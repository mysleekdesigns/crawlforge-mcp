import { z } from 'zod';
import { load } from 'cheerio';
import { MapSiteTool } from '../tools/crawl/mapSite.js';
import { CrawlDeepTool } from '../tools/crawl/crawlDeep.js';
import { normalizeUrl, getBaseUrl } from '../utils/urlNormalizer.js';
import { Logger } from '../utils/Logger.js';
import { safeFetch } from '../utils/ssrfGuard.js';
import { resolveUserAgent } from '../utils/fetchIdentity.js';
import { preflightFetch } from '../utils/robotsGate.js';
import { noteRetryAfter } from '../utils/hostRateLimiter.js';

const logger = new Logger('LLMsTxtAnalyzer');

// How many URLs to gather before ranking them down to maxPages. Large enough
// that a mid-size documentation site's top-level sections are all represented
// in the pool, small enough not to walk a big sitemap index end to end.
const CANDIDATE_POOL = 500;

/**
 * LLMsTxtAnalyzer - Comprehensive website analysis for LLMs.txt generation
 * 
 * This analyzer performs deep website analysis to understand:
 * - Site structure and navigation patterns
 * - API endpoints and data sources
 * - Content types and classification
 * - Security boundaries and sensitive areas
 * - Rate limiting recommendations
 * - Usage guidelines for AI models
 */
export class LLMsTxtAnalyzer {
  constructor(options = {}) {
    this.options = {
      maxDepth: options.maxDepth || 3,
      maxPages: options.maxPages || 100,
      timeout: options.timeout || 30000,
      userAgent: resolveUserAgent(options.userAgent),
      respectRobots: options.respectRobots !== false,
      detectAPIs: options.detectAPIs !== false,
      analyzeContent: options.analyzeContent !== false,
      // C1: intrusive probing is now opt-in (default false) to avoid hammering
      // security-sensitive and rate-probe paths on every generation run.
      checkSecurity: options.checkSecurity === true,
      probeRateLimit: options.probeRateLimit === true,
      ...options
    };

    this.mapSiteTool = new MapSiteTool({ 
      timeout: this.options.timeout,
      userAgent: this.options.userAgent 
    });
    
    this.crawlDeepTool = new CrawlDeepTool({ 
      timeout: this.options.timeout,
      userAgent: this.options.userAgent 
    });

    this.analysis = {
      structure: {},
      apis: [],
      contentTypes: {},
      securityAreas: [],
      // Conservative defaults so output never renders `undefined` when live
      // rate-limit probing is skipped (analyzeRateLimiting only runs with
      // probeRateLimit:true). Overwritten with measured values when probed.
      rateLimit: {
        recommendedDelay: 1000,
        maxConcurrency: 5,
        recommendedRPM: 30,
        reasoning: 'Conservative defaults applied; live rate-limit probing was not performed (pass probeRateLimit:true to measure actual response times).',
        averageResponseTime: null
      },
      guidelines: {},
      metadata: {},
      errors: []
    };
  }

  /**
   * Perform comprehensive website analysis
   */
  async analyzeWebsite(url, options = {}) {
    const startTime = Date.now();
    logger.info(`Starting comprehensive analysis for: ${url}`);

    try {
      const baseUrl = getBaseUrl(url);
      this.analysis.metadata = {
        baseUrl,
        analyzedAt: new Date().toISOString(),
        analyzer: 'LLMs.txt-Analyzer/1.0',
        analysisOptions: { ...this.options, ...options }
      };

      // Phase 1: Site Structure Analysis (must run first — subsequent phases
      // depend on the URL list it produces)
      await this.analyzeSiteStructure(url, options);

      // Phases 2-5 run in parallel where they are independent of each other.
      // detectAPIEndpoints and analyzeSecurity each fire a bounded set of probe
      // fetches (capped at PROBE_CONCURRENCY concurrent requests per phase).
      // analyzeRateLimiting is only executed when the caller opts in via
      // probeRateLimit:true — its 5 sequential requests are intrusive.
      const parallelTasks = [];

      if (this.options.detectAPIs) {
        parallelTasks.push(this.detectAPIEndpoints(url));
      }
      if (this.options.analyzeContent) {
        parallelTasks.push(this.classifyContent());
      }
      if (this.options.checkSecurity) {
        parallelTasks.push(this.analyzeSecurity(url));
      }
      if (this.options.probeRateLimit) {
        parallelTasks.push(this.analyzeRateLimiting(url));
      }

      await Promise.all(parallelTasks);

      // Phase 6: Generate Guidelines
      await this.generateUsageGuidelines();

      const analysisTime = Date.now() - startTime;
      this.analysis.metadata.analysisTimeMs = analysisTime;

      logger.info(`Analysis completed in ${analysisTime}ms`);
      return this.analysis;

    } catch (error) {
      logger.error(`Analysis failed: ${error.message}`);
      this.analysis.errors.push({
        phase: 'general',
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Analyze website structure using site mapping and crawling
   */
  async analyzeSiteStructure(url, options = {}) {
    logger.info('Analyzing site structure...');

    try {
      // Get comprehensive site map. map_site truncates in sitemap document
      // order, so asking it for exactly maxPages returns whichever section the
      // sitemap happens to list first — the homepage and the docs/spec entry
      // points never arrive. Ask for a larger candidate pool instead (the
      // sitemap is downloaded whole either way, so a site with one sitemap pays
      // no extra request), then keep the maxPages that describe the site.
      const siteMap = await this.mapSiteTool.execute({
        url,
        include_sitemap: true,
        max_urls: Math.max(this.options.maxPages, CANDIDATE_POOL),
        group_by_path: true,
        include_metadata: true
      });

      // Perform targeted crawl for deeper analysis
      const crawlResult = await this.crawlDeepTool.execute({
        url,
        max_depth: Math.min(this.options.maxDepth, 3),
        max_pages: Math.min(this.options.maxPages, 50),
        extract_content: true,
        respect_robots: this.options.respectRobots
      });

      // group_by_path:true returns {section: [...]}; flatten before ranking.
      const candidates = Array.isArray(siteMap.urls) ? siteMap.urls :
                         (siteMap.urls && typeof siteMap.urls === 'object' ? Object.values(siteMap.urls).flat() : []);
      const pages = this.prioritizeUrls(candidates, getBaseUrl(url), this.options.maxPages);

      this.analysis.structure = {
        // Every field describes the same selected pages, not the wider pool.
        siteMap: this.mapSiteTool.generateSiteMap(pages),
        totalPages: pages.length,
        sections: this.categorizeSections(pages),
        navigation: this.analyzeNavigation(crawlResult.pages),
        hierarchy: this.buildHierarchy(pages),
        robotsTxt: await this.fetchRobotsTxt(url),
        sitemap: pages
      };

      logger.info(`Selected ${pages.length} of ${siteMap.total_urls} discovered pages for the site structure`);

    } catch (error) {
      logger.error(`Site structure analysis failed: ${error.message}`);
      this.analysis.errors.push({
        phase: 'structure',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Detect API endpoints and data sources
   * C1: probe fetches run in parallel (capped at PROBE_CONCURRENCY).
   */
  async detectAPIEndpoints(baseUrl) {
    logger.info('Detecting API endpoints...');

    const PROBE_CONCURRENCY = 6;

    try {
      const commonPaths = [
        '/api', '/v1', '/v2', '/v3', '/rest', '/graphql',
        '/data', '/feed', '/json', '/xml', '/rss',
        '/.well-known', '/openapi', '/swagger'
      ];

      // Run path probes in parallel batches
      const apis = [];
      for (let i = 0; i < commonPaths.length; i += PROBE_CONCURRENCY) {
        const batch = commonPaths.slice(i, i + PROBE_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (path) => {
            const apiUrl = `${baseUrl}${path}`;
            const response = await this.fetchWithTimeout(apiUrl, { timeout: 5000 });
            if (response.ok) {
              const contentType = response.headers.get('content-type') || '';
              return {
                url: apiUrl,
                type: this.determineAPIType(apiUrl, contentType),
                status: response.status,
                contentType,
                accessible: true
              };
            }
            return null;
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) apis.push(r.value);
        }
      }

      // Look for API documentation references
      const mainPageResponse = await this.fetchWithTimeout(baseUrl);
      if (mainPageResponse.ok) {
        const html = await mainPageResponse.text();
        const $ = load(html);
        
        // Find API documentation links
        $('a[href*="api"], a[href*="developer"], a[href*="docs"]').each((_, element) => {
          const href = $(element).attr('href');
          const text = $(element).text().toLowerCase();
          // Word-boundary match: substring checks flagged "Sapiens"/"rapid"
          // style words as API links.
          if (href && /\b(api|developer)s?\b/.test(text)) {
            apis.push({
              url: new URL(href, baseUrl).toString(),
              type: 'documentation',
              description: text.trim()
            });
          }
        });
      }

      this.analysis.apis = apis;
      logger.info(`Detected ${apis.length} API endpoints`);

    } catch (error) {
      logger.error(`API detection failed: ${error.message}`);
      this.analysis.errors.push({
        phase: 'apis',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Classify content types across the website
   */
  async classifyContent() {
    logger.info('Classifying content types...');

    try {
      const contentTypes = {
        public: [],
        restricted: [],
        dynamic: [],
        static: [],
        forms: [],
        media: [],
        documents: []
      };

      // Analyze pages from structure analysis
      const sitemapUrls = this.analysis.structure?.sitemap || [];
      const urlsToAnalyze = Array.isArray(sitemapUrls) ? sitemapUrls : 
                           (typeof sitemapUrls === 'object' ? Object.values(sitemapUrls).flat() : []);
      
      if (urlsToAnalyze.length > 0) {
        for (const url of urlsToAnalyze.slice(0, 20)) {
          try {
            const classification = await this.classifyPage(url);
            contentTypes[classification.category].push({
              url,
              type: classification.type,
              confidence: classification.confidence,
              metadata: classification.metadata
            });
          } catch (error) {
            logger.warn(`Failed to classify page ${url}: ${error.message}`);
          }
        }
      }

      this.analysis.contentTypes = contentTypes;
      logger.info('Content classification completed');

    } catch (error) {
      logger.error(`Content classification failed: ${error.message}`);
      this.analysis.errors.push({
        phase: 'content',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Analyze security boundaries and sensitive areas
   * C1: probe fetches run in parallel (capped at PROBE_CONCURRENCY).
   */
  async analyzeSecurity(baseUrl) {
    logger.info('Analyzing security boundaries...');

    const PROBE_CONCURRENCY = 6;

    try {
      // Check for common sensitive paths
      const sensitivePaths = [
        '/admin', '/administrator', '/wp-admin', '/cms',
        '/login', '/signin', '/auth', '/oauth',
        '/user', '/account', '/profile', '/dashboard',
        '/private', '/internal', '/secure',
        '/config', '/settings', '/env'
      ];

      // Run path probes in parallel batches
      const securityAreas = [];
      for (let i = 0; i < sensitivePaths.length; i += PROBE_CONCURRENCY) {
        const batch = sensitivePaths.slice(i, i + PROBE_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (path) => {
            const testUrl = `${baseUrl}${path}`;
            const response = await this.fetchWithTimeout(testUrl, { timeout: 3000 });
            if (response.status === 200 || response.status === 302 || response.status === 401) {
              return {
                path,
                url: testUrl,
                status: response.status,
                type: this.classifySecurityArea(path),
                recommendation: 'restrict'
              };
            }
            return null;
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) securityAreas.push(r.value);
        }
      }

      // Check for security headers
      const mainResponse = await this.fetchWithTimeout(baseUrl);
      const securityHeaders = this.analyzeSecurityHeaders(mainResponse.headers);

      this.analysis.securityAreas = securityAreas;
      this.analysis.securityHeaders = securityHeaders;
      logger.info(`Identified ${securityAreas.length} security areas`);

    } catch (error) {
      logger.error(`Security analysis failed: ${error.message}`);
      this.analysis.errors.push({
        phase: 'security',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Analyze and recommend rate limiting
   */
  async analyzeRateLimiting(baseUrl) {
    logger.info('Analyzing rate limiting requirements...');

    try {
      // Test response times and determine appropriate limits
      const testRequests = 5;
      const responseTimes = [];

      for (let i = 0; i < testRequests; i++) {
        const start = Date.now();
        try {
          await this.fetchWithTimeout(baseUrl, { timeout: 10000 });
          responseTimes.push(Date.now() - start);
        } catch {
          responseTimes.push(10000); // Max timeout
        }
      }

      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      
      this.analysis.rateLimit = {
        averageResponseTime: avgResponseTime,
        recommendedDelay: Math.max(100, Math.floor(avgResponseTime * 0.5)),
        maxConcurrency: avgResponseTime > 2000 ? 2 : (avgResponseTime > 1000 ? 5 : 10),
        recommendedRPM: avgResponseTime > 2000 ? 10 : (avgResponseTime > 1000 ? 30 : 60),
        reasoning: this.generateRateLimitReasoning(avgResponseTime)
      };

      logger.info(`Rate limiting analysis completed. Avg response: ${avgResponseTime}ms`);

    } catch (error) {
      logger.error(`Rate limiting analysis failed: ${error.message}`);
      this.analysis.errors.push({
        phase: 'rateLimit',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Generate comprehensive usage guidelines
   */
  async generateUsageGuidelines() {
    logger.info('Generating usage guidelines...');

    try {
      this.analysis.guidelines = {
        crawling: this.generateCrawlingGuidelines(),
        apis: this.generateAPIGuidelines(),
        rateLimit: this.generateRateLimitGuidelines(),
        content: this.generateContentGuidelines(),
        security: this.generateSecurityGuidelines(),
        compliance: this.generateComplianceGuidelines()
      };

      logger.info('Usage guidelines generated');

    } catch (error) {
      logger.error(`Guidelines generation failed: ${error.message}`);
      this.analysis.errors.push({
        phase: 'guidelines',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Helper methods

  async fetchWithTimeout(url, options = {}) {
    const { timeout = this.options.timeout } = options;
    const gate = await preflightFetch(url, {
      respectRobots: this.options.respectRobots,
      userAgent: this.options.userAgent,
      tool: 'generate_llms_txt'
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await safeFetch(url, {
        signal: controller.signal,
        headers: { ...gate.headers },
        ...options
      });
      clearTimeout(timeoutId);
      if (response.status === 429 || response.status === 503) {
        noteRetryAfter(url, response.headers.get('retry-after'));
      }
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async fetchRobotsTxt(baseUrl) {
    try {
      const robotsUrl = `${baseUrl}/robots.txt`;
      const response = await this.fetchWithTimeout(robotsUrl);
      if (response.ok) {
        return await response.text();
      }
    } catch {
      // No robots.txt found
    }
    return null;
  }

  /**
   * Order candidate URLs by how much they tell an LLM about the site, then
   * keep the first `limit`.
   *
   * Truncating the crawl order instead returned whichever section the sitemap
   * lists first: modelcontextprotocol.io with maxPages 15 produced 15
   * /community/* pages and no homepage, docs or specification. The order here
   * is the site root, then one entry point per top-level section the site
   * declares, then the rest of each section a page at a time until the budget
   * runs out. Sections are visited alphabetically and ties inside a section
   * break on depth then alphabetically, so a given site always yields the same
   * list.
   */
  prioritizeUrls(urls, baseUrl, limit) {
    const sections = new Map();
    let sawAny = false;

    for (const url of urls) {
      let segments;
      try {
        segments = new URL(url).pathname.split('/').filter(Boolean);
      } catch {
        continue;
      }
      sawAny = true;
      // The root arrives as either "https://site.com" or "https://site.com/"
      // (normalizeUrl strips a trailing slash from every path but "/"), so it
      // is recognised by its path and re-added below in one canonical form.
      if (segments.length === 0) continue;
      const section = segments[0];
      if (!sections.has(section)) sections.set(section, []);
      sections.get(section).push({ url, depth: segments.length });
    }

    if (!sawAny) return [];

    // The site root leads: it is always fetched, and a site guide that omits
    // the homepage is a misleading one.
    const ordered = [`${baseUrl}/`];
    const queues = [...sections.keys()].sort().map((name) =>
      sections.get(name).sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url)));

    let placed = true;
    while (ordered.length < limit && placed) {
      placed = false;
      for (const queue of queues) {
        if (ordered.length >= limit) break;
        const next = queue.shift();
        if (!next) continue;
        ordered.push(next.url);
        placed = true;
      }
    }

    return ordered;
  }

  categorizeSections(urls) {
    const categories = {
      content: [],
      navigation: [],
      media: [],
      tools: [],
      documentation: [],
      other: []
    };

    if (typeof urls === 'object' && !Array.isArray(urls)) {
      // Handle grouped URLs
      for (const [path, urlList] of Object.entries(urls)) {
        const category = this.categorizeSection(path);
        categories[category].push({ path, urls: urlList });
      }
    } else if (Array.isArray(urls)) {
      // Handle flat URL list
      for (const url of urls) {
        try {
          const urlObj = new URL(url);
          const path = urlObj.pathname;
          const category = this.categorizeSection(path);
          categories[category].push(url);
        } catch {
          categories.other.push(url);
        }
      }
    }

    return categories;
  }

  categorizeSection(path) {
    const contentPaths = ['/blog', '/news', '/articles', '/posts'];
    const navPaths = ['/about', '/contact', '/help', '/support'];
    const mediaPaths = ['/images', '/media', '/gallery', '/downloads'];
    const toolPaths = ['/tools', '/utilities', '/calculator', '/converter'];
    const docPaths = ['/docs', '/documentation', '/api', '/guide'];

    if (contentPaths.some(p => path.includes(p))) return 'content';
    if (navPaths.some(p => path.includes(p))) return 'navigation';
    if (mediaPaths.some(p => path.includes(p))) return 'media';
    if (toolPaths.some(p => path.includes(p))) return 'tools';
    if (docPaths.some(p => path.includes(p))) return 'documentation';
    
    return 'other';
  }

  analyzeNavigation(pages) {
    const navigation = {
      mainMenu: [],
      breadcrumbs: [],
      footer: [],
      sideNav: []
    };

    if (pages && pages.length > 0) {
      // Analyze first few pages for common navigation patterns
      for (const page of pages.slice(0, 3)) {
        if (page.content) {
          const $ = load(page.content);
          
          // Extract main navigation
          $('nav, .nav, #nav, .navigation, .menu').each((_, element) => {
            $(element).find('a').each((_, link) => {
              const href = $(link).attr('href');
              const text = $(link).text().trim();
              if (href && text) {
                navigation.mainMenu.push({ href, text });
              }
            });
          });
        }
      }
    }

    return navigation;
  }

  buildHierarchy(urls) {
    const hierarchy = { depth: {}, paths: {} };
    
    const urlArray = Array.isArray(urls) ? urls : 
                     typeof urls === 'object' ? Object.values(urls).flat() : [];

    for (const url of urlArray) {
      try {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/').filter(s => s);
        const depth = pathSegments.length;

        if (!hierarchy.depth[depth]) {
          hierarchy.depth[depth] = [];
        }
        hierarchy.depth[depth].push(url);

        // Build path hierarchy
        let currentPath = '';
        for (const segment of pathSegments) {
          currentPath += '/' + segment;
          if (!hierarchy.paths[currentPath]) {
            hierarchy.paths[currentPath] = [];
          }
          hierarchy.paths[currentPath].push(url);
        }
      } catch {
        // Skip invalid URLs
      }
    }

    return hierarchy;
  }

  async classifyPage(url) {
    try {
      const response = await this.fetchWithTimeout(url, { timeout: 5000 });
      if (!response.ok) {
        return { category: 'other', type: 'inaccessible', confidence: 1.0 };
      }

      const contentType = response.headers.get('content-type') || '';
      const html = await response.text();
      const $ = load(html);

      // Check for forms
      if ($('form').length > 0) {
        return { 
          category: 'forms', 
          type: 'interactive', 
          confidence: 0.9,
          metadata: { formCount: $('form').length }
        };
      }

      // Check for login/auth indicators
      if (html.includes('login') || html.includes('password') || $('input[type="password"]').length > 0) {
        return { category: 'restricted', type: 'authentication', confidence: 0.8 };
      }

      // Check for dynamic content indicators
      if (html.includes('application/json') || contentType.includes('json')) {
        return { category: 'dynamic', type: 'api', confidence: 0.9 };
      }

      // Check file extensions for media/documents
      const urlObj = new URL(url);
      const extension = urlObj.pathname.split('.').pop().toLowerCase();
      const mediaExts = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'mp4', 'mp3'];
      const docExts = ['pdf', 'doc', 'docx', 'txt', 'csv', 'xml'];

      if (mediaExts.includes(extension)) {
        return { category: 'media', type: extension, confidence: 1.0 };
      }
      if (docExts.includes(extension)) {
        return { category: 'documents', type: extension, confidence: 1.0 };
      }

      // Default to public static content
      return { 
        category: 'public', 
        type: 'static', 
        confidence: 0.7,
        metadata: { 
          title: $('title').text().trim(),
          contentLength: html.length 
        }
      };

    } catch (error) {
      return { 
        category: 'other', 
        type: 'error', 
        confidence: 1.0, 
        error: error.message 
      };
    }
  }

  determineAPIType(url, contentType) {
    if (url.includes('graphql')) return 'GraphQL';
    if (url.includes('rest') || url.includes('api')) return 'REST';
    if (contentType.includes('json')) return 'JSON API';
    if (contentType.includes('xml')) return 'XML API';
    if (url.includes('rss')) return 'RSS Feed';
    return 'Unknown API';
  }

  classifySecurityArea(path) {
    if (path.includes('admin')) return 'admin';
    if (path.includes('login') || path.includes('auth')) return 'authentication';
    if (path.includes('user') || path.includes('account')) return 'user_area';
    if (path.includes('private') || path.includes('internal')) return 'private';
    if (path.includes('config') || path.includes('settings')) return 'configuration';
    return 'sensitive';
  }

  analyzeSecurityHeaders(headers) {
    const securityHeaders = {};
    const importantHeaders = [
      'x-frame-options',
      'x-content-type-options',
      'x-xss-protection',
      'strict-transport-security',
      'content-security-policy',
      'x-robots-tag'
    ];

    for (const header of importantHeaders) {
      const value = headers.get(header);
      if (value) {
        securityHeaders[header] = value;
      }
    }

    return securityHeaders;
  }

  generateRateLimitReasoning(avgResponseTime) {
    if (avgResponseTime > 2000) {
      return 'High response times suggest limited server capacity. Conservative rate limiting recommended.';
    }
    if (avgResponseTime > 1000) {
      return 'Moderate response times indicate standard server capacity. Moderate rate limiting appropriate.';
    }
    return 'Fast response times suggest good server capacity. Higher rate limits may be acceptable.';
  }

  generateCrawlingGuidelines() {
    const guidelines = {
      allowed: true,
      respectRobots: true,
      recommendations: []
    };

    if (this.analysis.structure?.robotsTxt) {
      guidelines.robotsTxtFound = true;
      guidelines.recommendations.push('Follow robots.txt directives');
    }

    if (this.analysis.securityAreas && this.analysis.securityAreas.length > 0) {
      guidelines.recommendations.push('Avoid crawling administrative and user-specific areas');
    }

    return guidelines;
  }

  generateAPIGuidelines() {
    const apiCount = this.analysis.apis ? this.analysis.apis.length : 0;
    return {
      endpoints: apiCount,
      recommendations: apiCount > 0 ? 
        ['Use APIs when available instead of scraping', 'Check API documentation for rate limits'] :
        ['No public APIs detected', 'Web scraping may be the only option']
    };
  }

  generateRateLimitGuidelines() {
    const rateLimit = this.analysis.rateLimit || {};
    return {
      delay: rateLimit.recommendedDelay || 1000,
      maxConcurrency: rateLimit.maxConcurrency || 5,
      requestsPerMinute: rateLimit.recommendedRPM || 30,
      reasoning: rateLimit.reasoning || 'Default conservative rate limiting applied'
    };
  }

  generateContentGuidelines() {
    const contentTypes = this.analysis.contentTypes || {};
    const totalContent = Object.values(contentTypes).reduce(
      (sum, arr) => sum + (arr ? arr.length : 0), 0
    );

    return {
      totalPagesAnalyzed: totalContent,
      publicContent: contentTypes.public ? contentTypes.public.length : 0,
      restrictedContent: contentTypes.restricted ? contentTypes.restricted.length : 0,
      recommendations: [
        'Focus on public content areas',
        'Respect form submissions and user data',
        'Avoid restricted and private sections'
      ]
    };
  }

  generateSecurityGuidelines() {
    const securityAreas = this.analysis.securityAreas || [];
    return {
      sensitiveAreas: securityAreas.length,
      recommendations: [
        'Do not attempt to access administrative areas',
        'Respect authentication requirements',
        'Avoid sensitive paths and user data'
      ]
    };
  }

  generateComplianceGuidelines() {
    return {
      dataProtection: [
        'Respect user privacy and data protection laws',
        'Do not collect personal information',
        'Follow GDPR, CCPA, and other applicable regulations'
      ],
      ethical: [
        'Use data responsibly and ethically',
        'Respect website terms of service',
        'Credit sources appropriately'
      ]
    };
  }
}

export default LLMsTxtAnalyzer;
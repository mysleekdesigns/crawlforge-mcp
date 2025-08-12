import { load } from 'cheerio';
import { QueueManager } from '../queue/QueueManager.js';
import { CacheManager } from '../cache/CacheManager.js';
import { RateLimiter } from '../../utils/rateLimiter.js';
import { RobotsChecker } from '../../utils/robotsChecker.js';
import { DomainFilter } from '../../utils/domainFilter.js';
import { LinkAnalyzer } from '../analysis/LinkAnalyzer.js';
import { normalizeUrl, extractLinks, isValidUrl } from '../../utils/urlNormalizer.js';

export class BFSCrawler {
  constructor(options = {}) {
    const {
      maxDepth = 5,
      maxPages = 100,
      followExternal = false,
      respectRobots = true,
      userAgent = 'MCP-WebScraper/1.0',
      timeout = 30000,
      concurrency = 10,
      domainFilter = null,
      enableLinkAnalysis = true,
      linkAnalyzerOptions = {}
    } = options;

    this.maxDepth = maxDepth;
    this.maxPages = maxPages;
    this.followExternal = followExternal;
    this.respectRobots = respectRobots;
    this.userAgent = userAgent;
    this.timeout = timeout;

    this.visited = new Set();
    this.results = [];
    this.errors = [];
    this.filterDecisions = []; // Track filtering decisions for analysis
    
    // Link analysis
    this.enableLinkAnalysis = enableLinkAnalysis;
    this.linkAnalyzer = enableLinkAnalysis ? new LinkAnalyzer(linkAnalyzerOptions) : null;
    
    this.queue = new QueueManager({ concurrency, timeout });
    this.cache = new CacheManager({ ttl: 3600000 }); // 1 hour cache
    this.rateLimiter = new RateLimiter({ requestsPerSecond: 10 });
    this.robotsChecker = respectRobots ? new RobotsChecker(userAgent) : null;
    
    // Initialize domain filter (create new if not provided)
    this.domainFilter = domainFilter || new DomainFilter({
      allowSubdomains: !followExternal, // If not following external, allow subdomains by default
      defaultMaxDepth: maxDepth,
      defaultRateLimit: 10
    });
  }

  async crawl(startUrl, options = {}) {
    const {
      includePatterns = [],
      excludePatterns = [],
      extractContent = true,
      domainFilterConfig = null
    } = options;

    // Backward compatibility: convert old patterns to domain filter patterns
    this.includePatterns = includePatterns.map(p => new RegExp(p));
    this.excludePatterns = excludePatterns.map(p => new RegExp(p));
    
    // Add legacy patterns to domain filter for unified processing
    for (const pattern of includePatterns) {
      this.domainFilter.addPattern(pattern, 'include', { description: 'Legacy include pattern' });
    }
    for (const pattern of excludePatterns) {
      this.domainFilter.addPattern(pattern, 'exclude', { description: 'Legacy exclude pattern' });
    }
    
    // Apply additional domain filter configuration if provided
    if (domainFilterConfig) {
      if (domainFilterConfig.whitelist) {
        for (const [domain, options] of Object.entries(domainFilterConfig.whitelist)) {
          this.domainFilter.addWhitelistDomain(domain, options);
        }
      }
      if (domainFilterConfig.blacklist) {
        for (const [domain, options] of Object.entries(domainFilterConfig.blacklist)) {
          this.domainFilter.addBlacklistDomain(domain, options);
        }
      }
    }

    this.extractContent = extractContent;
    this.filterDecisions = []; // Reset filter decisions

    const normalizedStart = normalizeUrl(startUrl);
    this.baseUrl = new URL(normalizedStart);
    
    // Check if start URL is allowed
    const startUrlDecision = this.domainFilter.isAllowed(normalizedStart);
    if (!startUrlDecision.allowed) {
      throw new Error(`Start URL blocked by domain filter: ${startUrlDecision.reason}`);
    }
    
    // Initialize queue with starting URL
    await this.queue.add(() => this.processUrl(normalizedStart, 0));

    // Wait for crawling to complete
    await this.queue.onIdle();

    // Perform link analysis if enabled
    let linkAnalysisResults = null;
    if (this.enableLinkAnalysis && this.linkAnalyzer) {
      linkAnalysisResults = this.performLinkAnalysis();
    }

    return {
      urls: Array.from(this.visited),
      results: this.results,
      errors: this.errors,
      stats: this.getStats(),
      linkAnalysis: linkAnalysisResults
    };
  }

  async processUrl(url, depth) {
    // Check limits
    if (depth > this.maxDepth || this.visited.size >= this.maxPages) {
      return;
    }

    // Check if already visited
    const normalizedUrl = normalizeUrl(url);
    if (this.visited.has(normalizedUrl)) {
      return;
    }

    // Check domain filter (replaces old pattern checking)
    const filterDecision = this.domainFilter.isAllowed(normalizedUrl);
    this.filterDecisions.push({
      url: normalizedUrl,
      decision: filterDecision,
      timestamp: new Date().toISOString()
    });
    
    if (!filterDecision.allowed) {
      console.log(`Domain filter blocks: ${normalizedUrl} - ${filterDecision.reason}`);
      return;
    }
    
    // Backward compatibility: also check legacy patterns
    if (!this.shouldCrawlUrl(normalizedUrl)) {
      console.log(`Legacy pattern blocks: ${normalizedUrl}`);
      return;
    }

    // Check robots.txt
    if (this.respectRobots && this.robotsChecker) {
      const canFetch = await this.robotsChecker.canFetch(normalizedUrl);
      if (!canFetch) {
        console.log(`Robots.txt blocks: ${normalizedUrl}`);
        return;
      }
    }

    // Mark as visited
    this.visited.add(normalizedUrl);

    try {
      // Check cache first
      const cacheKey = this.cache.generateKey(normalizedUrl);
      let pageData = await this.cache.get(cacheKey);

      if (!pageData) {
        // Apply domain-specific rate limiting
        const urlObj = new URL(normalizedUrl);
        const domainRules = this.domainFilter.getDomainRules(urlObj.hostname);
        
        // Use domain-specific rate limit if available
        const effectiveRateLimit = domainRules.rateLimit || 10;
        if (this.rateLimiter.requestsPerSecond !== effectiveRateLimit) {
          // Update rate limiter for this domain
          this.rateLimiter = new RateLimiter({ requestsPerSecond: effectiveRateLimit });
        }
        
        await this.rateLimiter.checkLimit(normalizedUrl);

        // Fetch the page
        pageData = await this.fetchPage(normalizedUrl);
        
        // Cache the result
        await this.cache.set(cacheKey, pageData);
      }

      // Process links for analysis
      if (this.enableLinkAnalysis && this.linkAnalyzer && pageData.links) {
        for (const link of pageData.links) {
          const absoluteUrl = this.resolveUrl(link, normalizedUrl);
          if (absoluteUrl) {
            // Extract anchor text and context from link
            const linkMetadata = this.extractLinkMetadata(link, pageData.originalHtml, normalizedUrl);
            this.linkAnalyzer.addLink(normalizedUrl, absoluteUrl, linkMetadata);
          }
        }
      }

      // Process the page
      const result = {
        url: normalizedUrl,
        depth,
        title: pageData.title,
        contentLength: pageData.content?.length || 0,
        links: pageData.links?.length || 0,
        timestamp: new Date().toISOString()
      };

      if (this.extractContent) {
        result.content = pageData.content;
        result.metadata = pageData.metadata;
      }

      this.results.push(result);

      // Add discovered links to queue (if not at max depth)
      if (depth < this.maxDepth && pageData.links) {
        for (const link of pageData.links) {
          if (this.visited.size >= this.maxPages) break;
          
          const absoluteUrl = this.resolveUrl(link, normalizedUrl);
          if (absoluteUrl && !this.visited.has(absoluteUrl)) {
            await this.queue.add(() => this.processUrl(absoluteUrl, depth + 1));
          }
        }
      }
    } catch (error) {
      this.errors.push({
        url: normalizedUrl,
        depth,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  async fetchPage(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // Get domain-specific headers and timeout
      const urlObj = new URL(url);
      const domainRules = this.domainFilter.getDomainRules(urlObj.hostname);
      
      const defaultHeaders = {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      };
      
      const headers = { ...defaultHeaders, ...domainRules.customHeaders };
      const effectiveTimeout = domainRules.timeout || this.timeout;
      
      // Update timeout if different
      if (effectiveTimeout !== this.timeout) {
        clearTimeout(timeoutId);
        setTimeout(() => controller.abort(), effectiveTimeout);
      }
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/html')) {
        throw new Error(`Non-HTML content type: ${contentType}`);
      }

      const html = await response.text();
      return this.parsePage(html, url);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  parsePage(html, url) {
    const $ = load(html);
    
    // Extract title
    const title = $('title').text().trim() || $('h1').first().text().trim() || '';
    
    // Extract main content
    $('script, style, noscript').remove();
    const content = $('body').text().replace(/\s+/g, ' ').trim();
    
    // Extract metadata
    const metadata = {
      description: $('meta[name="description"]').attr('content') || '',
      keywords: $('meta[name="keywords"]').attr('content') || '',
      author: $('meta[name="author"]').attr('content') || '',
      ogTitle: $('meta[property="og:title"]').attr('content') || '',
      ogDescription: $('meta[property="og:description"]').attr('content') || ''
    };
    
    // Extract links
    const links = [];
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        links.push(href);
      }
    });

    return {
      title,
      content,
      metadata,
      links: [...new Set(links)], // Remove duplicates
      originalHtml: html // Store original HTML for link analysis
    };
  }

  resolveUrl(link, baseUrl) {
    try {
      // Handle absolute URLs
      if (link.startsWith('http://') || link.startsWith('https://')) {
        const linkUrl = new URL(link);
        
        // Check if we should follow external links
        if (!this.followExternal && linkUrl.origin !== this.baseUrl.origin) {
          return null;
        }
        
        return normalizeUrl(link);
      }
      
      // Handle relative URLs
      const resolved = new URL(link, baseUrl);
      
      // Check if we should follow external links
      if (!this.followExternal && resolved.origin !== this.baseUrl.origin) {
        return null;
      }
      
      return normalizeUrl(resolved.toString());
    } catch {
      return null;
    }
  }

  shouldCrawlUrl(url) {
    // Check include patterns
    if (this.includePatterns.length > 0) {
      const matches = this.includePatterns.some(pattern => pattern.test(url));
      if (!matches) return false;
    }

    // Check exclude patterns
    if (this.excludePatterns.length > 0) {
      const excluded = this.excludePatterns.some(pattern => pattern.test(url));
      if (excluded) return false;
    }

    return true;
  }

  getStats() {
    const filterStats = this.domainFilter.getStats();
    const filterDecisionStats = this.getFilterDecisionStats();
    
    return {
      visited: this.visited.size,
      results: this.results.length,
      errors: this.errors.length,
      cacheStats: this.cache.getStats(),
      queueStats: this.queue.getStats(),
      rateLimitStats: this.rateLimiter.getStats(),
      domainFilterStats: filterStats,
      filterDecisions: filterDecisionStats
    };
  }
  
  getFilterDecisionStats() {
    const total = this.filterDecisions.length;
    const allowed = this.filterDecisions.filter(d => d.decision.allowed).length;
    const blocked = total - allowed;
    
    const reasonCounts = {};
    this.filterDecisions.forEach(d => {
      if (!d.decision.allowed) {
        reasonCounts[d.decision.reason] = (reasonCounts[d.decision.reason] || 0) + 1;
      }
    });
    
    return {
      total,
      allowed,
      blocked,
      allowedPercentage: total > 0 ? (allowed / total * 100).toFixed(2) : 0,
      blockedReasons: reasonCounts
    };
  }

  pause() {
    this.queue.pause();
  }

  resume() {
    this.queue.start();
  }

  stop() {
    this.queue.clear();
    this.queue.pause();
  }

  /**
   * Get the domain filter instance
   * @returns {DomainFilter} Current domain filter
   */
  getDomainFilter() {
    return this.domainFilter;
  }

  /**
   * Set a new domain filter instance
   * @param {DomainFilter} domainFilter - New domain filter to use
   */
  setDomainFilter(domainFilter) {
    if (!(domainFilter instanceof DomainFilter)) {
      throw new Error('Invalid domain filter: must be instance of DomainFilter');
    }
    this.domainFilter = domainFilter;
    this.filterDecisions = []; // Reset filter decisions
    return this;
  }

  /**
   * Configure domain filter with simple options
   * @param {Object} config - Configuration object
   */
  configureDomainFilter(config) {
    const {
      whitelist = [],
      blacklist = [],
      includePatterns = [],
      excludePatterns = [],
      domainRules = {}
    } = config;

    // Add whitelist domains
    for (const domain of whitelist) {
      if (typeof domain === 'string') {
        this.domainFilter.addWhitelistDomain(domain);
      } else if (typeof domain === 'object' && domain.domain) {
        this.domainFilter.addWhitelistDomain(domain.domain, domain.options || {});
      }
    }

    // Add blacklist domains
    for (const domain of blacklist) {
      if (typeof domain === 'string') {
        this.domainFilter.addBlacklistDomain(domain);
      } else if (typeof domain === 'object' && domain.domain) {
        this.domainFilter.addBlacklistDomain(domain.domain, domain.options || {});
      }
    }

    // Add include patterns
    for (const pattern of includePatterns) {
      if (typeof pattern === 'string') {
        this.domainFilter.addPattern(pattern, 'include');
      } else if (typeof pattern === 'object' && pattern.pattern) {
        this.domainFilter.addPattern(pattern.pattern, 'include', pattern.options || {});
      }
    }

    // Add exclude patterns
    for (const pattern of excludePatterns) {
      if (typeof pattern === 'string') {
        this.domainFilter.addPattern(pattern, 'exclude');
      } else if (typeof pattern === 'object' && pattern.pattern) {
        this.domainFilter.addPattern(pattern.pattern, 'exclude', pattern.options || {});
      }
    }

    // Set domain rules
    for (const [domain, rules] of Object.entries(domainRules)) {
      this.domainFilter.setDomainRules(domain, rules);
    }

    return this;
  }

  /**
   * Extract link metadata from HTML
   * @param {string} href - The href attribute value
   * @param {string} html - Original HTML content
   * @param {string} baseUrl - Base URL for context
   * @returns {Object} Link metadata
   */
  extractLinkMetadata(href, html, baseUrl) {
    if (!html) return {};

    try {
      const $ = load(html);
      const linkElement = $(`a[href="${href}"]`).first();
      
      if (linkElement.length === 0) {
        return { href };
      }

      const anchorText = linkElement.text().trim();
      const title = linkElement.attr('title');
      const rel = linkElement.attr('rel');
      const className = linkElement.attr('class');
      
      // Get surrounding context (up to 100 characters before and after)
      const linkHtml = linkElement.prop('outerHTML');
      const bodyText = $('body').text();
      const linkTextIndex = bodyText.indexOf(anchorText);
      let context = '';
      
      if (linkTextIndex >= 0 && anchorText) {
        const start = Math.max(0, linkTextIndex - 100);
        const end = Math.min(bodyText.length, linkTextIndex + anchorText.length + 100);
        context = bodyText.substring(start, end).trim();
      }

      return {
        href,
        anchorText,
        title,
        rel,
        className,
        context,
        extractedAt: new Date().toISOString()
      };
    } catch (error) {
      return { href, error: error.message };
    }
  }

  /**
   * Perform comprehensive link analysis
   * @returns {Object} Link analysis results
   */
  performLinkAnalysis() {
    if (!this.enableLinkAnalysis || !this.linkAnalyzer) {
      return null;
    }

    const startTime = Date.now();
    
    try {
      // Calculate link importance (PageRank)
      const importance = this.linkAnalyzer.calculateImportance();
      
      // Detect cycles
      const cycles = this.linkAnalyzer.detectCycles({ maxCycleLength: 8, includeMetadata: true });
      
      // Get comprehensive statistics
      const statistics = this.linkAnalyzer.getStatistics();
      
      // Find hub and authority pages
      const hubsAndAuthorities = this.findHubsAndAuthorities(importance);
      
      // Analyze link patterns
      const linkPatterns = this.analyzeLinkPatterns();
      
      // Get domain-level analysis
      const domainAnalysis = this.analyzeDomainLinking();

      const analysisTime = Date.now() - startTime;
      
      return {
        statistics,
        importance: this.formatImportanceResults(importance),
        cycles: cycles.map(cycle => ({
          ...cycle,
          urls: cycle.nodes,
          cycleLength: cycle.length,
          strength: cycle.strength
        })),
        hubsAndAuthorities,
        linkPatterns,
        domainAnalysis,
        analysisTime,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      return {
        error: error.message,
        analysisTime: Date.now() - startTime,
        generatedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Format importance results for output
   */
  formatImportanceResults(importance) {
    const results = Array.from(importance.entries())
      .map(([url, score]) => ({ url, importance: score }))
      .sort((a, b) => b.importance - a.importance);
    
    return {
      topPages: results.slice(0, 20),
      totalPages: results.length,
      averageImportance: results.reduce((sum, item) => sum + item.importance, 0) / results.length,
      importanceRange: {
        min: results[results.length - 1]?.importance || 0,
        max: results[0]?.importance || 0
      }
    };
  }

  /**
   * Find hub and authority pages
   */
  findHubsAndAuthorities(importance) {
    const nodes = Array.from(this.linkAnalyzer.nodes.keys());
    const hubs = [];
    const authorities = [];
    
    for (const node of nodes) {
      const outboundCount = this.linkAnalyzer.getOutboundLinks(node).length;
      const inboundCount = this.linkAnalyzer.getInboundLinks(node).length;
      const importanceScore = importance.get(node) || 0;
      
      // Hubs: pages with many outbound links
      if (outboundCount >= 10) {
        hubs.push({
          url: node,
          outboundLinks: outboundCount,
          importance: importanceScore
        });
      }
      
      // Authorities: pages with many inbound links
      if (inboundCount >= 5) {
        authorities.push({
          url: node,
          inboundLinks: inboundCount,
          importance: importanceScore
        });
      }
    }
    
    return {
      hubs: hubs.sort((a, b) => b.outboundLinks - a.outboundLinks).slice(0, 10),
      authorities: authorities.sort((a, b) => b.inboundLinks - a.inboundLinks).slice(0, 10)
    };
  }

  /**
   * Analyze link patterns
   */
  analyzeLinkPatterns() {
    const patterns = {
      internal: 0,
      external: 0,
      sameDomain: 0,
      crossDomain: 0,
      pathPatterns: new Map(),
      anchorTextAnalysis: new Map()
    };
    
    for (const [linkKey, linkData] of this.linkAnalyzer.linkMetadata) {
      const [from, to] = linkKey.split('|');
      
      try {
        const fromUrl = new URL(from);
        const toUrl = new URL(to);
        
        if (fromUrl.origin === this.baseUrl.origin) {
          patterns.internal++;
        } else {
          patterns.external++;
        }
        
        if (fromUrl.hostname === toUrl.hostname) {
          patterns.sameDomain++;
        } else {
          patterns.crossDomain++;
        }
        
        // Analyze path patterns
        const pathPattern = this.getPathPattern(toUrl.pathname);
        patterns.pathPatterns.set(pathPattern, 
          (patterns.pathPatterns.get(pathPattern) || 0) + 1);
        
        // Analyze anchor text
        const anchorText = linkData.anchorText?.toLowerCase().trim();
        if (anchorText && anchorText.length > 0) {
          patterns.anchorTextAnalysis.set(anchorText,
            (patterns.anchorTextAnalysis.get(anchorText) || 0) + 1);
        }
      } catch (error) {
        // Skip malformed URLs
      }
    }
    
    return {
      linkDistribution: {
        internal: patterns.internal,
        external: patterns.external,
        sameDomain: patterns.sameDomain,
        crossDomain: patterns.crossDomain
      },
      topPathPatterns: Array.from(patterns.pathPatterns.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([pattern, count]) => ({ pattern, count })),
      topAnchorTexts: Array.from(patterns.anchorTextAnalysis.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([text, count]) => ({ text, count }))
    };
  }

  /**
   * Analyze domain-level linking
   */
  analyzeDomainLinking() {
    const domainStats = new Map();
    
    for (const [linkKey] of this.linkAnalyzer.linkMetadata) {
      const [from, to] = linkKey.split('|');
      
      try {
        const fromDomain = new URL(from).hostname;
        const toDomain = new URL(to).hostname;
        
        if (!domainStats.has(fromDomain)) {
          domainStats.set(fromDomain, { outbound: 0, inbound: 0, internal: 0, external: 0 });
        }
        
        if (!domainStats.has(toDomain)) {
          domainStats.set(toDomain, { outbound: 0, inbound: 0, internal: 0, external: 0 });
        }
        
        domainStats.get(fromDomain).outbound++;
        domainStats.get(toDomain).inbound++;
        
        if (fromDomain === toDomain) {
          domainStats.get(fromDomain).internal++;
        } else {
          domainStats.get(fromDomain).external++;
        }
      } catch (error) {
        // Skip malformed URLs
      }
    }
    
    const topDomains = Array.from(domainStats.entries())
      .map(([domain, stats]) => ({ domain, ...stats }))
      .sort((a, b) => (b.outbound + b.inbound) - (a.outbound + a.inbound))
      .slice(0, 20);
    
    return {
      totalDomains: domainStats.size,
      topDomains,
      domainConnectivity: this.calculateDomainConnectivity(domainStats)
    };
  }

  /**
   * Calculate domain connectivity metrics
   */
  calculateDomainConnectivity(domainStats) {
    const domains = Array.from(domainStats.keys());
    const totalDomains = domains.length;
    
    if (totalDomains <= 1) {
      return { density: 0, averageConnections: 0 };
    }
    
    let totalConnections = 0;
    const connections = new Set();
    
    for (const [linkKey] of this.linkAnalyzer.linkMetadata) {
      const [from, to] = linkKey.split('|');
      
      try {
        const fromDomain = new URL(from).hostname;
        const toDomain = new URL(to).hostname;
        
        if (fromDomain !== toDomain) {
          const connectionKey = fromDomain < toDomain ? 
            `${fromDomain}-${toDomain}` : `${toDomain}-${fromDomain}`;
          connections.add(connectionKey);
        }
      } catch (error) {
        // Skip malformed URLs
      }
    }
    
    const uniqueConnections = connections.size;
    const maxPossibleConnections = (totalDomains * (totalDomains - 1)) / 2;
    const density = maxPossibleConnections > 0 ? uniqueConnections / maxPossibleConnections : 0;
    const averageConnections = totalDomains > 0 ? uniqueConnections / totalDomains : 0;
    
    return { density, averageConnections, uniqueConnections, maxPossibleConnections };
  }

  /**
   * Get path pattern for analysis
   */
  getPathPattern(pathname) {
    const segments = pathname.split('/').filter(s => s);
    
    if (segments.length === 0) return '/';
    if (segments.length === 1) return `/${segments[0]}/`;
    
    // Return first two segments as pattern
    return `/${segments[0]}/${segments[1]}/...`;
  }

  /**
   * Get link analyzer instance
   */
  getLinkAnalyzer() {
    return this.linkAnalyzer;
  }

  /**
   * Export link graph
   */
  exportLinkGraph(format = 'json', options = {}) {
    if (!this.enableLinkAnalysis || !this.linkAnalyzer) {
      throw new Error('Link analysis is not enabled');
    }
    
    return this.linkAnalyzer.exportGraph(format, options);
  }
}

export default BFSCrawler;
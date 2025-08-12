import { load } from 'cheerio';
import { QueueManager } from '../queue/QueueManager.js';
import { CacheManager } from '../cache/CacheManager.js';
import { RateLimiter } from '../../utils/rateLimiter.js';
import { RobotsChecker } from '../../utils/robotsChecker.js';
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
      concurrency = 10
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
    
    this.queue = new QueueManager({ concurrency, timeout });
    this.cache = new CacheManager({ ttl: 3600000 }); // 1 hour cache
    this.rateLimiter = new RateLimiter({ requestsPerSecond: 10 });
    this.robotsChecker = respectRobots ? new RobotsChecker(userAgent) : null;
  }

  async crawl(startUrl, options = {}) {
    const {
      includePatterns = [],
      excludePatterns = [],
      extractContent = true
    } = options;

    this.includePatterns = includePatterns.map(p => new RegExp(p));
    this.excludePatterns = excludePatterns.map(p => new RegExp(p));
    this.extractContent = extractContent;

    const normalizedStart = normalizeUrl(startUrl);
    this.baseUrl = new URL(normalizedStart);
    
    // Initialize queue with starting URL
    await this.queue.add(() => this.processUrl(normalizedStart, 0));

    // Wait for crawling to complete
    await this.queue.onIdle();

    return {
      urls: Array.from(this.visited),
      results: this.results,
      errors: this.errors,
      stats: this.getStats()
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

    // Check URL patterns
    if (!this.shouldCrawlUrl(normalizedUrl)) {
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
        // Rate limit the request
        await this.rateLimiter.checkLimit(normalizedUrl);

        // Fetch the page
        pageData = await this.fetchPage(normalizedUrl);
        
        // Cache the result
        await this.cache.set(cacheKey, pageData);
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
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        }
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
      links: [...new Set(links)] // Remove duplicates
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
    return {
      visited: this.visited.size,
      results: this.results.length,
      errors: this.errors.length,
      cacheStats: this.cache.getStats(),
      queueStats: this.queue.getStats(),
      rateLimitStats: this.rateLimiter.getStats()
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
}

export default BFSCrawler;
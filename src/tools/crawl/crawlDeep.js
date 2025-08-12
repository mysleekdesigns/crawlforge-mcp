import { z } from 'zod';
import { BFSCrawler } from '../../core/crawlers/BFSCrawler.js';

const CrawlDeepSchema = z.object({
  url: z.string().url(),
  max_depth: z.number().min(1).max(5).optional().default(3),
  max_pages: z.number().min(1).max(1000).optional().default(100),
  include_patterns: z.array(z.string()).optional().default([]),
  exclude_patterns: z.array(z.string()).optional().default([]),
  follow_external: z.boolean().optional().default(false),
  respect_robots: z.boolean().optional().default(true),
  extract_content: z.boolean().optional().default(true),
  concurrency: z.number().min(1).max(20).optional().default(10)
});

export class CrawlDeepTool {
  constructor(options = {}) {
    const {
      userAgent = 'MCP-WebScraper/1.0',
      timeout = 30000
    } = options;

    this.userAgent = userAgent;
    this.timeout = timeout;
  }

  async execute(params) {
    try {
      const validated = CrawlDeepSchema.parse(params);
      
      // Create crawler instance
      const crawler = new BFSCrawler({
        maxDepth: validated.max_depth,
        maxPages: validated.max_pages,
        followExternal: validated.follow_external,
        respectRobots: validated.respect_robots,
        userAgent: this.userAgent,
        timeout: this.timeout,
        concurrency: validated.concurrency
      });
      
      // Start crawling
      const startTime = Date.now();
      const results = await crawler.crawl(validated.url, {
        includePatterns: validated.include_patterns,
        excludePatterns: validated.exclude_patterns,
        extractContent: validated.extract_content
      });
      const duration = Date.now() - startTime;
      
      // Process and format results
      const response = {
        url: validated.url,
        crawl_depth: validated.max_depth,
        pages_crawled: results.urls.length,
        pages_found: results.results.length,
        errors: results.errors.length,
        duration_ms: duration,
        pages_per_second: results.urls.length / (duration / 1000),
        results: this.formatResults(results.results, validated.extract_content),
        errors: results.errors,
        stats: results.stats,
        site_structure: this.analyzeSiteStructure(results.urls)
      };
      
      return response;
    } catch (error) {
      throw new Error(`Crawl failed: ${error.message}`);
    }
  }

  formatResults(results, includeContent) {
    return results.map(result => {
      const formatted = {
        url: result.url,
        depth: result.depth,
        title: result.title,
        links_count: result.links,
        content_length: result.contentLength,
        timestamp: result.timestamp
      };
      
      if (includeContent) {
        formatted.content = result.content ? result.content.substring(0, 500) + '...' : '';
        formatted.metadata = result.metadata;
      }
      
      return formatted;
    });
  }

  analyzeSiteStructure(urls) {
    const structure = {
      total_pages: urls.length,
      depth_distribution: {},
      path_patterns: {},
      file_types: {},
      subdomains: new Set()
    };
    
    for (const url of urls) {
      try {
        const urlObj = new URL(url);
        
        // Analyze depth
        const depth = urlObj.pathname.split('/').filter(s => s).length;
        structure.depth_distribution[depth] = (structure.depth_distribution[depth] || 0) + 1;
        
        // Analyze path patterns
        const pathSegments = urlObj.pathname.split('/').filter(s => s);
        if (pathSegments.length > 0) {
          const firstSegment = pathSegments[0];
          structure.path_patterns[firstSegment] = (structure.path_patterns[firstSegment] || 0) + 1;
        }
        
        // Analyze file types
        const extension = this.getFileExtension(urlObj.pathname);
        if (extension) {
          structure.file_types[extension] = (structure.file_types[extension] || 0) + 1;
        }
        
        // Collect subdomains
        structure.subdomains.add(urlObj.hostname);
      } catch {
        // Skip invalid URLs
      }
    }
    
    structure.subdomains = Array.from(structure.subdomains);
    
    return structure;
  }

  getFileExtension(pathname) {
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : null;
  }

  async executeBatch(urls, options = {}) {
    const results = [];
    
    for (const url of urls) {
      try {
        const result = await this.execute({ ...options, url });
        results.push({ url, success: true, result });
      } catch (error) {
        results.push({ url, success: false, error: error.message });
      }
    }
    
    return results;
  }
}

export default CrawlDeepTool;
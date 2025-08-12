import { z } from 'zod';
import { BFSCrawler } from '../../core/crawlers/BFSCrawler.js';
import { DomainFilter } from '../../utils/domainFilter.js';

const CrawlDeepSchema = z.object({
  url: z.string().url(),
  max_depth: z.number().min(1).max(5).optional().default(3),
  max_pages: z.number().min(1).max(1000).optional().default(100),
  include_patterns: z.array(z.string()).optional().default([]),
  exclude_patterns: z.array(z.string()).optional().default([]),
  follow_external: z.boolean().optional().default(false),
  respect_robots: z.boolean().optional().default(true),
  extract_content: z.boolean().optional().default(true),
  concurrency: z.number().min(1).max(20).optional().default(10),
  enable_link_analysis: z.boolean().optional().default(true),
  link_analysis_options: z.object({
    dampingFactor: z.number().min(0).max(1).optional().default(0.85),
    maxIterations: z.number().min(1).max(1000).optional().default(100),
    enableCaching: z.boolean().optional().default(true)
  }).optional().default({}),
  // New domain filtering options
  domain_filter: z.object({
    whitelist: z.array(z.union([
      z.string(),
      z.object({
        domain: z.string(),
        options: z.object({
          includeSubdomains: z.boolean().optional(),
          maxDepth: z.number().optional(),
          rateLimit: z.number().optional(),
          customHeaders: z.record(z.string()).optional(),
          timeout: z.number().optional()
        }).optional()
      })
    ])).optional().default([]),
    blacklist: z.array(z.union([
      z.string(),
      z.object({
        domain: z.string(),
        options: z.object({
          includeSubdomains: z.boolean().optional(),
          reason: z.string().optional(),
          permanent: z.boolean().optional()
        }).optional()
      })
    ])).optional().default([]),
    domain_rules: z.record(z.object({
      maxDepth: z.number().optional(),
      rateLimit: z.number().optional(),
      respectRobots: z.boolean().optional(),
      allowedPaths: z.array(z.string()).optional(),
      blockedPaths: z.array(z.string()).optional(),
      customHeaders: z.record(z.string()).optional(),
      timeout: z.number().optional(),
      maxPages: z.number().optional(),
      concurrency: z.number().optional()
    })).optional().default({})
  }).optional(),
  import_filter_config: z.string().optional() // JSON string of exported config
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
      
      // Create domain filter if configuration provided
      let domainFilter = null;
      if (validated.import_filter_config) {
        // Import from exported configuration
        domainFilter = new DomainFilter();
        try {
          const importConfig = JSON.parse(validated.import_filter_config);
          domainFilter.importConfig(importConfig);
        } catch (error) {
          throw new Error(`Invalid filter configuration: ${error.message}`);
        }
      } else if (validated.domain_filter) {
        // Create from inline configuration
        domainFilter = new DomainFilter({
          allowSubdomains: !validated.follow_external,
          defaultMaxDepth: validated.max_depth,
          defaultRateLimit: 10
        });
        
        // Configure whitelist
        for (const item of validated.domain_filter.whitelist) {
          if (typeof item === 'string') {
            domainFilter.addWhitelistDomain(item);
          } else {
            domainFilter.addWhitelistDomain(item.domain, item.options || {});
          }
        }
        
        // Configure blacklist
        for (const item of validated.domain_filter.blacklist) {
          if (typeof item === 'string') {
            domainFilter.addBlacklistDomain(item);
          } else {
            domainFilter.addBlacklistDomain(item.domain, item.options || {});
          }
        }
        
        // Configure domain rules
        for (const [domain, rules] of Object.entries(validated.domain_filter.domain_rules)) {
          domainFilter.setDomainRules(domain, rules);
        }
      }
      
      // Create crawler instance
      const crawler = new BFSCrawler({
        maxDepth: validated.max_depth,
        maxPages: validated.max_pages,
        followExternal: validated.follow_external,
        respectRobots: validated.respect_robots,
        userAgent: this.userAgent,
        timeout: this.timeout,
        concurrency: validated.concurrency,
        domainFilter: domainFilter,
        enableLinkAnalysis: validated.enable_link_analysis,
        linkAnalyzerOptions: validated.link_analysis_options
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
        site_structure: this.analyzeSiteStructure(results.urls),
        domain_filter_config: domainFilter ? domainFilter.exportConfig() : null,
        link_analysis: results.linkAnalysis
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

  /**
   * Export link graph from crawler results
   * @param {Object} crawler - BFSCrawler instance
   * @param {string} format - Export format ('json', 'dot', 'csv', 'adjacency')
   * @param {Object} options - Export options
   * @returns {string|Object} Exported graph data
   */
  exportLinkGraph(crawler, format = 'json', options = {}) {
    if (!crawler || !crawler.getLinkAnalyzer()) {
      throw new Error('Crawler with link analysis is required');
    }
    
    return crawler.exportLinkGraph(format, options);
  }

  /**
   * Get relationship path between two URLs from crawler
   * @param {Object} crawler - BFSCrawler instance
   * @param {string} url1 - Starting URL
   * @param {string} url2 - Target URL
   * @param {Object} options - Path finding options
   * @returns {Object|null} Path object or null
   */
  getRelationshipPath(crawler, url1, url2, options = {}) {
    if (!crawler || !crawler.getLinkAnalyzer()) {
      throw new Error('Crawler with link analysis is required');
    }
    
    const linkAnalyzer = crawler.getLinkAnalyzer();
    return linkAnalyzer.getRelationshipPath(url1, url2, options);
  }

  /**
   * Analyze site structure with enhanced link analysis
   * @param {Array} urls - Crawled URLs
   * @param {Object} linkAnalysis - Link analysis results
   * @returns {Object} Enhanced site structure analysis
   */
  analyzeEnhancedSiteStructure(urls, linkAnalysis = null) {
    const basicStructure = this.analyzeSiteStructure(urls);
    
    if (!linkAnalysis) {
      return basicStructure;
    }
    
    return {
      ...basicStructure,
      link_metrics: {
        total_links: linkAnalysis.statistics?.links || 0,
        link_density: linkAnalysis.statistics?.density || 0,
        avg_outbound_links: linkAnalysis.statistics?.avgOutboundLinks || 0,
        avg_inbound_links: linkAnalysis.statistics?.avgInboundLinks || 0
      },
      authority_pages: linkAnalysis.hubsAndAuthorities?.authorities?.slice(0, 5) || [],
      hub_pages: linkAnalysis.hubsAndAuthorities?.hubs?.slice(0, 5) || [],
      most_important_pages: linkAnalysis.importance?.topPages?.slice(0, 10) || [],
      circular_references: linkAnalysis.cycles?.length || 0,
      domain_connectivity: linkAnalysis.domainAnalysis?.domainConnectivity || {},
      link_patterns: linkAnalysis.linkPatterns?.linkDistribution || {}
    };
  }

  /**
   * Generate link analysis summary report
   * @param {Object} linkAnalysis - Link analysis results
   * @returns {Object} Summary report
   */
  generateLinkAnalysisSummary(linkAnalysis) {
    if (!linkAnalysis) {
      return { error: 'No link analysis data provided' };
    }
    
    const summary = {
      overview: {
        total_pages: linkAnalysis.statistics?.nodes || 0,
        total_links: linkAnalysis.statistics?.links || 0,
        link_density: (linkAnalysis.statistics?.density || 0).toFixed(4),
        analysis_time: linkAnalysis.analysisTime || 0,
        generated_at: linkAnalysis.generatedAt
      },
      key_metrics: {
        most_important_page: linkAnalysis.importance?.topPages?.[0] || null,
        highest_authority: linkAnalysis.hubsAndAuthorities?.authorities?.[0] || null,
        main_hub: linkAnalysis.hubsAndAuthorities?.hubs?.[0] || null,
        circular_references: linkAnalysis.cycles?.length || 0,
        domains_analyzed: linkAnalysis.domainAnalysis?.totalDomains || 0
      },
      link_patterns: {
        internal_vs_external: {
          internal: linkAnalysis.linkPatterns?.linkDistribution?.internal || 0,
          external: linkAnalysis.linkPatterns?.linkDistribution?.external || 0
        },
        top_anchor_texts: linkAnalysis.linkPatterns?.topAnchorTexts?.slice(0, 5) || [],
        top_path_patterns: linkAnalysis.linkPatterns?.topPathPatterns?.slice(0, 5) || []
      },
      recommendations: this.generateLinkRecommendations(linkAnalysis)
    };
    
    return summary;
  }

  /**
   * Generate SEO and structural recommendations based on link analysis
   * @param {Object} linkAnalysis - Link analysis results
   * @returns {Array} Array of recommendations
   */
  generateLinkRecommendations(linkAnalysis) {
    const recommendations = [];
    
    if (!linkAnalysis || !linkAnalysis.statistics) {
      return recommendations;
    }
    
    const stats = linkAnalysis.statistics;
    const patterns = linkAnalysis.linkPatterns;
    const cycles = linkAnalysis.cycles || [];
    
    // Link density recommendations
    if (stats.density < 0.01) {
      recommendations.push({
        type: 'link_density',
        priority: 'medium',
        issue: 'Low link density detected',
        description: 'The site has very few internal links relative to the number of pages',
        suggestion: 'Consider adding more internal links to improve navigation and SEO'
      });
    }
    
    // Hub/Authority balance
    const hubs = linkAnalysis.hubsAndAuthorities?.hubs || [];
    const authorities = linkAnalysis.hubsAndAuthorities?.authorities || [];
    
    if (hubs.length === 0) {
      recommendations.push({
        type: 'hub_pages',
        priority: 'low',
        issue: 'No hub pages identified',
        description: 'No pages with many outbound links were found',
        suggestion: 'Consider creating navigation or category pages that link to multiple content pages'
      });
    }
    
    if (authorities.length === 0) {
      recommendations.push({
        type: 'authority_pages',
        priority: 'medium',
        issue: 'No authority pages identified',
        description: 'No pages with many inbound links were found',
        suggestion: 'Focus on creating high-quality content that other pages naturally link to'
      });
    }
    
    // Circular reference warnings
    if (cycles.length > 0) {
      const strongCycles = cycles.filter(cycle => cycle.strength > 2);
      if (strongCycles.length > 0) {
        recommendations.push({
          type: 'circular_references',
          priority: 'low',
          issue: `${strongCycles.length} circular reference chains detected`,
          description: 'Some pages have circular linking patterns',
          suggestion: 'Review circular links to ensure they provide value and don\'t confuse users'
        });
      }
    }
    
    // External vs internal link balance
    if (patterns && patterns.linkDistribution) {
      const internal = patterns.linkDistribution.internal || 0;
      const external = patterns.linkDistribution.external || 0;
      const total = internal + external;
      
      if (total > 0) {
        const externalRatio = external / total;
        if (externalRatio > 0.3) {
          recommendations.push({
            type: 'external_links',
            priority: 'low',
            issue: 'High ratio of external links',
            description: `${(externalRatio * 100).toFixed(1)}% of links are external`,
            suggestion: 'Consider balancing with more internal links to keep users on your site'
          });
        }
      }
    }
    
    // Orphaned pages (pages with no inbound links)
    if (stats.nodes > 0 && stats.avgInboundLinks < 1) {
      recommendations.push({
        type: 'orphaned_pages',
        priority: 'high',
        issue: 'Potential orphaned pages detected',
        description: 'Average inbound links per page is very low',
        suggestion: 'Ensure all important pages can be reached through internal navigation'
      });
    }
    
    return recommendations;
  }
}

export default CrawlDeepTool;
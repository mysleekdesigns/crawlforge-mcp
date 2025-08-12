import { z } from 'zod';
import { LinkAnalyzer } from '../../core/analysis/LinkAnalyzer.js';
import { BFSCrawler } from '../../core/crawlers/BFSCrawler.js';

const LinkAnalysisSchema = z.object({
  // Input data options
  urls: z.array(z.string().url()).optional(),
  links_data: z.array(z.object({
    from: z.string().url(),
    to: z.string().url(),
    metadata: z.object({}).optional()
  })).optional(),
  
  // Analysis options
  enable_importance_calculation: z.boolean().optional().default(true),
  enable_cycle_detection: z.boolean().optional().default(true),
  enable_path_analysis: z.boolean().optional().default(false),
  
  // PageRank parameters
  damping_factor: z.number().min(0).max(1).optional().default(0.85),
  max_iterations: z.number().min(1).max(1000).optional().default(100),
  convergence_threshold: z.number().min(0).optional().default(0.0001),
  
  // Export options
  export_format: z.enum(['json', 'dot', 'csv', 'adjacency']).optional().default('json'),
  include_metadata: z.boolean().optional().default(true),
  include_importance: z.boolean().optional().default(true),
  min_importance: z.number().min(0).optional().default(0),
  
  // Specific analysis queries
  find_path_from: z.string().url().optional(),
  find_path_to: z.string().url().optional(),
  analyze_url: z.string().url().optional()
});

const BulkAnalysisSchema = z.object({
  crawl_results: z.array(z.object({
    url: z.string().url(),
    link_analysis: z.object({}).optional()
  })),
  merge_strategy: z.enum(['union', 'intersection', 'weighted_merge']).optional().default('union'),
  export_format: z.enum(['json', 'dot', 'csv', 'adjacency']).optional().default('json'),
  analysis_options: LinkAnalysisSchema.omit({ urls: true, links_data: true }).optional()
});

export class LinkAnalyzerTool {
  constructor(options = {}) {
    this.defaultOptions = {
      dampingFactor: 0.85,
      maxIterations: 100,
      convergenceThreshold: 0.0001,
      enableCaching: true,
      maxCacheSize: 10000
    };
  }

  /**
   * Analyze links and generate comprehensive report
   * @param {Object} params - Analysis parameters
   * @returns {Object} Link analysis results
   */
  async analyze(params) {
    try {
      const validated = LinkAnalysisSchema.parse(params);
      
      // Create link analyzer instance
      const analyzer = new LinkAnalyzer({
        dampingFactor: validated.damping_factor,
        maxIterations: validated.max_iterations,
        convergenceThreshold: validated.convergence_threshold,
        enableCaching: true
      });
      
      // Add links to analyzer
      if (validated.links_data) {
        for (const link of validated.links_data) {
          analyzer.addLink(link.from, link.to, link.metadata || {});
        }
      }
      
      const results = {
        analyzer_stats: analyzer.getStatistics(),
        analysis_performed: new Date().toISOString()
      };
      
      // Perform importance calculation
      if (validated.enable_importance_calculation) {
        const startTime = Date.now();
        const importance = analyzer.calculateImportance();
        results.importance_analysis = {
          calculation_time: Date.now() - startTime,
          top_pages: this.formatImportanceResults(importance, 20),
          statistics: this.getImportanceStatistics(importance)
        };
      }
      
      // Detect cycles
      if (validated.enable_cycle_detection) {
        const startTime = Date.now();
        const cycles = analyzer.detectCycles({ 
          maxCycleLength: 10, 
          includeMetadata: validated.include_metadata 
        });
        results.cycle_analysis = {
          calculation_time: Date.now() - startTime,
          cycles_found: cycles.length,
          cycles: cycles.slice(0, 20), // Limit to top 20 cycles
          cycle_summary: this.summarizeCycles(cycles)
        };
      }
      
      // Find specific path
      if (validated.find_path_from && validated.find_path_to) {
        const startTime = Date.now();
        const path = analyzer.getRelationshipPath(
          validated.find_path_from, 
          validated.find_path_to,
          { 
            maxDepth: 10, 
            bidirectional: true, 
            includeMetadata: validated.include_metadata 
          }
        );
        results.path_analysis = {
          calculation_time: Date.now() - startTime,
          path_found: path !== null,
          path: path
        };
      }
      
      // Analyze specific URL
      if (validated.analyze_url) {
        results.url_analysis = this.analyzeSpecificUrl(analyzer, validated.analyze_url);
      }
      
      // Export graph
      if (validated.export_format) {
        const exportOptions = {
          includeMetadata: validated.include_metadata,
          includeImportance: validated.include_importance,
          minImportance: validated.min_importance
        };
        results.graph_export = analyzer.exportGraph(validated.export_format, exportOptions);
      }
      
      return results;
    } catch (error) {
      throw new Error(`Link analysis failed: ${error.message}`);
    }
  }

  /**
   * Analyze multiple crawl results and merge them
   * @param {Object} params - Bulk analysis parameters
   * @returns {Object} Merged analysis results
   */
  async analyzeBulk(params) {
    try {
      const validated = BulkAnalysisSchema.parse(params);
      
      const analyzers = [];
      const individualResults = [];
      
      // Process each crawl result
      for (const crawlResult of validated.crawl_results) {
        if (crawlResult.link_analysis && crawlResult.link_analysis.statistics) {
          // Create analyzer from link analysis data
          const analyzer = this.reconstructAnalyzerFromResults(crawlResult.link_analysis);
          analyzers.push({ url: crawlResult.url, analyzer });
          individualResults.push({
            url: crawlResult.url,
            stats: crawlResult.link_analysis.statistics,
            importance: crawlResult.link_analysis.importance,
            cycles: crawlResult.link_analysis.cycles?.length || 0
          });
        }
      }
      
      if (analyzers.length === 0) {
        throw new Error('No valid link analysis data found in crawl results');
      }
      
      // Merge analyzers based on strategy
      const mergedAnalyzer = this.mergeAnalyzers(analyzers, validated.merge_strategy);
      
      // Perform analysis on merged data
      const analysisOptions = validated.analysis_options || {};
      const mergedResults = await this.analyze({
        ...analysisOptions,
        export_format: validated.export_format
      });
      
      return {
        merge_strategy: validated.merge_strategy,
        individual_results: individualResults,
        merged_analysis: mergedResults,
        merged_stats: {
          total_analyzers: analyzers.length,
          total_nodes: mergedAnalyzer.nodes.size,
          total_links: mergedAnalyzer.linkMetadata.size,
          merge_time: new Date().toISOString()
        }
      };
    } catch (error) {
      throw new Error(`Bulk link analysis failed: ${error.message}`);
    }
  }

  /**
   * Compare two link analysis results
   * @param {Object} analysis1 - First analysis result
   * @param {Object} analysis2 - Second analysis result
   * @returns {Object} Comparison results
   */
  compareAnalyses(analysis1, analysis2) {
    if (!analysis1 || !analysis2) {
      throw new Error('Both analysis results are required for comparison');
    }
    
    const comparison = {
      statistics_comparison: this.compareStatistics(
        analysis1.analyzer_stats || analysis1.statistics,
        analysis2.analyzer_stats || analysis2.statistics
      ),
      importance_comparison: null,
      cycles_comparison: null,
      generated_at: new Date().toISOString()
    };
    
    // Compare importance if available
    if (analysis1.importance_analysis && analysis2.importance_analysis) {
      comparison.importance_comparison = this.compareImportance(
        analysis1.importance_analysis,
        analysis2.importance_analysis
      );
    }
    
    // Compare cycles if available
    if (analysis1.cycle_analysis && analysis2.cycle_analysis) {
      comparison.cycles_comparison = this.compareCycles(
        analysis1.cycle_analysis,
        analysis2.cycle_analysis
      );
    }
    
    return comparison;
  }

  /**
   * Generate visualization data for link graph
   * @param {LinkAnalyzer} analyzer - Link analyzer instance
   * @param {Object} options - Visualization options
   * @returns {Object} Visualization data
   */
  generateVisualizationData(analyzer, options = {}) {
    const {
      maxNodes = 100,
      minImportance = 0,
      includeMetadata = false,
      layoutAlgorithm = 'force_directed'
    } = options;
    
    const importance = analyzer.calculateImportance();
    const nodes = [];
    const links = [];
    
    // Filter and format nodes
    const sortedNodes = Array.from(importance.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxNodes)
      .filter(([url, score]) => score >= minImportance);
    
    const nodeSet = new Set(sortedNodes.map(([url]) => url));
    
    for (const [url, importanceScore] of sortedNodes) {
      const nodeData = analyzer.nodes.get(url);
      const inboundCount = analyzer.getInboundLinks(url).length;
      const outboundCount = analyzer.getOutboundLinks(url).length;
      
      const node = {
        id: url,
        label: this.extractDisplayName(url),
        importance: importanceScore,
        inboundLinks: inboundCount,
        outboundLinks: outboundCount,
        size: Math.max(5, Math.min(50, importanceScore * 100)),
        color: this.getNodeColor(importanceScore, inboundCount, outboundCount)
      };
      
      if (includeMetadata && nodeData) {
        node.domain = nodeData.domain;
        node.path = nodeData.path;
        node.discovered = nodeData.discovered;
      }
      
      nodes.push(node);
    }
    
    // Add links between nodes in the set
    for (const [linkKey, linkData] of analyzer.linkMetadata) {
      const [from, to] = linkKey.split('|');
      
      if (nodeSet.has(from) && nodeSet.has(to)) {
        const link = {
          source: from,
          target: to,
          weight: linkData.count || 1,
          strength: Math.min(10, linkData.count || 1)
        };
        
        if (includeMetadata) {
          link.anchorText = linkData.anchorText;
          link.context = linkData.context;
        }
        
        links.push(link);
      }
    }
    
    return {
      nodes,
      links,
      layout: layoutAlgorithm,
      metadata: {
        totalNodesInGraph: analyzer.nodes.size,
        totalLinksInGraph: analyzer.linkMetadata.size,
        nodesDisplayed: nodes.length,
        linksDisplayed: links.length,
        importanceRange: {
          min: Math.min(...nodes.map(n => n.importance)),
          max: Math.max(...nodes.map(n => n.importance))
        },
        generatedAt: new Date().toISOString()
      }
    };
  }

  // Helper methods

  formatImportanceResults(importance, limit = 10) {
    return Array.from(importance.entries())
      .map(([url, score]) => ({ url, importance: score }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
  }

  getImportanceStatistics(importance) {
    const values = Array.from(importance.values());
    if (values.length === 0) return null;
    
    const sorted = values.sort((a, b) => b - a);
    return {
      count: values.length,
      min: sorted[sorted.length - 1],
      max: sorted[0],
      mean: values.reduce((sum, val) => sum + val, 0) / values.length,
      median: sorted.length % 2 === 0 ? 
        (sorted[Math.floor(sorted.length / 2) - 1] + sorted[Math.floor(sorted.length / 2)]) / 2 :
        sorted[Math.floor(sorted.length / 2)]
    };
  }

  summarizeCycles(cycles) {
    if (cycles.length === 0) return null;
    
    const lengthDistribution = {};
    let totalStrength = 0;
    let strongestCycle = null;
    let maxStrength = 0;
    
    for (const cycle of cycles) {
      const length = cycle.length;
      lengthDistribution[length] = (lengthDistribution[length] || 0) + 1;
      
      totalStrength += cycle.strength;
      if (cycle.strength > maxStrength) {
        maxStrength = cycle.strength;
        strongestCycle = cycle;
      }
    }
    
    return {
      total_cycles: cycles.length,
      average_strength: totalStrength / cycles.length,
      strongest_cycle: strongestCycle,
      length_distribution: lengthDistribution
    };
  }

  analyzeSpecificUrl(analyzer, url) {
    const normalizedUrl = url;
    
    if (!analyzer.nodes.has(normalizedUrl)) {
      return { error: 'URL not found in graph' };
    }
    
    const inboundLinks = analyzer.getInboundLinks(normalizedUrl);
    const outboundLinks = analyzer.getOutboundLinks(normalizedUrl);
    const importance = analyzer.calculateImportance();
    const urlImportance = importance.get(normalizedUrl) || 0;
    
    return {
      url: normalizedUrl,
      inbound_links: inboundLinks.length,
      outbound_links: outboundLinks.length,
      importance_score: urlImportance,
      inbound_details: inboundLinks.slice(0, 10),
      outbound_details: outboundLinks.slice(0, 10),
      node_data: analyzer.nodes.get(normalizedUrl)
    };
  }

  reconstructAnalyzerFromResults(linkAnalysisResults) {
    // This would need to be implemented based on the structure of saved results
    // For now, return a placeholder
    const analyzer = new LinkAnalyzer();
    // Would need to reconstruct from saved data
    return analyzer;
  }

  mergeAnalyzers(analyzers, strategy) {
    const mergedAnalyzer = new LinkAnalyzer();
    
    switch (strategy) {
      case 'union':
        // Merge all analyzers together
        for (const { analyzer } of analyzers) {
          mergedAnalyzer.merge(analyzer);
        }
        break;
      
      case 'intersection':
        // Only include links that appear in multiple analyzers
        // More complex implementation needed
        break;
      
      case 'weighted_merge':
        // Weight links based on frequency across analyzers
        // More complex implementation needed
        break;
      
      default:
        throw new Error(`Unknown merge strategy: ${strategy}`);
    }
    
    return mergedAnalyzer;
  }

  compareStatistics(stats1, stats2) {
    const comparison = {};
    
    const fields = ['nodes', 'links', 'density', 'avgOutboundLinks', 'avgInboundLinks'];
    
    for (const field of fields) {
      const val1 = stats1[field] || 0;
      const val2 = stats2[field] || 0;
      const diff = val2 - val1;
      const percentChange = val1 !== 0 ? (diff / val1) * 100 : 0;
      
      comparison[field] = {
        value1: val1,
        value2: val2,
        difference: diff,
        percent_change: percentChange
      };
    }
    
    return comparison;
  }

  compareImportance(importance1, importance2) {
    return {
      top_pages_changed: this.compareTopPages(
        importance1.top_pages,
        importance2.top_pages
      ),
      statistics: this.compareStatistics(
        importance1.statistics,
        importance2.statistics
      )
    };
  }

  compareCycles(cycles1, cycles2) {
    return {
      cycles_count: {
        before: cycles1.cycles_found,
        after: cycles2.cycles_found,
        change: cycles2.cycles_found - cycles1.cycles_found
      },
      new_cycles: cycles2.cycles?.filter(c2 => 
        !cycles1.cycles?.some(c1 => 
          JSON.stringify(c1.nodes) === JSON.stringify(c2.nodes)
        )
      ) || [],
      removed_cycles: cycles1.cycles?.filter(c1 => 
        !cycles2.cycles?.some(c2 => 
          JSON.stringify(c1.nodes) === JSON.stringify(c2.nodes)
        )
      ) || []
    };
  }

  compareTopPages(pages1, pages2) {
    const urls1 = new Set(pages1.map(p => p.url));
    const urls2 = new Set(pages2.map(p => p.url));
    
    return {
      new_top_pages: pages2.filter(p => !urls1.has(p.url)),
      dropped_pages: pages1.filter(p => !urls2.has(p.url)),
      rank_changes: this.calculateRankChanges(pages1, pages2)
    };
  }

  calculateRankChanges(pages1, pages2) {
    const rankMap1 = new Map(pages1.map((p, i) => [p.url, i]));
    const rankMap2 = new Map(pages2.map((p, i) => [p.url, i]));
    const changes = [];
    
    for (const [url, rank2] of rankMap2) {
      if (rankMap1.has(url)) {
        const rank1 = rankMap1.get(url);
        const change = rank1 - rank2; // Positive means moved up
        if (change !== 0) {
          changes.push({ url, old_rank: rank1, new_rank: rank2, change });
        }
      }
    }
    
    return changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  }

  extractDisplayName(url) {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      if (path === '/' || path === '') {
        return urlObj.hostname;
      }
      
      const segments = path.split('/').filter(s => s);
      return segments[segments.length - 1] || urlObj.hostname;
    } catch {
      return url.substring(0, 30) + '...';
    }
  }

  getNodeColor(importance, inboundCount, outboundCount) {
    // Color based on importance score
    if (importance > 0.01) return '#ff4444'; // High importance - red
    if (importance > 0.005) return '#ff8800'; // Medium importance - orange
    if (inboundCount > 5) return '#4444ff'; // High authority - blue
    if (outboundCount > 10) return '#44ff44'; // High hub - green
    return '#888888'; // Default - gray
  }
}

export default LinkAnalyzerTool;
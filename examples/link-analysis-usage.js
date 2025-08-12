#!/usr/bin/env node

/**
 * Link Analysis System Usage Examples
 * 
 * This file demonstrates how to use the comprehensive link analysis system
 * with the MCP WebScraper project.
 */

import { BFSCrawler } from '../src/core/crawlers/BFSCrawler.js';
import { CrawlDeepTool } from '../src/tools/crawl/crawlDeep.js';
import { LinkAnalyzerTool } from '../src/tools/analysis/linkAnalyzer.js';
import { LinkAnalyzer } from '../src/core/analysis/LinkAnalyzer.js';

/**
 * Example 1: Basic crawling with link analysis
 */
async function basicLinkAnalysisExample() {
  console.log('=== Example 1: Basic Link Analysis ===');
  
  try {
    const crawler = new BFSCrawler({
      maxDepth: 2,
      maxPages: 20,
      followExternal: false,
      enableLinkAnalysis: true,
      linkAnalyzerOptions: {
        dampingFactor: 0.85,
        maxIterations: 50,
        enableCaching: true
      }
    });
    
    const results = await crawler.crawl('https://example.com');
    
    console.log('Crawl Results:');
    console.log(`- Pages crawled: ${results.urls.length}`);
    console.log(`- Links found: ${results.linkAnalysis?.statistics?.links || 0}`);
    console.log(`- Analysis time: ${results.linkAnalysis?.analysisTime}ms`);
    
    if (results.linkAnalysis) {
      console.log('\nTop Important Pages:');
      results.linkAnalysis.importance.topPages.slice(0, 5).forEach((page, i) => {
        console.log(`  ${i + 1}. ${page.url} (${page.importance.toFixed(4)})`);
      });
      
      console.log('\nLink Patterns:');
      const patterns = results.linkAnalysis.linkPatterns.linkDistribution;
      console.log(`  - Internal: ${patterns.internal}, External: ${patterns.external}`);
      console.log(`  - Same domain: ${patterns.sameDomain}, Cross domain: ${patterns.crossDomain}`);
      
      if (results.linkAnalysis.cycles.length > 0) {
        console.log(`\nCircular References: ${results.linkAnalysis.cycles.length} found`);
      }
    }
    
  } catch (error) {
    console.error('Basic example failed:', error.message);
  }
}

/**
 * Example 2: Using CrawlDeepTool with enhanced analysis
 */
async function crawlDeepWithAnalysisExample() {
  console.log('\n=== Example 2: CrawlDeep with Link Analysis ===');
  
  try {
    const crawlTool = new CrawlDeepTool();
    
    const results = await crawlTool.execute({
      url: 'https://example.com',
      max_depth: 2,
      max_pages: 15,
      enable_link_analysis: true,
      link_analysis_options: {
        dampingFactor: 0.85,
        maxIterations: 100,
        enableCaching: true
      },
      extract_content: false // Focus on structure
    });
    
    console.log('CrawlDeep Results:');
    console.log(`- Duration: ${results.duration_ms}ms`);
    console.log(`- Pages per second: ${results.pages_per_second.toFixed(2)}`);
    
    if (results.link_analysis) {
      // Generate summary report
      const summary = crawlTool.generateLinkAnalysisSummary(results.link_analysis);
      
      console.log('\nLink Analysis Summary:');
      console.log(`- Total pages: ${summary.overview.total_pages}`);
      console.log(`- Total links: ${summary.overview.total_links}`);
      console.log(`- Link density: ${summary.overview.link_density}`);
      
      console.log('\nKey Metrics:');
      if (summary.key_metrics.most_important_page) {
        console.log(`- Most important: ${summary.key_metrics.most_important_page.url}`);
      }
      if (summary.key_metrics.highest_authority) {
        console.log(`- Top authority: ${summary.key_metrics.highest_authority.url} (${summary.key_metrics.highest_authority.inboundLinks} inbound)`);
      }
      
      console.log('\nRecommendations:');
      summary.recommendations.forEach(rec => {
        console.log(`- ${rec.priority.toUpperCase()}: ${rec.issue}`);
        console.log(`  ${rec.suggestion}`);
      });
    }
    
  } catch (error) {
    console.error('CrawlDeep example failed:', error.message);
  }
}

/**
 * Example 3: Advanced link analysis with custom data
 */
async function advancedLinkAnalysisExample() {
  console.log('\n=== Example 3: Advanced Link Analysis ===');
  
  try {
    const linkTool = new LinkAnalyzerTool();
    
    // Sample link data (normally from crawling)
    const linksData = [
      { from: 'https://example.com/', to: 'https://example.com/about', metadata: { anchorText: 'About Us' }},
      { from: 'https://example.com/', to: 'https://example.com/products', metadata: { anchorText: 'Products' }},
      { from: 'https://example.com/about', to: 'https://example.com/contact', metadata: { anchorText: 'Contact' }},
      { from: 'https://example.com/products', to: 'https://example.com/contact', metadata: { anchorText: 'Get in Touch' }},
      { from: 'https://example.com/contact', to: 'https://example.com/', metadata: { anchorText: 'Home' }}, // Creates cycle
    ];
    
    const analysis = await linkTool.analyze({
      links_data: linksData,
      enable_importance_calculation: true,
      enable_cycle_detection: true,
      export_format: 'json',
      include_metadata: true
    });
    
    console.log('Advanced Analysis Results:');
    console.log(`- Nodes: ${analysis.analyzer_stats.nodes}`);
    console.log(`- Links: ${analysis.analyzer_stats.links}`);
    
    if (analysis.importance_analysis) {
      console.log('\nImportance Ranking:');
      analysis.importance_analysis.top_pages.forEach((page, i) => {
        console.log(`  ${i + 1}. ${page.url} (${page.importance.toFixed(4)})`);
      });
    }
    
    if (analysis.cycle_analysis?.cycles_found > 0) {
      console.log(`\nCycles Detected: ${analysis.cycle_analysis.cycles_found}`);
      analysis.cycle_analysis.cycles.forEach((cycle, i) => {
        console.log(`  Cycle ${i + 1}: ${cycle.nodes.join(' -> ')}`);
        console.log(`    Length: ${cycle.length}, Strength: ${cycle.strength.toFixed(2)}`);
      });
    }
    
  } catch (error) {
    console.error('Advanced example failed:', error.message);
  }
}

/**
 * Example 4: Graph export and visualization data
 */
async function graphExportExample() {
  console.log('\n=== Example 4: Graph Export ===');
  
  try {
    // Create a simple link analyzer with sample data
    const analyzer = new LinkAnalyzer({
      dampingFactor: 0.85,
      enableCaching: true
    });
    
    // Add sample links
    const sampleLinks = [
      ['https://example.com/', 'https://example.com/about'],
      ['https://example.com/', 'https://example.com/products'],
      ['https://example.com/about', 'https://example.com/team'],
      ['https://example.com/products', 'https://example.com/product1'],
      ['https://example.com/products', 'https://example.com/product2'],
      ['https://example.com/team', 'https://example.com/about']
    ];
    
    sampleLinks.forEach(([from, to]) => {
      analyzer.addLink(from, to, { anchorText: 'Sample Link' });
    });
    
    // Calculate importance
    analyzer.calculateImportance();
    
    // Export in different formats
    console.log('Exporting graph in different formats...');
    
    // JSON export
    const jsonExport = analyzer.exportGraph('json', { includeMetadata: true });
    console.log(`\nJSON Export: ${jsonExport.nodes.length} nodes, ${jsonExport.links.length} links`);
    
    // DOT export (for Graphviz)
    const dotExport = analyzer.exportGraph('dot', { includeImportance: true });
    console.log(`\nDOT Export (first 200 chars): ${dotExport.substring(0, 200)}...`);
    
    // CSV export
    const csvExport = analyzer.exportGraph('csv', { includeImportance: true });
    const csvLines = csvExport.split('\n');
    console.log(`\nCSV Export: ${csvLines.length - 1} data rows`);
    console.log(`Header: ${csvLines[0]}`);
    
    // Adjacency matrix
    const adjacencyExport = analyzer.exportGraph('adjacency');
    console.log(`\nAdjacency Matrix: ${adjacencyExport.size}x${adjacencyExport.size}`);
    
    // Generate visualization data
    const linkTool = new LinkAnalyzerTool();
    const vizData = linkTool.generateVisualizationData(analyzer, {
      maxNodes: 10,
      includeMetadata: true,
      layoutAlgorithm: 'force_directed'
    });
    
    console.log(`\nVisualization Data: ${vizData.nodes.length} nodes, ${vizData.links.length} links`);
    console.log(`Importance range: ${vizData.metadata.importanceRange.min.toFixed(4)} - ${vizData.metadata.importanceRange.max.toFixed(4)}`);
    
  } catch (error) {
    console.error('Graph export example failed:', error.message);
  }
}

/**
 * Example 5: Path analysis between URLs
 */
async function pathAnalysisExample() {
  console.log('\n=== Example 5: Path Analysis ===');
  
  try {
    const linkTool = new LinkAnalyzerTool();
    
    // Create a chain of links for path testing
    const linksData = [
      { from: 'https://example.com/start', to: 'https://example.com/step1' },
      { from: 'https://example.com/step1', to: 'https://example.com/step2' },
      { from: 'https://example.com/step2', to: 'https://example.com/step3' },
      { from: 'https://example.com/step3', to: 'https://example.com/end' },
      { from: 'https://example.com/start', to: 'https://example.com/shortcut' },
      { from: 'https://example.com/shortcut', to: 'https://example.com/end' }
    ];
    
    const analysis = await linkTool.analyze({
      links_data: linksData,
      find_path_from: 'https://example.com/start',
      find_path_to: 'https://example.com/end',
      enable_path_analysis: true
    });
    
    if (analysis.path_analysis?.path_found) {
      const path = analysis.path_analysis.path;
      console.log('Path Analysis Results:');
      console.log(`- Path found: ${path.direction}`);
      console.log(`- Path length: ${path.path.length - 1} steps`);
      console.log(`- Path: ${path.path.join(' -> ')}`);
      
      if (path.metadata) {
        console.log('\nPath metadata:');
        path.metadata.forEach((meta, i) => {
          console.log(`  ${i + 1}. ${meta.from} -> ${meta.to} (${meta.anchorText || 'no anchor'})`);
        });
      }
    } else {
      console.log('No path found between the specified URLs');
    }
    
  } catch (error) {
    console.error('Path analysis example failed:', error.message);
  }
}

/**
 * Example 6: Performance comparison
 */
async function performanceComparisonExample() {
  console.log('\n=== Example 6: Performance Comparison ===');
  
  try {
    const analyzer = new LinkAnalyzer({
      dampingFactor: 0.85,
      enableCaching: true
    });
    
    // Add many links to test performance
    const numNodes = 100;
    const numLinks = 500;
    
    console.log(`Creating graph with ${numNodes} nodes and ${numLinks} links...`);
    
    const startTime = Date.now();
    
    // Generate random links
    for (let i = 0; i < numLinks; i++) {
      const from = `https://example.com/page${Math.floor(Math.random() * numNodes)}`;
      const to = `https://example.com/page${Math.floor(Math.random() * numNodes)}`;
      analyzer.addLink(from, to, { linkId: i });
    }
    
    const buildTime = Date.now() - startTime;
    console.log(`Graph built in ${buildTime}ms`);
    
    // Test importance calculation performance
    const importanceStart = Date.now();
    const importance = analyzer.calculateImportance();
    const importanceTime = Date.now() - importanceStart;
    console.log(`PageRank calculated in ${importanceTime}ms`);
    
    // Test cycle detection performance
    const cycleStart = Date.now();
    const cycles = analyzer.detectCycles({ maxCycleLength: 5 });
    const cycleTime = Date.now() - cycleStart;
    console.log(`Cycle detection completed in ${cycleTime}ms`);
    console.log(`Found ${cycles.length} cycles`);
    
    // Get comprehensive statistics
    const stats = analyzer.getStatistics();
    console.log('\nFinal Statistics:');
    console.log(`- Nodes: ${stats.nodes}`);
    console.log(`- Links: ${stats.links}`);
    console.log(`- Density: ${stats.density.toFixed(6)}`);
    console.log(`- Avg outbound: ${stats.avgOutboundLinks.toFixed(2)}`);
    console.log(`- Avg inbound: ${stats.avgInboundLinks.toFixed(2)}`);
    console.log(`- Cache hits: ${stats.cacheHits}`);
    console.log(`- Cache misses: ${stats.cacheMisses}`);
    
  } catch (error) {
    console.error('Performance example failed:', error.message);
  }
}

// Main execution
async function main() {
  console.log('Link Analysis System Examples');
  console.log('============================\n');
  
  const examples = [
    basicLinkAnalysisExample,
    crawlDeepWithAnalysisExample,
    advancedLinkAnalysisExample,
    graphExportExample,
    pathAnalysisExample,
    performanceComparisonExample
  ];
  
  for (const example of examples) {
    try {
      await example();
      console.log('\n' + '='.repeat(50) + '\n');
    } catch (error) {
      console.error(`Example failed: ${error.message}\n`);
    }
  }
  
  console.log('All examples completed!');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export {
  basicLinkAnalysisExample,
  crawlDeepWithAnalysisExample,
  advancedLinkAnalysisExample,
  graphExportExample,
  pathAnalysisExample,
  performanceComparisonExample
};
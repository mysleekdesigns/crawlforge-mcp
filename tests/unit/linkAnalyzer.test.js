#!/usr/bin/env node

/**
 * Unit tests for LinkAnalyzer system
 */

import { LinkAnalyzer } from '../../src/core/analysis/LinkAnalyzer.js';
import { BFSCrawler } from '../../src/core/crawlers/BFSCrawler.js';
import { LinkAnalyzerTool } from '../../src/tools/analysis/linkAnalyzer.js';

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, testFunction) {
    this.tests.push({ name, testFunction });
  }

  async run() {
    console.log('Running LinkAnalyzer Tests');
    console.log('=========================\n');

    for (const { name, testFunction } of this.tests) {
      try {
        console.log(`Testing: ${name}`);
        await testFunction();
        console.log('✅ PASSED\n');
        this.passed++;
      } catch (error) {
        console.log(`❌ FAILED: ${error.message}\n`);
        this.failed++;
      }
    }

    console.log('Test Results:');
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`Total: ${this.tests.length}`);
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  assertEquals(actual, expected, message = '') {
    if (actual !== expected) {
      throw new Error(`${message} - Expected: ${expected}, Actual: ${actual}`);
    }
  }

  assertGreaterThan(actual, expected, message = '') {
    if (actual <= expected) {
      throw new Error(`${message} - Expected ${actual} to be greater than ${expected}`);
    }
  }

  assertArrayLength(array, expectedLength, message = '') {
    if (array.length !== expectedLength) {
      throw new Error(`${message} - Expected array length: ${expectedLength}, Actual: ${array.length}`);
    }
  }
}

const runner = new TestRunner();

// Test 1: Basic LinkAnalyzer functionality
runner.test('Basic LinkAnalyzer functionality', async () => {
  const analyzer = new LinkAnalyzer();
  
  // Test adding links
  const added = analyzer.addLink('https://example.com/a', 'https://example.com/b');
  runner.assert(added, 'Link should be added successfully');
  
  // Test node creation
  runner.assert(analyzer.nodes.has('https://example.com/a'), 'Source node should exist');
  runner.assert(analyzer.nodes.has('https://example.com/b'), 'Target node should exist');
  
  // Test link retrieval
  const outbound = analyzer.getOutboundLinks('https://example.com/a');
  const inbound = analyzer.getInboundLinks('https://example.com/b');
  
  runner.assertArrayLength(outbound, 1, 'Should have 1 outbound link');
  runner.assertArrayLength(inbound, 1, 'Should have 1 inbound link');
  runner.assertEquals(outbound[0], 'https://example.com/b', 'Outbound link should match');
  runner.assertEquals(inbound[0], 'https://example.com/a', 'Inbound link should match');
});

// Test 2: PageRank calculation
runner.test('PageRank calculation', async () => {
  const analyzer = new LinkAnalyzer({
    dampingFactor: 0.85,
    maxIterations: 50,
    convergenceThreshold: 0.001
  });
  
  // Create a simple graph: A -> B -> C -> A (triangle)
  analyzer.addLink('https://example.com/a', 'https://example.com/b');
  analyzer.addLink('https://example.com/b', 'https://example.com/c');
  analyzer.addLink('https://example.com/c', 'https://example.com/a');
  
  const importance = analyzer.calculateImportance();
  
  runner.assertEquals(importance.size, 3, 'Should calculate importance for 3 nodes');
  
  // All nodes should have equal importance in this symmetric case
  const scores = Array.from(importance.values());
  const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  
  runner.assert(avgScore > 0.3 && avgScore < 0.4, `Average score should be ~0.33, got ${avgScore}`);
});

// Test 3: Cycle detection
runner.test('Cycle detection', async () => {
  const analyzer = new LinkAnalyzer();
  
  // Create cycles
  analyzer.addLink('https://example.com/a', 'https://example.com/b');
  analyzer.addLink('https://example.com/b', 'https://example.com/c');
  analyzer.addLink('https://example.com/c', 'https://example.com/a'); // 3-cycle
  
  analyzer.addLink('https://example.com/d', 'https://example.com/e');
  analyzer.addLink('https://example.com/e', 'https://example.com/d'); // 2-cycle
  
  const cycles = analyzer.detectCycles();
  
  runner.assertGreaterThan(cycles.length, 0, 'Should detect cycles');
  
  // Check that cycles are properly formatted
  cycles.forEach(cycle => {
    runner.assert(Array.isArray(cycle.nodes), 'Cycle should have nodes array');
    runner.assert(typeof cycle.length === 'number', 'Cycle should have length');
    runner.assert(typeof cycle.strength === 'number', 'Cycle should have strength');
  });
});

// Test 4: Path finding
runner.test('Path finding', async () => {
  const analyzer = new LinkAnalyzer();
  
  // Create a path: A -> B -> C -> D
  analyzer.addLink('https://example.com/a', 'https://example.com/b');
  analyzer.addLink('https://example.com/b', 'https://example.com/c');
  analyzer.addLink('https://example.com/c', 'https://example.com/d');
  
  // Add a shortcut: A -> D
  analyzer.addLink('https://example.com/a', 'https://example.com/d');
  
  const path = analyzer.getRelationshipPath(
    'https://example.com/a', 
    'https://example.com/d',
    { maxDepth: 10, bidirectional: false }
  );
  
  runner.assert(path !== null, 'Should find a path');
  runner.assert(Array.isArray(path.path), 'Path should be an array');
  runner.assertEquals(path.path[0], 'https://example.com/a', 'Path should start with source');
  runner.assertEquals(path.path[path.path.length - 1], 'https://example.com/d', 'Path should end with target');
  
  // Should find the shortest path (direct link)
  runner.assertEquals(path.path.length, 2, 'Should find shortest path (2 nodes)');
});

// Test 5: Graph export functionality
runner.test('Graph export functionality', async () => {
  const analyzer = new LinkAnalyzer();
  
  analyzer.addLink('https://example.com/a', 'https://example.com/b', { anchorText: 'Link to B' });
  analyzer.addLink('https://example.com/b', 'https://example.com/c', { anchorText: 'Link to C' });
  analyzer.calculateImportance();
  
  // Test JSON export
  const jsonExport = analyzer.exportGraph('json', { includeMetadata: true });
  runner.assert(typeof jsonExport === 'object', 'JSON export should be an object');
  runner.assert(Array.isArray(jsonExport.nodes), 'Should have nodes array');
  runner.assert(Array.isArray(jsonExport.links), 'Should have links array');
  runner.assertEquals(jsonExport.nodes.length, 3, 'Should have 3 nodes');
  runner.assertEquals(jsonExport.links.length, 2, 'Should have 2 links');
  
  // Test DOT export
  const dotExport = analyzer.exportGraph('dot');
  runner.assert(typeof dotExport === 'string', 'DOT export should be a string');
  runner.assert(dotExport.includes('digraph'), 'DOT should contain digraph declaration');
  
  // Test CSV export
  const csvExport = analyzer.exportGraph('csv');
  runner.assert(typeof csvExport === 'string', 'CSV export should be a string');
  const csvLines = csvExport.split('\n').filter(line => line.trim());
  runner.assertGreaterThan(csvLines.length, 2, 'CSV should have header + data lines');
});

// Test 6: Statistics generation
runner.test('Statistics generation', async () => {
  const analyzer = new LinkAnalyzer();
  
  // Create a more complex graph
  const urls = ['a', 'b', 'c', 'd', 'e'].map(x => `https://example.com/${x}`);
  
  // Hub pattern: A links to all others
  for (let i = 1; i < urls.length; i++) {
    analyzer.addLink(urls[0], urls[i]);
  }
  
  // Authority pattern: All others link to E
  for (let i = 1; i < urls.length - 1; i++) {
    analyzer.addLink(urls[i], urls[4]);
  }
  
  const stats = analyzer.getStatistics();
  
  runner.assert(typeof stats === 'object', 'Stats should be an object');
  runner.assertEquals(stats.nodes, 5, 'Should have 5 nodes');
  runner.assertGreaterThan(stats.links, 0, 'Should have links');
  runner.assertGreaterThan(stats.density, 0, 'Should have positive density');
  runner.assert(typeof stats.avgOutboundLinks === 'number', 'Should have avg outbound links');
  runner.assert(typeof stats.avgInboundLinks === 'number', 'Should have avg inbound links');
});

// Test 7: BFSCrawler integration
runner.test('BFSCrawler integration', async () => {
  const crawler = new BFSCrawler({
    maxDepth: 1,
    maxPages: 5,
    enableLinkAnalysis: true,
    linkAnalyzerOptions: {
      dampingFactor: 0.85,
      enableCaching: true
    }
  });
  
  // Test that link analyzer is created
  runner.assert(crawler.linkAnalyzer !== null, 'LinkAnalyzer should be created');
  runner.assert(crawler.enableLinkAnalysis === true, 'Link analysis should be enabled');
  
  // Test getting the link analyzer
  const linkAnalyzer = crawler.getLinkAnalyzer();
  runner.assert(linkAnalyzer instanceof LinkAnalyzer, 'Should return LinkAnalyzer instance');
});

// Test 8: LinkAnalyzerTool functionality
runner.test('LinkAnalyzerTool functionality', async () => {
  const tool = new LinkAnalyzerTool();
  
  const sampleData = [
    { from: 'https://example.com/a', to: 'https://example.com/b', metadata: { anchorText: 'B' }},
    { from: 'https://example.com/b', to: 'https://example.com/c', metadata: { anchorText: 'C' }},
    { from: 'https://example.com/c', to: 'https://example.com/a', metadata: { anchorText: 'A' }}
  ];
  
  const analysis = await tool.analyze({
    links_data: sampleData,
    enable_importance_calculation: true,
    enable_cycle_detection: true,
    export_format: 'json'
  });
  
  runner.assert(typeof analysis === 'object', 'Analysis should return an object');
  runner.assert(analysis.analyzer_stats, 'Should have analyzer stats');
  
  if (analysis.importance_analysis) {
    runner.assert(Array.isArray(analysis.importance_analysis.top_pages), 'Should have top pages');
  }
  
  if (analysis.cycle_analysis) {
    runner.assertGreaterThan(analysis.cycle_analysis.cycles_found, 0, 'Should detect cycles');
  }
});

// Test 9: Performance with larger datasets
runner.test('Performance with larger datasets', async () => {
  const analyzer = new LinkAnalyzer({
    enableCaching: true,
    maxCacheSize: 1000
  });
  
  const startTime = Date.now();
  
  // Create 50 nodes with random links
  for (let i = 0; i < 100; i++) {
    const from = `https://example.com/page${Math.floor(Math.random() * 50)}`;
    const to = `https://example.com/page${Math.floor(Math.random() * 50)}`;
    analyzer.addLink(from, to);
  }
  
  const buildTime = Date.now() - startTime;
  runner.assert(buildTime < 1000, `Graph building should be fast, took ${buildTime}ms`);
  
  // Test importance calculation performance
  const importanceStart = Date.now();
  const importance = analyzer.calculateImportance();
  const importanceTime = Date.now() - importanceStart;
  
  runner.assert(importanceTime < 1000, `PageRank should be fast, took ${importanceTime}ms`);
  runner.assertGreaterThan(importance.size, 0, 'Should calculate importance for nodes');
});

// Test 10: Error handling
runner.test('Error handling', async () => {
  const analyzer = new LinkAnalyzer();
  
  // Test invalid URLs
  const invalidResult = analyzer.addLink('not-a-url', 'also-not-a-url');
  runner.assert(!invalidResult, 'Should reject invalid URLs');
  
  // Test self-links
  const selfLinkResult = analyzer.addLink('https://example.com/a', 'https://example.com/a');
  runner.assert(!selfLinkResult, 'Should reject self-links');
  
  // Test path finding with non-existent nodes
  const noPath = analyzer.getRelationshipPath('https://nowhere.com', 'https://alsono.com');
  runner.assert(noPath === null, 'Should return null for non-existent nodes');
  
  // Test export with invalid format
  try {
    analyzer.exportGraph('invalid_format');
    runner.assert(false, 'Should throw error for invalid format');
  } catch (error) {
    runner.assert(error.message.includes('Unsupported export format'), 'Should have proper error message');
  }
});

// Run all tests
runner.run().then(() => {
  process.exit(runner.failed > 0 ? 1 : 0);
}).catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
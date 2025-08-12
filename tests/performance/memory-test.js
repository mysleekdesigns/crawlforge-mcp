/**
 * Memory Testing Suite for MCP WebScraper
 * Monitors memory usage during large crawls and tests for memory leaks
 */

import { performance } from 'perf_hooks';
import { Worker } from 'worker_threads';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PerformanceManager } from '../../src/core/PerformanceManager.js';
import { StreamProcessor } from '../../src/core/processing/StreamProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Memory Test Configuration
 */
const MEMORY_TEST_CONFIG = {
  // Large crawl simulation
  largeCrawl: {
    urlCount: 1000,
    concurrent: 20,
    dataSize: 1024 * 1024, // 1MB per response
    duration: 300000 // 5 minutes
  },
  
  // Memory leak detection
  leakDetection: {
    iterations: 100,
    iterationDelay: 1000,
    memoryThreshold: 50 * 1024 * 1024, // 50MB threshold
    gcForceInterval: 10 // Force GC every 10 iterations
  },
  
  // Stream processing tests
  streamProcessing: {
    itemCount: 10000,
    itemSize: 10240, // 10KB per item
    chunkSize: 100,
    memoryLimit: 100 * 1024 * 1024 // 100MB limit
  },
  
  // Cleanup validation
  cleanup: {
    cycles: 5,
    operationsPerCycle: 50,
    cleanupDelay: 2000
  }
};

/**
 * Memory Usage Tracker
 */
class MemoryTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.startTime = Date.now();
    this.samples = [];
    this.peaks = {
      heapUsed: 0,
      heapTotal: 0,
      external: 0,
      rss: 0
    };
    this.leaks = [];
    this.gcEvents = [];
  }

  startTracking(interval = 1000) {
    this.stopTracking(); // Stop any existing tracking
    
    this.trackingInterval = setInterval(() => {
      this.recordSample();
    }, interval);
    
    // Track GC events if available
    if (global.gc) {
      this.setupGCTracking();
    }
  }

  stopTracking() {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
  }

  recordSample() {
    const memUsage = process.memoryUsage();
    const timestamp = Date.now();
    
    const sample = {
      timestamp,
      relativeTime: timestamp - this.startTime,
      ...memUsage
    };
    
    this.samples.push(sample);
    
    // Update peaks
    Object.keys(this.peaks).forEach(key => {
      if (memUsage[key] > this.peaks[key]) {
        this.peaks[key] = memUsage[key];
      }
    });
    
    return sample;
  }

  setupGCTracking() {
    const originalGC = global.gc;
    const self = this;
    
    global.gc = function(...args) {
      const before = process.memoryUsage();
      const result = originalGC.apply(this, args);
      const after = process.memoryUsage();
      
      self.gcEvents.push({
        timestamp: Date.now(),
        before,
        after,
        freed: before.heapUsed - after.heapUsed
      });
      
      return result;
    };
  }

  detectMemoryLeaks() {
    if (this.samples.length < 10) return [];
    
    const leaks = [];
    const windowSize = 10;
    
    // Sliding window analysis
    for (let i = windowSize; i < this.samples.length; i++) {
      const currentWindow = this.samples.slice(i - windowSize, i);
      const trend = this.calculateMemoryTrend(currentWindow);
      
      if (trend.slope > 1024 * 1024) { // 1MB/sample increasing trend
        leaks.push({
          startTime: currentWindow[0].timestamp,
          endTime: currentWindow[windowSize - 1].timestamp,
          memoryIncrease: trend.slope * windowSize,
          severity: this.calculateLeakSeverity(trend.slope)
        });
      }
    }
    
    this.leaks = leaks;
    return leaks;
  }

  calculateMemoryTrend(samples) {
    const n = samples.length;
    const sumX = samples.reduce((sum, _, i) => sum + i, 0);
    const sumY = samples.reduce((sum, sample) => sum + sample.heapUsed, 0);
    const sumXY = samples.reduce((sum, sample, i) => sum + (i * sample.heapUsed), 0);
    const sumXX = samples.reduce((sum, _, i) => sum + (i * i), 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }

  calculateLeakSeverity(slope) {
    const mbPerSample = slope / (1024 * 1024);
    
    if (mbPerSample > 10) return 'CRITICAL';
    if (mbPerSample > 5) return 'HIGH';
    if (mbPerSample > 1) return 'MEDIUM';
    return 'LOW';
  }

  generateReport() {
    if (this.samples.length === 0) {
      return { error: 'No memory samples collected' };
    }
    
    const duration = this.samples[this.samples.length - 1].timestamp - this.samples[0].timestamp;
    const avgMemory = this.samples.reduce((sum, s) => sum + s.heapUsed, 0) / this.samples.length;
    
    // Memory stability analysis
    const memoryVariation = this.calculateMemoryVariation();
    const leaks = this.detectMemoryLeaks();
    
    return {
      duration,
      sampleCount: this.samples.length,
      memory: {
        peak: this.peaks,
        average: avgMemory,
        final: this.samples[this.samples.length - 1],
        variation: memoryVariation
      },
      leaks: {
        detected: leaks.length > 0,
        count: leaks.length,
        details: leaks
      },
      gc: {
        events: this.gcEvents.length,
        totalFreed: this.gcEvents.reduce((sum, gc) => sum + gc.freed, 0),
        avgFreed: this.gcEvents.length > 0 
          ? this.gcEvents.reduce((sum, gc) => sum + gc.freed, 0) / this.gcEvents.length 
          : 0
      },
      stability: {
        isStable: memoryVariation.coefficient < 0.1,
        coefficient: memoryVariation.coefficient,
        trend: memoryVariation.trend
      }
    };
  }

  calculateMemoryVariation() {
    const memoryValues = this.samples.map(s => s.heapUsed);
    const mean = memoryValues.reduce((sum, val) => sum + val, 0) / memoryValues.length;
    const variance = memoryValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / memoryValues.length;
    const stdDev = Math.sqrt(variance);
    
    // Calculate trend
    const trend = this.calculateMemoryTrend(this.samples);
    
    return {
      mean,
      stdDev,
      coefficient: stdDev / mean,
      trend: trend.slope > 0 ? 'INCREASING' : trend.slope < 0 ? 'DECREASING' : 'STABLE'
    };
  }
}

/**
 * Memory Test Suite
 */
class MemoryTestSuite {
  constructor() {
    this.tracker = new MemoryTracker();
    this.performanceManager = null;
    this.results = {};
  }

  /**
   * Run comprehensive memory test suite
   */
  async runMemoryTests() {
    console.log('🧠 Starting Memory Test Suite...');
    console.log('─'.repeat(60));
    
    this.performanceManager = new PerformanceManager({
      enableMetrics: true,
      metricsInterval: 5000
    });
    
    try {
      // Test 1: Large crawl memory usage
      console.log('📊 Test 1: Large Crawl Memory Usage');
      this.results.largeCrawl = await this.testLargeCrawlMemory();
      
      // Test 2: Memory leak detection
      console.log('\n🔍 Test 2: Memory Leak Detection');
      this.results.memoryLeaks = await this.testMemoryLeaks();
      
      // Test 3: Stream processing memory efficiency
      console.log('\n🌊 Test 3: Stream Processing Memory Efficiency');
      this.results.streamProcessing = await this.testStreamProcessingMemory();
      
      // Test 4: Cleanup validation
      console.log('\n🧹 Test 4: Cleanup Validation');
      this.results.cleanup = await this.testCleanupValidation();
      
      // Test 5: Worker pool memory isolation
      console.log('\n👥 Test 5: Worker Pool Memory Isolation');
      this.results.workerIsolation = await this.testWorkerMemoryIsolation();
      
      // Generate comprehensive report
      const report = this.generateComprehensiveReport();
      await this.saveReport(report);
      
      return report;
      
    } finally {
      if (this.performanceManager) {
        await this.performanceManager.shutdown();
      }
      this.tracker.stopTracking();
    }
  }

  /**
   * Test memory usage during large crawl operations
   */
  async testLargeCrawlMemory() {
    console.log('   🚀 Simulating large crawl with 1000 URLs...');
    
    this.tracker.reset();
    this.tracker.startTracking(500); // Sample every 500ms
    
    const startMemory = process.memoryUsage();
    const testUrls = this.generateTestUrls(MEMORY_TEST_CONFIG.largeCrawl.urlCount);
    
    try {
      // Simulate concurrent crawling
      const crawlPromises = [];
      const concurrent = MEMORY_TEST_CONFIG.largeCrawl.concurrent;
      
      for (let i = 0; i < testUrls.length; i += concurrent) {
        const batch = testUrls.slice(i, i + concurrent);
        const batchPromises = batch.map(url => this.simulateCrawlOperation(url));
        
        crawlPromises.push(Promise.all(batchPromises));
        
        // Small delay between batches to observe memory patterns
        await this.delay(100);
      }
      
      await Promise.all(crawlPromises);
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        await this.delay(1000); // Wait for GC to complete
      }
      
      const endMemory = process.memoryUsage();
      this.tracker.stopTracking();
      
      const memoryReport = this.tracker.generateReport();
      
      return {
        success: true,
        startMemory,
        endMemory,
        memoryIncrease: endMemory.heapUsed - startMemory.heapUsed,
        peakMemory: memoryReport.memory.peak.heapUsed,
        urlsProcessed: testUrls.length,
        memoryPerUrl: (memoryReport.memory.peak.heapUsed - startMemory.heapUsed) / testUrls.length,
        tracking: memoryReport
      };
      
    } catch (error) {
      this.tracker.stopTracking();
      return {
        success: false,
        error: error.message,
        tracking: this.tracker.generateReport()
      };
    }
  }

  /**
   * Test for memory leaks through repeated operations
   */
  async testMemoryLeaks() {
    console.log('   🔍 Running memory leak detection...');
    
    this.tracker.reset();
    this.tracker.startTracking(200); // Frequent sampling for leak detection
    
    const iterations = MEMORY_TEST_CONFIG.leakDetection.iterations;
    const startMemory = process.memoryUsage();
    
    try {
      for (let i = 0; i < iterations; i++) {
        // Perform operations that might leak memory
        await this.performLeakProneOperations();
        
        // Force GC periodically
        if (global.gc && i % MEMORY_TEST_CONFIG.leakDetection.gcForceInterval === 0) {
          global.gc();
        }
        
        await this.delay(MEMORY_TEST_CONFIG.leakDetection.iterationDelay);
        
        if (i % 20 === 0) {
          const currentMemory = process.memoryUsage();
          console.log(`     Iteration ${i}: ${(currentMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        }
      }
      
      // Final GC
      if (global.gc) {
        global.gc();
        await this.delay(2000);
      }
      
      const endMemory = process.memoryUsage();
      this.tracker.stopTracking();
      
      const memoryReport = this.tracker.generateReport();
      const leaks = memoryReport.leaks;
      
      return {
        success: true,
        iterations,
        startMemory,
        endMemory,
        memoryIncrease: endMemory.heapUsed - startMemory.heapUsed,
        leaksDetected: leaks.detected,
        leakDetails: leaks.details,
        stability: memoryReport.stability,
        tracking: memoryReport
      };
      
    } catch (error) {
      this.tracker.stopTracking();
      return {
        success: false,
        error: error.message,
        tracking: this.tracker.generateReport()
      };
    }
  }

  /**
   * Test stream processing memory efficiency
   */
  async testStreamProcessingMemory() {
    console.log('   🌊 Testing stream processing memory efficiency...');
    
    this.tracker.reset();
    this.tracker.startTracking(1000);
    
    const startMemory = process.memoryUsage();
    const config = MEMORY_TEST_CONFIG.streamProcessing;
    
    try {
      const streamProcessor = new StreamProcessor({
        chunkSize: config.chunkSize,
        memoryLimit: config.memoryLimit
      });
      
      // Generate large dataset
      const dataset = this.generateLargeDataset(config.itemCount, config.itemSize);
      
      // Process using streaming
      const result = await streamProcessor.processStream(
        dataset,
        async (item) => {
          // Simulate processing
          return { processed: item.length, timestamp: Date.now() };
        },
        {
          enablePagination: true,
          chunkSize: config.chunkSize
        }
      );
      
      await streamProcessor.shutdown();
      
      // Force cleanup
      if (global.gc) {
        global.gc();
        await this.delay(1000);
      }
      
      const endMemory = process.memoryUsage();
      this.tracker.stopTracking();
      
      const memoryReport = this.tracker.generateReport();
      
      return {
        success: true,
        itemsProcessed: config.itemCount,
        totalDataSize: config.itemCount * config.itemSize,
        startMemory,
        endMemory,
        peakMemory: memoryReport.memory.peak.heapUsed,
        memoryEfficiency: (config.itemCount * config.itemSize) / memoryReport.memory.peak.heapUsed,
        withinLimit: memoryReport.memory.peak.heapUsed <= config.memoryLimit,
        tracking: memoryReport,
        result
      };
      
    } catch (error) {
      this.tracker.stopTracking();
      return {
        success: false,
        error: error.message,
        tracking: this.tracker.generateReport()
      };
    }
  }

  /**
   * Test cleanup validation
   */
  async testCleanupValidation() {
    console.log('   🧹 Testing cleanup validation...');
    
    const results = [];
    const config = MEMORY_TEST_CONFIG.cleanup;
    
    for (let cycle = 0; cycle < config.cycles; cycle++) {
      console.log(`     Cycle ${cycle + 1}/${config.cycles}`);
      
      this.tracker.reset();
      this.tracker.startTracking(500);
      
      const startMemory = process.memoryUsage();
      
      try {
        // Perform operations
        for (let op = 0; op < config.operationsPerCycle; op++) {
          await this.performCleanupTestOperation();
        }
        
        // Trigger cleanup
        await this.triggerCleanup();
        await this.delay(config.cleanupDelay);
        
        // Force GC
        if (global.gc) {
          global.gc();
          await this.delay(1000);
        }
        
        const endMemory = process.memoryUsage();
        this.tracker.stopTracking();
        
        const memoryReport = this.tracker.generateReport();
        
        results.push({
          cycle: cycle + 1,
          startMemory,
          endMemory,
          memoryRecovered: startMemory.heapUsed - endMemory.heapUsed,
          cleanupEffective: endMemory.heapUsed <= startMemory.heapUsed * 1.1, // Within 10%
          tracking: memoryReport
        });
        
      } catch (error) {
        this.tracker.stopTracking();
        results.push({
          cycle: cycle + 1,
          error: error.message,
          tracking: this.tracker.generateReport()
        });
      }
    }
    
    const successfulCycles = results.filter(r => !r.error);
    const cleanupEffectiveness = successfulCycles.filter(r => r.cleanupEffective).length / successfulCycles.length;
    
    return {
      success: successfulCycles.length === config.cycles,
      cycles: results,
      cleanupEffectiveness,
      averageMemoryRecovered: successfulCycles.reduce((sum, r) => sum + r.memoryRecovered, 0) / successfulCycles.length || 0
    };
  }

  /**
   * Test worker pool memory isolation
   */
  async testWorkerMemoryIsolation() {
    console.log('   👥 Testing worker pool memory isolation...');
    
    this.tracker.reset();
    this.tracker.startTracking(1000);
    
    const startMemory = process.memoryUsage();
    
    try {
      const workerTasks = [];
      const taskCount = 20;
      
      // Launch memory-intensive tasks in workers
      for (let i = 0; i < taskCount; i++) {
        const task = this.performanceManager.executeTask('memoryIntensiveTask', {
          dataSize: 10 * 1024 * 1024, // 10MB per task
          taskId: i
        });
        workerTasks.push(task);
      }
      
      await Promise.all(workerTasks);
      
      // Force cleanup
      if (global.gc) {
        global.gc();
        await this.delay(2000);
      }
      
      const endMemory = process.memoryUsage();
      this.tracker.stopTracking();
      
      const memoryReport = this.tracker.generateReport();
      const workerStats = this.performanceManager.getMetrics().componentStats.workerPool;
      
      return {
        success: true,
        tasksExecuted: taskCount,
        startMemory,
        endMemory,
        peakMemory: memoryReport.memory.peak.heapUsed,
        memoryIsolated: endMemory.heapUsed <= startMemory.heapUsed * 1.2, // Memory should not grow significantly
        workerStats,
        tracking: memoryReport
      };
      
    } catch (error) {
      this.tracker.stopTracking();
      return {
        success: false,
        error: error.message,
        tracking: this.tracker.generateReport()
      };
    }
  }

  /**
   * Generate test URLs for crawl simulation
   */
  generateTestUrls(count) {
    const baseUrls = [
      'https://httpbin.org/delay/',
      'https://httpbin.org/bytes/',
      'https://httpbin.org/json',
      'https://httpbin.org/html'
    ];
    
    const urls = [];
    for (let i = 0; i < count; i++) {
      const baseUrl = baseUrls[i % baseUrls.length];
      urls.push(`${baseUrl}${i}`);
    }
    
    return urls;
  }

  /**
   * Simulate crawl operation
   */
  async simulateCrawlOperation(url) {
    // Simulate the memory footprint of a real crawl operation
    const data = Buffer.alloc(MEMORY_TEST_CONFIG.largeCrawl.dataSize);
    data.fill('x');
    
    // Simulate processing delay
    await this.delay(Math.random() * 100 + 50);
    
    // Simulate data processing
    const processed = {
      url,
      content: data.toString('base64').substring(0, 1000),
      timestamp: Date.now(),
      size: data.length
    };
    
    return processed;
  }

  /**
   * Perform operations that might leak memory
   */
  async performLeakProneOperations() {
    // Create and discard large objects
    const largeArray = new Array(10000).fill('memory-test-data'.repeat(100));
    const largeObject = {
      data: largeArray,
      nested: {
        more: largeArray.slice(),
        timestamp: Date.now()
      }
    };
    
    // Simulate processing
    await this.delay(10);
    
    // Create circular reference (potential leak)
    largeObject.circular = largeObject;
    
    // Break circular reference
    delete largeObject.circular;
    
    return largeObject.nested.timestamp;
  }

  /**
   * Generate large dataset for stream testing
   */
  generateLargeDataset(itemCount, itemSize) {
    const dataset = [];
    
    for (let i = 0; i < itemCount; i++) {
      const item = Buffer.alloc(itemSize);
      item.fill(`item-${i}`);
      dataset.push(item);
    }
    
    return dataset;
  }

  /**
   * Perform cleanup test operation
   */
  async performCleanupTestOperation() {
    // Create temporary data structures
    const tempData = {
      id: Math.random(),
      data: new Array(1000).fill('cleanup-test-data'),
      created: Date.now()
    };
    
    await this.delay(5);
    
    // Simulate cleanup
    delete tempData.data;
    
    return tempData.id;
  }

  /**
   * Trigger cleanup operations
   */
  async triggerCleanup() {
    // Trigger various cleanup operations
    if (this.performanceManager) {
      // Get stats to trigger internal cleanup
      this.performanceManager.getMetrics();
    }
    
    // Force garbage collection
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Generate comprehensive memory test report
   */
  generateComprehensiveReport() {
    const timestamp = new Date().toISOString();
    
    return {
      timestamp,
      configuration: MEMORY_TEST_CONFIG,
      testResults: this.results,
      summary: this.generateSummary(),
      analysis: this.analyzeResults(),
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Generate test summary
   */
  generateSummary() {
    const tests = Object.keys(this.results);
    const successful = tests.filter(test => this.results[test].success).length;
    
    return {
      totalTests: tests.length,
      successfulTests: successful,
      failedTests: tests.length - successful,
      overallStatus: successful === tests.length ? 'PASS' : 'PARTIAL',
      
      // Memory statistics
      peakMemoryUsage: Math.max(...tests.map(test => 
        this.results[test].peakMemory || this.results[test].tracking?.memory?.peak?.heapUsed || 0
      )),
      
      // Leak detection
      leaksDetected: this.results.memoryLeaks?.leaksDetected || false,
      memoryStable: this.results.memoryLeaks?.stability?.isStable || false,
      
      // Cleanup effectiveness
      cleanupEffective: this.results.cleanup?.cleanupEffectiveness || 0
    };
  }

  /**
   * Analyze test results
   */
  analyzeResults() {
    const analysis = {
      status: 'PASS',
      issues: [],
      highlights: []
    };
    
    // Check for memory leaks
    if (this.results.memoryLeaks?.leaksDetected) {
      analysis.status = 'FAIL';
      analysis.issues.push('Memory leaks detected during stress testing');
    } else {
      analysis.highlights.push('No memory leaks detected');
    }
    
    // Check memory stability
    if (!this.results.memoryLeaks?.stability?.isStable) {
      analysis.status = 'WARNING';
      analysis.issues.push('Memory usage is not stable over time');
    }
    
    // Check cleanup effectiveness
    const cleanupEffectiveness = this.results.cleanup?.cleanupEffectiveness || 0;
    if (cleanupEffectiveness < 0.8) {
      analysis.status = 'WARNING';
      analysis.issues.push(`Low cleanup effectiveness: ${(cleanupEffectiveness * 100).toFixed(1)}%`);
    } else {
      analysis.highlights.push(`Good cleanup effectiveness: ${(cleanupEffectiveness * 100).toFixed(1)}%`);
    }
    
    // Check worker isolation
    if (!this.results.workerIsolation?.memoryIsolated) {
      analysis.status = 'WARNING';
      analysis.issues.push('Worker memory isolation may be insufficient');
    } else {
      analysis.highlights.push('Worker memory isolation working correctly');
    }
    
    // Check stream processing efficiency
    if (this.results.streamProcessing?.withinLimit === false) {
      analysis.status = 'FAIL';
      analysis.issues.push('Stream processing exceeded memory limits');
    } else if (this.results.streamProcessing?.memoryEfficiency < 0.1) {
      analysis.status = 'WARNING';
      analysis.issues.push('Stream processing memory efficiency could be improved');
    }
    
    return analysis;
  }

  /**
   * Generate recommendations based on test results
   */
  generateRecommendations() {
    const recommendations = [];
    
    if (this.results.memoryLeaks?.leaksDetected) {
      recommendations.push('Investigate and fix identified memory leaks');
      recommendations.push('Implement more aggressive garbage collection strategies');
    }
    
    if (this.results.cleanup?.cleanupEffectiveness < 0.8) {
      recommendations.push('Improve cleanup routines and resource management');
      recommendations.push('Consider implementing periodic cleanup cycles');
    }
    
    if (!this.results.workerIsolation?.memoryIsolated) {
      recommendations.push('Review worker pool memory management');
      recommendations.push('Implement stricter memory limits for worker processes');
    }
    
    if (this.results.streamProcessing?.memoryEfficiency < 0.1) {
      recommendations.push('Optimize stream processing chunk sizes');
      recommendations.push('Implement memory-efficient data transformation algorithms');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Memory usage patterns are within acceptable parameters');
      recommendations.push('Continue monitoring memory usage in production');
    }
    
    return recommendations;
  }

  /**
   * Save test report to file
   */
  async saveReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `memory-test-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📄 Memory test report saved: ${filepath}`);
    } catch (error) {
      console.error('❌ Failed to save report:', error.message);
    }
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Main memory test execution
 */
async function runMemoryTests() {
  // Enable GC if available
  if (typeof global.gc === 'function') {
    console.log('✅ Garbage collection available for testing');
  } else {
    console.log('⚠️ Garbage collection not available (run with --expose-gc for better results)');
  }
  
  const memoryTestSuite = new MemoryTestSuite();
  
  try {
    const report = await memoryTestSuite.runMemoryTests();
    
    console.log('\n📋 Memory Test Summary:');
    console.log('─'.repeat(60));
    console.log(`✅ Status: ${report.analysis.status}`);
    console.log(`📊 Total Tests: ${report.summary.totalTests}`);
    console.log(`🎯 Successful: ${report.summary.successfulTests}`);
    console.log(`🧠 Peak Memory: ${(report.summary.peakMemoryUsage / 1024 / 1024).toFixed(2)} MB`);
    console.log(`💧 Leaks Detected: ${report.summary.leaksDetected ? 'YES' : 'NO'}`);
    console.log(`📈 Memory Stable: ${report.summary.memoryStable ? 'YES' : 'NO'}`);
    console.log(`🧹 Cleanup Effectiveness: ${(report.summary.cleanupEffective * 100).toFixed(1)}%`);
    
    if (report.analysis.issues.length > 0) {
      console.log('\n⚠️ Issues Identified:');
      report.analysis.issues.forEach(issue => console.log(`   • ${issue}`));
    }
    
    if (report.analysis.highlights.length > 0) {
      console.log('\n✨ Highlights:');
      report.analysis.highlights.forEach(highlight => console.log(`   • ${highlight}`));
    }
    
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach(rec => console.log(`   • ${rec}`));
    
    return report;
    
  } catch (error) {
    console.error('❌ Memory test failed:', error);
    throw error;
  }
}

// Export for use in other test files
export { MemoryTestSuite, MemoryTracker, runMemoryTests };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMemoryTests()
    .then(() => {
      console.log('✅ Memory test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Memory test failed:', error);
      process.exit(1);
    });
}
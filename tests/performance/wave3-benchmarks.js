/**
 * Wave 3 Performance Benchmarks
 * Comprehensive performance testing suite for Wave 3 features
 */

import { performance, PerformanceObserver } from 'perf_hooks';
import fs from 'fs/promises';
import path from 'path';
import EventEmitter from 'events';

// Import Wave 3 components
import { DeepResearchTool } from '../../src/tools/research/deepResearch.js';
import { StealthBrowserManager } from '../../src/core/StealthBrowserManager.js';
import { TrackChangesTool } from '../../src/tools/tracking/trackChanges.js';

class PerformanceMonitor extends EventEmitter {
  constructor() {
    super();
    this.metrics = { memory: [], operations: new Map() };
    this.baseline = null;
    this.isMonitoring = false;
  }

  startMonitoring() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    this.baseline = this.getResourceSnapshot();
    this.emit('monitoring_started');
  }

  stopMonitoring() {
    if (!this.isMonitoring) return;
    this.isMonitoring = false;
    const finalSnapshot = this.getResourceSnapshot();
    this.emit('monitoring_stopped', { 
      baseline: this.baseline, 
      final: finalSnapshot,
      summary: this.generateSummary()
    });
  }

  getResourceSnapshot() {
    const memUsage = process.memoryUsage();
    const currentTime = Date.now();
    
    return {
      timestamp: currentTime,
      memory: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external
      }
    };
  }

  generateSummary() {
    return { memory: this.analyzeMemoryMetrics() };
  }

  analyzeMemoryMetrics() {
    if (this.metrics.memory.length === 0) return {};
    const heapUsages = this.metrics.memory.map(m => m.heapUsed);
    return {
      heap: {
        min: Math.min(...heapUsages),
        max: Math.max(...heapUsages),
        avg: heapUsages.reduce((a, b) => a + b, 0) / heapUsages.length
      }
    };
  }
}

class Wave3BenchmarkSuite extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      memoryThreshold: 512 * 1024 * 1024, // 512MB
      responseTimeThreshold: 2000, // 2 seconds
      ...options
    };

    this.monitor = new PerformanceMonitor();
    this.results = {
      deepResearch: {},
      stealthMode: {},
      changeTracking: {},
      overall: {}
    };
    
    this.setupComponents();
  }

  async setupComponents() {
    this.deepResearch = new DeepResearchTool({
      defaultTimeLimit: 60000,
      maxConcurrentResearch: 10,
      cacheEnabled: true
    });

    this.stealthManager = new StealthBrowserManager();
    
    this.changeTracker = new TrackChangesTool({
      cacheEnabled: true,
      maxConcurrentMonitors: 50
    });

    this.emit('components_initialized');
  }

  async runFullBenchmarkSuite() {
    console.log('Starting Wave 3 Performance Benchmark Suite...');
    this.emit('benchmark_started');
    
    try {
      await this.benchmarkDeepResearch();
      await this.benchmarkStealthMode();
      await this.benchmarkChangeTracking();
      
      const report = await this.generateReport();
      this.emit('benchmark_completed', report);
      return report;
      
    } catch (error) {
      this.emit('benchmark_error', error);
      throw error;
    }
  }

  async benchmarkDeepResearch() {
    console.log('Benchmarking Deep Research Tool...');
    this.monitor.startMonitoring();
    
    const scenarios = [
      { topic: 'artificial intelligence', maxDepth: 3, maxUrls: 20 },
      { topic: 'climate change solutions', maxDepth: 5, maxUrls: 50 }
    ];

    this.results.deepResearch = { singleRequests: {} };

    for (const scenario of scenarios) {
      const startTime = Date.now();
      
      try {
        const result = await this.deepResearch.execute({
          ...scenario,
          researchApproach: 'focused',
          timeLimit: 30000
        });
        
        const duration = Date.now() - startTime;
        
        this.results.deepResearch.singleRequests[scenario.topic] = {
          success: result.success,
          duration: duration,
          findingsCount: result.findings?.length || 0,
          memorySnapshot: this.monitor.getResourceSnapshot()
        };
        
      } catch (error) {
        this.results.deepResearch.singleRequests[scenario.topic] = {
          success: false,
          error: error.message
        };
      }
      
      await this.sleep(2000);
    }

    this.monitor.stopMonitoring();
    this.results.deepResearch.monitoring = this.monitor.generateSummary();
  }

  async benchmarkStealthMode() {
    console.log('Benchmarking Stealth Mode...');
    this.monitor.startMonitoring();

    this.results.stealthMode = { browserLaunch: {} };

    const launchConfigs = [
      { level: 'basic' },
      { level: 'medium' },
      { level: 'advanced' }
    ];

    for (const config of launchConfigs) {
      const startTime = Date.now();
      
      try {
        const browser = await this.stealthManager.launchStealthBrowser(config);
        const duration = Date.now() - startTime;
        
        this.results.stealthMode.browserLaunch[config.level] = {
          success: true,
          duration: duration,
          memorySnapshot: this.monitor.getResourceSnapshot()
        };

        await browser.close();
        
      } catch (error) {
        this.results.stealthMode.browserLaunch[config.level] = {
          success: false,
          error: error.message
        };
      }
      
      await this.sleep(1000);
    }

    this.monitor.stopMonitoring();
    this.results.stealthMode.monitoring = this.monitor.generateSummary();
  }

  async benchmarkChangeTracking() {
    console.log('Benchmarking Change Tracking...');
    this.monitor.startMonitoring();

    this.results.changeTracking = { baselineCreation: {} };

    const testUrls = [
      'https://example.com',
      'https://httpbin.org/html'
    ];

    for (const url of testUrls) {
      const startTime = Date.now();
      
      try {
        const result = await this.changeTracker.execute({
          url,
          operation: 'create_baseline',
          trackingOptions: {
            granularity: 'section',
            trackText: true,
            trackStructure: true
          }
        });
        
        const duration = Date.now() - startTime;
        
        this.results.changeTracking.baselineCreation[url] = {
          success: result.success,
          duration: duration,
          sections: result.baseline?.sections || 0,
          memorySnapshot: this.monitor.getResourceSnapshot()
        };
        
      } catch (error) {
        this.results.changeTracking.baselineCreation[url] = {
          success: false,
          error: error.message
        };
      }
      
      await this.sleep(1000);
    }

    this.monitor.stopMonitoring();
    this.results.changeTracking.monitoring = this.monitor.generateSummary();
  }

  async generateReport() {
    const timestamp = new Date().toISOString();
    const reportTimestamp = Date.now();
    
    const report = {
      metadata: {
        timestamp,
        nodeVersion: process.version,
        platform: process.platform
      },
      summary: this.generateSummary(),
      detailedResults: this.results,
      recommendations: this.generateRecommendations()
    };

    const reportFileName = 'wave3-benchmark-' + reportTimestamp + '.json';
    const reportPath = path.join(process.cwd(), 'tests', 'performance', 'reports', reportFileName);
    
    try {
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log('Performance report saved to: ' + reportPath);
    } catch (error) {
      console.warn('Failed to save performance report:', error.message);
    }

    return report;
  }

  generateSummary() {
    return {
      overallScore: this.calculateOverallScore(),
      memoryUsage: this.evaluateMemoryUsage(),
      responseTime: this.evaluateResponseTimes(),
      reliability: this.evaluateReliability()
    };
  }

  calculateOverallScore() {
    const memoryScore = this.evaluateMemoryUsage().efficiency || 0;
    const timeScore = this.evaluateResponseTimes().efficiency || 0;
    const reliabilityScore = this.evaluateReliability().successRate || 0;
    
    return (memoryScore + timeScore + reliabilityScore) / 3;
  }

  evaluateMemoryUsage() {
    let maxHeapUsed = 0;
    let samples = 0;

    const traverse = (obj) => {
      if (typeof obj === 'object' && obj !== null) {
        if (obj.memorySnapshot?.memory?.heapUsed) {
          maxHeapUsed = Math.max(maxHeapUsed, obj.memorySnapshot.memory.heapUsed);
          samples++;
        }
        for (const value of Object.values(obj)) {
          traverse(value);
        }
      }
    };

    traverse(this.results);

    return {
      maxHeapUsed: maxHeapUsed,
      exceedsThreshold: maxHeapUsed > this.options.memoryThreshold,
      efficiency: maxHeapUsed > 0 ? Math.max(0, 100 - (maxHeapUsed / this.options.memoryThreshold) * 100) : 100
    };
  }

  evaluateResponseTimes() {
    let maxDuration = 0;
    let samples = 0;

    const traverse = (obj) => {
      if (typeof obj === 'object' && obj !== null) {
        if (obj.duration && typeof obj.duration === 'number') {
          maxDuration = Math.max(maxDuration, obj.duration);
          samples++;
        }
        for (const value of Object.values(obj)) {
          traverse(value);
        }
      }
    };

    traverse(this.results);

    return {
      maxDuration,
      efficiency: maxDuration > 0 ? Math.max(0, 100 - (maxDuration / (this.options.responseTimeThreshold * 2)) * 100) : 100
    };
  }

  evaluateReliability() {
    let totalOperations = 0;
    let successfulOperations = 0;

    const traverse = (obj) => {
      if (typeof obj === 'object' && obj !== null) {
        if (obj.hasOwnProperty('success')) {
          totalOperations++;
          if (obj.success) {
            successfulOperations++;
          }
        }
        for (const value of Object.values(obj)) {
          traverse(value);
        }
      }
    };

    traverse(this.results);

    return {
      successRate: totalOperations > 0 ? (successfulOperations / totalOperations) * 100 : 0,
      totalOperations,
      successfulOperations
    };
  }

  generateRecommendations() {
    const recommendations = [];
    const memoryEval = this.evaluateMemoryUsage();
    const responseTime = this.evaluateResponseTimes();
    const reliability = this.evaluateReliability();
    const thresholdMB = (this.options.memoryThreshold / 1024 / 1024).toFixed(0);

    if (memoryEval.exceedsThreshold) {
      recommendations.push({
        category: 'memory',
        priority: 'high',
        issue: 'Memory usage exceeds ' + thresholdMB + 'MB threshold',
        suggestion: 'Implement memory optimization strategies: object pooling, lazy loading, garbage collection triggers'
      });
    }

    if (responseTime.maxDuration > this.options.responseTimeThreshold) {
      recommendations.push({
        category: 'performance',
        priority: 'medium',
        issue: 'Response time exceeded ' + this.options.responseTimeThreshold + 'ms threshold',
        suggestion: 'Consider implementing caching, request batching, or reducing operation scope'
      });
    }

    if (reliability.successRate < 95) {
      recommendations.push({
        category: 'reliability',
        priority: 'high',
        issue: 'Success rate is ' + reliability.successRate.toFixed(1) + '% (below 95% target)',
        suggestion: 'Implement better error handling, retry logic, and graceful degradation'
      });
    }

    return recommendations;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export { Wave3BenchmarkSuite, PerformanceMonitor };

// Run benchmarks if called directly
if (process.argv[1] === import.meta.url.replace('file://', '')) {
  const suite = new Wave3BenchmarkSuite();
  
  suite.on('benchmark_started', () => {
    console.log('🚀 Wave 3 Performance Benchmarks Started');
  });
  
  suite.on('benchmark_completed', (report) => {
    console.log('✅ Wave 3 Performance Benchmarks Completed');
    console.log('Overall Score: ' + report.summary.overallScore.toFixed(1) + '/100');
    console.log('Success Rate: ' + report.summary.reliability.successRate.toFixed(1) + '%');
    console.log('Max Memory Usage: ' + (report.summary.memoryUsage.maxHeapUsed / 1024 / 1024).toFixed(0) + 'MB');
    console.log('Max Response Time: ' + report.summary.responseTime.maxDuration.toFixed(0) + 'ms');
    
    if (report.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      report.recommendations.forEach(rec => {
        console.log('   ' + rec.priority.toUpperCase() + ': ' + rec.suggestion);
      });
    }
  });
  
  suite.runFullBenchmarkSuite()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Benchmark suite failed:', error);
      process.exit(1);
    });
}

/**
 * Benchmark Suite for MCP WebScraper
 * Compares performance before/after optimizations and identifies bottlenecks
 */

import { performance } from 'perf_hooks';
import { Worker } from 'worker_threads';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PerformanceManager } from '../../src/core/PerformanceManager.js';
import { QueueManager } from '../../src/core/queue/QueueManager.js';
import { WorkerPool } from '../../src/core/workers/WorkerPool.js';
import { ConnectionPool } from '../../src/core/connections/ConnectionPool.js';
import { StreamProcessor } from '../../src/core/processing/StreamProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Benchmark Configuration
 */
const BENCHMARK_CONFIG = {
  // Performance baselines
  baselines: {
    responseTime: {
      p50: 1000, // 1 second
      p95: 3000, // 3 seconds
      p99: 5000  // 5 seconds
    },
    throughput: {
      requestsPerSecond: 10,
      operationsPerSecond: 50
    },
    memory: {
      peakUsage: 256 * 1024 * 1024, // 256MB
      averageUsage: 128 * 1024 * 1024 // 128MB
    },
    cpu: {
      averageUtilization: 0.7, // 70%
      peakUtilization: 0.9 // 90%
    }
  },
  
  // Benchmark scenarios
  scenarios: {
    // Single operation benchmarks
    singleOperation: {
      iterations: 100,
      operations: ['fetchUrl', 'extractText', 'extractLinks', 'searchWeb']
    },
    
    // Concurrent operation benchmarks
    concurrentOperations: {
      concurrencyLevels: [1, 5, 10, 20, 50],
      operationsPerLevel: 50,
      timeout: 30000
    },
    
    // Component comparison benchmarks
    componentComparison: {
      components: ['queue', 'worker', 'connection', 'stream'],
      tasksPerComponent: 25,
      taskTypes: ['cpu-intensive', 'io-intensive', 'memory-intensive']
    },
    
    // Optimization impact benchmarks
    optimizationImpact: {
      scenarios: ['before-optimization', 'after-optimization'],
      iterations: 50,
      warmupIterations: 10
    }
  },
  
  // Test data configurations
  testData: {
    small: { size: 1024, count: 100 }, // 1KB x 100
    medium: { size: 10240, count: 50 }, // 10KB x 50
    large: { size: 102400, count: 10 }, // 100KB x 10
    xlarge: { size: 1048576, count: 5 } // 1MB x 5
  }
};

/**
 * Performance Benchmark Runner
 */
class BenchmarkRunner {
  constructor() {
    this.results = new Map();
    this.baselines = new Map();
    this.performanceManager = null;
    this.components = new Map();
  }

  /**
   * Initialize benchmark environment
   */
  async initialize() {
    console.log('🔧 Initializing Benchmark Environment...');
    
    this.performanceManager = new PerformanceManager({
      enableMetrics: true,
      metricsInterval: 1000
    });
    
    // Initialize individual components for comparison
    this.components.set('queue', new QueueManager({ concurrency: 10 }));
    this.components.set('worker', new WorkerPool({ maxWorkers: 5 }));
    this.components.set('connection', new ConnectionPool({ maxSockets: 20 }));
    this.components.set('stream', new StreamProcessor({ chunkSize: 1000 }));
    
    console.log('✅ Benchmark environment initialized');
  }

  /**
   * Run comprehensive benchmark suite
   */
  async runBenchmarks() {
    console.log('📊 Starting Comprehensive Benchmark Suite...');
    console.log('─'.repeat(60));
    
    await this.initialize();
    
    try {
      // Baseline performance measurement
      console.log('📏 Measuring baseline performance...');
      this.results.set('baseline', await this.measureBaseline());
      
      // Single operation benchmarks
      console.log('\n🎯 Running single operation benchmarks...');
      this.results.set('singleOperation', await this.benchmarkSingleOperations());
      
      // Concurrent operation benchmarks
      console.log('\n⚡ Running concurrent operation benchmarks...');
      this.results.set('concurrentOperations', await this.benchmarkConcurrentOperations());
      
      // Component comparison benchmarks
      console.log('\n🏆 Running component comparison benchmarks...');
      this.results.set('componentComparison', await this.benchmarkComponentComparison());
      
      // Bottleneck identification
      console.log('\n🔍 Identifying performance bottlenecks...');
      this.results.set('bottleneckAnalysis', await this.identifyBottlenecks());
      
      // Optimization impact assessment
      console.log('\n📈 Assessing optimization impact...');
      this.results.set('optimizationImpact', await this.assessOptimizationImpact());
      
      // Generate comprehensive report
      const report = this.generateBenchmarkReport();
      await this.saveReport(report);
      
      return report;
      
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Measure baseline performance metrics
   */
  async measureBaseline() {
    const baseline = {
      timestamp: Date.now(),
      system: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        uptime: process.uptime()
      },
      responseTime: { samples: [] },
      throughput: { samples: [] },
      errors: 0
    };
    
    // Warmup
    await this.warmupSystem();
    
    // Measure response times
    const iterations = 50;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      try {
        await this.performanceManager.executeTask('fetchUrl', {
          url: 'https://httpbin.org/delay/0.1'
        }, { timeout: 5000 });
        
        const duration = performance.now() - start;
        baseline.responseTime.samples.push(duration);
      } catch (error) {
        baseline.errors++;
      }
      
      await this.delay(100);
    }
    
    // Calculate statistics
    baseline.responseTime.stats = this.calculateStatistics(baseline.responseTime.samples);
    baseline.responseTime.percentiles = this.calculatePercentiles(baseline.responseTime.samples);
    
    return baseline;
  }

  /**
   * Benchmark single operations
   */
  async benchmarkSingleOperations() {
    const results = new Map();
    const config = BENCHMARK_CONFIG.scenarios.singleOperation;
    
    for (const operation of config.operations) {
      console.log(`   Benchmarking ${operation}...`);
      
      const operationResults = {
        operation,
        iterations: config.iterations,
        measurements: [],
        errors: 0
      };
      
      // Warmup
      await this.warmupOperation(operation);
      
      for (let i = 0; i < config.iterations; i++) {
        const measurement = await this.measureSingleOperation(operation);
        operationResults.measurements.push(measurement);
        
        if (measurement.error) {
          operationResults.errors++;
        }
        
        await this.delay(50);
      }
      
      // Calculate statistics
      const durations = operationResults.measurements
        .filter(m => !m.error)
        .map(m => m.duration);
      
      operationResults.statistics = {
        count: durations.length,
        stats: this.calculateStatistics(durations),
        percentiles: this.calculatePercentiles(durations),
        errorRate: operationResults.errors / config.iterations
      };
      
      results.set(operation, operationResults);
    }
    
    return Object.fromEntries(results);
  }

  /**
   * Benchmark concurrent operations
   */
  async benchmarkConcurrentOperations() {
    const results = new Map();
    const config = BENCHMARK_CONFIG.scenarios.concurrentOperations;
    
    for (const concurrency of config.concurrencyLevels) {
      console.log(`   Testing concurrency level: ${concurrency}`);
      
      const concurrencyResult = {
        concurrency,
        operationsPerLevel: config.operationsPerLevel,
        measurements: [],
        systemMetrics: []
      };
      
      const startTime = performance.now();
      const startMemory = process.memoryUsage();
      const startCpu = process.cpuUsage();
      
      // Launch concurrent operations
      const promises = [];
      for (let i = 0; i < config.operationsPerLevel; i++) {
        const operationPromises = [];
        
        for (let c = 0; c < concurrency; c++) {
          const operation = config.operations?.[c % 4] || 'fetchUrl';
          operationPromises.push(this.measureSingleOperation(operation));
        }
        
        promises.push(Promise.all(operationPromises));
        
        // Small delay between batches
        await this.delay(10);
      }
      
      // Wait for all operations to complete
      const results = await Promise.all(promises);
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      const endCpu = process.cpuUsage(startCpu);
      
      // Flatten results
      concurrencyResult.measurements = results.flat();
      
      // Calculate metrics
      const durations = concurrencyResult.measurements
        .filter(m => !m.error)
        .map(m => m.duration);
      
      concurrencyResult.performance = {
        totalDuration: endTime - startTime,
        throughput: concurrencyResult.measurements.length / ((endTime - startTime) / 1000),
        responseTime: {
          stats: this.calculateStatistics(durations),
          percentiles: this.calculatePercentiles(durations)
        },
        errorRate: concurrencyResult.measurements.filter(m => m.error).length / concurrencyResult.measurements.length
      };
      
      concurrencyResult.systemMetrics = {
        memory: {
          start: startMemory,
          end: endMemory,
          delta: endMemory.heapUsed - startMemory.heapUsed
        },
        cpu: {
          user: endCpu.user,
          system: endCpu.system,
          total: endCpu.user + endCpu.system
        }
      };
      
      results.set(concurrency, concurrencyResult);
    }
    
    return Object.fromEntries(results);
  }

  /**
   * Benchmark component comparison
   */
  async benchmarkComponentComparison() {
    const results = new Map();
    const config = BENCHMARK_CONFIG.scenarios.componentComparison;
    
    for (const component of config.components) {
      console.log(`   Benchmarking ${component} component...`);
      
      const componentResults = {
        component,
        taskTypes: new Map()
      };
      
      for (const taskType of config.taskTypes) {
        console.log(`     Task type: ${taskType}`);
        
        const taskResults = {
          taskType,
          measurements: [],
          errors: 0
        };
        
        for (let i = 0; i < config.tasksPerComponent; i++) {
          const measurement = await this.measureComponentTask(component, taskType);
          taskResults.measurements.push(measurement);
          
          if (measurement.error) {
            taskResults.errors++;
          }
          
          await this.delay(20);
        }
        
        // Calculate statistics
        const durations = taskResults.measurements
          .filter(m => !m.error)
          .map(m => m.duration);
        
        taskResults.statistics = {
          count: durations.length,
          stats: this.calculateStatistics(durations),
          percentiles: this.calculatePercentiles(durations),
          errorRate: taskResults.errors / config.tasksPerComponent
        };
        
        componentResults.taskTypes.set(taskType, taskResults);
      }
      
      results.set(component, {
        ...componentResults,
        taskTypes: Object.fromEntries(componentResults.taskTypes)
      });
    }
    
    return Object.fromEntries(results);
  }

  /**
   * Identify performance bottlenecks
   */
  async identifyBottlenecks() {
    console.log('   Analyzing performance bottlenecks...');
    
    const bottlenecks = {
      responseTime: [],
      throughput: [],
      memory: [],
      cpu: [],
      components: []
    };
    
    // Analyze response time bottlenecks
    const singleOpResults = this.results.get('singleOperation');
    if (singleOpResults) {
      for (const [operation, results] of Object.entries(singleOpResults)) {
        const p95 = results.statistics?.percentiles?.p95 || 0;
        if (p95 > BENCHMARK_CONFIG.baselines.responseTime.p95) {
          bottlenecks.responseTime.push({
            operation,
            p95ResponseTime: p95,
            severity: this.calculateSeverity(p95, BENCHMARK_CONFIG.baselines.responseTime.p95)
          });
        }
      }
    }
    
    // Analyze throughput bottlenecks
    const concurrentResults = this.results.get('concurrentOperations');
    if (concurrentResults) {
      for (const [concurrency, results] of Object.entries(concurrentResults)) {
        const throughput = results.performance?.throughput || 0;
        if (throughput < BENCHMARK_CONFIG.baselines.throughput.requestsPerSecond) {
          bottlenecks.throughput.push({
            concurrency: parseInt(concurrency),
            throughput,
            severity: this.calculateSeverity(
              BENCHMARK_CONFIG.baselines.throughput.requestsPerSecond,
              throughput
            )
          });
        }
      }
    }
    
    // Analyze component performance
    const componentResults = this.results.get('componentComparison');
    if (componentResults) {
      const componentPerformance = new Map();
      
      for (const [component, results] of Object.entries(componentResults)) {
        const avgPerformance = Object.values(results.taskTypes)
          .map(task => task.statistics?.stats?.mean || Infinity)
          .reduce((sum, val) => sum + val, 0) / Object.keys(results.taskTypes).length;
        
        componentPerformance.set(component, avgPerformance);
      }
      
      // Find slowest components
      const sortedComponents = Array.from(componentPerformance.entries())
        .sort((a, b) => b[1] - a[1]);
      
      const slowestComponent = sortedComponents[0];
      const fastestComponent = sortedComponents[sortedComponents.length - 1];
      
      if (slowestComponent[1] > fastestComponent[1] * 2) {
        bottlenecks.components.push({
          component: slowestComponent[0],
          avgDuration: slowestComponent[1],
          relativePerformance: slowestComponent[1] / fastestComponent[1],
          severity: 'HIGH'
        });
      }
    }
    
    return {
      summary: {
        totalBottlenecks: Object.values(bottlenecks).reduce((sum, arr) => sum + arr.length, 0),
        criticalBottlenecks: Object.values(bottlenecks)
          .flat()
          .filter(b => b.severity === 'CRITICAL').length
      },
      details: bottlenecks,
      recommendations: this.generateBottleneckRecommendations(bottlenecks)
    };
  }

  /**
   * Assess optimization impact
   */
  async assessOptimizationImpact() {
    console.log('   Assessing optimization impact...');
    
    const config = BENCHMARK_CONFIG.scenarios.optimizationImpact;
    const results = {
      scenarios: new Map(),
      comparison: {}
    };
    
    for (const scenario of config.scenarios) {
      console.log(`     Running ${scenario} scenario...`);
      
      const scenarioResults = {
        scenario,
        iterations: config.iterations,
        measurements: []
      };
      
      // Warmup
      for (let i = 0; i < config.warmupIterations; i++) {
        await this.measureOptimizationScenario(scenario);
      }
      
      // Actual measurements
      for (let i = 0; i < config.iterations; i++) {
        const measurement = await this.measureOptimizationScenario(scenario);
        scenarioResults.measurements.push(measurement);
        await this.delay(50);
      }
      
      // Calculate statistics
      const durations = scenarioResults.measurements
        .filter(m => !m.error)
        .map(m => m.duration);
      
      scenarioResults.statistics = {
        count: durations.length,
        stats: this.calculateStatistics(durations),
        percentiles: this.calculatePercentiles(durations)
      };
      
      results.scenarios.set(scenario, scenarioResults);
    }
    
    // Calculate improvement
    const beforeResults = results.scenarios.get('before-optimization');
    const afterResults = results.scenarios.get('after-optimization');
    
    if (beforeResults && afterResults) {
      const beforeMean = beforeResults.statistics.stats.mean;
      const afterMean = afterResults.statistics.stats.mean;
      
      results.comparison = {
        improvement: {
          absolute: beforeMean - afterMean,
          percentage: ((beforeMean - afterMean) / beforeMean) * 100
        },
        significanceTest: this.performSignificanceTest(
          beforeResults.measurements.map(m => m.duration),
          afterResults.measurements.map(m => m.duration)
        )
      };
    }
    
    return {
      ...results,
      scenarios: Object.fromEntries(results.scenarios)
    };
  }

  /**
   * Measure single operation performance
   */
  async measureSingleOperation(operation) {
    const start = performance.now();
    const startMemory = process.memoryUsage();
    
    try {
      const testData = this.generateTestData(operation);
      const result = await this.performanceManager.executeTask(operation, testData, {
        timeout: 10000
      });
      
      const end = performance.now();
      const endMemory = process.memoryUsage();
      
      return {
        operation,
        duration: end - start,
        memoryDelta: endMemory.heapUsed - startMemory.heapUsed,
        success: true,
        resultSize: this.estimateSize(result)
      };
      
    } catch (error) {
      const end = performance.now();
      
      return {
        operation,
        duration: end - start,
        error: error.message,
        success: false
      };
    }
  }

  /**
   * Measure component-specific task performance
   */
  async measureComponentTask(component, taskType) {
    const start = performance.now();
    
    try {
      const componentInstance = this.components.get(component);
      const testData = this.generateTestDataForTaskType(taskType);
      
      let result;
      switch (component) {
        case 'queue':
          result = await componentInstance.add(() => this.simulateTask(taskType, testData));
          break;
        case 'worker':
          result = await componentInstance.execute(taskType, testData);
          break;
        case 'connection':
          result = await componentInstance.request(testData);
          break;
        case 'stream':
          result = await componentInstance.processStream([testData], item => item);
          break;
        default:
          throw new Error(`Unknown component: ${component}`);
      }
      
      const end = performance.now();
      
      return {
        component,
        taskType,
        duration: end - start,
        success: true,
        resultSize: this.estimateSize(result)
      };
      
    } catch (error) {
      const end = performance.now();
      
      return {
        component,
        taskType,
        duration: end - start,
        error: error.message,
        success: false
      };
    }
  }

  /**
   * Measure optimization scenario performance
   */
  async measureOptimizationScenario(scenario) {
    const start = performance.now();
    
    try {
      // Simulate different optimization scenarios
      const config = scenario === 'before-optimization' 
        ? { useOptimizations: false, concurrency: 5 }
        : { useOptimizations: true, concurrency: 10 };
      
      const tasks = [];
      for (let i = 0; i < config.concurrency; i++) {
        tasks.push(this.performanceManager.executeTask('fetchUrl', {
          url: `https://httpbin.org/delay/0.${Math.floor(Math.random() * 5)}`
        }));
      }
      
      await Promise.all(tasks);
      
      const end = performance.now();
      
      return {
        scenario,
        duration: end - start,
        success: true
      };
      
    } catch (error) {
      const end = performance.now();
      
      return {
        scenario,
        duration: end - start,
        error: error.message,
        success: false
      };
    }
  }

  /**
   * Generate test data for operations
   */
  generateTestData(operation) {
    const testUrls = [
      'https://httpbin.org/json',
      'https://httpbin.org/html',
      'https://httpbin.org/delay/0.1',
      'https://example.com'
    ];
    
    switch (operation) {
      case 'fetchUrl':
        return { url: testUrls[Math.floor(Math.random() * testUrls.length)] };
      case 'extractText':
        return { url: 'https://httpbin.org/html' };
      case 'extractLinks':
        return { url: 'https://httpbin.org/links/5' };
      case 'searchWeb':
        return { query: 'test query', limit: 5 };
      default:
        return { url: testUrls[0] };
    }
  }

  /**
   * Generate test data for specific task types
   */
  generateTestDataForTaskType(taskType) {
    switch (taskType) {
      case 'cpu-intensive':
        return { data: new Array(10000).fill(Math.random()) };
      case 'io-intensive':
        return { url: 'https://httpbin.org/delay/0.1' };
      case 'memory-intensive':
        return { data: Buffer.alloc(1024 * 1024) }; // 1MB buffer
      default:
        return { data: 'test' };
    }
  }

  /**
   * Simulate a task for component testing
   */
  async simulateTask(taskType, testData) {
    switch (taskType) {
      case 'cpu-intensive':
        // Simulate CPU-intensive work
        const array = testData.data || new Array(1000).fill(Math.random());
        return array.reduce((sum, val) => sum + val, 0);
        
      case 'io-intensive':
        // Simulate I/O work
        await this.delay(Math.random() * 100 + 50);
        return { status: 'completed', size: 1024 };
        
      case 'memory-intensive':
        // Simulate memory-intensive work
        const buffer = testData.data || Buffer.alloc(512 * 1024);
        return { processed: buffer.length };
        
      default:
        await this.delay(10);
        return { result: 'test' };
    }
  }

  /**
   * Calculate statistics for a set of values
   */
  calculateStatistics(values) {
    if (values.length === 0) return { mean: 0, min: 0, max: 0, stdDev: 0 };
    
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    
    return {
      mean,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      stdDev: Math.sqrt(variance),
      median: sorted[Math.floor(sorted.length / 2)]
    };
  }

  /**
   * Calculate percentiles for a set of values
   */
  calculatePercentiles(values, percentiles = [50, 75, 90, 95, 99]) {
    if (values.length === 0) return {};
    
    const sorted = [...values].sort((a, b) => a - b);
    const result = {};
    
    for (const p of percentiles) {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      result[`p${p}`] = sorted[Math.max(0, index)];
    }
    
    return result;
  }

  /**
   * Calculate severity level
   */
  calculateSeverity(actual, baseline) {
    const ratio = actual / baseline;
    
    if (ratio > 3) return 'CRITICAL';
    if (ratio > 2) return 'HIGH';
    if (ratio > 1.5) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Generate bottleneck recommendations
   */
  generateBottleneckRecommendations(bottlenecks) {
    const recommendations = [];
    
    if (bottlenecks.responseTime.length > 0) {
      recommendations.push('Optimize slow operations by implementing caching or parallel processing');
    }
    
    if (bottlenecks.throughput.length > 0) {
      recommendations.push('Increase concurrency limits and optimize resource utilization');
    }
    
    if (bottlenecks.components.length > 0) {
      const slowComponent = bottlenecks.components[0]?.component;
      recommendations.push(`Optimize ${slowComponent} component implementation`);
    }
    
    if (recommendations.length === 0) {
      recommendations.push('No significant bottlenecks detected');
    }
    
    return recommendations;
  }

  /**
   * Perform statistical significance test
   */
  performSignificanceTest(before, after) {
    // Simple t-test implementation
    const meanBefore = before.reduce((sum, val) => sum + val, 0) / before.length;
    const meanAfter = after.reduce((sum, val) => sum + val, 0) / after.length;
    
    const varBefore = before.reduce((sum, val) => sum + Math.pow(val - meanBefore, 2), 0) / (before.length - 1);
    const varAfter = after.reduce((sum, val) => sum + Math.pow(val - meanAfter, 2), 0) / (after.length - 1);
    
    const pooledVar = ((before.length - 1) * varBefore + (after.length - 1) * varAfter) / 
                     (before.length + after.length - 2);
    
    const standardError = Math.sqrt(pooledVar * (1/before.length + 1/after.length));
    const tStat = (meanBefore - meanAfter) / standardError;
    
    return {
      tStatistic: tStat,
      significant: Math.abs(tStat) > 2.0, // Rough approximation for p < 0.05
      meanDifference: meanBefore - meanAfter
    };
  }

  /**
   * Estimate object size
   */
  estimateSize(obj) {
    if (typeof obj === 'string') {
      return Buffer.byteLength(obj, 'utf8');
    } else if (obj && typeof obj === 'object') {
      return Buffer.byteLength(JSON.stringify(obj), 'utf8');
    }
    return 0;
  }

  /**
   * Warmup system for accurate measurements
   */
  async warmupSystem() {
    console.log('   Warming up system...');
    
    for (let i = 0; i < 10; i++) {
      await this.performanceManager.executeTask('fetchUrl', {
        url: 'https://httpbin.org/json'
      });
      await this.delay(50);
    }
  }

  /**
   * Warmup specific operation
   */
  async warmupOperation(operation) {
    for (let i = 0; i < 5; i++) {
      const testData = this.generateTestData(operation);
      try {
        await this.performanceManager.executeTask(operation, testData);
      } catch (error) {
        // Ignore warmup errors
      }
      await this.delay(20);
    }
  }

  /**
   * Generate comprehensive benchmark report
   */
  generateBenchmarkReport() {
    const timestamp = new Date().toISOString();
    const allResults = Object.fromEntries(this.results);
    
    return {
      timestamp,
      configuration: BENCHMARK_CONFIG,
      results: allResults,
      summary: this.generateBenchmarkSummary(allResults),
      analysis: this.analyzeBenchmarkResults(allResults),
      recommendations: this.generateBenchmarkRecommendations(allResults)
    };
  }

  /**
   * Generate benchmark summary
   */
  generateBenchmarkSummary(results) {
    const summary = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      averageResponseTime: 0,
      peakThroughput: 0,
      bottlenecksFound: 0,
      optimizationImpact: 0
    };
    
    // Count tests from single operations
    if (results.singleOperation) {
      const operations = Object.values(results.singleOperation);
      summary.totalTests += operations.length;
      summary.passedTests += operations.filter(op => op.statistics?.errorRate < 0.1).length;
      summary.averageResponseTime = operations.reduce((sum, op) => 
        sum + (op.statistics?.stats?.mean || 0), 0) / operations.length;
    }
    
    // Get peak throughput from concurrent operations
    if (results.concurrentOperations) {
      const throughputs = Object.values(results.concurrentOperations)
        .map(op => op.performance?.throughput || 0);
      summary.peakThroughput = Math.max(...throughputs);
    }
    
    // Count bottlenecks
    if (results.bottleneckAnalysis) {
      summary.bottlenecksFound = results.bottleneckAnalysis.summary?.totalBottlenecks || 0;
    }
    
    // Calculate optimization impact
    if (results.optimizationImpact?.comparison?.improvement) {
      summary.optimizationImpact = results.optimizationImpact.comparison.improvement.percentage;
    }
    
    summary.failedTests = summary.totalTests - summary.passedTests;
    
    return summary;
  }

  /**
   * Analyze benchmark results
   */
  analyzeBenchmarkResults(results) {
    const analysis = {
      status: 'PASS',
      issues: [],
      highlights: []
    };
    
    // Check response times
    if (results.singleOperation) {
      const slowOperations = Object.entries(results.singleOperation)
        .filter(([_, op]) => (op.statistics?.percentiles?.p95 || 0) > BENCHMARK_CONFIG.baselines.responseTime.p95);
      
      if (slowOperations.length > 0) {
        analysis.status = 'WARNING';
        analysis.issues.push(`Slow operations detected: ${slowOperations.map(([name]) => name).join(', ')}`);
      } else {
        analysis.highlights.push('All operations meet response time targets');
      }
    }
    
    // Check throughput
    if (results.concurrentOperations) {
      const lowThroughput = Object.values(results.concurrentOperations)
        .some(op => (op.performance?.throughput || 0) < BENCHMARK_CONFIG.baselines.throughput.requestsPerSecond);
      
      if (lowThroughput) {
        analysis.status = 'WARNING';
        analysis.issues.push('Low throughput detected at some concurrency levels');
      } else {
        analysis.highlights.push('Throughput targets met across all concurrency levels');
      }
    }
    
    // Check bottlenecks
    if (results.bottleneckAnalysis?.summary?.criticalBottlenecks > 0) {
      analysis.status = 'FAIL';
      analysis.issues.push(`${results.bottleneckAnalysis.summary.criticalBottlenecks} critical bottlenecks found`);
    }
    
    // Check optimization impact
    if (results.optimizationImpact?.comparison?.improvement?.percentage > 0) {
      analysis.highlights.push(`Performance improvements of ${results.optimizationImpact.comparison.improvement.percentage.toFixed(1)}% achieved`);
    }
    
    return analysis;
  }

  /**
   * Generate benchmark recommendations
   */
  generateBenchmarkRecommendations(results) {
    const recommendations = [];
    
    // Based on bottleneck analysis
    if (results.bottleneckAnalysis?.recommendations) {
      recommendations.push(...results.bottleneckAnalysis.recommendations);
    }
    
    // Based on component comparison
    if (results.componentComparison) {
      const componentPerformances = Object.entries(results.componentComparison)
        .map(([component, data]) => {
          const avgPerformance = Object.values(data.taskTypes)
            .reduce((sum, task) => sum + (task.statistics?.stats?.mean || 0), 0) / 
            Object.keys(data.taskTypes).length;
          return { component, performance: avgPerformance };
        })
        .sort((a, b) => b.performance - a.performance);
      
      if (componentPerformances.length > 1) {
        const slowest = componentPerformances[0];
        const fastest = componentPerformances[componentPerformances.length - 1];
        
        if (slowest.performance > fastest.performance * 2) {
          recommendations.push(`Consider optimizing ${slowest.component} component performance`);
        }
      }
    }
    
    // Based on optimization impact
    if (results.optimizationImpact?.comparison?.improvement?.percentage < 10) {
      recommendations.push('Current optimizations show limited impact; consider alternative approaches');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Performance is within acceptable parameters');
      recommendations.push('Continue monitoring for regression detection');
    }
    
    return recommendations;
  }

  /**
   * Save benchmark report to file
   */
  async saveReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `benchmark-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📄 Benchmark report saved: ${filepath}`);
    } catch (error) {
      console.error('❌ Failed to save report:', error.message);
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.performanceManager) {
      await this.performanceManager.shutdown();
    }
    
    for (const [name, component] of this.components) {
      if (component.shutdown) {
        await component.shutdown();
      }
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
 * Main benchmark execution
 */
async function runBenchmarks() {
  console.log('🚀 Starting Comprehensive Benchmark Suite...');
  
  const benchmarkRunner = new BenchmarkRunner();
  
  try {
    const report = await benchmarkRunner.runBenchmarks();
    
    console.log('\n📋 Benchmark Summary:');
    console.log('─'.repeat(60));
    console.log(`✅ Status: ${report.analysis.status}`);
    console.log(`📊 Total Tests: ${report.summary.totalTests}`);
    console.log(`🎯 Passed: ${report.summary.passedTests}`);
    console.log(`❌ Failed: ${report.summary.failedTests}`);
    console.log(`⚡ Peak Throughput: ${report.summary.peakThroughput.toFixed(2)} req/s`);
    console.log(`⏱️ Avg Response Time: ${report.summary.averageResponseTime.toFixed(2)}ms`);
    console.log(`🔍 Bottlenecks Found: ${report.summary.bottlenecksFound}`);
    console.log(`📈 Optimization Impact: ${report.summary.optimizationImpact.toFixed(1)}%`);
    
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
    console.error('❌ Benchmark failed:', error);
    throw error;
  }
}

// Export for use in other test files
export { BenchmarkRunner, runBenchmarks };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runBenchmarks()
    .then(() => {
      console.log('✅ Benchmark completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Benchmark failed:', error);
      process.exit(1);
    });
}
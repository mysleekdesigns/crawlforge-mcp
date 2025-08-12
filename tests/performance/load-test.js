/**
 * Load Testing Suite for MCP WebScraper
 * Tests 100+ concurrent requests with performance metrics
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';
import { PerformanceManager } from '../../src/core/PerformanceManager.js';
import { config } from '../../src/constants/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load Test Configuration
 */
const LOAD_TEST_CONFIG = {
  concurrentRequests: 150,
  testDurationMs: 60000, // 1 minute
  rampUpTimeMs: 10000, // 10 seconds
  coolDownTimeMs: 5000, // 5 seconds
  maxRequestsPerSecond: 50,
  reportInterval: 5000, // Report every 5 seconds
  
  // Test scenarios
  scenarios: {
    fetchUrl: { weight: 30, timeout: 10000 },
    extractText: { weight: 25, timeout: 15000 },
    extractLinks: { weight: 20, timeout: 12000 },
    searchWeb: { weight: 15, timeout: 20000 },
    crawlDeep: { weight: 10, timeout: 30000 }
  },
  
  // Test URLs for different load patterns
  testUrls: [
    'https://httpbin.org/delay/1',
    'https://httpbin.org/html',
    'https://httpbin.org/json',
    'https://example.com',
    'https://wikipedia.org/wiki/Web_scraping',
    'https://news.ycombinator.com',
    'https://github.com/microsoft/TypeScript'
  ]
};

/**
 * Performance Metrics Collector
 */
class LoadTestMetrics {
  constructor() {
    this.reset();
  }

  reset() {
    this.startTime = performance.now();
    this.requests = {
      total: 0,
      successful: 0,
      failed: 0,
      timeout: 0
    };
    
    this.responseTime = {
      min: Infinity,
      max: 0,
      sum: 0,
      samples: [],
      percentiles: {}
    };
    
    this.throughput = {
      requestsPerSecond: 0,
      bytesPerSecond: 0,
      totalBytes: 0
    };
    
    this.errors = new Map();
    this.memoryUsage = [];
    this.cpuUsage = [];
    
    this.intervals = [];
  }

  recordRequest(startTime, endTime, success, error, dataSize = 0) {
    const duration = endTime - startTime;
    
    this.requests.total++;
    if (success) {
      this.requests.successful++;
    } else {
      this.requests.failed++;
      if (error?.name === 'TimeoutError') {
        this.requests.timeout++;
      }
      
      // Track error types
      const errorType = error?.name || 'Unknown';
      this.errors.set(errorType, (this.errors.get(errorType) || 0) + 1);
    }
    
    // Response time metrics
    this.responseTime.min = Math.min(this.responseTime.min, duration);
    this.responseTime.max = Math.max(this.responseTime.max, duration);
    this.responseTime.sum += duration;
    this.responseTime.samples.push(duration);
    
    // Throughput metrics
    this.throughput.totalBytes += dataSize;
  }

  recordSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    this.memoryUsage.push({
      timestamp: performance.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss
    });
    
    this.cpuUsage.push({
      timestamp: performance.now(),
      user: cpuUsage.user,
      system: cpuUsage.system
    });
  }

  calculatePercentiles() {
    if (this.responseTime.samples.length === 0) return;
    
    const sorted = [...this.responseTime.samples].sort((a, b) => a - b);
    const percentiles = [50, 75, 90, 95, 99];
    
    for (const p of percentiles) {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      this.responseTime.percentiles[`p${p}`] = sorted[index] || 0;
    }
  }

  calculateThroughput() {
    const elapsedSeconds = (performance.now() - this.startTime) / 1000;
    this.throughput.requestsPerSecond = this.requests.total / elapsedSeconds;
    this.throughput.bytesPerSecond = this.throughput.totalBytes / elapsedSeconds;
  }

  getReport() {
    this.calculatePercentiles();
    this.calculateThroughput();
    
    const avgResponseTime = this.responseTime.samples.length > 0 
      ? this.responseTime.sum / this.responseTime.samples.length 
      : 0;
    
    const successRate = this.requests.total > 0 
      ? (this.requests.successful / this.requests.total) * 100 
      : 0;
    
    return {
      summary: {
        totalRequests: this.requests.total,
        successfulRequests: this.requests.successful,
        failedRequests: this.requests.failed,
        timeoutRequests: this.requests.timeout,
        successRate: Number(successRate.toFixed(2)),
        averageResponseTime: Number(avgResponseTime.toFixed(2)),
        throughputRPS: Number(this.throughput.requestsPerSecond.toFixed(2)),
        throughputBPS: Number(this.throughput.bytesPerSecond.toFixed(2))
      },
      responseTime: {
        min: this.responseTime.min === Infinity ? 0 : this.responseTime.min,
        max: this.responseTime.max,
        average: avgResponseTime,
        percentiles: this.responseTime.percentiles
      },
      errors: Object.fromEntries(this.errors),
      memory: {
        peak: Math.max(...this.memoryUsage.map(m => m.heapUsed)),
        average: this.memoryUsage.reduce((sum, m) => sum + m.heapUsed, 0) / this.memoryUsage.length || 0,
        final: this.memoryUsage[this.memoryUsage.length - 1]?.heapUsed || 0
      }
    };
  }
}

/**
 * Load Test Runner
 */
class LoadTestRunner {
  constructor(performanceManager) {
    this.performanceManager = performanceManager;
    this.metrics = new LoadTestMetrics();
    this.activeRequests = new Set();
    this.isRunning = false;
    this.requestCounter = 0;
  }

  /**
   * Run comprehensive load test
   */
  async runLoadTest() {
    console.log('🚀 Starting Load Test Suite...');
    console.log(`Configuration: ${LOAD_TEST_CONFIG.concurrentRequests} concurrent requests`);
    console.log(`Duration: ${LOAD_TEST_CONFIG.testDurationMs / 1000}s`);
    console.log('─'.repeat(60));
    
    this.metrics.reset();
    this.isRunning = true;
    
    // Start system monitoring
    const monitoringInterval = setInterval(() => {
      this.metrics.recordSystemMetrics();
    }, 1000);
    
    // Start reporting
    const reportingInterval = setInterval(() => {
      this.printInterimReport();
    }, LOAD_TEST_CONFIG.reportInterval);
    
    try {
      // Ramp up phase
      await this.rampUpPhase();
      
      // Sustained load phase
      await this.sustainedLoadPhase();
      
      // Cool down phase
      await this.coolDownPhase();
      
      // Wait for all requests to complete
      await this.waitForCompletion();
      
    } finally {
      this.isRunning = false;
      clearInterval(monitoringInterval);
      clearInterval(reportingInterval);
    }
    
    // Generate final report
    const report = this.generateFinalReport();
    await this.saveReport(report);
    
    return report;
  }

  /**
   * Gradual ramp-up of concurrent requests
   */
  async rampUpPhase() {
    console.log('📈 Ramp-up phase starting...');
    
    const rampUpSteps = 10;
    const stepDuration = LOAD_TEST_CONFIG.rampUpTimeMs / rampUpSteps;
    const requestsPerStep = Math.ceil(LOAD_TEST_CONFIG.concurrentRequests / rampUpSteps);
    
    for (let step = 1; step <= rampUpSteps; step++) {
      const requestsToLaunch = Math.min(requestsPerStep, 
        LOAD_TEST_CONFIG.concurrentRequests - (step - 1) * requestsPerStep);
      
      // Launch requests for this step
      for (let i = 0; i < requestsToLaunch; i++) {
        this.launchRequest();
        await this.delay(50); // Small delay between requests
      }
      
      console.log(`   Step ${step}: ${requestsToLaunch} requests launched`);
      await this.delay(stepDuration);
    }
    
    console.log('✅ Ramp-up phase completed');
  }

  /**
   * Sustained load phase
   */
  async sustainedLoadPhase() {
    console.log('⚡ Sustained load phase starting...');
    
    const sustainedDuration = LOAD_TEST_CONFIG.testDurationMs - LOAD_TEST_CONFIG.rampUpTimeMs;
    const endTime = performance.now() + sustainedDuration;
    
    while (performance.now() < endTime && this.isRunning) {
      // Maintain target concurrency
      const currentConcurrency = this.activeRequests.size;
      const targetConcurrency = LOAD_TEST_CONFIG.concurrentRequests;
      
      if (currentConcurrency < targetConcurrency) {
        const requestsToLaunch = Math.min(
          targetConcurrency - currentConcurrency,
          LOAD_TEST_CONFIG.maxRequestsPerSecond / 10 // Throttle to prevent overwhelming
        );
        
        for (let i = 0; i < requestsToLaunch; i++) {
          this.launchRequest();
        }
      }
      
      await this.delay(100); // Check every 100ms
    }
    
    console.log('✅ Sustained load phase completed');
  }

  /**
   * Cool down phase - stop launching new requests
   */
  async coolDownPhase() {
    console.log('🌡️ Cool down phase starting...');
    
    // Stop launching new requests but wait for existing ones
    this.isRunning = false;
    
    await this.delay(LOAD_TEST_CONFIG.coolDownTimeMs);
    console.log('✅ Cool down phase completed');
  }

  /**
   * Wait for all active requests to complete
   */
  async waitForCompletion() {
    console.log('⏳ Waiting for remaining requests to complete...');
    
    const maxWaitTime = 30000; // 30 seconds max wait
    const startWait = performance.now();
    
    while (this.activeRequests.size > 0 && 
           (performance.now() - startWait) < maxWaitTime) {
      await this.delay(500);
      console.log(`   ${this.activeRequests.size} requests remaining...`);
    }
    
    if (this.activeRequests.size > 0) {
      console.log(`⚠️ ${this.activeRequests.size} requests did not complete within timeout`);
    } else {
      console.log('✅ All requests completed');
    }
  }

  /**
   * Launch a single test request
   */
  async launchRequest() {
    const requestId = ++this.requestCounter;
    const scenario = this.selectScenario();
    const testUrl = this.selectTestUrl();
    
    this.activeRequests.add(requestId);
    
    // Execute request without awaiting to maintain concurrency
    this.executeScenario(requestId, scenario, testUrl)
      .finally(() => {
        this.activeRequests.delete(requestId);
      });
  }

  /**
   * Select test scenario based on weights
   */
  selectScenario() {
    const scenarios = Object.entries(LOAD_TEST_CONFIG.scenarios);
    const totalWeight = scenarios.reduce((sum, [, config]) => sum + config.weight, 0);
    const random = Math.random() * totalWeight;
    
    let currentWeight = 0;
    for (const [scenarioName, config] of scenarios) {
      currentWeight += config.weight;
      if (random <= currentWeight) {
        return { name: scenarioName, ...config };
      }
    }
    
    return { name: 'fetchUrl', ...LOAD_TEST_CONFIG.scenarios.fetchUrl };
  }

  /**
   * Select test URL randomly
   */
  selectTestUrl() {
    const urls = LOAD_TEST_CONFIG.testUrls;
    return urls[Math.floor(Math.random() * urls.length)];
  }

  /**
   * Execute a specific test scenario
   */
  async executeScenario(requestId, scenario, testUrl) {
    const startTime = performance.now();
    let success = false;
    let error = null;
    let dataSize = 0;
    
    try {
      const result = await this.performanceManager.executeTask(
        scenario.name,
        { url: testUrl, requestId },
        { timeout: scenario.timeout }
      );
      
      success = true;
      dataSize = this.estimateDataSize(result);
      
    } catch (err) {
      error = err;
      success = false;
    }
    
    const endTime = performance.now();
    this.metrics.recordRequest(startTime, endTime, success, error, dataSize);
  }

  /**
   * Estimate data size from result
   */
  estimateDataSize(result) {
    if (typeof result === 'string') {
      return Buffer.byteLength(result, 'utf8');
    } else if (typeof result === 'object' && result !== null) {
      return Buffer.byteLength(JSON.stringify(result), 'utf8');
    }
    return 0;
  }

  /**
   * Print interim performance report
   */
  printInterimReport() {
    const report = this.metrics.getReport();
    
    console.log('\n📊 Interim Performance Report:');
    console.log(`   Requests: ${report.summary.totalRequests} total, ${report.summary.successfulRequests} successful (${report.summary.successRate}%)`);
    console.log(`   Response Time: ${report.responseTime.average.toFixed(2)}ms avg, ${report.responseTime.percentiles.p95 || 0}ms p95`);
    console.log(`   Throughput: ${report.summary.throughputRPS} req/s`);
    console.log(`   Active Requests: ${this.activeRequests.size}`);
    console.log(`   Memory: ${(report.memory.final / 1024 / 1024).toFixed(2)} MB`);
  }

  /**
   * Generate comprehensive final report
   */
  generateFinalReport() {
    const report = this.metrics.getReport();
    const pmStats = this.performanceManager.getMetrics();
    
    return {
      timestamp: new Date().toISOString(),
      configuration: LOAD_TEST_CONFIG,
      performance: report,
      performanceManager: pmStats,
      analysis: this.analyzeResults(report),
      recommendations: this.generateRecommendations(report)
    };
  }

  /**
   * Analyze test results and identify issues
   */
  analyzeResults(report) {
    const analysis = {
      status: 'PASS',
      issues: [],
      highlights: []
    };
    
    // Check success rate
    if (report.summary.successRate < 95) {
      analysis.status = 'FAIL';
      analysis.issues.push(`Low success rate: ${report.summary.successRate}% (target: ≥95%)`);
    } else {
      analysis.highlights.push(`Good success rate: ${report.summary.successRate}%`);
    }
    
    // Check response times
    if (report.responseTime.percentiles.p95 > 5000) {
      analysis.status = 'WARNING';
      analysis.issues.push(`High p95 response time: ${report.responseTime.percentiles.p95}ms (target: ≤5000ms)`);
    }
    
    // Check throughput
    if (report.summary.throughputRPS < 10) {
      analysis.status = 'WARNING';
      analysis.issues.push(`Low throughput: ${report.summary.throughputRPS} req/s (target: ≥10 req/s)`);
    } else {
      analysis.highlights.push(`Good throughput: ${report.summary.throughputRPS} req/s`);
    }
    
    // Check memory usage
    const memoryPeakMB = report.memory.peak / 1024 / 1024;
    if (memoryPeakMB > 512) {
      analysis.status = 'WARNING';
      analysis.issues.push(`High memory usage: ${memoryPeakMB.toFixed(2)} MB (target: ≤512 MB)`);
    } else {
      analysis.highlights.push(`Efficient memory usage: ${memoryPeakMB.toFixed(2)} MB`);
    }
    
    // Check error patterns
    if (Object.keys(report.errors).length > 0) {
      analysis.issues.push(`Error types detected: ${Object.keys(report.errors).join(', ')}`);
    }
    
    return analysis;
  }

  /**
   * Generate performance recommendations
   */
  generateRecommendations(report) {
    const recommendations = [];
    
    if (report.summary.successRate < 95) {
      recommendations.push('Investigate error causes and implement better error handling');
    }
    
    if (report.responseTime.percentiles.p95 > 5000) {
      recommendations.push('Optimize slow operations and consider increasing worker pool size');
    }
    
    if (report.summary.throughputRPS < 10) {
      recommendations.push('Increase concurrency limits and optimize bottlenecks');
    }
    
    const memoryPeakMB = report.memory.peak / 1024 / 1024;
    if (memoryPeakMB > 512) {
      recommendations.push('Implement memory optimization and garbage collection tuning');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Performance is within acceptable parameters');
    }
    
    return recommendations;
  }

  /**
   * Save report to file
   */
  async saveReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `load-test-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📄 Load test report saved: ${filepath}`);
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
 * Main test execution
 */
async function runLoadTests() {
  console.log('🔧 Initializing Performance Manager...');
  
  const performanceManager = new PerformanceManager({
    enableMetrics: true,
    metricsInterval: 5000
  });
  
  const loadTestRunner = new LoadTestRunner(performanceManager);
  
  try {
    const report = await loadTestRunner.runLoadTest();
    
    console.log('\n📋 Final Load Test Report:');
    console.log('─'.repeat(60));
    console.log(`✅ Status: ${report.analysis.status}`);
    console.log(`📊 Total Requests: ${report.performance.summary.totalRequests}`);
    console.log(`🎯 Success Rate: ${report.performance.summary.successRate}%`);
    console.log(`⚡ Throughput: ${report.performance.summary.throughputRPS} req/s`);
    console.log(`⏱️ Avg Response Time: ${report.performance.responseTime.average.toFixed(2)}ms`);
    console.log(`🧠 Peak Memory: ${(report.performance.memory.peak / 1024 / 1024).toFixed(2)} MB`);
    
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
    console.error('❌ Load test failed:', error);
    throw error;
  } finally {
    await performanceManager.shutdown();
  }
}

// Export for use in other test files
export { LoadTestRunner, LoadTestMetrics, runLoadTests };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runLoadTests()
    .then(() => {
      console.log('✅ Load test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Load test failed:', error);
      process.exit(1);
    });
}
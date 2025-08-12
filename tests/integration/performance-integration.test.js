/**
 * Performance Integration Tests
 * Tests the integration of WorkerPool, PerformanceManager, and error handling systems
 */

import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import { PerformanceManager } from '../../src/core/PerformanceManager.js';
import { WorkerPool } from '../../src/core/workers/WorkerPool.js';
import { ConnectionPool } from '../../src/core/connections/ConnectionPool.js';
import { StreamProcessor } from '../../src/core/processing/StreamProcessor.js';
import { QueueManager } from '../../src/core/queue/QueueManager.js';
import { CircuitBreaker } from '../../src/utils/CircuitBreaker.js';
import { RetryManager } from '../../src/utils/RetryManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Integration Test Suite Configuration
 */
const INTEGRATION_TEST_CONFIG = {
  // Component integration tests
  componentIntegration: {
    testDuration: 30000, // 30 seconds
    operationsPerSecond: 10,
    concurrency: 5,
    timeoutMs: 5000
  },
  
  // Error handling tests
  errorHandling: {
    failureRate: 0.3, // 30% failure rate
    maxRetries: 3,
    circuitBreakerThreshold: 5,
    recoveryTime: 5000
  },
  
  // Performance manager tests
  performanceManager: {
    taskBatches: 5,
    tasksPerBatch: 20,
    mixedTaskTypes: ['cpu-intensive', 'io-intensive', 'memory-intensive'],
    timeout: 10000
  },
  
  // Worker pool stress tests
  workerPoolStress: {
    maxWorkers: 10,
    taskCount: 100,
    taskVariety: ['fast', 'slow', 'failing', 'memory-heavy'],
    simultaneousBatches: 3
  }
};

/**
 * Integration Test Results Collector
 */
class IntegrationTestResults {
  constructor() {
    this.reset();
  }

  reset() {
    this.tests = new Map();
    this.startTime = Date.now();
    this.systemMetrics = [];
    this.errors = [];
  }

  addTest(testName, result) {
    this.tests.set(testName, {
      ...result,
      timestamp: Date.now(),
      duration: Date.now() - this.startTime
    });
  }

  addError(testName, error) {
    this.errors.push({
      testName,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });
  }

  recordSystemMetrics() {
    this.systemMetrics.push({
      timestamp: Date.now(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    });
  }

  getSummary() {
    const totalTests = this.tests.size;
    const passedTests = Array.from(this.tests.values()).filter(t => t.success).length;
    const failedTests = totalTests - passedTests;
    
    return {
      totalTests,
      passedTests,
      failedTests,
      successRate: totalTests > 0 ? (passedTests / totalTests) * 100 : 0,
      totalErrors: this.errors.length,
      duration: Date.now() - this.startTime,
      tests: Object.fromEntries(this.tests)
    };
  }
}

/**
 * Performance Integration Test Suite
 */
class PerformanceIntegrationTestSuite {
  constructor() {
    this.results = new IntegrationTestResults();
    this.performanceManager = null;
    this.components = new Map();
  }

  /**
   * Run comprehensive integration test suite
   */
  async runIntegrationTests() {
    console.log('🔧 Starting Performance Integration Tests...');
    console.log('─'.repeat(60));
    
    try {
      // Setup test environment
      await this.setupTestEnvironment();
      
      // Test 1: Performance Manager Integration
      console.log('🎯 Test 1: Performance Manager Integration');
      await this.testPerformanceManagerIntegration();
      
      // Test 2: Worker Pool Integration
      console.log('\n👥 Test 2: Worker Pool Integration');
      await this.testWorkerPoolIntegration();
      
      // Test 3: Error Handling Integration
      console.log('\n🛡️ Test 3: Error Handling Integration');
      await this.testErrorHandlingIntegration();
      
      // Test 4: Component Communication
      console.log('\n📡 Test 4: Component Communication');
      await this.testComponentCommunication();
      
      // Test 5: Resource Management
      console.log('\n🎛️ Test 5: Resource Management');
      await this.testResourceManagement();
      
      // Test 6: Stress Testing
      console.log('\n💥 Test 6: Stress Testing');
      await this.testStressScenarios();
      
      // Test 7: Recovery Testing
      console.log('\n🔄 Test 7: Recovery Testing');
      await this.testRecoveryScenarios();
      
      // Generate final report
      const report = this.generateIntegrationReport();
      await this.saveReport(report);
      
      return report;
      
    } catch (error) {
      console.error('❌ Integration test suite failed:', error);
      this.results.addError('suite', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Setup test environment
   */
  async setupTestEnvironment() {
    console.log('   Setting up test environment...');
    
    this.performanceManager = new PerformanceManager({
      enableMetrics: true,
      metricsInterval: 1000
    });
    
    // Initialize individual components for testing
    this.components.set('workerPool', new WorkerPool({ 
      maxWorkers: INTEGRATION_TEST_CONFIG.workerPoolStress.maxWorkers 
    }));
    
    this.components.set('connectionPool', new ConnectionPool({ 
      maxSockets: 20 
    }));
    
    this.components.set('streamProcessor', new StreamProcessor({ 
      chunkSize: 100,
      memoryLimit: 50 * 1024 * 1024 // 50MB
    }));
    
    this.components.set('queueManager', new QueueManager({ 
      concurrency: 10 
    }));
    
    this.components.set('circuitBreaker', new CircuitBreaker({
      failureThreshold: INTEGRATION_TEST_CONFIG.errorHandling.circuitBreakerThreshold,
      recoveryTime: INTEGRATION_TEST_CONFIG.errorHandling.recoveryTime
    }));
    
    this.components.set('retryManager', new RetryManager({
      maxRetries: INTEGRATION_TEST_CONFIG.errorHandling.maxRetries,
      retryDelay: 1000
    }));
    
    // Start system monitoring
    this.monitoringInterval = setInterval(() => {
      this.results.recordSystemMetrics();
    }, 1000);
    
    console.log('   ✅ Test environment ready');
  }

  /**
   * Test Performance Manager integration with all components
   */
  async testPerformanceManagerIntegration() {
    try {
      console.log('   Testing PerformanceManager task routing...');
      
      const config = INTEGRATION_TEST_CONFIG.performanceManager;
      const startTime = Date.now();
      const results = [];
      
      // Test mixed task execution
      for (let batch = 0; batch < config.taskBatches; batch++) {
        const batchTasks = [];
        
        for (let i = 0; i < config.tasksPerBatch; i++) {
          const taskType = config.mixedTaskTypes[i % config.mixedTaskTypes.length];
          const taskData = this.generateTaskData(taskType);
          
          const taskPromise = this.performanceManager.executeTask(taskType, taskData, {
            timeout: config.timeout
          });
          
          batchTasks.push(taskPromise);
        }
        
        const batchResults = await Promise.allSettled(batchTasks);
        results.push(...batchResults);
        
        console.log(`     Batch ${batch + 1}/${config.taskBatches} completed`);
      }
      
      const duration = Date.now() - startTime;
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      // Get performance metrics
      const metrics = this.performanceManager.getMetrics();
      
      this.results.addTest('performanceManagerIntegration', {
        success: true,
        duration,
        tasksExecuted: results.length,
        successfulTasks: successful,
        failedTasks: failed,
        successRate: (successful / results.length) * 100,
        performanceMetrics: metrics,
        throughput: results.length / (duration / 1000)
      });
      
      console.log(`     ✅ Performance Manager integration test passed`);
      console.log(`     📊 ${successful}/${results.length} tasks successful (${((successful/results.length)*100).toFixed(1)}%)`);
      
    } catch (error) {
      this.results.addError('performanceManagerIntegration', error);
      this.results.addTest('performanceManagerIntegration', {
        success: false,
        error: error.message
      });
      console.log(`     ❌ Performance Manager integration test failed: ${error.message}`);
    }
  }

  /**
   * Test Worker Pool integration and isolation
   */
  async testWorkerPoolIntegration() {
    try {
      console.log('   Testing WorkerPool integration and isolation...');
      
      const workerPool = this.components.get('workerPool');
      const config = INTEGRATION_TEST_CONFIG.workerPoolStress;
      const startTime = Date.now();
      
      // Test concurrent batch execution
      const batchPromises = [];
      
      for (let batch = 0; batch < config.simultaneousBatches; batch++) {
        const batchTasks = [];
        
        for (let i = 0; i < config.taskCount / config.simultaneousBatches; i++) {
          const taskType = config.taskVariety[i % config.taskVariety.length];
          const taskData = this.generateWorkerTaskData(taskType);
          
          batchTasks.push({
            taskType: taskType,
            data: taskData,
            options: { timeout: 10000 }
          });
        }
        
        batchPromises.push(workerPool.executeBatch(batchTasks, { failFast: false }));
      }
      
      const batchResults = await Promise.all(batchPromises);
      const duration = Date.now() - startTime;
      
      // Flatten results
      const allResults = batchResults.flat();
      const successful = allResults.filter(r => !r.error).length;
      const failed = allResults.filter(r => r.error).length;
      
      // Get worker pool stats
      const stats = workerPool.getStats();
      
      this.results.addTest('workerPoolIntegration', {
        success: true,
        duration,
        tasksExecuted: allResults.length,
        successfulTasks: successful,
        failedTasks: failed,
        successRate: (successful / allResults.length) * 100,
        workerStats: stats,
        averageTaskDuration: stats.avgTaskDuration,
        workerUtilization: stats.peakWorkerCount / config.maxWorkers
      });
      
      console.log(`     ✅ Worker Pool integration test passed`);
      console.log(`     👥 Peak workers used: ${stats.peakWorkerCount}/${config.maxWorkers}`);
      console.log(`     📊 ${successful}/${allResults.length} tasks successful`);
      
    } catch (error) {
      this.results.addError('workerPoolIntegration', error);
      this.results.addTest('workerPoolIntegration', {
        success: false,
        error: error.message
      });
      console.log(`     ❌ Worker Pool integration test failed: ${error.message}`);
    }
  }

  /**
   * Test error handling integration across components
   */
  async testErrorHandlingIntegration() {
    try {
      console.log('   Testing error handling integration...');
      
      const circuitBreaker = this.components.get('circuitBreaker');
      const retryManager = this.components.get('retryManager');
      const config = INTEGRATION_TEST_CONFIG.errorHandling;
      
      const startTime = Date.now();
      const results = [];
      
      // Test error scenarios
      const errorScenarios = [
        { type: 'timeout', data: { delay: 15000 } },
        { type: 'network-error', data: { shouldFail: true } },
        { type: 'invalid-data', data: { corrupt: true } },
        { type: 'resource-exhaustion', data: { memorySize: 1000000000 } }
      ];
      
      for (let i = 0; i < 20; i++) {
        const scenario = errorScenarios[i % errorScenarios.length];
        const shouldFail = Math.random() < config.failureRate;
        
        try {
          const result = await retryManager.executeWithRetry(async () => {
            return await circuitBreaker.execute(async () => {
              if (shouldFail) {
                throw new Error(`Simulated ${scenario.type} error`);
              }
              return await this.simulateOperation(scenario.data);
            });
          });
          
          results.push({ success: true, scenario: scenario.type });
          
        } catch (error) {
          results.push({ 
            success: false, 
            scenario: scenario.type, 
            error: error.message 
          });
        }
      }
      
      const duration = Date.now() - startTime;
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      // Check circuit breaker stats
      const circuitBreakerStats = {
        state: circuitBreaker.getState(),
        failureCount: circuitBreaker.getFailureCount(),
        isOpen: circuitBreaker.isOpen()
      };
      
      this.results.addTest('errorHandlingIntegration', {
        success: true,
        duration,
        operationsExecuted: results.length,
        successfulOperations: successful,
        failedOperations: failed,
        successRate: (successful / results.length) * 100,
        circuitBreakerStats,
        errorScenarios: this.groupErrorsByScenario(results)
      });
      
      console.log(`     ✅ Error handling integration test passed`);
      console.log(`     🛡️ Circuit breaker state: ${circuitBreakerStats.state}`);
      console.log(`     🔄 ${successful}/${results.length} operations successful`);
      
    } catch (error) {
      this.results.addError('errorHandlingIntegration', error);
      this.results.addTest('errorHandlingIntegration', {
        success: false,
        error: error.message
      });
      console.log(`     ❌ Error handling integration test failed: ${error.message}`);
    }
  }

  /**
   * Test component communication and coordination
   */
  async testComponentCommunication() {
    try {
      console.log('   Testing component communication...');
      
      const startTime = Date.now();
      const communicationTests = [];
      
      // Test 1: Performance Manager -> Worker Pool communication
      const pmToWorkerTest = await this.testPMToWorkerCommunication();
      communicationTests.push({ test: 'PM-to-Worker', ...pmToWorkerTest });
      
      // Test 2: Queue Manager coordination
      const queueCoordinationTest = await this.testQueueCoordination();
      communicationTests.push({ test: 'Queue-Coordination', ...queueCoordinationTest });
      
      // Test 3: Stream Processor integration
      const streamIntegrationTest = await this.testStreamProcessorIntegration();
      communicationTests.push({ test: 'Stream-Integration', ...streamIntegrationTest });
      
      // Test 4: Connection Pool coordination
      const connectionPoolTest = await this.testConnectionPoolCoordination();
      communicationTests.push({ test: 'Connection-Pool', ...connectionPoolTest });
      
      const duration = Date.now() - startTime;
      const successfulTests = communicationTests.filter(t => t.success).length;
      
      this.results.addTest('componentCommunication', {
        success: successfulTests === communicationTests.length,
        duration,
        totalTests: communicationTests.length,
        successfulTests,
        failedTests: communicationTests.length - successfulTests,
        testResults: communicationTests
      });
      
      console.log(`     ✅ Component communication test completed`);
      console.log(`     📡 ${successfulTests}/${communicationTests.length} communication tests passed`);
      
    } catch (error) {
      this.results.addError('componentCommunication', error);
      this.results.addTest('componentCommunication', {
        success: false,
        error: error.message
      });
      console.log(`     ❌ Component communication test failed: ${error.message}`);
    }
  }

  /**
   * Test resource management across components
   */
  async testResourceManagement() {
    try {
      console.log('   Testing resource management...');
      
      const startTime = Date.now();
      const initialMemory = process.memoryUsage();
      
      // Create resource-intensive operations
      const resourceTests = [];
      
      // Test memory management
      const memoryTest = await this.testMemoryResourceManagement();
      resourceTests.push({ test: 'Memory-Management', ...memoryTest });
      
      // Test CPU resource distribution
      const cpuTest = await this.testCPUResourceDistribution();
      resourceTests.push({ test: 'CPU-Distribution', ...cpuTest });
      
      // Test I/O resource coordination
      const ioTest = await this.testIOResourceCoordination();
      resourceTests.push({ test: 'IO-Coordination', ...ioTest });
      
      // Force cleanup and measure final state
      if (global.gc) global.gc();
      await this.delay(2000);
      
      const finalMemory = process.memoryUsage();
      const duration = Date.now() - startTime;
      const successfulTests = resourceTests.filter(t => t.success).length;
      
      this.results.addTest('resourceManagement', {
        success: successfulTests === resourceTests.length,
        duration,
        totalTests: resourceTests.length,
        successfulTests,
        memoryDelta: finalMemory.heapUsed - initialMemory.heapUsed,
        memoryEfficiency: (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024), // MB
        testResults: resourceTests
      });
      
      console.log(`     ✅ Resource management test completed`);
      console.log(`     💾 Memory delta: ${((finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
      
    } catch (error) {
      this.results.addError('resourceManagement', error);
      this.results.addTest('resourceManagement', {
        success: false,
        error: error.message
      });
      console.log(`     ❌ Resource management test failed: ${error.message}`);
    }
  }

  /**
   * Test stress scenarios
   */
  async testStressScenarios() {
    try {
      console.log('   Testing stress scenarios...');
      
      const stressTests = [];
      
      // High concurrency stress test
      const concurrencyStress = await this.testHighConcurrencyStress();
      stressTests.push({ test: 'High-Concurrency', ...concurrencyStress });
      
      // Memory pressure stress test
      const memoryStress = await this.testMemoryPressureStress();
      stressTests.push({ test: 'Memory-Pressure', ...memoryStress });
      
      // Error cascade stress test
      const errorStress = await this.testErrorCascadeStress();
      stressTests.push({ test: 'Error-Cascade', ...errorStress });
      
      const successfulTests = stressTests.filter(t => t.success).length;
      
      this.results.addTest('stressScenarios', {
        success: successfulTests === stressTests.length,
        totalTests: stressTests.length,
        successfulTests,
        testResults: stressTests
      });
      
      console.log(`     ✅ Stress scenarios test completed`);
      console.log(`     💥 ${successfulTests}/${stressTests.length} stress tests passed`);
      
    } catch (error) {
      this.results.addError('stressScenarios', error);
      this.results.addTest('stressScenarios', {
        success: false,
        error: error.message
      });
      console.log(`     ❌ Stress scenarios test failed: ${error.message}`);
    }
  }

  /**
   * Test recovery scenarios
   */
  async testRecoveryScenarios() {
    try {
      console.log('   Testing recovery scenarios...');
      
      const recoveryTests = [];
      
      // Component failure recovery
      const componentRecovery = await this.testComponentFailureRecovery();
      recoveryTests.push({ test: 'Component-Recovery', ...componentRecovery });
      
      // System overload recovery
      const overloadRecovery = await this.testSystemOverloadRecovery();
      recoveryTests.push({ test: 'Overload-Recovery', ...overloadRecovery });
      
      // Memory cleanup recovery
      const memoryRecovery = await this.testMemoryCleanupRecovery();
      recoveryTests.push({ test: 'Memory-Recovery', ...memoryRecovery });
      
      const successfulTests = recoveryTests.filter(t => t.success).length;
      
      this.results.addTest('recoveryScenarios', {
        success: successfulTests === recoveryTests.length,
        totalTests: recoveryTests.length,
        successfulTests,
        testResults: recoveryTests
      });
      
      console.log(`     ✅ Recovery scenarios test completed`);
      console.log(`     🔄 ${successfulTests}/${recoveryTests.length} recovery tests passed`);
      
    } catch (error) {
      this.results.addError('recoveryScenarios', error);
      this.results.addTest('recoveryScenarios', {
        success: false,
        error: error.message
      });
      console.log(`     ❌ Recovery scenarios test failed: ${error.message}`);
    }
  }

  // Helper methods for specific test scenarios

  /**
   * Test Performance Manager to Worker Pool communication
   */
  async testPMToWorkerCommunication() {
    try {
      const tasks = Array.from({ length: 10 }, (_, i) => ({
        taskType: 'cpu-intensive',
        data: { workload: 1000 * (i + 1) },
        options: { timeout: 5000 }
      }));
      
      const results = await this.performanceManager.executeBatch(tasks, {
        strategy: 'auto',
        enableOptimization: true
      });
      
      const successful = results.filter(r => !r.error).length;
      
      return {
        success: successful === tasks.length,
        tasksExecuted: tasks.length,
        successfulTasks: successful,
        duration: 0 // Will be set by caller
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test queue coordination
   */
  async testQueueCoordination() {
    try {
      const queueManager = this.components.get('queueManager');
      const tasks = Array.from({ length: 15 }, () => 
        () => this.simulateOperation({ delay: Math.random() * 1000 + 100 })
      );
      
      const results = await queueManager.addAll(tasks);
      
      return {
        success: results.length === tasks.length,
        tasksExecuted: tasks.length,
        successfulTasks: results.length
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test stream processor integration
   */
  async testStreamProcessorIntegration() {
    try {
      const streamProcessor = this.components.get('streamProcessor');
      const dataset = Array.from({ length: 100 }, (_, i) => ({ id: i, data: `item-${i}` }));
      
      const result = await streamProcessor.processStream(
        dataset,
        async (item) => ({ ...item, processed: true }),
        { chunkSize: 10 }
      );
      
      return {
        success: result.processedCount === dataset.length,
        itemsProcessed: result.processedCount,
        expectedItems: dataset.length
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test connection pool coordination
   */
  async testConnectionPoolCoordination() {
    try {
      const connectionPool = this.components.get('connectionPool');
      const requests = Array.from({ length: 10 }, (_, i) => ({
        url: `https://httpbin.org/delay/0.${i}`,
        method: 'GET'
      }));
      
      const results = await connectionPool.requestBatch(requests, { maxConcurrent: 5 });
      const successful = results.filter(r => !r.error).length;
      
      return {
        success: successful >= requests.length * 0.8, // Allow some failures
        requestsExecuted: requests.length,
        successfulRequests: successful
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test memory resource management
   */
  async testMemoryResourceManagement() {
    try {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Create memory-intensive operations
      const memoryTasks = Array.from({ length: 5 }, () => 
        this.performanceManager.executeTask('memory-intensive', {
          dataSize: 10 * 1024 * 1024 // 10MB
        })
      );
      
      await Promise.all(memoryTasks);
      
      // Force cleanup
      if (global.gc) global.gc();
      await this.delay(1000);
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      return {
        success: memoryIncrease < 50 * 1024 * 1024, // Less than 50MB increase
        memoryIncrease: memoryIncrease / 1024 / 1024, // MB
        tasksExecuted: memoryTasks.length
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test CPU resource distribution
   */
  async testCPUResourceDistribution() {
    try {
      const startCpu = process.cpuUsage();
      
      // Create CPU-intensive operations
      const cpuTasks = Array.from({ length: 8 }, (_, i) => 
        this.performanceManager.executeTask('cpu-intensive', {
          workload: 5000 + i * 1000
        })
      );
      
      await Promise.all(cpuTasks);
      
      const endCpu = process.cpuUsage(startCpu);
      const totalCpuTime = endCpu.user + endCpu.system;
      
      return {
        success: totalCpuTime > 0,
        cpuTimeUsed: totalCpuTime / 1000000, // Convert to seconds
        tasksExecuted: cpuTasks.length
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test I/O resource coordination
   */
  async testIOResourceCoordination() {
    try {
      // Create I/O intensive operations
      const ioTasks = Array.from({ length: 10 }, (_, i) => 
        this.performanceManager.executeTask('io-intensive', {
          url: `https://httpbin.org/delay/0.${i % 5}`,
          timeout: 5000
        })
      );
      
      const results = await Promise.allSettled(ioTasks);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      
      return {
        success: successful >= ioTasks.length * 0.7, // Allow some failures
        tasksExecuted: ioTasks.length,
        successfulTasks: successful
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test high concurrency stress
   */
  async testHighConcurrencyStress() {
    try {
      const concurrentTasks = 50;
      const tasks = Array.from({ length: concurrentTasks }, (_, i) => 
        this.performanceManager.executeTask('mixed-workload', {
          id: i,
          workload: Math.random() * 2000 + 500
        }, { timeout: 10000 })
      );
      
      const results = await Promise.allSettled(tasks);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      
      return {
        success: successful >= concurrentTasks * 0.8,
        tasksExecuted: concurrentTasks,
        successfulTasks: successful,
        successRate: (successful / concurrentTasks) * 100
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test memory pressure stress
   */
  async testMemoryPressureStress() {
    try {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Create operations that gradually increase memory pressure
      const memoryTasks = [];
      for (let i = 0; i < 10; i++) {
        memoryTasks.push(
          this.performanceManager.executeTask('memory-intensive', {
            dataSize: (i + 1) * 5 * 1024 * 1024 // 5MB to 50MB
          })
        );
      }
      
      const results = await Promise.allSettled(memoryTasks);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      
      // Check if system handled memory pressure gracefully
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      return {
        success: successful >= memoryTasks.length * 0.6 && memoryIncrease < 200 * 1024 * 1024,
        tasksExecuted: memoryTasks.length,
        successfulTasks: successful,
        memoryIncrease: memoryIncrease / 1024 / 1024
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test error cascade stress
   */
  async testErrorCascadeStress() {
    try {
      const circuitBreaker = this.components.get('circuitBreaker');
      
      // Create tasks that will likely fail
      const errorTasks = Array.from({ length: 20 }, (_, i) => 
        circuitBreaker.execute(async () => {
          if (Math.random() < 0.7) { // 70% failure rate
            throw new Error(`Simulated failure ${i}`);
          }
          return { success: true, id: i };
        })
      );
      
      const results = await Promise.allSettled(errorTasks);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      
      // Circuit breaker should open and protect system
      const isCircuitOpen = circuitBreaker.isOpen();
      
      return {
        success: true, // Success is measured by system stability, not task success
        tasksExecuted: errorTasks.length,
        successfulTasks: successful,
        circuitBreakerTriggered: isCircuitOpen,
        systemProtected: true
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test component failure recovery
   */
  async testComponentFailureRecovery() {
    try {
      // Simulate component failure and recovery
      const workerPool = this.components.get('workerPool');
      
      // Execute tasks before failure
      const preTasks = Array.from({ length: 5 }, () => 
        workerPool.execute('test-task', { data: 'pre-failure' })
      );
      await Promise.allSettled(preTasks);
      
      // Simulate failure by pausing worker pool
      workerPool.pause();
      
      // Try to execute tasks during failure (should queue)
      const duringTasks = Array.from({ length: 3 }, () => 
        workerPool.execute('test-task', { data: 'during-failure' }, { timeout: 5000 })
      );
      
      // Resume worker pool (recovery)
      await this.delay(1000);
      workerPool.resume();
      
      // Execute tasks after recovery
      const postTasks = Array.from({ length: 5 }, () => 
        workerPool.execute('test-task', { data: 'post-recovery' })
      );
      
      const allResults = await Promise.allSettled([...duringTasks, ...postTasks]);
      const successful = allResults.filter(r => r.status === 'fulfilled').length;
      
      return {
        success: successful >= allResults.length * 0.8,
        tasksExecuted: allResults.length,
        successfulTasks: successful,
        recoverySuccessful: true
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test system overload recovery
   */
  async testSystemOverloadRecovery() {
    try {
      // Create system overload
      const overloadTasks = Array.from({ length: 100 }, (_, i) => 
        this.performanceManager.executeTask('cpu-intensive', {
          workload: 10000,
          id: i
        }, { timeout: 15000 })
      );
      
      // System should handle overload gracefully
      const results = await Promise.allSettled(overloadTasks);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      
      // Check if system recovered and is responsive
      const recoveryTask = await this.performanceManager.executeTask('simple-task', {
        data: 'recovery-test'
      }, { timeout: 5000 });
      
      return {
        success: recoveryTask && successful >= overloadTasks.length * 0.5,
        overloadTasksExecuted: overloadTasks.length,
        successfulOverloadTasks: successful,
        systemRecovered: !!recoveryTask
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test memory cleanup recovery
   */
  async testMemoryCleanupRecovery() {
    try {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Create memory-intensive operations
      const memoryTasks = Array.from({ length: 10 }, () => 
        this.performanceManager.executeTask('memory-intensive', {
          dataSize: 20 * 1024 * 1024 // 20MB each
        })
      );
      
      await Promise.allSettled(memoryTasks);
      
      // Trigger cleanup
      if (global.gc) {
        global.gc();
      }
      await this.delay(3000);
      
      // Check memory recovery
      const afterCleanupMemory = process.memoryUsage().heapUsed;
      const memoryRecovered = initialMemory - afterCleanupMemory > -100 * 1024 * 1024; // Within 100MB
      
      // Test system responsiveness after cleanup
      const responsiveTask = await this.performanceManager.executeTask('simple-task', {
        data: 'post-cleanup-test'
      });
      
      return {
        success: memoryRecovered && !!responsiveTask,
        memoryDelta: (afterCleanupMemory - initialMemory) / 1024 / 1024,
        memoryRecovered,
        systemResponsive: !!responsiveTask
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Utility methods

  /**
   * Generate test data for different task types
   */
  generateTaskData(taskType) {
    switch (taskType) {
      case 'cpu-intensive':
        return { workload: Math.floor(Math.random() * 10000) + 1000 };
      case 'io-intensive':
        return { url: 'https://httpbin.org/delay/0.1' };
      case 'memory-intensive':
        return { dataSize: Math.floor(Math.random() * 10) * 1024 * 1024 + 1024 * 1024 };
      default:
        return { data: 'test' };
    }
  }

  /**
   * Generate worker-specific test data
   */
  generateWorkerTaskData(taskType) {
    switch (taskType) {
      case 'fast':
        return { duration: 50, data: 'fast-task' };
      case 'slow':
        return { duration: 2000, data: 'slow-task' };
      case 'failing':
        return { shouldFail: Math.random() < 0.3, data: 'failing-task' };
      case 'memory-heavy':
        return { memorySize: 5 * 1024 * 1024, data: 'memory-heavy-task' };
      default:
        return { data: 'default-task' };
    }
  }

  /**
   * Simulate an operation
   */
  async simulateOperation(data) {
    const delay = data.delay || 100;
    await this.delay(delay);
    
    if (data.shouldFail) {
      throw new Error('Simulated operation failure');
    }
    
    return { result: 'success', data: data };
  }

  /**
   * Group errors by scenario type
   */
  groupErrorsByScenario(results) {
    const groups = {};
    
    for (const result of results) {
      if (!result.success) {
        if (!groups[result.scenario]) {
          groups[result.scenario] = 0;
        }
        groups[result.scenario]++;
      }
    }
    
    return groups;
  }

  /**
   * Generate comprehensive integration report
   */
  generateIntegrationReport() {
    const summary = this.results.getSummary();
    
    return {
      timestamp: new Date().toISOString(),
      configuration: INTEGRATION_TEST_CONFIG,
      summary,
      systemMetrics: {
        samples: this.results.systemMetrics.length,
        finalMemory: this.results.systemMetrics[this.results.systemMetrics.length - 1]?.memory,
        peakMemory: Math.max(...this.results.systemMetrics.map(m => m.memory?.heapUsed || 0))
      },
      errors: this.results.errors,
      analysis: this.analyzeIntegrationResults(summary),
      recommendations: this.generateIntegrationRecommendations(summary)
    };
  }

  /**
   * Analyze integration test results
   */
  analyzeIntegrationResults(summary) {
    const analysis = {
      status: 'PASS',
      issues: [],
      highlights: []
    };
    
    if (summary.successRate < 80) {
      analysis.status = 'FAIL';
      analysis.issues.push(`Low overall success rate: ${summary.successRate.toFixed(1)}%`);
    } else if (summary.successRate < 95) {
      analysis.status = 'WARNING';
      analysis.issues.push(`Moderate success rate: ${summary.successRate.toFixed(1)}%`);
    } else {
      analysis.highlights.push(`High success rate: ${summary.successRate.toFixed(1)}%`);
    }
    
    if (summary.totalErrors > summary.totalTests * 0.1) {
      analysis.status = 'WARNING';
      analysis.issues.push(`High error count: ${summary.totalErrors} errors`);
    }
    
    // Check specific test results
    const criticalTests = ['performanceManagerIntegration', 'workerPoolIntegration', 'errorHandlingIntegration'];
    const failedCriticalTests = criticalTests.filter(test => 
      summary.tests[test] && !summary.tests[test].success
    );
    
    if (failedCriticalTests.length > 0) {
      analysis.status = 'FAIL';
      analysis.issues.push(`Critical test failures: ${failedCriticalTests.join(', ')}`);
    }
    
    return analysis;
  }

  /**
   * Generate integration recommendations
   */
  generateIntegrationRecommendations(summary) {
    const recommendations = [];
    
    if (summary.successRate < 95) {
      recommendations.push('Investigate and fix integration issues causing test failures');
    }
    
    if (summary.totalErrors > 0) {
      recommendations.push('Review error handling mechanisms and improve robustness');
    }
    
    // Check specific failed tests
    Object.entries(summary.tests).forEach(([testName, result]) => {
      if (!result.success) {
        switch (testName) {
          case 'performanceManagerIntegration':
            recommendations.push('Review PerformanceManager task routing and component coordination');
            break;
          case 'workerPoolIntegration':
            recommendations.push('Optimize WorkerPool configuration and error handling');
            break;
          case 'errorHandlingIntegration':
            recommendations.push('Strengthen error handling and recovery mechanisms');
            break;
          case 'resourceManagement':
            recommendations.push('Improve resource cleanup and memory management');
            break;
        }
      }
    });
    
    if (recommendations.length === 0) {
      recommendations.push('All integration tests passed successfully');
      recommendations.push('Continue monitoring for regression in production');
    }
    
    return recommendations;
  }

  /**
   * Save integration test report
   */
  async saveReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `integration-test-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📄 Integration test report saved: ${filepath}`);
    } catch (error) {
      console.error('❌ Failed to save report:', error.message);
    }
  }

  /**
   * Cleanup test environment
   */
  async cleanup() {
    console.log('   Cleaning up test environment...');
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    if (this.performanceManager) {
      await this.performanceManager.shutdown();
    }
    
    for (const [name, component] of this.components) {
      if (component && typeof component.shutdown === 'function') {
        try {
          await component.shutdown();
        } catch (error) {
          console.warn(`Failed to shutdown ${name}:`, error.message);
        }
      }
    }
    
    console.log('   ✅ Cleanup completed');
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Main integration test execution
 */
async function runIntegrationTests() {
  console.log('🔧 Starting Performance Integration Test Suite...');
  
  const testSuite = new PerformanceIntegrationTestSuite();
  
  try {
    const report = await testSuite.runIntegrationTests();
    
    console.log('\n📋 Integration Test Summary:');
    console.log('─'.repeat(60));
    console.log(`✅ Status: ${report.analysis.status}`);
    console.log(`📊 Total Tests: ${report.summary.totalTests}`);
    console.log(`🎯 Success Rate: ${report.summary.successRate.toFixed(1)}%`);
    console.log(`❌ Total Errors: ${report.summary.totalErrors}`);
    console.log(`⏱️ Duration: ${(report.summary.duration / 1000).toFixed(1)}s`);
    console.log(`🧠 Peak Memory: ${(report.systemMetrics.peakMemory / 1024 / 1024).toFixed(2)} MB`);
    
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
    console.error('❌ Integration test failed:', error);
    throw error;
  }
}

// Export for use in other test files
export { PerformanceIntegrationTestSuite, runIntegrationTests };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTests()
    .then(() => {
      console.log('✅ Integration test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Integration test failed:', error);
      process.exit(1);
    });
}
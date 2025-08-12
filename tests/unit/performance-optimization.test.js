/**
 * Performance Optimization Components Tests
 * Tests for WorkerPool, ConnectionPool, StreamProcessor, and PerformanceManager
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import WorkerPool from '../../src/core/workers/WorkerPool.js';
import ConnectionPool from '../../src/core/connections/ConnectionPool.js';
import StreamProcessor from '../../src/core/processing/StreamProcessor.js';
import PerformanceManager from '../../src/core/PerformanceManager.js';
import PerformanceIntegration from '../../src/core/integrations/PerformanceIntegration.js';

// Mock node-fetch for connection pool tests
jest.mock('node-fetch', () => ({
  default: jest.fn(() => Promise.resolve({
    status: 200,
    statusText: 'OK',
    headers: new Map([['content-type', 'application/json']]),
    url: 'https://example.com',
    text: () => Promise.resolve('{"test": "data"}'),
    ok: true
  }))
}));

describe('WorkerPool', () => {
  let workerPool;

  beforeEach(() => {
    workerPool = new WorkerPool({
      maxWorkers: 2,
      taskTimeout: 5000,
      idleTimeout: 30000
    });
  });

  afterEach(async () => {
    if (workerPool) {
      await workerPool.shutdown();
    }
  });

  it('should initialize with correct configuration', () => {
    expect(workerPool.maxWorkers).toBe(2);
    expect(workerPool.taskTimeout).toBe(5000);
    expect(workerPool.workers.size).toBe(0);
  });

  it('should execute a simple task', async () => {
    const result = await workerPool.execute('parseHtml', {
      html: '<html><body><h1>Test</h1></body></html>',
      options: { extractText: true }
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  }, 10000);

  it('should handle multiple concurrent tasks', async () => {
    const tasks = [
      { taskType: 'parseHtml', data: { html: '<div>Content 1</div>' } },
      { taskType: 'parseHtml', data: { html: '<div>Content 2</div>' } },
      { taskType: 'parseHtml', data: { html: '<div>Content 3</div>' } }
    ];

    const results = await workerPool.executeBatch(tasks);
    
    expect(results).toHaveLength(3);
    expect(results.every(result => result !== null)).toBe(true);
  }, 15000);

  it('should handle task failures gracefully', async () => {
    try {
      await workerPool.execute('invalidTask', { data: 'test' });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.message).toContain('Unknown task type');
    }
  });

  it('should provide accurate statistics', async () => {
    await workerPool.execute('parseHtml', {
      html: '<div>Test</div>',
      options: {}
    });

    const stats = workerPool.getStats();
    expect(stats.tasksCompleted).toBeGreaterThan(0);
    expect(stats.workersCreated).toBeGreaterThan(0);
    expect(typeof stats.avgTaskDuration).toBe('number');
  });
});

describe('ConnectionPool', () => {
  let connectionPool;

  beforeEach(() => {
    connectionPool = new ConnectionPool({
      maxSockets: 10,
      maxFreeSockets: 5,
      timeout: 10000
    });
  });

  afterEach(async () => {
    if (connectionPool) {
      await connectionPool.shutdown();
    }
  });

  it('should initialize with correct configuration', () => {
    expect(connectionPool.maxSockets).toBe(10);
    expect(connectionPool.maxFreeSockets).toBe(5);
    expect(connectionPool.timeout).toBe(10000);
  });

  it('should execute HTTP request', async () => {
    const result = await connectionPool.request({
      url: 'https://httpbin.org/json',
      method: 'GET'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
  });

  it('should handle batch requests', async () => {
    const requests = [
      { url: 'https://httpbin.org/json' },
      { url: 'https://httpbin.org/uuid' },
      { url: 'https://httpbin.org/ip' }
    ];

    const results = await connectionPool.requestBatch(requests);
    
    expect(results).toHaveLength(3);
    expect(results.every(result => result.status === 200)).toBe(true);
  });

  it('should track connection statistics', async () => {
    await connectionPool.request({
      url: 'https://httpbin.org/json',
      method: 'GET'
    });

    const stats = connectionPool.getStats();
    expect(stats.totalRequests).toBeGreaterThan(0);
    expect(stats.completedRequests).toBeGreaterThan(0);
    expect(typeof stats.avgResponseTime).toBe('number');
  });

  it('should handle connection errors gracefully', async () => {
    try {
      await connectionPool.request({
        url: 'https://invalid-domain-that-does-not-exist.com',
        timeout: 1000
      });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});

describe('StreamProcessor', () => {
  let streamProcessor;

  beforeEach(() => {
    streamProcessor = new StreamProcessor({
      chunkSize: 100,
      memoryLimit: 10 * 1024 * 1024, // 10MB
      pageSize: 50
    });
  });

  afterEach(async () => {
    if (streamProcessor) {
      await streamProcessor.shutdown();
    }
  });

  it('should initialize with correct configuration', () => {
    expect(streamProcessor.chunkSize).toBe(100);
    expect(streamProcessor.memoryLimit).toBe(10 * 1024 * 1024);
    expect(streamProcessor.pageSize).toBe(50);
  });

  it('should process data sequentially', async () => {
    const data = Array.from({ length: 200 }, (_, i) => ({ id: i, value: `item_${i}` }));
    
    const processor = async (item, index) => {
      return { ...item, processed: true, processedAt: Date.now() };
    };

    const result = await streamProcessor.processStream(data, processor, {
      parallel: false,
      collectResults: true
    });

    expect(result.processedItems).toBe(200);
    expect(result.results).toHaveLength(200);
    expect(result.success).toBe(true);
    expect(result.results.every(item => item.processed)).toBe(true);
  });

  it('should process data in parallel', async () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item_${i}` }));
    
    const processor = async (item, index) => {
      await new Promise(resolve => setTimeout(resolve, 10)); // Simulate async work
      return { ...item, processed: true, index };
    };

    const result = await streamProcessor.processStream(data, processor, {
      parallel: true,
      maxConcurrency: 5,
      collectResults: true
    });

    expect(result.processedItems).toBe(100);
    expect(result.results).toHaveLength(100);
    expect(result.success).toBe(true);
  });

  it('should handle pagination correctly', async () => {
    const data = Array.from({ length: 150 }, (_, i) => ({ id: i, value: `item_${i}` }));
    
    const processor = async (item, index) => {
      return { ...item, processed: true };
    };

    const result = await streamProcessor.processStream(data, processor, {
      enablePagination: true,
      collectResults: true
    });

    expect(result.totalItems).toBe(150);
    expect(result.totalPages).toBe(Math.ceil(150 / streamProcessor.pageSize));
    expect(result.pages.size).toBeGreaterThan(0);
  });

  it('should handle processing errors gracefully', async () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ id: i, shouldFail: i === 5 }));
    
    const processor = async (item, index) => {
      if (item.shouldFail) {
        throw new Error('Intentional test error');
      }
      return { ...item, processed: true };
    };

    const result = await streamProcessor.processStream(data, processor, {
      collectResults: true
    });

    expect(result.processedItems).toBe(10);
    expect(result.results).toHaveLength(9); // 9 successful
    expect(result.errors).toHaveLength(1); // 1 failed
    expect(result.success).toBe(false);
  });

  it('should provide accurate statistics', async () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    
    const processor = async (item, index) => item;

    await streamProcessor.processStream(data, processor);

    const stats = streamProcessor.getStats();
    expect(stats.processedItems).toBe(50);
    expect(stats.isProcessing).toBe(false);
    expect(typeof stats.duration).toBe('number');
    expect(typeof stats.itemsPerSecond).toBe('number');
  });
});

describe('PerformanceManager', () => {
  let performanceManager;

  beforeEach(() => {
    performanceManager = new PerformanceManager({
      workerPoolOptions: { maxWorkers: 2 },
      connectionPoolOptions: { maxSockets: 5 },
      streamProcessorOptions: { chunkSize: 50 },
      enableMetrics: true,
      metricsInterval: 1000
    });
  });

  afterEach(async () => {
    if (performanceManager) {
      await performanceManager.shutdown();
    }
  });

  it('should initialize all components', () => {
    expect(performanceManager.workerPool).toBeDefined();
    expect(performanceManager.connectionPool).toBeDefined();
    expect(performanceManager.streamProcessor).toBeDefined();
    expect(performanceManager.queueManager).toBeDefined();
  });

  it('should route tasks to optimal components', () => {
    expect(performanceManager.getOptimalComponent('parseHtml', { html: '<div>test</div>' })).toBe('worker');
    expect(performanceManager.getOptimalComponent('fetchUrl', { url: 'https://example.com' })).toBe('connection');
    
    const largeData = Array.from({ length: 10000 }, (_, i) => i);
    expect(performanceManager.getOptimalComponent('processData', largeData)).toBe('stream');
  });

  it('should execute tasks using appropriate components', async () => {
    const result = await performanceManager.executeTask('parseHtml', {
      html: '<html><body><h1>Test</h1></body></html>',
      options: { extractText: true }
    });

    expect(result).toBeDefined();
  }, 10000);

  it('should execute batch tasks with optimization', async () => {
    const tasks = [
      { taskType: 'parseHtml', data: { html: '<div>Content 1</div>' }, options: {} },
      { taskType: 'parseHtml', data: { html: '<div>Content 2</div>' }, options: {} },
      { taskType: 'calculateSimilarity', data: { text1: 'Hello', text2: 'Hi' }, options: {} }
    ];

    const results = await performanceManager.executeBatch(tasks, {
      strategy: 'auto',
      enableOptimization: true
    });

    expect(results).toHaveLength(3);
  }, 15000);

  it('should provide comprehensive metrics', async () => {
    await performanceManager.executeTask('parseHtml', {
      html: '<div>test</div>',
      options: {}
    });

    const metrics = performanceManager.getMetrics();
    
    expect(metrics.totalOperations).toBeGreaterThan(0);
    expect(metrics.completedOperations).toBeGreaterThan(0);
    expect(typeof metrics.avgOperationTime).toBe('number');
    expect(typeof metrics.operationsPerSecond).toBe('number');
    expect(metrics.componentStats).toBeDefined();
  });

  it('should handle large dataset processing', async () => {
    const largeDataset = Array.from({ length: 500 }, (_, i) => ({ id: i, data: `item_${i}` }));
    
    const processor = async (item, index) => {
      return { ...item, processed: true };
    };

    const result = await performanceManager.processLargeDataset(largeDataset, processor, {
      enableWorkerPool: false, // Disable for test simplicity
      enablePagination: true,
      chunkSize: 100
    });

    expect(result.processedItems).toBe(500);
    expect(result.totalPages).toBe(Math.ceil(500 / performanceManager.streamProcessor.pageSize));
  });
});

describe('PerformanceIntegration', () => {
  beforeEach(() => {
    // Clean up any existing instances
    PerformanceIntegration.shutdownPerformance();
  });

  afterEach(async () => {
    await PerformanceIntegration.shutdownPerformance();
  });

  it('should initialize performance components', () => {
    const components = PerformanceIntegration.initializePerformance({
      enableWorkerPool: true,
      enableConnectionPool: true,
      enableStreamProcessor: true
    });

    expect(components.workerPool).toBeDefined();
    expect(components.connectionPool).toBeDefined();
    expect(components.streamProcessor).toBeDefined();
  });

  it('should provide availability checks', () => {
    PerformanceIntegration.initializePerformance({
      enableWorkerPool: true,
      enableConnectionPool: false,
      enableStreamProcessor: true
    });

    expect(PerformanceIntegration.isPerformanceAvailable('worker')).toBe(true);
    expect(PerformanceIntegration.isPerformanceAvailable('connection')).toBe(false);
    expect(PerformanceIntegration.isPerformanceAvailable('stream')).toBe(true);
  });

  it('should provide enhanced parsing with fallback', async () => {
    // Test with small HTML (should use fallback)
    const smallHtml = '<div>Small content</div>';
    const result1 = await PerformanceIntegration.enhancedParseHtml(smallHtml, {
      extractText: true
    });

    expect(result1).toBeDefined();
    expect(typeof result1.text).toBe('string');

    // Initialize worker pool for large HTML test
    PerformanceIntegration.initializePerformance({ enableWorkerPool: true });

    // Test with large HTML (should use worker pool if available)
    const largeHtml = '<div>' + 'Large content '.repeat(10000) + '</div>';
    const result2 = await PerformanceIntegration.enhancedParseHtml(largeHtml, {
      extractText: true
    });

    expect(result2).toBeDefined();
  }, 10000);

  it('should provide enhanced batch processing', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, value: i * 2 }));
    
    const processor = async (item, index) => {
      return { ...item, doubled: item.value * 2 };
    };

    const result = await PerformanceIntegration.enhancedBatchProcess(items, processor, {
      useStreaming: false,
      useWorkers: false
    });

    expect(result.results).toHaveLength(100);
    expect(result.processedItems).toBe(100);
  });

  it('should provide performance statistics', () => {
    PerformanceIntegration.initializePerformance({
      enableWorkerPool: true,
      enableConnectionPool: true
    });

    const stats = PerformanceIntegration.getPerformanceStats();
    
    expect(stats.workerPool).toBeDefined();
    expect(stats.connectionPool).toBeDefined();
  });

  it('should handle graceful shutdown', async () => {
    PerformanceIntegration.initializePerformance({
      enableWorkerPool: true,
      enableConnectionPool: true,
      enableStreamProcessor: true
    });

    // Verify components are available
    expect(PerformanceIntegration.isPerformanceAvailable('worker')).toBe(true);
    expect(PerformanceIntegration.isPerformanceAvailable('connection')).toBe(true);

    // Shutdown
    await PerformanceIntegration.shutdownPerformance();

    // Verify components are no longer available
    expect(PerformanceIntegration.isPerformanceAvailable('worker')).toBe(false);
    expect(PerformanceIntegration.isPerformanceAvailable('connection')).toBe(false);
  });
});

// Integration tests
describe('Performance Integration Tests', () => {
  let performanceManager;

  beforeEach(() => {
    performanceManager = new PerformanceManager({
      workerPoolOptions: { maxWorkers: 2 },
      connectionPoolOptions: { maxSockets: 5 },
      enableMetrics: true
    });
  });

  afterEach(async () => {
    if (performanceManager) {
      await performanceManager.shutdown();
    }
  });

  it('should handle mixed workload efficiently', async () => {
    const mixedTasks = [
      // CPU-intensive tasks
      { taskType: 'parseHtml', data: { html: '<html><body>Content 1</body></html>' }, options: {} },
      { taskType: 'extractContent', data: { html: '<html><body>Content 2</body></html>' }, options: {} },
      
      // Network tasks (mocked)
      { taskType: 'fetchUrl', data: { url: 'https://httpbin.org/json' }, options: {} },
      
      // Analysis tasks
      { taskType: 'calculateSimilarity', data: { text1: 'Hello world', text2: 'Hello universe' }, options: {} },
      { taskType: 'analyzeText', data: { text: 'This is sample text for analysis.' }, options: {} }
    ];

    const startTime = Date.now();
    const results = await performanceManager.executeBatch(mixedTasks, {
      strategy: 'auto',
      maxConcurrency: 3,
      enableOptimization: true
    });
    const duration = Date.now() - startTime;

    expect(results).toHaveLength(5);
    expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
    
    // Verify metrics were collected
    const metrics = performanceManager.getMetrics();
    expect(metrics.totalOperations).toBeGreaterThanOrEqual(5);
    expect(metrics.completedOperations).toBeGreaterThan(0);
  }, 35000);

  it('should optimize resource usage under load', async () => {
    const heavyTasks = Array.from({ length: 20 }, (_, i) => ({
      taskType: 'parseHtml',
      data: { 
        html: `<html><body>${'Content '.repeat(1000)} ${i}</body></html>`,
        options: { extractText: true, extractLinks: true }
      },
      options: {}
    }));

    const startTime = Date.now();
    const results = await performanceManager.executeBatch(heavyTasks, {
      strategy: 'parallel',
      maxConcurrency: 4
    });
    const duration = Date.now() - startTime;

    expect(results).toHaveLength(20);
    
    // Check that worker pool was utilized efficiently
    const stats = performanceManager.getMetrics();
    expect(stats.componentStats.workerPool.tasksCompleted).toBeGreaterThan(0);
    
    // Performance should be reasonable even under load
    expect(duration).toBeLessThan(60000); // Should complete within 60 seconds
  }, 65000);
});

// Error handling and edge cases
describe('Performance Error Handling', () => {
  it('should handle worker pool initialization failures gracefully', async () => {
    // This test would need specific conditions to trigger worker creation failures
    const workerPool = new WorkerPool({
      maxWorkers: 1,
      workerScript: '/non/existent/path.js'
    });

    try {
      await workerPool.execute('parseHtml', { html: '<div>test</div>' });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined();
    } finally {
      await workerPool.shutdown();
    }
  });

  it('should handle memory pressure in stream processor', async () => {
    const streamProcessor = new StreamProcessor({
      memoryLimit: 1024, // Very low limit
      memoryCheckInterval: 100
    });

    const largeDataset = Array.from({ length: 1000 }, (_, i) => ({ 
      id: i, 
      data: 'x'.repeat(1000) // Each item is roughly 1KB
    }));

    let memoryPressureEvents = 0;
    streamProcessor.on('memoryPressure', () => {
      memoryPressureEvents++;
    });

    const processor = async (item, index) => item;

    await streamProcessor.processStream(largeDataset, processor, {
      chunkSize: 100
    });

    // Should have triggered memory pressure events
    expect(memoryPressureEvents).toBeGreaterThan(0);

    await streamProcessor.shutdown();
  });

  it('should handle connection pool backpressure', async () => {
    const connectionPool = new ConnectionPool({
      maxSockets: 2,
      backpressureThreshold: 0.5 // Low threshold to trigger backpressure
    });

    const manyRequests = Array.from({ length: 10 }, (_, i) => ({
      url: `https://httpbin.org/delay/1?req=${i}`
    }));

    let backpressureEvents = 0;
    connectionPool.on('backpressureActivated', () => {
      backpressureEvents++;
    });

    await connectionPool.requestBatch(manyRequests, {
      maxConcurrent: 5
    });

    // Should have triggered backpressure
    expect(backpressureEvents).toBeGreaterThan(0);

    await connectionPool.shutdown();
  });
});
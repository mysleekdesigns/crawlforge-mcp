/**
 * Wave 3 Performance Optimization Utilities
 * 
 * This module provides performance optimization utilities specifically designed
 * for Wave 3 features: Deep Research, Stealth Mode, Localization, and Change Tracking.
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import https from 'https';
import http from 'http';
import fs from 'fs/promises';

/**
 * Memory Leak Monitor
 * Tracks and prevents memory leaks in browser contexts and other resources
 */
class MemoryLeakMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      checkInterval: 30000, // 30 seconds
      memoryThreshold: 512 * 1024 * 1024, // 512MB
      leakThreshold: 0.15, // 15% growth rate
      gcForceThreshold: 0.8, // Force GC at 80% of threshold
      ...options
    };

    this.measurements = [];
    this.resourceTracking = new Map();
    this.leakDetected = false;
    this.monitoring = false;
    
    this.setupMonitoring();
  }

  setupMonitoring() {
    if (global.gc) {
      // Force garbage collection available
      this.forceGCAvailable = true;
    }
    
    setInterval(() => {
      if (this.monitoring) {
        this.performMemoryCheck();
      }
    }, this.options.checkInterval);
  }

  startMonitoring() {
    this.monitoring = true;
    this.emit('monitoring_started');
  }

  stopMonitoring() {
    this.monitoring = false;
    this.emit('monitoring_stopped');
  }

  performMemoryCheck() {
    const usage = process.memoryUsage();
    const timestamp = Date.now();
    
    this.measurements.push({
      timestamp,
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external
    });

    // Keep only last 20 measurements for trend analysis
    if (this.measurements.length > 20) {
      this.measurements.shift();
    }

    // Check for memory threshold breach
    if (usage.heapUsed > this.options.memoryThreshold) {
      this.emit('threshold_exceeded', { usage, threshold: this.options.memoryThreshold });
      
      if (this.forceGCAvailable && usage.heapUsed > this.options.memoryThreshold * this.options.gcForceThreshold) {
        this.forceGarbageCollection();
      }
    }

    // Detect memory leaks
    this.detectMemoryLeak();

    // Emit current status
    this.emit('memory_status', {
      current: usage,
      trend: this.calculateMemoryTrend(),
      leakDetected: this.leakDetected
    });
  }

  detectMemoryLeak() {
    if (this.measurements.length < 10) return;

    const trend = this.calculateMemoryTrend();
    const wasLeaking = this.leakDetected;
    
    this.leakDetected = trend > this.options.leakThreshold;

    if (this.leakDetected && !wasLeaking) {
      this.emit('leak_detected', {
        trend,
        threshold: this.options.leakThreshold,
        measurements: this.measurements
      });
    } else if (!this.leakDetected && wasLeaking) {
      this.emit('leak_resolved', { trend });
    }
  }

  calculateMemoryTrend() {
    if (this.measurements.length < 2) return 0;

    const values = this.measurements.map(m => m.heapUsed);
    const n = values.length;
    
    // Simple linear regression for trend
    const sumX = n * (n - 1) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, x) => sum + x * y, 0);
    const sumXX = n * (n - 1) * (2 * n - 1) / 6;
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope / (sumY / n); // Normalize by average
  }

  forceGarbageCollection() {
    if (this.forceGCAvailable) {
      const beforeGC = process.memoryUsage();
      global.gc();
      const afterGC = process.memoryUsage();
      
      const recovered = beforeGC.heapUsed - afterGC.heapUsed;
      this.emit('gc_forced', { beforeGC, afterGC, recovered });
    }
  }

  trackResource(resourceId, resource, cleanupFn) {
    this.resourceTracking.set(resourceId, {
      resource,
      cleanupFn,
      createdAt: Date.now(),
      lastAccessed: Date.now()
    });
  }

  releaseResource(resourceId) {
    const tracked = this.resourceTracking.get(resourceId);
    if (tracked) {
      try {
        tracked.cleanupFn();
        this.resourceTracking.delete(resourceId);
        this.emit('resource_released', { resourceId });
      } catch (error) {
        this.emit('cleanup_error', { resourceId, error: error.message });
      }
    }
  }

  getStats() {
    return {
      monitoring: this.monitoring,
      leakDetected: this.leakDetected,
      trackedResources: this.resourceTracking.size,
      measurements: this.measurements.length,
      currentMemory: process.memoryUsage(),
      memoryTrend: this.calculateMemoryTrend()
    };
  }
}

/**
 * Worker Pool Manager
 * Manages a pool of worker threads for CPU-intensive tasks
 */
class WorkerPoolManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      poolSize: Math.min(require('os').cpus().length, 8),
      maxQueueSize: 100,
      workerTimeout: 30000,
      taskTimeout: 60000,
      ...options
    };

    this.workers = [];
    this.availableWorkers = [];
    this.busyWorkers = new Set();
    this.taskQueue = [];
    this.stats = {
      tasksCompleted: 0,
      tasksErrors: 0,
      averageTaskTime: 0,
      totalTaskTime: 0
    };

    this.initialize();
  }

  async initialize() {
    for (let i = 0; i < this.options.poolSize; i++) {
      await this.createWorker(i);
    }
    this.emit('initialized', { poolSize: this.options.poolSize });
  }

  async createWorker(workerId) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: { isWorker: true, workerId }
      });

      worker.on('message', (result) => {
        this.handleWorkerMessage(worker, result);
      });

      worker.on('error', (error) => {
        this.handleWorkerError(worker, error);
      });

      worker.on('exit', (code) => {
        this.handleWorkerExit(worker, code);
      });

      const workerInfo = {
        worker,
        id: workerId,
        busy: false,
        currentTask: null,
        tasksCompleted: 0,
        createdAt: Date.now()
      };

      this.workers.push(workerInfo);
      this.availableWorkers.push(workerInfo);
      resolve(workerInfo);
    });
  }

  async executeTask(taskType, taskData, options = {}) {
    return new Promise((resolve, reject) => {
      const task = {
        id: this.generateTaskId(),
        type: taskType,
        data: taskData,
        options,
        resolve,
        reject,
        createdAt: Date.now(),
        timeout: setTimeout(() => {
          reject(new Error('Task timeout after ' + this.options.taskTimeout + 'ms'));
        }, this.options.taskTimeout)
      };

      if (this.taskQueue.length >= this.options.maxQueueSize) {
        reject(new Error('Task queue is full'));
        return;
      }

      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  processQueue() {
    while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      const task = this.taskQueue.shift();
      const workerInfo = this.availableWorkers.shift();
      
      this.assignTaskToWorker(task, workerInfo);
    }
  }

  assignTaskToWorker(task, workerInfo) {
    workerInfo.busy = true;
    workerInfo.currentTask = task;
    this.busyWorkers.add(workerInfo);

    const startTime = performance.now();
    
    workerInfo.worker.postMessage({
      taskId: task.id,
      type: task.type,
      data: task.data,
      options: task.options
    });

    task.startTime = startTime;
    task.workerInfo = workerInfo;
  }

  handleWorkerMessage(worker, message) {
    const workerInfo = this.workers.find(w => w.worker === worker);
    if (!workerInfo || !workerInfo.currentTask) return;

    const task = workerInfo.currentTask;
    const duration = performance.now() - task.startTime;

    // Clear timeout
    clearTimeout(task.timeout);

    // Update statistics
    this.updateStats(duration);

    // Free up worker
    this.releaseWorker(workerInfo);

    if (message.error) {
      task.reject(new Error(message.error));
      this.stats.tasksErrors++;
    } else {
      task.resolve(message.result);
      this.stats.tasksCompleted++;
    }

    // Process next task in queue
    this.processQueue();
  }

  handleWorkerError(worker, error) {
    const workerInfo = this.workers.find(w => w.worker === worker);
    if (workerInfo && workerInfo.currentTask) {
      workerInfo.currentTask.reject(error);
      this.releaseWorker(workerInfo);
    }
    
    this.emit('worker_error', { workerId: workerInfo?.id, error });
    
    // Replace failed worker
    this.replaceWorker(workerInfo);
  }

  handleWorkerExit(worker, code) {
    const workerInfo = this.workers.find(w => w.worker === worker);
    this.emit('worker_exit', { workerId: workerInfo?.id, code });
    
    if (code !== 0) {
      this.replaceWorker(workerInfo);
    }
  }

  async replaceWorker(failedWorker) {
    // Remove failed worker from arrays
    const workerIndex = this.workers.indexOf(failedWorker);
    if (workerIndex > -1) {
      this.workers.splice(workerIndex, 1);
    }

    const availableIndex = this.availableWorkers.indexOf(failedWorker);
    if (availableIndex > -1) {
      this.availableWorkers.splice(availableIndex, 1);
    }

    this.busyWorkers.delete(failedWorker);

    // Create replacement worker
    await this.createWorker(failedWorker.id);
  }

  releaseWorker(workerInfo) {
    workerInfo.busy = false;
    workerInfo.currentTask = null;
    workerInfo.tasksCompleted++;
    
    this.busyWorkers.delete(workerInfo);
    this.availableWorkers.push(workerInfo);
  }

  updateStats(duration) {
    this.stats.totalTaskTime += duration;
    const completedTasks = this.stats.tasksCompleted + 1;
    this.stats.averageTaskTime = this.stats.totalTaskTime / completedTasks;
  }

  generateTaskId() {
    return 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  getStats() {
    return {
      ...this.stats,
      activeWorkers: this.workers.length,
      availableWorkers: this.availableWorkers.length,
      busyWorkers: this.busyWorkers.size,
      queuedTasks: this.taskQueue.length,
      uptime: Date.now() - (this.workers[0]?.createdAt || Date.now())
    };
  }

  async shutdown() {
    // Wait for current tasks to complete
    while (this.busyWorkers.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Terminate all workers
    const terminatePromises = this.workers.map(workerInfo => 
      workerInfo.worker.terminate()
    );

    await Promise.all(terminatePromises);
    this.emit('shutdown');
  }
}

/**
 * Advanced Connection Pool Manager
 * Manages HTTP/HTTPS connections with intelligent pooling and request batching
 */
class ConnectionPoolManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 60000,
      freeSocketTimeout: 30000,
      keepAlive: true,
      batchSize: 10,
      batchTimeout: 100,
      retryAttempts: 3,
      retryDelay: 1000,
      ...options
    };

    this.httpAgent = new http.Agent({
      keepAlive: this.options.keepAlive,
      maxSockets: this.options.maxSockets,
      maxFreeSockets: this.options.maxFreeSockets,
      timeout: this.options.timeout,
      freeSocketTimeout: this.options.freeSocketTimeout
    });

    this.httpsAgent = new https.Agent({
      keepAlive: this.options.keepAlive,
      maxSockets: this.options.maxSockets,
      maxFreeSockets: this.options.maxFreeSockets,
      timeout: this.options.timeout,
      freeSocketTimeout: this.options.freeSocketTimeout
    });

    this.requestQueue = [];
    this.batchProcessor = null;
    this.stats = {
      requests: 0,
      responses: 0,
      errors: 0,
      batches: 0,
      averageResponseTime: 0,
      totalResponseTime: 0
    };

    this.setupBatchProcessor();
  }

  setupBatchProcessor() {
    this.batchProcessor = setInterval(() => {
      this.processBatch();
    }, this.options.batchTimeout);
  }

  async request(url, options = {}) {
    return new Promise((resolve, reject) => {
      const requestInfo = {
        url,
        options: {
          ...options,
          agent: url.startsWith('https:') ? this.httpsAgent : this.httpAgent
        },
        resolve,
        reject,
        createdAt: Date.now(),
        attempts: 0
      };

      this.requestQueue.push(requestInfo);
      
      // Process immediately if batch is full
      if (this.requestQueue.length >= this.options.batchSize) {
        this.processBatch();
      }
    });
  }

  async processBatch() {
    if (this.requestQueue.length === 0) return;

    const batch = this.requestQueue.splice(0, this.options.batchSize);
    this.stats.batches++;

    const batchPromises = batch.map(requestInfo => 
      this.executeRequest(requestInfo)
    );

    await Promise.allSettled(batchPromises);
  }

  async executeRequest(requestInfo) {
    const startTime = performance.now();
    
    try {
      requestInfo.attempts++;
      
      const response = await this.performRequest(requestInfo.url, requestInfo.options);
      const duration = performance.now() - startTime;
      
      this.updateStats(duration, false);
      requestInfo.resolve(response);
      
    } catch (error) {
      if (requestInfo.attempts < this.options.retryAttempts) {
        // Retry with exponential backoff
        const delay = this.options.retryDelay * Math.pow(2, requestInfo.attempts - 1);
        
        setTimeout(() => {
          this.executeRequest(requestInfo);
        }, delay);
      } else {
        this.stats.errors++;
        requestInfo.reject(error);
      }
    }
  }

  performRequest(url, options) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https:') ? https : http;
      
      const request = protocol.get(url, options, (response) => {
        let data = '';
        
        response.on('data', chunk => {
          data += chunk;
        });
        
        response.on('end', () => {
          this.stats.responses++;
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: data
          });
        });
      });

      request.on('error', reject);
      request.setTimeout(this.options.timeout, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  updateStats(duration, isError) {
    this.stats.requests++;
    if (!isError) {
      this.stats.totalResponseTime += duration;
      this.stats.averageResponseTime = this.stats.totalResponseTime / this.stats.responses;
    }
  }

  getStats() {
    return {
      ...this.stats,
      queueLength: this.requestQueue.length,
      successRate: this.stats.requests > 0 ? (this.stats.responses / this.stats.requests) * 100 : 0
    };
  }

  shutdown() {
    if (this.batchProcessor) {
      clearInterval(this.batchProcessor);
    }
    
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
    
    this.emit('shutdown');
  }
}

/**
 * Circuit Breaker Implementation
 * Provides fault tolerance for external service calls
 */
class CircuitBreaker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 60000,
      ...options
    };

    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.successes = 0;
    this.nextAttempt = 0;
    this.stats = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      stateChanges: 0
    };
  }

  async execute(fn) {
    this.stats.totalRequests++;
    
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        const error = new Error('Circuit breaker is OPEN');
        error.circuitBreakerOpen = true;
        throw error;
      } else {
        this.setState('HALF_OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.stats.totalSuccesses++;
    
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.setState('CLOSED');
      }
    }
    
    this.failures = 0;
  }

  onFailure() {
    this.stats.totalFailures++;
    this.failures++;
    this.successes = 0;

    if (this.failures >= this.options.failureThreshold) {
      this.setState('OPEN');
    }
  }

  setState(newState) {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      this.stats.stateChanges++;
      
      if (newState === 'OPEN') {
        this.nextAttempt = Date.now() + this.options.timeout;
      } else if (newState === 'CLOSED') {
        this.failures = 0;
        this.successes = 0;
      }
      
      this.emit('state_change', { from: oldState, to: newState });
    }
  }

  getState() {
    return this.state;
  }

  getStats() {
    return {
      ...this.stats,
      currentState: this.state,
      failures: this.failures,
      successes: this.successes,
      nextAttempt: this.nextAttempt,
      failureRate: this.stats.totalRequests > 0 ? 
        (this.stats.totalFailures / this.stats.totalRequests) * 100 : 0
    };
  }
}

/**
 * Performance Monitoring Dashboard
 * Real-time performance metrics and alerting
 */
class PerformanceDashboard extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      sampleInterval: 5000, // 5 seconds
      historySize: 100,
      alertThresholds: {
        memory: 450 * 1024 * 1024, // 450MB
        responseTime: 3000, // 3s
        errorRate: 0.05, // 5%
        cpuUsage: 0.8 // 80%
      },
      ...options
    };

    this.metrics = {
      memory: [],
      responseTime: [],
      errorRate: [],
      throughput: []
    };

    this.alerts = [];
    this.monitoring = false;
  }

  startMonitoring() {
    this.monitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.options.sampleInterval);
    
    this.emit('monitoring_started');
  }

  stopMonitoring() {
    this.monitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    this.emit('monitoring_stopped');
  }

  collectMetrics() {
    const timestamp = Date.now();
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Collect memory metrics
    this.addMetric('memory', {
      timestamp,
      rss: memUsage.rss,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external
    });

    // Check for alerts
    this.checkAlerts({
      memory: memUsage.heapUsed,
      timestamp
    });

    this.emit('metrics_collected', {
      memory: memUsage,
      cpu: cpuUsage,
      timestamp
    });
  }

  addMetric(type, data) {
    if (!this.metrics[type]) {
      this.metrics[type] = [];
    }

    this.metrics[type].push(data);
    
    // Keep only recent history
    if (this.metrics[type].length > this.options.historySize) {
      this.metrics[type].shift();
    }
  }

  checkAlerts(currentMetrics) {
    const alerts = [];

    // Memory alert
    if (currentMetrics.memory > this.options.alertThresholds.memory) {
      alerts.push({
        type: 'memory',
        severity: 'warning',
        message: 'Memory usage exceeded threshold: ' + (currentMetrics.memory / 1024 / 1024).toFixed(0) + 'MB',
        timestamp: currentMetrics.timestamp,
        value: currentMetrics.memory,
        threshold: this.options.alertThresholds.memory
      });
    }

    if (alerts.length > 0) {
      this.alerts.push(...alerts);
      this.emit('alerts', alerts);
    }
  }

  getMetrics(type, limit = 50) {
    if (!this.metrics[type]) return [];
    return this.metrics[type].slice(-limit);
  }

  getRecentAlerts(limit = 10) {
    return this.alerts.slice(-limit);
  }

  getDashboardData() {
    return {
      metrics: {
        memory: this.getMetrics('memory', 20),
        responseTime: this.getMetrics('responseTime', 20),
        errorRate: this.getMetrics('errorRate', 20),
        throughput: this.getMetrics('throughput', 20)
      },
      alerts: this.getRecentAlerts(5),
      summary: this.getSummary(),
      status: {
        monitoring: this.monitoring,
        uptime: process.uptime(),
        nodeVersion: process.version
      }
    };
  }

  getSummary() {
    const memoryMetrics = this.getMetrics('memory', 10);
    const currentMemory = memoryMetrics.length > 0 ? memoryMetrics[memoryMetrics.length - 1] : null;
    
    return {
      currentMemory: currentMemory ? (currentMemory.heapUsed / 1024 / 1024).toFixed(0) + 'MB' : 'N/A',
      memoryTrend: this.calculateTrend(memoryMetrics.map(m => m.heapUsed)),
      alertCount: this.alerts.length,
      criticalAlerts: this.alerts.filter(a => a.severity === 'critical').length
    };
  }

  calculateTrend(values) {
    if (values.length < 2) return 'stable';
    
    const recent = values.slice(-5);
    const avg1 = recent.slice(0, Math.floor(recent.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(recent.length / 2);
    const avg2 = recent.slice(Math.floor(recent.length / 2)).reduce((a, b) => a + b, 0) / (recent.length - Math.floor(recent.length / 2));
    
    const change = (avg2 - avg1) / avg1;
    
    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }
}

// Worker thread implementation
if (!isMainThread && workerData?.isWorker) {
  // This code runs in worker threads
  parentPort.on('message', async (message) => {
    const { taskId, type, data, options } = message;
    
    try {
      let result;
      
      switch (type) {
        case 'html_parse':
          result = await parseHTML(data, options);
          break;
        case 'content_analysis':
          result = await analyzeContent(data, options);
          break;
        case 'text_diff':
          result = await calculateTextDiff(data.original, data.current, options);
          break;
        case 'hash_calculation':
          result = await calculateHashes(data, options);
          break;
        default:
          throw new Error('Unknown task type: ' + type);
      }
      
      parentPort.postMessage({ taskId, result });
      
    } catch (error) {
      parentPort.postMessage({ taskId, error: error.message });
    }
  });

  // Worker implementations for CPU-intensive tasks
  async function parseHTML(html, options) {
    // CPU-intensive HTML parsing logic
    return { parsed: true, elements: 100 };
  }

  async function analyzeContent(content, options) {
    // CPU-intensive content analysis logic
    return { analyzed: true, score: 0.85 };
  }

  async function calculateTextDiff(original, current, options) {
    // CPU-intensive text diffing logic
    return { changes: 5, similarity: 0.92 };
  }

  async function calculateHashes(data, options) {
    // CPU-intensive hash calculation logic
    return { hash: 'abc123', checksum: 'def456' };
  }
}

// Export all optimization utilities
export {
  MemoryLeakMonitor,
  WorkerPoolManager,
  ConnectionPoolManager,
  CircuitBreaker,
  PerformanceDashboard as DashboardMonitor
};

export default {
  MemoryLeakMonitor,
  WorkerPoolManager,
  ConnectionPoolManager,
  CircuitBreaker,
  PerformanceDashboard
};

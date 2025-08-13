/**
 * PerformanceManager - Orchestrates performance optimization components
 * Integrates WorkerPool, ConnectionPool, StreamProcessor, and QueueManager
 */

import { EventEmitter } from 'events';
import WorkerPool from './workers/WorkerPool.js';
import ConnectionPool from './connections/ConnectionPool.js';
import StreamProcessor from './processing/StreamProcessor.js';
import QueueManager from './queue/QueueManager.js';
import { config } from '../constants/config.js';

export class PerformanceManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    const {
      workerPoolOptions = {},
      connectionPoolOptions = {},
      streamProcessorOptions = {},
      queueManagerOptions = {},
      enableMetrics = true,
      metricsInterval = 10000
    } = options;

    this.enableMetrics = enableMetrics;
    this.metricsInterval = metricsInterval;

    // Initialize performance components
    this.workerPool = new WorkerPool({
      maxWorkers: config.performance.maxWorkers,
      ...workerPoolOptions
    });

    this.connectionPool = new ConnectionPool({
      maxSockets: config.performance.maxWorkers * 2,
      ...connectionPoolOptions
    });

    this.streamProcessor = new StreamProcessor({
      chunkSize: 1000,
      memoryLimit: 100 * 1024 * 1024, // 100MB
      ...streamProcessorOptions
    });

    this.queueManager = new QueueManager({
      concurrency: config.performance.queueConcurrency,
      ...queueManagerOptions
    });

    // Performance metrics
    this.metrics = {
      startTime: Date.now(),
      totalOperations: 0,
      completedOperations: 0,
      failedOperations: 0,
      avgOperationTime: 0,
      memoryUsage: {
        current: 0,
        peak: 0
      },
      componentStats: {}
    };

    // Task routing configuration
    this.taskRouting = {
      // CPU-intensive tasks go to worker pool
      parseHtml: 'worker',
      extractContent: 'worker',
      analyzeText: 'worker',
      processStructuredData: 'worker',
      calculateSimilarity: 'worker',
      
      // I/O tasks go to connection pool
      fetchUrl: 'connection',
      downloadFile: 'connection',
      validateUrls: 'connection',
      
      // Large data processing goes to stream processor
      processBatch: 'stream',
      processLargeDataset: 'stream',
      transformData: 'stream',
      
      // Standard tasks go to queue manager
      default: 'queue'
    };

    this.setupEventHandlers();
    this.startMetricsCollection();
  }

  /**
   * Execute a task using the optimal performance component
   * @param {string} taskType - Type of task
   * @param {any} data - Task data
   * @param {Object} options - Task options
   * @returns {Promise<any>} - Task result
   */
  async executeTask(taskType, data, options = {}) {
    const startTime = Date.now();
    this.metrics.totalOperations++;

    try {
      const component = this.getOptimalComponent(taskType, data, options);
      const result = await this.executeOnComponent(component, taskType, data, options);
      
      this.updateSuccessMetrics(Date.now() - startTime);
      
      this.emit('taskCompleted', {
        taskType,
        component,
        duration: Date.now() - startTime,
        dataSize: this.getDataSize(data)
      });

      return result;

    } catch (error) {
      this.metrics.failedOperations++;
      
      this.emit('taskFailed', {
        taskType,
        error: error.message,
        duration: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * Execute multiple tasks with intelligent distribution
   * @param {Array} tasks - Array of {taskType, data, options} objects
   * @param {Object} batchOptions - Batch execution options
   * @returns {Promise<Array>} - Array of results
   */
  async executeBatch(tasks, batchOptions = {}) {
    const {
      strategy = 'auto', // 'auto', 'parallel', 'sequential', 'mixed'
      maxConcurrency = config.performance.maxWorkers,
      enableOptimization = true,
      groupBySimilarity = true
    } = batchOptions;

    if (enableOptimization && groupBySimilarity) {
      const groupedTasks = this.groupTasksBySimilarity(tasks);
      return await this.executeBatchGroups(groupedTasks, batchOptions);
    }

    switch (strategy) {
      case 'parallel':
        return await this.executeParallelBatch(tasks, batchOptions);
      case 'sequential':
        return await this.executeSequentialBatch(tasks, batchOptions);
      case 'mixed':
        return await this.executeMixedBatch(tasks, batchOptions);
      default:
        return await this.executeAutoBatch(tasks, batchOptions);
    }
  }

  /**
   * Process large dataset using stream processing
   * @param {Array|AsyncIterable} data - Data to process
   * @param {Function} processor - Processing function
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processing results
   */
  async processLargeDataset(data, processor, options = {}) {
    const {
      enableWorkerPool = true,
      enablePagination = true,
      chunkSize = 1000
    } = options;

    if (enableWorkerPool) {
      // Enhance processor to use worker pool for CPU-intensive operations
      const enhancedProcessor = async (item, index) => {
        if (this.isCpuIntensive(item)) {
          return await this.workerPool.execute('processItem', item, { timeout: 30000 });
        } else {
          return await processor(item, index);
        }
      };

      return await this.streamProcessor.processStream(data, enhancedProcessor, {
        ...options,
        enablePagination,
        chunkSize
      });
    } else {
      return await this.streamProcessor.processStream(data, processor, options);
    }
  }

  /**
   * Get optimal component for task execution
   * @param {string} taskType - Type of task
   * @param {any} data - Task data
   * @param {Object} options - Task options
   * @returns {string} - Component name
   */
  getOptimalComponent(taskType, data, options) {
    // Check explicit routing first
    if (this.taskRouting[taskType]) {
      return this.taskRouting[taskType];
    }

    // Auto-select based on task characteristics
    const dataSize = this.getDataSize(data);
    const isLargeDataset = dataSize > 10 * 1024 * 1024; // 10MB
    const isCpuIntensive = this.isCpuIntensive(data);
    const isNetworkOperation = this.isNetworkOperation(taskType);

    if (isLargeDataset && !isCpuIntensive) {
      return 'stream';
    } else if (isCpuIntensive) {
      return 'worker';
    } else if (isNetworkOperation) {
      return 'connection';
    } else {
      return 'queue';
    }
  }

  /**
   * Execute task on specific component
   * @param {string} component - Component name
   * @param {string} taskType - Task type
   * @param {any} data - Task data
   * @param {Object} options - Task options
   * @returns {Promise<any>} - Task result
   */
  async executeOnComponent(component, taskType, data, options) {
    switch (component) {
      case 'worker':
        return await this.workerPool.execute(taskType, data, options);
        
      case 'connection':
        if (taskType === 'fetchUrl' || taskType === 'downloadFile') {
          return await this.connectionPool.request({
            url: data.url || data,
            method: data.method || 'GET',
            headers: data.headers || {},
            ...options
          });
        } else {
          return await this.queueManager.add(async () => {
            return await this.executeNetworkTask(taskType, data, options);
          });
        }
        
      case 'stream':
        if (Array.isArray(data) || data[Symbol.asyncIterator]) {
          return await this.streamProcessor.processStream(
            data, 
            options.processor || (item => item), 
            options
          );
        } else {
          return await this.queueManager.add(async () => {
            return await this.executeStandardTask(taskType, data, options);
          });
        }
        
      case 'queue':
      default:
        return await this.queueManager.add(async () => {
          return await this.executeStandardTask(taskType, data, options);
        });
    }
  }

  /**
   * Execute auto-optimized batch
   * @param {Array} tasks - Tasks to execute
   * @param {Object} options - Batch options
   * @returns {Promise<Array>} - Results
   */
  async executeAutoBatch(tasks, options) {
    const groupedTasks = this.groupTasksByComponent(tasks);
    const results = [];

    // Execute each group with its optimal component
    for (const [component, componentTasks] of groupedTasks.entries()) {
      let componentResults;

      switch (component) {
        case 'worker':
          componentResults = await this.workerPool.executeBatch(
            componentTasks.map(t => ({ taskType: t.taskType, data: t.data, options: t.options })),
            { maxConcurrent: this.workerPool.maxWorkers }
          );
          break;

        case 'connection':
          componentResults = await this.connectionPool.requestBatch(
            componentTasks.map(t => ({
              url: t.data.url || t.data,
              method: t.data.method || 'GET',
              headers: t.data.headers || {},
              ...t.options
            })),
            { maxConcurrent: this.connectionPool.maxSockets * 0.8 }
          );
          break;

        case 'stream':
          // For stream tasks, process each one individually
          componentResults = [];
          for (const task of componentTasks) {
            const result = await this.streamProcessor.processStream(
              task.data,
              task.options.processor || (item => item),
              task.options
            );
            componentResults.push(result);
          }
          break;

        default:
          componentResults = await this.queueManager.addAll(
            componentTasks.map(t => () => this.executeStandardTask(t.taskType, t.data, t.options))
          );
      }

      results.push(...componentResults);
    }

    return results;
  }

  /**
   * Group tasks by optimal component
   * @param {Array} tasks - Tasks to group
   * @returns {Map} - Grouped tasks
   */
  groupTasksByComponent(tasks) {
    const groups = new Map();

    for (const task of tasks) {
      const component = this.getOptimalComponent(task.taskType, task.data, task.options);
      
      if (!groups.has(component)) {
        groups.set(component, []);
      }
      
      groups.get(component).push(task);
    }

    return groups;
  }

  /**
   * Group tasks by similarity for optimization
   * @param {Array} tasks - Tasks to group
   * @returns {Array} - Grouped tasks
   */
  groupTasksBySimilarity(tasks) {
    const groups = [];
    const taskMap = new Map();

    // Group by task type first
    for (const task of tasks) {
      const key = `${task.taskType}_${this.getOptimalComponent(task.taskType, task.data, task.options)}`;
      
      if (!taskMap.has(key)) {
        taskMap.set(key, []);
      }
      
      taskMap.get(key).push(task);
    }

    // Convert to array of groups
    for (const [key, taskGroup] of taskMap.entries()) {
      groups.push(taskGroup);
    }

    return groups;
  }

  /**
   * Execute batch groups
   * @param {Array} groups - Task groups
   * @param {Object} options - Batch options
   * @returns {Promise<Array>} - Results
   */
  async executeBatchGroups(groups, options) {
    const results = [];

    for (const group of groups) {
      const groupResults = await this.executeAutoBatch(group, options);
      results.push(...groupResults);
    }

    return results;
  }

  /**
   * Execute parallel batch
   * @param {Array} tasks - Tasks to execute
   * @param {Object} options - Batch options
   * @returns {Promise<Array>} - Results
   */
  async executeParallelBatch(tasks, options) {
    const { maxConcurrency = config.performance.maxWorkers } = options;
    const chunks = this.chunkArray(tasks, maxConcurrency);
    const results = [];

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(task => 
        this.executeTask(task.taskType, task.data, task.options)
      );
      
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Execute sequential batch
   * @param {Array} tasks - Tasks to execute
   * @param {Object} options - Batch options
   * @returns {Promise<Array>} - Results
   */
  async executeSequentialBatch(tasks, options) {
    const results = [];

    for (const task of tasks) {
      const result = await this.executeTask(task.taskType, task.data, task.options);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute mixed batch (some parallel, some sequential)
   * @param {Array} tasks - Tasks to execute
   * @param {Object} options - Batch options
   * @returns {Promise<Array>} - Results
   */
  async executeMixedBatch(tasks, options) {
    const parallelTasks = tasks.filter(task => this.canRunInParallel(task));
    const sequentialTasks = tasks.filter(task => !this.canRunInParallel(task));

    const parallelResults = await this.executeParallelBatch(parallelTasks, options);
    const sequentialResults = await this.executeSequentialBatch(sequentialTasks, options);

    // Merge results maintaining original order
    const results = new Array(tasks.length);
    let parallelIndex = 0;
    let sequentialIndex = 0;

    for (let i = 0; i < tasks.length; i++) {
      if (this.canRunInParallel(tasks[i])) {
        results[i] = parallelResults[parallelIndex++];
      } else {
        results[i] = sequentialResults[sequentialIndex++];
      }
    }

    return results;
  }

  /**
   * Check if task can run in parallel
   * @param {Object} task - Task object
   * @returns {boolean} - Whether task can run in parallel
   */
  canRunInParallel(task) {
    const parallelSafeTasks = ['parseHtml', 'extractContent', 'analyzeText', 'fetchUrl'];
    return parallelSafeTasks.includes(task.taskType);
  }

  /**
   * Execute network task
   * @param {string} taskType - Task type
   * @param {any} data - Task data
   * @param {Object} options - Task options
   * @returns {Promise<any>} - Task result
   */
  async executeNetworkTask(taskType, data, options) {
    // Implement network task execution
    // This would be specific to each task type
    switch (taskType) {
      case 'validateUrls':
        return await this.validateUrls(data, options);
      default:
        throw new Error(`Unknown network task type: ${taskType}`);
    }
  }

  /**
   * Execute standard task
   * @param {string} taskType - Task type
   * @param {any} data - Task data
   * @param {Object} options - Task options
   * @returns {Promise<any>} - Task result
   */
  async executeStandardTask(taskType, data, options = {}) {
    const startTime = Date.now();
    
    try {
      // Determine which component should handle this task
      const routingKey = this.taskRouting[taskType] || this.taskRouting.default;
      let result;
      
      switch (routingKey) {
        case 'worker':
          // CPU-intensive tasks go to worker pool
          result = await this.workerPool.execute({
            type: taskType,
            data,
            options
          });
          break;
          
        case 'connection':
          // I/O tasks use connection pool
          result = await this._executeIOTask(taskType, data, options);
          break;
          
        case 'stream':
          // Large data processing tasks
          result = await this.streamProcessor.process(data, {
            taskType,
            ...options
          });
          break;
          
        case 'queue':
        default:
          // Standard queue processing
          result = await this.queueManager.add(async () => {
            return await this._executeGenericTask(taskType, data, options);
          }, options);
          break;
      }
      
      // Update metrics
      this.metrics.completedOperations++;
      const duration = Date.now() - startTime;
      this.metrics.avgOperationTime = 
        (this.metrics.avgOperationTime * (this.metrics.completedOperations - 1) + duration) / 
        this.metrics.completedOperations;
      
      return result;
      
    } catch (error) {
      this.metrics.failedOperations++;
      throw new Error(`Task execution failed for ${taskType}: ${error.message}`);
    }
  }
  
  /**
   * Execute I/O intensive task using connection pool
   * @private
   */
  async _executeIOTask(taskType, data, options) {
    return new Promise((resolve, reject) => {
      const request = this.connectionPool.createRequest({
        taskType,
        data,
        options
      });
      
      request.on('response', (response) => {
        resolve(response);
      });
      
      request.on('error', (error) => {
        reject(error);
      });
      
      request.end();
    });
  }
  
  /**
   * Execute generic task
   * @private
   */
  async _executeGenericTask(taskType, data, options) {
    // Basic task execution for common operations
    switch (taskType) {
      case 'validateUrl':
        const url = new URL(data);
        return { valid: true, url: url.href };
        
      case 'normalizeData':
        return Array.isArray(data) ? data.filter(Boolean) : data;
        
      case 'calculateMetrics':
        return {
          size: JSON.stringify(data).length,
          timestamp: Date.now(),
          ...options
        };
        
      default:
        // For unknown task types, return the data as-is with metadata
        return {
          taskType,
          data,
          processed: true,
          timestamp: Date.now()
        };
    }
  }

  /**
   * Validate URLs
   * @param {Array} urls - URLs to validate
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} - Validation results
   */
  async validateUrls(urls, options) {
    const results = { valid: [], invalid: [] };
    
    for (const url of urls) {
      try {
        new URL(url);
        results.valid.push(url);
      } catch (error) {
        results.invalid.push({ url, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Get data size estimate
   * @param {any} data - Data to measure
   * @returns {number} - Size in bytes
   */
  getDataSize(data) {
    if (typeof data === 'string') {
      return Buffer.byteLength(data, 'utf8');
    } else if (Array.isArray(data)) {
      return data.length * 100; // Rough estimate
    } else if (typeof data === 'object' && data !== null) {
      return JSON.stringify(data).length;
    } else {
      return 0;
    }
  }

  /**
   * Check if task is CPU intensive
   * @param {any} data - Task data
   * @returns {boolean} - Whether task is CPU intensive
   */
  isCpuIntensive(data) {
    const dataSize = this.getDataSize(data);
    return dataSize > 100 * 1024; // 100KB threshold
  }

  /**
   * Check if task is network operation
   * @param {string} taskType - Task type
   * @returns {boolean} - Whether task is network operation
   */
  isNetworkOperation(taskType) {
    const networkTasks = ['fetchUrl', 'downloadFile', 'validateUrls', 'checkConnectivity'];
    return networkTasks.includes(taskType);
  }

  /**
   * Chunk array into smaller arrays
   * @param {Array} array - Array to chunk
   * @param {number} chunkSize - Size of each chunk
   * @returns {Array} - Array of chunks
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Update success metrics
   * @param {number} duration - Operation duration
   */
  updateSuccessMetrics(duration) {
    this.metrics.completedOperations++;
    
    const total = this.metrics.completedOperations;
    this.metrics.avgOperationTime = (
      (this.metrics.avgOperationTime * (total - 1) + duration) / total
    );
  }

  /**
   * Setup event handlers for all components
   */
  setupEventHandlers() {
    // Worker pool events
    this.workerPool.on('taskCompleted', (data) => {
      this.emit('workerTaskCompleted', data);
    });

    this.workerPool.on('taskFailed', (data) => {
      this.emit('workerTaskFailed', data);
    });

    // Connection pool events
    this.connectionPool.on('requestCompleted', (data) => {
      this.emit('connectionRequestCompleted', data);
    });

    this.connectionPool.on('requestFailed', (data) => {
      this.emit('connectionRequestFailed', data);
    });

    this.connectionPool.on('backpressureActivated', (data) => {
      this.emit('connectionBackpressure', data);
    });

    // Stream processor events
    this.streamProcessor.on('itemProcessed', (data) => {
      this.emit('streamItemProcessed', data);
    });

    this.streamProcessor.on('memoryPressure', (data) => {
      this.emit('streamMemoryPressure', data);
    });

    // Queue manager events
    this.queueManager.queue.on('completed', () => {
      this.emit('queueTaskCompleted');
    });

    this.queueManager.queue.on('error', (error) => {
      this.emit('queueTaskFailed', { error: error.message });
    });
  }

  /**
   * Start metrics collection
   */
  startMetricsCollection() {
    if (!this.enableMetrics) return;

    this.metricsTimer = setInterval(() => {
      this.collectMetrics();
    }, this.metricsInterval);
  }

  /**
   * Collect metrics from all components
   */
  collectMetrics() {
    const memUsage = process.memoryUsage();
    
    this.metrics.memoryUsage = {
      current: memUsage.heapUsed,
      peak: Math.max(this.metrics.memoryUsage.peak || 0, memUsage.heapUsed)
    };

    this.metrics.componentStats = {
      workerPool: this.workerPool.getStats(),
      connectionPool: this.connectionPool.getStats(),
      streamProcessor: this.streamProcessor.getStats(),
      queueManager: this.queueManager.getStats()
    };

    this.emit('metricsCollected', this.metrics);
  }

  /**
   * Get comprehensive performance metrics
   * @returns {Object} - Performance metrics
   */
  getMetrics() {
    this.collectMetrics(); // Get latest metrics
    
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime,
      operationsPerSecond: this.metrics.completedOperations / ((Date.now() - this.metrics.startTime) / 1000)
    };
  }

  /**
   * Reset all performance metrics
   */
  resetMetrics() {
    this.metrics = {
      startTime: Date.now(),
      totalOperations: 0,
      completedOperations: 0,
      failedOperations: 0,
      avgOperationTime: 0,
      memoryUsage: { current: 0, peak: 0 },
      componentStats: {}
    };
  }

  /**
   * Graceful shutdown of all components
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.emit('shutdown');

    // Stop metrics collection
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }

    // Shutdown all components
    await Promise.all([
      this.workerPool.shutdown(),
      this.connectionPool.shutdown(),
      this.streamProcessor.shutdown()
    ]);

    this.emit('shutdownComplete');
  }
}

export default PerformanceManager;
/**
 * WorkerPool - Manages a pool of worker threads for CPU-intensive tasks
 * Integrates with QueueManager for efficient task distribution
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { EventEmitter } from 'events';
import { config } from '../../constants/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WorkerPool extends EventEmitter {
  constructor(options = {}) {
    super();
    
    const {
      maxWorkers = config.performance.maxWorkers,
      workerScript = join(__dirname, 'worker.js'),
      taskTimeout = 30000,
      idleTimeout = 60000,
      retryAttempts = 3
    } = options;

    this.maxWorkers = maxWorkers;
    this.workerScript = workerScript;
    this.taskTimeout = taskTimeout;
    this.idleTimeout = idleTimeout;
    this.retryAttempts = retryAttempts;

    // Worker management
    this.workers = new Set();
    this.availableWorkers = [];
    this.busyWorkers = new Map();
    this.taskQueue = [];
    
    // Statistics
    this.stats = {
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksQueued: 0,
      workersCreated: 0,
      workersDestroyed: 0,
      avgTaskDuration: 0,
      peakWorkerCount: 0
    };

    // Task tracking
    this.activeTasks = new Map();
    this.taskIdCounter = 0;

    // Cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleWorkers();
    }, this.idleTimeout / 2);

    this.setupGracefulShutdown();
  }

  /**
   * Execute a task using the worker pool
   * @param {string} taskType - Type of task to execute
   * @param {any} data - Task data
   * @param {Object} options - Task options
   * @returns {Promise<any>} - Task result
   */
  async execute(taskType, data, options = {}) {
    const taskId = this.generateTaskId();
    const { timeout = this.taskTimeout, priority = 0, retries = this.retryAttempts } = options;

    const task = {
      id: taskId,
      type: taskType,
      data,
      timeout,
      priority,
      retries,
      startTime: Date.now(),
      attempts: 0
    };

    this.stats.tasksQueued++;
    this.emit('taskQueued', { taskId, taskType });

    return new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;

      // Add to queue or execute immediately if worker available
      if (this.availableWorkers.length > 0) {
        this.executeTask(task);
      } else {
        this.addToQueue(task);
        this.maybeCreateWorker();
      }
    });
  }

  /**
   * Execute multiple tasks in parallel with optional batching
   * @param {Array} tasks - Array of {taskType, data, options} objects
   * @param {Object} batchOptions - Batching options
   * @returns {Promise<Array>} - Array of results
   */
  async executeBatch(tasks, batchOptions = {}) {
    const { maxConcurrent = this.maxWorkers, failFast = false } = batchOptions;
    
    const chunks = this.chunkArray(tasks, maxConcurrent);
    const results = [];

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(({ taskType, data, options }) => 
        this.execute(taskType, data, options).catch(error => {
          if (failFast) throw error;
          return { error: error.message };
        })
      );

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);

      if (failFast && chunkResults.some(result => result && result.error)) {
        throw new Error('Batch execution failed fast');
      }
    }

    return results;
  }

  /**
   * Add task to priority queue
   * @param {Object} task - Task object
   */
  addToQueue(task) {
    // Insert task in priority order (higher priority first)
    let insertIndex = this.taskQueue.length;
    for (let i = 0; i < this.taskQueue.length; i++) {
      if (this.taskQueue[i].priority < task.priority) {
        insertIndex = i;
        break;
      }
    }
    this.taskQueue.splice(insertIndex, 0, task);
  }

  /**
   * Execute a task using an available worker
   * @param {Object} task - Task object
   */
  async executeTask(task) {
    let worker = this.getAvailableWorker();
    
    if (!worker) {
      // Create new worker if under limit
      if (this.workers.size < this.maxWorkers) {
        worker = await this.createWorker();
      } else {
        // Queue the task
        this.addToQueue(task);
        return;
      }
    }

    this.assignTaskToWorker(task, worker);
  }

  /**
   * Assign a task to a specific worker
   * @param {Object} task - Task object
   * @param {Worker} worker - Worker instance
   */
  assignTaskToWorker(task, worker) {
    task.attempts++;
    task.worker = worker;
    
    // Remove worker from available pool
    const workerIndex = this.availableWorkers.indexOf(worker);
    if (workerIndex !== -1) {
      this.availableWorkers.splice(workerIndex, 1);
    }

    // Add to busy workers
    this.busyWorkers.set(worker, task);
    this.activeTasks.set(task.id, task);

    // Set up timeout
    const timeoutId = setTimeout(() => {
      this.handleTaskTimeout(task);
    }, task.timeout);

    task.timeoutId = timeoutId;

    // Send task to worker
    worker.postMessage({
      taskId: task.id,
      type: task.type,
      data: task.data
    });

    this.emit('taskStarted', { 
      taskId: task.id, 
      taskType: task.type, 
      workerId: worker.threadId 
    });
  }

  /**
   * Handle task completion
   * @param {Object} task - Task object
   * @param {any} result - Task result
   * @param {Error} error - Task error (if any)
   */
  handleTaskCompletion(task, result, error) {
    const duration = Date.now() - task.startTime;
    
    // Update statistics
    this.updateTaskStats(duration, !error);

    // Clear timeout
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
    }

    // Remove from active tasks
    this.activeTasks.delete(task.id);

    // Return worker to available pool
    if (task.worker) {
      this.busyWorkers.delete(task.worker);
      this.availableWorkers.push(task.worker);
      task.worker.lastUsed = Date.now();
    }

    // Resolve or reject the task promise
    if (error && task.attempts < task.retries) {
      // Retry the task
      setTimeout(() => {
        this.executeTask(task);
      }, 1000 * task.attempts); // Exponential backoff
    } else if (error) {
      task.reject(error);
      this.emit('taskFailed', { 
        taskId: task.id, 
        taskType: task.type, 
        error: error.message,
        attempts: task.attempts 
      });
    } else {
      task.resolve(result);
      this.emit('taskCompleted', { 
        taskId: task.id, 
        taskType: task.type, 
        duration 
      });
    }

    // Process next task in queue
    this.processNextTask();
  }

  /**
   * Handle task timeout
   * @param {Object} task - Task object
   */
  handleTaskTimeout(task) {
    const error = new Error(`Task ${task.id} timed out after ${task.timeout}ms`);
    
    // Terminate the worker if it's unresponsive
    if (task.worker) {
      this.terminateWorker(task.worker);
    }

    this.handleTaskCompletion(task, null, error);
  }

  /**
   * Process the next task in the queue
   */
  processNextTask() {
    if (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      const nextTask = this.taskQueue.shift();
      this.executeTask(nextTask);
    }
  }

  /**
   * Get an available worker from the pool
   * @returns {Worker|null} - Available worker or null
   */
  getAvailableWorker() {
    return this.availableWorkers.length > 0 ? this.availableWorkers[0] : null;
  }

  /**
   * Create a new worker
   * @returns {Promise<Worker>} - Worker instance
   */
  async createWorker() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.workerScript);
      
      worker.on('message', (message) => {
        this.handleWorkerMessage(worker, message);
      });

      worker.on('error', (error) => {
        this.handleWorkerError(worker, error);
      });

      worker.on('exit', (code) => {
        this.handleWorkerExit(worker, code);
      });

      worker.on('online', () => {
        this.workers.add(worker);
        this.availableWorkers.push(worker);
        worker.createdAt = Date.now();
        worker.lastUsed = Date.now();
        
        this.stats.workersCreated++;
        this.stats.peakWorkerCount = Math.max(this.stats.peakWorkerCount, this.workers.size);
        
        this.emit('workerCreated', { workerId: worker.threadId });
        resolve(worker);
      });

      // Set creation timeout
      const timeout = setTimeout(() => {
        reject(new Error('Worker creation timeout'));
      }, 10000);

      worker.once('online', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Handle worker message
   * @param {Worker} worker - Worker instance
   * @param {Object} message - Message from worker
   */
  handleWorkerMessage(worker, message) {
    const { taskId, result, error } = message;
    const task = this.activeTasks.get(taskId);

    if (!task) {
      console.warn(`Received message for unknown task: ${taskId}`);
      return;
    }

    const taskError = error ? new Error(error) : null;
    this.handleTaskCompletion(task, result, taskError);
  }

  /**
   * Handle worker error
   * @param {Worker} worker - Worker instance
   * @param {Error} error - Worker error
   */
  handleWorkerError(worker, error) {
    console.error(`Worker ${worker.threadId} error:`, error);
    
    const task = this.busyWorkers.get(worker);
    if (task) {
      this.handleTaskCompletion(task, null, error);
    }

    this.terminateWorker(worker);
  }

  /**
   * Handle worker exit
   * @param {Worker} worker - Worker instance
   * @param {number} code - Exit code
   */
  handleWorkerExit(worker, code) {
    this.workers.delete(worker);
    this.stats.workersDestroyed++;

    // Remove from available workers
    const availableIndex = this.availableWorkers.indexOf(worker);
    if (availableIndex !== -1) {
      this.availableWorkers.splice(availableIndex, 1);
    }

    // Handle any active task
    const task = this.busyWorkers.get(worker);
    if (task) {
      const error = new Error(`Worker exited with code ${code}`);
      this.handleTaskCompletion(task, null, error);
    }

    this.emit('workerExited', { workerId: worker.threadId, code });
  }

  /**
   * Terminate a worker
   * @param {Worker} worker - Worker instance
   */
  async terminateWorker(worker) {
    try {
      await worker.terminate();
    } catch (error) {
      console.error(`Error terminating worker ${worker.threadId}:`, error);
    }
  }

  /**
   * Create a new worker if conditions are met
   */
  maybeCreateWorker() {
    if (this.workers.size < this.maxWorkers && 
        this.taskQueue.length > 0 && 
        this.availableWorkers.length === 0) {
      this.createWorker().catch(error => {
        console.error('Failed to create worker:', error);
      });
    }
  }

  /**
   * Clean up idle workers
   */
  cleanupIdleWorkers() {
    const now = Date.now();
    const workersToTerminate = [];

    for (const worker of this.availableWorkers) {
      if (now - worker.lastUsed > this.idleTimeout) {
        workersToTerminate.push(worker);
      }
    }

    // Keep at least one worker alive
    if (this.availableWorkers.length - workersToTerminate.length < 1) {
      workersToTerminate.pop();
    }

    for (const worker of workersToTerminate) {
      this.terminateWorker(worker);
    }
  }

  /**
   * Update task statistics
   * @param {number} duration - Task duration
   * @param {boolean} success - Whether task succeeded
   */
  updateTaskStats(duration, success) {
    if (success) {
      this.stats.tasksCompleted++;
    } else {
      this.stats.tasksFailed++;
    }

    // Update average duration
    const totalTasks = this.stats.tasksCompleted + this.stats.tasksFailed;
    this.stats.avgTaskDuration = (
      (this.stats.avgTaskDuration * (totalTasks - 1) + duration) / totalTasks
    );
  }

  /**
   * Generate unique task ID
   * @returns {string} - Task ID
   */
  generateTaskId() {
    return `task_${++this.taskIdCounter}_${Date.now()}`;
  }

  /**
   * Split array into chunks
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
   * Get worker pool statistics
   * @returns {Object} - Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      activeWorkers: this.workers.size,
      availableWorkers: this.availableWorkers.length,
      busyWorkers: this.busyWorkers.size,
      queuedTasks: this.taskQueue.length,
      activeTasks: this.activeTasks.size
    };
  }

  /**
   * Pause the worker pool
   */
  pause() {
    this.paused = true;
    this.emit('paused');
  }

  /**
   * Resume the worker pool
   */
  resume() {
    this.paused = false;
    this.emit('resumed');
    
    // Process any queued tasks
    while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      this.processNextTask();
    }
  }

  /**
   * Gracefully shutdown the worker pool
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.emit('shutdown');
    
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Wait for active tasks to complete or timeout
    const shutdownTimeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.activeTasks.size > 0 && (Date.now() - startTime) < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Terminate all workers
    const terminationPromises = Array.from(this.workers).map(worker => 
      this.terminateWorker(worker)
    );

    await Promise.all(terminationPromises);
    
    this.workers.clear();
    this.availableWorkers.length = 0;
    this.busyWorkers.clear();
    this.activeTasks.clear();
    this.taskQueue.length = 0;
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const shutdown = async () => {
      console.log('WorkerPool: Graceful shutdown initiated');
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

export default WorkerPool;
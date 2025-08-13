/**
 * JobManager - Async job management with persistence, tracking, and cancellation
 * Supports job creation, status tracking, persistence, expiration, and cancellation
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export class JobManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    const {
      storageDir = './jobs',
      defaultTtl = 24 * 60 * 60 * 1000, // 24 hours
      cleanupInterval = 60 * 60 * 1000, // 1 hour
      enablePersistence = true,
      maxJobs = 1000,
      enableMonitoring = true,
      monitoringInterval = 30000 // 30 seconds
    } = options;

    this.storageDir = storageDir;
    this.defaultTtl = defaultTtl;
    this.enablePersistence = enablePersistence;
    this.maxJobs = maxJobs;
    this.enableMonitoring = enableMonitoring;

    // In-memory job storage
    this.jobs = new Map();
    this.jobsByStatus = new Map([
      ['pending', new Set()],
      ['running', new Set()],
      ['completed', new Set()],
      ['failed', new Set()],
      ['cancelled', new Set()]
    ]);

    // Job execution callbacks
    this.executors = new Map();

    // Statistics
    this.stats = {
      totalJobs: 0,
      activeJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      cancelledJobs: 0,
      averageExecutionTime: 0,
      lastUpdated: Date.now()
    };

    // Job states
    this.JOB_STATES = {
      PENDING: 'pending',
      RUNNING: 'running',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled'
    };

    // Initialize storage if persistence enabled
    if (this.enablePersistence) {
      this.initStorage();
    }

    // Start cleanup interval
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredJobs();
    }, cleanupInterval);

    // Start monitoring if enabled
    if (this.enableMonitoring) {
      this.startMonitoring(monitoringInterval);
    }
  }

  /**
   * Initialize persistent storage
   */
  async initStorage() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      // Load existing jobs on startup
      await this.loadPersistedJobs();
    } catch (error) {
      console.error('Failed to initialize job storage:', error);
      this.enablePersistence = false;
    }
  }

  /**
   * Create a new job
   * @param {string} type - Job type identifier
   * @param {Object} data - Job data/payload
   * @param {Object} options - Job options
   * @returns {Promise<Object>} Job object
   */
  async createJob(type, data = {}, options = {}) {
    const {
      priority = 0,
      ttl = this.defaultTtl,
      maxRetries = 0,
      retryDelay = 5000,
      webhooks = [],
      tags = [],
      dependencies = [],
      metadata = {}
    } = options;

    // Generate unique job ID
    const jobId = this.generateJobId();
    const now = Date.now();

    const job = {
      id: jobId,
      type,
      data,
      status: this.JOB_STATES.PENDING,
      priority,
      ttl,
      maxRetries,
      currentRetries: 0,
      retryDelay,
      webhooks,
      tags,
      dependencies,
      metadata,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ttl,
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      progress: 0,
      logs: []
    };

    // Store job
    this.jobs.set(jobId, job);
    this.jobsByStatus.get(this.JOB_STATES.PENDING).add(jobId);

    // Persist if enabled
    if (this.enablePersistence) {
      await this.persistJob(job);
    }

    // Update statistics
    this.stats.totalJobs++;
    this.stats.activeJobs++;
    this.updateStats();

    this.emit('jobCreated', job);
    return job;
  }

  /**
   * Get job by ID
   * @param {string} jobId - Job identifier
   * @returns {Object|null} Job object or null if not found
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get jobs by status
   * @param {string} status - Job status
   * @returns {Array} Array of job objects
   */
  getJobsByStatus(status) {
    const jobIds = this.jobsByStatus.get(status);
    if (!jobIds) return [];

    return Array.from(jobIds)
      .map(id => this.jobs.get(id))
      .filter(Boolean);
  }

  /**
   * Get jobs by type
   * @param {string} type - Job type
   * @returns {Array} Array of job objects
   */
  getJobsByType(type) {
    return Array.from(this.jobs.values())
      .filter(job => job.type === type);
  }

  /**
   * Get jobs by tag
   * @param {string} tag - Job tag
   * @returns {Array} Array of job objects
   */
  getJobsByTag(tag) {
    return Array.from(this.jobs.values())
      .filter(job => job.tags.includes(tag));
  }

  /**
   * Update job status
   * @param {string} jobId - Job identifier
   * @param {string} status - New status
   * @param {Object} updates - Additional updates
   * @returns {Promise<Object>} Updated job object
   */
  async updateJobStatus(jobId, status, updates = {}) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Remove from old status set
    this.jobsByStatus.get(job.status).delete(jobId);

    // Update job
    job.status = status;
    job.updatedAt = Date.now();

    // Add status-specific updates
    switch (status) {
      case this.JOB_STATES.RUNNING:
        job.startedAt = Date.now();
        break;
      case this.JOB_STATES.COMPLETED:
        job.completedAt = Date.now();
        job.result = updates.result || null;
        this.stats.completedJobs++;
        this.stats.activeJobs--;
        break;
      case this.JOB_STATES.FAILED:
        job.completedAt = Date.now();
        job.error = updates.error || null;
        this.stats.failedJobs++;
        this.stats.activeJobs--;
        break;
      case this.JOB_STATES.CANCELLED:
        job.completedAt = Date.now();
        this.stats.cancelledJobs++;
        this.stats.activeJobs--;
        break;
    }

    // Apply additional updates
    Object.assign(job, updates);

    // Add to new status set
    this.jobsByStatus.get(status).add(jobId);

    // Persist if enabled
    if (this.enablePersistence) {
      await this.persistJob(job);
    }

    this.updateStats();
    this.emit('jobUpdated', job, status);
    
    return job;
  }

  /**
   * Execute a job
   * @param {string} jobId - Job identifier
   * @returns {Promise<Object>} Job result
   */
  async executeJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== this.JOB_STATES.PENDING) {
      throw new Error(`Job ${jobId} is not in pending status (current: ${job.status})`);
    }

    // Check dependencies
    const unmetDependencies = await this.checkDependencies(job);
    if (unmetDependencies.length > 0) {
      const depList = unmetDependencies.join(', ');
      throw new Error(`Job ${jobId} has unmet dependencies: ${depList}`);
    }

    const executor = this.executors.get(job.type);
    if (!executor) {
      await this.updateJobStatus(jobId, this.JOB_STATES.FAILED, {
        error: `No executor registered for job type: ${job.type}`
      });
      throw new Error(`No executor registered for job type: ${job.type}`);
    }

    await this.updateJobStatus(jobId, this.JOB_STATES.RUNNING);

    try {
      const result = await executor(job);
      await this.updateJobStatus(jobId, this.JOB_STATES.COMPLETED, { result });
      
      // Calculate execution time
      const executionTime = job.completedAt - job.startedAt;
      this.updateExecutionTime(executionTime);

      return result;
    } catch (error) {
      // Handle retries
      if (job.currentRetries < job.maxRetries) {
        job.currentRetries++;
        await this.updateJobStatus(jobId, this.JOB_STATES.PENDING, {
          error: error.message,
          currentRetries: job.currentRetries
        });

        // Schedule retry
        setTimeout(() => {
          this.executeJob(jobId).catch(() => {
            // Retry failed, will be handled in next execution
          });
        }, job.retryDelay);

        throw error;
      } else {
        await this.updateJobStatus(jobId, this.JOB_STATES.FAILED, {
          error: error.message
        });
        throw error;
      }
    }
  }

  /**
   * Cancel a job
   * @param {string} jobId - Job identifier
   * @returns {Promise<Object>} Cancelled job object
   */
  async cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if ([this.JOB_STATES.COMPLETED, this.JOB_STATES.FAILED, this.JOB_STATES.CANCELLED].includes(job.status)) {
      throw new Error(`Job ${jobId} cannot be cancelled (current status: ${job.status})`);
    }

    await this.updateJobStatus(jobId, this.JOB_STATES.CANCELLED);
    this.emit('jobCancelled', job);
    
    return job;
  }

  /**
   * Register job executor
   * @param {string} type - Job type
   * @param {Function} executor - Executor function
   */
  registerExecutor(type, executor) {
    this.executors.set(type, executor);
    this.emit('executorRegistered', type);
  }

  /**
   * Unregister job executor
   * @param {string} type - Job type
   */
  unregisterExecutor(type) {
    this.executors.delete(type);
    this.emit('executorUnregistered', type);
  }

  /**
   * Add log entry to job
   * @param {string} jobId - Job identifier
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} data - Additional log data
   */
  async addJobLog(jobId, level, message, data = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const logEntry = {
      timestamp: Date.now(),
      level,
      message,
      data
    };

    job.logs.push(logEntry);
    job.updatedAt = Date.now();

    // Keep only last 100 log entries
    if (job.logs.length > 100) {
      job.logs = job.logs.slice(-100);
    }

    // Persist if enabled
    if (this.enablePersistence) {
      await this.persistJob(job);
    }

    this.emit('jobLog', job, logEntry);
  }

  /**
   * Update job progress
   * @param {string} jobId - Job identifier
   * @param {number} progress - Progress percentage (0-100)
   * @param {string} message - Progress message
   */
  async updateJobProgress(jobId, progress, message = '') {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.progress = Math.max(0, Math.min(100, progress));
    job.updatedAt = Date.now();

    if (message) {
      await this.addJobLog(jobId, 'info', message, { progress });
    }

    // Persist if enabled
    if (this.enablePersistence) {
      await this.persistJob(job);
    }

    this.emit('jobProgress', job, progress, message);
  }

  /**
   * Check job dependencies
   * @param {Object} job - Job object
   * @returns {Promise<Array>} Array of unmet dependency IDs
   */
  async checkDependencies(job) {
    if (!job.dependencies || job.dependencies.length === 0) {
      return [];
    }

    const unmetDependencies = [];

    for (const depId of job.dependencies) {
      const depJob = this.jobs.get(depId);
      if (!depJob || depJob.status !== this.JOB_STATES.COMPLETED) {
        unmetDependencies.push(depId);
      }
    }

    return unmetDependencies;
  }

  /**
   * Cleanup expired jobs
   */
  async cleanupExpiredJobs() {
    const now = Date.now();
    const expiredJobs = [];

    for (const [jobId, job] of this.jobs) {
      if (job.expiresAt && now > job.expiresAt) {
        expiredJobs.push(jobId);
      }
    }

    for (const jobId of expiredJobs) {
      await this.removeJob(jobId);
      this.emit('jobExpired', jobId);
    }

    if (expiredJobs.length > 0) {
      this.updateStats();
    }
  }

  /**
   * Remove job from storage
   * @param {string} jobId - Job identifier
   */
  async removeJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Remove from status set
    this.jobsByStatus.get(job.status).delete(jobId);

    // Remove from memory
    this.jobs.delete(jobId);

    // Remove from persistent storage
    if (this.enablePersistence) {
      await this.removePersistedJob(jobId);
    }

    this.emit('jobRemoved', jobId);
  }

  /**
   * Persist job to disk
   * @param {Object} job - Job object
   */
  async persistJob(job) {
    if (!this.enablePersistence) return;

    try {
      const filePath = path.join(this.storageDir, `${job.id}.json`);
      const data = JSON.stringify(job, null, 2);
      await fs.writeFile(filePath, data, 'utf8');
    } catch (error) {
      console.error(`Failed to persist job ${job.id}:`, error);
    }
  }

  /**
   * Remove persisted job
   * @param {string} jobId - Job identifier
   */
  async removePersistedJob(jobId) {
    if (!this.enablePersistence) return;

    try {
      const filePath = path.join(this.storageDir, `${jobId}.json`);
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if (error.code !== 'ENOENT') {
        console.error(`Failed to remove persisted job ${jobId}:`, error);
      }
    }
  }

  /**
   * Load persisted jobs on startup
   */
  async loadPersistedJobs() {
    if (!this.enablePersistence) return;

    try {
      const files = await fs.readdir(this.storageDir);
      const jsonFiles = files.filter(file => file.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.storageDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const job = JSON.parse(data);

          // Validate job structure
          if (this.validateJob(job)) {
            this.jobs.set(job.id, job);
            this.jobsByStatus.get(job.status).add(job.id);
            
            // Update running jobs to failed on restart (they were interrupted)
            if (job.status === this.JOB_STATES.RUNNING) {
              await this.updateJobStatus(job.id, this.JOB_STATES.FAILED, {
                error: 'Job was interrupted by system restart'
              });
            }
          }
        } catch (error) {
          console.error(`Failed to load job from ${file}:`, error);
        }
      }

      this.updateStats();
    } catch (error) {
      console.error('Failed to load persisted jobs:', error);
    }
  }

  /**
   * Validate job object structure
   * @param {Object} job - Job object to validate
   * @returns {boolean} Whether job is valid
   */
  validateJob(job) {
    return job &&
           typeof job.id === 'string' &&
           typeof job.type === 'string' &&
           typeof job.status === 'string' &&
           Object.values(this.JOB_STATES).includes(job.status);
  }

  /**
   * Generate unique job ID
   * @returns {string} Unique job identifier
   */
  generateJobId() {
    return crypto.randomUUID();
  }

  /**
   * Update execution time statistics
   * @param {number} executionTime - Execution time in milliseconds
   */
  updateExecutionTime(executionTime) {
    const currentAverage = this.stats.averageExecutionTime;
    const completedJobs = this.stats.completedJobs;
    
    if (completedJobs === 1) {
      this.stats.averageExecutionTime = executionTime;
    } else {
      this.stats.averageExecutionTime = 
        ((currentAverage * (completedJobs - 1)) + executionTime) / completedJobs;
    }
  }

  /**
   * Update statistics
   */
  updateStats() {
    this.stats.activeJobs = 
      this.jobsByStatus.get(this.JOB_STATES.PENDING).size +
      this.jobsByStatus.get(this.JOB_STATES.RUNNING).size;
    
    this.stats.lastUpdated = Date.now();
  }

  /**
   * Start monitoring
   * @param {number} interval - Monitoring interval in milliseconds
   */
  startMonitoring(interval) {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }

    this.monitoringTimer = setInterval(() => {
      this.updateStats();
      this.emit('monitoring', this.getStats());
    }, interval);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
  }

  /**
   * Get comprehensive statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      jobCounts: {
        pending: this.jobsByStatus.get(this.JOB_STATES.PENDING).size,
        running: this.jobsByStatus.get(this.JOB_STATES.RUNNING).size,
        completed: this.jobsByStatus.get(this.JOB_STATES.COMPLETED).size,
        failed: this.jobsByStatus.get(this.JOB_STATES.FAILED).size,
        cancelled: this.jobsByStatus.get(this.JOB_STATES.CANCELLED).size
      },
      totalJobsInMemory: this.jobs.size,
      executorCount: this.executors.size
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    // Clear timers
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }

    // Clear data
    this.jobs.clear();
    this.jobsByStatus.forEach(set => set.clear());
    this.executors.clear();

    // Remove event listeners
    this.removeAllListeners();
    
    this.emit('destroyed');
  }
}

export default JobManager;

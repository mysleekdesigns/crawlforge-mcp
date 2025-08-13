/**
 * Unit tests for JobManager
 */

import { describe, it, beforeEach, afterEach, expect } from '@jest/globals';
import { jest } from '@jest/globals';
import JobManager from '../../src/core/JobManager.js';
import { promises as fs } from 'fs';
import path from 'path';

// Mock filesystem
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn()
  }
}));

describe('JobManager', () => {
  let jobManager;
  const testStorageDir = './test-jobs';

  beforeEach(() => {
    jest.clearAllMocks();
    jobManager = new JobManager({
      storageDir: testStorageDir,
      enablePersistence: false, // Disable for most tests
      enableMonitoring: false,
      cleanupInterval: 1000000 // Very long interval for tests
    });
  });

  afterEach(async () => {
    if (jobManager) {
      await jobManager.destroy();
    }
  });

  describe('Job Creation and Management', () => {
    it('should create a new job with default options', async () => {
      const job = await jobManager.createJob('test-job', { message: 'hello' });

      expect(job).toMatchObject({
        type: 'test-job',
        data: { message: 'hello' },
        status: 'pending',
        priority: 0,
        maxRetries: 0,
        currentRetries: 0,
        progress: 0
      });
      expect(job.id).toBeDefined();
      expect(job.createdAt).toBeDefined();
      expect(job.expiresAt).toBeDefined();
    });

    it('should create a job with custom options', async () => {
      const options = {
        priority: 5,
        ttl: 60000,
        maxRetries: 3,
        webhooks: ['http://example.com/webhook'],
        tags: ['test', 'urgent'],
        metadata: { user: 'testUser' }
      };

      const job = await jobManager.createJob('custom-job', { data: 'test' }, options);

      expect(job).toMatchObject({
        type: 'custom-job',
        data: { data: 'test' },
        priority: 5,
        maxRetries: 3,
        webhooks: ['http://example.com/webhook'],
        tags: ['test', 'urgent'],
        metadata: { user: 'testUser' }
      });
      expect(job.expiresAt - job.createdAt).toBe(60000);
    });

    it('should retrieve job by ID', async () => {
      const job = await jobManager.createJob('retrieve-test', { data: 'test' });
      const retrieved = jobManager.getJob(job.id);

      expect(retrieved).toEqual(job);
    });

    it('should return null for non-existent job', () => {
      const retrieved = jobManager.getJob('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should get jobs by status', async () => {
      const job1 = await jobManager.createJob('status-test-1', {});
      const job2 = await jobManager.createJob('status-test-2', {});
      await jobManager.updateJobStatus(job2.id, 'running');

      const pendingJobs = jobManager.getJobsByStatus('pending');
      const runningJobs = jobManager.getJobsByStatus('running');

      expect(pendingJobs).toHaveLength(1);
      expect(pendingJobs[0].id).toBe(job1.id);
      expect(runningJobs).toHaveLength(1);
      expect(runningJobs[0].id).toBe(job2.id);
    });

    it('should get jobs by type', async () => {
      await jobManager.createJob('type-a', {});
      await jobManager.createJob('type-b', {});
      await jobManager.createJob('type-a', {});

      const typeAJobs = jobManager.getJobsByType('type-a');
      const typeBJobs = jobManager.getJobsByType('type-b');

      expect(typeAJobs).toHaveLength(2);
      expect(typeBJobs).toHaveLength(1);
    });

    it('should get jobs by tag', async () => {
      await jobManager.createJob('tagged-1', {}, { tags: ['urgent', 'test'] });
      await jobManager.createJob('tagged-2', {}, { tags: ['normal', 'test'] });
      await jobManager.createJob('tagged-3', {}, { tags: ['urgent'] });

      const urgentJobs = jobManager.getJobsByTag('urgent');
      const testJobs = jobManager.getJobsByTag('test');

      expect(urgentJobs).toHaveLength(2);
      expect(testJobs).toHaveLength(2);
    });
  });

  describe('Job Status Management', () => {
    it('should update job status correctly', async () => {
      const job = await jobManager.createJob('status-update', {});
      
      const updatedJob = await jobManager.updateJobStatus(job.id, 'running');

      expect(updatedJob.status).toBe('running');
      expect(updatedJob.startedAt).toBeDefined();
      expect(updatedJob.updatedAt).toBeGreaterThan(job.updatedAt);
    });

    it('should update statistics when job completes', async () => {
      const job = await jobManager.createJob('completion-test', {});
      const initialStats = jobManager.getStats();

      await jobManager.updateJobStatus(job.id, 'completed', { result: 'success' });

      const finalStats = jobManager.getStats();
      expect(finalStats.completedJobs).toBe(initialStats.completedJobs + 1);
      expect(finalStats.activeJobs).toBe(initialStats.activeJobs - 1);
    });

    it('should handle job completion with results', async () => {
      const job = await jobManager.createJob('result-test', {});
      const result = { output: 'processed data' };

      await jobManager.updateJobStatus(job.id, 'completed', { result });

      const completedJob = jobManager.getJob(job.id);
      expect(completedJob.result).toEqual(result);
      expect(completedJob.completedAt).toBeDefined();
    });

    it('should handle job failure with error', async () => {
      const job = await jobManager.createJob('error-test', {});
      const error = 'Processing failed';

      await jobManager.updateJobStatus(job.id, 'failed', { error });

      const failedJob = jobManager.getJob(job.id);
      expect(failedJob.error).toBe(error);
      expect(failedJob.completedAt).toBeDefined();
    });
  });

  describe('Job Execution', () => {
    it('should execute job with registered executor', async () => {
      const mockExecutor = jest.fn().mockResolvedValue('execution result');
      jobManager.registerExecutor('executable-job', mockExecutor);

      const job = await jobManager.createJob('executable-job', { input: 'test' });
      const result = await jobManager.executeJob(job.id);

      expect(mockExecutor).toHaveBeenCalledWith(expect.objectContaining({
        type: 'executable-job',
        data: { input: 'test' }
      }));
      expect(result).toBe('execution result');

      const completedJob = jobManager.getJob(job.id);
      expect(completedJob.status).toBe('completed');
      expect(completedJob.result).toBe('execution result');
    });

    it('should fail job when no executor is registered', async () => {
      const job = await jobManager.createJob('unexecutable-job', {});

      await expect(jobManager.executeJob(job.id)).rejects.toThrow(
        'No executor registered for job type: unexecutable-job'
      );

      const failedJob = jobManager.getJob(job.id);
      expect(failedJob.status).toBe('failed');
    });

    it('should handle executor errors', async () => {
      const mockExecutor = jest.fn().mockRejectedValue(new Error('Executor failed'));
      jobManager.registerExecutor('failing-job', mockExecutor);

      const job = await jobManager.createJob('failing-job', {});

      await expect(jobManager.executeJob(job.id)).rejects.toThrow('Executor failed');

      const failedJob = jobManager.getJob(job.id);
      expect(failedJob.status).toBe('failed');
      expect(failedJob.error).toBe('Executor failed');
    });

    it('should retry failed jobs', async () => {
      let attempts = 0;
      const mockExecutor = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success after retries';
      });

      jobManager.registerExecutor('retry-job', mockExecutor);

      const job = await jobManager.createJob('retry-job', {}, { maxRetries: 3 });
      
      // First execution should fail and schedule retry
      await expect(jobManager.executeJob(job.id)).rejects.toThrow('Temporary failure');
      
      // Simulate retry execution
      await expect(jobManager.executeJob(job.id)).rejects.toThrow('Temporary failure');
      
      // Final successful execution
      const result = await jobManager.executeJob(job.id);
      expect(result).toBe('success after retries');
    });

    it('should check dependencies before execution', async () => {
      const dep1 = await jobManager.createJob('dependency-1', {});
      const dep2 = await jobManager.createJob('dependency-2', {});
      const mainJob = await jobManager.createJob('main-job', {}, {
        dependencies: [dep1.id, dep2.id]
      });

      // Should fail with unmet dependencies
      await expect(jobManager.executeJob(mainJob.id)).rejects.toThrow(
        'has unmet dependencies'
      );

      // Complete one dependency
      await jobManager.updateJobStatus(dep1.id, 'completed');

      // Should still fail with one unmet dependency
      await expect(jobManager.executeJob(mainJob.id)).rejects.toThrow(
        'has unmet dependencies'
      );

      // Complete second dependency
      await jobManager.updateJobStatus(dep2.id, 'completed');

      // Register executor for main job
      jobManager.registerExecutor('main-job', jest.fn().mockResolvedValue('success'));

      // Should now execute successfully
      const result = await jobManager.executeJob(mainJob.id);
      expect(result).toBe('success');
    });
  });

  describe('Job Cancellation', () => {
    it('should cancel pending job', async () => {
      const job = await jobManager.createJob('cancellable', {});
      
      const cancelledJob = await jobManager.cancelJob(job.id);

      expect(cancelledJob.status).toBe('cancelled');
      expect(cancelledJob.completedAt).toBeDefined();
    });

    it('should cancel running job', async () => {
      const job = await jobManager.createJob('cancellable-running', {});
      await jobManager.updateJobStatus(job.id, 'running');
      
      const cancelledJob = await jobManager.cancelJob(job.id);

      expect(cancelledJob.status).toBe('cancelled');
    });

    it('should not cancel completed job', async () => {
      const job = await jobManager.createJob('completed-job', {});
      await jobManager.updateJobStatus(job.id, 'completed');

      await expect(jobManager.cancelJob(job.id)).rejects.toThrow(
        'cannot be cancelled'
      );
    });

    it('should not cancel already cancelled job', async () => {
      const job = await jobManager.createJob('cancelled-job', {});
      await jobManager.cancelJob(job.id);

      await expect(jobManager.cancelJob(job.id)).rejects.toThrow(
        'cannot be cancelled'
      );
    });
  });

  describe('Job Logging and Progress', () => {
    it('should add log entries to job', async () => {
      const job = await jobManager.createJob('logging-job', {});
      
      await jobManager.addJobLog(job.id, 'info', 'Processing started', { step: 1 });
      await jobManager.addJobLog(job.id, 'warn', 'Warning occurred', { step: 2 });

      const loggedJob = jobManager.getJob(job.id);
      expect(loggedJob.logs).toHaveLength(2);
      expect(loggedJob.logs[0]).toMatchObject({
        level: 'info',
        message: 'Processing started',
        data: { step: 1 }
      });
      expect(loggedJob.logs[1]).toMatchObject({
        level: 'warn',
        message: 'Warning occurred',
        data: { step: 2 }
      });
    });

    it('should limit log entries to 100', async () => {
      const job = await jobManager.createJob('log-limit-job', {});
      
      // Add 150 log entries
      for (let i = 0; i < 150; i++) {
        await jobManager.addJobLog(job.id, 'info', `Log entry ${i}`);
      }

      const loggedJob = jobManager.getJob(job.id);
      expect(loggedJob.logs).toHaveLength(100);
      expect(loggedJob.logs[0].message).toBe('Log entry 50'); // Should keep last 100
    });

    it('should update job progress', async () => {
      const job = await jobManager.createJob('progress-job', {});
      
      await jobManager.updateJobProgress(job.id, 25, 'Quarter complete');
      await jobManager.updateJobProgress(job.id, 75, 'Three quarters complete');

      const progressJob = jobManager.getJob(job.id);
      expect(progressJob.progress).toBe(75);
      expect(progressJob.logs).toHaveLength(2);
      expect(progressJob.logs[1]).toMatchObject({
        level: 'info',
        message: 'Three quarters complete',
        data: { progress: 75 }
      });
    });

    it('should clamp progress between 0 and 100', async () => {
      const job = await jobManager.createJob('progress-clamp-job', {});
      
      await jobManager.updateJobProgress(job.id, -10);
      expect(jobManager.getJob(job.id).progress).toBe(0);

      await jobManager.updateJobProgress(job.id, 150);
      expect(jobManager.getJob(job.id).progress).toBe(100);
    });
  });

  describe('Job Cleanup and Expiration', () => {
    it('should remove expired jobs', async () => {
      // Create job with short TTL
      const shortTtl = 100;
      const job = await jobManager.createJob('expiring-job', {}, { ttl: shortTtl });

      expect(jobManager.getJob(job.id)).toBeDefined();

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, shortTtl + 50));

      // Manually trigger cleanup
      await jobManager.cleanupExpiredJobs();

      expect(jobManager.getJob(job.id)).toBeNull();
    });

    it('should emit jobExpired event for expired jobs', async () => {
      const expiredCallback = jest.fn();
      jobManager.on('jobExpired', expiredCallback);

      const job = await jobManager.createJob('expiring-job', {}, { ttl: 50 });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      await jobManager.cleanupExpiredJobs();

      expect(expiredCallback).toHaveBeenCalledWith(job.id);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should provide comprehensive statistics', async () => {
      // Create jobs in various states
      const job1 = await jobManager.createJob('stats-job-1', {});
      const job2 = await jobManager.createJob('stats-job-2', {});
      const job3 = await jobManager.createJob('stats-job-3', {});

      await jobManager.updateJobStatus(job2.id, 'completed');
      await jobManager.updateJobStatus(job3.id, 'failed');

      const stats = jobManager.getStats();

      expect(stats).toMatchObject({
        totalJobs: 3,
        activeJobs: 1, // Only job1 is still pending
        completedJobs: 1,
        failedJobs: 1,
        jobCounts: {
          pending: 1,
          running: 0,
          completed: 1,
          failed: 1,
          cancelled: 0
        },
        totalJobsInMemory: 3,
        executorCount: 0
      });
    });

    it('should track executor registration', () => {
      const initialStats = jobManager.getStats();
      
      jobManager.registerExecutor('test-type-1', jest.fn());
      jobManager.registerExecutor('test-type-2', jest.fn());

      const finalStats = jobManager.getStats();
      expect(finalStats.executorCount).toBe(initialStats.executorCount + 2);

      jobManager.unregisterExecutor('test-type-1');
      
      const afterUnregisterStats = jobManager.getStats();
      expect(afterUnregisterStats.executorCount).toBe(finalStats.executorCount - 1);
    });
  });

  describe('Event Emission', () => {
    it('should emit events for job lifecycle', async () => {
      const events = {
        jobCreated: jest.fn(),
        jobUpdated: jest.fn(),
        jobCancelled: jest.fn(),
        executorRegistered: jest.fn()
      };

      Object.entries(events).forEach(([event, callback]) => {
        jobManager.on(event, callback);
      });

      // Test job creation
      const job = await jobManager.createJob('event-job', {});
      expect(events.jobCreated).toHaveBeenCalledWith(job);

      // Test job update
      await jobManager.updateJobStatus(job.id, 'running');
      expect(events.jobUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ id: job.id, status: 'running' }),
        'running'
      );

      // Test job cancellation
      await jobManager.cancelJob(job.id);
      expect(events.jobCancelled).toHaveBeenCalledWith(
        expect.objectContaining({ id: job.id, status: 'cancelled' })
      );

      // Test executor registration
      jobManager.registerExecutor('event-executor', jest.fn());
      expect(events.executorRegistered).toHaveBeenCalledWith('event-executor');
    });
  });

  describe('Persistence', () => {
    beforeEach(() => {
      // Reset mocks for persistence tests
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.readdir.mockResolvedValue([]);
      fs.readFile.mockResolvedValue('{}');
      fs.unlink.mockResolvedValue();
    });

    it('should initialize storage directory', async () => {
      const persistentJobManager = new JobManager({
        storageDir: './test-persistent-jobs',
        enablePersistence: true
      });

      await new Promise(resolve => setTimeout(resolve, 10)); // Allow async init

      expect(fs.mkdir).toHaveBeenCalledWith('./test-persistent-jobs', { recursive: true });

      await persistentJobManager.destroy();
    });

    it('should persist job when created', async () => {
      const persistentJobManager = new JobManager({
        enablePersistence: true,
        storageDir: testStorageDir
      });

      await persistentJobManager.initStorage(); // Ensure storage is initialized

      const job = await persistentJobManager.createJob('persistent-job', { data: 'test' });

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(testStorageDir, `${job.id}.json`),
        expect.stringContaining(job.id),
        'utf8'
      );

      await persistentJobManager.destroy();
    });
  });

  describe('Resource Cleanup', () => {
    it('should cleanup resources on destroy', async () => {
      const job = await jobManager.createJob('cleanup-job', {});
      expect(jobManager.getJob(job.id)).toBeDefined();

      await jobManager.destroy();

      // Should not be able to interact with destroyed manager
      expect(() => jobManager.getJob(job.id)).not.toThrow();
      // Internal state should be cleared (we can't easily test this without accessing private state)
    });

    it('should clear all timers on destroy', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      // Create manager with monitoring enabled
      const monitoredJobManager = new JobManager({
        enableMonitoring: true,
        monitoringInterval: 1000,
        cleanupInterval: 2000
      });

      await monitoredJobManager.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });
  });
});

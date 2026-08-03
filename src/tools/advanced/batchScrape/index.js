/**
 * batchScrape — entry-point (index.js).
 *
 * Preserves the same exports as the original BatchScrapeTool.js:
 *   export class BatchScrapeTool
 *   export default BatchScrapeTool
 *
 * Heavy work is delegated to:
 *   schema.js   — Zod input schema
 *   worker.js   — per-URL fetch + content extraction
 *   queue.js    — Semaphore concurrency runner
 *   reporter.js — webhook notification helper
 *
 * Reuses JobManager and WebhookDispatcher from src/core/ (no embedded copies).
 */

import { EventEmitter } from 'events';
import { ElicitationHelper } from '../../../core/ElicitationHelper.js'; // D1.4
import JobManager from '../../../core/JobManager.js';
import WebhookDispatcher from '../../../core/WebhookDispatcher.js';
import { BatchScrapeSchema } from './schema.js';
import { scrapeUrlsBatch, processResults, paginateResults } from './queue.js';
import { sendWebhookNotification } from './reporter.js';

export class BatchScrapeTool extends EventEmitter {
  constructor(options = {}) {
    super();

    const {
      jobManager = null,
      webhookDispatcher = null,
      enableJobPersistence = true,
      enableWebhookNotifications = true,
      defaultTimeout = 15000,
      maxBatchSize = 50,
      enableResultCaching = true,
      enableLogging = true,
      maxCachedBatches = 20
    } = options;

    this.jobManager = jobManager || new JobManager({
      enablePersistence: enableJobPersistence,
      defaultTtl: 24 * 60 * 60 * 1000
    });

    this.webhookDispatcher = webhookDispatcher || new WebhookDispatcher({
      enablePersistence: enableJobPersistence
    });

    this.defaultTimeout = defaultTimeout;
    this.maxBatchSize = maxBatchSize;
    this.enableResultCaching = enableResultCaching;
    this.enableLogging = enableLogging;
    this.enableWebhookNotifications = enableWebhookNotifications;

    this.activeBatches = new Map();
    this.batchResults = new Map();
    this.maxCachedBatches = maxCachedBatches;
    this.resultCacheTtl = 3600000; // 1 hour — matches the ttl stored per cache entry
    // D1.4: Elicitation helper (set mcpServer after instantiation if desired)
    this._elicitation = new ElicitationHelper({});

    // Bound batchResults' lifetime: sweep expired entries periodically (in
    // addition to the on-read eviction in getBatchResults) so cached results —
    // including full HTML bodies when formats includes 'html' — don't
    // accumulate in memory for the life of the process.
    // .unref() so this timer never blocks process exit on its own — matches
    // SnapshotManager's cleanupTimer.
    this._resultsSweepTimer = setInterval(() => this._sweepBatchResults(), 10 * 60 * 1000);
    if (typeof this._resultsSweepTimer.unref === 'function') this._resultsSweepTimer.unref();

    this.stats = {
      totalBatches: 0,
      completedBatches: 0,
      failedBatches: 0,
      totalUrls: 0,
      successfulUrls: 0,
      failedUrls: 0,
      averageBatchTime: 0,
      lastUpdated: Date.now()
    };

    this._initializeJobExecutors();
  }

  /**
   * D1.4: Set the MCP server instance for elicitation support.
   * @param {object} mcpServer
   */
  setMcpServer(mcpServer) {
    this._elicitation = new ElicitationHelper({ mcpServer });
  }

  async execute(params) {
    try {
      const validated = BatchScrapeSchema.parse(params);
      this.stats.totalBatches++;
      const batchId = this._generateBatchId();
      const startTime = Date.now();

      this._log('info', `Starting batch scrape ${batchId} with ${validated.urls.length} URLs in ${validated.mode} mode`);

      const urlConfigs = this._normalizeUrlConfigs(validated.urls, validated);

      let webhookConfig = null;
      if (validated.webhook && this.enableWebhookNotifications) {
        webhookConfig = this._registerWebhook(validated.webhook, batchId);
      }

      // D1.4: Elicitation — warn when batch is large in sync mode
      if (validated.mode === 'sync' && urlConfigs.length > 25) {
        const proceed = await this._elicitation.confirm(
          `batch_scrape (sync mode) will fetch ${urlConfigs.length} URLs synchronously. This may take a while and consume significant credits.`,
          {
            url_count: urlConfigs.length,
            mode: 'sync',
            suggestion: 'Consider using mode:"async" for large batches.',
          }
        );
        if (!proceed) {
          return {
            batchId, mode: 'sync', success: false,
            error: 'Batch scrape cancelled by user (elicitation declined).',
            totalUrls: urlConfigs.length,
          };
        }
      }

      if (validated.mode === 'sync') {
        return await this._processBatchSync(batchId, urlConfigs, validated, webhookConfig, startTime);
      } else {
        return await this._processBatchAsync(batchId, urlConfigs, validated, webhookConfig, startTime);
      }
    } catch (error) {
      this.stats.failedBatches++;
      this._log('error', `Batch scrape failed: ${error.message}`);
      throw new Error(`Batch scrape failed: ${error.message}`);
    }
  }

  async _processBatchSync(batchId, urlConfigs, validated, webhookConfig, startTime) {
    try {
      // Process in maxConcurrency-sized chunks (rather than one call covering
      // all URLs) so `completed` can be updated for progress polling and so
      // cancelBatch's `cancelled` flag is actually observed between chunks.
      const activeEntry = { id: batchId, mode: 'sync', startTime, total: urlConfigs.length, completed: 0, cancelled: false };
      this.activeBatches.set(batchId, activeEntry);

      const rawResults = [];
      for (let i = 0; i < urlConfigs.length; i += validated.maxConcurrency) {
        if (activeEntry.cancelled) break;
        const chunk = urlConfigs.slice(i, i + validated.maxConcurrency);
        rawResults.push(...await scrapeUrlsBatch(chunk, validated, this.defaultTimeout));
        activeEntry.completed = rawResults.length;
      }
      const wasCancelled = activeEntry.cancelled;

      const processedResults = processResults(rawResults, validated);
      const executionTime = Date.now() - startTime;
      this._updateAverageBatchTime(executionTime);

      const batchResult = {
        batchId, mode: 'sync', success: true, cancelled: wasCancelled || undefined, executionTime,
        totalUrls: urlConfigs.length,
        successfulUrls: processedResults.filter(r => r.success).length,
        failedUrls: processedResults.filter(r => !r.success).length,
        results: paginateResults(processedResults, 0, validated.pageSize),
        pagination: {
          page: 1, pageSize: validated.pageSize,
          totalResults: processedResults.length,
          totalPages: Math.ceil(processedResults.length / validated.pageSize)
        },
        formats: validated.formats,
        metadata: { concurrency: validated.maxConcurrency, timestamp: Date.now() }
      };

      if (this.enableResultCaching) {
        this._cacheBatchResult(batchId, processedResults);
      }

      this.stats.completedBatches++;
      this.stats.totalUrls += rawResults.length;
      this.stats.successfulUrls += batchResult.successfulUrls;
      this.stats.failedUrls += batchResult.failedUrls;
      this.stats.lastUpdated = Date.now();
      this.activeBatches.delete(batchId);

      // C3: include webhook delivery status in the result (skip when cancelled
      // early — a 'batch_completed' notification would be misleading).
      if (!wasCancelled) {
        const webhookStatus = await sendWebhookNotification('batch_completed', batchResult, webhookConfig, this.webhookDispatcher, this.enableWebhookNotifications);
        if (webhookStatus) batchResult.webhookDelivery = webhookStatus;
        this.emit('batchCompleted', batchResult);
      }
      return batchResult;
    } catch (error) {
      this.stats.failedBatches++;
      this.activeBatches.delete(batchId);
      await sendWebhookNotification('batch_failed', { batchId, error: error.message }, webhookConfig, this.webhookDispatcher, this.enableWebhookNotifications);
      throw error;
    }
  }

  async _processBatchAsync(batchId, urlConfigs, validated, webhookConfig, startTime) {
    try {
      const jobData = { batchId, urlConfigs, validated, webhookConfig, startTime };
      const jobOptions = {
        ...validated.jobOptions,
        webhooks: webhookConfig ? [webhookConfig] : [],
        tags: ['batch_scrape', batchId, ...(validated.jobOptions?.tags || [])],
        metadata: { batchId, urlCount: urlConfigs.length, formats: validated.formats }
      };

      const job = await this.jobManager.createJob('batch_scrape', jobData, jobOptions);
      this.jobManager.executeJob(job.id).catch(err => {
        this._log('error', `Async batch job ${job.id} failed: ${err.message}`);
      });

      this.emit('batchJobCreated', job);

      return {
        batchId, mode: 'async', jobId: job.id, status: 'queued',
        totalUrls: urlConfigs.length, createdAt: job.createdAt,
        estimatedCompletion: new Date(job.createdAt + (urlConfigs.length * 2000)),
        statusCheckUrl: `get_batch_results({batchId: "${batchId}"})`,
        webhook: webhookConfig ? { url: webhookConfig.url, events: webhookConfig.events } : null
      };
    } catch (error) {
      this.stats.failedBatches++;
      throw error;
    }
  }

  async getBatchResults(batchId, page = 1, pageSize = 25) {
    const cached = this.batchResults.get(batchId);
    if (cached) {
      if (Date.now() - cached.timestamp < cached.ttl) {
        const offset = (page - 1) * pageSize;
        return {
          batchId, success: true,
          results: paginateResults(cached.results, offset, pageSize),
          pagination: { page, pageSize, totalResults: cached.results.length, totalPages: Math.ceil(cached.results.length / pageSize) },
          cached: true, timestamp: cached.timestamp
        };
      }
      // Expired — evict now instead of waiting for the periodic sweep, and
      // fall through to the activeBatches/jobManager lookups below.
      this.batchResults.delete(batchId);
    }

    const active = this.activeBatches.get(batchId);
    if (active) {
      return {
        batchId, status: 'in_progress', mode: active.mode,
        progress: { completed: active.completed, total: active.total, percentage: Math.round((active.completed / active.total) * 100) },
        startTime: active.startTime, runningTime: Date.now() - active.startTime
      };
    }

    // Async batches are never added to activeBatches; look the underlying job
    // up by its batchId tag so pending/running (and completed-but-uncached)
    // batches are still reported instead of a misleading "not found".
    const jobs = this.jobManager.getJobsByTag(batchId);
    if (jobs.length > 0) {
      const job = jobs[0];

      if (job.status === 'completed' && job.result) {
        const results = job.result.results || [];
        const offset = (page - 1) * pageSize;
        return {
          batchId, success: true, jobId: job.id,
          results: paginateResults(results, offset, pageSize),
          pagination: { page, pageSize, totalResults: results.length, totalPages: Math.ceil(results.length / pageSize) },
          cached: false, timestamp: job.completedAt
        };
      }

      return {
        batchId, jobId: job.id, status: job.status, mode: 'async',
        progress: { percentage: job.progress, total: job.metadata?.urlCount },
        startTime: job.startedAt || job.createdAt,
        runningTime: Date.now() - (job.startedAt || job.createdAt),
        error: job.error || undefined
      };
    }

    throw new Error(`Batch ${batchId} not found`);
  }

  async getJobStatus(jobId) {
    const job = this.jobManager.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    const status = { jobId, batchId: job.metadata?.batchId, status: job.status, progress: job.progress, createdAt: job.createdAt, startedAt: job.startedAt, completedAt: job.completedAt, error: job.error, metadata: job.metadata };
    if (job.status === 'completed' && job.result) status.results = job.result;
    return status;
  }

  async cancelBatch(batchId) {
    const active = this.activeBatches.get(batchId);
    if (active) {
      // Signal the running _processBatchSync loop to stop dispatching further
      // chunks (the in-flight chunk still finishes — there is no per-request
      // abort). Deleting the entry outright, as before, only hid the batch
      // from getBatchResults; the scrape loop kept running to completion.
      active.cancelled = true;
      return { success: true, message: `Batch ${batchId} cancellation requested; processing stops after the in-flight chunk completes` };
    }
    const jobs = this.jobManager.getJobsByTag(batchId);
    if (jobs.length > 0) {
      const job = jobs[0];
      await this.jobManager.cancelJob(job.id);
      return { success: true, message: `Job ${job.id} for batch ${batchId} cancelled` };
    }
    throw new Error(`Batch ${batchId} not found or already completed`);
  }

  getStats() {
    return {
      ...this.stats,
      activeBatches: this.activeBatches.size,
      cachedResults: this.batchResults.size,
      jobManagerStats: this.jobManager ? this.jobManager.getStats() : null,
      webhookStats: this.webhookDispatcher ? this.webhookDispatcher.getStats() : null
    };
  }

  async destroy() {
    for (const batchId of this.activeBatches.keys()) {
      try { await this.cancelBatch(batchId); } catch (e) { this._log('warn', `Failed to cancel batch ${batchId}: ${e.message}`); }
    }
    this.activeBatches.clear();
    this.batchResults.clear();
    if (this._resultsSweepTimer) clearInterval(this._resultsSweepTimer);
    this.jobManager?.destroy();
    this.webhookDispatcher?.destroy();
    this.removeAllListeners();
    this.emit('destroyed');
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  _generateBatchId() {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  _normalizeUrlConfigs(urls, globalOptions) {
    return urls.map(url => {
      if (typeof url === 'string') {
        return { url, selectors: globalOptions.extractionSchema || {}, headers: {}, timeout: this.defaultTimeout };
      }
      return {
        ...url,
        selectors: { ...globalOptions.extractionSchema, ...(url.selectors || {}) },
        headers: url.headers || {},
        timeout: url.timeout || this.defaultTimeout
      };
    });
  }

  _registerWebhook(webhookConfig, batchId) {
    const config = { ...webhookConfig, metadata: { batchId, registeredAt: Date.now() } };
    return this.webhookDispatcher.registerWebhook(webhookConfig.url, config);
  }

  /**
   * Cache a batch's results, capped to maxCachedBatches. Map preserves
   * insertion order, so the oldest entry is evicted first (LRU by write time).
   */
  _cacheBatchResult(batchId, results) {
    this.batchResults.set(batchId, { results, timestamp: Date.now(), ttl: this.resultCacheTtl });
    while (this.batchResults.size > this.maxCachedBatches) {
      const oldestKey = this.batchResults.keys().next().value;
      this.batchResults.delete(oldestKey);
    }
  }

  _sweepBatchResults() {
    const now = Date.now();
    for (const [id, entry] of this.batchResults) {
      if (now - entry.timestamp >= entry.ttl) this.batchResults.delete(id);
    }
  }

  _updateAverageBatchTime(batchTime) {
    const n = this.stats.completedBatches;
    this.stats.averageBatchTime = n === 1 ? batchTime : ((this.stats.averageBatchTime * (n - 1)) + batchTime) / n;
  }

  _log(level, message) {
    // → stderr so stdout stays clean for MCP JSON-RPC / CLI --json output.
    if (this.enableLogging) console.error(`[BatchScrapeTool:${level.toUpperCase()}] ${message}`);
  }

  _initializeJobExecutors() {
    this.jobManager.registerExecutor('batch_scrape', async (job) => {
      const { batchId, urlConfigs, validated, webhookConfig, startTime } = job.data;
      try {
        await this.jobManager.updateJobProgress(job.id, 0, 'Starting batch scrape');

        const results = [];
        const total = urlConfigs.length;
        let wasCancelled = false;

        for (let i = 0; i < total; i += validated.maxConcurrency) {
          // Check job.status between slices so JobManager.cancelJob (which
          // only flips status — it can't interrupt an in-flight await) is
          // actually honored instead of the loop running to completion anyway.
          const currentJob = this.jobManager.getJob(job.id);
          if (currentJob?.status === 'cancelled') {
            wasCancelled = true;
            this._log('info', `Batch job ${job.id} cancelled; stopping after ${i}/${total} URLs`);
            break;
          }
          const batch = urlConfigs.slice(i, i + validated.maxConcurrency);
          results.push(...await scrapeUrlsBatch(batch, validated, this.defaultTimeout));
          const progress = Math.round(((i + batch.length) / total) * 100);
          await this.jobManager.updateJobProgress(job.id, progress, `Processed ${i + batch.length}/${total} URLs`);
        }

        const processedResults = processResults(results, validated);
        const executionTime = Date.now() - startTime;

        const batchResult = {
          batchId, mode: 'async', success: true, cancelled: wasCancelled || undefined, executionTime,
          totalUrls: urlConfigs.length,
          successfulUrls: processedResults.filter(r => r.success).length,
          failedUrls: processedResults.filter(r => !r.success).length,
          results: processedResults, formats: validated.formats,
          metadata: { concurrency: validated.maxConcurrency, timestamp: Date.now(), jobId: job.id }
        };

        if (this.enableResultCaching) {
          this._cacheBatchResult(batchId, processedResults);
        }

        this.stats.totalUrls += results.length;
        this.stats.successfulUrls += batchResult.successfulUrls;
        this.stats.failedUrls += batchResult.failedUrls;
        this.stats.lastUpdated = Date.now();

        if (wasCancelled) {
          // Job status is already 'cancelled' (set by cancelJob); returning
          // normally here would otherwise let JobManager.executeJob overwrite
          // it back to 'completed'. See the JobManager.js guard below.
          return batchResult;
        }

        this.stats.completedBatches++;
        this._updateAverageBatchTime(executionTime);
        await sendWebhookNotification('batch_completed', batchResult, webhookConfig, this.webhookDispatcher, this.enableWebhookNotifications);
        this.emit('batchCompleted', batchResult);
        return batchResult;
      } catch (error) {
        this.stats.failedBatches++;
        await sendWebhookNotification('batch_failed', { batchId, error: error.message }, webhookConfig, this.webhookDispatcher, this.enableWebhookNotifications);
        throw error;
      }
    });
  }
}

export default BatchScrapeTool;

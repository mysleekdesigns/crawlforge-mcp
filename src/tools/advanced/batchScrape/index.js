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
      enableLogging = true
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
    // D1.4: Elicitation helper (set mcpServer after instantiation if desired)
    this._elicitation = new ElicitationHelper({});

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
      this.activeBatches.set(batchId, { id: batchId, mode: 'sync', startTime, total: urlConfigs.length, completed: 0 });

      const rawResults = await scrapeUrlsBatch(urlConfigs, validated, this.defaultTimeout);
      const processedResults = processResults(rawResults, validated);
      const executionTime = Date.now() - startTime;
      this._updateAverageBatchTime(executionTime);

      const batchResult = {
        batchId, mode: 'sync', success: true, executionTime,
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
        this.batchResults.set(batchId, { results: processedResults, timestamp: Date.now(), ttl: 3600000 });
      }

      this.stats.completedBatches++;
      this.stats.totalUrls += urlConfigs.length;
      this.stats.successfulUrls += batchResult.successfulUrls;
      this.stats.failedUrls += batchResult.failedUrls;
      this.stats.lastUpdated = Date.now();
      this.activeBatches.delete(batchId);

      await sendWebhookNotification('batch_completed', batchResult, webhookConfig, this.webhookDispatcher, this.enableWebhookNotifications);
      this.emit('batchCompleted', batchResult);
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
        statusCheckUrl: `batch_scrape_status?jobId=${job.id}`,
        webhook: webhookConfig ? { url: webhookConfig.url, events: webhookConfig.events } : null
      };
    } catch (error) {
      this.stats.failedBatches++;
      throw error;
    }
  }

  async getBatchResults(batchId, page = 1, pageSize = 25) {
    const cached = this.batchResults.get(batchId);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      const offset = (page - 1) * pageSize;
      return {
        batchId, success: true,
        results: paginateResults(cached.results, offset, pageSize),
        pagination: { page, pageSize, totalResults: cached.results.length, totalPages: Math.ceil(cached.results.length / pageSize) },
        cached: true, timestamp: cached.timestamp
      };
    }

    const active = this.activeBatches.get(batchId);
    if (active) {
      return {
        batchId, status: 'in_progress', mode: active.mode,
        progress: { completed: active.completed, total: active.total, percentage: Math.round((active.completed / active.total) * 100) },
        startTime: active.startTime, runningTime: Date.now() - active.startTime
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
    if (this.activeBatches.has(batchId)) {
      this.activeBatches.delete(batchId);
      return { success: true, message: `Active batch ${batchId} cancelled` };
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

  _updateAverageBatchTime(batchTime) {
    const n = this.stats.completedBatches;
    this.stats.averageBatchTime = n === 1 ? batchTime : ((this.stats.averageBatchTime * (n - 1)) + batchTime) / n;
  }

  _log(level, message) {
    if (this.enableLogging) console.log(`[BatchScrapeTool:${level.toUpperCase()}] ${message}`);
  }

  _initializeJobExecutors() {
    this.jobManager.registerExecutor('batch_scrape', async (job) => {
      const { batchId, urlConfigs, validated, webhookConfig, startTime } = job.data;
      try {
        await this.jobManager.updateJobProgress(job.id, 0, 'Starting batch scrape');

        const results = [];
        const total = urlConfigs.length;

        for (let i = 0; i < total; i += validated.maxConcurrency) {
          const batch = urlConfigs.slice(i, i + validated.maxConcurrency);
          results.push(...await scrapeUrlsBatch(batch, validated, this.defaultTimeout));
          const progress = Math.round(((i + batch.length) / total) * 100);
          await this.jobManager.updateJobProgress(job.id, progress, `Processed ${i + batch.length}/${total} URLs`);
        }

        const processedResults = processResults(results, validated);
        const executionTime = Date.now() - startTime;

        const batchResult = {
          batchId, mode: 'async', success: true, executionTime,
          totalUrls: urlConfigs.length,
          successfulUrls: processedResults.filter(r => r.success).length,
          failedUrls: processedResults.filter(r => !r.success).length,
          results: processedResults, formats: validated.formats,
          metadata: { concurrency: validated.maxConcurrency, timestamp: Date.now(), jobId: job.id }
        };

        if (this.enableResultCaching) {
          this.batchResults.set(batchId, { results: processedResults, timestamp: Date.now(), ttl: 3600000 });
        }

        this.stats.completedBatches++;
        this.stats.totalUrls += urlConfigs.length;
        this.stats.successfulUrls += batchResult.successfulUrls;
        this.stats.failedUrls += batchResult.failedUrls;
        this._updateAverageBatchTime(executionTime);
        this.stats.lastUpdated = Date.now();

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

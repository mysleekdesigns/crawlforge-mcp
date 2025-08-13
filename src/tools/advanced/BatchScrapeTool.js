/**
 * BatchScrapeTool - Process multiple URLs simultaneously with job management
 * Features: parallel processing, async/sync modes, webhook notifications, result pagination
 */

import { z } from 'zod';
import { EventEmitter } from 'events';
import JobManager from '../../core/JobManager.js';
import WebhookDispatcher from '../../core/WebhookDispatcher.js';
import { load } from 'cheerio';

// Schema for individual URL configuration
const UrlConfigSchema = z.object({
  url: z.string().url(),
  selectors: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().min(1000).max(30000).optional(),
  metadata: z.record(z.any()).optional()
});

// Main batch scrape schema
const BatchScrapeSchema = z.object({
  urls: z.array(z.union([
    z.string().url(),
    UrlConfigSchema
  ])).min(1).max(50),
  
  formats: z.array(z.enum(['markdown', 'html', 'json', 'text'])).default(['json']),
  mode: z.enum(['sync', 'async']).default('sync'),
  
  // Webhook configuration
  webhook: z.object({
    url: z.string().url(),
    events: z.array(z.string()).optional().default(['batch_completed', 'batch_failed']),
    headers: z.record(z.string()).optional(),
    signingSecret: z.string().optional()
  }).optional(),
  
  // Structured extraction schema (applied to all URLs)
  extractionSchema: z.record(z.string()).optional(),
  
  // Concurrency and timing
  maxConcurrency: z.number().min(1).max(20).default(10),
  delayBetweenRequests: z.number().min(0).max(10000).default(100),
  
  // Result handling
  includeMetadata: z.boolean().default(true),
  includeFailed: z.boolean().default(true),
  pageSize: z.number().min(1).max(100).default(25),
  
  // Job configuration (for async mode)
  jobOptions: z.object({
    priority: z.number().default(0),
    ttl: z.number().min(60000).default(24 * 60 * 60 * 1000), // 24 hours
    maxRetries: z.number().min(0).max(5).default(1),
    tags: z.array(z.string()).default([])
  }).optional()
});

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
      defaultTtl: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    this.webhookDispatcher = webhookDispatcher || new WebhookDispatcher({
      enablePersistence: enableJobPersistence
    });
    
    this.defaultTimeout = defaultTimeout;
    this.maxBatchSize = maxBatchSize;
    this.enableResultCaching = enableResultCaching;
    this.enableLogging = enableLogging;
    this.enableWebhookNotifications = enableWebhookNotifications;

    // Active batch tracking
    this.activeBatches = new Map();
    this.batchResults = new Map();
    
    // Statistics
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

    // Register job executors
    this.initializeJobExecutors();
  }

  /**
   * Execute batch scraping operation
   * @param {Object} params - Batch scraping parameters
   * @returns {Promise<Object>} Batch result or job info
   */
  async execute(params) {
    try {
      const validated = BatchScrapeSchema.parse(params);
      
      this.stats.totalBatches++;
      const batchId = this.generateBatchId();
      const startTime = Date.now();

      if (this.enableLogging) {
        console.log(`Starting batch scrape ${batchId} with ${validated.urls.length} URLs in ${validated.mode} mode`);
      }

      // Normalize URL configurations
      const urlConfigs = this.normalizeUrlConfigs(validated.urls, validated);
      
      // Register webhook if provided
      let webhookConfig = null;
      if (validated.webhook && this.enableWebhookNotifications) {
        webhookConfig = await this.registerWebhook(validated.webhook, batchId);
      }

      if (validated.mode === 'sync') {
        // Process synchronously and return results
        return await this.processBatchSync(batchId, urlConfigs, validated, webhookConfig, startTime);
      } else {
        // Create async job and return job info
        return await this.processBatchAsync(batchId, urlConfigs, validated, webhookConfig, startTime);
      }

    } catch (error) {
      this.stats.failedBatches++;
      this.log('error', `Batch scrape failed: ${error.message}`);
      throw new Error(`Batch scrape failed: ${error.message}`);
    }
  }

  /**
   * Process batch synchronously
   * @param {string} batchId - Batch identifier
   * @param {Array} urlConfigs - Normalized URL configurations
   * @param {Object} validated - Validated parameters
   * @param {Object} webhookConfig - Webhook configuration
   * @param {number} startTime - Start time
   * @returns {Promise<Object>} Batch results
   */
  async processBatchSync(batchId, urlConfigs, validated, webhookConfig, startTime) {
    try {
      const batchContext = {
        id: batchId,
        mode: 'sync',
        startTime,
        urlConfigs,
        validated,
        webhookConfig,
        results: [],
        errors: [],
        completed: 0,
        total: urlConfigs.length
      };

      this.activeBatches.set(batchId, batchContext);

      // Process URLs with controlled concurrency
      const results = await this.scrapeUrlsBatch(urlConfigs, validated);
      
      // Process and format results
      const processedResults = await this.processResults(results, validated);
      
      const executionTime = Date.now() - startTime;
      this.updateAverageBatchTime(executionTime);
      
      const batchResult = {
        batchId,
        mode: 'sync',
        success: true,
        executionTime,
        totalUrls: urlConfigs.length,
        successfulUrls: processedResults.filter(r => r.success).length,
        failedUrls: processedResults.filter(r => !r.success).length,
        results: this.paginateResults(processedResults, 0, validated.pageSize),
        pagination: {
          page: 1,
          pageSize: validated.pageSize,
          totalResults: processedResults.length,
          totalPages: Math.ceil(processedResults.length / validated.pageSize)
        },
        formats: validated.formats,
        metadata: {
          concurrency: validated.maxConcurrency,
          extractionSchema: validated.extractionSchema ? Object.keys(validated.extractionSchema) : null,
          timestamp: Date.now()
        }
      };

      // Cache results for pagination
      if (this.enableResultCaching) {
        this.batchResults.set(batchId, {
          results: processedResults,
          timestamp: Date.now(),
          ttl: 3600000 // 1 hour
        });
      }

      this.stats.completedBatches++;
      this.stats.totalUrls += urlConfigs.length;
      this.stats.successfulUrls += batchResult.successfulUrls;
      this.stats.failedUrls += batchResult.failedUrls;
      this.updateStats();

      this.activeBatches.delete(batchId);

      // Send webhook notification
      if (webhookConfig) {
        await this.sendWebhookNotification('batch_completed', batchResult, webhookConfig);
      }

      this.emit('batchCompleted', batchResult);
      return batchResult;

    } catch (error) {
      this.stats.failedBatches++;
      this.activeBatches.delete(batchId);
      
      if (webhookConfig) {
        await this.sendWebhookNotification('batch_failed', { batchId, error: error.message }, webhookConfig);
      }

      throw error;
    }
  }

  /**
   * Process batch asynchronously using job manager
   * @param {string} batchId - Batch identifier
   * @param {Array} urlConfigs - Normalized URL configurations  
   * @param {Object} validated - Validated parameters
   * @param {Object} webhookConfig - Webhook configuration
   * @param {number} startTime - Start time
   * @returns {Promise<Object>} Job information
   */
  async processBatchAsync(batchId, urlConfigs, validated, webhookConfig, startTime) {
    try {
      const jobData = {
        batchId,
        urlConfigs,
        validated,
        webhookConfig,
        startTime
      };

      const jobOptions = {
        ...validated.jobOptions,
        webhooks: webhookConfig ? [webhookConfig] : [],
        tags: ['batch_scrape', batchId, ...(validated.jobOptions?.tags || [])],
        metadata: {
          batchId,
          urlCount: urlConfigs.length,
          formats: validated.formats,
          extractionSchema: validated.extractionSchema ? Object.keys(validated.extractionSchema) : null
        }
      };

      const job = await this.jobManager.createJob('batch_scrape', jobData, jobOptions);
      
      // Start job execution asynchronously
      this.jobManager.executeJob(job.id).catch(error => {
        this.log('error', `Async batch job ${job.id} failed: ${error.message}`);
      });

      this.emit('batchJobCreated', job);

      return {
        batchId,
        mode: 'async',
        jobId: job.id,
        status: 'queued',
        totalUrls: urlConfigs.length,
        createdAt: job.createdAt,
        estimatedCompletion: new Date(job.createdAt + (urlConfigs.length * 2000)), // Rough estimate
        statusCheckUrl: `batch_scrape_status?jobId=${job.id}`,
        webhook: webhookConfig ? {
          url: webhookConfig.url,
          events: webhookConfig.events
        } : null
      };

    } catch (error) {
      this.stats.failedBatches++;
      throw error;
    }
  }

  /**
   * Scrape URLs in batch with concurrency control
   * @param {Array} urlConfigs - URL configurations
   * @param {Object} options - Scraping options
   * @returns {Promise<Array>} Scraping results
   */
  async scrapeUrlsBatch(urlConfigs, options) {
    const results = [];
    const semaphore = new Semaphore(options.maxConcurrency);

    const scrapePromises = urlConfigs.map(async (config, index) => {
      return semaphore.acquire(async () => {
        try {
          // Add delay between requests if configured
          if (options.delayBetweenRequests > 0 && index > 0) {
            await this.delay(options.delayBetweenRequests);
          }

          return await this.scrapeUrl(config, options);
        } catch (error) {
          return {
            success: false,
            url: config.url,
            error: error.message,
            timestamp: Date.now()
          };
        }
      });
    });

    const settledResults = await Promise.allSettled(scrapePromises);
    
    settledResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          success: false,
          url: urlConfigs[index].url,
          error: result.reason.message || 'Unknown error',
          timestamp: Date.now()
        });
      }
    });

    return results;
  }

  /**
   * Scrape individual URL
   * @param {Object} config - URL configuration
   * @param {Object} options - Scraping options
   * @returns {Promise<Object>} Scrape result
   */
  async scrapeUrl(config, options) {
    const startTime = Date.now();
    
    try {
      const response = await this.fetchUrl(config.url, {
        headers: config.headers,
        timeout: config.timeout || this.defaultTimeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = load(html);
      
      const result = {
        success: true,
        url: config.url,
        timestamp: Date.now(),
        executionTime: Date.now() - startTime,
        metadata: {
          status: response.status,
          contentType: response.headers.get('content-type'),
          contentLength: html.length,
          ...(config.metadata || {})
        }
      };

      // Apply extraction schemas
      if (options.extractionSchema || config.selectors) {
        const selectors = { ...config.selectors, ...options.extractionSchema };
        result.extracted = this.extractStructuredData($, selectors);
      }

      // Generate different formats
      result.content = this.generateFormats($, html, options.formats);

      return result;

    } catch (error) {
      return {
        success: false,
        url: config.url,
        error: error.message,
        timestamp: Date.now(),
        executionTime: Date.now() - startTime,
        metadata: config.metadata || {}
      };
    }
  }

  /**
   * Extract structured data using selectors
   * @param {Object} $ - Cheerio instance
   * @param {Object} selectors - CSS selectors
   * @returns {Object} Extracted data
   */
  extractStructuredData($, selectors) {
    const extracted = {};

    for (const [key, selector] of Object.entries(selectors)) {
      try {
        const elements = $(selector);
        
        if (elements.length === 0) {
          extracted[key] = null;
        } else if (elements.length === 1) {
          extracted[key] = elements.text().trim();
        } else {
          extracted[key] = elements.map((_, el) => $(el).text().trim()).get();
        }
      } catch (error) {
        extracted[key] = { error: `Invalid selector: ${selector}` };
      }
    }

    return extracted;
  }

  /**
   * Generate content in different formats
   * @param {Object} $ - Cheerio instance
   * @param {string} html - Raw HTML
   * @param {Array} formats - Requested formats
   * @returns {Object} Content in different formats
   */
  generateFormats($, html, formats) {
    const content = {};

    if (formats.includes('html')) {
      content.html = html;
    }

    if (formats.includes('text')) {
      content.text = $('body').text().replace(/\s+/g, ' ').trim();
    }

    if (formats.includes('markdown')) {
      content.markdown = this.convertToMarkdown($);
    }

    if (formats.includes('json')) {
      content.json = {
        title: $('title').text().trim(),
        headings: this.extractHeadings($),
        links: this.extractLinks($),
        images: this.extractImages($),
        metadata: this.extractMetadata($)
      };
    }

    return content;
  }

  /**
   * Convert HTML to Markdown (basic implementation)
   * @param {Object} $ - Cheerio instance
   * @returns {string} Markdown content
   */
  convertToMarkdown($) {
    let markdown = '';
    
    // Extract title
    const title = $('title').text().trim();
    if (title) {
      markdown += `# ${title}\n\n`;
    }

    // Extract main content
    const contentSelectors = ['article', 'main', '.content', '#content', '.post-content', '.entry-content'];
    let $content = null;

    for (const selector of contentSelectors) {
      $content = $(selector);
      if ($content.length > 0) break;
    }

    if (!$content || $content.length === 0) {
      $content = $('body');
    }

    // Basic markdown conversion
    $content.find('h1').each((_, el) => {
      markdown += `# ${$(el).text().trim()}\n\n`;
    });

    $content.find('h2').each((_, el) => {
      markdown += `## ${$(el).text().trim()}\n\n`;
    });

    $content.find('h3').each((_, el) => {
      markdown += `### ${$(el).text().trim()}\n\n`;
    });

    $content.find('p').each((_, el) => {
      const text = $(el).text().trim();
      if (text) {
        markdown += `${text}\n\n`;
      }
    });

    $content.find('ul li').each((_, el) => {
      markdown += `- ${$(el).text().trim()}\n`;
    });

    $content.find('ol li').each((_, el) => {
      markdown += `1. ${$(el).text().trim()}\n`;
    });

    return markdown.trim();
  }

  /**
   * Extract headings
   * @param {Object} $ - Cheerio instance
   * @returns {Array} Headings
   */
  extractHeadings($) {
    const headings = [];
    
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      headings.push({
        level: parseInt(el.name.substring(1)),
        text: $(el).text().trim(),
        id: $(el).attr('id') || null
      });
    });

    return headings;
  }

  /**
   * Extract links
   * @param {Object} $ - Cheerio instance
   * @returns {Array} Links
   */
  extractLinks($) {
    const links = [];
    
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      
      if (href && text) {
        links.push({
          href,
          text,
          title: $(el).attr('title') || null
        });
      }
    });

    return links;
  }

  /**
   * Extract images
   * @param {Object} $ - Cheerio instance
   * @returns {Array} Images
   */
  extractImages($) {
    const images = [];
    
    $('img[src]').each((_, el) => {
      images.push({
        src: $(el).attr('src'),
        alt: $(el).attr('alt') || null,
        title: $(el).attr('title') || null,
        width: $(el).attr('width') || null,
        height: $(el).attr('height') || null
      });
    });

    return images;
  }

  /**
   * Extract metadata
   * @param {Object} $ - Cheerio instance
   * @returns {Object} Metadata
   */
  extractMetadata($) {
    const metadata = {};
    
    // Basic metadata
    metadata.title = $('title').text().trim();
    metadata.description = $('meta[name="description"]').attr('content') || '';
    
    // Open Graph
    metadata.og = {};
    $('meta[property^="og:"]').each((_, el) => {
      const property = $(el).attr('property').replace('og:', '');
      metadata.og[property] = $(el).attr('content');
    });

    // Twitter Cards
    metadata.twitter = {};
    $('meta[name^="twitter:"]').each((_, el) => {
      const name = $(el).attr('name').replace('twitter:', '');
      metadata.twitter[name] = $(el).attr('content');
    });

    return metadata;
  }

  /**
   * Process and format results
   * @param {Array} results - Raw results
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} Processed results
   */
  async processResults(results, options) {
    let processedResults = [...results];

    // Filter out failed results if not requested
    if (!options.includeFailed) {
      processedResults = processedResults.filter(r => r.success);
    }

    // Add metadata if requested
    if (options.includeMetadata) {
      processedResults = processedResults.map(result => ({
        ...result,
        processingMetadata: {
          formats: options.formats,
          extractionApplied: !!options.extractionSchema,
          processedAt: Date.now()
        }
      }));
    }

    return processedResults;
  }

  /**
   * Paginate results
   * @param {Array} results - All results
   * @param {number} offset - Offset
   * @param {number} limit - Limit
   * @returns {Array} Paginated results
   */
  paginateResults(results, offset, limit) {
    return results.slice(offset, offset + limit);
  }

  /**
   * Get batch status and results
   * @param {string} batchId - Batch identifier
   * @param {number} page - Page number (1-based)
   * @param {number} pageSize - Page size
   * @returns {Object} Batch status and results
   */
  async getBatchResults(batchId, page = 1, pageSize = 25) {
    // Check if results are cached
    const cached = this.batchResults.get(batchId);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      const offset = (page - 1) * pageSize;
      return {
        batchId,
        success: true,
        results: this.paginateResults(cached.results, offset, pageSize),
        pagination: {
          page,
          pageSize,
          totalResults: cached.results.length,
          totalPages: Math.ceil(cached.results.length / pageSize)
        },
        cached: true,
        timestamp: cached.timestamp
      };
    }

    // Check active batches
    const active = this.activeBatches.get(batchId);
    if (active) {
      return {
        batchId,
        status: 'in_progress',
        mode: active.mode,
        progress: {
          completed: active.completed,
          total: active.total,
          percentage: Math.round((active.completed / active.total) * 100)
        },
        startTime: active.startTime,
        runningTime: Date.now() - active.startTime
      };
    }

    throw new Error(`Batch ${batchId} not found`);
  }

  /**
   * Get job status for async batches
   * @param {string} jobId - Job identifier
   * @returns {Object} Job status
   */
  async getJobStatus(jobId) {
    const job = this.jobManager.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const status = {
      jobId,
      batchId: job.metadata?.batchId,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      metadata: job.metadata
    };

    // If job is completed, include results
    if (job.status === 'completed' && job.result) {
      status.results = job.result;
    }

    return status;
  }

  /**
   * Cancel batch operation
   * @param {string} batchId - Batch identifier
   * @returns {Object} Cancellation result
   */
  async cancelBatch(batchId) {
    // Check active batches
    if (this.activeBatches.has(batchId)) {
      this.activeBatches.delete(batchId);
      return { success: true, message: `Active batch ${batchId} cancelled` };
    }

    // Try to cancel job
    const jobs = this.jobManager.getJobsByTag(batchId);
    if (jobs.length > 0) {
      const job = jobs[0];
      await this.jobManager.cancelJob(job.id);
      return { success: true, message: `Job ${job.id} for batch ${batchId} cancelled` };
    }

    throw new Error(`Batch ${batchId} not found or already completed`);
  }

  /**
   * Initialize job executors
   */
  initializeJobExecutors() {
    this.jobManager.registerExecutor('batch_scrape', async (job) => {
      const { batchId, urlConfigs, validated, webhookConfig, startTime } = job.data;
      
      try {
        // Update job progress
        await this.jobManager.updateJobProgress(job.id, 0, 'Starting batch scrape');

        // Process URLs with progress updates
        const results = [];
        const total = urlConfigs.length;
        
        for (let i = 0; i < total; i += validated.maxConcurrency) {
          const batch = urlConfigs.slice(i, i + validated.maxConcurrency);
          const batchResults = await this.scrapeUrlsBatch(batch, validated);
          results.push(...batchResults);
          
          const progress = Math.round(((i + batch.length) / total) * 100);
          await this.jobManager.updateJobProgress(
            job.id, 
            progress, 
            `Processed ${i + batch.length}/${total} URLs`
          );
        }

        // Process and format results
        const processedResults = await this.processResults(results, validated);
        const executionTime = Date.now() - startTime;

        const batchResult = {
          batchId,
          mode: 'async',
          success: true,
          executionTime,
          totalUrls: urlConfigs.length,
          successfulUrls: processedResults.filter(r => r.success).length,
          failedUrls: processedResults.filter(r => !r.success).length,
          results: processedResults,
          formats: validated.formats,
          metadata: {
            concurrency: validated.maxConcurrency,
            extractionSchema: validated.extractionSchema ? Object.keys(validated.extractionSchema) : null,
            timestamp: Date.now(),
            jobId: job.id
          }
        };

        // Cache results
        if (this.enableResultCaching) {
          this.batchResults.set(batchId, {
            results: processedResults,
            timestamp: Date.now(),
            ttl: 3600000 // 1 hour
          });
        }

        // Update statistics
        this.stats.completedBatches++;
        this.stats.totalUrls += urlConfigs.length;
        this.stats.successfulUrls += batchResult.successfulUrls;
        this.stats.failedUrls += batchResult.failedUrls;
        this.updateAverageBatchTime(executionTime);
        this.updateStats();

        // Send webhook notification
        if (webhookConfig) {
          await this.sendWebhookNotification('batch_completed', batchResult, webhookConfig);
        }

        this.emit('batchCompleted', batchResult);
        return batchResult;

      } catch (error) {
        this.stats.failedBatches++;
        
        if (webhookConfig) {
          await this.sendWebhookNotification('batch_failed', { batchId, error: error.message }, webhookConfig);
        }

        throw error;
      }
    });
  }

  /**
   * Normalize URL configurations
   * @param {Array} urls - Raw URL configurations
   * @param {Object} globalOptions - Global options
   * @returns {Array} Normalized URL configurations
   */
  normalizeUrlConfigs(urls, globalOptions) {
    return urls.map(url => {
      if (typeof url === 'string') {
        return {
          url,
          selectors: globalOptions.extractionSchema || {},
          headers: {},
          timeout: this.defaultTimeout
        };
      } else {
        return {
          ...url,
          selectors: { ...globalOptions.extractionSchema, ...(url.selectors || {}) },
          headers: url.headers || {},
          timeout: url.timeout || this.defaultTimeout
        };
      }
    });
  }

  /**
   * Register webhook for notifications
   * @param {Object} webhookConfig - Webhook configuration
   * @param {string} batchId - Batch identifier
   * @returns {Promise<Object>} Registered webhook configuration
   */
  async registerWebhook(webhookConfig, batchId) {
    const config = {
      ...webhookConfig,
      metadata: {
        batchId,
        registeredAt: Date.now()
      }
    };

    const registeredConfig = this.webhookDispatcher.registerWebhook(webhookConfig.url, config);
    return registeredConfig;
  }

  /**
   * Send webhook notification
   * @param {string} event - Event type
   * @param {Object} data - Event data
   * @param {Object} webhookConfig - Webhook configuration
   */
  async sendWebhookNotification(event, data, webhookConfig) {
    if (!this.enableWebhookNotifications || !webhookConfig) return;

    try {
      await this.webhookDispatcher.dispatch(event, data, {
        urls: [webhookConfig.url],
        immediate: false,
        metadata: {
          batchId: data.batchId,
          timestamp: Date.now()
        }
      });
    } catch (error) {
      this.log('warn', `Webhook notification failed: ${error.message}`);
    }
  }

  /**
   * Fetch URL with error handling
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} Response
   */
  async fetchUrl(url, options = {}) {
    const { timeout = this.defaultTimeout, headers = {} } = options;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'MCP-WebScraper-BatchTool/1.0.0',
          ...headers
        }
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Generate unique batch ID
   * @returns {string} Batch ID
   */
  generateBatchId() {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update average batch time statistic
   * @param {number} batchTime - Batch execution time
   */
  updateAverageBatchTime(batchTime) {
    const currentAverage = this.stats.averageBatchTime;
    const completedBatches = this.stats.completedBatches;
    
    if (completedBatches === 1) {
      this.stats.averageBatchTime = batchTime;
    } else {
      this.stats.averageBatchTime = 
        ((currentAverage * (completedBatches - 1)) + batchTime) / completedBatches;
    }
  }

  /**
   * Update statistics
   */
  updateStats() {
    this.stats.lastUpdated = Date.now();
  }

  /**
   * Utility delay function
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Delay promise
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log message if logging enabled
   * @param {string} level - Log level
   * @param {string} message - Log message
   */
  log(level, message) {
    if (this.enableLogging) {
      console.log(`[BatchScrapeTool:${level.toUpperCase()}] ${message}`);
    }
  }

  /**
   * Get comprehensive statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeBatches: this.activeBatches.size,
      cachedResults: this.batchResults.size,
      jobManagerStats: this.jobManager ? this.jobManager.getStats() : null,
      webhookStats: this.webhookDispatcher ? this.webhookDispatcher.getStats() : null
    };
  }

  /**
   * Cleanup resources
   */
  async destroy() {
    // Cancel active batches
    for (const batchId of this.activeBatches.keys()) {
      try {
        await this.cancelBatch(batchId);
      } catch (error) {
        this.log('warn', `Failed to cancel batch ${batchId}: ${error.message}`);
      }
    }

    // Clear caches
    this.activeBatches.clear();
    this.batchResults.clear();

    // Cleanup job manager if we own it
    if (this.jobManager) {
      this.jobManager.destroy();
    }

    // Cleanup webhook dispatcher if we own it
    if (this.webhookDispatcher) {
      this.webhookDispatcher.destroy();
    }

    // Remove event listeners
    this.removeAllListeners();
    
    this.emit('destroyed');
  }
}

/**
 * Simple semaphore implementation for concurrency control
 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.tryNext();
    });
  }

  tryNext() {
    if (this.current >= this.max || this.queue.length === 0) {
      return;
    }

    this.current++;
    const { task, resolve, reject } = this.queue.shift();

    task()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.current--;
        this.tryNext();
      });
  }
}

export default BatchScrapeTool;

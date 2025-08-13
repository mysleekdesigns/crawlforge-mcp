/**
 * WebhookDispatcher - Webhook infrastructure for event notifications
 * Features: queuing, retry logic, HMAC security, health monitoring
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import RetryManager from '../utils/RetryManager.js';

export class WebhookDispatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    
    const {
      queueDir = './webhooks',
      maxRetries = 3,
      retryDelay = 5000,
      timeout = 30000,
      enablePersistence = true,
      maxQueueSize = 10000,
      healthCheckInterval = 60000, // 1 minute
      enableHealthMonitoring = true,
      batchSize = 50,
      enableBatching = false,
      signingSecret = null,
      defaultHeaders = {},
      enableLogging = true
    } = options;

    this.queueDir = queueDir;
    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;
    this.timeout = timeout;
    this.enablePersistence = enablePersistence;
    this.maxQueueSize = maxQueueSize;
    this.healthCheckInterval = healthCheckInterval;
    this.enableHealthMonitoring = enableHealthMonitoring;
    this.batchSize = batchSize;
    this.enableBatching = enableBatching;
    this.signingSecret = signingSecret;
    this.defaultHeaders = defaultHeaders;
    this.enableLogging = enableLogging;

    // Webhook queue - in memory and persistent
    this.queue = [];
    this.processing = false;
    this.webhookUrls = new Map(); // url -> configuration
    this.failedUrls = new Map(); // url -> failure info
    
    // Statistics
    this.stats = {
      totalEvents: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      retriedDeliveries: 0,
      averageResponseTime: 0,
      healthyUrls: 0,
      unhealthyUrls: 0,
      lastUpdated: Date.now()
    };

    // Health monitoring
    this.healthChecks = new Map(); // url -> health status
    this.responseTimes = new Map(); // url -> response time history

    // Retry manager
    this.retryManager = new RetryManager({
      maxRetries: this.maxRetries,
      baseDelay: this.retryDelay,
      strategy: 'exponential',
      retryableStatusCodes: [408, 429, 500, 502, 503, 504],
      onRetry: (error, attempt, delay, context) => {
        this.stats.retriedDeliveries++;
        if (this.enableLogging) {
          console.log('Webhook retry ' + attempt + ' for ' + context.url + ' after ' + delay + 'ms: ' + error.message);
        }
      }
    });

    // Initialize storage
    if (this.enablePersistence) {
      this.initStorage();
    }

    // Start health monitoring
    if (this.enableHealthMonitoring) {
      this.startHealthMonitoring();
    }

    // Start processing queue
    this.startProcessing();
  }

  /**
   * Initialize persistent storage
   */
  async initStorage() {
    try {
      await fs.mkdir(this.queueDir, { recursive: true });
      await this.loadPersistedEvents();
    } catch (error) {
      console.error('Failed to initialize webhook storage:', error);
      this.enablePersistence = false;
    }
  }

  /**
   * Register webhook URL with configuration
   * @param {string|Object} urlOrConfig - Webhook URL string or config object with url property
   * @param {Object} config - Webhook configuration (when first param is URL string)
   */
  registerWebhook(urlOrConfig, config = {}) {
    let url, actualConfig;
    
    // Handle both signatures: registerWebhook(url, config) and registerWebhook({url, ...config})
    if (typeof urlOrConfig === 'string') {
      url = urlOrConfig;
      actualConfig = config;
    } else if (urlOrConfig && typeof urlOrConfig === 'object' && urlOrConfig.url) {
      url = urlOrConfig.url;
      actualConfig = { ...urlOrConfig };
      delete actualConfig.url; // Remove url from config since it's handled separately
    } else {
      throw new Error('Invalid webhook configuration: URL is required');
    }

    const webhookConfig = {
      id: this.generateEventId(), // Add unique ID
      url,
      enabled: actualConfig.enabled !== false,
      events: actualConfig.events || ['*'], // * means all events
      headers: Object.assign({}, this.defaultHeaders, actualConfig.headers || {}),
      timeout: actualConfig.timeout || this.timeout,
      maxRetries: actualConfig.maxRetries || this.maxRetries,
      retryDelay: actualConfig.retryDelay || this.retryDelay,
      signingSecret: actualConfig.signingSecret || actualConfig.secret || this.signingSecret, // support 'secret' alias
      metadata: actualConfig.metadata || {},
      createdAt: Date.now(),
      lastUsed: null
    };

    this.webhookUrls.set(url, webhookConfig);
    this.healthChecks.set(url, {
      status: 'unknown',
      lastCheck: null,
      consecutiveFailures: 0,
      averageResponseTime: 0,
      lastError: null
    });

    this.emit('webhookRegistered', url, webhookConfig);
    return webhookConfig;
  }

  /**
   * Unregister webhook URL
   * @param {string} url - Webhook URL
   */
  unregisterWebhook(url) {
    const removed = this.webhookUrls.delete(url);
    this.healthChecks.delete(url);
    this.responseTimes.delete(url);
    this.failedUrls.delete(url);

    if (removed) {
      this.emit('webhookUnregistered', url);
    }
    return removed;
  }

  /**
   * Dispatch webhook event
   * @param {string} eventType - Event type
   * @param {Object} payload - Event payload
   * @param {Object} options - Dispatch options
   * @returns {Promise<Array>} Array of dispatch results
   */
  async dispatch(eventType, payload, options = {}) {
    const {
      urls = null, // Specific URLs to send to, null for all registered
      immediate = false, // Skip queue and send immediately
      priority = 0, // Higher number = higher priority
      metadata = {}
    } = options;

    const event = {
      id: this.generateEventId(),
      type: eventType,
      payload,
      timestamp: Date.now(),
      priority,
      metadata,
      attempts: 0,
      createdAt: Date.now()
    };

    this.stats.totalEvents++;

    // Determine target URLs
    const targetUrls = urls || Array.from(this.webhookUrls.keys());
    const filteredUrls = targetUrls.filter(url => {
      const config = this.webhookUrls.get(url);
      return config && 
             config.enabled && 
             (config.events.includes('*') || config.events.includes(eventType));
    });

    if (filteredUrls.length === 0) {
      this.emit('noTargets', event, eventType);
      return [];
    }

    // Create dispatch tasks
    const tasks = filteredUrls.map(url => {
      const urlString = typeof url === 'string' ? url : String(url);
      const cleanUrl = urlString.replace(/[^a-zA-Z0-9]/g, '_');
      return Object.assign({}, event, {
        url: urlString,
        id: event.id + '_' + cleanUrl
      });
    });

    if (immediate) {
      // Process immediately
      const results = [];
      for (const task of tasks) {
        try {
          const result = await this.deliverWebhook(task);
          results.push(result);
        } catch (error) {
          results.push({
            success: false,
            url: task.url,
            error: error.message,
            timestamp: Date.now()
          });
        }
      }
      return results;
    } else {
      // Add to queue
      await this.enqueueEvents(tasks);
      this.emit('eventsQueued', tasks.length, eventType);
      return tasks.map(t => ({ queued: true, url: t.url, eventId: t.id }));
    }
  }

  /**
   * Add events to queue
   * @param {Array} events - Events to queue
   */
  async enqueueEvents(events) {
    // Check queue size limit
    if (this.queue.length + events.length > this.maxQueueSize) {
      const excess = (this.queue.length + events.length) - this.maxQueueSize;
      // Remove oldest events to make room
      this.queue.splice(0, excess);
      this.emit('queueOverflow', excess);
    }

    // Add to queue with priority sorting
    this.queue.push(...events);
    this.queue.sort((a, b) => b.priority - a.priority);

    // Persist if enabled
    if (this.enablePersistence) {
      await this.persistQueue();
    }

    this.emit('eventsEnqueued', events.length);
  }

  /**
   * Process webhook queue
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    
    try {
      const batchSize = this.enableBatching ? this.batchSize : 1;
      const batch = this.queue.splice(0, batchSize);

      if (this.enableBatching && batch.length > 1) {
        await this.processBatch(batch);
      } else {
        for (const event of batch) {
          await this.processEvent(event);
        }
      }

      // Update persistence after processing
      if (this.enablePersistence && batch.length > 0) {
        await this.persistQueue();
      }

    } catch (error) {
      console.error('Queue processing error:', error);
      this.emit('processingError', error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process individual webhook event
   * @param {Object} event - Webhook event
   */
  async processEvent(event) {
    try {
      event.attempts++;
      const result = await this.deliverWebhook(event);
      
      this.stats.successfulDeliveries++;
      this.emit('webhookDelivered', event, result);

    } catch (error) {
      event.lastError = error.message;
      
      // Check if we should retry
      if (event.attempts < this.maxRetries) {
        // Re-queue for retry with exponential backoff
        const delay = Math.min(
          this.retryDelay * Math.pow(2, event.attempts - 1),
          60000 // Max 1 minute delay
        );
        
        setTimeout(() => {
          this.queue.unshift(event); // Add to front for priority
        }, delay);

        this.emit('webhookRetry', event, error, delay);
      } else {
        this.stats.failedDeliveries++;
        this.recordFailure(event.url, error);
        this.emit('webhookFailed', event, error);
      }
    }
  }

  /**
   * Process batch of webhook events
   * @param {Array} batch - Batch of events
   */
  async processBatch(batch) {
    const promises = batch.map(event => this.processEvent(event));
    await Promise.allSettled(promises);
  }

  /**
   * Deliver webhook to URL
   * @param {Object} event - Webhook event
   * @returns {Promise<Object>} Delivery result
   */
  async deliverWebhook(event) {
    const config = this.webhookUrls.get(event.url);
    if (!config) {
      throw new Error('Webhook URL ' + event.url + ' not registered');
    }

    const startTime = Date.now();
    const headers = Object.assign({}, config.headers);
    
    // Add standard headers
    headers['Content-Type'] = 'application/json';
    headers['User-Agent'] = 'WebhookDispatcher/1.0';
    headers['X-Webhook-Event'] = event.type;
    headers['X-Webhook-ID'] = event.id;
    headers['X-Webhook-Timestamp'] = event.timestamp.toString();

    // Add HMAC signature if secret provided
    if (config.signingSecret) {
      const signature = this.generateSignature(event.payload, config.signingSecret);
      headers['X-Webhook-Signature'] = signature;
    }

    // Create request body
    const body = JSON.stringify({
      event: event.type,
      id: event.id,
      timestamp: event.timestamp,
      data: event.payload,
      metadata: event.metadata
    });

    // Execute with retry logic
    const result = await this.retryManager.execute(async () => {
      const response = await fetch(event.url, {
        method: 'POST',
        headers,
        body,
        timeout: config.timeout
      });

      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }

      return response;
    }, { url: event.url });

    const duration = Date.now() - startTime;
    this.recordSuccess(event.url, duration);
    
    // Update webhook last used time
    config.lastUsed = Date.now();

    return {
      success: true,
      url: event.url,
      status: result.status,
      duration,
      timestamp: Date.now()
    };
  }

  /**
   * Generate HMAC signature for webhook security
   * @param {Object} payload - Webhook payload
   * @param {string} secret - Signing secret
   * @returns {string} HMAC signature
   */
  generateSignature(payload, secret) {
    const body = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(body);
    return 'sha256=' + hmac.digest('hex');
  }

  /**
   * Record successful delivery
   * @param {string} url - Webhook URL
   * @param {number} duration - Response time in milliseconds
   */
  recordSuccess(url, duration) {
    const health = this.healthChecks.get(url);
    if (health) {
      health.status = 'healthy';
      health.lastCheck = Date.now();
      health.consecutiveFailures = 0;
      
      // Update response time
      if (!this.responseTimes.has(url)) {
        this.responseTimes.set(url, []);
      }
      const times = this.responseTimes.get(url);
      times.push(duration);
      if (times.length > 100) times.shift(); // Keep last 100 measurements
      
      health.averageResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
    }

    // Update global stats
    this.updateAverageResponseTime(duration);
    this.updateStats();
  }

  /**
   * Record delivery failure
   * @param {string} url - Webhook URL
   * @param {Error} error - Failure error
   */
  recordFailure(url, error) {
    const health = this.healthChecks.get(url);
    if (health) {
      health.status = 'unhealthy';
      health.lastCheck = Date.now();
      health.consecutiveFailures++;
      health.lastError = error.message;
    }

    // Track failed URLs
    if (!this.failedUrls.has(url)) {
      this.failedUrls.set(url, {
        firstFailure: Date.now(),
        failureCount: 0,
        lastError: null
      });
    }
    
    const failureInfo = this.failedUrls.get(url);
    failureInfo.failureCount++;
    failureInfo.lastError = error.message;
    failureInfo.lastFailure = Date.now();

    this.updateStats();
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    if (this.healthMonitoringTimer) {
      clearInterval(this.healthMonitoringTimer);
    }

    this.healthMonitoringTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.healthCheckInterval);
  }

  /**
   * Perform health checks on all registered webhooks
   */
  async performHealthChecks() {
    const urls = Array.from(this.webhookUrls.keys());
    const healthCheckPromises = urls.map(url => this.healthCheckUrl(url));
    
    try {
      await Promise.allSettled(healthCheckPromises);
      this.updateStats();
      this.emit('healthCheckComplete', this.getHealthSummary());
    } catch (error) {
      this.emit('healthCheckError', error);
    }
  }

  /**
   * Perform health check on specific URL
   * @param {string} url - Webhook URL
   */
  async healthCheckUrl(url) {
    const config = this.webhookUrls.get(url);
    if (!config || !config.enabled) return;

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'HEAD',
        timeout: config.timeout / 2, // Use half timeout for health checks
        headers: {
          'User-Agent': 'WebhookDispatcher-HealthCheck/1.0'
        }
      });

      const duration = Date.now() - startTime;
      
      if (response.ok || response.status === 405) { // 405 Method Not Allowed is OK for HEAD
        this.recordSuccess(url, duration);
      } else {
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }

    } catch (error) {
      this.recordFailure(url, error);
    }
  }

  /**
   * Start queue processing
   */
  startProcessing() {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
    }

    // Process queue every 100ms
    this.processingTimer = setInterval(() => {
      this.processQueue();
    }, 100);
  }

  /**
   * Stop processing
   */
  stopProcessing() {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    if (this.healthMonitoringTimer) {
      clearInterval(this.healthMonitoringTimer);
      this.healthMonitoringTimer = null;
    }
  }

  /**
   * Persist queue to disk
   */
  async persistQueue() {
    if (!this.enablePersistence) return;

    try {
      const queuePath = path.join(this.queueDir, 'queue.json');
      const data = JSON.stringify(this.queue, null, 2);
      await fs.writeFile(queuePath, data, 'utf8');
    } catch (error) {
      console.error('Failed to persist webhook queue:', error);
    }
  }

  /**
   * Load persisted events
   */
  async loadPersistedEvents() {
    if (!this.enablePersistence) return;

    try {
      const queuePath = path.join(this.queueDir, 'queue.json');
      const data = await fs.readFile(queuePath, 'utf8');
      const events = JSON.parse(data);
      
      if (Array.isArray(events)) {
        this.queue = events;
        this.emit('queueLoaded', events.length);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Failed to load persisted webhook queue:', error);
      }
    }
  }

  /**
   * Update average response time statistic
   * @param {number} responseTime - Response time in milliseconds
   */
  updateAverageResponseTime(responseTime) {
    const currentAverage = this.stats.averageResponseTime;
    const totalDeliveries = this.stats.successfulDeliveries;
    
    if (totalDeliveries === 1) {
      this.stats.averageResponseTime = responseTime;
    } else {
      this.stats.averageResponseTime = 
        ((currentAverage * (totalDeliveries - 1)) + responseTime) / totalDeliveries;
    }
  }

  /**
   * Update statistics
   */
  updateStats() {
    let healthy = 0;
    let unhealthy = 0;

    for (const health of this.healthChecks.values()) {
      if (health.status === 'healthy') healthy++;
      else if (health.status === 'unhealthy') unhealthy++;
    }

    this.stats.healthyUrls = healthy;
    this.stats.unhealthyUrls = unhealthy;
    this.stats.lastUpdated = Date.now();
  }

  /**
   * Get health summary
   * @returns {Object} Health summary
   */
  getHealthSummary() {
    const summary = {
      totalUrls: this.webhookUrls.size,
      healthyUrls: 0,
      unhealthyUrls: 0,
      unknownUrls: 0,
      details: {}
    };

    for (const [url, health] of this.healthChecks) {
      summary.details[url] = {
        status: health.status,
        consecutiveFailures: health.consecutiveFailures,
        averageResponseTime: health.averageResponseTime,
        lastCheck: health.lastCheck,
        lastError: health.lastError
      };

      summary[health.status + 'Urls']++;
    }

    return summary;
  }

  /**
   * Generate unique event ID
   * @returns {string} Event ID
   */
  generateEventId() {
    return crypto.randomUUID();
  }

  /**
   * Get comprehensive statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return Object.assign({}, this.stats, {
      queueSize: this.queue.length,
      registeredUrls: this.webhookUrls.size,
      failedUrlsCount: this.failedUrls.size,
      processing: this.processing,
      retryManagerStats: this.retryManager.getStats()
    });
  }

  /**
   * Get failed URLs information
   * @returns {Object} Failed URLs mapping
   */
  getFailedUrls() {
    return Object.fromEntries(this.failedUrls);
  }

  /**
   * Clear failed URLs tracking
   * @param {string} url - Specific URL to clear, or null for all
   */
  clearFailedUrls(url = null) {
    if (url) {
      this.failedUrls.delete(url);
    } else {
      this.failedUrls.clear();
    }
    this.emit('failedUrlsCleared', url);
  }

  /**
   * Cleanup resources
   */
  destroy() {
    // Stop timers
    this.stopProcessing();

    // Clear data
    this.queue = [];
    this.webhookUrls.clear();
    this.healthChecks.clear();
    this.responseTimes.clear();
    this.failedUrls.clear();

    // Remove event listeners
    this.removeAllListeners();
    
    this.emit('destroyed');
  }
}

export default WebhookDispatcher;

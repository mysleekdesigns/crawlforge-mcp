/**
 * ConnectionPool - HTTP connection pooling with backpressure handling
 * Optimizes concurrent requests through connection reuse and intelligent queueing
 */

import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { EventEmitter } from 'events';
import { config } from '../../constants/config.js';

export class ConnectionPool extends EventEmitter {
  constructor(options = {}) {
    super();
    
    const {
      maxSockets = 50,
      maxFreeSockets = 10,
      timeout = 30000,
      keepAlive = true,
      keepAliveMsecs = 1000,
      maxCachedSessions = 100,
      backpressureThreshold = 0.8,
      cleanupInterval = 60000,
      enableMetrics = true
    } = options;

    this.maxSockets = maxSockets;
    this.maxFreeSockets = maxFreeSockets;
    this.timeout = timeout;
    this.keepAlive = keepAlive;
    this.keepAliveMsecs = keepAliveMsecs;
    this.maxCachedSessions = maxCachedSessions;
    this.backpressureThreshold = backpressureThreshold;
    this.cleanupInterval = cleanupInterval;
    this.enableMetrics = enableMetrics;

    // Create HTTP/HTTPS agents
    this.httpAgent = new HttpAgent({
      keepAlive: this.keepAlive,
      keepAliveMsecs: this.keepAliveMsecs,
      maxSockets: this.maxSockets,
      maxFreeSockets: this.maxFreeSockets,
      timeout: this.timeout,
      scheduling: 'fifo'
    });

    this.httpsAgent = new HttpsAgent({
      keepAlive: this.keepAlive,
      keepAliveMsecs: this.keepAliveMsecs,
      maxSockets: this.maxSockets,
      maxFreeSockets: this.maxFreeSockets,
      timeout: this.timeout,
      maxCachedSessions: this.maxCachedSessions,
      scheduling: 'fifo'
    });

    // Connection tracking
    this.activeConnections = new Map();
    this.connectionStats = new Map();
    this.requestQueue = [];
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      activeRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      connectionReuse: 0,
      backpressureEvents: 0,
      avgResponseTime: 0,
      peakConcurrency: 0
    };

    // Backpressure state
    this.backpressureActive = false;
    this.lastBackpressureCheck = Date.now();

    // Start cleanup interval
    if (this.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanup();
      }, this.cleanupInterval);
    }

    this.setupAgentMonitoring();
    this.setupGracefulShutdown();
  }

  /**
   * Get appropriate agent for URL
   * @param {string} protocol - URL protocol
   * @returns {Agent} - HTTP or HTTPS agent
   */
  getAgent(protocol) {
    return protocol === 'https:' ? this.httpsAgent : this.httpAgent;
  }

  /**
   * Execute HTTP request with connection pooling
   * @param {Object} options - Request options
   * @returns {Promise<Object>} - Request result
   */
  async request(options) {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    
    this.metrics.totalRequests++;
    this.metrics.activeRequests++;
    this.metrics.peakConcurrency = Math.max(this.metrics.peakConcurrency, this.metrics.activeRequests);

    try {
      // Check for backpressure
      if (this.shouldApplyBackpressure()) {
        await this.handleBackpressure(requestId);
      }

      // Track connection
      this.trackConnection(requestId, options, startTime);

      // Execute request
      const result = await this.executeRequest(options, requestId);
      
      // Update metrics
      const duration = Date.now() - startTime;
      this.updateSuccessMetrics(duration);
      
      this.emit('requestCompleted', { requestId, duration, options });
      
      return result;

    } catch (error) {
      this.metrics.failedRequests++;
      this.emit('requestFailed', { requestId, error: error.message, options });
      throw error;
    } finally {
      this.metrics.activeRequests--;
      this.untrackConnection(requestId);
    }
  }

  /**
   * Execute multiple requests with intelligent batching
   * @param {Array} requests - Array of request options
   * @param {Object} batchOptions - Batching configuration
   * @returns {Promise<Array>} - Array of results
   */
  async requestBatch(requests, batchOptions = {}) {
    const {
      maxConcurrent = Math.min(this.maxSockets * 0.8, 20),
      failFast = false,
      retryFailures = false,
      batchDelay = 0
    } = batchOptions;

    const chunks = this.chunkArray(requests, maxConcurrent);
    const results = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      if (i > 0 && batchDelay > 0) {
        await this.delay(batchDelay);
      }

      const chunkPromises = chunk.map(async (requestOptions) => {
        try {
          return await this.request(requestOptions);
        } catch (error) {
          if (failFast) throw error;
          return { error: error.message, options: requestOptions };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);

      // Handle fail-fast mode
      if (failFast && chunkResults.some(result => result && result.error)) {
        throw new Error('Batch request failed in fail-fast mode');
      }

      // Check for backpressure between chunks
      if (this.shouldApplyBackpressure()) {
        await this.handleBackpressure(`batch_${i}`);
      }
    }

    // Retry failures if requested
    if (retryFailures) {
      const failedRequests = results
        .map((result, index) => ({ result, index, original: requests[index] }))
        .filter(({ result }) => result && result.error)
        .map(({ original }) => original);

      if (failedRequests.length > 0) {
        const retryResults = await this.requestBatch(failedRequests, {
          ...batchOptions,
          retryFailures: false // Prevent infinite recursion
        });
        
        // Merge retry results back
        let retryIndex = 0;
        for (let i = 0; i < results.length; i++) {
          if (results[i] && results[i].error) {
            results[i] = retryResults[retryIndex++];
          }
        }
      }
    }

    return results;
  }

  /**
   * Execute the actual HTTP request
   * @param {Object} options - Request options
   * @param {string} requestId - Request ID
   * @returns {Promise<Object>} - Request result
   */
  async executeRequest(options, requestId) {
    const { fetch } = await import('node-fetch');
    
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout = this.timeout,
      ...otherOptions
    } = options;

    const urlObj = new URL(url);
    const agent = this.getAgent(urlObj.protocol);

    const fetchOptions = {
      method,
      headers: {
        'User-Agent': config.crawling.userAgent,
        ...headers
      },
      body,
      timeout,
      agent,
      ...otherOptions
    };

    const response = await fetch(url, fetchOptions);
    
    // Check if connection was reused
    if (this.wasConnectionReused(agent, urlObj.hostname)) {
      this.metrics.connectionReuse++;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      url: response.url,
      body: await response.text(),
      ok: response.ok
    };
  }

  /**
   * Check if backpressure should be applied
   * @returns {boolean} - Whether to apply backpressure
   */
  shouldApplyBackpressure() {
    const now = Date.now();
    
    // Only check periodically to avoid overhead
    if (now - this.lastBackpressureCheck < 1000) {
      return this.backpressureActive;
    }

    this.lastBackpressureCheck = now;

    const activeRatio = this.metrics.activeRequests / this.maxSockets;
    const shouldActivate = activeRatio > this.backpressureThreshold;

    if (shouldActivate && !this.backpressureActive) {
      this.backpressureActive = true;
      this.metrics.backpressureEvents++;
      this.emit('backpressureActivated', { activeRequests: this.metrics.activeRequests });
    } else if (!shouldActivate && this.backpressureActive) {
      this.backpressureActive = false;
      this.emit('backpressureDeactivated', { activeRequests: this.metrics.activeRequests });
    }

    return this.backpressureActive;
  }

  /**
   * Handle backpressure by delaying request
   * @param {string} requestId - Request ID
   */
  async handleBackpressure(requestId) {
    const baseDelay = 100;
    const maxDelay = 2000;
    const backoffMultiplier = Math.min(this.metrics.backpressureEvents, 10);
    
    const delay = Math.min(baseDelay * Math.pow(1.5, backoffMultiplier), maxDelay);
    
    this.emit('backpressureDelay', { requestId, delay });
    await this.delay(delay);
  }

  /**
   * Track active connection
   * @param {string} requestId - Request ID
   * @param {Object} options - Request options
   * @param {number} startTime - Request start time
   */
  trackConnection(requestId, options, startTime) {
    this.activeConnections.set(requestId, {
      url: options.url,
      method: options.method || 'GET',
      startTime,
      host: new URL(options.url).hostname
    });

    // Update per-host statistics
    const host = new URL(options.url).hostname;
    if (!this.connectionStats.has(host)) {
      this.connectionStats.set(host, {
        totalRequests: 0,
        activeRequests: 0,
        avgResponseTime: 0,
        lastRequestTime: startTime
      });
    }

    const hostStats = this.connectionStats.get(host);
    hostStats.totalRequests++;
    hostStats.activeRequests++;
    hostStats.lastRequestTime = startTime;
  }

  /**
   * Stop tracking connection
   * @param {string} requestId - Request ID
   */
  untrackConnection(requestId) {
    const connection = this.activeConnections.get(requestId);
    if (connection) {
      const hostStats = this.connectionStats.get(connection.host);
      if (hostStats) {
        hostStats.activeRequests--;
        
        const duration = Date.now() - connection.startTime;
        hostStats.avgResponseTime = (
          (hostStats.avgResponseTime * (hostStats.totalRequests - 1) + duration) / 
          hostStats.totalRequests
        );
      }
      
      this.activeConnections.delete(requestId);
    }
  }

  /**
   * Check if connection was reused
   * @param {Agent} agent - HTTP/HTTPS agent
   * @param {string} hostname - Target hostname
   * @returns {boolean} - Whether connection was reused
   */
  wasConnectionReused(agent, hostname) {
    const sockets = agent.sockets[hostname] || [];
    const freeSockets = agent.freeSockets[hostname] || [];
    
    // If there are free sockets or multiple sockets, connection was likely reused
    return freeSockets.length > 0 || sockets.length > 1;
  }

  /**
   * Update success metrics
   * @param {number} duration - Request duration
   */
  updateSuccessMetrics(duration) {
    this.metrics.completedRequests++;
    
    // Update average response time
    const totalCompleted = this.metrics.completedRequests;
    this.metrics.avgResponseTime = (
      (this.metrics.avgResponseTime * (totalCompleted - 1) + duration) / totalCompleted
    );
  }

  /**
   * Generate unique request ID
   * @returns {string} - Request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
   * Delay execution
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Setup agent monitoring
   */
  setupAgentMonitoring() {
    if (!this.enableMetrics) return;

    const monitorAgent = (agent, protocol) => {
      const originalCreateConnection = agent.createConnection;
      agent.createConnection = (...args) => {
        this.emit('connectionCreated', { protocol });
        return originalCreateConnection.apply(agent, args);
      };
    };

    monitorAgent(this.httpAgent, 'http');
    monitorAgent(this.httpsAgent, 'https');
  }

  /**
   * Cleanup idle connections and stale statistics
   */
  cleanup() {
    const now = Date.now();
    const maxIdleTime = 300000; // 5 minutes

    // Cleanup stale host statistics
    for (const [host, stats] of this.connectionStats.entries()) {
      if (now - stats.lastRequestTime > maxIdleTime && stats.activeRequests === 0) {
        this.connectionStats.delete(host);
      }
    }

    // Force socket cleanup on agents
    this.httpAgent.destroy();
    this.httpsAgent.destroy();

    this.emit('cleanup', {
      hostsTracked: this.connectionStats.size,
      activeConnections: this.activeConnections.size
    });
  }

  /**
   * Get connection pool statistics
   * @returns {Object} - Statistics object
   */
  getStats() {
    return {
      ...this.metrics,
      activeConnections: this.activeConnections.size,
      hostsTracked: this.connectionStats.size,
      backpressureActive: this.backpressureActive,
      httpSockets: Object.keys(this.httpAgent.sockets).length,
      httpFreeSockets: Object.keys(this.httpAgent.freeSockets).length,
      httpsSockets: Object.keys(this.httpsAgent.sockets).length,
      httpsFreeSockets: Object.keys(this.httpsAgent.freeSockets).length
    };
  }

  /**
   * Get per-host statistics
   * @returns {Map} - Host statistics
   */
  getHostStats() {
    return new Map(this.connectionStats);
  }

  /**
   * Get active connections information
   * @returns {Array} - Active connections
   */
  getActiveConnections() {
    return Array.from(this.activeConnections.entries()).map(([id, info]) => ({
      id,
      ...info,
      duration: Date.now() - info.startTime
    }));
  }

  /**
   * Force close all connections
   */
  async closeAllConnections() {
    // Destroy all agent connections
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
    
    // Clear tracking
    this.activeConnections.clear();
    this.connectionStats.clear();
    
    this.emit('allConnectionsClosed');
  }

  /**
   * Graceful shutdown
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.emit('shutdown');
    
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Wait for active requests to complete or timeout
    const shutdownTimeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.activeConnections.size > 0 && (Date.now() - startTime) < shutdownTimeout) {
      await this.delay(100);
    }

    // Force close remaining connections
    await this.closeAllConnections();
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const shutdown = async () => {
      console.log('ConnectionPool: Graceful shutdown initiated');
      await this.shutdown();
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

export default ConnectionPool;
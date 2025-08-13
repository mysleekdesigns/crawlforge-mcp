/**
 * Metrics Collection System for MCP WebScraper
 * Comprehensive performance metrics, analytics, and reporting
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';
import { createLogger } from '../utils/Logger.js';

const logger = createLogger('Metrics');

export class MetricsCollector extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      collectInterval: options.collectInterval || 10000, // 10 seconds
      retentionPeriod: options.retentionPeriod || 7 * 24 * 60 * 60 * 1000, // 7 days
      exportInterval: options.exportInterval || 60000, // 1 minute
      exportPath: options.exportPath || './cache/metrics',
      enableFileExport: options.enableFileExport !== false,
      enableRealtimeMetrics: options.enableRealtimeMetrics !== false,
      ...options
    };

    // Core metrics storage
    this.metrics = {
      system: {
        startTime: Date.now(),
        totalRequests: 0,
        totalErrors: 0,
        totalResponseTime: 0,
        toolUsage: new Map(),
        errorsByType: new Map(),
        responseTimeHistogram: new Map(),
        memoryUsageHistory: [],
        cpuUsageHistory: []
      },
      tools: {
        // Tool-specific metrics
        fetch_url: this.createToolMetrics(),
        search_web: this.createToolMetrics(),
        crawl_deep: this.createToolMetrics(),
        map_site: this.createToolMetrics(),
        extract_content: this.createToolMetrics(),
        process_document: this.createToolMetrics(),
        summarize_content: this.createToolMetrics(),
        analyze_content: this.createToolMetrics(),
        extract_text: this.createToolMetrics(),
        extract_links: this.createToolMetrics(),
        extract_metadata: this.createToolMetrics(),
        scrape_structured: this.createToolMetrics()
      },
      cache: {
        hits: 0,
        misses: 0,
        writes: 0,
        evictions: 0,
        totalSize: 0,
        hitRateHistory: [],
        avgResponseTimeCache: 0,
        avgResponseTimeNonCache: 0
      },
      performance: {
        workerPool: {
          activeWorkers: 0,
          queuedTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          avgTaskDuration: 0
        },
        connectionPool: {
          activeConnections: 0,
          totalConnections: 0,
          connectionErrors: 0,
          avgConnectionTime: 0
        },
        queue: {
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          avgWaitTime: 0
        }
      },
      realtime: {
        requestsPerSecond: 0,
        errorsPerSecond: 0,
        avgResponseTime: 0,
        activeOperations: 0,
        memoryUsage: 0,
        cpuUsage: 0
      }
    };

    // Time-series data for trends
    this.timeSeries = {
      requests: [],
      errors: [],
      responseTime: [],
      memoryUsage: [],
      cpuUsage: [],
      cacheHitRate: []
    };

    this.isCollecting = false;
    this.collectionTimer = null;
    this.exportTimer = null;
  }

  /**
   * Start metrics collection
   */
  async start() {
    if (this.isCollecting) {
      logger.warn('Metrics collection already running');
      return;
    }

    this.isCollecting = true;
    this.metrics.system.startTime = Date.now();

    // Ensure export directory exists
    if (this.options.enableFileExport) {
      await this.ensureExportDirectory();
    }

    // Start collection intervals
    this.collectionTimer = setInterval(() => {
      this.collectSystemMetrics();
    }, this.options.collectInterval);

    if (this.options.enableFileExport) {
      this.exportTimer = setInterval(() => {
        this.exportMetrics();
      }, this.options.exportInterval);
    }

    logger.info('Metrics collection started', {
      interval: this.options.collectInterval,
      exportInterval: this.options.exportInterval,
      exportPath: this.options.exportPath
    });

    this.emit('started');
  }

  /**
   * Stop metrics collection
   */
  async stop() {
    if (!this.isCollecting) {
      return;
    }

    this.isCollecting = false;

    if (this.collectionTimer) {
      clearInterval(this.collectionTimer);
      this.collectionTimer = null;
    }

    if (this.exportTimer) {
      clearInterval(this.exportTimer);
      this.exportTimer = null;
    }

    // Final export
    if (this.options.enableFileExport) {
      await this.exportMetrics();
    }

    logger.info('Metrics collection stopped');
    this.emit('stopped');
  }

  /**
   * Record a tool execution
   * @param {string} toolName - Name of the tool
   * @param {number} responseTime - Execution time in milliseconds
   * @param {boolean} isError - Whether the execution resulted in an error
   * @param {Object} metadata - Additional metadata
   */
  recordToolExecution(toolName, responseTime, isError = false, metadata = {}) {
    const timestamp = Date.now();
    
    // Update system metrics
    this.metrics.system.totalRequests++;
    this.metrics.system.totalResponseTime += responseTime;
    
    if (isError) {
      this.metrics.system.totalErrors++;
      const errorType = metadata.errorType || 'unknown';
      this.metrics.system.errorsByType.set(
        errorType,
        (this.metrics.system.errorsByType.get(errorType) || 0) + 1
      );
    }

    // Update tool-specific metrics
    if (this.metrics.tools[toolName]) {
      const toolMetrics = this.metrics.tools[toolName];
      toolMetrics.totalCalls++;
      toolMetrics.totalResponseTime += responseTime;
      
      if (isError) {
        toolMetrics.totalErrors++;
      } else {
        toolMetrics.successfulCalls++;
      }

      // Update percentiles
      toolMetrics.responseTimes.push(responseTime);
      if (toolMetrics.responseTimes.length > 1000) {
        toolMetrics.responseTimes = toolMetrics.responseTimes.slice(-1000);
      }

      // Calculate running averages
      toolMetrics.avgResponseTime = toolMetrics.totalResponseTime / toolMetrics.totalCalls;
      toolMetrics.errorRate = toolMetrics.totalErrors / toolMetrics.totalCalls;
      toolMetrics.lastUsed = timestamp;
    }

    // Update usage tracking
    this.metrics.system.toolUsage.set(
      toolName,
      (this.metrics.system.toolUsage.get(toolName) || 0) + 1
    );

    // Update response time histogram
    const bucket = this.getResponseTimeBucket(responseTime);
    this.metrics.system.responseTimeHistogram.set(
      bucket,
      (this.metrics.system.responseTimeHistogram.get(bucket) || 0) + 1
    );

    // Add to time series
    this.timeSeries.requests.push({ timestamp, value: 1 });
    if (isError) {
      this.timeSeries.errors.push({ timestamp, value: 1 });
    }
    this.timeSeries.responseTime.push({ timestamp, value: responseTime });

    // Clean old time series data
    this.cleanTimeSeries();

    // Emit event for real-time monitoring
    this.emit('toolExecution', {
      toolName,
      responseTime,
      isError,
      metadata,
      timestamp
    });

    logger.debug('Recorded tool execution', {
      tool: toolName,
      responseTime,
      isError,
      timestamp
    });
  }

  /**
   * Record cache operation
   * @param {string} operation - 'hit', 'miss', 'write', 'eviction'
   * @param {Object} metadata - Additional metadata
   */
  recordCacheOperation(operation, metadata = {}) {
    const cache = this.metrics.cache;
    
    switch (operation) {
      case 'hit':
        cache.hits++;
        if (metadata.responseTime) {
          cache.avgResponseTimeCache = this.updateAverage(
            cache.avgResponseTimeCache,
            metadata.responseTime,
            cache.hits
          );
        }
        break;
      case 'miss':
        cache.misses++;
        if (metadata.responseTime) {
          cache.avgResponseTimeNonCache = this.updateAverage(
            cache.avgResponseTimeNonCache,
            metadata.responseTime,
            cache.misses
          );
        }
        break;
      case 'write':
        cache.writes++;
        break;
      case 'eviction':
        cache.evictions++;
        break;
    }

    if (metadata.cacheSize !== undefined) {
      cache.totalSize = metadata.cacheSize;
    }

    // Calculate and store hit rate
    const total = cache.hits + cache.misses;
    if (total > 0) {
      const hitRate = cache.hits / total;
      cache.hitRateHistory.push({
        timestamp: Date.now(),
        value: hitRate
      });

      // Keep only recent history
      if (cache.hitRateHistory.length > 1000) {
        cache.hitRateHistory = cache.hitRateHistory.slice(-1000);
      }

      this.timeSeries.cacheHitRate.push({
        timestamp: Date.now(),
        value: hitRate
      });
    }

    this.emit('cacheOperation', {
      operation,
      metadata,
      currentHitRate: total > 0 ? cache.hits / total : 0
    });
  }

  /**
   * Record worker pool metrics
   * @param {Object} stats - Worker pool statistics
   */
  recordWorkerPoolMetrics(stats) {
    Object.assign(this.metrics.performance.workerPool, stats);
    this.emit('workerPoolMetrics', stats);
  }

  /**
   * Record connection pool metrics
   * @param {Object} stats - Connection pool statistics
   */
  recordConnectionPoolMetrics(stats) {
    Object.assign(this.metrics.performance.connectionPool, stats);
    this.emit('connectionPoolMetrics', stats);
  }

  /**
   * Record queue metrics
   * @param {Object} stats - Queue statistics
   */
  recordQueueMetrics(stats) {
    Object.assign(this.metrics.performance.queue, stats);
    this.emit('queueMetrics', stats);
  }

  /**
   * Collect system-level metrics
   */
  collectSystemMetrics() {
    const timestamp = Date.now();
    
    // Memory usage
    const memUsage = process.memoryUsage();
    this.metrics.system.memoryUsageHistory.push({
      timestamp,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external
    });

    this.timeSeries.memoryUsage.push({
      timestamp,
      value: memUsage.heapUsed
    });

    // CPU usage (simplified)
    const cpuUsage = process.cpuUsage();
    this.metrics.system.cpuUsageHistory.push({
      timestamp,
      user: cpuUsage.user,
      system: cpuUsage.system
    });

    // Update realtime metrics
    this.updateRealtimeMetrics();

    // Clean old history
    this.cleanHistoryData();
    this.cleanTimeSeries();

    this.emit('systemMetrics', {
      memory: memUsage,
      cpu: cpuUsage,
      timestamp
    });
  }

  /**
   * Update realtime metrics
   */
  updateRealtimeMetrics() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Calculate requests per second
    const recentRequests = this.timeSeries.requests.filter(r => r.timestamp > oneMinuteAgo);
    this.metrics.realtime.requestsPerSecond = recentRequests.length / 60;

    // Calculate errors per second
    const recentErrors = this.timeSeries.errors.filter(e => e.timestamp > oneMinuteAgo);
    this.metrics.realtime.errorsPerSecond = recentErrors.length / 60;

    // Calculate average response time
    const recentResponseTimes = this.timeSeries.responseTime.filter(r => r.timestamp > oneMinuteAgo);
    if (recentResponseTimes.length > 0) {
      this.metrics.realtime.avgResponseTime = 
        recentResponseTimes.reduce((sum, r) => sum + r.value, 0) / recentResponseTimes.length;
    }

    // Memory and CPU from latest readings
    if (this.metrics.system.memoryUsageHistory.length > 0) {
      const latest = this.metrics.system.memoryUsageHistory[this.metrics.system.memoryUsageHistory.length - 1];
      this.metrics.realtime.memoryUsage = latest.heapUsed;
    }
  }

  /**
   * Get comprehensive metrics report
   * @param {Object} options - Report options
   * @returns {Object} Metrics report
   */
  getMetrics(options = {}) {
    const {
      includeTimeSeries = false,
      includeHistory = false,
      includePercentiles = true,
      timeRange = null
    } = options;

    const report = {
      timestamp: Date.now(),
      uptime: Date.now() - this.metrics.system.startTime,
      summary: this.generateSummary(),
      tools: this.generateToolMetrics(includePercentiles),
      cache: { ...this.metrics.cache },
      performance: { ...this.metrics.performance },
      realtime: { ...this.metrics.realtime }
    };

    if (includeTimeSeries) {
      report.timeSeries = this.filterTimeSeriesByRange(timeRange);
    }

    if (includeHistory) {
      report.history = {
        memory: this.filterHistoryByRange(this.metrics.system.memoryUsageHistory, timeRange),
        cpu: this.filterHistoryByRange(this.metrics.system.cpuUsageHistory, timeRange)
      };
    }

    return report;
  }

  /**
   * Generate summary metrics
   */
  generateSummary() {
    const { system } = this.metrics;
    const uptime = Date.now() - system.startTime;
    
    return {
      totalRequests: system.totalRequests,
      totalErrors: system.totalErrors,
      errorRate: system.totalRequests > 0 ? system.totalErrors / system.totalRequests : 0,
      avgResponseTime: system.totalRequests > 0 ? system.totalResponseTime / system.totalRequests : 0,
      requestsPerSecond: system.totalRequests / (uptime / 1000),
      uptime,
      mostUsedTool: this.getMostUsedTool(),
      cacheHitRate: this.getCacheHitRate()
    };
  }

  /**
   * Generate tool-specific metrics
   */
  generateToolMetrics(includePercentiles = true) {
    const toolMetrics = {};
    
    for (const [toolName, metrics] of Object.entries(this.metrics.tools)) {
      toolMetrics[toolName] = {
        totalCalls: metrics.totalCalls,
        successfulCalls: metrics.successfulCalls,
        totalErrors: metrics.totalErrors,
        avgResponseTime: metrics.avgResponseTime,
        errorRate: metrics.errorRate,
        lastUsed: metrics.lastUsed
      };

      if (includePercentiles && metrics.responseTimes.length > 0) {
        toolMetrics[toolName].percentiles = this.calculatePercentiles(metrics.responseTimes);
      }
    }

    return toolMetrics;
  }

  /**
   * Calculate percentiles for response times
   */
  calculatePercentiles(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      p50: sorted[Math.floor(len * 0.5)],
      p75: sorted[Math.floor(len * 0.75)],
      p90: sorted[Math.floor(len * 0.90)],
      p95: sorted[Math.floor(len * 0.95)],
      p99: sorted[Math.floor(len * 0.99)]
    };
  }

  /**
   * Export metrics to file
   */
  async exportMetrics() {
    if (!this.options.enableFileExport) {
      return;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const metrics = this.getMetrics({ includeTimeSeries: true, includeHistory: true });

      // Export comprehensive metrics
      const metricsPath = path.join(this.options.exportPath, `metrics-${timestamp}.json`);
      await fs.writeFile(metricsPath, JSON.stringify(metrics, null, 2));

      // Export CSV summary for analysis tools
      const csvPath = path.join(this.options.exportPath, `metrics-summary-${timestamp}.csv`);
      await this.exportCSV(metrics, csvPath);

      logger.debug('Metrics exported', { metricsPath, csvPath });
      this.emit('metricsExported', { metricsPath, csvPath });

    } catch (error) {
      logger.error('Failed to export metrics', { error: error.message });
      this.emit('exportError', error);
    }
  }

  /**
   * Export metrics as CSV
   */
  async exportCSV(metrics, filePath) {
    const csvLines = [];
    
    // Header
    csvLines.push('timestamp,tool,totalCalls,successfulCalls,errorRate,avgResponseTime,p95ResponseTime');

    // Tool data
    for (const [toolName, toolMetrics] of Object.entries(metrics.tools)) {
      csvLines.push([
        metrics.timestamp,
        toolName,
        toolMetrics.totalCalls,
        toolMetrics.successfulCalls,
        (toolMetrics.errorRate * 100).toFixed(2),
        toolMetrics.avgResponseTime.toFixed(2),
        toolMetrics.percentiles?.p95 || 0
      ].join(','));
    }

    await fs.writeFile(filePath, csvLines.join('\n'));
  }

  /**
   * Create tool metrics structure
   */
  createToolMetrics() {
    return {
      totalCalls: 0,
      successfulCalls: 0,
      totalErrors: 0,
      totalResponseTime: 0,
      avgResponseTime: 0,
      errorRate: 0,
      responseTimes: [],
      lastUsed: null
    };
  }

  /**
   * Get response time bucket for histogram
   */
  getResponseTimeBucket(responseTime) {
    if (responseTime < 100) return '0-100ms';
    if (responseTime < 500) return '100-500ms';
    if (responseTime < 1000) return '500ms-1s';
    if (responseTime < 2000) return '1-2s';
    if (responseTime < 5000) return '2-5s';
    return '5s+';
  }

  /**
   * Update running average
   */
  updateAverage(currentAvg, newValue, count) {
    return ((currentAvg * (count - 1)) + newValue) / count;
  }

  /**
   * Get most used tool
   */
  getMostUsedTool() {
    let maxUsage = 0;
    let mostUsed = null;

    for (const [tool, usage] of this.metrics.system.toolUsage.entries()) {
      if (usage > maxUsage) {
        maxUsage = usage;
        mostUsed = tool;
      }
    }

    return mostUsed;
  }

  /**
   * Get current cache hit rate
   */
  getCacheHitRate() {
    const { cache } = this.metrics;
    const total = cache.hits + cache.misses;
    return total > 0 ? cache.hits / total : 0;
  }

  /**
   * Clean old time series data
   */
  cleanTimeSeries() {
    const cutoff = Date.now() - this.options.retentionPeriod;
    
    for (const series of Object.values(this.timeSeries)) {
      const originalLength = series.length;
      const filtered = series.filter(item => item.timestamp > cutoff);
      if (filtered.length !== originalLength) {
        series.length = 0;
        series.push(...filtered);
      }
    }
  }

  /**
   * Clean old history data
   */
  cleanHistoryData() {
    const cutoff = Date.now() - this.options.retentionPeriod;
    
    this.metrics.system.memoryUsageHistory = this.metrics.system.memoryUsageHistory
      .filter(item => item.timestamp > cutoff);
    
    this.metrics.system.cpuUsageHistory = this.metrics.system.cpuUsageHistory
      .filter(item => item.timestamp > cutoff);
  }

  /**
   * Filter time series by time range
   */
  filterTimeSeriesByRange(timeRange) {
    if (!timeRange) {
      return this.timeSeries;
    }

    const { start, end } = timeRange;
    const filtered = {};

    for (const [key, series] of Object.entries(this.timeSeries)) {
      filtered[key] = series.filter(item => 
        item.timestamp >= start && item.timestamp <= end
      );
    }

    return filtered;
  }

  /**
   * Filter history by time range
   */
  filterHistoryByRange(history, timeRange) {
    if (!timeRange || !history) {
      return history;
    }

    const { start, end } = timeRange;
    return history.filter(item => 
      item.timestamp >= start && item.timestamp <= end
    );
  }

  /**
   * Ensure export directory exists
   */
  async ensureExportDirectory() {
    try {
      await fs.access(this.options.exportPath);
    } catch (error) {
      await fs.mkdir(this.options.exportPath, { recursive: true });
    }
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.system = {
      startTime: Date.now(),
      totalRequests: 0,
      totalErrors: 0,
      totalResponseTime: 0,
      toolUsage: new Map(),
      errorsByType: new Map(),
      responseTimeHistogram: new Map(),
      memoryUsageHistory: [],
      cpuUsageHistory: []
    };

    // Reset tool metrics
    for (const toolName of Object.keys(this.metrics.tools)) {
      this.metrics.tools[toolName] = this.createToolMetrics();
    }

    // Reset cache metrics
    this.metrics.cache = {
      hits: 0,
      misses: 0,
      writes: 0,
      evictions: 0,
      totalSize: 0,
      hitRateHistory: [],
      avgResponseTimeCache: 0,
      avgResponseTimeNonCache: 0
    };

    // Clear time series
    for (const series of Object.values(this.timeSeries)) {
      series.length = 0;
    }

    logger.info('Metrics reset');
    this.emit('reset');
  }
}

export default MetricsCollector;
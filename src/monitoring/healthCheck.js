/**
 * Health Check System for CrawlForge MCP Server
 * Provides comprehensive health monitoring for production environments
 */

import { EventEmitter } from 'events';
import os from 'os';
import { performance } from 'perf_hooks';
import { config } from '../constants/config.js';
import { createLogger } from '../utils/Logger.js';

const logger = createLogger('HealthCheck');

export class HealthCheckManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      checkInterval: options.checkInterval || 30000, // 30 seconds
      timeout: options.timeout || 5000, // 5 seconds
      thresholds: {
        memoryUsage: options.memoryThreshold || 512 * 1024 * 1024, // 512MB
        cpuUsage: options.cpuThreshold || 90, // 90%
        responseTime: options.responseTimeThreshold || 2000, // 2 seconds
        errorRate: options.errorRateThreshold || 0.05, // 5%
        ...options.thresholds
      },
      ...options
    };

    this.healthStatus = {
      overall: 'healthy',
      lastCheck: Date.now(),
      uptime: Date.now(),
      checks: {}
    };

    this.dependencyChecks = new Map();
    this.performanceMonitor = {
      requestCount: 0,
      errorCount: 0,
      responseTimeSum: 0,
      lastMinuteRequests: [],
      lastMinuteErrors: []
    };

    this.isRunning = false;
    this.checkTimer = null;
  }

  /**
   * Start health monitoring
   */
  start() {
    if (this.isRunning) {
      logger.warn('Health monitoring is already running');
      return;
    }

    this.isRunning = true;
    this.healthStatus.uptime = Date.now();
    
    // Register core health checks
    this.registerCoreChecks();
    
    // Start periodic health checks
    this.checkTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.options.checkInterval);

    logger.info('Health monitoring started', {
      interval: this.options.checkInterval,
      thresholds: this.options.thresholds
    });

    this.emit('started');
  }

  /**
   * Stop health monitoring
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    logger.info('Health monitoring stopped');
    this.emit('stopped');
  }

  /**
   * Register core system health checks
   */
  registerCoreChecks() {
    // System resource checks
    this.registerCheck('memory', this.checkMemoryUsage.bind(this));
    this.registerCheck('cpu', this.checkCpuUsage.bind(this));
    this.registerCheck('disk', this.checkDiskSpace.bind(this));
    
    // Application health checks
    this.registerCheck('cache', this.checkCacheHealth.bind(this));
    this.registerCheck('queue', this.checkQueueHealth.bind(this));
    this.registerCheck('workers', this.checkWorkerHealth.bind(this));
    this.registerCheck('connections', this.checkConnectionHealth.bind(this));
    
    // External dependency checks
    this.registerCheck('search_api', this.checkSearchApiHealth.bind(this));
    this.registerCheck('network', this.checkNetworkConnectivity.bind(this));
  }

  /**
   * Register a health check function
   * @param {string} name - Check name
   * @param {Function} checkFunction - Function that returns health status
   */
  registerCheck(name, checkFunction) {
    this.dependencyChecks.set(name, checkFunction);
    logger.debug(`Registered health check: ${name}`);
  }

  /**
   * Unregister a health check
   * @param {string} name - Check name
   */
  unregisterCheck(name) {
    this.dependencyChecks.delete(name);
    logger.debug(`Unregistered health check: ${name}`);
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    const startTime = performance.now();
    const results = {};

    logger.debug('Starting health check');

    try {
      // Run all registered checks in parallel
      const checkPromises = Array.from(this.dependencyChecks.entries()).map(
        async ([name, checkFunction]) => {
          try {
            const checkStart = performance.now();
            const result = await Promise.race([
              checkFunction(),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Health check timeout')), this.options.timeout)
              )
            ]);
            
            return {
              name,
              status: 'healthy',
              responseTime: performance.now() - checkStart,
              details: result,
              timestamp: Date.now()
            };
          } catch (error) {
            return {
              name,
              status: 'unhealthy',
              error: error.message,
              timestamp: Date.now()
            };
          }
        }
      );

      const checkResults = await Promise.all(checkPromises);
      
      // Process results
      for (const result of checkResults) {
        results[result.name] = result;
      }

      // Determine overall health
      const unhealthyChecks = checkResults.filter(r => r.status === 'unhealthy');
      const warningChecks = checkResults.filter(r => r.status === 'warning');

      let overallStatus = 'healthy';
      if (unhealthyChecks.length > 0) {
        overallStatus = 'unhealthy';
      } else if (warningChecks.length > 0) {
        overallStatus = 'warning';
      }

      // Update health status
      this.healthStatus = {
        overall: overallStatus,
        lastCheck: Date.now(),
        uptime: this.healthStatus.uptime,
        checkDuration: performance.now() - startTime,
        checks: results,
        performance: this.getPerformanceMetrics()
      };

      // Emit health status event
      this.emit('healthCheck', this.healthStatus);

      // Log status changes
      if (overallStatus !== 'healthy') {
        logger.warn('Health check completed with issues', {
          status: overallStatus,
          unhealthyChecks: unhealthyChecks.length,
          warningChecks: warningChecks.length
        });
      } else {
        logger.debug('Health check completed successfully');
      }

    } catch (error) {
      logger.error('Health check failed', { error: error.message });
      
      this.healthStatus = {
        overall: 'unhealthy',
        lastCheck: Date.now(),
        uptime: this.healthStatus.uptime,
        error: error.message,
        checks: results
      };

      this.emit('healthCheckError', error);
    }
  }

  /**
   * Get current health status
   * @returns {Object} Current health status
   */
  getHealthStatus() {
    return {
      ...this.healthStatus,
      performance: this.getPerformanceMetrics()
    };
  }

  /**
   * Record a request for performance tracking
   * @param {number} responseTime - Response time in milliseconds
   * @param {boolean} isError - Whether the request resulted in an error
   */
  recordRequest(responseTime, isError = false) {
    const now = Date.now();
    
    this.performanceMonitor.requestCount++;
    this.performanceMonitor.responseTimeSum += responseTime;
    
    if (isError) {
      this.performanceMonitor.errorCount++;
    }

    // Track last minute metrics
    this.performanceMonitor.lastMinuteRequests.push({
      timestamp: now,
      responseTime,
      isError
    });

    // Clean up old entries (older than 1 minute)
    const oneMinuteAgo = now - 60000;
    this.performanceMonitor.lastMinuteRequests = this.performanceMonitor.lastMinuteRequests
      .filter(req => req.timestamp > oneMinuteAgo);
  }

  /**
   * Get performance metrics
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    const recentRequests = this.performanceMonitor.lastMinuteRequests
      .filter(req => req.timestamp > oneMinuteAgo);
    
    const recentErrors = recentRequests.filter(req => req.isError);
    
    const avgResponseTime = this.performanceMonitor.requestCount > 0
      ? this.performanceMonitor.responseTimeSum / this.performanceMonitor.requestCount
      : 0;

    return {
      totalRequests: this.performanceMonitor.requestCount,
      totalErrors: this.performanceMonitor.errorCount,
      avgResponseTime,
      errorRate: this.performanceMonitor.requestCount > 0
        ? this.performanceMonitor.errorCount / this.performanceMonitor.requestCount
        : 0,
      lastMinute: {
        requests: recentRequests.length,
        errors: recentErrors.length,
        avgResponseTime: recentRequests.length > 0
          ? recentRequests.reduce((sum, req) => sum + req.responseTime, 0) / recentRequests.length
          : 0,
        errorRate: recentRequests.length > 0
          ? recentErrors.length / recentRequests.length
          : 0
      }
    };
  }

  // Individual health check implementations

  /**
   * Check memory usage
   */
  async checkMemoryUsage() {
    const memUsage = process.memoryUsage();
    const systemMem = {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem()
    };

    const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    const systemUsagePercent = (systemMem.used / systemMem.total) * 100;

    const result = {
      process: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        heapUsagePercent,
        rss: memUsage.rss,
        external: memUsage.external
      },
      system: {
        total: systemMem.total,
        free: systemMem.free,
        used: systemMem.used,
        usagePercent: systemUsagePercent
      }
    };

    // Check against thresholds
    if (memUsage.heapUsed > this.options.thresholds.memoryUsage) {
      throw new Error(`Memory usage (${memUsage.heapUsed}) exceeds threshold (${this.options.thresholds.memoryUsage})`);
    }

    return result;
  }

  /**
   * Check CPU usage
   */
  async checkCpuUsage() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    // Calculate average CPU usage over a short interval
    const startUsage = process.cpuUsage();
    await new Promise(resolve => setTimeout(resolve, 100));
    const endUsage = process.cpuUsage(startUsage);
    
    const cpuPercent = ((endUsage.user + endUsage.system) / 100000); // Convert to percentage

    const result = {
      cores: cpus.length,
      loadAverage: {
        '1min': loadAvg[0],
        '5min': loadAvg[1],
        '15min': loadAvg[2]
      },
      usage: {
        user: endUsage.user,
        system: endUsage.system,
        percent: cpuPercent
      }
    };

    // Check against thresholds
    if (cpuPercent > this.options.thresholds.cpuUsage) {
      throw new Error(`CPU usage (${cpuPercent}%) exceeds threshold (${this.options.thresholds.cpuUsage}%)`);
    }

    return result;
  }

  /**
   * Check disk space
   */
  async checkDiskSpace() {
    // Note: This is a simplified check. In production, you might want to use statvfs or similar
    const stats = {
      available: true, // Placeholder - implement actual disk space check if needed
      usage: 'Not implemented'
    };

    return stats;
  }

  /**
   * Check cache health
   */
  async checkCacheHealth() {
    // This would integrate with your CacheManager
    return {
      status: 'operational',
      hitRate: 85, // Placeholder
      size: 1024 * 1024 // Placeholder
    };
  }

  /**
   * Check queue health
   */
  async checkQueueHealth() {
    // This would integrate with your QueueManager
    return {
      status: 'operational',
      pending: 0, // Placeholder
      processing: 0 // Placeholder
    };
  }

  /**
   * Check worker health
   */
  async checkWorkerHealth() {
    // This would integrate with your WorkerPool
    return {
      status: 'operational',
      activeWorkers: 0, // Placeholder
      totalWorkers: config.performance?.maxWorkers || 4
    };
  }

  /**
   * Check connection pool health
   */
  async checkConnectionHealth() {
    // This would integrate with your ConnectionPool
    return {
      status: 'operational',
      activeConnections: 0, // Placeholder
      poolSize: 20 // Placeholder
    };
  }

  /**
   * Check search API health
   */
  async checkSearchApiHealth() {
    try {
      // Simple connectivity test - you might want to implement actual API health checks
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch('https://www.google.com', {
        method: 'HEAD',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      return {
        status: 'operational',
        responseCode: response.status,
        responseTime: performance.now()
      };
    } catch (error) {
      throw new Error(`Search API health check failed: ${error.message}`);
    }
  }

  /**
   * Check network connectivity
   */
  async checkNetworkConnectivity() {
    try {
      const testUrls = [
        'https://www.google.com',
        'https://www.github.com'
      ];

      const results = await Promise.all(
        testUrls.map(async (url) => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            
            const start = performance.now();
            const response = await fetch(url, {
              method: 'HEAD',
              signal: controller.signal
            });
            const duration = performance.now() - start;
            
            clearTimeout(timeoutId);
            
            return {
              url,
              status: 'ok',
              responseTime: duration,
              statusCode: response.status
            };
          } catch (error) {
            return {
              url,
              status: 'error',
              error: error.message
            };
          }
        })
      );

      const failedChecks = results.filter(r => r.status === 'error');
      
      if (failedChecks.length === results.length) {
        throw new Error('All network connectivity tests failed');
      }

      return {
        results,
        successRate: (results.length - failedChecks.length) / results.length
      };
    } catch (error) {
      throw new Error(`Network connectivity check failed: ${error.message}`);
    }
  }

  /**
   * Generate health report in different formats
   * @param {string} format - Report format ('json', 'text', 'summary')
   * @returns {string|Object} Formatted health report
   */
  generateReport(format = 'json') {
    const status = this.getHealthStatus();
    
    switch (format) {
      case 'text':
        return this.generateTextReport(status);
      case 'summary':
        return this.generateSummaryReport(status);
      case 'json':
      default:
        return status;
    }
  }

  /**
   * Generate text-based health report
   */
  generateTextReport(status) {
    const lines = [];
    lines.push(`CrawlForge MCP Server Health Report`);
    lines.push(`Generated: ${new Date(status.lastCheck).toISOString()}`);
    lines.push(`Overall Status: ${status.overall.toUpperCase()}`);
    lines.push(`Uptime: ${Math.floor((Date.now() - status.uptime) / 1000)}s`);
    lines.push('');

    if (status.performance) {
      lines.push('Performance Metrics:');
      lines.push(`  Requests: ${status.performance.totalRequests}`);
      lines.push(`  Errors: ${status.performance.totalErrors}`);
      lines.push(`  Avg Response Time: ${status.performance.avgResponseTime.toFixed(2)}ms`);
      lines.push(`  Error Rate: ${(status.performance.errorRate * 100).toFixed(2)}%`);
      lines.push('');
    }

    lines.push('Health Checks:');
    for (const [name, check] of Object.entries(status.checks)) {
      lines.push(`  ${name}: ${check.status.toUpperCase()}`);
      if (check.error) {
        lines.push(`    Error: ${check.error}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate summary health report
   */
  generateSummaryReport(status) {
    const healthyChecks = Object.values(status.checks).filter(c => c.status === 'healthy').length;
    const totalChecks = Object.keys(status.checks).length;
    
    return {
      status: status.overall,
      uptime: Date.now() - status.uptime,
      checksHealthy: `${healthyChecks}/${totalChecks}`,
      lastCheck: status.lastCheck,
      performance: status.performance ? {
        requestsPerMinute: status.performance.lastMinute.requests,
        avgResponseTime: status.performance.avgResponseTime,
        errorRate: status.performance.errorRate
      } : null
    };
  }
}

export default HealthCheckManager;
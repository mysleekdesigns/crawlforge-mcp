/**
 * Logger - Comprehensive logging system with Winston integration
 * Features: Structured logging, multiple transports, contextual logging, request tracking
 */

import winston from 'winston';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class Logger {
  constructor(options = {}) {
    const {
      level = process.env.LOG_LEVEL || 'info',
      service = 'mcp-webscraper',
      enableConsole = true,
      enableFile = true,
      enableJson = process.env.NODE_ENV === 'production',
      logDir = join(__dirname, '../../logs'),
      maxFiles = 5,
      maxSize = '10m',
      enableRequestTracking = true,
      enableErrorTracking = true,
      enablePerformanceTracking = true
    } = options;

    this.service = service;
    this.enableRequestTracking = enableRequestTracking;
    this.enableErrorTracking = enableErrorTracking;
    this.enablePerformanceTracking = enablePerformanceTracking;
    this.logDir = logDir;

    // Ensure log directory exists
    this.ensureLogDirectory();

    // Request tracking
    this.requests = new Map(); // requestId -> request context
    this.requestCounter = 0;

    // Performance metrics
    this.metrics = {
      requests: 0,
      errors: 0,
      warnings: 0,
      averageResponseTime: 0,
      slowRequests: 0
    };

    // Create Winston logger
    this.winston = winston.createLogger({
      level,
      defaultMeta: { service: this.service },
      format: this.createFormat(enableJson),
      transports: this.createTransports(enableConsole, enableFile, maxFiles, maxSize),
      exitOnError: false
    });

    // Error handling for logger itself
    this.winston.on('error', (error) => {
      console.error('Logger error:', error);
    });
  }

  /**
   * Create Winston format configuration
   * @param {boolean} enableJson - Whether to use JSON format
   * @returns {winston.Format} Winston format
   */
  createFormat(enableJson) {
    const formats = [
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'service'] })
    ];

    if (enableJson) {
      formats.push(winston.format.json());
    } else {
      formats.push(
        winston.format.colorize({ all: true }),
        winston.format.printf(this.formatMessage.bind(this))
      );
    }

    return winston.format.combine(...formats);
  }

  /**
   * Create Winston transports
   * @param {boolean} enableConsole - Enable console transport
   * @param {boolean} enableFile - Enable file transport
   * @param {number} maxFiles - Maximum log files to keep
   * @param {string} maxSize - Maximum size per log file
   * @returns {Array} Array of Winston transports
   */
  createTransports(enableConsole, enableFile, maxFiles, maxSize) {
    const transports = [];

    if (enableConsole) {
      transports.push(new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      }));
    }

    if (enableFile) {
      // General log file
      transports.push(new winston.transports.File({
        filename: join(this.logDir, 'app.log'),
        maxFiles,
        maxsize: maxSize,
        tailable: true
      }));

      // Error log file
      transports.push(new winston.transports.File({
        filename: join(this.logDir, 'error.log'),
        level: 'error',
        maxFiles,
        maxsize: maxSize,
        tailable: true
      }));

      // Performance log file
      if (this.enablePerformanceTracking) {
        transports.push(new winston.transports.File({
          filename: join(this.logDir, 'performance.log'),
          level: 'info',
          maxFiles,
          maxsize: maxSize,
          tailable: true,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        }));
      }
    }

    return transports;
  }

  /**
   * Format log message for console output
   * @param {Object} info - Log info object
   * @returns {string} Formatted message
   */
  formatMessage(info) {
    const { timestamp, level, message, service, metadata } = info;
    let formatted = `[${timestamp}] ${level.toUpperCase()} [${service}]`;

    // Add request ID if available
    if (metadata.requestId) {
      formatted += ` [${metadata.requestId}]`;
    }

    formatted += `: ${message}`;

    // Add context information
    if (metadata.context && Object.keys(metadata.context).length > 0) {
      formatted += ` | Context: ${JSON.stringify(metadata.context)}`;
    }

    // Add error stack if available
    if (metadata.stack) {
      formatted += `\n${metadata.stack}`;
    }

    return formatted;
  }

  /**
   * Ensure log directory exists
   */
  ensureLogDirectory() {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Generate unique request ID
   * @returns {string} Request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${++this.requestCounter}`;
  }

  /**
   * Start request tracking
   * @param {Object} context - Request context
   * @returns {string} Request ID
   */
  startRequest(context = {}) {
    if (!this.enableRequestTracking) {
      return null;
    }

    const requestId = this.generateRequestId();
    const startTime = Date.now();

    this.requests.set(requestId, {
      ...context,
      startTime,
      requestId
    });

    this.metrics.requests++;

    this.info('Request started', {
      requestId,
      context,
      startTime
    });

    return requestId;
  }

  /**
   * End request tracking
   * @param {string} requestId - Request ID
   * @param {Object} result - Request result
   */
  endRequest(requestId, result = {}) {
    if (!this.enableRequestTracking || !requestId) {
      return;
    }

    const request = this.requests.get(requestId);
    if (!request) {
      return;
    }

    const endTime = Date.now();
    const duration = endTime - request.startTime;

    // Update performance metrics
    this.updatePerformanceMetrics(duration);

    // Log request completion
    this.info('Request completed', {
      requestId,
      duration: `${duration}ms`,
      result,
      context: request
    });

    // Log slow requests
    if (duration > 5000) { // 5 seconds threshold
      this.warn('Slow request detected', {
        requestId,
        duration: `${duration}ms`,
        context: request
      });
      this.metrics.slowRequests++;
    }

    this.requests.delete(requestId);
  }

  /**
   * Log request error
   * @param {string} requestId - Request ID
   * @param {Error} error - Error object
   * @param {Object} context - Additional context
   */
  requestError(requestId, error, context = {}) {
    if (!this.enableRequestTracking || !requestId) {
      this.error('Request error', error, context);
      return;
    }

    const request = this.requests.get(requestId);
    const duration = request ? Date.now() - request.startTime : null;

    this.error('Request failed', error, {
      requestId,
      duration: duration ? `${duration}ms` : 'unknown',
      context: { ...request, ...context }
    });

    if (request) {
      this.requests.delete(requestId);
    }
  }

  /**
   * Update performance metrics
   * @param {number} duration - Request duration in ms
   */
  updatePerformanceMetrics(duration) {
    if (!this.enablePerformanceTracking) {
      return;
    }

    const currentAverage = this.metrics.averageResponseTime;
    const totalRequests = this.metrics.requests;
    this.metrics.averageResponseTime = 
      ((currentAverage * (totalRequests - 1)) + duration) / totalRequests;
  }

  /**
   * Log debug message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   * @param {string} requestId - Optional request ID
   */
  debug(message, context = {}, requestId = null) {
    this.winston.debug(message, {
      context,
      requestId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log info message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   * @param {string} requestId - Optional request ID
   */
  info(message, context = {}, requestId = null) {
    this.winston.info(message, {
      context,
      requestId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   * @param {string} requestId - Optional request ID
   */
  warn(message, context = {}, requestId = null) {
    this.metrics.warnings++;
    this.winston.warn(message, {
      context,
      requestId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log error message
   * @param {string} message - Log message
   * @param {Error} error - Error object
   * @param {Object} context - Additional context
   * @param {string} requestId - Optional request ID
   */
  error(message, error = null, context = {}, requestId = null) {
    this.metrics.errors++;

    const errorContext = {
      ...context,
      requestId
    };

    if (error) {
      errorContext.error = {
        message: error.message,
        stack: error.stack,
        name: error.name,
        code: error.code
      };
    }

    this.winston.error(message, errorContext);

    // Track error for analysis
    if (this.enableErrorTracking) {
      this.trackError(error, context, requestId);
    }
  }

  /**
   * Log performance metrics
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in ms
   * @param {Object} context - Additional context
   * @param {string} requestId - Optional request ID
   */
  performance(operation, duration, context = {}, requestId = null) {
    if (!this.enablePerformanceTracking) {
      return;
    }

    this.info(`Performance: ${operation}`, {
      operation,
      duration: `${duration}ms`,
      ...context
    }, requestId);
  }

  /**
   * Track error for analysis
   * @param {Error} error - Error object
   * @param {Object} context - Additional context
   * @param {string} requestId - Request ID
   */
  trackError(error, context, requestId) {
    // Could be extended to send to error tracking service
    // For now, just log structured error data
    this.winston.error('Error tracking', {
      errorTracking: {
        type: error.name,
        message: error.message,
        stack: error.stack,
        context,
        requestId,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Create child logger with additional context
   * @param {Object} context - Additional context for all logs
   * @returns {Logger} Child logger instance
   */
  child(context = {}) {
    return new ChildLogger(this, context);
  }

  /**
   * Get logger statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.metrics,
      activeRequests: this.requests.size,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Set log level
   * @param {string} level - Log level
   */
  setLevel(level) {
    this.winston.level = level;
  }

  /**
   * Close logger and cleanup resources
   */
  close() {
    return new Promise((resolve) => {
      this.winston.close(() => {
        resolve();
      });
    });
  }
}

/**
 * Child logger that inherits from parent with additional context
 */
export class ChildLogger {
  constructor(parent, context) {
    this.parent = parent;
    this.context = context;
  }

  debug(message, additionalContext = {}, requestId = null) {
    this.parent.debug(message, { ...this.context, ...additionalContext }, requestId);
  }

  info(message, additionalContext = {}, requestId = null) {
    this.parent.info(message, { ...this.context, ...additionalContext }, requestId);
  }

  warn(message, additionalContext = {}, requestId = null) {
    this.parent.warn(message, { ...this.context, ...additionalContext }, requestId);
  }

  error(message, error = null, additionalContext = {}, requestId = null) {
    this.parent.error(message, error, { ...this.context, ...additionalContext }, requestId);
  }

  performance(operation, duration, additionalContext = {}, requestId = null) {
    this.parent.performance(operation, duration, { ...this.context, ...additionalContext }, requestId);
  }

  startRequest(additionalContext = {}) {
    return this.parent.startRequest({ ...this.context, ...additionalContext });
  }

  endRequest(requestId, result = {}) {
    this.parent.endRequest(requestId, result);
  }

  requestError(requestId, error, additionalContext = {}) {
    this.parent.requestError(requestId, error, { ...this.context, ...additionalContext });
  }

  child(additionalContext = {}) {
    return new ChildLogger(this.parent, { ...this.context, ...additionalContext });
  }
}

/**
 * Create a logger instance with preset configurations
 * @param {string} preset - Preset name
 * @param {Object} overrides - Configuration overrides
 * @returns {Logger} Logger instance
 */
export function createLogger(preset = 'default', overrides = {}) {
  const presets = {
    default: {
      level: 'info',
      enableConsole: true,
      enableFile: true,
      enableJson: false
    },
    development: {
      level: 'debug',
      enableConsole: true,
      enableFile: true,
      enableJson: false,
      enableRequestTracking: true,
      enablePerformanceTracking: true
    },
    production: {
      level: 'info',
      enableConsole: false,
      enableFile: true,
      enableJson: true,
      enableRequestTracking: true,
      enableErrorTracking: true,
      enablePerformanceTracking: true
    },
    testing: {
      level: 'error',
      enableConsole: false,
      enableFile: false,
      enableJson: false,
      enableRequestTracking: false
    },
    debug: {
      level: 'debug',
      enableConsole: true,
      enableFile: true,
      enableJson: false,
      enableRequestTracking: true,
      enablePerformanceTracking: true,
      enableErrorTracking: true
    }
  };

  const config = { ...presets[preset], ...overrides };
  return new Logger(config);
}

// Global logger instance
export const logger = createLogger(
  process.env.NODE_ENV === 'production' ? 'production' : 'development'
);

export default logger;
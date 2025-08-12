/**
 * ErrorHandlingConfig - Centralized configuration for error handling systems
 * Provides default configurations and factory methods for error handling components
 */

import { RetryManager } from './RetryManager.js';
import { createCircuitBreaker } from './CircuitBreaker.js';
import { createLogger } from './Logger.js';

/**
 * Default configurations for different service types
 */
export const DEFAULT_CONFIGS = {
  // Web scraping operations
  scraping: {
    retry: {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      strategy: 'exponential',
      jitter: true,
      retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'],
      retryableStatusCodes: [408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]
    },
    circuitBreaker: {
      threshold: 5,
      timeout: 30000,
      resetTimeout: 60000,
      halfOpenMaxCalls: 3,
      errorThresholdPercentage: 50,
      minimumThroughput: 10
    },
    logger: {
      level: 'info',
      enableRequestTracking: true,
      enablePerformanceTracking: true,
      enableErrorTracking: true
    }
  },

  // API operations (Google Search, etc.)
  api: {
    retry: {
      maxRetries: 4,
      baseDelay: 1000,
      maxDelay: 16000,
      strategy: 'exponential',
      jitter: true,
      retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'],
      retryableStatusCodes: [408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]
    },
    circuitBreaker: {
      threshold: 5,
      timeout: 30000,
      resetTimeout: 120000,
      halfOpenMaxCalls: 3,
      errorThresholdPercentage: 50,
      minimumThroughput: 20
    },
    logger: {
      level: 'info',
      enableRequestTracking: true,
      enablePerformanceTracking: true,
      enableErrorTracking: true
    }
  },

  // Network operations (general HTTP requests)
  network: {
    retry: {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      strategy: 'exponential',
      jitter: true,
      retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'],
      retryableStatusCodes: [408, 429, 500, 502, 503, 504]
    },
    circuitBreaker: {
      threshold: 3,
      timeout: 10000,
      resetTimeout: 60000,
      halfOpenMaxCalls: 2,
      errorThresholdPercentage: 40,
      minimumThroughput: 10
    },
    logger: {
      level: 'info',
      enableRequestTracking: true,
      enablePerformanceTracking: false,
      enableErrorTracking: true
    }
  },

  // File processing operations
  processing: {
    retry: {
      maxRetries: 2,
      baseDelay: 2000,
      maxDelay: 60000,
      strategy: 'linear',
      jitter: false,
      retryableErrors: ['EMFILE', 'ENFILE', 'EBUSY', 'ENOENT'],
      retryableStatusCodes: []
    },
    circuitBreaker: {
      threshold: 10,
      timeout: 60000,
      resetTimeout: 300000,
      halfOpenMaxCalls: 5,
      errorThresholdPercentage: 70,
      minimumThroughput: 5
    },
    logger: {
      level: 'info',
      enableRequestTracking: false,
      enablePerformanceTracking: true,
      enableErrorTracking: true
    }
  },

  // Critical operations (require high reliability)
  critical: {
    retry: {
      maxRetries: 5,
      baseDelay: 500,
      maxDelay: 10000,
      strategy: 'exponential',
      jitter: true,
      retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'],
      retryableStatusCodes: [408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]
    },
    circuitBreaker: {
      threshold: 3,
      timeout: 15000,
      resetTimeout: 30000,
      halfOpenMaxCalls: 2,
      errorThresholdPercentage: 30,
      minimumThroughput: 5
    },
    logger: {
      level: 'debug',
      enableRequestTracking: true,
      enablePerformanceTracking: true,
      enableErrorTracking: true
    }
  }
};

/**
 * Factory class for creating error handling components
 */
export class ErrorHandlingFactory {
  /**
   * Create a complete error handling suite for a service type
   * @param {string} serviceType - Type of service (scraping, api, network, processing, critical)
   * @param {Object} overrides - Configuration overrides
   * @returns {Object} Error handling components
   */
  static createSuite(serviceType = 'scraping', overrides = {}) {
    const config = { ...DEFAULT_CONFIGS[serviceType], ...overrides };
    
    if (!config) {
      throw new Error(`Unknown service type: ${serviceType}. Available types: ${Object.keys(DEFAULT_CONFIGS).join(', ')}`);
    }

    return {
      retryManager: new RetryManager(config.retry),
      circuitBreaker: createCircuitBreaker('default', config.circuitBreaker),
      logger: createLogger('default', config.logger)
    };
  }

  /**
   * Create retry manager with preset configuration
   * @param {string} serviceType - Service type
   * @param {Object} overrides - Configuration overrides
   * @returns {RetryManager} Configured retry manager
   */
  static createRetryManager(serviceType = 'scraping', overrides = {}) {
    const config = { ...DEFAULT_CONFIGS[serviceType]?.retry, ...overrides };
    return new RetryManager(config);
  }

  /**
   * Create circuit breaker with preset configuration
   * @param {string} serviceType - Service type
   * @param {Object} overrides - Configuration overrides
   * @returns {CircuitBreaker} Configured circuit breaker
   */
  static createCircuitBreaker(serviceType = 'scraping', overrides = {}) {
    const config = { ...DEFAULT_CONFIGS[serviceType]?.circuitBreaker, ...overrides };
    return createCircuitBreaker('default', config);
  }

  /**
   * Create logger with preset configuration
   * @param {string} serviceType - Service type
   * @param {Object} overrides - Configuration overrides
   * @returns {Logger} Configured logger
   */
  static createLogger(serviceType = 'scraping', overrides = {}) {
    const config = { ...DEFAULT_CONFIGS[serviceType]?.logger, ...overrides };
    return createLogger('default', config);
  }
}

/**
 * Global error handling configuration manager
 */
export class ErrorHandlingConfigManager {
  constructor() {
    this.configs = new Map();
    this.instances = new Map();
  }

  /**
   * Register a custom configuration for a service
   * @param {string} serviceName - Service name
   * @param {Object} config - Error handling configuration
   */
  registerConfig(serviceName, config) {
    this.configs.set(serviceName, config);
  }

  /**
   * Get error handling suite for a service
   * @param {string} serviceName - Service name
   * @param {string} serviceType - Default service type if not registered
   * @returns {Object} Error handling components
   */
  getSuite(serviceName, serviceType = 'scraping') {
    if (this.instances.has(serviceName)) {
      return this.instances.get(serviceName);
    }

    const config = this.configs.get(serviceName);
    const suite = config 
      ? ErrorHandlingFactory.createSuite('scraping', config)
      : ErrorHandlingFactory.createSuite(serviceType);

    this.instances.set(serviceName, suite);
    return suite;
  }

  /**
   * Clear cached instances (useful for testing)
   */
  clearCache() {
    // Cleanup existing instances
    for (const suite of this.instances.values()) {
      if (suite.circuitBreaker && typeof suite.circuitBreaker.destroy === 'function') {
        suite.circuitBreaker.destroy();
      }
      if (suite.logger && typeof suite.logger.close === 'function') {
        suite.logger.close();
      }
    }
    
    this.instances.clear();
  }

  /**
   * Get statistics for all registered services
   * @returns {Object} Statistics for all services
   */
  getAllStats() {
    const stats = {};
    
    for (const [serviceName, suite] of this.instances.entries()) {
      stats[serviceName] = {
        retry: suite.retryManager?.getStats(),
        circuitBreaker: suite.circuitBreaker?.getStats(),
        logger: suite.logger?.getStats()
      };
    }
    
    return stats;
  }
}

// Global instance
export const errorHandlingConfig = new ErrorHandlingConfigManager();

/**
 * Helper function to get error handling suite
 * @param {string} serviceName - Service name
 * @param {string} serviceType - Service type
 * @returns {Object} Error handling components
 */
export function getErrorHandling(serviceName, serviceType = 'scraping') {
  return errorHandlingConfig.getSuite(serviceName, serviceType);
}

/**
 * Helper function to register custom error handling configuration
 * @param {string} serviceName - Service name
 * @param {Object} config - Configuration object
 */
export function registerErrorHandlingConfig(serviceName, config) {
  errorHandlingConfig.registerConfig(serviceName, config);
}

/**
 * Decorator for adding error handling to class methods
 * @param {string} serviceName - Service name for error handling
 * @param {string} serviceType - Service type
 * @returns {Function} Decorator function
 */
export function withErrorHandling(serviceName, serviceType = 'scraping') {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    const suite = getErrorHandling(serviceName, serviceType);
    
    descriptor.value = async function(...args) {
      const requestId = suite.logger.startRequest({
        method: propertyKey,
        service: serviceName,
        args: args.length
      });

      try {
        const result = await suite.retryManager.executeWithCircuitBreaker(
          () => originalMethod.apply(this, args),
          suite.circuitBreaker,
          serviceName,
          { method: propertyKey }
        );

        suite.logger.endRequest(requestId, { success: true });
        return result;
      } catch (error) {
        suite.logger.requestError(requestId, error, { method: propertyKey });
        throw error;
      }
    };
    
    return descriptor;
  };
}

export default ErrorHandlingFactory;
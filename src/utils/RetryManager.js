/**
 * RetryManager - Comprehensive retry management with multiple strategies
 * Handles exponential backoff, circuit breaking integration, and retry policies
 */

export class RetryManager {
  constructor(options = {}) {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      maxDelay = 30000,
      strategy = 'exponential',
      jitter = true,
      retryableErrors = ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'],
      retryableStatusCodes = [408, 429, 500, 502, 503, 504],
      onRetry = null,
      onFailure = null
    } = options;

    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
    this.strategy = strategy;
    this.jitter = jitter;
    this.retryableErrors = new Set(retryableErrors);
    this.retryableStatusCodes = new Set(retryableStatusCodes);
    this.onRetry = onRetry;
    this.onFailure = onFailure;

    // Strategy implementations
    this.strategies = {
      linear: this.linearBackoff.bind(this),
      exponential: this.exponentialBackoff.bind(this),
      fibonacci: this.fibonacciBackoff.bind(this),
      fixed: this.fixedBackoff.bind(this)
    };

    // Statistics tracking
    this.stats = {
      totalAttempts: 0,
      totalRetries: 0,
      successfulRetries: 0,
      failedOperations: 0,
      averageRetryDelay: 0
    };
  }

  /**
   * Execute an operation with retry logic
   * @param {Function} operation - Async function to execute
   * @param {Object} context - Context information for logging/callbacks
   * @returns {Promise} Result of successful operation
   */
  async execute(operation, context = {}) {
    let lastError;
    let totalDelay = 0;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      this.stats.totalAttempts++;

      try {
        const result = await operation();
        
        if (attempt > 0) {
          this.stats.successfulRetries++;
          this.updateAverageDelay(totalDelay);
        }

        return result;
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          this.stats.failedOperations++;
          if (this.onFailure) {
            await this.onFailure(error, attempt, context);
          }
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === this.maxRetries) {
          this.stats.failedOperations++;
          if (this.onFailure) {
            await this.onFailure(error, attempt, context);
          }
          throw new RetryExhaustedError(
            `Operation failed after ${this.maxRetries} retries: ${error.message}`,
            error,
            attempt
          );
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt);
        totalDelay += delay;

        this.stats.totalRetries++;

        // Call retry callback if provided
        if (this.onRetry) {
          await this.onRetry(error, attempt, delay, context);
        }

        // Wait before retrying
        await this.delay(delay);
      }
    }

    throw lastError;
  }

  /**
   * Execute multiple operations with retry, stopping on first success
   * @param {Array<Function>} operations - Array of async functions
   * @param {Object} context - Context information
   * @returns {Promise} Result of first successful operation
   */
  async executeAny(operations, context = {}) {
    let lastError;

    for (const operation of operations) {
      try {
        return await this.execute(operation, context);
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`All ${operations.length} operations failed. Last error: ${lastError.message}`);
  }

  /**
   * Execute operation with circuit breaker integration
   * @param {Function} operation - Async function to execute
   * @param {CircuitBreaker} circuitBreaker - Circuit breaker instance
   * @param {string} domain - Domain for circuit breaker
   * @param {Object} context - Context information
   * @returns {Promise} Result of successful operation
   */
  async executeWithCircuitBreaker(operation, circuitBreaker, domain, context = {}) {
    return this.execute(async () => {
      return circuitBreaker.execute(domain, operation);
    }, { ...context, domain });
  }

  /**
   * Check if an error is retryable based on configuration
   * @param {Error} error - Error to check
   * @returns {boolean} Whether the error is retryable
   */
  isRetryableError(error) {
    // Check error codes
    if (error.code && this.retryableErrors.has(error.code)) {
      return true;
    }

    // Check HTTP status codes
    if (error.response && error.response.status) {
      return this.retryableStatusCodes.has(error.response.status);
    }

    // Check error types
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return true;
    }

    // Check for timeout errors
    if (error.message && (
      error.message.includes('timeout') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('socket hang up')
    )) {
      return true;
    }

    // Circuit breaker errors are retryable
    if (error.message && error.message.includes('Circuit breaker is OPEN')) {
      return true;
    }

    return false;
  }

  /**
   * Calculate delay based on configured strategy
   * @param {number} attempt - Current attempt number (0-based)
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(attempt) {
    const strategy = this.strategies[this.strategy] || this.strategies.exponential;
    let delay = strategy(attempt);

    // Apply maximum delay cap
    delay = Math.min(delay, this.maxDelay);

    // Apply jitter to prevent thundering herd
    if (this.jitter) {
      delay = this.addJitter(delay);
    }

    return Math.max(0, delay);
  }

  /**
   * Linear backoff strategy
   * @param {number} attempt - Attempt number
   * @returns {number} Delay in milliseconds
   */
  linearBackoff(attempt) {
    return this.baseDelay * (attempt + 1);
  }

  /**
   * Exponential backoff strategy
   * @param {number} attempt - Attempt number
   * @returns {number} Delay in milliseconds
   */
  exponentialBackoff(attempt) {
    return this.baseDelay * Math.pow(2, attempt);
  }

  /**
   * Fibonacci backoff strategy
   * @param {number} attempt - Attempt number
   * @returns {number} Delay in milliseconds
   */
  fibonacciBackoff(attempt) {
    if (attempt <= 1) return this.baseDelay;
    
    let a = 1, b = 1;
    for (let i = 2; i <= attempt; i++) {
      [a, b] = [b, a + b];
    }
    
    return this.baseDelay * b;
  }

  /**
   * Fixed delay strategy
   * @param {number} attempt - Attempt number
   * @returns {number} Delay in milliseconds
   */
  fixedBackoff(attempt) {
    return this.baseDelay;
  }

  /**
   * Add jitter to delay to prevent thundering herd
   * @param {number} delay - Base delay
   * @returns {number} Jittered delay
   */
  addJitter(delay) {
    // Use full jitter: random value between 0 and delay
    return Math.random() * delay;
  }

  /**
   * Promise-based delay utility
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update average retry delay statistic
   * @param {number} totalDelay - Total delay for this operation
   */
  updateAverageDelay(totalDelay) {
    const currentAverage = this.stats.averageRetryDelay;
    const count = this.stats.successfulRetries;
    this.stats.averageRetryDelay = ((currentAverage * (count - 1)) + totalDelay) / count;
  }

  /**
   * Get retry statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalAttempts > 0 
        ? ((this.stats.totalAttempts - this.stats.failedOperations) / this.stats.totalAttempts) * 100 
        : 0,
      retryRate: this.stats.totalAttempts > 0 
        ? (this.stats.totalRetries / this.stats.totalAttempts) * 100 
        : 0
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalAttempts: 0,
      totalRetries: 0,
      successfulRetries: 0,
      failedOperations: 0,
      averageRetryDelay: 0
    };
  }

  /**
   * Create a configured retry manager for specific use cases
   * @param {string} preset - Preset name ('aggressive', 'conservative', 'network', 'api')
   * @returns {RetryManager} Configured retry manager
   */
  static createPreset(preset) {
    const presets = {
      aggressive: {
        maxRetries: 5,
        baseDelay: 500,
        maxDelay: 10000,
        strategy: 'exponential',
        jitter: true
      },
      conservative: {
        maxRetries: 2,
        baseDelay: 2000,
        maxDelay: 60000,
        strategy: 'linear',
        jitter: false
      },
      network: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        strategy: 'exponential',
        jitter: true,
        retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']
      },
      api: {
        maxRetries: 4,
        baseDelay: 1000,
        maxDelay: 16000,
        strategy: 'exponential',
        jitter: true,
        retryableStatusCodes: [408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]
      }
    };

    const config = presets[preset];
    if (!config) {
      throw new Error(`Unknown preset: ${preset}. Available presets: ${Object.keys(presets).join(', ')}`);
    }

    return new RetryManager(config);
  }
}

/**
 * Custom error class for retry exhausted scenarios
 */
export class RetryExhaustedError extends Error {
  constructor(message, originalError, attempts) {
    super(message);
    this.name = 'RetryExhaustedError';
    this.originalError = originalError;
    this.attempts = attempts;
  }
}

/**
 * Decorator function to add retry logic to any async function
 * @param {RetryManager} retryManager - Retry manager instance
 * @param {Object} context - Context for the operation
 * @returns {Function} Decorator function
 */
export function withRetry(retryManager, context = {}) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args) {
      return retryManager.execute(() => originalMethod.apply(this, args), context);
    };
    
    return descriptor;
  };
}

export default RetryManager;
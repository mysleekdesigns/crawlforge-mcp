/**
 * Enhanced CircuitBreaker - Advanced circuit breaker pattern implementation
 * Features: Multiple states, health monitoring, automatic recovery, metrics
 */

export class CircuitBreaker {
  constructor(options = {}) {
    const {
      threshold = 5,
      timeout = 30000,
      resetTimeout = 60000,
      halfOpenMaxCalls = 3,
      monitoringWindow = 60000,
      errorThresholdPercentage = 50,
      minimumThroughput = 10,
      onStateChange = null,
      onFailure = null,
      onSuccess = null,
      name = 'default'
    } = options;

    this.threshold = threshold;
    this.timeout = timeout;
    this.resetTimeout = resetTimeout;
    this.halfOpenMaxCalls = halfOpenMaxCalls;
    this.monitoringWindow = monitoringWindow;
    this.errorThresholdPercentage = errorThresholdPercentage;
    this.minimumThroughput = minimumThroughput;
    this.onStateChange = onStateChange;
    this.onFailure = onFailure;
    this.onSuccess = onSuccess;
    this.name = name;

    // Circuit state per service endpoint
    this.circuits = new Map();
    
    // Health monitoring
    this.healthChecks = new Map();
    this.monitoringIntervals = new Map();

    // States
    this.STATES = {
      CLOSED: 'CLOSED',
      OPEN: 'OPEN',
      HALF_OPEN: 'HALF_OPEN'
    };
  }

  /**
   * Execute operation with circuit breaker protection
   * @param {string} serviceId - Unique identifier for the service
   * @param {Function} operation - Async operation to execute
   * @param {Object} options - Execution options
   * @returns {Promise} Operation result
   */
  async execute(serviceId, operation, options = {}) {
    const circuit = this.getCircuit(serviceId);
    const startTime = Date.now();

    // Check circuit state
    if (circuit.state === this.STATES.OPEN) {
      if (Date.now() < circuit.nextAttempt) {
        const error = new CircuitBreakerOpenError(
          `Circuit breaker is OPEN for service: ${serviceId}`,
          serviceId,
          circuit
        );
        this.recordMetric(serviceId, 'rejected', Date.now() - startTime);
        throw error;
      }
      // Transition to half-open
      this.transitionTo(serviceId, this.STATES.HALF_OPEN);
    }

    if (circuit.state === this.STATES.HALF_OPEN) {
      if (circuit.halfOpenCalls >= this.halfOpenMaxCalls) {
        const error = new CircuitBreakerOpenError(
          `Circuit breaker HALF_OPEN limit exceeded for service: ${serviceId}`,
          serviceId,
          circuit
        );
        this.recordMetric(serviceId, 'rejected', Date.now() - startTime);
        throw error;
      }
      circuit.halfOpenCalls++;
    }

    try {
      // Execute operation with timeout
      const result = await this.executeWithTimeout(operation, options.timeout || this.timeout);
      
      const duration = Date.now() - startTime;
      this.onSuccess(serviceId, duration);
      this.recordMetric(serviceId, 'success', duration);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.onFailure(serviceId, error, duration);
      this.recordMetric(serviceId, 'failure', duration, error);
      throw error;
    }
  }

  /**
   * Execute operation with timeout
   * @param {Function} operation - Operation to execute
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise} Operation result
   */
  async executeWithTimeout(operation, timeout) {
    return Promise.race([
      operation(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Operation timeout after ${timeout}ms`));
        }, timeout);
      })
    ]);
  }

  /**
   * Handle successful operation
   * @param {string} serviceId - Service identifier
   * @param {number} duration - Operation duration
   */
  onSuccess(serviceId, duration) {
    const circuit = this.getCircuit(serviceId);
    
    if (circuit.state === this.STATES.HALF_OPEN) {
      // Check if we can close the circuit
      if (circuit.halfOpenCalls >= this.halfOpenMaxCalls) {
        this.transitionTo(serviceId, this.STATES.CLOSED);
      }
    } else if (circuit.state === this.STATES.CLOSED) {
      // Reset failure count on success
      circuit.failureCount = 0;
    }

    // Call success callback
    if (this.onSuccess) {
      this.onSuccess(serviceId, duration);
    }
  }

  /**
   * Handle failed operation
   * @param {string} serviceId - Service identifier
   * @param {Error} error - Error that occurred
   * @param {number} duration - Operation duration
   */
  onFailure(serviceId, error, duration) {
    const circuit = this.getCircuit(serviceId);
    circuit.failureCount++;
    circuit.lastFailure = error;
    circuit.lastFailureTime = Date.now();

    if (circuit.state === this.STATES.HALF_OPEN) {
      // Failure in half-open state immediately opens the circuit
      this.transitionTo(serviceId, this.STATES.OPEN);
    } else if (circuit.state === this.STATES.CLOSED) {
      // Check if we should open the circuit
      if (this.shouldOpenCircuit(serviceId)) {
        this.transitionTo(serviceId, this.STATES.OPEN);
      }
    }

    // Call failure callback
    if (this.onFailure) {
      this.onFailure(serviceId, error, duration);
    }
  }

  /**
   * Determine if circuit should be opened
   * @param {string} serviceId - Service identifier
   * @returns {boolean} Whether to open circuit
   */
  shouldOpenCircuit(serviceId) {
    const circuit = this.getCircuit(serviceId);
    const metrics = this.getServiceMetrics(serviceId);

    // Simple threshold check
    if (circuit.failureCount >= this.threshold) {
      return true;
    }

    // Percentage-based check within monitoring window
    if (metrics.totalCalls >= this.minimumThroughput) {
      const errorRate = (metrics.failures / metrics.totalCalls) * 100;
      return errorRate >= this.errorThresholdPercentage;
    }

    return false;
  }

  /**
   * Transition circuit to new state
   * @param {string} serviceId - Service identifier
   * @param {string} newState - New state
   */
  transitionTo(serviceId, newState) {
    const circuit = this.getCircuit(serviceId);
    const oldState = circuit.state;

    circuit.state = newState;
    circuit.stateChangeTime = Date.now();

    switch (newState) {
      case this.STATES.OPEN:
        circuit.nextAttempt = Date.now() + this.resetTimeout;
        circuit.halfOpenCalls = 0;
        break;
      case this.STATES.HALF_OPEN:
        circuit.halfOpenCalls = 0;
        break;
      case this.STATES.CLOSED:
        circuit.failureCount = 0;
        circuit.halfOpenCalls = 0;
        break;
    }

    // Call state change callback
    if (this.onStateChange) {
      this.onStateChange(serviceId, oldState, newState, circuit);
    }

    // Start health monitoring for open circuits
    if (newState === this.STATES.OPEN) {
      this.startHealthMonitoring(serviceId);
    } else {
      this.stopHealthMonitoring(serviceId);
    }
  }

  /**
   * Get or create circuit for service
   * @param {string} serviceId - Service identifier
   * @returns {Object} Circuit state object
   */
  getCircuit(serviceId) {
    if (!this.circuits.has(serviceId)) {
      this.circuits.set(serviceId, {
        state: this.STATES.CLOSED,
        failureCount: 0,
        halfOpenCalls: 0,
        nextAttempt: 0,
        stateChangeTime: Date.now(),
        lastFailure: null,
        lastFailureTime: 0,
        metrics: {
          totalCalls: 0,
          failures: 0,
          successes: 0,
          rejections: 0,
          timeouts: 0,
          averageResponseTime: 0,
          callsInWindow: []
        }
      });
    }
    return this.circuits.get(serviceId);
  }

  /**
   * Record operation metrics
   * @param {string} serviceId - Service identifier
   * @param {string} type - Metric type ('success', 'failure', 'rejected')
   * @param {number} duration - Operation duration
   * @param {Error} error - Error if applicable
   */
  recordMetric(serviceId, type, duration, error = null) {
    const circuit = this.getCircuit(serviceId);
    const now = Date.now();
    
    // Record call in sliding window
    circuit.metrics.callsInWindow.push({
      timestamp: now,
      type,
      duration,
      error: error ? error.message : null
    });

    // Clean old entries outside monitoring window
    circuit.metrics.callsInWindow = circuit.metrics.callsInWindow.filter(
      call => now - call.timestamp <= this.monitoringWindow
    );

    // Update counters
    circuit.metrics.totalCalls++;
    circuit.metrics[type === 'success' ? 'successes' : 
                   type === 'failure' ? 'failures' : 'rejections']++;

    if (error && error.message.includes('timeout')) {
      circuit.metrics.timeouts++;
    }

    // Update average response time
    if (type === 'success' || type === 'failure') {
      const currentAverage = circuit.metrics.averageResponseTime;
      const calls = circuit.metrics.successes + circuit.metrics.failures;
      circuit.metrics.averageResponseTime = 
        ((currentAverage * (calls - 1)) + duration) / calls;
    }
  }

  /**
   * Get metrics for a specific service
   * @param {string} serviceId - Service identifier
   * @returns {Object} Service metrics
   */
  getServiceMetrics(serviceId) {
    const circuit = this.getCircuit(serviceId);
    const now = Date.now();
    
    // Get metrics within monitoring window
    const windowCalls = circuit.metrics.callsInWindow.filter(
      call => now - call.timestamp <= this.monitoringWindow
    );

    const windowFailures = windowCalls.filter(call => call.type === 'failure').length;
    const windowSuccesses = windowCalls.filter(call => call.type === 'success').length;
    const windowTotal = windowCalls.length;

    return {
      state: circuit.state,
      totalCalls: windowTotal,
      failures: windowFailures,
      successes: windowSuccesses,
      errorRate: windowTotal > 0 ? (windowFailures / windowTotal) * 100 : 0,
      averageResponseTime: circuit.metrics.averageResponseTime,
      lastFailure: circuit.lastFailure?.message,
      lastFailureTime: circuit.lastFailureTime,
      nextAttempt: circuit.nextAttempt,
      stateChangeTime: circuit.stateChangeTime
    };
  }

  /**
   * Start health monitoring for a service
   * @param {string} serviceId - Service identifier
   */
  startHealthMonitoring(serviceId) {
    if (this.monitoringIntervals.has(serviceId)) {
      return; // Already monitoring
    }

    const interval = setInterval(() => {
      this.performHealthCheck(serviceId);
    }, this.resetTimeout / 2); // Check twice per reset timeout

    this.monitoringIntervals.set(serviceId, interval);
  }

  /**
   * Stop health monitoring for a service
   * @param {string} serviceId - Service identifier
   */
  stopHealthMonitoring(serviceId) {
    const interval = this.monitoringIntervals.get(serviceId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(serviceId);
    }
  }

  /**
   * Perform health check for a service
   * @param {string} serviceId - Service identifier
   */
  async performHealthCheck(serviceId) {
    const circuit = this.getCircuit(serviceId);
    
    if (circuit.state !== this.STATES.OPEN) {
      return;
    }

    if (Date.now() >= circuit.nextAttempt) {
      // Transition to half-open for testing
      this.transitionTo(serviceId, this.STATES.HALF_OPEN);
    }
  }

  /**
   * Manually reset circuit breaker for a service
   * @param {string} serviceId - Service identifier
   */
  reset(serviceId) {
    if (serviceId) {
      this.transitionTo(serviceId, this.STATES.CLOSED);
    } else {
      // Reset all circuits
      for (const id of this.circuits.keys()) {
        this.transitionTo(id, this.STATES.CLOSED);
      }
    }
  }

  /**
   * Get comprehensive statistics for all services
   * @returns {Object} Statistics object
   */
  getStats() {
    const stats = {
      totalServices: this.circuits.size,
      serviceStates: {},
      globalMetrics: {
        totalCalls: 0,
        totalFailures: 0,
        totalSuccesses: 0,
        totalRejections: 0,
        averageErrorRate: 0
      }
    };

    let totalErrorRate = 0;
    let servicesWithCalls = 0;

    for (const [serviceId, circuit] of this.circuits.entries()) {
      const metrics = this.getServiceMetrics(serviceId);
      stats.serviceStates[serviceId] = metrics;
      
      stats.globalMetrics.totalCalls += circuit.metrics.totalCalls;
      stats.globalMetrics.totalFailures += circuit.metrics.failures;
      stats.globalMetrics.totalSuccesses += circuit.metrics.successes;
      stats.globalMetrics.totalRejections += circuit.metrics.rejections;

      if (circuit.metrics.totalCalls > 0) {
        totalErrorRate += metrics.errorRate;
        servicesWithCalls++;
      }
    }

    stats.globalMetrics.averageErrorRate = servicesWithCalls > 0 
      ? totalErrorRate / servicesWithCalls 
      : 0;

    return stats;
  }

  /**
   * Cleanup resources
   */
  destroy() {
    // Stop all monitoring intervals
    for (const interval of this.monitoringIntervals.values()) {
      clearInterval(interval);
    }
    this.monitoringIntervals.clear();
    this.circuits.clear();
    this.healthChecks.clear();
  }
}

/**
 * Circuit Breaker specific error class
 */
export class CircuitBreakerOpenError extends Error {
  constructor(message, serviceId, circuit) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.serviceId = serviceId;
    this.circuit = circuit;
    this.isCircuitBreakerError = true;
  }
}

/**
 * Factory function to create circuit breakers with presets
 */
export function createCircuitBreaker(preset = 'default', overrides = {}) {
  const presets = {
    default: {
      threshold: 5,
      timeout: 30000,
      resetTimeout: 60000,
      halfOpenMaxCalls: 3
    },
    aggressive: {
      threshold: 3,
      timeout: 15000,
      resetTimeout: 30000,
      halfOpenMaxCalls: 2,
      errorThresholdPercentage: 30
    },
    conservative: {
      threshold: 10,
      timeout: 60000,
      resetTimeout: 300000,
      halfOpenMaxCalls: 5,
      errorThresholdPercentage: 70
    },
    api: {
      threshold: 5,
      timeout: 30000,
      resetTimeout: 120000,
      halfOpenMaxCalls: 3,
      errorThresholdPercentage: 50,
      minimumThroughput: 20
    },
    network: {
      threshold: 3,
      timeout: 10000,
      resetTimeout: 60000,
      halfOpenMaxCalls: 2,
      errorThresholdPercentage: 40,
      minimumThroughput: 10
    }
  };

  const config = { ...presets[preset], ...overrides };
  return new CircuitBreaker(config);
}

export default CircuitBreaker;
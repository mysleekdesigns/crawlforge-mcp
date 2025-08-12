/**
 * Error Handling Usage Examples
 * Demonstrates how to use the comprehensive error handling systems
 */

import { RetryManager, RetryExhaustedError } from '../src/utils/RetryManager.js';
import { CircuitBreaker, createCircuitBreaker } from '../src/utils/CircuitBreaker.js';
import { createLogger } from '../src/utils/Logger.js';
import { ErrorHandlingFactory, getErrorHandling, withErrorHandling } from '../src/utils/ErrorHandlingConfig.js';

/**
 * Example 1: Basic RetryManager usage
 */
async function basicRetryExample() {
  console.log('\n=== Basic Retry Manager Example ===');
  
  const retryManager = RetryManager.createPreset('api');
  let attempts = 0;

  try {
    const result = await retryManager.execute(async () => {
      attempts++;
      console.log(`Attempt ${attempts}`);
      
      if (attempts < 3) {
        throw new Error('Simulated failure');
      }
      
      return 'Success!';
    });
    
    console.log('Result:', result);
    console.log('Stats:', retryManager.getStats());
  } catch (error) {
    console.error('Failed after retries:', error.message);
  }
}

/**
 * Example 2: Circuit Breaker with RetryManager integration
 */
async function circuitBreakerExample() {
  console.log('\n=== Circuit Breaker Example ===');
  
  const circuitBreaker = createCircuitBreaker('api');
  const retryManager = RetryManager.createPreset('api');
  const serviceId = 'example-service';
  
  // Simulate multiple failures to trigger circuit breaker
  for (let i = 0; i < 8; i++) {
    try {
      await retryManager.executeWithCircuitBreaker(
        async () => {
          throw new Error(`Failure ${i + 1}`);
        },
        circuitBreaker,
        serviceId
      );
    } catch (error) {
      console.log(`Request ${i + 1}: ${error.message}`);
    }
  }
  
  console.log('Circuit Breaker Stats:', circuitBreaker.getStats());
}

/**
 * Example 3: Comprehensive logging with request tracking
 */
async function loggingExample() {
  console.log('\n=== Logging Example ===');
  
  const logger = createLogger('development');
  
  // Start a request
  const requestId = logger.startRequest({
    operation: 'fetchData',
    url: 'https://example.com'
  });
  
  logger.info('Processing request', { step: 'validation' }, requestId);
  logger.warn('Rate limit approaching', { remaining: 10 }, requestId);
  
  // Simulate work
  await new Promise(resolve => setTimeout(resolve, 100));
  
  logger.endRequest(requestId, { 
    success: true,
    dataSize: 1024 
  });
  
  console.log('Logger Stats:', logger.getStats());
}

/**
 * Example 4: Using ErrorHandlingFactory for complete suite
 */
async function errorHandlingSuiteExample() {
  console.log('\n=== Error Handling Suite Example ===');
  
  const suite = ErrorHandlingFactory.createSuite('api', {
    retry: { maxRetries: 2 },
    circuitBreaker: { threshold: 3 },
    logger: { level: 'debug' }
  });
  
  const serviceId = 'payment-service';
  let attempts = 0;
  
  try {
    const result = await suite.retryManager.executeWithCircuitBreaker(
      async () => {
        attempts++;
        const requestId = suite.logger.startRequest({ operation: 'processPayment' });
        
        try {
          suite.logger.info('Processing payment', { attempt: attempts }, requestId);
          
          if (attempts < 2) {
            throw new Error('Payment gateway timeout');
          }
          
          suite.logger.endRequest(requestId, { success: true, amount: 100 });
          return { transactionId: 'txn_123', amount: 100 };
        } catch (error) {
          suite.logger.requestError(requestId, error);
          throw error;
        }
      },
      suite.circuitBreaker,
      serviceId
    );
    
    console.log('Payment result:', result);
  } catch (error) {
    console.error('Payment failed:', error.message);
  }
  
  // Get comprehensive stats
  console.log('Retry Stats:', suite.retryManager.getStats());
  console.log('Circuit Breaker Stats:', suite.circuitBreaker.getServiceMetrics(serviceId));
}

/**
 * Example 5: Using decorator for automatic error handling
 */
class PaymentService {
  constructor() {
    const suite = getErrorHandling('payment-service', 'api');
    this.logger = suite.logger.child({ component: 'PaymentService' });
  }
  
  @withErrorHandling('payment-service', 'api')
  async processPayment(amount) {
    this.logger.info('Processing payment', { amount });
    
    // Simulate payment processing
    if (Math.random() < 0.3) {
      throw new Error('Payment gateway error');
    }
    
    return { transactionId: `txn_${Date.now()}`, amount };
  }
  
  @withErrorHandling('payment-service', 'api')
  async refundPayment(transactionId) {
    this.logger.info('Processing refund', { transactionId });
    
    // Simulate refund processing
    if (Math.random() < 0.2) {
      throw new Error('Refund processing failed');
    }
    
    return { refundId: `ref_${Date.now()}`, transactionId };
  }
}

/**
 * Example 6: Error handling with different retry strategies
 */
async function retryStrategiesExample() {
  console.log('\n=== Retry Strategies Example ===');
  
  const strategies = ['linear', 'exponential', 'fibonacci', 'fixed'];
  
  for (const strategy of strategies) {
    console.log(`\n--- ${strategy.toUpperCase()} Strategy ---`);
    
    const retryManager = new RetryManager({
      maxRetries: 3,
      baseDelay: 500,
      strategy,
      onRetry: (error, attempt, delay) => {
        console.log(`Retry ${attempt + 1}: waiting ${delay}ms`);
      }
    });
    
    let attempts = 0;
    const startTime = Date.now();
    
    try {
      await retryManager.execute(async () => {
        attempts++;
        if (attempts < 4) {
          throw new Error('Simulated failure');
        }
        return 'Success';
      });
      
      console.log(`Success after ${Date.now() - startTime}ms`);
    } catch (error) {
      console.log(`Failed after ${Date.now() - startTime}ms`);
    }
  }
}

/**
 * Example 7: Performance monitoring and slow request detection
 */
async function performanceMonitoringExample() {
  console.log('\n=== Performance Monitoring Example ===');
  
  const logger = createLogger('development', {
    enablePerformanceTracking: true
  });
  
  // Simulate various request durations
  const operations = [
    { name: 'fast-operation', duration: 100 },
    { name: 'medium-operation', duration: 2000 },
    { name: 'slow-operation', duration: 6000 }, // This will trigger slow request warning
  ];
  
  for (const op of operations) {
    const requestId = logger.startRequest({ operation: op.name });
    
    logger.info(`Starting ${op.name}`, { expectedDuration: op.duration }, requestId);
    
    // Simulate work
    await new Promise(resolve => setTimeout(resolve, op.duration));
    
    logger.endRequest(requestId, { 
      operation: op.name,
      actualDuration: op.duration 
    });
  }
  
  console.log('Performance Stats:', logger.getStats());
}

/**
 * Run all examples
 */
async function runExamples() {
  console.log('🚀 Error Handling System Examples\n');
  
  try {
    await basicRetryExample();
    await circuitBreakerExample();
    await loggingExample();
    await errorHandlingSuiteExample();
    
    // Decorator example
    console.log('\n=== Decorator Example ===');
    const paymentService = new PaymentService();
    
    try {
      const result = await paymentService.processPayment(100);
      console.log('Payment success:', result);
    } catch (error) {
      console.log('Payment failed:', error.message);
    }
    
    await retryStrategiesExample();
    await performanceMonitoringExample();
    
    console.log('\n✅ All examples completed successfully!');
  } catch (error) {
    console.error('❌ Example failed:', error);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples();
}

export {
  basicRetryExample,
  circuitBreakerExample,
  loggingExample,
  errorHandlingSuiteExample,
  retryStrategiesExample,
  performanceMonitoringExample,
  PaymentService
};
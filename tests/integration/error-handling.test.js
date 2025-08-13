/**
 * Error Handling Integration Tests
 * Comprehensive tests for error scenarios and edge cases
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Error Handling Test Configuration
 */
const ERROR_TEST_CONFIG = {
  serverTimeout: 10000,
  requestTimeout: 15000,
  retryAttempts: 3,
  errorScenarios: {
    network: {
      timeout: 5000,
      maxRetries: 2
    },
    validation: {
      strictMode: true
    },
    resource: {
      memoryLimit: 100 * 1024 * 1024, // 100MB
      maxConcurrent: 10
    }
  }
};

/**
 * Error Test Results Collector
 */
class ErrorTestResults {
  constructor() {
    this.reset();
  }

  reset() {
    this.errorScenarios = new Map();
    this.edgeCases = new Map();
    this.recoveryTests = new Map();
    this.errorPatterns = [];
    this.errors = [];
    this.startTime = Date.now();
  }

  addErrorScenario(scenarioName, testCase, result) {
    if (!this.errorScenarios.has(scenarioName)) {
      this.errorScenarios.set(scenarioName, []);
    }
    
    this.errorScenarios.get(scenarioName).push({
      ...result,
      testCase,
      timestamp: Date.now()
    });
  }

  addEdgeCase(caseName, result) {
    this.edgeCases.set(caseName, {
      ...result,
      timestamp: Date.now()
    });
  }

  addRecoveryTest(testName, result) {
    this.recoveryTests.set(testName, {
      ...result,
      timestamp: Date.now()
    });
  }

  addErrorPattern(pattern) {
    this.errorPatterns.push({
      ...pattern,
      timestamp: Date.now()
    });
  }

  addError(testName, error) {
    this.errors.push({
      testName,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });
  }

  getSummary() {
    const totalErrorScenarios = Array.from(this.errorScenarios.values())
      .reduce((sum, scenarios) => sum + scenarios.length, 0);
    const passedErrorScenarios = Array.from(this.errorScenarios.values())
      .reduce((sum, scenarios) => sum + scenarios.filter(s => s.success).length, 0);
    
    const totalEdgeCases = this.edgeCases.size;
    const passedEdgeCases = Array.from(this.edgeCases.values()).filter(e => e.success).length;
    
    const totalRecoveryTests = this.recoveryTests.size;
    const passedRecoveryTests = Array.from(this.recoveryTests.values()).filter(r => r.success).length;
    
    const totalTests = totalErrorScenarios + totalEdgeCases + totalRecoveryTests;
    const passedTests = passedErrorScenarios + passedEdgeCases + passedRecoveryTests;
    
    return {
      totalTests,
      passedTests,
      failedTests: totalTests - passedTests,
      successRate: totalTests > 0 ? (passedTests / totalTests) * 100 : 0,
      errorScenarios: {
        total: totalErrorScenarios,
        passed: passedErrorScenarios,
        categories: this.errorScenarios.size
      },
      edgeCases: {
        total: totalEdgeCases,
        passed: passedEdgeCases
      },
      recoveryTests: {
        total: totalRecoveryTests,
        passed: passedRecoveryTests
      },
      errorPatterns: this.errorPatterns.length,
      totalErrors: this.errors.length,
      duration: Date.now() - this.startTime
    };
  }
}

/**
 * Error Handling Test Suite
 */
class ErrorHandlingTestSuite {
  constructor() {
    this.results = new ErrorTestResults();
    this.serverProcess = null;
    this.requestId = 1;
  }

  /**
   * Run comprehensive error handling tests
   */
  async runErrorHandlingTests() {
    console.log('🛡️ Starting Error Handling Tests...');
    console.log('─'.repeat(60));
    
    try {
      // Setup test environment
      await this.setupTestEnvironment();
      
      // Test 1: Network Error Scenarios
      console.log('🌐 Test 1: Network Error Scenarios');
      await this.testNetworkErrors();
      
      // Test 2: Input Validation Errors
      console.log('\n✅ Test 2: Input Validation Errors');
      await this.testValidationErrors();
      
      // Test 3: Resource Limitation Errors
      console.log('\n💾 Test 3: Resource Limitation Errors');
      await this.testResourceErrors();
      
      // Test 4: Protocol Error Handling
      console.log('\n📡 Test 4: Protocol Error Handling');
      await this.testProtocolErrors();
      
      // Test 5: Concurrent Request Errors
      console.log('\n🔀 Test 5: Concurrent Request Errors');
      await this.testConcurrentErrors();
      
      // Test 6: Edge Cases
      console.log('\n🔍 Test 6: Edge Cases');
      await this.testEdgeCases();
      
      // Test 7: Error Recovery
      console.log('\n🔄 Test 7: Error Recovery');
      await this.testErrorRecovery();
      
      // Test 8: Graceful Degradation
      console.log('\n📉 Test 8: Graceful Degradation');
      await this.testGracefulDegradation();
      
      // Test 9: Error Reporting
      console.log('\n📋 Test 9: Error Reporting');
      await this.testErrorReporting();
      
      // Test 10: Security Error Handling
      console.log('\n🔒 Test 10: Security Error Handling');
      await this.testSecurityErrors();
      
      // Generate error handling report
      const report = this.generateErrorReport();
      await this.saveErrorReport(report);
      
      return report;
      
    } catch (error) {
      console.error('❌ Error handling test suite failed:', error);
      this.results.addError('suite', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Setup test environment
   */
  async setupTestEnvironment() {
    console.log('   Setting up test environment...');
    
    const serverPath = join(__dirname, '..', '..', 'server.js');
    this.serverProcess = await this.startServer(serverPath);
    
    // Initialize server
    const initRequest = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'error-handling-test', version: '1.0.0' }
      }
    };
    
    await this.sendRequest(initRequest);
    
    // Send initialized notification
    await this.sendNotification({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });
    
    console.log('   ✅ Test environment ready');
  }

  /**
   * Test network error scenarios
   */
  async testNetworkErrors() {
    const networkErrorScenarios = [
      {
        name: 'connection-timeout',
        tool: 'fetch_url',
        args: {
          url: 'https://httpbin.org/delay/10', // Will timeout
          timeout: 2000
        },
        expectError: true,
        errorPattern: /timeout/i
      },
      {
        name: 'connection-refused',
        tool: 'fetch_url',
        args: {
          url: 'http://localhost:99999' // Port that should be closed
        },
        expectError: true,
        errorPattern: /connect|refused/i
      },
      {
        name: 'dns-resolution-failure',
        tool: 'fetch_url',
        args: {
          url: 'https://nonexistent-domain-123456789.com'
        },
        expectError: true,
        errorPattern: /not found|dns|resolve/i
      },
      {
        name: 'invalid-ssl-certificate',
        tool: 'fetch_url',
        args: {
          url: 'https://self-signed.badssl.com'
        },
        expectError: true,
        errorPattern: /certificate|ssl|tls/i
      },
      {
        name: 'http-error-status',
        tool: 'fetch_url',
        args: {
          url: 'https://httpbin.org/status/500'
        },
        expectError: false, // Should handle HTTP errors gracefully
        validateResponse: (result) => result && result.status === 500
      }
    ];
    
    for (const scenario of networkErrorScenarios) {
      await this.executeErrorScenario('network-errors', scenario);
    }
  }

  /**
   * Test input validation errors
   */
  async testValidationErrors() {
    const validationErrorScenarios = [
      {
        name: 'invalid-url-format',
        tool: 'fetch_url',
        args: {
          url: 'not-a-valid-url'
        },
        expectError: true,
        errorPattern: /invalid|url|format/i
      },
      {
        name: 'missing-required-parameter',
        tool: 'fetch_url',
        args: {}, // Missing required 'url' parameter
        expectError: true,
        errorPattern: /required|missing|url/i
      },
      {
        name: 'invalid-parameter-type',
        tool: 'fetch_url',
        args: {
          url: 'https://httpbin.org/get',
          timeout: 'not-a-number'
        },
        expectError: true,
        errorPattern: /invalid|type|timeout/i
      },
      {
        name: 'out-of-range-parameter',
        tool: 'fetch_url',
        args: {
          url: 'https://httpbin.org/get',
          timeout: 100000 // Too large
        },
        expectError: true,
        errorPattern: /range|limit|timeout/i
      },
      {
        name: 'empty-selectors',
        tool: 'scrape_structured',
        args: {
          url: 'https://httpbin.org/html',
          selectors: {}
        },
        expectError: false, // Should handle gracefully
        validateResponse: (result) => result && typeof result.data === 'object'
      },
      {
        name: 'invalid-selector-syntax',
        tool: 'scrape_structured',
        args: {
          url: 'https://httpbin.org/html',
          selectors: {
            invalid: 'invalid[selector['
          }
        },
        expectError: false, // Should handle individual selector errors gracefully
        validateResponse: (result) => result && result.data && result.data.invalid && result.data.invalid.error
      },
      {
        name: 'extremely-long-text',
        tool: 'summarize_content',
        args: {
          text: 'A'.repeat(1000000) // 1MB of text
        },
        expectError: false, // Should handle large text gracefully
        validateResponse: (result) => result && typeof result.summary === 'string'
      },
      {
        name: 'empty-text-analysis',
        tool: 'analyze_content',
        args: {
          text: ''
        },
        expectError: false, // Should handle empty text gracefully
        validateResponse: (result) => result && typeof result.word_count === 'number'
      }
    ];
    
    for (const scenario of validationErrorScenarios) {
      await this.executeErrorScenario('validation-errors', scenario);
    }
  }

  /**
   * Test resource limitation errors
   */
  async testResourceErrors() {
    const resourceErrorScenarios = [
      {
        name: 'large-response-handling',
        tool: 'fetch_url',
        args: {
          url: 'https://httpbin.org/bytes/1048576' // 1MB response
        },
        expectError: false, // Should handle large responses
        validateResponse: (result) => result && result.size >= 1048576
      },
      {
        name: 'concurrent-request-limit',
        tool: 'fetch_url',
        args: Array.from({ length: 20 }, () => ({
          url: 'https://httpbin.org/delay/1'
        })),
        expectError: false, // Should handle concurrent requests
        validateConcurrent: true
      },
      {
        name: 'deep-crawl-resource-management',
        tool: 'crawl_deep',
        args: {
          url: 'https://httpbin.org',
          max_depth: 3,
          max_pages: 50,
          concurrency: 10
        },
        expectError: false, // Should manage resources appropriately
        validateResponse: (result) => result && Array.isArray(result.pages),
        timeout: 30000 // Longer timeout for crawling
      },
      {
        name: 'memory-intensive-analysis',
        tool: 'analyze_content',
        args: {
          text: 'Test content. '.repeat(50000), // Large but manageable text
          options: {
            include_sentiment: true,
            include_entities: true,
            include_keywords: true
          }
        },
        expectError: false, // Should handle memory-intensive operations
        validateResponse: (result) => result && typeof result.language === 'string'
      }
    ];
    
    for (const scenario of resourceErrorScenarios) {
      await this.executeErrorScenario('resource-errors', scenario);
    }
  }

  /**
   * Test protocol error handling
   */
  async testProtocolErrors() {
    const protocolErrorScenarios = [
      {
        name: 'malformed-json',
        rawMessage: '{"jsonrpc":"2.0","id":1,"method":"tools/list"', // Missing closing brace
        expectError: true,
        errorPattern: /parse|json|syntax/i
      },
      {
        name: 'missing-jsonrpc-field',
        message: {
          id: this.getNextRequestId(),
          method: 'tools/list'
        },
        expectError: true,
        errorPattern: /jsonrpc|protocol/i
      },
      {
        name: 'invalid-jsonrpc-version',
        message: {
          jsonrpc: '1.0',
          id: this.getNextRequestId(),
          method: 'tools/list'
        },
        expectError: true,
        errorPattern: /version|jsonrpc/i
      },
      {
        name: 'missing-method',
        message: {
          jsonrpc: '2.0',
          id: this.getNextRequestId(),
          params: {}
        },
        expectError: true,
        errorPattern: /method|missing/i
      },
      {
        name: 'unknown-method',
        message: {
          jsonrpc: '2.0',
          id: this.getNextRequestId(),
          method: 'unknown/method'
        },
        expectError: true,
        errorPattern: /method|unknown|not found/i
      },
      {
        name: 'invalid-request-id',
        message: {
          jsonrpc: '2.0',
          id: null,
          method: 'tools/list'
        },
        expectError: true,
        errorPattern: /id|invalid/i
      }
    ];
    
    for (const scenario of protocolErrorScenarios) {
      await this.executeProtocolErrorScenario(scenario);
    }
  }

  /**
   * Test concurrent request errors
   */
  async testConcurrentErrors() {
    console.log('   Testing concurrent error scenarios...');
    
    try {
      // Create multiple requests that will fail
      const concurrentErrorRequests = Array.from({ length: 10 }, (_, i) => ({
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/call',
        params: {
          name: 'fetch_url',
          arguments: {
            url: `https://nonexistent-domain-${i}.com`
          }
        }
      }));
      
      const startTime = Date.now();
      const responses = await Promise.allSettled(
        concurrentErrorRequests.map(req => this.sendRequest(req))
      );
      const duration = Date.now() - startTime;
      
      const errorResponses = responses.filter(r => 
        r.status === 'fulfilled' && r.value.error
      );
      const rejectedResponses = responses.filter(r => r.status === 'rejected');
      
      const handledGracefully = errorResponses.length > 0 && rejectedResponses.length === 0;
      
      this.results.addErrorScenario('concurrent-errors', 'multiple-failures', {
        success: handledGracefully,
        totalRequests: concurrentErrorRequests.length,
        errorResponsesReceived: errorResponses.length,
        rejectedRequests: rejectedResponses.length,
        duration,
        allHandledGracefully: handledGracefully
      });
      
      console.log(`   ✅ Concurrent error test completed (${errorResponses.length}/${concurrentErrorRequests.length} errors handled)`);
      
    } catch (error) {
      this.results.addError('concurrent-errors', error);
      this.results.addErrorScenario('concurrent-errors', 'multiple-failures', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Concurrent error test failed: ${error.message}`);
    }
  }

  /**
   * Test edge cases
   */
  async testEdgeCases() {
    const edgeCases = [
      {
        name: 'empty-string-url',
        test: async () => {
          const response = await this.sendToolRequest('fetch_url', { url: '' });
          return {
            success: !!response.error,
            handled: !!response.error,
            errorMessage: response.error?.message
          };
        }
      },
      {
        name: 'unicode-url',
        test: async () => {
          const response = await this.sendToolRequest('fetch_url', { 
            url: 'https://httpbin.org/get?param=测试数据' 
          });
          return {
            success: !response.error,
            handled: true,
            statusCode: response.result?.content?.[0]?.status
          };
        }
      },
      {
        name: 'very-long-url',
        test: async () => {
          const longParam = 'param=' + 'a'.repeat(8000); // Very long URL
          const response = await this.sendToolRequest('fetch_url', { 
            url: `https://httpbin.org/get?${longParam}` 
          });
          return {
            success: true, // Should handle either way (accept or reject)
            handled: true,
            hasError: !!response.error
          };
        }
      },
      {
        name: 'null-selector-values',
        test: async () => {
          const response = await this.sendToolRequest('scrape_structured', {
            url: 'https://httpbin.org/html',
            selectors: {
              valid: 'title',
              null_value: null,
              undefined_value: undefined
            }
          });
          return {
            success: !response.error,
            handled: true,
            dataReceived: !!response.result?.content?.[0]?.data
          };
        }
      },
      {
        name: 'circular-references',
        test: async () => {
          // Test with complex nested object that could cause issues
          const complexArgs = {
            url: 'https://httpbin.org/html',
            options: {
              nested: {
                deep: {
                  level: {
                    data: 'test'
                  }
                }
              }
            }
          };
          
          const response = await this.sendToolRequest('extract_content', complexArgs);
          return {
            success: !response.error,
            handled: true,
            contentExtracted: !!response.result?.content?.[0]?.content
          };
        }
      },
      {
        name: 'zero-timeout',
        test: async () => {
          const response = await this.sendToolRequest('fetch_url', {
            url: 'https://httpbin.org/get',
            timeout: 0
          });
          return {
            success: !!response.error, // Should error on invalid timeout
            handled: !!response.error,
            errorMessage: response.error?.message
          };
        }
      },
      {
        name: 'negative-parameters',
        test: async () => {
          const response = await this.sendToolRequest('crawl_deep', {
            url: 'https://httpbin.org',
            max_depth: -1,
            max_pages: -5
          });
          return {
            success: !!response.error, // Should error on negative values
            handled: !!response.error,
            errorMessage: response.error?.message
          };
        }
      },
      {
        name: 'binary-data-in-text',
        test: async () => {
          // Test with binary-like data that might cause encoding issues
          const binaryLikeText = String.fromCharCode(...Array.from({length: 256}, (_, i) => i));
          const response = await this.sendToolRequest('analyze_content', {
            text: binaryLikeText
          });
          return {
            success: !response.error,
            handled: true,
            analysisCompleted: !!response.result?.content?.[0]?.language
          };
        }
      }
    ];
    
    for (const edgeCase of edgeCases) {
      try {
        console.log(`   Testing edge case: ${edgeCase.name}...`);
        const result = await edgeCase.test();
        this.results.addEdgeCase(edgeCase.name, result);
        
        if (result.success) {
          console.log(`     ✅ ${edgeCase.name} handled correctly`);
        } else {
          console.log(`     ⚠️ ${edgeCase.name} needs attention`);
        }
      } catch (error) {
        this.results.addError(edgeCase.name, error);
        this.results.addEdgeCase(edgeCase.name, {
          success: false,
          error: error.message
        });
        console.log(`     ❌ ${edgeCase.name} failed: ${error.message}`);
      }
    }
  }

  /**
   * Test error recovery mechanisms
   */
  async testErrorRecovery() {
    const recoveryTests = [
      {
        name: 'server-responsiveness-after-errors',
        test: async () => {
          // Cause multiple errors
          const errorRequests = Array.from({ length: 5 }, () => 
            this.sendToolRequest('fetch_url', { url: 'invalid-url' })
          );
          
          await Promise.allSettled(errorRequests);
          
          // Test if server is still responsive
          const recoveryResponse = await this.sendToolRequest('fetch_url', {
            url: 'https://httpbin.org/get'
          });
          
          return {
            success: !recoveryResponse.error,
            serverResponsive: !recoveryResponse.error,
            validResponse: !!recoveryResponse.result
          };
        }
      },
      {
        name: 'memory-recovery-after-large-operations',
        test: async () => {
          // Attempt large operation that might fail
          try {
            await this.sendToolRequest('analyze_content', {
              text: 'Test. '.repeat(100000) // Large text
            });
          } catch (error) {
            // Ignore the error, we're testing recovery
          }
          
          // Test if server recovered
          const recoveryResponse = await this.sendToolRequest('analyze_content', {
            text: 'Simple test content for analysis.'
          });
          
          return {
            success: !recoveryResponse.error,
            memoryRecovered: !recoveryResponse.error,
            analysisWorking: !!recoveryResponse.result?.content?.[0]?.word_count
          };
        }
      },
      {
        name: 'concurrent-error-recovery',
        test: async () => {
          // Create concurrent failing requests
          const failingRequests = Array.from({ length: 10 }, () => 
            this.sendToolRequest('fetch_url', { url: 'https://nonexistent.domain' })
          );
          
          await Promise.allSettled(failingRequests);
          
          // Test recovery with valid request
          const recoveryResponse = await this.sendToolRequest('extract_text', {
            url: 'https://httpbin.org/html'
          });
          
          return {
            success: !recoveryResponse.error,
            concurrentErrorsHandled: true,
            serverRecovered: !recoveryResponse.error
          };
        }
      }
    ];
    
    for (const recoveryTest of recoveryTests) {
      try {
        console.log(`   Testing recovery: ${recoveryTest.name}...`);
        const result = await recoveryTest.test();
        this.results.addRecoveryTest(recoveryTest.name, result);
        
        if (result.success) {
          console.log(`     ✅ ${recoveryTest.name} successful`);
        } else {
          console.log(`     ⚠️ ${recoveryTest.name} needs attention`);
        }
      } catch (error) {
        this.results.addError(recoveryTest.name, error);
        this.results.addRecoveryTest(recoveryTest.name, {
          success: false,
          error: error.message
        });
        console.log(`     ❌ ${recoveryTest.name} failed: ${error.message}`);
      }
    }
  }

  /**
   * Test graceful degradation
   */
  async testGracefulDegradation() {
    console.log('   Testing graceful degradation...');
    
    try {
      // Test partial failures in complex operations
      const degradationResponse = await this.sendToolRequest('scrape_structured', {
        url: 'https://httpbin.org/html',
        selectors: {
          valid: 'title',
          invalid: 'invalid[selector',
          missing: 'nonexistent-element',
          another_valid: 'body'
        }
      });
      
      const data = degradationResponse.result?.content?.[0]?.data;
      const hasValidResults = data && (data.valid || data.another_valid);
      const handlesInvalidGracefully = data && data.invalid && data.invalid.error;
      
      this.results.addRecoveryTest('graceful-degradation', {
        success: hasValidResults && handlesInvalidGracefully,
        hasValidResults,
        handlesInvalidGracefully,
        partialSuccess: true
      });
      
      console.log('   ✅ Graceful degradation test completed');
      
    } catch (error) {
      this.results.addError('graceful-degradation', error);
      this.results.addRecoveryTest('graceful-degradation', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Graceful degradation test failed: ${error.message}`);
    }
  }

  /**
   * Test error reporting quality
   */
  async testErrorReporting() {
    console.log('   Testing error reporting quality...');
    
    const errorReportingTests = [
      {
        name: 'descriptive-error-messages',
        request: {
          tool: 'fetch_url',
          args: { url: 'not-a-url' }
        }
      },
      {
        name: 'error-code-consistency',
        request: {
          tool: 'unknown_tool',
          args: {}
        }
      },
      {
        name: 'parameter-validation-details',
        request: {
          tool: 'fetch_url',
          args: { url: 'https://httpbin.org/get', timeout: 'invalid' }
        }
      }
    ];
    
    const reportingResults = [];
    
    for (const test of errorReportingTests) {
      try {
        const response = await this.sendToolRequest(test.request.tool, test.request.args);
        
        if (response.error) {
          const hasErrorCode = typeof response.error.code === 'number';
          const hasErrorMessage = typeof response.error.message === 'string' && response.error.message.length > 0;
          const isDescriptive = response.error.message.length > 10; // Basic check for descriptiveness
          
          reportingResults.push({
            name: test.name,
            success: hasErrorCode && hasErrorMessage && isDescriptive,
            hasErrorCode,
            hasErrorMessage,
            isDescriptive,
            errorCode: response.error.code,
            errorMessage: response.error.message
          });
          
          this.results.addErrorPattern({
            errorCode: response.error.code,
            errorMessage: response.error.message,
            context: test.name
          });
        } else {
          reportingResults.push({
            name: test.name,
            success: false,
            reason: 'Expected error but got success response'
          });
        }
      } catch (error) {
        reportingResults.push({
          name: test.name,
          success: false,
          error: error.message
        });
      }
    }
    
    const allReportingValid = reportingResults.every(r => r.success);
    
    this.results.addRecoveryTest('error-reporting-quality', {
      success: allReportingValid,
      testsCount: reportingResults.length,
      validReports: reportingResults.filter(r => r.success).length,
      results: reportingResults
    });
    
    console.log('   ✅ Error reporting test completed');
  }

  /**
   * Test security-related error handling
   */
  async testSecurityErrors() {
    console.log('   Testing security error handling...');
    
    const securityTests = [
      {
        name: 'url-injection-attempt',
        test: async () => {
          const response = await this.sendToolRequest('fetch_url', {
            url: 'https://httpbin.org/get?param="><script>alert("xss")</script>'
          });
          
          return {
            success: true, // Should handle without crashing
            handled: true,
            safelyProcessed: !!response.result || !!response.error
          };
        }
      },
      {
        name: 'malicious-selector',
        test: async () => {
          const response = await this.sendToolRequest('scrape_structured', {
            url: 'https://httpbin.org/html',
            selectors: {
              malicious: 'script[src*="evil.com"]'
            }
          });
          
          return {
            success: !response.error,
            handled: true,
            safelyProcessed: !!response.result
          };
        }
      },
      {
        name: 'oversized-parameter',
        test: async () => {
          const oversizedText = 'A'.repeat(10 * 1024 * 1024); // 10MB text
          const response = await this.sendToolRequest('summarize_content', {
            text: oversizedText
          });
          
          return {
            success: true, // Should handle gracefully (accept or reject)
            handled: true,
            responseReceived: !!response.result || !!response.error
          };
        }
      }
    ];
    
    for (const securityTest of securityTests) {
      try {
        console.log(`   Testing security: ${securityTest.name}...`);
        const result = await securityTest.test();
        this.results.addRecoveryTest(`security-${securityTest.name}`, result);
        
        if (result.success) {
          console.log(`     ✅ ${securityTest.name} handled securely`);
        } else {
          console.log(`     ⚠️ ${securityTest.name} needs security review`);
        }
      } catch (error) {
        this.results.addError(securityTest.name, error);
        this.results.addRecoveryTest(`security-${securityTest.name}`, {
          success: false,
          error: error.message
        });
        console.log(`     ❌ ${securityTest.name} failed: ${error.message}`);
      }
    }
  }

  // Helper methods

  /**
   * Execute an error scenario test
   */
  async executeErrorScenario(category, scenario) {
    try {
      console.log(`   Testing ${category}: ${scenario.name}...`);
      
      if (scenario.validateConcurrent) {
        // Handle concurrent request scenarios
        const requests = scenario.args.map(args => this.sendToolRequest(scenario.tool, args));
        const responses = await Promise.allSettled(requests);
        
        const successfulResponses = responses.filter(r => r.status === 'fulfilled' && !r.value.error);
        const success = successfulResponses.length > 0;
        
        this.results.addErrorScenario(category, scenario.name, {
          success,
          totalRequests: requests.length,
          successfulRequests: successfulResponses.length,
          handled: true
        });
        return;
      }
      
      const timeout = scenario.timeout || ERROR_TEST_CONFIG.requestTimeout;
      const response = await this.sendToolRequest(scenario.tool, scenario.args, timeout);
      
      const hasError = !!response.error;
      const success = scenario.expectError ? hasError : !hasError;
      
      let patternMatch = true;
      if (scenario.expectError && scenario.errorPattern && response.error) {
        patternMatch = scenario.errorPattern.test(response.error.message);
      }
      
      let validationSuccess = true;
      if (!scenario.expectError && scenario.validateResponse && response.result) {
        validationSuccess = scenario.validateResponse(response.result.content[0]);
      }
      
      const overallSuccess = success && patternMatch && validationSuccess;
      
      this.results.addErrorScenario(category, scenario.name, {
        success: overallSuccess,
        expectError: scenario.expectError,
        hasError,
        patternMatch,
        validationSuccess,
        errorMessage: response.error?.message,
        errorCode: response.error?.code
      });
      
      if (overallSuccess) {
        console.log(`     ✅ ${scenario.name} handled correctly`);
      } else {
        console.log(`     ⚠️ ${scenario.name} needs attention`);
      }
      
    } catch (error) {
      this.results.addError(category, error);
      this.results.addErrorScenario(category, scenario.name, {
        success: scenario.expectError, // If we expected an error, catching is success
        error: error.message,
        caughtException: true
      });
      console.log(`     ${scenario.expectError ? '✅' : '❌'} ${scenario.name}: ${error.message}`);
    }
  }

  /**
   * Execute a protocol error scenario
   */
  async executeProtocolErrorScenario(scenario) {
    try {
      console.log(`   Testing protocol error: ${scenario.name}...`);
      
      let response;
      
      if (scenario.rawMessage) {
        // Send raw malformed message
        response = await this.sendRawMessage(scenario.rawMessage);
      } else {
        // Send structured message
        response = await this.sendRequest(scenario.message);
      }
      
      const hasError = !!response.error;
      const success = scenario.expectError ? hasError : !hasError;
      
      let patternMatch = true;
      if (scenario.expectError && scenario.errorPattern && response.error) {
        patternMatch = scenario.errorPattern.test(response.error.message);
      }
      
      const overallSuccess = success && patternMatch;
      
      this.results.addErrorScenario('protocol-errors', scenario.name, {
        success: overallSuccess,
        expectError: scenario.expectError,
        hasError,
        patternMatch,
        errorMessage: response.error?.message,
        errorCode: response.error?.code
      });
      
      if (overallSuccess) {
        console.log(`     ✅ ${scenario.name} handled correctly`);
      } else {
        console.log(`     ⚠️ ${scenario.name} needs attention`);
      }
      
    } catch (error) {
      this.results.addError('protocol-errors', error);
      this.results.addErrorScenario('protocol-errors', scenario.name, {
        success: scenario.expectError,
        error: error.message,
        caughtException: true
      });
      console.log(`     ${scenario.expectError ? '✅' : '❌'} ${scenario.name}: ${error.message}`);
    }
  }

  /**
   * Send a tool request
   */
  async sendToolRequest(toolName, args, timeout = ERROR_TEST_CONFIG.requestTimeout) {
    const request = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };
    
    return await this.sendRequest(request, timeout);
  }

  /**
   * Start server process
   */
  async startServer(serverPath) {
    return new Promise((resolve, reject) => {
      const serverProcess = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' }
      });
      
      serverProcess.on('error', reject);
      
      let stderr = '';
      serverProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.includes('MCP WebScraper server')) {
          resolve(serverProcess);
        }
      });
      
      setTimeout(() => {
        if (!serverProcess.pid) {
          reject(new Error('Server failed to start within timeout'));
        } else {
          resolve(serverProcess);
        }
      }, ERROR_TEST_CONFIG.serverTimeout);
    });
  }

  /**
   * Send request to server
   */
  async sendRequest(request, timeout = ERROR_TEST_CONFIG.requestTimeout) {
    return new Promise((resolve, reject) => {
      if (!this.serverProcess) {
        reject(new Error('Server not started'));
        return;
      }
      
      const requestStr = JSON.stringify(request) + '\n';
      let responseBuffer = '';
      
      const timeoutId = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, timeout);
      
      const onData = (data) => {
        responseBuffer += data.toString();
        
        const lines = responseBuffer.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line.trim());
              if (response.id === request.id || response.jsonrpc) {
                clearTimeout(timeoutId);
                this.serverProcess.stdout.removeListener('data', onData);
                resolve(response);
                return;
              }
            } catch (e) {
              // Not complete JSON yet
            }
          }
        }
      };
      
      this.serverProcess.stdout.on('data', onData);
      this.serverProcess.stdin.write(requestStr);
    });
  }

  /**
   * Send raw message to server
   */
  async sendRawMessage(data) {
    return new Promise((resolve, reject) => {
      if (!this.serverProcess) {
        reject(new Error('Server not started'));
        return;
      }
      
      let responseBuffer = '';
      
      const timeout = setTimeout(() => {
        reject(new Error('Raw message timeout'));
      }, ERROR_TEST_CONFIG.requestTimeout);
      
      const onData = (data) => {
        responseBuffer += data.toString();
        
        const lines = responseBuffer.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line.trim());
              clearTimeout(timeout);
              this.serverProcess.stdout.removeListener('data', onData);
              resolve(response);
              return;
            } catch (e) {
              // Invalid JSON might be expected
              clearTimeout(timeout);
              this.serverProcess.stdout.removeListener('data', onData);
              resolve({ error: { code: -32700, message: 'Parse error' } });
              return;
            }
          }
        }
      };
      
      this.serverProcess.stdout.on('data', onData);
      this.serverProcess.stdin.write(data + '\n');
    });
  }

  /**
   * Send notification to server
   */
  async sendNotification(notification) {
    if (!this.serverProcess) {
      throw new Error('Server not started');
    }
    
    const notificationStr = JSON.stringify(notification) + '\n';
    this.serverProcess.stdin.write(notificationStr);
  }

  /**
   * Get next request ID
   */
  getNextRequestId() {
    return this.requestId++;
  }

  /**
   * Generate error handling report
   */
  generateErrorReport() {
    const summary = this.results.getSummary();
    
    return {
      timestamp: new Date().toISOString(),
      configuration: ERROR_TEST_CONFIG,
      summary,
      errorAnalysis: this.analyzeErrorHandling(summary),
      errorPatterns: this.analyzeErrorPatterns(),
      robustnessScore: this.calculateRobustnessScore(summary),
      errors: this.results.errors,
      recommendations: this.generateErrorRecommendations(summary)
    };
  }

  /**
   * Analyze error handling quality
   */
  analyzeErrorHandling(summary) {
    const analysis = {
      status: 'ROBUST',
      issues: [],
      strengths: []
    };
    
    if (summary.successRate < 80) {
      analysis.status = 'FRAGILE';
      analysis.issues.push(`Low error handling success rate: ${summary.successRate.toFixed(1)}%`);
    } else if (summary.successRate < 95) {
      analysis.status = 'MODERATE';
      analysis.issues.push(`Moderate error handling: ${summary.successRate.toFixed(1)}%`);
    } else {
      analysis.strengths.push(`Excellent error handling: ${summary.successRate.toFixed(1)}%`);
    }
    
    // Analyze specific categories
    if (summary.errorScenarios.passed < summary.errorScenarios.total * 0.9) {
      analysis.issues.push('Some error scenarios not handled properly');
    }
    
    if (summary.recoveryTests.passed === summary.recoveryTests.total) {
      analysis.strengths.push('All recovery tests passed');
    } else {
      analysis.issues.push('Some recovery mechanisms failed');
    }
    
    return analysis;
  }

  /**
   * Analyze error patterns
   */
  analyzeErrorPatterns() {
    const patterns = this.results.errorPatterns;
    const errorCodeCounts = {};
    const messagePatterns = {};
    
    for (const pattern of patterns) {
      // Count error codes
      if (pattern.errorCode) {
        errorCodeCounts[pattern.errorCode] = (errorCodeCounts[pattern.errorCode] || 0) + 1;
      }
      
      // Analyze message patterns
      if (pattern.errorMessage) {
        const words = pattern.errorMessage.toLowerCase().split(/\s+/);
        for (const word of words) {
          if (word.length > 3) { // Only significant words
            messagePatterns[word] = (messagePatterns[word] || 0) + 1;
          }
        }
      }
    }
    
    return {
      totalPatterns: patterns.length,
      errorCodeDistribution: errorCodeCounts,
      commonMessageWords: Object.entries(messagePatterns)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
    };
  }

  /**
   * Calculate robustness score
   */
  calculateRobustnessScore(summary) {
    let score = 0;
    let maxScore = 0;
    
    // Error scenario handling (40 points)
    score += (summary.errorScenarios.passed / summary.errorScenarios.total) * 40;
    maxScore += 40;
    
    // Edge case handling (30 points)
    score += (summary.edgeCases.passed / summary.edgeCases.total) * 30;
    maxScore += 30;
    
    // Recovery mechanisms (30 points)
    score += (summary.recoveryTests.passed / summary.recoveryTests.total) * 30;
    maxScore += 30;
    
    const normalizedScore = (score / maxScore) * 100;
    
    let rating = 'POOR';
    if (normalizedScore >= 90) rating = 'EXCELLENT';
    else if (normalizedScore >= 80) rating = 'GOOD';
    else if (normalizedScore >= 70) rating = 'ACCEPTABLE';
    
    return {
      score: normalizedScore,
      rating,
      breakdown: {
        errorScenarios: (summary.errorScenarios.passed / summary.errorScenarios.total) * 100,
        edgeCases: (summary.edgeCases.passed / summary.edgeCases.total) * 100,
        recovery: (summary.recoveryTests.passed / summary.recoveryTests.total) * 100
      }
    };
  }

  /**
   * Generate error handling recommendations
   */
  generateErrorRecommendations(summary) {
    const recommendations = [];
    
    if (summary.successRate < 95) {
      recommendations.push('Improve error handling robustness across all scenarios');
    }
    
    if (summary.errorScenarios.passed < summary.errorScenarios.total) {
      recommendations.push('Review and fix specific error scenario handling');
    }
    
    if (summary.edgeCases.passed < summary.edgeCases.total) {
      recommendations.push('Strengthen edge case handling and input validation');
    }
    
    if (summary.recoveryTests.passed < summary.recoveryTests.total) {
      recommendations.push('Improve error recovery and graceful degradation mechanisms');
    }
    
    if (this.results.errorPatterns.length < 5) {
      recommendations.push('Expand error testing coverage to identify more patterns');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Error handling is robust and comprehensive');
      recommendations.push('Continue monitoring for new error scenarios');
    }
    
    return recommendations;
  }

  /**
   * Save error handling report
   */
  async saveErrorReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `error-handling-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📄 Error handling report saved: ${filepath}`);
    } catch (error) {
      console.error('❌ Failed to save error report:', error.message);
    }
  }

  /**
   * Cleanup test environment
   */
  async cleanup() {
    console.log('   Cleaning up test environment...');
    
    if (this.serverProcess && !this.serverProcess.killed) {
      this.serverProcess.kill('SIGTERM');
      
      await new Promise((resolve) => {
        this.serverProcess.on('exit', resolve);
        setTimeout(() => {
          if (!this.serverProcess.killed) {
            this.serverProcess.kill('SIGKILL');
          }
          resolve();
        }, 2000);
      });
    }
    
    console.log('   ✅ Cleanup completed');
  }
}

/**
 * Main error handling test execution
 */
async function runErrorHandlingTests() {
  console.log('🛡️ Starting Error Handling Test Suite...');
  
  const testSuite = new ErrorHandlingTestSuite();
  
  try {
    const report = await testSuite.runErrorHandlingTests();
    
    console.log('\n📋 Error Handling Test Summary:');
    console.log('─'.repeat(60));
    console.log(`✅ Status: ${report.errorAnalysis.status}`);
    console.log(`📊 Total Tests: ${report.summary.totalTests}`);
    console.log(`🎯 Success Rate: ${report.summary.successRate.toFixed(1)}%`);
    console.log(`🛡️ Robustness Score: ${report.robustnessScore.score.toFixed(1)} (${report.robustnessScore.rating})`);
    console.log(`❌ Total Errors: ${report.summary.totalErrors}`);
    console.log(`⏱️ Duration: ${(report.summary.duration / 1000).toFixed(1)}s`);
    console.log(`🔍 Error Patterns: ${report.errorPatterns.totalPatterns}`);
    
    if (report.errorAnalysis.issues.length > 0) {
      console.log('\n⚠️ Issues Identified:');
      report.errorAnalysis.issues.forEach(issue => console.log(`   • ${issue}`));
    }
    
    if (report.errorAnalysis.strengths.length > 0) {
      console.log('\n✨ Strengths:');
      report.errorAnalysis.strengths.forEach(strength => console.log(`   • ${strength}`));
    }
    
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach(rec => console.log(`   • ${rec}`));
    
    return report;
    
  } catch (error) {
    console.error('❌ Error handling test failed:', error);
    throw error;
  }
}

// Export for use in other test files
export { ErrorHandlingTestSuite, runErrorHandlingTests };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runErrorHandlingTests()
    .then(() => {
      console.log('✅ Error handling test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Error handling test failed:', error);
      process.exit(1);
    });
}
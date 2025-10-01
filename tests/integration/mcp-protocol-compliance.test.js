/**
 * MCP Protocol Compliance Integration Tests
 * Tests the MCP (Model Context Protocol) implementation for compliance with specifications
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * MCP Protocol Test Configuration
 */
const MCP_TEST_CONFIG = {
  serverTimeout: 10000,
  requestTimeout: 5000,
  maxRetries: 3,
  expectedTools: [
    'fetch_url', 'extract_text', 'extract_links', 'extract_metadata', 
    'scrape_structured', 'crawl_deep', 'map_site', 'extract_content',
    'process_document', 'summarize_content', 'analyze_content'
    // Note: search_web is conditional based on configuration
  ],
  protocolVersion: '2024-11-05'
};

/**
 * MCP Protocol Test Results Collector
 */
class MCPTestResults {
  constructor() {
    this.reset();
  }

  reset() {
    this.tests = new Map();
    this.protocolMessages = [];
    this.errors = [];
    this.startTime = Date.now();
    this.serverProcess = null;
  }

  addTest(testName, result) {
    this.tests.set(testName, {
      ...result,
      timestamp: Date.now(),
      duration: Date.now() - this.startTime
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

  addProtocolMessage(direction, message) {
    this.protocolMessages.push({
      direction, // 'sent' or 'received'
      message,
      timestamp: Date.now()
    });
  }

  getSummary() {
    const totalTests = this.tests.size;
    const passedTests = Array.from(this.tests.values()).filter(t => t.success).length;
    const failedTests = totalTests - passedTests;
    
    return {
      totalTests,
      passedTests,
      failedTests,
      successRate: totalTests > 0 ? (passedTests / totalTests) * 100 : 0,
      totalErrors: this.errors.length,
      duration: Date.now() - this.startTime,
      protocolMessageCount: this.protocolMessages.length,
      tests: Object.fromEntries(this.tests)
    };
  }
}

/**
 * MCP Protocol Compliance Test Suite
 */
class MCPProtocolComplianceTestSuite {
  constructor() {
    this.results = new MCPTestResults();
    this.serverProcess = null;
    this.requestId = 1;
  }

  /**
   * Run comprehensive MCP protocol compliance tests
   */
  async runComplianceTests() {
    console.log('🔌 Starting MCP Protocol Compliance Tests...');
    console.log('─'.repeat(60));
    
    try {
      // Test 1: Server Initialization and Protocol Handshake
      console.log('🤝 Test 1: Protocol Initialization');
      await this.testProtocolInitialization();
      
      // Test 2: Tool Discovery and Schema Validation
      console.log('\n🔍 Test 2: Tool Discovery');
      await this.testToolDiscovery();
      
      // Test 3: Request/Response Format Validation
      console.log('\n📋 Test 3: Request/Response Format');
      await this.testRequestResponseFormat();
      
      // Test 4: Error Handling and Protocol Compliance
      console.log('\n❌ Test 4: Error Handling');
      await this.testErrorHandling();
      
      // Test 5: Tool Execution Validation
      console.log('\n⚙️ Test 5: Tool Execution');
      await this.testToolExecution();
      
      // Test 6: Parameter Validation
      console.log('\n✅ Test 6: Parameter Validation');
      await this.testParameterValidation();
      
      // Test 7: Response Schema Validation
      console.log('\n📤 Test 7: Response Schema');
      await this.testResponseSchema();
      
      // Test 8: Concurrent Request Handling
      console.log('\n🔄 Test 8: Concurrent Requests');
      await this.testConcurrentRequests();
      
      // Test 9: Large Payload Handling
      console.log('\n📦 Test 9: Large Payloads');
      await this.testLargePayloadHandling();
      
      // Test 10: Transport Layer Validation
      console.log('\n🚀 Test 10: Transport Layer');
      await this.testTransportLayer();
      
      // Generate final compliance report
      const report = this.generateComplianceReport();
      await this.saveComplianceReport(report);
      
      return report;
      
    } catch (error) {
      console.error('❌ MCP compliance test suite failed:', error);
      this.results.addError('suite', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Test MCP protocol initialization and handshake
   */
  async testProtocolInitialization() {
    try {
      console.log('   Testing server startup and protocol handshake...');
      
      const serverPath = join(__dirname, '..', '..', 'server.js');
      await this.startServer(serverPath);
      
      // Test initialization request
      const initRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'initialize',
        params: {
          protocolVersion: MCP_TEST_CONFIG.protocolVersion,
          capabilities: {
            tools: {}
          },
          clientInfo: {
            name: 'mcp-integration-test',
            version: '1.0.0'
          }
        }
      };
      
      const initResponse = await this.sendRequest(initRequest);
      
      // Validate initialization response
      const isValidInit = this.validateInitializationResponse(initResponse);
      
      // Send initialized notification
      const initializedNotification = {
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      };
      
      await this.sendNotification(initializedNotification);
      
      this.results.addTest('protocolInitialization', {
        success: isValidInit,
        serverStarted: this.serverProcess !== null,
        initResponseValid: isValidInit,
        protocolVersion: initResponse?.result?.protocolVersion,
        serverCapabilities: initResponse?.result?.capabilities
      });
      
      console.log('   ✅ Protocol initialization test completed');
      
    } catch (error) {
      this.results.addError('protocolInitialization', error);
      this.results.addTest('protocolInitialization', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Protocol initialization test failed: ${error.message}`);
    }
  }

  /**
   * Test tool discovery and schema validation
   */
  async testToolDiscovery() {
    try {
      console.log('   Testing tool discovery and schemas...');
      
      const toolsRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/list'
      };
      
      const toolsResponse = await this.sendRequest(toolsRequest);
      
      // Validate tools response structure
      const isValidResponse = this.validateToolsListResponse(toolsResponse);
      const tools = toolsResponse?.result?.tools || [];
      
      // Check for expected tools
      const expectedTools = [...MCP_TEST_CONFIG.expectedTools];
      const discoveredTools = tools.map(t => t.name);
      const missingTools = expectedTools.filter(t => !discoveredTools.includes(t));
      const unexpectedTools = discoveredTools.filter(t => !expectedTools.includes(t) && t !== 'search_web');
      
      // Validate individual tool schemas
      const schemaValidationResults = tools.map(tool => ({
        name: tool.name,
        hasValidSchema: this.validateToolSchema(tool),
        hasDescription: !!tool.description,
        hasInputSchema: !!tool.inputSchema,
        parametersValid: this.validateToolParameters(tool.inputSchema)
      }));
      
      const allSchemasValid = schemaValidationResults.every(r => r.hasValidSchema);
      
      this.results.addTest('toolDiscovery', {
        success: isValidResponse && allSchemasValid && missingTools.length === 0,
        responseValid: isValidResponse,
        toolsDiscovered: tools.length,
        expectedToolsFound: expectedTools.length - missingTools.length,
        missingTools,
        unexpectedTools,
        schemaValidationResults,
        allSchemasValid
      });
      
      console.log(`   ✅ Tool discovery test completed (${tools.length} tools found)`);
      
    } catch (error) {
      this.results.addError('toolDiscovery', error);
      this.results.addTest('toolDiscovery', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Tool discovery test failed: ${error.message}`);
    }
  }

  /**
   * Test request/response format compliance
   */
  async testRequestResponseFormat() {
    try {
      console.log('   Testing request/response format compliance...');
      
      const testCases = [
        {
          name: 'valid-jsonrpc-request',
          request: {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'tools/call',
            params: {
              name: 'fetch_url',
              arguments: {
                url: 'https://httpbin.org/get'
              }
            }
          },
          expectSuccess: true
        },
        {
          name: 'missing-jsonrpc-field',
          request: {
            id: this.getNextRequestId(),
            method: 'tools/call',
            params: {
              name: 'fetch_url',
              arguments: {
                url: 'https://httpbin.org/get'
              }
            }
          },
          expectSuccess: false
        },
        {
          name: 'invalid-jsonrpc-version',
          request: {
            jsonrpc: '1.0',
            id: this.getNextRequestId(),
            method: 'tools/call',
            params: {
              name: 'fetch_url',
              arguments: {
                url: 'https://httpbin.org/get'
              }
            }
          },
          expectSuccess: false
        },
        {
          name: 'missing-method',
          request: {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            params: {
              name: 'fetch_url',
              arguments: {
                url: 'https://httpbin.org/get'
              }
            }
          },
          expectSuccess: false
        }
      ];
      
      const formatTestResults = [];
      
      for (const testCase of testCases) {
        try {
          const response = await this.sendRequest(testCase.request);
          const hasError = !!response.error;
          const success = testCase.expectSuccess ? !hasError : hasError;
          
          formatTestResults.push({
            name: testCase.name,
            success,
            expectSuccess: testCase.expectSuccess,
            hasError,
            response: response
          });
        } catch (error) {
          formatTestResults.push({
            name: testCase.name,
            success: !testCase.expectSuccess,
            expectSuccess: testCase.expectSuccess,
            hasError: true,
            error: error.message
          });
        }
      }
      
      const allFormatTestsPass = formatTestResults.every(r => r.success);
      
      this.results.addTest('requestResponseFormat', {
        success: allFormatTestsPass,
        testCases: formatTestResults.length,
        passedCases: formatTestResults.filter(r => r.success).length,
        results: formatTestResults
      });
      
      console.log(`   ✅ Request/response format test completed`);
      
    } catch (error) {
      this.results.addError('requestResponseFormat', error);
      this.results.addTest('requestResponseFormat', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Request/response format test failed: ${error.message}`);
    }
  }

  /**
   * Test error handling compliance
   */
  async testErrorHandling() {
    try {
      console.log('   Testing error handling compliance...');
      
      const errorTestCases = [
        {
          name: 'unknown-method',
          request: {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'unknown/method',
            params: {}
          },
          expectedErrorCode: -32601 // Method not found
        },
        {
          name: 'unknown-tool',
          request: {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'tools/call',
            params: {
              name: 'unknown_tool',
              arguments: {}
            }
          },
          expectedErrorCode: -32602 // Invalid params
        },
        {
          name: 'invalid-parameters',
          request: {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'tools/call',
            params: {
              name: 'fetch_url',
              arguments: {
                url: 'not-a-valid-url'
              }
            }
          },
          expectedErrorCode: -32602 // Invalid params
        },
        {
          name: 'missing-required-parameter',
          request: {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'tools/call',
            params: {
              name: 'fetch_url',
              arguments: {}
            }
          },
          expectedErrorCode: -32602 // Invalid params
        }
      ];
      
      const errorTestResults = [];
      
      for (const testCase of errorTestCases) {
        try {
          const response = await this.sendRequest(testCase.request);
          
          const hasError = !!response.error;
          const correctErrorCode = hasError && response.error.code === testCase.expectedErrorCode;
          const hasErrorMessage = hasError && !!response.error.message;
          
          errorTestResults.push({
            name: testCase.name,
            success: hasError && correctErrorCode && hasErrorMessage,
            hasError,
            correctErrorCode,
            hasErrorMessage,
            actualErrorCode: response.error?.code,
            errorMessage: response.error?.message
          });
        } catch (error) {
          errorTestResults.push({
            name: testCase.name,
            success: false,
            error: error.message
          });
        }
      }
      
      const allErrorTestsPass = errorTestResults.every(r => r.success);
      
      this.results.addTest('errorHandling', {
        success: allErrorTestsPass,
        testCases: errorTestResults.length,
        passedCases: errorTestResults.filter(r => r.success).length,
        results: errorTestResults
      });
      
      console.log(`   ✅ Error handling test completed`);
      
    } catch (error) {
      this.results.addError('errorHandling', error);
      this.results.addTest('errorHandling', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Error handling test failed: ${error.message}`);
    }
  }

  /**
   * Test tool execution for basic tools
   */
  async testToolExecution() {
    try {
      console.log('   Testing tool execution...');
      
      const toolExecutionTests = [
        {
          name: 'fetch_url',
          arguments: {
            url: 'https://httpbin.org/get',
            timeout: 5000
          },
          validateResponse: (result) => {
            return result && typeof result.status === 'number' && 
                   typeof result.body === 'string' && result.status === 200;
          }
        },
        {
          name: 'extract_metadata',
          arguments: {
            url: 'https://httpbin.org/html'
          },
          validateResponse: (result) => {
            return result && typeof result.title === 'string' && 
                   typeof result.description === 'string';
          }
        },
        {
          name: 'scrape_structured',
          arguments: {
            url: 'https://httpbin.org/html',
            selectors: {
              title: 'title',
              heading: 'h1'
            }
          },
          validateResponse: (result) => {
            return result && result.data && 
                   typeof result.data.title === 'string';
          }
        }
      ];
      
      const executionResults = [];
      
      for (const test of toolExecutionTests) {
        try {
          const request = {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'tools/call',
            params: {
              name: test.name,
              arguments: test.arguments
            }
          };
          
          const response = await this.sendRequest(request);
          
          const hasResult = !response.error && !!response.result;
          
          // Parse JSON from content[0].text for validation
          let parsedResult = null;
          if (hasResult && response.result.content && response.result.content[0]) {
            parsedResult = JSON.parse(response.result.content[0].text);
          }
          const validResponse = hasResult && parsedResult && test.validateResponse(parsedResult);
          
          executionResults.push({
            name: test.name,
            success: validResponse,
            hasResult,
            validResponse,
            error: response.error?.message
          });
        } catch (error) {
          executionResults.push({
            name: test.name,
            success: false,
            error: error.message
          });
        }
      }
      
      const allExecutionTestsPass = executionResults.every(r => r.success);
      
      this.results.addTest('toolExecution', {
        success: allExecutionTestsPass,
        testCases: executionResults.length,
        passedCases: executionResults.filter(r => r.success).length,
        results: executionResults
      });
      
      console.log(`   ✅ Tool execution test completed`);
      
    } catch (error) {
      this.results.addError('toolExecution', error);
      this.results.addTest('toolExecution', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Tool execution test failed: ${error.message}`);
    }
  }

  /**
   * Test parameter validation for all tools
   */
  async testParameterValidation() {
    try {
      console.log('   Testing parameter validation...');
      
      const validationTests = [
        {
          toolName: 'fetch_url',
          testCases: [
            {
              name: 'valid-parameters',
              args: { url: 'https://httpbin.org/get' },
              expectSuccess: true
            },
            {
              name: 'invalid-url',
              args: { url: 'not-a-url' },
              expectSuccess: false
            },
            {
              name: 'missing-url',
              args: {},
              expectSuccess: false
            },
            {
              name: 'invalid-timeout',
              args: { url: 'https://httpbin.org/get', timeout: 'invalid' },
              expectSuccess: false
            }
          ]
        },
        {
          toolName: 'extract_text',
          testCases: [
            {
              name: 'valid-parameters',
              args: { url: 'https://httpbin.org/html' },
              expectSuccess: true
            },
            {
              name: 'invalid-url',
              args: { url: 'not-a-url' },
              expectSuccess: false
            },
            {
              name: 'invalid-boolean',
              args: { url: 'https://httpbin.org/html', remove_scripts: 'not-boolean' },
              expectSuccess: false
            }
          ]
        }
      ];
      
      const validationResults = [];
      
      for (const toolTest of validationTests) {
        for (const testCase of toolTest.testCases) {
          try {
            const request = {
              jsonrpc: '2.0',
              id: this.getNextRequestId(),
              method: 'tools/call',
              params: {
                name: toolTest.toolName,
                arguments: testCase.args
              }
            };
            
            const response = await this.sendRequest(request);
            const hasError = !!response.error;
            const success = testCase.expectSuccess ? !hasError : hasError;
            
            validationResults.push({
              toolName: toolTest.toolName,
              testCase: testCase.name,
              success,
              expectSuccess: testCase.expectSuccess,
              hasError,
              errorMessage: response.error?.message
            });
          } catch (error) {
            validationResults.push({
              toolName: toolTest.toolName,
              testCase: testCase.name,
              success: !testCase.expectSuccess,
              expectSuccess: testCase.expectSuccess,
              error: error.message
            });
          }
        }
      }
      
      const allValidationTestsPass = validationResults.every(r => r.success);
      
      this.results.addTest('parameterValidation', {
        success: allValidationTestsPass,
        testCases: validationResults.length,
        passedCases: validationResults.filter(r => r.success).length,
        results: validationResults
      });
      
      console.log(`   ✅ Parameter validation test completed`);
      
    } catch (error) {
      this.results.addError('parameterValidation', error);
      this.results.addTest('parameterValidation', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Parameter validation test failed: ${error.message}`);
    }
  }

  /**
   * Test response schema validation
   */
  async testResponseSchema() {
    try {
      console.log('   Testing response schema validation...');
      
      const schemaTests = [
        {
          toolName: 'fetch_url',
          arguments: { url: 'https://httpbin.org/get' },
          validateSchema: (result) => {
            return typeof result.status === 'number' &&
                   typeof result.statusText === 'string' &&
                   typeof result.body === 'string' &&
                   typeof result.headers === 'object' &&
                   typeof result.contentType === 'string' &&
                   typeof result.size === 'number' &&
                   typeof result.url === 'string';
          }
        },
        {
          toolName: 'extract_text',
          arguments: { url: 'https://httpbin.org/html' },
          validateSchema: (result) => {
            return typeof result.text === 'string' &&
                   typeof result.word_count === 'number' &&
                   typeof result.char_count === 'number' &&
                   typeof result.url === 'string';
          }
        },
        {
          toolName: 'extract_metadata',
          arguments: { url: 'https://httpbin.org/html' },
          validateSchema: (result) => {
            return typeof result.title === 'string' &&
                   typeof result.description === 'string' &&
                   Array.isArray(result.keywords) &&
                   typeof result.og_tags === 'object' &&
                   typeof result.twitter_tags === 'object' &&
                   typeof result.url === 'string';
          }
        }
      ];
      
      const schemaResults = [];
      
      for (const test of schemaTests) {
        try {
          const request = {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'tools/call',
            params: {
              name: test.toolName,
              arguments: test.arguments
            }
          };
          
          const response = await this.sendRequest(request);
          
          if (response.error) {
            schemaResults.push({
              toolName: test.toolName,
              success: false,
              error: response.error.message
            });
            continue;
          }
          
          // Parse JSON from content[0].text for schema validation
          const result = JSON.parse(response.result.content[0].text);
          const schemaValid = test.validateSchema(result);
          
          schemaResults.push({
            toolName: test.toolName,
            success: schemaValid,
            schemaValid,
            resultStructure: Object.keys(result)
          });
        } catch (error) {
          schemaResults.push({
            toolName: test.toolName,
            success: false,
            error: error.message
          });
        }
      }
      
      const allSchemaTestsPass = schemaResults.every(r => r.success);
      
      this.results.addTest('responseSchema', {
        success: allSchemaTestsPass,
        testCases: schemaResults.length,
        passedCases: schemaResults.filter(r => r.success).length,
        results: schemaResults
      });
      
      console.log(`   ✅ Response schema test completed`);
      
    } catch (error) {
      this.results.addError('responseSchema', error);
      this.results.addTest('responseSchema', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Response schema test failed: ${error.message}`);
    }
  }

  /**
   * Test concurrent request handling
   */
  async testConcurrentRequests() {
    try {
      console.log('   Testing concurrent request handling...');
      
      const concurrentRequests = Array.from({ length: 5 }, (_, i) => ({
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/call',
        params: {
          name: 'fetch_url',
          arguments: {
            url: `https://httpbin.org/delay/${i % 3}`
          }
        }
      }));
      
      const startTime = Date.now();
      const responses = await Promise.all(
        concurrentRequests.map(req => this.sendRequest(req))
      );
      const duration = Date.now() - startTime;
      
      const successfulResponses = responses.filter(r => !r.error);
      const allRequestsSuccessful = successfulResponses.length === concurrentRequests.length;
      
      // Verify that requests were processed concurrently (not sequentially)
      const expectedSequentialTime = concurrentRequests.length * 1000; // Minimum 1s per request
      const isConcurrent = duration < expectedSequentialTime * 0.8;
      
      this.results.addTest('concurrentRequests', {
        success: allRequestsSuccessful && isConcurrent,
        requestsExecuted: concurrentRequests.length,
        successfulRequests: successfulResponses.length,
        duration,
        isConcurrent,
        expectedSequentialTime,
        responses: responses.map(r => ({
          hasError: !!r.error,
          errorMessage: r.error?.message
        }))
      });
      
      console.log(`   ✅ Concurrent requests test completed (${duration}ms)`);
      
    } catch (error) {
      this.results.addError('concurrentRequests', error);
      this.results.addTest('concurrentRequests', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Concurrent requests test failed: ${error.message}`);
    }
  }

  /**
   * Test large payload handling
   */
  async testLargePayloadHandling() {
    try {
      console.log('   Testing large payload handling...');
      
      // Test with large selectors object
      const largeSelectors = {};
      for (let i = 0; i < 100; i++) {
        largeSelectors[`field_${i}`] = `div:nth-child(${i + 1})`;
      }
      
      const largePayloadRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/call',
        params: {
          name: 'scrape_structured',
          arguments: {
            url: 'https://httpbin.org/html',
            selectors: largeSelectors
          }
        }
      };
      
      const response = await this.sendRequest(largePayloadRequest);
      const success = !response.error;
      
      this.results.addTest('largePayloadHandling', {
        success,
        payloadSize: JSON.stringify(largePayloadRequest).length,
        responseReceived: !!response,
        hasError: !!response.error,
        errorMessage: response.error?.message
      });
      
      console.log(`   ✅ Large payload handling test completed`);
      
    } catch (error) {
      this.results.addError('largePayloadHandling', error);
      this.results.addTest('largePayloadHandling', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Large payload handling test failed: ${error.message}`);
    }
  }

  /**
   * Test transport layer (stdio) functionality
   */
  async testTransportLayer() {
    try {
      console.log('   Testing transport layer functionality...');
      
      // Test that server responds to ping-like requests
      const pingRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/list'
      };
      
      const startTime = Date.now();
      const response = await this.sendRequest(pingRequest);
      const roundTripTime = Date.now() - startTime;
      
      const transportWorking = !response.error && response.result;
      const responsiveTransport = roundTripTime < 1000; // Should respond within 1 second
      
      this.results.addTest('transportLayer', {
        success: transportWorking && responsiveTransport,
        transportWorking,
        responsiveTransport,
        roundTripTime,
        serverProcessAlive: this.serverProcess && !this.serverProcess.killed
      });
      
      console.log(`   ✅ Transport layer test completed (${roundTripTime}ms)`);
      
    } catch (error) {
      this.results.addError('transportLayer', error);
      this.results.addTest('transportLayer', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Transport layer test failed: ${error.message}`);
    }
  }

  // Helper methods for server communication and validation

  /**
   * Start the MCP server process
   */
  async startServer(serverPath) {
    return new Promise((resolve, reject) => {
      this.serverProcess = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' }
      });
      
      this.serverProcess.on('error', reject);
      
      // Wait for server to be ready
      let stderr = '';
      this.serverProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.includes('CrawlForge MCP Server')) {
          resolve();
        }
      });
      
      // Timeout if server doesn't start
      setTimeout(() => {
        if (!this.serverProcess.pid) {
          reject(new Error('Server failed to start within timeout'));
        } else {
          resolve(); // Server started, proceed
        }
      }, MCP_TEST_CONFIG.serverTimeout);
    });
  }

  /**
   * Send a JSON-RPC request to the server
   */
  async sendRequest(request) {
    return new Promise((resolve, reject) => {
      if (!this.serverProcess) {
        reject(new Error('Server not started'));
        return;
      }
      
      const requestStr = JSON.stringify(request) + '\n';
      this.results.addProtocolMessage('sent', request);
      
      let responseBuffer = '';
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, MCP_TEST_CONFIG.requestTimeout);
      
      const onData = (data) => {
        responseBuffer += data.toString();
        
        // Look for complete JSON response
        const lines = responseBuffer.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line.trim());
              if (response.id === request.id || response.jsonrpc) {
                clearTimeout(timeout);
                this.serverProcess.stdout.removeListener('data', onData);
                this.results.addProtocolMessage('received', response);
                resolve(response);
                return;
              }
            } catch (e) {
              // Not a complete JSON yet, continue accumulating
            }
          }
        }
      };
      
      this.serverProcess.stdout.on('data', onData);
      this.serverProcess.stdin.write(requestStr);
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  async sendNotification(notification) {
    if (!this.serverProcess) {
      throw new Error('Server not started');
    }
    
    const notificationStr = JSON.stringify(notification) + '\n';
    this.results.addProtocolMessage('sent', notification);
    this.serverProcess.stdin.write(notificationStr);
  }

  /**
   * Validate initialization response
   */
  validateInitializationResponse(response) {
    return response &&
           response.jsonrpc === '2.0' &&
           response.result &&
           response.result.protocolVersion &&
           response.result.capabilities &&
           typeof response.result.serverInfo === 'object';
  }

  /**
   * Validate tools list response
   */
  validateToolsListResponse(response) {
    return response &&
           response.jsonrpc === '2.0' &&
           response.result &&
           Array.isArray(response.result.tools);
  }

  /**
   * Validate individual tool schema
   */
  validateToolSchema(tool) {
    return tool &&
           typeof tool.name === 'string' &&
           typeof tool.description === 'string' &&
           tool.inputSchema &&
           typeof tool.inputSchema === 'object';
  }

  /**
   * Validate tool parameters schema
   */
  validateToolParameters(inputSchema) {
    return inputSchema &&
           inputSchema.type === 'object' &&
           inputSchema.properties &&
           typeof inputSchema.properties === 'object';
  }

  /**
   * Get next request ID
   */
  getNextRequestId() {
    return this.requestId++;
  }

  /**
   * Generate compliance report
   */
  generateComplianceReport() {
    const summary = this.results.getSummary();
    
    return {
      timestamp: new Date().toISOString(),
      protocolVersion: MCP_TEST_CONFIG.protocolVersion,
      summary,
      protocolMessages: {
        total: this.results.protocolMessages.length,
        sent: this.results.protocolMessages.filter(m => m.direction === 'sent').length,
        received: this.results.protocolMessages.filter(m => m.direction === 'received').length
      },
      compliance: this.analyzeCompliance(summary),
      errors: this.results.errors,
      recommendations: this.generateComplianceRecommendations(summary)
    };
  }

  /**
   * Analyze MCP compliance
   */
  analyzeCompliance(summary) {
    const compliance = {
      status: 'COMPLIANT',
      issues: [],
      strengths: []
    };
    
    if (summary.successRate < 90) {
      compliance.status = 'NON_COMPLIANT';
      compliance.issues.push(`Low success rate: ${summary.successRate.toFixed(1)}%`);
    } else if (summary.successRate < 95) {
      compliance.status = 'PARTIAL_COMPLIANCE';
      compliance.issues.push(`Moderate success rate: ${summary.successRate.toFixed(1)}%`);
    } else {
      compliance.strengths.push(`High compliance rate: ${summary.successRate.toFixed(1)}%`);
    }
    
    // Check critical tests
    const criticalTests = ['protocolInitialization', 'toolDiscovery', 'requestResponseFormat'];
    const failedCriticalTests = criticalTests.filter(test => 
      summary.tests[test] && !summary.tests[test].success
    );
    
    if (failedCriticalTests.length > 0) {
      compliance.status = 'NON_COMPLIANT';
      compliance.issues.push(`Critical protocol failures: ${failedCriticalTests.join(', ')}`);
    }
    
    return compliance;
  }

  /**
   * Generate compliance recommendations
   */
  generateComplianceRecommendations(summary) {
    const recommendations = [];
    
    if (summary.successRate < 95) {
      recommendations.push('Review and fix protocol compliance issues');
    }
    
    // Check specific failed tests
    Object.entries(summary.tests).forEach(([testName, result]) => {
      if (!result.success) {
        switch (testName) {
          case 'protocolInitialization':
            recommendations.push('Fix protocol initialization and handshake process');
            break;
          case 'toolDiscovery':
            recommendations.push('Review tool registration and schema definitions');
            break;
          case 'requestResponseFormat':
            recommendations.push('Ensure JSON-RPC 2.0 format compliance');
            break;
          case 'errorHandling':
            recommendations.push('Improve error handling and standard error codes');
            break;
          case 'transportLayer':
            recommendations.push('Review stdio transport implementation');
            break;
        }
      }
    });
    
    if (recommendations.length === 0) {
      recommendations.push('MCP protocol implementation is compliant');
      recommendations.push('Continue monitoring for regressions');
    }
    
    return recommendations;
  }

  /**
   * Save compliance report
   */
  async saveComplianceReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `mcp-compliance-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📄 MCP compliance report saved: ${filepath}`);
    } catch (error) {
      console.error('❌ Failed to save compliance report:', error.message);
    }
  }

  /**
   * Cleanup test environment
   */
  async cleanup() {
    console.log('   Cleaning up test environment...');
    
    if (this.serverProcess && !this.serverProcess.killed) {
      this.serverProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
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
 * Main compliance test execution
 */
async function runMCPComplianceTests() {
  console.log('🔌 Starting MCP Protocol Compliance Test Suite...');
  
  const testSuite = new MCPProtocolComplianceTestSuite();
  
  try {
    const report = await testSuite.runComplianceTests();
    
    console.log('\n📋 MCP Compliance Test Summary:');
    console.log('─'.repeat(60));
    console.log(`✅ Status: ${report.compliance.status}`);
    console.log(`📊 Total Tests: ${report.summary.totalTests}`);
    console.log(`🎯 Success Rate: ${report.summary.successRate.toFixed(1)}%`);
    console.log(`❌ Total Errors: ${report.summary.totalErrors}`);
    console.log(`⏱️ Duration: ${(report.summary.duration / 1000).toFixed(1)}s`);
    console.log(`📡 Protocol Messages: ${report.protocolMessages.total}`);
    
    if (report.compliance.issues.length > 0) {
      console.log('\n⚠️ Compliance Issues:');
      report.compliance.issues.forEach(issue => console.log(`   • ${issue}`));
    }
    
    if (report.compliance.strengths.length > 0) {
      console.log('\n✨ Compliance Strengths:');
      report.compliance.strengths.forEach(strength => console.log(`   • ${strength}`));
    }
    
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach(rec => console.log(`   • ${rec}`));
    
    return report;
    
  } catch (error) {
    console.error('❌ MCP compliance test failed:', error);
    throw error;
  }
}

// Export for use in other test files
export { MCPProtocolComplianceTestSuite, runMCPComplianceTests };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMCPComplianceTests()
    .then(() => {
      console.log('✅ MCP compliance test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ MCP compliance test failed:', error);
      process.exit(1);
    });
}
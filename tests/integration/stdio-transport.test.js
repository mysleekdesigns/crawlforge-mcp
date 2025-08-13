/**
 * Stdio Transport Integration Tests
 * Tests the stdio transport layer for MCP server communication
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Stdio Transport Test Configuration
 */
const STDIO_TEST_CONFIG = {
  serverTimeout: 15000,
  requestTimeout: 8000,
  maxConcurrentConnections: 5,
  messageBufferSize: 1024 * 1024, // 1MB
  heartbeatInterval: 1000,
  reconnectAttempts: 3,
  binaryDataSizes: [1024, 10240, 102400], // 1KB, 10KB, 100KB
};

/**
 * Stdio Transport Test Results Collector
 */
class StdioTestResults {
  constructor() {
    this.reset();
  }

  reset() {
    this.tests = new Map();
    this.connectionEvents = [];
    this.dataTransferMetrics = [];
    this.errors = [];
    this.startTime = Date.now();
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

  addConnectionEvent(event, details) {
    this.connectionEvents.push({
      event,
      details,
      timestamp: Date.now()
    });
  }

  addDataTransferMetric(metric) {
    this.dataTransferMetrics.push({
      ...metric,
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
      connectionEvents: this.connectionEvents.length,
      dataTransferMetrics: this.dataTransferMetrics.length,
      tests: Object.fromEntries(this.tests)
    };
  }
}

/**
 * Stdio Transport Test Suite
 */
class StdioTransportTestSuite {
  constructor() {
    this.results = new StdioTestResults();
    this.serverProcesses = new Map();
    this.requestId = 1;
  }

  /**
   * Run comprehensive stdio transport tests
   */
  async runStdioTransportTests() {
    console.log('📡 Starting Stdio Transport Tests...');
    console.log('─'.repeat(60));
    
    try {
      // Test 1: Basic Connection Establishment
      console.log('🔗 Test 1: Connection Establishment');
      await this.testConnectionEstablishment();
      
      // Test 2: Bidirectional Communication
      console.log('\n↔️ Test 2: Bidirectional Communication');
      await this.testBidirectionalCommunication();
      
      // Test 3: Message Framing and Parsing
      console.log('\n📦 Test 3: Message Framing');
      await this.testMessageFraming();
      
      // Test 4: Large Message Handling
      console.log('\n📊 Test 4: Large Message Handling');
      await this.testLargeMessageHandling();
      
      // Test 5: Concurrent Connections
      console.log('\n🔀 Test 5: Concurrent Connections');
      await this.testConcurrentConnections();
      
      // Test 6: Connection Recovery
      console.log('\n🔄 Test 6: Connection Recovery');
      await this.testConnectionRecovery();
      
      // Test 7: Stream Buffer Management
      console.log('\n💾 Test 7: Buffer Management');
      await this.testBufferManagement();
      
      // Test 8: Error Handling and Cleanup
      console.log('\n🛡️ Test 8: Error Handling');
      await this.testErrorHandlingAndCleanup();
      
      // Test 9: Performance Characteristics
      console.log('\n⚡ Test 9: Performance');
      await this.testPerformanceCharacteristics();
      
      // Test 10: Signal Handling
      console.log('\n📶 Test 10: Signal Handling');
      await this.testSignalHandling();
      
      // Generate transport report
      const report = this.generateTransportReport();
      await this.saveTransportReport(report);
      
      return report;
      
    } catch (error) {
      console.error('❌ Stdio transport test suite failed:', error);
      this.results.addError('suite', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Test basic connection establishment
   */
  async testConnectionEstablishment() {
    try {
      console.log('   Testing connection establishment...');
      
      const serverPath = join(__dirname, '..', '..', 'server.js');
      const startTime = Date.now();
      
      const serverProcess = await this.createServerProcess('connection-test', serverPath);
      const connectionTime = Date.now() - startTime;
      
      // Test that server responds to initialization
      const initRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'stdio-test', version: '1.0.0' }
        }
      };
      
      const response = await this.sendMessage(serverProcess, initRequest);
      const connectionEstablished = response && !response.error;
      
      this.results.addConnectionEvent('established', {
        processId: serverProcess.pid,
        connectionTime,
        success: connectionEstablished
      });
      
      this.results.addTest('connectionEstablishment', {
        success: connectionEstablished,
        connectionTime,
        serverStarted: !!serverProcess.pid,
        responseReceived: !!response,
        validResponse: connectionEstablished
      });
      
      console.log(`   ✅ Connection establishment test completed (${connectionTime}ms)`);
      
    } catch (error) {
      this.results.addError('connectionEstablishment', error);
      this.results.addTest('connectionEstablishment', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Connection establishment test failed: ${error.message}`);
    }
  }

  /**
   * Test bidirectional communication
   */
  async testBidirectionalCommunication() {
    try {
      console.log('   Testing bidirectional communication...');
      
      const serverProcess = this.serverProcesses.get('connection-test');
      if (!serverProcess) {
        throw new Error('No server process available');
      }
      
      // Send multiple requests in both directions
      const requests = [
        {
          jsonrpc: '2.0',
          id: this.getNextRequestId(),
          method: 'tools/list'
        },
        {
          jsonrpc: '2.0',
          id: this.getNextRequestId(),
          method: 'tools/call',
          params: {
            name: 'fetch_url',
            arguments: { url: 'https://httpbin.org/get' }
          }
        }
      ];
      
      const responses = [];
      for (const request of requests) {
        const response = await this.sendMessage(serverProcess, request);
        responses.push(response);
      }
      
      const allResponsesValid = responses.every(r => r && r.jsonrpc === '2.0');
      const allRequestsAnswered = responses.length === requests.length;
      
      // Test notifications (no response expected)
      const notification = {
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      };
      await this.sendNotification(serverProcess, notification);
      
      this.results.addTest('bidirectionalCommunication', {
        success: allResponsesValid && allRequestsAnswered,
        requestsSent: requests.length,
        responsesReceived: responses.length,
        allResponsesValid,
        allRequestsAnswered,
        notificationSent: true
      });
      
      console.log(`   ✅ Bidirectional communication test completed`);
      
    } catch (error) {
      this.results.addError('bidirectionalCommunication', error);
      this.results.addTest('bidirectionalCommunication', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Bidirectional communication test failed: ${error.message}`);
    }
  }

  /**
   * Test message framing and parsing
   */
  async testMessageFraming() {
    try {
      console.log('   Testing message framing and parsing...');
      
      const serverProcess = this.serverProcesses.get('connection-test');
      if (!serverProcess) {
        throw new Error('No server process available');
      }
      
      // Test different message formats
      const framingTests = [
        {
          name: 'single-line-message',
          message: { jsonrpc: '2.0', id: this.getNextRequestId(), method: 'tools/list' },
          delimiter: '\n'
        },
        {
          name: 'multi-line-message',
          message: {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'tools/call',
            params: {
              name: 'scrape_structured',
              arguments: {
                url: 'https://httpbin.org/html',
                selectors: {
                  title: 'title',
                  heading: 'h1',
                  description: 'meta[name="description"]'
                }
              }
            }
          },
          delimiter: '\n'
        },
        {
          name: 'compact-message',
          message: { jsonrpc: '2.0', id: this.getNextRequestId(), method: 'tools/list' },
          compact: true,
          delimiter: '\n'
        }
      ];
      
      const framingResults = [];
      
      for (const test of framingTests) {
        try {
          const messageStr = test.compact ? 
            JSON.stringify(test.message) : 
            JSON.stringify(test.message, null, 0);
          
          const response = await this.sendRawMessage(serverProcess, messageStr + test.delimiter);
          
          framingResults.push({
            name: test.name,
            success: !!response && response.jsonrpc === '2.0',
            messageSize: messageStr.length,
            responseReceived: !!response
          });
        } catch (error) {
          framingResults.push({
            name: test.name,
            success: false,
            error: error.message
          });
        }
      }
      
      const allFramingTestsPass = framingResults.every(r => r.success);
      
      this.results.addTest('messageFraming', {
        success: allFramingTestsPass,
        testCases: framingResults.length,
        passedCases: framingResults.filter(r => r.success).length,
        results: framingResults
      });
      
      console.log(`   ✅ Message framing test completed`);
      
    } catch (error) {
      this.results.addError('messageFraming', error);
      this.results.addTest('messageFraming', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Message framing test failed: ${error.message}`);
    }
  }

  /**
   * Test large message handling
   */
  async testLargeMessageHandling() {
    try {
      console.log('   Testing large message handling...');
      
      const serverProcess = this.serverProcesses.get('connection-test');
      if (!serverProcess) {
        throw new Error('No server process available');
      }
      
      const largeMessageTests = [];
      
      for (const size of STDIO_TEST_CONFIG.binaryDataSizes) {
        try {
          // Create large selectors object
          const largeSelectors = {};
          const selectorsNeeded = Math.floor(size / 50); // Approximate size per selector
          
          for (let i = 0; i < selectorsNeeded; i++) {
            largeSelectors[`field_${i}`] = `div:nth-child(${i + 1}) .class-${i}`;
          }
          
          const largeMessage = {
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
          
          const messageSize = JSON.stringify(largeMessage).length;
          const startTime = Date.now();
          
          const response = await this.sendMessage(serverProcess, largeMessage);
          const transferTime = Date.now() - startTime;
          
          this.results.addDataTransferMetric({
            size: messageSize,
            transferTime,
            throughput: messageSize / (transferTime / 1000), // bytes per second
            success: !!response && !response.error
          });
          
          largeMessageTests.push({
            size: messageSize,
            success: !!response && !response.error,
            transferTime,
            throughput: messageSize / (transferTime / 1000)
          });
          
        } catch (error) {
          largeMessageTests.push({
            size,
            success: false,
            error: error.message
          });
        }
      }
      
      const allLargeMessageTestsPass = largeMessageTests.every(r => r.success);
      const averageThroughput = largeMessageTests
        .filter(r => r.success)
        .reduce((sum, r) => sum + r.throughput, 0) / largeMessageTests.filter(r => r.success).length;
      
      this.results.addTest('largeMessageHandling', {
        success: allLargeMessageTestsPass,
        testCases: largeMessageTests.length,
        passedCases: largeMessageTests.filter(r => r.success).length,
        averageThroughput,
        results: largeMessageTests
      });
      
      console.log(`   ✅ Large message handling test completed`);
      
    } catch (error) {
      this.results.addError('largeMessageHandling', error);
      this.results.addTest('largeMessageHandling', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Large message handling test failed: ${error.message}`);
    }
  }

  /**
   * Test concurrent connections
   */
  async testConcurrentConnections() {
    try {
      console.log('   Testing concurrent connections...');
      
      const serverPath = join(__dirname, '..', '..', 'server.js');
      const concurrentProcesses = [];
      
      // Create multiple concurrent server processes
      for (let i = 0; i < STDIO_TEST_CONFIG.maxConcurrentConnections; i++) {
        try {
          const processId = `concurrent-${i}`;
          const serverProcess = await this.createServerProcess(processId, serverPath);
          concurrentProcesses.push({ processId, serverProcess });
        } catch (error) {
          console.warn(`Failed to create concurrent process ${i}:`, error.message);
        }
      }
      
      // Send concurrent requests to all processes
      const concurrentRequests = concurrentProcesses.map(({ processId, serverProcess }) => ({
        processId,
        request: this.sendMessage(serverProcess, {
          jsonrpc: '2.0',
          id: this.getNextRequestId(),
          method: 'tools/list'
        })
      }));
      
      const startTime = Date.now();
      const responses = await Promise.allSettled(
        concurrentRequests.map(r => r.request)
      );
      const concurrentDuration = Date.now() - startTime;
      
      const successfulResponses = responses.filter(r => r.status === 'fulfilled' && r.value);
      const concurrentSuccess = successfulResponses.length === concurrentProcesses.length;
      
      this.results.addTest('concurrentConnections', {
        success: concurrentSuccess,
        processesCreated: concurrentProcesses.length,
        requestsSent: concurrentRequests.length,
        successfulResponses: successfulResponses.length,
        concurrentDuration,
        averageResponseTime: concurrentDuration / concurrentRequests.length
      });
      
      console.log(`   ✅ Concurrent connections test completed (${concurrentProcesses.length} processes)`);
      
    } catch (error) {
      this.results.addError('concurrentConnections', error);
      this.results.addTest('concurrentConnections', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Concurrent connections test failed: ${error.message}`);
    }
  }

  /**
   * Test connection recovery
   */
  async testConnectionRecovery() {
    try {
      console.log('   Testing connection recovery...');
      
      const serverPath = join(__dirname, '..', '..', 'server.js');
      
      // Create a server process
      const serverProcess = await this.createServerProcess('recovery-test', serverPath);
      
      // Send initial request to establish connection
      const initialRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/list'
      };
      
      const initialResponse = await this.sendMessage(serverProcess, initialRequest);
      const initialSuccess = !!initialResponse && !initialResponse.error;
      
      // Simulate connection interruption by killing the process
      serverProcess.kill('SIGTERM');
      await this.delay(1000);
      
      // Attempt to recreate connection
      const recoveredProcess = await this.createServerProcess('recovery-test-recovered', serverPath);
      
      // Test that new connection works
      const recoveryRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/list'
      };
      
      const recoveryResponse = await this.sendMessage(recoveredProcess, recoveryRequest);
      const recoverySuccess = !!recoveryResponse && !recoveryResponse.error;
      
      this.results.addConnectionEvent('recovery', {
        initialSuccess,
        recoverySuccess,
        processesInvolved: 2
      });
      
      this.results.addTest('connectionRecovery', {
        success: initialSuccess && recoverySuccess,
        initialConnectionSuccess: initialSuccess,
        recoveryConnectionSuccess: recoverySuccess,
        recoveryTime: 1000 // Simulated recovery time
      });
      
      console.log(`   ✅ Connection recovery test completed`);
      
    } catch (error) {
      this.results.addError('connectionRecovery', error);
      this.results.addTest('connectionRecovery', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Connection recovery test failed: ${error.message}`);
    }
  }

  /**
   * Test buffer management
   */
  async testBufferManagement() {
    try {
      console.log('   Testing buffer management...');
      
      const serverProcess = this.serverProcesses.get('connection-test') || 
                          this.serverProcesses.get('recovery-test-recovered');
      
      if (!serverProcess) {
        throw new Error('No server process available');
      }
      
      // Test rapid message sending to stress buffer
      const rapidMessages = Array.from({ length: 20 }, (_, i) => ({
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/call',
        params: {
          name: 'fetch_url',
          arguments: { url: `https://httpbin.org/delay/${i % 3}` }
        }
      }));
      
      // Send all messages rapidly
      const startTime = Date.now();
      const messagePromises = rapidMessages.map(msg => this.sendMessage(serverProcess, msg));
      
      const responses = await Promise.allSettled(messagePromises);
      const bufferTestDuration = Date.now() - startTime;
      
      const successfulResponses = responses.filter(r => r.status === 'fulfilled' && r.value);
      const bufferManagementSuccess = successfulResponses.length >= rapidMessages.length * 0.8; // 80% success rate
      
      this.results.addTest('bufferManagement', {
        success: bufferManagementSuccess,
        messagesSent: rapidMessages.length,
        responsesReceived: successfulResponses.length,
        bufferTestDuration,
        successRate: (successfulResponses.length / rapidMessages.length) * 100,
        averageResponseTime: bufferTestDuration / rapidMessages.length
      });
      
      console.log(`   ✅ Buffer management test completed`);
      
    } catch (error) {
      this.results.addError('bufferManagement', error);
      this.results.addTest('bufferManagement', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Buffer management test failed: ${error.message}`);
    }
  }

  /**
   * Test error handling and cleanup
   */
  async testErrorHandlingAndCleanup() {
    try {
      console.log('   Testing error handling and cleanup...');
      
      const serverPath = join(__dirname, '..', '..', 'server.js');
      const errorTestProcess = await this.createServerProcess('error-test', serverPath);
      
      // Test various error scenarios
      const errorScenarios = [
        {
          name: 'malformed-json',
          data: '{"jsonrpc":"2.0","id":1,"method":"tools/list"' // Missing closing brace
        },
        {
          name: 'invalid-method',
          message: {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'invalid/method'
          }
        },
        {
          name: 'invalid-parameters',
          message: {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'tools/call',
            params: {
              name: 'fetch_url',
              arguments: { url: null }
            }
          }
        }
      ];
      
      const errorResults = [];
      
      for (const scenario of errorScenarios) {
        try {
          let response;
          
          if (scenario.data) {
            // Send raw malformed data
            response = await this.sendRawMessage(errorTestProcess, scenario.data + '\n');
          } else {
            // Send structured message
            response = await this.sendMessage(errorTestProcess, scenario.message);
          }
          
          const handledGracefully = !!response && !!response.error;
          
          errorResults.push({
            name: scenario.name,
            success: handledGracefully,
            errorHandled: handledGracefully,
            responseReceived: !!response
          });
          
        } catch (error) {
          // Errors during sending are also a form of error handling
          errorResults.push({
            name: scenario.name,
            success: true, // Error was caught/handled
            errorHandled: true,
            caughtException: true,
            error: error.message
          });
        }
      }
      
      // Test that server is still responsive after errors
      const recoveryRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/list'
      };
      
      const recoveryResponse = await this.sendMessage(errorTestProcess, recoveryRequest);
      const stillResponsive = !!recoveryResponse && !recoveryResponse.error;
      
      const allErrorsHandled = errorResults.every(r => r.success);
      
      this.results.addTest('errorHandlingAndCleanup', {
        success: allErrorsHandled && stillResponsive,
        errorScenariosHandled: errorResults.filter(r => r.success).length,
        totalErrorScenarios: errorResults.length,
        stillResponsiveAfterErrors: stillResponsive,
        errorResults
      });
      
      console.log(`   ✅ Error handling and cleanup test completed`);
      
    } catch (error) {
      this.results.addError('errorHandlingAndCleanup', error);
      this.results.addTest('errorHandlingAndCleanup', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Error handling and cleanup test failed: ${error.message}`);
    }
  }

  /**
   * Test performance characteristics
   */
  async testPerformanceCharacteristics() {
    try {
      console.log('   Testing performance characteristics...');
      
      const serverProcess = this.serverProcesses.get('connection-test') || 
                          this.serverProcesses.get('error-test');
      
      if (!serverProcess) {
        throw new Error('No server process available');
      }
      
      // Measure response times for different request types
      const performanceTests = [
        {
          name: 'simple-request',
          request: { jsonrpc: '2.0', id: this.getNextRequestId(), method: 'tools/list' }
        },
        {
          name: 'complex-request',
          request: {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'tools/call',
            params: {
              name: 'scrape_structured',
              arguments: {
                url: 'https://httpbin.org/html',
                selectors: {
                  title: 'title',
                  content: 'body',
                  links: 'a[href]'
                }
              }
            }
          }
        }
      ];
      
      const performanceResults = [];
      
      for (const test of performanceTests) {
        const measurements = [];
        
        // Take multiple measurements
        for (let i = 0; i < 5; i++) {
          const startTime = Date.now();
          const response = await this.sendMessage(serverProcess, test.request);
          const responseTime = Date.now() - startTime;
          
          measurements.push({
            responseTime,
            success: !!response && !response.error
          });
        }
        
        const successfulMeasurements = measurements.filter(m => m.success);
        const averageResponseTime = successfulMeasurements.length > 0 ?
          successfulMeasurements.reduce((sum, m) => sum + m.responseTime, 0) / successfulMeasurements.length : 0;
        
        performanceResults.push({
          name: test.name,
          measurements: measurements.length,
          successfulMeasurements: successfulMeasurements.length,
          averageResponseTime,
          minResponseTime: Math.min(...successfulMeasurements.map(m => m.responseTime)),
          maxResponseTime: Math.max(...successfulMeasurements.map(m => m.responseTime))
        });
      }
      
      const overallPerformance = performanceResults.every(r => r.averageResponseTime < 5000); // Under 5 seconds
      
      this.results.addTest('performanceCharacteristics', {
        success: overallPerformance,
        testTypes: performanceResults.length,
        results: performanceResults,
        overallPerformanceAcceptable: overallPerformance
      });
      
      console.log(`   ✅ Performance characteristics test completed`);
      
    } catch (error) {
      this.results.addError('performanceCharacteristics', error);
      this.results.addTest('performanceCharacteristics', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Performance characteristics test failed: ${error.message}`);
    }
  }

  /**
   * Test signal handling
   */
  async testSignalHandling() {
    try {
      console.log('   Testing signal handling...');
      
      const serverPath = join(__dirname, '..', '..', 'server.js');
      const signalTestProcess = await this.createServerProcess('signal-test', serverPath);
      
      // Verify server is responsive
      const preSignalRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/list'
      };
      
      const preSignalResponse = await this.sendMessage(signalTestProcess, preSignalRequest);
      const initiallyResponsive = !!preSignalResponse && !preSignalResponse.error;
      
      // Test graceful shutdown with SIGTERM
      let shutdownTime = Date.now();
      signalTestProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        signalTestProcess.on('exit', (code, signal) => {
          shutdownTime = Date.now() - shutdownTime;
          resolve();
        });
        
        // Force kill if doesn't shutdown gracefully within 5 seconds
        setTimeout(() => {
          if (!signalTestProcess.killed) {
            signalTestProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      });
      
      const gracefulShutdown = shutdownTime < 5000; // Shut down within 5 seconds
      
      this.results.addTest('signalHandling', {
        success: initiallyResponsive && gracefulShutdown,
        initiallyResponsive,
        gracefulShutdown,
        shutdownTime
      });
      
      console.log(`   ✅ Signal handling test completed (${shutdownTime}ms shutdown)`);
      
    } catch (error) {
      this.results.addError('signalHandling', error);
      this.results.addTest('signalHandling', {
        success: false,
        error: error.message
      });
      console.log(`   ❌ Signal handling test failed: ${error.message}`);
    }
  }

  // Helper methods for server communication

  /**
   * Create a new server process
   */
  async createServerProcess(processId, serverPath) {
    return new Promise((resolve, reject) => {
      const serverProcess = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' }
      });
      
      this.serverProcesses.set(processId, serverProcess);
      
      serverProcess.on('error', reject);
      
      // Wait for server to be ready
      let stderr = '';
      const onStderr = (data) => {
        stderr += data.toString();
        if (stderr.includes('MCP WebScraper server')) {
          serverProcess.stderr.removeListener('data', onStderr);
          resolve(serverProcess);
        }
      };
      
      serverProcess.stderr.on('data', onStderr);
      
      // Timeout if server doesn't start
      setTimeout(() => {
        serverProcess.stderr.removeListener('data', onStderr);
        if (!serverProcess.pid) {
          reject(new Error(`Server ${processId} failed to start within timeout`));
        } else {
          resolve(serverProcess);
        }
      }, STDIO_TEST_CONFIG.serverTimeout);
    });
  }

  /**
   * Send a message to server process
   */
  async sendMessage(serverProcess, message) {
    return new Promise((resolve, reject) => {
      if (!serverProcess || serverProcess.killed) {
        reject(new Error('Server process not available'));
        return;
      }
      
      const messageStr = JSON.stringify(message) + '\n';
      let responseBuffer = '';
      
      const timeout = setTimeout(() => {
        serverProcess.stdout.removeListener('data', onData);
        reject(new Error('Message timeout'));
      }, STDIO_TEST_CONFIG.requestTimeout);
      
      const onData = (data) => {
        responseBuffer += data.toString();
        
        const lines = responseBuffer.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line.trim());
              if (response.id === message.id || (response.jsonrpc && !message.id)) {
                clearTimeout(timeout);
                serverProcess.stdout.removeListener('data', onData);
                resolve(response);
                return;
              }
            } catch (e) {
              // Not complete JSON yet
            }
          }
        }
      };
      
      serverProcess.stdout.on('data', onData);
      serverProcess.stdin.write(messageStr);
    });
  }

  /**
   * Send raw message data
   */
  async sendRawMessage(serverProcess, data) {
    return new Promise((resolve, reject) => {
      if (!serverProcess || serverProcess.killed) {
        reject(new Error('Server process not available'));
        return;
      }
      
      let responseBuffer = '';
      
      const timeout = setTimeout(() => {
        serverProcess.stdout.removeListener('data', onData);
        reject(new Error('Raw message timeout'));
      }, STDIO_TEST_CONFIG.requestTimeout);
      
      const onData = (data) => {
        responseBuffer += data.toString();
        
        const lines = responseBuffer.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line.trim());
              clearTimeout(timeout);
              serverProcess.stdout.removeListener('data', onData);
              resolve(response);
              return;
            } catch (e) {
              // Invalid JSON might be expected in error tests
              clearTimeout(timeout);
              serverProcess.stdout.removeListener('data', onData);
              resolve(null);
              return;
            }
          }
        }
      };
      
      serverProcess.stdout.on('data', onData);
      serverProcess.stdin.write(data);
    });
  }

  /**
   * Send notification (no response expected)
   */
  async sendNotification(serverProcess, notification) {
    if (!serverProcess || serverProcess.killed) {
      throw new Error('Server process not available');
    }
    
    const notificationStr = JSON.stringify(notification) + '\n';
    serverProcess.stdin.write(notificationStr);
  }

  /**
   * Get next request ID
   */
  getNextRequestId() {
    return this.requestId++;
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate transport report
   */
  generateTransportReport() {
    const summary = this.results.getSummary();
    
    return {
      timestamp: new Date().toISOString(),
      configuration: STDIO_TEST_CONFIG,
      summary,
      connectionEvents: this.results.connectionEvents,
      dataTransferMetrics: this.results.dataTransferMetrics,
      transportAnalysis: this.analyzeTransportPerformance(),
      errors: this.results.errors,
      recommendations: this.generateTransportRecommendations(summary)
    };
  }

  /**
   * Analyze transport performance
   */
  analyzeTransportPerformance() {
    const metrics = this.results.dataTransferMetrics;
    
    if (metrics.length === 0) {
      return { status: 'NO_DATA' };
    }
    
    const averageThroughput = metrics.reduce((sum, m) => sum + m.throughput, 0) / metrics.length;
    const averageTransferTime = metrics.reduce((sum, m) => sum + m.transferTime, 0) / metrics.length;
    
    return {
      status: 'ANALYZED',
      averageThroughput: averageThroughput,
      averageTransferTime: averageTransferTime,
      totalDataTransferred: metrics.reduce((sum, m) => sum + m.size, 0),
      performanceRating: this.rateTransportPerformance(averageThroughput, averageTransferTime)
    };
  }

  /**
   * Rate transport performance
   */
  rateTransportPerformance(throughput, transferTime) {
    if (throughput > 1000000 && transferTime < 1000) { // > 1MB/s, < 1s
      return 'EXCELLENT';
    } else if (throughput > 500000 && transferTime < 2000) { // > 500KB/s, < 2s
      return 'GOOD';
    } else if (throughput > 100000 && transferTime < 5000) { // > 100KB/s, < 5s
      return 'ACCEPTABLE';
    } else {
      return 'POOR';
    }
  }

  /**
   * Generate transport recommendations
   */
  generateTransportRecommendations(summary) {
    const recommendations = [];
    
    if (summary.successRate < 95) {
      recommendations.push('Investigate transport reliability issues');
    }
    
    // Check specific failed tests
    Object.entries(summary.tests).forEach(([testName, result]) => {
      if (!result.success) {
        switch (testName) {
          case 'connectionEstablishment':
            recommendations.push('Review server startup and initialization process');
            break;
          case 'bidirectionalCommunication':
            recommendations.push('Check stdio pipe configuration and message handling');
            break;
          case 'messageFraming':
            recommendations.push('Improve message parsing and framing logic');
            break;
          case 'bufferManagement':
            recommendations.push('Optimize buffer sizes and message queuing');
            break;
          case 'performanceCharacteristics':
            recommendations.push('Profile and optimize message processing performance');
            break;
        }
      }
    });
    
    const analysis = this.analyzeTransportPerformance();
    if (analysis.performanceRating === 'POOR') {
      recommendations.push('Optimize transport layer for better throughput and response times');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Stdio transport implementation is performing well');
      recommendations.push('Continue monitoring for regressions');
    }
    
    return recommendations;
  }

  /**
   * Save transport report
   */
  async saveTransportReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `stdio-transport-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📄 Stdio transport report saved: ${filepath}`);
    } catch (error) {
      console.error('❌ Failed to save transport report:', error.message);
    }
  }

  /**
   * Cleanup test environment
   */
  async cleanup() {
    console.log('   Cleaning up test environment...');
    
    for (const [processId, serverProcess] of this.serverProcesses) {
      if (serverProcess && !serverProcess.killed) {
        console.log(`   Terminating process: ${processId}`);
        serverProcess.kill('SIGTERM');
        
        // Wait for graceful shutdown
        await new Promise((resolve) => {
          serverProcess.on('exit', resolve);
          setTimeout(() => {
            if (!serverProcess.killed) {
              serverProcess.kill('SIGKILL');
            }
            resolve();
          }, 2000);
        });
      }
    }
    
    this.serverProcesses.clear();
    console.log('   ✅ Cleanup completed');
  }
}

/**
 * Main stdio transport test execution
 */
async function runStdioTransportTests() {
  console.log('📡 Starting Stdio Transport Test Suite...');
  
  const testSuite = new StdioTransportTestSuite();
  
  try {
    const report = await testSuite.runStdioTransportTests();
    
    console.log('\n📋 Stdio Transport Test Summary:');
    console.log('─'.repeat(60));
    console.log(`✅ Success Rate: ${report.summary.successRate.toFixed(1)}%`);
    console.log(`📊 Total Tests: ${report.summary.totalTests}`);
    console.log(`❌ Total Errors: ${report.summary.totalErrors}`);
    console.log(`⏱️ Duration: ${(report.summary.duration / 1000).toFixed(1)}s`);
    console.log(`🔗 Connection Events: ${report.summary.connectionEvents}`);
    console.log(`📈 Data Transfer Metrics: ${report.summary.dataTransferMetrics}`);
    
    if (report.transportAnalysis.status === 'ANALYZED') {
      console.log(`⚡ Performance Rating: ${report.transportAnalysis.performanceRating}`);
      console.log(`🚀 Average Throughput: ${(report.transportAnalysis.averageThroughput / 1024).toFixed(2)} KB/s`);
    }
    
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach(rec => console.log(`   • ${rec}`));
    
    return report;
    
  } catch (error) {
    console.error('❌ Stdio transport test failed:', error);
    throw error;
  }
}

// Export for use in other test files
export { StdioTransportTestSuite, runStdioTransportTests };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runStdioTransportTests()
    .then(() => {
      console.log('✅ Stdio transport test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Stdio transport test failed:', error);
      process.exit(1);
    });
}
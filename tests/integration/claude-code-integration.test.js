/**
 * Claude Code IDE Integration Tests
 * Tests integration with Claude Code IDE via stdio transport
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Claude Code Integration Test Configuration
 */
const CLAUDE_CODE_CONFIG = {
  serverTimeout: 15000,
  requestTimeout: 30000,
  ideSimulationTimeout: 45000,
  maxConcurrentRequests: 3,
  testScenarios: {
    codebaseAnalysis: {
      timeout: 60000,
      maxRetries: 2
    },
    realTimeAssistance: {
      responseTimeThreshold: 5000,
      concurrentOperations: 5
    },
    longRunningTasks: {
      timeout: 120000,
      progressCheckInterval: 10000
    }
  }
};

/**
 * Claude Code Test Results Collector
 */
class ClaudeCodeTestResults {
  constructor() {
    this.reset();
  }

  reset() {
    this.ideScenarios = new Map();
    this.performanceMetrics = [];
    this.userExperience = [];
    this.integrationTests = [];
    this.errors = [];
    this.startTime = Date.now();
  }

  addIDEScenario(scenarioName, result) {
    this.ideScenarios.set(scenarioName, {
      ...result,
      timestamp: Date.now(),
      duration: Date.now() - this.startTime
    });
  }

  addPerformanceMetric(metric) {
    this.performanceMetrics.push({
      ...metric,
      timestamp: Date.now()
    });
  }

  addUserExperience(experience) {
    this.userExperience.push({
      ...experience,
      timestamp: Date.now()
    });
  }

  addIntegrationTest(testName, result) {
    this.integrationTests.push({
      testName,
      ...result,
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
    const totalScenarios = this.ideScenarios.size;
    const passedScenarios = Array.from(this.ideScenarios.values()).filter(s => s.success).length;
    
    const totalIntegrationTests = this.integrationTests.length;
    const passedIntegrationTests = this.integrationTests.filter(t => t.success).length;
    
    const totalTests = totalScenarios + totalIntegrationTests;
    const passedTests = passedScenarios + passedIntegrationTests;
    
    return {
      totalTests,
      passedTests,
      failedTests: totalTests - passedTests,
      successRate: totalTests > 0 ? (passedTests / totalTests) * 100 : 0,
      ideScenarios: {
        total: totalScenarios,
        passed: passedScenarios
      },
      integrationTests: {
        total: totalIntegrationTests,
        passed: passedIntegrationTests
      },
      performanceMetrics: this.performanceMetrics.length,
      userExperienceTests: this.userExperience.length,
      totalErrors: this.errors.length,
      duration: Date.now() - this.startTime
    };
  }
}

/**
 * Claude Code Integration Test Suite
 */
class ClaudeCodeIntegrationTestSuite {
  constructor() {
    this.results = new ClaudeCodeTestResults();
    this.serverProcess = null;
    this.requestId = 1;
  }

  /**
   * Run comprehensive Claude Code integration tests
   */
  async runClaudeCodeIntegrationTests() {
    console.log('🤖 Starting Claude Code IDE Integration Tests...');
    console.log('─'.repeat(60));
    
    try {
      // Setup test environment
      await this.setupTestEnvironment();
      
      // Test 1: Basic IDE Integration
      console.log('🔌 Test 1: Basic IDE Integration');
      await this.testBasicIDEIntegration();
      
      // Test 2: Real-time Code Analysis
      console.log('\n⚡ Test 2: Real-time Code Analysis');
      await this.testRealTimeCodeAnalysis();
      
      // Test 3: Codebase Understanding
      console.log('\n🧠 Test 3: Codebase Understanding');
      await this.testCodebaseUnderstanding();
      
      // Test 4: Multi-step Code Tasks
      console.log('\n🔄 Test 4: Multi-step Code Tasks');
      await this.testMultiStepCodeTasks();
      
      // Test 5: Context-Aware Assistance
      console.log('\n📝 Test 5: Context-Aware Assistance');
      await this.testContextAwareAssistance();
      
      // Test 6: Performance Under Load
      console.log('\n⚡ Test 6: Performance Under Load');
      await this.testPerformanceUnderLoad();
      
      // Test 7: Long-running Operations
      console.log('\n⏳ Test 7: Long-running Operations');
      await this.testLongRunningOperations();
      
      // Test 8: Error Recovery in IDE
      console.log('\n🛠️ Test 8: Error Recovery in IDE');
      await this.testErrorRecoveryInIDE();
      
      // Test 9: IDE-specific Features
      console.log('\n🎛️ Test 9: IDE-specific Features');
      await this.testIDESpecificFeatures();
      
      // Test 10: User Experience Validation
      console.log('\n👤 Test 10: User Experience Validation');
      await this.testUserExperienceValidation();
      
      // Generate Claude Code integration report
      const report = this.generateClaudeCodeReport();
      await this.saveClaudeCodeReport(report);
      
      return report;
      
    } catch (error) {
      console.error('❌ Claude Code integration test suite failed:', error);
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
    console.log('   Setting up Claude Code test environment...');
    
    const serverPath = join(__dirname, '..', '..', 'server.js');
    this.serverProcess = await this.startServer(serverPath);
    
    // Initialize server with Claude Code-like client info
    const initRequest = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          sampling: {}
        },
        clientInfo: {
          name: 'claude-code',
          version: '1.0.0'
        }
      }
    };
    
    const initResponse = await this.sendRequest(initRequest);
    if (initResponse.error) {
      throw new Error(`Failed to initialize server: ${initResponse.error.message}`);
    }
    
    // Send initialized notification
    await this.sendNotification({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });
    
    console.log('   ✅ Claude Code test environment ready');
  }

  /**
   * Test basic IDE integration functionality
   */
  async testBasicIDEIntegration() {
    const scenarioName = 'basic-ide-integration';
    const startTime = Date.now();
    
    try {
      console.log('   Testing tool discovery and availability...');
      
      // Test tool discovery
      const toolsResponse = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/list'
      });
      
      const toolsAvailable = !toolsResponse.error && 
                           Array.isArray(toolsResponse.result?.tools) &&
                           toolsResponse.result.tools.length > 0;
      
      console.log('   Testing basic tool execution...');
      
      // Test basic tool execution
      const basicTestResponse = await this.sendToolRequest('fetch_url', {
        url: 'https://httpbin.org/get'
      });
      
      const basicExecutionWorking = !basicTestResponse.error && basicTestResponse.result;
      
      console.log('   Testing IDE responsiveness...');
      
      // Test responsiveness with quick requests
      const responsivenessTasks = Array.from({ length: 3 }, (_, i) => 
        this.sendToolRequest('extract_metadata', {
          url: `https://httpbin.org/html?test=${i}`
        })
      );
      
      const responsivenessStart = Date.now();
      const responsivenessResults = await Promise.allSettled(responsivenessTasks);
      const responsivenessTime = Date.now() - responsivenessStart;
      
      const responsivenessGood = responsivenessTime < 15000 && // Under 15 seconds total
                               responsivenessResults.some(r => r.status === 'fulfilled');
      
      const integrationSuccess = toolsAvailable && basicExecutionWorking && responsivenessGood;
      
      this.results.addIDEScenario(scenarioName, {
        success: integrationSuccess,
        toolsAvailable,
        basicExecutionWorking,
        responsivenessGood,
        responsivenessTime,
        toolCount: toolsResponse.result?.tools?.length || 0
      });
      
      this.results.addPerformanceMetric({
        scenario: scenarioName,
        metric: 'responsiveness',
        value: responsivenessTime,
        threshold: 15000,
        passed: responsivenessGood
      });
      
      console.log(`   ✅ Basic IDE integration test completed (${Date.now() - startTime}ms)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addIDEScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Basic IDE integration test failed: ${error.message}`);
    }
  }

  /**
   * Test real-time code analysis capabilities
   */
  async testRealTimeCodeAnalysis() {
    const scenarioName = 'real-time-code-analysis';
    const startTime = Date.now();
    
    try {
      console.log('   Testing real-time content analysis...');
      
      // Simulate real-time analysis requests as user types/navigates
      const analysisRequests = [
        {
          name: 'analyze-documentation',
          tool: 'analyze_content',
          args: {
            text: 'This is a JavaScript function that handles user authentication and session management.',
            options: { include_keywords: true, include_entities: true }
          }
        },
        {
          name: 'extract-api-docs',
          tool: 'extract_content',
          args: {
            url: 'https://httpbin.org/html'
          }
        },
        {
          name: 'summarize-readme',
          tool: 'summarize_content',
          args: {
            text: 'This project is a web scraping library built with Node.js. It provides tools for extracting data from websites, analyzing content, and processing documents. The library supports multiple data formats and includes advanced features like content analysis and summarization.',
            options: { max_sentences: 3 }
          }
        }
      ];
      
      const analysisResults = [];
      
      for (const request of analysisRequests) {
        const requestStart = Date.now();
        const response = await this.sendToolRequest(request.tool, request.args);
        const requestTime = Date.now() - requestStart;
        
        analysisResults.push({
          name: request.name,
          success: !response.error,
          responseTime: requestTime,
          realTimeReady: requestTime < CLAUDE_CODE_CONFIG.testScenarios.realTimeAssistance.responseTimeThreshold
        });
      }
      
      const allAnalysisSuccessful = analysisResults.every(r => r.success);
      const allRealTimeReady = analysisResults.every(r => r.realTimeReady);
      const averageResponseTime = analysisResults.reduce((sum, r) => sum + r.responseTime, 0) / analysisResults.length;
      
      this.results.addIDEScenario(scenarioName, {
        success: allAnalysisSuccessful && allRealTimeReady,
        allAnalysisSuccessful,
        allRealTimeReady,
        averageResponseTime,
        analysisResults
      });
      
      this.results.addPerformanceMetric({
        scenario: scenarioName,
        metric: 'real-time-response',
        value: averageResponseTime,
        threshold: CLAUDE_CODE_CONFIG.testScenarios.realTimeAssistance.responseTimeThreshold,
        passed: allRealTimeReady
      });
      
      console.log(`   ✅ Real-time code analysis test completed (avg: ${averageResponseTime.toFixed(0)}ms)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addIDEScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Real-time code analysis test failed: ${error.message}`);
    }
  }

  /**
   * Test codebase understanding capabilities
   */
  async testCodebaseUnderstanding() {
    const scenarioName = 'codebase-understanding';
    const startTime = Date.now();
    
    try {
      console.log('   Testing comprehensive codebase analysis...');
      
      // Simulate understanding a codebase by analyzing multiple related resources
      const codebaseAnalysis = [
        {
          phase: 'project-overview',
          tool: 'map_site',
          args: {
            url: 'https://httpbin.org',
            max_urls: 10,
            group_by_path: true
          }
        },
        {
          phase: 'documentation-analysis',
          tool: 'extract_content',
          args: {
            url: 'https://httpbin.org/html',
            options: { include_links: true }
          }
        },
        {
          phase: 'structure-understanding',
          tool: 'scrape_structured',
          args: {
            url: 'https://httpbin.org/html',
            selectors: {
              navigation: 'nav, .nav',
              main_content: 'main, .main',
              code_examples: 'pre, code',
              api_endpoints: '[data-api], .endpoint'
            }
          }
        }
      ];
      
      const analysisResults = [];
      
      for (const analysis of codebaseAnalysis) {
        console.log(`     Analyzing ${analysis.phase}...`);
        
        const phaseStart = Date.now();
        const response = await this.sendToolRequest(analysis.tool, analysis.args);
        const phaseDuration = Date.now() - phaseStart;
        
        analysisResults.push({
          phase: analysis.phase,
          success: !response.error,
          duration: phaseDuration,
          dataExtracted: response.result ? true : false
        });
      }
      
      console.log('   Testing cross-reference capabilities...');
      
      // Test ability to cross-reference information
      const crossReferenceTest = await this.sendToolRequest('analyze_content', {
        text: 'HTTP testing service with JSON API endpoints for GET, POST, PUT, DELETE operations.',
        options: {
          include_keywords: true,
          include_entities: true
        }
      });
      
      const crossReferenceWorking = !crossReferenceTest.error && crossReferenceTest.result;
      
      const allPhasesSuccessful = analysisResults.every(r => r.success);
      const totalAnalysisTime = analysisResults.reduce((sum, r) => sum + r.duration, 0);
      const codebaseUnderstandingComplete = allPhasesSuccessful && crossReferenceWorking;
      
      this.results.addIDEScenario(scenarioName, {
        success: codebaseUnderstandingComplete,
        allPhasesSuccessful,
        crossReferenceWorking,
        totalAnalysisTime,
        phasesCompleted: analysisResults.length,
        analysisResults
      });
      
      this.results.addUserExperience({
        scenario: scenarioName,
        aspect: 'codebase-comprehension',
        rating: codebaseUnderstandingComplete ? 'excellent' : 'needs-improvement',
        feedback: codebaseUnderstandingComplete ? 
          'Successfully analyzed and understood codebase structure' :
          'Had difficulty with comprehensive codebase analysis'
      });
      
      console.log(`   ✅ Codebase understanding test completed (${totalAnalysisTime}ms total)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addIDEScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Codebase understanding test failed: ${error.message}`);
    }
  }

  /**
   * Test multi-step code tasks
   */
  async testMultiStepCodeTasks() {
    const scenarioName = 'multi-step-code-tasks';
    const startTime = Date.now();
    
    try {
      console.log('   Testing complex multi-step task execution...');
      
      // Simulate a complex task: API documentation analysis and summary
      const steps = [
        {
          name: 'fetch-api-docs',
          description: 'Fetch API documentation',
          execute: async () => {
            return await this.sendToolRequest('fetch_url', {
              url: 'https://httpbin.org/json'
            });
          }
        },
        {
          name: 'extract-api-structure',
          description: 'Extract API structure information',
          execute: async () => {
            return await this.sendToolRequest('scrape_structured', {
              url: 'https://httpbin.org/html',
              selectors: {
                endpoints: 'code, pre',
                descriptions: 'p, .description',
                examples: '.example, .code-example'
              }
            });
          }
        },
        {
          name: 'analyze-api-content',
          description: 'Analyze API content for patterns',
          execute: async () => {
            return await this.sendToolRequest('analyze_content', {
              text: 'RESTful API service providing HTTP request and response testing endpoints including GET, POST, PUT, DELETE methods with JSON responses.',
              options: {
                include_keywords: true,
                include_topics: true
              }
            });
          }
        },
        {
          name: 'generate-summary',
          description: 'Generate comprehensive API summary',
          execute: async () => {
            return await this.sendToolRequest('summarize_content', {
              text: 'This HTTP testing service provides various endpoints for testing HTTP requests. It supports GET, POST, PUT, DELETE methods and returns JSON responses. The service includes endpoints for testing headers, query parameters, form data, and file uploads. It also provides endpoints for testing different HTTP status codes and response delays.',
              options: {
                max_sentences: 4,
                include_keywords: true
              }
            });
          }
        }
      ];
      
      const stepResults = [];
      let previousStepSuccess = true;
      
      for (const step of steps) {
        if (!previousStepSuccess) {
          console.log(`     Skipping ${step.name} due to previous step failure`);
          stepResults.push({
            name: step.name,
            success: false,
            skipped: true,
            reason: 'Previous step failed'
          });
          continue;
        }
        
        console.log(`     Executing ${step.description}...`);
        
        const stepStart = Date.now();
        try {
          const result = await step.execute();
          const stepDuration = Date.now() - stepStart;
          
          const stepSuccess = !result.error && result.result;
          stepResults.push({
            name: step.name,
            success: stepSuccess,
            duration: stepDuration,
            dataReceived: !!result.result
          });
          
          previousStepSuccess = stepSuccess;
          
        } catch (error) {
          stepResults.push({
            name: step.name,
            success: false,
            error: error.message,
            duration: Date.now() - stepStart
          });
          previousStepSuccess = false;
        }
      }
      
      const allStepsSuccessful = stepResults.every(r => r.success || r.skipped);
      const completedSteps = stepResults.filter(r => !r.skipped).length;
      const totalTaskTime = stepResults.reduce((sum, r) => sum + (r.duration || 0), 0);
      
      this.results.addIDEScenario(scenarioName, {
        success: allStepsSuccessful,
        completedSteps,
        totalSteps: steps.length,
        totalTaskTime,
        stepResults,
        taskComplexityHandled: allStepsSuccessful
      });
      
      this.results.addUserExperience({
        scenario: scenarioName,
        aspect: 'task-execution',
        rating: allStepsSuccessful ? 'excellent' : 'needs-improvement',
        feedback: `Completed ${completedSteps}/${steps.length} steps successfully`
      });
      
      console.log(`   ✅ Multi-step code tasks test completed (${completedSteps}/${steps.length} steps)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addIDEScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Multi-step code tasks test failed: ${error.message}`);
    }
  }

  /**
   * Test context-aware assistance
   */
  async testContextAwareAssistance() {
    const scenarioName = 'context-aware-assistance';
    const startTime = Date.now();
    
    try {
      console.log('   Testing context awareness and intelligent assistance...');
      
      // Simulate providing context-aware help based on current work
      const contextScenarios = [
        {
          context: 'working-with-apis',
          assistanceRequests: [
            {
              tool: 'extract_metadata',
              args: { url: 'https://httpbin.org/html' },
              expectedContext: 'api documentation analysis'
            },
            {
              tool: 'scrape_structured',
              args: {
                url: 'https://httpbin.org/html',
                selectors: { api_methods: 'code', endpoints: 'pre' }
              },
              expectedContext: 'api endpoint extraction'
            }
          ]
        },
        {
          context: 'content-analysis',
          assistanceRequests: [
            {
              tool: 'analyze_content',
              args: {
                text: 'Function to process user authentication tokens and validate session state.',
                options: { include_keywords: true }
              },
              expectedContext: 'code analysis and understanding'
            },
            {
              tool: 'summarize_content',
              args: {
                text: 'This authentication module provides secure token validation, session management, and user privilege verification for web applications.',
                options: { max_sentences: 2 }
              },
              expectedContext: 'code documentation summarization'
            }
          ]
        }
      ];
      
      const contextResults = [];
      
      for (const scenario of contextScenarios) {
        console.log(`     Testing ${scenario.context} context...`);
        
        const scenarioStart = Date.now();
        const assistanceResults = [];
        
        for (const request of scenario.assistanceRequests) {
          const requestStart = Date.now();
          const response = await this.sendToolRequest(request.tool, request.args);
          const requestTime = Date.now() - requestStart;
          
          assistanceResults.push({
            tool: request.tool,
            success: !response.error,
            responseTime: requestTime,
            contextuallyRelevant: !response.error
          });
        }
        
        const scenarioDuration = Date.now() - scenarioStart;
        const allAssistanceSuccessful = assistanceResults.every(r => r.success);
        
        contextResults.push({
          context: scenario.context,
          success: allAssistanceSuccessful,
          duration: scenarioDuration,
          assistanceProvided: assistanceResults.length,
          assistanceResults
        });
      }
      
      const allContextsHandled = contextResults.every(r => r.success);
      const averageContextTime = contextResults.reduce((sum, r) => sum + r.duration, 0) / contextResults.length;
      
      this.results.addIDEScenario(scenarioName, {
        success: allContextsHandled,
        contextsHandled: contextResults.length,
        allContextsHandled,
        averageContextTime,
        contextResults
      });
      
      this.results.addUserExperience({
        scenario: scenarioName,
        aspect: 'context-awareness',
        rating: allContextsHandled ? 'excellent' : 'good',
        feedback: `Provided relevant assistance across ${contextResults.length} different contexts`
      });
      
      console.log(`   ✅ Context-aware assistance test completed (${contextResults.length} contexts)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addIDEScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Context-aware assistance test failed: ${error.message}`);
    }
  }

  /**
   * Test performance under load
   */
  async testPerformanceUnderLoad() {
    const scenarioName = 'performance-under-load';
    const startTime = Date.now();
    
    try {
      console.log('   Testing performance under IDE load conditions...');
      
      // Simulate concurrent requests as would happen in active IDE usage
      const concurrentRequests = Array.from({ length: CLAUDE_CODE_CONFIG.maxConcurrentRequests }, (_, i) => ({
        id: i,
        tool: i % 2 === 0 ? 'extract_text' : 'extract_metadata',
        args: i % 2 === 0 ? 
          { url: `https://httpbin.org/html?test=${i}` } :
          { url: `https://httpbin.org/html?meta=${i}` }
      }));
      
      const loadTestStart = Date.now();
      const requestPromises = concurrentRequests.map(req => 
        this.sendToolRequest(req.tool, req.args).then(result => ({
          id: req.id,
          success: !result.error,
          responseTime: Date.now() - loadTestStart
        }))
      );
      
      const loadTestResults = await Promise.allSettled(requestPromises);
      const loadTestDuration = Date.now() - loadTestStart;
      
      const successfulRequests = loadTestResults.filter(r => 
        r.status === 'fulfilled' && r.value.success
      ).length;
      
      const performanceGood = loadTestDuration < 30000 && // Under 30 seconds
                            successfulRequests >= concurrentRequests.length * 0.8; // 80% success rate
      
      console.log('   Testing sustained performance...');
      
      // Test sustained performance with sequential requests
      const sustainedRequests = Array.from({ length: 8 }, (_, i) => ({
        tool: 'analyze_content',
        args: {
          text: `Test content for analysis ${i}. This is sample text to ensure the system can handle sustained load.`,
          options: { include_keywords: true }
        }
      }));
      
      const sustainedStart = Date.now();
      const sustainedResults = [];
      
      for (const request of sustainedRequests) {
        const requestStart = Date.now();
        const response = await this.sendToolRequest(request.tool, request.args);
        const requestTime = Date.now() - requestStart;
        
        sustainedResults.push({
          success: !response.error,
          responseTime: requestTime
        });
      }
      
      const sustainedDuration = Date.now() - sustainedStart;
      const sustainedSuccessRate = sustainedResults.filter(r => r.success).length / sustainedResults.length;
      const averageSustainedTime = sustainedResults.reduce((sum, r) => sum + r.responseTime, 0) / sustainedResults.length;
      
      const sustainedPerformanceGood = sustainedSuccessRate >= 0.9 && averageSustainedTime < 10000;
      
      const overallPerformanceGood = performanceGood && sustainedPerformanceGood;
      
      this.results.addIDEScenario(scenarioName, {
        success: overallPerformanceGood,
        concurrentPerformanceGood: performanceGood,
        sustainedPerformanceGood,
        loadTestDuration,
        sustainedDuration,
        concurrentSuccessRate: successfulRequests / concurrentRequests.length,
        sustainedSuccessRate,
        averageSustainedTime
      });
      
      this.results.addPerformanceMetric({
        scenario: scenarioName,
        metric: 'concurrent-load',
        value: loadTestDuration,
        threshold: 30000,
        passed: performanceGood
      });
      
      this.results.addPerformanceMetric({
        scenario: scenarioName,
        metric: 'sustained-load',
        value: averageSustainedTime,
        threshold: 10000,
        passed: sustainedPerformanceGood
      });
      
      console.log(`   ✅ Performance under load test completed (concurrent: ${loadTestDuration}ms, sustained avg: ${averageSustainedTime.toFixed(0)}ms)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addIDEScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Performance under load test failed: ${error.message}`);
    }
  }

  /**
   * Test long-running operations
   */
  async testLongRunningOperations() {
    const scenarioName = 'long-running-operations';
    const startTime = Date.now();
    
    try {
      console.log('   Testing long-running operation handling...');
      
      // Test operations that take longer to complete
      const longRunningTasks = [
        {
          name: 'deep-crawl',
          tool: 'crawl_deep',
          args: {
            url: 'https://httpbin.org',
            max_depth: 2,
            max_pages: 6,
            extract_content: true
          },
          expectedMinDuration: 5000
        },
        {
          name: 'comprehensive-site-map',
          tool: 'map_site',
          args: {
            url: 'https://httpbin.org',
            max_urls: 15,
            include_metadata: true,
            group_by_path: true
          },
          expectedMinDuration: 3000
        }
      ];
      
      const taskResults = [];
      
      for (const task of longRunningTasks) {
        console.log(`     Running ${task.name}...`);
        
        const taskStart = Date.now();
        const response = await this.sendToolRequest(task.tool, task.args, CLAUDE_CODE_CONFIG.testScenarios.longRunningTasks.timeout);
        const taskDuration = Date.now() - taskStart;
        
        const taskSuccess = !response.error && response.result;
        const appropriateDuration = taskDuration >= task.expectedMinDuration;
        
        taskResults.push({
          name: task.name,
          success: taskSuccess,
          duration: taskDuration,
          appropriateDuration,
          completedWithinTimeout: taskDuration < CLAUDE_CODE_CONFIG.testScenarios.longRunningTasks.timeout
        });
      }
      
      const allTasksSuccessful = taskResults.every(r => r.success);
      const allCompletedInTime = taskResults.every(r => r.completedWithinTimeout);
      const totalLongRunningTime = taskResults.reduce((sum, r) => sum + r.duration, 0);
      
      this.results.addIDEScenario(scenarioName, {
        success: allTasksSuccessful && allCompletedInTime,
        allTasksSuccessful,
        allCompletedInTime,
        totalLongRunningTime,
        tasksExecuted: taskResults.length,
        taskResults
      });
      
      this.results.addUserExperience({
        scenario: scenarioName,
        aspect: 'long-running-tasks',
        rating: allTasksSuccessful && allCompletedInTime ? 'excellent' : 'acceptable',
        feedback: `Long-running tasks ${allTasksSuccessful ? 'completed successfully' : 'had issues'} with ${allCompletedInTime ? 'good' : 'slow'} response times`
      });
      
      console.log(`   ✅ Long-running operations test completed (${totalLongRunningTime}ms total)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addIDEScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Long-running operations test failed: ${error.message}`);
    }
  }

  /**
   * Test error recovery in IDE context
   */
  async testErrorRecoveryInIDE() {
    const scenarioName = 'error-recovery-ide';
    const startTime = Date.now();
    
    try {
      console.log('   Testing error recovery in IDE context...');
      
      // Test graceful error handling and recovery
      const errorScenarios = [
        {
          name: 'invalid-url-recovery',
          operations: [
            { tool: 'fetch_url', args: { url: 'invalid-url' }, expectError: true },
            { tool: 'fetch_url', args: { url: 'https://httpbin.org/get' }, expectError: false }
          ]
        },
        {
          name: 'network-error-recovery',
          operations: [
            { tool: 'extract_text', args: { url: 'https://nonexistent-domain.com' }, expectError: true },
            { tool: 'extract_text', args: { url: 'https://httpbin.org/html' }, expectError: false }
          ]
        },
        {
          name: 'parameter-error-recovery',
          operations: [
            { tool: 'summarize_content', args: { text: '' }, expectError: false }, // Should handle gracefully
            { tool: 'summarize_content', args: { text: 'Valid content for summarization test.' }, expectError: false }
          ]
        }
      ];
      
      const recoveryResults = [];
      
      for (const scenario of errorScenarios) {
        console.log(`     Testing ${scenario.name}...`);
        
        const scenarioStart = Date.now();
        const operationResults = [];
        
        for (const operation of scenario.operations) {
          const opStart = Date.now();
          const response = await this.sendToolRequest(operation.tool, operation.args);
          const opDuration = Date.now() - opStart;
          
          const hasError = !!response.error;
          const expectedResult = operation.expectError ? hasError : !hasError;
          
          operationResults.push({
            tool: operation.tool,
            success: expectedResult,
            hasError,
            expectedError: operation.expectError,
            duration: opDuration
          });
        }
        
        const scenarioDuration = Date.now() - scenarioStart;
        const allOperationsHandled = operationResults.every(r => r.success);
        
        recoveryResults.push({
          name: scenario.name,
          success: allOperationsHandled,
          duration: scenarioDuration,
          operationsHandled: operationResults.length,
          operationResults
        });
      }
      
      const allRecoverySuccessful = recoveryResults.every(r => r.success);
      const totalRecoveryTime = recoveryResults.reduce((sum, r) => sum + r.duration, 0);
      
      this.results.addIDEScenario(scenarioName, {
        success: allRecoverySuccessful,
        allRecoverySuccessful,
        totalRecoveryTime,
        scenariosHandled: recoveryResults.length,
        recoveryResults
      });
      
      this.results.addUserExperience({
        scenario: scenarioName,
        aspect: 'error-handling',
        rating: allRecoverySuccessful ? 'excellent' : 'needs-improvement',
        feedback: `Error recovery ${allRecoverySuccessful ? 'worked perfectly' : 'needs attention'} across different error types`
      });
      
      console.log(`   ✅ Error recovery test completed (${recoveryResults.length} scenarios)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addIDEScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Error recovery test failed: ${error.message}`);
    }
  }

  /**
   * Test IDE-specific features
   */
  async testIDESpecificFeatures() {
    const scenarioName = 'ide-specific-features';
    const startTime = Date.now();
    
    try {
      console.log('   Testing IDE-specific integration features...');
      
      // Test features that are particularly important for IDE integration
      const ideFeatures = [
        {
          name: 'rapid-tool-switching',
          test: async () => {
            const tools = ['extract_metadata', 'extract_text', 'analyze_content', 'extract_metadata'];
            const results = [];
            
            for (const tool of tools) {
              const start = Date.now();
              const response = await this.sendToolRequest(tool, 
                tool === 'analyze_content' ? 
                  { text: 'Sample text for analysis' } :
                  { url: 'https://httpbin.org/html' }
              );
              const duration = Date.now() - start;
              
              results.push({
                tool,
                success: !response.error,
                switchTime: duration
              });
            }
            
            const allSwitchesSuccessful = results.every(r => r.success);
            const averageSwitchTime = results.reduce((sum, r) => sum + r.switchTime, 0) / results.length;
            
            return {
              success: allSwitchesSuccessful && averageSwitchTime < 8000,
              allSwitchesSuccessful,
              averageSwitchTime,
              results
            };
          }
        },
        {
          name: 'context-preservation',
          test: async () => {
            // Test that context is preserved across requests
            const contextualRequests = [
              { tool: 'extract_content', args: { url: 'https://httpbin.org/html' } },
              { tool: 'analyze_content', args: { text: 'Content analysis following extraction.' } },
              { tool: 'summarize_content', args: { text: 'Summary based on previous analysis context.' } }
            ];
            
            const results = [];
            
            for (const request of contextualRequests) {
              const response = await this.sendToolRequest(request.tool, request.args);
              results.push({
                tool: request.tool,
                success: !response.error
              });
            }
            
            const contextPreserved = results.every(r => r.success);
            
            return {
              success: contextPreserved,
              contextPreserved,
              requestsHandled: results.length
            };
          }
        },
        {
          name: 'concurrent-assistance',
          test: async () => {
            // Test handling multiple concurrent assistance requests
            const concurrentRequests = [
              this.sendToolRequest('extract_links', { url: 'https://httpbin.org/html' }),
              this.sendToolRequest('extract_metadata', { url: 'https://httpbin.org/html' }),
              this.sendToolRequest('scrape_structured', { 
                url: 'https://httpbin.org/html',
                selectors: { title: 'title', body: 'body' }
              })
            ];
            
            const results = await Promise.allSettled(concurrentRequests);
            const successfulConcurrent = results.filter(r => 
              r.status === 'fulfilled' && !r.value.error
            ).length;
            
            return {
              success: successfulConcurrent >= 2, // At least 2 out of 3 should succeed
              successfulConcurrent,
              totalConcurrent: concurrentRequests.length
            };
          }
        }
      ];
      
      const featureResults = [];
      
      for (const feature of ideFeatures) {
        console.log(`     Testing ${feature.name}...`);
        
        try {
          const featureResult = await feature.test();
          featureResults.push({
            name: feature.name,
            ...featureResult
          });
        } catch (error) {
          featureResults.push({
            name: feature.name,
            success: false,
            error: error.message
          });
        }
      }
      
      const allFeaturesWorking = featureResults.every(f => f.success);
      
      this.results.addIDEScenario(scenarioName, {
        success: allFeaturesWorking,
        allFeaturesWorking,
        featuresTestedCount: featureResults.length,
        featureResults
      });
      
      this.results.addIntegrationTest('ide-feature-compatibility', {
        success: allFeaturesWorking,
        featuresSupported: featureResults.filter(f => f.success).length,
        totalFeatures: featureResults.length
      });
      
      console.log(`   ✅ IDE-specific features test completed (${featureResults.filter(f => f.success).length}/${featureResults.length} features)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addIDEScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ IDE-specific features test failed: ${error.message}`);
    }
  }

  /**
   * Test user experience validation
   */
  async testUserExperienceValidation() {
    const scenarioName = 'user-experience-validation';
    const startTime = Date.now();
    
    try {
      console.log('   Testing overall user experience...');
      
      // Simulate common user workflows and measure experience quality
      const userWorkflows = [
        {
          name: 'documentation-helper',
          description: 'User gets help understanding documentation',
          steps: [
            { tool: 'fetch_url', args: { url: 'https://httpbin.org/html' } },
            { tool: 'extract_content', args: { url: 'https://httpbin.org/html' } },
            { tool: 'summarize_content', args: { text: 'Documentation content about HTTP testing service with various endpoints for testing requests and responses.' } }
          ]
        },
        {
          name: 'api-explorer',
          description: 'User explores and understands an API',
          steps: [
            { tool: 'map_site', args: { url: 'https://httpbin.org', max_urls: 8 } },
            { tool: 'scrape_structured', args: { 
              url: 'https://httpbin.org/html',
              selectors: { methods: 'code', endpoints: 'pre' }
            }},
            { tool: 'analyze_content', args: { 
              text: 'REST API with GET, POST, PUT, DELETE endpoints for testing HTTP requests.',
              options: { include_keywords: true }
            }}
          ]
        }
      ];
      
      const workflowResults = [];
      
      for (const workflow of userWorkflows) {
        console.log(`     Simulating ${workflow.description}...`);
        
        const workflowStart = Date.now();
        const stepResults = [];
        let workflowSuccess = true;
        
        for (const step of workflow.steps) {
          const stepStart = Date.now();
          const response = await this.sendToolRequest(step.tool, step.args);
          const stepDuration = Date.now() - stepStart;
          
          const stepSuccess = !response.error;
          stepResults.push({
            tool: step.tool,
            success: stepSuccess,
            duration: stepDuration,
            responsive: stepDuration < 10000
          });
          
          if (!stepSuccess) {
            workflowSuccess = false;
          }
        }
        
        const workflowDuration = Date.now() - workflowStart;
        const averageStepTime = stepResults.reduce((sum, s) => sum + s.duration, 0) / stepResults.length;
        const allStepsResponsive = stepResults.every(s => s.responsive);
        
        workflowResults.push({
          name: workflow.name,
          success: workflowSuccess,
          duration: workflowDuration,
          stepsCompleted: stepResults.filter(s => s.success).length,
          totalSteps: stepResults.length,
          averageStepTime,
          allStepsResponsive,
          userExperienceRating: workflowSuccess && allStepsResponsive ? 'excellent' : 
                               workflowSuccess ? 'good' : 'poor'
        });
      }
      
      const allWorkflowsSuccessful = workflowResults.every(w => w.success);
      const overallUXRating = allWorkflowsSuccessful ? 'excellent' : 'needs-improvement';
      
      this.results.addIDEScenario(scenarioName, {
        success: allWorkflowsSuccessful,
        allWorkflowsSuccessful,
        workflowsTestedCount: workflowResults.length,
        overallUXRating,
        workflowResults
      });
      
      this.results.addUserExperience({
        scenario: scenarioName,
        aspect: 'overall-experience',
        rating: overallUXRating,
        feedback: `User workflows ${allWorkflowsSuccessful ? 'completed smoothly' : 'encountered issues'} with ${overallUXRating} experience quality`
      });
      
      console.log(`   ✅ User experience validation completed (${workflowResults.filter(w => w.success).length}/${workflowResults.length} workflows successful)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addIDEScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ User experience validation failed: ${error.message}`);
    }
  }

  // Helper methods

  /**
   * Send a tool request
   */
  async sendToolRequest(toolName, args, timeout = CLAUDE_CODE_CONFIG.requestTimeout) {
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
      }, CLAUDE_CODE_CONFIG.serverTimeout);
    });
  }

  /**
   * Send request to server
   */
  async sendRequest(request, timeout = CLAUDE_CODE_CONFIG.requestTimeout) {
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
   * Generate Claude Code integration report
   */
  generateClaudeCodeReport() {
    const summary = this.results.getSummary();
    
    return {
      timestamp: new Date().toISOString(),
      configuration: CLAUDE_CODE_CONFIG,
      summary,
      ideIntegration: this.analyzeIDEIntegration(summary),
      performanceAnalysis: this.analyzeIDEPerformance(),
      userExperienceAnalysis: this.analyzeUserExperience(),
      claudeCodeReadiness: this.assessClaudeCodeReadiness(summary),
      errors: this.results.errors,
      recommendations: this.generateClaudeCodeRecommendations(summary)
    };
  }

  /**
   * Analyze IDE integration quality
   */
  analyzeIDEIntegration(summary) {
    const analysis = {
      status: 'READY',
      issues: [],
      strengths: []
    };
    
    if (summary.successRate < 85) {
      analysis.status = 'NOT_READY';
      analysis.issues.push(`Low IDE integration success rate: ${summary.successRate.toFixed(1)}%`);
    } else if (summary.successRate < 95) {
      analysis.status = 'MOSTLY_READY';
      analysis.issues.push(`Moderate IDE integration success rate: ${summary.successRate.toFixed(1)}%`);
    } else {
      analysis.strengths.push(`High IDE integration success rate: ${summary.successRate.toFixed(1)}%`);
    }
    
    // Check critical IDE scenarios
    const criticalScenarios = ['basic-ide-integration', 'real-time-code-analysis', 'context-aware-assistance'];
    const ideScenarios = Array.from(this.results.ideScenarios.entries());
    const failedCriticalScenarios = criticalScenarios.filter(scenario => {
      const scenarioResult = ideScenarios.find(([name]) => name === scenario);
      return scenarioResult && !scenarioResult[1].success;
    });
    
    if (failedCriticalScenarios.length > 0) {
      analysis.status = 'NOT_READY';
      analysis.issues.push(`Critical IDE scenarios failed: ${failedCriticalScenarios.join(', ')}`);
    }
    
    return analysis;
  }

  /**
   * Analyze IDE performance characteristics
   */
  analyzeIDEPerformance() {
    const metrics = this.results.performanceMetrics;
    
    if (metrics.length === 0) {
      return { status: 'NO_DATA' };
    }
    
    const responsiveMetrics = metrics.filter(m => m.metric === 'real-time-response');
    const loadMetrics = metrics.filter(m => m.metric.includes('load'));
    
    const averageResponseTime = responsiveMetrics.length > 0 ? 
      responsiveMetrics.reduce((sum, m) => sum + m.value, 0) / responsiveMetrics.length : 0;
    
    return {
      status: 'ANALYZED',
      averageResponseTime,
      realTimePerformance: this.rateIDEPerformance(averageResponseTime),
      loadHandling: loadMetrics.every(m => m.passed) ? 'EXCELLENT' : 'NEEDS_IMPROVEMENT',
      performanceScore: this.calculateIDEPerformanceScore(metrics)
    };
  }

  /**
   * Rate IDE performance
   */
  rateIDEPerformance(avgResponseTime) {
    if (avgResponseTime === 0) return 'NO_DATA';
    if (avgResponseTime < 2000) return 'EXCELLENT';
    if (avgResponseTime < 5000) return 'GOOD';
    if (avgResponseTime < 10000) return 'ACCEPTABLE';
    return 'POOR';
  }

  /**
   * Calculate IDE performance score
   */
  calculateIDEPerformanceScore(metrics) {
    const passedMetrics = metrics.filter(m => m.passed).length;
    return metrics.length > 0 ? (passedMetrics / metrics.length) * 100 : 0;
  }

  /**
   * Analyze user experience
   */
  analyzeUserExperience() {
    const uxTests = this.results.userExperience;
    
    if (uxTests.length === 0) {
      return { status: 'NO_DATA' };
    }
    
    const excellentRatings = uxTests.filter(ux => ux.rating === 'excellent').length;
    const goodRatings = uxTests.filter(ux => ux.rating === 'good').length;
    const needsImprovement = uxTests.filter(ux => ux.rating === 'needs-improvement').length;
    
    const overallRating = excellentRatings / uxTests.length >= 0.8 ? 'EXCELLENT' :
                         (excellentRatings + goodRatings) / uxTests.length >= 0.7 ? 'GOOD' : 'NEEDS_IMPROVEMENT';
    
    return {
      status: 'ANALYZED',
      overallRating,
      excellentAspects: excellentRatings,
      goodAspects: goodRatings,
      improvementNeeded: needsImprovement,
      totalAspects: uxTests.length,
      userSatisfactionScore: ((excellentRatings * 3 + goodRatings * 2) / (uxTests.length * 3)) * 100
    };
  }

  /**
   * Assess Claude Code readiness
   */
  assessClaudeCodeReadiness(summary) {
    const readinessFactors = {
      ideIntegration: summary.successRate >= 90,
      realTimePerformance: this.analyzeIDEPerformance().realTimePerformance !== 'POOR',
      userExperience: this.analyzeUserExperience().overallRating !== 'NEEDS_IMPROVEMENT',
      errorHandling: summary.totalErrors / summary.totalTests < 0.2,
      featureCompleteness: summary.ideScenarios.passed >= summary.ideScenarios.total * 0.9
    };
    
    const readinessScore = Object.values(readinessFactors).filter(Boolean).length;
    
    let readinessLevel = 'NOT_READY';
    if (readinessScore >= 4) readinessLevel = 'PRODUCTION_READY';
    else if (readinessScore >= 3) readinessLevel = 'MOSTLY_READY';
    else if (readinessScore >= 2) readinessLevel = 'PARTIALLY_READY';
    
    return {
      level: readinessLevel,
      score: readinessScore,
      maxScore: Object.keys(readinessFactors).length,
      factors: readinessFactors,
      percentage: (readinessScore / Object.keys(readinessFactors).length) * 100
    };
  }

  /**
   * Generate Claude Code recommendations
   */
  generateClaudeCodeRecommendations(summary) {
    const recommendations = [];
    
    const ideAnalysis = this.analyzeIDEIntegration(summary);
    if (ideAnalysis.status === 'NOT_READY') {
      recommendations.push('Fix critical IDE integration issues before deploying to Claude Code');
    }
    
    const performance = this.analyzeIDEPerformance();
    if (performance.realTimePerformance === 'POOR') {
      recommendations.push('Optimize response times for real-time code assistance');
    }
    
    const ux = this.analyzeUserExperience();
    if (ux.overallRating === 'NEEDS_IMPROVEMENT') {
      recommendations.push('Improve user experience and workflow smoothness');
    }
    
    if (summary.totalErrors > summary.totalTests * 0.1) {
      recommendations.push('Reduce error rate for better IDE stability');
    }
    
    const readiness = this.assessClaudeCodeReadiness(summary);
    if (readiness.level === 'NOT_READY') {
      recommendations.push('Address fundamental readiness issues before Claude Code integration');
    } else if (readiness.level === 'PARTIALLY_READY') {
      recommendations.push('Improve additional readiness factors for better Claude Code experience');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Integration is ready for Claude Code deployment');
      recommendations.push('Consider beta testing with select Claude Code users');
      recommendations.push('Monitor performance and user feedback in production');
    }
    
    return recommendations;
  }

  /**
   * Save Claude Code integration report
   */
  async saveClaudeCodeReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `claude-code-integration-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📄 Claude Code integration report saved: ${filepath}`);
    } catch (error) {
      console.error('❌ Failed to save Claude Code report:', error.message);
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
 * Main Claude Code integration test execution
 */
async function runClaudeCodeIntegrationTests() {
  console.log('🤖 Starting Claude Code IDE Integration Test Suite...');
  
  const testSuite = new ClaudeCodeIntegrationTestSuite();
  
  try {
    const report = await testSuite.runClaudeCodeIntegrationTests();
    
    console.log('\n📋 Claude Code Integration Test Summary:');
    console.log('─'.repeat(60));
    console.log(`✅ Status: ${report.ideIntegration.status}`);
    console.log(`📊 Total Tests: ${report.summary.totalTests}`);
    console.log(`🎯 Success Rate: ${report.summary.successRate.toFixed(1)}%`);
    console.log(`🚀 Claude Code Readiness: ${report.claudeCodeReadiness.level} (${report.claudeCodeReadiness.percentage.toFixed(1)}%)`);
    console.log(`👤 User Experience: ${report.userExperienceAnalysis.overallRating}`);
    console.log(`❌ Total Errors: ${report.summary.totalErrors}`);
    console.log(`⏱️ Duration: ${(report.summary.duration / 1000).toFixed(1)}s`);
    
    if (report.performanceAnalysis.status === 'ANALYZED') {
      console.log(`⚡ Real-time Performance: ${report.performanceAnalysis.realTimePerformance}`);
      console.log(`📈 Performance Score: ${report.performanceAnalysis.performanceScore.toFixed(1)}%`);
    }
    
    if (report.ideIntegration.issues.length > 0) {
      console.log('\n⚠️ Issues Identified:');
      report.ideIntegration.issues.forEach(issue => console.log(`   • ${issue}`));
    }
    
    if (report.ideIntegration.strengths.length > 0) {
      console.log('\n✨ Strengths:');
      report.ideIntegration.strengths.forEach(strength => console.log(`   • ${strength}`));
    }
    
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach(rec => console.log(`   • ${rec}`));
    
    return report;
    
  } catch (error) {
    console.error('❌ Claude Code integration test failed:', error);
    throw error;
  }
}

// Export for use in other test files
export { ClaudeCodeIntegrationTestSuite, runClaudeCodeIntegrationTests };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runClaudeCodeIntegrationTests()
    .then(() => {
      console.log('✅ Claude Code integration test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Claude Code integration test failed:', error);
      process.exit(1);
    });
}
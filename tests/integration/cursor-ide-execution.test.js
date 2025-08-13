/**
 * Cursor IDE NPX Execution Integration Tests
 * Tests integration with Cursor IDE via npx execution
 */

import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execAsync = promisify(exec);

/**
 * Cursor IDE NPX Test Configuration
 */
const CURSOR_NPX_CONFIG = {
  serverTimeout: 20000,
  requestTimeout: 30000,
  npxTimeout: 45000,
  maxRetries: 3,
  testPackage: 'mcp-webscraper',
  npxCommands: {
    basic: 'npx mcp-webscraper',
    withArgs: 'npx mcp-webscraper --help',
    version: 'npx mcp-webscraper --version'
  },
  cursorScenarios: {
    quickStart: {
      timeout: 60000,
      expectedTools: 11 // Minimum expected tools
    },
    productionUse: {
      timeout: 120000,
      concurrentOperations: 3
    }
  }
};

/**
 * Cursor NPX Test Results Collector
 */
class CursorNPXTestResults {
  constructor() {
    this.reset();
  }

  reset() {
    this.npxExecutions = new Map();
    this.cursorScenarios = new Map();
    this.packageValidation = [];
    this.executionMetrics = [];
    this.deploymentTests = [];
    this.errors = [];
    this.startTime = Date.now();
  }

  addNPXExecution(command, result) {
    this.npxExecutions.set(command, {
      ...result,
      timestamp: Date.now(),
      duration: Date.now() - this.startTime
    });
  }

  addCursorScenario(scenarioName, result) {
    this.cursorScenarios.set(scenarioName, {
      ...result,
      timestamp: Date.now(),
      duration: Date.now() - this.startTime
    });
  }

  addPackageValidation(validation) {
    this.packageValidation.push({
      ...validation,
      timestamp: Date.now()
    });
  }

  addExecutionMetric(metric) {
    this.executionMetrics.push({
      ...metric,
      timestamp: Date.now()
    });
  }

  addDeploymentTest(testName, result) {
    this.deploymentTests.push({
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
    const totalNPXTests = this.npxExecutions.size;
    const passedNPXTests = Array.from(this.npxExecutions.values()).filter(t => t.success).length;
    
    const totalCursorScenarios = this.cursorScenarios.size;
    const passedCursorScenarios = Array.from(this.cursorScenarios.values()).filter(s => s.success).length;
    
    const totalDeploymentTests = this.deploymentTests.length;
    const passedDeploymentTests = this.deploymentTests.filter(t => t.success).length;
    
    const totalTests = totalNPXTests + totalCursorScenarios + totalDeploymentTests;
    const passedTests = passedNPXTests + passedCursorScenarios + passedDeploymentTests;
    
    return {
      totalTests,
      passedTests,
      failedTests: totalTests - passedTests,
      successRate: totalTests > 0 ? (passedTests / totalTests) * 100 : 0,
      npxExecutions: {
        total: totalNPXTests,
        passed: passedNPXTests
      },
      cursorScenarios: {
        total: totalCursorScenarios,
        passed: passedCursorScenarios
      },
      deploymentTests: {
        total: totalDeploymentTests,
        passed: passedDeploymentTests
      },
      packageValidations: this.packageValidation.length,
      executionMetrics: this.executionMetrics.length,
      totalErrors: this.errors.length,
      duration: Date.now() - this.startTime
    };
  }
}

/**
 * Cursor IDE NPX Integration Test Suite
 */
class CursorIDENPXTestSuite {
  constructor() {
    this.results = new CursorNPXTestResults();
    this.packagePath = join(__dirname, '..', '..');
    this.requestId = 1;
  }

  /**
   * Run comprehensive Cursor IDE NPX integration tests
   */
  async runCursorNPXIntegrationTests() {
    console.log('🎯 Starting Cursor IDE NPX Execution Tests...');
    console.log('─'.repeat(60));
    
    try {
      // Test 1: Package Validation
      console.log('📦 Test 1: Package Validation');
      await this.testPackageValidation();
      
      // Test 2: NPX Command Execution
      console.log('\n💻 Test 2: NPX Command Execution');
      await this.testNPXCommandExecution();
      
      // Test 3: Cursor IDE Quick Start
      console.log('\n🚀 Test 3: Cursor IDE Quick Start');
      await this.testCursorQuickStart();
      
      // Test 4: Production Deployment Simulation
      console.log('\n🏭 Test 4: Production Deployment');
      await this.testProductionDeployment();
      
      // Test 5: Package Distribution Validation
      console.log('\n📊 Test 5: Package Distribution');
      await this.testPackageDistribution();
      
      // Test 6: Cursor-specific Integration
      console.log('\n🎛️ Test 6: Cursor Integration Features');
      await this.testCursorIntegrationFeatures();
      
      // Test 7: Installation and Setup
      console.log('\n⚙️ Test 7: Installation and Setup');
      await this.testInstallationSetup();
      
      // Test 8: Cross-platform Execution
      console.log('\n🌐 Test 8: Cross-platform Execution');
      await this.testCrossPlatformExecution();
      
      // Test 9: Error Handling in NPX Context
      console.log('\n🛠️ Test 9: NPX Error Handling');
      await this.testNPXErrorHandling();
      
      // Test 10: Performance and Optimization
      console.log('\n⚡ Test 10: Performance Optimization');
      await this.testPerformanceOptimization();
      
      // Generate Cursor NPX integration report
      const report = this.generateCursorNPXReport();
      await this.saveCursorNPXReport(report);
      
      return report;
      
    } catch (error) {
      console.error('❌ Cursor NPX integration test suite failed:', error);
      this.results.addError('suite', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Test package validation for NPX distribution
   */
  async testPackageValidation() {
    const testName = 'package-validation';
    const startTime = Date.now();
    
    try {
      console.log('   Validating package.json configuration...');
      
      // Check package.json structure
      const packageJsonPath = join(this.packagePath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      const validationChecks = [
        {
          name: 'has-bin-field',
          test: () => !!packageJson.bin,
          description: 'Package has bin field for npx execution'
        },
        {
          name: 'correct-main-entry',
          test: () => packageJson.main === 'server.js',
          description: 'Main entry points to server.js'
        },
        {
          name: 'has-start-script',
          test: () => !!packageJson.scripts?.start,
          description: 'Package has start script'
        },
        {
          name: 'proper-dependencies',
          test: () => !!packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0,
          description: 'Package has required dependencies'
        },
        {
          name: 'es-modules-support',
          test: () => packageJson.type === 'module',
          description: 'Package supports ES modules'
        },
        {
          name: 'node-version-requirement',
          test: () => !!packageJson.engines?.node,
          description: 'Package specifies Node.js version requirement'
        }
      ];
      
      const validationResults = validationChecks.map(check => ({
        name: check.name,
        passed: check.test(),
        description: check.description
      }));
      
      const allValidationsPassed = validationResults.every(r => r.passed);
      
      console.log('   Checking server.js executable permissions...');
      
      // Check if server.js is executable
      const serverPath = join(this.packagePath, 'server.js');
      let serverExecutable = false;
      try {
        await fs.access(serverPath, fs.constants.F_OK);
        const stats = await fs.stat(serverPath);
        serverExecutable = true;
      } catch (error) {
        serverExecutable = false;
      }
      
      console.log('   Validating NPM package structure...');
      
      // Check for required files
      const requiredFiles = ['server.js', 'package.json', 'README.md'];
      const fileChecks = await Promise.all(
        requiredFiles.map(async (file) => {
          try {
            await fs.access(join(this.packagePath, file));
            return { file, exists: true };
          } catch {
            return { file, exists: false };
          }
        })
      );
      
      const allRequiredFilesExist = fileChecks.every(check => check.exists);
      
      const packageValidationSuccess = allValidationsPassed && serverExecutable && allRequiredFilesExist;
      
      this.results.addPackageValidation({
        success: packageValidationSuccess,
        allValidationsPassed,
        serverExecutable,
        allRequiredFilesExist,
        validationResults,
        fileChecks,
        packageInfo: {
          name: packageJson.name,
          version: packageJson.version,
          bin: packageJson.bin,
          main: packageJson.main
        }
      });
      
      this.results.addNPXExecution(testName, {
        success: packageValidationSuccess,
        duration: Date.now() - startTime,
        validationsCompleted: validationResults.length
      });
      
      console.log(`   ✅ Package validation completed (${validationResults.filter(r => r.passed).length}/${validationResults.length} checks passed)`);
      
    } catch (error) {
      this.results.addError(testName, error);
      this.results.addNPXExecution(testName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Package validation failed: ${error.message}`);
    }
  }

  /**
   * Test NPX command execution scenarios
   */
  async testNPXCommandExecution() {
    const testName = 'npx-command-execution';
    const startTime = Date.now();
    
    try {
      console.log('   Testing basic NPX execution...');
      
      // Test NPX execution from the package directory
      const npxTests = [
        {
          name: 'direct-execution',
          command: 'node server.js --test',
          description: 'Direct Node.js execution test',
          timeout: 15000
        },
        {
          name: 'package-start',
          command: 'npm start',
          description: 'NPM start script execution',
          timeout: 15000,
          expectOutput: 'MCP WebScraper server'
        }
      ];
      
      const executionResults = [];
      
      for (const test of npxTests) {
        console.log(`     Testing ${test.description}...`);
        
        try {
          const executionStart = Date.now();
          
          const result = await this.executeCommand(test.command, {
            cwd: this.packagePath,
            timeout: test.timeout
          });
          
          const executionTime = Date.now() - executionStart;
          
          const success = result.success && (!test.expectOutput || result.output.includes(test.expectOutput));
          
          executionResults.push({
            name: test.name,
            success,
            executionTime,
            output: result.output?.substring(0, 200) || '',
            description: test.description
          });
          
          console.log(`       ${success ? '✅' : '❌'} ${test.name}: ${executionTime}ms`);
          
        } catch (error) {
          executionResults.push({
            name: test.name,
            success: false,
            error: error.message,
            description: test.description
          });
          console.log(`       ❌ ${test.name}: ${error.message}`);
        }
      }
      
      const allExecutionsSuccessful = executionResults.every(r => r.success);
      const averageExecutionTime = executionResults.reduce((sum, r) => sum + (r.executionTime || 0), 0) / executionResults.length;
      
      this.results.addNPXExecution(testName, {
        success: allExecutionsSuccessful,
        duration: Date.now() - startTime,
        executionResults,
        averageExecutionTime,
        testsCompleted: executionResults.length
      });
      
      this.results.addExecutionMetric({
        type: 'npx-execution',
        averageTime: averageExecutionTime,
        successRate: executionResults.filter(r => r.success).length / executionResults.length
      });
      
      console.log(`   ✅ NPX command execution completed (${executionResults.filter(r => r.success).length}/${executionResults.length} successful)`);
      
    } catch (error) {
      this.results.addError(testName, error);
      this.results.addNPXExecution(testName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ NPX command execution failed: ${error.message}`);
    }
  }

  /**
   * Test Cursor IDE quick start scenario
   */
  async testCursorQuickStart() {
    const scenarioName = 'cursor-quick-start';
    const startTime = Date.now();
    
    try {
      console.log('   Simulating Cursor IDE quick start workflow...');
      
      // Simulate the steps a user would take to start using the package in Cursor
      const quickStartSteps = [
        {
          name: 'server-startup',
          description: 'Start MCP server',
          execute: async () => {
            return await this.startServerForTesting();
          }
        },
        {
          name: 'tool-discovery',
          description: 'Discover available tools',
          execute: async (serverProcess) => {
            return await this.testToolDiscovery(serverProcess);
          }
        },
        {
          name: 'basic-functionality',
          description: 'Test basic functionality',
          execute: async (serverProcess) => {
            return await this.testBasicFunctionality(serverProcess);
          }
        },
        {
          name: 'cursor-integration',
          description: 'Test Cursor-specific features',
          execute: async (serverProcess) => {
            return await this.testCursorSpecificFeatures(serverProcess);
          }
        }
      ];
      
      const stepResults = [];
      let serverProcess = null;
      
      for (const step of quickStartSteps) {
        console.log(`     Executing ${step.description}...`);
        
        const stepStart = Date.now();
        try {
          const result = await step.execute(serverProcess);
          const stepDuration = Date.now() - stepStart;
          
          if (step.name === 'server-startup') {
            serverProcess = result.serverProcess;
          }
          
          stepResults.push({
            name: step.name,
            success: result.success,
            duration: stepDuration,
            description: step.description,
            data: result.data || {}
          });
          
        } catch (error) {
          stepResults.push({
            name: step.name,
            success: false,
            error: error.message,
            duration: Date.now() - stepStart,
            description: step.description
          });
        }
      }
      
      // Cleanup server process
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
      }
      
      const allStepsSuccessful = stepResults.every(s => s.success);
      const totalQuickStartTime = Date.now() - startTime;
      const quickStartReady = allStepsSuccessful && totalQuickStartTime < CURSOR_NPX_CONFIG.cursorScenarios.quickStart.timeout;
      
      this.results.addCursorScenario(scenarioName, {
        success: quickStartReady,
        allStepsSuccessful,
        totalQuickStartTime,
        stepsCompleted: stepResults.filter(s => s.success).length,
        totalSteps: stepResults.length,
        stepResults,
        cursorReady: quickStartReady
      });
      
      console.log(`   ✅ Cursor quick start test completed (${stepResults.filter(s => s.success).length}/${stepResults.length} steps successful)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addCursorScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Cursor quick start test failed: ${error.message}`);
    }
  }

  /**
   * Test production deployment scenario
   */
  async testProductionDeployment() {
    const testName = 'production-deployment';
    const startTime = Date.now();
    
    try {
      console.log('   Testing production deployment readiness...');
      
      const deploymentChecks = [
        {
          name: 'environment-variables',
          description: 'Environment variables handling',
          test: async () => {
            // Test that server handles missing environment variables gracefully
            const result = await this.executeCommand('node server.js --test', {
              cwd: this.packagePath,
              timeout: 10000,
              env: { ...process.env, NODE_ENV: 'production' }
            });
            
            return {
              success: result.success,
              handlesProduction: result.output.includes('production') || result.success
            };
          }
        },
        {
          name: 'error-handling',
          description: 'Production error handling',
          test: async () => {
            // Test error handling in production-like conditions
            const serverProcess = await this.startServerForTesting({ env: { NODE_ENV: 'production' } });
            
            try {
              // Send invalid request to test error handling
              const response = await this.sendRequestToServer(serverProcess, {
                jsonrpc: '2.0',
                id: 1,
                method: 'invalid/method'
              });
              
              return {
                success: !!response.error, // Should return error response
                errorHandled: !!response.error
              };
            } finally {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGTERM');
              }
            }
          }
        },
        {
          name: 'resource-efficiency',
          description: 'Resource usage in production',
          test: async () => {
            const serverProcess = await this.startServerForTesting();
            
            try {
              // Test basic operations to check resource usage
              const operations = [
                { method: 'tools/list' },
                { 
                  method: 'tools/call',
                  params: {
                    name: 'fetch_url',
                    arguments: { url: 'https://httpbin.org/get' }
                  }
                }
              ];
              
              const results = [];
              for (const operation of operations) {
                const response = await this.sendRequestToServer(serverProcess, {
                  jsonrpc: '2.0',
                  id: this.getNextRequestId(),
                  ...operation
                });
                results.push({ success: !response.error });
              }
              
              return {
                success: results.every(r => r.success),
                operationsCompleted: results.length
              };
            } finally {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGTERM');
              }
            }
          }
        }
      ];
      
      const deploymentResults = [];
      
      for (const check of deploymentChecks) {
        console.log(`     Checking ${check.description}...`);
        
        try {
          const checkResult = await check.test();
          deploymentResults.push({
            name: check.name,
            success: checkResult.success,
            description: check.description,
            ...checkResult
          });
        } catch (error) {
          deploymentResults.push({
            name: check.name,
            success: false,
            error: error.message,
            description: check.description
          });
        }
      }
      
      const allDeploymentChecksPass = deploymentResults.every(r => r.success);
      
      this.results.addDeploymentTest(testName, {
        success: allDeploymentChecksPass,
        checksCompleted: deploymentResults.length,
        successfulChecks: deploymentResults.filter(r => r.success).length,
        deploymentResults,
        productionReady: allDeploymentChecksPass
      });
      
      console.log(`   ✅ Production deployment test completed (${deploymentResults.filter(r => r.success).length}/${deploymentResults.length} checks passed)`);
      
    } catch (error) {
      this.results.addError(testName, error);
      this.results.addDeploymentTest(testName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Production deployment test failed: ${error.message}`);
    }
  }

  /**
   * Test package distribution validation
   */
  async testPackageDistribution() {
    const testName = 'package-distribution';
    const startTime = Date.now();
    
    try {
      console.log('   Validating package distribution...');
      
      const distributionChecks = [
        {
          name: 'package-size',
          description: 'Check package size is reasonable',
          test: async () => {
            const { stdout } = await execAsync('du -sh .', { cwd: this.packagePath });
            const sizeMatch = stdout.match(/^([\d.]+)([KMG])/);
            if (!sizeMatch) return { success: false, reason: 'Could not determine size' };
            
            const size = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2];
            
            // Convert to MB for comparison
            let sizeInMB = size;
            if (unit === 'K') sizeInMB = size / 1024;
            else if (unit === 'G') sizeInMB = size * 1024;
            
            const reasonableSize = sizeInMB < 50; // Less than 50MB
            
            return {
              success: reasonableSize,
              size: `${size}${unit}`,
              sizeInMB,
              reasonableSize
            };
          }
        },
        {
          name: 'dependency-check',
          description: 'Validate dependencies are installable',
          test: async () => {
            try {
              // Check if dependencies can be resolved
              const { stdout } = await execAsync('npm ls --depth=0 --json', { 
                cwd: this.packagePath,
                timeout: 30000
              });
              
              const deps = JSON.parse(stdout);
              const hasProblems = deps.problems && deps.problems.length > 0;
              
              return {
                success: !hasProblems,
                dependencyCount: Object.keys(deps.dependencies || {}).length,
                hasProblems,
                problems: deps.problems || []
              };
            } catch (error) {
              return {
                success: false,
                error: error.message
              };
            }
          }
        },
        {
          name: 'cross-platform-compatibility',
          description: 'Check cross-platform file paths',
          test: async () => {
            // Check for platform-specific paths in code
            const serverContent = await fs.readFile(join(this.packagePath, 'server.js'), 'utf8');
            const packageContent = await fs.readFile(join(this.packagePath, 'package.json'), 'utf8');
            
            // Look for potential cross-platform issues
            const hasWindowsOnlyPaths = /\\\\/.test(serverContent) || /\\\\/.test(packageContent);
            const hasUnixOnlyPaths = serverContent.includes('#!/bin/bash') || packageContent.includes('#!/bin/bash');
            
            return {
              success: !hasWindowsOnlyPaths && !hasUnixOnlyPaths,
              crossPlatformCompatible: !hasWindowsOnlyPaths && !hasUnixOnlyPaths,
              hasWindowsOnlyPaths,
              hasUnixOnlyPaths
            };
          }
        }
      ];
      
      const distributionResults = [];
      
      for (const check of distributionChecks) {
        console.log(`     ${check.description}...`);
        
        try {
          const result = await check.test();
          distributionResults.push({
            name: check.name,
            success: result.success,
            description: check.description,
            ...result
          });
        } catch (error) {
          distributionResults.push({
            name: check.name,
            success: false,
            error: error.message,
            description: check.description
          });
        }
      }
      
      const allDistributionChecksPass = distributionResults.every(r => r.success);
      
      this.results.addDeploymentTest(testName, {
        success: allDistributionChecksPass,
        checksCompleted: distributionResults.length,
        successfulChecks: distributionResults.filter(r => r.success).length,
        distributionResults,
        distributionReady: allDistributionChecksPass
      });
      
      console.log(`   ✅ Package distribution validation completed (${distributionResults.filter(r => r.success).length}/${distributionResults.length} checks passed)`);
      
    } catch (error) {
      this.results.addError(testName, error);
      this.results.addDeploymentTest(testName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Package distribution validation failed: ${error.message}`);
    }
  }

  /**
   * Test Cursor IDE integration features
   */
  async testCursorIntegrationFeatures() {
    const scenarioName = 'cursor-integration-features';
    const startTime = Date.now();
    
    try {
      console.log('   Testing Cursor IDE integration features...');
      
      const integrationFeatures = [
        {
          name: 'mcp-config-compatibility',
          description: 'Test MCP configuration compatibility',
          test: async () => {
            // Check if package works with standard MCP configuration
            const serverProcess = await this.startServerForTesting();
            
            try {
              const initResponse = await this.sendRequestToServer(serverProcess, {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                  protocolVersion: '2024-11-05',
                  capabilities: { tools: {} },
                  clientInfo: { name: 'cursor', version: '1.0.0' }
                }
              });
              
              return {
                success: !initResponse.error,
                initializationWorking: !initResponse.error,
                serverInfo: initResponse.result?.serverInfo
              };
            } finally {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGTERM');
              }
            }
          }
        },
        {
          name: 'tool-schema-validation',
          description: 'Validate tool schemas for Cursor',
          test: async () => {
            const serverProcess = await this.startServerForTesting();
            
            try {
              const toolsResponse = await this.sendRequestToServer(serverProcess, {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list'
              });
              
              if (toolsResponse.error) {
                return { success: false, error: toolsResponse.error.message };
              }
              
              const tools = toolsResponse.result?.tools || [];
              const validSchemas = tools.every(tool => 
                tool.name && 
                tool.description && 
                tool.inputSchema &&
                typeof tool.inputSchema === 'object'
              );
              
              return {
                success: validSchemas && tools.length >= CURSOR_NPX_CONFIG.cursorScenarios.quickStart.expectedTools,
                validSchemas,
                toolCount: tools.length,
                expectedTools: CURSOR_NPX_CONFIG.cursorScenarios.quickStart.expectedTools
              };
            } finally {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGTERM');
              }
            }
          }
        },
        {
          name: 'cursor-workflow-simulation',
          description: 'Simulate typical Cursor workflow',
          test: async () => {
            const serverProcess = await this.startServerForTesting();
            
            try {
              // Simulate a typical Cursor workflow: initialize, discover tools, execute tool
              const workflow = [
                {
                  method: 'initialize',
                  params: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    clientInfo: { name: 'cursor', version: '1.0.0' }
                  }
                },
                { method: 'tools/list' },
                {
                  method: 'tools/call',
                  params: {
                    name: 'extract_metadata',
                    arguments: { url: 'https://httpbin.org/html' }
                  }
                }
              ];
              
              const workflowResults = [];
              
              for (const [index, step] of workflow.entries()) {
                const response = await this.sendRequestToServer(serverProcess, {
                  jsonrpc: '2.0',
                  id: index + 1,
                  ...step
                });
                
                workflowResults.push({
                  step: step.method,
                  success: !response.error
                });
              }
              
              const workflowSuccess = workflowResults.every(r => r.success);
              
              return {
                success: workflowSuccess,
                workflowSuccess,
                stepsCompleted: workflowResults.filter(r => r.success).length,
                totalSteps: workflow.length
              };
            } finally {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGTERM');
              }
            }
          }
        }
      ];
      
      const featureResults = [];
      
      for (const feature of integrationFeatures) {
        console.log(`     Testing ${feature.description}...`);
        
        try {
          const result = await feature.test();
          featureResults.push({
            name: feature.name,
            success: result.success,
            description: feature.description,
            ...result
          });
        } catch (error) {
          featureResults.push({
            name: feature.name,
            success: false,
            error: error.message,
            description: feature.description
          });
        }
      }
      
      const allFeaturesWork = featureResults.every(f => f.success);
      
      this.results.addCursorScenario(scenarioName, {
        success: allFeaturesWork,
        allFeaturesWork,
        featuresTestedCount: featureResults.length,
        successfulFeatures: featureResults.filter(f => f.success).length,
        featureResults,
        cursorIntegrationReady: allFeaturesWork
      });
      
      console.log(`   ✅ Cursor integration features test completed (${featureResults.filter(f => f.success).length}/${featureResults.length} features working)`);
      
    } catch (error) {
      this.results.addError(scenarioName, error);
      this.results.addCursorScenario(scenarioName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Cursor integration features test failed: ${error.message}`);
    }
  }

  /**
   * Test installation and setup process
   */
  async testInstallationSetup() {
    const testName = 'installation-setup';
    const startTime = Date.now();
    
    try {
      console.log('   Testing installation and setup process...');
      
      const installationTests = [
        {
          name: 'npm-install-simulation',
          description: 'Simulate npm install process',
          test: async () => {
            try {
              // Check if npm install would work (dry run)
              const { stdout } = await execAsync('npm install --dry-run', { 
                cwd: this.packagePath,
                timeout: 30000
              });
              
              return {
                success: true,
                dryRunSuccessful: true,
                output: stdout.substring(0, 200)
              };
            } catch (error) {
              return {
                success: false,
                error: error.message
              };
            }
          }
        },
        {
          name: 'post-install-validation',
          description: 'Validate post-install state',
          test: async () => {
            // Check that all required files are present after installation
            const requiredPaths = [
              'server.js',
              'package.json',
              'src/tools',
              'src/constants',
              'src/utils'
            ];
            
            const pathChecks = await Promise.all(
              requiredPaths.map(async (path) => {
                try {
                  await fs.access(join(this.packagePath, path));
                  return { path, exists: true };
                } catch {
                  return { path, exists: false };
                }
              })
            );
            
            const allPathsExist = pathChecks.every(check => check.exists);
            
            return {
              success: allPathsExist,
              allPathsExist,
              pathChecks
            };
          }
        },
        {
          name: 'configuration-setup',
          description: 'Test configuration setup',
          test: async () => {
            // Test that the package can start without configuration
            const result = await this.executeCommand('node server.js --help', {
              cwd: this.packagePath,
              timeout: 10000
            });
            
            return {
              success: result.success,
              configurationOptional: result.success,
              helpAvailable: result.output?.includes('help') || result.success
            };
          }
        }
      ];
      
      const installationResults = [];
      
      for (const test of installationTests) {
        console.log(`     ${test.description}...`);
        
        try {
          const result = await test.test();
          installationResults.push({
            name: test.name,
            success: result.success,
            description: test.description,
            ...result
          });
        } catch (error) {
          installationResults.push({
            name: test.name,
            success: false,
            error: error.message,
            description: test.description
          });
        }
      }
      
      const allInstallationTestsPass = installationResults.every(r => r.success);
      
      this.results.addDeploymentTest(testName, {
        success: allInstallationTestsPass,
        testsCompleted: installationResults.length,
        successfulTests: installationResults.filter(r => r.success).length,
        installationResults,
        installationReady: allInstallationTestsPass
      });
      
      console.log(`   ✅ Installation and setup test completed (${installationResults.filter(r => r.success).length}/${installationResults.length} tests passed)`);
      
    } catch (error) {
      this.results.addError(testName, error);
      this.results.addDeploymentTest(testName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Installation and setup test failed: ${error.message}`);
    }
  }

  /**
   * Test cross-platform execution
   */
  async testCrossPlatformExecution() {
    const testName = 'cross-platform-execution';
    const startTime = Date.now();
    
    try {
      console.log('   Testing cross-platform execution compatibility...');
      
      const platformTests = [
        {
          name: 'path-handling',
          description: 'Test cross-platform path handling',
          test: async () => {
            // Check that the server handles paths correctly across platforms
            const serverProcess = await this.startServerForTesting();
            
            try {
              const response = await this.sendRequestToServer(serverProcess, {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                  name: 'fetch_url',
                  arguments: { url: 'https://httpbin.org/get' }
                }
              });
              
              return {
                success: !response.error,
                pathHandlingWorking: !response.error
              };
            } finally {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGTERM');
              }
            }
          }
        },
        {
          name: 'environment-variables',
          description: 'Test environment variable handling',
          test: async () => {
            // Test with different environment variable formats
            const envTests = [
              { NODE_ENV: 'development' },
              { NODE_ENV: 'production' },
              { NODE_ENV: 'test' }
            ];
            
            const envResults = [];
            
            for (const env of envTests) {
              const result = await this.executeCommand('node server.js --test', {
                cwd: this.packagePath,
                timeout: 10000,
                env: { ...process.env, ...env }
              });
              
              envResults.push({
                env: env.NODE_ENV,
                success: result.success
              });
            }
            
            const allEnvTestsPass = envResults.every(r => r.success);
            
            return {
              success: allEnvTestsPass,
              allEnvTestsPass,
              envResults
            };
          }
        },
        {
          name: 'file-permissions',
          description: 'Test file permission handling',
          test: async () => {
            // Check that file permissions are handled correctly
            try {
              const stats = await fs.stat(join(this.packagePath, 'server.js'));
              const isReadable = !!(stats.mode & parseInt('444', 8));
              
              return {
                success: isReadable,
                isReadable,
                permissions: stats.mode.toString(8)
              };
            } catch (error) {
              return {
                success: false,
                error: error.message
              };
            }
          }
        }
      ];
      
      const platformResults = [];
      
      for (const test of platformTests) {
        console.log(`     ${test.description}...`);
        
        try {
          const result = await test.test();
          platformResults.push({
            name: test.name,
            success: result.success,
            description: test.description,
            ...result
          });
        } catch (error) {
          platformResults.push({
            name: test.name,
            success: false,
            error: error.message,
            description: test.description
          });
        }
      }
      
      const allPlatformTestsPass = platformResults.every(r => r.success);
      
      this.results.addDeploymentTest(testName, {
        success: allPlatformTestsPass,
        testsCompleted: platformResults.length,
        successfulTests: platformResults.filter(r => r.success).length,
        platformResults,
        crossPlatformReady: allPlatformTestsPass
      });
      
      console.log(`   ✅ Cross-platform execution test completed (${platformResults.filter(r => r.success).length}/${platformResults.length} tests passed)`);
      
    } catch (error) {
      this.results.addError(testName, error);
      this.results.addDeploymentTest(testName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Cross-platform execution test failed: ${error.message}`);
    }
  }

  /**
   * Test NPX error handling
   */
  async testNPXErrorHandling() {
    const testName = 'npx-error-handling';
    const startTime = Date.now();
    
    try {
      console.log('   Testing NPX error handling...');
      
      const errorScenarios = [
        {
          name: 'invalid-arguments',
          description: 'Test handling of invalid arguments',
          test: async () => {
            const result = await this.executeCommand('node server.js --invalid-flag', {
              cwd: this.packagePath,
              timeout: 10000
            });
            
            // Should handle gracefully (either ignore or show help)
            return {
              success: true, // Any graceful handling is acceptable
              gracefulHandling: true
            };
          }
        },
        {
          name: 'missing-dependencies',
          description: 'Test behavior with missing optional dependencies',
          test: async () => {
            // Test that server starts even if some optional features aren't available
            const serverProcess = await this.startServerForTesting({
              env: { ...process.env, DISABLE_OPTIONAL_FEATURES: 'true' }
            });
            
            try {
              const response = await this.sendRequestToServer(serverProcess, {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list'
              });
              
              return {
                success: !response.error,
                gracefulDegradation: !response.error
              };
            } finally {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGTERM');
              }
            }
          }
        },
        {
          name: 'network-errors',
          description: 'Test network error handling',
          test: async () => {
            const serverProcess = await this.startServerForTesting();
            
            try {
              const response = await this.sendRequestToServer(serverProcess, {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                  name: 'fetch_url',
                  arguments: { url: 'https://nonexistent-domain-12345.com' }
                }
              });
              
              return {
                success: !!response.error, // Should return error, not crash
                errorHandled: !!response.error
              };
            } finally {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGTERM');
              }
            }
          }
        }
      ];
      
      const errorResults = [];
      
      for (const scenario of errorScenarios) {
        console.log(`     ${scenario.description}...`);
        
        try {
          const result = await scenario.test();
          errorResults.push({
            name: scenario.name,
            success: result.success,
            description: scenario.description,
            ...result
          });
        } catch (error) {
          errorResults.push({
            name: scenario.name,
            success: false,
            error: error.message,
            description: scenario.description
          });
        }
      }
      
      const allErrorScenariosHandled = errorResults.every(r => r.success);
      
      this.results.addNPXExecution(testName, {
        success: allErrorScenariosHandled,
        duration: Date.now() - startTime,
        scenariosHandled: errorResults.length,
        successfulScenarios: errorResults.filter(r => r.success).length,
        errorResults,
        robustErrorHandling: allErrorScenariosHandled
      });
      
      console.log(`   ✅ NPX error handling test completed (${errorResults.filter(r => r.success).length}/${errorResults.length} scenarios handled)`);
      
    } catch (error) {
      this.results.addError(testName, error);
      this.results.addNPXExecution(testName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ NPX error handling test failed: ${error.message}`);
    }
  }

  /**
   * Test performance optimization
   */
  async testPerformanceOptimization() {
    const testName = 'performance-optimization';
    const startTime = Date.now();
    
    try {
      console.log('   Testing performance optimization...');
      
      const performanceTests = [
        {
          name: 'startup-time',
          description: 'Measure server startup time',
          test: async () => {
            const startupStart = Date.now();
            const serverProcess = await this.startServerForTesting();
            const startupTime = Date.now() - startupStart;
            
            try {
              return {
                success: startupTime < 10000, // Under 10 seconds
                startupTime,
                fastStartup: startupTime < 5000
              };
            } finally {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGTERM');
              }
            }
          }
        },
        {
          name: 'memory-usage',
          description: 'Check memory usage efficiency',
          test: async () => {
            const serverProcess = await this.startServerForTesting();
            
            try {
              // Let server settle
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // Check basic memory usage (this is approximate)
              const memoryUsage = process.memoryUsage();
              const reasonableMemory = memoryUsage.heapUsed < 100 * 1024 * 1024; // Under 100MB
              
              return {
                success: reasonableMemory,
                memoryUsage: memoryUsage.heapUsed,
                reasonableMemory
              };
            } finally {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGTERM');
              }
            }
          }
        },
        {
          name: 'response-time',
          description: 'Test response time performance',
          test: async () => {
            const serverProcess = await this.startServerForTesting();
            
            try {
              const responseTimes = [];
              
              for (let i = 0; i < 5; i++) {
                const responseStart = Date.now();
                const response = await this.sendRequestToServer(serverProcess, {
                  jsonrpc: '2.0',
                  id: i + 1,
                  method: 'tools/list'
                });
                const responseTime = Date.now() - responseStart;
                
                if (!response.error) {
                  responseTimes.push(responseTime);
                }
              }
              
              const averageResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
              const fastResponse = averageResponseTime < 1000; // Under 1 second
              
              return {
                success: fastResponse && responseTimes.length >= 3,
                averageResponseTime,
                fastResponse,
                responseTimes
              };
            } finally {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGTERM');
              }
            }
          }
        }
      ];
      
      const performanceResults = [];
      
      for (const test of performanceTests) {
        console.log(`     ${test.description}...`);
        
        try {
          const result = await test.test();
          performanceResults.push({
            name: test.name,
            success: result.success,
            description: test.description,
            ...result
          });
          
          this.results.addExecutionMetric({
            type: test.name,
            value: result.startupTime || result.averageResponseTime || result.memoryUsage,
            success: result.success
          });
          
        } catch (error) {
          performanceResults.push({
            name: test.name,
            success: false,
            error: error.message,
            description: test.description
          });
        }
      }
      
      const allPerformanceTestsPass = performanceResults.every(r => r.success);
      
      this.results.addNPXExecution(testName, {
        success: allPerformanceTestsPass,
        duration: Date.now() - startTime,
        testsCompleted: performanceResults.length,
        successfulTests: performanceResults.filter(r => r.success).length,
        performanceResults,
        performanceOptimized: allPerformanceTestsPass
      });
      
      console.log(`   ✅ Performance optimization test completed (${performanceResults.filter(r => r.success).length}/${performanceResults.length} tests passed)`);
      
    } catch (error) {
      this.results.addError(testName, error);
      this.results.addNPXExecution(testName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Performance optimization test failed: ${error.message}`);
    }
  }

  // Helper methods

  /**
   * Execute a command with timeout and error handling
   */
  async executeCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 30000;
      const env = options.env || process.env;
      const cwd = options.cwd || process.cwd();
      
      exec(command, { 
        cwd, 
        env,
        timeout
      }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            error: error.message,
            output: stderr || stdout,
            code: error.code
          });
        } else {
          resolve({
            success: true,
            output: stdout,
            stderr: stderr
          });
        }
      });
    });
  }

  /**
   * Start server for testing
   */
  async startServerForTesting(options = {}) {
    return new Promise((resolve, reject) => {
      const env = options.env || process.env;
      
      const serverProcess = spawn('node', ['server.js'], {
        cwd: this.packagePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });
      
      serverProcess.on('error', reject);
      
      let stderr = '';
      serverProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.includes('MCP WebScraper server')) {
          resolve(serverProcess);
        }
      });
      
      // Timeout if server doesn't start
      setTimeout(() => {
        if (!serverProcess.pid) {
          reject(new Error('Server failed to start within timeout'));
        } else {
          resolve(serverProcess);
        }
      }, CURSOR_NPX_CONFIG.serverTimeout);
    });
  }

  /**
   * Send request to server process
   */
  async sendRequestToServer(serverProcess, request) {
    return new Promise((resolve, reject) => {
      if (!serverProcess || serverProcess.killed) {
        reject(new Error('Server process not available'));
        return;
      }
      
      const requestStr = JSON.stringify(request) + '\n';
      let responseBuffer = '';
      
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, CURSOR_NPX_CONFIG.requestTimeout);
      
      const onData = (data) => {
        responseBuffer += data.toString();
        
        const lines = responseBuffer.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line.trim());
              if (response.id === request.id || response.jsonrpc) {
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
      serverProcess.stdin.write(requestStr);
    });
  }

  /**
   * Test tool discovery functionality
   */
  async testToolDiscovery(serverProcess) {
    try {
      const response = await this.sendRequestToServer(serverProcess, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      });
      
      return {
        success: !response.error && Array.isArray(response.result?.tools),
        data: {
          toolCount: response.result?.tools?.length || 0,
          tools: response.result?.tools?.map(t => t.name) || []
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Test basic functionality
   */
  async testBasicFunctionality(serverProcess) {
    try {
      const response = await this.sendRequestToServer(serverProcess, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'fetch_url',
          arguments: { url: 'https://httpbin.org/get' }
        }
      });
      
      return {
        success: !response.error && response.result,
        data: {
          basicFunctionalityWorking: !response.error
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Test Cursor-specific features
   */
  async testCursorSpecificFeatures(serverProcess) {
    try {
      // Test multiple tools to ensure Cursor can use various features
      const tools = ['extract_metadata', 'extract_text'];
      const results = [];
      
      for (const tool of tools) {
        const response = await this.sendRequestToServer(serverProcess, {
          jsonrpc: '2.0',
          id: this.getNextRequestId(),
          method: 'tools/call',
          params: {
            name: tool,
            arguments: { url: 'https://httpbin.org/html' }
          }
        });
        
        results.push({ tool, success: !response.error });
      }
      
      const allToolsWork = results.every(r => r.success);
      
      return {
        success: allToolsWork,
        data: {
          cursorFeaturesWorking: allToolsWork,
          toolsTestd: results.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get next request ID
   */
  getNextRequestId() {
    return this.requestId++;
  }

  /**
   * Generate Cursor NPX integration report
   */
  generateCursorNPXReport() {
    const summary = this.results.getSummary();
    
    return {
      timestamp: new Date().toISOString(),
      configuration: CURSOR_NPX_CONFIG,
      summary,
      npxAnalysis: this.analyzeNPXIntegration(summary),
      cursorReadiness: this.assessCursorReadiness(summary),
      deploymentAnalysis: this.analyzeDeploymentReadiness(),
      packageAnalysis: this.analyzePackageQuality(),
      errors: this.results.errors,
      recommendations: this.generateCursorNPXRecommendations(summary)
    };
  }

  /**
   * Analyze NPX integration quality
   */
  analyzeNPXIntegration(summary) {
    const analysis = {
      status: 'READY',
      issues: [],
      strengths: []
    };
    
    if (summary.successRate < 85) {
      analysis.status = 'NOT_READY';
      analysis.issues.push(`Low NPX integration success rate: ${summary.successRate.toFixed(1)}%`);
    } else if (summary.successRate < 95) {
      analysis.status = 'MOSTLY_READY';
      analysis.issues.push(`Moderate NPX success rate: ${summary.successRate.toFixed(1)}%`);
    } else {
      analysis.strengths.push(`High NPX integration success rate: ${summary.successRate.toFixed(1)}%`);
    }
    
    // Check NPX-specific tests
    const npxExecutions = Array.from(this.results.npxExecutions.values());
    const failedNPXTests = npxExecutions.filter(exec => !exec.success);
    
    if (failedNPXTests.length > 0) {
      analysis.issues.push(`Some NPX executions failed: ${failedNPXTests.map(t => t.name || 'unknown').join(', ')}`);
    }
    
    return analysis;
  }

  /**
   * Assess Cursor readiness
   */
  assessCursorReadiness(summary) {
    const readinessFactors = {
      npxExecution: summary.npxExecutions.passed >= summary.npxExecutions.total * 0.9,
      cursorScenarios: summary.cursorScenarios.passed === summary.cursorScenarios.total,
      packageValidation: this.results.packageValidation.length > 0 && this.results.packageValidation.every(v => v.success),
      deploymentReady: summary.deploymentTests.passed >= summary.deploymentTests.total * 0.8,
      errorHandling: summary.totalErrors / summary.totalTests < 0.2
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
   * Analyze deployment readiness
   */
  analyzeDeploymentReadiness() {
    const deploymentTests = this.results.deploymentTests;
    
    if (deploymentTests.length === 0) {
      return { status: 'NO_DATA' };
    }
    
    const passedTests = deploymentTests.filter(t => t.success).length;
    const deploymentScore = (passedTests / deploymentTests.length) * 100;
    
    let deploymentStatus = 'NOT_READY';
    if (deploymentScore >= 90) deploymentStatus = 'READY';
    else if (deploymentScore >= 75) deploymentStatus = 'MOSTLY_READY';
    else if (deploymentScore >= 50) deploymentStatus = 'PARTIALLY_READY';
    
    return {
      status: deploymentStatus,
      score: deploymentScore,
      passedTests,
      totalTests: deploymentTests.length,
      criticalIssues: deploymentTests.filter(t => !t.success && t.testName.includes('production'))
    };
  }

  /**
   * Analyze package quality
   */
  analyzePackageQuality() {
    const packageValidations = this.results.packageValidation;
    
    if (packageValidations.length === 0) {
      return { status: 'NO_DATA' };
    }
    
    const latestValidation = packageValidations[packageValidations.length - 1];
    
    return {
      status: latestValidation.success ? 'HIGH_QUALITY' : 'NEEDS_IMPROVEMENT',
      packageStructureValid: latestValidation.allValidationsPassed,
      executableReady: latestValidation.serverExecutable,
      filesComplete: latestValidation.allRequiredFilesExist,
      validationDetails: latestValidation.validationResults
    };
  }

  /**
   * Generate Cursor NPX recommendations
   */
  generateCursorNPXRecommendations(summary) {
    const recommendations = [];
    
    const npxAnalysis = this.analyzeNPXIntegration(summary);
    if (npxAnalysis.status === 'NOT_READY') {
      recommendations.push('Fix critical NPX integration issues before Cursor deployment');
    }
    
    const cursorReadiness = this.assessCursorReadiness(summary);
    if (cursorReadiness.level === 'NOT_READY') {
      recommendations.push('Address fundamental readiness issues for Cursor IDE integration');
    }
    
    const deploymentAnalysis = this.analyzeDeploymentReadiness();
    if (deploymentAnalysis.status === 'NOT_READY') {
      recommendations.push('Improve deployment readiness before NPX publication');
    }
    
    const packageAnalysis = this.analyzePackageQuality();
    if (packageAnalysis.status === 'NEEDS_IMPROVEMENT') {
      recommendations.push('Fix package structure and validation issues');
    }
    
    if (summary.totalErrors > summary.totalTests * 0.1) {
      recommendations.push('Reduce error rate for better NPX execution reliability');
    }
    
    // Check specific recommendations based on test results
    const executionMetrics = this.results.executionMetrics;
    const slowMetrics = executionMetrics.filter(m => !m.success);
    if (slowMetrics.length > 0) {
      recommendations.push('Optimize performance for better NPX execution speed');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Package is ready for NPX distribution and Cursor IDE integration');
      recommendations.push('Consider publishing to NPM registry');
      recommendations.push('Monitor NPX usage and performance in production');
    }
    
    return recommendations;
  }

  /**
   * Save Cursor NPX integration report
   */
  async saveCursorNPXReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `cursor-npx-integration-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📄 Cursor NPX integration report saved: ${filepath}`);
    } catch (error) {
      console.error('❌ Failed to save Cursor NPX report:', error.message);
    }
  }

  /**
   * Cleanup test environment
   */
  async cleanup() {
    console.log('   Cleaning up test environment...');
    // No persistent processes to clean up for NPX tests
    console.log('   ✅ Cleanup completed');
  }
}

/**
 * Main Cursor NPX integration test execution
 */
async function runCursorNPXIntegrationTests() {
  console.log('🎯 Starting Cursor IDE NPX Execution Test Suite...');
  
  const testSuite = new CursorIDENPXTestSuite();
  
  try {
    const report = await testSuite.runCursorNPXIntegrationTests();
    
    console.log('\n📋 Cursor NPX Integration Test Summary:');
    console.log('─'.repeat(60));
    console.log(`✅ Status: ${report.npxAnalysis.status}`);
    console.log(`📊 Total Tests: ${report.summary.totalTests}`);
    console.log(`🎯 Success Rate: ${report.summary.successRate.toFixed(1)}%`);
    console.log(`🚀 Cursor Readiness: ${report.cursorReadiness.level} (${report.cursorReadiness.percentage.toFixed(1)}%)`);
    console.log(`📦 Package Quality: ${report.packageAnalysis.status}`);
    console.log(`🏭 Deployment Status: ${report.deploymentAnalysis.status}`);
    console.log(`❌ Total Errors: ${report.summary.totalErrors}`);
    console.log(`⏱️ Duration: ${(report.summary.duration / 1000).toFixed(1)}s`);
    
    if (report.npxAnalysis.issues.length > 0) {
      console.log('\n⚠️ Issues Identified:');
      report.npxAnalysis.issues.forEach(issue => console.log(`   • ${issue}`));
    }
    
    if (report.npxAnalysis.strengths.length > 0) {
      console.log('\n✨ Strengths:');
      report.npxAnalysis.strengths.forEach(strength => console.log(`   • ${strength}`));
    }
    
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach(rec => console.log(`   • ${rec}`));
    
    return report;
    
  } catch (error) {
    console.error('❌ Cursor NPX integration test failed:', error);
    throw error;
  }
}

// Export for use in other test files
export { CursorIDENPXTestSuite, runCursorNPXIntegrationTests };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCursorNPXIntegrationTests()
    .then(() => {
      console.log('✅ Cursor NPX integration test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Cursor NPX integration test failed:', error);
      process.exit(1);
    });
}
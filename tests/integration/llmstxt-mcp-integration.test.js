#!/usr/bin/env node

/**
 * LLMs.txt Generator MCP Integration Test
 * Tests the tool integration through the MCP server interface
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serverPath = join(__dirname, '..', '..', 'server.js');

class LLMsTxtMCPIntegrationTest {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      errors: []
    };
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '✅';
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async runTest(testName, testFunction) {
    try {
      this.log(`Running test: ${testName}`);
      await testFunction();
      this.results.passed++;
      this.log(`✓ ${testName} passed`);
    } catch (error) {
      this.results.failed++;
      this.results.errors.push({ test: testName, error: error.message });
      this.log(`✗ ${testName} failed: ${error.message}`, 'error');
    }
  }

  async sendMCPRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const server = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: method,
        params: params
      };

      server.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      server.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      server.on('close', (code) => {
        try {
          // Parse the JSON response from stdout
          const lines = stdout.trim().split('\n');
          const responseLine = lines.find(line => {
            try {
              const parsed = JSON.parse(line);
              return parsed.id === 1;
            } catch {
              return false;
            }
          });

          if (!responseLine) {
            reject(new Error(`No valid response found. stderr: ${stderr}`));
            return;
          }

          const response = JSON.parse(responseLine);
          if (response.error) {
            reject(new Error(`MCP Error: ${response.error.message || JSON.stringify(response.error)}`));
          } else {
            resolve(response.result);
          }
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}. stdout: ${stdout}, stderr: ${stderr}`));
        }
      });

      server.on('error', (error) => {
        reject(new Error(`Server process error: ${error.message}`));
      });

      // Send the request
      server.stdin.write(JSON.stringify(request) + '\n');
      server.stdin.end();

      // Set timeout
      setTimeout(() => {
        server.kill();
        reject(new Error('Request timeout'));
      }, 30000);
    });
  }

  async testToolRegistration() {
    // Test that the generate_llms_txt tool is properly registered
    const result = await this.sendMCPRequest('tools/list');
    
    if (!result.tools) {
      throw new Error('No tools returned from MCP server');
    }

    const llmsTxtTool = result.tools.find(tool => tool.name === 'generate_llms_txt');
    if (!llmsTxtTool) {
      throw new Error('generate_llms_txt tool not found in registered tools');
    }

    if (!llmsTxtTool.description) {
      throw new Error('Tool description missing');
    }

    if (!llmsTxtTool.inputSchema) {
      throw new Error('Tool input schema missing');
    }

    this.log('Tool registration test passed');
  }

  async testBasicToolExecution() {
    // Test basic tool execution through MCP
    const result = await this.sendMCPRequest('tools/call', {
      name: 'generate_llms_txt',
      arguments: {
        url: 'https://httpbin.org',
        analysisOptions: {
          maxDepth: 1,
          maxPages: 5
        },
        format: 'llms-txt'
      }
    });

    if (!result.content || !Array.isArray(result.content)) {
      throw new Error('Invalid response format from tool');
    }

    const content = result.content[0];
    if (content.type !== 'text') {
      throw new Error('Response content type is not text');
    }

    const responseData = JSON.parse(content.text);
    if (!responseData.files || !responseData.files['llms.txt']) {
      throw new Error('LLMs.txt file not generated');
    }

    this.log('Basic tool execution test passed');
  }

  async testComprehensiveGeneration() {
    // Test comprehensive generation with all options
    const result = await this.sendMCPRequest('tools/call', {
      name: 'generate_llms_txt',
      arguments: {
        url: 'https://httpbin.org',
        analysisOptions: {
          maxDepth: 2,
          maxPages: 20,
          detectAPIs: true,
          analyzeContent: true,
          checkSecurity: true,
          respectRobots: true
        },
        outputOptions: {
          includeDetailed: true,
          contactEmail: 'test@example.com',
          organizationName: 'Test Organization',
          customGuidelines: ['Custom guideline 1'],
          customRestrictions: ['/custom/restricted']
        },
        complianceLevel: 'standard',
        format: 'both'
      }
    });

    const responseData = JSON.parse(result.content[0].text);
    
    if (!responseData.files['llms.txt'] || !responseData.files['llms-full.txt']) {
      throw new Error('Both LLMs.txt files not generated');
    }

    if (!responseData.analysisStats) {
      throw new Error('Analysis statistics not provided');
    }

    if (!responseData.recommendations) {
      throw new Error('Recommendations not generated');
    }

    this.log('Comprehensive generation test passed');
  }

  async testParameterValidation() {
    // Test parameter validation
    try {
      await this.sendMCPRequest('tools/call', {
        name: 'generate_llms_txt',
        arguments: {
          url: 'not-a-valid-url',
          format: 'invalid-format'
        }
      });
      throw new Error('Should have failed validation');
    } catch (error) {
      if (!error.message.includes('MCP Error') && !error.message.includes('validation')) {
        throw new Error('Unexpected error type: ' + error.message);
      }
    }

    this.log('Parameter validation test passed');
  }

  async testDifferentComplianceLevels() {
    // Test different compliance levels
    const levels = ['basic', 'standard', 'strict'];
    
    for (const level of levels) {
      const result = await this.sendMCPRequest('tools/call', {
        name: 'generate_llms_txt',
        arguments: {
          url: 'https://httpbin.org',
          complianceLevel: level,
          analysisOptions: {
            maxDepth: 1,
            maxPages: 5
          }
        }
      });

      const responseData = JSON.parse(result.content[0].text);
      if (responseData.complianceLevel !== level) {
        throw new Error(`Compliance level not set correctly for ${level}`);
      }
    }

    this.log('Compliance levels test passed');
  }

  async testFormatOptions() {
    // Test different format options
    const formats = ['llms-txt', 'llms-full-txt', 'both'];
    
    for (const format of formats) {
      const result = await this.sendMCPRequest('tools/call', {
        name: 'generate_llms_txt',
        arguments: {
          url: 'https://httpbin.org',
          format: format,
          analysisOptions: {
            maxDepth: 1,
            maxPages: 5
          }
        }
      });

      const responseData = JSON.parse(result.content[0].text);
      
      if (format === 'llms-txt' && !responseData.files['llms.txt']) {
        throw new Error('LLMs.txt not generated when requested');
      }
      
      if (format === 'llms-full-txt' && !responseData.files['llms-full.txt']) {
        throw new Error('LLMs-full.txt not generated when requested');
      }
      
      if (format === 'both' && (!responseData.files['llms.txt'] || !responseData.files['llms-full.txt'])) {
        throw new Error('Both files not generated when requested');
      }
    }

    this.log('Format options test passed');
  }

  async testErrorHandlingMCP() {
    // Test error handling through MCP interface
    const result = await this.sendMCPRequest('tools/call', {
      name: 'generate_llms_txt',
      arguments: {
        url: 'https://definitely-does-not-exist-12345.com',
        analysisOptions: {
          maxDepth: 1,
          maxPages: 5
        }
      }
    });

    if (!result.isError) {
      throw new Error('Error flag not set for failed request');
    }

    const content = result.content[0];
    if (!content.text.includes('LLMs.txt generation failed')) {
      throw new Error('Error message format incorrect');
    }

    this.log('Error handling MCP test passed');
  }

  async testResponseFormat() {
    // Test that responses follow MCP format standards
    const result = await this.sendMCPRequest('tools/call', {
      name: 'generate_llms_txt',
      arguments: {
        url: 'https://httpbin.org',
        analysisOptions: {
          maxDepth: 1,
          maxPages: 5
        }
      }
    });

    // Check MCP response structure
    if (!result.content) {
      throw new Error('Response missing content field');
    }

    if (!Array.isArray(result.content)) {
      throw new Error('Content field is not an array');
    }

    const content = result.content[0];
    if (!content.type || !content.text) {
      throw new Error('Content item missing required fields');
    }

    // Check that the response is valid JSON
    const responseData = JSON.parse(content.text);
    if (!responseData.baseUrl || !responseData.generatedAt || !responseData.files) {
      throw new Error('Response data missing required fields');
    }

    this.log('Response format test passed');
  }

  async runAllTests() {
    this.log('Starting LLMs.txt Generator MCP Integration Tests...', 'info');
    this.log('='.repeat(60), 'info');

    const tests = [
      ['Tool Registration', () => this.testToolRegistration()],
      ['Basic Tool Execution', () => this.testBasicToolExecution()],
      ['Comprehensive Generation', () => this.testComprehensiveGeneration()],
      ['Parameter Validation', () => this.testParameterValidation()],
      ['Different Compliance Levels', () => this.testDifferentComplianceLevels()],
      ['Format Options', () => this.testFormatOptions()],
      ['Error Handling MCP', () => this.testErrorHandlingMCP()],
      ['Response Format', () => this.testResponseFormat()]
    ];

    for (const [testName, testFunction] of tests) {
      await this.runTest(testName, testFunction);
    }

    this.printResults();
  }

  printResults() {
    this.log('='.repeat(60), 'info');
    this.log('LLMs.txt Generator MCP Integration Test Results:', 'info');
    this.log(`✅ Passed: ${this.results.passed}`, 'info');
    this.log(`❌ Failed: ${this.results.failed}`, this.results.failed > 0 ? 'error' : 'info');
    
    if (this.results.errors.length > 0) {
      this.log('\nErrors:', 'error');
      this.results.errors.forEach(error => {
        this.log(`  - ${error.test}: ${error.error}`, 'error');
      });
    }

    const successRate = (this.results.passed / (this.results.passed + this.results.failed)) * 100;
    this.log(`\nSuccess Rate: ${successRate.toFixed(1)}%`, successRate >= 90 ? 'info' : 'warn');

    if (this.results.failed === 0) {
      this.log('\n🎉 All LLMs.txt Generator MCP integration tests passed!', 'info');
    } else {
      this.log(`\n⚠️  ${this.results.failed} test(s) failed. Please review and fix issues.`, 'warn');
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new LLMsTxtMCPIntegrationTest();
  
  tester.runAllTests().catch(error => {
    console.error('MCP integration test runner failed:', error);
    process.exit(1);
  });
}

export { LLMsTxtMCPIntegrationTest };
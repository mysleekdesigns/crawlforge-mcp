#!/usr/bin/env node

/**
 * Simple focused test for MCP WebScraper tools
 * Tests one tool at a time with basic parameter validation
 */

import { spawn } from 'child_process';
import { performance } from 'perf_hooks';

class SimpleToolTester {
    constructor() {
        this.testResults = [];
    }

    async testSingleTool(toolName, params, timeout = 15000) {
        console.log(`\n=== Testing ${toolName} ===`);
        console.log(`Parameters:`, JSON.stringify(params, null, 2));
        
        const startTime = performance.now();
        
        return new Promise((resolve, reject) => {
            const server = spawn('node', ['server.js'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let responseBuffer = '';
            let errorBuffer = '';
            let resolved = false;

            const timeoutId = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    server.kill('SIGKILL');
                    reject(new Error(`Timeout after ${timeout}ms`));
                }
            }, timeout);

            server.stdout.on('data', (data) => {
                responseBuffer += data.toString();
                
                // Look for JSON response
                const lines = responseBuffer.split('\n');
                for (const line of lines) {
                    if (line.trim().startsWith('{"result"') || line.trim().startsWith('{"error"')) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeoutId);
                            server.kill();
                            
                            try {
                                const response = JSON.parse(line.trim());
                                const duration = Math.round(performance.now() - startTime);
                                resolve({ response, duration, stderr: errorBuffer });
                            } catch (e) {
                                reject(new Error(`Failed to parse response: ${line}`));
                            }
                        }
                        return;
                    }
                }
            });

            server.stderr.on('data', (data) => {
                errorBuffer += data.toString();
            });

            server.on('error', (error) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });

            // Send the MCP request
            const request = {
                jsonrpc: "2.0",
                method: "tools/call",
                id: Math.floor(Math.random() * 1000),
                params: {
                    name: toolName,
                    arguments: params
                }
            };

            server.stdin.write(JSON.stringify(request) + '\n');
            
            // Give it a moment to process
            setTimeout(() => {
                if (!resolved) {
                    server.stdin.end();
                }
            }, 1000);
        });
    }

    async runBasicTests() {
        console.log('🧪 Running basic MCP WebScraper tool tests...');
        console.log('='.repeat(50));

        const tests = [
            // Test 1: fetch_url with a simple URL
            {
                tool: 'fetch_url',
                params: { 
                    url: 'https://httpbin.org/get',
                    timeout: 10000 
                }
            },
            
            // Test 2: extract_text
            {
                tool: 'extract_text',
                params: { 
                    url: 'https://example.com' 
                }
            },
            
            // Test 3: extract_links
            {
                tool: 'extract_links',
                params: { 
                    url: 'https://example.com' 
                }
            },
            
            // Test 4: extract_metadata
            {
                tool: 'extract_metadata',
                params: { 
                    url: 'https://example.com' 
                }
            },
            
            // Test 5: summarize_content (non-URL based)
            {
                tool: 'summarize_content',
                params: { 
                    text: 'This is a test text for summarization. It should be shortened.' 
                }
            },
            
            // Test 6: analyze_content (non-URL based)
            {
                tool: 'analyze_content',
                params: { 
                    text: 'Hello world! This is a test sentence for content analysis.' 
                }
            }
        ];

        for (const test of tests) {
            try {
                const result = await this.testSingleTool(test.tool, test.params);
                
                console.log(`✅ ${test.tool}: Success (${result.duration}ms)`);
                
                if (result.response.result) {
                    console.log('   Response type:', typeof result.response.result.content);
                    if (result.response.result.content && result.response.result.content[0]) {
                        const content = result.response.result.content[0].text;
                        console.log('   Content preview:', content.substring(0, 100) + '...');
                    }
                } else if (result.response.error) {
                    console.log('   Error:', result.response.error.message || result.response.error);
                }

                this.testResults.push({
                    tool: test.tool,
                    status: 'SUCCESS',
                    duration: result.duration,
                    hasError: !!result.response.error
                });

            } catch (error) {
                console.log(`❌ ${test.tool}: Failed - ${error.message}`);
                this.testResults.push({
                    tool: test.tool,
                    status: 'FAILED',
                    error: error.message
                });
            }
        }

        this.printSummary();
    }

    printSummary() {
        console.log('\n' + '='.repeat(50));
        console.log('📊 TEST SUMMARY');
        console.log('='.repeat(50));
        
        const successful = this.testResults.filter(r => r.status === 'SUCCESS').length;
        const failed = this.testResults.filter(r => r.status === 'FAILED').length;
        const withErrors = this.testResults.filter(r => r.status === 'SUCCESS' && r.hasError).length;
        
        console.log(`✅ Successful: ${successful}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`⚠️  Success with errors: ${withErrors}`);
        console.log(`📈 Success rate: ${((successful / this.testResults.length) * 100).toFixed(1)}%`);
        
        if (successful > 0) {
            const successfulTests = this.testResults.filter(r => r.status === 'SUCCESS' && r.duration);
            if (successfulTests.length > 0) {
                const avgTime = successfulTests.reduce((sum, r) => sum + r.duration, 0) / successfulTests.length;
                console.log(`⏱️  Average response time: ${Math.round(avgTime)}ms`);
            }
        }
        
        console.log('\nDetailed Results:');
        this.testResults.forEach((result, index) => {
            console.log(`${index + 1}. ${result.tool}: ${result.status} ${result.duration ? `(${result.duration}ms)` : ''} ${result.hasError ? '⚠️' : ''}`);
            if (result.error) {
                console.log(`   Error: ${result.error}`);
            }
        });
        
        console.log('\n' + '='.repeat(50));
    }
}

// Run the tests
const tester = new SimpleToolTester();
tester.runBasicTests().catch(console.error);
#!/usr/bin/env node
/**
 * Simple functional test for CrawlForge tools
 * Tests basic functionality of each tool
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ToolTester {
  constructor() {
    this.server = null;
    this.results = [];
    this.messageId = 1;
  }

  async start() {
    console.log('🚀 Starting CrawlForge Tool Test Suite...\n');

    // Start server in creator mode
    this.server = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, BYPASS_API_KEY: 'true', NODE_ENV: 'development' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for server to be ready
    await this.waitForReady();

    // Initialize protocol
    await this.initialize();
  }

  async waitForReady() {
    return new Promise((resolve) => {
      let buffer = '';
      const handler = (data) => {
        buffer += data.toString();
        if (buffer.includes('running on stdio')) {
          this.server.stderr.removeListener('data', handler);
          setTimeout(resolve, 500); // Give it a moment to fully initialize
        }
      };
      this.server.stderr.on('data', handler);
    });
  }

  async sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const request = {
        jsonrpc: '2.0',
        id: this.messageId++,
        method,
        params
      };

      let buffer = '';
      const timeout = setTimeout(() => {
        this.server.stdout.removeListener('data', handler);
        reject(new Error('Request timeout'));
      }, 30000);

      const handler = (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          try {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              clearTimeout(timeout);
              this.server.stdout.removeListener('data', handler);
              resolve(response);
              buffer = lines[lines.length - 1];
              return;
            }
          } catch (e) {
            // Continue parsing
          }
        }
        buffer = lines[lines.length - 1];
      };

      this.server.stdout.on('data', handler);
      this.server.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async initialize() {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    });

    if (response.error) {
      throw new Error(`Initialization failed: ${response.error.message}`);
    }

    await this.sendRequest('initialized', {});
  }

  async testTool(toolName, params, description) {
    console.log(`Testing: ${description}`);
    try {
      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: params
      });

      if (response.error) {
        console.log(`  ❌ FAILED: ${response.error.message}\n`);
        this.results.push({ tool: toolName, test: description, passed: false, error: response.error.message });
        return false;
      }

      if (response.result && response.result.content && response.result.content.length > 0) {
        console.log(`  ✅ PASSED\n`);
        this.results.push({ tool: toolName, test: description, passed: true });
        return true;
      } else {
        console.log(`  ❌ FAILED: Invalid response format\n`);
        this.results.push({ tool: toolName, test: description, passed: false, error: 'Invalid response format' });
        return false;
      }
    } catch (error) {
      console.log(`  ❌ FAILED: ${error.message}\n`);
      this.results.push({ tool: toolName, test: description, passed: false, error: error.message });
      return false;
    }
  }

  async runTests() {
    console.log('📋 Testing Basic Tools\n');
    console.log('─'.repeat(60) + '\n');

    // Test 1: fetch_url
    await this.testTool('fetch_url', {
      url: 'https://example.com',
      timeout: 10000
    }, 'fetch_url - Get example.com');

    // Test 2: extract_text
    await this.testTool('extract_text', {
      url: 'https://example.com',
      remove_scripts: true
    }, 'extract_text - Extract text from example.com');

    // Test 3: extract_metadata
    await this.testTool('extract_metadata', {
      url: 'https://example.com'
    }, 'extract_metadata - Extract metadata from example.com');

    // Test 4: extract_links
    await this.testTool('extract_links', {
      url: 'https://example.com',
      filter_external: false
    }, 'extract_links - Extract links from example.com');

    // Test 5: scrape_structured
    await this.testTool('scrape_structured', {
      url: 'https://example.com',
      selectors: {
        title: 'h1',
        content: 'p'
      }
    }, 'scrape_structured - Extract h1 and p tags');

    // Test 6: search_web
    await this.testTool('search_web', {
      query: 'web scraping',
      limit: 3
    }, 'search_web - Search for "web scraping"');

    // Test 7: crawl_deep
    await this.testTool('crawl_deep', {
      url: 'https://example.com',
      max_depth: 1,
      max_pages: 3
    }, 'crawl_deep - Crawl example.com (depth 1, max 3 pages)');

    // Test 8: map_site
    await this.testTool('map_site', {
      url: 'https://example.com',
      max_urls: 10
    }, 'map_site - Map example.com structure');

    console.log('\n📋 Testing Wave 2 Features (Advanced)\n');
    console.log('─'.repeat(60) + '\n');

    // Test 9: batch_scrape
    await this.testTool('batch_scrape', {
      urls: ['https://example.com', 'https://example.org'],
      formats: ['json'],
      mode: 'sync',
      maxConcurrency: 2
    }, 'batch_scrape - Scrape 2 URLs in parallel');

    // Test 10: scrape_with_actions
    await this.testTool('scrape_with_actions', {
      url: 'https://example.com',
      actions: [
        { type: 'wait', timeout: 1000 },
        { type: 'screenshot' }
      ],
      formats: ['json']
    }, 'scrape_with_actions - Wait and screenshot');

    console.log('\n📋 Testing Wave 3 Features (Research)\n');
    console.log('─'.repeat(60) + '\n');

    // Test 11: extract_content
    await this.testTool('extract_content', {
      url: 'https://example.com'
    }, 'extract_content - Extract main content');

    // Test 12: summarize_content
    await this.testTool('summarize_content', {
      text: 'This is a test sentence about web scraping. Web scraping is the process of extracting data from websites. It is used for various purposes including data analysis and research.'
    }, 'summarize_content - Summarize test text');

    // Test 13: analyze_content
    await this.testTool('analyze_content', {
      text: 'This is a test sentence about web scraping technology.'
    }, 'analyze_content - Analyze test text');

    // Test 14: stealth_mode
    await this.testTool('stealth_mode', {
      operation: 'get_stats'
    }, 'stealth_mode - Get stealth stats');

    // Test 15: localization
    await this.testTool('localization', {
      operation: 'get_supported_countries'
    }, 'localization - Get supported countries');

    console.log('─'.repeat(60) + '\n');
    this.printSummary();
  }

  printSummary() {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;

    console.log('\n📊 Test Summary\n');
    console.log('─'.repeat(60));
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${failed}/${total}`);
    console.log(`📈 Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
    console.log('─'.repeat(60) + '\n');

    if (failed > 0) {
      console.log('\n⚠️  Failed Tests:\n');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  • ${r.tool}: ${r.test}`);
        console.log(`    Error: ${r.error}\n`);
      });
    }
  }

  async cleanup() {
    if (this.server) {
      this.server.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Run tests
const tester = new ToolTester();

tester.start()
  .then(() => tester.runTests())
  .then(() => tester.cleanup())
  .then(() => {
    const failed = tester.results.filter(r => !r.passed).length;
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('❌ Test suite failed:', error);
    tester.cleanup();
    process.exit(1);
  });

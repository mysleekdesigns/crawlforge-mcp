#!/usr/bin/env node
/**
 * Real-world usage test scenarios for CrawlForge
 * Tests practical use cases to ensure the tool works in real projects
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class RealWorldTester {
  constructor() {
    this.server = null;
    this.messageId = 1;
    this.scenarios = [];
  }

  async start() {
    console.log('🌍 Starting Real-World Usage Test Suite...\n');

    this.server = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, BYPASS_API_KEY: 'true', NODE_ENV: 'development' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    await this.waitForReady();
    await this.initialize();
  }

  async waitForReady() {
    return new Promise((resolve) => {
      let buffer = '';
      const handler = (data) => {
        buffer += data.toString();
        if (buffer.includes('running on stdio')) {
          this.server.stderr.removeListener('data', handler);
          setTimeout(resolve, 500);
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
      }, 60000);

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
      clientInfo: { name: 'real-world-test', version: '1.0.0' }
    });

    if (response.error) {
      throw new Error(`Initialization failed: ${response.error.message}`);
    }

    await this.sendRequest('initialized', {});
  }

  async runScenario(name, testFunc) {
    console.log(`\n🔬 Scenario: ${name}`);
    console.log('─'.repeat(60));

    try {
      const result = await testFunc();
      this.scenarios.push({ name, passed: true, details: result });
      console.log('✅ PASSED\n');
      return true;
    } catch (error) {
      this.scenarios.push({ name, passed: false, error: error.message });
      console.log(`❌ FAILED: ${error.message}\n`);
      return false;
    }
  }

  async runTests() {
    console.log('📋 Real-World Usage Scenarios\n');
    console.log('─'.repeat(60));

    // Scenario 1: Research a topic
    await this.runScenario('Research a new technology', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'search_web',
        arguments: { query: 'Next.js 14 features', limit: 5 }
      });

      if (response.error) throw new Error(response.error.message);

      const data = JSON.parse(response.result.content[0].text);
      if (!data.results || data.results.length === 0) {
        throw new Error('No search results returned');
      }

      console.log(`  Found ${data.results.length} articles about Next.js 14`);
      return `Found ${data.results.length} results`;
    });

    // Scenario 2: Extract documentation
    await this.runScenario('Extract documentation from a website', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'extract_content',
        arguments: { url: 'https://example.com' }
      });

      if (response.error) throw new Error(response.error.message);

      const data = JSON.parse(response.result.content[0].text);
      if (!data.content) {
        throw new Error('No content extracted');
      }

      console.log(`  Extracted ${data.content.length} characters of content`);
      return `Extracted ${data.content.length} chars`;
    });

    // Scenario 3: Scrape multiple pages
    await this.runScenario('Scrape multiple product pages', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'batch_scrape',
        arguments: {
          urls: ['https://example.com', 'https://example.org', 'https://example.net'],
          formats: ['json'],
          mode: 'sync',
          maxConcurrency: 3
        }
      });

      if (response.error) throw new Error(response.error.message);

      const data = JSON.parse(response.result.content[0].text);
      if (!data.results || data.results.length === 0) {
        throw new Error('No scraping results returned');
      }

      const successful = data.results.filter(r => r.success).length;
      console.log(`  Successfully scraped ${successful}/${data.results.length} pages`);
      return `${successful}/${data.results.length} successful`;
    });

    // Scenario 4: Analyze website structure
    await this.runScenario('Map website structure for sitemap', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'map_site',
        arguments: { url: 'https://example.com', max_urls: 20 }
      });

      if (response.error) throw new Error(response.error.message);

      const data = JSON.parse(response.result.content[0].text);
      if (!data.urls || data.urls.length === 0) {
        throw new Error('No URLs found');
      }

      console.log(`  Mapped ${data.urls.length} URLs`);
      return `Mapped ${data.urls.length} URLs`;
    });

    // Scenario 5: Extract structured data
    await this.runScenario('Extract pricing information', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'scrape_structured',
        arguments: {
          url: 'https://example.com',
          selectors: {
            title: 'h1',
            description: 'p',
            links: 'a'
          }
        }
      });

      if (response.error) throw new Error(response.error.message);

      const data = JSON.parse(response.result.content[0].text);
      console.log(`  Extracted structured data with ${Object.keys(data).length} fields`);
      return `Extracted ${Object.keys(data).length} fields`;
    });

    // Scenario 6: Monitor content changes
    await this.runScenario('Check if website content changed', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'extract_text',
        arguments: { url: 'https://example.com' }
      });

      if (response.error) throw new Error(response.error.message);

      const data = JSON.parse(response.result.content[0].text);
      if (!data.text) {
        throw new Error('No text extracted');
      }

      console.log(`  Retrieved ${data.text.length} characters for comparison`);
      return `Retrieved ${data.text.length} chars`;
    });

    // Scenario 7: Browser automation
    await this.runScenario('Fill form and take screenshot', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'scrape_with_actions',
        arguments: {
          url: 'https://example.com',
          actions: [
            { type: 'wait', timeout: 1000 },
            { type: 'screenshot' }
          ],
          formats: ['json', 'screenshots']
        }
      });

      if (response.error) throw new Error(response.error.message);

      const data = JSON.parse(response.result.content[0].text);
      console.log(`  Executed ${data.executedActions || 0} actions`);
      return `Executed ${data.executedActions || 0} actions`;
    });

    // Scenario 8: Content analysis
    await this.runScenario('Analyze article readability', async () => {
      const textResponse = await this.sendRequest('tools/call', {
        name: 'extract_text',
        arguments: { url: 'https://example.com' }
      });

      if (textResponse.error) throw new Error(textResponse.error.message);
      const textData = JSON.parse(textResponse.result.content[0].text);

      const analyzeResponse = await this.sendRequest('tools/call', {
        name: 'analyze_content',
        arguments: { text: textData.text.substring(0, 500) }
      });

      if (analyzeResponse.error) throw new Error(analyzeResponse.error.message);
      const analysis = JSON.parse(analyzeResponse.result.content[0].text);

      console.log(`  Analyzed ${analysis.wordCount || 0} words`);
      return `Analyzed ${analysis.wordCount || 0} words`;
    });

    console.log('\n' + '─'.repeat(60));
    this.printSummary();
  }

  printSummary() {
    const passed = this.scenarios.filter(s => s.passed).length;
    const failed = this.scenarios.filter(s => !s.passed).length;
    const total = this.scenarios.length;

    console.log('\n📊 Real-World Test Summary\n');
    console.log('─'.repeat(60));
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${failed}/${total}`);
    console.log(`📈 Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
    console.log('─'.repeat(60) + '\n');

    if (failed > 0) {
      console.log('⚠️  Failed Scenarios:\n');
      this.scenarios.filter(s => !s.passed).forEach(s => {
        console.log(`  • ${s.name}`);
        console.log(`    Error: ${s.error}\n`);
      });
    } else {
      console.log('🎉 All real-world scenarios passed!');
      console.log('   CrawlForge is ready for production use.\n');
    }
  }

  async cleanup() {
    if (this.server) {
      this.server.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

const tester = new RealWorldTester();

tester.start()
  .then(() => tester.runTests())
  .then(() => tester.cleanup())
  .then(() => {
    const failed = tester.scenarios.filter(s => !s.passed).length;
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('❌ Test suite failed:', error);
    tester.cleanup();
    process.exit(1);
  });
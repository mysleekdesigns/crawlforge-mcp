/**
 * Tool Integration Tests
 * Comprehensive integration tests for all 12 MCP WebScraper tools
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Tool Integration Test Configuration
 */
const TOOL_TEST_CONFIG = {
  serverTimeout: 10000,
  requestTimeout: 30000, // Longer timeout for complex operations
  testUrls: {
    basic: 'https://httpbin.org',
    html: 'https://httpbin.org/html',
    json: 'https://httpbin.org/json',
    delay: 'https://httpbin.org/delay/1',
    status: 'https://httpbin.org/status/200',
    large: 'https://httpbin.org/bytes/10240' // 10KB
  },
  expectedTools: [
    'fetch_url', 'extract_text', 'extract_links', 'extract_metadata', 
    'scrape_structured', 'crawl_deep', 'map_site', 'extract_content',
    'process_document', 'summarize_content', 'analyze_content'
    // Note: search_web is conditional
  ]
};

/**
 * Tool Test Results Collector
 */
class ToolTestResults {
  constructor() {
    this.reset();
  }

  reset() {
    this.tools = new Map();
    this.testCases = new Map();
    this.performanceMetrics = [];
    this.errors = [];
    this.startTime = Date.now();
  }

  addToolTest(toolName, testCase, result) {
    if (!this.tools.has(toolName)) {
      this.tools.set(toolName, []);
    }
    
    const testResult = {
      ...result,
      testCase,
      timestamp: Date.now(),
      duration: Date.now() - this.startTime
    };
    
    this.tools.get(toolName).push(testResult);
    this.testCases.set(`${toolName}-${testCase}`, testResult);
  }

  addError(toolName, testCase, error) {
    this.errors.push({
      toolName,
      testCase,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });
  }

  addPerformanceMetric(toolName, metric) {
    this.performanceMetrics.push({
      toolName,
      ...metric,
      timestamp: Date.now()
    });
  }

  getSummary() {
    const totalTests = Array.from(this.tools.values()).reduce((sum, tests) => sum + tests.length, 0);
    const passedTests = Array.from(this.tools.values()).reduce((sum, tests) => 
      sum + tests.filter(t => t.success).length, 0);
    const failedTests = totalTests - passedTests;
    
    const toolSummaries = {};
    for (const [toolName, tests] of this.tools) {
      const toolPassed = tests.filter(t => t.success).length;
      toolSummaries[toolName] = {
        total: tests.length,
        passed: toolPassed,
        failed: tests.length - toolPassed,
        successRate: tests.length > 0 ? (toolPassed / tests.length) * 100 : 0
      };
    }
    
    return {
      totalTests,
      passedTests,
      failedTests,
      successRate: totalTests > 0 ? (passedTests / totalTests) * 100 : 0,
      totalErrors: this.errors.length,
      duration: Date.now() - this.startTime,
      toolsTestedCount: this.tools.size,
      toolSummaries,
      performanceMetrics: this.performanceMetrics.length
    };
  }
}

/**
 * Tool Integration Test Suite
 */
class ToolIntegrationTestSuite {
  constructor() {
    this.results = new ToolTestResults();
    this.serverProcess = null;
    this.requestId = 1;
  }

  /**
   * Run comprehensive tool integration tests
   */
  async runToolIntegrationTests() {
    console.log('⚙️ Starting Tool Integration Tests...');
    console.log('─'.repeat(60));
    
    try {
      // Setup test environment
      await this.setupTestEnvironment();
      
      // Test each tool individually
      console.log('🔧 Testing Basic Tools...');
      await this.testBasicTools();
      
      console.log('\n🔍 Testing Search Tools...');
      await this.testSearchTools();
      
      console.log('\n🕷️ Testing Crawl Tools...');
      await this.testCrawlTools();
      
      console.log('\n📄 Testing Content Processing Tools...');
      await this.testContentProcessingTools();
      
      console.log('\n🧠 Testing Analysis Tools...');
      await this.testAnalysisTools();
      
      console.log('\n⚡ Testing Performance Characteristics...');
      await this.testToolPerformance();
      
      console.log('\n🔗 Testing Tool Interactions...');
      await this.testToolInteractions();
      
      console.log('\n🛡️ Testing Error Scenarios...');
      await this.testToolErrorScenarios();
      
      // Generate tool integration report
      const report = this.generateToolReport();
      await this.saveToolReport(report);
      
      return report;
      
    } catch (error) {
      console.error('❌ Tool integration test suite failed:', error);
      this.results.addError('suite', 'general', error);
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
        clientInfo: { name: 'tool-integration-test', version: '1.0.0' }
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
   * Test basic tools: fetch_url, extract_text, extract_links, extract_metadata, scrape_structured
   */
  async testBasicTools() {
    // Test fetch_url
    await this.testFetchUrl();
    
    // Test extract_text
    await this.testExtractText();
    
    // Test extract_links
    await this.testExtractLinks();
    
    // Test extract_metadata
    await this.testExtractMetadata();
    
    // Test scrape_structured
    await this.testScrapeStructured();
  }

  /**
   * Test fetch_url tool
   */
  async testFetchUrl() {
    const toolName = 'fetch_url';
    console.log(`   Testing ${toolName}...`);
    
    const testCases = [
      {
        name: 'basic-get',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.basic + '/get'
        },
        validate: (result) => {
          return result && 
                 typeof result.status === 'number' && 
                 result.status === 200 &&
                 typeof result.body === 'string' &&
                 result.body.length > 0;
        }
      },
      {
        name: 'with-timeout',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.delay,
          timeout: 5000
        },
        validate: (result) => {
          return result && result.status === 200;
        }
      },
      {
        name: 'with-headers',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.basic + '/headers',
          headers: {
            'User-Agent': 'Test-Agent',
            'Accept': 'application/json'
          }
        },
        validate: (result) => {
          return result && result.status === 200 && 
                 result.body.includes('Test-Agent');
        }
      },
      {
        name: 'large-response',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.large
        },
        validate: (result) => {
          return result && result.status === 200 && 
                 result.size >= 10240;
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase);
    }
  }

  /**
   * Test extract_text tool
   */
  async testExtractText() {
    const toolName = 'extract_text';
    console.log(`   Testing ${toolName}...`);
    
    const testCases = [
      {
        name: 'basic-html',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html
        },
        validate: (result) => {
          return result && 
                 typeof result.text === 'string' &&
                 result.text.length > 0 &&
                 typeof result.word_count === 'number' &&
                 typeof result.char_count === 'number';
        }
      },
      {
        name: 'remove-scripts',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html,
          remove_scripts: true
        },
        validate: (result) => {
          return result && 
                 typeof result.text === 'string' &&
                 !result.text.includes('<script>');
        }
      },
      {
        name: 'remove-styles',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html,
          remove_styles: true
        },
        validate: (result) => {
          return result && 
                 typeof result.text === 'string' &&
                 !result.text.includes('<style>');
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase);
    }
  }

  /**
   * Test extract_links tool
   */
  async testExtractLinks() {
    const toolName = 'extract_links';
    console.log(`   Testing ${toolName}...`);
    
    const testCases = [
      {
        name: 'all-links',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.links) &&
                 typeof result.total_count === 'number' &&
                 typeof result.internal_count === 'number' &&
                 typeof result.external_count === 'number';
        }
      },
      {
        name: 'filter-external',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html,
          filter_external: true
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.links) &&
                 result.external_count === 0;
        }
      },
      {
        name: 'with-base-url',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html,
          base_url: TOOL_TEST_CONFIG.testUrls.basic
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.links) &&
                 result.base_url === TOOL_TEST_CONFIG.testUrls.basic;
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase);
    }
  }

  /**
   * Test extract_metadata tool
   */
  async testExtractMetadata() {
    const toolName = 'extract_metadata';
    console.log(`   Testing ${toolName}...`);
    
    const testCases = [
      {
        name: 'html-metadata',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html
        },
        validate: (result) => {
          return result && 
                 typeof result.title === 'string' &&
                 typeof result.description === 'string' &&
                 Array.isArray(result.keywords) &&
                 typeof result.og_tags === 'object' &&
                 typeof result.twitter_tags === 'object';
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase);
    }
  }

  /**
   * Test scrape_structured tool
   */
  async testScrapeStructured() {
    const toolName = 'scrape_structured';
    console.log(`   Testing ${toolName}...`);
    
    const testCases = [
      {
        name: 'basic-selectors',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html,
          selectors: {
            title: 'title',
            heading: 'h1',
            body: 'body'
          }
        },
        validate: (result) => {
          return result && 
                 result.data &&
                 typeof result.data.title === 'string' &&
                 typeof result.elements_found === 'number';
        }
      },
      {
        name: 'multiple-elements',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html,
          selectors: {
            links: 'a',
            paragraphs: 'p'
          }
        },
        validate: (result) => {
          return result && 
                 result.data &&
                 (Array.isArray(result.data.links) || typeof result.data.links === 'string');
        }
      },
      {
        name: 'invalid-selector',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html,
          selectors: {
            invalid: 'invalid[selector'
          }
        },
        validate: (result) => {
          return result && 
                 result.data &&
                 (result.data.invalid === null || result.data.invalid.error);
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase);
    }
  }

  /**
   * Test search tools (if available)
   */
  async testSearchTools() {
    // Check if search_web is available
    const toolsResponse = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'tools/list'
    });
    
    const availableTools = toolsResponse.result?.tools?.map(t => t.name) || [];
    
    if (availableTools.includes('search_web')) {
      await this.testSearchWeb();
    } else {
      console.log('   ⚠️ search_web tool not configured, skipping search tests');
    }
  }

  /**
   * Test search_web tool
   */
  async testSearchWeb() {
    const toolName = 'search_web';
    console.log(`   Testing ${toolName}...`);
    
    const testCases = [
      {
        name: 'basic-search',
        args: {
          query: 'nodejs web scraping',
          limit: 5
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.results) &&
                 result.results.length > 0 &&
                 typeof result.query === 'string';
        }
      },
      {
        name: 'limited-results',
        args: {
          query: 'javascript',
          limit: 3
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.results) &&
                 result.results.length <= 3;
        }
      },
      {
        name: 'with-filters',
        args: {
          query: 'programming',
          limit: 5,
          lang: 'en',
          safe_search: true
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.results) &&
                 result.results.length > 0;
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase);
    }
  }

  /**
   * Test crawl tools: crawl_deep, map_site
   */
  async testCrawlTools() {
    await this.testCrawlDeep();
    await this.testMapSite();
  }

  /**
   * Test crawl_deep tool
   */
  async testCrawlDeep() {
    const toolName = 'crawl_deep';
    console.log(`   Testing ${toolName}...`);
    
    const testCases = [
      {
        name: 'basic-crawl',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.basic,
          max_depth: 1,
          max_pages: 5
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.pages) &&
                 typeof result.total_pages === 'number' &&
                 typeof result.crawl_depth === 'number';
        }
      },
      {
        name: 'with-patterns',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.basic,
          max_depth: 1,
          max_pages: 3,
          include_patterns: ['.*get.*'],
          exclude_patterns: ['.*post.*']
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.pages) &&
                 result.pages.length > 0;
        }
      },
      {
        name: 'extract-content',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html,
          max_depth: 1,
          max_pages: 2,
          extract_content: true
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.pages) &&
                 result.pages.some(page => page.content && page.content.length > 0);
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase, 20000); // Longer timeout for crawling
    }
  }

  /**
   * Test map_site tool
   */
  async testMapSite() {
    const toolName = 'map_site';
    console.log(`   Testing ${toolName}...`);
    
    const testCases = [
      {
        name: 'basic-mapping',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.basic,
          max_urls: 10
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.urls) &&
                 typeof result.total_urls === 'number' &&
                 typeof result.site_structure === 'object';
        }
      },
      {
        name: 'with-grouping',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.basic,
          max_urls: 10,
          group_by_path: true
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.urls) &&
                 typeof result.site_structure === 'object';
        }
      },
      {
        name: 'with-metadata',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html,
          max_urls: 5,
          include_metadata: true
        },
        validate: (result) => {
          return result && 
                 Array.isArray(result.urls) &&
                 result.urls.some(url => url.metadata);
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase, 15000); // Longer timeout for mapping
    }
  }

  /**
   * Test content processing tools: extract_content, process_document
   */
  async testContentProcessingTools() {
    await this.testExtractContent();
    await this.testProcessDocument();
  }

  /**
   * Test extract_content tool
   */
  async testExtractContent() {
    const toolName = 'extract_content';
    console.log(`   Testing ${toolName}...`);
    
    const testCases = [
      {
        name: 'basic-extraction',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html
        },
        validate: (result) => {
          return result && 
                 typeof result.content === 'string' &&
                 result.content.length > 0 &&
                 typeof result.title === 'string';
        }
      },
      {
        name: 'with-options',
        args: {
          url: TOOL_TEST_CONFIG.testUrls.html,
          options: {
            include_links: true,
            include_images: true
          }
        },
        validate: (result) => {
          return result && 
                 typeof result.content === 'string' &&
                 result.content.length > 0;
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase);
    }
  }

  /**
   * Test process_document tool
   */
  async testProcessDocument() {
    const toolName = 'process_document';
    console.log(`   Testing ${toolName}...`);
    
    const testCases = [
      {
        name: 'web-document',
        args: {
          source: TOOL_TEST_CONFIG.testUrls.html,
          sourceType: 'url'
        },
        validate: (result) => {
          return result && 
                 typeof result.content === 'string' &&
                 result.content.length > 0 &&
                 typeof result.sourceType === 'string';
        }
      },
      {
        name: 'with-processing-options',
        args: {
          source: TOOL_TEST_CONFIG.testUrls.html,
          sourceType: 'url',
          options: {
            extract_tables: true,
            extract_forms: true
          }
        },
        validate: (result) => {
          return result && 
                 typeof result.content === 'string' &&
                 result.content.length > 0;
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase);
    }
  }

  /**
   * Test analysis tools: summarize_content, analyze_content
   */
  async testAnalysisTools() {
    await this.testSummarizeContent();
    await this.testAnalyzeContent();
  }

  /**
   * Test summarize_content tool
   */
  async testSummarizeContent() {
    const toolName = 'summarize_content';
    console.log(`   Testing ${toolName}...`);
    
    const sampleText = `
      Web scraping is a technique used to extract data from websites. It involves making HTTP requests 
      to web pages and parsing the HTML content to extract specific information. Web scraping can be 
      useful for data collection, market research, and automation tasks. However, it's important to 
      respect robots.txt files and website terms of service when scraping data.
    `;
    
    const testCases = [
      {
        name: 'basic-summary',
        args: {
          text: sampleText
        },
        validate: (result) => {
          return result && 
                 typeof result.summary === 'string' &&
                 result.summary.length > 0 &&
                 result.summary.length < sampleText.length;
        }
      },
      {
        name: 'with-options',
        args: {
          text: sampleText,
          options: {
            max_sentences: 2,
            include_keywords: true
          }
        },
        validate: (result) => {
          return result && 
                 typeof result.summary === 'string' &&
                 result.summary.length > 0;
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase);
    }
  }

  /**
   * Test analyze_content tool
   */
  async testAnalyzeContent() {
    const toolName = 'analyze_content';
    console.log(`   Testing ${toolName}...`);
    
    const sampleText = `
      JavaScript is a programming language that is widely used for web development. 
      It was created by Brendan Eich in 1995 and has become one of the most popular 
      programming languages in the world. JavaScript enables interactive web pages 
      and is an essential part of web applications.
    `;
    
    const testCases = [
      {
        name: 'basic-analysis',
        args: {
          text: sampleText
        },
        validate: (result) => {
          return result && 
                 typeof result.language === 'string' &&
                 Array.isArray(result.topics) &&
                 typeof result.word_count === 'number';
        }
      },
      {
        name: 'with-analysis-options',
        args: {
          text: sampleText,
          options: {
            include_sentiment: true,
            include_entities: true,
            include_keywords: true
          }
        },
        validate: (result) => {
          return result && 
                 typeof result.language === 'string' &&
                 result.word_count > 0;
        }
      }
    ];
    
    for (const testCase of testCases) {
      await this.executeToolTest(toolName, testCase);
    }
  }

  /**
   * Test tool performance characteristics
   */
  async testToolPerformance() {
    console.log('   Testing tool performance...');
    
    const performanceTests = [
      {
        toolName: 'fetch_url',
        args: { url: TOOL_TEST_CONFIG.testUrls.basic + '/get' }
      },
      {
        toolName: 'extract_text',
        args: { url: TOOL_TEST_CONFIG.testUrls.html }
      },
      {
        toolName: 'extract_metadata',
        args: { url: TOOL_TEST_CONFIG.testUrls.html }
      }
    ];
    
    for (const test of performanceTests) {
      const iterations = 3;
      const responseTimes = [];
      
      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        
        try {
          const response = await this.sendToolRequest(test.toolName, test.args);
          const responseTime = Date.now() - startTime;
          
          if (!response.error) {
            responseTimes.push(responseTime);
          }
        } catch (error) {
          console.warn(`Performance test failed for ${test.toolName}:`, error.message);
        }
      }
      
      if (responseTimes.length > 0) {
        const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
        const minResponseTime = Math.min(...responseTimes);
        const maxResponseTime = Math.max(...responseTimes);
        
        this.results.addPerformanceMetric(test.toolName, {
          iterations,
          avgResponseTime,
          minResponseTime,
          maxResponseTime,
          successfulTests: responseTimes.length
        });
        
        console.log(`     ${test.toolName}: avg ${avgResponseTime.toFixed(0)}ms`);
      }
    }
  }

  /**
   * Test tool interactions and chaining
   */
  async testToolInteractions() {
    console.log('   Testing tool interactions...');
    
    try {
      // Chain: fetch_url -> extract_text
      const fetchResponse = await this.sendToolRequest('fetch_url', {
        url: TOOL_TEST_CONFIG.testUrls.html
      });
      
      if (!fetchResponse.error && fetchResponse.result) {
        // Use the URL from fetch response for extract_text
        const extractResponse = await this.sendToolRequest('extract_text', {
          url: fetchResponse.result.content[0].url
        });
        
        const chainSuccess = !extractResponse.error && extractResponse.result;
        
        this.results.addToolTest('tool-interactions', 'fetch-extract-chain', {
          success: chainSuccess,
          fetchSuccess: !fetchResponse.error,
          extractSuccess: !extractResponse.error
        });
      }
      
      // Chain: extract_links -> analyze multiple URLs
      const linksResponse = await this.sendToolRequest('extract_links', {
        url: TOOL_TEST_CONFIG.testUrls.html,
        filter_external: true
      });
      
      if (!linksResponse.error && linksResponse.result) {
        const links = linksResponse.result.content[0].links || [];
        const linkAnalysisSuccess = links.length > 0;
        
        this.results.addToolTest('tool-interactions', 'links-analysis-chain', {
          success: linkAnalysisSuccess,
          linksExtracted: links.length,
          linksResponse: !linksResponse.error
        });
      }
      
    } catch (error) {
      this.results.addError('tool-interactions', 'chain-test', error);
    }
  }

  /**
   * Test tool error scenarios
   */
  async testToolErrorScenarios() {
    console.log('   Testing error scenarios...');
    
    const errorTests = [
      {
        toolName: 'fetch_url',
        testCase: 'invalid-url',
        args: { url: 'not-a-valid-url' },
        expectError: true
      },
      {
        toolName: 'fetch_url',
        testCase: 'nonexistent-domain',
        args: { url: 'https://nonexistent-domain-12345.com' },
        expectError: true
      },
      {
        toolName: 'extract_text',
        testCase: 'invalid-url',
        args: { url: 'not-a-valid-url' },
        expectError: true
      },
      {
        toolName: 'scrape_structured',
        testCase: 'empty-selectors',
        args: { url: TOOL_TEST_CONFIG.testUrls.html, selectors: {} },
        expectError: false // Should handle gracefully
      },
      {
        toolName: 'summarize_content',
        testCase: 'empty-text',
        args: { text: '' },
        expectError: false // Should handle gracefully
      },
      {
        toolName: 'analyze_content',
        testCase: 'empty-text',
        args: { text: '' },
        expectError: false // Should handle gracefully
      }
    ];
    
    for (const test of errorTests) {
      try {
        const response = await this.sendToolRequest(test.toolName, test.args);
        const hasError = !!response.error;
        const success = test.expectError ? hasError : !hasError;
        
        this.results.addToolTest(test.toolName, test.testCase, {
          success,
          expectError: test.expectError,
          hasError,
          errorHandled: hasError,
          errorMessage: response.error?.message
        });
        
      } catch (error) {
        this.results.addError(test.toolName, test.testCase, error);
        this.results.addToolTest(test.toolName, test.testCase, {
          success: test.expectError,
          expectError: test.expectError,
          hasError: true,
          caughtException: true
        });
      }
    }
  }

  // Helper methods

  /**
   * Execute a tool test case
   */
  async executeToolTest(toolName, testCase, timeout = TOOL_TEST_CONFIG.requestTimeout) {
    try {
      const startTime = Date.now();
      const response = await this.sendToolRequest(toolName, testCase.args, timeout);
      const responseTime = Date.now() - startTime;
      
      if (response.error) {
        this.results.addToolTest(toolName, testCase.name, {
          success: false,
          error: response.error.message,
          responseTime
        });
        return;
      }
      
      const result = response.result?.content?.[0];
      const isValid = testCase.validate(result);
      
      this.results.addToolTest(toolName, testCase.name, {
        success: isValid,
        responseTime,
        resultValid: isValid,
        resultStructure: result ? Object.keys(result) : []
      });
      
    } catch (error) {
      this.results.addError(toolName, testCase.name, error);
      this.results.addToolTest(toolName, testCase.name, {
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Send a tool request
   */
  async sendToolRequest(toolName, args, timeout = TOOL_TEST_CONFIG.requestTimeout) {
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
      }, TOOL_TEST_CONFIG.serverTimeout);
    });
  }

  /**
   * Send request to server
   */
  async sendRequest(request, timeout = TOOL_TEST_CONFIG.requestTimeout) {
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
   * Generate tool integration report
   */
  generateToolReport() {
    const summary = this.results.getSummary();
    
    return {
      timestamp: new Date().toISOString(),
      configuration: TOOL_TEST_CONFIG,
      summary,
      toolAnalysis: this.analyzeToolResults(summary),
      performanceAnalysis: this.analyzePerformanceMetrics(),
      errors: this.results.errors,
      recommendations: this.generateToolRecommendations(summary)
    };
  }

  /**
   * Analyze tool test results
   */
  analyzeToolResults(summary) {
    const analysis = {
      status: 'PASS',
      issues: [],
      strengths: []
    };
    
    if (summary.successRate < 80) {
      analysis.status = 'FAIL';
      analysis.issues.push(`Low overall success rate: ${summary.successRate.toFixed(1)}%`);
    } else if (summary.successRate < 95) {
      analysis.status = 'WARNING';
      analysis.issues.push(`Moderate success rate: ${summary.successRate.toFixed(1)}%`);
    } else {
      analysis.strengths.push(`High success rate: ${summary.successRate.toFixed(1)}%`);
    }
    
    // Analyze individual tools
    for (const [toolName, toolSummary] of Object.entries(summary.toolSummaries)) {
      if (toolSummary.successRate < 80) {
        analysis.issues.push(`Tool ${toolName} has low success rate: ${toolSummary.successRate.toFixed(1)}%`);
      } else if (toolSummary.successRate === 100) {
        analysis.strengths.push(`Tool ${toolName} has perfect success rate`);
      }
    }
    
    return analysis;
  }

  /**
   * Analyze performance metrics
   */
  analyzePerformanceMetrics() {
    const metrics = this.results.performanceMetrics;
    
    if (metrics.length === 0) {
      return { status: 'NO_DATA' };
    }
    
    const avgPerformance = metrics.reduce((sum, m) => sum + m.avgResponseTime, 0) / metrics.length;
    
    return {
      status: 'ANALYZED',
      overallAverageResponseTime: avgPerformance,
      fastestTool: metrics.reduce((min, m) => m.avgResponseTime < min.avgResponseTime ? m : min),
      slowestTool: metrics.reduce((max, m) => m.avgResponseTime > max.avgResponseTime ? m : max),
      performanceRating: this.ratePerformance(avgPerformance)
    };
  }

  /**
   * Rate overall performance
   */
  ratePerformance(avgResponseTime) {
    if (avgResponseTime < 1000) return 'EXCELLENT';
    if (avgResponseTime < 3000) return 'GOOD';
    if (avgResponseTime < 10000) return 'ACCEPTABLE';
    return 'POOR';
  }

  /**
   * Generate tool recommendations
   */
  generateToolRecommendations(summary) {
    const recommendations = [];
    
    if (summary.successRate < 95) {
      recommendations.push('Investigate and fix tool implementation issues');
    }
    
    // Tool-specific recommendations
    for (const [toolName, toolSummary] of Object.entries(summary.toolSummaries)) {
      if (toolSummary.successRate < 90) {
        recommendations.push(`Review ${toolName} implementation for reliability issues`);
      }
    }
    
    if (this.results.errors.length > 0) {
      recommendations.push('Review error handling in tools with failures');
    }
    
    const perfAnalysis = this.analyzePerformanceMetrics();
    if (perfAnalysis.performanceRating === 'POOR') {
      recommendations.push('Optimize tool performance for better response times');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('All tools are functioning well');
      recommendations.push('Continue monitoring for regressions');
    }
    
    return recommendations;
  }

  /**
   * Save tool integration report
   */
  async saveToolReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `tool-integration-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📄 Tool integration report saved: ${filepath}`);
    } catch (error) {
      console.error('❌ Failed to save tool report:', error.message);
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
 * Main tool integration test execution
 */
async function runToolIntegrationTests() {
  console.log('⚙️ Starting Tool Integration Test Suite...');
  
  const testSuite = new ToolIntegrationTestSuite();
  
  try {
    const report = await testSuite.runToolIntegrationTests();
    
    console.log('\n📋 Tool Integration Test Summary:');
    console.log('─'.repeat(60));
    console.log(`✅ Status: ${report.toolAnalysis.status}`);
    console.log(`📊 Total Tests: ${report.summary.totalTests}`);
    console.log(`🎯 Success Rate: ${report.summary.successRate.toFixed(1)}%`);
    console.log(`❌ Total Errors: ${report.summary.totalErrors}`);
    console.log(`⏱️ Duration: ${(report.summary.duration / 1000).toFixed(1)}s`);
    console.log(`🔧 Tools Tested: ${report.summary.toolsTestedCount}`);
    
    if (report.performanceAnalysis.status === 'ANALYZED') {
      console.log(`⚡ Performance Rating: ${report.performanceAnalysis.performanceRating}`);
      console.log(`📈 Average Response Time: ${report.performanceAnalysis.overallAverageResponseTime.toFixed(0)}ms`);
    }
    
    if (report.toolAnalysis.issues.length > 0) {
      console.log('\n⚠️ Issues Identified:');
      report.toolAnalysis.issues.forEach(issue => console.log(`   • ${issue}`));
    }
    
    if (report.toolAnalysis.strengths.length > 0) {
      console.log('\n✨ Strengths:');
      report.toolAnalysis.strengths.forEach(strength => console.log(`   • ${strength}`));
    }
    
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach(rec => console.log(`   • ${rec}`));
    
    return report;
    
  } catch (error) {
    console.error('❌ Tool integration test failed:', error);
    throw error;
  }
}

// Export for use in other test files
export { ToolIntegrationTestSuite, runToolIntegrationTests };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runToolIntegrationTests()
    .then(() => {
      console.log('✅ Tool integration test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Tool integration test failed:', error);
      process.exit(1);
    });
}
/**
 * End-to-End Workflow Integration Tests
 * Tests real-world usage scenarios and tool combinations
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * End-to-End Workflow Test Configuration
 */
const E2E_TEST_CONFIG = {
  serverTimeout: 15000,
  requestTimeout: 45000, // Longer timeout for complex workflows
  maxRetries: 2,
  testSites: {
    blog: 'https://httpbin.org',
    documentation: 'https://httpbin.org/html',
    ecommerce: 'https://httpbin.org/json',
    news: 'https://httpbin.org/xml'
  },
  workflows: {
    maxConcurrentTasks: 5,
    chainTimeout: 60000
  }
};

/**
 * Workflow Test Results Collector
 */
class WorkflowTestResults {
  constructor() {
    this.reset();
  }

  reset() {
    this.workflows = new Map();
    this.workflowSteps = [];
    this.performanceMetrics = [];
    this.errors = [];
    this.startTime = Date.now();
  }

  addWorkflow(workflowName, result) {
    this.workflows.set(workflowName, {
      ...result,
      timestamp: Date.now(),
      duration: Date.now() - this.startTime
    });
  }

  addWorkflowStep(workflowName, stepName, result) {
    this.workflowSteps.push({
      workflowName,
      stepName,
      ...result,
      timestamp: Date.now()
    });
  }

  addPerformanceMetric(workflowName, metric) {
    this.performanceMetrics.push({
      workflowName,
      ...metric,
      timestamp: Date.now()
    });
  }

  addError(workflowName, error) {
    this.errors.push({
      workflowName,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });
  }

  getSummary() {
    const totalWorkflows = this.workflows.size;
    const passedWorkflows = Array.from(this.workflows.values()).filter(w => w.success).length;
    const failedWorkflows = totalWorkflows - passedWorkflows;
    
    const totalSteps = this.workflowSteps.length;
    const passedSteps = this.workflowSteps.filter(s => s.success).length;
    
    return {
      totalWorkflows,
      passedWorkflows,
      failedWorkflows,
      successRate: totalWorkflows > 0 ? (passedWorkflows / totalWorkflows) * 100 : 0,
      totalSteps,
      passedSteps,
      stepSuccessRate: totalSteps > 0 ? (passedSteps / totalSteps) * 100 : 0,
      totalErrors: this.errors.length,
      duration: Date.now() - this.startTime,
      performanceMetrics: this.performanceMetrics.length,
      workflows: Object.fromEntries(this.workflows)
    };
  }
}

/**
 * End-to-End Workflow Test Suite
 */
class EndToEndWorkflowTestSuite {
  constructor() {
    this.results = new WorkflowTestResults();
    this.serverProcess = null;
    this.requestId = 1;
  }

  /**
   * Run comprehensive end-to-end workflow tests
   */
  async runWorkflowTests() {
    console.log('🔄 Starting End-to-End Workflow Tests...');
    console.log('─'.repeat(60));
    
    try {
      // Setup test environment
      await this.setupTestEnvironment();
      
      // Workflow 1: Content Research Pipeline
      console.log('📚 Workflow 1: Content Research Pipeline');
      await this.testContentResearchWorkflow();
      
      // Workflow 2: Website Analysis Workflow
      console.log('\n🔍 Workflow 2: Website Analysis Workflow');
      await this.testWebsiteAnalysisWorkflow();
      
      // Workflow 3: Competitive Intelligence Workflow
      console.log('\n🕵️ Workflow 3: Competitive Intelligence Workflow');
      await this.testCompetitiveIntelligenceWorkflow();
      
      // Workflow 4: Content Extraction and Processing
      console.log('\n📄 Workflow 4: Content Extraction Pipeline');
      await this.testContentExtractionWorkflow();
      
      // Workflow 5: Site Mapping and Discovery
      console.log('\n🗺️ Workflow 5: Site Discovery Workflow');
      await this.testSiteDiscoveryWorkflow();
      
      // Workflow 6: Multi-Source Data Aggregation
      console.log('\n📊 Workflow 6: Data Aggregation Workflow');
      await this.testDataAggregationWorkflow();
      
      // Workflow 7: Content Validation Pipeline
      console.log('\n✅ Workflow 7: Content Validation Workflow');
      await this.testContentValidationWorkflow();
      
      // Workflow 8: Performance Monitoring Workflow
      console.log('\n⚡ Workflow 8: Performance Monitoring Workflow');
      await this.testPerformanceMonitoringWorkflow();
      
      // Workflow 9: Error Recovery Workflow
      console.log('\n🛠️ Workflow 9: Error Recovery Workflow');
      await this.testErrorRecoveryWorkflow();
      
      // Workflow 10: Real-World Simulation
      console.log('\n🌍 Workflow 10: Real-World Simulation');
      await this.testRealWorldSimulation();
      
      // Generate workflow report
      const report = this.generateWorkflowReport();
      await this.saveWorkflowReport(report);
      
      return report;
      
    } catch (error) {
      console.error('❌ End-to-end workflow test suite failed:', error);
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
        clientInfo: { name: 'e2e-workflow-test', version: '1.0.0' }
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
   * Test content research workflow
   * Flow: Search -> Extract Links -> Analyze Content -> Summarize
   */
  async testContentResearchWorkflow() {
    const workflowName = 'content-research';
    const startTime = Date.now();
    
    try {
      console.log('   Step 1: Discovering content sources...');
      
      // Step 1: Get initial page and extract links
      const linksResponse = await this.sendToolRequest('extract_links', {
        url: E2E_TEST_CONFIG.testSites.blog,
        filter_external: false
      });
      
      const step1Success = !linksResponse.error && linksResponse.result;
      this.results.addWorkflowStep(workflowName, 'extract-links', {
        success: step1Success,
        linksFound: step1Success ? linksResponse.result.content[0].total_count : 0
      });
      
      if (!step1Success) {
        throw new Error('Failed to extract links');
      }
      
      console.log('   Step 2: Extracting content from sources...');
      
      // Step 2: Extract text from a few discovered URLs
      const links = linksResponse.result.content[0].links || [];
      const contentExtractionPromises = links.slice(0, 3).map(link => 
        this.sendToolRequest('extract_text', { url: link.href })
      );
      
      const contentResponses = await Promise.allSettled(contentExtractionPromises);
      const successfulExtractions = contentResponses.filter(r => 
        r.status === 'fulfilled' && !r.value.error
      );
      
      const step2Success = successfulExtractions.length > 0;
      this.results.addWorkflowStep(workflowName, 'extract-content', {
        success: step2Success,
        sourcesProcessed: contentResponses.length,
        successfulExtractions: successfulExtractions.length
      });
      
      console.log('   Step 3: Analyzing extracted content...');
      
      // Step 3: Analyze the extracted content
      if (step2Success) {
        const firstContent = successfulExtractions[0].value.result.content[0];
        const analysisResponse = await this.sendToolRequest('analyze_content', {
          text: firstContent.text.substring(0, 5000) // Limit to first 5000 chars
        });
        
        const step3Success = !analysisResponse.error && analysisResponse.result;
        this.results.addWorkflowStep(workflowName, 'analyze-content', {
          success: step3Success,
          contentAnalyzed: true,
          languageDetected: step3Success ? analysisResponse.result.content[0].language : null
        });
        
        console.log('   Step 4: Generating content summary...');
        
        // Step 4: Summarize the analyzed content
        if (step3Success) {
          const summaryResponse = await this.sendToolRequest('summarize_content', {
            text: firstContent.text.substring(0, 5000)
          });
          
          const step4Success = !summaryResponse.error && summaryResponse.result;
          this.results.addWorkflowStep(workflowName, 'summarize-content', {
            success: step4Success,
            summaryGenerated: step4Success,
            summaryLength: step4Success ? summaryResponse.result.content[0].summary.length : 0
          });
        }
      }
      
      const workflowDuration = Date.now() - startTime;
      const allStepsSuccessful = this.results.workflowSteps
        .filter(s => s.workflowName === workflowName)
        .every(s => s.success);
      
      this.results.addWorkflow(workflowName, {
        success: allStepsSuccessful,
        duration: workflowDuration,
        stepsCompleted: this.results.workflowSteps.filter(s => s.workflowName === workflowName).length,
        allStepsSuccessful
      });
      
      this.results.addPerformanceMetric(workflowName, {
        totalDuration: workflowDuration,
        stepsCount: this.results.workflowSteps.filter(s => s.workflowName === workflowName).length,
        averageStepDuration: workflowDuration / this.results.workflowSteps.filter(s => s.workflowName === workflowName).length
      });
      
      console.log(`   ✅ Content research workflow completed (${workflowDuration}ms)`);
      
    } catch (error) {
      this.results.addError(workflowName, error);
      this.results.addWorkflow(workflowName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Content research workflow failed: ${error.message}`);
    }
  }

  /**
   * Test website analysis workflow
   * Flow: Map Site -> Extract Metadata -> Crawl Structure -> Analyze Content
   */
  async testWebsiteAnalysisWorkflow() {
    const workflowName = 'website-analysis';
    const startTime = Date.now();
    
    try {
      console.log('   Step 1: Mapping site structure...');
      
      // Step 1: Map the site structure
      const mapResponse = await this.sendToolRequest('map_site', {
        url: E2E_TEST_CONFIG.testSites.documentation,
        max_urls: 10,
        group_by_path: true
      });
      
      const step1Success = !mapResponse.error && mapResponse.result;
      this.results.addWorkflowStep(workflowName, 'map-site', {
        success: step1Success,
        urlsDiscovered: step1Success ? mapResponse.result.content[0].total_urls : 0
      });
      
      console.log('   Step 2: Extracting metadata...');
      
      // Step 2: Extract metadata from main page
      const metadataResponse = await this.sendToolRequest('extract_metadata', {
        url: E2E_TEST_CONFIG.testSites.documentation
      });
      
      const step2Success = !metadataResponse.error && metadataResponse.result;
      this.results.addWorkflowStep(workflowName, 'extract-metadata', {
        success: step2Success,
        hasTitle: step2Success ? !!metadataResponse.result.content[0].title : false,
        hasDescription: step2Success ? !!metadataResponse.result.content[0].description : false
      });
      
      console.log('   Step 3: Performing targeted crawl...');
      
      // Step 3: Perform a shallow crawl
      const crawlResponse = await this.sendToolRequest('crawl_deep', {
        url: E2E_TEST_CONFIG.testSites.documentation,
        max_depth: 1,
        max_pages: 5,
        extract_content: true
      });
      
      const step3Success = !crawlResponse.error && crawlResponse.result;
      this.results.addWorkflowStep(workflowName, 'crawl-deep', {
        success: step3Success,
        pagesCrawled: step3Success ? crawlResponse.result.content[0].total_pages : 0
      });
      
      console.log('   Step 4: Analyzing site content patterns...');
      
      // Step 4: Analyze content from crawled pages
      if (step3Success) {
        const pages = crawlResponse.result.content[0].pages || [];
        if (pages.length > 0 && pages[0].content) {
          const analysisResponse = await this.sendToolRequest('analyze_content', {
            text: pages[0].content.substring(0, 3000)
          });
          
          const step4Success = !analysisResponse.error && analysisResponse.result;
          this.results.addWorkflowStep(workflowName, 'analyze-patterns', {
            success: step4Success,
            contentAnalyzed: step4Success,
            topicsIdentified: step4Success ? analysisResponse.result.content[0].topics?.length || 0 : 0
          });
        }
      }
      
      const workflowDuration = Date.now() - startTime;
      const allStepsSuccessful = this.results.workflowSteps
        .filter(s => s.workflowName === workflowName)
        .every(s => s.success);
      
      this.results.addWorkflow(workflowName, {
        success: allStepsSuccessful,
        duration: workflowDuration,
        stepsCompleted: this.results.workflowSteps.filter(s => s.workflowName === workflowName).length,
        comprehensiveAnalysis: allStepsSuccessful
      });
      
      console.log(`   ✅ Website analysis workflow completed (${workflowDuration}ms)`);
      
    } catch (error) {
      this.results.addError(workflowName, error);
      this.results.addWorkflow(workflowName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Website analysis workflow failed: ${error.message}`);
    }
  }

  /**
   * Test competitive intelligence workflow
   * Flow: Multi-site Mapping -> Content Comparison -> Structured Data Extraction
   */
  async testCompetitiveIntelligenceWorkflow() {
    const workflowName = 'competitive-intelligence';
    const startTime = Date.now();
    
    try {
      console.log('   Step 1: Gathering competitor data...');
      
      // Step 1: Collect data from multiple sources
      const competitorSites = [
        E2E_TEST_CONFIG.testSites.blog,
        E2E_TEST_CONFIG.testSites.documentation,
        E2E_TEST_CONFIG.testSites.ecommerce
      ];
      
      const metadataPromises = competitorSites.map(site => 
        this.sendToolRequest('extract_metadata', { url: site })
      );
      
      const metadataResponses = await Promise.allSettled(metadataPromises);
      const successfulMetadata = metadataResponses.filter(r => 
        r.status === 'fulfilled' && !r.value.error
      );
      
      const step1Success = successfulMetadata.length > 0;
      this.results.addWorkflowStep(workflowName, 'gather-metadata', {
        success: step1Success,
        sitesAnalyzed: competitorSites.length,
        successfulAnalyses: successfulMetadata.length
      });
      
      console.log('   Step 2: Extracting structured competitor data...');
      
      // Step 2: Extract structured data from sites
      const structuredPromises = competitorSites.map(site => 
        this.sendToolRequest('scrape_structured', {
          url: site,
          selectors: {
            title: 'title',
            headings: 'h1, h2, h3',
            links: 'a[href]',
            content_sections: 'main, article, .content'
          }
        })
      );
      
      const structuredResponses = await Promise.allSettled(structuredPromises);
      const successfulStructured = structuredResponses.filter(r => 
        r.status === 'fulfilled' && !r.value.error
      );
      
      const step2Success = successfulStructured.length > 0;
      this.results.addWorkflowStep(workflowName, 'extract-structured', {
        success: step2Success,
        structuredExtractions: successfulStructured.length,
        dataPointsCollected: successfulStructured.length * 4 // 4 selectors per site
      });
      
      console.log('   Step 3: Comparing content strategies...');
      
      // Step 3: Analyze and compare content from different sites
      if (step2Success) {
        const firstSiteData = successfulStructured[0].value.result.content[0];
        const titleData = firstSiteData.data.title || '';
        
        if (titleData) {
          const analysisResponse = await this.sendToolRequest('analyze_content', {
            text: titleData
          });
          
          const step3Success = !analysisResponse.error && analysisResponse.result;
          this.results.addWorkflowStep(workflowName, 'compare-strategies', {
            success: step3Success,
            contentCompared: step3Success,
            strategiesAnalyzed: successfulStructured.length
          });
        }
      }
      
      console.log('   Step 4: Generating competitive insights...');
      
      // Step 4: Generate summary insights
      const competitiveData = successfulMetadata.map(r => r.value.result.content[0]);
      const combinedTitles = competitiveData.map(data => data.title).join('. ');
      
      if (combinedTitles) {
        const summaryResponse = await this.sendToolRequest('summarize_content', {
          text: combinedTitles,
          options: {
            max_sentences: 3
          }
        });
        
        const step4Success = !summaryResponse.error && summaryResponse.result;
        this.results.addWorkflowStep(workflowName, 'generate-insights', {
          success: step4Success,
          insightsGenerated: step4Success,
          competitorsAnalyzed: competitiveData.length
        });
      }
      
      const workflowDuration = Date.now() - startTime;
      const allStepsSuccessful = this.results.workflowSteps
        .filter(s => s.workflowName === workflowName)
        .every(s => s.success);
      
      this.results.addWorkflow(workflowName, {
        success: allStepsSuccessful,
        duration: workflowDuration,
        competitorsAnalyzed: competitorSites.length,
        comprehensiveIntelligence: allStepsSuccessful
      });
      
      console.log(`   ✅ Competitive intelligence workflow completed (${workflowDuration}ms)`);
      
    } catch (error) {
      this.results.addError(workflowName, error);
      this.results.addWorkflow(workflowName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Competitive intelligence workflow failed: ${error.message}`);
    }
  }

  /**
   * Test content extraction workflow
   * Flow: Fetch -> Extract Content -> Process Document -> Analyze
   */
  async testContentExtractionWorkflow() {
    const workflowName = 'content-extraction';
    const startTime = Date.now();
    
    try {
      console.log('   Step 1: Fetching raw content...');
      
      // Step 1: Fetch raw content
      const fetchResponse = await this.sendToolRequest('fetch_url', {
        url: E2E_TEST_CONFIG.testSites.documentation,
        timeout: 10000
      });
      
      const step1Success = !fetchResponse.error && fetchResponse.result;
      this.results.addWorkflowStep(workflowName, 'fetch-content', {
        success: step1Success,
        contentSize: step1Success ? fetchResponse.result.content[0].size : 0,
        statusCode: step1Success ? fetchResponse.result.content[0].status : null
      });
      
      console.log('   Step 2: Enhanced content extraction...');
      
      // Step 2: Enhanced content extraction
      const extractResponse = await this.sendToolRequest('extract_content', {
        url: E2E_TEST_CONFIG.testSites.documentation,
        options: {
          include_links: true,
          include_images: true
        }
      });
      
      const step2Success = !extractResponse.error && extractResponse.result;
      this.results.addWorkflowStep(workflowName, 'extract-enhanced', {
        success: step2Success,
        contentExtracted: step2Success,
        hasMainContent: step2Success ? !!extractResponse.result.content[0].content : false
      });
      
      console.log('   Step 3: Document processing...');
      
      // Step 3: Process as document
      const processResponse = await this.sendToolRequest('process_document', {
        source: E2E_TEST_CONFIG.testSites.documentation,
        sourceType: 'url',
        options: {
          extract_tables: true,
          extract_forms: true
        }
      });
      
      const step3Success = !processResponse.error && processResponse.result;
      this.results.addWorkflowStep(workflowName, 'process-document', {
        success: step3Success,
        documentProcessed: step3Success,
        structuredDataExtracted: step3Success
      });
      
      console.log('   Step 4: Content analysis and insights...');
      
      // Step 4: Analyze the processed content
      if (step2Success) {
        const extractedContent = extractResponse.result.content[0].content;
        const analysisResponse = await this.sendToolRequest('analyze_content', {
          text: extractedContent.substring(0, 4000),
          options: {
            include_sentiment: true,
            include_entities: true,
            include_keywords: true
          }
        });
        
        const step4Success = !analysisResponse.error && analysisResponse.result;
        this.results.addWorkflowStep(workflowName, 'analyze-insights', {
          success: step4Success,
          sentimentAnalyzed: step4Success,
          entitiesExtracted: step4Success,
          keywordsIdentified: step4Success
        });
      }
      
      const workflowDuration = Date.now() - startTime;
      const allStepsSuccessful = this.results.workflowSteps
        .filter(s => s.workflowName === workflowName)
        .every(s => s.success);
      
      this.results.addWorkflow(workflowName, {
        success: allStepsSuccessful,
        duration: workflowDuration,
        contentProcessingComplete: allStepsSuccessful,
        multiModalExtraction: allStepsSuccessful
      });
      
      console.log(`   ✅ Content extraction workflow completed (${workflowDuration}ms)`);
      
    } catch (error) {
      this.results.addError(workflowName, error);
      this.results.addWorkflow(workflowName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Content extraction workflow failed: ${error.message}`);
    }
  }

  /**
   * Test site discovery workflow
   * Flow: Map Site -> Crawl -> Analyze Structure -> Extract Links
   */
  async testSiteDiscoveryWorkflow() {
    const workflowName = 'site-discovery';
    const startTime = Date.now();
    
    try {
      console.log('   Step 1: Initial site mapping...');
      
      // Step 1: Map site with metadata
      const mapResponse = await this.sendToolRequest('map_site', {
        url: E2E_TEST_CONFIG.testSites.blog,
        max_urls: 15,
        include_metadata: true,
        group_by_path: true
      });
      
      const step1Success = !mapResponse.error && mapResponse.result;
      this.results.addWorkflowStep(workflowName, 'initial-mapping', {
        success: step1Success,
        urlsDiscovered: step1Success ? mapResponse.result.content[0].total_urls : 0,
        siteStructureMapped: step1Success
      });
      
      console.log('   Step 2: Deep crawl discovery...');
      
      // Step 2: Perform discovery crawl
      const crawlResponse = await this.sendToolRequest('crawl_deep', {
        url: E2E_TEST_CONFIG.testSites.blog,
        max_depth: 2,
        max_pages: 8,
        follow_external: false,
        extract_content: false // Focus on structure
      });
      
      const step2Success = !crawlResponse.error && crawlResponse.result;
      this.results.addWorkflowStep(workflowName, 'deep-crawl', {
        success: step2Success,
        pagesCrawled: step2Success ? crawlResponse.result.content[0].total_pages : 0,
        crawlDepth: step2Success ? crawlResponse.result.content[0].crawl_depth : 0
      });
      
      console.log('   Step 3: Link pattern analysis...');
      
      // Step 3: Analyze link patterns
      const linksResponse = await this.sendToolRequest('extract_links', {
        url: E2E_TEST_CONFIG.testSites.blog,
        filter_external: false
      });
      
      const step3Success = !linksResponse.error && linksResponse.result;
      this.results.addWorkflowStep(workflowName, 'link-analysis', {
        success: step3Success,
        totalLinks: step3Success ? linksResponse.result.content[0].total_count : 0,
        internalLinks: step3Success ? linksResponse.result.content[0].internal_count : 0,
        externalLinks: step3Success ? linksResponse.result.content[0].external_count : 0
      });
      
      console.log('   Step 4: Structure validation...');
      
      // Step 4: Validate discovered structure with structured extraction
      const structureResponse = await this.sendToolRequest('scrape_structured', {
        url: E2E_TEST_CONFIG.testSites.blog,
        selectors: {
          navigation: 'nav, .nav, .navigation',
          main_content: 'main, .main, .content',
          sidebar: '.sidebar, aside',
          footer: 'footer, .footer'
        }
      });
      
      const step4Success = !structureResponse.error && structureResponse.result;
      this.results.addWorkflowStep(workflowName, 'structure-validation', {
        success: step4Success,
        structureValidated: step4Success,
        elementsFound: step4Success ? structureResponse.result.content[0].elements_found : 0
      });
      
      const workflowDuration = Date.now() - startTime;
      const allStepsSuccessful = this.results.workflowSteps
        .filter(s => s.workflowName === workflowName)
        .every(s => s.success);
      
      this.results.addWorkflow(workflowName, {
        success: allStepsSuccessful,
        duration: workflowDuration,
        comprehensiveDiscovery: allStepsSuccessful,
        siteFullyMapped: allStepsSuccessful
      });
      
      console.log(`   ✅ Site discovery workflow completed (${workflowDuration}ms)`);
      
    } catch (error) {
      this.results.addError(workflowName, error);
      this.results.addWorkflow(workflowName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Site discovery workflow failed: ${error.message}`);
    }
  }

  /**
   * Test data aggregation workflow
   * Flow: Multi-source Collection -> Content Processing -> Analysis -> Summary
   */
  async testDataAggregationWorkflow() {
    const workflowName = 'data-aggregation';
    const startTime = Date.now();
    
    try {
      console.log('   Step 1: Multi-source data collection...');
      
      // Step 1: Collect data from multiple sources
      const sources = [
        E2E_TEST_CONFIG.testSites.blog,
        E2E_TEST_CONFIG.testSites.documentation,
        E2E_TEST_CONFIG.testSites.ecommerce
      ];
      
      const collectionPromises = sources.map(source => Promise.all([
        this.sendToolRequest('extract_metadata', { url: source }),
        this.sendToolRequest('extract_text', { url: source }),
        this.sendToolRequest('extract_links', { url: source, filter_external: true })
      ]));
      
      const collectionResults = await Promise.allSettled(collectionPromises);
      const successfulCollections = collectionResults.filter(r => r.status === 'fulfilled');
      
      const step1Success = successfulCollections.length > 0;
      this.results.addWorkflowStep(workflowName, 'multi-source-collection', {
        success: step1Success,
        sourcesCollected: sources.length,
        successfulCollections: successfulCollections.length,
        dataPointsGathered: successfulCollections.length * 3
      });
      
      console.log('   Step 2: Data processing and normalization...');
      
      // Step 2: Process collected data
      if (step1Success) {
        const firstCollection = successfulCollections[0].value;
        const textData = firstCollection.find(r => !r.error && r.result?.content?.[0]?.text);
        
        if (textData) {
          const processResponse = await this.sendToolRequest('process_document', {
            source: sources[0],
            sourceType: 'url',
            options: {
              extract_tables: true,
              clean_text: true
            }
          });
          
          const step2Success = !processResponse.error && processResponse.result;
          this.results.addWorkflowStep(workflowName, 'data-processing', {
            success: step2Success,
            dataProcessed: step2Success,
            normalizedData: step2Success
          });
        }
      }
      
      console.log('   Step 3: Cross-source analysis...');
      
      // Step 3: Analyze aggregated data
      const analysisPromises = successfulCollections.slice(0, 2).map(collection => {
        const textData = collection.value.find(r => !r.error && r.result?.content?.[0]?.text);
        if (textData) {
          return this.sendToolRequest('analyze_content', {
            text: textData.result.content[0].text.substring(0, 3000)
          });
        }
        return Promise.resolve({ error: { message: 'No text data' } });
      });
      
      const analysisResults = await Promise.allSettled(analysisPromises);
      const successfulAnalyses = analysisResults.filter(r => 
        r.status === 'fulfilled' && !r.value.error
      );
      
      const step3Success = successfulAnalyses.length > 0;
      this.results.addWorkflowStep(workflowName, 'cross-source-analysis', {
        success: step3Success,
        sourcesAnalyzed: analysisResults.length,
        successfulAnalyses: successfulAnalyses.length
      });
      
      console.log('   Step 4: Aggregated insights generation...');
      
      // Step 4: Generate comprehensive summary
      if (step3Success) {
        // Combine analysis results
        const combinedTopics = successfulAnalyses
          .map(a => a.value.result.content[0].topics || [])
          .flat()
          .join(', ');
        
        if (combinedTopics) {
          const summaryResponse = await this.sendToolRequest('summarize_content', {
            text: `Analysis of multiple data sources revealed topics: ${combinedTopics}`,
            options: {
              max_sentences: 5,
              include_keywords: true
            }
          });
          
          const step4Success = !summaryResponse.error && summaryResponse.result;
          this.results.addWorkflowStep(workflowName, 'insights-generation', {
            success: step4Success,
            insightsGenerated: step4Success,
            crossSourceSummary: step4Success
          });
        }
      }
      
      const workflowDuration = Date.now() - startTime;
      const allStepsSuccessful = this.results.workflowSteps
        .filter(s => s.workflowName === workflowName)
        .every(s => s.success);
      
      this.results.addWorkflow(workflowName, {
        success: allStepsSuccessful,
        duration: workflowDuration,
        sourcesAggregated: sources.length,
        comprehensiveAggregation: allStepsSuccessful
      });
      
      console.log(`   ✅ Data aggregation workflow completed (${workflowDuration}ms)`);
      
    } catch (error) {
      this.results.addError(workflowName, error);
      this.results.addWorkflow(workflowName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Data aggregation workflow failed: ${error.message}`);
    }
  }

  /**
   * Test content validation workflow
   * Flow: Extract -> Validate -> Cross-check -> Report
   */
  async testContentValidationWorkflow() {
    const workflowName = 'content-validation';
    const startTime = Date.now();
    
    try {
      console.log('   Step 1: Content extraction for validation...');
      
      // Step 1: Extract content to validate
      const extractResponse = await this.sendToolRequest('extract_content', {
        url: E2E_TEST_CONFIG.testSites.documentation
      });
      
      const step1Success = !extractResponse.error && extractResponse.result;
      this.results.addWorkflowStep(workflowName, 'extract-for-validation', {
        success: step1Success,
        contentExtracted: step1Success,
        hasTitle: step1Success ? !!extractResponse.result.content[0].title : false
      });
      
      console.log('   Step 2: Structure validation...');
      
      // Step 2: Validate structure
      const structureResponse = await this.sendToolRequest('scrape_structured', {
        url: E2E_TEST_CONFIG.testSites.documentation,
        selectors: {
          title: 'title',
          headings: 'h1, h2, h3, h4, h5, h6',
          paragraphs: 'p',
          links: 'a[href]',
          images: 'img[src]'
        }
      });
      
      const step2Success = !structureResponse.error && structureResponse.result;
      const structureData = step2Success ? structureResponse.result.content[0].data : {};
      
      this.results.addWorkflowStep(workflowName, 'validate-structure', {
        success: step2Success,
        hasTitle: !!structureData.title,
        hasHeadings: !!structureData.headings,
        hasParagraphs: !!structureData.paragraphs,
        hasLinks: !!structureData.links,
        elementsValidated: step2Success ? Object.keys(structureData).length : 0
      });
      
      console.log('   Step 3: Content quality assessment...');
      
      // Step 3: Assess content quality
      if (step1Success) {
        const content = extractResponse.result.content[0].content;
        const analysisResponse = await this.sendToolRequest('analyze_content', {
          text: content.substring(0, 4000),
          options: {
            include_sentiment: true,
            include_keywords: true
          }
        });
        
        const step3Success = !analysisResponse.error && analysisResponse.result;
        const analysisData = step3Success ? analysisResponse.result.content[0] : {};
        
        this.results.addWorkflowStep(workflowName, 'assess-quality', {
          success: step3Success,
          wordCount: analysisData.word_count || 0,
          languageDetected: !!analysisData.language,
          hasKeywords: !!(analysisData.keywords && analysisData.keywords.length > 0),
          qualityMetrics: step3Success
        });
      }
      
      console.log('   Step 4: Cross-validation check...');
      
      // Step 4: Cross-validate with metadata
      const metadataResponse = await this.sendToolRequest('extract_metadata', {
        url: E2E_TEST_CONFIG.testSites.documentation
      });
      
      const step4Success = !metadataResponse.error && metadataResponse.result;
      const metadataData = step4Success ? metadataResponse.result.content[0] : {};
      
      // Validate consistency between extracted content and metadata
      const titleConsistent = step1Success && step4Success && 
        (extractResponse.result.content[0].title === metadataData.title ||
         Math.abs(extractResponse.result.content[0].title.length - metadataData.title.length) < 50);
      
      this.results.addWorkflowStep(workflowName, 'cross-validation', {
        success: step4Success,
        metadataExtracted: step4Success,
        titleConsistent,
        validationComplete: step4Success && titleConsistent
      });
      
      const workflowDuration = Date.now() - startTime;
      const allStepsSuccessful = this.results.workflowSteps
        .filter(s => s.workflowName === workflowName)
        .every(s => s.success);
      
      this.results.addWorkflow(workflowName, {
        success: allStepsSuccessful,
        duration: workflowDuration,
        validationComplete: allStepsSuccessful,
        contentValidated: allStepsSuccessful
      });
      
      console.log(`   ✅ Content validation workflow completed (${workflowDuration}ms)`);
      
    } catch (error) {
      this.results.addError(workflowName, error);
      this.results.addWorkflow(workflowName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Content validation workflow failed: ${error.message}`);
    }
  }

  /**
   * Test performance monitoring workflow
   * Flow: Baseline -> Stress Test -> Monitor -> Report
   */
  async testPerformanceMonitoringWorkflow() {
    const workflowName = 'performance-monitoring';
    const startTime = Date.now();
    
    try {
      console.log('   Step 1: Establishing performance baseline...');
      
      // Step 1: Baseline performance measurement
      const baselineStart = Date.now();
      const baselineResponse = await this.sendToolRequest('fetch_url', {
        url: E2E_TEST_CONFIG.testSites.blog
      });
      const baselineDuration = Date.now() - baselineStart;
      
      const step1Success = !baselineResponse.error && baselineResponse.result;
      this.results.addWorkflowStep(workflowName, 'baseline-measurement', {
        success: step1Success,
        baselineDuration,
        baselineEstablished: step1Success
      });
      
      console.log('   Step 2: Concurrent request stress test...');
      
      // Step 2: Stress test with concurrent requests
      const stressTestStart = Date.now();
      const concurrentRequests = Array.from({ length: 5 }, () => 
        this.sendToolRequest('extract_text', {
          url: E2E_TEST_CONFIG.testSites.documentation
        })
      );
      
      const stressResults = await Promise.allSettled(concurrentRequests);
      const stressTestDuration = Date.now() - stressTestStart;
      const successfulStressRequests = stressResults.filter(r => 
        r.status === 'fulfilled' && !r.value.error
      ).length;
      
      const step2Success = successfulStressRequests > 0;
      this.results.addWorkflowStep(workflowName, 'stress-test', {
        success: step2Success,
        concurrentRequests: concurrentRequests.length,
        successfulRequests: successfulStressRequests,
        stressTestDuration,
        averageResponseTime: stressTestDuration / concurrentRequests.length
      });
      
      console.log('   Step 3: Resource usage monitoring...');
      
      // Step 3: Monitor complex operation
      const monitoringStart = Date.now();
      const complexResponse = await this.sendToolRequest('crawl_deep', {
        url: E2E_TEST_CONFIG.testSites.blog,
        max_depth: 1,
        max_pages: 3,
        extract_content: true
      });
      const monitoringDuration = Date.now() - monitoringStart;
      
      const step3Success = !complexResponse.error && complexResponse.result;
      this.results.addWorkflowStep(workflowName, 'resource-monitoring', {
        success: step3Success,
        complexOperationDuration: monitoringDuration,
        resourcesMonitored: step3Success
      });
      
      console.log('   Step 4: Performance report generation...');
      
      // Step 4: Generate performance report
      const performanceData = {
        baseline: baselineDuration,
        concurrentAverage: stressTestDuration / concurrentRequests.length,
        complexOperation: monitoringDuration,
        successRates: {
          baseline: step1Success ? 100 : 0,
          concurrent: (successfulStressRequests / concurrentRequests.length) * 100,
          complex: step3Success ? 100 : 0
        }
      };
      
      const performanceReport = `Performance Analysis: Baseline ${performanceData.baseline}ms, Concurrent avg ${performanceData.concurrentAverage.toFixed(0)}ms, Complex operation ${performanceData.complexOperation}ms. Success rates: Baseline ${performanceData.successRates.baseline}%, Concurrent ${performanceData.successRates.concurrent}%, Complex ${performanceData.successRates.complex}%.`;
      
      const reportResponse = await this.sendToolRequest('summarize_content', {
        text: performanceReport
      });
      
      const step4Success = !reportResponse.error && reportResponse.result;
      this.results.addWorkflowStep(workflowName, 'generate-report', {
        success: step4Success,
        reportGenerated: step4Success,
        performanceDataCollected: true
      });
      
      this.results.addPerformanceMetric(workflowName, performanceData);
      
      const workflowDuration = Date.now() - startTime;
      const allStepsSuccessful = this.results.workflowSteps
        .filter(s => s.workflowName === workflowName)
        .every(s => s.success);
      
      this.results.addWorkflow(workflowName, {
        success: allStepsSuccessful,
        duration: workflowDuration,
        performanceMonitored: allStepsSuccessful,
        benchmarkCompleted: allStepsSuccessful
      });
      
      console.log(`   ✅ Performance monitoring workflow completed (${workflowDuration}ms)`);
      
    } catch (error) {
      this.results.addError(workflowName, error);
      this.results.addWorkflow(workflowName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Performance monitoring workflow failed: ${error.message}`);
    }
  }

  /**
   * Test error recovery workflow
   * Flow: Normal Operation -> Induced Error -> Recovery -> Validation
   */
  async testErrorRecoveryWorkflow() {
    const workflowName = 'error-recovery';
    const startTime = Date.now();
    
    try {
      console.log('   Step 1: Normal operation baseline...');
      
      // Step 1: Establish normal operation
      const normalResponse = await this.sendToolRequest('extract_metadata', {
        url: E2E_TEST_CONFIG.testSites.documentation
      });
      
      const step1Success = !normalResponse.error && normalResponse.result;
      this.results.addWorkflowStep(workflowName, 'normal-operation', {
        success: step1Success,
        normalOperationConfirmed: step1Success
      });
      
      console.log('   Step 2: Simulating error conditions...');
      
      // Step 2: Induce errors
      const errorResponse = await this.sendToolRequest('fetch_url', {
        url: 'https://nonexistent-domain-12345.com'
      });
      
      const step2Success = !!errorResponse.error; // We expect an error
      this.results.addWorkflowStep(workflowName, 'induce-error', {
        success: step2Success,
        errorInduced: step2Success,
        errorHandled: !!errorResponse.error
      });
      
      console.log('   Step 3: Recovery validation...');
      
      // Step 3: Validate recovery
      const recoveryResponse = await this.sendToolRequest('extract_text', {
        url: E2E_TEST_CONFIG.testSites.documentation
      });
      
      const step3Success = !recoveryResponse.error && recoveryResponse.result;
      this.results.addWorkflowStep(workflowName, 'validate-recovery', {
        success: step3Success,
        recoverySuccessful: step3Success,
        systemResponsive: step3Success
      });
      
      console.log('   Step 4: Comprehensive functionality check...');
      
      // Step 4: Test multiple functions to ensure full recovery
      const functionalityChecks = [
        this.sendToolRequest('extract_links', { url: E2E_TEST_CONFIG.testSites.blog }),
        this.sendToolRequest('extract_metadata', { url: E2E_TEST_CONFIG.testSites.ecommerce }),
        this.sendToolRequest('scrape_structured', {
          url: E2E_TEST_CONFIG.testSites.documentation,
          selectors: { title: 'title', body: 'body' }
        })
      ];
      
      const functionalityResults = await Promise.allSettled(functionalityChecks);
      const successfulChecks = functionalityResults.filter(r => 
        r.status === 'fulfilled' && !r.value.error
      ).length;
      
      const step4Success = successfulChecks >= 2; // At least 2 out of 3 should work
      this.results.addWorkflowStep(workflowName, 'functionality-check', {
        success: step4Success,
        functionalityChecks: functionalityChecks.length,
        successfulChecks,
        fullFunctionalityRestored: step4Success
      });
      
      const workflowDuration = Date.now() - startTime;
      const allStepsSuccessful = this.results.workflowSteps
        .filter(s => s.workflowName === workflowName)
        .every(s => s.success);
      
      this.results.addWorkflow(workflowName, {
        success: allStepsSuccessful,
        duration: workflowDuration,
        errorRecoveryComplete: allStepsSuccessful,
        systemRobustness: allStepsSuccessful
      });
      
      console.log(`   ✅ Error recovery workflow completed (${workflowDuration}ms)`);
      
    } catch (error) {
      this.results.addError(workflowName, error);
      this.results.addWorkflow(workflowName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Error recovery workflow failed: ${error.message}`);
    }
  }

  /**
   * Test real-world simulation workflow
   * Flow: Complex Multi-step Process Simulating Real Usage
   */
  async testRealWorldSimulation() {
    const workflowName = 'real-world-simulation';
    const startTime = Date.now();
    
    try {
      console.log('   Step 1: Research planning phase...');
      
      // Simulate a real-world research task: analyzing a website comprehensively
      
      // Step 1: Initial reconnaissance
      const reconPromises = [
        this.sendToolRequest('extract_metadata', { url: E2E_TEST_CONFIG.testSites.blog }),
        this.sendToolRequest('extract_links', { url: E2E_TEST_CONFIG.testSites.blog }),
        this.sendToolRequest('map_site', { url: E2E_TEST_CONFIG.testSites.blog, max_urls: 8 })
      ];
      
      const reconResults = await Promise.allSettled(reconPromises);
      const successfulRecon = reconResults.filter(r => r.status === 'fulfilled' && !r.value.error);
      
      const step1Success = successfulRecon.length >= 2;
      this.results.addWorkflowStep(workflowName, 'research-planning', {
        success: step1Success,
        reconnaissanceComplete: step1Success,
        dataSourcesIdentified: successfulRecon.length
      });
      
      console.log('   Step 2: Deep content analysis...');
      
      // Step 2: Deep analysis of discovered content
      if (step1Success) {
        const analysisPromises = [
          this.sendToolRequest('extract_content', { url: E2E_TEST_CONFIG.testSites.blog }),
          this.sendToolRequest('crawl_deep', {
            url: E2E_TEST_CONFIG.testSites.blog,
            max_depth: 1,
            max_pages: 4,
            extract_content: true
          })
        ];
        
        const analysisResults = await Promise.allSettled(analysisPromises);
        const successfulAnalysis = analysisResults.filter(r => 
          r.status === 'fulfilled' && !r.value.error
        );
        
        const step2Success = successfulAnalysis.length > 0;
        this.results.addWorkflowStep(workflowName, 'content-analysis', {
          success: step2Success,
          deepAnalysisComplete: step2Success,
          contentSourcesAnalyzed: successfulAnalysis.length
        });
        
        console.log('   Step 3: Data processing and insights...');
        
        // Step 3: Process and generate insights
        if (step2Success && successfulAnalysis[0].value.result) {
          const content = successfulAnalysis[0].value.result.content[0];
          const contentText = content.content || content.text || '';
          
          if (contentText) {
            const insightPromises = [
              this.sendToolRequest('analyze_content', {
                text: contentText.substring(0, 5000),
                options: { include_sentiment: true, include_keywords: true }
              }),
              this.sendToolRequest('summarize_content', {
                text: contentText.substring(0, 5000),
                options: { max_sentences: 4 }
              })
            ];
            
            const insightResults = await Promise.allSettled(insightPromises);
            const successfulInsights = insightResults.filter(r => 
              r.status === 'fulfilled' && !r.value.error
            );
            
            const step3Success = successfulInsights.length > 0;
            this.results.addWorkflowStep(workflowName, 'insights-generation', {
              success: step3Success,
              insightsGenerated: step3Success,
              analyticsComplete: successfulInsights.length
            });
          }
        }
      }
      
      console.log('   Step 4: Comprehensive reporting...');
      
      // Step 4: Generate comprehensive report
      const reportingPromises = [
        this.sendToolRequest('scrape_structured', {
          url: E2E_TEST_CONFIG.testSites.blog,
          selectors: {
            title: 'title',
            headings: 'h1, h2, h3',
            links: 'a[href]',
            content_blocks: 'main, article, .content'
          }
        }),
        this.sendToolRequest('extract_metadata', { url: E2E_TEST_CONFIG.testSites.documentation })
      ];
      
      const reportingResults = await Promise.allSettled(reportingPromises);
      const successfulReporting = reportingResults.filter(r => 
        r.status === 'fulfilled' && !r.value.error
      );
      
      const step4Success = successfulReporting.length > 0;
      this.results.addWorkflowStep(workflowName, 'comprehensive-reporting', {
        success: step4Success,
        reportGenerated: step4Success,
        dataCompiled: successfulReporting.length
      });
      
      console.log('   Step 5: Quality assurance validation...');
      
      // Step 5: Validate all collected data
      const validationChecks = [
        // Check that we have metadata
        successfulRecon.some(r => r.value.result?.content?.[0]?.title),
        // Check that we have content
        successfulReporting.some(r => r.value.result?.content?.[0]?.data),
        // Check that workflows completed without major errors
        this.results.errors.filter(e => e.workflowName === workflowName).length === 0
      ];
      
      const validationScore = validationChecks.filter(Boolean).length;
      const step5Success = validationScore >= 2;
      
      this.results.addWorkflowStep(workflowName, 'quality-assurance', {
        success: step5Success,
        validationScore,
        qualityAssured: step5Success,
        dataIntegrityConfirmed: step5Success
      });
      
      const workflowDuration = Date.now() - startTime;
      const allStepsSuccessful = this.results.workflowSteps
        .filter(s => s.workflowName === workflowName)
        .every(s => s.success);
      
      this.results.addWorkflow(workflowName, {
        success: allStepsSuccessful,
        duration: workflowDuration,
        realWorldSimulationComplete: allStepsSuccessful,
        comprehensiveWorkflow: true,
        productionReady: allStepsSuccessful
      });
      
      console.log(`   ✅ Real-world simulation workflow completed (${workflowDuration}ms)`);
      
    } catch (error) {
      this.results.addError(workflowName, error);
      this.results.addWorkflow(workflowName, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      console.log(`   ❌ Real-world simulation workflow failed: ${error.message}`);
    }
  }

  // Helper methods

  /**
   * Send a tool request
   */
  async sendToolRequest(toolName, args, timeout = E2E_TEST_CONFIG.requestTimeout) {
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
      }, E2E_TEST_CONFIG.serverTimeout);
    });
  }

  /**
   * Send request to server
   */
  async sendRequest(request, timeout = E2E_TEST_CONFIG.requestTimeout) {
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
   * Generate workflow report
   */
  generateWorkflowReport() {
    const summary = this.results.getSummary();
    
    return {
      timestamp: new Date().toISOString(),
      configuration: E2E_TEST_CONFIG,
      summary,
      workflowAnalysis: this.analyzeWorkflows(summary),
      performanceAnalysis: this.analyzeWorkflowPerformance(),
      realWorldReadiness: this.assessRealWorldReadiness(summary),
      errors: this.results.errors,
      recommendations: this.generateWorkflowRecommendations(summary)
    };
  }

  /**
   * Analyze workflow results
   */
  analyzeWorkflows(summary) {
    const analysis = {
      status: 'READY',
      issues: [],
      strengths: []
    };
    
    if (summary.successRate < 80) {
      analysis.status = 'NOT_READY';
      analysis.issues.push(`Low workflow success rate: ${summary.successRate.toFixed(1)}%`);
    } else if (summary.successRate < 95) {
      analysis.status = 'PARTIALLY_READY';
      analysis.issues.push(`Moderate workflow success rate: ${summary.successRate.toFixed(1)}%`);
    } else {
      analysis.strengths.push(`High workflow success rate: ${summary.successRate.toFixed(1)}%`);
    }
    
    if (summary.stepSuccessRate < 90) {
      analysis.issues.push(`Some workflow steps failing: ${summary.stepSuccessRate.toFixed(1)}% step success rate`);
    } else {
      analysis.strengths.push(`Excellent step-level reliability: ${summary.stepSuccessRate.toFixed(1)}%`);
    }
    
    // Analyze specific workflows
    const criticalWorkflows = ['content-research', 'website-analysis', 'real-world-simulation'];
    const failedCriticalWorkflows = criticalWorkflows.filter(workflow => 
      summary.workflows[workflow] && !summary.workflows[workflow].success
    );
    
    if (failedCriticalWorkflows.length > 0) {
      analysis.status = 'NOT_READY';
      analysis.issues.push(`Critical workflows failed: ${failedCriticalWorkflows.join(', ')}`);
    }
    
    return analysis;
  }

  /**
   * Analyze workflow performance
   */
  analyzeWorkflowPerformance() {
    const metrics = this.results.performanceMetrics;
    const workflows = Array.from(this.results.workflows.values());
    
    if (workflows.length === 0) {
      return { status: 'NO_DATA' };
    }
    
    const averageDuration = workflows.reduce((sum, w) => sum + w.duration, 0) / workflows.length;
    const fastestWorkflow = workflows.reduce((min, w) => w.duration < min.duration ? w : min);
    const slowestWorkflow = workflows.reduce((max, w) => w.duration > max.duration ? w : max);
    
    return {
      status: 'ANALYZED',
      averageDuration,
      fastestWorkflow: fastestWorkflow.duration,
      slowestWorkflow: slowestWorkflow.duration,
      performanceRating: this.rateWorkflowPerformance(averageDuration),
      scalabilityScore: this.calculateScalabilityScore(workflows)
    };
  }

  /**
   * Rate workflow performance
   */
  rateWorkflowPerformance(avgDuration) {
    if (avgDuration < 10000) return 'EXCELLENT';
    if (avgDuration < 30000) return 'GOOD';
    if (avgDuration < 60000) return 'ACCEPTABLE';
    return 'POOR';
  }

  /**
   * Calculate scalability score
   */
  calculateScalabilityScore(workflows) {
    // Score based on workflow complexity and duration relationship
    const complexWorkflows = workflows.filter(w => w.duration > 20000);
    const simpleWorkflows = workflows.filter(w => w.duration <= 20000);
    
    const complexSuccessRate = complexWorkflows.length > 0 ? 
      complexWorkflows.filter(w => w.success).length / complexWorkflows.length : 1;
    const simpleSuccessRate = simpleWorkflows.length > 0 ? 
      simpleWorkflows.filter(w => w.success).length / simpleWorkflows.length : 1;
    
    return (complexSuccessRate * 0.6 + simpleSuccessRate * 0.4) * 100;
  }

  /**
   * Assess real-world readiness
   */
  assessRealWorldReadiness(summary) {
    const readinessFactors = {
      workflowReliability: summary.successRate >= 95,
      stepReliability: summary.stepSuccessRate >= 90,
      errorHandling: summary.totalErrors / summary.totalWorkflows < 0.5,
      realWorldSimulation: summary.workflows['real-world-simulation']?.success || false,
      performanceAdequate: this.analyzeWorkflowPerformance().performanceRating !== 'POOR'
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
   * Generate workflow recommendations
   */
  generateWorkflowRecommendations(summary) {
    const recommendations = [];
    
    if (summary.successRate < 95) {
      recommendations.push('Improve workflow reliability and error handling');
    }
    
    if (summary.stepSuccessRate < 90) {
      recommendations.push('Review and strengthen individual workflow steps');
    }
    
    const performanceAnalysis = this.analyzeWorkflowPerformance();
    if (performanceAnalysis.performanceRating === 'POOR') {
      recommendations.push('Optimize workflow performance for production use');
    }
    
    // Check specific workflow failures
    Object.entries(summary.workflows).forEach(([workflowName, workflow]) => {
      if (!workflow.success) {
        recommendations.push(`Fix issues in ${workflowName} workflow`);
      }
    });
    
    const readiness = this.assessRealWorldReadiness(summary);
    if (readiness.level === 'NOT_READY') {
      recommendations.push('Address critical readiness factors before production deployment');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('All workflows are production-ready');
      recommendations.push('Consider additional edge case testing');
      recommendations.push('Monitor performance in production environment');
    }
    
    return recommendations;
  }

  /**
   * Save workflow report
   */
  async saveWorkflowReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `workflow-integration-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📄 Workflow integration report saved: ${filepath}`);
    } catch (error) {
      console.error('❌ Failed to save workflow report:', error.message);
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
 * Main workflow test execution
 */
async function runWorkflowTests() {
  console.log('🔄 Starting End-to-End Workflow Test Suite...');
  
  const testSuite = new EndToEndWorkflowTestSuite();
  
  try {
    const report = await testSuite.runWorkflowTests();
    
    console.log('\n📋 End-to-End Workflow Test Summary:');
    console.log('─'.repeat(60));
    console.log(`✅ Status: ${report.workflowAnalysis.status}`);
    console.log(`📊 Total Workflows: ${report.summary.totalWorkflows}`);
    console.log(`🎯 Workflow Success Rate: ${report.summary.successRate.toFixed(1)}%`);
    console.log(`📝 Step Success Rate: ${report.summary.stepSuccessRate.toFixed(1)}%`);
    console.log(`🚀 Real-World Readiness: ${report.realWorldReadiness.level} (${report.realWorldReadiness.percentage.toFixed(1)}%)`);
    console.log(`❌ Total Errors: ${report.summary.totalErrors}`);
    console.log(`⏱️ Duration: ${(report.summary.duration / 1000).toFixed(1)}s`);
    
    if (report.performanceAnalysis.status === 'ANALYZED') {
      console.log(`⚡ Performance Rating: ${report.performanceAnalysis.performanceRating}`);
      console.log(`📈 Average Workflow Duration: ${(report.performanceAnalysis.averageDuration / 1000).toFixed(1)}s`);
    }
    
    if (report.workflowAnalysis.issues.length > 0) {
      console.log('\n⚠️ Issues Identified:');
      report.workflowAnalysis.issues.forEach(issue => console.log(`   • ${issue}`));
    }
    
    if (report.workflowAnalysis.strengths.length > 0) {
      console.log('\n✨ Strengths:');
      report.workflowAnalysis.strengths.forEach(strength => console.log(`   • ${strength}`));
    }
    
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach(rec => console.log(`   • ${rec}`));
    
    return report;
    
  } catch (error) {
    console.error('❌ End-to-end workflow test failed:', error);
    throw error;
  }
}

// Export for use in other test files
export { EndToEndWorkflowTestSuite, runWorkflowTests };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runWorkflowTests()
    .then(() => {
      console.log('✅ End-to-end workflow test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ End-to-end workflow test failed:', error);
      process.exit(1);
    });
}
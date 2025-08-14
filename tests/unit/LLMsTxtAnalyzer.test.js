#!/usr/bin/env node

/**
 * Unit Tests for LLMsTxtAnalyzer
 * Tests the core analysis functionality for website structure, APIs, content, and security
 */

import { LLMsTxtAnalyzer } from '../../src/core/LLMsTxtAnalyzer.js';

class LLMsTxtAnalyzerTests {
  constructor() {
    this.analyzer = new LLMsTxtAnalyzer({
      maxDepth: 2,
      maxPages: 20,
      timeout: 10000
    });
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

  async testBasicAnalysis() {
    // Test basic website analysis
    const analysis = await this.analyzer.analyzeWebsite('https://httpbin.org', {
      maxDepth: 1,
      maxPages: 10
    });

    if (!analysis.metadata) {
      throw new Error('Analysis metadata not generated');
    }

    if (!analysis.structure) {
      throw new Error('Structure analysis not performed');
    }

    if (!analysis.apis) {
      throw new Error('API analysis not performed');
    }

    if (!analysis.contentTypes) {
      throw new Error('Content type analysis not performed');
    }

    this.log('Basic analysis structure validation passed');
  }

  async testSiteStructureAnalysis() {
    // Test site structure analysis
    await this.analyzer.analyzeSiteStructure('https://httpbin.org');
    
    const structure = this.analyzer.analysis.structure;
    
    if (!structure.siteMap) {
      throw new Error('Site map not generated');
    }

    if (!structure.sections) {
      throw new Error('Section categorization not performed');
    }

    if (!structure.hierarchy) {
      throw new Error('Site hierarchy not built');
    }

    this.log('Site structure analysis passed');
  }

  async testAPIDetection() {
    // Test API endpoint detection
    await this.analyzer.detectAPIEndpoints('https://httpbin.org');
    
    const apis = this.analyzer.analysis.apis;
    
    if (!Array.isArray(apis)) {
      throw new Error('APIs not detected as array');
    }

    // httpbin.org should have API endpoints
    if (apis.length === 0) {
      this.log('No APIs detected for httpbin.org (may be expected)', 'warn');
    } else {
      this.log(`Detected ${apis.length} API endpoints`);
    }

    this.log('API detection test passed');
  }

  async testContentClassification() {
    // Test content classification
    await this.analyzer.classifyContent();
    
    const contentTypes = this.analyzer.analysis.contentTypes;
    
    if (!contentTypes.public || !Array.isArray(contentTypes.public)) {
      throw new Error('Public content classification failed');
    }

    if (!contentTypes.restricted || !Array.isArray(contentTypes.restricted)) {
      throw new Error('Restricted content classification failed');
    }

    if (!contentTypes.dynamic || !Array.isArray(contentTypes.dynamic)) {
      throw new Error('Dynamic content classification failed');
    }

    this.log('Content classification test passed');
  }

  async testSecurityAnalysis() {
    // Test security boundary analysis
    await this.analyzer.analyzeSecurity('https://httpbin.org');
    
    const securityAreas = this.analyzer.analysis.securityAreas;
    
    if (!Array.isArray(securityAreas)) {
      throw new Error('Security areas not analyzed');
    }

    if (!this.analyzer.analysis.securityHeaders) {
      throw new Error('Security headers not analyzed');
    }

    this.log(`Security analysis found ${securityAreas.length} sensitive areas`);
    this.log('Security analysis test passed');
  }

  async testRateLimitingAnalysis() {
    // Test rate limiting analysis
    await this.analyzer.analyzeRateLimiting('https://httpbin.org');
    
    const rateLimit = this.analyzer.analysis.rateLimit;
    
    if (!rateLimit) {
      throw new Error('Rate limiting analysis not performed');
    }

    if (typeof rateLimit.averageResponseTime !== 'number') {
      throw new Error('Average response time not calculated');
    }

    if (typeof rateLimit.recommendedDelay !== 'number') {
      throw new Error('Recommended delay not calculated');
    }

    if (typeof rateLimit.maxConcurrency !== 'number') {
      throw new Error('Max concurrency not calculated');
    }

    this.log(`Rate limiting: ${rateLimit.averageResponseTime}ms avg, ${rateLimit.recommendedDelay}ms delay`);
    this.log('Rate limiting analysis test passed');
  }

  async testGuidelinesGeneration() {
    // Test usage guidelines generation
    await this.analyzer.generateUsageGuidelines();
    
    const guidelines = this.analyzer.analysis.guidelines;
    
    if (!guidelines) {
      throw new Error('Guidelines not generated');
    }

    const requiredSections = ['crawling', 'apis', 'rateLimit', 'content', 'security', 'compliance'];
    for (const section of requiredSections) {
      if (!guidelines[section]) {
        throw new Error(`Guidelines section missing: ${section}`);
      }
    }

    this.log('Guidelines generation test passed');
  }

  testHelperMethods() {
    // Test helper methods
    const analyzer = this.analyzer;

    // Test section categorization
    const sections = analyzer.categorizeSections([
      'https://example.com/blog/post1',
      'https://example.com/api/users',
      'https://example.com/about',
      'https://example.com/images/photo.jpg'
    ]);

    if (!sections.content || !sections.tools || !sections.navigation || !sections.media) {
      throw new Error('Section categorization failed');
    }

    // Test URL classification
    const classification = analyzer.categorizeSection('/blog/posts');
    if (classification !== 'content') {
      throw new Error('URL classification failed');
    }

    // Test security area classification
    const securityType = analyzer.classifySecurityArea('/admin');
    if (securityType !== 'admin') {
      throw new Error('Security area classification failed');
    }

    this.log('Helper methods test passed');
  }

  async testPageClassification() {
    // Test individual page classification
    const classification = await this.analyzer.classifyPage('https://httpbin.org');
    
    if (!classification.category) {
      throw new Error('Page category not determined');
    }

    if (!classification.type) {
      throw new Error('Page type not determined');
    }

    if (typeof classification.confidence !== 'number') {
      throw new Error('Confidence score not calculated');
    }

    this.log(`Page classified as: ${classification.category}/${classification.type} (confidence: ${classification.confidence})`);
    this.log('Page classification test passed');
  }

  async testErrorHandling() {
    // Test error handling with invalid URLs
    const originalAnalysis = { ...this.analyzer.analysis };
    
    try {
      await this.analyzer.analyzeWebsite('https://definitely-does-not-exist-12345.com');
    } catch (error) {
      // Expected to fail, check that errors are recorded
      if (!this.analyzer.analysis.errors || this.analyzer.analysis.errors.length === 0) {
        throw new Error('Errors not properly recorded');
      }
    }

    // Reset analyzer state
    this.analyzer.analysis = originalAnalysis;
    this.log('Error handling test passed');
  }

  testAnalysisDataStructure() {
    // Test that analysis data structure is properly initialized
    const analysis = this.analyzer.analysis;
    
    const requiredFields = [
      'structure', 'apis', 'contentTypes', 'securityAreas',
      'rateLimit', 'guidelines', 'metadata', 'errors'
    ];

    for (const field of requiredFields) {
      if (!(field in analysis)) {
        throw new Error(`Required analysis field missing: ${field}`);
      }
    }

    this.log('Analysis data structure test passed');
  }

  async testComprehensiveAnalysis() {
    // Test full comprehensive analysis
    const analysis = await this.analyzer.analyzeWebsite('https://httpbin.org', {
      detectAPIs: true,
      analyzeContent: true,
      checkSecurity: true,
      respectRobots: true
    });

    // Verify all analysis phases completed
    const phases = ['structure', 'apis', 'contentTypes', 'securityAreas', 'rateLimit', 'guidelines'];
    for (const phase of phases) {
      if (!analysis[phase]) {
        throw new Error(`Analysis phase not completed: ${phase}`);
      }
    }

    // Check metadata
    if (!analysis.metadata.analyzedAt) {
      throw new Error('Analysis timestamp not recorded');
    }

    if (!analysis.metadata.analysisTimeMs) {
      throw new Error('Analysis time not recorded');
    }

    this.log(`Comprehensive analysis completed in ${analysis.metadata.analysisTimeMs}ms`);
    this.log('Comprehensive analysis test passed');
  }

  async runAllTests() {
    this.log('Starting LLMsTxtAnalyzer unit tests...', 'info');
    this.log('='.repeat(60), 'info');

    const tests = [
      ['Analysis Data Structure', () => this.testAnalysisDataStructure()],
      ['Helper Methods', () => this.testHelperMethods()],
      ['Basic Analysis', () => this.testBasicAnalysis()],
      ['Site Structure Analysis', () => this.testSiteStructureAnalysis()],
      ['API Detection', () => this.testAPIDetection()],
      ['Content Classification', () => this.testContentClassification()],
      ['Security Analysis', () => this.testSecurityAnalysis()],
      ['Rate Limiting Analysis', () => this.testRateLimitingAnalysis()],
      ['Guidelines Generation', () => this.testGuidelinesGeneration()],
      ['Page Classification', () => this.testPageClassification()],
      ['Error Handling', () => this.testErrorHandling()],
      ['Comprehensive Analysis', () => this.testComprehensiveAnalysis()]
    ];

    for (const [testName, testFunction] of tests) {
      await this.runTest(testName, testFunction);
    }

    this.printResults();
  }

  printResults() {
    this.log('='.repeat(60), 'info');
    this.log('LLMsTxtAnalyzer Unit Test Results:', 'info');
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
      this.log('\n🎉 All LLMsTxtAnalyzer unit tests passed!', 'info');
    } else {
      this.log(`\n⚠️  ${this.results.failed} test(s) failed. Please review and fix issues.`, 'warn');
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new LLMsTxtAnalyzerTests();
  
  tester.runAllTests().catch(error => {
    console.error('Unit test runner failed:', error);
    process.exit(1);
  });
}

export { LLMsTxtAnalyzerTests };
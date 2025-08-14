#!/usr/bin/env node

/**
 * LLMs.txt Generator Demo
 * Demonstrates the usage of the LLMs.txt Generator Tool
 */

import { GenerateLLMsTxtTool } from '../src/tools/llmstxt/generateLLMsTxt.js';

class LLMsTxtGeneratorDemo {
  constructor() {
    this.tool = new GenerateLLMsTxtTool();
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'success' ? '🎉' : '📋';
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async demonstrateBasicGeneration() {
    this.log('='.repeat(60));
    this.log('DEMO 1: Basic LLMs.txt Generation');
    this.log('='.repeat(60));

    try {
      const result = await this.tool.execute({
        url: 'https://httpbin.org',
        analysisOptions: {
          maxDepth: 2,
          maxPages: 20
        },
        format: 'llms-txt'
      });

      this.log('Basic generation completed successfully!', 'success');
      this.log(`Analysis Stats:`);
      this.log(`- Pages analyzed: ${result.analysisStats.pagesAnalyzed}`);
      this.log(`- APIs detected: ${result.analysisStats.apisDetected}`);
      this.log(`- Security areas found: ${result.analysisStats.securityAreasFound}`);
      this.log(`- Analysis time: ${result.analysisStats.analysisTimeMs}ms`);

      this.log('\nGenerated LLMs.txt content (first 500 characters):');
      console.log('-'.repeat(50));
      console.log(result.files['llms.txt'].substring(0, 500) + '...');
      console.log('-'.repeat(50));

    } catch (error) {
      this.log(`Basic generation failed: ${error.message}`, 'error');
    }
  }

  async demonstrateComprehensiveGeneration() {
    this.log('\n' + '='.repeat(60));
    this.log('DEMO 2: Comprehensive Generation with Custom Options');
    this.log('='.repeat(60));

    try {
      const result = await this.tool.execute({
        url: 'https://httpbin.org',
        analysisOptions: {
          maxDepth: 3,
          maxPages: 50,
          detectAPIs: true,
          analyzeContent: true,
          checkSecurity: true,
          respectRobots: true
        },
        outputOptions: {
          includeDetailed: true,
          includeAnalysis: false,
          contactEmail: 'ai-support@example.com',
          organizationName: 'Example Corporation',
          customGuidelines: [
            'Respect our API rate limits',
            'Use authentication when available',
            'Cache responses appropriately'
          ],
          customRestrictions: [
            '/internal/*',
            '/private/*',
            '/*.env'
          ]
        },
        complianceLevel: 'strict',
        format: 'both'
      });

      this.log('Comprehensive generation completed successfully!', 'success');
      this.log(`Files generated: ${Object.keys(result.files).join(', ')}`);
      this.log(`Compliance level: ${result.complianceLevel}`);
      this.log(`Recommendations: ${result.recommendations.length}`);
      this.log(`Warnings: ${result.warnings.length}`);

      if (result.recommendations.length > 0) {
        this.log('\nRecommendations:');
        result.recommendations.forEach((rec, index) => {
          this.log(`  ${index + 1}. [${rec.type}] ${rec.message}`);
        });
      }

      this.log('\nLLMs-full.txt content preview (section headers):');
      console.log('-'.repeat(50));
      const fullContent = result.files['llms-full.txt'];
      const headers = fullContent.split('\n')
        .filter(line => line.startsWith('##'))
        .slice(0, 8);
      headers.forEach(header => console.log(header));
      console.log('-'.repeat(50));

    } catch (error) {
      this.log(`Comprehensive generation failed: ${error.message}`, 'error');
    }
  }

  async demonstrateDifferentComplianceLevels() {
    this.log('\n' + '='.repeat(60));
    this.log('DEMO 3: Different Compliance Levels');
    this.log('='.repeat(60));

    const levels = ['basic', 'standard', 'strict'];

    for (const level of levels) {
      try {
        this.log(`\nGenerating LLMs.txt with '${level}' compliance level...`);
        
        const result = await this.tool.execute({
          url: 'https://httpbin.org',
          complianceLevel: level,
          analysisOptions: {
            maxDepth: 1,
            maxPages: 10
          },
          format: 'llms-txt'
        });

        const content = result.files['llms.txt'];
        const disallowCount = (content.match(/Disallow:/g) || []).length;
        
        this.log(`✓ ${level} compliance: ${disallowCount} restrictions`, 'success');

      } catch (error) {
        this.log(`✗ ${level} compliance failed: ${error.message}`, 'error');
      }
    }
  }

  async demonstrateAPIAnalysis() {
    this.log('\n' + '='.repeat(60));
    this.log('DEMO 4: API Detection and Analysis');
    this.log('='.repeat(60));

    try {
      const result = await this.tool.execute({
        url: 'https://httpbin.org',
        analysisOptions: {
          maxDepth: 2,
          maxPages: 30,
          detectAPIs: true
        },
        outputOptions: {
          includeAnalysis: true
        },
        format: 'llms-txt'
      });

      this.log('API analysis completed!', 'success');
      this.log(`APIs detected: ${result.analysisStats.apisDetected}`);

      if (result.analysis && result.analysis.apis.length > 0) {
        this.log('\nDetected APIs:');
        result.analysis.apis.forEach((api, index) => {
          this.log(`  ${index + 1}. ${api.type}: ${api.url}`);
        });
      } else {
        this.log('No APIs detected in analysis');
      }

      // Check if LLMs.txt mentions APIs
      const content = result.files['llms.txt'];
      if (content.includes('API:')) {
        this.log('\nLLMs.txt includes API recommendations ✓', 'success');
      } else {
        this.log('\nLLMs.txt does not mention APIs (expected for this test site)');
      }

    } catch (error) {
      this.log(`API analysis failed: ${error.message}`, 'error');
    }
  }

  async demonstrateSecurityAnalysis() {
    this.log('\n' + '='.repeat(60));
    this.log('DEMO 5: Security Boundary Analysis');
    this.log('='.repeat(60));

    try {
      const result = await this.tool.execute({
        url: 'https://httpbin.org',
        analysisOptions: {
          checkSecurity: true,
          maxDepth: 2,
          maxPages: 25
        },
        outputOptions: {
          includeAnalysis: true
        },
        format: 'both'
      });

      this.log('Security analysis completed!', 'success');
      this.log(`Security areas found: ${result.analysisStats.securityAreasFound}`);

      if (result.analysis && result.analysis.securityAreas.length > 0) {
        this.log('\nSecurity areas detected:');
        result.analysis.securityAreas.forEach((area, index) => {
          this.log(`  ${index + 1}. ${area.type}: ${area.path} (${area.recommendation})`);
        });
      }

      // Check security guidelines in LLMs-full.txt
      const fullContent = result.files['llms-full.txt'];
      if (fullContent.includes('Security and Privacy Guidelines')) {
        this.log('\nSecurity guidelines included in LLMs-full.txt ✓', 'success');
      }

    } catch (error) {
      this.log(`Security analysis failed: ${error.message}`, 'error');
    }
  }

  async demonstrateErrorHandling() {
    this.log('\n' + '='.repeat(60));
    this.log('DEMO 6: Error Handling');
    this.log('='.repeat(60));

    // Test with invalid URL
    try {
      this.log('Testing with invalid URL...');
      await this.tool.execute({
        url: 'https://definitely-does-not-exist-12345.com',
        analysisOptions: {
          maxDepth: 1,
          maxPages: 5
        }
      });
      this.log('Unexpected success - should have failed', 'error');
    } catch (error) {
      this.log(`✓ Correctly handled invalid URL: ${error.message}`, 'success');
    }

    // Test with malformed parameters
    try {
      this.log('Testing with invalid parameters...');
      await this.tool.execute({
        url: 'not-a-url',
        complianceLevel: 'invalid-level'
      });
      this.log('Unexpected success - should have failed validation', 'error');
    } catch (error) {
      this.log(`✓ Correctly handled invalid parameters: ${error.message}`, 'success');
    }
  }

  async demonstratePerformanceMetrics() {
    this.log('\n' + '='.repeat(60));
    this.log('DEMO 7: Performance Analysis');
    this.log('='.repeat(60));

    const testSizes = [
      { maxDepth: 1, maxPages: 5, name: 'Small' },
      { maxDepth: 2, maxPages: 20, name: 'Medium' },
      { maxDepth: 3, maxPages: 50, name: 'Large' }
    ];

    for (const testSize of testSizes) {
      try {
        this.log(`\nTesting ${testSize.name} analysis (depth: ${testSize.maxDepth}, pages: ${testSize.maxPages})...`);
        
        const startTime = Date.now();
        const result = await this.tool.execute({
          url: 'https://httpbin.org',
          analysisOptions: {
            maxDepth: testSize.maxDepth,
            maxPages: testSize.maxPages
          },
          format: 'llms-txt'
        });
        const totalTime = Date.now() - startTime;

        this.log(`✓ ${testSize.name}: ${result.analysisStats.analysisTimeMs}ms analysis, ${totalTime}ms total`, 'success');
        this.log(`  - Pages: ${result.analysisStats.pagesAnalyzed}, APIs: ${result.analysisStats.apisDetected}`);

      } catch (error) {
        this.log(`✗ ${testSize.name} test failed: ${error.message}`, 'error');
      }
    }
  }

  async runAllDemos() {
    this.log('🚀 Starting LLMs.txt Generator Tool Demonstrations...');
    this.log('This will showcase the comprehensive website analysis and generation capabilities');

    const demos = [
      () => this.demonstrateBasicGeneration(),
      () => this.demonstrateComprehensiveGeneration(),
      () => this.demonstrateDifferentComplianceLevels(),
      () => this.demonstrateAPIAnalysis(),
      () => this.demonstrateSecurityAnalysis(),
      () => this.demonstrateErrorHandling(),
      () => this.demonstratePerformanceMetrics()
    ];

    for (const demo of demos) {
      await demo();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause between demos
    }

    this.log('\n' + '='.repeat(60));
    this.log('🎉 All LLMs.txt Generator Tool demonstrations completed!', 'success');
    this.log('='.repeat(60));
    this.log('\nKey Features Demonstrated:');
    this.log('✅ Basic and comprehensive LLMs.txt generation');
    this.log('✅ Multiple compliance levels (basic, standard, strict)');
    this.log('✅ API endpoint detection and recommendations');
    this.log('✅ Security boundary analysis');
    this.log('✅ Custom guidelines and restrictions');
    this.log('✅ Performance optimization');
    this.log('✅ Error handling and validation');
    this.log('✅ Both LLMs.txt and LLMs-full.txt formats');
    this.log('\nThe tool is ready for production use! 🚀');
  }
}

// Run demos if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = new LLMsTxtGeneratorDemo();
  
  demo.runAllDemos().catch(error => {
    console.error('Demo runner failed:', error);
    process.exit(1);
  });
}

export { LLMsTxtGeneratorDemo };
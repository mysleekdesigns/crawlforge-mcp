/**
 * Master Integration Test Runner
 * Coordinates all integration test suites and generates comprehensive reports
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

// Import all test suites
import { runMCPComplianceTests } from './mcp-protocol-compliance.test.js';
import { runStdioTransportTests } from './stdio-transport.test.js';
import { runToolIntegrationTests } from './tool-integration.test.js';
import { runErrorHandlingTests } from './error-handling.test.js';
import { runWorkflowTests } from './end-to-end-workflows.test.js';
import { runClaudeCodeIntegrationTests } from './claude-code-integration.test.js';
import { runCursorNPXIntegrationTests } from './cursor-ide-execution.test.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Master Test Configuration
 */
const MASTER_TEST_CONFIG = {
  testSuites: [
    {
      name: 'MCP Protocol Compliance',
      runner: runMCPComplianceTests,
      category: 'protocol',
      priority: 'critical',
      timeout: 300000 // 5 minutes
    },
    {
      name: 'Stdio Transport',
      runner: runStdioTransportTests,
      category: 'transport',
      priority: 'critical',
      timeout: 240000 // 4 minutes
    },
    {
      name: 'Tool Integration',
      runner: runToolIntegrationTests,
      category: 'functionality',
      priority: 'high',
      timeout: 480000 // 8 minutes
    },
    {
      name: 'Error Handling',
      runner: runErrorHandlingTests,
      category: 'reliability',
      priority: 'high',
      timeout: 360000 // 6 minutes
    },
    {
      name: 'End-to-End Workflows',
      runner: runWorkflowTests,
      category: 'integration',
      priority: 'high',
      timeout: 600000 // 10 minutes
    },
    {
      name: 'Claude Code Integration',
      runner: runClaudeCodeIntegrationTests,
      category: 'ide-integration',
      priority: 'medium',
      timeout: 420000 // 7 minutes
    },
    {
      name: 'Cursor NPX Execution',
      runner: runCursorNPXIntegrationTests,
      category: 'deployment',
      priority: 'medium',
      timeout: 360000 // 6 minutes
    }
  ],
  execution: {
    parallelExecution: false, // Run sequentially to avoid resource conflicts
    stopOnCriticalFailure: false, // Continue testing even if critical tests fail
    generateDetailedReport: true,
    saveCombinedReport: true
  },
  reporting: {
    includePerformanceMetrics: true,
    includeErrorAnalysis: true,
    includeRecommendations: true,
    generateReadmeUpdate: true
  }
};

/**
 * Master Test Results Aggregator
 */
class MasterTestResults {
  constructor() {
    this.reset();
  }

  reset() {
    this.testSuites = new Map();
    this.overallMetrics = {
      startTime: Date.now(),
      endTime: null,
      totalDuration: 0,
      totalTests: 0,
      totalPassed: 0,
      totalFailed: 0,
      totalErrors: 0
    };
    this.categoryResults = new Map();
    this.criticalIssues = [];
    this.recommendations = [];
  }

  addTestSuite(suiteName, category, priority, result) {
    this.testSuites.set(suiteName, {
      category,
      priority,
      result,
      timestamp: Date.now()
    });

    // Update category results
    if (!this.categoryResults.has(category)) {
      this.categoryResults.set(category, {
        suites: 0,
        passed: 0,
        failed: 0,
        totalTests: 0,
        passedTests: 0
      });
    }

    const categoryResult = this.categoryResults.get(category);
    categoryResult.suites++;
    
    if (result.success) {
      categoryResult.passed++;
    } else {
      categoryResult.failed++;
      
      // Track critical issues
      if (priority === 'critical') {
        this.criticalIssues.push({
          suite: suiteName,
          category,
          issue: result.error || 'Critical test suite failed',
          priority
        });
      }
    }

    // Aggregate test counts
    if (result.summary) {
      categoryResult.totalTests += result.summary.totalTests || 0;
      categoryResult.passedTests += result.summary.passedTests || 0;
      
      this.overallMetrics.totalTests += result.summary.totalTests || 0;
      this.overallMetrics.totalPassed += result.summary.passedTests || 0;
      this.overallMetrics.totalFailed += (result.summary.totalTests - result.summary.passedTests) || 0;
      this.overallMetrics.totalErrors += result.summary.totalErrors || 0;
    }

    // Collect recommendations
    if (result.recommendations && Array.isArray(result.recommendations)) {
      this.recommendations.push(...result.recommendations.map(rec => ({
        suite: suiteName,
        category,
        recommendation: rec
      })));
    }
  }

  finalize() {
    this.overallMetrics.endTime = Date.now();
    this.overallMetrics.totalDuration = this.overallMetrics.endTime - this.overallMetrics.startTime;
  }

  getSummary() {
    const totalSuites = this.testSuites.size;
    const passedSuites = Array.from(this.testSuites.values()).filter(s => s.result.success).length;
    const failedSuites = totalSuites - passedSuites;
    
    const overallSuccessRate = this.overallMetrics.totalTests > 0 ? 
      (this.overallMetrics.totalPassed / this.overallMetrics.totalTests) * 100 : 0;

    return {
      testSuites: {
        total: totalSuites,
        passed: passedSuites,
        failed: failedSuites,
        successRate: totalSuites > 0 ? (passedSuites / totalSuites) * 100 : 0
      },
      tests: {
        total: this.overallMetrics.totalTests,
        passed: this.overallMetrics.totalPassed,
        failed: this.overallMetrics.totalFailed,
        successRate: overallSuccessRate
      },
      duration: this.overallMetrics.totalDuration,
      errors: this.overallMetrics.totalErrors,
      criticalIssues: this.criticalIssues.length,
      categories: Object.fromEntries(this.categoryResults),
      recommendations: this.recommendations.length
    };
  }
}

/**
 * Master Integration Test Runner
 */
class MasterIntegrationTestRunner {
  constructor() {
    this.results = new MasterTestResults();
  }

  /**
   * Run all integration test suites
   */
  async runAllIntegrationTests() {
    console.log('🏗️ Starting Master Integration Test Suite...');
    console.log('═'.repeat(80));
    console.log(`Running ${MASTER_TEST_CONFIG.testSuites.length} test suites sequentially`);
    console.log('═'.repeat(80));
    
    const startTime = Date.now();
    
    try {
      for (const [index, testSuite] of MASTER_TEST_CONFIG.testSuites.entries()) {
        console.log(`\n[${index + 1}/${MASTER_TEST_CONFIG.testSuites.length}] ${testSuite.name} (${testSuite.priority.toUpperCase()})`);
        console.log('─'.repeat(60));
        
        const suiteStartTime = Date.now();
        let suiteResult = null;
        
        try {
          // Run test suite with timeout
          suiteResult = await this.runTestSuiteWithTimeout(testSuite);
          const suiteDuration = Date.now() - suiteStartTime;
          
          console.log(`✅ ${testSuite.name} completed successfully (${(suiteDuration / 1000).toFixed(1)}s)`);
          
          this.results.addTestSuite(
            testSuite.name,
            testSuite.category,
            testSuite.priority,
            { ...suiteResult, success: true, duration: suiteDuration }
          );
          
        } catch (error) {
          const suiteDuration = Date.now() - suiteStartTime;
          
          console.error(`❌ ${testSuite.name} failed: ${error.message} (${(suiteDuration / 1000).toFixed(1)}s)`);
          
          this.results.addTestSuite(
            testSuite.name,
            testSuite.category,
            testSuite.priority,
            { 
              success: false, 
              error: error.message, 
              duration: suiteDuration,
              summary: { totalTests: 0, passedTests: 0, totalErrors: 1 }
            }
          );
          
          // Check if we should stop on critical failure
          if (testSuite.priority === 'critical' && MASTER_TEST_CONFIG.execution.stopOnCriticalFailure) {
            console.log('🛑 Stopping execution due to critical test failure');
            break;
          }
        }
      }
      
      this.results.finalize();
      
      // Generate comprehensive report
      const masterReport = this.generateMasterReport();
      await this.saveMasterReport(masterReport);
      
      // Print summary
      this.printSummary(masterReport);
      
      return masterReport;
      
    } catch (error) {
      console.error('❌ Master test runner failed:', error);
      throw error;
    }
  }

  /**
   * Run test suite with timeout protection
   */
  async runTestSuiteWithTimeout(testSuite) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Test suite timeout after ${testSuite.timeout / 1000}s`));
      }, testSuite.timeout);
      
      testSuite.runner()
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Generate comprehensive master report
   */
  generateMasterReport() {
    const summary = this.results.getSummary();
    
    return {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      configuration: MASTER_TEST_CONFIG,
      summary,
      executionDetails: this.analyzeExecution(),
      qualityAssessment: this.assessQuality(summary),
      readinessAnalysis: this.analyzeReadiness(summary),
      performanceAnalysis: this.analyzePerformance(),
      criticalIssues: this.results.criticalIssues,
      categoryBreakdown: this.generateCategoryBreakdown(),
      recommendations: this.consolidateRecommendations(),
      testSuiteResults: Object.fromEntries(this.results.testSuites),
      nextSteps: this.generateNextSteps(summary)
    };
  }

  /**
   * Analyze test execution
   */
  analyzeExecution() {
    const testSuites = Array.from(this.results.testSuites.values());
    const durations = testSuites.map(s => s.result.duration || 0);
    
    return {
      totalSuites: testSuites.length,
      executionTime: this.results.overallMetrics.totalDuration,
      averageSuiteTime: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      fastestSuite: Math.min(...durations),
      slowestSuite: Math.max(...durations),
      parallelizationPotential: this.assessParallelizationPotential(testSuites),
      resourceUtilization: this.assessResourceUtilization()
    };
  }

  /**
   * Assess overall quality
   */
  assessQuality(summary) {
    const qualityMetrics = {
      testSuiteReliability: summary.testSuites.successRate,
      testCoverage: summary.tests.successRate,
      errorRate: (summary.errors / summary.tests.total) * 100,
      criticalIssueRate: (summary.criticalIssues / summary.testSuites.total) * 100
    };
    
    // Calculate overall quality score
    const weights = {
      testSuiteReliability: 0.3,
      testCoverage: 0.4,
      errorRate: -0.2, // Negative weight (lower is better)
      criticalIssueRate: -0.1 // Negative weight (lower is better)
    };
    
    let qualityScore = 0;
    qualityScore += qualityMetrics.testSuiteReliability * weights.testSuiteReliability;
    qualityScore += qualityMetrics.testCoverage * weights.testCoverage;
    qualityScore += (100 - qualityMetrics.errorRate) * Math.abs(weights.errorRate);
    qualityScore += (100 - qualityMetrics.criticalIssueRate) * Math.abs(weights.criticalIssueRate);
    
    let qualityRating = 'POOR';
    if (qualityScore >= 90) qualityRating = 'EXCELLENT';
    else if (qualityScore >= 80) qualityRating = 'GOOD';
    else if (qualityScore >= 70) qualityRating = 'ACCEPTABLE';
    else if (qualityScore >= 60) qualityRating = 'NEEDS_IMPROVEMENT';
    
    return {
      score: qualityScore,
      rating: qualityRating,
      metrics: qualityMetrics,
      strengths: this.identifyQualityStrengths(qualityMetrics),
      weaknesses: this.identifyQualityWeaknesses(qualityMetrics)
    };
  }

  /**
   * Analyze production readiness
   */
  analyzeReadiness(summary) {
    const readinessFactors = {
      protocolCompliance: this.getTestSuiteSuccess('MCP Protocol Compliance'),
      transportReliability: this.getTestSuiteSuccess('Stdio Transport'),
      toolFunctionality: this.getTestSuiteSuccess('Tool Integration'),
      errorHandling: this.getTestSuiteSuccess('Error Handling'),
      workflowIntegration: this.getTestSuiteSuccess('End-to-End Workflows'),
      ideIntegration: this.getTestSuiteSuccess('Claude Code Integration') && 
                     this.getTestSuiteSuccess('Cursor NPX Execution')
    };
    
    const readinessScore = Object.values(readinessFactors).filter(Boolean).length;
    const maxScore = Object.keys(readinessFactors).length;
    
    let readinessLevel = 'NOT_READY';
    if (readinessScore >= maxScore) readinessLevel = 'PRODUCTION_READY';
    else if (readinessScore >= maxScore * 0.8) readinessLevel = 'MOSTLY_READY';
    else if (readinessScore >= maxScore * 0.6) readinessLevel = 'PARTIALLY_READY';
    
    return {
      level: readinessLevel,
      score: readinessScore,
      maxScore,
      percentage: (readinessScore / maxScore) * 100,
      factors: readinessFactors,
      blockers: this.identifyReadinessBlockers(readinessFactors),
      enablers: this.identifyReadinessEnablers(readinessFactors)
    };
  }

  /**
   * Analyze performance characteristics
   */
  analyzePerformance() {
    const testSuites = Array.from(this.results.testSuites.values());
    const performanceData = testSuites.map(suite => ({
      name: suite.result.name || 'Unknown',
      duration: suite.result.duration || 0,
      category: suite.category,
      priority: suite.priority
    }));
    
    return {
      overallExecutionTime: this.results.overallMetrics.totalDuration,
      averageSuiteTime: performanceData.reduce((sum, p) => sum + p.duration, 0) / performanceData.length,
      performanceByCategory: this.analyzePerformanceByCategory(performanceData),
      bottlenecks: this.identifyPerformanceBottlenecks(performanceData),
      optimizationOpportunities: this.identifyOptimizationOpportunities(performanceData)
    };
  }

  /**
   * Generate category breakdown
   */
  generateCategoryBreakdown() {
    const breakdown = {};
    
    for (const [category, results] of this.categoryResults) {
      breakdown[category] = {
        ...results,
        successRate: results.suites > 0 ? (results.passed / results.suites) * 100 : 0,
        testSuccessRate: results.totalTests > 0 ? (results.passedTests / results.totalTests) * 100 : 0,
        status: this.determineCategoryStatus(results)
      };
    }
    
    return breakdown;
  }

  /**
   * Consolidate recommendations from all test suites
   */
  consolidateRecommendations() {
    const recommendations = this.results.recommendations;
    
    // Group recommendations by category
    const byCategory = {};
    const bySuite = {};
    const critical = [];
    const general = [];
    
    for (const rec of recommendations) {
      // By category
      if (!byCategory[rec.category]) {
        byCategory[rec.category] = [];
      }
      byCategory[rec.category].push(rec.recommendation);
      
      // By suite
      if (!bySuite[rec.suite]) {
        bySuite[rec.suite] = [];
      }
      bySuite[rec.suite].push(rec.recommendation);
      
      // Categorize by urgency
      if (rec.recommendation.toLowerCase().includes('critical') || 
          rec.recommendation.toLowerCase().includes('fix') ||
          rec.recommendation.toLowerCase().includes('address')) {
        critical.push(rec);
      } else {
        general.push(rec);
      }
    }
    
    return {
      total: recommendations.length,
      byCategory,
      bySuite,
      critical: critical.map(r => r.recommendation),
      general: general.map(r => r.recommendation),
      prioritized: this.prioritizeRecommendations(recommendations)
    };
  }

  /**
   * Generate next steps based on results
   */
  generateNextSteps(summary) {
    const nextSteps = [];
    
    // Based on critical issues
    if (summary.criticalIssues > 0) {
      nextSteps.push({
        priority: 'IMMEDIATE',
        action: 'Fix critical test failures',
        description: `Address ${summary.criticalIssues} critical issues before proceeding`
      });
    }
    
    // Based on success rates
    if (summary.testSuites.successRate < 80) {
      nextSteps.push({
        priority: 'HIGH',
        action: 'Improve test suite reliability',
        description: 'Fix failing test suites to achieve >90% success rate'
      });
    }
    
    if (summary.tests.successRate < 90) {
      nextSteps.push({
        priority: 'HIGH',
        action: 'Improve individual test reliability',
        description: 'Address failing individual tests to achieve >95% success rate'
      });
    }
    
    // Based on readiness analysis
    const readiness = this.analyzeReadiness(summary);
    if (readiness.level === 'NOT_READY') {
      nextSteps.push({
        priority: 'HIGH',
        action: 'Address production readiness blockers',
        description: 'Fix core functionality issues before deployment'
      });
    } else if (readiness.level === 'PARTIALLY_READY') {
      nextSteps.push({
        priority: 'MEDIUM',
        action: 'Complete remaining readiness requirements',
        description: 'Address remaining issues for full production readiness'
      });
    }
    
    // Default next steps if everything is good
    if (nextSteps.length === 0) {
      nextSteps.push({
        priority: 'LOW',
        action: 'Prepare for production deployment',
        description: 'All tests passing - ready for production deployment'
      });
      
      nextSteps.push({
        priority: 'LOW',
        action: 'Set up monitoring',
        description: 'Implement production monitoring and alerting'
      });
    }
    
    return nextSteps;
  }

  // Helper methods

  getTestSuiteSuccess(suiteName) {
    const suite = this.results.testSuites.get(suiteName);
    return suite ? suite.result.success : false;
  }

  identifyQualityStrengths(metrics) {
    const strengths = [];
    if (metrics.testSuiteReliability >= 90) strengths.push('High test suite reliability');
    if (metrics.testCoverage >= 95) strengths.push('Excellent test coverage');
    if (metrics.errorRate <= 5) strengths.push('Low error rate');
    if (metrics.criticalIssueRate === 0) strengths.push('No critical issues');
    return strengths;
  }

  identifyQualityWeaknesses(metrics) {
    const weaknesses = [];
    if (metrics.testSuiteReliability < 80) weaknesses.push('Low test suite reliability');
    if (metrics.testCoverage < 90) weaknesses.push('Insufficient test coverage');
    if (metrics.errorRate > 10) weaknesses.push('High error rate');
    if (metrics.criticalIssueRate > 0) weaknesses.push('Critical issues present');
    return weaknesses;
  }

  identifyReadinessBlockers(factors) {
    const blockers = [];
    for (const [factor, passed] of Object.entries(factors)) {
      if (!passed) {
        blockers.push(factor);
      }
    }
    return blockers;
  }

  identifyReadinessEnablers(factors) {
    const enablers = [];
    for (const [factor, passed] of Object.entries(factors)) {
      if (passed) {
        enablers.push(factor);
      }
    }
    return enablers;
  }

  assessParallelizationPotential(testSuites) {
    // Estimate potential time savings from parallel execution
    const totalSequentialTime = testSuites.reduce((sum, s) => sum + (s.result.duration || 0), 0);
    const maxSuiteTime = Math.max(...testSuites.map(s => s.result.duration || 0));
    const potentialSavings = totalSequentialTime - maxSuiteTime;
    
    return {
      currentTime: totalSequentialTime,
      potentialTime: maxSuiteTime,
      potentialSavings,
      savingsPercentage: totalSequentialTime > 0 ? (potentialSavings / totalSequentialTime) * 100 : 0
    };
  }

  assessResourceUtilization() {
    // Simple resource utilization assessment
    return {
      cpuIntensive: ['Tool Integration', 'End-to-End Workflows'],
      ioIntensive: ['Stdio Transport', 'MCP Protocol Compliance'],
      memoryIntensive: ['Error Handling', 'Claude Code Integration'],
      networkIntensive: ['Tool Integration', 'End-to-End Workflows']
    };
  }

  analyzePerformanceByCategory(performanceData) {
    const byCategory = {};
    
    for (const data of performanceData) {
      if (!byCategory[data.category]) {
        byCategory[data.category] = [];
      }
      byCategory[data.category].push(data.duration);
    }
    
    const categoryPerformance = {};
    for (const [category, durations] of Object.entries(byCategory)) {
      categoryPerformance[category] = {
        averageDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        totalDuration: durations.reduce((sum, d) => sum + d, 0)
      };
    }
    
    return categoryPerformance;
  }

  identifyPerformanceBottlenecks(performanceData) {
    const sortedByDuration = performanceData.sort((a, b) => b.duration - a.duration);
    return sortedByDuration.slice(0, 3).map(p => ({
      name: p.name,
      duration: p.duration,
      category: p.category
    }));
  }

  identifyOptimizationOpportunities(performanceData) {
    const opportunities = [];
    
    // Long-running tests
    const longRunning = performanceData.filter(p => p.duration > 300000); // > 5 minutes
    if (longRunning.length > 0) {
      opportunities.push({
        type: 'Long Running Tests',
        description: 'Consider optimizing or parallelizing long-running test suites',
        affected: longRunning.map(p => p.name)
      });
    }
    
    // Uneven distribution
    const maxDuration = Math.max(...performanceData.map(p => p.duration));
    const avgDuration = performanceData.reduce((sum, p) => sum + p.duration, 0) / performanceData.length;
    if (maxDuration > avgDuration * 3) {
      opportunities.push({
        type: 'Uneven Duration Distribution',
        description: 'Some test suites take significantly longer than others',
        recommendation: 'Consider breaking down large test suites or optimizing slow operations'
      });
    }
    
    return opportunities;
  }

  determineCategoryStatus(results) {
    const suiteSuccessRate = results.suites > 0 ? (results.passed / results.suites) * 100 : 0;
    const testSuccessRate = results.totalTests > 0 ? (results.passedTests / results.totalTests) * 100 : 0;
    
    if (suiteSuccessRate === 100 && testSuccessRate >= 95) return 'EXCELLENT';
    if (suiteSuccessRate >= 80 && testSuccessRate >= 90) return 'GOOD';
    if (suiteSuccessRate >= 60 && testSuccessRate >= 80) return 'ACCEPTABLE';
    return 'NEEDS_IMPROVEMENT';
  }

  prioritizeRecommendations(recommendations) {
    // Sort recommendations by priority keywords
    const priorityKeywords = {
      critical: 5,
      fix: 4,
      address: 4,
      improve: 3,
      optimize: 2,
      consider: 1,
      monitor: 1
    };
    
    return recommendations
      .map(rec => ({
        ...rec,
        priority: this.calculateRecommendationPriority(rec.recommendation, priorityKeywords)
      }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 10) // Top 10 recommendations
      .map(rec => rec.recommendation);
  }

  calculateRecommendationPriority(recommendation, keywords) {
    const lowerRec = recommendation.toLowerCase();
    let priority = 0;
    
    for (const [keyword, weight] of Object.entries(keywords)) {
      if (lowerRec.includes(keyword)) {
        priority += weight;
      }
    }
    
    return priority;
  }

  /**
   * Save master integration report
   */
  async saveMasterReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `master-integration-report-${timestamp}.json`;
    const filepath = join(__dirname, '..', '..', 'cache', filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`\n📄 Master integration report saved: ${filepath}`);
      
      // Also save a summary report
      const summaryFilename = `integration-summary-${timestamp}.md`;
      const summaryFilepath = join(__dirname, '..', '..', 'cache', summaryFilename);
      const summaryContent = this.generateMarkdownSummary(report);
      await fs.writeFile(summaryFilepath, summaryContent);
      console.log(`📄 Integration summary saved: ${summaryFilepath}`);
      
    } catch (error) {
      console.error('❌ Failed to save master report:', error.message);
    }
  }

  /**
   * Generate markdown summary
   */
  generateMarkdownSummary(report) {
    const { summary, qualityAssessment, readinessAnalysis } = report;
    
    return `# MCP WebScraper Integration Test Results

## Executive Summary

- **Overall Quality**: ${qualityAssessment.rating} (${qualityAssessment.score.toFixed(1)}/100)
- **Production Readiness**: ${readinessAnalysis.level} (${readinessAnalysis.percentage.toFixed(1)}%)
- **Test Success Rate**: ${summary.tests.successRate.toFixed(1)}% (${summary.tests.passed}/${summary.tests.total} tests)
- **Test Suite Success Rate**: ${summary.testSuites.successRate.toFixed(1)}% (${summary.testSuites.passed}/${summary.testSuites.total} suites)

## Test Results by Category

${Object.entries(report.categoryBreakdown).map(([category, data]) => `
### ${category.charAt(0).toUpperCase() + category.slice(1)}
- **Status**: ${data.status}
- **Success Rate**: ${data.successRate.toFixed(1)}%
- **Tests**: ${data.passedTests}/${data.totalTests} passed
`).join('')}

## Critical Issues

${report.criticalIssues.length > 0 ? 
  report.criticalIssues.map(issue => `- **${issue.suite}**: ${issue.issue}`).join('\n') :
  'No critical issues identified ✅'
}

## Top Recommendations

${report.recommendations.prioritized.slice(0, 5).map(rec => `- ${rec}`).join('\n')}

## Next Steps

${report.nextSteps.map(step => `
### ${step.priority} Priority: ${step.action}
${step.description}
`).join('')}

---
*Generated on ${new Date().toISOString()}*
`;
  }

  /**
   * Print comprehensive summary
   */
  printSummary(report) {
    const { summary, qualityAssessment, readinessAnalysis } = report;
    
    console.log('\n');
    console.log('═'.repeat(80));
    console.log('🏁 MASTER INTEGRATION TEST RESULTS');
    console.log('═'.repeat(80));
    
    console.log('\n📊 OVERALL SUMMARY:');
    console.log(`   Quality Assessment: ${qualityAssessment.rating} (${qualityAssessment.score.toFixed(1)}/100)`);
    console.log(`   Production Readiness: ${readinessAnalysis.level} (${readinessAnalysis.percentage.toFixed(1)}%)`);
    console.log(`   Total Duration: ${(summary.duration / 1000 / 60).toFixed(1)} minutes`);
    
    console.log('\n🎯 TEST RESULTS:');
    console.log(`   Test Suites: ${summary.testSuites.passed}/${summary.testSuites.total} passed (${summary.testSuites.successRate.toFixed(1)}%)`);
    console.log(`   Individual Tests: ${summary.tests.passed}/${summary.tests.total} passed (${summary.tests.successRate.toFixed(1)}%)`);
    console.log(`   Total Errors: ${summary.errors}`);
    
    console.log('\n📂 RESULTS BY CATEGORY:');
    Object.entries(report.categoryBreakdown).forEach(([category, data]) => {
      const statusEmoji = data.status === 'EXCELLENT' ? '🟢' : 
                         data.status === 'GOOD' ? '🟡' : 
                         data.status === 'ACCEPTABLE' ? '🟠' : '🔴';
      console.log(`   ${statusEmoji} ${category}: ${data.successRate.toFixed(1)}% (${data.passed}/${data.suites} suites)`);
    });
    
    if (report.criticalIssues.length > 0) {
      console.log('\n🚨 CRITICAL ISSUES:');
      report.criticalIssues.forEach(issue => {
        console.log(`   • ${issue.suite}: ${issue.issue}`);
      });
    }
    
    console.log('\n💡 TOP RECOMMENDATIONS:');
    report.recommendations.prioritized.slice(0, 5).forEach(rec => {
      console.log(`   • ${rec}`);
    });
    
    console.log('\n🚀 NEXT STEPS:');
    report.nextSteps.forEach(step => {
      const priorityEmoji = step.priority === 'IMMEDIATE' ? '🔥' :
                           step.priority === 'HIGH' ? '⚡' :
                           step.priority === 'MEDIUM' ? '📋' : '💭';
      console.log(`   ${priorityEmoji} ${step.action}: ${step.description}`);
    });
    
    console.log('\n═'.repeat(80));
    const finalStatus = readinessAnalysis.level === 'PRODUCTION_READY' ? 
      '✅ READY FOR PRODUCTION DEPLOYMENT' : 
      readinessAnalysis.level === 'MOSTLY_READY' ?
      '🟡 MOSTLY READY - FEW ISSUES TO ADDRESS' :
      '🔴 NOT READY FOR PRODUCTION';
    console.log(finalStatus);
    console.log('═'.repeat(80));
  }
}

/**
 * Main execution function
 */
async function runMasterIntegrationTests() {
  const runner = new MasterIntegrationTestRunner();
  
  try {
    const report = await runner.runAllIntegrationTests();
    
    // Return report for programmatic use
    return report;
    
  } catch (error) {
    console.error('❌ Master integration test execution failed:', error);
    process.exit(1);
  }
}

// Export for use in other test files
export { MasterIntegrationTestRunner, runMasterIntegrationTests };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMasterIntegrationTests()
    .then((report) => {
      const exitCode = report.readinessAnalysis.level === 'PRODUCTION_READY' ? 0 : 1;
      console.log(`\n🏁 Master integration test completed with exit code ${exitCode}`);
      process.exit(exitCode);
    })
    .catch((error) => {
      console.error('❌ Master integration test failed:', error);
      process.exit(1);
    });
}
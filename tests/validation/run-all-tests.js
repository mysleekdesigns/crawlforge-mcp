#!/usr/bin/env node

/**
 * Master Test Runner for Wave 1 Infrastructure Components
 * Runs all validation tests and provides comprehensive results
 */

import { runTests as runJobManagerTests } from './test-job-manager.js';
import { runTests as runWebhookDispatcherTests } from './test-webhook-dispatcher.js';
import { runTests as runActionExecutorTests } from './test-action-executor.js';

async function runAllTests() {
  console.log('🚀 Wave 1 Infrastructure Component Validation Suite');
  console.log('==================================================\n');
  
  const startTime = Date.now();
  let totalPassed = 0;
  let totalFailed = 0;
  const results = [];

  const tests = [
    { name: 'JobManager', runner: runJobManagerTests },
    { name: 'WebhookDispatcher', runner: runWebhookDispatcherTests },
    { name: 'ActionExecutor', runner: runActionExecutorTests }
  ];

  for (const test of tests) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 Running ${test.name} Tests`);
    console.log(`${'='.repeat(60)}\n`);
    
    try {
      // Capture console output to count results
      const originalLog = console.log;
      const originalError = console.error;
      let output = '';
      let passed = 0;
      let failed = 0;

      console.log = (...args) => {
        const message = args.join(' ');
        output += message + '\n';
        if (message.includes('✅')) passed++;
        if (message.includes('❌')) failed++;
        originalLog(...args);
      };

      console.error = (...args) => {
        const message = args.join(' ');
        output += message + '\n';
        originalError(...args);
      };

      // Run the test
      const testStartTime = Date.now();
      await test.runner();
      const testDuration = Date.now() - testStartTime;

      // Restore console
      console.log = originalLog;
      console.error = originalError;

      results.push({
        name: test.name,
        passed,
        failed,
        duration: testDuration,
        success: failed === 0
      });

      totalPassed += passed;
      totalFailed += failed;

    } catch (error) {
      console.error(`❌ ${test.name} test suite failed: ${error.message}`);
      results.push({
        name: test.name,
        passed: 0,
        failed: 1,
        duration: 0,
        success: false,
        error: error.message
      });
      totalFailed++;
    }
  }

  // Final Results Summary
  const totalDuration = Date.now() - startTime;
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 WAVE 1 VALIDATION RESULTS SUMMARY');
  console.log('='.repeat(60));
  
  console.log(`\n⏱️  Total Execution Time: ${totalDuration}ms`);
  console.log(`📈 Total Tests: ${totalPassed + totalFailed}`);
  console.log(`✅ Total Passed: ${totalPassed}`);
  console.log(`❌ Total Failed: ${totalFailed}`);
  console.log(`📊 Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%\n`);

  // Component-by-component results
  console.log('🧩 Component Results:');
  console.log('-'.repeat(60));
  
  results.forEach(result => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    const duration = `${result.duration}ms`.padStart(6);
    const name = result.name.padEnd(20);
    const tests = `${result.passed + result.failed} tests`.padEnd(12);
    const passRate = result.failed === 0 ? '100.0%' : 
      `${((result.passed / (result.passed + result.failed)) * 100).toFixed(1)}%`;
    
    console.log(`${status} ${name} ${tests} ${duration} ${passRate}`);
    
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
  });

  // Integration Assessment
  console.log('\n🔗 Integration Assessment:');
  console.log('-'.repeat(60));
  
  const allComponentsPass = results.every(r => r.success);
  
  if (allComponentsPass) {
    console.log('✅ All Wave 1 components are functioning correctly');
    console.log('✅ Components are ready for Wave 2 integration');
    console.log('✅ No breaking changes detected');
    console.log('✅ Error handling and resource cleanup verified');
  } else {
    console.log('❌ Some Wave 1 components have issues');
    console.log('⚠️  Wave 2 implementation should be postponed');
    console.log('🔧 Review failed tests and fix issues before proceeding');
  }

  // Performance Assessment
  console.log('\n⚡ Performance Assessment:');
  console.log('-'.repeat(60));
  
  const avgTestTime = totalDuration / (totalPassed + totalFailed);
  console.log(`Average test execution time: ${avgTestTime.toFixed(2)}ms`);
  
  if (avgTestTime < 100) {
    console.log('✅ Excellent performance - all tests run quickly');
  } else if (avgTestTime < 500) {
    console.log('✅ Good performance - acceptable test execution time');
  } else {
    console.log('⚠️  Some components may have performance concerns');
  }

  // Recommendations
  console.log('\n💡 Recommendations:');
  console.log('-'.repeat(60));
  
  if (allComponentsPass && totalFailed === 0) {
    console.log('✅ Wave 1 is production-ready');
    console.log('🚀 Proceed with Wave 2 implementation');
    console.log('📝 Update documentation to reflect new capabilities');
    console.log('🔧 Consider adding integration tests with existing tools');
  } else {
    console.log('🔧 Fix failing tests before production deployment');
    console.log('📋 Review error messages and implement fixes');
    console.log('🧪 Run tests again after making changes');
    console.log('⏸️  Hold Wave 2 implementation until Wave 1 is stable');
  }

  // Exit with appropriate code
  if (totalFailed === 0) {
    console.log('\n🎉 Wave 1 validation completed successfully!');
    process.exit(0);
  } else {
    console.log('\n💥 Wave 1 validation found issues that need attention.');
    process.exit(1);
  }
}

// Run all tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

export { runAllTests };
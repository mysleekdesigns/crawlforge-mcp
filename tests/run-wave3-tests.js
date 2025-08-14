#!/usr/bin/env node

/**
 * Wave 3 Test Runner - Simple execution script for Wave 3 feature tests
 * Provides a unified interface to run different categories of Wave 3 tests
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function showHelp() {
  log('\nWave 3 Test Runner', 'bright');
  log('================', 'bright');
  log('\nUsage: node run-wave3-tests.js [command] [options]', 'cyan');
  log('\nCommands:', 'yellow');
  log('  unit          Run unit tests for all Wave 3 components');
  log('  integration   Run integration tests');
  log('  validation    Run comprehensive validation suite');
  log('  all           Run all Wave 3 tests');
  log('  quick         Run quick validation (skip slow tests)');
  log('  component     Run tests for specific component');
  log('\nOptions:', 'yellow');
  log('  --verbose     Enable verbose output');
  log('  --help        Show this help message');
  log('\nExamples:', 'cyan');
  log('  node run-wave3-tests.js unit');
  log('  node run-wave3-tests.js validation --verbose');
  log('  node run-wave3-tests.js component ResearchOrchestrator');
  log('  node run-wave3-tests.js quick');
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    log(`\nExecuting: ${command} ${args.join(' ')}`, 'cyan');
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: options.cwd || process.cwd(),
      ...options
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        log(`✓ Command completed successfully`, 'green');
        resolve(code);
      } else {
        log(`✗ Command failed with exit code ${code}`, 'red');
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      log(`✗ Command error: ${error.message}`, 'red');
      reject(error);
    });
  });
}

async function runUnitTests(verbose = false) {
  log('Running Wave 3 Unit Tests...', 'bright');
  
  const testFiles = [
    'tests/unit/ResearchOrchestrator.test.js',
    'tests/unit/StealthMode.test.js', 
    'tests/unit/LocalizationManager.test.js',
    'tests/unit/ChangeTracker.test.js'
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const testFile of testFiles) {
    try {
      log(`\n--- Running ${testFile} ---`, 'yellow');
      const args = verbose ? ['--verbose', testFile] : [testFile];
      await runCommand('jest', args);
      passed++;
    } catch (error) {
      log(`Failed: ${testFile}`, 'red');
      failed++;
    }
  }
  
  log(`\nUnit Test Results: ${passed} passed, ${failed} failed`, passed > failed ? 'green' : 'red');
  return { passed, failed };
}

async function runIntegrationTests(verbose = false) {
  log('Running Wave 3 Integration Tests...', 'bright');
  
  try {
    const args = verbose ? 
      ['--verbose', 'tests/integration/wave3-integration.test.js'] :
      ['tests/integration/wave3-integration.test.js'];
    
    await runCommand('jest', args);
    log('✓ Integration tests passed', 'green');
    return { passed: 1, failed: 0 };
  } catch (error) {
    log('✗ Integration tests failed', 'red');
    return { passed: 0, failed: 1 };
  }
}

async function runValidationSuite(quick = false, verbose = false) {
  log('Running Wave 3 Validation Suite...', 'bright');
  
  try {
    const args = ['tests/validation/wave3-validation.js'];
    if (quick) args.push('--quick');
    if (verbose) args.push('--verbose');
    
    await runCommand('node', args);
    log('✓ Validation suite passed', 'green');
    return { passed: 1, failed: 0 };
  } catch (error) {
    log('✗ Validation suite failed', 'red');
    return { passed: 0, failed: 1 };
  }
}

async function runComponentTests(component, verbose = false) {
  log(`Running tests for ${component}...`, 'bright');
  
  const componentMap = {
    'ResearchOrchestrator': 'tests/unit/ResearchOrchestrator.test.js',
    'research': 'tests/unit/ResearchOrchestrator.test.js',
    'StealthMode': 'tests/unit/StealthMode.test.js',
    'stealth': 'tests/unit/StealthMode.test.js',
    'LocalizationManager': 'tests/unit/LocalizationManager.test.js',
    'localization': 'tests/unit/LocalizationManager.test.js',
    'ChangeTracker': 'tests/unit/ChangeTracker.test.js',
    'change': 'tests/unit/ChangeTracker.test.js',
    'tracking': 'tests/unit/ChangeTracker.test.js'
  };
  
  const testFile = componentMap[component];
  if (!testFile) {
    log(`Unknown component: ${component}`, 'red');
    log(`Available components: ${Object.keys(componentMap).join(', ')}`, 'yellow');
    return { passed: 0, failed: 1 };
  }
  
  try {
    const args = verbose ? ['--verbose', testFile] : [testFile];
    await runCommand('jest', args);
    log(`✓ ${component} tests passed`, 'green');
    return { passed: 1, failed: 0 };
  } catch (error) {
    log(`✗ ${component} tests failed`, 'red');
    return { passed: 0, failed: 1 };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const verbose = args.includes('--verbose');
  
  if (args.includes('--help') || command === 'help') {
    showHelp();
    return;
  }
  
  log('Wave 3 Features Test Runner', 'bright');
  log('===========================', 'bright');
  
  const startTime = Date.now();
  let totalResults = { passed: 0, failed: 0 };
  
  try {
    switch (command) {
      case 'unit':
        const unitResults = await runUnitTests(verbose);
        totalResults.passed += unitResults.passed;
        totalResults.failed += unitResults.failed;
        break;
        
      case 'integration':
        const integrationResults = await runIntegrationTests(verbose);
        totalResults.passed += integrationResults.passed;
        totalResults.failed += integrationResults.failed;
        break;
        
      case 'validation':
        const validationResults = await runValidationSuite(false, verbose);
        totalResults.passed += validationResults.passed;
        totalResults.failed += validationResults.failed;
        break;
        
      case 'quick':
        log('Running quick validation suite...', 'cyan');
        const quickResults = await runValidationSuite(true, verbose);
        totalResults.passed += quickResults.passed;
        totalResults.failed += quickResults.failed;
        break;
        
      case 'component':
        const componentName = args[1];
        if (!componentName) {
          log('Error: Component name required', 'red');
          log('Usage: node run-wave3-tests.js component <componentName>', 'yellow');
          process.exit(1);
        }
        const componentResults = await runComponentTests(componentName, verbose);
        totalResults.passed += componentResults.passed;
        totalResults.failed += componentResults.failed;
        break;
        
      case 'all':
        log('Running all Wave 3 tests...', 'cyan');
        
        // Run unit tests
        const allUnitResults = await runUnitTests(verbose);
        totalResults.passed += allUnitResults.passed;
        totalResults.failed += allUnitResults.failed;
        
        // Run integration tests
        const allIntegrationResults = await runIntegrationTests(verbose);
        totalResults.passed += allIntegrationResults.passed;
        totalResults.failed += allIntegrationResults.failed;
        
        // Run validation suite
        const allValidationResults = await runValidationSuite(false, verbose);
        totalResults.passed += allValidationResults.passed;
        totalResults.failed += allValidationResults.failed;
        break;
        
      default:
        log(`Unknown command: ${command}`, 'red');
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    log(`Test execution failed: ${error.message}`, 'red');
    process.exit(1);
  }
  
  const duration = Math.round((Date.now() - startTime) / 1000);
  
  log('\n=== Test Summary ===', 'bright');
  log(`Duration: ${duration}s`, 'cyan');
  log(`Passed: ${totalResults.passed}`, 'green');
  log(`Failed: ${totalResults.failed}`, totalResults.failed > 0 ? 'red' : 'green');
  
  const successRate = totalResults.passed + totalResults.failed > 0 ?
    Math.round((totalResults.passed / (totalResults.passed + totalResults.failed)) * 100) : 0;
  log(`Success Rate: ${successRate}%`, successRate >= 80 ? 'green' : 'red');
  
  if (totalResults.failed > 0) {
    log('\nSome tests failed. Check the output above for details.', 'yellow');
    process.exit(1);
  } else {
    log('\nAll tests passed successfully!', 'green');
    process.exit(0);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log(`Uncaught Exception: ${error.message}`, 'red');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled Promise Rejection: ${reason}`, 'red');
  process.exit(1);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
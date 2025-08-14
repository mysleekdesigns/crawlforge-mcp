# Wave 3 Features Testing Guide

This document provides comprehensive information about testing the Wave 3 features of the MCP WebScraper project.

## Wave 3 Features Overview

Wave 3 introduces four major feature sets:

1. **Deep Research Tool** - ResearchOrchestrator with multi-stage research workflows
2. **Stealth Mode** - StealthBrowserManager and HumanBehaviorSimulator for anti-detection
3. **Localization** - LocalizationManager for region-specific browsing and content handling
4. **Change Tracking** - ChangeTracker and SnapshotManager for content change detection

## Test Structure

### Unit Tests (`tests/unit/`)
- `ResearchOrchestrator.test.js` - Tests for deep research functionality
- `StealthMode.test.js` - Tests for stealth browsing and human behavior simulation
- `LocalizationManager.test.js` - Tests for localization and regional settings
- `ChangeTracker.test.js` - Tests for change detection and analysis

### Integration Tests (`tests/integration/`)
- `wave3-integration.test.js` - Cross-component integration testing

### Validation Tests (`tests/validation/`)
- `wave3-validation.js` - Comprehensive validation suite for all Wave 3 features

## Running Tests

### Quick Commands

```bash
# Run all Wave 3 tests
npm run test:wave3

# Run Wave 3 tests with verbose output
npm run test:wave3:verbose

# Run Wave 3 tests quickly (skip slow tests)
npm run test:wave3:quick

# Run only Wave 3 unit tests
npm run test:unit:wave3

# Run only Wave 3 integration tests
npm run test:integration:wave3
```

### Individual Test Execution

```bash
# Test specific components
node tests/validation/wave3-validation.js --verbose

# Run with Jest for unit tests
jest tests/unit/ResearchOrchestrator.test.js
jest tests/unit/StealthMode.test.js
jest tests/unit/LocalizationManager.test.js
jest tests/unit/ChangeTracker.test.js

# Run integration tests
jest tests/integration/wave3-integration.test.js
```

### Test Configuration Options

The validation script supports several command-line options:

- `--verbose` - Enable detailed output
- `--quick` - Skip slow/long-running tests
- `--no-report` - Skip generating test reports

## Test Coverage

### ResearchOrchestrator Tests
- Initialization and configuration validation
- Query expansion functionality
- Research session management
- Source verification and credibility scoring
- Conflict detection in information
- Full research workflow testing
- Performance and resource management
- Integration with other MCP tools

### StealthBrowserManager Tests
- Browser launch with anti-detection configurations
- Fingerprint generation and randomization
- Anti-detection script injection
- Context and page management
- Human behavior simulation integration
- Resource management and cleanup
- Configuration validation

### LocalizationManager Tests
- Country configuration management
- Language and locale handling
- Timezone and geolocation management
- HTTP header generation
- Browser context configuration
- Content localization and translation
- Performance optimization and caching

### ChangeTracker Tests
- Content hashing and snapshot management
- Change detection algorithms
- Significance scoring and classification
- Differential analysis
- Real-time monitoring capabilities
- Statistics and reporting
- Error handling and recovery

### Integration Tests
- Cross-component functionality
- Research with stealth browsing
- Localized research workflows
- Change tracking during research
- Multi-regional analysis
- Error recovery across components
- Performance and scalability testing

## Test Environments

### Prerequisites
- Node.js 18+ with ES modules support
- Playwright dependencies (for stealth testing)
- Jest testing framework
- Required npm packages installed

### Environment Variables
```bash
# Optional: For enhanced testing
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=false
NODE_ENV=test
```

### Test Data
The tests use mock data and simulated scenarios to avoid dependency on external services during testing.

## Performance Benchmarks

### Expected Performance Metrics
- **ResearchOrchestrator**: < 30s for standard research workflows
- **StealthBrowserManager**: < 5s for browser context creation
- **LocalizationManager**: < 1s for configuration generation
- **ChangeTracker**: < 2s for change detection on typical content

### Memory Usage
- Individual components: < 50MB baseline memory usage
- Full integration: < 200MB peak memory usage
- Memory cleanup: No significant leaks after component destruction

## Test Reports

Test execution generates comprehensive reports:

### Report Locations
- JSON Report: `test-results/wave3-validation/wave3-validation-report.json`
- Summary Report: `test-results/wave3-validation/wave3-validation-summary.txt`

### Report Contents
- Test execution summary
- Component coverage percentages
- Performance metrics
- Error and warning details
- System information

## Troubleshooting

### Common Issues

#### Jest Configuration
If Jest tests fail to run:
```bash
# Install Jest if missing
npm install --save-dev jest @jest/globals

# Ensure proper ES module configuration in package.json
"type": "module"
```

#### Playwright Dependencies
For stealth browser testing:
```bash
# Install Playwright browsers
npx playwright install chromium

# For Linux/Docker environments
npx playwright install-deps
```

#### Mock Dependencies
Some tests use mocked external services. Ensure mock implementations are properly configured if tests fail unexpectedly.

### Test Debugging

Enable verbose logging:
```bash
DEBUG=* npm run test:wave3:verbose
```

Run individual test files for focused debugging:
```bash
jest tests/unit/ResearchOrchestrator.test.js --verbose
```

### Performance Issues

If tests run slowly:
```bash
# Use quick test mode
npm run test:wave3:quick

# Skip integration tests
npm run test:unit:wave3
```

## Continuous Integration

### GitHub Actions Integration
The Wave 3 tests are integrated into the CI pipeline:

```yaml
# Example CI configuration
- name: Run Wave 3 Tests
  run: npm run test:wave3:quick
  timeout-minutes: 15

- name: Upload Test Reports
  uses: actions/upload-artifact@v3
  with:
    name: wave3-test-reports
    path: test-results/wave3-validation/
```

### Test Reliability
- Tests are designed to be deterministic and repeatable
- Mock implementations avoid network dependencies
- Timeouts are configured to prevent hanging tests
- Cleanup procedures ensure proper resource management

## Contributing

### Adding New Tests

1. **Unit Tests**: Add to appropriate component test file
2. **Integration Tests**: Add to `wave3-integration.test.js`
3. **Validation Tests**: Add to `wave3-validation.js`

### Test Conventions

- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)
- Include both positive and negative test cases
- Test error conditions and edge cases
- Clean up resources in afterEach/afterAll hooks

### Performance Testing

When adding performance-sensitive features:
- Include performance benchmarks in tests
- Set reasonable timeout limits
- Test memory usage patterns
- Validate cleanup procedures

## Security Considerations

### Sensitive Data
- No real credentials or API keys in tests
- Use mock data for external service interactions
- Sanitize any logged output in test reports

### Resource Limits
- Browser instances are properly closed
- File handles are cleaned up
- Memory usage is monitored
- Network connections are terminated

This testing framework ensures the reliability, performance, and security of all Wave 3 features while providing comprehensive coverage and detailed reporting.
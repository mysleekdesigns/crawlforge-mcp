# Performance Testing Suite

Comprehensive performance testing suite for the MCP WebScraper project, designed to validate the Phase 4 performance optimizations and ensure system reliability under various load conditions.

## Overview

This testing suite provides four specialized test modules that thoroughly validate the performance characteristics of the MCP WebScraper:

### Test Modules

1. **Load Testing** (`load-test.js`)
   - Tests 100+ concurrent requests
   - Measures response times and throughput
   - Validates system behavior under sustained load
   - Reports comprehensive performance metrics

2. **Memory Testing** (`memory-test.js`)
   - Monitors memory usage during large crawls
   - Detects memory leaks through repeated operations
   - Tests cleanup routines and garbage collection
   - Validates streaming vs buffering approaches

3. **Benchmark Suite** (`benchmark.js`)
   - Compares performance before/after optimizations
   - Tests individual component performance
   - Identifies bottlenecks and optimization opportunities
   - Generates comparison reports

4. **Integration Testing** (`performance-integration.test.js`)
   - Tests WorkerPool integration and isolation
   - Validates error handling systems
   - Tests component communication and coordination
   - Stress tests and recovery scenarios

## Quick Start

### Prerequisites

- Node.js 18+ with `--expose-gc` flag support
- At least 1GB available RAM
- Internet connection for external URL testing

### Running Tests

```bash
# Run complete performance test suite (recommended)
npm run test:performance

# Run individual test suites
npm run test:load          # Load testing
npm run test:memory        # Memory testing  
npm run test:benchmark     # Benchmark suite
npm run test:integration   # Integration testing

# Quick run (without garbage collection optimization)
npm run test:performance:quick
```

### Expected Runtime

- **Complete Suite**: 15-25 minutes
- **Load Testing**: 3-5 minutes
- **Memory Testing**: 8-12 minutes
- **Benchmark Suite**: 5-8 minutes
- **Integration Testing**: 4-6 minutes

## Test Configuration

### Load Test Configuration

```javascript
const LOAD_TEST_CONFIG = {
  concurrentRequests: 150,        // Number of concurrent requests
  testDurationMs: 60000,          // Test duration (1 minute)
  rampUpTimeMs: 10000,           // Gradual ramp-up (10 seconds)
  maxRequestsPerSecond: 50,       // Rate limiting
  
  scenarios: {
    fetchUrl: { weight: 30 },     // 30% of requests
    extractText: { weight: 25 },  // 25% of requests
    extractLinks: { weight: 20 }, // 20% of requests
    searchWeb: { weight: 15 },    // 15% of requests
    crawlDeep: { weight: 10 }     // 10% of requests
  }
};
```

### Memory Test Configuration

```javascript
const MEMORY_TEST_CONFIG = {
  largeCrawl: {
    urlCount: 1000,               // URLs to process
    concurrent: 20,               // Concurrent operations
    dataSize: 1024 * 1024        // 1MB per response
  },
  
  leakDetection: {
    iterations: 100,              // Test iterations
    memoryThreshold: 50 * 1024 * 1024, // 50MB threshold
    gcForceInterval: 10           // Force GC every 10 iterations
  }
};
```

## Performance Baselines

The test suite validates against these performance baselines:

### Response Time Targets
- **P50**: ≤ 1 second
- **P95**: ≤ 3 seconds  
- **P99**: ≤ 5 seconds

### Throughput Targets
- **Requests/Second**: ≥ 10 req/s
- **Operations/Second**: ≥ 50 ops/s

### Memory Targets
- **Peak Usage**: ≤ 256MB
- **Average Usage**: ≤ 128MB
- **Memory Leaks**: None detected
- **Cleanup Effectiveness**: ≥ 80%

### System Targets
- **Success Rate**: ≥ 95%
- **Error Rate**: ≤ 5%
- **CPU Utilization**: ≤ 90% peak

## Test Reports

All tests generate detailed reports saved to the `cache/` directory:

### Report Types

1. **Comprehensive Reports** (`*-comprehensive-*.json`)
   - Complete test results and metrics
   - System information and configuration
   - Detailed analysis and recommendations

2. **Summary Reports** (`*-summary-*.json`)
   - Key metrics and performance indicators
   - Pass/fail status and success rates
   - Executive summary format

3. **CSV Metrics** (`*-metrics-*.csv`)
   - Tabular performance data
   - Easy import into analysis tools
   - Trend analysis support

### Sample Report Structure

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "summary": {
    "totalTests": 4,
    "successfulTests": 4,
    "overallSuccessRate": 100,
    "combinedMetrics": {
      "peakThroughput": 45.2,
      "averageResponseTime": 847,
      "peakMemoryUsage": 187234560
    }
  },
  "analysis": {
    "status": "PASS",
    "performance": {
      "rating": "GOOD"
    }
  },
  "recommendations": [
    "All performance tests passed successfully",
    "System is ready for production deployment"
  ]
}
```

## Performance Optimizations Tested

The test suite validates these Phase 4 optimizations:

### 1. WorkerPool Implementation
- **CPU-intensive task distribution**
- **Worker lifecycle management**
- **Task retry and error handling**
- **Memory isolation between workers**

### 2. ConnectionPool Management
- **HTTP connection reuse**
- **Concurrent request limiting**
- **Connection timeout handling**
- **Backpressure management**

### 3. StreamProcessor Efficiency
- **Memory-efficient data processing**
- **Chunked processing for large datasets**
- **Memory limit enforcement**
- **Streaming vs buffering optimization**

### 4. PerformanceManager Integration
- **Intelligent task routing**
- **Component coordination**
- **Resource optimization**
- **Real-time metrics collection**

## Troubleshooting

### Common Issues

#### Memory Issues
```bash
# If you see "JavaScript heap out of memory"
node --max-old-space-size=4096 --expose-gc tests/performance/test-runner.js
```

#### Network Timeouts
```bash
# For environments with slow network connections
export TEST_TIMEOUT_MULTIPLIER=2
npm run test:performance
```

#### Permission Issues
```bash
# Ensure proper permissions for cache directory
chmod 755 cache/
chmod 644 cache/*
```

### Environment Variables

```bash
# Optional environment variables for customization
export MAX_WORKERS=8              # Override default worker count
export QUEUE_CONCURRENCY=12       # Override queue concurrency
export RATE_LIMIT_REQUESTS_PER_SECOND=15  # Override rate limits
export CACHE_TTL=7200000          # Override cache TTL (2 hours)
```

### Debug Mode

```bash
# Enable debug logging
DEBUG=performance:* npm run test:performance

# Verbose memory tracking
NODE_OPTIONS="--expose-gc --trace-gc" npm run test:memory
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Performance Tests
on: [push, pull_request]

jobs:
  performance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:performance
      - uses: actions/upload-artifact@v3
        with:
          name: performance-reports
          path: cache/*-report-*.json
```

### Performance Regression Detection

The test suite can be used for continuous performance monitoring:

```bash
# Save baseline performance metrics
npm run test:benchmark > baseline.json

# Compare against baseline in CI
npm run test:benchmark | node scripts/compare-performance.js baseline.json
```

## Contributing

When adding new performance tests:

1. **Follow the existing pattern**: Use similar structure and reporting format
2. **Add configuration**: Include configuration options at the top of the file
3. **Generate reports**: Ensure tests save reports to the cache directory
4. **Update documentation**: Add test description to this README
5. **Test locally**: Verify tests pass in isolation and as part of the suite

### Test Development Guidelines

- Tests should be deterministic and repeatable
- Include both positive and negative test scenarios
- Validate cleanup and resource management
- Generate actionable metrics and recommendations
- Handle timeouts and error conditions gracefully

## Performance Analysis

### Key Metrics to Monitor

1. **Response Time Distribution**
   - Mean, median, and percentile response times
   - Response time trends over test duration
   - Outlier detection and analysis

2. **Throughput Analysis**
   - Requests per second under various loads
   - Scalability characteristics
   - Bottleneck identification

3. **Resource Utilization**
   - Memory usage patterns and peaks
   - CPU utilization distribution
   - I/O wait times and network usage

4. **Error Analysis**
   - Error rates and types
   - Error clustering and patterns
   - Recovery time analysis

### Performance Regression Indicators

Monitor these indicators for performance regressions:

- **Response time increase** > 20%
- **Throughput decrease** > 15%
- **Memory usage increase** > 25%
- **Error rate increase** > 5%
- **Success rate decrease** < 95%

## Support

For issues with the performance testing suite:

1. Check the [troubleshooting section](#troubleshooting)
2. Review test logs in the `cache/` directory
3. Run individual test modules to isolate issues
4. Check system resources and network connectivity
5. Verify Node.js version compatibility

The performance testing suite is designed to be robust and provide clear feedback on system performance characteristics. Regular execution helps ensure the MCP WebScraper maintains high performance standards as the codebase evolves.
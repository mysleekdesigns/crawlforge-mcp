# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server implementation providing 16 comprehensive web scraping, crawling, and content processing tools. Version 3.0 includes advanced content extraction, document processing, summarization, and analysis capabilities. Wave 2 adds asynchronous batch processing and browser automation features. Wave 3 introduces deep research orchestration, stealth scraping, localization, and change tracking.

## Development Commands

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env to add Google API credentials if using Google search

# Run the server
npm start

# Test MCP protocol compliance
# NOTE: test-server.js doesn't exist, use integration tests instead
npm run test:integration      # Integration tests including MCP compliance

# Lint checks (no linter configured yet, placeholder)
npm run lint

# Performance tests
npm run test:performance       # Full performance test suite
npm run test:performance:quick # Quick performance tests
npm run test:load             # Load testing
npm run test:memory           # Memory usage tests
npm run test:benchmark        # Component benchmarks
npm run test:integration      # Integration tests
npm run test:security         # Security test suite
npm run test:all             # Run all tests

# Wave 2 Validation Tests
node tests/validation/test-wave2-runner.js  # Test Wave 2 features
node tests/validation/test-batch-scrape.js  # Test batch scraping
node tests/validation/test-scrape-with-actions.js  # Test action scraping
node tests/integration/master-test-runner.js # Run master test suite

# Wave 3 Tests
npm run test:wave3             # Full Wave 3 validation
npm run test:wave3:quick       # Quick Wave 3 tests
npm run test:wave3:verbose     # Verbose Wave 3 output
npm run test:unit:wave3        # Wave 3 unit tests (Jest)
npm run test:integration:wave3 # Wave 3 integration tests

# Docker commands
npm run docker:build         # Build Docker image
npm run docker:dev          # Run development container
npm run docker:prod         # Run production container
npm run docker:test         # Run test container
npm run docker:perf         # Run performance test container

# Security Testing (CI/CD Integration)
npm run test:security       # Run comprehensive security test suite
npm audit                   # Check for dependency vulnerabilities
npm audit fix               # Automatically fix vulnerabilities
npm outdated                # Check for outdated packages

# Release management
npm run release:patch       # Patch version bump
npm run release:minor       # Minor version bump
npm run release:major       # Major version bump

# Cleanup
npm run clean              # Remove cache, logs, test results

# Running specific test files
node tests/unit/linkAnalyzer.test.js          # Unit test for link analyzer
node tests/validation/wave3-validation.js     # Wave 3 validation suite
node tests/security/security-test-suite.js    # Security test suite
```

## High-Level Architecture

### Core Infrastructure (`src/core/`)
- **PerformanceManager**: Centralized performance monitoring and optimization
- **JobManager**: Asynchronous job tracking and management for batch operations
- **WebhookDispatcher**: Event notification system for job completion callbacks
- **ActionExecutor**: Browser automation engine for complex interactions
- **ResearchOrchestrator**: Coordinates multi-stage research with query expansion and synthesis
- **StealthBrowserManager**: Manages stealth mode scraping with anti-detection features
- **LocalizationManager**: Handles multi-language content and localization
- **ChangeTracker**: Tracks and compares content changes over time
- **SnapshotManager**: Manages website snapshots and version history

### Tool Layer (`src/tools/`)
Tools are organized in subdirectories by category:
- `advanced/` - BatchScrapeTool, ScrapeWithActionsTool
- `crawl/` - crawlDeep, mapSite
- `extract/` - analyzeContent, extractContent, processDocument, summarizeContent
- `research/` - deepResearch
- `search/` - searchWeb and provider adapters (Google, DuckDuckGo)
- `tracking/` - trackChanges

### MCP Server Entry Point
The main server implementation is in `server.js` which:
1. Uses stdio transport for MCP protocol communication
2. Registers all 16 tools using `server.registerTool()` pattern
3. Each tool has inline Zod schema for parameter validation
4. Parameter extraction from `request.params?.arguments` structure
5. Response format uses `content` array with text objects

### Key Configuration

Critical environment variables:

```bash
# Search Provider (auto, google, duckduckgo)
SEARCH_PROVIDER=auto

# Google API (optional, only if using Google)
GOOGLE_API_KEY=your_key
GOOGLE_SEARCH_ENGINE_ID=your_id

# Performance Settings
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
CACHE_TTL=3600000
RATE_LIMIT_REQUESTS_PER_SECOND=10

# Crawling Limits
MAX_CRAWL_DEPTH=5
MAX_PAGES_PER_CRAWL=100
RESPECT_ROBOTS_TXT=true
```

## Common Development Tasks

### Running a Single Test
```bash
# Run a specific test file
node tests/unit/linkAnalyzer.test.js

# Run a specific Wave test
node tests/validation/test-batch-scrape.js

# Run Wave 3 tests with verbose output
npm run test:wave3:verbose
```

### Testing Tool Integration
```bash
# Test MCP protocol compliance
npm test

# Test specific tool functionality
node tests/validation/test-batch-scrape.js
node tests/validation/test-scrape-with-actions.js

# Test research features
node tests/validation/wave3-validation.js
```

### Debugging Tips
- Server logs are written to console via Winston logger
- Set `NODE_ENV=development` for verbose logging
- Use `--expose-gc` flag for memory profiling tests
- Check `cache/` directory for cached responses
- Review `logs/` directory for application logs

## CI/CD Security Integration

### Automated Security Testing Pipeline

The project includes comprehensive security testing integrated into the CI/CD pipeline:

#### Main CI Pipeline (`.github/workflows/ci.yml`)
The CI pipeline runs on every PR and push to main/develop branches and includes:

**Security Test Suite:**
- SSRF Protection validation
- Input validation (XSS, SQL injection, command injection)
- Rate limiting functionality
- DoS protection measures
- Regex DoS vulnerability detection

**Dependency Security:**
- npm audit with JSON output and summary generation
- Vulnerability severity analysis (critical/high/moderate/low)
- License compliance checking
- Outdated package detection

**Static Code Analysis:**
- CodeQL security analysis with extended queries
- ESLint security rules for dangerous patterns
- Hardcoded secret detection
- Security file scanning

**Reporting & Artifacts:**
- Comprehensive security reports generated
- PR comments with security summaries
- Artifact upload for detailed analysis
- Build failure on critical vulnerabilities

#### Dedicated Security Workflow (`.github/workflows/security.yml`)
Daily scheduled comprehensive security scanning:

**Dependency Security Scan:**
- Full vulnerability audit with configurable severity levels
- License compliance verification
- Detailed vulnerability reporting

**Static Code Analysis:**
- Extended CodeQL analysis with security-focused queries
- ESLint security plugin integration
- Pattern-based secret detection

**Container Security:**
- Trivy vulnerability scanning
- SARIF report generation
- Container base image analysis

**Automated Issue Creation:**
- GitHub issues created for critical vulnerabilities
- Detailed security reports with remediation steps
- Configurable severity thresholds

### Security Thresholds and Policies

**Build Failure Conditions:**
- Any critical severity vulnerabilities
- More than 3 high severity vulnerabilities
- Security test suite failures

**Automated Actions:**
- Daily security scans at 2 AM UTC
- PR blocking for security failures
- Automatic security issue creation
- Comprehensive artifact collection

### Running Security Tests Locally

```bash
# Run the complete security test suite
npm run test:security

# Check for dependency vulnerabilities
npm audit --audit-level moderate

# Fix automatically resolvable vulnerabilities
npm audit fix

# Generate security report manually
mkdir security-results
npm audit --json > security-results/audit.json

# Run specific security validation
node tests/security/security-test-suite.js
```

### Security Artifacts and Reports

**Generated Reports:**
- `SECURITY-REPORT.md`: Comprehensive security assessment
- `npm-audit.json`: Detailed vulnerability data
- `security-tests.log`: Test execution logs
- `dependency-analysis.md`: Package security analysis
- `license-check.md`: License compliance report

**Artifact Retention:**
- CI security results: 30 days
- Comprehensive security reports: 90 days
- Critical vulnerability reports: Indefinite

### Manual Security Scan Triggers

The security workflow can be manually triggered with custom parameters:

```bash
# Via GitHub CLI
gh workflow run security.yml \
  --field scan_type=all \
  --field severity_threshold=moderate

# Via GitHub UI
# Go to Actions > Security Scanning > Run workflow
```

**Available Options:**
- `scan_type`: all, dependencies, code-analysis, container-scan
- `severity_threshold`: low, moderate, high, critical

### Security Integration Best Practices

**For Contributors:**
1. Always run `npm run test:security` before submitting PRs
2. Address any security warnings in your code
3. Keep dependencies updated with `npm audit fix`
4. Review security artifacts when CI fails

**For Maintainers:**
1. Review security reports weekly
2. Respond to automated security issues promptly
3. Keep security thresholds updated
4. Monitor trending vulnerabilities in dependencies

### Security Documentation

Comprehensive security documentation is available in:
- `.github/SECURITY.md` - Complete security policy and procedures
- Security workflow logs and artifacts
- Generated security reports in CI runs

The security integration ensures that:
- No critical vulnerabilities reach production
- Security issues are detected early in development
- Comprehensive audit trails are maintained
- Automated remediation guidance is provided


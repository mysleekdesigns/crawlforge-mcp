# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CrawlForge MCP Server - A professional MCP (Model Context Protocol) server implementation providing 18+ comprehensive web scraping, crawling, and content processing tools. Version 3.0 includes advanced content extraction, document processing, summarization, and analysis capabilities. Wave 2 adds asynchronous batch processing and browser automation features. Wave 3 introduces deep research orchestration, stealth scraping, localization, and change tracking.

## Development Commands

```bash
# Install dependencies
npm install

# Setup (required for first run unless in creator mode)
npm run setup
# Or provide API key via environment:
export CRAWLFORGE_API_KEY="your_api_key_here"

# Creator Mode (bypass API key requirement for development)
export BYPASS_API_KEY=true
npm start

# Run the server (production)
npm start

# Development mode with verbose logging
npm run dev

# Test MCP protocol compliance
npm test

# Functional tests
node test-tools.js             # Test all tools (basic, Wave 2, Wave 3)
node test-real-world.js        # Test real-world usage scenarios

# MCP Protocol tests
node tests/integration/mcp-protocol-compliance.test.js  # MCP protocol compliance

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
node tests/integration/mcp-protocol-compliance.test.js  # MCP protocol compliance
node test-tools.js                                      # All tools functional test
node test-real-world.js                                 # Real-world scenarios test
```

## High-Level Architecture

### Core Infrastructure (`src/core/`)
- **AuthManager**: Authentication, credit tracking, and usage reporting (supports creator mode)
- **PerformanceManager**: Centralized performance monitoring and optimization
- **JobManager**: Asynchronous job tracking and management for batch operations
- **WebhookDispatcher**: Event notification system for job completion callbacks
- **ActionExecutor**: Browser automation engine for complex interactions (Playwright-based)
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
- `tracking/` - trackChanges (currently disabled in server.js)
- `llmstxt/` - generateLLMsTxt

### Available MCP Tools (18 total)
**Basic Tools (server.js inline):**
- fetch_url, extract_text, extract_links, extract_metadata, scrape_structured

**Advanced Tools:**
- search_web (conditional - requires search provider), crawl_deep, map_site
- extract_content, process_document, summarize_content, analyze_content
- batch_scrape, scrape_with_actions, deep_research
- generate_llms_txt, stealth_mode, localization

**Note:** track_changes tool is implemented but currently commented out in server.js (line 1409-1535)

### MCP Server Entry Point
The main server implementation is in `server.js` which:
1. **Authentication Flow**: Uses AuthManager for API key validation and credit tracking
   - Checks for authentication on startup (skipped in creator mode)
   - Auto-setup if CRAWLFORGE_API_KEY environment variable is present
   - Creator mode enabled via BYPASS_API_KEY=true
2. **Tool Registration**: All tools registered via `server.registerTool()` pattern
   - Wrapped with `withAuth()` function for credit tracking and authentication
   - Each tool has inline Zod schema for parameter validation
   - Response format uses `content` array with text objects
3. **Transport**: Uses stdio transport for MCP protocol communication
4. **Graceful Shutdown**: Cleans up browser instances, job managers, and other resources

### Tool Credit System
Each tool wrapped with `withAuth(toolName, handler)`:
- Checks credits before execution (skipped in creator mode)
- Reports usage with credit deduction on success
- Charges half credits on error
- Returns credit error if insufficient balance

### Key Configuration

Critical environment variables defined in `src/constants/config.js`:

```bash
# Authentication (required unless in creator mode)
CRAWLFORGE_API_KEY=your_api_key_here
BYPASS_API_KEY=true  # Enable creator mode for development

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

### Configuration Files
- `~/.crawlforge/config.json` - User authentication and API key storage
- `.env` - Environment variables for development
- `src/constants/config.js` - Central configuration with defaults and validation

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
- Server logs are written to console via Winston logger (stderr for status, stdout for MCP protocol)
- Set `NODE_ENV=development` for verbose logging
- Use `--expose-gc` flag for memory profiling: `node --expose-gc server.js`
- Check `cache/` directory for cached responses
- Review `logs/` directory for application logs
- Use creator mode during development to bypass authentication: `BYPASS_API_KEY=true npm start`
- Memory monitoring automatically enabled in development mode (logs every 60s if >200MB)

### Adding New Tools
When adding a new tool to server.js:
1. Import the tool class from `src/tools/`
2. Instantiate the tool (with config if needed)
3. Register with `server.registerTool(name, { description, inputSchema }, withAuth(name, handler))`
4. Ensure tool implements `execute(params)` method
5. Add to cleanup array in gracefulShutdown if it has `destroy()` or `cleanup()` methods
6. Update tool count in console log at server startup (line 1860)

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

## Important Implementation Patterns

### Tool Structure
All tools follow a consistent class-based pattern:
```javascript
export class ToolName {
  constructor(config) {
    this.config = config;
    // Initialize resources
  }

  async execute(params) {
    // Validate params (Zod validation done in server.js)
    // Execute tool logic
    // Return structured result
    return { success: true, data: {...} };
  }

  async destroy() {
    // Cleanup resources (browsers, connections, etc.)
  }
}
```

### Search Provider Architecture
Search providers implement a factory pattern:
- `searchProviderFactory.js` selects provider based on config
- Providers implement common interface: `search(query, options)`
- Auto-fallback: Google → DuckDuckGo if Google credentials missing
- Each provider in `src/tools/search/adapters/`

### Browser Management
- Playwright used for browser automation (ActionExecutor, ScrapeWithActionsTool)
- Stealth features in StealthBrowserManager
- Always cleanup browsers in error handlers
- Context isolation per operation for security

### Memory Management
Critical for long-running processes:
- Graceful shutdown handlers registered for SIGINT/SIGTERM
- All tools with heavy resources must implement `destroy()` or `cleanup()`
- Memory monitoring in development mode (server.js line 1955-1963)
- Force GC on shutdown if available

### Error Handling Pattern
```javascript
try {
  const result = await tool.execute(params);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
} catch (error) {
  return {
    content: [{ type: "text", text: `Operation failed: ${error.message}` }],
    isError: true
  };
}
```

### Configuration Validation
- All config in `src/constants/config.js` with defaults
- `validateConfig()` checks required settings
- Environment variables parsed with fallbacks
- Config errors only fail in production (warnings in dev)


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
npm test

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

# Release management
npm run release:patch       # Patch version bump
npm run release:minor       # Minor version bump
npm run release:major       # Major version bump

# Cleanup
npm run clean              # Remove cache, logs, test results
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


# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server implementation providing 16 comprehensive web scraping, crawling, and content processing tools. Version 3.0 includes advanced content extraction, document processing, summarization, and analysis capabilities. Wave 2 adds asynchronous batch processing and browser automation features. Wave 3 introduces deep research orchestration, stealth scraping, localization, and change tracking.

## Technical Stack

- **Runtime**: Node.js 18+ (ES modules with `"type": "module"`)
- **Core SDK**: `@modelcontextprotocol/sdk` for MCP server implementation
- **HTML Parsing**: Cheerio for DOM manipulation
- **Content Processing**: Mozilla Readability, JSDOM, PDF-parse
- **JavaScript Rendering**: Playwright for dynamic content
- **Validation**: Zod for parameter schemas
- **Search**: Google Custom Search API and DuckDuckGo integration
- **Caching**: LRU-Cache with disk persistence
- **Queue**: p-queue for concurrent operations
- **NLP**: Compromise for text analysis, franc for language detection

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

## Available MCP Tools (16 Total)

### Basic Scraping Tools
1. **fetch_url** - Fetch content with headers and timeout support
2. **extract_text** - Extract clean text from HTML
3. **extract_links** - Extract and filter links
4. **extract_metadata** - Extract page metadata (Open Graph, Twitter Cards, etc.)
5. **scrape_structured** - Extract data using CSS selectors

### Search & Crawling Tools
6. **search_web** - Web search with multiple provider support (Google, DuckDuckGo)
7. **crawl_deep** - BFS crawling up to 5 levels deep with comprehensive options
8. **map_site** - Discover website structure with sitemap support

### Advanced Content Processing
9. **extract_content** - Enhanced content extraction with readability detection and structured data
10. **process_document** - Multi-format document processing (PDFs, web pages, JavaScript content)
11. **summarize_content** - Intelligent text summarization with configurable options
12. **analyze_content** - Comprehensive content analysis (language, topics, sentiment, entities)

### Wave 2 Advanced Tools
13. **batch_scrape** - Asynchronously scrape multiple URLs with job tracking and webhook notifications
14. **scrape_with_actions** - Advanced scraping with browser automation (clicks, scrolls, form fills)

### Wave 3 Research & Tracking Tools
15. **deep_research** - Multi-stage research orchestration with intelligent query expansion and source verification
16. **track_changes** - Monitor content changes with baseline capture, comparison, and scheduled monitoring

## High-Level Architecture

The codebase follows a modular architecture with clear separation of concerns:

### Core Infrastructure (`src/core/`)
- **QueueManager**: Manages concurrent operations using p-queue, handles job scheduling and worker pool management
- **CacheManager**: Two-tier caching system (LRU memory + disk persistence) for optimal performance
- **BFSCrawler**: Breadth-first search crawler with depth control, URL tracking, and domain filtering
- **ContentProcessor**: Main content extraction using Mozilla Readability and structured data parsing
- **PDFProcessor/BrowserProcessor**: Specialized processors for different content types
- **PerformanceManager**: Centralized performance monitoring and optimization
- **WorkerPool**: Multi-threading support for CPU-intensive operations
- **ConnectionPool**: HTTP connection pooling for improved network performance
- **JobManager**: Asynchronous job tracking and management for batch operations
- **WebhookDispatcher**: Event notification system for job completion callbacks
- **ActionExecutor**: Browser automation engine for complex interactions
- **ResearchOrchestrator**: Coordinates multi-stage research with query expansion and synthesis
- **StealthBrowserManager**: Manages stealth mode scraping with anti-detection features
- **LocalizationManager**: Handles multi-language content and localization
- **ChangeTracker**: Tracks and compares content changes over time
- **SnapshotManager**: Manages website snapshots and version history

### Tool Layer (`src/tools/`)
- Each tool is self-contained with its own validation and error handling
- Tools leverage core infrastructure for common operations
- Search tools support multiple providers through adapter pattern
- Crawl tools use BFSCrawler with configurable strategies

### Utility Layer (`src/utils/`)
- **RateLimiter**: Per-domain rate limiting with configurable limits
- **RobotsChecker**: robots.txt compliance checking and caching
- **URLNormalizer**: Consistent URL normalization for deduplication
- **SitemapParser**: Multi-format sitemap parsing with priority support
- **DomainFilter**: Whitelist/blacklist domain management
- **CircuitBreaker**: Fault tolerance for external service calls
- **RetryManager**: Exponential backoff retry logic
- **Logger**: Winston-based logging with performance metrics

### Search System Architecture
- **Provider Adapters**: Abstraction layer for Google/DuckDuckGo with factory pattern
- **ResultRanker**: Multi-factor ranking using BM25, semantic matching, authority scores
- **ResultDeduplicator**: SimHash-based deduplication with fuzzy matching
- **QueryExpander**: Automatic query expansion for better search coverage

## Key Configuration

Critical environment variables for development:

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

## Development Workflow

### MCP Server Entry Point
The main server implementation is in `server.js` which:
1. Uses stdio transport for MCP protocol communication
2. Registers all 16 tools using `server.registerTool()` pattern
3. Each tool has its own Zod schema for parameter validation
4. Tools are implemented as classes in `src/tools/` directory

### CI/CD Pipeline
GitHub Actions workflow (`/.github/workflows/ci.yml`) handles:
- Multi-platform testing (Ubuntu, Windows, macOS)
- Node.js version matrix (18.x, 20.x, 21.x)
- Security audits and CodeQL analysis
- Performance regression detection
- Docker build testing
- Automated npm publishing on release commits

### Testing Approach
- Unit tests in `tests/unit/` for core components
- Performance tests in `tests/performance/` for load and memory testing
- Integration tests in `tests/integration/` for end-to-end scenarios
- Security tests in `tests/security/` for vulnerability scanning
- Validation tests in `tests/validation/` for Wave 2 and Wave 3 features
- Test files follow `*.test.js` naming convention
- Run `npm test` for basic protocol compliance
- Run `npm run test:all` for comprehensive test suite
- Test results uploaded as artifacts in CI pipeline
- Note: No linter configured yet (npm run lint is placeholder)

## Important Implementation Notes

### MCP Protocol Implementation
- Server uses stdio transport (not HTTP) for MCP protocol
- All tools registered with `server.registerTool()` with inline Zod schemas
- Parameter extraction from `request.params?.arguments` structure
- Response format uses `content` array with text objects
- Tools are located in `src/tools/` with subdirectories for organization:
  - `advanced/` - BatchScrapeTool, ScrapeWithActionsTool
  - `crawl/` - crawlDeep, mapSite
  - `extract/` - analyzeContent, extractContent, processDocument, summarizeContent
  - `research/` - deepResearch
  - `search/` - searchWeb and adapters
  - `tracking/` - trackChanges

### Performance & Reliability
- Memory usage optimized to stay under 512MB for typical crawls
- Concurrent operations managed through QueueManager (p-queue)
- WorkerPool with Node.js worker_threads for 8x faster HTML parsing
- ConnectionPool reduces connection overhead by 50%
- StreamProcessor enables 90% memory reduction for large datasets
- Circuit breaker pattern (CircuitBreaker class) for external services
- Exponential backoff retry logic (RetryManager)
- Per-domain rate limiting prevents server overload
- robots.txt compliance checked before crawling
- Asynchronous job management with unique job IDs and status tracking
- Webhook notifications for long-running batch operations

### Security & Validation
- All inputs validated with Zod schemas
- SSRF protection implemented (`src/utils/ssrfProtection.js`)
- Input sanitization across all tools
- Security audit completed (see SECURITY_AUDIT_REPORT.md)
- No hardcoded secrets, uses .env configuration

### Documentation Standards
- All documentation files should be placed in the `docs/` directory
- Tool-specific documentation in `docs/TOOLS_GUIDE.md`
- Deployment guides in `docs/DEPLOYMENT.md`
- API reference in `docs/API_REFERENCE.md`

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

### NPM Installation for End Users
```bash
# Install globally (coming soon)
npx mcp-webscraper-setup

# Configure with Claude Code or Cursor IDE
# Follow prompts to set up MCP configuration
```
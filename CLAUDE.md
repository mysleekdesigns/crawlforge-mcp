# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server implementation providing 12 comprehensive web scraping, crawling, and content processing tools. Version 3.0 adds advanced content extraction, document processing, summarization, and analysis capabilities.

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

# Performance tests
npm run test:performance       # Full performance test suite
npm run test:performance:quick # Quick performance tests
npm run test:load             # Load testing
npm run test:memory           # Memory usage tests
npm run test:benchmark        # Component benchmarks
npm run test:integration      # Integration tests
```

## Available MCP Tools (12 Total)

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

### Project Management Structure
When working on this codebase, tasks are coordinated through a project manager pattern:
1. Project manager reviews incoming tasks
2. Assigns work to appropriate sub-agents (mcp-implementation, testing-validation, etc.)
3. Sub-agents report completion back to project manager
4. Project manager consolidates results

### Current Development Status
- Phase 1: ✅ Architecture & Research (COMPLETED)
- Phase 2: ✅ Core Search & Crawling (COMPLETED)
- Phase 3: 🚧 Advanced Content Processing (IN PROGRESS)
- Phase 4: ⏳ Performance Optimization (Partially Complete)
- Phase 5: ⏳ Integration & Testing (Pending)

See `tasks/TODO.md` for detailed task tracking and progress.

### Testing Approach
- Unit tests in `tests/unit/` for core components
- Performance tests in `tests/performance/` for load and memory testing
- Integration tests in `tests/integration/` for end-to-end scenarios
- Test files follow `*.test.js` naming convention
- Run `npm test` for protocol compliance
- Run `npm run test:performance` for full performance suite

## Important Implementation Notes

- Server uses stdio transport (not HTTP) for MCP protocol
- All async operations use proper error handling and timeouts
- Memory usage optimized to stay under 512MB for typical crawls
- Tools validate input parameters using Zod schemas
- Concurrent operations managed through QueueManager
- Search results cached with configurable TTL
- Per-domain rate limiting prevents server overload
- robots.txt compliance checked before crawling
- Performance monitoring integrated via PerformanceManager
- Circuit breaker pattern implemented for external service reliability
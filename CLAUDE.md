# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server implementation providing 8 comprehensive web scraping and crawling tools. Version 2.0 adds powerful search, deep crawling, and site mapping capabilities to the original scraping toolkit.

## Technical Stack

- **Runtime**: Node.js 18+ (ES modules with `"type": "module"`)
- **Core SDK**: `@modelcontextprotocol/sdk` for MCP server implementation
- **HTML Parsing**: Cheerio for DOM manipulation
- **Validation**: Zod for parameter schemas
- **Search**: Google Custom Search API integration
- **Caching**: LRU-Cache with disk persistence
- **Queue**: p-queue for concurrent operations

## Project Structure

```
webScraper-1.0/
├── server.js                 # Main MCP server entry point
├── src/
│   ├── core/                # Core infrastructure
│   │   ├── queue/           # QueueManager for concurrent operations
│   │   ├── cache/           # CacheManager (memory + disk)
│   │   └── crawlers/        # BFSCrawler implementation
│   ├── tools/               # MCP tool implementations
│   │   ├── search/          # searchWeb tool + Google adapter
│   │   ├── crawl/           # crawlDeep, mapSite tools
│   │   └── extract/         # (future) enhanced extraction
│   ├── utils/               # Shared utilities
│   │   ├── rateLimiter.js  # Per-domain rate limiting
│   │   ├── robotsChecker.js # robots.txt compliance
│   │   └── urlNormalizer.js # URL normalization
│   └── constants/
│       └── config.js        # Centralized configuration
├── docs/                    # Architecture documentation
├── tasks/                   # Development tracking
└── .env.example             # Environment variables template
```

## Development Commands

```bash
# Install dependencies
npm install

# Copy and configure environment (required for search_web tool)
cp .env.example .env
# Edit .env to add Google API credentials if needed

# Run the server
npm start

# Test MCP protocol compliance
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | node server.js
```

## Available MCP Tools

1. **fetch_url** - Fetch content with headers and timeout support
2. **extract_text** - Extract clean text from HTML
3. **extract_links** - Extract and filter links
4. **extract_metadata** - Extract page metadata (Open Graph, Twitter Cards, etc.)
5. **scrape_structured** - Extract data using CSS selectors
6. **search_web** - Web search via Google Custom Search API (requires API key)
7. **crawl_deep** - BFS crawling up to 5 levels deep
8. **map_site** - Discover website structure with sitemap support

## Key Configuration (.env)

```bash
# Required for search_web tool
GOOGLE_API_KEY=your_key_here
GOOGLE_SEARCH_ENGINE_ID=your_engine_id

# Performance tuning
MAX_WORKERS=10
CACHE_TTL=3600000
RATE_LIMIT_REQUESTS_PER_SECOND=10
MAX_CRAWL_DEPTH=5
RESPECT_ROBOTS_TXT=true
```

## Architecture Highlights

- **Concurrent Processing**: Worker pool with queue management for parallel operations
- **Multi-level Caching**: LRU memory cache + disk persistence for optimal performance
- **Rate Limiting**: Per-domain rate limiting to respect server resources
- **BFS Crawling**: Breadth-first search algorithm for systematic crawling
- **robots.txt Compliance**: Built-in respect for robots.txt directives
- **Error Handling**: Comprehensive retry mechanisms with exponential backoff

## Important Notes

- Server uses stdio transport (not HTTP) for MCP communication
- Node.js 18+ required for ES modules support
- search_web tool requires Google API configuration in .env
- Maximum crawl depth limited to 5 levels for performance
- All tools include timeout protection and error handling
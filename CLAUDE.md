# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server implementation for comprehensive web scraping functionality. The server provides 5 powerful tools for web scraping and content extraction, designed to work with Claude Code, Cursor, and other MCP-compatible clients.

## Architecture

- **server.js**: Main entry point that sets up the MCP server using the MCP SDK
  - Uses ES modules (`"type": "module"` in package.json)
  - Implements 5 MCP tools: fetch_url, extract_text, extract_links, extract_metadata, scrape_structured
  - Built on `@modelcontextprotocol/sdk` for MCP server functionality
  - Uses Cheerio for HTML parsing and manipulation
  - Uses Zod for parameter validation

## Available MCP Tools

**Original Tools (v1.0):**
1. **fetch_url**: Basic URL fetching with headers and timeout support
2. **extract_text**: Clean text extraction from HTML, removing scripts/styles
3. **extract_links**: Link extraction with filtering options
4. **extract_metadata**: Extract page metadata (title, description, Open Graph, etc.)
5. **scrape_structured**: Extract data using CSS selectors

**New Tools (v2.0):**
6. **search_web**: Web search using Google Custom Search API (requires API configuration)
7. **crawl_deep**: Deep website crawling with BFS algorithm (max 5 levels)
8. **map_site**: Site structure discovery and mapping with sitemap support

## Development Commands

```bash
# Install dependencies
npm install

# Run the server
npm start
# or
node server.js

# Test the server (basic test)
npm test
```

## Testing MCP Protocol

Test the server with MCP protocol messages:
```bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | node server.js
```

## Project Structure

```
webScraper-1.0/
├── server.js                 # Main server with tool registrations
├── src/
│   ├── core/                # Core infrastructure
│   │   ├── queue/           # Queue management
│   │   ├── cache/           # Caching system
│   │   └── crawlers/        # BFS crawler
│   ├── tools/               # Tool implementations
│   │   ├── search/          # Search tools
│   │   └── crawl/           # Crawling tools
│   ├── utils/               # Utilities
│   │   ├── rateLimiter.js
│   │   ├── robotsChecker.js
│   │   └── urlNormalizer.js
│   └── constants/           # Configuration
│       └── config.js
├── .env.example             # Environment template
├── ARCHITECTURE.md          # System architecture
└── IMPLEMENTATION_PLAN.md   # Phase 2 implementation details
```

## Phase 2 Features (Completed)

✅ Web search integration with Google Custom Search API
✅ Deep crawling with BFS algorithm (max 5 levels)
✅ Site mapping and structure discovery
✅ Multi-level caching (LRU memory + disk)
✅ Per-domain rate limiting
✅ Concurrent processing with queue management
✅ robots.txt compliance

## Important Notes

- Server communicates via stdio transport (not HTTP)
- All tools include comprehensive error handling
- Rate limiting and timeout protection built-in
- It's August 2025 - always search to the latest date when looking for documentation
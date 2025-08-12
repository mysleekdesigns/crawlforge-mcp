# MCP WebScraper Server v3.0

A powerful Model Context Protocol (MCP) server that provides comprehensive web scraping, searching, crawling, and advanced content processing capabilities for use with Claude Code, Cursor, and other MCP-compatible clients.

## 🚀 What's New in v3.0 (Phase 3: Advanced Content Processing)

- **Enhanced Content Extraction**: Mozilla Readability integration for main content detection
- **Multi-format Document Processing**: Support for PDFs, JavaScript-rendered content, and more
- **Intelligent Summarization**: Configurable text summarization with key point extraction
- **Comprehensive Content Analysis**: Language detection, topic extraction, sentiment analysis
- **Structured Data Extraction**: JSON-LD, microdata, and schema.org parsing
- **Content Quality Assessment**: Readability scoring and quality metrics
- **JavaScript Rendering**: Playwright-powered dynamic content processing

## Features

- **12 Powerful Tools** (4 new in v3.0):
  - `fetch_url` - Fetch content from URLs with headers and timeout support
  - `extract_text` - Extract clean text content from webpages
  - `extract_links` - Extract and filter links from webpages
  - `extract_metadata` - Extract comprehensive metadata (title, description, Open Graph, etc.)
  - `scrape_structured` - Extract structured data using CSS selectors
  - `search_web` - Search the web using DuckDuckGo (default) or Google Custom Search API
  - `crawl_deep` - Deep crawl websites with breadth-first search (up to 5 levels)
  - `map_site` - Discover and map website structure with sitemap support
  - 🆕 `extract_content` - Enhanced content extraction with readability detection and structured data
  - 🆕 `process_document` - Multi-format document processing (PDFs, web pages, JavaScript content)
  - 🆕 `summarize_content` - Intelligent text summarization with configurable options
  - 🆕 `analyze_content` - Comprehensive content analysis (language, topics, sentiment, entities)

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd webScraper-1.0

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env to add your Google API credentials (optional, for search_web tool)
# Get your API key from: https://console.cloud.google.com/
# Create a Custom Search Engine: https://programmablesearchengine.google.com/

# Make executable (optional)
chmod +x server.js
```

## Configuration

### Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```env
# Search Provider Settings
SEARCH_PROVIDER=auto  # Options: 'auto', 'duckduckgo', 'google' (default: auto)

# Google Custom Search API (optional - only needed if using Google provider)
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here

# Performance Settings
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
CACHE_TTL=3600000
CACHE_MAX_SIZE=1000

# Rate Limiting
RATE_LIMIT_REQUESTS_PER_SECOND=10
RATE_LIMIT_PER_DOMAIN=true

# Crawling Settings
MAX_CRAWL_DEPTH=5
MAX_PAGES_PER_CRAWL=100
RESPECT_ROBOTS_TXT=true
USER_AGENT=MCP-WebScraper/2.0
```

## Usage

### Direct Execution
```bash
node server.js
# or
npm start
```

### Configuration for Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "mcp-webscraper": {
      "command": "node",
      "args": ["/path/to/webScraper-1.0/server.js"]
    }
  }
}
```

### Configuration for Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mcp-webscraper": {
      "command": "node",
      "args": ["/path/to/webScraper-1.0/server.js"]
    }
  }
}
```

### After Publishing to NPM

Once published, you can use npx:

```json
{
  "mcpServers": {
    "mcp-webscraper": {
      "command": "npx",
      "args": ["-y", "mcp-webscraper"]
    }
  }
}
```

## Available Tools

### 1. fetch_url
Fetches content from a URL with optional headers and timeout.

**Parameters:**
- `url` (string, required): The URL to fetch
- `headers` (object, optional): HTTP headers to include
- `timeout` (number, optional): Request timeout in milliseconds (1000-30000, default: 10000)

**Returns:** Status, headers, body, content type, size, and final URL

### 2. extract_text
Extracts clean text content from HTML, removing scripts, styles, and non-content elements.

**Parameters:**
- `url` (string, required): The URL to extract text from
- `remove_scripts` (boolean, optional): Remove script tags (default: true)
- `remove_styles` (boolean, optional): Remove style tags (default: true)

**Returns:** Cleaned text, word count, character count

### 3. extract_links
Extracts all links from a webpage with filtering options.

**Parameters:**
- `url` (string, required): The URL to extract links from
- `filter_external` (boolean, optional): Keep only internal links (default: false)
- `base_url` (string, optional): Base URL for resolving relative links

**Returns:** Array of links with href, text, and external status

### 4. extract_metadata
Extracts comprehensive metadata from a webpage.

**Parameters:**
- `url` (string, required): The URL to extract metadata from

**Returns:** Title, description, keywords, Open Graph tags, Twitter Card tags, canonical URL, author, robots, viewport, charset

### 5. scrape_structured
Extracts structured data using CSS selectors.

**Parameters:**
- `url` (string, required): The URL to scrape
- `selectors` (object, required): Object mapping field names to CSS selectors

**Returns:** Structured data based on provided selectors

### 6. search_web 🆕
Search the web using DuckDuckGo (default, no API key required) or Google Custom Search API.

**Search Provider Selection:**
- **Auto Mode (default)**: Automatically selects DuckDuckGo unless Google credentials are configured
- **DuckDuckGo**: Free, privacy-focused, no API key required (limited to ~10 results per query)
- **Google**: Requires API credentials, provides richer metadata and up to 100 results

**Parameters:**
- `query` (string, required): Search query
- `limit` (number, optional): Maximum results (1-100, default: 10)
- `offset` (number, optional): Result offset for pagination
- `lang` (string, optional): Language code (default: 'en')
- `safe_search` (boolean, optional): Enable safe search (default: true)
- `time_range` (string, optional): 'day', 'week', 'month', 'year', 'all' (default: 'all')
- `site` (string, optional): Restrict to specific site
- `file_type` (string, optional): Filter by file type

**Returns:** Search results with title, link, snippet, and metadata

### 7. crawl_deep 🆕
Deep crawl websites using breadth-first search algorithm.

**Parameters:**
- `url` (string, required): Starting URL
- `max_depth` (number, optional): Maximum depth (1-5, default: 3)
- `max_pages` (number, optional): Maximum pages (1-1000, default: 100)
- `include_patterns` (array, optional): URL patterns to include
- `exclude_patterns` (array, optional): URL patterns to exclude
- `follow_external` (boolean, optional): Follow external links (default: false)
- `respect_robots` (boolean, optional): Respect robots.txt (default: true)
- `extract_content` (boolean, optional): Extract page content (default: true)
- `concurrency` (number, optional): Concurrent requests (1-20, default: 10)

**Returns:** Crawled pages, site structure, statistics, and errors

### 8. map_site 🆕
Discover and map website structure.

**Parameters:**
- `url` (string, required): Website URL
- `include_sitemap` (boolean, optional): Include sitemap.xml (default: true)
- `max_urls` (number, optional): Maximum URLs (1-10000, default: 1000)
- `group_by_path` (boolean, optional): Group by path (default: true)
- `include_metadata` (boolean, optional): Fetch metadata (default: false)

**Returns:** Site map, URL structure, statistics, and metadata

## Requirements

- Node.js 18.0.0 or higher
- npm or yarn

## Dependencies

- `@modelcontextprotocol/sdk` - MCP SDK for server implementation
- `cheerio` - HTML parsing and manipulation
- `zod` - Schema validation

## Testing

Test the server with MCP protocol:

```bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | node server.js
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
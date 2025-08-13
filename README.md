# MCP WebScraper Server v3.0

A powerful Model Context Protocol (MCP) server that provides comprehensive web scraping, searching, crawling, and advanced content processing capabilities for use with Claude Code, Cursor, and other MCP-compatible clients.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-blue)](https://modelcontextprotocol.io/)

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Integration](#integration)
- [Tools Overview](#tools-overview)
- [Usage Examples](#usage-examples)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Contributing](#contributing)

## Features

### 🚀 What's New in v3.0

- **Enhanced Content Extraction**: Mozilla Readability integration for main content detection
- **Multi-format Document Processing**: Support for PDFs, JavaScript-rendered content, and more
- **Intelligent Summarization**: Configurable text summarization with key point extraction
- **Comprehensive Content Analysis**: Language detection, topic extraction, sentiment analysis
- **Structured Data Extraction**: JSON-LD, microdata, and schema.org parsing
- **Content Quality Assessment**: Readability scoring and quality metrics
- **JavaScript Rendering**: Playwright-powered dynamic content processing

### 🛠️ 12 Powerful Tools

#### Basic Web Operations
- **`fetch_url`** - Fetch content from URLs with headers and timeout support
- **`extract_text`** - Extract clean text content from webpages
- **`extract_links`** - Extract and filter links from webpages
- **`extract_metadata`** - Extract comprehensive metadata (Open Graph, Twitter Cards, etc.)
- **`scrape_structured`** - Extract structured data using CSS selectors

#### Search & Discovery
- **`search_web`** - Web search using DuckDuckGo (default) or Google Custom Search API
- **`crawl_deep`** - Deep website crawling with breadth-first search (up to 5 levels)
- **`map_site`** - Discover and map website structure with sitemap support

#### Advanced Content Processing (🆕 v3.0)
- **`extract_content`** - Enhanced content extraction with readability detection
- **`process_document`** - Multi-format document processing (PDFs, web pages, JavaScript content)
- **`summarize_content`** - Intelligent text summarization with configurable options
- **`analyze_content`** - Comprehensive content analysis (language, topics, sentiment, entities)

## Quick Start

Get started in under 5 minutes:

```bash
# 1. Clone and install
git clone https://github.com/your-username/mcp-webscraper.git
cd mcp-webscraper
npm install

# 2. Start the server
npm start

# 3. Test basic functionality
curl -X POST http://localhost:3000/tools/fetch_url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### Integration with Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"]
    }
  }
}
```

[See detailed integration guide →](./docs/INTEGRATION_GUIDE.md)

## Installation

### Prerequisites

- **Node.js** 18.0.0 or higher
- **npm** 8.0.0 or higher
- **Operating System**: Windows 10+, macOS 10.15+, Linux (Ubuntu 18.04+)

### Install from Source

```bash
# Clone the repository
git clone https://github.com/your-username/mcp-webscraper.git
cd mcp-webscraper

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
nano .env  # Edit configuration

# Test installation
npm test
```

### Install via NPM (when published)

```bash
# Install globally
npm install -g mcp-webscraper

# Or install in your project
npm install mcp-webscraper
```

### Environment Configuration

Edit `.env` file to customize behavior:

```env
# Search Provider (auto, google, duckduckgo)
SEARCH_PROVIDER=auto

# Google Search API (optional)
GOOGLE_API_KEY=your_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_engine_id_here

# Performance Settings
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
RATE_LIMIT_REQUESTS_PER_SECOND=10

# Crawling Settings
MAX_CRAWL_DEPTH=5
RESPECT_ROBOTS_TXT=true
```

[→ See complete configuration guide](./docs/INTEGRATION_GUIDE.md#configuration-options)

## Integration

### Claude Code Setup

1. **Create MCP configuration** in your project root:

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"],
      "env": {
        "SEARCH_PROVIDER": "auto"
      }
    }
  }
}
```

2. **Restart Claude Code** to load the new server

### Cursor IDE Setup

1. **Create configuration** at `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"]
    }
  }
}
```

2. **Restart Cursor** to enable WebScraper tools

[→ Complete integration guide with troubleshooting](./docs/INTEGRATION_GUIDE.md)

## Tools Overview

The WebScraper server provides 12 specialized tools organized into three categories:

### 🔧 Basic Web Operations
| Tool | Purpose | Use Case |
|------|---------|----------|
| `fetch_url` | Fetch raw content with headers | API testing, content retrieval |
| `extract_text` | Clean text extraction | Content analysis, research |
| `extract_links` | Link discovery and filtering | Site mapping, navigation analysis |
| `extract_metadata` | Comprehensive metadata extraction | SEO analysis, social media preview |
| `scrape_structured` | CSS selector-based scraping | Product data, structured content |

### 🔍 Search & Discovery
| Tool | Purpose | Use Case |
|------|---------|----------|
| `search_web` | Web search with multiple providers | Research, content discovery |
| `crawl_deep` | Deep website crawling (BFS) | Site analysis, content inventory |
| `map_site` | Website structure mapping | Site architecture, navigation audit |

### 🧠 Advanced Content Processing
| Tool | Purpose | Use Case |
|------|---------|----------|
| `extract_content` | Enhanced content extraction | Article processing, content curation |
| `process_document` | Multi-format document processing | PDF analysis, document conversion |
| `summarize_content` | Intelligent text summarization | Content condensation, key points |
| `analyze_content` | Comprehensive content analysis | Sentiment analysis, topic extraction |

## Usage Examples

### Basic Web Scraping

```javascript
// Extract clean text from a news article
{
  "tool": "extract_text",
  "url": "https://news.example.com/article",
  "remove_scripts": true,
  "remove_styles": true
}

// Get all links from a page
{
  "tool": "extract_links", 
  "url": "https://blog.example.com",
  "filter_external": false
}
```

### Advanced Content Processing

```javascript
// Extract main content with readability analysis
{
  "tool": "extract_content",
  "url": "https://article.example.com",
  "options": {
    "useReadability": true,
    "outputFormat": "markdown",
    "calculateReadabilityScore": true
  }
}

// Analyze content for topics and sentiment
{
  "tool": "analyze_content",
  "text": "Your text content here...",
  "options": {
    "extractTopics": true,
    "analyzeSentiment": true,
    "maxKeywords": 20
  }
}
```

### Search and Discovery

```javascript
// Search with advanced options
{
  "tool": "search_web",
  "query": "machine learning tutorials",
  "limit": 10,
  "time_range": "month",
  "enable_ranking": true
}

// Deep crawl a website
{
  "tool": "crawl_deep",
  "url": "https://docs.example.com",
  "max_depth": 3,
  "max_pages": 50,
  "extract_content": true
}
```

### E-commerce Data Extraction

```javascript
// Extract product information
{
  "tool": "scrape_structured",
  "url": "https://shop.example.com/product/123",
  "selectors": {
    "title": "h1.product-title",
    "price": ".price-current",
    "description": ".product-description",
    "reviews": ".review-text"
  }
}
```

[→ See complete API reference with all parameters](./docs/API_REFERENCE.md)

## Configuration

### Environment Variables

Configure the server behavior through environment variables:

```env
# Search Provider
SEARCH_PROVIDER=auto              # auto, google, duckduckgo
GOOGLE_API_KEY=your_key          # Required for Google search
GOOGLE_SEARCH_ENGINE_ID=your_id  # Required for Google search

# Performance Tuning  
MAX_WORKERS=10                   # Worker thread pool size
QUEUE_CONCURRENCY=10             # Concurrent request limit
CACHE_TTL=3600000               # Cache lifetime (ms)
RATE_LIMIT_REQUESTS_PER_SECOND=10

# Crawling Behavior
MAX_CRAWL_DEPTH=5               # Maximum crawl depth
RESPECT_ROBOTS_TXT=true         # Honor robots.txt
USER_AGENT=MCP-WebScraper/3.0   # Custom user agent
```

### Performance Profiles

#### High-Performance Setup
```env
MAX_WORKERS=20
QUEUE_CONCURRENCY=15
CACHE_TTL=7200000
RATE_LIMIT_REQUESTS_PER_SECOND=15
```

#### Resource-Constrained Setup
```env
MAX_WORKERS=5
QUEUE_CONCURRENCY=3
CACHE_MAX_SIZE=500
RATE_LIMIT_REQUESTS_PER_SECOND=5
```

[→ Complete configuration reference](./docs/INTEGRATION_GUIDE.md#configuration-options)

## Documentation

### 📚 Complete Documentation

- **[API Reference](./docs/API_REFERENCE.md)** - Detailed API documentation for all 12 tools
- **[Integration Guide](./docs/INTEGRATION_GUIDE.md)** - Step-by-step setup for Claude Code and Cursor
- **[Troubleshooting Guide](./docs/TROUBLESHOOTING.md)** - Common issues and solutions

### 🛠️ Development Resources

- **[Architecture Overview](./docs/ARCHITECTURE.md)** - System design and components
- **[Performance Guide](./docs/PERFORMANCE_OPTIMIZATION.md)** - Optimization strategies
- **[Examples](./examples/)** - Practical usage examples

## Testing

### Quick Protocol Test

```bash
# Test MCP protocol compliance
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | node server.js
```

### Comprehensive Testing

```bash
# Run all tests
npm test

# Performance tests
npm run test:performance

# Load testing
npm run test:load

# Memory usage tests
npm run test:memory
```

## Requirements

- **Node.js:** 18.0.0 or higher
- **Memory:** 512MB available
- **Network:** Internet connection for web operations
- **Optional:** Google Custom Search API credentials

## Contributing

We welcome contributions! Here's how to get started:

1. **Fork the repository**
2. **Create a feature branch:** `git checkout -b feature/amazing-feature`
3. **Make your changes** and add tests
4. **Run tests:** `npm test`
5. **Commit changes:** `git commit -m 'Add amazing feature'`
6. **Push to branch:** `git push origin feature/amazing-feature`
7. **Open a Pull Request**

### Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/mcp-webscraper.git
cd mcp-webscraper

# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test
```

### Code Style

- Use ESLint configuration provided
- Follow existing code patterns
- Add tests for new features
- Update documentation as needed

## Support

- **Documentation:** [Complete guides](./docs/)
- **Issues:** [GitHub Issues](https://github.com/your-username/mcp-webscraper/issues)
- **Discussions:** [GitHub Discussions](https://github.com/your-username/mcp-webscraper/discussions)
- **Security:** [Security Policy](./docs/SECURITY.md)

## License

[MIT License](./LICENSE) - see the LICENSE file for details.

## Acknowledgments

- **MCP Team** for the Model Context Protocol
- **Mozilla** for Readability.js
- **Cheerio Team** for HTML parsing
- **All contributors** who help improve this project

---

**Made with ❤️ for the MCP community**
# MCP WebScraper - Quick Start Guide

## 🚀 Installation Command

Install the MCP WebScraper in any project with a single command:

```bash
npx mcp-webscraper@latest
```

This works exactly like Playwright MCP (`npx @playwright/mcp@latest`)!

## 📦 Installation Options

### Option 1: Quick Setup with NPX (Recommended)
```bash
# Run the installer
npx mcp-webscraper@latest

# Copy the configuration it provides to your Claude MCP settings
```

### Option 2: Global Installation
```bash
# Install globally
npm install -g mcp-webscraper

# Run the installer
mcp-webscraper
```

### Option 3: Project Installation
```bash
# Install in your project
npm install mcp-webscraper

# Run via npx
npx mcp-webscraper
```

## 🔧 Claude MCP Configuration

After running the installer, add this to your Claude MCP settings:

```json
{
  "webscraper": {
    "command": "npx",
    "args": ["mcp-webscraper@latest"],
    "env": {
      "SEARCH_PROVIDER": "duckduckgo"
    }
  }
}
```

## 🎯 Usage Examples

Once installed, you can use these commands in Claude:

- **Search the web**: `search_web("latest AI news")`
- **Scrape a page**: `fetch_url("https://example.com")`
- **Extract links**: `extract_links("https://example.com")`
- **Deep crawl**: `crawl_deep("https://example.com", max_depth=3)`
- **Batch scrape**: `batch_scrape(["url1", "url2", "url3"])`
- **Research topic**: `deep_research("quantum computing breakthroughs 2024")`

## ⚙️ Optional: Google Search Setup

To use Google search instead of DuckDuckGo:

1. Get API credentials from [Google Custom Search](https://developers.google.com/custom-search/v1/overview)
2. Add to your MCP configuration:

```json
{
  "webscraper": {
    "command": "npx",
    "args": ["mcp-webscraper@latest"],
    "env": {
      "SEARCH_PROVIDER": "google",
      "GOOGLE_API_KEY": "your-api-key",
      "GOOGLE_SEARCH_ENGINE_ID": "your-engine-id"
    }
  }
}
```

## 📚 All Available Tools

- `fetch_url` - Fetch content from URLs
- `extract_text` - Extract clean text
- `extract_links` - Extract all links
- `extract_metadata` - Extract page metadata
- `scrape_structured` - Extract using CSS selectors
- `search_web` - Search the web
- `crawl_deep` - Deep website crawling
- `map_site` - Map website structure
- `extract_content` - Enhanced content extraction
- `process_document` - Process PDFs and documents
- `summarize_content` - Summarize text
- `analyze_content` - Analyze content
- `batch_scrape` - Scrape multiple URLs
- `scrape_with_actions` - Browser automation
- `deep_research` - Multi-stage research
- `track_changes` - Monitor content changes

## 🆘 Help & Support

- GitHub: https://github.com/mcp-webscraper/mcp-webscraper
- Issues: https://github.com/mcp-webscraper/mcp-webscraper/issues
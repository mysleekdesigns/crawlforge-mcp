# MCP WebScraper Installation Guide

## Quick Install (Recommended)

Install the MCP WebScraper server in any project using:

```bash
npx mcp-webscraper@latest
```

This command will:
1. Download the latest version of the MCP WebScraper
2. Display the configuration needed for Claude
3. Create a sample `.env.example` file

## Installation Methods

### Method 1: Via NPX (No Installation Required)

```bash
# Run directly without installing
npx mcp-webscraper@latest
```

### Method 2: Global Installation

```bash
# Install globally
npm install -g mcp-webscraper

# Then run the installer
mcp-webscraper
```

### Method 3: Local Project Installation

```bash
# Install in your project
npm install mcp-webscraper

# Run via npx
npx mcp-webscraper
```

### Method 4: Claude MCP Add (After NPM Publish)

```bash
# Add to Claude's MCP servers
claude mcp add webscraper npx mcp-webscraper@latest
```

## Configuration

After installation, configure the server in your MCP settings:

```json
{
  "webscraper": {
    "command": "npx",
    "args": ["mcp-webscraper@latest"],
    "env": {
      "SEARCH_PROVIDER": "duckduckgo",
      "GOOGLE_API_KEY": "",
      "GOOGLE_SEARCH_ENGINE_ID": ""
    }
  }
}
```

## Environment Variables

Create a `.env` file in your project root:

```bash
# Search Provider (auto, google, duckduckgo)
SEARCH_PROVIDER=duckduckgo

# Google API (optional)
GOOGLE_API_KEY=your_key_here
GOOGLE_SEARCH_ENGINE_ID=your_id_here

# Performance Settings
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
```

## Available Tools

Once installed, you'll have access to 16 powerful web scraping tools:

### Basic Tools
- `fetch_url` - Fetch content from URLs
- `extract_text` - Extract clean text
- `extract_links` - Extract all links
- `extract_metadata` - Extract page metadata
- `scrape_structured` - Extract using CSS selectors

### Advanced Tools
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

## Testing Your Installation

After installation, test the server:

```bash
# Test the server directly
node server.js

# Or via npm
npm start
```

## Troubleshooting

### Issue: Server not starting
- Ensure Node.js 18+ is installed
- Check that all dependencies are installed: `npm install`

### Issue: Search not working
- DuckDuckGo works without API keys
- For Google search, add valid API credentials

### Issue: Permission errors
- Run with appropriate permissions
- Check file access for cache and logs directories

## Support

- GitHub Issues: https://github.com/mcp-webscraper/mcp-webscraper/issues
- Documentation: https://github.com/mcp-webscraper/mcp-webscraper#readme

## License

MIT License - See LICENSE file for details
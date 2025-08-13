# Quick Start Guide - MCP WebScraper

Get the MCP WebScraper running with Claude Code or Cursor in under 5 minutes!

## Prerequisites

- **Node.js** 18.0.0+ ([Download](https://nodejs.org/))
- **npm** 8.0.0+ (comes with Node.js)

Verify installation:
```bash
node --version  # Should show v18.0.0 or higher
npm --version   # Should show v8.0.0 or higher
```

## Installation

### Option 1: Quick Install (Recommended)

```bash
# Clone and setup in one command
git clone https://github.com/your-username/mcp-webscraper.git && \
cd mcp-webscraper && \
npm install && \
cp .env.example .env

# Test the server
npm start
```

### Option 2: Manual Install

```bash
# 1. Clone the repository
git clone https://github.com/your-username/mcp-webscraper.git

# 2. Navigate to directory
cd mcp-webscraper

# 3. Install dependencies
npm install

# 4. Setup configuration
cp .env.example .env

# 5. Start the server
npm start
```

## Claude Code Integration

### Step 1: Locate Your Config File

Claude Code stores MCP configuration in:
- **macOS/Linux**: `~/.config/claude/mcp.json`
- **Windows**: `%APPDATA%\claude\mcp.json`

### Step 2: Add WebScraper Configuration

Open the `mcp.json` file and add:

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

**Important**: Replace `/absolute/path/to/mcp-webscraper` with your actual installation path:
- **macOS Example**: `/Users/username/projects/mcp-webscraper/server.js`
- **Windows Example**: `C:\\Users\\username\\projects\\mcp-webscraper\\server.js`
- **Linux Example**: `/home/username/projects/mcp-webscraper/server.js`

### Step 3: Restart Claude Code

1. Quit Claude Code completely
2. Restart Claude Code
3. Open the MCP tools panel
4. You should see 12 WebScraper tools available

### Step 4: Test in Claude Code

Try this command in Claude Code:
```
Use the fetch_url tool to get the content from https://example.com
```

## Cursor IDE Integration

### Step 1: Open Cursor Settings

1. Open Cursor IDE
2. Press `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux)
3. Search for "MCP" in settings

### Step 2: Configure MCP Server

Add to your Cursor configuration:

```json
{
  "mcp.servers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### Step 3: Enable MCP in Cursor

1. Open Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`)
2. Type "MCP: Reload Servers"
3. Press Enter

### Step 4: Verify Installation

1. Open Command Palette
2. Type "MCP: List Tools"
3. You should see all 12 WebScraper tools

## First Tool Usage

### Example 1: Fetch a Website

```javascript
// In Claude Code or Cursor, ask:
"Fetch the content from https://httpbin.org/html"

// Or use directly:
{
  "tool": "fetch_url",
  "parameters": {
    "url": "https://httpbin.org/html"
  }
}
```

### Example 2: Extract Clean Text

```javascript
// Ask:
"Extract the main text content from https://example.com"

// Direct usage:
{
  "tool": "extract_text",
  "parameters": {
    "url": "https://example.com"
  }
}
```

### Example 3: Search the Web

```javascript
// Ask:
"Search for 'Node.js MCP servers' and return 5 results"

// Direct usage:
{
  "tool": "search_web",
  "parameters": {
    "query": "Node.js MCP servers",
    "max_results": 5
  }
}
```

## Optional: Configure Google Search

For better search results, add Google Custom Search API:

1. Get API credentials:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Enable "Custom Search API"
   - Create credentials (API Key)
   - Create a [Custom Search Engine](https://programmablesearchengine.google.com/)

2. Edit `.env` file:
```env
SEARCH_PROVIDER=google
GOOGLE_API_KEY=your_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_engine_id_here
```

3. Restart the server:
```bash
npm start
```

## Available Tools (12)

### Basic Web Operations
- `fetch_url` - Fetch content from URLs
- `extract_text` - Extract clean text
- `extract_links` - Extract all links
- `extract_metadata` - Get page metadata
- `scrape_structured` - Extract using CSS selectors

### Search & Discovery
- `search_web` - Search the internet
- `crawl_deep` - Deep website crawling
- `map_site` - Map website structure

### Advanced Processing
- `extract_content` - Smart content extraction
- `process_document` - Process PDFs and documents
- `summarize_content` - Summarize long text
- `analyze_content` - Analyze text (sentiment, language, etc.)

## Quick Troubleshooting

### Server won't start?
```bash
# Check Node version
node --version  # Must be 18+

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Tools not showing in Claude/Cursor?
1. Check the path in config is absolute (not relative)
2. Ensure no syntax errors in JSON config
3. Restart the IDE completely

### Permission errors?
```bash
# Make server executable
chmod +x server.js

# Fix npm permissions
sudo npm install -g npm
```

## Next Steps

- 📖 [API Reference](./API_REFERENCE.md) - Detailed tool documentation
- 🚀 [Deployment Guide](./DEPLOYMENT.md) - Production deployment
- 🔧 [Troubleshooting](./TROUBLESHOOTING.md) - Solve common issues
- 🏗️ [Advanced Topics](./ADVANCED.md) - Architecture & optimization

## Need Help?

- **Issues**: [GitHub Issues](https://github.com/your-username/mcp-webscraper/issues)
- **Documentation**: [Full Docs](https://github.com/your-username/mcp-webscraper/tree/main/docs)
- **MCP Protocol**: [Official MCP Docs](https://modelcontextprotocol.io/)
# Getting Started with MCP WebScraper

🎯 **Goal**: Get you scraping websites in under 5 minutes  
📚 **Difficulty**: Beginner-friendly  
⏱️ **Time Required**: 2-5 minutes for basic setup

## Table of Contents

- [What is MCP WebScraper?](#what-is-mcp-webscraper)
- [Prerequisites](#prerequisites)
- [Quick Start (30 seconds)](#quick-start-30-seconds)
- [Installation Methods](#installation-methods)
- [Configuration](#configuration)
- [Your First Scrape](#your-first-scrape)
- [Next Steps](#next-steps)
- [Troubleshooting](#troubleshooting)

## What is MCP WebScraper?

MCP WebScraper gives your AI assistant (Claude or Cursor) 16 powerful tools to interact with websites:

- 📄 **Extract** text, links, and metadata from any webpage
- 🔍 **Search** the web using Google or DuckDuckGo
- 🕷️ **Crawl** entire websites systematically
- 📊 **Analyze** content with NLP capabilities
- 🤖 **Automate** browser interactions (forms, clicks)
- 🔬 **Research** topics comprehensively with AI
- 📈 **Track** website changes over time

## Prerequisites

### Required
- **Node.js 18+** - Check with: `node --version`
- **AI Assistant** - Claude Code or Cursor IDE

### Optional
- **Google API credentials** - For better search results (works without them using DuckDuckGo)

**Need Node.js?** Download from [nodejs.org](https://nodejs.org) (get the LTS version)

## Quick Start (30 seconds)

The fastest way to get started:

```bash
# Run this single command
npx mcp-webscraper@latest

# The installer will:
# 1. Set up the server
# 2. Show you the configuration to add
# 3. Guide you through the setup
```

After running, restart your AI assistant and you're ready to scrape!

## Installation Methods

### Method 1: Automatic Setup (Recommended)

Best for beginners - handles everything automatically:

```bash
# Interactive setup with prompts
npx mcp-webscraper-setup

# Or with Google API credentials
npx mcp-webscraper-setup --google-api-key=YOUR_KEY --google-search-engine-id=YOUR_ID

# Or silent install (DuckDuckGo only)
npx mcp-webscraper-setup --no-interactive
```

This will:
1. Prompt for optional Google API credentials
2. Automatically configure your AI assistant
3. Verify the installation

### Method 2: Manual Installation

For more control over the setup process:

```bash
# Clone the repository
git clone https://github.com/your-username/mcp-webscraper.git
cd mcp-webscraper

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Test the server
npm start
```

### Method 3: Global Installation

Install once, use anywhere:

```bash
# Install globally
npm install -g mcp-webscraper

# Run from anywhere
mcp-webscraper
```

### Method 4: Docker Installation

For production deployments or isolation:

```bash
# Using Docker Compose
docker-compose up -d mcp-webscraper-prod

# Or using Docker directly
docker run -d --name mcp-webscraper \
  -e SEARCH_PROVIDER=auto \
  mcp-webscraper:latest
```

## Configuration

### For Claude Code

Add to your Claude configuration file:

**File Locations:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/claude/claude_desktop_config.json`

**Configuration:**
```json
{
  "mcpServers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"],
      "env": {
        "SEARCH_PROVIDER": "auto",
        "GOOGLE_API_KEY": "your_key_here_or_leave_empty",
        "GOOGLE_SEARCH_ENGINE_ID": "your_id_here_or_leave_empty"
      }
    }
  }
}
```

### For Cursor IDE

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "webscraper": {
      "command": "npx",
      "args": ["mcp-webscraper@latest"],
      "env": {
        "SEARCH_PROVIDER": "auto"
      }
    }
  }
}
```

### Environment Variables (Optional)

Create a `.env` file for advanced configuration:

```env
# Search Configuration
SEARCH_PROVIDER=auto              # auto, google, or duckduckgo
GOOGLE_API_KEY=your_key          # Optional: for Google search
GOOGLE_SEARCH_ENGINE_ID=your_id  # Optional: for Google search

# Performance Settings
MAX_WORKERS=10                    # Concurrent operations
QUEUE_CONCURRENCY=10              # Queue processing threads
CACHE_TTL=3600000                # Cache duration (1 hour)
RATE_LIMIT_REQUESTS_PER_SECOND=10

# Crawling Settings
MAX_CRAWL_DEPTH=5                # Maximum crawl depth
MAX_PAGES_PER_CRAWL=100         # Maximum pages per crawl
RESPECT_ROBOTS_TXT=true          # Honor robots.txt
```

### Getting Google API Credentials (Optional)

For better search results (free tier available):

1. **Get API Key:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Enable "Custom Search API"
   - Create credentials → API Key

2. **Get Search Engine ID:**
   - Go to [Programmable Search Engine](https://programmablesearchengine.google.com/)
   - Create a new search engine
   - Set to search the entire web
   - Copy the Search Engine ID

3. **Add to Configuration:**
   ```env
   GOOGLE_API_KEY=AIzaSy...your_key
   GOOGLE_SEARCH_ENGINE_ID=123456...your_id
   ```

**Note:** The system works perfectly with DuckDuckGo (no API key needed) if you skip this step.

## Your First Scrape

Once configured, try these commands with your AI assistant:

### 1. Extract Text from a Webpage
```
Extract the main text from https://example.com/article
```

### 2. Search the Web
```
Search for "machine learning tutorials" and show me the top 5 results
```

### 3. Extract All Links
```
Find all links on https://news.ycombinator.com
```

### 4. Get Page Metadata
```
Get the metadata (title, description, social tags) from https://github.com
```

### 5. Extract Specific Data
```
Extract all product prices from https://example.com/products using the CSS selector ".price"
```

## Next Steps

### Learn the Tools
- **[Tools Guide](./TOOLS_GUIDE.md)** - Detailed guide for all 16 tools
- **[Examples](./EXAMPLES.md)** - Real-world use cases and workflows
- **[API Reference](./API_REFERENCE.md)** - Complete technical documentation

### Explore Advanced Features
- **Batch Processing**: Process multiple URLs efficiently
- **Browser Automation**: Fill forms, click buttons, take screenshots
- **Deep Research**: AI-powered comprehensive research
- **Change Tracking**: Monitor websites for updates

### Common Workflows

1. **Research Workflow:**
   - Search for sources → Deep research → Summarize findings

2. **E-commerce Monitoring:**
   - Map product pages → Extract prices → Track changes

3. **Content Aggregation:**
   - Crawl website → Extract articles → Analyze content

## Troubleshooting

### Tools Not Appearing

1. **Check Configuration Path:**
   ```bash
   # Verify config exists
   cat ~/.config/claude/mcp.json  # Linux/Mac
   type %APPDATA%\claude\mcp.json  # Windows
   ```

2. **Verify Absolute Paths:**
   - ✅ Good: `"/home/user/mcp-webscraper/server.js"`
   - ❌ Bad: `"./server.js"` or `"~/mcp-webscraper/server.js"`

3. **Restart Your AI Assistant:**
   - Completely quit (not just close)
   - Start fresh

### Server Won't Start

1. **Check Node Version:**
   ```bash
   node --version  # Must be 18.0.0 or higher
   ```

2. **Reinstall Dependencies:**
   ```bash
   cd mcp-webscraper
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Check Permissions (Mac/Linux):**
   ```bash
   chmod +x server.js
   ```

### Search Not Working

- **No API Key?** That's fine! DuckDuckGo works without configuration
- **Have API Key?** Verify it's correctly added to your config
- **Rate Limited?** Google free tier has limits; wait or use DuckDuckGo

### Common Error Messages

| Error | Solution |
|-------|----------|
| "Cannot find module" | Run `npm install` in the project directory |
| "Permission denied" | Mac/Linux: Run `chmod +x server.js` |
| "Invalid JSON in config" | Validate at [jsonlint.com](https://jsonlint.com) |
| "Port already in use" | The server uses stdio, not ports - restart your AI assistant |
| "Tools not available" | Check config path is absolute, restart AI assistant |

### Getting Help

- **More Issues?** See [Troubleshooting Guide](./TROUBLESHOOTING.md)
- **GitHub Issues**: [Report bugs](https://github.com/your-username/mcp-webscraper/issues)
- **Discussions**: [Ask questions](https://github.com/your-username/mcp-webscraper/discussions)

---

## Ready to Start Scraping?

You now have everything needed to begin web scraping with your AI assistant!

1. ✅ Installation complete
2. ✅ Configuration added
3. ✅ AI assistant restarted
4. 🚀 **Try your first command:** "Search for today's tech news"

For a complete guide to all 16 tools, continue to the **[Tools Guide](./TOOLS_GUIDE.md)**.

---

*Need help? Check the [Troubleshooting Guide](./TROUBLESHOOTING.md) or [ask for help](https://github.com/your-username/mcp-webscraper/discussions)*
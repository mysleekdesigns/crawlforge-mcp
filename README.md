# MCP WebScraper Server v3.0

🌐 **Extract content from any website using AI-powered tools in Claude Code or Cursor IDE**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-blue)](https://modelcontextprotocol.io/)

## 🤔 What is This?

**MCP WebScraper** is a toolkit that gives AI assistants (like Claude) the ability to browse and extract information from websites. Think of it as giving your AI assistant a web browser and teaching it how to:

- 🔍 **Search the internet** like you would with Google
- 📄 **Read web pages** and extract the important parts
- 🕷️ **Crawl entire websites** to gather comprehensive information
- 📊 **Analyze content** including PDFs and complex documents
- 🎯 **Extract specific data** using targeted selectors

**Perfect for**: Researchers, developers, data analysts, content creators, and anyone who needs to gather information from the web efficiently.

## 🚀 Quick Start (3 Steps)

### Prerequisites Check
```bash
# Check if you have Node.js installed (need v18+)
node --version

# If not installed, download from: https://nodejs.org/
```

### Step 1️⃣: Install
```bash
git clone https://github.com/your-username/mcp-webscraper.git
cd mcp-webscraper
npm install
```

### Step 2️⃣: Configure Your IDE

<details>
<summary>🤖 For Claude Code</summary>

Add to `~/.config/claude/mcp.json`:
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
</details>

<details>
<summary>💻 For Cursor IDE</summary>

Add to Cursor settings:
```json
{
  "mcp.servers": {
    "webscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webscraper/server.js"]
    }
  }
}
```
</details>

### Step 3️⃣: Start Using

Ask your AI assistant:
- *"Search for the latest AI news"*
- *"Extract the main content from https://example.com"*
- *"Crawl the documentation site and summarize it"*

✅ **That's it!** You're ready to scrape the web with AI.

## 📚 Table of Contents

- [🎯 Features](#features)
- [🛠️ Available Tools](#available-tools)
- [🐳 Docker Setup](./docs/docker.md)
- [📖 Documentation](#documentation)
- [🤝 Contributing](#contributing)

## 🎯 Features

### What Can It Do?

🔍 **Search & Discovery**
- Search the web like Google (but through your AI)
- Discover all pages on a website automatically
- Map out entire website structures

📄 **Content Extraction**
- Extract clean, readable text from any webpage
- Get just the main article content (removes ads, menus)
- Pull specific data using CSS selectors (prices, titles, etc.)

🧠 **Smart Processing** (New in v3.0!)
- Summarize long articles into key points
- Analyze sentiment and detect languages
- Process PDFs and JavaScript-heavy sites
- Extract structured data (product info, metadata)

## 🛠️ Available Tools

Our toolkit includes **12 specialized tools** organized by complexity:

### 🟢 Basic Tools (Start Here)
| Tool | What it does | Example Use |
|------|--------------|-------------|
| `fetch_url` | Get raw website content | Downloading pages |
| `extract_text` | Get clean, readable text | Reading articles |
| `extract_links` | Find all links on a page | Navigation mapping |
| `search_web` | Search the internet | Research tasks |

### 🟡 Intermediate Tools
| Tool | What it does | Example Use |
|------|--------------|-------------|
| `extract_metadata` | Get page title, description, images | SEO analysis |
| `scrape_structured` | Extract specific elements | Product prices |
| `map_site` | Discover all pages on a site | Site inventory |
| `crawl_deep` | Explore websites thoroughly | Documentation gathering |

### 🔴 Advanced Tools
| Tool | What it does | Example Use |
|------|--------------|-------------|
| `extract_content` | Smart content extraction | Article processing |
| `process_document` | Handle PDFs and complex pages | Document analysis |
| `summarize_content` | Create summaries | Research digests |
| `analyze_content` | Deep content analysis | Sentiment detection |

## 🔧 Advanced Setup

### Using Docker (Recommended)
The easiest way to run MCP WebScraper:
```bash
# Start with Docker Compose
docker-compose up mcp-webscraper-dev
```
📖 [Full Docker Guide](./docs/docker.md) - Includes monitoring, scaling, and production setups

### Manual Installation
For development or customization:
```bash
# Clone and setup
git clone https://github.com/your-username/mcp-webscraper.git
cd mcp-webscraper
npm install

# Configure (optional)
cp .env.example .env
# Edit .env if you have Google API keys
```

### Configuration Options

Basic settings in `.env`:
```env
# Search provider (auto uses DuckDuckGo by default)
SEARCH_PROVIDER=auto

# Optional: Google Search API for better results
GOOGLE_API_KEY=your_key
GOOGLE_SEARCH_ENGINE_ID=your_id
```

📖 [Google Search Setup Guide](./docs/GOOGLE_SEARCH_SETUP.md) - Get API keys and configure Google search

## 💡 Example Uses

Ask your AI assistant to:

### Research Tasks
- *"Search for recent developments in renewable energy"*
- *"Find and summarize the top 5 articles about machine learning"*
- *"What are people saying about the new iPhone?"*

### Data Extraction
- *"Get all product prices from this store page"*
- *"Extract email addresses from this contact page"*
- *"Find all PDF download links on this site"*

### Content Analysis
- *"Analyze the sentiment of customer reviews on this page"*
- *"Summarize this long article into 5 key points"*
- *"What topics are discussed in this blog?"*

### Website Exploration
- *"Map out all pages on docs.python.org"*
- *"Crawl this blog and find all posts about JavaScript"*
- *"Check what technologies this website uses"*

📖 **Full Examples**: [API Reference](./docs/API_REFERENCE.md) has detailed code examples for each tool

## 📖 Documentation

### Essential Guides
- 📚 **[Quick Start](./docs/QUICK_START.md)** - Get running in 5 minutes
- 🔧 **[API Reference](./docs/API_REFERENCE.md)** - Detailed tool documentation
- 🐳 **[Docker Guide](./docs/docker.md)** - Container deployment
- ❓ **[Troubleshooting](./docs/TROUBLESHOOTING.md)** - Solve common issues

### Advanced Topics
- 🏗️ **[Architecture](./docs/ADVANCED.md)** - System design and internals
- 🚀 **[Deployment](./docs/DEPLOYMENT.md)** - Production deployment
- 🔍 **[Google Search Setup](./docs/GOOGLE_SEARCH_SETUP.md)** - Enhanced search configuration

## 🧪 Testing

```bash
# Quick test - verify installation
npm test

# Performance testing
npm run test:performance

# Run with Docker
docker-compose --profile testing up mcp-webscraper-test
```

## 🤝 Contributing

We love contributions! Here's how to help:

1. 🍴 Fork the repository
2. 🌿 Create your feature branch: `git checkout -b feature/awesome-feature`
3. 💻 Make your changes
4. ✅ Run tests: `npm test`
5. 📝 Commit: `git commit -m 'Add awesome feature'`
6. 🚀 Push: `git push origin feature/awesome-feature`
7. 🎯 Open a Pull Request

## 📞 Support

Need help? We're here:

- 💬 **[GitHub Issues](https://github.com/your-username/mcp-webscraper/issues)** - Report bugs
- 💡 **[Discussions](https://github.com/your-username/mcp-webscraper/discussions)** - Ask questions
- 📖 **[Documentation](./docs/)** - Read the guides
- 🔒 **[Security](mailto:security@example.com)** - Report vulnerabilities

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

## 🙏 Acknowledgments

Built with amazing open-source projects:
- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Mozilla Readability](https://github.com/mozilla/readability) for content extraction
- [Cheerio](https://cheerio.js.org/) for HTML parsing
- [Playwright](https://playwright.dev/) for browser automation

---

<div align="center">
<b>Made with ❤️ for the MCP community</b><br>
<i>Star ⭐ this repo if you find it helpful!</i>
</div>
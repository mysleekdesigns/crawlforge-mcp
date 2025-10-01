# CrawlForge MCP Server

Professional web scraping and content extraction server implementing the Model Context Protocol (MCP). Get started with **1,000 free credits** - no credit card required!

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io/)
[![npm version](https://img.shields.io/npm/v/crawlforge-mcp-server.svg)](https://www.npmjs.com/package/crawlforge-mcp-server)

## 🎯 Features

- **19 Professional Tools**: Web scraping, deep research, stealth browsing, content analysis
- **Free Tier**: 1,000 credits to get started instantly
- **MCP Compatible**: Works with Claude, Cursor, and other MCP-enabled AI tools
- **Enterprise Ready**: Scale up with paid plans for production use
- **Credit-Based**: Pay only for what you use

## 🚀 Quick Start (2 Minutes)

### 1. Install from NPM

```bash
npm install -g crawlforge-mcp-server
```

### 2. Setup Your API Key

```bash
npx crawlforge-setup
```

This will:
- Guide you through getting your free API key
- Configure your credentials securely
- Verify your setup is working

**Don't have an API key?** Get one free at [https://www.crawlforge.dev/signup](https://www.crawlforge.dev/signup)

### 3. Configure Your IDE

<details>
<summary>🤖 For Claude Desktop</summary>

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "crawlforge": {
      "command": "npx",
      "args": ["crawlforge-mcp-server"]
    }
  }
}
```

**Location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

Restart Claude Desktop to activate.
</details>

<details>
<summary>💻 For Cursor IDE</summary>

Add to `.cursorrules` in your project:
```bash
mcp_servers:
  crawlforge:
    command: npx
    args: ["crawlforge-mcp-server"]
```

Or use the MCP plugin in Cursor settings.
</details>

## 📊 Available Tools

### Basic Tools (1 credit each)
- `fetch_url` - Fetch content from any URL
- `extract_text` - Extract clean text from web pages
- `extract_links` - Get all links from a page
- `extract_metadata` - Extract page metadata

### Advanced Tools (2-3 credits)
- `scrape_structured` - Extract structured data with CSS selectors
- `search_web` - Search the web with Google/DuckDuckGo
- `summarize_content` - Generate intelligent summaries
- `analyze_content` - Comprehensive content analysis

### Premium Tools (5-10 credits)
- `crawl_deep` - Deep crawl entire websites
- `map_site` - Discover and map website structure
- `batch_scrape` - Process multiple URLs simultaneously
- `deep_research` - Multi-stage research with source verification
- `stealth_mode` - Anti-detection browser management

### Heavy Processing (3-10 credits)
- `process_document` - Multi-format document processing
- `extract_content` - Enhanced content extraction
- `scrape_with_actions` - Browser automation chains
- `generate_llms_txt` - Generate AI interaction guidelines
- `localization` - Multi-language and geo-location management

## 💳 Pricing

| Plan | Credits/Month | Best For |
|------|---------------|----------|
| **Free** | 1,000 | Testing & personal projects |
| **Starter** | 5,000 | Small projects & development |
| **Professional** | 50,000 | Professional use & production |
| **Enterprise** | 250,000 | Large scale operations |

**All plans include:**
- Access to all 19 tools
- Credits never expire and roll over month-to-month
- API access and webhook notifications

[View full pricing](https://www.crawlforge.dev/pricing)

## 🔧 Advanced Configuration

### Environment Variables

```bash
# Optional: Set API key via environment
export CRAWLFORGE_API_KEY="sk_live_your_api_key_here"

# Optional: Custom API endpoint (for enterprise)
export CRAWLFORGE_API_URL="https://api.crawlforge.dev"
```

### Manual Configuration

Your configuration is stored at `~/.crawlforge/config.json`:

```json
{
  "apiKey": "sk_live_...",
  "userId": "user_...",
  "email": "you@example.com"
}
```

## 📖 Usage Examples

Once configured, use these tools in your AI assistant:

```
"Search for the latest AI news"
"Extract all links from example.com"
"Crawl the documentation site and summarize it"
"Monitor this page for changes"
"Extract product prices from this e-commerce site"
```

## 🔒 Security & Privacy

- API keys are stored locally and encrypted
- All connections use HTTPS
- No data is stored on our servers beyond usage logs
- Compliant with robots.txt and rate limits
- GDPR compliant

## 🆘 Support

- **Documentation**: [https://www.crawlforge.dev/docs](https://www.crawlforge.dev/docs)
- **Issues**: [GitHub Issues](https://github.com/mysleekdesigns/crawlforge-mcp/issues)
- **Email**: support@crawlforge.dev
- **Discord**: [Join our community](https://discord.gg/crawlforge)

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

---

**Built with ❤️ by the CrawlForge team**

[Website](https://www.crawlforge.dev) | [Documentation](https://www.crawlforge.dev/docs) | [API Reference](https://www.crawlforge.dev/api-reference)
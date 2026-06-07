# CrawlForge MCP Server

Professional web scraping and content extraction server implementing the Model Context Protocol (MCP). Get started with **1,000 free credits** - no credit card required!

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io/)
[![npm version](https://img.shields.io/npm/v/crawlforge-mcp-server.svg)](https://www.npmjs.com/package/crawlforge-mcp-server)

## 🎯 Features

- **23 Professional Tools**: Web scraping, deep research, stealth browsing, content analysis, local-LLM extraction (Ollama)
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
- **Auto-configure Claude Code and Cursor** (if installed)
- Verify your setup is working

**Don't have an API key?** Get one free at [https://www.crawlforge.dev/signup](https://www.crawlforge.dev/signup)

### 3. Configure Your IDE (if not auto-configured)

<details>
<summary>🤖 For Claude Desktop</summary>

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "crawlforge": {
      "command": "npx",
      "args": ["-y", "crawlforge-mcp-server"]
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
<summary>🖥️ For Claude Code CLI (Auto-configured)</summary>

The setup wizard automatically configures Claude Code by adding to `~/.claude.json`:
```json
{
  "mcpServers": {
    "crawlforge": {
      "type": "stdio",
      "command": "crawlforge-mcp"
    }
  }
}
```

After setup, restart Claude Code to activate.
</details>

<details>
<summary>💻 For Cursor IDE (Auto-configured)</summary>

The setup wizard automatically configures Cursor by adding to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "crawlforge": {
      "type": "stdio",
      "command": "crawlforge-mcp"
    }
  }
}
```

Restart Cursor to activate.
</details>

> **Which launch command?** `npx -y crawlforge-mcp-server` needs no global install and always runs the published version (recommended for Claude Desktop). For a global install (`npm i -g crawlforge-mcp-server`), use the dedicated `crawlforge-mcp` bin — it resolves on your `PATH`, so it survives Node/nvm version switches. The bare `crawlforge` command still launches the server when an MCP client spawns it over stdio (backward compatibility for configs created before v4.2.5); interactively it's the CLI — run `crawlforge mcp` to start the server by hand.

## 📊 Available Tools

### Basic Tools (1 credit each)
- `fetch_url` - Fetch content from any URL
- `extract_text` - Extract clean text from web pages
- `extract_links` - Get all links from a page
- `extract_metadata` - Extract page metadata

### Advanced Tools (2-3 credits)
- `scrape_structured` - Extract structured data with CSS selectors
- `search_web` - Search the web using Google Search API
- `summarize_content` - Generate intelligent summaries
- `analyze_content` - Comprehensive content analysis
- `extract_structured` - LLM-powered schema-driven extraction
- `extract_with_llm` - Natural-language extraction. **Defaults to a local Ollama model — no API key, no API costs.** Pass `provider: "openai" | "anthropic"` with the matching key for cloud models.
- `list_ollama_models` - List the Ollama models installed locally (free; helps you pick a `model` for `extract_with_llm`)
- `track_changes` - Monitor content changes over time

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

For the full canonical capabilities reference (all tools, CLI commands, stealth engines, research workflow), see [SKILL.md](SKILL.md).

## 💳 Pricing

| Plan | Credits/Month | Best For |
|------|---------------|----------|
| **Free** | 1,000 | Testing & personal projects |
| **Starter** | 5,000 | Small projects & development |
| **Professional** | 50,000 | Professional use & production |
| **Enterprise** | 250,000 | Large scale operations |

**All plans include:**
- Access to all 23 tools
- Credits never expire and roll over month-to-month
- API access and webhook notifications

[View full pricing](https://www.crawlforge.dev/pricing)

## 🔧 Advanced Configuration

### Environment Variables

```bash
# Optional: Set API key via environment
export CRAWLFORGE_API_KEY="cf_live_your_api_key_here"

# Optional: Custom API endpoint (for enterprise)
export CRAWLFORGE_API_URL="https://api.crawlforge.dev"
# As of v3.0.18, this variable is validated against an allow-list of CrawlForge backend hosts.

# Optional: Local LLM (Ollama) overrides — extract_with_llm defaults to Ollama
export OLLAMA_BASE_URL="http://localhost:11434"   # default
export OLLAMA_DEFAULT_MODEL="llama3.2"             # default; any locally-pulled model name works

# Optional: Cloud LLM keys — only needed when you pass provider: "openai" or "anthropic"
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Local-LLM quickstart (`extract_with_llm` with Ollama)

`extract_with_llm` defaults to a local Ollama model — no API key, no API costs, no data leaving your machine.

```bash
# 1. Install Ollama:  https://ollama.com
# 2. Pull any model from https://ollama.com/library
ollama pull llama3.2

# 3. Discover what's installed (from your MCP client)
#    list_ollama_models()

# 4. Extract — defaults to Ollama with the model from step 2
#    extract_with_llm({ url: "https://example.com", prompt: "…", model: "llama3.2" })
```

### Manual Configuration

Your configuration is stored at `~/.crawlforge/config.json`:

```json
{
  "apiKey": "cf_live_...",
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

- **Secure Authentication**: API keys required for all operations (no bypass methods)
- **Local Storage**: API keys stored securely at `~/.crawlforge/config.json`
- **HTTPS Only**: All connections use encrypted HTTPS
- **No Data Retention**: We don't store scraped data, only usage logs
- **Rate Limiting**: Built-in protection against abuse
- **Compliance**: Respects robots.txt and GDPR requirements

### Security & Approvals

- **SSRF enforcement**: Every scraped URL is validated before the request is sent — http/https only; blocks loopback, RFC1918, IPv6 private/link-local ranges, cloud metadata endpoints (GCP, Azure), and dangerous ports (SSH, SMTP, DNS, MySQL, Postgres, Redis, MongoDB, etc.). Redirects are re-validated each hop, capped at 5.
- **Backend endpoint guard** (v3.0.18): The server's own calls to CrawlForge.dev use a separate fail-closed allow-list (`{crawlforge.dev, www.crawlforge.dev, api.crawlforge.dev}`, HTTPS required). Setting `CRAWLFORGE_API_URL` to an arbitrary host is blocked at parse time.
- **Action allowlist**: `scrape_with_actions` accepts only 7 action types (`wait`, `click`, `type`, `press`, `scroll`, `screenshot`, `executeJavaScript`). No download, file-write, or arbitrary cross-page navigation primitives exist.
- **JavaScript gate**: The `executeJavaScript` action throws by default. Set `ALLOW_JAVASCRIPT_EXECUTION=true` at deploy time to enable (not recommended in production).
- **MCP Elicitation** (v3.6.0): Four tools request user confirmation before executing expensive operations — `deep_research` (>50 URLs), `batch_scrape` (sync mode, >25 URLs), `crawl_deep` (projected >500 pages), `extract_structured` (schema has >3 required fields with no LLM configured). Credit-low situations also elicit. Confirmation is best-effort: if the MCP client does not support elicitation the tool proceeds (fail-open).
- **Per-tool credit gating**: Every tool is wrapped with `withAuth()`, which checks and deducts credits before execution. Fail-closed since v3.0.18.

See [docs/sandboxing-and-approvals.md](docs/sandboxing-and-approvals.md) for the full reference.

### Security Updates

**v3.0.3 (2025-10-01)**: Removed authentication bypass vulnerability. All users must authenticate with valid API keys.

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
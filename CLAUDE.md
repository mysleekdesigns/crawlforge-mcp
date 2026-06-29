# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

1. Think Before Coding
   Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.

2. Simplicity First
   Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes
   Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

4. Goal-Driven Execution
   Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" → "Write tests for invalid inputs, then make them pass"
"Fix the bug" → "Write a test that reproduces it, then make it pass"
"Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
   Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Project Overview

CrawlForge MCP Server - A professional MCP (Model Context Protocol) server providing 26 web scraping, crawling, and content processing tools (5 inline + 21 advanced).

**Current Version:** 4.8.1

## Development Commands

```bash
# Install dependencies
npm install

# Setup (required for first run - users only)
npm run setup
# Or provide API key via environment:
export CRAWLFORGE_API_KEY="your_api_key_here"

# Creator Mode (for package maintainer only)
# Set your creator secret in .env file:
# CRAWLFORGE_CREATOR_SECRET=your-secret-uuid
# This enables unlimited access for development/testing

# Run the server (production)
npm start

# HTTP transport mode
npm run start:http

# Development mode with verbose logging
npm run dev

# Test MCP protocol compliance
npm test

# Unit tests (400+ tests across tests/unit/, no live network)
npm run test:unit
# Phase D regressions live in tests/unit/phaseD-regressions.test.js (agent hard stops, unified scrape, map_site ranking)
# Run a single test file:  node --test tests/unit/phaseD-regressions.test.js
# Note: add --test-force-exit if the run appears to hang at the end — importing
# StealthBrowserManager (d2-reliability.test.js) leaves a Playwright handle that
# otherwise delays process exit ~100s. Tests themselves pass either way.

# Integration tests
npm run test:integration

# Functional tests
node test-tools.js             # Test all tools
node test-real-world.js        # Test real-world usage scenarios

# MCP Protocol tests
node tests/integration/mcp-protocol-compliance.test.js

# CLI (v4.1.0+, requires global install or npx)
crawlforge --help              # Show all subcommands
crawlforge init                # API-key detection + skill install + idempotent MCP-stanza merge (v4.6.0)
crawlforge init --all --yes    # Merge MCP config into Claude Code / Desktop / Cursor non-interactively
crawlforge scrape https://example.com
crawlforge batch --urls urls.txt --format markdown
crawlforge install-skills --target claude-code
# See docs/cli-guide.md for full reference

# Docker
npm run docker:build         # Build Docker image
npm run docker:dev          # Run development container
npm run docker:prod         # Run production container
```

### Debugging Tips

- All diagnostic output (Winston logs + status banners) goes to stderr; stdout is reserved for the MCP JSON-RPC stream and CLI `--json` output (enforced in v4.2.4)
- Set `NODE_ENV=development` for verbose logging
- Use `--expose-gc` flag for memory profiling: `node --expose-gc server.js`
- Check `cache/` directory for cached responses
- Review `logs/` directory for application logs
- Memory monitoring auto-enabled in development mode (logs every 60s if >200MB)

## High-Level Architecture

### Core Infrastructure (`src/core/`)

- **AuthManager**: Authentication, credit tracking, and usage reporting
- **PerformanceManager**: Centralized performance monitoring and optimization
- **JobManager**: Asynchronous job tracking and management for batch operations
- **WebhookDispatcher**: Event notification system for job completion callbacks
- **ActionExecutor**: Browser automation engine (Playwright-based)
- **ResearchOrchestrator**: Multi-stage research with query expansion and synthesis
- **AgentOrchestrator**: Powers the `agent` tool — NL prompt → autonomous PLAN→GATHER→ACT→DECIDE→SHAPE loop with three orchestrator-enforced hard stops (maxSteps≤10, maxUrls≤20, wall-clock) never delegated to the LLM; degraded no-LLM-key path (D2, v4.6.0)
- **StealthBrowserManager**: Stealth mode scraping with anti-detection; Camoufox (Firefox) engine added in v4.0.0
- **LocalizationManager**: Multi-language content and localization
- **ChangeTracker**: Content change tracking over time
- **SnapshotManager**: Website snapshots and version history
- **ResourceRegistry**: MCP Resources (crawlforge:// URI scheme, 5 resource types) — D1.1, v3.6.0
- **PromptRegistry** (`src/prompts/`): 5 workflow prompts — D1.2, v3.6.0
- **SamplingClient**: MCP Sampling with Ollama-API fallback chain — D1.3, v3.6.0
- **ElicitationHelper**: MCP Elicitation for user confirmation on expensive operations — D1.4, v3.6.0
- **endpointGuard**: Allow-list guard for server's own backend calls — v3.0.18

### Tool Layer (`src/tools/`)

Tools are organized in subdirectories by category:

- `advanced/` - BatchScrapeTool, ScrapeWithActionsTool
- `agent/` - agent (AgentOrchestrator-driven autonomous tool, v4.6.0)
- `basic/` - fetchUrl, extractText, extractLinks, extractMetadata, scrapeStructured
- `scrape/` - unifiedScrape (single-fetch multi-format `scrape` tool, v4.6.0)
- `crawl/` - crawlDeep, mapSite
- `extract/` - analyzeContent, extractContent, extractStructured, extractWithLlm, listOllamaModels, processDocument, summarizeContent
- `research/` - deepResearch
- `search/` - searchWeb (proxied through CrawlForge.dev API)
- `templates/` - ScrapeTemplateTool (10 pre-built site templates, v4.0.0)
- `tracking/` - trackChanges
- `llmstxt/` - generateLLMsTxt

### Available MCP Tools (26 total)

**Basic Tools (server.js inline, 5):**
fetch_url, extract_text, extract_links, extract_metadata, scrape_structured

**Advanced Tools (21):**
search_web, crawl_deep, map_site, extract_content, process_document, summarize_content, analyze_content, extract_structured, extract_with_llm, list_ollama_models, batch_scrape, scrape_with_actions, deep_research, track_changes, generate_llms_txt, stealth_mode, localization, scrape_template, scrape, agent

**v4.6.0 additions (Phase D):**
- `scrape` — single fetch + one cheerio load dispatching a `formats` array (markdown/html/rawHtml/text/links/metadata/screenshot/json-schema) + `onlyMainContent`; partial-success via per-format `warnings[]`. Cost: 2.
- `agent` — NL prompt → autonomous research/extract, no URLs required (see AgentOrchestrator above). Cost: 8.
- `map_site` gained an optional `search=` param that ranks discovered URLs (`ranked_urls:[{url,score}]`); default output unchanged.

### MCP Server Entry Point

The main server implementation is in `server.js` which:

1. **Secure Creator Mode**: Loads `.env` early, validates secret via SHA256 hash comparison
2. **Authentication Flow**: AuthManager for API key validation and credit tracking
3. **Tool Registration**: All tools registered via `server.registerTool()`, wrapped with `withAuth()` for credit tracking
4. **Transport**: stdio transport for MCP protocol communication
5. **Graceful Shutdown**: Cleans up browser instances, job managers, and other resources

### Tool Credit System

Each tool wrapped with `withAuth(toolName, handler)`:

- Checks credits before execution (skipped in creator mode)
- Reports usage with credit deduction on success
- Charges half credits on error
- Creator mode: Unlimited access for package maintainer

### Key Configuration

Critical environment variables defined in `src/constants/config.js`:

```bash
CRAWLFORGE_API_KEY=your_api_key_here
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
CACHE_TTL=3600000
RATE_LIMIT_REQUESTS_PER_SECOND=10
MAX_CRAWL_DEPTH=5
MAX_PAGES_PER_CRAWL=100
RESPECT_ROBOTS_TXT=true
```

`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are optional. They only affect `deep_research`: when set, it produces a fully synthesized report internally; when unset, it returns raw evidence for the calling LLM (e.g. Claude Code) to synthesize.

### Configuration Files

- `~/.crawlforge/config.json` - User authentication and API key storage
- `.env` - Environment variables for development
- `src/constants/config.js` - Central configuration with defaults and validation

### Adding New Tools

When adding a new tool to server.js:

1. Import the tool class from `src/tools/`
2. Instantiate the tool (with config if needed)
3. Register with `server.registerTool(name, { description, inputSchema }, withAuth(name, handler))`
4. Ensure tool implements `execute(params)` method
5. Add to cleanup array in gracefulShutdown if it has `destroy()` or `cleanup()` methods
6. Update tool count in console log at server startup

## Sandboxing & Approvals

Key mechanisms for security-conscious future sessions:

- **SSRF** (`src/utils/ssrfGuard.js` enforcing `src/utils/ssrfProtection.js`): As of v4.8.0 SSRF is actually enforced on the live scraping fetch path (previously `ssrfProtection.js` was unwired). `ssrfGuard` injects an undici dispatcher whose connect-time `lookup` validates every connection — initial request and each redirect hop — and pins the validated IP (closing the DNS-rebinding TOCTOU window). Stage 1 (default) blocks loopback, link-local/cloud-metadata (169.254.169.254), and 0.0.0.0; `SSRF_STRICT=true` adds full RFC1918/ULA/etc. enforcement. Kill switch `SSRF_PROTECTION_ENABLED=false`; `ALLOWED_DOMAINS` allowlist bypass. Wired into every read-scrape site (`_fetch.js`, `_fetchAndParse.js`, `batchScrape/worker.js`, `mapSite.js`, `BFSCrawler.js`, extract/template/session/research/llms-txt/robots/sitemap/track-changes fetches) via `ssrfGuard()`/`safeFetch()`. http/https only; dangerous ports + path-traversal still rejected by `ssrfProtection.js`.
- **endpointGuard** (`src/core/endpointGuard.js`): Hard allow-list of `{crawlforge.dev, www.crawlforge.dev, api.crawlforge.dev}` for the server's own backend calls; HTTPS required; fail-closed. Localhost only in creator mode (v3.0.18).
- **Action allowlist** (`src/core/ActionExecutor.js`): `scrape_with_actions` accepts only 7 action types: `wait`, `click`, `type`, `press`, `scroll`, `screenshot`, `executeJavaScript`. `executeJavaScript` throws unless `ALLOW_JAVASCRIPT_EXECUTION=true` is set at deploy time (off by default).
- **Elicitation** (`src/core/ElicitationHelper.js`): User confirmation requested for `deep_research` (>50 URLs), `batch_scrape` (sync, >25 URLs), `crawl_deep` (projected >500 pages), `extract_structured` (schema has >3 required fields, no LLM configured), and credit-low situations. Fail-open if client does not support elicitation.
- **Browser sandboxing**: Standard pool retains OS sandbox. Stealth Chromium uses `--no-sandbox` + `--disable-web-security` (deliberate fingerprint-spoofing trade-off). Camoufox (Firefox, v4.0.0) is the alternative — see `docs/stealth-engines.md`.

See `docs/sandboxing-and-approvals.md` for the full reference.

## Security

Security testing and CI/CD pipeline details are in:

- `docs/sandboxing-and-approvals.md` — Canonical sandboxing & approvals reference
- `docs/security-audit-report.md` — Full security audit
- `.github/workflows/ci.yml` — CI pipeline with security checks
- `.github/workflows/security.yml` — Daily scheduled security scanning
- `.github/SECURITY.md` — Security policy and procedures

Run `npm audit` locally to check dependencies.

## Implementation Patterns

### Tool Structure

```javascript
export class ToolName {
  constructor(config) { this.config = config; }

  async execute(params) {
    return { success: true, data: {...} };
  }

  async destroy() { /* cleanup resources */ }
}
```

### Error Handling Pattern

```javascript
try {
  const result = await tool.execute(params);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
} catch (error) {
  return {
    content: [{ type: "text", text: `Operation failed: ${error.message}` }],
    isError: true,
  };
}
```

## Project Management Rules

- Always have the project manager work with the appropriate sub agents in parallel
- Each sub agent must work on their strengths; when done they report to the project manager who updates `docs/PRODUCTION_READINESS.md`
- Whenever a phase is completed, push all changes to GitHub
- Put all documentation md files into the `docs/` folder
- Every time you finish a phase run the test suites (`npm run test:unit` and `npm test`) and fix all failures before pushing

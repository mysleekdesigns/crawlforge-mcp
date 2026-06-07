# CrawlForge Skill Reference

> Auto-generated from `src/skills/*.md`. To regenerate, run `concatenateSkills()` from `src/skills/installer.js`, or re-run this documentation task.
>
> This file is the canonical capabilities reference for AI agents using CrawlForge MCP tools.

---

# CrawlForge MCP Tools — When and How to Use

CrawlForge is a professional MCP server with 23 tools for web scraping, crawling, content extraction, research, and AI compliance.

## When to Use MCP Tools vs CLI

Use MCP tools when you need results inline within an AI assistant session.
Use the CLI (`crawlforge <command>`) for scripts, CI, and automation pipelines.

## All 23 Tools

### Basic Fetching (5 tools)
- **fetch_url** — Raw HTTP fetch; returns headers + body. Use for quick single-URL fetches.
- **extract_text** — Clean readable text from a page (strips HTML). Use for reading articles.
- **extract_links** — All links from a page with anchor text. Use for link analysis.
- **extract_metadata** — Title, description, OG tags, schema.org from a page.
- **scrape_structured** — CSS-selector based data extraction from a page.

### Search (1 tool)
- **search_web** — Search via CrawlForge API or SearXNG. Supports query expansion, ranking, dedup.

### Crawling (2 tools)
- **crawl_deep** — BFS crawl up to 1000 pages with configurable depth, content extraction, link analysis.
- **map_site** — Fast sitemap generation via sitemap.xml or crawl. Returns URL list with metadata.

### Content Extraction (7 tools)
- **extract_content** — Main content extraction with Readability, markdown output, image handling.
- **process_document** — PDF, DOCX, TXT processing with chunking and metadata.
- **summarize_content** — Abstractive summarization (via Ollama/API/sampling).
- **analyze_content** — Sentiment, entities, readability, keyword density, topic detection.
- **extract_structured** — JSON schema-driven extraction with LLM or CSS selectors.
- **extract_with_llm** — Natural language prompt-based extraction. Fallback: Ollama → API keys → sampling.
- **list_ollama_models** — List locally available Ollama models.

### Advanced (2 tools)
- **batch_scrape** — Scrape multiple URLs concurrently. Default output: markdown (RAG-ready).
- **scrape_with_actions** — Browser automation (click, type, scroll, wait) before scraping.

### Research (1 tool)
- **deep_research** — Multi-stage research: query expansion → parallel fetch → dedup → synthesis.

### Tracking (1 tool)
- **track_changes** — Snapshot URL and diff against baseline. Returns change percentage + diff.

### LLMs.txt (1 tool)
- **generate_llms_txt** — Generate llms.txt and llms-full.txt for AI compliance.

### Stealth (1 tool)
- **stealth_mode** — Anti-bot browser scraping. Engines: playwright (default) or camoufox.

### Localization (1 tool)
- **localization** — Fetch with locale/geo targeting, proxy routing, currency awareness.

### Templates (1 tool)
- **scrape_template** — Pre-built extractors for: amazon-product, linkedin-profile, github-repo, youtube-video, tweet, reddit-thread, hacker-news-front-page, producthunt-launch, stackoverflow-question, npm-package.

## Cost Reference (Credits)
- fetch_url, extract_text, extract_links, extract_metadata: 1 credit
- search_web, map_site: 2 credits
- extract_content, scrape_structured, analyze_content, summarize_content: 3 credits
- crawl_deep, batch_scrape, track_changes, generate_llms_txt: 5 credits
- extract_structured, extract_with_llm, stealth_mode, localization, scrape_with_actions: 5 credits
- deep_research: 10–50 credits (dynamic, triggers elicitation when >50)

## Example Tool Calls

Fetch a page:
```json
{ "tool": "fetch_url", "params": { "url": "https://example.com" } }
```

Search the web:
```json
{ "tool": "search_web", "params": { "query": "MCP server Node.js", "limit": 5 } }
```

Extract markdown from an article:
```json
{ "tool": "extract_content", "params": { "url": "https://example.com/article", "output_format": "markdown" } }
```

---

# CrawlForge CLI Usage Guide

The `crawlforge` CLI exposes all 23 MCP tools as command-line subcommands.

## Installation

```bash
npm install -g crawlforge-mcp-server
# or run without installing:
npx crawlforge-mcp-server <command>
```

## Global Flags

All commands support these flags:
- `--json` — output compact JSON
- `--pretty` — output pretty-printed JSON
- `--quiet` — suppress output (exit code only)
- `--api-key <key>` — override CRAWLFORGE_API_KEY env var
- `--timeout <ms>` — global request timeout (default: 30000)

## Commands

### scrape — Fetch a URL
```bash
crawlforge scrape https://example.com
crawlforge scrape https://example.com --extract --format markdown
crawlforge scrape https://example.com --pretty
```

### search — Search the web
```bash
crawlforge search "MCP server tutorial" --limit 10
crawlforge search "nodejs scraping" --provider searxng --json
```

### crawl — Deep website crawl
```bash
crawlforge crawl https://docs.example.com --depth 3 --max-pages 200
crawlforge crawl https://example.com --no-robots --concurrency 20
```

### map — Generate sitemap
```bash
crawlforge map https://example.com --pretty
crawlforge map https://example.com --format xml > sitemap.xml
```

### extract — Structured data extraction
```bash
# Schema-based extraction
crawlforge extract https://example.com/product --schema product-schema.json

# LLM-guided extraction
crawlforge extract https://example.com/article --prompt "extract title, author, date, summary"
```

### track — Track content changes
```bash
crawlforge track https://example.com --threshold 10
crawlforge track https://example.com --selector ".main-content"
```

### analyze — Content analysis
```bash
crawlforge analyze https://example.com --depth full --pretty
```

### research — Deep research
```bash
crawlforge research "state of AI in 2025" --depth deep --max-urls 30
crawlforge research "competitor pricing" --output-format detailed --json
```

### stealth — Anti-bot scraping
```bash
crawlforge stealth https://protected-site.com
crawlforge stealth https://protected-site.com --engine camoufox --screenshot
```

### batch — Batch scrape from file
```bash
# Create a URLs file:
cat > urls.txt << EOF
https://example.com/page1
https://example.com/page2
https://example.com/page3
EOF

crawlforge batch urls.txt --format markdown --concurrency 10
```

### actions — Browser automation
```bash
# Create an actions script:
cat > login.json << EOF
[
  { "type": "click", "selector": "#login-btn" },
  { "type": "type", "selector": "#email", "text": "user@example.com" },
  { "type": "wait", "duration": 1000 }
]
EOF

crawlforge actions https://example.com --script login.json --screenshot
```

### localize — Geo-targeted fetch
```bash
crawlforge localize https://example.com --locale fr-FR --country FR
crawlforge localize https://shop.example.com --locale en-GB --currency GBP
```

### llmstxt — Generate llms.txt
```bash
crawlforge llmstxt https://example.com
crawlforge llmstxt https://example.com --include-full > llms.txt
```

### template — Pre-built site scrapers
```bash
crawlforge template github-repo https://github.com/owner/repo
crawlforge template amazon-product https://amazon.com/dp/B0XXXXX
crawlforge template npm-package https://npmjs.com/package/commander
crawlforge template --list  # list all available templates
```

### monitor — Continuous change monitoring
```bash
crawlforge monitor https://example.com --interval 60 --webhook https://my-site.com/hook
crawlforge monitor https://example.com --selector ".price" --threshold 1
```

### install-skills — Install AI assistant skills
```bash
crawlforge install-skills --target claude-code
crawlforge install-skills --target cursor --force
crawlforge install-skills --target all --dry-run
```

### uninstall-skills — Remove AI assistant skills
```bash
crawlforge uninstall-skills --target claude-code
crawlforge uninstall-skills --target all
```

## Output Piping Examples

```bash
# Extract markdown and save to file
crawlforge scrape https://example.com --extract --format markdown > page.md

# Search and parse with jq
crawlforge search "nodejs MCP" --json | jq '.results[].url'

# Batch scrape and process results
crawlforge batch urls.txt --json | jq '.results | length'
```

---

# CrawlForge Stealth Mode Guide

## When to Use stealth_mode

Use `stealth_mode` when a site returns bot-detection errors, 403 responses, CAPTCHAs, or JavaScript-rendered content that `fetch_url` and `extract_content` cannot access.

Signs you need stealth mode:
- Site returns 403 or 429 on regular fetch
- Content is empty or shows "please enable JavaScript"
- Site uses Cloudflare, DataDome, PerimeterX, or similar bot protection

## Engines

### playwright (default)
- Chromium-based with stealth patches
- Masks webdriver fingerprints, User-Agent, navigator properties
- Good for most sites with basic bot detection
- Lower resource usage

### camoufox
- Firefox-based with native anti-detection
- No patches applied — uses Firefox's native properties
- Scores higher on CreepJS and DataDome than patched Chromium
- Use for sites with advanced fingerprinting (financial, e-commerce)

## MCP Tool Usage

```json
// Basic stealth scrape
{
  "tool": "stealth_mode",
  "params": {
    "url": "https://protected-site.com",
    "engine": "playwright"
  }
}

// Advanced: Camoufox engine with screenshot
{
  "tool": "stealth_mode",
  "params": {
    "url": "https://heavily-protected-site.com",
    "engine": "camoufox",
    "wait_for": 3000,
    "screenshot": true
  }
}
```

## CLI Usage

```bash
# Default engine (playwright)
crawlforge stealth https://protected-site.com

# Camoufox for advanced bot detection bypass
crawlforge stealth https://protected-site.com --engine camoufox

# Wait for JS-heavy page to render, capture screenshot
crawlforge stealth https://spa-site.com --wait 3000 --screenshot

# Output as JSON
crawlforge stealth https://example.com --json
```

## Engine Selection Guide

| Scenario | Recommended Engine |
|----------|-------------------|
| General JS-rendered sites | playwright |
| Cloudflare-protected sites | camoufox |
| Sites with DataDome | camoufox |
| Sites with PerimeterX | camoufox |
| Financial/trading sites | camoufox |
| Speed-critical scraping | playwright |
| Basic bot detection bypass | playwright |

## Environment Variable

Force engine globally:
```bash
export CRAWLFORGE_STEALTH_ENGINE=camoufox
```

## Combining with Other Tools

After extracting raw HTML via stealth_mode, pipe to analyze_content or extract_structured:
```json
// Step 1: get HTML via stealth
{ "tool": "stealth_mode", "params": { "url": "https://example.com" } }

// Step 2: extract structured data from the result
{ "tool": "extract_structured", "params": { "url": "https://example.com", "schema": {...} } }
```

## Credits
- `stealth_mode`: 5 credits per call
- Additional costs for screenshots (1 extra credit per screenshot)

---

# CrawlForge Deep Research Workflow

## When to Use deep_research

Use `deep_research` for comprehensive topic research that requires multiple sources:
- Competitive analysis (compare multiple competitors)
- Technology landscape research
- Fact-gathering with citations
- Market research with multiple data points
- Any topic requiring 5+ web sources synthesized

Do NOT use for:
- Single URL content extraction → use `extract_content`
- Simple web searches → use `search_web`
- Known URLs you want to read → use `fetch_url` or `batch_scrape`

## How deep_research Works

1. **Query Expansion** — Generates 3–5 related queries from your topic
2. **Parallel Fetching** — Fetches up to `max_urls` sources simultaneously
3. **URL Deduplication** — Skips already-visited URLs within the session
4. **Content Extraction** — Extracts clean text from each source
5. **Synthesis** — If Ollama/API key available: returns synthesized report; otherwise returns raw evidence for the calling LLM to synthesize

## LLM Fallback Chain

```
Ollama (local, default) → OpenAI API key → Anthropic API key → MCP Sampling → Raw evidence
```

With no LLM configured, `deep_research` returns structured raw evidence that Claude or another LLM can synthesize.

## MCP Tool Usage

```json
// Standard research
{
  "tool": "deep_research",
  "params": {
    "query": "React vs Vue vs Angular in 2025",
    "depth": "standard",
    "max_urls": 20
  }
}

// Deep research with all sources
{
  "tool": "deep_research",
  "params": {
    "query": "competitor pricing analysis for B2B SaaS",
    "depth": "deep",
    "max_urls": 50,
    "output_format": "detailed"
  }
}
```

Note: When `max_urls > 50`, the tool triggers an elicitation asking for confirmation before proceeding (cost guard).

## CLI Usage

```bash
# Standard research
crawlforge research "React vs Vue in 2025" --depth standard

# Deep research with JSON output
crawlforge research "B2B SaaS pricing trends" --depth deep --max-urls 30 --json

# Save research report to file
crawlforge research "competitor analysis" --pretty > research-report.json
```

## Depth Levels

| Depth | URLs Analyzed | Use Case | Approx. Credits |
|-------|--------------|----------|-----------------|
| basic | 5–10 | Quick overview | 10–15 |
| standard | 15–25 | General research | 15–30 |
| deep | 30–75 | Comprehensive analysis | 30–75+ |

## Cost Management

- `deep_research` costs 10 base credits + 1 per URL analyzed
- Elicitation fires when projected cost > 50 credits
- Use `max_urls` to cap costs: `max_urls: 10` ≈ 20 credits max
- Token budget auto-limits LLM synthesis costs (default: 200,000 chars)

## Accessing Research Results as Resources

Completed research sessions are available as MCP Resources:
```
crawlforge://research/{sessionId}
```

List via `resources/list` — no need to re-run the research.

## Combining with Other Tools

For targeted competitive research:
```
1. search_web "competitor X pricing"         → get URLs
2. batch_scrape [competitor URLs]             → get content in parallel
3. deep_research "competitor X vs us"         → synthesized analysis
```

---

## Phase D New Tools (v4.6.0)

Two tools added in Phase D ("Firecrawl-Competitive"):

### scrape
Unified single-fetch multi-format scrape. Replaces the common pattern of calling `fetch_url` then `extract_content` in sequence.
- Key params: `url` (string, required), `format` (`markdown` | `html` | `text` | `links`, default `markdown`), `include_metadata` (bool)
- Credits: 2

### agent
Autonomous natural-language research and extraction. Accepts a plain-English prompt; internally plans and executes tool calls (search, fetch, extract) to return a structured answer.
- Key params: `prompt` (string, required), `max_steps` (int, default 10), `output_format` (`text` | `json` | `markdown`)
- Credits: 5–25 (dynamic, based on steps taken)

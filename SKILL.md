# CrawlForge Skill Reference

> Auto-generated from `src/skills/agent-skills/*/SKILL.md`. To regenerate, run `npm run skills:gen` (calls `concatenateSkills()` from `src/skills/installer.js`).
>
> This file is the canonical capabilities reference for AI agents using CrawlForge MCP tools.

---

# CrawlForge Batch & Automation

Scale up scraping and drive interactive pages. Use `batch_scrape` for many URLs,
`get_batch_results` to page through async output, `scrape_with_actions` to
interact before scraping, and `generate_llms_txt` to produce a site's AI policy
file.

## When to use

- "Scrape these 30 URLs" / "batch-scrape this list" → `batch_scrape`
- "Collect dozens of product / news / competitor pages" → `batch_scrape` (async)
- "Get the rest of the results from that batch" → `get_batch_results`
- "Click / type / scroll / wait before scraping" / "log in then extract" →
  `scrape_with_actions`
- "Generate an llms.txt for this site" → `generate_llms_txt`

## batch_scrape — many URLs in parallel (cost: 5)

Sync mode (results returned immediately), good for up to ~25 URLs:

```json
{
  "tool": "batch_scrape",
  "params": {
    "urls": ["https://a.com", "https://b.com", "https://c.com"],
    "formats": ["markdown"],
    "mode": "sync",
    "maxConcurrency": 5
  }
}
```

Async mode with a webhook for large batches (returns a `batchId` immediately):

```json
{
  "tool": "batch_scrape",
  "params": {
    "urls": ["https://a.com", "https://b.com"],
    "formats": ["json"],
    "mode": "async",
    "webhook": { "url": "https://my-site.com/hook", "events": ["batch_completed", "batch_failed"] }
  }
}
```

- `urls` accepts plain strings OR objects `{url, selectors, headers, timeout,
  metadata}` for per-URL config. 1–50 URLs.
- `formats`: `markdown`, `html`, `json`, `text`.
- `extractionSchema` applies structured extraction to every URL.
- `maxConcurrency` 1–20 (default 10); `delayBetweenRequests` throttles.
- Sync batches over ~25 URLs trigger a confirmation prompt (elicitation) — use
  async for large jobs.

CLI: `crawlforge batch urls.txt --format markdown --concurrency 10`.

## get_batch_results — page through output (cost: 1)

```json
{ "tool": "get_batch_results", "params": { "batchId": "batch_1234567890_abc", "page": 2, "pageSize": 25 } }
```

Use the `batchId` from `batch_scrape` to retrieve paginated results for a
completed or in-progress job. Cheap (1 credit) because the batch was already
paid for. Completed jobs are also exposed as `crawlforge://job/{jobId}`
resources.

## scrape_with_actions — interact, then scrape (cost: 5)

For SPAs, login-gated content, or multi-step flows. Run an ordered list of
browser actions before extraction.

```json
{
  "tool": "scrape_with_actions",
  "params": {
    "url": "https://app.com/login",
    "actions": [
      { "type": "type", "selector": "#email", "text": "user@a.com" },
      { "type": "type", "selector": "#password", "text": "secret" },
      { "type": "click", "selector": "#login" },
      { "type": "wait", "duration": 1500 }
    ],
    "formats": ["markdown"]
  }
}
```

Allowed action types: `wait`, `click`, `type`, `press`, `scroll`, `screenshot`,
`executeJavaScript`. `executeJavaScript` is disabled unless the deploy sets
`ALLOW_JAVASCRIPT_EXECUTION=true`. 1–20 actions per call. Screenshots are stored
as `crawlforge://screenshot/{actionId}` resources. Full action schemas:
[actions](references/actions.md). CLI:
`crawlforge actions https://example.com --script login.json --screenshot`.

## generate_llms_txt — AI policy file (cost: 5)

```json
{ "tool": "generate_llms_txt", "params": { "url": "https://example.com", "format": "both" } }
```

Generates `llms.txt` (and optionally `llms-full.txt`) describing how AI models
should interact with a site. `format`: `both`, `llms-txt`, `llms-full-txt`.
Tune `analysisOptions` (`maxDepth`, `maxPages`, `respectRobots`) and
`outputOptions` (`contactEmail`, `organizationName`, custom guidelines). CLI:
`crawlforge llmstxt https://example.com --include-full > llms.txt`.

## Sync vs async decision

- **≤ ~25 URLs, need results now** → `batch_scrape` `mode:"sync"`.
- **Large list or long-running** → `mode:"async"` + `webhook`, then
  `get_batch_results` (or read the `crawlforge://job/{jobId}` resource).

## Cost note

`batch_scrape`, `scrape_with_actions`, `generate_llms_txt` = 5 credits each;
`get_batch_results` = 1 (retrieval of an already-paid batch). Async batches are
billed once at submission — paging results afterward stays cheap.

---

# CrawlForge Change Tracking

Detect when a web page changes over time using the `track_changes` tool. Useful
for competitor pricing, regulation updates, product availability, and any page
you need to watch for edits.

## When to use

- "Track changes to this page" / "watch this URL"
- "Tell me when competitor pricing changes"
- "Detect when this content updates"
- "Diff this page against last week's version"
- "Notify me when product availability / a regulation changes"

## Core workflow

`track_changes` is one tool driven by an `operation` parameter (cost: 3 credits
per call).

1. **Create a baseline** the first time:

```json
{ "tool": "track_changes", "params": { "url": "https://example.com/pricing", "operation": "create_baseline" } }
```

2. **Compare** later to get the change percentage + diff:

```json
{ "tool": "track_changes", "params": { "url": "https://example.com/pricing", "operation": "compare" } }
```

`compare` is the default operation. It returns a change percentage and a
structured diff against the stored baseline.

## Scoping to part of a page

Use `trackingOptions` to ignore noise and focus on what matters:

```json
{
  "tool": "track_changes",
  "params": {
    "url": "https://example.com/pricing",
    "operation": "compare",
    "trackingOptions": {
      "granularity": "element",
      "customSelectors": [".price", ".plan-name"],
      "excludeSelectors": [".timestamp", ".ad"],
      "ignoreWhitespace": true
    }
  }
}
```

`granularity`: `page`, `section` (default), `element`, `text`. Toggle
`trackText`, `trackStructure`, `trackLinks`, `trackImages`. Set
`significanceThresholds` (`minor`/`moderate`/`major`) to classify change size.

CLI: `crawlforge track https://example.com --selector ".price" --threshold 1`.

## Scheduled monitoring & notifications

Run continuous monitoring with webhooks instead of polling manually:

```json
{
  "tool": "track_changes",
  "params": {
    "url": "https://example.com/pricing",
    "operation": "create_scheduled_monitor",
    "monitoringOptions": {
      "enabled": true,
      "interval": 300000,
      "notificationThreshold": "moderate",
      "enableWebhook": true,
      "webhookUrl": "https://my-site.com/notify"
    }
  }
}
```

CLI (runs until Ctrl+C):
`crawlforge monitor https://example.com --interval 60 --webhook https://my-site.com/notify`.

## Other operations

| Operation | Purpose |
|-----------|---------|
| `create_baseline` | Save the first snapshot to diff against. |
| `compare` (default) | Diff current content vs baseline → % change + diff. |
| `monitor` | One monitoring pass. |
| `get_history` | Retrieve past change records (`queryOptions`). |
| `get_stats` | Summary statistics for a tracked URL. |
| `create_scheduled_monitor` / `stop_scheduled_monitor` | Manage cron-style monitors. |
| `get_dashboard` | Aggregate status, recent alerts, trends. |
| `export_history` | Export change history as `json` or `csv`. |
| `create_alert_rule` | Conditional alerts (webhook / email / slack). |
| `generate_trend_report` | Trend analysis over time. |
| `get_monitoring_templates` | List built-in monitoring presets. |

You can also pass `content` or `html` directly to compare pre-fetched content
against the baseline without re-fetching.

## Cost note

`track_changes` = 3 credits per call. A typical watch is one `create_baseline`
plus periodic `compare` calls; scheduled monitors run server-side and notify via
webhook/Slack so you don't pay for manual polling loops.

---

# CrawlForge Deep Research

Answer questions and produce reports from many web sources using the CrawlForge
MCP server. Three tools, from lightest to heaviest: `search_web` (ranked
results), `agent` (autonomous plan-and-answer), `deep_research` (exhaustive
multi-source synthesis).

## When to use

- "Search the web for X" / "find pages about X" → `search_web`
- "Answer this question from the web" / "what are the top 5 X" (no URLs given) → `agent`
- "Research this topic in depth" / "compare competitors" / "give me a cited
  report" / "gather facts with sources" → `deep_research`

Do NOT use these for a single known URL — use the **crawlforge-web-scraping**
skill (`scrape` / `extract_content`) instead.

## Tool selection

| Need | Tool | Cost |
|------|------|------|
| A ranked list of result URLs + snippets | `search_web` | 5 |
| A direct answer, agent decides what to read | `agent` | 8 (scales) |
| A synthesized, multi-source, cited report | `deep_research` | 10+ (scales) |

A common pipeline: `search_web` to find sources → `batch_scrape` (see
**crawlforge-batch-automation**) to read them → `deep_research` to synthesize.

## search_web (cost: 5)

```json
{
  "tool": "search_web",
  "params": { "query": "best MCP servers 2025", "limit": 10, "time_range": "month" }
}
```

Returns titles, URLs, snippets. Supports `lang`, `site` (domain filter),
`file_type`, `time_range` (`day`/`week`/`month`/`year`/`all`), `expand_query`,
`enable_ranking`, and `enable_deduplication`. CLI:
`crawlforge search "MCP server tutorial" --limit 5`.

## agent — autonomous answer (cost: 8, scales with maxUrls)

No URLs required. The agent plans search queries, fetches and filters relevant
pages, then returns a prose or structured answer.

```json
{
  "tool": "agent",
  "params": { "prompt": "What are the top 5 MCP servers in 2025 and who maintains them?", "maxUrls": 10 }
}
```

- `model:"default"` runs a SamplingClient loop (no LLM keys needed).
- `model:"pro"` runs the full ResearchOrchestrator (deeper, multi-source); it
  asks for confirmation (elicitation) before running.
- Pass `schema` for structured JSON output, `urls` for optional seed URLs.
- Hard limits enforced by the orchestrator: `maxSteps` ≤ 10, `maxUrls` ≤ 20,
  120s wall-clock. Output is degraded-but-useful if no LLM keys/Ollama exist.

## deep_research — exhaustive report (cost: 10+, scales)

```json
{
  "tool": "deep_research",
  "params": {
    "topic": "React vs Vue vs Angular in 2025",
    "maxUrls": 20,
    "researchApproach": "comparative",
    "outputFormat": "comprehensive"
  }
}
```

How it works: query expansion → parallel fetch (deduped) → content extraction →
conflict detection → synthesis. `researchApproach`: `broad`, `focused`,
`academic`, `current_events`, `comparative`. `outputFormat`: `comprehensive`,
`summary`, `citations_only`, `conflicts_focus`. Results are stored as a
`crawlforge://research/{sessionId}` resource — re-read them without re-running.

CLI: `crawlforge research "B2B SaaS pricing trends" --depth deep --max-urls 30`.

### Cost control

`deep_research` starts at 10 credits and grows with sources. **`maxUrls > 50`
triggers a confirmation prompt (elicitation).** Cap cost with `maxUrls`
(e.g. `maxUrls:10` ≈ 12 credits). `timeLimit` (default 120000 ms) bounds
runtime.

## Synthesis & LLM fallback

The server ships with **no LLM key by design**. The fallback chain is:
Ollama (local) → OpenAI key → Anthropic key → MCP Sampling → raw evidence.
With no LLM configured, `deep_research` returns structured **raw evidence** for
the calling assistant (e.g. Claude Code) to synthesize — this is expected, do
not suggest adding API keys.

See [research workflows](references/workflows.md) for pipelines, depth tiers,
and parameter detail.

---

# CrawlForge: Getting Started

CrawlForge is an MCP server with **27 tools** for web scraping, crawling,
extraction, research, change tracking, and AI-compliance. This skill orients you
and routes each request to the right specialized skill.

## Setup

1. Get an API key at https://crawlforge.dev/signup (1,000 free credits).
2. Provide it to the server:

```bash
export CRAWLFORGE_API_KEY="your_api_key_here"
# or, for the CLI, run: crawlforge init   (detects key, installs skills, merges MCP config)
```

Every tool is metered and requires a key — there is no free tier. User config is
stored at `~/.crawlforge/config.json`.

## Route to the right skill

| The user wants to... | Use skill |
|----------------------|-----------|
| Scrape a page, get markdown/text/links/metadata, map or crawl a site | **crawlforge-web-scraping** |
| Research a topic, search the web, get a cited report, autonomous Q&A | **crawlforge-deep-research** |
| Get past 403/CAPTCHA/Cloudflare, or emulate a region/locale | **crawlforge-stealth-browsing** |
| Extract JSON/fields, parse a PDF, summarize, analyze sentiment | **crawlforge-structured-extraction** |
| Watch a page for changes / monitor pricing | **crawlforge-change-tracking** |
| Scrape many URLs, run browser actions, generate llms.txt | **crawlforge-batch-automation** |

## The 27 tools at a glance

- **Basic (5):** fetch_url, extract_text, extract_links, extract_metadata, scrape_structured
- **Unified (1):** scrape (multi-format single fetch)
- **Search & research (4):** search_web, serp_rank, deep_research, agent
- **Crawl (2):** crawl_deep, map_site
- **Extract & analyze (7):** extract_content, process_document, summarize_content, analyze_content, extract_structured, extract_with_llm, list_ollama_models
- **Batch & automation (4):** batch_scrape, get_batch_results, scrape_with_actions, generate_llms_txt
- **Stealth & locale (2):** stealth_mode, localization
- **Templates & tracking (2):** scrape_template, track_changes

## MCP tools vs CLI

- **MCP tools** — call inline within an AI assistant session (Claude Code,
  Cursor, etc.). This is the default in chat.
- **CLI** (`crawlforge <command>`) — for scripts, CI, and pipelines. 15 tool
  commands + 2 skill commands. See [cli](references/cli.md).

Both hit the same backend and consume the same credits.

## LLM fallback chain (Ollama-first)

LLM-backed tools (`extract_with_llm`, `extract_structured`, abstractive
`summarize_content`, `deep_research`, `agent`) resolve a provider in this order:

```
Ollama (local, default, no key) → OpenAI key → Anthropic key → MCP Sampling → raw evidence
```

The server ships with **no cloud LLM key by design**. With none configured,
research tools return raw evidence for the calling assistant to synthesize.
Do not suggest adding API keys — local Ollama is the intended zero-cost default.

## When a tool fails — fallbacks

| Symptom | Try next |
|---------|----------|
| `scrape` / `fetch_url` returns 403, 429, CAPTCHA, or empty JS shell | `stealth_mode` (crawlforge-stealth-browsing) |
| No template for a known site | `scrape_structured` → `extract_structured` → `extract_with_llm` |
| LLM extraction unavailable (no Ollama/keys) | `scrape_structured` with CSS selectors |
| Single page too slow / many pages | `batch_scrape` (async + webhook) |
| Wrong region / currency shown | `localization` |
| Need a big report but cost is high | lower `maxUrls` on `deep_research` |

## Credits

Costs range from 1 credit (fetch_url, extract_text, scrape_template,
get_batch_results...) up to 10+ for `deep_research`. Full table:
[credits](references/credits.md). Prefer the cheapest tool that does the job, and
cap dynamic tools (`deep_research`, `agent`, `crawl_deep`) with their max
parameters.

---

# CrawlForge Stealth Browsing

Get past bot-detection systems and geo-blocks. Use `stealth_mode` when a normal
scrape is blocked, and `localization` when you need region-specific content,
pricing, or locale emulation.

## When to escalate to stealth_mode

Escalate from a normal `scrape` / `fetch_url` (see crawlforge-web-scraping) when:

- The site returns **403 or 429** on a regular fetch.
- You get a **CAPTCHA** or a "please enable JavaScript" interstitial.
- Content comes back **empty** or only a shell (JS-rendered SPA).
- The site uses **Cloudflare, DataDome, PerimeterX**, or similar protection.

`stealth_mode` drives a real browser with randomized fingerprints, human
behavior simulation, and WebRTC/canvas/WebGL spoofing.

## stealth_mode (cost: 5)

`stealth_mode` is operation-based. Typical flow: create a context, then create a
page that navigates to the target URL.

```json
{
  "tool": "stealth_mode",
  "params": {
    "operation": "create_context",
    "stealthConfig": { "level": "advanced", "simulateHumanBehavior": true },
    "engine": "playwright"
  }
}
```

Then use the returned `contextId`:

```json
{
  "tool": "stealth_mode",
  "params": { "operation": "create_page", "contextId": "<id-from-create_context>", "urlToTest": "https://protected-site.com" }
}
```

Operations: `configure`, `enable`, `disable`, `create_context`, `create_page`,
`get_stats`, `cleanup`. `stealthConfig.level` is `basic` / `medium` (default) /
`advanced`. Always run `cleanup` when done to release the browser.

### Engine: playwright vs camoufox

- `engine:"playwright"` (default) — Chromium with stealth patches. Fast, good
  for most basic bot detection.
- `engine:"camoufox"` — Firefox-based with native anti-detection (no patches).
  Scores higher against DataDome / Cloudflare / PerimeterX and on CreepJS. Use
  for heavily protected, financial, or e-commerce sites.

Full decision table: [engine selection](references/engine-selection.md).

### CLI

```bash
crawlforge stealth https://protected-site.com
crawlforge stealth https://protected-site.com --engine camoufox --wait 3000 --screenshot
```

The CLI exposes a one-shot form (`--engine`, `--wait <ms>`, `--screenshot`).
Force the engine globally with `export CRAWLFORGE_STEALTH_ENGINE=camoufox`.

## localization (cost: 2)

Emulate a country/language/timezone/currency for region-specific content and
geo-blocked pages.

```json
{
  "tool": "localization",
  "params": { "operation": "configure_country", "countryCode": "DE", "language": "de", "currency": "EUR" }
}
```

Operations: `configure_country`, `localize_search`, `localize_browser`,
`generate_timezone_spoof`, `handle_geo_blocking`, `auto_detect`, `get_stats`,
`get_supported_countries`. `countryCode` is ISO 3166-1 alpha-2; `currency` is
ISO 4217. Supports proxy routing and GPS geolocation emulation.

CLI: `crawlforge localize https://shop.example.com --locale en-GB --country GB --currency GBP`.

## stealth_mode vs localization

- **Blocked / bot-detected** → `stealth_mode`.
- **Wrong region / language / currency, but not blocked** → `localization`.
- **Geo-blocked AND bot-protected** → `localization` to set region context, then
  `stealth_mode` for the actual fetch.

## Cost note

`stealth_mode` = 5 credits per call (screenshots add a small extra cost);
`localization` = 2 credits. Try the cheaper `scrape` (2 credits) first and only
escalate to stealth when you see the block signals above.

---

# CrawlForge Structured Extraction & Analysis

Turn pages and documents into structured data, and run NLP analysis. Pick the
extraction method by how predictable the page is and whether an LLM is needed.

## Tool selection

| You have / want | Tool | Cost |
|-----------------|------|------|
| A well-known site (Amazon, GitHub, LinkedIn...) | `scrape_template` | 1 |
| Exact CSS selectors for the fields | `scrape_structured` | 2 |
| A JSON schema to fill (LLM, CSS fallback) | `extract_structured` | 3 |
| A natural-language extraction instruction | `extract_with_llm` | 3 |
| A PDF / DOCX / TXT to parse | `process_document` | 2 |
| A summary of long text | `summarize_content` | 4 |
| Sentiment / entities / keywords / readability | `analyze_content` | 3 |
| To list local LLMs available for extraction | `list_ollama_models` | 1 |

Cheapest-first rule: try `scrape_template` → `scrape_structured` (deterministic)
before reaching for the LLM tools.

## scrape_template — known sites, zero selectors (cost: 1)

```json
{ "tool": "scrape_template", "params": { "template": "github-repo", "url": "https://github.com/user/repo" } }
```

Pass `template:"list"` to enumerate templates. Supports `amazon-product`,
`linkedin-profile`, `github-repo`, `youtube-video`, `tweet`, `reddit-thread`,
`hacker-news-front-page`, `producthunt-launch`, `stackoverflow-question`,
`npm-package`. Full field lists: [templates](references/templates.md).
CLI: `crawlforge template github-repo https://github.com/owner/repo`.

## scrape_structured — CSS selectors (cost: 2)

```json
{
  "tool": "scrape_structured",
  "params": { "url": "https://shop.com/products", "selectors": { "price": ".price", "name": ".product-title", "link": "a.product@href" } }
}
```

Most reliable for consistent markup. Append `@attr` to a selector to read an
attribute (e.g. `a.link@href`, `img@src`). `max_results` caps matches per field.

## extract_structured — schema-driven (cost: 3)

```json
{
  "tool": "extract_structured",
  "params": {
    "url": "https://jobs.example.com/post/123",
    "schema": { "properties": { "title": { "type": "string" }, "salary": { "type": "string" } }, "required": ["title"] }
  }
}
```

Uses an LLM by default and falls back to CSS selectors when no LLM is
configured (`fallbackToSelectors:true`). Provide `selectorHints` to guide the
fallback. A schema with >3 required fields and no LLM configured triggers a
confirmation prompt. CLI: `crawlforge extract <url> --schema schema.json`.

## extract_with_llm — natural-language prompt (cost: 3)

```json
{
  "tool": "extract_with_llm",
  "params": { "url": "https://example.com/article", "prompt": "extract title, author, date, and a one-line summary", "provider": "ollama" }
}
```

Defaults to a **local Ollama** model (`http://localhost:11434`, no API key).
Run `list_ollama_models` first to see installed models, then pass one via
`model` (e.g. `"llama3.2"`). Use `provider:"openai"` or `"anthropic"` with the
matching key for a cloud model. CLI: `crawlforge extract <url> --prompt "..." --model llama3.2`.

## process_document — PDF / DOCX / TXT (cost: 2)

```json
{ "tool": "process_document", "params": { "source": "https://example.com/report.pdf", "sourceType": "pdf_url" } }
```

`sourceType`: `url`, `pdf_url`, `file`, `pdf_file`. Returns structured sections,
metadata, and word count. `options` passes through `maxPages`,
`pageRange:{start,end}`, `password`, `outputFormat`, etc.

## summarize_content & analyze_content

```json
{ "tool": "summarize_content", "params": { "text": "..long article..", "options": { "summaryLength": "short", "summaryType": "abstractive" } } }
```

```json
{ "tool": "analyze_content", "params": { "text": "..article text..", "options": { "extractTopics": true, "includeSentiment": true } } }
```

`summarize_content` (cost 4) does extractive or abstractive summaries.
`analyze_content` (cost 3) returns language, sentiment, entities, topics,
keyword density, and readability. Both take raw `text` — feed them output from
`extract_content` / `extract_text`.

## LLM fallback chain

For LLM-backed extraction (extract_structured, extract_with_llm, abstractive
summarize): **Ollama (local, default) → OpenAI key → Anthropic key → MCP
Sampling**. No cloud key is required; local Ollama is the zero-cost default.

## Cost note

`scrape_template` & `list_ollama_models` = 1 · `scrape_structured`,
`process_document` = 2 · `extract_structured`, `extract_with_llm`,
`analyze_content` = 3 · `summarize_content` = 4. Cloud LLM usage is billed
separately by your provider, on top of credits.

---

# CrawlForge Web Scraping

Fetch and clean web content with the CrawlForge MCP server. This skill covers
single-page scraping (one URL → Markdown / HTML / text / links / metadata),
site discovery (sitemaps and URL maps), and whole-site crawling.

## When to use

- "Scrape this URL" / "get the markdown of this page" / "read this article" → `scrape`
- "Just give me the raw HTML / JSON / headers" → `fetch_url`
- "Give me the clean article text, no nav or ads" → `extract_content`
- "Get the plain text / markdown body" → `extract_text`
- "List every link on this page" → `extract_links`
- "Get the title / meta / Open Graph / SEO tags" → `extract_metadata`
- "Map all the URLs on this site" / "generate a sitemap" → `map_site`
- "Crawl the whole docs site" / "index every page" → `crawl_deep`

## Tool selection (fastest path first)

1. **`scrape`** is the default for single pages. One fetch returns many formats
   at once — no N-request fan-out. Ask for exactly the formats you need.
2. Use the **single-purpose basic tools** (`fetch_url`, `extract_text`,
   `extract_links`, `extract_metadata`) when you only want one cheap thing.
3. **`extract_content`** when you specifically want Readability-cleaned article
   body (strips ads, nav, footers) — better than `extract_text` for articles.
4. **`map_site`** before a crawl to estimate scope / find section URLs.
5. **`crawl_deep`** to walk an entire site and (optionally) extract content.

If a page returns 403/429, a CAPTCHA, or empty "enable JavaScript" content,
switch to the **crawlforge-stealth-browsing** skill (`stealth_mode`).

## scrape — unified multi-format (cost: 2)

Get markdown + links + metadata in a single call:

```json
{
  "tool": "scrape",
  "params": {
    "url": "https://example.com/article",
    "formats": ["markdown", "links", "metadata"],
    "onlyMainContent": true
  }
}
```

`formats` accepts: `"markdown"`, `"html"`, `"rawHtml"`, `"text"`, `"links"`,
`"metadata"`, `"screenshot"`, or an object `{ "type": "json", "schema": {...},
"prompt": "..." }` for LLM-structured extraction. Partial success is supported:
a failing format adds a `warnings[]` entry instead of failing the whole call.
`onlyMainContent` (default `true`) strips boilerplate via Readability.

CLI equivalent:

```bash
crawlforge scrape https://example.com/article --extract --format markdown
```

## fetch_url — raw HTTP (cost: 1)

```json
{ "tool": "fetch_url", "params": { "url": "https://example.com", "timeout": 15000 } }
```

Returns headers + body. Good for JSON/XML APIs or as a first step before
`extract_text` / `extract_content`. Supports `headers` (e.g. auth tokens).

## extract_content vs extract_text

```json
{ "tool": "extract_content", "params": { "url": "https://blog.example.com/post" } }
```

```json
{ "tool": "extract_text", "params": { "url": "https://example.com/article", "output_format": "markdown" } }
```

`extract_content` (cost 2) = Readability-cleaned article body, best for RAG.
`extract_text` (cost 1) = faster, strips tags; pass `output_format:"markdown"`
for RAG-friendly output.

## extract_links / extract_metadata (cost: 1 each)

```json
{ "tool": "extract_links", "params": { "url": "https://example.com", "filter_external": true } }
```

```json
{ "tool": "extract_metadata", "params": { "url": "https://example.com" } }
```

## map_site — discover URLs (cost: 2)

```json
{
  "tool": "map_site",
  "params": { "url": "https://example.com", "include_sitemap": true, "max_urls": 500 }
}
```

Reads `sitemap.xml` when available. Pass `search:"pricing"` to rank discovered
URLs by relevance and get a `ranked_urls:[{url,score}]` array (default output
is unchanged when `search` is omitted).

CLI: `crawlforge map https://example.com --pretty` (add `--format xml` for a sitemap file).

## crawl_deep — walk a whole site (cost: 4, scales with pages)

```json
{
  "tool": "crawl_deep",
  "params": {
    "url": "https://docs.example.com",
    "max_depth": 3,
    "max_pages": 200,
    "extract_content": true
  }
}
```

BFS crawl up to depth 5 / 1000 pages. Use `include_patterns` /
`exclude_patterns` (regex) to scope, `respect_robots` to honor robots.txt
(on by default). Crawls projected over ~500 pages trigger a confirmation
prompt (elicitation). CLI: `crawlforge crawl https://docs.example.com --depth 3 --max-pages 200`.

## Cost note

Cheapest first: `fetch_url`, `extract_text`, `extract_links`,
`extract_metadata` = 1 credit · `scrape`, `extract_content`, `map_site` =
2 · `crawl_deep` = 4 (grows with `max_pages`). Prefer one `scrape` call over
several single-format calls when you need multiple formats.

See [tool reference](references/tool-reference.md) for the full parameter list.

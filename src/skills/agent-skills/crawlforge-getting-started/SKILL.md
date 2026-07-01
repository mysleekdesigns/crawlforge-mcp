---
name: crawlforge-getting-started
description: "Orientation and tool-selection guide for the CrawlForge MCP server's 27 web tools. Use when the user is getting started with CrawlForge, asks which CrawlForge tool to use, how to set up the API key, how skills or the CLI work, what a tool costs in credits, or when one tool fails and a fallback is needed. Routes requests to the right specialized skill (web scraping, deep research, stealth, structured extraction, change tracking, batch automation), and explains MCP-tools-vs-CLI, the Ollama-first LLM fallback chain, and per-tool credit costs."
metadata:
  version: 4.8.0
  source: crawlforge-mcp-server
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

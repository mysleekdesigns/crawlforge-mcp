# CrawlForge Credit Costs

Per-tool credit cost (source of truth: `AuthManager.getToolCost`). Every tool is
metered; there is no free tier. Tools marked "scales" cost more as work grows.

## 1 credit

| Tool | Notes |
|------|-------|
| `fetch_url` | Raw HTTP fetch. |
| `extract_text` | Tag-stripped text/markdown. |
| `extract_links` | All links on a page. |
| `extract_metadata` | Title / meta / OG / schema.org. |
| `scrape_template` | Pre-built site extractor. |
| `list_ollama_models` | List local LLMs. |
| `get_batch_results` | Retrieve an already-paid batch. |

## 2 credits

| Tool | Notes |
|------|-------|
| `scrape` | Unified multi-format single fetch. |
| `scrape_structured` | CSS-selector extraction. |
| `extract_content` | Readability-cleaned article. |
| `map_site` | URL discovery / sitemap. |
| `process_document` | PDF / DOCX / TXT parsing. |
| `localization` | Locale / geo emulation. |

## 3 credits

| Tool | Notes |
|------|-------|
| `track_changes` | Baseline / compare / monitor. |
| `analyze_content` | Sentiment / entities / keywords. |
| `extract_structured` | Schema-driven (LLM + CSS fallback). |
| `extract_with_llm` | NL-prompt extraction. |

## 4 credits

| Tool | Notes |
|------|-------|
| `summarize_content` | Extractive / abstractive summary. |
| `crawl_deep` | Site crawl; **scales** with page count. |

## 5 credits

| Tool | Notes |
|------|-------|
| `stealth_mode` | Anti-bot browser (screenshots add a little). |
| `scrape_with_actions` | Browser automation then scrape. |
| `batch_scrape` | Many URLs; projection scales with URL count. |
| `search_web` | Web search. |
| `generate_llms_txt` | AI-compliance file. |

## 8 credits

| Tool | Notes |
|------|-------|
| `agent` | Autonomous research; **scales** with `maxUrls` (and `model:"pro"`). |

## 10+ credits

| Tool | Notes |
|------|-------|
| `deep_research` | Base 10; **scales** with `maxUrls`. **>50 URLs prompts for confirmation.** |

## Cost-control tips

- Use the cheapest tool that satisfies the request (e.g. `extract_metadata` at 1
  before `scrape` at 2).
- Prefer one `scrape` call (2) over several single-format basic calls.
- Cap dynamic tools: `deep_research`/`agent` via `maxUrls`, `crawl_deep` via
  `max_pages`, `batch_scrape` via the URL list size.
- `get_batch_results` (1) is cheap — submit a batch once, page through results.
- Errors are charged at half the tool cost; creator mode is unlimited.

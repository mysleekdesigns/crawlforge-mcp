# CrawlForge Credit Optimization

Costs below are read from `AuthManager.getToolCost` (`src/core/AuthManager.js`), the
biller; `tests/unit/toolSelectionSurface.test.js` pins the same numbers into every tool
description. Errors bill half; creator mode and internal-proxy calls bill nothing.

## Tool Selection Ladder

Pick one tool per step. A page whose content is already in the conversation is never
fetched again.

- Read one page whose URL you have -> `scrape` (2), asking for every format you need in
  that call (markdown, links, metadata, html, screenshot, json). `fetch_url` (1) is for a
  raw JSON/XML/API body, not for HTML you will read; `fetch_url` + `extract_*` on the same
  URL is a double fetch.
- Find pages for a query -> `search_web` (5); snippets often answer without a scrape.
  Reddit -> `reddit_search` (5). Google organic position -> `serp_rank` (5).
- 2-50 known URLs -> one `batch_scrape` (5), never a loop of `scrape` calls;
  `get_batch_results` (1) reads an async job.
- A site's URL list -> `map_site` (2); many pages of one site -> `crawl_deep` (4 base).
- Blocked (403/429/CAPTCHA/challenge page/empty shell) -> `stealth_mode` operation
  `scrape` (5); content behind a click, login or scroll -> `scrape_with_actions` (5).
  Neither is a first attempt.
- Known CSS selectors -> `scrape_structured` (2); fields you can describe but not select ->
  `extract_structured` (3); exact values from a framework payload ->
  `extract_embedded_state` (2) with a path.
- Multi-source report -> `deep_research` (10 base); open question with no URLs ->
  `agent` (8). Both grow with `maxUrls`; cap it.

## Credit Costs Reference

| Tool | Credits | Use |
|------|---------|-----|
| extract_links | 1 | Links on one page |
| extract_metadata | 1 | Title / meta / OG / schema.org |
| extract_text | 1 | Tag-stripped text of a static page |
| fetch_url | 1 | Raw HTTP body (JSON/XML/API); not for HTML you will read |
| get_batch_results | 1 | Read an already-paid batch job |
| list_ollama_models | 1 | Local Ollama models (only if a model name is rejected) |
| scrape_template | 1 | Known sites and platform APIs, no selectors |
| extract_content | 2 | Readability-cleaned article |
| extract_embedded_state | 2 | Exact values from __NEXT_DATA__ / RSC / Nuxt / Redux payloads |
| localization | 2 | Country / locale context |
| map_site | 2 | A site's URL list |
| process_document | 2 | PDF text and sections |
| scrape | 2 | One page, every format in one call - the default page tool |
| scrape_structured | 2 | Known CSS selectors |
| analyze_content | 3 | NLP metrics on text you hold |
| extract_structured | 3 | JSON schema via LLM (CSS fallback) |
| extract_with_llm | 3 | Natural-language extraction via local Ollama |
| track_changes | 3 | Baseline then compare |
| crawl_deep | 4 | Follow links and fetch many pages (grows with page count) |
| summarize_content | 4 | Condense text you hold |
| batch_scrape | 5 | 2-50 known URLs in one call |
| generate_llms_txt | 5 | Write a site's llms.txt |
| reddit_search | 5 | Reddit posts, comments, threads |
| scrape_with_actions | 5 | Click / login / scroll, then scrape |
| search_web | 5 | Find pages; snippets often answer without a scrape |
| serp_rank | 5 | Real Google organic position (needs DataForSEO) |
| stealth_mode | 5 | After a 403/429/CAPTCHA/challenge page - never first |
| agent | 8 | Open question, no URLs (grows with maxUrls) |
| deep_research | 10 | Multi-source report (grows with maxUrls) |

## Budget Management

- Estimate the credits of a plan before running it: count calls x cost from the table.
- Batch instead of looping; cap `maxUrls`, `max_pages` and batch sizes.
- Error results end with a "Next step:" line naming the tool to try; follow it rather
  than retrying the same call.

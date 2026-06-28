---
name: crawlforge-batch-automation
description: "Automates large scraping jobs and browser interactions with CrawlForge's batch_scrape, get_batch_results, scrape_with_actions, and generate_llms_txt tools. Use when the user wants to scrape many URLs at once, batch-scrape a list of pages, collect dozens of product, news, or competitor pages, run browser actions (click, type, scroll, wait) before scraping, log in or fill a form before extracting, or generate an llms.txt for a site. Use sync mode for up to about 25 URLs and async with a webhook for large batches; retrieve paginated output with get_batch_results."
metadata:
  version: 4.8.0
  source: crawlforge-mcp-server
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

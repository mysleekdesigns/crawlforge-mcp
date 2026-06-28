# Web Scraping & Crawl Tools — Parameter Reference

Authoritative parameters for the scraping/discovery/crawl tools. Costs are in
CrawlForge credits.

## scrape (cost: 2)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `url` | string (URL) | — | Required. |
| `formats` | array | `["markdown"]` | Any of `markdown`, `html`, `rawHtml`, `text`, `links`, `metadata`, `screenshot`, or `{type:"json", schema?, prompt?}`. |
| `onlyMainContent` | boolean | `true` | Strip boilerplate via Readability. |
| `timeoutMs` | number | `15000` | 1000–60000. |

Partial success: a format that fails produces a `warnings[]` entry rather than
failing the whole call. `{type:"json"}` may incur external LLM cost (billed by
your provider).

## fetch_url (cost: 1)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `url` | string (URL) | — | Required. |
| `headers` | object | — | Custom HTTP headers (e.g. auth tokens). |
| `timeout` | number | `10000` | 1000–30000 ms. |

## extract_text (cost: 1)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `url` | string (URL) | — | Required. |
| `remove_scripts` | boolean | `true` | Strip `script` tags. |
| `remove_styles` | boolean | `true` | Strip `style` tags. |
| `output_format` | enum | `text` | `text` or `markdown` (use markdown for RAG). |

## extract_links (cost: 1)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `url` | string (URL) | — | Required. |
| `filter_external` | boolean | `false` | Only return outbound links. |
| `base_url` | string (URL) | — | Resolve relative links against this. |

## extract_metadata (cost: 1)

| Param | Type | Notes |
|-------|------|-------|
| `url` | string (URL) | Required. Returns title, description, OG tags, canonical, schema.org. |

## extract_content (cost: 2)

| Param | Type | Notes |
|-------|------|-------|
| `url` | string (URL) | Required. Readability-cleaned article body (markdown). |
| `options` | object | Additional extraction options. |

## map_site (cost: 2)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `url` | string (URL) | — | Required. |
| `include_sitemap` | boolean | — | Include `sitemap.xml` data. |
| `max_urls` | number | — | 1–10000. |
| `group_by_path` | boolean | — | Group URLs by path segment. |
| `include_metadata` | boolean | — | Per-URL metadata. |
| `domain_filter` | object | — | `whitelist`, `blacklist`, `include_patterns`, `exclude_patterns`. |
| `search` | string | — | Rank URLs by relevance; emits `ranked_urls:[{url,score}]`. |

## crawl_deep (cost: 4, scales with max_pages)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `url` | string (URL) | — | Required start URL. |
| `max_depth` | number | — | 1–5. |
| `max_pages` | number | — | 1–1000. |
| `include_patterns` | string[] | — | Regex URL allow-list. |
| `exclude_patterns` | string[] | — | Regex URL deny-list. |
| `follow_external` | boolean | — | Follow off-domain links. |
| `respect_robots` | boolean | `true`* | Honor robots.txt. |
| `extract_content` | boolean | — | Extract page content during crawl. |
| `content_max_length` | number | `500` | Max chars per page; sets a `truncated` flag. |
| `concurrency` | number | — | 1–20 concurrent requests. |
| `enable_link_analysis` | boolean | — | Compute PageRank over crawled pages. |
| `session` | object | — | Shared cookie jar for login-then-crawl. |

*Server default honors `RESPECT_ROBOTS_TXT`. Crawls projected over ~500 pages
trigger an elicitation confirmation.

## CLI quick map

| Tool | CLI |
|------|-----|
| `scrape` / `fetch_url` | `crawlforge scrape <url> [--extract --format markdown]` |
| `map_site` | `crawlforge map <url> [--format xml]` |
| `crawl_deep` | `crawlforge crawl <url> --depth 3 --max-pages 200` |

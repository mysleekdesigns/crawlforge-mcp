# Web Scraping & Crawl Tools — Parameter Reference

Authoritative parameters for the scraping/discovery/crawl tools. Costs are in
CrawlForge credits.

## scrape (cost: 2)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `url` | string (URL) | — | Required. |
| `formats` | array | `["markdown"]` | Any of `markdown`, `html`, `rawHtml`, `text`, `links`, `metadata`, `branding`, `screenshot`, `{type:"json", schema?, prompt?}`, `{type:"highlights", query, max_highlights?, mode?}` (the matching sentences, table rows and code blocks, verbatim, with offsets into the markdown; +1 credit once per call) or `{type:"question", question, mode?}` (an answer assembled from the evidence units; same +1). `mode:"model"` adds 3 credits and needs an LLM route. |
| `onlyMainContent` | boolean | `true` | Strip boilerplate via Readability. |
| `timeoutMs` | number | `15000` | 1000–60000. |
| `max_inline_chars` | number | `40000` | 1,000–10,000,000. A larger result returns `preview` + `result_handle` for `read_result` (below). |

Partial success: a format that fails produces a `warnings[]` entry rather than
failing the whole call. `{type:"json"}` may incur external LLM cost (billed by
your provider).

## fetch_url (cost: 1)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `url` | string (URL) | — | Required. |
| `headers` | object | — | Custom HTTP headers (e.g. auth tokens). |
| `timeout` | number | `10000` | 1000–30000 ms. |
| `max_inline_chars` | number | `40000` | 1,000–10,000,000. A larger result returns `preview` + `result_handle` for `read_result` (below). |

## extract_text (cost: 1)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `url` | string (URL) | — | Required. |
| `remove_scripts` | boolean | `true` | Strip `script` tags. |
| `remove_styles` | boolean | `true` | Strip `style` tags. |
| `output_format` | enum | `text` | `text` or `markdown` (use markdown for RAG). |
| `selector` | string | — | CSS selector: read only the matched elements (nav/header/footer inside them are kept). No match is an error: `No elements found for selector: <sel>`. |
| `max_length` | integer | — | 1–1,000,000. Text or markdown longer than this is cut and ends with `...`; `word_count`/`char_count` count the cut result. |
| `escalate` | boolean | `false` | When the plain fetch is blocked (403/429/444/challenge page/empty shell), re-read the page once in the stealth browser (impit first under `auto`). A 404 or 5xx never escalates. Projected 6, charged 1 when the plain fetch worked. |
| `escalate_engine` | enum | `auto` | `auto`, `playwright` (Chromium) or `camoufox`. |

Text mode returns one line per block element (`<h1>Hi</h1><p>there</p>` reads `Hi\nthere`). The REST route (`/api/v1/tools/extract_text`) takes the same parameters plus `preserve_links` and `preserve_formatting`, which the MCP tool does not.

A PDF or other binary body fails with `UNSUPPORTED_CONTENT_TYPE` (use `process_document`). An empty client-rendered shell succeeds with `rendered:false` and the warning `page renders client-side; use scrape`.

## extract_links (cost: 1)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `url` | string (URL) | — | Required. |
| `filter_external` | boolean | `false` | Drop internal (same-host) links; external and `other` links stay. |
| `base_url` | string (URL) | — | Resolve relative links against this. Without it, the page's `<base href>`, else the page URL. |
| `escalate` | boolean | `false` | When the plain fetch is blocked (403/429/444/challenge page/empty shell), re-read the page once in the stealth browser (impit first under `auto`). A 404 or 5xx never escalates. Projected 6, charged 1 when the plain fetch worked. |
| `escalate_engine` | enum | `auto` | `auto`, `playwright` (Chromium) or `camoufox`. |
| `max_inline_chars` | number | `40000` | 1,000–10,000,000. A larger result returns `preview` + `result_handle` for `read_result` (below). |

Each link is `{ href, text, type, domain, rel, original_href }` (plus `title` when the link has one). `type` is `internal` (same host as the page), `external` or `other` (`mailto:`, `tel:`, `javascript:` and other non-web schemes; only `mailto:`/`tel:` keep an `href`, the rest are `null`). `#fragment`-only links are skipped, and links are deduplicated on the URL without its fragment or trailing slash. Counts: `total_count`, `internal_count`, `external_count`, `other_count`. The REST route returns the same records.

A PDF or other binary body fails with `UNSUPPORTED_CONTENT_TYPE` (use `process_document`). An empty client-rendered shell succeeds with `rendered:false` and the warning `page renders client-side; use scrape`.

## extract_metadata (cost: 1)

| Param | Type | Notes |
|-------|------|-------|
| `url` | string (URL) | Required. Returns title, description, OG tags, canonical, schema.org. |
| `max_inline_chars` | number | Default 40000 (1,000–10,000,000). A larger result returns `preview` + `result_handle` for `read_result` (below). |

## extract_content (cost: 2)

| Param | Type | Notes |
|-------|------|-------|
| `url` | string (URL) | Required. Readability-cleaned article body (markdown). |
| `options` | object | Additional extraction options. |
| `max_inline_chars` | number | Default 40000 (1,000–10,000,000). A larger result returns `preview` + `result_handle` for `read_result` (below). |

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
| `max_inline_chars` | number | `40000` | 1,000–10,000,000. A larger result returns `preview` + `result_handle` for `read_result` (below). |

`urls` is the one list of URLs; `site_map` gives the site's shape as counts (`root`, `sections.<segment>.count` and `.subsections`, `depth_levels`).

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
| `max_inline_chars` | number | `40000` | 1,000–10,000,000. A larger result returns `preview` + `result_handle` for `read_result` (below). |

*Server default honors `RESPECT_ROBOTS_TXT`. Crawls projected over ~500 pages
trigger an elicitation confirmation.

## read_result (cost: 1)

Reads a result a tool returned with `truncated: true` and a `result_handle`
(kept 1 hour, on the local machine; a handle that is gone is an error that says why — expired, evicted, unreadable, or unknown to this server process).

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `handle` | string | — | Required. The `result_handle` (`res_…`). |
| `operation` | enum | — | Required. `slice`, `search`, `lines` or `json_path`. |
| `offset` | number | — | `slice`: character offset; `lines`: first line (default 0). |
| `length` | number | — | `slice`: characters (default 10,000); `lines`: lines (default 200, at most 5,000). |
| `query` | string | — | `search`: case-insensitive literal substring. |
| `max_matches` | number | `20` | `search`: 1–100. |
| `path` | string | — | `json_path`: path into the stored result object (or the parsed body when the stored text is JSON, e.g. a `fetch_url` body). |
| `max_inline_chars` | number | `40000` | 1,000–10,000,000. |

Every response carries `handle`, `tool`, `operation`, `view` (`text` or `json`),
`view_path`, `total_chars` and `expires_at`. `slice` returns `text` + `has_more`;
`search` returns `matches[{offset, length, context_offset, context}]` (200
characters of context each side) + `total_matches`; `lines` returns `lines[]`
+ `total_lines`, `char_offset`, `has_more`; `json_path` returns `value`.

## CLI quick map

| Tool | CLI |
|------|-----|
| `scrape` / `fetch_url` | `crawlforge scrape <url> [--extract --format markdown]` |
| `map_site` | `crawlforge map <url> [--format xml]` |
| `crawl_deep` | `crawlforge crawl <url> --depth 3 --max-pages 200` |

---
name: crawlforge-web-scraping
description: "Scrapes web pages and returns clean Markdown, HTML, plain text, links, or metadata using CrawlForge's scrape, fetch_url, extract_content, extract_text, extract_links, extract_metadata, map_site, and crawl_deep tools. Use when the user wants to scrape a URL, fetch a page, get the markdown or text of a website, extract links or metadata, read an article, map a site's URLs, generate a sitemap, or crawl a whole website or documentation site. Prefer the unified scrape tool to get multiple formats in one call; use map_site to discover URLs and crawl_deep to walk an entire site."
metadata:
  version: 4.8.0
  source: crawlforge-mcp-server
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

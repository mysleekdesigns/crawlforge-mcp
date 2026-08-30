---
name: crawlforge-structured-extraction
description: "Extracts structured JSON and analyzes content with CrawlForge's extract_structured, extract_with_llm, extract_embedded_state, scrape_structured, scrape_template, process_document, analyze_content, summarize_content, and list_ollama_models tools. Use when the user wants to extract specific fields, pull data into a JSON schema, extract by natural-language prompt, scrape with CSS selectors, read a page's embedded JavaScript state (__NEXT_DATA__, React Server Components, Nuxt, Apollo, Redux), get product, profile, or repo data from known sites (Amazon, LinkedIn, GitHub, YouTube, Reddit, and more), parse a PDF or DOCX, summarize a page, or analyze sentiment, entities, or keywords. Defaults to local Ollama for LLM extraction; OpenAI and Anthropic optional."
metadata:
  version: 4.8.0
  source: crawlforge-mcp-server
---

# CrawlForge Structured Extraction & Analysis

Turn pages and documents into structured data, and run NLP analysis. Pick the
extraction method by how predictable the page is and whether an LLM is needed.

## Tool selection

| You have / want | Tool | Cost |
|-----------------|------|------|
| A well-known site (Amazon, GitHub, LinkedIn...) | `scrape_template` | 1 |
| Exact CSS selectors for the fields | `scrape_structured` | 2 |
| The data is in the page's JS state, not its HTML | `extract_embedded_state` | 2 |
| A JSON schema to fill (LLM, CSS fallback) | `extract_structured` | 3 |
| A natural-language extraction instruction | `extract_with_llm` | 3 |
| A PDF / DOCX / TXT to parse | `process_document` | 2 |
| A summary of long text | `summarize_content` | 4 |
| Sentiment / entities / keywords / readability | `analyze_content` | 3 |
| To list local LLMs available for extraction | `list_ollama_models` | 1 |

Cheapest-first rule: try `scrape_template` → `scrape_structured` /
`extract_embedded_state` (all deterministic) before reaching for the LLM tools.
On a React/Next/Nuxt page the values are usually sitting in the embedded state
already, exact and typed — that beats asking a model to read them off the render.

## extract_embedded_state — the page's own JS state (cost: 2)

```json
{ "tool": "extract_embedded_state", "params": { "url": "https://www.ticketmaster.com/discover/concerts", "path": "next_data.props.pageProps" } }
```

Finds `__NEXT_DATA__`, `self.__next_f` (React Server Component payloads),
`window.__NUXT__`, `__APOLLO_STATE__`, `__INITIAL_STATE__`, `__PRELOADED_STATE__`
and `<script type="application/json">` blocks, keyed by source name. No LLM in
the path, so values are exact rather than inferred.

These payloads are routinely over a megabyte — pass `path` (dotted keys and
array indexes, e.g. `next_data.props.pageProps` or `next_f[0].f`) to return one
subtree. Without it, a large result comes back with a warning naming the biggest
source and a ready-to-paste path.

## scrape_template — known sites, zero selectors (cost: 1)

```json
{ "tool": "scrape_template", "params": { "template": "github-repo", "url": "https://github.com/user/repo" } }
```

Pass `template:"list"` to enumerate templates. Supports `shopify-product`,
`amazon-product`, `github-repo`, `youtube-video`, `reddit-thread` (the post,
from the Arctic Shift archive; `reddit_search` reads the comment tree),
`hacker-news-front-page`, `producthunt-launch`, `stackoverflow-question`,
`npm-package`. `linkedin-profile` and `tweet` are retired — those sites'
robots.txt disallow every keyless path. Prefer `shopify-product` over scraping
or LLM extraction on any Shopify storefront — it reads the store's own JSON, so
prices and stock cannot be misread. Full field lists: [templates](references/templates.md).
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

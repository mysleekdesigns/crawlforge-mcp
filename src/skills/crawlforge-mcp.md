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

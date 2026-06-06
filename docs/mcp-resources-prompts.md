# CrawlForge MCP Resources and Prompts

CrawlForge v3.6.0 exposes MCP-native Resources, Prompts, Sampling, and Elicitation — upgrading it from a pure tool host to a first-class MCP server.

## Resources (D1.1)

CrawlForge uses the `crawlforge://` URI scheme. Resources represent long-lived artifacts produced by tools during a session.

### URI Scheme

```
crawlforge://<type>/<id>
```

### Available Resource Types

| URI Pattern | Type | Source | MIME |
|-------------|------|--------|------|
| `crawlforge://research/{sessionId}` | JSON | `deep_research` results stored in `ResearchOrchestrator.activeSessions` | `application/json` |
| `crawlforge://job/{jobId}` | JSON | Completed/failed `batch_scrape` jobs from `JobManager` | `application/json` |
| `crawlforge://crawl/{sessionId}/sitemap` | JSON | `map_site` output stored per crawl session | `application/json` |
| `crawlforge://screenshot/{actionId}` | PNG | Screenshots from `scrape_with_actions` | `image/png` |
| `crawlforge://snapshot/{urlHash}/{timestamp}` | HTML | `SnapshotManager` content snapshots | `text/html` |

### TTL Policy

- All resources have a default TTL of **1 hour** after creation.
- Research sessions remain listed while the `deep_research` session is active.
- Screenshots and crawl sitemaps expire from in-memory storage after 1 hour.
- Snapshots follow the `SnapshotManager` retention policy (default: 30 days, 100 snapshots, 1 GB max).

### Accessing Resources

MCP clients that support `resources/list` and `resources/read` can access these directly:

```json
{ "method": "resources/list" }
// → lists all current crawlforge:// artifacts

{ "method": "resources/read", "params": { "uri": "crawlforge://research/sess-abc123" } }
// → returns the research report JSON
```

---

## Prompts (D1.2)

CrawlForge ships 6 pre-defined workflow prompts (plus the existing `getting-started` prompt).

### Available Prompts

| Name | Arguments | Description |
|------|-----------|-------------|
| `getting-started` | — | Learn CrawlForge tools and best practices |
| `competitive-analysis` | `competitor_urls`, `our_url` | Analyze competitor sites vs your own |
| `monitor-changes` | `url`, `interval?`, `webhook?` | Set up continuous change monitoring |
| `rag-ingest` | `urls`, `output_format?` | Convert URLs to clean markdown for RAG |
| `site-audit` | `url` | Full audit: map + metadata + llms.txt |
| `research-deep-dive` | `topic`, `depth?` | Exhaustive multi-source research |

### Using Prompts

```json
{ "method": "prompts/list" }
// → returns all available prompts with their argument definitions

{ "method": "prompts/get", "params": { "name": "competitive-analysis", "arguments": { "competitor_urls": "https://competitor.com", "our_url": "https://our.com" } } }
// → returns pre-built messages for the competitive analysis workflow
```

---

## Sampling (D1.3)

Tools that require LLM completions now use a **fallback chain** instead of failing when no API key is configured:

```
Ollama (local, http://localhost:11434) 
  → OPENAI_API_KEY 
  → ANTHROPIC_API_KEY 
  → MCP Sampling (client-side LLM) 
  → Error
```

This affects:
- `extract_with_llm` — all LLM calls
- `summarize_content` — abstractive mode
- `extract_structured` — LLM extraction path
- `deep_research` — synthesis (LLM path); the no-LLM `raw_evidence` path now also honors `outputFormat` (`summary` / `citations_only` / `conflicts_focus`) and ranks evidence by relevance without requiring an LLM

To use MCP sampling, the connected MCP client must support the `sampling/createMessage` capability. Claude Code and Claude Desktop support this.

---

## Elicitation (D1.4)

Tools that might trigger expensive or irreversible operations now request user confirmation mid-execution when the MCP client supports elicitation.

| Tool | Trigger | Question |
|------|---------|---------|
| `deep_research` | `maxUrls > 50` | Confirm ~N credit usage before starting |
| `batch_scrape` | `urls.length > 25` in sync mode | Confirm large synchronous batch |
| `crawl_deep` | `max_pages > 500` | Confirm large crawl scope |
| `extract_structured` | Schema has >3 required fields and LLM unavailable | Warn about CSS fallback accuracy |
| AuthManager (all tools) | Remaining credits < projected cost | Confirm proceeding with low credits |

If the client does not support elicitation, all checks **fail open** (the operation proceeds automatically). This ensures tools work in all MCP clients, not just elicitation-capable ones.

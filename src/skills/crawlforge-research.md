# CrawlForge Deep Research Workflow

## When to Use deep_research

Use `deep_research` for comprehensive topic research that requires multiple sources:
- Competitive analysis (compare multiple competitors)
- Technology landscape research
- Fact-gathering with citations
- Market research with multiple data points
- Any topic requiring 5+ web sources synthesized

Do NOT use for:
- Single URL content extraction → use `extract_content`
- Simple web searches → use `search_web`
- Known URLs you want to read → use `fetch_url` or `batch_scrape`

## How deep_research Works

1. **Query Expansion** — Generates 3–5 related queries from your topic
2. **Parallel Fetching** — Fetches up to `max_urls` sources simultaneously
3. **URL Deduplication** — Skips already-visited URLs within the session
4. **Content Extraction** — Extracts clean text from each source
5. **Synthesis** — If Ollama/API key available: returns synthesized report; otherwise returns raw evidence for the calling LLM to synthesize

## LLM Fallback Chain

```
Ollama (local, default) → OpenAI API key → Anthropic API key → MCP Sampling → Raw evidence
```

With no LLM configured, `deep_research` returns structured raw evidence that Claude or another LLM can synthesize.

## MCP Tool Usage

```json
// Standard research
{
  "tool": "deep_research",
  "params": {
    "query": "React vs Vue vs Angular in 2025",
    "depth": "standard",
    "max_urls": 20
  }
}

// Deep research with all sources
{
  "tool": "deep_research",
  "params": {
    "query": "competitor pricing analysis for B2B SaaS",
    "depth": "deep",
    "max_urls": 50,
    "output_format": "detailed"
  }
}
```

Note: When `max_urls > 50`, the tool triggers an elicitation asking for confirmation before proceeding (cost guard).

## CLI Usage

```bash
# Standard research
crawlforge research "React vs Vue in 2025" --depth standard

# Deep research with JSON output
crawlforge research "B2B SaaS pricing trends" --depth deep --max-urls 30 --json

# Save research report to file
crawlforge research "competitor analysis" --pretty > research-report.json
```

## Depth Levels

| Depth | URLs Analyzed | Use Case | Approx. Credits |
|-------|--------------|----------|-----------------|
| basic | 5–10 | Quick overview | 10–15 |
| standard | 15–25 | General research | 15–30 |
| deep | 30–75 | Comprehensive analysis | 30–75+ |

## Cost Management

- `deep_research` costs 10 base credits + 1 per URL analyzed
- Elicitation fires when projected cost > 50 credits
- Use `max_urls` to cap costs: `max_urls: 10` ≈ 20 credits max
- Token budget auto-limits LLM synthesis costs (default: 200,000 chars)

## Accessing Research Results as Resources

Completed research sessions are available as MCP Resources:
```
crawlforge://research/{sessionId}
```

List via `resources/list` — no need to re-run the research.

## Combining with Other Tools

For targeted competitive research:
```
1. search_web "competitor X pricing"         → get URLs
2. batch_scrape [competitor URLs]             → get content in parallel
3. deep_research "competitor X vs us"         → synthesized analysis
```

---
name: crawlforge-deep-research
description: "Runs multi-source web research and autonomous question-answering with CrawlForge's deep_research, agent, search_web, and reddit_search tools. Use when the user wants to research a topic, do a deep dive, compare competitors, gather facts with citations, answer a question from the web, search the web, or get a synthesized report from many sources, or search Reddit posts, comments, and threads. deep_research expands queries, fetches and dedupes sources, then synthesizes; agent autonomously plans searches and navigation from a plain-English prompt with no URLs needed; search_web returns ranked results; reddit_search searches Reddit via community archives (reddit.com blocks scrapers). Caps costs via max_urls and confirms before expensive runs."
metadata:
  version: 4.8.0
  source: crawlforge-mcp-server
---

# CrawlForge Deep Research

Answer questions and produce reports from many web sources using the CrawlForge
MCP server. Four tools, from lightest to heaviest: `reddit_search` (Reddit
posts/comments/threads), `search_web` (ranked results), `agent` (autonomous plan-and-answer), `deep_research` (exhaustive
multi-source synthesis).

## When to use

- "Search the web for X" / "find pages about X" → `search_web`
- "Search Reddit for X" / "what does Reddit say about X" / "read this Reddit
  thread" → `reddit_search`
- "Answer this question from the web" / "what are the top 5 X" (no URLs given) → `agent`
- "Research this topic in depth" / "compare competitors" / "give me a cited
  report" / "gather facts with sources" → `deep_research`

Do NOT use these for a single known URL — use the **crawlforge-web-scraping**
skill (`scrape` / `extract_content`) instead.

## Tool selection

| Need | Tool | Cost |
|------|------|------|
| A ranked list of result URLs + snippets | `search_web` | 5 |
| Reddit posts, comments, or a full thread | `reddit_search` | 2 |
| A direct answer, agent decides what to read | `agent` | 8 (scales) |
| A synthesized, multi-source, cited report | `deep_research` | 10+ (scales) |

A common pipeline: `search_web` to find sources → `batch_scrape` (see
**crawlforge-batch-automation**) to read them → `deep_research` to synthesize.

## search_web (cost: 5)

```json
{
  "tool": "search_web",
  "params": { "query": "best MCP servers 2025", "limit": 10, "time_range": "month" }
}
```

Returns titles, URLs, snippets. Supports `lang`, `site` (domain filter),
`file_type`, `time_range` (`day`/`week`/`month`/`year`/`all`), `expand_query`,
`enable_ranking`, and `enable_deduplication`. CLI:
`crawlforge search "MCP server tutorial" --limit 5`.

## reddit_search (cost: 5)

reddit.com 403-blocks direct scraping, so this queries the Arctic Shift and
PullPush community archives instead (free, no Reddit credentials).

```json
{
  "tool": "reddit_search",
  "params": { "query": "best MCP servers", "subreddit": "ClaudeAI", "limit": 10 }
}
```

Modes: `posts` (default), `comments`, and `thread` (a post plus its nested
comment tree via `link_id`). Scope with `subreddit`/`author` for near-real-time
results (Arctic Shift); an unscoped `query` searches all of Reddit via PullPush
(best-effort — it rate-limits aggressively). `after`/`before` accept ISO dates,
epoch seconds, or offsets like `"7d"`. Scores of posts under ~36h old read 0/1
until the archive backfills. Space calls out rather than firing them in
parallel — the archives shed load under concurrent bursts.

## agent — autonomous answer (cost: 8, scales with maxUrls)

No URLs required. The agent plans search queries, fetches and filters relevant
pages, then returns a prose or structured answer.

```json
{
  "tool": "agent",
  "params": { "prompt": "What are the top 5 MCP servers in 2025 and who maintains them?", "maxUrls": 10 }
}
```

- `model:"default"` runs a SamplingClient loop (no LLM keys needed).
- `model:"pro"` runs the full ResearchOrchestrator (deeper, multi-source); it
  asks for confirmation (elicitation) before running.
- Pass `schema` for structured JSON output, `urls` for optional seed URLs.
- Hard limits enforced by the orchestrator: `maxSteps` ≤ 10, `maxUrls` ≤ 20,
  120s wall-clock. Output is degraded-but-useful if no LLM keys/Ollama exist.

## deep_research — exhaustive report (cost: 10+, scales)

```json
{
  "tool": "deep_research",
  "params": {
    "topic": "React vs Vue vs Angular in 2025",
    "maxUrls": 20,
    "researchApproach": "comparative",
    "outputFormat": "comprehensive"
  }
}
```

How it works: query expansion → parallel fetch (deduped) → content extraction →
conflict detection → synthesis. `researchApproach`: `broad`, `focused`,
`academic`, `current_events`, `comparative`. `outputFormat`: `comprehensive`,
`summary`, `citations_only`, `conflicts_focus`. Results are stored as a
`crawlforge://research/{sessionId}` resource — re-read them without re-running.

CLI: `crawlforge research "B2B SaaS pricing trends" --depth deep --max-urls 30`.

### Cost control

`deep_research` starts at 10 credits and grows with sources. **`maxUrls > 50`
triggers a confirmation prompt (elicitation).** Cap cost with `maxUrls`
(e.g. `maxUrls:10` ≈ 12 credits). `timeLimit` (default 120000 ms) bounds
runtime.

## Synthesis & LLM fallback

The server ships with **no LLM key by design**. The fallback chain is:
Ollama (local) → OpenAI key → Anthropic key → MCP Sampling → raw evidence.
With no LLM configured, `deep_research` returns structured **raw evidence** for
the calling assistant (e.g. Claude Code) to synthesize — this is expected, do
not suggest adding API keys.

See [research workflows](references/workflows.md) for pipelines, depth tiers,
and parameter detail.

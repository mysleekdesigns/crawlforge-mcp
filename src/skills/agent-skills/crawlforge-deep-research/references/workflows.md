# Deep Research — Workflows & Parameters

## Pipelines

### Targeted competitive research
1. `search_web` `"competitor X pricing"` → candidate URLs.
2. `batch_scrape` the URLs → content in parallel (see crawlforge-batch-automation).
3. `deep_research` `"competitor X vs us"` → synthesized comparison.

### Quick fact-find
- `agent` with `model:"default"` and a tight `maxUrls` (5–8). Cheapest path to a
  cited answer when you don't need a full report.

### Exhaustive report
- `deep_research` with `researchApproach` matched to intent and `maxUrls`
  sized to budget.

## deep_research parameters (cost: 10+, scales with maxUrls)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `topic` | string | — | Required, 3–500 chars. |
| `maxDepth` | number | `5` | 1–10. |
| `maxUrls` | number | `50` | 1–1000. **>50 triggers elicitation.** |
| `timeLimit` | number | `120000` | 30000–300000 ms. |
| `researchApproach` | enum | `broad` | `broad`, `focused`, `academic`, `current_events`, `comparative`. |
| `sourceTypes` | string[] | `["any"]` | `academic`, `news`, `government`, `commercial`, `blog`, `wiki`, `any`. |
| `credibilityThreshold` | number | `0.3` | 0–1 minimum source credibility. |
| `enableConflictDetection` | boolean | `true` | Flag contradictory claims. |
| `enableSourceVerification` | boolean | `true` | Score source credibility. |
| `enableSynthesis` | boolean | `true` | Build a coherent report. |
| `outputFormat` | enum | `comprehensive` | `comprehensive`, `summary`, `citations_only`, `conflicts_focus`. |
| `includeRawData` | boolean | `false` | Include raw scraped data. |
| `concurrency` | number | `5` | 1–20. |
| `webhook` | object | — | `started`/`progress`/`completed`/`failed` callbacks. |

Results stored at `crawlforge://research/{sessionId}` (list via `resources/list`).

## Approximate depth tiers (CLI `--depth`)

| Depth | URLs | Use case | Approx. credits |
|-------|------|----------|-----------------|
| basic | 5–10 | Quick overview | 10–15 |
| standard | 15–25 | General research | 15–30 |
| deep | 30–75 | Comprehensive analysis | 30–75+ |

## agent parameters (cost: 8, scales with maxUrls)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `prompt` | string | — | Required, 1–2000 chars. |
| `urls` | string[] | — | Optional seed URLs, max 20. |
| `schema` | object | — | JSON schema for structured output. |
| `model` | enum | `default` | `default` = SamplingClient loop; `pro` = ResearchOrchestrator (confirms first). |
| `maxSteps` | number | `5` | Hard cap 10. |
| `maxUrls` | number | `10` | Hard cap 20. |

Orchestrator-enforced hard stops (never delegated to the LLM): maxSteps ≤ 10,
maxUrls ≤ 20, 120s wall-clock.

## search_web parameters (cost: 5)

| Param | Type | Notes |
|-------|------|-------|
| `query` | string | Required. |
| `limit` | number | 1–100. |
| `offset` | number | Pagination. |
| `lang` | string | e.g. `en`, `fr`. |
| `time_range` | enum | `day`, `week`, `month`, `year`, `all`. |
| `site` | string | Restrict to a domain. |
| `file_type` | string | e.g. `pdf`, `doc`. |
| `provider` | enum | `crawlforge` (default) or `searxng`. |
| `expand_query` | boolean | Synonyms/stemming/etc. |
| `enable_ranking` | boolean | BM25 + signal re-ranking. |
| `enable_deduplication` | boolean | Drop near-duplicates. |
| `localization` | object | `countryCode`, `language`, `timezone`, geo-targeting. |

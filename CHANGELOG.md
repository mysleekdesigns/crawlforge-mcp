# Changelog



All notable changes to CrawlForge MCP Server will be documented in this file.
## [4.6.5] - 2026-06-16

Patch — fixes `deep_research` returning irrelevant / near-empty results on commercial topics. The v4.6.4 fix restored search execution; this fixes what those searches *find*.

### Fixed

- **Query expansion poisoned commercial/comparative research.** `ResearchOrchestrator.generateResearchVariations()` appended academic/scientific suffixes (`what is …`, `… explained`, `… research paper`, `… peer reviewed`, `… scientific`) to *every* topic regardless of `researchApproach`. On a competitor analysis this dragged web search toward irrelevant government/academic PDFs (reproduced: DNI SCIF specs, university course catalogs, a DLA logistics handbook surfaced as "top sources"), and on niche commercial topics it left only 1–2 usable sources. Variations are now tuned to the approach: `academic` keeps the scholarly suffixes, `current_events` uses recency terms, and `broad`/`focused`/`comparative` use commercial intent (`review`, `comparison`, `vs alternatives`, `pricing`, `best …`, `company`). Also dropped the stale hardcoded `2024` year suffix. `src/core/ResearchOrchestrator.js`
- **`researchApproach` never reached query generation.** It only configured search ranking weights in `buildOrchestratorConfig()`; the orchestrator itself always behaved as `broad`. `DeepResearchTool.buildOrchestratorConfig()` now passes `researchApproach` into the orchestrator config, and the `ResearchOrchestrator` constructor accepts and stores it. `src/tools/research/deepResearch.js`, `src/core/ResearchOrchestrator.js`
- **High-authority off-topic pages dominated results.** `verifySourceCredibility()` scored `.gov`/`.edu` at 0.9 domain authority irrespective of topical relevance, so unrelated authoritative pages ranked as top sources. Credibility is now blended with the per-source relevance signal (`overallCredibility *= 0.4 + 0.6 * relevanceScore`), demoting (and, at zero keyword overlap, dropping below the 0.3 threshold) sources that don't actually match the topic. `src/core/ResearchOrchestrator.js`

### Notes

- Unaddressed by design (scoped out): discussion sources behind bot protection (Reddit, Quora, gearspace, Facebook) return HTTP 403 to the plain-`fetch` extraction path; verified that realistic browser headers do **not** bypass their TLS-fingerprint/JS-challenge defenses. Recovering those needs a browser/stealth extraction path.
- Unit suite: 374/374 (sandbox-on); the 13 `streamableHttp` / `searchWebSearxng` cases fail only under the sandbox's `listen EPERM` localhost-bind restriction and pass 24/24 with the sandbox disabled.

### Changed

- **Version sync** — `package.json`, `server.json` (manifest + npm package entry), and the `McpServer` version in `server.js` bumped to `4.6.5`.

## [4.6.4] - 2026-06-09

Patch — fixes `deep_research` silently returning zero sources (and the same hole in `agent model:"pro"`), caught by live MCP usage.

### Fixed

- **`deep_research` returned zero sources, silently.** `ResearchOrchestrator` builds its own private `SearchWebTool`, but no layer of the `deep_research` stack ever passed it the `search_web` tool config (`apiKey`/`apiBaseUrl`): `server.js` constructs `DeepResearchTool` with no options, and `buildOrchestratorConfig()`'s per-approach `searchConfig` blocks carried only ranking/dedup weights. Every internal search threw "API key is required", the per-query catch swallowed it, and — because `metrics.searchQueries` incremented *before* the call — the result reported a successful run with 4–5 search queries and `urlsProcessed: 0`. (Pre open-core Phase 2 this failed loudly at construction; the key-optional constructor turned it into silent empty success.) `buildOrchestratorConfig()` now merges `getToolConfig('search_web')` into `searchConfig` for all five research approaches. `src/tools/research/deepResearch.js`
- **`agent` tool `model:"pro"` had the same hole.** `AgentOrchestrator` passed its `searchConfig` to its direct search tool but not to the `ResearchOrchestrator` it lazily constructs for pro runs. Now forwarded. `src/core/AgentOrchestrator.js`
- **All-queries-failed searches no longer masquerade as success.** `gatherInitialSources()` now throws when every attempted search query fails (carrying the first underlying error), and only counts `metrics.searchQueries` for searches that actually executed; partial failure (some queries fail, some succeed) still proceeds. `src/core/ResearchOrchestrator.js`
- **Orchestrator error payloads surfaced as failures.** `conductResearch()` never rejects — it returns a `handleResearchError()` payload — which `DeepResearchTool` previously formatted into a `success: true` result and the agent pro path wrapped as a successful answer. Both now detect the `error` field and return `success: false` with the message (deep_research includes `partialResults` under `includeRawData` and the recovery recommendations). `src/tools/research/deepResearch.js`, `src/core/AgentOrchestrator.js`

### Added

- **`tests/unit/researchSearchKey.test.js`** — 11 regression tests: key plumbing across all five research approaches, agent-pro `searchConfig` forwarding, loud all-failed behavior + metrics accuracy, partial-failure tolerance, and error-payload surfacing.

### Changed

- **Version sync** — `package.json`, `server.json` (manifest + npm package entry), and the `McpServer` version in `server.js` bumped to `4.6.4`.

## [4.6.3] - 2026-06-07

Patch — README rendering fix so the npm package page matches GitHub. No tool or runtime behavior changes.

### Fixed

- **README banner broken on npm.** The header banner used a relative-path SVG (`assets/banner.svg`); npm's README renderer blocks SVG and mishandles relative image paths, so the banner showed broken on the npm package page while rendering fine on GitHub. Pointed it at the absolute raw-GitHub URL of the JPG export (`assets/banner.jpg`), which renders identically on both. npm only refreshes a package's README on publish, so this required a new version. `README.md`

### Changed

- **Version sync** — `package.json`, `server.json` (manifest + npm package entry), and the `McpServer` version in `server.js` (which had lagged at `4.5.0`) all bumped to `4.6.3`.

## [4.6.2] - 2026-06-07

Patch — enables publication to the official MCP registry (`registry.modelcontextprotocol.io`). No tool or runtime behavior changes.

### Added

- **`mcpName` field in `package.json`** (`io.github.mysleekdesigns/crawlforge-mcp-server`). The MCP registry fetches the published npm tarball and rejects packages whose `package.json` lacks an `mcpName` matching the registry submission — so this required a new published version.
- **`server.json`** (repo root) — registry manifest validated against the `2025-12-11` schema; npm package `crawlforge-mcp-server`, stdio transport. Registry `description` trimmed to ≤100 chars per schema validation.
- **`docs/registry-submission.md`** — `mcp-publisher` publish runbook + ready-to-paste `awesome-mcp-servers` entries.

## [4.6.1] - 2026-06-07

Patch — fixes the `agent` tool's autonomous search, caught by live MCP smoke testing of the v4.6.0 release.

### Fixed

- **`agent` tool: autonomous search (GATHER) was a no-op.** `AgentOrchestrator` parsed search results assuming the MCP content-wrapped shape (`sr.content[0].text`), but `SearchWebTool.execute()` returns the **raw** results object — so `parsed` was always `null`, no URLs were ever queued, and any `agent` call without seed `urls[]` returned `{degraded:true, reason:"No content could be fetched…"}`. The orchestrator now handles both shapes (`sr.content?.[0]?.text ? JSON.parse(...) : sr`). `src/core/AgentOrchestrator.js`
- **Test gap that masked the above.** `tests/unit/phaseD-regressions.test.js` mocked `_searchTool.execute()` with the content-wrapped shape, encoding the orchestrator's wrong assumption. All six mocks now return the **raw** shape that the real `SearchWebTool` returns, so the suite guards this path. Verified live: `agent({prompt})` with no URLs now searches, fetches, and synthesizes.

## [4.6.0] - 2026-06-07

Phase D of `IMPROVEMENT_PLAN.md` — "Firecrawl-Competitive: Agent + Unified Scrape + Onboarding". Closes the three Firecrawl feature gaps with no clean CrawlForge equivalent — an autonomous **agent**, a **unified scrape** entry point, and **ranked map** — plus a one-command onboarding flow, all **local-first** (MCP-native primitives + local-LLM via Ollama; no cloud proxy/reliability layer). Purely additive: tool count 24 → 26, no breaking changes to existing tools. Regression coverage ships in `tests/unit/phaseD-regressions.test.js`.

### Added

- **`scrape` tool (unified scrape)** — one call takes a `formats` array (`"markdown" | "html" | "rawHtml" | "text" | "links" | "metadata" | "screenshot"` or `{type:"json", schema, prompt?}`) plus an `onlyMainContent` flag, does a **single fetch + one cheerio load**, and dispatches each requested format from that one parse (reusing `extractBlockText`, the Readability→markdown helper, `htmlToMarkdown`, and `ExtractWithLlm` for JSON). Partial-success is non-fatal: a failed format records a `warnings[]` entry rather than failing the whole call. `onlyMainContent` maps to the existing Readability boilerplate-removal branch. **New:** `src/tools/scrape/unifiedScrape.js`.
- **`agent` tool (autonomous)** — natural-language prompt → autonomous search / navigate / extract → prose-or-structured output, **no URLs required**. Input: `prompt`, optional `urls[]` (≤20), optional `schema`, `model:'default'|'pro'`, `maxSteps` (≤10), `maxUrls` (≤20). Built as a hardcoded PLAN → GATHER → ACT → DECIDE → SHAPE state machine over existing pieces (`SearchWebTool`, `fetchAndParse`, `ExtractWithLlm`, `SamplingClient`, and `ResearchOrchestrator` for the `pro` tier). **Three independent hard stops — steps, URLs, and a wall-clock budget — plus "answer found", all enforced in the orchestrator and never delegated to the LLM.** No-LLM-key path returns a degraded-but-useful result (`{degraded:true, reason, ...evidence}`) so the host LLM can finish, mirroring `deep_research`'s raw-evidence behavior. `ElicitationHelper` confirms before a `pro`/expensive run (fail-open). **New:** `src/core/AgentOrchestrator.js`, `src/tools/agent/agent.js`.
- **`map_site` `search=` ranking** — optional `search` string ranks discovered URLs by relevance via the existing `ResultRanker.rankResults()` (slug adapter over the URL path) and emits `ranked_urls:[{url, score}]` sorted descending. Default (no-`search`) output shape is **unchanged** (back-compat). The ranker is constructed lazily/once to avoid its `CacheManager` timer leaking per request. `src/tools/crawl/mapSite.js`, `server.js`
- **`crawlforge init` CLI command** — one command orchestrates existing pieces: API-key detection, skill installation (`install({target})`), and **idempotent merge of the MCP server stanza** into the detected client config (`~/.claude.json`, Claude Desktop's OS-specific config, Cursor `~/.cursor/mcp.json`) — without clobbering other servers. Flags: `--all`, `--client <name>`, `--yes`. **New:** `src/cli/commands/init.js`; registered in `src/cli/index.js`; `package.json` postinstall hint updated.
- **`SKILL.md`** — canonical, agent-fetchable capabilities reference generated by concatenating `src/skills/*.md` (the same `concatenateSkills()` source used by the installer), with a "Phase D New Tools" section documenting `scrape` and `agent`. Referenced from `README.md`.

### Changed

- **`extract_text` reuse** — `extractBlockText($)` is now exported and the Readability→markdown conversion is factored into a reusable exported helper, so the new `scrape` tool reuses them against an already-loaded cheerio instance without re-fetching. No behavior change to `extract_text`. `src/tools/basic/extractText.js`
- **Cost model** — `getToolCost()` adds `scrape: 2` and `agent: 8`; `projectCost()` scales `scrape` with the number of requested formats and `agent` with `maxUrls` + the `pro` tier (external LLM usage is billed by the provider, not in credits). `src/core/AuthManager.js`
- **Tool count 24 → 26** — `scrape` and `agent` registered (both `withAuth`), added to the startup tool list and graceful-shutdown cleanup; server description updated.

### Verified

`tests/unit/phaseD-regressions.test.js` 34/34 pass (mocked LLM/search/fetch — no live network; covers the agent loop's `maxSteps`/`maxUrls`/wall-clock hard stops and clamps, the no-LLM degraded path, unified `scrape` single-fetch multi-format + partial-success warnings, and `map_site` `search=` ranking). Full `npm run test:unit` green except the pre-existing `streamableHttp` / `searchWebSearxng` suites, which fail only under the sandbox's `listen EPERM` (localhost-bind) restriction and pass cleanly with the sandbox disabled (0 failures). `npm test` MCP harness exits 0 (0 errors; 60% rate unchanged from v4.5.0). `node test-tools.js` 15/15 pass + 5 network-skipped (100%). Live MCP smoke tests are deferred — they require publishing + reinstalling the global binary. Version bumped 4.5.0 → 4.6.0; tool count 24 → 26.

## [4.5.0] - 2026-06-07

Phase C of `IMPROVEMENT_PLAN.md` — "Robustness, Security & Polish". Closes all C-series items so tools are robust, polite on the network, and consistent in their contracts. Regression coverage ships in `tests/unit/phaseC-regressions.test.js` (27 tests).

### Added

- **`get_batch_results` tool** — paginated retrieval of `batch_scrape` results by `batchId` (`page` / `pageSize`). Tool count 23 → 24. Also restored `list_ollama_models` to the startup tool list. `server.js`, `src/tools/advanced/batchScrape/index.js`
- **`stealth_mode` engine selection** — `engine: 'chromium'` (default) | `'camoufox'`, wired through the operation-based `scrape_with_stealth` → `createStealthContext` → `launchStealthBrowser` path; a mismatched running browser is torn down before switching. `src/core/StealthBrowserManager.js`
- **`extract_with_llm` structured output** — when a `schema` is provided and the provider is Anthropic, output is forced via tool-use (`tools` + `tool_choice`), guaranteeing schema-shaped JSON; output is then validated with zod (`valid` / `validationErrors` in the result). Truncation metadata (`truncated`, `original_length`) is surfaced. `src/tools/extract/extractWithLlm.js`
- **`process_document` page ranges** — `options.pageRange: {start, end}` (1-based, inclusive) returns exactly those pages via per-page `pagerender` capture. The server `options` schema is now passthrough so granular options (`maxPages`, `pageRange`, `extractText`, …) actually reach the tool instead of being stripped. `src/core/processing/PDFProcessor.js`, `src/tools/extract/processDocument.js`, `server.js`

### Fixed

- **`fetch_url` body-size cap** — Content-Length pre-check plus a streaming byte-count guard (configurable via `MAX_FETCH_BODY_SIZE`, default 25 MB) prevents memory exhaustion across all basic tools. The guard is defensive: responses without a Headers object or a `ReadableStream` body are returned unchanged so native `.text()`/`.json()` keep working. `src/tools/basic/_fetch.js`, `src/constants/config.js`
- **Ineffective fetch timeouts** — replaced the no-op `timeout:` option (ignored by Node `fetch`) with `AbortSignal.timeout(...)` in `extract_content`, `process_document`, and `track_changes`. `src/tools/extract/extractContent.js`, `src/tools/extract/processDocument.js`, `src/tools/tracking/trackChanges/differ.js`
- **`generate_llms_txt` intrusive probing** — security-path and rate-limit probing are now opt-in (`checkSecurity`, `probeRateLimit` default `false`); remaining probes run in bounded parallel batches instead of long sequential loops. `src/core/LLMsTxtAnalyzer.js`, `src/tools/llmstxt/generateLLMsTxt.js`
- **`crawl_deep` rate limiting & logging** — per-domain rate-limiter map (reused rather than recreated per URL); filter/robots block messages routed through `logger.debug` instead of raw `console.error` (stdout-hygiene). `src/core/crawlers/BFSCrawler.js`
- **`stealth_mode` sec-ch-ua mismatch** — `sec-ch-ua` brand versions are derived from the resolved User-Agent's Chrome major version (was hardcoded `120` against a `121` UA). `src/core/StealthBrowserManager.js`
- **Stale User-Agent** — `fetch_url` / `extract_structured` now send a version-derived `CrawlForge/<version> (+https://crawlforge.dev)` UA (was `CrawlForge/1.0.0` / `CrawlForge-MCP/3.0`). `src/tools/basic/_fetch.js`, `src/tools/extract/extractStructured.js`
- **`localization` geo-blocking & phone regex** — `handle_geo_blocking` renamed to `detect_geo_blocking` (it only detects and recommends — no bypass is applied); fixed the US phone regex (`\\d` → `\d`). `src/core/LocalizationManager.js`, `server.js`
- **`extract_with_llm` JSON recovery** — extracts the first *balanced* embedded JSON object/array (string/escape-aware), tolerating prose both before and after the JSON; previously only leading-prose-then-trailing-JSON was recovered. `src/tools/extract/extractWithLlm.js`
- **`list_ollama_models` robustness** — hardened against a non-array `models` field; `modified_at` normalized to ISO 8601. `src/tools/extract/listOllamaModels.js`
- **`process_document` page extraction** — `extractPDFPages` now produces a real page range; previously its `endPage` was clobbered by `maxPages` and `startPage > 1` only logged a warning while returning all pages. `src/core/processing/PDFProcessor.js`
- **`batch_scrape` markdown title / webhook status** — markdown builder de-dups the `<title>` heading against the first `<h1>`; webhook delivery status is returned on the batch result. `src/tools/advanced/batchScrape/worker.js`, `reporter.js`, `index.js`

### Verified

`npm run test:unit` 360/360 (sandbox-off; sandbox-on `listen EPERM` failures are the pre-existing HTTP-transport/searxng port-binding cases). `node test-tools.js` 20/20 (100%). `npm test` MCP harness exits 0 (0 errors). `npm audit`: 4 pre-existing moderate advisories (uuid/node-cron transitive) — out of Phase-C scope. Version bumped 4.4.0 → 4.5.0; tool count 23 → 24.

## [4.4.0] - 2026-06-06

Phase B of `IMPROVEMENT_PLAN.md` — "Result-Quality Upgrades". Closes 12 quality items so "working" tools return accurate, well-structured, high-fidelity data. Each fix ships a reproduce→pass regression test in `tests/unit/phaseB-regressions.test.js` (56 tests).

### Fixed

- **`extract_content` / `process_document` Flesch formula** — replaced the inverted, char-based readability score with the correct Flesch Reading-Ease formula (`206.835 − 1.015·avgWordsPerSentence − 84.6·avgSyllablesPerWord`); added a `_countSyllables` helper and exposed `avgSyllablesPerWord`. Higher score now means easier reading. `src/core/processing/ContentProcessor.js`
- **`extract_text` block structure** — text mode joins block-level elements with `\n\n` instead of collapsing whitespace (which glued paragraphs together); markdown mode runs `@mozilla/readability` before Turndown, and `turndown-plugin-gfm` renders HTML tables as GFM pipe tables. `src/tools/basic/extractText.js`, `src/utils/htmlToMarkdown.js`
- **`extract_metadata` JSON-LD/microdata** — now parses and returns `json_ld` and `microdata` (advertised but previously absent); title fallback chain is `og:title → <title> → h1`. `src/tools/basic/extractMetadata.js`
- **`scrape_structured` attributes & match counts** — added `@attr` extraction syntax (`a@href`, `img@src`) and a `max_results` param; `elements_found` is now a per-field DOM-match-count object instead of a count of result keys. `src/tools/basic/scrapeStructured.js`, `server.js`
- **`extract_structured` confidence penalty** — the "CSS fallback used" note moved out of `validationErrors` into its own `extractionNotes` array so it no longer drags down confidence; `ul/ol > li` array/list extraction improved. `src/tools/extract/extractStructured.js`
- **`crawl_deep` truncation** — replaced the hardcoded 500-char cut with a `content_max_length` param + `truncated` flag; no `...` appended to already-short content. `src/tools/crawl/crawlDeep.js`, `server.js`
- **`map_site` sitemap handling** — reuses `src/utils/sitemapParser.js` for sitemap-index recursion, gzipped (`.xml.gz`) sitemaps, real cheerio XML parsing (CDATA/entities), and robots.txt sitemap discovery; `min=Infinity` fixed to `null`. `src/tools/crawl/mapSite.js`
- **`search_web` ranking & contract** — `total_results` is now a Number (was `String()`-wrapped); BM25 uses real per-term IDF instead of a constant `df`; SimHash is a true 64-bit hash via two independent FNV-1a seeds (bits 32-63 no longer mirror 0-31); top-level `finalScore`/`contentHash`/`scores`/internal fields are stripped unless detail flags are set. `src/tools/search/providers/searxng.js`, `ranking/ResultRanker.js`, `ranking/ResultDeduplicator.js`, `searchWeb.js`
- **`analyze_content` false positives** — topic categorization and emotion detection use word-boundary (`\bword\b`) matching, eliminating substring matches like `'happy'`→`'app'` and `'glade'`→`'glad'`. `src/tools/extract/analyzeContent.js`
- **`track_changes` similarity** — token-based Jaccard `calculateSimilarity()` replaces length-only comparison, with a `DEFAULT_CHANGE_THRESHOLD = 0.85`. `src/tools/tracking/trackChanges/differ.js`

### Added

- **`extract_content` provenance fields** — `extractionMethod` (`readability` / `fallback_boilerplate_removal` / `raw_body_text`), `fallback_reason`, `confidence`, and `finalUrl`, so callers can distinguish Readability output from last-resort body text. `src/tools/extract/extractContent.js`
- **`deep_research` no-LLM `outputFormat`** — the `raw_evidence` path now honors `outputFormat`: `summary` trims to the top-5 sources, `citations_only` returns a citation shape plus `citationSummary`, `conflicts_focus` surfaces a `conflictsNote`; evidence is ranked by credibility. Previously these formats silently did nothing without an LLM. `src/tools/research/deepResearch.js`
- **`turndown-plugin-gfm` dependency** — enables GFM table rendering in markdown output.

### Verified

- `tests/unit/phaseB-regressions.test.js` 56/56; full recursive `npm run test:unit` 488/488 green sandbox-off (the sandbox-on `listen EPERM 127.0.0.1` failures are the pre-existing HTTP-transport/searxng port-binding cases). `node test-tools.js` 20/20 (100%). `npm test` MCP harness exits 0 (0 errors). `McpServer` version bumped 4.3.0 → 4.4.0.

## [4.3.0] - 2026-06-06

Phase A of `IMPROVEMENT_PLAN.md` — "Critical Fixes & Restored Capabilities". Closes 9 critical-correctness bugs and restores 6 advanced MCP capabilities that `server.js` schemas were silently dropping. Each fix ships a reproduce→pass regression test in `tests/unit/phaseA-regressions.test.js`.

### Fixed

- **`extract_links` inverted `filter_external`** — `filter_external:true` now returns only *external* links (previously returned internal-only). `src/tools/basic/extractLinks.js`
- **`analyze_content` language detection** — `franc.all` (nonexistent in franc v6) replaced with the `francAll` named import; unblocks all language detection and `summarize_content`'s `metadata.language`. `src/core/analysis/ContentAnalyzer.js`
- **`summarize_content` abstractive mode** — implemented the missing `_abstractiveSummaryViaSampling()` (via `SamplingClient`); when no LLM/sampling backend is available it returns the extractive summary with explicit `degraded`/`degradedReason` flags instead of silently masking the failure. `src/tools/extract/summarizeContent.js`
- **`extract_with_llm` undefined `callViaSampling`** — removed the undefined call and wired the real `getSamplingClient()` fallback; the Ollama/auto error path no longer crashes. `src/tools/extract/extractWithLlm.js`
- **`deep_research` empty extractions** — failed/empty (`{"text":""}`) extractions are no longer counted as `contentExtracted` or surfaced; guards on `contentData.success` + non-empty trimmed content. `src/core/ResearchOrchestrator.js`
- **`track_changes` no-baseline** — returns a clean `No baseline found for <url> — run create_baseline first` error and no longer emits an unhandled `'error'` EventEmitter event. `src/core/ChangeTracker.js`
- **`scrape_template` Hacker News selectors** — `.subtext` is the sibling row after `tr.athing` (not `.spacer`); score/author/posted/comments now populate per story. `src/tools/templates/TemplateRegistry.js`
- **`generate_llms_txt` output format** — default output is now spec-compliant llmstxt.org markdown (`# Title`, `> summary`, `## Section` headers with `[name](url)` link lists) instead of robots.txt directives. The legacy robots-style output is preserved behind `outputOptions.robotsStyle:true`. `src/tools/llmstxt/generateLLMsTxt.js`

### Added (restored MCP capabilities)

- **`crawl_deep`** — `domain_filter`, `session`, `import_filter_config`, `enable_link_analysis`, `link_analysis_options` now forwarded through the MCP schema + handler. `server.js`
- **`search_web`** — 10 previously-dropped params forwarded: `provider`, `expand_query`, `expansion_options`, `enable_ranking`, `ranking_weights`, `enable_deduplication`, `deduplication_thresholds`, `include_ranking_details`, `include_deduplication_details`, `localization`. `server.js`
- **`map_site`** — `domain_filter` / `import_filter_config` forwarded. `server.js`
- **`scrape_with_actions`** — the MCP action schema now carries all action fields (`duration`, `distance`, `direction`, `captureAfter`, `clear`, `button`, `clickCount`, `delay`, `force`, `position`, `modifiers`, `smooth`, `toElement`, `condition`, `fullPage`, `quality`, `format`, `args`, `returnResult`) so `{type:'wait',duration:1000}` works; `formAutoFill` `{fields:[…]}` is reconciled end-to-end (flat record still accepted); and final content is read from the post-action live page (`ActionExecutor` captures `finalHtml`/`finalUrl`; `extractContent` accepts pre-rendered `html`) instead of re-fetching the original URL. `server.js`, `src/tools/advanced/ScrapeWithActionsTool.js`, `src/core/ActionExecutor.js`, `src/tools/extract/extractContent.js`

### Verified

- `tests/unit/phaseA-regressions.test.js` 12/12; full `npm run test:unit` 277/277 green sandbox-off (the sandbox-on `listen EPERM 127.0.0.1` failures are the pre-existing HTTP-transport/searxng port-binding cases). `node test-tools.js` 20/20 (100%). `npm test` MCP harness exits 0 (all 23 tools discovered). `McpServer` version corrected from a stale 4.2.6 to 4.3.0.

## [4.2.12] - 2026-06-06

Patch release: ship the previously-unreleased `stealth_mode` fingerprint-consistency and `create_page` output fixes (commit `28e2e3b`) so the published package matches HEAD. Tarball now carries the corrected `StealthBrowserManager` and `create_page` handler.

### Fixed

- **`stealth_mode` fingerprint OS consistency** (`src/core/StealthBrowserManager.js`): the user-agent, `sec-ch-ua-platform` header, and `navigator.platform` were drawn from `osDistribution` by three independent random calls, so a fingerprint could advertise a Windows UA with `navigator.platform: "Linux x86_64"`. `generateAdvancedFingerprint()` now selects the OS once (`selectOS()`, inferring OS from any `customUserAgent`) and threads it through the UA, headers, and hardware fingerprint. Verified 500/500 random fingerprints internally consistent.
- **`stealth_mode` `create_page` output leak** (`server.js`): `create_page` returned the raw, non-serializable Playwright `Response` handle. It now returns a serializable `navigation` object `{ requestedUrl, finalUrl, status, ok, title }`.

### Verified

- `tests/unit/d2-reliability.test.js` (StealthBrowserManager) 16/16; `npm run test:unit` green sandbox-off (sandbox-on `listen EPERM` HTTP-transport failures are pre-existing and environmental).

## [4.2.11] - 2026-05-25

Maintenance release. No shippable code changed — the published tarball is identical to 4.2.10 (the `files` allow-list excludes `tests/`); the version bump releases the post-4.2.10 test-hardening work and keeps the registry in lockstep with `main`.

### Added

- **`tests/unit/stdout-hygiene.test.js` regression lock** for the v4.2.10 stdout fixes — a source scan that fails if any `console.log` reappears in the tool/crawler/stealth/webhook execution paths, plus the `tests/fixtures/cli/actions-wait-screenshot.json` fixture. Landed after 4.2.10 was already published.

### Verified

- `npm run test:unit` passes (sandbox-off; the only sandbox-on failures are HTTP-transport tests that can't `listen` on `127.0.0.1` under the sandbox). `npm test` MCP harness exits 0.

## [4.2.10] - 2026-05-25

Patch release: eliminate stdout leaks that corrupted CLI `--json` output. Found while verifying the v4.2.9 CLI fixes — `crawlforge actions --json` emitted a non-JSON banner line before the JSON, breaking programmatic parsing.

### Fixed

- **Tool diagnostics no longer write to stdout** (reserved for the MCP JSON-RPC stream and CLI `--json`). Moved 11 `console.log` calls to `console.error` across the tool/crawler execution paths:
  - `ScrapeWithActionsTool` — "Starting scrape session …" banner (the one that broke `actions --json`) and its internal `log()` helper.
  - `extractContent` / `processDocument` — "Using browser rendering for JavaScript content…" (corrupted `scrape`/`extract`/`analyze`/`process-document --json` when JS rendering kicked in).
  - `StealthBrowserManager` — Cloudflare/reCAPTCHA-detected and proxy-rotation messages (corrupted `stealth --json` on protected sites).
  - `BFSCrawler` — domain-filter / legacy-pattern / robots.txt block messages (corrupted `map`/`crawl --json` on real multi-page sites).
  - `WebhookDispatcher` — webhook-retry message (corrupted `track`/`monitor --json` on webhook retries).
  - Completes the v4.2.4 stdout-hygiene pass. Left untouched: `AuthManager` interactive setup output (stdout is intended there), standalone `src/security/*` scripts/tests, and graceful-shutdown logs (don't fire on normal one-shot CLI exit).

### Verified

- `crawlforge actions … --json` now starts with `{` and parses cleanly (`success:true`, 2/2 actions, screenshot captured), confirmed against the global 4.2.10 install (banner on stderr, none on stdout). `npm run test:unit` 265/265.
- Regression-locked by `tests/unit/stdout-hygiene.test.js` (source scan: fails if any `console.log` reappears in tool/crawler execution paths) + `tests/fixtures/cli/actions-wait-screenshot.json`.

## [4.2.9] - 2026-05-25

Patch release: fix the remaining broken/no-op `crawlforge` CLI commands and make the CLI work inside sandboxed (proxied) environments. The CLI invokes tools directly, so these are CLI-layer fixes — the MCP server was already correct.

### Fixed

- **`research` no longer errors on every run.** Passed `query`/`depth`/`max_urls`/`output_format`, but `DeepResearchSchema` requires `topic` plus `maxDepth`/`maxUrls`/`outputFormat`. Zod stripped the unknown keys, leaving `topic` undefined → "Required". Now sends `topic` and maps `--depth basic|standard|deep` → `maxDepth` (2/5/8) and `--output-format summary|detailed` → `outputFormat` (`summary`/`comprehensive`).
- **`stealth` no longer throws `TypeError`.** It called `StealthBrowserManager.scrapeWithStealth()`, which did not exist (the `stealth_mode` tool is operation-based only). Added a one-shot `scrapeWithStealth({url, engine, wait_for, screenshot})` convenience method (create context → page → goto → extract title/text/html → optional base64 screenshot → `closeContext` in `finally`).
- **`track` / `monitor` flags were silently ignored, and both threw "No baseline found" on first run.** `--selector` → `trackingOptions.customSelectors`; `--threshold` (%) → `trackingOptions.significanceThresholds` (ordered 0-1). `monitor` now uses `operation: 'monitor'` (the interval poller) with `--interval` converted s→ms and `--webhook` → `notificationOptions.webhook`. Both commands now bootstrap a baseline before comparing/polling, so first use works.
- **`llmstxt` flags were no-ops.** `--include-full` → `format` (`both`/`llms-txt`), `--max-pages` → `analysisOptions.maxPages`.
- **`map` flags were no-ops.** `--max-pages` → `max_urls`. Removed `--depth`/`--format` (no backing in `map_site`); added `--no-sitemap`.
- **`actions` flags were no-ops.** `--screenshot` → `captureScreenshots`. Removed `--wait` (no between-action wait field; use `{type:'wait'}` actions in the script).

### Added

- **undici proxy support for the CLI.** Node's global `fetch()` ignores `HTTP(S)_PROXY`, so the CLI's API/scrape calls failed inside sandboxes that only allow proxied egress. `src/cli/index.js` now installs an undici `EnvHttpProxyAgent` global dispatcher when a proxy env var is set (honors `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`; no-op otherwise). Removes the need for a sandbox `excludedCommands` workaround. `undici` is now a direct dependency (pinned to the existing `^7.24.0` security override).

### Tests

- `npm run test:unit` 262/262; `npm test` exits 0. CLI smoke-tested (help/version, proxy dispatcher install, `scrapeWithStealth` presence).

## [4.2.6] - 2026-05-25

Patch release: make `crawlforge-mcp-server <command>` work as the CLI (follow-up to 4.2.5).

### Fixed

- **`crawlforge-mcp-server` bin now points at the CLI** (`src/cli/index.js`), not `server.js`. In 4.2.5 it launched the MCP server, so `crawlforge-mcp-server scrape <url>` (the form documented in `docs/cli-guide.md` and `docs/PRODUCTION_READINESS.md`) ignored its args and hung waiting for a JSON-RPC stream. Because the CLI auto-detects MCP-stdio launches and hands off to the server, this one-line change makes both paths work: `crawlforge-mcp-server scrape <url>` runs the CLI, while `npx -y crawlforge-mcp-server` spawned by an MCP host over stdio still starts the server. `crawlforge-mcp` remains the dedicated direct-to-`server.js` launcher.

## [4.2.5] - 2026-05-25

Patch release: restore the MCP server launch command that v4.1.0 silently broke, and make the documented launch commands actually work.

### Fixed

- **`crawlforge` no longer fails to start the MCP server.** Before v4.1.0 the `crawlforge` bin **was** the MCP server. v4.1.0 repurposed it into the CLI, so MCP clients still configured with `"command": "crawlforge"` received CLI help text instead of a JSON-RPC stream — surfacing in Claude Code / Cursor / Claude Desktop as `Failed to reconnect: -32000`. The CLI now detects MCP-stdio invocation (no subcommand + non-TTY stdin, i.e. how a host spawns it) and hands off to the server. **Existing configs keep working after `npm update` with no edits.** Escape hatch: `CRAWLFORGE_FORCE_CLI=true`.
- **`npx -y crawlforge-mcp-server` now resolves.** The README's Claude Desktop example pointed `npx` at the package, but no bin matched the package name, so npm errored with "could not determine executable to run." Added a matching bin.

### Added

- **`crawlforge-mcp-server` bin** → `server.js`, so `npx -y crawlforge-mcp-server` works (npx resolves the bin whose name matches the package).
- **`crawlforge-mcp` bin** → `server.js`: a dedicated, explicit MCP-server launcher. Because it resolves on `PATH`, it survives Node/nvm version switches (unlike a hard-coded `node /path/to/server.js`). This is what `crawlforge-setup` now writes into MCP client configs.
- **`crawlforge mcp` / `crawlforge serve` subcommand** to start the server by hand from an interactive shell.

### Changed

- **`crawlforge-setup`** now writes `"command": "crawlforge-mcp"` (was `"crawlforge"`) and migrates pre-v4.2.5 configs on re-run.
- **README** MCP config examples corrected; added a "Which launch command?" note.
- Server `serverInfo.version` corrected to track the package version (was pinned at `4.2.2`).

### Tests

- `tests/integration/cli.test.js`: assert `--help` lists `mcp`, and a guarded end-to-end test that drives a full `initialize` handshake through `crawlforge mcp` (skips when no CrawlForge credentials are present, so it never hangs CI).

## [4.2.2] - 2026-05-18

Patch release: CLI bugfix + retracted v4.0.0 breaking-change documentation.

### Fixed

- **`crawlforge batch` CLI command** — user-supplied `--format`, `--concurrency`, and `--max-retries` flags were silently dropped because the command passed `output_format` / `concurrency` / `max_retries` to `BatchScrapeTool.execute()`, but `BatchScrapeSchema` expects `formats` (array) / `maxConcurrency` / `jobOptions.maxRetries`. Zod's strip-mode silently discarded the unknown keys, so the tool always ran with defaults regardless of what was passed on the command line. Now maps to the schema's actual keys.

### Documentation

- **CHANGELOG v4.0.0 retracted** — the "breaking change" to `batch_scrape` defaults was a phantom at the MCP surface (see v4.2.1 postmortem). The v4.0.0 Breaking Changes and Migration Guide sections are now annotated as retracted with the corrected reality inline.

### Added

- Contract test in `tests/unit/tools/advanced/batchScrape.test.js` pins the CLI param shape so the flag-mapping regression can't silently re-appear.

### Internal

- CI workflow (`.github/workflows/ci.yml`) fixed: the quoted glob `"tests/unit/*.test.js"` never expanded in GitHub Actions, causing the unit-tests job to fail in 0s with "Could not find" before running any test. Replaced with `$(find tests/unit -name "*.test.js")` for recursive discovery (now runs 417 tests across 18 files vs. 0 before), added `--test-force-exit` to bypass open-handle hangs in legacy D2 reliability tests, bumped CI Node 20 → 22. Not user-facing; not in the published tarball.

## [4.2.1] - 2026-05-18

Backwards-compatibility fix: neutralize the v4.0.0 "breaking change" to `batch_scrape` defaults.

### Fixed

- **`batch_scrape` default formats** — Aligned the internal `BatchScrapeSchema` default from `['markdown']` back to `['json']` to match the MCP-facing default at `server.js:544`. The v4.0.0 release notes flagged this as a breaking change, but in practice the MCP tool registration always defaulted to `['json']` — the inner-schema mismatch only ever affected direct programmatic callers of `BatchScrapeTool.execute()`, never MCP clients (Claude Code, Cursor, the CLI). v4.2.1 closes the latent gap so the two layers agree. **No migration needed for any caller.** Markdown output remains a single-line opt-in via `formats: ['markdown']` (or `['markdown','json']` for both).

### Added

- Regression tests in `tests/unit/tools/advanced/batchScrape.test.js` pinning `BatchScrapeSchema` defaults so this mismatch can't silently re-appear: `default formats is ['json']`, `preserves explicit ['markdown']`, `preserves explicit ['markdown','json']`. 10/10 tests green.

### Migration Guide

If you upgraded from v3.x to v4.0.0–v4.2.0 via the MCP interface: **nothing changes**, you were never affected. If you import `BatchScrapeTool` directly and call `.execute({urls:[...]})` without specifying `formats`: you now get `content.json` again (matches v3.x). To get the markdown-first behavior promised in D3.1, pass `formats: ['markdown']` explicitly — the Turndown converter, `extract_text` markdown mode, `extract_content` markdown mode, and `process_document` markdown mode are all unchanged.

## [4.2.0] - 2026-05-18

Phase D5.2 + D5.3 — Per-tool unit tests and docs refresh. Additive release: no API changes.

### Added

**D5.2 Per-tool unit tests (17 new test files)**
- `tests/unit/tools/extract/extractContent.test.js` — 8 tests
- `tests/unit/tools/extract/processDocument.test.js` — 7 tests
- `tests/unit/tools/extract/analyzeContent.test.js` — 8 tests
- `tests/unit/tools/extract/summarizeContent.test.js` — 8 tests
- `tests/unit/tools/extract/extractStructured.test.js` — 7 tests
- `tests/unit/tools/extract/listOllamaModels.test.js` — 7 tests (with injectable fetch stub)
- `tests/unit/tools/research/deepResearch.test.js` — 9 tests (elicitation, session tracking)
- `tests/unit/tools/search/searchWeb.test.js` — 7 tests (cache, expander, provider)
- `tests/unit/tools/crawl/crawlDeep.test.js` — 7 tests (elicitation for >500 pages)
- `tests/unit/tools/crawl/mapSite.test.js` — 8 tests (sitemap parse, group_by_path, cache)
- `tests/unit/tools/advanced/batchScrape.test.js` — 7 tests (elicitation, jobManager integration)
- `tests/unit/tools/advanced/scrapeWithActions.test.js` — 8 tests (page.close() leak check)
- `tests/unit/tools/stealth/stealthMode.test.js` — 7 tests (camoufox/playwright engine)
- `tests/unit/tools/localization/localization.test.js` — 8 tests (geo-block, translation)
- `tests/unit/tools/tracking/trackChanges.test.js` — 8 tests (diff, monitoring lifecycle)
- `tests/unit/tools/llmstxt/generateLLMsTxt.test.js` — 9 tests (format modes)
- `tests/unit/tools/templates/scrapeTemplate.test.js` — 8 tests (list mode, HTTP errors)
- Total new tests: 131 — all green. No new npm dependencies (uses node:test + stubs).

**D5.3 Docs refresh**
- `docs/local-ollama-quickstart.md` — Ollama install, model selection, env vars, Docker, troubleshooting
- `docs/docker-deployment.md` — build, run, compose, Render deploy, health check, volumes
- `docs/observability-setup.md` — Prometheus metrics table, OTel spans, Winston log levels, Grafana dashboard import, alerting rules
- `tests/docs/example-runner.js` — validates README JSON and shell code blocks for syntax (no live network)

**Verified existing docs present from earlier phases:** `docs/mcp-resources-prompts.md`, `docs/cli-guide.md`, `docs/stealth-engines.md`, `docs/cloud-browser.md`

### Changed

- `IMPROVEMENT_ROADMAP_V4.md` header updated: version 4.0.0 → 4.1.0, status → ALL PHASES COMPLETE
- Carry-forward items noted at bottom of roadmap: D2.8 customDNS, D2.11 24h load test, D5.1 ESLint + Docker CI

## [4.1.0] - 2026-05-18

Phase D4 - CLI (PRD Phase 2) + Skills Installer (PRD Phase 3). Additive release: no breaking changes to existing MCP tools or API.

### Added

**D4.1 CLI scaffolding**
- `commander` added to dependencies.
- `"bin": { "crawlforge": "src/cli/index.js" }` in `package.json` — `crawlforge` command available after `npm install -g`.
- `src/cli/index.js` — main entry point with global flags: `--json`, `--pretty`, `--quiet`, `--api-key`, `--timeout`.
- `src/cli/formatter.js` — shared output formatter; formats MCP tool `content[]` responses for CLI output.
- `src/cli/lib/runTool.js` — thin wrapper calling tool `execute()` and formatting output per global flags.

**D4.2 CLI commands (15 tool commands)**
- `scrape <url>` — wraps `fetch_url` (default) or `extract_content` with `--extract` flag.
- `search <query>` — wraps `search_web`; supports `--limit`, `--lang`, `--provider`.
- `crawl <url>` — wraps `crawl_deep`; supports `--depth`, `--max-pages`, `--concurrency`.
- `map <url>` — wraps `map_site`; supports `--format json|xml`.
- `extract <url>` — wraps `extract_structured` (with `--schema`) or `extract_with_llm` (with `--prompt`).
- `track <url>` — wraps `track_changes`; supports `--selector`, `--threshold`.
- `analyze <url>` — wraps `analyze_content`; supports `--depth`.
- `research <topic>` — wraps `deep_research`; supports `--depth`, `--max-urls`, `--output-format`.
- `stealth <url>` — wraps `stealth_mode`; supports `--engine playwright|camoufox`, `--screenshot`.
- `batch <urls-file>` — wraps `batch_scrape`; reads newline-delimited URLs from file.
- `actions <url> --script <file>` — wraps `scrape_with_actions`; reads JSON action script from file.
- `localize <url>` — wraps `localization`; supports `--locale`, `--country`, `--currency`.
- `llmstxt <url>` — wraps `generate_llms_txt`; supports `--include-full`, `--max-pages`.
- `template <id> <target>` — wraps `scrape_template`; `--list` shows all 10 templates.
- `monitor <url>` — wraps `track_changes` in scheduled mode; supports `--interval`, `--webhook`.

**D4.3 Skills installer (2 management commands)**
- `src/skills/installer.js` — `install()` and `uninstall()` functions; idempotent, supports `--force` and `--dry-run`.
- `install-skills [--target=claude-code|cursor|vscode|all]` — copies skill files to target AI coding tool.
- `uninstall-skills [--target=...]` — removes installed skill files.
- Skill files in `src/skills/`:
  - `crawlforge-mcp.md` — overview of all 23 MCP tools with credit reference and example calls.
  - `crawlforge-cli.md` — full CLI usage guide with examples for all 17 commands.
  - `crawlforge-stealth.md` — stealth_mode engine selection guide.
  - `crawlforge-research.md` — deep_research workflow, depth levels, cost management.
- Claude Code target: `~/.claude/skills/crawlforge-*.md` (one file per skill).
- Cursor target: `.cursor/rules/crawlforge.mdc` (concatenated).
- VS Code target: `.github/instructions/crawlforge.instructions.md` (concatenated).

### Tests
- `tests/integration/cli.test.js` — 6 tests: `--help` coverage for all 15 commands + skills commands, dry-run path verification for all 3 targets, version semver format.

### Docs
- New: `docs/cli-guide.md` — complete CLI reference with all 17 commands, flags, and examples.
- Updated: `docs/PRODUCTION_READINESS.md` — CLI availability noted.
- Updated: `IMPROVEMENT_ROADMAP_V4.md` — D4 marked complete.
- Updated: `PRD.md` — Phase 2 (CLI) and Phase 3 (Skills) marked done.


The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2026-05-18

Phase D3 - Competitive Feature Parity. ~~**Breaking change:** batch_scrape now defaults to markdown output (was json).~~ **Retracted in v4.2.1** — see note below. Adds scrape_template tool (23 tools total). Turndown HTML-to-Markdown converter. Camoufox Firefox-based stealth engine. BrowserBase cloud backend. Cost transparency in all tool responses.

> **Postmortem (added in v4.2.1):** the v4.0.0 "breaking change" to `batch_scrape` defaults was a phantom at the MCP surface. The MCP tool registration in `server.js:544` always defaulted `formats` to `['json']`; only the inner `BatchScrapeSchema` defaulted to `['markdown']`. Because params are validated at both layers and the MCP layer wins, MCP clients (Claude Code, Cursor, the `crawlforge` CLI) were never broken. The mismatch only ever affected direct programmatic callers of `BatchScrapeTool.execute()`. v4.2.1 aligned the inner schema to `['json']` to remove the latent gap. **No migration is needed for any caller — the section below describes a migration that was never actually required.**

### ~~Breaking Changes~~ (retracted in v4.2.1)

- ~~**batch_scrape** default `formats` changed from `["json"]` to `["markdown"]`. Callers that depend on `content.json` from batch results must now pass `formats: ["json"]` explicitly.~~ Reality: the MCP-facing default never changed; v4.2.1 aligned the inner schema to `['json']` to match.
- **server version** bumped 3.6.0 to 4.0.0.

### ~~Migration Guide~~ (not required — see postmortem above)

~~If you use `batch_scrape` without specifying `formats`, your response shape changes:~~
- ~~Before (v3.x): `result.results[n].content.json`~~
- ~~After (v4.0): `result.results[n].content.markdown`~~
- ~~To keep old behavior: pass `formats: ["json"]` explicitly.~~

Reality after v4.2.1: `content.json` continues to be the MCP default exactly as in v3.x. Pass `formats: ['markdown']` to opt into RAG-friendly markdown output.

### Added

**D3.1 Markdown-first output (Turndown) — additive only after v4.2.1**
- New utility `src/utils/htmlToMarkdown.js` wraps Turndown with sensible RAG-optimized defaults (atx headings, fenced code blocks, boilerplate removal).
- `extract_text`: new `output_format: "markdown"` parameter (default: "text").
- `extract_content`: `outputFormat: "markdown"` now uses Turndown instead of regex-based conversion.
- `process_document`: `outputFormat: "markdown"` added to enum (new option).
- `batch_scrape`: markdown output available via `formats: ['markdown']` (was framed as a default-change in v4.0.0; v4.2.1 confirms it's purely opt-in at the MCP surface).
- turndown added to dependencies.

**D3.2 Camoufox browser engine**
- `src/core/StealthBrowserManager.js`: new `BrowserEngine` abstract class + `CamoufoxAdapter` implementation.
- `stealth_mode` tool: new `engine: "playwright" | "camoufox"` parameter (default: "playwright").
- Camoufox adapter gracefully fails with actionable error when package not installed.
- Licensing verified: camoufox JS API is MIT, Firefox patches are MPL-2.0 (no AGPL).
- Benchmark methodology documented in `docs/stealth-engines.md`.
- New doc: `docs/stealth-engines.md`.

**D3.3 Pre-built site templates**
- New `src/tools/templates/TemplateRegistry.js` with 10 templates: amazon-product, linkedin-profile, github-repo, youtube-video, tweet, reddit-thread, hacker-news-front-page, producthunt-launch, stackoverflow-question, npm-package.
- New `src/tools/templates/ScrapeTemplateTool.js` wrapping the registry.
- New `scrape_template` tool registered in server.js (tool count: 22 to 23).
- Fixture stubs in `tests/integration/templates/fixtures.js` for all 10 templates.
- Credit cost: 1 credit per invocation (same as fetch_url).

**D3.4 Cloud browser backend (BrowserBase)**
- `src/core/StealthBrowserManager.js`: new `BrowserBackend` abstract class, `LocalPlaywrightBackend`, `BrowserBaseBackend` (CDP), and `resolveBrowserBackend()` factory.
- Env config: `CRAWLFORGE_BROWSER_BACKEND=local|browserbase`, `BROWSERBASE_API_KEY`.
- Graceful fallback: if browserbase requested but BROWSERBASE_API_KEY not set, logs warning and falls back to local.
- New doc: `docs/cloud-browser.md`.

**D3.5 Cost transparency**
- `src/core/AuthManager.js`: new `projectCost(toolName, params)` method returning `{ projected, note }`.
- `src/server/withAuth.js`: all successful tool responses include `_cost: { projected, actual, remaining_credits, projection_note }` injected into the first JSON content item.
- Dynamic tools (deep_research, crawl_deep, batch_scrape) return lower-bound estimates with accuracy caveats in `projection_note`.

### Changed
- server.js: version bumped to 4.0.0; description updated to 23 tools; scrape_template registered.
- package.json: version bumped to 4.0.0; turndown added to dependencies.

### Verification
- `node --check server.js` and all modified src files: no syntax errors.
- `npm test` (MCP protocol compliance): 60% pass rate - unchanged from pre-D3 baseline.
- `node --test tests/unit/withAuth.test.js`: 9/9 pass.
- `node --test tests/unit/authManager.test.js`: 6/6 pass.

## [3.6.0] - 2026-05-18

Phase D1 — MCP-Native Primitives. CrawlForge is now a first-class MCP server, not just a tool host.

### Added

**D1.1 Resources** — `crawlforge://` URI scheme for long-lived artifacts:
- Created `src/resources/ResourceRegistry.js` with URI parsing, MIME types, and TTL-based in-memory storage.
- Registered `ResourceTemplate` patterns in `server.js` for all 5 resource types: `crawlforge://research/{sessionId}`, `crawlforge://job/{jobId}`, `crawlforge://crawl/{sessionId}/sitemap`, `crawlforge://screenshot/{actionId}`, `crawlforge://snapshot/{urlHash}/{timestamp}`.
- 20 unit tests in `tests/unit/resources/resourceRegistry.test.js` — all green.
- Documented URI scheme and TTL policy in `docs/mcp-resources-prompts.md`.

**D1.2 Prompts** — 5 pre-built workflow prompts (plus existing `getting-started`):
- Created `src/prompts/PromptRegistry.js` with 5 prompts: `competitive-analysis`, `monitor-changes`, `rag-ingest`, `site-audit`, `research-deep-dive`.
- Wired `prompts/list` and `prompts/get` in `server.js` via `server.registerPrompt()`.
- Server now advertises `prompts.listChanged: true` capability.

**D1.3 Sampling** — LLM fallback chain removes requirement for server-side API keys:
- Created `src/core/SamplingClient.js` with `complete()` (Ollama → OpenAI → Anthropic → MCP sampling → error) and `probe()` to check available providers.
- `extract_with_llm`: when Ollama is unavailable and no API key set, tries MCP client sampling before returning an error.
- `summarize_content`: abstractive mode now attempts Ollama/API/sampling before falling back to extractive output.
- `extract_structured` and `deep_research`: SamplingClient integrated as last-resort LLM provider.

**D1.4 Elicitation** — mid-tool user confirmation for expensive/ambiguous operations:
- Created `src/core/ElicitationHelper.js` with `confirm()` and `requestString()` — fails open when client lacks elicitation support.
- `deep_research`: prompts user before scanning >50 URLs.
- `batch_scrape`: confirms large synchronous batches (>25 URLs in sync mode).
- `crawl_deep`: confirms crawls exceeding 500 pages.
- `extract_structured`: warns when schema has >3 required fields and LLM is unavailable.
- `AuthManager`: elicits confirmation when remaining credits fall below projected cost (replaces hard-fail).
- All tools expose `setMcpServer()` to wire elicitation post-instantiation.

**D1.5 Tool description audit** — all 22 tool descriptions rewritten to lead with *when to use*:
- Every `description` field now starts with "Use this when..." followed by specific scenarios.
- Example invocations embedded in each description.
- Descriptions updated for: fetch_url, extract_text, extract_links, extract_metadata, scrape_structured, search_web, crawl_deep, map_site, extract_content, process_document, summarize_content, analyze_content, extract_structured, extract_with_llm, list_ollama_models, batch_scrape, scrape_with_actions, deep_research, track_changes, generate_llms_txt, stealth_mode, localization.

### Changed
- `server.js`: version bumped 3.5.1 → 3.6.0; description updated to mention Resources, Prompts, Sampling, Elicitation.
- `package.json`: version bumped to 3.6.0.
- Server now correctly advertises `resources.listChanged: true` and `prompts.listChanged: true` MCP capabilities.

### Verification
- `node --check server.js` and all modified src files: no syntax errors.
- `npm test` (MCP protocol compliance): 60% pass rate — unchanged from pre-D1 baseline (pre-existing compliance test issues unrelated to D1).
- `node --test tests/unit/resources/resourceRegistry.test.js`: **20/20 PASS**.
- `node --test tests/unit/d2-reliability.test.js`: **16/17 pass** (1 cancelled due to pre-existing pending promise issue in test harness — same as before D1).
- `ResourceTemplate` registered correctly: server capabilities response now includes `resources.listChanged: true`.

## [3.4.0] - 2026-05-18

Adds local-LLM support to `extract_with_llm` via Ollama. Cloud users see zero behavior change — the addition is strictly opt-in.

### Added
- **Ollama provider for `extract_with_llm`.** Set `provider: "ollama"` (or `provider: "auto"` with `OLLAMA_BASE_URL` env var) to extract using a local Ollama model — no API key, no API costs, no data leaving the machine.
  - Default base URL `http://localhost:11434`; default model `llama3.2` (override via `OLLAMA_DEFAULT_MODEL` env or the `model` param).
  - Calls Ollama's `/api/chat` directly with `stream: false`, `temperature: 0`, `num_predict: maxTokens`. Zero new runtime deps — same raw-`fetch()` pattern as the OpenAI/Anthropic branches.
  - JSON mode by default (`format: "json"`). When the optional `schema` param is provided, it is passed through as Ollama's structured-outputs `format` object, constraining the model to that JSON schema (per <https://ollama.com/blog/structured-outputs>).
  - Provider resolution: `provider: "ollama"` always selects Ollama (no key required). `provider: "auto"` keeps the existing Anthropic → OpenAI order and only falls back to Ollama when neither cloud key is set **and** `OLLAMA_BASE_URL` is exported — guaranteeing no behavior change for existing cloud users.
  - Friendly error on `ECONNREFUSED` / `ENOTFOUND`: surfaces `Ollama is not running at <url>. Start it with "ollama serve" and pull a model: "ollama pull llama3.2".` instead of a raw fetch error. Friendly error on `404 model not found` instructs `ollama pull <model>`.
  - Usage normalized: Ollama's `prompt_eval_count` / `eval_count` mapped to the uniform `{ input_tokens, output_tokens }` shape used by the OpenAI/Anthropic branches.
- 8 new unit tests in `tests/unit/extractWithLlm.test.js` (22 total, all pass): explicit-ollama path, JSON-mode body shape, schema → structured-outputs pass-through, ECONNREFUSED → friendly error, usage normalization, auto-fallback rules (no behavior change for cloud users), model override.

### Changed
- `server.js` — `extract_with_llm` provider enum extended to `["openai", "anthropic", "ollama", "auto"]`; tool description updated to mention local Ollama support and clarify that Ollama needs no key.

### Verification
- `node --test tests/unit/extractWithLlm.test.js`: **22/22 PASS**.
- `npm test` MCP protocol compliance: 10/10 tests completed, 0 errors — unchanged from HEAD baseline.
- **Live end-to-end against real Ollama 0.24.0 with `llama3.2:latest`**: 3/3 scenarios pass — plain JSON mode (extracted product/price/screen-size from "iPhone 16 Pro" text), structured-outputs schema (nested order with line-items array), and `provider: "auto"` fallback via `OLLAMA_BASE_URL`.

## [3.3.1] - 2026-05-17

Two pre-existing bugs surfaced during the full out-of-sandbox verification of the v3.3.0 release. Neither was caused by Phase C5 — both reproduce on the v3.2.0 commit. They were masked respectively by a populated LRU cache hit (bug #1) and by CI environments lacking the maintainer `.env` (bug #2).

### Fixed
- **`search_web` "Converting circular structure to JSON → Timeout" crash.** `ResultRanker` and `ResultDeduplicator` constructors spread `...options` (which includes `sharedCache`, a `CacheManager` instance holding a `setInterval` monitoring Timer) into `this.options`. Cache-key generation later called `JSON.stringify` on that options object, hitting a circular reference through `Timer → TimersList → Timer`. Fix: destructure `sharedCache` out before the spread so it lives in `this.cache` only — never in the serializable `this.options`. Inline comment added at both constructors so a future refactor doesn't reintroduce the bug. (`src/tools/search/ranking/ResultRanker.js`, `src/tools/search/ranking/ResultDeduplicator.js`)
- **`endpointGuard.test.js` "creator mode OFF" test was premise-unsatisfiable on the maintainer's machine.** `creatorMode.js` loads `.env` at module init and caches the verified flag in a module-scoped variable that is immutable from outside (by design — security note in that file). The test tried to disable creator mode by `delete process.env.CRAWLFORGE_CREATOR_SECRET` at test time, which has no effect once the module has loaded. Fix: have the test `t.skip()` with a clear rationale when `isCreatorModeVerified()` returns true — the test's other 7 assertions still run unconditionally. (`tests/unit/endpointGuard.test.js`)

### Verification (clean tree, no sandbox)
- `node test-tools.js`: **20/20 PASS** (was 19/20 — search_web fixed)
- `node --test tests/unit/*.test.js`: 240 tests — **227 pass, 0 fail, 13 skipped** (was 227 pass, 1 fail, 12 skipped)
- `node --test tests/unit/streamableHttp.test.js`: **12/12 pass** (was sandbox-blocked by EPERM listen on 127.0.0.1)
- `npm test` MCP protocol compliance: 70% — unchanged from HEAD baseline
- `npm audit`: **0 vulnerabilities**

## [3.3.0] - 2026-05-17

Ships Phase C5 "Feature parity" of `IMPROVEMENT_PLAN.md`. Adds one new MCP tool (`extract_with_llm`, bringing the total to 21) and extends three existing tools with capabilities at parity with Firecrawl, Crawl4AI, and ScrapeGraphAI. All changes are strictly additive — every existing call signature behaves exactly as in v3.2.0.

### Added
- **New tool `extract_with_llm`** — natural-language structured extraction over a URL or pre-fetched content. Gated on `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`; `provider: 'auto'` picks Anthropic first then OpenAI. Dependency-free direct `fetch()` to `/v1/chat/completions` (OpenAI) or `/v1/messages` (Anthropic). Optional `schema` JSON-schema hint; defensive JSON parse with single retry; uniform `{ input_tokens, output_tokens }` usage shape across providers. Endpoints overridable via `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` for self-hosted gateways. Costs 5 credits.
- **`scrape_with_actions` recording & replay** — Firecrawl-style action recording. New input fields `record: boolean` + `recordingName: string` persist the executed action chain as JSON to `~/.crawlforge/recordings/<name>.json` (atomic `.tmp` + rename write). New `replayRecording: string` loads and re-executes a saved recording against a fresh URL. Special `replayRecording: '__list__'` returns the recordings index without a new tool. `recordingName` validated against `/^[a-zA-Z0-9_-]{1,64}$/` (path-traversal blocked). Home dir overridable via `CRAWLFORGE_HOME_OVERRIDE` for testing.
- **`crawl_deep` session reuse** — Crawl4AI-style cookie + header persistence across every page of a crawl. New optional `session: { enabled, persistCookies?, headers?, initialRequest? }`. With `enabled: true`, an in-memory cookie jar (hand-rolled, zero new deps, uses Node 18+ `Headers.getSetCookie()` for multi-value correctness) captures every `Set-Cookie` response and replays cookies on every subsequent fetch. `session.headers` merged into every request. Optional `session.initialRequest` performs a pre-crawl login (or any HTTP request) and seeds the jar before traversal starts. Backward compatible — omit `session` for v3.2.0 behavior.
- **`search_web` SearXNG provider** — new optional `provider: 'crawlforge' | 'searxng'` (default `'crawlforge'`). With `provider: 'searxng'`, queries route to a self-hosted SearXNG instance specified by `CRAWLFORGE_SEARXNG_URL` (e.g. `http://localhost:8888`). SearXNG JSON results are normalised to the same shape as the CrawlForge backend (`title→title`, `url→link/displayLink/formattedUrl`, `content→snippet/htmlSnippet`) so the existing ranking + deduplication pipeline runs unchanged. Errors clearly when `CRAWLFORGE_SEARXNG_URL` is unset or the upstream returns non-200.
- `src/tools/extract/extractWithLlm.js` — main tool class. 14 unit tests in `tests/unit/extractWithLlm.test.js` covering provider auto-pick, error when no key, JSON parse success + retry, URL fetch path, content-direct path, schema hint pass-through, token-usage normalization, OpenAI + Anthropic stubs.
- `src/tools/advanced/scrapeWithActions/recorder.js` — recording persistence helpers (`saveRecording`, `loadRecording`, `listRecordings`, `validateRecordingName`, `buildRecordedEntry`). 12 unit tests in `tests/unit/scrapeWithActionsRecording.test.js`.
- `src/tools/crawl/_sessionContext.js` — `SessionContext` class (cookie jar + session headers + `performInitialRequest`). 12 unit tests in `tests/unit/crawlDeepSession.test.js`.
- `src/tools/search/providers/searxng.js` — SearXNG adapter (`searchViaSearxng`, `normalizeSearxngResult`). 12 unit tests in `tests/unit/searchWebSearxng.test.js`.

### Changed
- `server.js` — registered `extract_with_llm`; tool count strings bumped 20 → 21.
- `src/core/AuthManager.js` `getToolCost()` — added `extract_with_llm: 5`.
- `src/tools/advanced/ScrapeWithActionsTool.js` — schema extended with `record` / `recordingName` / `replayRecording`; `executeSession()` captures recorded entries when recording is on; `execute()` short-circuits to listing / replay when those flags are set.
- `src/tools/crawl/crawlDeep.js` + `src/core/crawlers/BFSCrawler.js` — `SessionContext` plumbed into the BFS crawler; per-request session headers + cookies are layered before `fetch()` and the response's `Set-Cookie` is recorded back into the jar.
- `src/tools/search/searchWeb.js` — `provider` field added to `SearchWebSchema`; `_executeViaSearxng()` short-circuits when `provider === 'searxng'`.
- `package.json` 3.2.0 → 3.3.0; description "20" → "21".

### Test results (this release)
- 50 new unit tests across 4 new files — **50/50 pass** in `node --test`.
- Full unit suite: 240 tests, 227 pass, 12 skipped (sandbox-only HTTP listen restrictions on `streamableHttp.test.js`), 1 pre-existing `endpointGuard.test.js` failure unrelated to C5 (also fails on the v3.2.0 commit).
- `node test-tools.js`: 19/20 pass; the 1 failure (`search_web`) is a pre-existing sandbox network flake — same failure reproduces on the v3.2.0 baseline once the local search cache is cleared.
- `npm test` (MCP protocol compliance): unchanged from HEAD baseline (70% success rate).
- `npm audit`: **0 vulnerabilities**.

### Notes
- All four C5 items were implemented in parallel by four `mcp-implementation` sub-agents working on non-overlapping files. The lead handled `server.js` registration, version bookkeeping, and integration verification.

## [3.2.0] - 2026-05-17

Ships Phase C "Modernize" of `IMPROVEMENT_PLAN.md` end-to-end. Closes the protocol/feature gap with Firecrawl, Crawl4AI, and Bright Data MCP. No tool schema or public API changes for existing stdio users — strictly additive.

### Added
- `src/server/transports/streamableHttp.js` — stateful Streamable HTTP transport (MCP spec 2025-06-18). Sessions via `Mcp-Session-Id` header (request + response). Single `/mcp` endpoint handles POST (JSON or SSE) and GET (SSE) per spec. Built on `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk@1.29`.
- `src/server/auth/oauth.js` — OAuth 2.1 authorization server (~350 LOC, zero new runtime deps). Discovery (`/.well-known/oauth-authorization-server`), Dynamic Client Registration (RFC 7591) at `/oauth/register`, Authorization Code + PKCE S256 at `/oauth/authorize`, token issuance + refresh rotation at `/oauth/token`, revocation (RFC 7009) at `/oauth/revoke`. Bearer tokens are opaque and mapped server-side to the operator's CrawlForge API key.
- `src/observability/metrics.js` — minimal Prometheus exposition (counters, gauges, histograms). Exposes `crawlforge_tool_requests_total`, `crawlforge_tool_errors_total{error_class}`, `crawlforge_tool_duration_ms` (histogram), `crawlforge_credits_consumed_total`, `crawlforge_browser_pool_in_use`, `crawlforge_browser_pool_capacity`.
- `src/observability/tracing.js` — OpenTelemetry tracing facade. No-op unless `OTEL_SDK_DISABLED=false` AND `globalThis.__otelTracer` is registered by the host application. Span attributes: `mcp.tool.name`, `mcp.tool.duration_ms`, `mcp.tool.outcome`, `mcp.credit.cost`, `mcp.credit.outcome`, `mcp.creator_mode`.
- `dualOutput()` helper in `src/server/registerTool.js` for tool handlers that want to emit both legacy `content` and MCP-2025-06-18 `structuredContent` from one value.
- `outputSchema` option on `registerTool()` — opt-in MCP structured outputs (validated server-side by the SDK against the supplied Zod shape).
- `--legacy-http` / `CRAWLFORGE_LEGACY_HTTP=true` — preserves v3.1 stateless HTTP behaviour for one release; emits a deprecation warning at startup.
- Environment knobs (all opt-in): `CRAWLFORGE_OAUTH_ENABLED`, `CRAWLFORGE_OAUTH_ISSUER`, `CRAWLFORGE_METRICS`, `CRAWLFORGE_LEGACY_HTTP`.
- `docs/oauth-quickstart.md` — copy-pasteable Node sample client covering register → authorize → exchange → refresh → `/mcp`.
- `docs/observability/grafana-dashboard.json` — six-panel dashboard (requests/sec, errors/sec, p50/p95 duration, credits/sec, browser pool utilization).
- `tests/unit/oauth.test.js` (12 cases) — discovery shape, DCR validation, full PKCE flow, wrong-verifier rejection, `plain` rejection, refresh rotation + replay protection, revocation.
- `tests/unit/streamableHttp.test.js` (12 cases) — `/health`, `/metrics`, server-card, `/mcp` 401 paths, creator-mode bypass, OAuth pass-through, OPTIONS preflight, unknown path.
- `tests/unit/metrics.test.js` (6 cases) — counter / gauge / histogram correctness + label escaping.
- `tests/unit/tracing.test.js` (7 cases) — gating logic, no-op span when disabled, attribute writes when enabled.
- `tests/unit/registerTool.test.js` (4 cases) — `outputSchema` forwarding + `dualOutput` shape.
- `tests/unit/withAuth.test.js` — three new cases for metrics integration (success counter + credits, error counter + `error_class`, no-op when registry not passed).

### Changed
- `server.js`: wires new Streamable HTTP transport (default in `--http`), OAuth provider when `CRAWLFORGE_OAUTH_ENABLED=true`, Prometheus registry when `CRAWLFORGE_METRICS=true`. Version string bumped 3.0.19 → 3.2.0.
- `src/server/transports/http.js`: now a 20-line back-compat shim that forwards to `connectStreamableHttp({ legacy: true })`.
- `src/server/withAuth.js`: emits Prometheus counter + histogram + credits-consumed on every invocation when a registry is passed; emits an OTel span when tracing is enabled. Both are wrapped in try/catch so they can't break the request path.
- `src/server/registerTool.js`: accepts and forwards `outputSchema`; exports `dualOutput`.
- `package.json`: version 3.1.0 → 3.2.0.
- `docs/PRODUCTION_READINESS.md`: version bump + dedicated Streamable HTTP endpoint table.

### Deferred (documented in `IMPROVEMENT_PLAN.md` § C5)
- Firecrawl-style action recording/replay for `scrape_with_actions`
- Crawl4AI-style session reuse in `crawl_deep`
- New `extract_with_llm` tool (LLM-gated)
- `provider: 'crawlforge' | 'searxng'` switch on `search_web`

The plan explicitly says "pick based on user demand". No user requests for these in the v3.1 window — leaving `[ ]` rather than building speculatively. All remain independently shippable.

### Notes
- Adding `outputSchema` to each of the 20 existing tool registrations is intentionally a follow-up. The framework, helper, and tests are in place — per-tool schema rollout will get its own review pass.

## [3.1.0] - 2026-05-17

Ships Phase B "Refactor" of `IMPROVEMENT_PLAN.md` end-to-end. No public-API or tool-schema changes — strictly internal restructuring, bounded browser pool, and a real test suite. All 20 MCP tools continue to pass.

### Added
- `src/server/registerTool.js` — single tool-registration helper that wraps every handler with `withAuth`. Replaces 20 near-identical registration blocks in `server.js`.
- `src/server/schemas/common.js` — shared Zod fragments (`urlSchema`, `paginationSchema`, `webhookSchema`, `cacheOptsSchema`).
- `src/server/transports/stdio.js` and `src/server/transports/http.js` — transport setup extracted from `server.js`.
- `src/tools/basic/` — 5 inline basic-tool handlers (`fetchUrl`, `extractText`, `extractLinks`, `extractMetadata`, `scrapeStructured`) moved out of `server.js`, plus a shared `_fetch.js` helper.
- `src/core/BrowserContextPool.js` (187 LOC) — bounded pool with capacity cap, idle eviction, periodic refresh, and a wait queue with timeout. Used by `StealthBrowserManager` instead of an unbounded `Map`. Defaults: `MAX_BROWSER_CONTEXTS=10`, refresh every 200 acquisitions or 30 minutes, `closeIdleAfterMs=300000`.
- `src/tools/tracking/trackChanges/{schema,monitor,differ,notifier,index}.js` — 1,377 LOC tool split into 5 files; root `trackChanges.js` is now a 15-line re-export shim.
- `src/tools/advanced/batchScrape/{schema,queue,worker,reporter,index}.js` — 1,089 LOC tool split into 5 files; reuses `JobManager` and `WebhookDispatcher` instead of embedding them. Root `BatchScrapeTool.js` is now a 15-line re-export shim.
- `src/tools/search/ranking/SearchResultCache.js` — single shared cache passed to `ResultRanker` and `ResultDeduplicator` via `sharedCache` option (was two separate `CacheManager` instances).
- `src/tools/extract/_fetchAndParse.js` — shared fetch + Cheerio parse helper used by `extractStructured`.
- `CacheManager` integration in `crawlDeep` and `mapSite` for fetch deduplication.
- `tests/unit/browserContextPool.test.js` (18 tests) — pool capacity, idle eviction, refresh interval, queue timeout, destroy semantics.
- `tests/unit/changeTracker.test.js` (33 tests) — `diff()` granularity matrix, text/structure/visual change detection, threshold gating.
- `tests/unit/jobManager.test.js` (28 tests) — lifecycle, validateJob, generateJobId, stats, destroy.
- `tests/unit/snapshotManager.test.js` (21 tests) — create/restore, gzip compression path, list/cleanup.
- `tests/unit/webhookDispatcher.test.js` (21 tests) — dispatch, retries, signing, queue draining.
- `tests/integration/tools/basicTools.test.js` (17 tests) — happy-path + invalid-input assertions for all 5 basic-tool handlers.
- `tests/integration/tools/schemas.test.js` (28 tests) — Zod schema acceptance/rejection for `BatchScrape`, `TrackChanges`, `UrlConfig`, plus `SearchResultCache` behaviour.
- `tests/integration/tools/batchScrape.test.js` (8 tests) — internal `scrapeUrl` worker contract.
- `npm run test:coverage` — c8 coverage script with a 60% line/statement gate (45% branch / 55% function). Reports 64.3% lines, 60.7% functions, 74.9% branches across `src/`.
- `npm run test:integration` — convenience script for `tests/integration/tools/*.test.js`.

### Changed
- `server.js`: **2,138 → 990 LOC** (54% reduction). All tool registrations now flow through `registerTool()`; transport selection delegated to `src/server/transports/*`.
- `src/core/StealthBrowserManager.js`: context storage swapped from raw `Map` to `BrowserContextPool`. Context limit, refresh, and idle eviction now bounded.
- `src/core/cache/CacheManager.js`: `cleanupTimer` and `monitoringTimer` now `.unref()` so they don't block process exit in short-lived CLI/test runs.
- `src/core/JobManager.js`: `validateJob()` now returns a strict boolean (was returning the falsy operand from `&&` short-circuit, breaking strict-equality tests).
- `src/tools/search/searchWeb.js`: ranker and deduplicator share one `SearchResultCache` instance instead of holding separate `CacheManager`s.
- `package.json`: version bumped 3.0.19 → 3.1.0.

### Fixed
- `JobManager.validateJob(null)` previously returned `null`; now returns `false` as the docstring implies.

### Deferred (documented in `IMPROVEMENT_PLAN.md` § B4 / B5)
- "Wire coverage gate into CI" — no CI workflow exists in this repo. Local gate is enforced via `npm run test:coverage`.
- "`npm run docker:prod` boots" — Docker is unavailable in the sandboxed verification environment; Dockerfile/compose unchanged from v3.0.19 green baseline.
- "1,000-call soak test" — requires real Chromium launches and outbound network blocked by sandbox; `BrowserContextPool` unit tests cover the bounded-pool / idle-eviction / refresh behaviour the soak test was meant to validate.

## [3.0.19] - 2026-05-17

### Security
- **HIGH:** HTTP transport (`--http`) now requires `Authorization: Bearer <api-key>` (or `X-API-Key`) on every `/mcp` request — closes audit phase 4. Unauthenticated requests return 401 and emit a structured warning log. Creator mode bypasses the check. `/health` and `/.well-known/mcp/server-card.json` remain unauthenticated for discovery.
- **MEDIUM:** Stored API key is re-validated against the backend at startup — closes audit phase 5. If the backend explicitly rejects the key (invalid / revoked / expired / unauthorized), the server throws and refuses to boot. Network failures are tolerated. `CRAWLFORGE_SKIP_STARTUP_VALIDATION=true` bypasses.
- Phase 6 (config HMAC) is formally deferred until the backend gains support; tracked in `docs/PRODUCTION_READINESS.md`.

### Added
- `src/server/withAuth.js` — tool-handler wrapper extracted from `server.js` for unit-testability.
- Structured `tool invocation` log line on every MCP tool call: `{ toolName, paramHash, durationMs, outcome, creditCost, creatorMode }`. `paramHash` is a 12-hex SHA-256 prefix — no payload leakage. `outcome ∈ { success | error | insufficient_credits }`.
- Per-report `requestId` + `idempotencyKey` (UUID v4) on every usage report; the latter is sent as the HTTP `Idempotency-Key` header and persisted into `~/.crawlforge/pending-usage.json` for safe retry replay.
- `tests/unit/withAuth.test.js` (6 tests) and `tests/unit/authManagerPhaseA.test.js` (6 tests). Unit-test count rises from 14 → 26.

### Changed
- `AuthManager._flushPendingUsage()` and `_appendPendingUsage()` no longer swallow errors silently — structured Winston logs at info/warn/error with retained requestIds. Pending-file ENOENT remains silent (normal), other read errors are now logged at warn.
- `withAuth()` resolves `getToolCost()` and `isCreatorMode()` once per call (was twice and three times respectively); wrapped in `try/finally` so the log line fires on every code path.
- `docs/PRODUCTION_READINESS.md` header bumped: v3.0.12 → v3.0.19, "19 Tools" → "20 Tools", date 2026-03-30 → 2026-05-17. Security Audit Phase Tracker updated: phases 4 and 5 ✅ COMPLETE, phase 6 DEFERRED with rationale.

### Removed
- `src/core/LocalizationManager.js`: deleted the `PROXY_PROVIDERS` constant (11 fake `proxy-*.example.com` endpoints), the `TRANSLATION_SERVICES` constant (Google / Azure / LibreTranslate stubs that were never wired up), the `initializeProxySystem()` and `initializeTranslationServices()` methods, and their re-exports. These never did anything.
- `src/core/ActionExecutor.js`: deleted the `if (url === 'http://example.com')` mock branch — no test depended on it and it short-circuited real action-chain validation.

### Notes
- `isomorphic-dompurify` was **not** removed (plan claim was incorrect — it's actively used by `src/security/wave3-security.js` and `src/utils/inputValidation.js` for HTML sanitization).
- `SnapshotManager.js` was **not** changed — gzip compression is already real, working code (lines 240–260), not a stale comment.

## [3.0.18] - 2026-04-18

### Security
- **CRITICAL:** Endpoint allow-list prevents `CRAWLFORGE_API_URL` from pointing to unauthorized/mock backends. Localhost only permitted in creator mode.
- **CRITICAL:** Credit check fails closed — cached results only trusted within 30 s of last successful backend response. `CREDIT_CHECK_INTERVAL` reduced from 60 s to 15 s.
- **HIGH:** Usage reporting now has a 5 s timeout and decrements local cache regardless of network success. Failed usage reports queued to `~/.crawlforge/pending-usage.json` and replayed automatically.

### Known Issues (deferred to future release)
- HTTP transport (`--http`) still uses the server's stored key for every request. Do not expose publicly until Phase 4 lands.
- API key is not re-validated at startup (Phase 5).
- Local `config.json` has no integrity check (Phase 6).

## [3.0.3] - 2025-10-01

### Security
- **CRITICAL:** Removed authentication bypass vulnerability that allowed users to use `BYPASS_API_KEY=true` for free unlimited access
- Implemented secure creator mode with SHA256 hash-based authentication
- Only package maintainer with secret UUID can enable creator mode (unlimited access for development)
- Protected business model - all users must now authenticate with valid API keys from crawlforge.dev

### Changed
- AuthManager now checks creator mode dynamically to fix initialization order issues
- `.env` file loading moved to top of server.js before all imports
- Updated documentation to reflect security changes

### Added
- `.env.example` file with configuration templates
- Comprehensive creator mode documentation in CLAUDE.md
- Security update notes in README.md

## [3.0.2] - 2025-10-01

### Fixed
- Removed backup files from npm package (ActionExecutor.js.backup, ssrfProtection.js.bak)
- Fixed author email from placeholder to support@crawlforge.dev
- Standardized repository URLs to github.com/mysleekdesigns/crawlforge-mcp
- Fixed homepage URL to https://crawlforge.dev

### Changed
- Updated .npmignore to exclude `*.backup` files
- Updated package-lock.json to sync version
- Reduced package size by 11.1 KB (3.5% reduction)

### Added
- CONTRIBUTING.md with comprehensive contribution guidelines

## [3.0.1] - 2025-10-01

### Security
- Disabled JavaScript execution by default in ActionExecutor
- Requires explicit `ALLOW_JAVASCRIPT_EXECUTION=true` environment variable
- Enforced HTTPS-only webhooks (HTTP webhooks now rejected)

### Fixed
- MCP protocol compliance test JSON parsing issues
- Version synchronization between server.js and package.json

### Changed
- Updated security documentation
- Improved error handling for webhook validation

## [3.0.0] - 2024-08-28

### Added
- Initial release with 19 comprehensive tools
- Basic tools: fetch_url, extract_text, extract_links, extract_metadata, scrape_structured
- Advanced tools: search_web, crawl_deep, map_site
- Content processing: extract_content, process_document, summarize_content, analyze_content
- Wave 2 tools: batch_scrape, scrape_with_actions
- Wave 3 tools: deep_research, track_changes, generate_llms_txt, stealth_mode, localization
- MCP protocol compliance
- Authentication system with API key validation
- Credit tracking and usage reporting
- Docker support
- Comprehensive test suite

### Security
- SSRF protection with allowlist/blocklist
- Input validation and sanitization
- Rate limiting
- Secure webhook dispatching
- API key encryption

---

## Version History Summary

| Version | Date | Type | Description |
|---------|------|------|-------------|
| 3.0.18 | 2026-04-18 | Security | Endpoint allow-list, fail-closed credit check, usage-report hardening |
| 3.0.3 | 2025-10-01 | Security | Critical auth bypass fix |
| 3.0.2 | 2025-10-01 | Maintenance | Package cleanup & metadata fixes |
| 3.0.1 | 2025-10-01 | Security | JS execution & webhook security |
| 3.0.0 | 2024-08-28 | Major | Initial public release |

---

**Note:** For detailed security information, see `PRODUCTION_READINESS.md` and `.github/SECURITY.md`.

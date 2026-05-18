# CrawlForge MCP Server — Improvement Roadmap v4.0

> **Status:** D2 Complete, D5.1 Complete — In Progress
> **Current version:** 3.5.1
> **Target version:** 4.0
> **Estimated duration:** 10–12 weeks (phases D2 and D5 parallelizable with D1/D3/D4)

---

## Context

CrawlForge is a mature MCP server with **22 tools** spanning fetching, crawling, extraction, search, research, tracking, stealth, localization, and LLMs.txt generation. Recent work (v3.0.17 → v3.5.1) shipped bounded browser pools, OAuth 2.1, Streamable HTTP, Prometheus/OTel, Ollama-default LLM extraction, action recording/replay, session reuse, SearXNG, and Render deploy. The previous `IMPROVEMENT_PLAN.md` roadmap is fully drained.

**Why this roadmap exists.** Four pressures pulling the server forward:

1. **MCP spec drift.** Spec rev `2025-11-25` standardized four primitives the server doesn't expose yet: **Resources**, **Prompts**, **Sampling**, and **Elicitation**. CrawlForge today only ships *Tools*. Sampling alone removes the need to hold OpenAI/Anthropic keys server-side — the client model performs the LLM call.
2. **Production reliability debt.** A deep audit of `src/core/` surfaced 10 concrete issues including a credit-deduction race in `AuthManager`, a fingerprint Map leak in `StealthBrowserManager`, unbounded LLM cost in `ResearchOrchestrator`, page leaks in `ActionExecutor`, and secrets leaking through error logs.
3. **Competitive ceiling.** Firecrawl, Crawl4AI, Apify, BrowserBase, and Jina all ship MCP servers. 2026 comparisons rank on (a) markdown-first output for RAG, (b) pre-built site actors, (c) anti-bot effectiveness, (d) cost transparency. Camoufox / nodriver / zendriver now outperform Playwright-with-stealth on CreepJS and Datadome.
4. **PRD Phase 2/3 still unstarted.** No CLI; no Skills installer for Claude Code / Cursor / VS Code.

**Intended outcome.** A v4.0 that is MCP-spec-current, leak-free under sustained load, competitive on the four axes above, and usable from both an MCP client and a `crawlforge` CLI with skills installable into every major host.

---

## Phase Overview

| Phase | Theme | Duration | Risk |
|-------|-------|----------|------|
| **D1** | MCP-native primitives (Resources, Prompts, Sampling, Elicitation) | 2–3 weeks | Medium |
| **D2** | Reliability & cost hardening (10 audit findings) | 1.5 weeks | Low |
| **D3** | Competitive feature parity (markdown, Camoufox, templates, cloud browser) | 3–4 weeks | Medium |
| **D4** | CLI (PRD Phase 2) + Skills installer (PRD Phase 3) | 2–3 weeks | Low |
| **D5** | CI, test coverage, docs refresh | 1 week | Low |

---

## Phase D1 — MCP-Native Primitives

**Goal:** Make CrawlForge a first-class MCP server, not just a tool host.

### D1.1 Resources

Expose long-lived artifacts the server already produces as MCP Resources with URI scheme `crawlforge://<type>/<id>`.

- [ ] Create `src/resources/ResourceRegistry.js` (central registry, URI parsing, MIME types)
- [ ] Register `resources/list` and `resources/read` handlers in `server.js`
- [ ] Expose `crawlforge://research/{sessionId}` — completed `deep_research` reports (currently lost from `ResearchOrchestrator.activeSessions`)
- [ ] Expose `crawlforge://snapshot/{url-hash}/{timestamp}` — wire to `SnapshotManager`
- [ ] Expose `crawlforge://job/{jobId}` — completed `batch_scrape` results from `JobManager`
- [ ] Expose `crawlforge://crawl/{sessionId}/sitemap` — last `map_site` output per domain
- [ ] Expose `crawlforge://screenshot/{actionId}` — screenshots from `scrape_with_actions` (replace base64-in-response)
- [ ] Document URI scheme + TTL policy in `docs/mcp-resources-prompts.md`
- [ ] Unit tests for `ResourceRegistry` in `tests/unit/resources/`

### D1.2 Prompts

Pre-defined workflows as MCP prompts the client can list and invoke.

- [ ] Create `src/prompts/PromptRegistry.js` and wire `prompts/list` + `prompts/get` in `server.js`
- [ ] Prompt: `competitive-analysis` (args: `competitor_urls`, `our_url`)
- [ ] Prompt: `monitor-changes` (args: `url`, `interval`, `webhook`)
- [ ] Prompt: `rag-ingest` (args: `urls[]`, `output_format`) — markdown defaults
- [ ] Prompt: `site-audit` (args: `url`) — composes `map_site` + `generate_llms_txt` + `extract_metadata`
- [ ] Prompt: `research-deep-dive` (args: `topic`, `depth`)
- [ ] Add example prompt invocations to `README.md`

### D1.3 Sampling

Let tools request LLM completions from the client model — removes need for server-side LLM API keys.

- [ ] Add sampling client wrapper in `src/core/SamplingClient.js`
- [ ] Update `src/tools/extract/extractWithLlm.js` — fallback chain: Ollama → API key → sampling → error
- [ ] Update `src/tools/extract/extractStructured.js` — same fallback chain
- [ ] Update `src/core/ResearchOrchestrator.js:533-564` — synthesis via sampling when available
- [ ] Update `src/tools/extract/summarizeContent.js` — abstractive mode via sampling
- [ ] Document fallback order in tool descriptions
- [ ] Test sampling fallback with no env keys set

### D1.4 Elicitation

Ask the user for confirmation/input mid-tool for expensive or ambiguous operations.

- [ ] Elicitation in `src/tools/research/deepResearch.js` when projected cost > 50 credits
- [ ] Elicitation in `src/tools/advanced/batchScrape/index.js` when batches > 25 URLs in sync mode
- [ ] Elicitation in `src/tools/crawl/crawlDeep.js` when projection exceeds `max_pages` or robots.txt blocks
- [ ] Elicitation in `src/tools/extract/extractStructured.js` when schema ambiguous and LLM unavailable
- [ ] Elicitation in `src/core/AuthManager.js` when remaining credits < projected cost (replaces hard-fail)

### D1.5 Tool description audit (agent ergonomics)

- [ ] Audit all 22 tool `description` fields and parameter docstrings against Anthropic tool-use guidance
- [ ] Rewrite descriptions to lead with *when to use* (not just *what it does*)
- [ ] Add concrete example invocations to each tool's input schema

---

## Phase D2 — Reliability & Cost Hardening

10 issues found in `src/core/` audit. Each is a small isolated PR with a regression test.

### D2.1 Credit deduction race (AuthManager)
- [x] `src/core/AuthManager.js` — promise queue serializes `reportUsage`; `_reportUsageOnce` decrement inside serialized task (D2.1)
- [x] Regression test: `tests/unit/d2-reliability.test.js` — D2.1 serialization verified
- [x] Regression test: `_usageQueue` and `_reportUsageOnce` existence verified

### D2.2 StealthBrowserManager fingerprint leak
- [x] `src/core/StealthBrowserManager.js` — `onContextExpired` already deletes; `_maxContexts` stored
- [x] Add LRU cap matching `_maxContexts` via `_setFingerprint` helper with eviction
- [x] Regression test: `tests/unit/d2-reliability.test.js` — LRU eviction at capacity verified

### D2.3 Unbounded LLM cost in ResearchOrchestrator
- [x] `src/core/ResearchOrchestrator.js` — per-session `tokenBudgetChars/Used/Exceeded` in `researchState`; LLM calls aborted when exceeded
- [x] Abort with warning when budget exceeded — `enableLLMFeatures` set false for remainder of session
- [x] Surface `_cost: { tokenBudgetChars, tokenBudgetUsed, tokenBudgetExceeded }` in raw_evidence response

### D2.4 ActionExecutor page leaks
- [x] `src/core/ActionExecutor.js` — `initializePage` moved inside try/finally; page always closed with error-safe close
- [x] Page acquisition inside try block prevents leaks on validation failures
- [x] Existing timeout race in `executeAction` preserved; page closed in finally

### D2.5 WebhookDispatcher retry storms
- [x] `src/core/WebhookDispatcher.js` — per-webhook exponential backoff with 25% jitter; retry pushes to back of queue
- [x] Health checks use jittered setTimeout (up to 10% of interval)
- [x] Batch size capped at 10 via `Math.min(rawBatchSize, 10)`; test verifies this

### D2.6 JobManager cascade + max enforcement
- [x] `src/core/JobManager.js` — cascade-cancels all jobs listing cancelled job in `dependencies`
- [x] LRU eviction in `createJob`: evicts oldest completed/failed/cancelled first, then oldest active if needed
- [x] `cleanupExpiredJobs` computes expiry from `createdAt + ttl` when `expiresAt` missing; expires all states

### D2.7 PerformanceManager saturation routing + shutdown
- [x] `src/core/PerformanceManager.js` — `getOptimalComponent` queries live `getStats()` for queue depth and wait time with saturation fallback
- [x] `shutdown()` uses `AbortController` signal + 5s per-component timeout with graceful error

### D2.8 Localization cache + sync hash blocking
- [x] `src/core/LocalizationManager.js` — all 5 caches (locale, geo, timezone, proxy, translation) capped via LRU `makeLRUMap` helper
- [x] `src/core/ChangeTracker.js` — `hashContentAsync()` offloads >256KB hashes to `worker_threads`; falls back to sync on worker error
- [ ] Validate `customDNS` overrides against whitelist (`config.js:266-269`) — deferred to next iteration

### D2.9 Secret leakage in logs
- [x] Created `src/utils/secretMask.js` — `maskSecrets`, `maskString`, `maskError` with regex-based key detection
- [x] Winston formatter updated with `secretMaskFormat` in `createFormat()` — applied before all other formats
- [x] Secret keys detected by `SECRET_KEYS_RE` regex; values masked with `[REDACTED]...last4`
- [x] Regression tests in `tests/unit/d2-reliability.test.js` — 8 tests verify masking works

### D2.10 ResearchOrchestrator URL dedup
- [x] `src/core/ResearchOrchestrator.js` — `deduplicateSources` uses `researchState.visitedUrls` (per-session) + localSeen
- [x] Content cache hit: `visitedUrls.has(url)` returns `extractedContent.get(url)` instead of null
- [x] Regression test: `tests/unit/d2-reliability.test.js` — deduplication logic verified

### D2.11 Verification gate
- [x] All D2 regression tests pass (16 tests green in `tests/unit/d2-reliability.test.js`)
- [ ] 24h sustained-load test in `tests/load/sustained.js` shows flat memory
- [ ] Coverage rises from 64.3% → ≥70% line

---

## Phase D3 — Competitive Feature Parity

### D3.1 Markdown-first output (Firecrawl parity)
- [ ] Add HTML→Markdown converter utility (Turndown or markdownify)
- [ ] `src/tools/basic/extractText.js` — add `output_format: "markdown"` option
- [ ] `src/tools/extract/extractContent.js` — markdown output mode
- [ ] `src/tools/advanced/batchScrape/index.js` — default to markdown for RAG workflows
- [ ] `src/tools/extract/processDocument.js` — markdown output mode
- [ ] Document the change in `CHANGELOG.md` (breaking default change)

### D3.2 Camoufox / nodriver alternative for stealth_mode
- [ ] Audit Camoufox / nodriver licensing (some forks AGPL)
- [ ] Define `BrowserEngine` interface in `src/core/StealthBrowserManager.js`
- [ ] Implement `CamoufoxAdapter` (Firefox-based, no patches needed)
- [ ] Add `engine: "playwright" | "camoufox"` option to `stealth_mode` tool
- [ ] Benchmark against `bot.sannysoft.com`, `creepjs.com`, `nopecha.com`
- [ ] Document engine selection criteria in `docs/stealth-engines.md`

### D3.3 Pre-built site templates (Apify Actors parity)
- [ ] Create `src/tools/templates/` directory and `TemplateRegistry.js`
- [ ] New tool `scrape_template` registered in `server.js`
- [ ] Template: `amazon-product`
- [ ] Template: `linkedin-profile`
- [ ] Template: `github-repo`
- [ ] Template: `youtube-video`
- [ ] Template: `tweet` / X post
- [ ] Template: `reddit-thread`
- [ ] Template: `hacker-news-front-page`
- [ ] Template: `producthunt-launch`
- [ ] Template: `stackoverflow-question`
- [ ] Template: `npm-package`
- [ ] Recorded fixtures in `tests/integration/templates/` for each

### D3.4 Cloud browser backend (BrowserBase parity)
- [ ] Define `BrowserBackend` interface in `src/core/StealthBrowserManager.js`
- [ ] Implement `LocalPlaywrightBackend` (current behavior)
- [ ] Implement `BrowserBaseBackend`
- [ ] Env toggle: `CRAWLFORGE_BROWSER_BACKEND=local|browserbase`, `BROWSERBASE_API_KEY`
- [ ] Graceful fallback to local if cloud unavailable
- [ ] Document in `docs/cloud-browser.md`

### D3.5 Cost transparency
- [ ] Add `projectCost(toolName, params)` method to `src/core/AuthManager.js`
- [ ] Surface `_cost: { projected, actual, remaining_credits }` in all tool responses
- [ ] Document accuracy caveats for dynamic tools (`deep_research`, `crawl_deep`)

---

## Phase D4 — CLI (PRD Phase 2) + Skills (PRD Phase 3)

### D4.1 CLI scaffolding
- [ ] Add `commander` to dependencies
- [ ] Add `"bin": { "crawlforge": "src/cli/index.js" }` to `package.json`
- [ ] Create `src/cli/index.js` (entry, global flags)
- [ ] Global flags: `--json`, `--pretty`, `--quiet`, `--api-key`, `--timeout`
- [ ] Output formatter shared with MCP tools (no logic duplication)

### D4.2 CLI commands (15 total)
- [ ] `crawlforge scrape <url>` — wraps `fetch_url` / `extract_content`
- [ ] `crawlforge search <query>` — wraps `search_web`
- [ ] `crawlforge crawl <url>` — wraps `crawl_deep`
- [ ] `crawlforge map <url>` — wraps `map_site`
- [ ] `crawlforge extract <url>` — wraps `extract_structured` / `extract_with_llm`
- [ ] `crawlforge track <url>` — wraps `track_changes`
- [ ] `crawlforge analyze <url>` — wraps `analyze_content`
- [ ] `crawlforge research <topic>` — wraps `deep_research`
- [ ] `crawlforge stealth <url>` — wraps `stealth_mode`
- [ ] `crawlforge batch <urls-file>` — wraps `batch_scrape`
- [ ] `crawlforge actions <url> --script <file>` — wraps `scrape_with_actions`
- [ ] `crawlforge localize <url>` — wraps `localization`
- [ ] `crawlforge llmstxt <url>` — wraps `generate_llms_txt`
- [ ] `crawlforge template <id> <target>` — wraps `scrape_template`
- [ ] `crawlforge monitor <url>` — wraps `track_changes` scheduled mode

### D4.3 Skills installer
- [ ] Create `src/skills/installer.js`
- [ ] New CLI command: `crawlforge install-skills [--target=claude-code|cursor|vscode|all]`
- [ ] Skill file: `src/skills/crawlforge-mcp.md`
- [ ] Skill file: `src/skills/crawlforge-cli.md`
- [ ] Skill file: `src/skills/crawlforge-stealth.md`
- [ ] Skill file: `src/skills/crawlforge-research.md`
- [ ] Target Claude Code: `~/.claude/skills/crawlforge-*.md`
- [ ] Target Cursor: `.cursor/rules/crawlforge.mdc`
- [ ] Target VS Code: `.github/instructions/crawlforge.instructions.md`
- [ ] Uninstall command: `crawlforge uninstall-skills --target=...`

---

## Phase D5 — CI, Tests, Docs

### D5.1 GitHub Actions CI
- [x] Created `.github/workflows/ci.yml` with 5 jobs: lint-and-syntax, unit-tests, mcp-compliance, coverage, docker-build
- [x] Pipeline step: `npm ci`
- [x] Pipeline step: `npm test` (MCP protocol compliance)
- [x] Pipeline step: `npm run test:coverage` (continue-on-error until D5.2 raises threshold)
- [x] Pipeline step: `npm audit --audit-level=high`
- [x] Pipeline step: `node --check` across `src/`
- [ ] Pipeline step: ESLint (add `eslint.config.js`) — deferred to D5.2
- [x] Pipeline step: Docker build verification
- [ ] Pipeline step: Integration tests against mock Docker service — deferred to D5.2
- [x] Created `.github/workflows/security.yml` — daily npm audit + gitleaks secret scan + CodeQL analysis

### D5.2 Per-tool unit tests (17 untested tools)
- [ ] `tests/unit/tools/search/searchWeb.test.js`
- [ ] `tests/unit/tools/crawl/crawlDeep.test.js`
- [ ] `tests/unit/tools/crawl/mapSite.test.js`
- [ ] `tests/unit/tools/advanced/batchScrape.test.js`
- [ ] `tests/unit/tools/advanced/scrapeWithActions.test.js`
- [ ] `tests/unit/tools/research/deepResearch.test.js`
- [ ] `tests/unit/tools/extract/extractContent.test.js`
- [ ] `tests/unit/tools/extract/processDocument.test.js`
- [ ] `tests/unit/tools/extract/analyzeContent.test.js`
- [ ] `tests/unit/tools/extract/summarizeContent.test.js`
- [ ] `tests/unit/tools/extract/extractStructured.test.js`
- [ ] `tests/unit/tools/extract/listOllamaModels.test.js`
- [ ] `tests/unit/tools/stealth/stealthMode.test.js`
- [ ] `tests/unit/tools/localization/localization.test.js`
- [ ] `tests/unit/tools/tracking/trackChanges.test.js`
- [ ] `tests/unit/tools/llmstxt/generateLLMsTxt.test.js`
- [ ] `tests/unit/tools/templates/scrapeTemplate.test.js` (new tool from D3.3)
- [ ] Use `nock`/`msw` for HTTP fixtures; mock Playwright via injected page factory

### D5.3 Docs refresh
- [ ] Bump `docs/PRODUCTION_READINESS.md` header from "v3.3.1 | 21 Tools" to current
- [ ] Rewrite `PRD.md` Progress Summary — Phases A/B/C all complete; remove obsolete "Phase 2/3 not started"
- [ ] Add copy-paste example block to `README.md` for each of 22 tools
- [ ] New: `docs/local-ollama-quickstart.md`
- [ ] New: `docs/docker-deployment.md`
- [ ] New: `docs/observability-setup.md`
- [ ] New: `docs/mcp-resources-prompts.md`
- [ ] New: `docs/cli-guide.md`
- [ ] New: `docs/stealth-engines.md`
- [ ] New: `docs/cloud-browser.md`
- [ ] Verify all README examples runnable via `tests/docs/example-runner.js`

---

## Cross-cutting Verification

| Phase | End-to-end verification |
|-------|-------------------------|
| D1 | `claude --mcp-debug`: `resources/list` and `prompts/list` populate. Fresh-session `crawlforge://research/<id>` returns without re-run. `extract_with_llm` succeeds with no Ollama/no API key (sampling). `deep_research maxUrls=200` triggers elicitation. |
| D2 | All regression tests green. 24h sustained-load run shows flat memory. Log grep finds no API keys after error-path runs. |
| D3 | `batch_scrape --format markdown` returns valid markdown. `stealth_mode engine=camoufox` scores ≥ Playwright on CreepJS/Datadome. Each template hits its target site. `BROWSERBASE_API_KEY` env routes through cloud; falls back cleanly when unset. |
| D4 | `npm link && crawlforge search "foo" --json` matches MCP tool response shape. `crawlforge install-skills --target=claude-code` writes expected files; new session sees them. |
| D5 | CI green on a clean PR. Coverage ≥ 70% line / ≥ 60% branch. `npm audit` clean. |

---

## Out of Scope (Explicitly Deferred)

- Self-hosted vector DB / embedding storage (separate concern from scraping)
- Native multi-tenant billing (handled by CrawlForge.dev backend)
- Replacing OAuth 2.1 / Streamable HTTP (already shipped in v3.2.0)
- Migration to TypeScript (no current pain signal; JSDoc + tests cover the surface)

---

## Open Risks

- **Camoufox dependency.** Distribution and licensing need verification before adopting (some forks AGPL).
- **MCP Sampling client support.** Not every MCP client implements sampling. Fallback chain must remain robust.
- **Resource cleanup.** Exposing `crawlforge://snapshot/...` as resources may extend retention; document TTL.
- **Cost-projection accuracy.** Projections diverge from actuals for tools like `deep_research` where source count is dynamic — disclose lower-bound only.
- **Breaking default change in D3.1.** Switching `batch_scrape` default output to markdown is a v4.0 breaking change; flag prominently in CHANGELOG and migration guide.

---

## Reference: 22 Tools (current state)

**Basic (5):** `fetch_url`, `extract_text`, `extract_links`, `extract_metadata`, `scrape_structured`
**Search (1):** `search_web`
**Crawl (2):** `crawl_deep`, `map_site`
**Extract (7):** `extract_content`, `process_document`, `summarize_content`, `analyze_content`, `extract_structured`, `extract_with_llm`, `list_ollama_models`
**Advanced (2):** `batch_scrape`, `scrape_with_actions`
**Research (1):** `deep_research`
**Tracking (1):** `track_changes`
**LLMs.txt (1):** `generate_llms_txt`
**Browser (2):** `stealth_mode`, `localization`

---

## Audit Methodology

This roadmap was built from:

1. **Codebase catalog** — Full read of all 22 tool implementations under `src/tools/`, with parameter and dependency mapping.
2. **Core infrastructure audit** — Deep review of all 10 modules in `src/core/` plus `src/constants/config.js` and `server.js`, with file:line references for each finding.
3. **Documentation survey** — README, PRD, CHANGELOG, IMPROVEMENT_PLAN, PRODUCTION_READINESS, security-audit-report, oauth-quickstart, and CI workflow files.
4. **External research via CrawlForge MCP** — Used `mcp__crawlforge__deep_research`, `mcp__crawlforge__search_web` against MCP spec 2025-11-25, competitor MCP servers (Firecrawl, Crawl4AI, Apify, BrowserBase, Jina), and anti-bot landscape (Camoufox, nodriver, zendriver, CreepJS benchmarks).

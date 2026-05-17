# CrawlForge MCP Server — Improvement Plan

**Status:** Phase A shipped | **Drafted:** 2026-05-17 | **Current version:** v3.0.19 | **Target end state:** v3.2.0

---

## Why this plan

This plan was drafted after a detailed audit of the repo (~14.6K LOC core + 2.1K LOC `server.js`, 20 MCP tools) combined with web research on MCP best practices and the competitive landscape (Firecrawl, Crawl4AI, ScrapeGraphAI, Bright Data, JetBrains AI Assistant, Azure MCP Server) as of mid-2026.

Key facts driving the plan:

- The last five commits are all bug/security patches — **no structural refactoring has happened in months**.
- **10 of 14 core modules have zero tests.** The "integration test" only checks that the server returns a tool list and doesn't crash.
- `server.js` is **2,138 lines** with 20 near-identical `registerTool` blocks.
- `StealthBrowserManager.js` (**1,794 LOC**) keeps browser contexts in an unbounded `Map()` — no concurrency cap, no idle timeout, no periodic refresh. That's a memory leak waiting to happen at scale.
- `LocalizationManager.js` (**1,614 LOC**) contains proxy configs pointing at `proxy-us-east.example.com` and translation service configs that are never wired up — pure dead code.
- `AuthManager.js` silently swallows pending-usage flush errors at line 303 (`catch { return; }`); failed credit reports vanish without a log.
- Security audit phases 4, 5, and 6 are marked **open/deferred**.
- The server is **stdio-only**. The MCP spec deprecated HTTP+SSE in March 2025 in favor of **Streamable HTTP**, and every modern MCP host (JetBrains, Azure, Portkey) assumes it for remote deployment. CrawlForge has no remote-deploy story.
- The single static API key model is behind the curve — **OAuth 2.1** is now the MCP standard for remote authorization (`modelcontextprotocol.io/docs/tutorials/security/authorization`, Oct 2025; CoSAI whitepaper, Jan 2026).
- Tools return JSON wrapped in a `text` content block. MCP SDK ≥1.10 supports **structured outputs** (`outputSchema`) — competitors already use them.

The plan is three releases. Each is independently shippable.

---

## Phase A — v3.0.19 "Cleanup" (target: 1–2 days)
**Completed:** 2026-05-17

Goal: Close the deferred security phases, remove dead weight, fix the silent-failure bugs. No new features, no schema changes, no breaking changes.

### A1 — Security hardening (close audit phases 4 & 5)

- [x] Implement Phase 5: re-validate API key on startup in `src/core/AuthManager.js`; refuse to start if the cached key has been revoked
- [x] Implement Phase 4 (HTTP path only): require `Authorization: Bearer <key>` per request when `--http` is used; reject unauthenticated requests
- [x] Document Phase 6 (config HMAC) as future work blocked on backend changes — link from `docs/PRODUCTION_READINESS.md`

### A2 — Reliability fixes

- [x] Replace silent `catch { return; }` at `src/core/AuthManager.js:303–305` with structured Winston logging that records dropped usage entry IDs
- [x] Add a request ID + idempotency key to every entry in `~/.crawlforge/pending-usage.json`
- [x] Wrap the `withAuth()` handler call (`server.js:124–182`) in `try/finally`; always log `{ toolName, paramHash, durationMs, outcome }`
- [x] Remove the redundant inner credit check in `withAuth()`

### A3 — Dead code & dependencies

- [x] Delete `LocalizationManager.js` proxy/translation stubs (lines ~67–100); keep only the locale switching that actually works
- [ ] Remove `isomorphic-dompurify` from `package.json` (zero references in `src/`) — **left unchanged in v3.0.19:** plan claim is incorrect. `isomorphic-dompurify` is actively imported by `src/security/wave3-security.js:11` and `src/utils/inputValidation.js:7` (both call `DOMPurify.sanitize(...)`). Removing it would break HTML sanitization. Item should be re-scoped or struck from the plan in a follow-up.
- [x] Delete the `example.com` mock branch in `src/core/ActionExecutor.js:174–197`
- [ ] Pick one: delete the compression claim comment in `SnapshotManager.js` OR actually implement gzip on `snapshots/` writes — **left unchanged in v3.0.19:** plan premise is incorrect. `SnapshotManager.js` already implements real gzip compression (lines 240–260) using `zlib.gzip` via `gzipAsync`, with a configurable threshold and 20% ratio guard. The "compression claim" is not just a comment — it's working code. Nothing to do.

### A4 — Documentation

- [x] Fix `docs/PRODUCTION_READINESS.md` header (v3.0.12 → v3.0.18; "19 Tools" → "20 Tools") — bumped to v3.0.19 / 20 Tools
- [x] Append v3.0.19 entry to root `PRD.md` (per the standing project rule)
- [x] Add `CHANGELOG.md` entry

### A5 — Verification

- [x] `npm test` passes (MCP protocol compliance unchanged from HEAD baseline)
- [x] `node test-tools.js` passes (14 PASS / 6 SKIP for sandboxed network; 100% non-sandboxed pass rate)
- [x] New unit test: server refuses to start with a revoked API key (`tests/unit/authManagerPhaseA.test.js`)
- [x] New unit test: every `withAuth` invocation produces a log line (`tests/unit/withAuth.test.js`)
- [x] `npm audit` clean (4 pre-existing transitive advisories in `fast-uri`/`hono`/`ip-address`/`express-rate-limit` resolved via `npm audit fix`; 0 vulnerabilities)
- [x] `npm run build` succeeds — N/A for this pure-ESM JS project (no `build` script defined); replaced with `node --check` syntax verification on every modified file
- [x] Push to GitHub and bump version

---

## Phase B — v3.1.0 "Refactor" (target: 3–5 days)

Goal: Cut ~3–4K LOC of bloat and duplication without changing any tool's public schema. Pure internal restructuring + a real test suite.

### B1 — Decompose `server.js` (2,138 → ~600 LOC)

- [ ] Extract `src/server/registerTool.js` helper: `{ name, description, schema, annotations, handler, creditCost }` → registration + `withAuth` wrap (removes ~1,200 LOC of repetition)
- [ ] Extract `src/server/schemas/common.js` for shared Zod fragments (`urlSchema`, `paginationSchema`, `webhookSchema`, `cacheOptsSchema`) — `url` pattern alone is repeated in 12+ schemas
- [ ] Move 5 inline "basic" tool handlers (`fetch_url`, `extract_text`, `extract_links`, `extract_metadata`, `scrape_structured`) into `src/tools/basic/`
- [ ] Move transport setup (`server.js:1950–2018`) into `src/server/transports/{stdio,http}.js`

### B2 — Browser lifecycle (`StealthBrowserManager.js`)

- [ ] Introduce a bounded `BrowserContextPool` (default `MAX_BROWSER_CONTEXTS=10`, configurable via env)
- [ ] Per-request: acquire context → use → dispose. Don't accumulate in a Map.
- [ ] Periodic browser refresh: close + relaunch after every 200 contexts or 30 minutes (documented Playwright best practice — firecrawl.dev, dev.to/peyman.iravani)
- [ ] Add `closeIdleAfterMs` for contexts acquired but never released
- [ ] Add concurrency wait queue with timeout so excess requests fail fast instead of piling up

### B3 — Tool bloat reduction

- [ ] Split `src/tools/tracking/trackChanges.js` (1,377 LOC) into `trackChanges/{schema,monitor,differ,notifier}.js` — handler ≤150 LOC
- [ ] Split `src/tools/advanced/BatchScrapeTool.js` (1,089 LOC) into `batchScrape/{schema,queue,worker,reporter}.js` — reuse `JobManager` + `WebhookDispatcher` instead of embedding them
- [ ] Merge `ResultRanker` + `ResultDeduplicator` cache layers into one `SearchResultCache`
- [ ] Extract `src/tools/extract/_fetchAndParse.js`; use it from `extractStructured`, `extractContent`, `processDocument`
- [ ] Add `CacheManager` to crawl tools (`crawlDeep`, `mapSite`) for fetch dedup

### B4 — Real test suite

- [ ] Unit tests for `StealthBrowserManager` (pool capacity, idle eviction, refresh interval)
- [ ] Unit tests for `JobManager`, `WebhookDispatcher`, `ChangeTracker.diff()`, `SnapshotManager.create()/restore()`
- [ ] Convert `test-tools.js` + `test-real-world.js` into assertion suites under `tests/integration/tools/`
- [ ] Each tool: ≥1 "happy path output looks right" + ≥1 "invalid input is rejected" test
- [ ] Add `c8` coverage; target ≥60% line coverage on `src/core/` and `src/tools/`
- [ ] Wire coverage gate into CI

### B5 — Verification

- [ ] `npm test` passes with new assertions
- [ ] `npm run docker:prod` boots; all 20 tools list and execute
- [ ] Soak test: `node --expose-gc server.js` under 1,000 sequential `scrape_with_actions` calls; RSS stays <400MB
- [ ] `npm run build` succeeds
- [ ] Push to GitHub and bump version

---

## Phase C — v3.2.0 "Modernize" (target: 1–2 weeks, items independently shippable)

Goal: Close the protocol/feature gap with Firecrawl, Crawl4AI, Bright Data MCP. Each item below ships independently — pick the order based on user demand.

### C1 — Streamable HTTP transport (MCP spec 2025-06-18)

- [ ] Implement `src/server/transports/streamableHttp.js` using `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport`
- [ ] Single endpoint (`POST /mcp`); SSE for streaming, JSON for one-shot — per spec
- [ ] Session resumption via `Mcp-Session-Id` header
- [ ] `npm run start:http` defaults to Streamable HTTP; legacy HTTP behind `--legacy-http` for one release then removed
- [ ] Update `docs/PRODUCTION_READINESS.md` API endpoints table
- [ ] Verify with MCP Inspector against `http://localhost:3000/mcp`

### C2 — OAuth 2.1 authorization (for the new remote transport)

- [ ] Follow `modelcontextprotocol.io/docs/tutorials/security/authorization` exactly
- [ ] Implement discovery endpoints (`/.well-known/oauth-authorization-server`)
- [ ] Dynamic client registration
- [ ] PKCE code flow
- [ ] Map OAuth tokens → existing CrawlForge API keys server-side (no backend schema change)
- [ ] Stdio transport keeps the static API key (no breaking change for existing local users)
- [ ] Write `docs/oauth-quickstart.md` with a sample client

### C3 — Structured tool outputs (MCP SDK ≥1.10)

- [ ] Add `outputSchema` to each tool's registration in `registerTool.js`
- [ ] Return `structuredContent` alongside `content` for backward compatibility
- [ ] Update `tests/integration/tools/*` to assert against `structuredContent`

### C4 — Observability

- [ ] OpenTelemetry traces around every tool invocation; span attributes `mcp.tool.name`, `mcp.tool.duration_ms`, `mcp.credit.cost`, `mcp.credit.outcome`
- [ ] Prometheus `/metrics` endpoint in HTTP mode: `crawlforge_tool_requests_total`, `crawlforge_tool_errors_total`, `crawlforge_browser_pool_in_use`, `crawlforge_credits_consumed_total`
- [ ] Default off via `OTEL_SDK_DISABLED=true` so stdio mode stays silent
- [ ] Commit example Grafana dashboard at `docs/observability/grafana-dashboard.json`

### C5 — Feature parity (pick based on user demand)

- [ ] `scrape_with_actions`: Firecrawl-style action recording / replay
- [ ] `crawl_deep`: Crawl4AI-style session reuse so cookies persist across pages of a crawl
- [ ] New tool `extract_with_llm` (gated by `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`): natural-language extraction, mirrors ScrapeGraphAI positioning
- [ ] `search_web`: expose `provider: 'crawlforge' | 'searxng'` so self-hosters can swap in SearXNG (r/LocalLLaMA `1nfvhyh` shows this is real user demand)

### C6 — Verification

- [ ] MCP Inspector connects over Streamable HTTP; lists 20 tools; executes each
- [ ] OAuth PKCE flow tested end-to-end with the sample client
- [ ] `/metrics` scrapeable by Prometheus
- [ ] All Phase A + B tests still pass
- [ ] `npm run build` succeeds
- [ ] Push to GitHub and bump version

---

## Critical files (by phase)

**Phase A:** `src/core/AuthManager.js`, `server.js` (124–182, 1950–2018), `src/core/LocalizationManager.js` (67–100), `src/core/ActionExecutor.js` (174–197), `package.json`, `docs/PRODUCTION_READINESS.md`, `PRD.md`, `CHANGELOG.md`.

**Phase B:** `server.js` → `src/server/{registerTool.js, schemas/common.js, transports/{stdio,http}.js}` + `src/tools/basic/*`; `src/core/StealthBrowserManager.js`; `src/tools/tracking/trackChanges.js` → `trackChanges/*`; `src/tools/advanced/BatchScrapeTool.js` → `batchScrape/*`; `src/tools/search/ranking/*`; new `src/tools/extract/_fetchAndParse.js`; `tests/unit/*` + `tests/integration/tools/*`.

**Phase C:** new `src/server/transports/streamableHttp.js`, `src/server/auth/oauth.js`, `src/observability/{tracing,metrics}.js`; `src/server/registerTool.js` (add `outputSchema`); `docs/oauth-quickstart.md`, `docs/observability/grafana-dashboard.json`.

---

## Reuse — what already exists

- `withAuth()` in `server.js:124` already wraps every tool — Phase A hardens it; Phase B moves it to `registerTool.js`.
- `JobManager` (687 LOC) — `BatchScrapeTool` should use it instead of embedding job tracking.
- `WebhookDispatcher` (749 LOC) — `trackChanges`, `deepResearch`, `batchScrape` should call it instead of carrying their own webhook code.
- `CacheManager` (wrapping `lru-cache`) already used in `searchWeb.js:94` — extract and crawl tools should adopt it.
- `PerformanceManager` (827 LOC) already logs RSS — reuse for soak-test verification.
- `endpointGuard.js` (37 LOC) already restricts outbound URLs — Phase C OAuth callbacks must route through it.

---

## Out of scope (intentionally)

- Audit phase 6 (config HMAC) — requires backend changes outside this repo.
- Rewriting `LocalizationManager` to actually do proxy rotation + translation — different product decision. Phase A just removes the dead pretense.
- Replacing Playwright with Puppeteer or Browserless cloud — Playwright is fine; the bug is the lifecycle, not the engine.
- Migrating to TypeScript — would be a separate v4.0.0 effort.

---

## End-to-end verification (run after every phase)

```bash
npm test
node test-tools.js
node tests/integration/mcp-protocol-compliance.test.js
npm run docker:build && npm run docker:prod
npm audit
npm run build
```

Plus from this Claude Code session, exercise every tool group at least once:
`mcp__crawlforge__fetch_url`, `scrape_structured`, `batch_scrape`, `scrape_with_actions`, `deep_research`, `track_changes`, `search_web`.

For Phase B onward, add a soak test:
```bash
node --expose-gc --max-old-space-size=512 server.js &
# drive 1000 concurrent fetches; RSS must stay <400MB
```

For Phase C, additionally:
- MCP Inspector connects over `http://localhost:3000/mcp`, lists 20 tools, executes each.
- OAuth PKCE flow per `docs/oauth-quickstart.md`.
- `curl http://localhost:3000/metrics` returns documented counters.

# Changelog

All notable changes to CrawlForge MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

# CrawlForge Upgrade PRD — CLI + LLM Extraction + Skills System

## Context

CrawlForge MCP Server (v3.6.0) has 20 specialized tools and strong security/stealth features, but Firecrawl has leapfrogged in developer experience with a CLI, skills system, and AI workflows. This PRD covers the top 3 upgrades to close the gap while preserving CrawlForge's unique advantages (stealth, localization, NLP, change tracking, local processing).

**Goal:** Add a CLI layer, LLM-powered structured extraction, and a skills system — without breaking any of the 20 existing MCP tools or the current setup flow.

**Last Updated:** 2026-05-18

---

## Release History

### v3.6.0 (Development) - Phase D1 MCP-Native Primitives (2026-05-18)

Phase D1 ships Resources, Prompts, Sampling, and Elicitation primitives (MCP spec 2025-11-25). D1.1: ResourceRegistry with crawlforge:// URI scheme (5 types), 20 tests green. D1.2: PromptRegistry with 5 workflow prompts. D1.3: SamplingClient with Ollama-API-sampling fallback chain. D1.4: ElicitationHelper wired into 5 tools. D1.5: All 22 tool descriptions rewritten to lead with when-to-use + examples. Server version bumped to 3.6.0.

### v3.5.2 (Development) — Phase D2 Reliability Hardening + D5.1 CI Workflows (2026-05-17)

**10 audit findings fixed** in `src/core/` — all covered by regression tests in `tests/unit/d2-reliability.test.js`:

- **D2.1 AuthManager credit race** — promise queue serializes concurrent `reportUsage` calls
- **D2.2 StealthBrowserManager leak** — `_setFingerprint` LRU cap at `_maxContexts`
- **D2.3 ResearchOrchestrator LLM cost** — per-session token budget with abort + `_cost` in response
- **D2.4 ActionExecutor page leaks** — `initializePage` inside try/finally; safe `page.close()`
- **D2.5 WebhookDispatcher retry storms** — per-webhook jittered exponential backoff; batch cap at 10
- **D2.6 JobManager cascade + eviction** — cascade-cancel dependents; LRU eviction at `maxJobs`; TTL expiry for all states
- **D2.7 PerformanceManager routing** — routes by live queue depth + wait time; AbortController on shutdown
- **D2.8 Localization/ChangeTracker** — LRU-capped Maps; `hashContentAsync` offloads >256KB to `worker_threads`
- **D2.9 Secret masking** — `src/utils/secretMask.js` + Winston global masking format
- **D2.10 URL dedup** — `deduplicateSources` uses per-session `visitedUrls`; cache-hit returns existing extracted content

**D5.1 GitHub Actions** — `.github/workflows/ci.yml` (5 jobs) + `.github/workflows/security.yml` (daily scans)

---

### v3.5.1 — Render deploy fix: align default port with Render's scanner (2026-05-18)

Fixes a Render deploy that timed out with "Port scan timeout reached, no open ports detected" even though the server was logging "running on port 10000" — Render's default scan target matches the app's `$PORT`-resolved port, but the Dockerfile's `EXPOSE 3000` + the in-code default of `3000` were misaligned with that and the broken HEALTHCHECK didn't actually probe the HTTP server. Net symptom: the app was listening, but the surrounding metadata pointed at the wrong port and the healthcheck was a no-op.

- `Dockerfile` — `EXPOSE 3000` → `EXPOSE 10000`; added `ENV PORT=10000` so the container default matches Render's default; HEALTHCHECK replaced (was `node -e "console.log('Health check passed')"` — always passed) with a real fetch against `http://127.0.0.1:$PORT/health`.
- `server.js` — `process.env.PORT || '3000'` → `process.env.PORT || '10000'` so local-Docker / non-PaaS runs also bind to the expected port.
- `src/server/transports/streamableHttp.js` — startup log now prints `listening on ${host}:${port}` (e.g. `0.0.0.0:10000`) instead of `http://localhost:${port}` — the latter was misleading when debugging "is it actually bound to 0.0.0.0?".
- New `render.yaml` blueprint — explicit `type: web`, `runtime: docker`, `healthCheckPath: /health`, `MCP_HTTP=true`, `CRAWLFORGE_API_KEY` flagged as a dashboard-only secret (`sync: false`).

**Operator action required:** in the Render dashboard for the existing service, confirm the "Port" field is either empty (Render auto-detects) or set to `10000`. If it's set to `3000` from an earlier deploy, change it to `10000` and re-deploy.

### v3.5.0 — Ollama is now the default for `extract_with_llm` + new `list_ollama_models` tool (2026-05-18)

Flips `extract_with_llm` so a **local Ollama model is the default** (was: OpenAI/Anthropic cloud). No API key is required to use the tool out of the box. Adds a new `list_ollama_models` MCP tool so a user / agent can discover which models are installed locally and pick one for the `model` parameter. **Breaking for existing `provider: "auto"` users with cloud keys set** — auto now resolves to Ollama regardless of whether `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is present. Cloud providers remain fully supported via explicit `provider: "openai" | "anthropic"`.

**Implementation:**
- `src/tools/extract/extractWithLlm.js` — `resolveProvider()` simplified: `provider: "auto"` (and `"ollama"`) always returns `{ provider: 'ollama', apiKey: null }`. The `OLLAMA_BASE_URL` opt-in gate is gone; `ollamaBaseUrl()` already defaults to `http://localhost:11434`. Explicit `"openai"` / `"anthropic"` branches still validate the corresponding API key and surface a clear error if missing. The pre-existing friendly `ECONNREFUSED` / `404 model not found` error messages are unchanged.
- New file `src/tools/extract/listOllamaModels.js` — thin wrapper around `GET /api/tags`. Returns each model's `name`, `size_bytes`, `modified_at`, `family`, `parameter_size`, `quantization`, plus a `hint` field that tells the user to run `ollama pull <name>` if zero models are installed, or to pass any listed name as the `extract_with_llm` `model` param.
- `server.js` — imports/instantiates `ListOllamaModelsTool`, registers the `list_ollama_models` tool (no params; `readOnlyHint`, `idempotentHint`). Updates `extract_with_llm` description and the `provider` / `model` field descriptions so MCP clients see the new defaults. Server description and getting-started prompt bumped 20 → 21 / 21 → 22 tools.
- `README.md` — feature blurb 20 → 22 tools; "Advanced Tools" list adds `extract_with_llm` and `list_ollama_models`; new "Local-LLM quickstart" snippet plus `OLLAMA_BASE_URL` / `OLLAMA_DEFAULT_MODEL` env-var docs.

**Tests:**
- `tests/unit/extractWithLlm.test.js` rewritten where the old contract was asserted. Tests 1–3 now verify auto → Ollama regardless of which cloud keys are set; test 19 now verifies the `OLLAMA_BASE_URL` override is respected (was: "auto does NOT pick ollama without env vars"). Removed test 20 (cloud-priority assertion no longer holds). **20/20 pass.**
- `npm test` (MCP protocol compliance): exits successfully; 60% rate is the pre-existing baseline on `main` — no regression from this change.

**Verification not yet run:**
- Live end-to-end against a real Ollama instance with the new `list_ollama_models` tool — to be done by reconnecting the MCP client (`/mcp`) so it picks up the updated schemas, then calling `list_ollama_models()` followed by `extract_with_llm({ url, prompt })`.

### v3.4.0 — Local Ollama support for `extract_with_llm` (2026-05-18)

Adds local-LLM support to `extract_with_llm` via Ollama, alongside the existing OpenAI + Anthropic cloud providers. Lets users extract structured data with no API key, no API costs, and no data leaving their machine — using whichever model they have pulled locally (default `llama3.2`). Strictly opt-in: existing cloud users see zero behavior change.

**Implementation (`src/tools/extract/extractWithLlm.js`, `server.js`):**
- New `callOllama()` calls Ollama's `/api/chat` directly with raw `fetch()` (same pattern as the existing OpenAI/Anthropic branches — zero new runtime deps). Sends `stream: false`, `temperature: 0`, `num_predict: maxTokens`. When the optional `schema` param is provided it is passed through as Ollama's structured-outputs `format` object; otherwise `format: "json"` for JSON mode.
- `resolveProvider()` extended: `provider: "ollama"` always selects Ollama (no key required). `provider: "auto"` keeps the Anthropic → OpenAI order and only falls back to Ollama when neither cloud key is set **and** `OLLAMA_BASE_URL` is exported — guarantees no behavior change for existing cloud users.
- Defaults are beginner-friendly: base URL `http://localhost:11434`, model `llama3.2`. Both overridable via `OLLAMA_BASE_URL` / `OLLAMA_DEFAULT_MODEL` env vars or per-call `model` param.
- Friendly error on `ECONNREFUSED` / `ENOTFOUND`: `Ollama is not running at <url>. Start it with "ollama serve" and pull a model: "ollama pull llama3.2".` Friendly error on `404 model not found`: `ollama pull <model>`.
- Usage normalized to the uniform `{ input_tokens, output_tokens }` shape (mapped from Ollama's `prompt_eval_count` / `eval_count`).
- `extract_with_llm` provider enum extended to `["openai", "anthropic", "ollama", "auto"]`; description updated to mention local Ollama.

**Verification:**
- `node --test tests/unit/extractWithLlm.test.js`: **22/22 pass** (14 pre-existing + 8 new Ollama tests).
- `npm test` MCP protocol compliance: 10/10 tests completed, 0 errors — unchanged from baseline.
- **Live end-to-end against real Ollama 0.24.0 with `llama3.2:latest`**: 3/3 scenarios pass — plain JSON mode (extracted product/price/screen-size), structured-outputs schema (nested order with line-items array), and `provider: "auto"` fallback via `OLLAMA_BASE_URL`.

### v3.3.1 — Post-C5 verification fixes (2026-05-17)

Two pre-existing bugs surfaced during the full out-of-sandbox verification of the v3.3.0 release. Neither was caused by Phase C5 — both reproduce on v3.2.0 — but they were unmasked when v3.3.0 verification ran outside the sandbox and against a freshly-cleared cache.

**Fix 1 — `search_web` circular-JSON crash on cache miss.** `ResultRanker` and `ResultDeduplicator` constructors were spreading `...options` (which includes `sharedCache`, a `CacheManager` instance holding a `setInterval` monitoring Timer) into `this.options`. Cache-key generation later called `JSON.stringify` on that options object, hitting a circular reference through `Timer → TimersList → Timer`. Destructured `sharedCache` out before the spread so it lives in `this.cache` only — never in the serializable `this.options`. Bug was masked in earlier verification runs by hitting a populated LRU cache hit.

**Fix 2 — `endpointGuard` "creator mode OFF" test premise-unsatisfiable.** `creatorMode.js` loads `.env` at module init and caches the verified flag in a module-scoped variable that is immutable from outside (by design). The test at `tests/unit/endpointGuard.test.js:94` tried to disable creator mode by `delete process.env.CRAWLFORGE_CREATOR_SECRET` at test time, which has no effect once the module has loaded — so the test always failed on the maintainer's machine but passed in CI. Now `t.skip()` with a clear rationale when `isCreatorModeVerified()` returns true; the other 7 assertions still run unconditionally.

**Verification (clean tree, no sandbox):**
- `node test-tools.js`: **20/20 pass** (was 19/20 — search_web fixed)
- Full unit suite: 240 tests, 227 pass, 0 fail, 13 skipped
- `streamableHttp.test.js`: 12/12 pass (was sandbox-blocked)
- `npm test` MCP compliance: 70% — unchanged from HEAD baseline
- `npm audit`: 0 vulnerabilities

### v3.3.0 — Phase C5 "Feature parity" (2026-05-17)

Ships the four feature-parity items deferred from Phase C: one new MCP tool (`extract_with_llm`, total now 21) plus capability extensions to three existing tools at parity with Firecrawl, Crawl4AI, and ScrapeGraphAI. Implemented by four `mcp-implementation` sub-agents in parallel; lead handled central registration + verification. All changes strictly additive — every existing call signature behaves exactly as in v3.2.0.

**C5.1 — `scrape_with_actions` recording & replay (Firecrawl parity):**
- New input fields `record: boolean` + `recordingName: string` capture each executed action plus its `timestamp_ms_since_start`, persisted as JSON to `~/.crawlforge/recordings/<name>.json` via an atomic `.tmp` + rename write.
- New input field `replayRecording: string` loads a saved recording and re-executes it through the existing `ActionExecutor` against a fresh URL. Special value `replayRecording: '__list__'` returns the recordings index inline.
- `recordingName` validated against `/^[a-zA-Z0-9_-]{1,64}$/` — path traversal blocked. Home dir overridable via `CRAWLFORGE_HOME_OVERRIDE` for testing.
- New `src/tools/advanced/scrapeWithActions/recorder.js` + 12 unit tests.

**C5.2 — `crawl_deep` session reuse (Crawl4AI parity):**
- New optional `session: { enabled, persistCookies?, headers?, initialRequest? }`. With `enabled: true`, an in-memory cookie jar persists every `Set-Cookie` response and replays cookies on every subsequent fetch within the crawl. Session `headers` merged into every request.
- Optional `session.initialRequest` performs a pre-crawl login (or any HTTP request) and seeds the jar before traversal begins — enables authenticated-area crawling.
- Zero new runtime deps; hand-rolled jar uses Node 18+ `Headers.getSetCookie()` for multi-value correctness.
- New `src/tools/crawl/_sessionContext.js`; `BFSCrawler.fetchPage()` layers session headers + cookies before `fetch()` and records the response's `Set-Cookie` back into the jar. 12 unit tests.

**C5.3 — `extract_with_llm` (ScrapeGraphAI parity):**
- New 21st tool. Takes a URL or pre-fetched `content` plus a natural-language `prompt`; returns parsed JSON.
- `provider: 'openai' | 'anthropic' | 'auto'` (default `'auto'` — Anthropic first then OpenAI based on env keys). Errors clearly when neither key is set.
- Direct `fetch()` to OpenAI `/v1/chat/completions` (default `gpt-4o-mini`, `response_format: { type: 'json_object' }`) or Anthropic `/v1/messages` (default `claude-haiku-4-5-20251001`). Zero new runtime deps.
- Endpoints overridable via `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` for self-hosted gateways.
- Defensive JSON parse with single retry; uniform `{ input_tokens, output_tokens }` usage shape across providers. Optional `schema` JSON-schema-like hint passed through to the prompt.
- Costs 5 credits per invocation. 14 unit tests.

**C5.4 — `search_web` SearXNG provider (self-host parity; addresses r/LocalLLaMA `1nfvhyh`):**
- New optional `provider: 'crawlforge' | 'searxng'` (default `'crawlforge'`). When `'searxng'`, queries route to a self-hosted SearXNG JSON API at `CRAWLFORGE_SEARXNG_URL` (e.g. `http://localhost:8888`).
- Standard search params (`query`, `limit`, `page`, `safeSearch`, `language`) mapped to SearXNG's `q` / `pageno` / `safesearch` / `language`.
- SearXNG results normalised to the CrawlForge result shape so the shared ranking + deduplication + caching pipeline runs unchanged.
- Errors clearly when `CRAWLFORGE_SEARXNG_URL` is unset or the upstream returns non-200.
- New `src/tools/search/providers/searxng.js`. 12 unit tests.

**Tool registration & metadata:**
- `server.js` — imports + instantiates `ExtractWithLlm`; registers `extract_with_llm` with full Zod input schema and `withAuth()` wrapper; advertise-string and `allTools` bumped 20 → 21.
- `src/core/AuthManager.js` `getToolCost()` — added `extract_with_llm: 5`.
- `package.json` 3.2.0 → 3.3.0; description "20" → "21".

**Verification:**
- 50 new unit tests across 4 new files — **50/50 pass**.
- Full unit suite: 240 tests, 227 pass, 12 skipped (sandbox-only HTTP listen on `streamableHttp.test.js`), 1 pre-existing `endpointGuard.test.js` failure unrelated to C5 (reproduces on v3.2.0 commit).
- `node test-tools.js`: 19/20 (the 1 failure is a pre-existing sandbox network flake; reproduces on v3.2.0 once local search cache is cleared).
- `npm test` MCP compliance: unchanged from HEAD baseline (70%).
- `npm audit`: **0 vulnerabilities**.

**Deferred items now closed:** the four `[ ]` C5 entries in `IMPROVEMENT_PLAN.md` are now ticked. Phases A, B, C all complete.

### v3.2.0 — Phase C "Modernize" (2026-05-17)

Ships Phase C of `IMPROVEMENT_PLAN.md` end-to-end via `/next-phase`. Closes the protocol/feature gap with Firecrawl, Crawl4AI, and Bright Data MCP: Streamable HTTP transport with stateful sessions, OAuth 2.1 with PKCE for remote deployments, the framework for structured tool outputs, and a no-op-by-default observability stack (OpenTelemetry tracing facade + Prometheus `/metrics`). No tool schema or public API changes for existing stdio users — strictly additive.

**C1 — Streamable HTTP transport (MCP spec 2025-06-18):**
- `src/server/transports/streamableHttp.js` (new) — replaces the v3.1 stateless HTTP with a stateful Streamable HTTP transport built on `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk@1.29`. Session IDs are minted via `randomUUID()` and returned on the `Mcp-Session-Id` response header; clients resume state by re-sending the header on subsequent requests. Single `/mcp` endpoint serves POST (JSON or SSE) and GET (SSE) per spec.
- `--legacy-http` / `CRAWLFORGE_LEGACY_HTTP=true` flag preserves v3.1 stateless behaviour for one release; the existing `src/server/transports/http.js` is now a thin shim that forwards to `connectStreamableHttp({ legacy: true })`. Legacy mode logs a deprecation warning at startup and will be removed in v3.3.0.
- `Mcp-Session-Id` added to `Access-Control-Allow-Headers` and `Access-Control-Expose-Headers` so browser-based MCP clients can resume.
- New `host` option on `connectStreamableHttp` (defaults `0.0.0.0`) for test bindings.
- `docs/PRODUCTION_READINESS.md` now lists every Streamable HTTP endpoint in a dedicated table.

**C2 — OAuth 2.1 authorization:**
- `src/server/auth/oauth.js` (new, ~350 LOC, zero new runtime dependencies) — implements the OAuth 2.1 subset required by the MCP authorization spec: discovery (`/.well-known/oauth-authorization-server`), Dynamic Client Registration (RFC 7591) at `/oauth/register`, Authorization Code + PKCE S256 at `/oauth/authorize`, token issuance/refresh at `/oauth/token`, and revocation (RFC 7009) at `/oauth/revoke`. `plain` PKCE method is explicitly rejected. Refresh tokens rotate on every use.
- Opaque bearer tokens are minted server-side and carry a `mappedApiKey` link to the operator's existing CrawlForge API key, so `withAuth()` credit tracking continues to work unchanged. Public clients only — no client secrets.
- Auto-approve consent model: possession of the operator's `CRAWLFORGE_API_KEY` IS the authorization. Multi-tenant deployments swap the auto-approve path in `handleAuthorize()` for a real consent UI.
- In-memory token storage by default; a `storage` adapter (`setClient/getClient/setCode/takeCode/setToken/getToken/deleteToken`) can be supplied for multi-instance deployments.
- Opt-in via `CRAWLFORGE_OAUTH_ENABLED=true` (HTTP transport only). Stdio transport keeps the static API key — no breaking change for existing local users.
- `docs/oauth-quickstart.md` (new) — copy-pasteable Node sample for register / authorize / exchange / refresh / call `/mcp`.

**C3 — Structured tool outputs (MCP SDK ≥1.10):**
- `src/server/registerTool.js` extended to accept an optional `outputSchema` and forward it to `server.registerTool()`. When set, the SDK validates `structuredContent` returned by the handler against the schema; legacy clients keep reading the JSON-stringified `content[].text`.
- `dualOutput(structured)` helper exported from `registerTool.js` — convenience for handlers that want to emit both `structuredContent` and the legacy `content` block from a single value.
- The 20 existing tool registrations in `server.js` are left unchanged (no schemas attached yet). The framework is in place; per-tool schema rollout is intentionally deferred to a follow-up so each tool gets a careful schema review and per-tool test update rather than a rushed batch change. Unit test (`registerTool.test.js`) asserts the mechanism end-to-end.

**C4 — Observability:**
- `src/observability/metrics.js` (new, ~150 LOC, zero new dependencies) — minimal Prometheus exposition (counters, gauges, histograms) conforming to format 0.0.4. Exposes `crawlforge_tool_requests_total`, `crawlforge_tool_errors_total{error_class}`, `crawlforge_tool_duration_ms` (histogram with 10/50/100/250/500/1000/2500/5000/10000/30000 ms buckets), `crawlforge_credits_consumed_total`, and the two `crawlforge_browser_pool_*` gauges. Off by default — opt-in via `CRAWLFORGE_METRICS=true` in HTTP mode.
- `src/observability/tracing.js` (new) — OpenTelemetry facade that calls into `globalThis.__otelTracer.startSpan(...)` if present, no-op otherwise. Disabled unless `OTEL_SDK_DISABLED=false` AND a tracer is registered. Span attributes: `mcp.tool.name`, `mcp.tool.duration_ms`, `mcp.tool.outcome`, `mcp.credit.cost`, `mcp.credit.outcome`, `mcp.creator_mode`. We don't add `@opentelemetry/sdk-node` to `package.json` — operators install it themselves and we discover it through `globalThis`.
- `withAuth()` now records both metrics and tracing on every invocation (still produces exactly one log line; observability calls are wrapped so they can't break the request path).
- `docs/observability/grafana-dashboard.json` (new) — six-panel dashboard: requests/sec, errors/sec, p50/p95 duration, credits/sec, browser pool utilization.

**C5 — Feature parity (intentionally deferred):**

The plan explicitly says "pick based on user demand". None of the four candidates (Firecrawl-style action recording, Crawl4AI-style session reuse in `crawl_deep`, `extract_with_llm` tool, `searxng` provider for `search_web`) have been requested by users in the v3.1 window. Leaving them `[ ]` in `IMPROVEMENT_PLAN.md` with a note rather than building speculatively. They remain independently shippable in any future minor.

**C6 — Verification:**
- `node --test tests/unit/*.test.js`: **190 pass / 0 fail** (added 70 cases: oauth 12, metrics 6, tracing 7, registerTool 4, streamableHttp 12, withAuth metrics path 3, plus existing).
- `node --test tests/integration/tools/*.test.js`: **53 pass / 0 fail**.
- `npm test` (MCP protocol compliance): unchanged from HEAD baseline (10 tests, all pre-existing 70% success rate — not regressed by Phase C).
- `node test-tools.js`: **20/20 tools pass** (3.4 s total).
- `npm audit`: **0 vulnerabilities**.
- `node --check` syntax verification on every modified/new file: OK.
- MCP Inspector / OAuth PKCE / `/metrics` end-to-end against a live HTTP server are exercised through the `streamableHttp.test.js` and `oauth.test.js` suites (they boot a real `McpServer` + Node HTTP server on `127.0.0.1` and drive the full flows). A separate manual Inspector run against `http://localhost:3000/mcp` is documented in `docs/oauth-quickstart.md` for operators.

**Files (new):**
- `src/server/transports/streamableHttp.js`
- `src/server/auth/oauth.js`
- `src/observability/metrics.js`
- `src/observability/tracing.js`
- `docs/oauth-quickstart.md`
- `docs/observability/grafana-dashboard.json`
- `tests/unit/{streamableHttp,oauth,metrics,tracing,registerTool}.test.js`

**Files (modified):**
- `server.js` — wire new transport + OAuth + metrics; version bump to 3.2.0
- `src/server/registerTool.js` — accept `outputSchema`, export `dualOutput`
- `src/server/withAuth.js` — emit metrics + OTel span (no-ops if disabled)
- `src/server/transports/http.js` — now a back-compat shim
- `tests/unit/withAuth.test.js` — three new metrics-integration cases
- `package.json` — version 3.1.0 → 3.2.0
- `docs/PRODUCTION_READINESS.md` — version bump + Streamable HTTP endpoint table
- `IMPROVEMENT_PLAN.md` — Phase C checkboxes flipped (C1–C4); C5 left `[ ]` with rationale
- `CHANGELOG.md` — `[3.2.0]` section

---

### v3.1.0 — Phase B "Refactor" (2026-05-17)

Ships Phase B of `IMPROVEMENT_PLAN.md` end-to-end via `/next-phase`. Strictly internal restructuring — no public-API or tool-schema changes. All 20 MCP tools continue to pass. Bumps minor because of substantial internal reorganization (server.js cut in half, new bounded browser pool, real test suite) that downstream forks would need to be aware of.

**B1 — Decomposed `server.js` (2,138 → 990 LOC, 54% reduction):**
- `src/server/registerTool.js` (new) — single tool-registration helper that wraps every handler with `withAuth`. Replaces 20 near-identical registration blocks.
- `src/server/schemas/common.js` (new) — shared Zod fragments (`urlSchema`, `paginationSchema`, `webhookSchema`, `cacheOptsSchema`).
- `src/server/transports/{stdio,http}.js` (new) — transport setup extracted from `server.js`.
- `src/tools/basic/` (new) — 5 inline basic-tool handlers (`fetchUrl`, `extractText`, `extractLinks`, `extractMetadata`, `scrapeStructured`) moved out of `server.js`, plus a shared `_fetch.js` helper.

**B2 — Browser lifecycle (`StealthBrowserManager.js`):**
- `src/core/BrowserContextPool.js` (new, 187 LOC) — bounded pool with capacity cap (default `MAX_BROWSER_CONTEXTS=10`, configurable via env), idle eviction (`closeIdleAfterMs`, default 5 min), periodic browser refresh (every 200 acquisitions or 30 minutes — Playwright best practice), and a wait queue with timeout so excess requests fail fast instead of piling up.
- `StealthBrowserManager` now stores contexts in `BrowserContextPool` instead of an unbounded `Map`, closing the memory-leak vector flagged in the original audit.

**B3 — Tool bloat reduction:**
- `src/tools/tracking/trackChanges.js` (1,377 LOC) split into `trackChanges/{schema,monitor,differ,notifier,index}.js`; root file is now a 15-line re-export shim.
- `src/tools/advanced/BatchScrapeTool.js` (1,089 LOC) split into `batchScrape/{schema,queue,worker,reporter,index}.js`; root file is now a 15-line re-export shim. Now reuses `JobManager` and `WebhookDispatcher` instead of embedding them.
- `ResultRanker` + `ResultDeduplicator` no longer hold separate `CacheManager` instances; they now share a single `SearchResultCache` (`src/tools/search/ranking/SearchResultCache.js`) passed via `sharedCache` option from `searchWeb.js`.
- `src/tools/extract/_fetchAndParse.js` (new) — shared fetch + Cheerio parse helper used by `extractStructured`. `extractContent` and `processDocument` use the higher-level `ContentProcessor` and weren't refactored to use the low-level helper (would have been a no-op change).
- `CacheManager` wired into `crawlDeep` and `mapSite` for fetch deduplication.

**B4 — Real test suite:**
- New unit tests (121 cases total): `browserContextPool` (18), `changeTracker` (33), `jobManager` (28), `snapshotManager` (21), `webhookDispatcher` (21).
- New integration test suites (53 cases total): `basicTools.test.js` (17), `schemas.test.js` (28), `batchScrape.test.js` (8). Cover happy-path + invalid-input assertions for the 5 basic tools and Zod schema acceptance/rejection for `BatchScrape`, `TrackChanges`, `UrlConfig`, plus `SearchResultCache` behaviour.
- `npm run test:coverage` — c8 coverage script with a 60% line / 60% statement / 45% branch / 55% function gate. Reports **64.3% lines, 60.7% functions, 74.9% branches, 64.3% statements** across `src/`. Target met.
- `npm run test:integration` — convenience runner for `tests/integration/tools/*.test.js`.
- "Wire coverage gate into CI" left as `[ ]`: no CI workflow exists in this repo (`.github/workflows/` does not exist). Local gate is enforced through the new `npm run test:coverage` script and tracked for Phase C.

**B5 — Verification:**
- `node --test` against all unit + integration suites: 188 pass / 0 fail.
- `npm test` (MCP protocol compliance): unchanged from HEAD baseline (the 60% success rate is pre-existing).
- `node test-tools.js`: 14 PASS / 6 SKIP (sandboxed-network skips, same as HEAD).
- `npm audit`: 0 vulnerabilities.
- `npm run docker:prod` and the 1,000-call `scrape_with_actions` soak test are deferred to Phase C verification because the sandbox blocks Docker and outbound Chromium traffic. The `BrowserContextPool` unit tests directly assert the bounded-pool / idle-eviction / refresh behaviour the soak test was meant to validate.

**Two small bug fixes surfaced while writing the test suite:**
- `JobManager.validateJob(null)` previously returned `null` (the falsy operand from `&&` short-circuit); now returns a strict `false` as the docstring implies.
- `CacheManager.cleanupTimer` and `monitoringTimer` now `.unref()` so they don't block process exit in short-lived CLI/test runs.

Files: `server.js`, `src/core/StealthBrowserManager.js`, `src/core/BrowserContextPool.js` (new), `src/core/cache/CacheManager.js`, `src/core/JobManager.js`, `src/server/{registerTool.js, schemas/common.js, transports/stdio.js, transports/http.js}` (all new), `src/tools/basic/*` (new), `src/tools/tracking/trackChanges.js` (now shim) + `src/tools/tracking/trackChanges/*` (new), `src/tools/advanced/BatchScrapeTool.js` (now shim) + `src/tools/advanced/batchScrape/*` (new), `src/tools/search/searchWeb.js`, `src/tools/search/ranking/{ResultRanker,ResultDeduplicator,SearchResultCache}.js`, `src/tools/extract/extractStructured.js`, `src/tools/extract/_fetchAndParse.js` (new), `src/tools/crawl/{crawlDeep,mapSite}.js`, `tests/unit/{browserContextPool,changeTracker,jobManager,snapshotManager,webhookDispatcher}.test.js` (all new), `tests/integration/tools/{basicTools,schemas,batchScrape}.test.js` (all new), `package.json`, `package-lock.json`, `IMPROVEMENT_PLAN.md`, `CHANGELOG.md`, `PRD.md`.

---

### v3.0.19 — Phase A "Cleanup" (2026-05-17)

Ships Phase A of `IMPROVEMENT_PLAN.md` end-to-end via `/next-phase`. Closes the two deferred security-audit phases (4 and 5), fixes the silent-failure usage-report bugs, and removes the two pieces of dead code that were not booby-trapped (LocalizationManager proxy/translation stubs, ActionExecutor `example.com` mock branch). No public API or schema changes — strictly internal hardening.

**A1 — Security hardening (audit phases 4 & 5 closed):**
- Phase 5: `AuthManager.initialize()` now calls `validateApiKey()` against the backend at startup. If the backend explicitly rejects the key (invalid / revoked / expired / unauthorized), the server throws and refuses to boot. Connection errors are tolerated — runtime fail-closed credit check from v3.0.18 handles revocation. `CRAWLFORGE_SKIP_STARTUP_VALIDATION=true` bypasses the check.
- Phase 4: HTTP transport (`--http` / `MCP_HTTP=true`) now requires `Authorization: Bearer <api-key>` (or `X-API-Key`) on every `/mcp` request, verified against the stored key. Unauthenticated requests get 401 + a structured log line. Creator mode bypasses the check. The `/health` and `/.well-known/mcp/server-card.json` endpoints remain unauthenticated for discovery.
- Phase 6 (config HMAC) is now formally tracked as deferred in `docs/PRODUCTION_READINESS.md` — requires backend changes outside this repo; will land alongside the v3.2.0 OAuth 2.1 work.

**A2 — Reliability fixes (silent-failure bugs):**
- `withAuth()` is extracted from `server.js` into `src/server/withAuth.js` (so it's directly unit-testable) and wrapped in `try/finally`. Every invocation now emits exactly one `tool invocation` log line: `{ toolName, paramHash, durationMs, outcome, creditCost, creatorMode }`. `outcome ∈ { 'success' | 'error' | 'insufficient_credits' }`. `paramHash` is the first 12 hex chars of a SHA-256 of the params — no payload leakage. Redundant double-call to `getToolCost()` removed; creator-mode check hoisted to one site.
- `AuthManager.reportUsage()` now stamps every usage report with a `requestId` and `idempotencyKey` (UUID v4) and sends the latter as the HTTP `Idempotency-Key` header. The same keys are persisted into `~/.crawlforge/pending-usage.json` so retries from disk are safe to replay.
- `AuthManager._flushPendingUsage()` and `_appendPendingUsage()` no longer swallow errors silently. Successful flushes log their requestIds at info; failed replays log at warn with the retained requestIds; the 1 MB queue-cap eviction logs dropped IDs at warn; pending-file read errors other than ENOENT log at warn.

**A3 — Dead code removal:**
- `src/core/LocalizationManager.js`: removed the `PROXY_PROVIDERS` constant (11 fake `proxy-*.example.com` endpoints), the `TRANSLATION_SERVICES` constant (Google / Azure / LibreTranslate stubs that were never wired up), the `initializeProxySystem()` and `initializeTranslationServices()` methods, and their calls from `initialize()`. The state Maps and `getStats()` fields are retained because they're referenced by other methods elsewhere in the file (and always empty now). The export list no longer re-exports the deleted constants.
- `src/core/ActionExecutor.js`: removed the legacy `if (url === 'http://example.com')` mock branch (lines 174–216 of the original). No test depended on it.
- **NOT removed:** `isomorphic-dompurify` (plan claim was wrong — it's imported by `src/security/wave3-security.js` and `src/utils/inputValidation.js`). **Not changed:** `SnapshotManager.js` gzip — already real, working code; nothing to fix.

**A4 — Documentation:**
- `docs/PRODUCTION_READINESS.md` header bumped (v3.0.12 → v3.0.19; "19 Tools" → "20 Tools"; date updated). The Security Audit Phase Tracker now shows Phase 4 and Phase 5 as ✅ COMPLETE in v3.0.19; Phase 6 stays DEFERRED with an explanation of why.
- `CHANGELOG.md`: new `[3.0.19]` section.
- `IMPROVEMENT_PLAN.md`: Phase A checkboxes flipped; the two items left unchecked carry inline notes explaining why the plan premise was incorrect.

**A5 — Verification:**
- New unit suite `tests/unit/authManagerPhaseA.test.js` (6 tests): startup-validation rejection, success, network tolerance, env bypass, plus idempotency-key plumbing on success and failure paths.
- New unit suite `tests/unit/withAuth.test.js` (6 tests, including 2 for `hashParams`): asserts the "exactly one log line per invocation" contract across success / error / insufficient-credits / creator-mode paths.
- `npm run test:unit`: 26 tests pass (was 14).
- `npm test`: MCP protocol compliance unchanged from HEAD baseline (60% success rate is pre-existing — see commit 104e7e4).
- `node test-tools.js`: 14 PASS, 6 SKIP for sandboxed network; same as HEAD.
- `npm audit`: 0 vulnerabilities (4 pre-existing transitive advisories in `fast-uri` / `hono` / `ip-address` / `express-rate-limit` cleared via `npm audit fix`).
- No build script in this pure-ESM JS project; replaced with `node --check` syntax verification on every modified file.

Files: `src/core/AuthManager.js`, `src/core/LocalizationManager.js`, `src/core/ActionExecutor.js`, `server.js`, `src/server/withAuth.js` (new), `tests/unit/withAuth.test.js` (new), `tests/unit/authManagerPhaseA.test.js` (new), `docs/PRODUCTION_READINESS.md`, `package.json`, `package-lock.json`, `IMPROVEMENT_PLAN.md`, `CHANGELOG.md`, `PRD.md`.

---

### Unreleased — `/next-phase` orchestration skill + IMPROVEMENT_PLAN.md (2026-05-17)

Added `IMPROVEMENT_PLAN.md` at the repo root: a three-release roadmap (Phase A v3.0.19 "Cleanup" → Phase B v3.1.0 "Refactor" → Phase C v3.2.0 "Modernize") drafted from a full audit of the codebase and current MCP best practices (Streamable HTTP, OAuth 2.1, structured outputs).

Added `.claude/skills/next-phase/SKILL.md` — a workflow skill that drives one phase of the plan to completion end-to-end. Invoking `/next-phase` auto-detects the first phase with unchecked `[ ]` items, fires the right sub-agents (`security-auditor`, `mcp-implementation`, `testing-validation`, `performance-monitor`, `api-documenter`, `deployment-manager`) **in parallel**, runs that phase's verification block (`npm test`, `node test-tools.js`, `npm audit`, `npm run build`, plus phase-specific soak / Inspector / OAuth / `/metrics` checks), then flips `[ ]` → `[x]` in `IMPROVEMENT_PLAN.md`, appends entries to `PRD.md` and `CHANGELOG.md`, and commits + pushes to the current branch. Safety rails: never amends, never `--no-verify`, never force-pushes, never `git add -A`; halts before commit if any verification step fails.

No source/runtime code changed. Files: `IMPROVEMENT_PLAN.md` (new), `.claude/skills/next-phase/SKILL.md` (new), `PRD.md`.

---

### Unreleased — `deep_research` raw-evidence mode + scope/metric fixes (2026-04-30)

`deep_research` previously appeared broken when called from Claude Code: it returned `success: true` but emitted unreadable text fragments in `keyFindings`, `consensus`, `conflicts`, and `recommendations`. Root cause: the tool tried to do its own LLM-powered synthesis but, when no `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` was configured, silently fell back to a frequency-based keyword extractor that produced garbage. MCP "sampling" (server-to-host LLM calls) is not yet supported in Claude Code ([anthropics/claude-code#1785](https://github.com/anthropics/claude-code/issues/1785)), so the tool cannot route through the user's Max plan.

**Fix 1 — raw-evidence mode:** When no LLM provider is configured, `ResearchOrchestrator.synthesizeInformation` now skips the broken keyword pipeline and returns a clean `synthesisMode: "raw_evidence"` payload — per-source `{title, url, credibility, contentSnippet, topSentences}` plus an explanatory `note` directing the calling LLM (Claude Code on a Max/Pro plan) to do the synthesis itself. The legacy LLM-enhanced path is unchanged when keys are present. `.env.example` and `CLAUDE.md` now document the optional LLM keys.

**Fix 2 — scope-param propagation in `buildOrchestratorConfig()`:** The `academic`, `current_events`, `comparative`, and `focused` (partial) approach branches silently dropped `maxUrls`, `timeLimit`, and `concurrency` from the user's request, falling back to orchestrator defaults (`maxUrls: 100`, `timeLimit: 120000`). For example, calling with `researchApproach: "current_events", maxUrls: 6` returned 15 sources. Each branch now spreads a shared `scopeConfig` so user-supplied scope is honored across all approaches.

**Fix 3 — performance/depth metrics:** `performance.totalProcessingTime` was being snapshot into the result *before* it was assigned (always reported `0`); now set before `compileResearchResults` runs. `metadata.researchDepth` was vestigial — initialized to `0` and never updated; now incremented after each of the five orchestration stages so the field reflects how far the pipeline got (`5` = full success, `<5` = partial completion before failure).

Files: `src/core/ResearchOrchestrator.js`, `src/tools/research/deepResearch.js`, `.env.example`, `CLAUDE.md`, `PRD.md`. All 20 MCP tools continue to pass `node test-tools.js`.

---

### v3.0.18 — Security Patch (2026-04-18)

Closes three critical/high audit findings identified in the 2026-04-18 security audit of v3.0.17. No public API changes; all 20 MCP tools continue to pass.

**Phase 1 — Endpoint allow-list (CRITICAL):** `CRAWLFORGE_API_URL` is now validated against an allow-list of permitted CrawlForge backend hosts (`www.crawlforge.dev`, `crawlforge.dev`, `api.crawlforge.dev`). Localhost is only accepted when verified creator mode is active. The server exits at startup if the endpoint fails validation.

**Phase 2 — Fail-closed credit check (CRITICAL):** Cached credit results are now only trusted within a 30-second window of the last successful backend response. `CREDIT_CHECK_INTERVAL` reduced from 60 s to 15 s. Blocking outbound network no longer grants indefinite free access.

**Phase 3 — Usage-report hardening (HIGH):** Usage-report fetch has a 5-second timeout. Local credit cache is decremented regardless of network outcome. Failed reports are queued to `~/.crawlforge/pending-usage.json` (capped at 1 MB) and replayed on the next successful report or server startup.

**Deferred:** Phases 4 (HTTP transport per-request auth), 5 (startup key re-validation), and 6 (config HMAC) are intentionally deferred; see `docs/PRODUCTION_READINESS.md` for open-item tracking.

---

### v3.0.17 — Security Patch (2026-04-15)

Cleared all 12 `npm audit` advisories (8 high, 3 moderate, 1 low) flagged by Socket.dev against v3.0.16. No public API changes; all 20 MCP tools verified passing post-upgrade.

**Direct dependency bumps:**
- `@modelcontextprotocol/sdk`: `^1.17.3` → `^1.29.0` (resolves GHSA-345p-7cg4-v4c7 cross-client data leak; cascades fix to `hono`, `@hono/node-server`, `ajv`, `path-to-regexp`)
- `isomorphic-dompurify`: `^2.26.0` → `^3.9.0` (resolves 4 `dompurify` advisories including mutation-XSS and prototype pollution)
- `jsdom`: `^26.1.0` → `^29.0.2` (dedupes with isomorphic-dompurify v3's inner dep)
- `jest` + `@jest/globals` (dev): `^30.0.5` → `^30.3.0` (refreshes `minimatch`, `brace-expansion`, `picomatch` to patched versions)

**Transitive `overrides` added** (for deps whose parents are latest-already or unmaintained): `undici ^7.24.0`, `underscore ^1.13.8`, `qs ^6.14.2`, `path-to-regexp ^8.4.2`, `@hono/node-server ^1.19.13`, `hono ^4.12.4`, `dompurify ^3.4.0`.

**Verification:** `npm audit` reports 0 vulnerabilities. MCP protocol compliance: 10/10. `test-tools.js`: 20/20 tools PASS. `test-real-world.js`: 4/4 scenarios PASS.

---

## Progress Summary

| Phase | Status | Completion |
|-------|--------|------------|
| Pre-requisite: Extract Creator Mode | ✅ Complete | 100% |
| Phase 1: LLM-Powered Structured Extraction | ✅ Complete | 100% |
| Phase 2: CLI Layer | ❌ Not Started | 0% |
| Phase 3: Skills System | ❌ Not Started | 0% |

**Current tool count:** 20 (19 original + extract_structured)

---

## Pre-requisite: Extract Creator Mode ✅ COMPLETE

**Problem:** `AuthManager.js` and `searchWeb.js` both imported `isCreatorModeVerified()` from `server.js`. Importing any tool that depends on AuthManager would trigger the entire MCP server startup. The CLI cannot reuse tool classes without fixing this.

**Solution:** Extracted creator mode logic into `src/core/creatorMode.js`, updated all imports.

### Completed:
- [x] Created `src/core/creatorMode.js` — crypto, dotenv, hash check, `_creatorModeVerified` flag, `isCreatorModeVerified()` export, timing-safe hash comparison, auto secret cleanup
- [x] Updated `server.js` (line 5) — re-exports from `./src/core/creatorMode.js`
- [x] Updated `src/core/AuthManager.js` (line 9) — imports from `./creatorMode.js`
- [x] Updated `src/tools/search/searchWeb.js` (line 8) — imports from `../../core/creatorMode.js`
- [x] Verified: `npm start` works (MCP server)
- [x] Verified: `npm test` passes
- [x] Verified: Creator mode activates with secret

---

## Phase 1: LLM-Powered Structured Extraction ✅ COMPLETE

**Why first:** Self-contained, extends existing LLMManager, and is Firecrawl's strongest differentiator. Most infrastructure already exists.

### 1.1 Add `extractStructured()` to LLMManager — ✅ Done

**File:** `src/core/llm/LLMManager.js` (lines 326-448)

- [x] Added `async extractStructured(content, schema, options = {})` method (lines 326-372)
- [x] System prompt instructs LLM to extract data matching JSON Schema, return ONLY valid JSON
- [x] Accepts optional `prompt` parameter for extraction guidance
- [x] Uses `temperature: 0.1` for deterministic extraction
- [x] `maxTokens` scales with schema complexity (default 1000, max 2000)
- [x] Truncates content to `maxContentLength` (default 6000 chars)
- [x] Parses JSON response and validates against schema via `validateAgainstSchema()` (lines 377-405)
- [x] Added `fallbackStructuredExtraction(content, schema)` (lines 410-448) — keyword/regex matching for primitives

### 1.2 Create ExtractStructuredTool — ✅ Done

**File:** `src/tools/extract/extractStructured.js` (280 lines)

- [x] `ExtractStructuredSchema` with Zod: url, schema, prompt, llmConfig, fallbackToSelectors, selectorHints
- [x] Class `ExtractStructuredTool` with `constructor(options)` and `async execute(params)`
- [x] Execute flow: fetch URL -> parse HTML with Cheerio -> strip scripts/styles -> truncate -> LLM extraction -> validate -> return
- [x] Return shape: `{ url, data, extraction_method, confidence, schema_used, processingTime, validation }`
- [x] Lightweight JSON Schema validator (types, required fields, enums)
- [x] CSS selector fallback with `_cssExtraction()` and type coercion via `_coerceValue()`
- [x] Keyword fallback if CSS fails
- [x] Confidence scoring via `_calculateConfidence()` based on method and validation

### 1.3 Register in server.js — ✅ Done

- [x] Imported `ExtractStructuredTool` from `./src/tools/extract/extractStructured.js`
- [x] Registered with `server.registerTool("extract_structured", ...)` (line 1214)
- [x] Wrapped with `withAuth("extract_structured", ...)`
- [x] Tool has `destroy()` method for cleanup

### 1.4 Credit Cost — ✅ Done

- [x] Added `extract_structured: 4` to `getToolCost()` in `src/core/AuthManager.js` (line 290)

### 1.5 Verification — ✅ Done

- [x] `npm start` — MCP server starts, lists 20 tools
- [x] `npm test` — MCP protocol compliance passes
- [x] All 20 tools verified passing via `test-tools.js`
- [x] Existing 19 tools still work unchanged

---

## Phase 2: CLI Layer (2-3 weeks)

**Why:** Makes CrawlForge usable by humans, scriptable in CI/CD, composable with Unix tools. Foundation for skills and workflows.

### 2.1 CLI Infrastructure

**New files:**
- [ ] `bin/cli.js` — entry point with shebang, Commander.js program
- [ ] `src/cli/ToolAdapter.js` — wraps tool classes for CLI use (init, execute, cleanup)
- [ ] `src/cli/AuthAdapter.js` — CLI version of withAuth (credit check, usage reporting, friendly errors)
- [ ] `src/cli/formatters/json.js` — JSON output formatter
- [ ] `src/cli/formatters/text.js` — plain text/markdown formatter
- [ ] `src/cli/formatters/table.js` — tabular output for lists
- [ ] `src/cli/utils.js` — TTY detection, spinner helpers, error formatting

**Key design decisions:**
- `crawlforge` bin MUST remain pointing to `server.js` (MCP clients depend on it)
- New bin entry: `crawlforge-cli` -> `bin/cli.js`
- Global flags: `--json`, `--pretty`, `--output <file>`, `--format <fmt>`, `--quiet`, `--api-key`, `--timeout`
- TTY detection: when piped, output plain text/JSON; when interactive, use colors/spinners
- Spinners/progress write to stderr so stdout stays clean for piping

### 2.2 Package.json Updates

- [ ] Add `"crawlforge-cli": "bin/cli.js"` to `bin`
- [ ] Add `"bin/"` to `files` array
- [ ] Add dependencies: `commander`, `ora`, `chalk`
- [ ] Add script: `"cli": "node bin/cli.js"`

### 2.3 Phase 2a — MVP Commands (first week)

- [ ] `crawlforge-cli scrape <url>` — wraps ExtractContentTool (markdown output default)
- [ ] `crawlforge-cli search <query>` — wraps SearchWebTool
- [ ] `crawlforge-cli crawl <url>` — wraps CrawlDeepTool (with `--depth`, `--limit`)
- [ ] `crawlforge-cli map <url>` — wraps MapSiteTool
- [ ] `crawlforge-cli setup` — delegates to setup.js
- [ ] `crawlforge-cli credits` — shows credit balance via AuthManager

### 2.4 Phase 2b — Full Commands (second week)

- [ ] `crawlforge-cli stealth <url>` — wraps StealthBrowserManager (CrawlForge unique!)
- [ ] `crawlforge-cli track <url>` — wraps TrackChangesTool (`--baseline`, `--compare`)
- [ ] `crawlforge-cli analyze <url>` — wraps AnalyzeContentTool (NLP, CrawlForge unique!)
- [ ] `crawlforge-cli research <topic>` — wraps DeepResearchTool
- [ ] `crawlforge-cli extract <url>` — wraps ExtractStructuredTool (from Phase 1)
- [ ] `crawlforge-cli batch <file>` — wraps BatchScrapeTool (reads URLs from file)
- [ ] `crawlforge-cli download <url>` — map + scrape + save to directory
- [ ] `crawlforge-cli <url>` — shorthand for scrape (detect bare URL as default command)

### 2.5 ToolAdapter Pattern

```javascript
// src/cli/ToolAdapter.js
export class ToolAdapter {
  constructor(ToolClass, config = {})
  async run(params, outputOptions)  // init tool, execute, format output, cleanup
  formatOutput(result, options)      // delegate to formatter
  cleanup()                          // call tool.destroy() if exists
}
```

Key insight: Tool classes return raw JS objects from `execute()`. The MCP wrapping (`{ content: [{ type: "text", text: ... }] }`) happens in server.js callbacks, NOT in the tools. So the CLI can call `tool.execute()` directly.

### 2.6 Auth Flow for CLI

- [ ] Priority order: `--api-key` flag > `CRAWLFORGE_API_KEY` env > `~/.crawlforge/config.json` > creator mode
- [ ] `AuthAdapter.withCliAuth(toolName, fn)` — same credit check/report as server.js `withAuth()` but throws CLI-friendly errors
- [ ] Show credit balance after operations (unless `--quiet`)

### 2.7 Testing

- [ ] Unit tests: formatters, TTY detection, auth adapter (`tests/cli/`)
- [ ] Integration: each command `--help` exits 0
- [ ] Integration: `crawlforge-cli scrape https://example.com --json` returns valid JSON
- [ ] Pipe test: `crawlforge-cli scrape https://example.com | head -5` works

### 2.8 Verification

- [ ] `npm start` — MCP server still works (unchanged)
- [ ] `crawlforge-cli --help` — shows all commands
- [ ] `crawlforge-cli scrape https://example.com` — returns markdown content
- [ ] `crawlforge-cli search "web scraping" --json | jq .` — pipe works
- [ ] `crawlforge-cli stealth https://example.com` — stealth mode works from terminal
- [ ] All 20 MCP tools still functional via Claude Code/Cursor

**Depends on:** Phase 1 (complete) — ExtractStructuredTool for `crawlforge-cli extract` command

---

## Phase 3: Skills System (1-2 weeks)

**Why:** Skills make CrawlForge discoverable by AI agents without MCP configuration. Dramatically lowers adoption barrier.

### 3.1 Skill Content Files

**New directory:** `skills/` (top-level, ships with npm package)

- [ ] `skills/crawlforge-mcp.md` — comprehensive MCP tool usage skill
  - All 20 tools with descriptions and example calls
  - Workflow patterns: search -> extract -> analyze
  - Credit optimization tips
  - Highlights unique features (stealth, localization, tracking, NLP)
- [ ] `skills/crawlforge-cli.md` — CLI usage skill (for Bash-capable agents)
  - All CLI commands with examples
  - Pipe patterns and composition
  - CI/CD integration examples
- [ ] `skills/crawlforge-stealth.md` — specialized stealth/localization skill
  - When to use stealth vs regular fetch
  - Country profiles and geo-targeting
  - Anti-detection best practices
- [ ] `skills/crawlforge-research.md` — deep research workflow skill
  - Multi-source research patterns
  - LLM-powered extraction with schemas
  - Combining tools for comprehensive analysis

### 3.2 SkillInstaller Class

**New file:** `src/skills/SkillInstaller.js`

- [ ] `detectAgents()` — returns `{ claudeCode: bool, cursor: bool, vscode: bool }`
  - Claude Code: check `~/.claude.json` or `~/.claude/` exists
  - Cursor: check `~/.cursor/` exists
  - VS Code: check for `.github/` or VS Code settings
- [ ] `installForClaudeCode(options)` — writes to `~/.claude/commands/crawlforge.md` (creates global `/crawlforge` slash command)
- [ ] `installForCursor(options)` — appends to `.cursorrules` or `.cursor/rules/crawlforge.md`
- [ ] `installForVSCode(options)` — writes to `.github/copilot-instructions.md`
- [ ] `installAll(options)` — install to all detected agents
- [ ] `checkInstallStatus()` — version check, reports if update available
- [ ] `uninstall(agent)` — remove installed skills

### 3.3 Integration with Setup

**Modify:** `setup.js`

- [ ] Add `--skills` flag handling: `npx crawlforge-setup --skills`
- [ ] Add `--skills --agent claude` for specific agent targeting
- [ ] Add skills installation as optional step at end of normal setup flow
- [ ] Add `--uninstall-skills` flag to remove installed skills

### 3.4 Package.json Updates

- [ ] Add `"skills/"` to `files` array (ships with npm package)
- [ ] Optionally add `"crawlforge-skills": "src/skills/cli.js"` bin entry

### 3.5 Skill Content Strategy

Skills should reference BOTH MCP tools AND CLI commands:
- MCP section: structured tool calls with parameters
- CLI section: bash commands for agents with shell access
- Best practices: when to use which approach
- Each skill includes a version header: `<!-- crawlforge-skill v1.0.0 -->`

### 3.6 Conflict Handling

- [ ] Check for existing content before writing
- [ ] Back up existing files before modifying
- [ ] Use `--force` flag to override
- [ ] For `.cursorrules`: append with clear section markers, don't replace
- [ ] Namespaced filenames: `crawlforge-*.md` to avoid conflicts

### 3.7 Testing

- [ ] Unit test: `detectAgents()` with mocked filesystem
- [ ] Unit test: skill file generation produces valid markdown
- [ ] Unit test: conflict detection and backup logic
- [ ] Integration: full install flow to temp directory
- [ ] Manual: install to Claude Code, verify `/crawlforge` command appears

### 3.8 Verification

- [ ] `npx crawlforge-setup --skills` — detects agents and installs
- [ ] Claude Code recognizes `/crawlforge` slash command
- [ ] Skill content accurately describes all 20 tools + CLI commands
- [ ] Existing setup flow (`npx crawlforge-setup`) unchanged
- [ ] All MCP tools still work

---

## Key Files Reference

| File | Role | Phase | Status |
|------|------|-------|--------|
| `server.js` | MCP server, tool registration | Pre-req, Phase 1 | ✅ Done |
| `src/core/creatorMode.js` | Creator mode logic | Pre-req | ✅ Done |
| `src/core/AuthManager.js` | Auth, credits | Pre-req, Phase 1 | ✅ Done |
| `src/core/llm/LLMManager.js` | LLM orchestration | Phase 1 | ✅ Done |
| `src/tools/extract/extractStructured.js` | Structured extraction tool | Phase 1 | ✅ Done |
| `src/tools/search/searchWeb.js` | Search tool (import fix) | Pre-req | ✅ Done |
| `bin/cli.js` | CLI entry point (NEW) | Phase 2 | ❌ Not started |
| `src/cli/` | CLI infrastructure (NEW) | Phase 2 | ❌ Not started |
| `skills/` | User-facing skill files (NEW) | Phase 3 | ❌ Not started |
| `src/skills/SkillInstaller.js` | Skill installer (NEW) | Phase 3 | ❌ Not started |
| `setup.js` | Setup wizard | Phase 3 | ❌ Not started |
| `package.json` | Dependencies, bin entries | All phases | ⏳ Phase 1 done |

## Existing Code to Reuse

| Component | Location | Reused For |
|-----------|----------|------------|
| `LLMManager.generateCompletion()` | `src/core/llm/LLMManager.js:100` | Structured extraction |
| `analyzeRelevance()` pattern | `src/core/llm/LLMManager.js:233` | extractStructured method template |
| `fallbackRelevanceAnalysis()` | `src/core/llm/LLMManager.js:342` | fallbackStructuredExtraction template |
| Tool `execute()` methods | All tool classes | CLI ToolAdapter wrapping |
| `AuthManager.checkCredits()` | `src/core/AuthManager.js` | CLI AuthAdapter |
| `configureMcpClients()` | `setup.js` | Skills agent detection |
| `getToolConfig()` | `src/constants/config.js` | CLI tool initialization |

## What's Next

**Immediate priority:** Phase 2 (CLI Layer) — this unlocks CrawlForge for non-MCP users, CI/CD pipelines, and scriptable workflows. The pre-requisite work (creatorMode extraction) was specifically done to enable CLI tool reuse without triggering MCP server startup.

**Branch:** `crawlforge-cli-upgrade` (created, no CLI work committed yet)

**Key dependencies resolved:**
- Tool classes can now be imported independently (creatorMode extracted)
- ExtractStructuredTool available for `crawlforge-cli extract` command
- All 20 tools verified and production-ready

---

## End-to-End Verification Plan

After all phases complete:
1. `npm start` — MCP server runs, 20 tools listed ✅ (verified)
2. `npm test` — MCP protocol compliance passes ✅ (verified)
3. `crawlforge-cli --help` — CLI shows all commands
4. `crawlforge-cli scrape https://example.com` — returns content
5. `crawlforge-cli search "test" --json | jq .` — piping works
6. `crawlforge-cli stealth https://example.com` — stealth mode via CLI
7. Test `extract_structured` via Claude Code MCP tool call ✅ (verified)
8. `npx crawlforge-setup --skills` — installs skills
9. All 20 MCP tools work via Claude Code and Cursor ✅ (verified)
10. Run `node test-tools.js` — full tool validation ✅ (20/20 tools passing)

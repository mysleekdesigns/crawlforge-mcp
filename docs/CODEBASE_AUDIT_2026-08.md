# CrawlForge MCP Server — Deep Codebase Audit & Improvement Plan

**Date:** 2026-08-03 · **Version audited:** 4.10.0 · **Scope:** all 27 MCP tools + core infrastructure, dependency posture, MCP-spec/competitive positioning.

**Method:** 7 parallel static code auditors (one per subsystem) → adversarial verification of every critical/high finding by an independent reviewer → live smoke-tests of all 27 tools over the real MCP connection → 2 research agents (dependency currency + MCP-spec/competitor scan) driven through CrawlForge's own tools and the npm registry. Two of the most consequential claims (the SSRF IP-literal bypass and the `map_site` raw-fetch bypass) were additionally re-read by hand and confirmed.

---

## Baseline health (what's already good)

- **`npm run test:unit`: 480/480 pass** (85 suites, ~1.75s). **`npm test` (MCP protocol compliance): 100.0% COMPLIANT, 0 errors.**
- **All 27 tools pass a live happy-path smoke-test** over the real MCP connection — every tool returns a well-formed, contract-shaped result on safe public targets. Nothing is broken in the default single-user stdio + static-API-key deployment path.
- Genuinely solid: the 27 tool registrations (names/costs/annotations), creator-mode gating, `endpointGuard` (fail-closed, localhost only in creator mode), secret-masked Winston→stderr logging, the agent hard-stops (`maxSteps`/`maxUrls`/wall-clock clamped by the orchestrator, covered by tests), `serp_rank`/DataForSEO (correct Basic auth, depth≤200, 0-credit-when-unconfigured, no fabrication, 29 tests), and the plain-fetch batch pipeline (per-URL isolation, semaphore concurrency, 7-type action allowlist with `executeJavaScript` hard-gated).

**The catch:** the smoke-tests pass because they exercise the *happy path*. The static audit + adversarial verification found **109 real defects off that path** — and several of them void security guarantees the docs currently assert. "Zero errors" is not yet true; this document is the map to get there.

---

## Executive summary

| Severity | Count | Verified CONFIRMED (of crit/high) |
|---|---|---|
| 🔴 Critical | 5 | 5 / 5 |
| 🟠 High | 28 | 28 / 28 |
| 🟡 Medium | 47 | — |
| ⚪ Low | 29 | — |
| **Total** | **109** | **33 serious, all confirmed** |

**Plus a security-dependency backlog:** `npm audit` = **16 vulnerabilities (8 high, 6 moderate, 2 low)**, most fixable by `npm update` inside existing caret ranges with zero code change. Two abandoned deps (`node-summarizer` last published 2019, `pdf-parse` 1.x is the 2018 release) and an unfixable transitive HIGH (`adm-zip` via `camoufox`).

### The 5 critical findings (all CONFIRMED)

1. **SSRF guard is completely bypassed for IP-literal URLs** (`src/utils/ssrfGuard.js:129`). The guard enforces only at undici *connect-time DNS `lookup`*, which Node skips for literal IPs. `fetch_url({url:"http://169.254.169.254/latest/meta-data/..."})` — or any public page 302-redirecting to an internal IP — returns internal/cloud-metadata content. Reproduced end-to-end (`REACHED http://127.0.0.1:.../ "INTERNAL SECRET"`). This alone voids the v4.8.0 "SSRF is now enforced on every scrape path" claim.
2. **`scrape_with_actions` / Playwright navigation has no SSRF guard at all** (`src/core/ActionExecutor.js:827`). The undici dispatcher doesn't apply to Chromium; `page.goto()` on an internal/metadata URL is a full internal-network read primitive.
3. **`map_site` page & metadata fetches bypass the guard** (`src/tools/crawl/mapSite.js:264`) — raw global `fetch`. Reproduced: returned `["http://127.0.0.1:.../secret-internal"]`.
4. **`crawl_deep` aborts the entire crawl with "Promise timed out" whenever it outlives `timeout`, and always fails when `concurrency ≤ max_depth`** (`src/core/crawlers/BFSCrawler.js:241`). Children are `await`ed from inside a queued p-queue task whose timeout spans the whole recursive crawl. Reproduced: a 25-page crawl returned 0 results. With the default `CRAWL_TIMEOUT=30000`, essentially every real crawl at the advertised `max_pages` throws away everything it fetched. **`crawl_deep` is effectively unusable for non-trivial crawls.**
5. **OAuth `authorize` endpoint auto-approves any anonymous client** (`src/server/auth/oauth.js:199`). With `CRAWLFORGE_OAUTH_ENABLED=true`, open Dynamic Client Registration + no credential check on `/authorize` = anyone can mint a bearer token bound to the **operator's** CrawlForge key and spend their credits. (Opt-in flag, so blast radius is limited to operators who enable HTTP+OAuth.)

### Systemic themes (fix the pattern, not just the instance)

- **SSRF enforcement is coupled to *one* fetch mechanism.** The guard lives in a custom undici dispatcher, so it only protects `undici`/`safeFetch` call sites. Every other outbound path is unguarded: Playwright navigation, raw `global fetch` (`map_site`, `deep_research` webhooks), the PDF downloader, and webhook delivery/health-checks. Even the guarded path is bypassable via IP-literal and IPv4-mapped-IPv6 hosts. **Root fix:** a single `assertUrlAllowed(url)` pre-flight (host → `net.isIP` / DNS resolve → `ipBlocked`) that *every* outbound site calls, plus post-navigation `page.url()` re-validation for the browser paths.
- **Result caches omit request parameters from their keys.** `crawl_deep` (key = `{url,depth,pages}`) and `map_site` (key = `{url,maxUrls}`) return cached payloads that contradict the new request — `search`/ranking, `extract_content:false`, include/exclude patterns, domain filters all silently ignored on a cache hit for the full 1h TTL.
- **Timers and browser handles leak.** `CacheManager` (per `crawl_deep`), non-stealth `BrowserContext` (per action call), `batchResults` map, `SnapshotManager` metadata cache, localization/track-changes intervals — all accumulate for the process lifetime. A long-running MCP server grows without bound.
- **A whole class of tool *options* silently doesn't work.** `z.object({}).optional()` strips unknown keys, so `extract_content`/`summarize_content`/`analyze_content` receive `{}` — every documented option is unreachable. Same shape of bug: `summarize_content`'s extractive path throws internally on a wrong `node-summarizer` method and always returns a 2-sentence fallback; `deep_research`'s advertised tuning params and `searchConfig` keys don't match the constructors that consume them.
- **Tests validate stubs, not the real modules.** All six `tests/unit/tools/extract/` suites (and much of templates/localization) exercise locally-defined stub classes, so none of the above defects were catchable by the green test suite. This is why 480/480 + 100% compliance coexists with 109 real bugs.

---

## Phased execution plan

Ordered by (risk reduction × user-visible impact) ÷ effort. Each phase ends with a concrete verification gate. Phases 0–4 are pure bug/security fixes with no external decisions needed; Phases 5–6 require product decisions (flagged **DECISION**).

### Phase 0 — Zero-risk security & currency `~1 hr, no code change`
- `npm update` within existing carets: SDK `1.29→1.30` (clears the @hono/node-server moderate + gains stdio buffer limit & Streamable-HTTP keep-alive fixes), **undici `7.25→7.29` (clears 2 HIGH: SOCKS5 TLS-bypass + Set-Cookie header injection)**, `isomorphic-dompurify→3.19` (clears DOMPurify moderates), `lru-cache`, `jsdom→29.1`, `compromise`, `cheerio→1.2`.
- Add an npm `overrides` entry pinning `adm-zip` ≥0.6 if a compatible version resolves under `camoufox`; else document it as install-time-only exposure.
- **Verify:** `npm audit` high-count drops materially; `npm run test:unit` (480/480) and `npm test` (100%) stay green.

### Phase 1 — Critical security holes `SSRF + OAuth + secret leakage`
- **Unify SSRF enforcement.** Add `assertUrlAllowed(url)` (pre-flight: `net.isIP(host)` → `ipBlocked`; else it's covered by the dispatcher) and fold `config…blockedDomains` in. Fix IPv4-mapped IPv6 in `ipBlocked` (`::ffff:127.0.0.1`). Route the four unguarded paths through it: `map_site` fetch → `safeFetch`; PDF download → `safeFetch`; webhook delivery + health-check + `deep_research` webhook → `safeFetch`; Playwright `page.goto` → pre-validate + re-validate `page.url()` after navigation.
- **OAuth:** gate `/authorize` on proof of the operator API key (or disable open DCR) so tokens can't be minted anonymously.
- **Secrets:** run `requestData` through `maskSecrets()` before usage telemetry (`AuthManager.js:338`); stop logging user LLM API keys in `deep_research` (`deepResearch.js:120`).
- **Verify:** new `ssrfGuard` regression suite — literal IPv4/IPv6, decimal/hex IP forms, IPv4-mapped IPv6, and a redirect-to-internal hop — each asserted BLOCKED on *every* fetch path (fetch/scrape/map/pdf/actions/webhook). OAuth test asserting anonymous `/authorize` is rejected.

### Phase 2 — Tool-breaking correctness bugs `make every tool actually work`
- **`crawl_deep`:** refactor BFS so discovered URLs go on a work-list driven from `crawl()` (never `await queue.add()` from inside a queued task), or drop the per-task p-queue `timeout`/`throwOnTimeout`. Restores real crawls and low-concurrency crawls.
- **Cache keys:** hash full validated params for `crawl_deep` and `map_site` (or rank/filter *after* the cache read).
- **`summarize_content`:** fix the `node-summarizer` call (`new SummarizerManager(text, n)` + `getSummaryByRank()`); assert `summaryLength` changes output.
- **Options plumbing:** add `.passthrough()` to the three stripped `options` schemas (match `process_document`).
- **`extract_structured`:** guard non-identifier schema keys before building CSS attribute selectors.
- **`extract_links`:** resolve relative hrefs against the final page URL, not the origin.
- **Sitemaps:** stop double-gunzipping already-decompressed bodies (magic-byte sniff); surface parse failures.
- **`track_changes`:** compute similarity from content (Jaccard in `differ.js`), not hamming distance of hashes; fix `SnapshotManager` delta path that discards new content; give `generate_llms_txt` a fresh analyzer per call.
- **`deep_research`:** clamp `maxSourcesPerQuery ≤ 100`; restore the 4 dropped state maps in `initializeResearchSession`.
- **Ranking:** deep-merge partial `ranking_weights`/`deduplication_thresholds` so tuning doesn't produce `NaN`.
- **Verify:** replace stub tests with real-module unit tests reproducing each bug, then green. Add a live re-smoke of `crawl_deep` (multi-page), `summarize_content` (long≠short), `extract_links` (non-root page).

### Phase 3 — Resource leaks & robustness `long-running-server health`
- Close owning `BrowserContext` in `ActionExecutor` finally + on `goto` failure. Add `destroy()` to `BFSCrawler`/`CacheManager` and call it in a `finally` from `crawl_deep`. TTL-sweep + LRU-cap `batchResults`. Strip content from `.meta` files + bound `metadataCache`. Store/clear localization & track-changes intervals; make the track-changes singleton lazy/unref'd. Arm the body-read timeout in `_fetch.js`; add timeouts to PDF/batch/searxng fetches. Add `extractContentTool`/`processDocumentTool` to `gracefulShutdown`. Make `deep_research`'s time budget actually cancel in-flight work (AbortSignal) and clear its racer timers.
- **Verify:** WeakRef/`--expose-gc` leak assertions where feasible; a shutdown test asserting no live browser/timer handles remain.

### Phase 4 — HTTP transport + medium/low cleanup `HTTP deployments + polish`
- Rework `streamableHttp` to the SDK's per-session-transport map (fixes single-session brick + reconnect + DELETE); fix the legacy stateless mode (fresh transport per request) or remove it. Fix the `getting-started` prompt registration (`registerPrompt`). Then work the medium/low catalog (charset detection, `<base href>`, protocol-relative link classification, `CircuitBreaker` constructor TypeError, webhook HMAC/timeout, discovery-metadata staleness, schema drifts).
- **Verify:** HTTP transport tests for a 2nd session, reconnect, and DELETE; a prompt-retrieval test; re-run full suites.

### Phase 5 — Dependency modernization `DECISION: raise Node floor to ≥20`
- Raising `engines` to `>=20` unlocks security/maintenance upgrades: **node-cron `3→4`** (only fix for its `uuid` advisory), **pdf-parse `1→2`** (replaces the abandoned 2018 release; API port in `PDFProcessor`), **p-queue `8→9`** (audit `throwOnTimeout` reliance first), **commander `12→14`**, **@googleapis/customsearch `5→8`**, **diff `8→9`**; and **drop `node-summarizer`** (abandoned) in favor of the existing `compromise` path.
- **Defer to a Node-22 + SDK-v2 phase:** undici 8 (needs SSRF-dispatcher retest), jsdom 30, zod 4.
- **Verify:** each upgrade is its own PR with the tool's smoke-test re-run; suites green.

### Phase 6 — MCP-spec & competitive upgrades `DECISION: product roadmap`
- **Low-risk, adopt soon:** emit `outputSchema` + `structuredContent` (structured output is now the norm; most tools already return typed JSON); JSON Schema 2020-12 dialect; deterministic tool ordering + `CacheableResult ttlMs` on `tools/list`; surface input-validation (zod) failures as *tool execution errors*, not protocol errors (SEP-1303); publish `server.json` to the live MCP Registry.
- **Bigger bets (each a DECISION):** async **tasks** pattern (`io.modelcontextprotocol/tasks`) for `crawl_deep`/`batch_scrape`/`deep_research`/`agent` — matches the spec *and* Firecrawl's job-ID+poll pattern; a **hosted remote endpoint with OAuth** (table-stakes vs Firecrawl/Tavily/Exa/Bright Data); a **keyless free tier** (acquisition funnel); **scheduled monitoring + change-judging** for `track_changes`; **client-side tool selection** (a `TOOLS`/`GROUPS` env whitelist) to tame 27-tool context bloat; an optional **`redactPII`** flag.
- **Note:** the SDK v2 line (2026-07-27, MCP spec 2026-07-28) is the real long-horizon item — it drags Node≥20 + zod 4 and reworks the elicitation/sampling model (MRTR). Plan it as its own initiative *after* Phases 0–4 land.

---

## Dependency & security posture (details)

`npm audit`: **16 vulns (8 high / 6 moderate / 2 low)**. Highlights — undici ≤7.27.2 (2 HIGH, fixed by `npm update`→7.29); MCP SDK 1.29 → vulnerable @hono/node-server (fixed by →1.30); `adm-zip` <0.6 HIGH via `camoufox` (no upstream fix — install-time only); `brace-expansion`/`js-yaml`/`fast-uri`/`hono` HIGH via dev/optional trees (mostly `npm audit fix`).

Currency (registry-verified 2026-08-03), decisions only:

| package | pinned | latest | action |
|---|---|---|---|
| @modelcontextprotocol/sdk | ^1.29.0 | 1.30.0 (v1); **v2.0 exists** | **Phase 0:** →1.30. v2 = its own initiative (Node≥20, zod 4, spec 2026-07-28). |
| undici | ^7.24.0 | 7.29 (v7); 8.9 breaking | **Phase 0:** →7.29 (2 HIGH). v8 needs Node≥22.19 + SSRF-dispatcher retest → defer. |
| pdf-parse | ^1.1.1 | 2.4.5 breaking | **Phase 5:** v1 is abandoned/2018; v2 is an ESM rewrite (code port). |
| node-cron | ^3.0.3 | 4.6.0 breaking | **Phase 5:** v4 is the only fix for its `uuid` advisory. |
| node-summarizer | ^1.0.7 | 1.0.7 **abandoned (2019)** | **Phase 5:** drop; use the `compromise` path. |
| isomorphic-dompurify | ^3.9.0 | 3.19 | **Phase 0:** →3.19 (DOMPurify advisories); watch jsdom-30/Node-22 coupling above 3.19. |
| p-queue / commander / diff / @googleapis/customsearch | 8 / 12 / 8 / 5 | 9 / 15 / 9 / 8 | **Phase 5** (Node≥20; verify `throwOnTimeout`, ESM-only at commander 15). |
| zod / jsdom | 3.25 / 29.1 | 4.4 / 30 | Defer to the SDK-v2 phase (breaking, wide blast radius). |
| playwright / cheerio / winston / lru-cache / dotenv / compromise / franc / turndown / robots-parser | — | minor | inside carets — `npm update` (Phase 0). |

## MCP spec deltas that matter (since rev 2025-06-18)

Two revisions shipped: **2025-11-25** and **2026-07-28** (final, six days before this audit).
- **Tasks** (async long-running requests, now the official `io.modelcontextprotocol/tasks` extension) — the sanctioned pattern for `crawl_deep`/`batch_scrape`/`deep_research`/`agent`.
- **Input-validation errors → Tool Execution Errors, not Protocol Errors** (SEP-1303) — lets the model self-correct on a bad `params`.
- **JSON Schema 2020-12** is the default dialect; `inputSchema`/`outputSchema` loosened to full 2020-12; `structuredContent` any JSON. CrawlForge tools still return JSON-as-text with no `outputSchema`.
- **`tools/list` caching** (`ttlMs` + `cacheScope`) and deterministic tool ordering for prompt-cache hits.
- **2026-07-28 is a major rewrite** (stateless core, `server/discover`, MRTR replacing elicitation/sampling wire calls, Roots/Sampling/Logging deprecated, DCR → Client ID Metadata Documents). This lands with SDK v2 — a deliberate, later initiative. Tool annotations (`readOnlyHint` etc.) are unchanged and already adopted.
- The **official MCP Registry** is live and publishable (`server.json`, DNS/GitHub-verified namespace).

## Competitor features worth adopting (mid-2026 table-stakes)

- **Hosted remote MCP endpoint + OAuth** — Firecrawl/Tavily/Exa/Bright Data all ship one; CrawlForge is stdio/local-HTTP only.
- **Keyless free hosted tier** — Firecrawl & Bright Data both offer no-key/no-card entry (acquisition funnel).
- **Async agent/job pattern** — Firecrawl `firecrawl_agent` returns a job ID + status poll; CrawlForge `agent` (cost 8) blocks synchronously.
- **Scheduled monitoring with change-judging + webhooks** — Firecrawl `monitor_*`; CrawlForge `track_changes` is on-demand only.
- **Persistent interactive browser sessions** — Firecrawl `interact`/Bright Data snapshot tools; `scrape_with_actions` is one-shot.
- **Client-side tool selection** (`TOOLS`/`GROUPS` whitelist) to control 27-tool context bloat — Bright Data & Exa both ship it.
- **PII redaction**, **credit-refund feedback loop**, **vertical structured-data tools** (a cheap npm/PyPI "code" group is loved by coding agents).
- **Already at parity:** multi-format single-fetch scrape + branding, map/crawl split, document parsing, batch, deep research, stealth (arguably ahead of Tavily/Exa), skills install.

---

## Appendix: full findings catalog (109)

Each finding: severity · verification verdict (for crit/high) · `file:line` · failure scenario · fix. Grouped by subsystem, most-severe first.

### A. Server, Auth, Billing & Transports

> **Auditor's read:** The stdio core path — 27 correctly named/priced tool registrations, creator-mode gating, endpointGuard (fail-closed, localhost only in creator mode), secret-masked Winston logging to stderr — is solid and well unit-tested. The weak flanks are everything off that happy path: the HTTP transport layer is materially broken (single-session stateful mode, dead legacy mode), the opt-in OAuth provider is an outright auth bypass that mints operator-billed tokens to anonymous callers, and the advertised getting-started prompt cannot be retrieved by any client. Billing correctness also has real gaps — half-charges for calls refused by the credit check, raw params (including third-party API keys and webhook secrets) shipped unmasked in usage telemetry, and backend rejections of usage reports silently swallowed. None of these compromise the primary stdio + static-key deployment, but the HTTP/OAuth surface should not be considered production-ready as shipped.


**🔴 CRIT · _CONFIRMED_ — OAuth authorize endpoint auto-approves any client with no authentication, minting tokens bound to the operator's API key**  
`src/server/auth/oauth.js:199`  
With CRAWLFORGE_OAUTH_ENABLED=true, an anonymous attacker can: (1) POST /oauth/register (open dynamic client registration, oauth.js:146-172, no auth), (2) GET /oauth/authorize with their client_id and a PKCE challenge — handleAuthorize performs no credential check whatsoever and auto-approves (lines 199-214), issuing a code with mappedApiKey = the operator's CrawlForge key, (3) exchange it at /oauth/token for a bearer token that streamableHttp.js accepts via validateBearer (streamableHttp.js:214-217). Result: full MCP tool access billed to the operator's CrawlForge credits. The comment claims 'possession of the operator's apiKey IS the authorization' but the flow never requires possession of anything.  
*Fix:* Require proof of the API key (or an operator-approved consent step) at /oauth/authorize before issuing a code; at minimum gate authorize on a shared secret or disable open registration.


**🟠 HIGH · _CONFIRMED_ — getting-started prompt is unusable: config object misinterpreted as argsSchema by the SDK**  
`server.js:115`  
server.prompt('getting-started', { description: ... }, cb) hits the SDK's positional overload (mcp.js:706): a non-string second arg becomes argsSchema, so the plain object {description: '...'} is treated as a Zod raw shape whose 'value' is a string. Verified against SDK 1.29.0 with a live in-memory client: prompts/list advertises a bogus REQUIRED argument named 'description' (and no prompt description); prompts/get without arguments fails with -32602 'Invalid arguments'; with arguments it fails with -32603 'keyValidator._parse is not a function'. The prompt can never be retrieved by any client. The compliance suite never exercises prompts, so this ships silently.  
*Fix:* Use server.registerPrompt('getting-started', { description }, cb) (the config-object API used for the other 5 prompts at server.js:264), or pass the description as a plain string.


**🟠 HIGH · _CONFIRMED_ — Full tool params — including third-party API keys, auth headers, and webhook secrets — are sent to the backend as usage telemetry unmasked**  
`src/core/AuthManager.js:338`  
withAuth passes the raw invocation params to reportUsage (withAuth.js:103), and _reportUsageOnce puts them verbatim into the POST /api/v1/usage payload as requestData (AuthManager.js:335-357). Realistic leaks: extract_structured/deep_research llmConfig apiKey (user's OpenAI/Anthropic key), fetch_url/crawl_deep custom headers (Authorization tokens for scraped sites), batch_scrape/track_changes webhook signingSecret, localization proxySettings.password. src/utils/secretMask.js exists and is wired into the Winston logger, but is never applied to this network payload, so user secrets land in the vendor's usage database on every successful or failed metered call.  
*Fix:* Run requestData through maskSecrets() before building the payload, or send only the paramHash already computed in withAuth.


**🟠 HIGH · _CONFIRMED_ — Stateful streamable HTTP uses one shared transport: only one session ever; reconnect or DELETE bricks /mcp until restart**  
`src/server/transports/streamableHttp.js:53`  
A single StreamableHTTPServerTransport is created once and reused for all requests. In SDK 1.29.0 (webStandardStreamableHttp.js:425-427) a second initialize while _initialized is true returns 400 'Invalid Request: Server already initialized' — so a second concurrent client can never connect, and a single client that reconnects after a network drop (standard MCP client behavior: re-initialize) is rejected. Worse, DELETE /mcp (session terminate) calls transport.close(), which clears streams but never resets _initialized or sessionId (SDK close() at line 630), so after any clean client disconnect the endpoint returns 400/404 for everything until process restart. A deployed HTTP server (Render, per the port comment) degrades to one-shot.  
*Fix:* Follow the SDK's documented stateful pattern: keep a map of sessionId -> transport, create a new transport per initialize request, and dispose it on DELETE/onsessionclosed.


**🟠 HIGH · _CONFIRMED_ — Legacy stateless mode (--legacy-http / connectHttp) fails on every request after the first**  
`src/server/transports/streamableHttp.js:152`  
With legacy=true, sessionIdGenerator is undefined and the single transport is reused for all requests. SDK 1.29.0 explicitly forbids this: webStandardStreamableHttp.js:139-141 throws 'Stateless transport cannot be reused across requests. Create a new transport per request.' once _hasHandledRequest is set by the first request. The throw propagates out of the unguarded 'await transport.handleRequest(req, res)' inside the async createServer callback — an unhandled rejection (logged by the process handler) and a response that is never ended, so the client hangs until timeout. Every request after the first fails for the lifetime of the process, making the advertised one-release deprecation window a dead mode.  
*Fix:* In legacy mode construct a fresh StreamableHTTPServerTransport per request (and connect it to the server per SDK stateless example), and wrap transport.handleRequest in try/catch that ends the response with a 500.


**🟠 HIGH · _CONFIRMED_ — User is charged half credits when the credit check itself throws — tool never executed**  
`src/server/withAuth.js:112`  
checkCredits() throws 'Unable to verify credits...' when the backend is unreachable and the 30s grace window has passed (AuthManager.js:296). That throw lands in withAuth's catch (lines 107-121), which unconditionally bills Math.max(1, floor(cost*0.5)) via reportUsage before rethrowing. Concrete: backend down > 30s, user calls fetch_url (cost 1) → call is refused, yet reportUsage queues a 1-credit charge; the fetch to /api/v1/usage fails (backend down) so it is persisted to pending-usage.json and flushed when the backend recovers — the user is billed for a call that never ran. The same applies to every tool at half its cost during any backend outage.  
*Fix:* Only apply the half-charge when the failure occurred after the handler started; treat exceptions thrown before handler(params) (credit check, not-configured) as unbilled.


**🟡 MED — search_web reads its API key only from env/.env, not from ~/.crawlforge/config.json — fails and half-bills users configured via setup**  
`src/constants/config.js:306`  
getToolConfig('search_web') passes apiKey: config.crawlforge.apiKey (env CRAWLFORGE_API_KEY or package .env only). AuthManager authenticates from ~/.crawlforge/config.json, so a user who ran `npm run setup` and launches with `npm start` (no env var) passes the credit check but SearchWebTool has searchAdapter=null (searchWeb.js:86-88) and every search_web call throws 'CrawlForge API key is required...' — which the server.js handler converts to isError:true, so withAuth bills half of 5 = 2 credits per guaranteed-failure call. Key-source divergence between AuthManager and SearchWebTool.  
*Fix:* Fall back to AuthManager.getConfig()?.apiKey when the env var is absent (at instantiation in server.js or inside getToolConfig).


**🟡 MED — Auto-setup path writes status banners to stdout in stdio MCP mode**  
`src/core/AuthManager.js:169`  
server.js:65 calls AuthManager.runSetup(apiKey) whenever CRAWLFORGE_API_KEY is set but ~/.crawlforge/config.json is absent (first launch on a machine, or every container start on an ephemeral filesystem). runSetup uses console.log for '🔧 Setting up...', '✅ Setup complete!', account/credits/plan lines (AuthManager.js:169-193; clearConfig:660 likewise) — all to stdout, which in stdio mode is the JSON-RPC channel. This violates the project's own v4.2.4 stdout-hygiene contract; strict MCP clients can fail the handshake on the non-JSON lines. The stdout-hygiene test explicitly excludes 'AuthManager interactive setup' on the incorrect assumption it is never hit during a server run.  
*Fix:* Switch runSetup/clearConfig status output to console.error (as the surrounding startup banners already do), and drop the exclusion from tests/unit/stdout-hygiene.test.js.


**🟡 MED — checkCredits silently returns undefined on non-OK backend responses, misreported as 'Insufficient credits'**  
`src/core/AuthManager.js:264`  
In checkCredits, when the /api/v1/credits response is not ok (revoked key 401, backend 500), the `if (response.ok)` block is skipped and the function falls off the end of the try, returning undefined — no throw, no message. withAuth treats the falsy value as 'no credits' and returns 'Insufficient credits ... upgrade your plan at .../pricing' to the model. A user whose key was revoked (or during a backend 5xx incident) is told to buy more credits instead of being told their key is invalid, with no isError flag and no distinguishing signal in logs (outcome=insufficient_credits).  
*Fix:* Handle !response.ok explicitly: throw a descriptive error for 401/403 (key invalid/revoked) and fall into the grace-window path for 5xx.


**🟡 MED — Usage reporting never checks response.ok — backend rejections are silently treated as successfully billed**  
`src/core/AuthManager.js:348`  
_reportUsageOnce awaits fetch(POST /api/v1/usage) and only catches network-level failures; an HTTP 4xx/5xx response (e.g. rejected payload, auth failure, backend bug) resolves normally, so the usage event is neither retried nor queued — it is silently dropped while the local creditCache was already decremented. _flushPendingUsage (lines 452-469) has the same flaw: a 400 response counts the entry as flushed and deletes it from pending-usage.json. Billing integrity depends on the backend never returning an error status, and cache-vs-backend credit drift accumulates silently.  
*Fix:* Check response.ok in both paths; queue (or retain) the entry on non-2xx just like on network failure.


**⚪ LOW — gracefulShutdown omits extractContentTool and processDocumentTool despite both holding lazily-launched Chromium instances**  
`server.js:1389`  
ExtractContentTool and ProcessDocumentTool each own a BrowserProcessor that launches Chromium on first browser-path use (src/core/processing/BrowserProcessor.js:241) and both expose cleanup() (extractContent.js:334, processDocument.js:509), but neither is in the toolsToCleanup array (server.js:1389-1394), violating CLAUDE.md's 'add to cleanup array if it has destroy()/cleanup()' rule. Impact is mostly masked because process.exit triggers Playwright's own exit hooks, but browsers stay open through the 5s cleanup window and any future refactor that removes the hard exit would leak them.  
*Fix:* Add extractContentTool and processDocumentTool to the toolsToCleanup array.


**⚪ LOW — projectCost reads params.maxPages for crawl_deep but the tool's schema field is max_pages — projection always uses the default**  
`src/core/AuthManager.js:602`  
crawl_deep's input schema (server.js:419) uses snake_case max_pages, but projectCost checks params?.maxPages || params?.options?.maxPages || 10, so a crawl_deep call with max_pages: 1000 still projects Math.ceil(10/20)*4 = 4 credits. The _cost.projected transparency metadata injected into every crawl_deep response is therefore wrong for any non-default page count (actual billing is unaffected since the charge is the flat base).  
*Fix:* Read params?.max_pages (keeping maxPages as a fallback).


**⚪ LOW — Public discovery metadata is stale: server-card advertises '20 tools' and version 3.5.1 on a 27-tool v4.10.0 server**  
`src/server/transports/streamableHttp.js:106`  
SERVER_VERSION is hard-coded '3.5.1' (line 31) and surfaces in /health, startup banners, and the Smithery server-card, whose description says '20 web scraping ... tools' (line 106) versus the actual 27 tools and package version 4.10.0. Clients using Smithery discovery or health-based version checks get wrong information.  
*Fix:* Derive the version from package.json and update the card description (or reuse the McpServer description string from server.js).


**⚪ LOW — Insufficient-credits refusal is returned without isError:true**  
`src/server/withAuth.js:48`  
When checkCredits returns false, withAuth returns a content-only result carrying a JSON error body but no isError flag, unlike every other failure path in server.js. MCP clients and automation that branch on isError treat the refusal as a successful tool result; the calling model must parse the text to discover the call was refused.  
*Fix:* Add isError: true to the insufficient-credits return object.


**⚪ LOW — No coverage for the failure modes found above: prompt retrieval, second HTTP session/request, credit-check-throw billing**  
`tests/unit/streamableHttp.test.js:57`  
The transport suite only exercises /health, /metrics, auth rejection, and single OAuth pass-through — never a second POST /mcp in legacy mode nor a re-initialize in stateful mode, which is exactly where both transports break. tests/integration/mcp-protocol-compliance.test.js contains zero prompt coverage (grep 'prompt' matches nothing), letting the dead getting-started prompt report '100% COMPLIANT'. withAuth tests cover checkCredits returning false but not checkCredits throwing, missing the bill-on-refusal path.  
*Fix:* Add: a prompts/get test for every registered prompt; a two-request legacy-mode test and a reconnect/second-initialize stateful test; a withAuth test where checkCredits rejects asserting no usage is reported.


### B. Basic Tools, Unified Scrape & SSRF

> **Auditor's read:** The basic/scrape tool layer is generally well-structured (single fetch + one cheerio load in unifiedScrape, per-format warnings really do work, all handlers return well-formed MCP results and nothing writes to stdout), but the SSRF layer it depends on has a hole big enough to void the whole v4.8 "SSRF is now enforced" claim: enforcement lives only in the undici connect-time `lookup`, which Node never calls for IP-literal hosts, so `http://127.0.0.1:…`, `http://169.254.169.254/…`, and decimal/userinfo variants of them sail straight through (verified end-to-end — safeFetch fetched a live loopback server's body). Correctness-wise, extract_links resolves relative hrefs against the origin instead of the page URL (wrong links on any non-root page), `<base href>` is ignored by both link extractors, and unifiedScrape's `text` format mutates the shared cheerio document so results depend on the order of `formats[]`. Error handling is mostly defensive, but the body-read phase in `_fetch.js` runs with no timeout at all and the `scrape` path (`fetchAndParse`) has no response-size or content-type guard. Test coverage exists for happy paths and format presence but not for any of the above (the SSRF kill-switch test asserts nothing).


**🔴 CRIT · _CONFIRMED_ — SSRF guard is completely bypassed for IP-literal URLs (loopback, cloud metadata)**  
`src/utils/ssrfGuard.js:129`  
ssrfGuard()'s pre-flight only rejects non-http(s) protocols and three literal metadata hostnames; all IP checking is delegated to the undici dispatcher's connect-time `lookup` (ssrfLookup, lines 60-77). Node's net.connect skips DNS lookup entirely when the host is already an IP literal, so `lookup` is never invoked and ipBlocked() never runs. Verified two ways: (a) an undici Agent whose lookup records calls saw zero calls for http://127.0.0.1:8099/, http://[::1]:8099/ and http://2130706433:8099/ (the last is normalized by WHATWG URL to 127.0.0.1) while it was called for hostnames; (b) end-to-end with the repo's own safeFetch against a local http server: `REACHED http://127.0.0.1:57960/ "<html><body>INTERNAL SECRET</body></html"` while `http://localhost:57960/` was correctly blocked. Every read-scrape tool is affected (fetch_url/extract_text/extract_links/extract_metadata/scrape_structured via _fetch.js, `scrape` via _fetchAndParse.js, branding stylesheet fetches). So `fetch_url({url:"http://169.254.169.254/latest/meta-data/iam/security-credentials/"})` or any 302 from a public page to an IP-literal internal address returns internal content to the caller. config.security.ssrfProtection.blockedDomains (config.js:96, which lists 127.0.0.1/0.0.0.0/169.254.169.254) is dead — its only consumer, src/utils/securityMiddleware.js, is imported nowhere.  
*Fix:* In ssrfGuard() pre-flight, when net.isIP(u.hostname) (after WHATWG normalization, which already folds decimal/hex/octal IPv4 forms) call ipBlocked(hostname) and throw SSRF_BLOCKED on a hit; also fold config …ssrfProtection.blockedDomains into the hostname check so BLOCKED_DOMAINS actually does something. Add unit tests for literal-IP URLs.


**🟠 HIGH · _CONFIRMED_ — Body streaming runs with no timeout — the abort controller is cleared as soon as headers arrive**  
`src/tools/basic/_fetch.js:52`  
clearTimeout(timeoutId) fires immediately after fetch() resolves (line 52), i.e. as soon as response headers are received. The body is then read chunk-by-chunk in the unbounded `while (true)` loop at lines 91-102 with no signal and no deadline. A server that returns 200 + headers and then trickles or stalls the body (slowloris, hung proxy, half-open TCP) leaves fetch_url/extract_text/extract_links/extract_metadata/scrape_structured awaiting reader.read() forever; the `timeout` parameter advertised in the tool schema (1000-30000 ms) silently does not cover it, so the MCP call never returns. Contrast _fetchAndParse.js:41, which uses AbortSignal.timeout for the whole request and does not have this hole.  
*Fix:* Keep the AbortController armed until the body has been fully read (clearTimeout in a finally after the read loop), or pass AbortSignal.timeout(timeout) so the signal also aborts the body stream.


**🟠 HIGH · _CONFIRMED_ — extract_links resolves relative hrefs against the origin, not the page URL**  
`src/tools/basic/extractLinks.js:22`  
baseUrl defaults to `new URL(url).origin`, and line 40 resolves every relative href against it. Verified with a mocked fetch: for url https://example.com/docs/page.html containing <a href="about.html">, the tool returns href "https://example.com/about.html" — the correct target is https://example.com/docs/about.html. unifiedScrape's copy (unifiedScrape.js:75) resolves against pageUrl and gets this right, so the two tools disagree. Every crawl seed list or broken-link audit built from extract_links on a non-root page is wrong (404s), and the tool description explicitly sells it for "build a crawl seed list, audit broken links".  
*Fix:* Default baseUrl to response.url (the final URL after redirects) rather than its origin; keep base_url as an explicit override.


**🟠 HIGH · _CONFIRMED_ — ipBlocked() does not recognize IPv4-mapped IPv6 addresses, even in strict mode**  
`src/utils/ssrfGuard.js:51`  
ipBlocked() special-cases only the exact strings '127.0.0.1', '::1', '0.0.0.0' and then does CIDR math via SSRFProtection.isIPInRange, whose normalizeIPv6 mis-parses embedded IPv4 (parseInt('127.0.0.1',16)). Verified by running the module: ipBlocked('::ffff:127.0.0.1') === false, ipBlocked('::ffff:169.254.169.254') === false, ipBlocked('0:0:0:0:0:ffff:7f00:1') === false — and the same false results with SSRF_STRICT=true. Since ssrfLookup resolves with {all:true, verbatim:true} and hands the addresses straight to undici, an attacker-controlled domain publishing an AAAA record of ::ffff:127.0.0.1 (or ::ffff:169.254.169.254) passes the guard and the socket connects to loopback/metadata — the exact DNS-controlled SSRF the guard exists to stop.  
*Fix:* Normalize IPv4-mapped/compat IPv6 (strip a leading ::ffff: / ::  prefix and re-test as IPv4) before the range checks in ipBlocked, and add ::ffff:… cases to tests/unit/ssrfGuard.test.js.


**🟡 MED — scrape inlines full base64 screenshot bytes into the JSON tool result despite publishing a resource URI**  
`server.js:901`  
The screenshot objects produced by ActionExecutor.captureScreenshot carry `data` (base64 of the PNG/JPEG, ActionExecutor.js:801). server.js stores the image in resourceRegistry and adds resourceUri, but returns `{...shot, resourceUri}` — `data` is kept — and the whole result is JSON.stringify'd into a single text content block. `scrape({url, formats:["screenshot"], screenshotOptions:{fullPage:true}})` therefore ships several MB of base64 into the conversation even though the tool description says it "returns crawlforge://screenshot/{id} resources", blowing the client's context/response limits for no benefit.  
*Fix:* Strip `data` from the returned shot once it has been stored in resourceRegistry (keep actionId, format, fullPage, timestamp, resourceUri), so the bytes are only retrievable through the resource.


**🟡 MED — Response body is always decoded as UTF-8; Content-Type charset and <meta charset> are ignored**  
`src/tools/basic/_fetch.js:105`  
The streaming path reassembles the bytes and decodes them with `new TextDecoder()` (UTF-8, no charset argument), and nothing else in the basic/scrape path re-decodes. A page served as `Content-Type: text/html; charset=iso-8859-1` or windows-1252 (still common on older European/Latin-American sites) or Shift_JIS comes back with U+FFFD replacement characters throughout: extract_text returns corrupted words, extract_metadata returns a mangled title, and scrape_structured returns mangled field values — all with success and no warning, so the caller cannot tell the content is wrong.  
*Fix:* Parse the charset from the response Content-Type (falling back to a <meta charset> sniff of the first bytes) and pass it to TextDecoder; keep UTF-8 as the default.


**🟡 MED — Protocol-relative links are always classified as internal**  
`src/tools/basic/extractLinks.js:41`  
Both extractors only treat hrefs starting with http:// or https:// as candidates for external classification; anything else takes the else-branch which hardcodes `isExternal = false` (extractLinks.js:41, unifiedScrape.js:76). Verified: <a href="//other.example.org/x"> on https://example.com/docs/page.html is returned as {href:"https://other.example.org/x", is_external:false}, and internal_count/external_count are correspondingly wrong (2 internal / 1 external instead of 1 / 2). filter_external:true then silently drops genuine outbound CDN/partner links, and a same-domain crawler seeded from is_external:false will walk off-site.  
*Fix:* Compute isExternal from the resolved absolute URL's origin in all branches (`new URL(absoluteUrl).origin !== pageOrigin`) instead of hardcoding false.


**🟡 MED — Attribute extraction silently drops elements missing the attribute, desynchronizing parallel field arrays**  
`src/tools/basic/scrapeStructured.js:67`  
For multi-match fields the code returns `elements.map((_, el) => extract(el)).get()`; cheerio's map discards null/undefined results, so elements whose attribute is absent vanish from the array while elements_found still reports the DOM match count. Verified with three <img> tags where the middle one has no src and selectors {imgs:'img@src'}: data.imgs = ["a.png","c.png"] but elements_found.imgs = 3. The documented use case ("scraping a pricing table or product list", selectors {price:'.price', name:'.product-title'}) relies on index alignment across fields — one missing href/src silently shifts every subsequent row, pairing the wrong price with the wrong product.  
*Fix:* Return an explicit null placeholder for missing attributes (e.g. build the array with elements.toArray().map(extract)) so array length always equals elements_found.


**🟡 MED — scrape path has no response-size cap (the 25 MB cap exists only for basic tools)**  
`src/tools/extract/_fetchAndParse.js:48`  
fetchAndParse calls `await response.text()` on whatever the server returns, with no Content-Length pre-check and no streaming byte counter — unlike _fetch.js, which enforces config.fetch.maxBodySize (25 MB default) both ways. `scrape({url})` (and extract_structured / extract_with_llm / process_document, which share this helper) pointed at a large file — a 500 MB log, a big tarball, a hostile endpoint streaming zeros — buffers the whole thing into a JS string, then hands it to cheerio, JSDOM and Turndown, multiplying peak memory several times. Realistic outcome: heap exhaustion or a multi-second event-loop stall that blocks every other MCP request on the stdio server.  
*Fix:* Reuse the streaming size guard from _fetch.js (or share one helper): check Content-Length, then count bytes while reading and abort past config.fetch.maxBodySize.


**🟡 MED — No Content-Type check anywhere on the scrape path — binary responses are parsed as HTML**  
`src/tools/extract/_fetchAndParse.js:49`  
fetchAndParse (used by `scrape`) and _fetch.js-based basic tools never inspect response.headers.get('content-type'); the bytes are decoded as UTF-8 text and fed to cheerio/Readability/Turndown regardless. `scrape({url:"https://site/report.pdf", formats:["markdown"]})` or extract_text on an image/zip returns confident-looking garbage (mojibake fragments, empty markdown, metadata:{}) with success:true and no warning, instead of an explicit "unsupported content type" error that would steer the caller to process_document.  
*Fix:* After the fetch, branch on content-type: pass text/html and xml through the parser, return raw text for text/plain and application/json, and fail (or emit a warning + skip HTML-derived formats) for binary types.


**🟡 MED — branding format can run ~160 s of sequential stylesheet fetches, unbounded by the tool's timeoutMs**  
`src/tools/scrape/_brandingExtractor.js:143`  
collectCssSources fetches linked stylesheets one at a time in a for-loop, each with its own AbortSignal.timeout(perFileTimeoutMs ?? 8000), up to maxStylesheets (schema allows 20). unifiedScrape's timeoutMs (max 60000) only covers the page fetch, and there is no wall-clock budget across stylesheets, so `scrape({url, formats:["branding"], brandingOptions:{maxStylesheets:20}})` against a site with 20 slow/unresponsive CSS hosts can block for up to 160 s before returning — far beyond any MCP client timeout, and the tool holds a worker the whole time.  
*Fix:* Fetch stylesheets concurrently with a small pool and enforce a single overall deadline (e.g. Math.min(timeoutMs, 10000)) after which remaining sheets are skipped with a warning.


**🟡 MED — <base href> is ignored by both link extractors, producing wrong absolute URLs**  
`src/tools/scrape/unifiedScrape.js:75`  
extractLinksFromDom resolves with `new URL(href, pageUrl)` and extractLinks.js:40 with `new URL(href, baseUrl)`; neither reads <base href>. Verified with a page served from https://example.com/docs/page.html containing <base href="https://cdn.example.com/assets/"> and <a href="about.html">: both tools returned example.com URLs, while a browser (and the site's own navigation) resolves to https://cdn.example.com/assets/about.html. Result: links[] points at URLs that do not exist, and any crawl seeded from them 404s.  
*Fix:* Read `$('base[href]').attr('href')` once per document, resolve it against the final URL, and use it as the resolution base when present (in both extractLinksFromDom and extractLinks.js).


**🟡 MED — 'text' format mutates the shared cheerio document, making output depend on formats[] order**  
`src/tools/scrape/unifiedScrape.js:289`  
With onlyMainContent:false the text branch runs `$('script, style').remove()` on the single shared cheerio instance, which every later format also reads. Verified with a page containing <script>/<style>: formats:['html','text'] returns content.html = "<body><script>var a=1;</script><style>.x{}</style><p>Body text</p></body>" while formats:['text','html'] returns "<body><p>Body text</p></body>" for the same page. Same applies to markdown (line 260 uses $.html('body')) and to the json branch's $('body').text(). Callers get non-deterministic content for a format purely because of array ordering.  
*Fix:* Do the script/style stripping on a cloned document (e.g. load($.html()) or cheerio clone) inside the text branch, leaving `$` untouched for other formats.


**🟡 MED — Screenshot failures are reported as 'produced no image', discarding the real error**  
`src/tools/scrape/unifiedScrape.js:351`  
ActionExecutor.executeActionChain never throws on failure — its outer catch returns {success:false, error, screenshots:[]} (ActionExecutor.js:300-311). unifiedScrape only inspects r.screenshots, so any real failure (navigation timeout, ERR_NAME_NOT_RESOLVED, browser launch failure, 'Action failed: …') is flattened to the warning "screenshot: capture produced no image" and r.error is dropped. The caller gets no way to distinguish a blank page from a browser that never started, and cannot decide whether retrying is worthwhile.  
*Fix:* Check `r?.success === false` (or r.error) first and push `screenshot: ${r.error}` as the warning; keep the 'no image' message only for a successful chain that genuinely produced zero screenshots.


**⚪ LOW — Body reassembly is O(n^2) — a full-size response blocks the event loop for over a second**  
`src/tools/basic/_fetch.js:106`  
chunks.reduce allocates a brand-new Uint8Array and copies the entire accumulated buffer for every chunk. Measured locally: 25 MB delivered in 1600 x 16 KB chunks takes 1524 ms of pure synchronous memcpy (367 ms at 400 x 64 KB chunks). That whole time the stdio MCP server's event loop is blocked, delaying every other in-flight tool call, and it scales quadratically with the configurable MAX_FETCH_BODY_SIZE.  
*Fix:* Collect chunks in the array and concatenate once after the loop (Buffer.concat(chunks, totalBytes) or a single preallocated Uint8Array).


**⚪ LOW — Selector spec parsing on lastIndexOf('@') breaks selectors containing '@'**  
`src/tools/basic/scrapeStructured.js:20`  
parseSelectorSpec splits on the last '@' whenever it is not at index 0, so a legitimate selector such as `a[href*="@"]` (find mailto/contact links — a natural use of this tool) is split into selector `a[href*="` and attribute `"]`. Verified: the field returns {error:"Invalid selector: a[href*=\"@\"]", message:"Attribute value didn't end"} and elements_found 0, with no hint that the '@' suffix syntax caused it.  
*Fix:* Only treat a trailing '@' segment as an attribute when it matches /@[A-Za-z_:][\w:.-]*$/ and is outside brackets/quotes, or require an explicit {selector, attribute} object form.


**⚪ LOW — SSRF test suite has no literal-IP coverage and a kill-switch test that asserts nothing**  
`tests/unit/ssrfGuard.test.js:54`  
The 'kill switch (SSRF_PROTECTION_ENABLED=false) disables the guard' test has an empty try block — it sets and restores the env var and then asserts three isAllowlisted() cases instead, so the documented kill-switch contract is untested. More importantly there is no test that calls ssrfGuard('http://127.0.0.1/'), 'http://169.254.169.254/', 'http://2130706433/' or a userinfo form, which is exactly why the critical literal-IP bypass above went unnoticed; ipBlocked() is tested only with bare IP strings, which never reach the guard for literal-host URLs. The unifiedScrape/basicTools tests stub globalThis.fetch, so no test exercises the guard on the real fetch path at all.  
*Fix:* Add pre-flight assertions for literal-IP URLs (currently they would fail, documenting the bug), IPv4-mapped IPv6 in ipBlocked, and re-import the module with SSRF_PROTECTION_ENABLED=false to assert ssrfGuard returns {}.


### C. Batch, Browser Actions, Jobs & Webhooks

> **Auditor's read:** The plain-fetch batch pipeline is in good shape: per-URL error isolation genuinely works (scrapeUrl catch + Promise.allSettled), SSRF and per-host throttling are correctly wired into worker.fetchUrl, the semaphore enforces concurrency, the action allowlist is exactly the documented 7 types with executeJavaScript hard-gated, and JobManager/WebhookDispatcher have reasonable eviction/backoff logic. However, the two paths that leave the guarded fetch stack are the area's weak points: browser navigation (scrape_with_actions) and webhook delivery both completely bypass SSRF protection, giving tool callers an internal-network read/write primitive despite CLAUDE.md's claim of full-path enforcement. Beyond security, the browser lifecycle leaks contexts on every call and pages on failed navigations, several caches (batchResults, executionHistory) grow effectively unbounded in a long-running server, and the async batch job flow is inconsistent with its own tool description (in-progress jobs unreachable, cancel is cosmetic). None of the crashes are in live paths (the broken utils/CircuitBreaker is currently unwired), but the leaks and SSRF gaps are realistic production issues.


**🔴 CRIT · _CONFIRMED_ — scrape_with_actions browser navigation has no SSRF guard**  
`src/core/ActionExecutor.js:827`  
ActionExecutor.initializePage calls page.goto(url) with no ssrfGuard/ssrfProtection check (grep confirms zero SSRF references in ActionExecutor.js, ScrapeWithActionsTool.js, BrowserProcessor.js, server.js). The undici-dispatcher SSRF guard used on the plain-fetch paths does not apply to Playwright. A caller can pass url: "http://169.254.169.254/latest/meta-data/" or any RFC1918/localhost admin URL to scrape_with_actions (or the shared actionExecutor used by unified scrape screenshots); the Chromium instance (launched with --no-sandbox --disable-web-security, BrowserProcessor.js:244-247) navigates there and the tool returns the page HTML via finalHtml/extractFinalContent — full internal-network/cloud-metadata read primitive, bypassing the v4.8.0 SSRF enforcement CLAUDE.md claims covers every scrape site.  
*Fix:* Run the same IP validation used by ssrfGuard (resolve host, ipBlocked()) on the target URL before page.goto, and also validate page.url() after navigation to catch redirects into blocked ranges.


**🟠 HIGH · _CONFIRMED_ — Page + context leak when page.goto fails inside initializePage**  
`src/core/ActionExecutor.js:217`  
executeActionChain does page = await this.initializePage(url, browserOptions) (line 217). initializePage first creates the page via browserProcessor.initializePage, then navigates (page.goto at line 827, 30s timeout). If navigation throws (DNS failure, timeout, blocked URL — a routine event), the exception propagates before the local `page` variable is assigned, so the finally's `if (page)` (line 257) skips close and the already-created page and its context are orphaned. Every failed navigation leaks a live page.  
*Fix:* Create the page inside initializePage with its own try/catch that closes page+context before rethrowing, or return the page before navigation and goto inside the caller's try where the finally can see it.


**🟠 HIGH · _CONFIRMED_ — Webhook URLs are not SSRF-guarded (HTTPS-scheme check only)**  
`src/core/WebhookDispatcher.js:398`  
registerWebhook's only validation is url.startsWith('https://') (line 129). deliverWebhook then does a raw fetch(event.url, ...) (line 398) and healthCheckUrl does the same (line 545) — neither uses ssrfGuard. batch_scrape accepts an arbitrary webhook.url from tool input, so a caller can have the server POST full batch results (page content, metadata) to https://internal-service.local/, https://localhost:8443/, or a DNS-rebinding hostname resolving to private IPs. Health checks then keep probing that internal URL every ~60s forever.  
*Fix:* Route webhook deliveries and health checks through ssrfGuard()/safeFetch() (the guarded undici dispatcher) so internal/metadata addresses are rejected at connect time.


**🟠 HIGH · _CONFIRMED_ — Browser context leaked on every non-stealth page: only the page is ever closed**  
`src/core/processing/BrowserProcessor.js:502`  
createPage creates a fresh BrowserContext per call (this.browser.newContext at line 502) and returns only the page. ActionExecutor's finally closes only the page (ActionExecutor.js:258), and BrowserProcessor.processURL likewise closes only page.close() (line 205). Closing a Playwright page does not close its context, and non-stealth contexts are never stored in activeContexts, so every scrape_with_actions / unified-scrape-screenshot call permanently leaks one BrowserContext in the shared Chromium until server shutdown — steady memory growth in a long-running MCP server.  
*Fix:* Close the owning context, e.g. in ActionExecutor's finally: const ctx = page.context(); await page.close(); await ctx.close(); (or have createPage register the context for cleanup).


**🟠 HIGH · _CONFIRMED_ — batchResults cache grows unbounded — TTL never enforced, no eviction**  
`src/tools/advanced/batchScrape/index.js:154`  
With enableResultCaching (default true, line 36), every batch stores its full processedResults — including complete HTML bodies for up to 50 URLs — in this.batchResults (lines 154 and 339). The ttl:3600000 field is only consulted on read in getBatchResults (line 209); expired entries are never deleted and there is no size cap or sweep timer, so the Map grows for the life of the MCP server. Heavy batch_scrape use (e.g. 50-URL batches with formats:['html']) accumulates hundreds of MB that are never released until process exit.  
*Fix:* Delete expired entries on read, add a periodic sweep (like JobManager's cleanupTimer), and cap the number of cached batches (LRU).


**🟡 MED — Chain-failure path discards per-action results and the error screenshot**  
`src/core/ActionExecutor.js:308`  
When an action fails without continueOnError, executeChainWithRetries throws; the outer catch (lines 300-311) returns results:[] and screenshots:[] even though executionContext.results holds every executed action's outcome (including which action failed and why) and executionContext.screenshots holds the error screenshot captured at lines 242-252. Consequently scrape_with_actions with screenshotOnError:true never returns the promised error screenshot, and the response reports actionsExecuted:0 with no per-action detail — the caller cannot tell which of their 10 actions broke.  
*Fix:* Include executionContext.results and executionContext.screenshots in the failure return object.


**🟡 MED — executionHistory retains finalHtml and base64 screenshots for the last 100 chains**  
`src/core/ActionExecutor.js:270`  
The finally block pushes {...executionContext, page: undefined} into executionHistory (lines 270-273), which includes finalHtml (the full post-action page HTML captured at line 227, often 100KB-2MB) and the screenshots array (base64 PNGs, potentially several MB each for fullPage captures). Capped at 100 entries (line 276), this can pin hundreds of MB in a long-running server; getExecutionHistory only ever reads a handful of scalar fields, so the heavy payloads are retained for nothing.  
*Fix:* Strip finalHtml and screenshot data before pushing to history (store counts/ids only).


**🟡 MED — Webhook fetch 'timeout' option is silently ignored — no real delivery timeout**  
`src/core/WebhookDispatcher.js:402`  
deliverWebhook passes { timeout: config.timeout } to fetch (lines 398-403) and healthCheckUrl passes timeout: config.timeout/2 (line 547). Node's WHATWG fetch (undici) has no 'timeout' RequestInit option, so the configured 30s deadline is a no-op; requests hang until undici's ~300s default header/body timeouts. Because processQueue is serialized by the `processing` flag and processes 1 event per 100ms tick, one hung webhook endpoint stalls the entire delivery queue for minutes, delaying every other batch's notifications.  
*Fix:* Use signal: AbortSignal.timeout(config.timeout) on both fetch calls.


**🟡 MED — captureIntermediateStates silently broken and pollutes failure counts when JS execution is disabled (the default)**  
`src/tools/advanced/ScrapeWithActionsTool.js:532`  
insertCaptureActions injects executeJavaScript actions (lines 525-543) to snapshot page state, but executeJavaScriptAction throws unless ALLOW_JAVASCRIPT_EXECUTION=true (ActionExecutor.js:714-722), which is off by default. Every injected capture action fails (continueOnError:true hides it), so captureIntermediateStates:true yields intermediateStates:[] with no explanation — and the failed injected actions are counted in the result: a user chain of 3 fully successful actions reports failedActions:3 and success/failure stats that don't match the user's actions.  
*Fix:* Capture state natively via page.content()/page.url() in ActionExecutor (no in-page JS needed), or reject captureIntermediateStates upfront when ALLOW_JAVASCRIPT_EXECUTION is unset; exclude injected actions from failure counts.


**🟡 MED — get_batch_results cannot see in-progress async batches; statusCheckUrl names a nonexistent tool**  
`src/tools/advanced/batchScrape/index.js:228`  
_processBatchAsync never records the batch in activeBatches and results only reach batchResults when the job's executor finishes (line 339). So for an async batch, get_batch_results({batchId}) during execution falls through both lookups and throws 'Batch <id> not found' (line 228) — contradicting the server.js:691 tool description 'completed or in-progress batch_scrape job'. The async response's statusCheckUrl 'batch_scrape_status?jobId=...' (line 198) references a tool that is not registered anywhere, and getJobStatus (line 231) is not exposed via any MCP surface (the crawlforge://job/{jobId} resource lists completed/failed jobs only). Callers have no way to poll a running async batch and get a misleading not-found error.  
*Fix:* In getBatchResults, fall back to jobManager.getJobsByTag(batchId) and return job status/progress for pending/running jobs; fix or remove the statusCheckUrl string.


**🟡 MED — cancelBatch on a sync batch reports success but cancels nothing; sync progress is always 0%**  
`src/tools/advanced/batchScrape/index.js:240`  
For an active sync batch, cancelBatch just deletes the activeBatches entry and returns success (lines 240-242) — scrapeUrlsBatch has no abort signal and keeps fetching all URLs to completion, so 'Active batch cancelled' is false. Additionally the activeBatches entry's `completed` counter (set to 0 at line 131) is never incremented during processing, so any concurrent getBatchResults poll reports progress 0% until the batch vanishes. Same no-abort issue applies to async cancellation: JobManager.cancelJob flips status but the running executor loop is never interrupted.  
*Fix:* Thread an AbortController through scrapeUrlsBatch (checked between semaphore tasks) and update activeBatches.completed from the queue; have the async executor check job.status between slices.


**🟡 MED — Batch body read has no timeout or size cap — a trickling server can hang a sync batch indefinitely**  
`src/tools/advanced/batchScrape/worker.js:51`  
fetchUrl clears the abort timer as soon as headers arrive (line 28) and returns the Response; scrapeUrl then awaits response.text() (line 51) with no abort signal and no content-length cap. A slow-loris style server that sends headers then drips the body holds a semaphore slot forever; in mode:'sync' the batch_scrape MCP call never returns (only undici's ~300s bodyTimeout eventually saves it, far beyond the configured 15-30s per-URL timeout). A multi-GB body is also fully buffered.  
*Fix:* Keep the AbortController alive through the body read (clear the timer after response.text()) and enforce a max content length.


**🟡 MED — CircuitBreaker.execute always throws TypeError — constructor nulls shadow onSuccess/onFailure methods**  
`src/utils/CircuitBreaker.js:30`  
The constructor assigns this.onStateChange/this.onFailure/this.onSuccess from options (lines 29-31, default null), shadowing the prototype methods onSuccess(serviceId,duration) (line 127) and onFailure(serviceId,error,duration) (line 152). execute() then calls this.onSuccess(...) (line 93) / this.onFailure(...) (line 99) which are null. Verified by running the module: both success and failure paths throw 'TypeError: this.onFailure is not a function', and the circuit state machine never records anything. Mitigating factor: the only importer is ErrorHandlingConfig.js, which itself is not imported by server.js or any tool, so no live path crashes today — but the class is completely unusable and its recovery/half-open logic is dead the moment anyone wires it in.  
*Fix:* Rename the callback options (e.g. this.onSuccessCallback = onSuccess) or rename the internal methods (_handleSuccess/_handleFailure), and add a unit test that exercises execute().


**⚪ LOW — destroy() awaits context.page.close() unguarded — one bad page aborts cleanup before browser shutdown**  
`src/core/ActionExecutor.js:1145`  
destroy iterates activeChains and awaits context.page.close() with no try/catch (lines 1143-1147). If a page's browser already crashed/disconnected, close() rejects, destroy() throws, and browserProcessor.cleanup() (line 1155) never runs — leaving the Chromium process alive on server shutdown. Contrast with the per-chain finally which correctly swallows close errors (line 258).  
*Fix:* Wrap each page.close() in try/catch, mirroring line 258.


**⚪ LOW — HMAC signature covers only event.payload, not the delivered body — standard verification always fails**  
`src/core/WebhookDispatcher.js:433`  
generateSignature signs JSON.stringify(payload) (lines 433-438), but the POSTed body is the envelope {event,id,timestamp,data:payload,metadata} (lines 388-394). Receivers following the universal webhook pattern (HMAC over the raw request body) compute a different digest and reject every delivery, making the signingSecret feature unusable without reverse-engineering that only the `data` sub-object is signed — which no docs state.  
*Fix:* Sign the exact serialized request body string that is sent.


**⚪ LOW — retryableStatusCodes on the webhook RetryManager never matches — HTTP 5xx errors carry no .response**  
`src/core/WebhookDispatcher.js:73`  
The RetryManager is configured with retryableStatusCodes [408,429,500,...] (line 73), but deliverWebhook throws plain new Error('HTTP 500: ...') (line 406) with no .response property, and RetryManager.isRetryableError only checks error.response.status (RetryManager.js:161-163). So RetryManager never retries HTTP failures; only the outer queue-level re-enqueue in processEvent provides retries. Behavior still converges, but the configured inner retry policy for status codes is dead code and delivery retry timing differs from what the config implies.  
*Fix:* Attach the status to the thrown error (err.response = { status: response.status }) or drop the misleading config.


**⚪ LOW — result.metadata.finalUrl is always undefined (reads wrong property path)**  
`src/tools/advanced/ScrapeWithActionsTool.js:443`  
executeSession sets finalUrl: chainResult.metadata?.finalUrl (line 443), but executeActionChain returns finalUrl at the top level of chainResult (ActionExecutor.js:287), not inside metadata. So the scrape_with_actions result's metadata.finalUrl is always undefined even after navigation-changing actions, hiding where the browser actually ended up (extractFinalContent uses the correct chainResult.finalUrl, so content is right but the reported URL is not).  
*Fix:* Use chainResult?.finalUrl.


**⚪ LOW — Recordings made with captureIntermediateStates save unreplayable executeJavaScript entries**  
`src/tools/advanced/scrapeWithActions/recorder.js:158`  
ScrapeWithActionsTool records the expanded actionChain (including injected capture actions), but buildRecordedEntry (lines 158-176) preserves only selector/text/key/duration/etc. and drops `script`. A recording made with record:true + captureIntermediateStates:true therefore contains {type:'executeJavaScript'} entries with no script; on replay, ActionChainSchema.parse in ActionExecutor rejects them (script is required, ActionExecutor.js:81-86) and the entire replay fails with a validation error.  
*Fix:* Either record only the user's original actions (params.actions) or preserve the script field in buildRecordedEntry.


**⚪ LOW — No tests exercise the real browser lifecycle, webhook SSRF/timeout, or async get_batch_results paths**  
`tests/unit/tools/advanced/scrapeWithActions.test.js:96`  
scrapeWithActions.test.js stubs the executor entirely (the 'page is always closed' test at line 138 tracks a stub's close, so the goto-failure leak and context leak are invisible). webhookDispatcher.test.js covers registration/signature/queueing but never a real delivery, so the ignored fetch timeout and unguarded URL are untested. batchScrape.test.js and jobManager.test.js never test get_batch_results against an in-progress async job, batchResults cache eviction, or cancelBatch actually stopping work — exactly the paths found defective above.  
*Fix:* Add tests: getBatchResults during a running async job; a delivery against a local HTTPS endpoint asserting abort at config.timeout; an initializePage goto-failure asserting page/context close; batchResults eviction after TTL.


### D. Crawl, Map, LLMs.txt & Change Tracking

> **Auditor's read:** This area is the weakest I would expect to find in a v4.10.0 release: two of its three headline tools have defects that make them fail or mislead in ordinary use. crawl_deep's BFS queue awaits child tasks from inside a queued task under a p-queue per-task timeout, so any crawl lasting longer than CRAWL_TIMEOUT (30 s default) throws away every page it fetched, and any concurrency <= max_depth fails immediately — both reproduced against a local server. map_site's page and metadata fetches never go through the SSRF guard despite the docs claiming otherwise (reproduced fetching loopback), its cache key ignores the new `search` parameter so the v4.6.0 ranking feature silently no-ops on a hit, and gzip-encoded sitemaps parse to zero URLs while reporting success. On the tracking side, SnapshotManager's delta storage silently returns the previous version's content, snapshot .meta files duplicate the full uncompressed body into an unbounded in-memory cache, and ChangeTracker's hash-Hamming "similarity" makes every one-character edit read as 0% similar and at least 'moderate' significance. The genuinely solid parts: robots.txt is checked per-URL rather than only on seeds, snapshot IDs are sha256-derived so there is no path-traversal surface, diagnostics go to stderr, and the SSRF guard itself (connect-time lookup with IP pinning) is well built — it is just not wired into mapSite.


**🔴 CRIT · _CONFIRMED_ — crawl_deep aborts the whole crawl with "Promise timed out" whenever the crawl outlives `timeout`, and always fails when concurrency <= max_depth**  
`src/core/crawlers/BFSCrawler.js:241`  
processUrl awaits `this.queue.add(() => this.processUrl(child, depth+1))` from inside a task that already occupies a p-queue slot, and crawl() awaits the root task at line 111. QueueManager (src/core/queue/QueueManager.js:11-18) configures p-queue with `timeout: <crawler timeout>` and `throwOnTimeout: true`, and that timeout is measured over the task's whole execution — which for the root task is the entire recursive crawl. Verified against a local server (700 ms/page, timeout 3000 ms, max_depth 3, max_pages 25): `crawl_deep` returned `ERR Crawl failed: Promise timed out after 3000 milliseconds` with zero results instead of the 25 pages. With the shipped default CRAWL_TIMEOUT=30000 any real crawl taking >30 s (i.e. essentially every crawl at the advertised max_pages: 200) throws away every page it already fetched. Second symptom of the same anti-pattern: children can never get a slot when nesting exceeds concurrency — verified `concurrency: 1/2/3/5` with `max_depth: 5` all returned `ERR Crawl failed: Promise timed out ...` while `concurrency: 10` succeeded, so any user lowering concurrency to be polite breaks the tool outright.  
*Fix:* Do not await queue.add() from inside a queued task: push discovered URLs onto a work list/queue and drive them from crawl() (loop until queue idle and no pending URLs), or drop the per-task p-queue `timeout`/`throwOnTimeout` and rely solely on the per-fetch AbortController.


**🔴 CRIT · _CONFIRMED_ — map_site page/metadata fetches bypass the SSRF guard entirely (raw global fetch)**  
`src/tools/crawl/mapSite.js:264`  
fetchWithTimeout uses the global `fetch` with no ssrfGuard/safeFetch dispatcher, and it is the fetch path for fetchPageUrls (line 198) and fetchMetadata (line 238); only the sitemap path goes through SitemapParser/safeFetch. CLAUDE.md and docs/sandboxing-and-approvals.md list mapSite.js as SSRF-wired, so this is a documented-guard bypass. Verified: started a loopback HTTP server and called `mapSiteTool.execute({url:'http://127.0.0.1:<port>/'})` — it succeeded and returned `["http://127.0.0.1:58039/secret-internal"]`. A model- or user-supplied URL such as http://169.254.169.254/latest/meta-data/ or an internal admin host is therefore fetched, and its links plus (with include_metadata) title/description/h1/canonical are returned to the caller.  
*Fix:* Replace `fetch(url, {...})` in fetchWithTimeout with `safeFetch` from ../../utils/ssrfGuard.js (same import style as _sessionContext.js), so both fetchPageUrls and fetchMetadata are guarded.


**🟠 HIGH · _CONFIRMED_ — Content similarity is computed as Hamming distance between hex hashes, so every change scores ~0% similar and lands at >= 'moderate' significance**  
`src/core/ChangeTracker.js:869`  
calculateSimilarity(hash1, hash2) compares two sha256 hex digests character-by-character (hammingDistance, line 910). Two hashes of near-identical inputs differ in ~15/16 of their hex chars: verified numerically that a one-character content edit yields similarity 0.000. detectChanges stores that as `changes.similarity` (line 349), calculateChangeSignificance adds `(1 - similarity) * 0.3 = 0.3` (line 441), which already equals the default `moderate` threshold — so a single typo fix on a monitored page is classified at least 'moderate' and fires the default `notificationThreshold: 'moderate'` alerts, while generateChangeSummary reports `contentSimilarity: 0` (%) to the user for a 99.9%-identical page. differ.js already exports a correct token-Jaccard calculateSimilarity that nothing calls.  
*Fix:* Compare content, not hashes — use the Jaccard helper in src/tools/tracking/trackChanges/differ.js (or a diff-ratio) for changes.similarity, and keep hash equality only as the fast identical/changed test.


**🟠 HIGH · _CONFIRMED_ — generate_llms_txt reuses one analyzer instance whose mutable `this.analysis` is shared across calls, so results cross-contaminate**  
`src/core/LLMsTxtAnalyzer.js:49`  
GenerateLLMsTxtTool creates a single LLMsTxtAnalyzer in its constructor (src/tools/llmstxt/generateLLMsTxt.js:57) and the server registers one tool instance, but analyzeWebsite writes into instance state (`this.analysis.metadata` line 79, `.structure` 157, `.apis` 241, `.contentTypes` 292, `.securityAreas` 353, `.rateLimit` 390) and returns that same object. Two concurrent generate_llms_txt calls (an MCP client may dispatch tool calls in parallel) interleave: whichever finishes last overwrites metadata.baseUrl while another phase's data from the other site remains, producing an llms.txt that mixes two domains. Even sequentially, `this.analysis.errors` is only ever pushed to (lines 123/171/246/297/359/402/430) and never reset, so run 2 reports run 1's errors through generateWarnings() and its 'Guidelines may be incomplete' warning.  
*Fix:* Construct a fresh LLMsTxtAnalyzer per execute() call (or reset this.analysis to a fresh object at the top of analyzeWebsite and return a deep copy).


**🟠 HIGH · _CONFIRMED_ — Delta snapshot storage silently discards content — retrieving a delta snapshot returns the previous version's content**  
`src/core/SnapshotManager.js:836`  
createDelta() returns a stub JSON (`{type:'diff', base, current, operations: []}`) with no actual diff, and applyDelta() (line 850) ignores it and returns the base content. storeSnapshot enables delta whenever similarity > deltaThreshold (line 223), and TrackChangesTool constructs SnapshotManager with `enableDeltaStorage: true` (src/tools/tracking/trackChanges/index.js:47-52). Verified end to end: stored v1 = 'PRICE: 100 USD...' then v2 = 'PRICE: 999 USD...' (766 chars); v2 was stored as a 56-byte delta, and after a process restart (cold cache) `retrieveSnapshot(v2)` returned content starting 'PRICE: 100 USD' — the new version is unrecoverable. Any track_changes history/export that reads snapshot bodies gets stale content presented as current.  
*Fix:* Either implement a real delta (store the diff and apply it) or disable delta storage: drop the createDelta/applyDelta path and always persist the full (compressed) content.


**🟠 HIGH · _CONFIRMED_ — Snapshot .meta files embed the full uncompressed content, and every one is loaded into an unbounded in-memory metadataCache at startup**  
`src/core/SnapshotManager.js:701`  
storeMetadata writes the entire `snapshot` object — which still holds `content` (assigned at line 195) and `delta.deltaData` — to `<id>.meta` as pretty-printed JSON, and caches the same object in metadataCache. Verified: for a 766-char page the .snap file was 56 bytes but the .meta file was 1330 bytes and contained the full plaintext ('meta file contains FULL content? true'), so gzip compression and delta storage save nothing on disk. loadMetadata() (line 737) then reads every .meta file at construction into metadataCache, which has no size bound (unlike snapshotCache, capped at line 902). A tracker with thousands of stored page snapshots therefore pins every page body in RAM on startup and doubles disk usage; querySnapshots (line 402) iterates this same unbounded map.  
*Fix:* Strip `content` and `delta.deltaData` before writing/caching metadata (persist them only in the .snap file), and bound metadataCache the way snapshotCache is bounded.


**🟠 HIGH · _CONFIRMED_ — Every crawl_deep call permanently leaks a CacheManager (plus up to 1000 cached page bodies) via its never-cleared interval timers**  
`src/core/cache/CacheManager.js:87`  
CacheManager registers a cleanup setInterval (line 87) and a monitoring setInterval (line 547); both arrow callbacks capture `this`, so the instance stays strongly reachable from Node's timer list even after the owner is dropped. BFSCrawler creates a fresh `new CacheManager({ttl: 3600000})` per crawl (src/core/crawlers/BFSCrawler.js:49), stores every page's parsed data including `originalHtml` (BFSCrawler.js:350), and has no destroy()/cleanup(); crawlDeep.js never tears the crawler down. Verified with WeakRef + --expose-gc: a dropped CacheManager is still alive after repeated global.gc() ('CacheManager still retained after GC (leak): true'). Consequence: N crawl_deep calls leave N caches holding up to 1000 full HTML documents each for the process lifetime, and each leaked cache re-runs calculateMemoryUsage() (JSON.stringify of every cached value) every 60 s forever.  
*Fix:* Add a destroy()/cleanup() on BFSCrawler that calls this.cache.destroy(), and call it from CrawlDeepTool.execute in a finally block; unref() is not enough because unref'd timers still retain the instance.


**🟠 HIGH · _CONFIRMED_ — crawl_deep result cache key omits extract_content, include/exclude patterns, follow_external and session — cached results contradict the request**  
`src/tools/crawl/crawlDeep.js:107`  
generateKey uses only `{url, depth, pages}` (lines 107 and 234) and returns the cached response at line 109 before anything else runs. Verified against a local server: call 1 with defaults cached a result containing page content; call 2 with `extract_content: false` and `exclude_patterns: ['.*']` returned the identical cached payload — content still present, exclusions ignored, `pages_crawled: 2`. A caller who re-runs a crawl to exclude a section, or to skip content extraction for size reasons, silently gets the old result for the whole 1 h TTL.  
*Fix:* Fold extract_content, content_max_length, include_patterns, exclude_patterns, follow_external, respect_robots, concurrency, domain_filter and session presence into the cache key (or hash the full validated params).


**🟠 HIGH · _CONFIRMED_ — map_site result cache key omits `search` and the domain filter, so the v4.6.0 ranking feature is silently ignored on a cache hit**  
`src/tools/crawl/mapSite.js:55`  
The cache key is generated from only `{url, maxUrls}` (lines 55 and 153) and a hit returns early at line 57, before the search-ranking block at lines 133-149 and before any filter is applied. Verified against a local server: call 1 without `search` cached the result; call 2 with `search:'pricing'` returned `'ranked_urls' in result === false` — the requested ranking was dropped for the full 1 h TTL. The inverse also holds: a plain call after a cached search call gets the extra `ranked_urls` key it never asked for, and calls differing only in domain_filter/include_metadata reuse each other's results.  
*Fix:* Include search, domain_filter/import_filter_config, include_metadata and group_by_path in generateKey (or apply ranking/filtering after the cache read rather than before).


**🟠 HIGH · _CONFIRMED_ — Sitemaps served with Content-Encoding: gzip are silently dropped (double gunzip of already-decompressed body)**  
`src/utils/sitemapParser.js:401`  
_fetchSitemapContent gunzips whenever `content-encoding` contains gzip, but undici's fetch has already transparently decompressed the body while still exposing the original `content-encoding` header (verified: header is "gzip", body is plain XML, and zlib.gunzipSync on it throws 'incorrect header check'). Verified with a local server returning a gzip-encoded urlset: `SitemapParser.parseSitemap()` returned `success: true, urls: 0, error: ''` — the failure is swallowed by the catch at line 411 and again at line 377, so callers cannot tell. Since gzip-encoding XML is the norm on nginx/CDN-fronted sites, map_site's `include_sitemap` path yields nothing for those sites and silently degrades to homepage-link scraping.  
*Fix:* Only gunzip when the payload is actually compressed — check for the 0x1f 0x8b magic bytes (or restrict to url.endsWith('.gz') and sniff), and surface a parse failure instead of returning success:true with 0 urls.


**🟡 MED — generate_llms_txt MCP schema drifts from the tool: checkSecurity defaults to true (probing /admin, /login) and probeRateLimit/robotsStyle are unreachable**  
`server.js:1048`  
The registered inputSchema sets `checkSecurity: z.boolean().optional().default(true)`, while the tool's own schema documents it as opt-in and defaults it to false (src/tools/llmstxt/generateLLMsTxt.js:16, mirrored by LLMsTxtAnalyzer.js:34 'intrusive probing is now opt-in'). Because zod defaults inside an optional object apply as soon as the object is present, any caller who passes `analysisOptions: {maxDepth: 2}` silently gets security probing of /admin, /wp-admin, /login, /auth etc. against a third-party site. Conversely the server schema omits `analysisOptions.probeRateLimit` and `outputOptions.robotsStyle`, and the MCP SDK strips unknown keys, so those two documented switches cannot be reached through the tool at all.  
*Fix:* Mirror the tool schema in server.js: default checkSecurity to false and add probeRateLimit and outputOptions.robotsStyle.


**🟡 MED — Change history grows without bound — maxHistoryLength / maxHistoryEntries / retainHistory are declared but never enforced**  
`src/core/ChangeTracker.js:231`  
`changeHistory.push(changeRecord)` appends forever, and each record carries `details` = the full change analysis including word- and line-level diff arrays (detectTextChanges, line 716) plus the baseline's `analysis.originalContent` retained in this.snapshots (line 137). Grepping the whole src tree shows `maxHistoryLength` appears only at its declaration (ChangeTracker.js:56) and `maxHistoryEntries`/`retainHistory` only in the input schema (src/tools/tracking/trackChanges/schema.js:63-64) — nothing reads them, and storageOptions.compressionEnabled/deltaStorageEnabled are likewise never forwarded to SnapshotManager. A scheduled monitor polling hourly for weeks accumulates a diff record per check for the process lifetime, and the caller's maxHistoryEntries setting does nothing.  
*Fix:* Trim changeHistory to options.maxHistoryLength (and honour storageOptions.maxHistoryEntries/retainHistory) after each push, and stop retaining originalContent in the in-memory baseline once hashes are computed.


**🟡 MED — Unawaited initialize() in the constructor turns a snapshot-directory failure into an opaque unhandled rejection and a silently broken tool**  
`src/core/SnapshotManager.js:127`  
The constructor calls `this.initialize()` without await or catch; initialize emits 'error' on an EventEmitter that has no listener yet (line 154) and then rethrows, so the real cause is replaced by a generic 'Unhandled error.' rejection. Verified: constructing SnapshotManager with an uncreatable storageDir produced `UNHANDLED REJECTION TYPE: Error | Unhandled error. ({operation:'initialize', error:"ENOENT: no such file or directory, mkdir '/proc'"})`. TrackChangesTool has the same pattern (src/tools/tracking/trackChanges/index.js:67/105). This matters in practice because the server constructs TrackChangesTool with no options (server.js:175), so storage defaults to `./snapshots` relative to whatever cwd the MCP client launches the server in (often `/` for Claude Desktop) — the tool then appears registered but every snapshot write fails.  
*Fix:* Move initialization into an awaited async factory/`ensureInitialized()` guard called from execute(), and resolve the storage directory against a stable base (e.g. ~/.crawlforge) rather than process.cwd().


**🟡 MED — Per-domain fetch timeout creates a second setTimeout whose handle is discarded and never cleared**  
`src/core/crawlers/BFSCrawler.js:285`  
When `effectiveTimeout !== this.timeout`, the code clears the original timer and creates a replacement without capturing its id; the subsequent `clearTimeout(timeoutId)` calls at lines 298 and 312 clear the already-cleared original, so the replacement always survives the request. It later fires `controller.abort()` on a completed request and keeps a live timer per fetched page for up to `effectiveTimeout` ms. This triggers on every page whenever CRAWL_TIMEOUT differs from the domainRules default of 30000 (src/utils/domainFilter.js:203), or whenever a caller supplies `domain_filter.domain_rules` with a custom timeout — a 100-page crawl then leaves 100 pending timers behind.  
*Fix:* Assign the replacement to `timeoutId` (`timeoutId = setTimeout(...)`) so the existing clearTimeout calls cancel it.


**🟡 MED — crawl_deep ignores its server configuration — MAX_PAGES_PER_CRAWL, MAX_CRAWL_DEPTH, RESPECT_ROBOTS_TXT, FOLLOW_EXTERNAL_LINKS and QUEUE_CONCURRENCY have no effect**  
`src/tools/crawl/crawlDeep.js:81`  
server.js:163 passes `getToolConfig('crawl_deep')`, which supplies maxDepth, maxPages, respectRobots, followExternal and concurrency (src/constants/config.js:325-333), but the constructor destructures only userAgent, timeout, cacheEnabled and cacheTTL — the rest are dropped on the floor. The zod schema defaults (max_depth 3, max_pages 100 with a max of 1000, concurrency 10, respect_robots true, follow_external false) always win. An operator who sets MAX_PAGES_PER_CRAWL=20 to cap credit burn, or RESPECT_ROBOTS_TXT=false in a lab, gets no change in behaviour, and a caller can request max_pages: 1000 — 10x the documented cap — regardless of configuration.  
*Fix:* Store the config values on the instance and use them as the effective ceiling/default: clamp validated.max_pages/max_depth to the configured maxima and fall back to configured respectRobots/followExternal/concurrency when the caller omits them.


**🟡 MED — map_site stops after the first productive sitemap, discarding the other sitemaps a site declares**  
`src/tools/crawl/mapSite.js:187`  
fetchSitemapUrls iterates every discovered sitemap but breaks out of the loop as soon as `urls.size > 0`. discoverSitemaps returns all `Sitemap:` entries from robots.txt plus every reachable common path, so a site that declares e.g. sitemap-posts.xml, sitemap-products.xml and sitemap-pages.xml has only the first one parsed. The tool description promises 'know all URLs on a domain ... Reads sitemap.xml when available', and map_site is the documented pre-step for scoping crawl_deep, so the URL inventory silently under-reports large sites.  
*Fix:* Drop the break and keep accumulating across discovered sitemaps until `urls.size >= max_urls` (passing max_urls into fetchSitemapUrls as the stop condition).


**🟡 MED — Module-level `trackChangesTool` singleton spins up a second ChangeTracker/SnapshotManager/cache on import and hangs the process with a non-unref'd timer**  
`src/tools/tracking/trackChanges/index.js:473`  
`export const trackChangesTool = new TrackChangesTool()` runs on import, while server.js:175 separately constructs the instance it actually uses — so the server carries a duplicate ChangeTracker, SnapshotManager, CacheManager, MonitorStore and MonitorScheduler that nothing ever shuts down (gracefulShutdown only cleans the server's instance). SnapshotManager's cleanup interval (line 979 of SnapshotManager.js) is not unref'd. Verified: `node -e "import('src/tools/tracking/trackChanges/index.js')"` created `cache/` and `snapshots/` directories in the current working directory and then never exited — the run had to be killed by `timeout` (exit 124), with getActiveResourcesInfo() reporting a live `Timeout`.  
*Fix:* Drop the eager singleton (export a lazy getter/factory instead), and unref the SnapshotManager cleanup timer so an idle instance cannot keep the process alive.


**🟡 MED — track_changes get_history and monitor crash on the documented default call because queryOptions/monitoringOptions have no schema default**  
`src/tools/tracking/trackChanges/index.js:263`  
schema.js declares `queryOptions` (line 69) and `monitoringOptions` (line 50) as `.optional()` with no `.default({})`, but getChangeHistory dereferences `queryOptions.limit` (line 263) and setupMonitoring dereferences `monitoringOptions.interval` (line 245). Verified by executing the tool: `{url, operation:'get_history'}` returned `{success:false, error:"Cannot read properties of undefined (reading 'limit')"}` and `{url, operation:'monitor'}` returned `{success:false, error:"Cannot read properties of undefined (reading 'interval')"}`. The server wrapper (server.js:1030) reports these as a normal (non-isError) result, so the model sees a raw JS TypeError for two of the tool's five headline operations invoked exactly as documented.  
*Fix:* Add `.default({})` to queryOptions and monitoringOptions in schema.js (the inner fields already have defaults), or default the destructured objects in index.js.


**🟡 MED — normalizeUrl corrupts URLs with repeated query parameters, so the crawler fetches URLs that do not exist on the site**  
`src/utils/urlNormalizer.js:24`  
The sort block iterates `[...params.keys()]` (which yields one entry per occurrence, including duplicates) and appends `params.get(key)` — always the first value — once per occurrence. Verified: `normalizeUrl('https://example.com/p?tag=a&tag=b')` returns `https://example.com/p?tag=a&tag=a`. Because normalizeUrl runs on every discovered link in BFSCrawler.resolveUrl (line 365/376) and on every mapSite URL (mapSite.js:97/104), a faceted-search or multi-tag URL is rewritten into a URL the site never linked, that fabricated URL is then fetched and reported in results, and genuinely distinct multi-value URLs collapse to the same key in `visited` (under-dedup of one, over-dedup of the other).  
*Fix:* Sort entries rather than keys: `[...params.entries()].sort(([a],[b]) => a.localeCompare(b)).forEach(([k,v]) => sortedParams.append(k, v))`.


**⚪ LOW — crawl_deep response defines `errors` twice, silently dropping the error count**  
`src/tools/crawl/crawlDeep.js:218`  
The response literal sets `errors: results.errors.length` at line 218 and then `errors: results.errors` at line 222; the second wins, so the advertised error *count* field never reaches the caller and `errors` is an array. Verified against a local crawl: `typeof result.errors` was 'array'. Callers (and the LLM reading the JSON) get no scalar failure count alongside pages_crawled/pages_found, and the dead first key hides the fact that no summary metric is emitted.  
*Fix:* Rename the first key (e.g. `error_count`) or delete it and let consumers use `errors.length`.


**⚪ LOW — Test coverage gap: snapshot tests disable the delta path, and BFSCrawler/sitemapParser/urlNormalizer/robotsChecker/domainFilter have no unit tests at all**  
`tests/unit/snapshotManager.test.js:45`  
The snapshotManager suite constructs its subject with `enableDeltaStorage: false` and `enableCompression: false`, which is precisely why the delta data-loss defect above ships undetected — no test ever retrieves a delta-stored snapshot. Grepping tests/unit and tests/integration shows no file exercising src/core/crawlers/BFSCrawler.js, src/utils/sitemapParser.js, src/utils/urlNormalizer.js, src/utils/robotsChecker.js or src/utils/domainFilter.js directly; crawlDeep.test.js and mapSite.test.js have 9 assertions each and cover schema/formatting only, so the queue deadlock, the gzip sitemap failure, the duplicate-query-param corruption and the cache-key omissions are all untested load-bearing logic.  
*Fix:* Add unit tests over a local http server for: delta store+retrieve round-trip, BFSCrawler max_pages/max_depth and low-concurrency completion, gzip-encoded sitemap parsing, normalizeUrl with repeated query params, and cache-key sensitivity for map_site `search` / crawl_deep `extract_content`.


### E. Extract & Document Processing

> **Auditor's read:** The extract/document area works for the happy path but has several load-bearing defects that current tests cannot catch, because every unit test under tests/unit/tools/extract/ exercises locally-defined stub classes rather than the real modules. Two of them are user-visible today: `summarize_content`'s extractive path silently throws inside ContentAnalyzer on every call (wrong method name on node-summarizer) and degrades to "first two sentences", and the `options` object for extract_content / summarize_content / analyze_content is stripped to `{}` by `z.object({})` at the MCP boundary, so every option those tool descriptions advertise is unreachable. The PDF path is the weakest spot: it is the one read-scrape fetch in the repo still using raw global `fetch` (no SSRF guard), it has no working timeout, no size bound, and its `password` option is a silent no-op. Error handling is generally defensive (broad try/catch returning `{success:false}`), but that same breadth is what hides these failures — several fall back silently with no note in the result.


**🟠 HIGH · _CONFIRMED_ — options object silently stripped for extract_content, summarize_content and analyze_content**  
`server.js:543`  
These three tools declare `options: z.object({}).optional()` (lines 500, 543, 563). Zod objects strip unknown keys, and the MCP SDK passes parseResult.data to the handler (sdk/dist/esm/server/mcp.js:174-181), so the handler always receives `{}`. Verified: z.object({text:z.string(), options:z.object({})}).parse({text:'x', options:{summaryType:'abstractive'}}) -> {"text":"x","options":{}}. Failure scenario: the summarize_content description's own example, summarize_content({text, options:{summaryLength:'short', summaryType:'abstractive'}}), silently produces a default medium extractive summary; extract_content's outputFormat:'markdown'/includeRawHTML and analyze_content's includeAdvancedMetrics/maxKeywords are likewise unreachable. process_document was already fixed with `.passthrough()` (line 523) — these three were missed.  
*Fix:* Add `.passthrough()` to the three options schemas (or declare the real option keys), matching process_document.


**🟠 HIGH · _CONFIRMED_ — summarize_content extractive mode always throws internally and returns a 2-sentence fallback**  
`src/core/analysis/ContentAnalyzer.js:385`  
summarizeText() calls `this.summarizer.getSummaryByRanking(text, targetSentences)`, but node-summarizer's SummarizerManager exposes getSummaryByFrequency()/getSummaryByRank() and its constructor takes (string, number_of_sentences) — line 182 constructs it with no arguments. Verified at runtime through the real tool: SummarizeContentTool.execute({text: <15 sentences>, options:{summaryLength:'long'}}) logs 'Text summarization failed: this.summarizer.getSummaryByRanking is not a function' and returns {summary:{type:'fallback', length:'short', sentences:2}} — identical output for summaryLength 'short' and 'long' — while result.metadata.processingMethod still reports 'extractive'. The advertised ranking summarizer has never run and summaryLength has no effect.  
*Fix:* Construct per call as `new SummarizerManager(text, targetSentences)` and call `await mgr.getSummaryByRank()` (or getSummaryByFrequency()), reading `.summary` from the result; add a real (non-stub) test asserting summaryLength changes sentence count.


**🟠 HIGH · _CONFIRMED_ — process_document PDF-URL download bypasses the SSRF guard (raw global fetch)**  
`src/core/processing/PDFProcessor.js:208`  
downloadPDFFromURL() calls the global `fetch` directly instead of safeFetch/ssrfGuard, unlike every other read-scrape fetch site (extractContent.js:173, processDocument.js:279, _fetchAndParse.js:36 all use safeFetch). I verified with a read-only script that ssrfGuard() rejects `http://metadata.google.internal/computeMetadata/v1/` ('SSRF Protection: blocked metadata host') and `file:///etc/passwd` ('protocol not allowed'), while this path applies none of those checks and gets no connect-time IP validation from the guarded undici dispatcher. Failure scenario: process_document({source:'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/', sourceType:'pdf_url'}) — reachable via prompt injection into the calling LLM — issues the internal request that CLAUDE.md and docs/sandboxing-and-approvals.md state is blocked on the live scraping fetch path since v4.8.0.  
*Fix:* Import { safeFetch } from '../../utils/ssrfGuard.js' and use it in downloadPDFFromURL, matching the other fetch sites.


**🟠 HIGH · _CONFIRMED_ — CSS fallback builds unquoted attribute selectors from schema keys and throws on keys with spaces/parens/quotes**  
`src/tools/extract/extractStructured.js:239`  
_cssExtraction interpolates schema property names straight into `[data-${key}]` (line 239) and `[data-${key}] > li` (line 210). Verified with cheerio: $('[data-job title]'), $('[data-price(USD)]') and $('[data-a\"b]') all throw Error('Attribute selector didn't terminate'). Because the CSS fallback is the default path whenever no LLM provider is configured (the documented default for this server), extract_structured({url, schema:{properties:{'job title':{type:'string'}}}}) returns {extraction_method:'none', error:"Structured extraction failed: Attribute selector didn't terminate"} instead of extracting anything — the throw escapes _cssExtraction into execute()'s outer catch and discards all other fields too.  
*Fix:* Skip/escape keys that aren't valid CSS identifiers (e.g. only build attribute selectors when /^[A-Za-z_][\w-]*$/ matches), or wrap each selector lookup in its own try/catch so one bad key doesn't abort the whole extraction.


**🟡 MED — extract_content / process_document Chromium instances and contexts are never cleaned up**  
`server.js:1391`  
extractContentTool and processDocumentTool each own a BrowserProcessor and each defines cleanup() (extractContent.js:334, processDocument.js:509), but neither is in the gracefulShutdown toolsToCleanup array (only extractStructuredTool from this area is). BrowserProcessor.initBrowser() caches `this.browser = chromium.launch(...)` for the process lifetime, and createPage() opens a fresh context per call (BrowserProcessor.js:502) while processURL only closes the page in its finally (line 205) — the context is never closed. Failure scenario: N extract_content calls on JS-rendered pages accumulate N leaked browser contexts, and on SIGTERM the headless Chromium child process is orphaned rather than closed.  
*Fix:* Add extractContentTool and processDocumentTool to toolsToCleanup, and close the context (not just the page) in BrowserProcessor.processURL's finally block.


**🟡 MED — PDF download has no timeout (invalid `timeout` option) and buffers the body unbounded**  
`src/core/processing/PDFProcessor.js:212`  
downloadPDFFromURL passes `timeout: 30000` in the fetch init — Node/undici fetch ignores unknown init properties; only `signal` works (every other fetch in this area uses AbortSignal.timeout(15000)). Line 224 then does `await response.arrayBuffer()` with no Content-Length or byte cap. Failure scenario: process_document({source:'https://slow.example/report.pdf', sourceType:'pdf_url'}) against a stalling or slow-drip server never returns — the MCP call hangs indefinitely and the credit is already reserved; a multi-GB response OOMs the server process before pdf-parse's maxPages cap can apply.  
*Fix:* Use `signal: AbortSignal.timeout(30000)` and reject when Content-Length (or accumulated bytes read from the stream) exceeds a configured maximum.


**🟡 MED — PDF `password` option is a silent no-op — encrypted PDFs always fail**  
`src/core/processing/PDFProcessor.js:127`  
processPDF sets parseOptions.password (line 128) and the tool schema exposes it (processDocument.js:26 via options.password), but the installed pdf-parse 1.1.4 never reads it: lib/pdf-parse.js only consumes pagerender/max/version and calls `PDFJS.getDocument(dataBuffer)` with the raw buffer (grep for 'password' in that file returns nothing). Failure scenario: process_document({source:'https://x/encrypted.pdf', sourceType:'pdf_url', options:{password:'hunter2'}}) returns 'PDF parsing failed: No password given' — the caller has no way to tell the option was ignored rather than wrong.  
*Fix:* Either drop the password option from both schemas, or pass `{data: buffer, password}` to a pdf.js API that honours it (requires bypassing pdf-parse's buffer-only call).


**🟡 MED — Any URL containing '#' forces headless-browser rendering in extract_content and process_document**  
`src/tools/extract/extractContent.js:304`  
shouldUseJavaScript() tests `/#/` against the raw URL (same list duplicated at processDocument.js:454), and `/\/(app|spa|dashboard|admin)/` has no path-segment boundary. Failure scenario: extract_content({url:'https://docs.example.com/guide#installation'}) — an ordinary static docs anchor — skips the cheap safeFetch path and launches Chromium with --no-sandbox/--disable-web-security, adding seconds of latency and a leaked context per call; if Playwright browser binaries are not installed (package.json has no `playwright install` postinstall), the call fails outright with 'Browser processing failed: ...' even though a plain HTTP fetch would have succeeded. '/apple' and '/spaces' likewise match the second pattern.  
*Fix:* Strip the fragment before the check (or drop the '#' heuristic entirely) and anchor the path pattern to full segments, e.g. /\/(app|spa|dashboard|admin)(\/|$)/.


**🟡 MED — extract_structured elicitation is wired but never invoked, contradicting the documented behaviour**  
`src/tools/extract/extractStructured.js:56`  
The tool constructs an ElicitationHelper (line 56) and server.js:199 calls setMcpServer to inject the real MCP server, but `this._elicitation` is never referenced inside execute() — grep across src/tools/extract shows only lines 56 and 61. docs/sandboxing-and-approvals.md:140 and CLAUDE.md both state extract_structured asks for confirmation when 'schema has >3 required fields, no LLM configured'. Failure scenario: extract_structured with a 6-required-field schema and no LLM provider silently runs the low-fidelity CSS fallback with no confirmation and no note, while the security documentation asserts the user was asked.  
*Fix:* Either call `await this._elicitation.confirm(...)` before the CSS fallback when schema.required.length > 3 and no LLM is available, or remove the claim from the docs and the unused helper.


**🟡 MED — MCP-sampling fallback is dead — SamplingClient is constructed without the MCP server**  
`src/tools/extract/extractWithLlm.js:482`  
Both `new SamplingClient()` here and in summarizeContent.js:214 pass no mcpServer, so SamplingClient's step 3 guard `if (this._mcpServer?.server?.createMessage)` (SamplingClient.js:153) is always false and the client-side sampling leg never runs. Neither tool has a setMcpServer() and neither is wired in server.js (which does wire deepResearch, batchScrape, crawlDeep, extractStructured, agent, trackChanges). Failure scenario: on a sampling-capable MCP client with no Ollama and no API keys, summarize_content({options:{summaryType:'abstractive'}}) returns degraded:true 'no LLM/sampling backend' even though the client could have served the completion, and extract_with_llm's advertised 'Ollama → ... → sampling' chain stops one step early.  
*Fix:* Add setMcpServer(server) to both tools and pass it into the SamplingClient constructor, as extractStructured/agent already do.


**🟡 MED — sourceType 'file' (non-PDF local file) always fails with 'Failed to parse URL'**  
`src/tools/extract/processDocument.js:148`  
The schema advertises sourceType 'file' (line 16) and the tool description says it handles 'local files', but the dispatch at line 148 only routes to the PDF processor when sourceType contains 'pdf'; 'file' falls through to processWebDocument, which passes the filesystem path to safeFetch (line 279). Verified at runtime: ProcessDocumentTool.execute({source:'/etc/hosts', sourceType:'file'}) returns {success:false, error:'Document processing failed: Failed to parse URL from /etc/hosts', documentType:'unknown'}. No local non-PDF file can ever be processed.  
*Fix:* Route sourceType 'file' to a local fs.readFile branch (as processPDFDocument does for pdf_file) before falling through to the URL fetch, or drop 'file' from the enum and the description.


**⚪ LOW — analyze_content language 'alternatives' confidences are inverted**  
`src/core/analysis/ContentAnalyzer.js:327`  
francAll returns [code, score] pairs sorted best-first where 1.0 is the best match (verified: francAll('The quick brown fox…') -> [['eng',1],['sco',0.978],['dan',0.721]]), but line 327 maps them to `confidence: 1 - score`. Verified through the real tool: detectLanguage on an English paragraph returns alternatives [{deu,0.13},{dan/afr,~0.19},{nld/glg,~0.25}] — the list stays sorted most-likely-first while the reported confidences ascend, so a consumer ranking by confidence picks the least likely language. The primary `confidence` (line 316) is also purely a function of text length, not detection certainty.  
*Fix:* Report the franc score directly (or a normalised form of it) instead of 1 - score.


**⚪ LOW — pageRange past the end of the PDF returns empty text with success:true**  
`src/core/processing/PDFProcessor.js:147`  
When pageRange is set, `capturedPages.slice(start - 1, end)` (line 147) silently yields [] if start exceeds the rendered page count, and processPDF still returns success:true with text:'' and extractedPages:{start,end,count:0}. process_document then reports statistics of 0 words and a quality assessment of 'Invalid or empty content' with no indication that the requested range simply doesn't exist. Failure scenario: process_document({source:'…/2-page.pdf', sourceType:'pdf_url', options:{pageRange:{start:50,end:60}}}) looks like a PDF with no extractable text.  
*Fix:* Return an explicit error (or a warning field) when start > capturedPages.length, and clamp end to the page count.


**⚪ LOW — LLM failure in extract_structured is swallowed with no trace in the result**  
`src/tools/extract/extractStructured.js:122`  
The catch at line 122-125 sets extractionResult = null and discards llmError entirely; the returned object then reports extraction_method:'css_fallback' with extractionNotes ['Used CSS selector fallback extraction']. Failure scenario: a configured OpenAI key that is expired or rate-limited produces low-quality CSS-fallback data on every call, and neither the caller nor the logs ever see the 401/429 — the user cannot distinguish 'no LLM configured' from 'LLM broken'.  
*Fix:* Push the error message into extractionNotes (e.g. `LLM extraction failed: ${llmError.message}`) or log it to stderr.


**⚪ LOW — Flat schema hint maps are normalised for Anthropic but passed raw to Ollama's `format`**  
`src/tools/extract/extractWithLlm.js:343`  
buildInputSchema() (line 163) and jsonSchemaToZod() (line 181) both explicitly accept a flat field→type-hint map such as {name:'string', tags:'array'}, and the Anthropic branch normalises it into a valid JSON Schema before sending (line 291). The Ollama branch instead assigns `format: schema` verbatim (line 343). Failure scenario: extract_with_llm({content, prompt, schema:{name:'string'}}) with the default provider 'auto' (= Ollama) sends a non-JSON-Schema object as Ollama's structured-output format, which the server rejects rather than constraining the model — the same input works on the anthropic provider.  
*Fix:* Pass buildInputSchema(schema) to callOllama as well, so both branches receive the same normalised schema.


**⚪ LOW — HTMLCleaner.extractTextWithFormatting duplicates nested text and ignores its own preserve options**  
`src/utils/contentUtils.js:104`  
The walker iterates every descendant of body and, for each p/div, appends `$element.text()` — which already includes nested content — so text under nested containers is emitted once per ancestor. The final `text.replace(/\s+/g,' ')` on line 150 then collapses every newline, making preserveLineBreaks/preserveParagraphs no-ops (the following /\n\s+/ replace is dead). Verified: extractTextWithFormatting('<body><div><div><p>Hello world.</p></div></div><p>Second para.</p><br><li>Item</li></body>', {preserveLineBreaks:true, preserveParagraphs:true}) returns 'Hello world. Hello world. Hello world. Second para. • Item'. This is the declared last-resort branch of extract_content (line 229) and process_document (line 320); today it is effectively unreachable because ContentProcessor always sets fallback_content, so impact is latent rather than active.  
*Fix:* Walk only direct block-level children (or use the existing htmlToMarkdown/Turndown path), and collapse spaces with /[ \t]+/ instead of /\s+/ so line breaks survive.


**⚪ LOW — All six extract-tool unit suites test locally-defined stubs, not the real modules**  
`tests/unit/tools/extract/summarizeContent.test.js:20`  
summarizeContent.test.js (SummarizeContentStub, line 20), analyzeContent.test.js (line 32), processDocument.test.js (line 45), extractContent.test.js (line 46), extractStructured.test.js (line 38) and listOllamaModels.test.js (line 20) each define a stub class reimplementing the tool and never import src/tools/extract/*; only tests/unit/extractWithLlm.test.js imports the production module. Consequence: the suites pass green while the real code has the getSummaryByRanking failure, the stripped-options break and the unused elicitation helper — extractStructured.test.js even asserts `tool._elicitation` exists on a stub whose production counterpart never uses it.  
*Fix:* Import the real tool classes and inject stubbed collaborators (constructor injection or a fetch stub) so the suites exercise src/tools/extract; at minimum add a real-module test for summarize_content asserting summary.type === 'extractive'.


### F. Search & Deep Research

> **Auditor's read:** The serp_rank/DataForSEO path is genuinely solid — correct Basic auth, zod-enforced depth<=200, clean error mapping, 0-credit unconfigured handling honored in withAuth, no credential leakage, and 29 unit tests. The search_web core path works for defaults, but its tuning surface is a trap: partial ranking weights or dedup thresholds silently break ranking/dedup (verified NaN scores), approach-specific tuning in deep_research never reaches SearchWebTool due to config-key drift, and the expansion retry loop can quietly multiply backend billing. deep_research is the weakest area: maxUrls>500 deterministically fails after asking the user to confirm the spend, the time budget neither cancels background work nor bounds the whole run, several schema parameters are decorative, LLM-configured runs would crash at compile time on missing state maps, and webhook delivery bypasses the SSRF guard while llmConfig API keys land in file logs. Raw-evidence (no-LLM) mode itself — this deployment's intended path — is correctly wired and returns partial results rather than throwing on timeout.


**🟠 HIGH · _CONFIRMED_ — deep_research with maxUrls > 500 makes every internal search fail and the whole run errors out**  
`src/core/ResearchOrchestrator.js:467`  
gatherInitialSources computes `maxSourcesPerQuery = Math.ceil(this.maxUrls / queries.length)` and passes it as `limit` to SearchWebTool.execute, but SearchWebSchema caps limit at 100 (src/tools/search/searchWeb.js:15). With the default 5 queries, any maxUrls > 500 (schema allows up to 1000) — or maxUrls > 100 with maxDepth:1 (only 1 query survives rankResearchQueriesWithSemantics) — makes every search throw a zod 'too_big' error, tripping the all-queries-failed guard at line 506 and failing the entire research run. Verified empirically: SearchWebTool.execute({query:'x', limit:120}) throws. Worse, the >50-URL elicitation in deepResearch.js:135 first asks the user to confirm spending ~maxUrls credits for a run that then deterministically fails.  
*Fix:* Clamp: `const maxSourcesPerQuery = Math.min(100, Math.ceil(this.maxUrls / queries.length));` and fan out extra pages via offset if more coverage is needed.


**🟠 HIGH · _CONFIRMED_ — initializeResearchSession drops 4 state maps, crashing result compilation whenever LLM features are enabled**  
`src/core/ResearchOrchestrator.js:214`  
The constructor's researchState includes llmAnalysis, semanticSimilarities, relevanceScores, and synthesisHistory (lines 114-117), but initializeResearchSession (lines 214-230) replaces researchState with an object missing all four. When enableLLMFeatures is true (user passes llmConfig.openai/anthropic.apiKey — explicitly allowed by the deep_research schema — or env keys are set), compileResearchResults line 1553 executes `Object.fromEntries(this.researchState.relevanceScores)` → TypeError 'undefined is not iterable' → outer catch → handleResearchError, so every LLM-enabled research run returns an error after doing all the paid search/extract work. Earlier `.set()` calls on the missing maps (lines 390, 663-664, 963) also throw and silently knock out semantic ranking, LLM relevance analysis, and synthesis history via their local catches. Dormant in this keyless deployment but guaranteed for any user who supplies llmConfig.  
*Fix:* Add llmAnalysis: new Map(), semanticSimilarities: new Map(), relevanceScores: new Map(), synthesisHistory: [] to the researchState object built in initializeResearchSession.


**🟠 HIGH · _CONFIRMED_ — Research time budget does not cancel work: timed-out stages keep running and race with result compilation**  
`src/core/ResearchOrchestrator.js:1325`  
processWithTimeLimit (lines 1325-1339) races the stage against a setTimeout and swallows the timeout, but never cancels the abandoned async function. On a timeout in exploreSourcesInDepth, the batch loop keeps fetching/extracting (and burning stealth retries and LLM calls) in the background while conductResearch proceeds: _closeStealth() (line 706) closes the browser out from under in-flight stealth fetches, `detailedFindings.sort(...)` (line 709) sorts an array the background loop is still pushing into, and verifySourceCredibility iterates it while it grows — nondeterministic result sets and network activity continuing well past the advertised timeLimit. Additionally the timeout timer is never cleared, so each stage leaves a live timer of up to 5 minutes (two per research call) that keeps the event loop alive and delays graceful shutdown. Note also the timeLimit is per-stage, not global: gatherInitialSources and exploreSourcesInDepth each get the full budget, so timeLimit:120000 can legally run 240s+ before synthesis.  
*Fix:* Pass an AbortSignal (AbortSignal.timeout or a shared deadline checked between batches) into the stage loops so work stops at the budget; clearTimeout the racer in a finally; derive both stage budgets from one wall-clock deadline.


**🟠 HIGH · _CONFIRMED_ — Partial ranking_weights produce NaN finalScore for every result — ranking silently broken**  
`src/tools/search/ranking/ResultRanker.js:76`  
search_web's zod schema allows a partial weights object (each of bm25/semantic/authority/freshness optional, searchWeb.js:34-39) and passes it as {weights} (searchWeb.js:274-281). rankResults does `{ ...this.options, ...options }`, replacing the entire default weights object, so computeFinalScore (lines 323-330) multiplies missing weights as undefined. Verified empirically: rankResults(results, 'node guide', {weights:{bm25:0.7}}) returns finalScore NaN for all results — sort order becomes a no-op, rankingDetails report NaN, and the response's `weightsApplied` (searchWeb.js:285) misleadingly shows the untouched defaults. Any user tuning a single weight gets unranked results with no error.  
*Fix:* Deep-merge weights: `rankingOptions.weights = { ...this.options.weights, ...(options.weights || {}) }` (same for bm25/authority/freshness sub-objects), and report the merged weights in rankingInfo.


**🟡 MED — deep_research logs user-supplied LLM API keys to Winston file logs**  
`src/tools/research/deepResearch.js:120`  
execute() logs `config: this.sanitizeConfigForLogging(validated)` (line 120), and sanitizeConfigForLogging (lines 749-755) only strips webhook headers — llmConfig, including openai.apiKey and anthropic.apiKey which the tool schema explicitly accepts per request, is logged verbatim. Logger.js has enableFile=true by default writing to the logs/ directory, so secrets are persisted to disk. A user who passes llmConfig:{openai:{apiKey:"sk-..."}} has their key written to logs/*.log.  
*Fix:* In sanitizeConfigForLogging, redact llmConfig key material: e.g. replace llmConfig.openai/anthropic apiKey values with '[redacted]' before logging.


**🟡 MED — Webhook notifications use raw fetch on a user-supplied URL — SSRF gap (bypasses ssrfGuard)**  
`src/tools/research/deepResearch.js:716`  
sendWebhookNotification POSTs the research payload to webhook.url with the global fetch (line 716) instead of safeFetch/ssrfGuard, and there is no global undici dispatcher installed in the server (only the CLI sets one, for proxies). ssrfGuard is opt-in per call, so a caller can set webhook.url to http://169.254.169.254/... or an internal service and the server performs a blind POST (with arbitrary user-controlled headers via webhook.headers) from its network position on every configured event. CLAUDE.md claims SSRF is wired into research fetches — true for the extraction fallback (ResearchOrchestrator.js:556 uses safeFetch) but not this path. The fetch also has no timeout, so a tar-pitting webhook endpoint stalls the event handler.  
*Fix:* Use safeFetch from src/utils/ssrfGuard.js with an AbortSignal.timeout for webhook delivery (or route through WebhookDispatcher if it validates URLs).


**🟡 MED — Several advertised deep_research parameters are silently ignored by the orchestrator**  
`src/tools/research/deepResearch.js:360`  
buildResearchOptions (lines 360-370) packages sourceTypes, includeRecentOnly, queryExpansion, enableConflictDetection, enableSourceVerification, and enableSynthesis into conductResearch's `options`, but ResearchOrchestrator never reads any of them (grep confirms zero occurrences of sourceTypes/includeRecentOnly/enableSynthesis/options.enableConflictDetection/options.enableSourceVerification/options.queryExpansion/cacheResults in the file): stages use the constructor flags, which buildOrchestratorConfig only sets for specific approaches (academic sets enableSourceVerification:true, comparative sets enableConflictDetection:true). Concretely: enableSourceVerification:false and enableConflictDetection:false still run verification/conflict detection; sourceTypes:['academic'] and includeRecentOnly:true filter nothing; queryExpansion tuning and cacheResults:false change nothing — all while the tool schema documents these as functional.  
*Fix:* Propagate these flags through scopeConfig in buildOrchestratorConfig (constructor path), or make conductResearch honor its options argument; drop unimplementable filters from the schema.


**🟡 MED — Approach-specific searchConfig keys (enableRanking/rankingWeights/deduplicationThresholds) don't match SearchWebTool's constructor — tuning is a no-op**  
`src/tools/research/deepResearch.js:295`  
buildOrchestratorConfig's academic/current_events/comparative cases set searchConfig.enableRanking, searchConfig.rankingWeights (lines 293-301, 310-318), and searchConfig.deduplicationThresholds (lines 338-344), but SearchWebTool's constructor (searchWeb.js:68-77) only destructures apiKey, apiBaseUrl, cacheEnabled, cacheTTL, expanderOptions, rankingOptions, and deduplicationOptions — the keys used here are silently discarded. So the documented academic authority-weighting and current_events freshness-weighting never apply; those approaches search with default weights, differing from 'broad' only in query variations.  
*Fix:* Rename to the constructor's contract: searchConfig.rankingOptions = { weights: {...} } and searchConfig.deduplicationOptions = { thresholds: {...} }.


**🟡 MED — Partial deduplication_thresholds replace the defaults wholesale, disabling the unset checks**  
`src/tools/search/ranking/ResultDeduplicator.js:91`  
search_web passes { thresholds: userPartial } and deduplicateResults does `{ ...this.options, ...options }` (line 91), replacing the whole thresholds object. areDuplicates then compares against undefined for the missing keys (lines 219-221: `similarities.title >= undefined` is always false), and the combined-score check (line 231) is likewise dead if `combined` is unset. E.g. deduplication_thresholds:{url:0.8} (valid per zod) turns off title/content/combined duplicate detection entirely, leaving only the hardcoded 0.95 URL fast-path — the user tightened one knob and unknowingly disabled the rest.  
*Fix:* Merge: `dedupeOptions.thresholds = { ...this.options.thresholds, ...(options.thresholds || {}) }`.


**🟡 MED — Query-expansion retry loop can issue up to 5 billed backend searches for one search_web call**  
`src/tools/search/searchWeb.js:194`  
With expand_query defaulting to true and maxExpansions defaulting to 5, execute() loops over expanded queries (lines 194-242) and issues a new searchAdapter.search() — a separate POST to the CrawlForge /api/v1/search endpoint (documented at 2 credits per search, crawlforgeSearch.js:7) — whenever the previous query returned zero items. A niche/no-result query therefore triggers up to 5 sequential backend-billed searches (or 5x Google CSE quota in creator mode) inside a single tool invocation the user expects to cost one search. The retry count is not surfaced anywhere in the response.  
*Fix:* Cap fallback attempts (e.g. original query + 1 expansion), or only retry expansions when the caller opts in, and surface attempts/billing in the response.


**⚪ LOW — Success log computes duration after the session was deleted — always logs 0**  
`src/tools/research/deepResearch.js:196`  
Line 194 deletes the session from activeSessions, then line 198 logs `duration: Date.now() - this.activeSessions.get(sessionId)?.startTime || 0` — the lookup is now undefined, `Date.now() - undefined` is NaN, and `NaN || 0` yields 0, so every successful research run logs duration 0. Purely observability, but it makes the log field useless.  
*Fix:* Capture `const startTime = this.activeSessions.get(sessionId)?.startTime` before the delete (or reuse a local start timestamp).


**⚪ LOW — SearXNG fetch has no timeout — a hung instance stalls search_web for minutes**  
`src/tools/search/providers/searxng.js:94`  
searchViaSearxng calls fetch without an AbortSignal (lines 92-99). If the configured CRAWLFORGE_SEARXNG_URL instance accepts the TCP connection but never responds, the tool call hangs until undici's default header/body timeouts (~5 minutes) instead of failing fast like the DataForSEO adapter does (dataforseoSearch.js:82 uses AbortSignal.timeout(30000)). The instance URL is operator-configured env, so this is availability, not SSRF.  
*Fix:* Add `signal: AbortSignal.timeout(15000)` (or configurable) to the fetch options and map AbortError to a clear message.


**⚪ LOW — Queries whose tokens are all <=1 char after tokenization (e.g. "C#") yield NaN BM25 and NaN finalScore**  
`src/tools/search/ranking/ResultRanker.js:219`  
tokenize() strips punctuation and drops tokens of length <=1 (lines 400-406), so a query like "C#" produces queryTerms=[] and computeBM25Score returns `score / queryTerms.length` = 0/0 = NaN (line 219), which propagates to finalScore NaN for every result (verified empirically). Ranking becomes a no-op and NaN scores appear when include_ranking_details is set.  
*Fix:* Guard: `if (queryTerms.length === 0) return 0;` at the top of computeBM25Score (and similarly protect avgDocLength=0).


**⚪ LOW — No unit tests for ResultRanker, ResultDeduplicator, or QueryExpander; searchWeb tests are mock happy-path only**  
`tests/unit/tools/search/searchWeb.test.js:84`  
The search pipeline's load-bearing logic is untested: searchWeb.test.js has 7 mocked tests (constructor, happy path, cache hit, validation, error propagation, expand toggle) and never exercises ranking, deduplication, partial weights/thresholds, or the multi-query retry loop; there are no test files at all for ResultRanker, ResultDeduplicator, or QueryExpander (grep across tests/ finds them only in phase-regression mentions). This is exactly why the NaN-weights, partial-thresholds, and maxSourcesPerQuery>100 defects above shipped unnoticed. ResearchOrchestrator has targeted tests only for stealth fallback and search-key wiring.  
*Fix:* Add unit tests: rankResults with partial weights (finalScore finite), dedup with partial thresholds, expansion retry-count bound, and gatherInitialSources clamping limit to <=100 for large maxUrls.


### G. Agent, Stealth, Templates & Localization

> **Auditor's read:** The agent hard stops are the strongest part of this area: maxSteps/maxUrls are clamped by the orchestrator with Math.min (AgentOrchestrator.js:141-142), the ACT loop is bounded and cannot recurse, the no-LLM-key degraded path returns useful evidence, and phaseD-regressions.test.js covers all four hard-stop cases directly. The defects I found are real but mostly medium/low: a genuine timer leak in LocalizationManager.cleanup() that never clears its health-check intervals, a concurrency race in launchStealthBrowser that can orphan a headless Chromium process, and a YouTube template that throws on a non-absolute canonical URL and takes the whole tool call down with it. The dead BrowserBaseBackend code has an empty throw and a comment referencing a non-existent method. Test coverage for the templates and localization real code is thin (mocked manager, single template exercised). Nothing here is a crash-on-normal-use or a security hole, so the area is broadly sound with a few worthwhile fixes.


**🟡 MED — Health-check setInterval handles are never stored, so cleanup() can never clear them**  
`src/core/LocalizationManager.js:988`  
setupHealthChecks() (called from the constructor via initialize(), line 226) starts two setInterval timers at lines 988 and 995 but discards their handles. cleanup() at line 1500 only clears this.healthCheckInterval, which is never assigned anywhere. Scenario: server.js instantiates a singleton LocalizationManager (server.js:181); on gracefulShutdown it calls localizationManager.cleanup(), yet both intervals keep firing (every 5 min / 10 min) for the process lifetime, keeping the Node event loop alive and preventing clean exit. In tests, constructing any LocalizationManager leaves live timers that hang the runner unless --test-force-exit is used.  
*Fix:* Store the interval handles (e.g. this._proxyHealthTimer = setInterval(...); this._translationHealthTimer = setInterval(...)) and clearInterval both in cleanup(); optionally .unref() them.


**🟡 MED — launchStealthBrowser has no concurrency guard, so parallel context creation orphans a Chromium process**  
`src/core/StealthBrowserManager.js:250`  
createStealthContext (line 369-370) calls launchStealthBrowser when this.browser is null. launchStealthBrowser checks `if (this.browser) return` (line 250) then awaits chromium.launch(...) (line 351) before assigning this.browser. Scenario: two stealth_mode create_context calls interleave at the await; both see this.browser === null, both launch a Chromium browser, and the second assignment overwrites this.browser. The first browser process is now unreferenced and cleanup() (line 1844) only closes the last this.browser, leaking a headless Chromium process (with --no-sandbox) for the process lifetime.  
*Fix:* Guard the launch with a shared in-flight promise: if a launch is already pending, await it instead of starting a second chromium.launch().


**🟡 MED — youtube-video template crashes the whole extraction on a relative/protocol-relative canonical href**  
`src/tools/templates/TemplateRegistry.js:116`  
The video_id field does `new URL($('link[rel="canonical"]').attr('href') || 'https://youtube.com')`. The fallback only guards a missing attribute; when the canonical link IS present but not absolute (e.g. href="/watch?v=abc" or protocol-relative "//www.youtube.com/watch?v=abc"), new URL() throws TypeError: Invalid URL (verified via node). TemplateRegistry.run (line 300) has no try/catch around template.extract($), so the throw propagates through ScrapeTemplateTool.execute up to the server handler, which returns isError with the entire scrape_template call failed instead of returning the other successfully-extracted fields. A consent/interstitial or redirected YouTube page matching /youtube.com\/watch/ can trigger this.  
*Fix:* Wrap the URL parse in a try/catch returning null, or pass a base: new URL(href, url).searchParams.get('v').


**⚪ LOW — maxUrls is effectively unreachable at default maxSteps because both share one per-iteration counter**  
`src/core/AgentOrchestrator.js:217`  
The ACT loop increments BOTH step and urlsFetched once per URL (lines 218-219) and breaks on step>=capSteps OR urlsFetched>=capUrls. Since the two counters are always equal, the binding cap is min(capSteps, capUrls). With the tool defaults maxSteps=5 and maxUrls=10 (server.js:916-917), a caller who sets maxUrls=10 but leaves maxSteps at 5 still only fetches 5 URLs, contradicting the maxUrls="Max URLs to fetch" description. maxUrls only ever matters when it is smaller than maxSteps.  
*Fix:* Decouple the caps — e.g. only count a step per ACT iteration and gate URL fetching purely on urlsFetched — or document that effective fetches = min(maxSteps, maxUrls).


**⚪ LOW — BrowserBaseBackend.connect throws an empty Error, discarding status and response body**  
`src/core/StealthBrowserManager.js:2104`  
On a failed BrowserBase session create, line 2103 reads the error body into `err` and line 2104 does `throw new Error();` with no message — the status code and `err` body are dropped, so any caller gets a message-less error with zero diagnostics. Separately, this whole backend is dead code: resolveBrowserBackend (line 2144) is never called anywhere, and the comment at line 2019 references StealthBrowserManager.getBrowserBackend() which does not exist, so the documented graceful fallback to local Playwright is not wired. Latent, but would bite the moment the backend is connected.  
*Fix:* throw new Error(`BrowserBase session create failed: HTTP ${sessionRes.status} ${err}`); and either wire resolveBrowserBackend/getBrowserBackend or remove the unused backend + misleading comment.


**⚪ LOW — Template and localization unit tests exercise almost none of the real extraction/manager code**  
`tests/unit/tools/templates/scrapeTemplate.test.js:97`  
scrapeTemplate.test.js covers only the github-repo happy path plus generic error cases; none of the other 9 template extractors are exercised, so the youtube-video new URL crash (TemplateRegistry.js:116) and any selector-staleness in the remaining templates are untested. localization.test.js (tests/unit/tools/localization/localization.test.js) substitutes a mock manager (async cleanup(){} at line 25) instead of the real LocalizationManager, so the real configureCountry/generateTimezoneSpoof paths and the setInterval leak in setupHealthChecks are never covered.  
*Fix:* Add a table-driven test that feeds representative fixture HTML (including a relative canonical for youtube-video) through each real template extractor, and a test that constructs the real LocalizationManager and asserts cleanup() stops its timers.

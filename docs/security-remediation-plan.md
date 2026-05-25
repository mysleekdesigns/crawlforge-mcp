# CrawlForge API Key & Credit Bypass — Remediation Plan

Audit date: 2026-04-18 · Version audited: 3.0.17 · Branch: `development`

**Status (2026-04-18):** Phases 1, 2, 3 shipped in v3.0.18. Phases 4, 5, 6 deferred.

## Audit Summary

Confirmed what is **safe**:
- [x] `.env` is gitignored (`.gitignore:76`) and absent from git history.
- [x] `.env` is excluded from the published npm tarball (`package.json` `files` + `.npmignore`).
- [x] Creator-mode SHA-256 gate uses `crypto.timingSafeEqual` and a module-scoped flag (`src/core/creatorMode.js:30`).
- [x] All 20 MCP tools pass through `withAuth()` (`server.js:124-182`); credit check runs **before** execution.
- [x] `search_web` proxies user's API key to backend; credit enforcement is server-side (`src/tools/search/adapters/crawlforgeSearch.js:35-53`).

Confirmed what is **exploitable**:
- [x] ~~**CRITICAL** — `CRAWLFORGE_API_URL` env override~~ **FIXED v3.0.18 (Phase 1).**
- [x] ~~**CRITICAL** — `checkCredits` fails open when backend is unreachable~~ **FIXED v3.0.18 (Phase 2).**
- [x] ~~**HIGH** — `reportUsage` has no timeout and swallows errors silently~~ **FIXED v3.0.18 (Phase 3).**
- [ ] **HIGH** — HTTP transport mode uses the server's own stored API key for every inbound request; `x-api-key` header is advertised in the server card (`server.js:1983-1993`) but never read per-request. Any public HTTP deployment drains the deployer's credits.
- [ ] **MEDIUM** — `loadConfig` (`src/core/AuthManager.js:56-69`) only checks that `apiKey` and `userId` are truthy; hand-crafted config passes validation.
- [ ] **MEDIUM** — API key is validated once in `runSetup` and never re-validated at startup. Revoked/downgraded keys keep working as long as cache or mock is in play.

Dismissed false positives from the audit:
- Creator secret is **not** publicly leaked (one sub-agent claimed it was — they saw the local `.env` but missed that it is gitignored and not shipped).
- `batch_scrape` / `deep_research` single-charge pricing is a product decision, not a bypass.

---

## Phase 1 — Lock Down the Backend Endpoint (CRITICAL #1) — ✅ COMPLETE v3.0.18

Goal: make it impossible to point the server at a mock backend.

- [x] Add `resolveApiEndpoint()` helper that validates hostname against an allow-list (`www.crawlforge.dev`, `crawlforge.dev`, `api.crawlforge.dev`) and enforces `https://` protocol. → `src/core/endpointGuard.js`
- [x] Permit `localhost` / `127.0.0.1` / `::1` **only** when `isCreatorModeVerified()` is true.
- [x] Use the helper in `src/core/AuthManager.js:14`.
- [x] Use the helper in `src/constants/config.js:15`.
- [x] Throw a clear error at startup if the endpoint fails validation (not silently fall back).
- [x] Manual check: `CRAWLFORGE_API_URL=http://evil.example.com node server.js` exits with "Refusing to use API endpoint…". ✔ Verified.
- [x] Manual check: `CRAWLFORGE_API_URL=http://localhost:8888` exits unless creator mode is active. ✔ Verified.
- [x] Manual check: unset env var → server starts normally and hits `https://www.crawlforge.dev`. ✔ Verified.

## Phase 2 — Fail Closed on Network Errors (CRITICAL #2) — ✅ COMPLETE v3.0.18

Goal: no indefinite free use just by blocking outbound network.

- [x] Reduce `CREDIT_CHECK_INTERVAL` in `src/core/AuthManager.js:21` from `60000` to `15000`.
- [x] Replace the catch block at `src/core/AuthManager.js:207-215` with a tight fail-closed policy: only allow cache if the **last successful** verification was within 30 s AND cached credits cover the cost.
- [x] Ensure `lastSuccessfulCreditCheck` is never updated on network errors — only set in the 200-OK path (`src/core/AuthManager.js:204`).
- [x] Unit test: with no cache and network down → `checkCredits()` throws. → `tests/unit/authManager.test.js`
- [x] Unit test: cache present, last successful check > 30 s ago, network down → `checkCredits()` throws.
- [x] Unit test: cache present, last successful check < 30 s ago, network down → `checkCredits()` returns true.
- [ ] Manual check: seed cache with one real call; block `www.crawlforge.dev` via `/etc/hosts`; wait 30 s → next tool call must return "Unable to verify credits". _(Deferred to QA; covered by unit tests.)_

## Phase 3 — Harden Usage Reporting (HIGH #3) — ✅ COMPLETE v3.0.18

Goal: local cache must deplete even when the backend can't receive reports, so the user eventually hits the fail-closed check.

- [x] Add `signal: AbortSignal.timeout(5000)` to the `fetch` at `src/core/AuthManager.js:257`.
- [x] Move the `creditCache.set(userId, max(0, cached - creditsUsed))` decrement **outside** the try block so it runs regardless of network success (`src/core/AuthManager.js:234-237`).
- [x] Add a persistent pending-usage queue at `~/.crawlforge/pending-usage.json` — `_appendPendingUsage()` / `_flushPendingUsage()` (`src/core/AuthManager.js:268-340`). Size capped at 1 MB; oldest entries dropped on overflow. Replayed on `initialize()` and after any successful `reportUsage`.
- [x] Unit test: `reportUsage` with network down → local cache is decremented by the expected amount.
- [x] Unit test: queued payloads are flushed the next time a successful report goes through.
- [ ] Manual check: allow credit reads, block only `POST /api/v1/usage` → after N tool calls (where N × cost = initial cache), next call must return "Insufficient credits" via the Phase 2 fail-closed path. _(Deferred to QA; covered by unit tests.)_

## Phase 4 — Fix HTTP Transport Multi-Tenant Auth (HIGH #4) — ⏸ DEFERRED

_Awaiting Track A vs Track B decision. See `docs/security-patch-v3.0.18.md` for deployment guidance in the meantime: do not expose `--http` mode publicly._


Goal: a public `--http` deployment cannot be used by anyone other than the authenticated caller.

Pick one track:

**Track A (recommended — fast, single-tenant gate):**
- [ ] In `server.js:1938-2007`, refuse to start HTTP mode unless `CRAWLFORGE_HTTP_SINGLE_USER=true`.
- [ ] Log a loud warning at startup: "HTTP mode runs as single-user using server's stored API key. Set CRAWLFORGE_HTTP_SINGLE_USER=true to acknowledge."
- [ ] Update `README.md` to document that HTTP mode is single-tenant only.
- [ ] Remove the `x-api-key` configSchema advertisement at `server.js:1990` (currently misleading).

**Track B (correct — required for Smithery / public gateways, larger change):**
- [ ] Refactor `AuthManager` from singleton to request-scoped: `validateApiKey(key)`, `checkCredits(cost, key)`, `reportUsage(tool, cost, key, …)`.
- [ ] In the HTTP handler, extract `req.headers['x-api-key']` before routing to the MCP transport.
- [ ] Return HTTP 401 when the header is missing.
- [ ] Validate the key once per request (or cache per-key for the `CREDIT_CHECK_INTERVAL` window).
- [ ] Thread the key through the tool context so `withAuth` uses the request's key, not a singleton.
- [ ] Add integration test: two different API keys hitting the same server get independently billed.
- [ ] Manual check: a request without `x-api-key` returns 401; requests with distinct keys draw from distinct credit pools.

Decision required from you: **which track?** Track A is correct for local/desktop use; Track B is required if you intend HTTP mode for Smithery or any multi-user deployment.

## Phase 5 — Re-Validate API Key on Startup (MEDIUM #5, #6) — ⏸ DEFERRED

Goal: revoked/downgraded keys stop working on the next server restart.

- [ ] After `AuthManager.loadConfig()` succeeds (`src/core/AuthManager.js:44-50`), call `validateApiKey(this.config.apiKey)`.
- [ ] On 401 / "invalid key" response, wipe `this.config` and print the setup prompt.
- [ ] On transient network error, allow startup but record a `lastValidatedAt` timestamp in `~/.crawlforge/config.json` and refuse to start if the timestamp is > 30 days old.
- [ ] Manual check: replace `~/.crawlforge/config.json` with `{"apiKey":"fake","userId":"fake","lastValidatedAt":"2026-04-18T00:00:00Z"}` → server refuses to start.
- [ ] Manual check: revoke a real key on the backend → restart server → server prints setup prompt instead of accepting tool calls.

## Phase 6 — Defense in Depth for Local Config (LOW) — ⏸ DEFERRED (requires backend change)

Goal: hand-crafted `config.json` files can't be used even if an attacker finds a way to pair them with a reachable mock.

- [ ] On successful `validateApiKey`, have the backend return an HMAC over `{apiKey, userId, email, issuedAt}` (backend change required — flag for backend team).
- [ ] Store the HMAC in `~/.crawlforge/config.json`.
- [ ] `loadConfig` verifies the HMAC before trusting the file; fail hard if missing or invalid.
- [ ] Bump config `version` field and write a one-time migration path for existing users.
- [ ] Manual check: edit `apiKey` or `userId` in `config.json` without re-running setup → server refuses to start with "Config tampered".

## Phase 7 — Verification & Release

- [x] All unit tests from phases 2/3 pass. (`npm run test:unit` — 14/14 passing)
- [x] `npm test` (MCP protocol compliance) passes (pre-existing 60 % success rate, 0 errors — no regressions).
- [ ] `node test-tools.js` passes against the real backend with a valid key. _(requires live backend — run manually before release)_
- [ ] `node test-real-world.js` passes. _(requires live backend)_
- [x] Re-run exploit reproductions from phases 1–3 — endpoint rejection verified manually for evil host and localhost-without-creator-mode.
- [x] Add new security-patch doc `docs/security-patch-v3.0.18.md`.
- [x] Update `docs/PRODUCTION_READINESS.md`.
- [x] Update root `PRD.md`.
- [x] Bump version to `3.0.18`.
- [x] Entry in `CHANGELOG.md` under "Security".
- [x] Add `npm run test:unit` script (runs with `CRAWLFORGE_CREATOR_SECRET=` to disable creator mode).
- [ ] Commit to `development`, open PR to `main`. _(pending user approval)_

## Open Questions for You

- [ ] **Phase 4 track:** A (gate HTTP mode) or B (per-request auth refactor)? _(still open)_
- [ ] **Phase 6 backend HMAC:** can the backend be updated to return a config HMAC, or should Phase 6 be deferred? _(still open)_
- [x] ~~**Grace window length**~~ — **30 s confirmed** by user on 2026-04-18.

## Critical Files Index

| File | Lines | Touched By |
|---|---|---|
| `src/core/AuthManager.js` | 13 | Phase 1 |
| `src/core/AuthManager.js` | 18 | Phase 2 |
| `src/core/AuthManager.js` | 44-50 | Phase 5 |
| `src/core/AuthManager.js` | 56-69 | Phase 6 |
| `src/core/AuthManager.js` | 74-90 | Phase 6 |
| `src/core/AuthManager.js` | 197-210 | Phase 2 |
| `src/core/AuthManager.js` | 237-254 | Phase 3 |
| `src/constants/config.js` | 14 | Phase 1 |
| `server.js` | 1938-2007 | Phase 4 |
| `server.js` | 1983-1993 | Phase 4 (Track A removes; Track B consumes) |

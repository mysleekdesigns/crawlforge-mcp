# Security Patch v3.0.18 — API Key & Credit Bypass Remediation

**Date:** 2026-04-18
**Prior version:** 3.0.17
**Audit reference:** `crawlforge-api-update.md`

---

## Scope

This patch addresses the three highest-severity vulnerabilities identified in the 2026-04-18 audit of v3.0.17: an unvalidated backend endpoint override (V1), a fail-open credit cache (V2), and silent usage-report swallowing that allows indefinite free use by blocking only the reporting endpoint (V3). Together these constitute the CRITICAL + HIGH bundle shipped as v3.0.18. Phases 4 (HTTP transport multi-tenant auth), 5 (startup key re-validation), and 6 (config HMAC integrity) are explicitly deferred pending a Track A/B decision from the operator and a backend change, respectively.

---

## Vulnerabilities Addressed

### V1 — Unvalidated API Endpoint (CRITICAL)

- **CWE:** CWE-20 (Improper Input Validation), CWE-346 (Origin Validation Error)
- **Attack vector:** An attacker sets `CRAWLFORGE_API_URL=http://localhost:8888` to point the server at a mock backend they control. The mock returns an arbitrarily large fake credit balance on every `GET /api/v1/credits` call and silently discards all `POST /api/v1/usage` reports, granting unlimited free tool execution.
- **Affected code (pre-patch):** `src/core/AuthManager.js` line 13 — raw `process.env.CRAWLFORGE_API_URL` passed directly to `this.apiEndpoint` without any host or protocol check. `src/constants/config.js` line 14 — duplicated the same unvalidated read, allowing the two values to drift.
- **Mitigation (Phase 1):** New `src/core/endpointGuard.js` exports `resolveApiEndpoint(rawUrl)` and `ALLOWED_HOSTS`. The function parses the URL with the `URL` global, rejects any non-`https:` protocol, and rejects any hostname not in the allow-list (`www.crawlforge.dev`, `crawlforge.dev`, `api.crawlforge.dev`). Localhost hostnames (`localhost`, `127.0.0.1`, `::1`) are permitted only when `isCreatorModeVerified()` returns `true` at call time. On any rejection the function throws `Error('Refusing to use API endpoint "<url>" — not in allow-list')` immediately — there is no silent fallback. Both `AuthManager.js` line 15 and `src/constants/config.js` line 14 now call `resolveApiEndpoint` so the two reads are guaranteed to share the same validation logic.
- **Residual risk:** DNS hijacking of an approved hostname is out of scope for this patch; the existing TLS certificate validation in Node's `fetch` implementation is the mitigating control. HTTP downgrade via a misconfigured proxy is not addressed here.

---

### V2 — Fail-Open Credit Check (CRITICAL)

- **CWE:** CWE-636 (Not Failing Securely)
- **Attack vector:** An attacker seeds the local credit cache with one legitimate backend call to populate `creditCache` with a positive balance. They then block all outbound traffic to `www.crawlforge.dev`. Every subsequent call to `checkCredits` enters the catch branch, finds a cached value, and returns `true` indefinitely — granting unlimited tool use without any further network contact.
- **Affected code (pre-patch):** `src/core/AuthManager.js` lines 197–210 — the catch branch returned `true` on any cached value regardless of how stale it was. `CREDIT_CHECK_INTERVAL` was 60 000 ms, meaning a successful check within the last minute bypassed a live fetch entirely.
- **Mitigation (Phase 2):** `CREDIT_CHECK_INTERVAL` reduced from 60 000 ms to 15 000 ms (line 22). A new per-user `lastSuccessfulCreditCheck` Map (keyed by `userId`) is updated only inside the successful fetch branch, never in the catch. The catch branch (lines 208–215) now grants a cached `true` only when both conditions are met simultaneously: `Date.now() - lastSuccessfulCreditCheck < 30_000` AND `cached >= estimatedCredits`. If either condition fails, the existing `'Unable to verify credits'` error is thrown.
- **Residual risk:** Within the 30-second grace window, a user suffering a genuine network outage can still consume credits already in the local cache. This is an accepted availability tradeoff. An attacker who blocks the network and then acts within 30 seconds of the last successful check will succeed; the window is intentionally narrow to bound this exposure.

---

### V3 — Silent Usage-Report Drop (HIGH)

- **CWE:** CWE-460 (Improper Cleanup on Thrown Exception), CWE-1188 (Insecure Default Initialization)
- **Attack vector:** An attacker blocks only `POST /api/v1/usage` while allowing `GET /api/v1/credits` through. Because `reportUsage` was a fire-and-swallow call (no timeout, cache decrement only on success), blocking usage reporting caused the local cache to never deplete. This interacts with V2: when `GET /api/v1/credits` is subsequently blocked too, the attacker has an arbitrary positive cache balance and unlimited use.
- **Affected code (pre-patch):** `src/core/AuthManager.js` lines 237–254 — no `AbortSignal.timeout`, `creditCache.set` inside the try block so it only ran on successful fetch, no retry queue for failed payloads.
- **Mitigation (Phase 3):**
  - `signal: AbortSignal.timeout(5000)` added to the `POST /api/v1/usage` fetch (line 258), preventing the request from hanging indefinitely.
  - `creditCache.set(userId, Math.max(0, cached - creditsUsed))` moved **outside** the try block to lines 235–238, so the local cache decrements regardless of whether the network call succeeds or throws.
  - A persistent pending-usage queue at `~/.crawlforge/pending-usage.json` stores failed payloads (fields: `toolName`, `creditsUsed`, `userId`, `timestamp`). The file is written with mode `0o600` matching the existing `saveConfig` convention. Entries are capped at 1 MB by dropping the oldest records. Failed payloads are replayed via `_flushPendingUsage()` on the next successful `reportUsage` and on `AuthManager.initialize()`.
- **Residual risk:** The pending-usage queue file is written to `~/.crawlforge/`. An attacker with filesystem write access to that path can delete the file to discard queued usage records. However, at that privilege level the attacker already has access to `~/.crawlforge/config.json` containing the API key itself, so the incremental risk is low. The Phase 3 mitigation is primarily effective against remote/network-level attacks.

---

## Known Residual Vulnerabilities (Deferred)

### V4 — HTTP Transport Multi-Tenant Auth (HIGH, Phase 4 — deferred)

The `--http` transport mode (`server.js` lines 1938–2007) uses the server's own stored API key for every inbound request. The `x-api-key` header is advertised in the server capability card (`server.js` lines 1983–1993) but is never read per-request. Any operator who exposes the HTTP transport publicly will have their own credits consumed by arbitrary callers.

**Deployment guidance until fixed:** Do not expose the HTTP transport on a public network interface. Use it exclusively for single-user local access (loopback only). A Track A/B architectural decision is required before this can be patched:
- Track A: refuse to start HTTP mode without `CRAWLFORGE_HTTP_SINGLE_USER=true`, document it as explicitly single-tenant.
- Track B: refactor `AuthManager` from singleton to request-scoped, extract `x-api-key` per HTTP request, return HTTP 401 when absent.

Track B is required for Smithery or any multi-user gateway deployment. The decision is pending operator input.

---

### V5 — API Key Never Re-Validated at Startup (MEDIUM, Phase 5 — deferred)

`AuthManager.initialize()` calls `loadConfig()` but does not call `validateApiKey()` against the live backend. A revoked or downgraded key loaded from `~/.crawlforge/config.json` will continue to pass `isAuthenticated()` checks until the user re-runs setup. Remediation depends on the Phase 4 refactor direction (singleton vs. request-scoped `AuthManager`) and requires a `lastValidatedAt` timestamp in `config.json` with a configurable staleness threshold.

---

### V6 — No Config Integrity Check (MEDIUM, Phase 6 — deferred)

`loadConfig()` validates only that `apiKey` and `userId` are truthy strings. A hand-crafted `~/.crawlforge/config.json` passes all checks. Proper remediation requires the backend to return an HMAC over `{apiKey, userId, email, issuedAt}` at validation time, stored in `config.json` and verified on every load. This is a backend change and is out of scope for this client-side repository patch.

---

## Verification Checklist

Items transcribed from the Phase 1, 2, and 3 "Manual check" requirements in `crawlforge-api-update.md`.

### Phase 1 — Endpoint Lockdown

- [ ] `CRAWLFORGE_API_URL=http://evil.example.com node server.js` exits immediately with `Refusing to use API endpoint "http://evil.example.com" — not in allow-list`.
- [ ] `CRAWLFORGE_API_URL=http://localhost:8888 node server.js` (no creator secret set) exits immediately with the allow-list rejection error.
- [ ] Starting the server with `CRAWLFORGE_API_URL` unset (or set to `https://www.crawlforge.dev`) starts normally and contacts `https://www.crawlforge.dev`.

### Phase 2 — Fail-Closed Credit Check

- [ ] Seed the credit cache with one real backend call; block `www.crawlforge.dev` via `/etc/hosts` (or equivalent network rule); wait more than 30 seconds; the next tool call returns `Unable to verify credits. Please check your connection and try again.`
- [ ] Unit test passes: `checkCredits()` with no cache and network mocked to throw → throws.
- [ ] Unit test passes: cache present, `lastSuccessfulCreditCheck` > 30 s ago, network throws → throws.
- [ ] Unit test passes: cache present, `lastSuccessfulCreditCheck` < 30 s ago, network throws → returns `true`.

### Phase 3 — Usage Reporting Hardening

- [ ] Allow credit reads (`GET /api/v1/credits`), block only `POST /api/v1/usage`; execute N tool calls where `N × toolCost = initial cached credit balance`; the (N+1)th call must return `Unable to verify credits` via the Phase 2 fail-closed path.
- [ ] Unit test passes: `reportUsage()` with `fetch` rejected → local `creditCache` is decremented by the expected amount.
- [ ] Unit test passes: a payload queued to `pending-usage.json` after a failed `reportUsage` is flushed (sent and removed) on the next successful `reportUsage` call.

---

## Review Sign-Off

Left blank — to be filled by the reviewer during PR.

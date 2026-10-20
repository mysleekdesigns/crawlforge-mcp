---
paths:
  - "src/utils/ssrfGuard.js"
  - "src/utils/ssrfProtection.js"
  - "src/utils/hostBlocklist.js"
  - "src/utils/robots*.js"
  - "src/utils/webBotAuth.js"
  - "src/core/endpointGuard.js"
  - "src/core/ActionExecutor.js"
  - "src/core/ElicitationHelper.js"
  - "scripts/generate-signing-key.mjs"
  - "scripts/verify-web-bot-auth.mjs"
---

# Security guards

Full reference: `docs/sandboxing-and-approvals.md`.

- **SSRF** (`ssrfGuard.js` enforcing `ssrfProtection.js`): an undici dispatcher whose connect-time `lookup` validates every connection — the first request and each redirect hop — and pins the validated IP, closing the DNS-rebinding window. Default blocks loopback, link-local/cloud metadata (169.254.169.254) and 0.0.0.0; `SSRF_STRICT=true` adds RFC1918/ULA. Kill switch `SSRF_PROTECTION_ENABLED=false`; `ALLOWED_DOMAINS` is an allowlist bypass. http/https only; dangerous ports and path traversal are still rejected by `ssrfProtection.js`. Every read-scrape site goes through `ssrfGuard()`/`safeFetch()` — never call `fetch` directly on a user URL. Every browser context (Chromium, stealth, Camoufox, browser_session) gets its proxy from `guardedProxyFor()` (`src/core/browser/guardedProxy.js`): a local forward proxy that runs `assertUrlAllowed` and connects with `ssrfLookup` on every connection, chaining to any upstream proxy. `page.route` does not see redirect hops or WebSockets, so never rely on it for SSRF.
- **endpointGuard**: hard allowlist `{crawlforge.dev, www.crawlforge.dev, api.crawlforge.dev}` for the server's own backend calls; HTTPS required; fail-closed. Localhost only in creator mode.
- **Action allowlist** (`ActionExecutor.js`): the action schema accepts only `wait`, `click`, `type`, `press`, `scroll`, `screenshot`, `select`, `check`, `hover`, `navigate`, `snapshot` and `executeJavaScript`; `executeJavaScript` throws unless `ALLOW_JAVASCRIPT_EXECUTION=true` at deploy time.
- **Elicitation** (`ElicitationHelper.js`): asks the user before `deep_research` (>50 URLs), sync `batch_scrape` (>25 URLs), `crawl_deep` (projected >500 pages), `extract_structured` (>3 required fields, no LLM) and low credits. Fails open if the client lacks elicitation.
- **Robots / opt-out**: `RESPECT_ROBOTS_TXT=true`, `ROBOTS_CACHE_TTL_MS`; `CRAWLFORGE_BLOCKED_HOSTS` (comma-separated) extends the permanent opt-out blocklist.
- **Web Bot Auth** (off by default; requests go out unsigned when unset): `CRAWLFORGE_SIGNING_KEY` is an Ed25519 PKCS#8 PEM or its base64 — a secret, never committed. `WEB_BOT_AUTH_DIRECTORY` (`https://www.crawlforge.dev`) is advertised in `Signature-Agent`. Generate with `node scripts/generate-signing-key.mjs` and publish the public half before setting the private one; rotation and compromise response are in `docs/policy/KEY_ROTATION.md`.

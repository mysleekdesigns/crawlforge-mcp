# Sandboxing & Approvals

**Version:** 4.4.0
**Last updated:** 2026-10-20
**Audience:** Operators, security reviewers, and integrators evaluating CrawlForge for production deployment.

---

## TL;DR

CrawlForge enforces three layers of protection:

1. **Network sandboxing** — every scraped URL passes SSRF validation before the request is sent; the server's own backend calls are locked to a hard allow-list of CrawlForge.dev hosts.
2. **Browser sandboxing** — standard pool retains OS sandbox; stealth Chromium drops it deliberately (explained below); per-request context isolation ensures cookies and storage never bleed across calls.
3. **User approvals** — four tools use MCP Elicitation to request confirmation before running expensive operations; JavaScript execution inside `scrape_with_actions` requires a deploy-time opt-in env var.

---

## Network Sandboxing

### Inbound — every scraped URL

Source: `src/utils/ssrfGuard.js` (the IP ranges for strict mode live in `src/utils/ssrfProtection.js`)

Every scrape target goes through `ssrfGuard()` / `safeFetch()` (fetch path) or `assertUrlAllowed()` / `safeGoto()` (browser path). The checks are:

**Pre-flight, on the URL** (`preflightHostCheck`):
- Protocol must be `http:` or `https:`.
- `ALLOWED_DOMAINS` (exact host or any subdomain) skips every check below.
- Cloud metadata hostnames are refused: `metadata.google.internal`, `metadata.azure.com`, `metadata`.
- `BLOCKED_DOMAINS` (exact host or any subdomain) is refused. Default: `localhost`, `127.0.0.1`, `0.0.0.0`, `metadata.google.internal`, `169.254.169.254`, `metadata.azure.com`.
- An IP-literal host is checked against the blocked ranges below.

**At connect time, on every connection** (`ssrfLookup` + `guardedConnect`): the hostname is resolved, every answer is checked, and the connection goes to the address that was checked. This covers the first request and each redirect hop, and closes the DNS-rebinding window: there is no cache to outlive.

**Blocked ranges** depend on the mode:
- **Default (Stage 1):** loopback (`127.0.0.0/8`, `::1`), the unspecified addresses (`0.0.0.0/8`, `::`), and link-local and cloud metadata (`169.254.0.0/16`, `fe80::/10`). Private networks (RFC1918, IPv6 ULA) are **allowed**. On a user's own machine the server acts for that user, and reading a router page, a NAS or an intranet site on the LAN is a legitimate use.
- **`SSRF_STRICT=true`:** adds RFC1918 (`10/8`, `172.16/12`, `192.168/16`), CGNAT (`100.64/10`), benchmark (`198.18/15`), multicast, reserved, IPv6 ULA (`fc00::/7`), IPv6 multicast, IPv4-compatible (`::/96`) and NAT64 (`64:ff9b::/96`). Set it when an agent reads untrusted pages and should not be able to reach the LAN, and whenever the server is shared. The hosted deployment runs strict.

IPv4-mapped IPv6 literals (`::ffff:127.0.0.1`) are reduced to their IPv4 address before the check. `SSRF_PROTECTION_ENABLED=false` turns the whole guard off.

**Browser tools:** every browser context (Chromium, stealth Chromium, Camoufox, `browser_session`) uses a local forward proxy, `guardedProxyFor()` in `src/core/browser/guardedProxy.js`. It runs the same pre-flight and connect-time lookup on every connection the page makes: navigations, redirect hops, iframes, subresources, fetch/XHR and WebSockets. A refused connection gets a 403. A caller's upstream proxy is chained behind it, and the target is still checked locally first. `page.route` is not used for this, because it never sees redirect hops or WebSockets.

Not enforced on the live path: ports, path-traversal patterns and the hostname patterns (`admin*`, `consul*`, `*.internal`, ...) in `SSRFProtection.validateURL()`. Nothing calls that method.

### Local files — `process_document`

Source: `src/utils/localFilePolicy.js`

`sourceType` `file` and `pdf_file` read from disk. When the server is served to a network they are refused outright. Locally, a path is judged by its realpath, so a symlink counts as its target:
- Only `.pdf`, `.docx`, `.txt`, `.md`, `.html` and `.htm` files are read.
- Nothing inside a dot-directory (`~/.ssh`, `~/.aws`, `~/.config`, `~/.crawlforge`, ...) is read.
- `CRAWLFORGE_ALLOWED_DIRS` (directories separated by `:`, or `;` on Windows) limits reads to those directories. Inside them the dot-directory rule is lifted; the extension rule still applies.

The point is prompt injection: a page an agent reads can ask it to read a local file, such as the CrawlForge config that holds the API key.

### Outbound — server's own backend

Source: `src/core/endpointGuard.js`

When the server calls its own backend (auth validation, credit checks, usage reports, search proxy), the target URL is passed through `resolveApiEndpoint()` before every call.

Allow-list: `['www.crawlforge.dev', 'crawlforge.dev', 'api.crawlforge.dev']`

Rules:
- Protocol must be `https:` — any non-HTTPS URL is rejected.
- Hostname must be in the allow-list exactly — no subdomain wildcards.
- `localhost` / `127.0.0.1` / `::1` are allowed only if `isCreatorModeVerified()` returns true (i.e., the `CRAWLFORGE_CREATOR_SECRET` env var matches the expected hash).
- Any other URL throws immediately (fail-closed).

Motivation (v3.0.18): a misconfigured or injected `CRAWLFORGE_API_URL` env var could have redirected usage reports to an attacker-controlled host. The guard eliminates that exfiltration vector regardless of the env var value.

---

## Browser Sandboxing

### Standard browser pool

Playwright Chromium in the standard pool runs with the default OS sandbox intact. The pool (`src/core/BrowserContextPool.js`) creates a fresh browser context per request — separate cookies, storage, and service workers — so one request cannot read session data from a concurrent or prior request.

### Stealth browser pool

Source: `src/core/StealthBrowserManager.js`, `_doLaunchStealthBrowser()`

The stealth pool launches Chromium with `--no-sandbox`.

**Why**: fingerprint evasion requires controlling canvas rendering, WebGL, and font enumeration at a low level. The Playwright Chromium distribution does not expose these hooks under the OS sandbox in most container environments. Disabling the sandbox is a deliberate trade-off to enable anti-detection.

**`--disable-web-security` is gone from this browser** (2026-09-21). It used to stand beside `--no-sandbox` here and bought the stealth layer nothing: every script it applies goes through `addInitScript`/`evaluate`, which need no same-origin bypass. What it did buy was a tell — a page reads it in one line, with a cross-origin `fetch()` that should throw and does not — and it contradicted this pool's own decision to leave `bypassCSP` unset. It left together with four flags Playwright passes by default (`--disable-component-update`, `--disable-default-apps`, `--disable-extensions`, `--disable-popup-blocking`), which are now named in `ignoreDefaultArgs` so they are off the command line rather than merely absent from our own args.

Only the stealth Chromium lost the flag. The non-stealth render browser behind `extract_content`, `process_document` and `scrape_with_actions` (`src/core/processing/BrowserProcessor.js`) still launches with `--no-sandbox` and `--disable-web-security`.

**Mitigation**: stealth scraping is an explicit operator choice (`stealth_mode` tool); it does not activate for standard scrapes. Camoufox (Firefox-based, added in v4.0.0, `engine: "camoufox"`) is available as an alternative that achieves fingerprint evasion without disabling the OS sandbox. See `docs/stealth-engines.md`.

**Context isolation**: even in stealth mode, the per-request context isolation from `BrowserContextPool` applies.

**Known limitation**: `--no-sandbox` is a real reduction in browser security. If you are scraping attacker-controlled content at scale in stealth mode, prefer Camoufox or isolate the stealth process with OS-level container boundaries.

---

## Action Allowlist (scrape_with_actions)

Source: `src/core/ActionExecutor.js`, lines 75–90

`scrape_with_actions` executes an ordered list of browser actions. The action type is validated against a strict union schema before any action runs:

| Permitted action | Description |
|------------------|-------------|
| `wait` | Pause execution for a specified duration or selector |
| `click` | Click a DOM element |
| `type` | Type text into a field |
| `press` | Press a keyboard key |
| `scroll` | Scroll the viewport |
| `screenshot` | Capture a screenshot (stored as `crawlforge://screenshot/{actionId}` resource) |
| `executeJavaScript` | Run a JavaScript snippet — **disabled by default** (see below) |

No download, file-write, `goto`/`navigate`, new-tab, or cross-origin navigation primitives exist in the schema. Passing any other `type` value fails Zod validation before the action runs.

### executeJavaScript gate

Source: `src/core/ActionExecutor.js`, lines 669–680

`executeJavaScript` throws unconditionally unless the env var `ALLOW_JAVASCRIPT_EXECUTION=true` is set at deploy time. This is a deploy-time opt-in, not a per-call parameter. The decision was made at the operator level, not the caller level.

When enabled, a console warning is emitted on every invocation. The script runs via `page.evaluate()` with args passed as-is — it has full access to the page context.

**Recommendation**: do not enable `ALLOW_JAVASCRIPT_EXECUTION=true` in production deployments unless you control and trust all callers.

---

## User Approvals (MCP Elicitation)

Source: `src/core/ElicitationHelper.js`

### How it works

`ElicitationHelper.confirm()` calls `server.elicit()` with a human-readable message and a boolean `confirmed` schema. If the user confirms, the tool proceeds. If the user declines, the operation is cancelled.

**Fail-open**: if the connected MCP client does not support the elicitation protocol, `confirm()` logs a warning and returns `true` — the tool proceeds without confirmation. This ensures compatibility with clients that predate the MCP Elicitation spec (2025-11-25).

**Capability advertisement**: the server does not currently declare `elicitation` in its MCP capabilities block. Elicitation is wired and functional when the client supports it, but clients that rely on capabilities discovery to detect elicitation support will not see it advertised. This is a known gap.

### Trigger conditions

| Tool | Condition | What is elicited |
|------|-----------|-----------------|
| `deep_research` | `maxUrls > 50` | Confirmation to proceed with large research run |
| `batch_scrape` | `mode === 'sync'` and `urls.length > 25` | Confirmation before synchronous batch of >25 URLs |
| `crawl_deep` | Projected page count > 500 | Confirmation before large crawl |
| `extract_structured` | Schema has >3 required fields and no LLM is configured | Confirmation that CSS-fallback extraction will be used |
| `AuthManager` (credit-low) | Remaining credits < projected tool cost | Confirmation to spend remaining credits |

### What is NOT elicited

`scrape_with_actions` and `stealth_mode` do not elicit per-invocation confirmation. The action allowlist, the `executeJavaScript` env-var gate, and the credit gate are the guardrails for those tools. Adding per-invocation elicitation to every browser automation call would make those tools unusable in automated pipelines.

---

## Credit Gating

Source: `src/server/withAuth.js`

Every tool registration in `server.js` wraps the handler with `withAuth(toolName, handler)`. This wrapper:

1. Checks the authenticated user's credit balance against the projected cost for that tool before execution.
2. Deducts credits on successful completion.
3. Charges nothing on error: an `isError` result, a JSON body with `success: false`, or a throw.
4. In creator mode (`CRAWLFORGE_CREATOR_SECRET` verified), skips credit checks entirely.

The credit check is fail-closed since v3.0.18: insufficient credits stop the tool before any network request is made.

---

## Crawl and Rate Limits

| Limit | Default | Config |
|-------|---------|--------|
| Rate limit | 10 req/sec per domain | `RATE_LIMIT_REQUESTS_PER_SECOND=10` |
| Max crawl depth | 5 | `MAX_CRAWL_DEPTH=5` |
| Max pages per crawl | 100 (schema max: 1,000) | `MAX_PAGES_PER_CRAWL=100` |
| Max content per crawled page | unlimited (caller-specified via `content_max_length`) | `content_max_length` param on `crawl_deep`; response includes `truncated: true` when applied |
| Max concurrent requests | 10 | `MAX_WORKERS=10` / `QUEUE_CONCURRENCY=10` |

**robots.txt**: respected when `respect_robots: true` is passed to `crawl_deep` or when `RESPECT_ROBOTS_TXT=true` is set globally. Behavior is **fail-open**: if `robots.txt` is missing or unreachable, the server assumes all paths are allowed and proceeds with the crawl. This is intentional for resilience but means the server will crawl pages a stricter client would skip.

---

## Known Limitations / Honest Gaps

The following are documented limitations, not planned fixes:

- **SSRF is blocklist-based**: there is no per-deployment outbound allowlist for scraped targets (`ALLOWED_DOMAINS` is a bypass list, not a restriction). Anything outside the blocked ranges is reachable, and in the default Stage-1 mode that includes the local network; set `SSRF_STRICT=true` to refuse it.
- **The browser SSRF proxy has no authentication**: any process on the same host can use the 127.0.0.1 listener. It still enforces the SSRF policy, but it would relay through a configured upstream proxy with that proxy's stored credentials. This only matters on multi-user hosts.
- **Stealth Chromium uses `--no-sandbox`**: this is a real sandbox reduction. Use Camoufox or OS-level container isolation if scraping untrusted content at scale. The non-stealth render browser (`BrowserProcessor`) runs with `--no-sandbox` and `--disable-web-security`; only the stealth browser dropped the second flag.
- **robots.txt is fail-open**: a missing or unreachable `robots.txt` is treated as "allow all". This is a deliberate resilience choice, not a compliance guarantee.
- **No per-action elicitation in `scrape_with_actions`**: the tool accepts entire action chains without mid-chain confirmation. The action allowlist and JS env-var gate are the only per-action controls.
- **Elicitation capability not advertised**: the server wires elicitation but does not declare it in the MCP capabilities block. Clients that gate on capability discovery will not trigger the elicitation flow.

---

## Threat Model

CrawlForge is designed to be a **credit-protected, SSRF-hardened, reasonable-default web scraping service**. It is not a hostile-input sandbox or a general-purpose code execution environment.

What it is designed to defend against:
- SSRF attacks via crafted URLs targeting internal infrastructure
- Server-side exfiltration via a spoofed `CRAWLFORGE_API_URL`
- Runaway resource consumption via rate limits, depth caps, and credit gating
- Accidental JavaScript execution by tools that do not intend to run arbitrary code

What it is not designed to defend against:
- A compromised or malicious MCP client that sends valid but harmful action chains within the allowlist
- Content-level attacks (XSS payloads, malicious PDFs) — the server processes content for extraction, not for safe rendering
- High-volume adversarial scraping of attacker-controlled sites specifically designed to exploit the browser engine

For higher-assurance deployments, run the server inside a container with a restrictive network policy, disable `ALLOW_JAVASCRIPT_EXECUTION`, and use Camoufox instead of stealth Chromium.

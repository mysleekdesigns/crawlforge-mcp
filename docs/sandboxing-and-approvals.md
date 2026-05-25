# Sandboxing & Approvals

**Version:** 4.2.2
**Last updated:** 2026-05-25
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

Source: `src/utils/ssrfProtection.js`

All URLs submitted for scraping are validated by `SSRFProtection.validateURL()` before any HTTP request is made. The checks run in order:

**Protocol**: only `http:` and `https:` are permitted. All other schemes are rejected with HIGH severity.

**Hostname blocklist**: the following are blocked outright:
- Exact names: `localhost`, `metadata.google.internal`, `metadata.azure.com`, `metadata`, `consul`, `vault`
- Pattern matches: hostnames starting with `metadata`, `consul`, `vault`, `admin`, `internal`; hostnames ending in `.local` or `.internal`

**Port blocklist**: the following ports are blocked regardless of hostname:
22 (SSH), 23 (Telnet), 25 (SMTP), 53 (DNS), 135 (RPC), 139 (NetBIOS), 445 (SMB), 1433 (MSSQL), 1521 (Oracle), 3306 (MySQL), 3389 (RDP), 5432 (PostgreSQL), 5984 (CouchDB), 6379 (Redis), 8086 (InfluxDB), 9200/9300 (Elasticsearch), 27017 (MongoDB).

**DNS resolution + IP validation**: the hostname is resolved to an IP and checked against blocked CIDR ranges:
- `127.0.0.0/8` (loopback), `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC1918 private)
- `169.254.0.0/16` (IPv4 link-local), `100.64.0.0/10` (CGNAT), `198.18.0.0/15` (benchmark), `224.0.0.0/4` (multicast), `240.0.0.0/4` (reserved)
- `::1/128` (IPv6 loopback), `fc00::/7` (IPv6 ULA), `fe80::/10` (IPv6 link-local), `ff00::/8` (IPv6 multicast)

DNS results are cached for 5 minutes (LRU, max 10,000 entries).

**Path traversal**: `checkRawPathTraversal()` scans the raw URL string before URL-parsing for `../`, `..\`, and their URL-encoded variants (`%2e%2e%2f`, `%2e%2e%5c`, `%2e%2e`, `..%2f`, `..%5c`). Violations are HIGH severity.

**Path pattern check**: parsed path is also scanned for `/etc/`, `/proc/`, `/sys/`, `/dev/`, `/tmp/`, `/var/log`. Violations are MEDIUM severity (do not block alone).

**Redirects**: handled manually via `redirect: 'manual'`. Each redirect location is re-validated through the full chain above. Capped at 5 hops; exceeding the cap throws.

**Known limitation**: SSRF protection is blocklist-based. There is no operator-configurable outbound allowlist for scraped targets. An attacker who can register a public hostname that resolves to a previously unblocked private IP range after the DNS cache cools could bypass the check (DNS rebinding). The 5-minute cache window limits exposure.

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

Source: `src/core/StealthBrowserManager.js`, line ~246

The stealth pool launches Chromium with `--no-sandbox` and `--disable-web-security`.

**Why**: fingerprint evasion requires controlling canvas rendering, WebGL, and font enumeration at a low level. The Playwright Chromium distribution does not expose these hooks under the OS sandbox in most container environments. Disabling the sandbox is a deliberate trade-off to enable anti-detection.

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
3. Deducts half credits on error (partial work may have been done).
4. In creator mode (`CRAWLFORGE_CREATOR_SECRET` verified), skips credit checks entirely.

The credit check is fail-closed since v3.0.18: insufficient credits stop the tool before any network request is made.

---

## Crawl and Rate Limits

| Limit | Default | Config |
|-------|---------|--------|
| Rate limit | 10 req/sec per domain | `RATE_LIMIT_REQUESTS_PER_SECOND=10` |
| Max crawl depth | 5 | `MAX_CRAWL_DEPTH=5` |
| Max pages per crawl | 100 (schema max: 1,000) | `MAX_PAGES_PER_CRAWL=100` |
| Max concurrent requests | 10 | `MAX_WORKERS=10` / `QUEUE_CONCURRENCY=10` |

**robots.txt**: respected when `respect_robots: true` is passed to `crawl_deep` or when `RESPECT_ROBOTS_TXT=true` is set globally. Behavior is **fail-open**: if `robots.txt` is missing or unreachable, the server assumes all paths are allowed and proceeds with the crawl. This is intentional for resilience but means the server will crawl pages a stricter client would skip.

---

## Known Limitations / Honest Gaps

The following are documented limitations, not planned fixes:

- **SSRF is blocklist-based**: there is no per-deployment outbound allowlist for scraped targets. A previously unknown private range or a DNS rebinding attack after the 5-minute cache window could bypass the check.
- **Stealth Chromium uses `--no-sandbox`**: this is a real sandbox reduction. Use Camoufox or OS-level container isolation if scraping untrusted content at scale.
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

# CrawlForge MCP Server — Security Audit Report

Running log of `npm audit` posture over time: advisories found, advisories cleared, and the triage rationale for anything left open. For the prior application-level audit see `docs/security-remediation-plan.md` (2026-04-18, API-key/credit-bypass) and its patch notes in `docs/security-patch-v3.0.18.md`. For the current full-codebase audit and phased remediation plan this entry belongs to, see `docs/CODEBASE_AUDIT_2026-08.md` and `plan/phase-0-dependency-currency.md`.

---

## 2026-08-03 — Phase 0: Dependency Currency & Audit Cleanup (v4.10.0 tree)

**Context:** Phase 0 of the remediation plan in `docs/CODEBASE_AUDIT_2026-08.md`. Before Phase 0, `npm audit` reported **16 vulnerabilities (8 high, 6 moderate, 2 low, 0 critical)**. A caret-range `npm update` plus one new `overrides` entry — no other code changes — brought that down to **4 (0 high, 4 moderate, 0 low, 0 critical)**.

### Advisories cleared

| Package | Before → After | Cleared |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.29 → 1.30.0 | stdio message-buffer limit, Streamable-HTTP SSE keep-alive fixes, Content-Type validation |
| `undici` | 7.25 → 7.29.0 | 2 HIGH: SOCKS5 `ProxyAgent` TLS-cert-validation bypass (GHSA-vmh5-mc38-953g); Set-Cookie percent-decode header injection (GHSA-p88m-4jfj-68fv) |
| `isomorphic-dompurify` | 3.9 → 3.19.0 | DOMPurify moderate advisories (bundles DOMPurify ≥3.4.12); deliberately stayed on jsdom 29.x rather than the newer 3.21+ line to preserve the Node ≥18 `engines` floor |

Plus routine caret minors with no advisory impact: `lru-cache`, `jsdom` 29.0 → 29.1, `cheerio`, `compromise`, `winston`, `dotenv`, `playwright`, `franc`, `turndown`, `robots-parser`.

### New override

Added `"adm-zip": "^0.6.0"` to `package.json` `overrides`. Clears the HIGH crafted-ZIP 4GB-allocation advisory, reached only via `camoufox` → `generative-bayesian-network` (an optional, install-time-only dependency). Verified `camoufox` resolution still works correctly under the override.

### Not cleared (documented, not fixed)

- **`@hono/node-server` — GHSA-frvp-7c67-39w9 (moderate).** Remains open. The pre-existing `overrides` pin holds `@hono/node-server` on the 1.x line for Node ≥18 compatibility; the fix ships only in 2.0.5+, which requires Node ≥20. Revisit once Phase 5 decides whether to raise the Node floor.
- **`uuid` (via `node-cron`) — moderate.** Deferred to Phase 5. The only fix is `node-cron@4`, a breaking major version bump; `npm audit fix --force` was deliberately not run so a "zero-risk" phase doesn't pull in an uncontrolled breaking change.
- The dev/optional-tree advisories flagged pre-update (`brace-expansion`, `js-yaml`, `fast-uri`, `qs`, `body-parser`, `@babel/core`) all cleared in this pass. The 4 remaining moderates above do sit in the production dependency tree (`@modelcontextprotocol/sdk` → `@hono/node-server`, used only by the optional HTTP transport; `node-cron` → `uuid`, the change-monitor scheduler) — both are moderate-severity, triaged, and deferred to the Phase 5 Node-floor/major-bump decisions.

### Verification

- `npm audit`: 16 vulnerabilities (8 high, 6 moderate, 2 low, 0 critical) → 4 (0 high, 4 moderate, 0 low, 0 critical).
- No application code changes — dependency bumps within existing caret ranges plus one new `overrides` entry.

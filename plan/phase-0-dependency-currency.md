# Phase 0 — Zero-Risk Dependency Currency & Audit Cleanup

**Completed:** 2026-08-03

_No code changes. ~1 hour. Do this first — it clears most of the `npm audit` HIGHs with a single `npm update`. Part of the [remediation plan](./README.md)._

**Goal:** eliminate the security advisories that are already fixed inside the existing caret ranges, before touching any code. This buys down `npm audit` (16 vulns → mostly the unfixable `camoufox`/`adm-zip` transitive) with zero behavior change and a green test suite as the safety net.

**Context:** `npm audit` currently reports **16 vulnerabilities (8 high, 6 moderate, 2 low, 0 critical)**. `npm outdated` shows the caret-satisfiable bumps below. Do NOT run `npm audit fix --force` (it would pull `node-cron@4`, a breaking change reserved for Phase 5).

> Note: `npm install` writes need the sandbox disabled in this environment (see the `running-tests-sandbox` memory).

---

## Checklist

### Caret-satisfiable updates (zero code change)
- [x] Run `npm update` and confirm these land:
  - [x] `@modelcontextprotocol/sdk` 1.29 → **1.30.0** — clears the moderate advisory via `@hono/node-server` (GHSA-frvp-7c67-39w9); gains stdio message-buffer limit + Streamable-HTTP SSE keep-alive fixes + Content-Type validation.
    - _2026-08-03 note: bump landed, but GHSA-frvp-7c67-39w9 did **not** clear — the pre-existing `overrides` pin holds `@hono/node-server` on 1.x for Node ≥18 compatibility (fix only in 2.0.5+, Node ≥20). Revisit with the Phase 5 Node-floor decision._
  - [x] `undici` 7.25 → **7.29.0** — clears **2 HIGH**: SOCKS5 ProxyAgent TLS-cert-validation bypass (GHSA-vmh5-mc38-953g) and Set-Cookie percent-decode header injection (GHSA-p88m-4jfj-68fv).
  - [x] `isomorphic-dompurify` 3.9 → **3.19.0** — bundles DOMPurify ≥3.4.12, clearing the DOMPurify moderate advisories. Verify the resolved `jsdom` stays compatible with the current Node floor (3.21 pulls jsdom 30 / Node ≥22.22 — pin to the newest 3.x that keeps jsdom 29 if enforcing engines). _Landed at 3.19.0; resolved jsdom stays on 29.x (verified 29.1.1)._
  - [x] `lru-cache` 11.3 → 11.5, `jsdom` 29.0 → 29.1, `cheerio` 1.1 → 1.2, `compromise` 14.15 → 14.16, `winston`/`dotenv`/`playwright`/`franc`/`turndown`/`robots-parser` — routine minors inside carets.
- [x] Confirm the lockfile updated and `git diff package-lock.json` contains only the intended bumps.

### Transitive HIGH triage (no upstream fix)
- [x] `adm-zip <0.6.0` (HIGH, crafted-ZIP 4GB alloc) reaches us **only via `camoufox` → `generative-bayesian-network`** (optional dep, install-time only). Try an npm `overrides` entry pinning `adm-zip` to a safe version; if it breaks camoufox resolution, **document it** in `docs/security-audit-report.md` as install-time-only exposure and leave it. _Override `"adm-zip": "^0.6.0"` applied cleanly — advisory cleared, camoufox/generative-bayesian-network resolution verified intact._
- [x] Confirm the remaining `brace-expansion` / `js-yaml` / `fast-uri` / `hono` / `qs` / `body-parser` / `@babel/core` HIGH/moderate advisories are all in **dev or optional (camoufox)** trees, not the production runtime path — note which in the audit report. _After the update these no longer appear in `npm audit`; the only 4 remaining moderates are the pinned `@hono/node-server` 1.x chain (GHSA-frvp-7c67-39w9, Node-18 pin) and `node-cron`→`uuid` (GHSA-w5hq-g745-h8pq), both deferred to Phase 5._

### Verification gate
- [x] `npm audit` HIGH count drops materially (target: only the `camoufox`/`adm-zip` transitive HIGH remains, if unavoidable). _Beat target: 16 (8 high, 6 moderate, 2 low) → 4 moderate, **0 high** — the adm-zip HIGH cleared too via the override._
- [x] `npm run test:unit` → **480/480 pass**.
- [x] `npm test` → **100.0% COMPLIANT, 0 errors**.
- [x] Update `docs/security-audit-report.md` and `CHANGELOG.md` with the advisories cleared.

# Phase 5 — Dependency Modernization (Node ≥ 20)

**Completed:** 2026-08-05

_Requires a **DECISION**: raise the `engines` Node floor from `>=18` to `>=20`. Each item below is a code port, not a caret bump. Part of the [remediation plan](./README.md)._

**Goal:** retire the abandoned/unmaintained dependencies and take the security-only-in-a-major upgrades that the current Node floor blocks. The Node floor gates everything here — `>=18` blocks every one of these.

**Decision to make first:**
- [x] **Approve raising `engines.node` to `>=20`** in `package.json` (and update CI matrix, Dockerfile base image, docs). Node 18 is EOL (April 2025); 20 is the practical floor for the modern ecosystem. Downstream impact: consumers on Node 18 would see an engines warning. _(Approved 2026-08-05; set to `>=20.16.0` — pdf-parse 2.4.5 declares `>=20.16.0 <21 || >=22.3.0`. Dockerfile `node:20-alpine` and CI Node 22 already satisfy it — no changes needed there.)_

---

## Checklist (each is its own PR with the tool's smoke-test re-run)

### Security-driven
- [x] **`node-cron` 3 → 4** — the **only** fix for its `uuid` advisory (moderate). v4 is a TS rewrite, Node ≥20, zero-dependency, adds graceful `shutdown()`. Migration: nodecron.com/migrating-from-v3. Affects `track_changes` monitor scheduling — verify monitors still fire and now stop cleanly on shutdown (ties to the Phase 3 timer-leak fix). _(Resolved by **removal** instead of upgrade: node-cron was imported nowhere — scheduling moved to `src/core/MonitorScheduler.js` setInterval timers in the Phase 3 work. Uninstalled; uuid advisory cleared; monitor suites verified green.)_
- [x] **Drop `node-summarizer`** (abandoned since 2019-05) — after Phase 2 fixes the extractive path, evaluate whether to keep it at all; prefer routing `summarize_content` through the existing `compromise` path (or `wink-nlp`) and removing the dependency entirely. _(Done: `ContentAnalyzer` extractive path rewritten as a compromise-based Luhn-style word-frequency scorer; dependency uninstalled.)_

### Maintenance / abandonment
- [x] **`pdf-parse` 1.1.x → 2.4.5** — v1 is the 2018 release with the known debug-mode crash; the npm name was taken over by an actively maintained ESM rewrite (pdfjs-dist 5 + @napi-rs/canvas, Node ≥20.16). New class-based API → rewrite the import and call sites in `src/core/processing/PDFProcessor.js`. Re-smoke `process_document` on a multi-page PDF and an encrypted PDF (also fixes the Phase 2 password no-op). _(Done: ported to `new PDFParse({data, password})` / `getInfo()` / `getText({partial|first})` / `destroy()`; password decryption now real; page-range extraction uses v2's native `partial`; new fixture-backed PDF suites added.)_
- [x] **`commander` 12 → 14** — v13 stricter arg/option errors, v14 Node ≥20. (Stop at 14; v15 is ESM-only + Node ≥22.12 — defer.) Affects `src/cli/`. Re-run the CLI subcommands. _(Done: ^14.0.3; `src/cli/` audited — no v13/v14-breaking patterns, zero code changes needed; subcommand `--help`/`--version` smokes pass.)_
- [x] **`p-queue` 8 → 9** — Node ≥20; **`throwOnTimeout` removed (timeouts always throw)** and `carryoverConcurrencyCount` renamed. **Audit for reliance on timeout-returns-undefined first** — this intersects the Phase 2 `crawl_deep` BFS fix (`QueueManager` uses `timeout`/`throwOnTimeout`). Do the BFS refactor before/with this bump. _(Done: ^9.3.3; `QueueManager` already set `throwOnTimeout: true`, so v9's always-throw is behavior-identical — dead option removed; `carryoverConcurrencyCount` used nowhere; BFS/crawl suites green.)_
- [x] **`@googleapis/customsearch` 5 → 8** — nominally breaking (auto-generated majors) but near-identical deps; low risk. Re-smoke the `search_web` Google fallback path. _(Resolved by **removal** instead of upgrade: imported nowhere — `googleSearch.js` calls the Custom Search REST endpoint directly. Uninstalled; `search_web` suites green.)_
- [x] **`diff` 8 → 9** — drops ES5; `formatPatch`/`parsePatch` behavior changes. Low risk for `diffLines`/`createPatch`; verify `track_changes` diff output snapshots. _(Done: ^9.0.0; only `diffWords`/`diffLines`/`diffChars` are used (`ChangeTracker.js`) — zero code changes; changeTracker suites green.)_

### Deferred to a later "Node 22 + SDK v2" initiative (do NOT take here)

_Confirmed deferred at phase completion (2026-08-05) — intentionally not checkboxes; these belong to the future Node 22 + SDK v2 initiative, not this phase:_

- `undici` 7 → 8 — needs Node ≥22.19 **and** a full SSRF-dispatcher regression pass (v8 isolates the global dispatcher and changes connect internals; the Phase 1 guard depends on this).
- `jsdom` 29 → 30 — Node ≥22.22.
- `zod` 3 → 4 — rewrites error customization, deprecates `.passthrough()`/`.strict()`; touches every tool schema. Bundle with SDK v2 (which requires zod 4).

### Verification gate
- [x] CI green on Node 20 (and 22 if the matrix includes it); `npm run test:unit` + `npm test` green. _(CI matrix is Node 22-only and runs on push; locally `npm run test:unit` 845 tests — 844 pass / 0 fail / 1 deliberately skipped; `npm test` 100.0% COMPLIANT / 0 errors.)_
- [x] Each upgraded tool re-smoke-tested live over MCP. _(`npm test` compliance harness over stdio + `node test-tools.js` 20/20 pass; PDF multi-page/encrypted, extractive summarizer, QueueManager timeout-throw, and CLI subcommand smokes run directly.)_
- [x] `npm audit` shows the `node-cron`/`uuid` and `pdf-parse`-tree advisories cleared. _(`npm audit`: **0 vulnerabilities** — node-cron/uuid gone via removal; bonus: `@hono/node-server` override bumped 1.19.x → 2.0.12, clearing GHSA-frvp-7c67-39w9.)_

### Supply-chain verification (ChainDrop npm worm, active since 2026-08-04)

Performed for every install in this phase, verified clean **before and after** the upgrades:

- All `npm install`/`npm uninstall` operations run with `--ignore-scripts` (blocks the worm's `preinstall: node setup.mjs` execution vector).
- Publish-date gate: every adopted version (direct + new transitives `@napi-rs/canvas@0.1.80` + platform binaries, `pdfjs-dist@5.4.296`, `p-timeout@7.0.1`) verified published **before 2026-08-04**.
- Lockfile diff (12 added / 6 changed / 28 removed packages) cross-checked against the Socket CSV (2,276 rows) and StepSecurity full compromised-package lists: **zero matches**.
- IoC scans clean pre- and post-upgrade: no `setup.mjs`/`Math_Symbol.js`/`math_init.js` in `node_modules`, no `"node setup.mjs"` preinstall hooks.
- `npm audit` post-upgrade: 0 vulnerabilities, no malware advisories.

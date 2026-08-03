# Phase 5 — Dependency Modernization (Node ≥ 20)

_Requires a **DECISION**: raise the `engines` Node floor from `>=18` to `>=20`. Each item below is a code port, not a caret bump. Part of the [remediation plan](./README.md)._

**Goal:** retire the abandoned/unmaintained dependencies and take the security-only-in-a-major upgrades that the current Node floor blocks. The Node floor gates everything here — `>=18` blocks every one of these.

**Decision to make first:**
- [ ] **Approve raising `engines.node` to `>=20`** in `package.json` (and update CI matrix, Dockerfile base image, docs). Node 18 is EOL (April 2025); 20 is the practical floor for the modern ecosystem. Downstream impact: consumers on Node 18 would see an engines warning.

---

## Checklist (each is its own PR with the tool's smoke-test re-run)

### Security-driven
- [ ] **`node-cron` 3 → 4** — the **only** fix for its `uuid` advisory (moderate). v4 is a TS rewrite, Node ≥20, zero-dependency, adds graceful `shutdown()`. Migration: nodecron.com/migrating-from-v3. Affects `track_changes` monitor scheduling — verify monitors still fire and now stop cleanly on shutdown (ties to the Phase 3 timer-leak fix).
- [ ] **Drop `node-summarizer`** (abandoned since 2019-05) — after Phase 2 fixes the extractive path, evaluate whether to keep it at all; prefer routing `summarize_content` through the existing `compromise` path (or `wink-nlp`) and removing the dependency entirely.

### Maintenance / abandonment
- [ ] **`pdf-parse` 1.1.x → 2.4.5** — v1 is the 2018 release with the known debug-mode crash; the npm name was taken over by an actively maintained ESM rewrite (pdfjs-dist 5 + @napi-rs/canvas, Node ≥20.16). New class-based API → rewrite the import and call sites in `src/core/processing/PDFProcessor.js`. Re-smoke `process_document` on a multi-page PDF and an encrypted PDF (also fixes the Phase 2 password no-op).
- [ ] **`commander` 12 → 14** — v13 stricter arg/option errors, v14 Node ≥20. (Stop at 14; v15 is ESM-only + Node ≥22.12 — defer.) Affects `src/cli/`. Re-run the CLI subcommands.
- [ ] **`p-queue` 8 → 9** — Node ≥20; **`throwOnTimeout` removed (timeouts always throw)** and `carryoverConcurrencyCount` renamed. **Audit for reliance on timeout-returns-undefined first** — this intersects the Phase 2 `crawl_deep` BFS fix (`QueueManager` uses `timeout`/`throwOnTimeout`). Do the BFS refactor before/with this bump.
- [ ] **`@googleapis/customsearch` 5 → 8** — nominally breaking (auto-generated majors) but near-identical deps; low risk. Re-smoke the `search_web` Google fallback path.
- [ ] **`diff` 8 → 9** — drops ES5; `formatPatch`/`parsePatch` behavior changes. Low risk for `diffLines`/`createPatch`; verify `track_changes` diff output snapshots.

### Deferred to a later "Node 22 + SDK v2" initiative (do NOT take here)
- [ ] `undici` 7 → 8 — needs Node ≥22.19 **and** a full SSRF-dispatcher regression pass (v8 isolates the global dispatcher and changes connect internals; the Phase 1 guard depends on this).
- [ ] `jsdom` 29 → 30 — Node ≥22.22.
- [ ] `zod` 3 → 4 — rewrites error customization, deprecates `.passthrough()`/`.strict()`; touches every tool schema. Bundle with SDK v2 (which requires zod 4).

### Verification gate
- [ ] CI green on Node 20 (and 22 if the matrix includes it); `npm run test:unit` + `npm test` green.
- [ ] Each upgraded tool re-smoke-tested live over MCP.
- [ ] `npm audit` shows the `node-cron`/`uuid` and `pdf-parse`-tree advisories cleared.

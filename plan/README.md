# CrawlForge Remediation Plan

Phased, checklisted execution plan for the [2026-08-03 deep codebase audit](../docs/CODEBASE_AUDIT_2026-08.md) of CrawlForge MCP Server **v4.10.0**.

The audit found **109 defects** (5 critical, 28 high, 47 medium, 29 low) off the happy path — while the baseline stays green (**480/480 unit tests, 100% MCP compliance, all 27 tools smoke-pass**). All 33 critical/high findings were adversarially verified as **CONFIRMED**. This folder turns that into ordered, checkable work.

## Phases

| # | File | Focus | Findings | Needs a decision? |
|---|---|---|---|---|
| 0 | [phase-0-dependency-currency.md](./phase-0-dependency-currency.md) | `npm update` — clear the already-fixed advisories | — (deps) | No ✅ **Done 2026-08-03** |
| 1 | [phase-1-critical-security.md](./phase-1-critical-security.md) | SSRF bypasses · OAuth token mint · secret leakage · wrong billing | 14 | No ✅ **Done 2026-08-03** |
| 2 | [phase-2-correctness.md](./phase-2-correctness.md) | Tool-breaking bugs — make every tool do what it promises | 52 | No ✅ **Done 2026-08-03** |
| 3 | [phase-3-leaks-robustness.md](./phase-3-leaks-robustness.md) | Timer/browser/cache leaks · missing timeouts · shutdown | 24 | No ✅ **Done 2026-08-03** |
| 4 | [phase-4-transport-cleanup.md](./phase-4-transport-cleanup.md) | HTTP transport · protocol hygiene · medium/low cleanup | 19 | No ✅ **Done 2026-08-04** |
| 5 | [phase-5-dependency-modernization.md](./phase-5-dependency-modernization.md) | Node ≥20 · retire abandoned deps · security-only majors | — (deps) | **Yes** — raise Node floor |
| 6 | [phase-6-mcp-competitive.md](./phase-6-mcp-competitive.md) | MCP-spec adoption · async tasks · competitive parity | — (roadmap) | **Yes** — product roadmap |

**Total code findings across Phases 1–4: 109** (every finding is assigned to exactly one phase).

## How to use this

- Each finding is a checkbox with its `file:line`, the concrete failure scenario, and the fix. Check items off as you land them.
- Phases **0 → 4** are pure bug/security fixes with no external decisions; run them in order. Each phase ends with a **verification gate** — don't mark a phase done until every gate box is checked (tests green + the phase-specific live re-smoke).
- Phases **5 → 6** need your call (Node-floor bump; product roadmap) — flagged inline.

## Sequencing rationale

1. **Phase 0** first — it's a `npm update` that clears most `npm audit` HIGHs with zero code change; a clean audit is the backdrop for everything else.
2. **Phase 1** next — active security holes (internal-network/metadata read primitives, anonymous operator-billed tokens, secret leakage). Highest risk-reduction.
3. **Phase 2** — the tools that silently return wrong/misleading output (esp. `crawl_deep`, the three tools that ignore `options`, `summarize_content`). Highest user-visible impact.
4. **Phase 3** — leaks that only bite a long-running server; important but not user-facing on a single call.
5. **Phase 4** — only load-bearing for HTTP/remote deployments; prerequisite for a hosted endpoint (Phase 6).
6. **Phases 5–6** — modernization and roadmap, gated on your decisions.

## Project conventions (from CLAUDE.md)

- Run `npm run test:unit` **and** `npm test` at the end of every phase; fix all failures before pushing.
- Update root `PRD.md` and `docs/PRODUCTION_READINESS.md` when landing changes; keep docs in `docs/`.
- Tests/`git`/`npm install` need the sandbox disabled in this environment (see `running-tests-sandbox` memory); use `--test-force-exit`.
- Push to GitHub when a phase completes.

## Source of truth

Full failure detail, dependency table, `npm audit` breakdown, and MCP-spec/competitive research: **[`docs/CODEBASE_AUDIT_2026-08.md`](../docs/CODEBASE_AUDIT_2026-08.md)**.

# Open-Core Migration Plan — Make the CrawlForge API Non-Bypassable

**Status:** Proposal · awaiting approval · **Drafted:** 2026-06-09
**Companion docs:** `docs/tier-map.md` (tool tiers + reconciled cost table) ·
`docs/security-remediation-plan.md` (issued-key hardening)

---

## Context / Problem

25 of 26 CrawlForge MCP tools run **entirely on the user's machine**. The backend only *meters*
usage via a self-reported `/api/v1/usage` call — it does none of the actual scraping work (except
`search_web`). So anyone who clones the public MIT repo (or `npm install`s it) can delete one
function (`withAuth`, or flip `isCreatorModeVerified()`) and use every tool for free. **The API key
gates nothing of value, because the value — the compute — happens client-side.**

**Chosen direction: _minimal_ open-core.** Officially free the cheap, trivially-reimplementable
tools (an adoption funnel you can't bill anyway), fix a live billing-table bug, and move **only**
the tools whose value genuinely *is* infrastructure (`stealth_mode` first) server-side. We do
**not** migrate the whole catalog — server-hosting commodity tools would convert a ~100%-margin
product (the user's machine does the work today) into one with real COGS, latency, and SSRF/abuse
exposure, subsidizing what users could do with `curl`. Enforcement and margin strategy agree: host
only what is both **enforceable** and **a real product**.

### Two repos involved
- **Client** — `crawlforge-mcp-server` (this repo, ESM Node).
- **Backend** — `crawlforge-website` (Next.js 16 + Prisma/Postgres + Stripe, on Vercel).

### Facts that make this cheap (verified)
- [x] Backend already has 23 server-side tool routes scaffolded at
  `crawlforge-website/src/app/api/v1/tools/<tool>/route.ts` (auth + SSRF + credit-deduct + logging
  wired) — but they call `simulate*` stubs and the client never calls them.
- [x] Real tool logic already exists in `crawlforge-mcp-server/src/tools/*` (lift, don't rewrite).
- [x] **Stripe is tool-agnostic** (sells credits, not tools) — re-tiering needs **zero** Stripe /
  price / webhook / DB changes.
- [x] `search_web` is already live server-side (`/api/v1/search`, real Google CSE) — the working
  template for the server-execution pattern.
- [x] Vercel can't run Playwright/Camoufox; browser tools need a Docker worker (both repos already
  ship Dockerfiles).

---

## Phase 1 — Reconcile the cost table (do first; zero behavior risk)

**Goal:** one credit-cost source of truth shared by both repos. Fixes a live bug where the client
and backend tables disagree and the client's value silently wins
(`/api/v1/usage:69` → `creditsUsed || getToolCreditCost(tool)`).

**Tasks**
- [x] Finalize the single cost table from `docs/tier-map.md` (Tier-0 → 0; Tier-1 per COGS).
      `extract_structured` (missing from the tier map) confirmed Tier 0 → 0 on 2026-06-09.
- [x] Update client `src/core/AuthManager.js` → `getToolCost()` (and `projectCost()` notes).
      `getToolCost(tool, params)` is now params-aware: `scrape` + `screenshot` format → 2.
- [x] Update backend `src/lib/credits.ts` → `TOOL_CREDIT_COSTS` (also fixed `|| 1` → `?? 1`
      fallback in both repos so 0-cost lookups don't resolve to 1).
- [x] Add the tools missing from the backend table: `scrape`, `agent` (+ `get_batch_results`).
- [x] Resolve known conflicts: `search_web` → 5, `stealth_mode` → 10, `map_site` → 3,
      `crawl_deep` → 5, `localization` → 5.

**Verification**
- [x] Client `getToolCost(t)` === backend `TOOL_CREDIT_COSTS[t]` for every tool
      (`scripts/verify-cost-parity.mjs` — 26 tools, 0 mismatches).
- [x] `npm run test:unit` (381/381) + `npm test` green (client; MCP compliance at the same 70%
      pre-existing baseline as the 2026-06-07 report — failures unrelated to this change);
      website `npm run test:unit:stable` green (`credits.test.ts` updated to the new table;
      the 3 remaining failing suites are the known-flaky set excluded from stable/CI and fail
      for pre-existing reasons unrelated to costs).

**Risk:** none (constants only) · **Repos:** both

---

## Phase 2 — Officially free Tier 0 + key-optional (low risk; mostly client + copy)

**Goal:** stop pretending to bill the 13 commodity tools you can't enforce; reframe as a generous
free tier.

Tier-0 tools: `fetch_url`, `extract_text`, `extract_links`, `extract_metadata`,
`scrape_structured`, `scrape_template`, `extract_content`, `scrape` (non-screenshot formats),
`summarize_content`, `analyze_content`, `extract_with_llm`, `process_document`, `list_ollama_models`.

**Tasks**
- [ ] Set all Tier-0 tools to cost 0 (from Phase 1 table).
- [ ] `src/server/withAuth.js`: a 0-cost tool skips the credit check **and** the usage report.
- [ ] `src/core/AuthManager.js`: allow Tier-0 tools to run with **no configured API key**
      (relax the "not configured" hard-fail for 0-cost tools only).
- [ ] Keep the `screenshot` format of `scrape` gated as Tier-1 (needs server browser).
- [ ] README + pricing-page copy: "free local tools + metered premium tools."
- [ ] Reconcile plan naming: README says *Free / Starter / Professional / Enterprise*; engine uses
      *free / hobby / professional / business* (`crawlforge-website/src/lib/stripe/products.ts`).

**Verification**
- [ ] With **no** API key configured: Tier-0 tools return results, no credit error;
      `_cost.actual === 0`.
- [ ] With no key: Tier-1 tools still demand a key.
- [ ] `npm test` (MCP compliance) + `npm run test:unit` green.

**Risk:** low · **Repos:** client + docs/site copy

---

## Phase 3 — Pull 90-day usage data (decision gate; read-only)

**Goal:** decide whether any migration beyond `stealth_mode` is worth the margin hit, using data
you already have.

**Tasks**
- [ ] Pull credits-by-tool for the last 90 days from `UsageLog` (website already exposes
      `src/app/api/dashboard/usage` + `src/app/api/usage/tools`, or run a one-off Prisma query).
- [ ] Rank tools by share of paid credit consumption.
- [ ] Record the finding here:

      | Tool | % of paid credits (90d) | Already server-side? |
      |------|------------------------:|----------------------|
      | _fill in_ | | |

**Decision gate**
- [ ] If revenue concentrates in `search_web` + `stealth_mode` → **stop after Phase 4.**
- [ ] Else → list the specific Tier-1 tools that justify Phase 5.

**Risk:** none (read-only) · **Repos:** backend (read)

---

## Phase 4 — Migrate `stealth_mode` server-side (proof-of-pattern; highest value)

**Goal:** prove the full server-execution pattern on the one tool where server-side is both
enforceable AND a real product (residential proxies + anti-bot nobody can self-host).

**Tasks**
- [ ] Stand up a **Docker browser worker** (reuse existing `Dockerfile` / `docker-compose`) — not
      a Vercel function. _(Confirm host: existing Docker service vs. new microservice vs. 3rd-party
      browser API — see Open Decision.)_
- [ ] Backend: replace the `simulate*` stub in
      `crawlforge-website/src/app/api/v1/tools/stealth_mode/route.ts` with the real engine lifted
      from `crawlforge-mcp-server/src/core/StealthBrowserManager.js` + the stealth tool, executed
      on the browser worker.
- [ ] Backend: deduct via the route's server cost table (`creditDeduction.deduct('stealth_mode')`);
      retire the self-reported `/api/v1/usage` path for this tool.
- [ ] Client: repoint the `stealth_mode` handler to POST `/api/v1/tools/stealth_mode` with the API
      key instead of running locally; keep the MCP response shape identical.

**Verification**
- [ ] With a real key: `stealth_mode` returns a result fetched by the **server** (confirm via
      server logs / request origin), credits decrement **server-side**.
- [ ] Bypass closed: a patched client with `withAuth` removed can no longer get free `stealth_mode`
      (the work is no longer local).
- [ ] `npm run test:unit` + `npm test` green; website tests green.

**Risk:** medium (new infra path) · **Repos:** both + Docker worker

---

## Phase 5 — Reassess remaining Tier 1 with the data (conditional)

**Goal:** migrate only the Tier-1 tools that Phase 3 proves pay for themselves. Do **not**
pre-commit.

Candidate tools: `crawl_deep`, `batch_scrape`, `deep_research`, `agent`, `localization`,
`map_site`, `track_changes`, `generate_llms_txt`, `scrape_with_actions`.

**Tasks (repeat per justified tool)**
- [ ] Confirm the tool clears the Phase 3 revenue bar.
- [ ] Fill its `/api/v1/tools/<tool>/route.ts` stub with logic from `src/tools/*`
      (non-browser tools run in Vercel functions; `scrape_with_actions` joins the Docker worker).
- [ ] Repoint the client handler to the backend; server-side deduction.
- [ ] Per-tool verification: server executes, server deducts, bypass closed, tests green.

**Risk:** scales with count · **Repos:** both

---

## Cross-cutting notes

- **Per CLAUDE.md:** run `npm run test:unit` + `npm test` at the end of every phase, fix all
  failures before pushing, and push to GitHub when a phase completes. Update `PRD.md`.
- **Sandbox:** the `crawlforge-website` repo is outside the assistant's write sandbox — backend
  edits are applied by the user or with the sandbox disabled.
- **Stripe/DB:** untouched across all phases. No new products, prices, webhooks, or migrations.

## Open decision (confirm at Phase 4)

- [ ] **Browser worker host:** existing Docker service (recommended — reuses your infra) ·
      new dedicated microservice · third-party browser API (Browserless / Camoufox cloud).

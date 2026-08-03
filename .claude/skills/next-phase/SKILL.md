---
name: next-phase
description: Drive the next incomplete phase of the remediation plan in the plan/ folder to completion. Auto-detects the next phase (Phase 0 → Phase 6), spawns specialized sub-agents IN PARALLEL to do the work, runs that phase's verification gate plus npm run test:unit and npm test, updates the phase file / plan README / PRD.md / CHANGELOG.md / docs/PRODUCTION_READINESS.md, then commits and pushes to the current branch. One phase per invocation.
context: fork
---

# /next-phase — Ship the next phase of the `plan/` folder

You orchestrate exactly **one** phase of the remediation plan in `plan/` from start to push, then stop. Repeated invocations walk the plan in order: **Phase 0 → 1 → 2 → 3 → 4 → 5 → 6**. You do not implement the work yourself — you delegate to specialized sub-agents in parallel and integrate their work.

The plan lives in `plan/`:
- `plan/README.md` — index + sequencing + the phase table.
- `plan/phase-0-dependency-currency.md` … `plan/phase-6-mcp-competitive.md` — one file per phase.
- Full failure detail for every finding: `docs/CODEBASE_AUDIT_2026-08.md`.

Each phase file has a `## Checklist` of `- [ ]` items and a `## Verification gate` of `- [ ]` items. A code finding looks like:

```
- [ ] 🔴 **<title>** · CONFIRMED
  - `src/utils/ssrfGuard.js:129`
  - Failure: <concrete failure scenario>
  - Fix: <the fix>
```

The `` `file:line` `` and `Fix:` sub-bullets are the contract you hand to the sub-agent — copy them verbatim, don't paraphrase.

## Hard rules

- **One phase per invocation.** Detect the lowest-numbered incomplete phase, ship it, stop.
- **Never amend.** Always create a new commit.
- **Never `--no-verify`, `--no-gpg-sign`, or force-push.**
- **Never `git add -A` / `git add .`** — stage files by name.
- If the working tree is dirty before Step 1 (anything other than the plan files themselves), **stop and report** — don't sweep other work into the commit.
- If any verification step fails, **stop before commit**, leave the tree as-is, and report the failure with output.
- All sub-agent calls in Step 3 go out in a **single message with multiple `Agent` tool calls** so they run in parallel.
- **Disjoint file ownership.** No two parallel agents may edit the same file (they share the real working tree, not worktrees — concurrent edits to one file corrupt it). `server.js` and shared `src/utils/*` are hotspots; give each hot file to a single agent.
- **In this environment**, `git`, `npm install/update`, and the test suites may fail under a restrictive sandbox (listen EPERM / write EPERM are artifacts, not real failures). If a step fails that way, re-run it with the sandbox disabled. Append `--test-force-exit` to `node --test` runs (a Playwright handle otherwise delays exit ~100s — see CLAUDE.md).

## Step 1 — Detect the next phase

1. List `plan/phase-*.md` and order them by phase number (0 → 6).
2. The **current phase** is the first file (lowest number) containing at least one `- [ ]` line.
3. If every `- [ ]` in every phase file is already `- [x]`, output `All phases complete — nothing to do.` and exit.
4. Read the current phase file in full. Record:
   - Phase number + title (from the `# Phase N — …` heading).
   - Whether it is a **DECISION** phase (its goal contains `**DECISION**` or the README table marks it "Yes" under "Needs a decision?"). Phases 5 and 6 are DECISION phases.
   - Every unchecked `- [ ]` item in `## Checklist`, verbatim, plus each item's `file:line` and `Fix:` sub-bullets.
   - The `## Verification gate` block verbatim.
5. Run `git status --short` and `git rev-parse --abbrev-ref HEAD`. If the tree is dirty (anything other than files under `plan/`), stop and report.

### DECISION-phase gate (Phases 5 & 6)

If the current phase is a DECISION phase, **do not start work.** Instead:

- Surface the decision(s) the phase names (e.g. Phase 5: "raise `engines.node` to `>=20`?"; Phase 6: which spec-adoption / competitive items to pursue).
- Use `AskUserQuestion` to get the call. Only the items the user greenlights become in-scope; leave the rest `- [ ]`.
- Then proceed with Steps 2–5 for the greenlit subset only. Never auto-implement a roadmap/competitive item (Phase 6 Track B/C) the user did not choose.

## Step 2 — Plan parallel delegation

Group the in-scope unchecked items by owning agent, primarily from each finding's `file:line`. Mapping:

| Finding area (by file / theme) | Sub-agent |
|---|---|
| SSRF (`src/utils/ssrfGuard.js`, `ssrfProtection.js`), OAuth (`src/server/auth/oauth.js`), auth/billing (`src/core/AuthManager.js`, `src/server/withAuth.js`), secret masking, webhook SSRF | `security-auditor` |
| Tool logic & core in `src/tools/**` and `src/core/**` (crawlers, cache, processing, analysis, Snapshot/ChangeTracker, Research, Localization, Stealth), `server.js` handlers/schemas | `mcp-implementation` |
| Real-module unit/integration tests, SSRF regression suite, coverage, `npm test`, `node test-tools.js`, `npm audit` | `testing-validation` |
| Leak assertions (WeakRef/`--expose-gc`), soak/RSS/memory, browser-pool load | `performance-monitor` |
| `docs/**`, `PRD.md`, `CHANGELOG.md`, `README.md`, `docs/PRODUCTION_READINESS.md` | `api-documenter` |
| `npm update`, dependency bumps/removals in `package.json`, Node-floor bump, Docker/npm verification, version bump | `deployment-manager` |

Notes:
- **Phase 0** and **Phase 5** are dependency/ops phases (no severity-emoji findings) — lead with `deployment-manager`, verify with `testing-validation`.
- **Phase 2 is large (~52 items).** Do NOT hand it to one agent. Shard the `mcp-implementation` work into several parallel agents **by disjoint subsystem/file set** (e.g. basic+scrape, crawl+map, extract+document, search+research, batch+actions) so no two agents share a file. Assign all `server.js` findings to a single agent.
- **Do NOT delegate** the final commit + push or the plan checkbox flips. You do those in Step 5.
- Within one agent's group, items are sequential; across groups, parallel.

## Step 3 — Execute agents in parallel

Send **one message** containing one `Agent` tool call per group. Each prompt must:

1. State the phase number + title + a one-line goal.
2. Include the agent's owned items **verbatim**, each with its `` `file:line` `` and `Fix:` line.
3. List the exact files the agent owns (disjoint from every other agent this round).
4. Forbid: touching files outside its list, editing anything under `plan/`, committing, or pushing.
5. End with: *"Report the exact files you modified and a one-line result per item — only what you actually did, not what you would do."*

Prompt skeleton (fill in real items — do not copy literally):

```
You are shipping part of Phase <N> — <title> of the plan/ folder. Goal: <one line>.
Your owned items (verbatim from plan/phase-<N>-*.md):
- [ ] <emoji> <title>
    file:line: <src/...:NN>
    fix: <the fix text>

Owned files (touch ONLY these): <disjoint file list>
Forbidden: editing anything under plan/, committing, pushing, touching files outside the list.
When done, report: (1) files modified, (2) one-line outcome per item.
```

## Step 4 — Integrate and verify

After all agents return:

1. Run `git status --short` and `git diff --stat`.
2. For each owned item, confirm the change is actually in the diff. **Trust the code, not the agent's summary.** If an item wasn't done, re-delegate it or do it yourself. Reconcile any two agents that touched the same file (should not happen with disjoint ownership — if it did, re-read and merge both intents by hand).
3. Run this phase's `## Verification gate` (the checklist from the phase file — its live re-smokes and assertions) **plus the project-standard suites**:
   ```bash
   npm run test:unit          # expect 480/480 pass (add --test-force-exit if it hangs at exit)
   npm test                   # expect 100.0% COMPLIANT, 0 errors
   ```
   For dependency phases (0, 5) also run `npm audit` and confirm the targeted advisories cleared. Run any phase-specific commands the gate names (e.g. `node test-tools.js`, a soak test).
4. If anything fails: **stop.** Do not edit the plan. Do not commit. Report which gate item failed and the output.

## Step 5 — Update plan, commit, push

Only on full verification success:

1. **Edit the phase file:** flip every completed `- [ ]` → `- [x]` (checklist items and verification-gate items). Under the `# Phase N` heading, append: `**Completed:** YYYY-MM-DD` (today's real date). For a partial DECISION phase, flip only the greenlit items and note which were deferred.
2. **Edit `plan/README.md`:** in the phase table, mark the phase done (e.g. append `✅` to its row) so the index reflects progress.
3. **Edit `PRD.md`:** append the version/phase entry per the standing project rule (see `CLAUDE.md` and the `feedback_commit_update_prd` memory). Match the format of prior entries.
4. **Edit `CHANGELOG.md`:** append a section summarizing what shipped. Match prior entries.
5. **Edit `docs/PRODUCTION_READINESS.md`:** record the phase completion (project rule: sub-agents report, PM updates this file).
6. Stage **named files only** — every file the agents touched plus the plan/PRD/CHANGELOG/docs edits:
   ```bash
   git add plan/phase-<N>-*.md plan/README.md PRD.md CHANGELOG.md docs/PRODUCTION_READINESS.md <other modified files>
   ```
   Never `git add -A`.
7. Commit with a HEREDOC. Title: `Phase <N> — <phase title>`. Body: short bullets of what shipped (grouped by theme/subsystem). End the body with the `Co-Authored-By` trailer your environment's git rules specify (e.g. `Co-Authored-By: Claude <noreply@anthropic.com>`).
   ```bash
   git commit -m "$(cat <<'EOF'
   Phase 1 — Critical Security Holes (SSRF · OAuth · Secrets · Billing)

   - Unified SSRF pre-flight across every outbound fetch path (fetch/scrape/map/pdf/actions/webhook)
   - Fixed IP-literal + IPv4-mapped-IPv6 guard bypass
   - Closed anonymous OAuth token mint; masked secrets in usage telemetry
   - No credits billed when the credit check itself refuses the call
   - Added SSRF regression suite

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```
8. `git push` to the current branch. Never push to `main`; never force. (`gh`/`git` may need the sandbox disabled here — see the `gh-cli-needs-sandbox-off` / `running-tests-sandbox` memories.)
9. Final report: phase number, commit SHA, branch, what shipped (one line per theme), the `npm run test:unit` / `npm test` results, and **which phase runs next** on the next `/next-phase` invocation.

## When agents conflict or stall

- Two agents touched the same file → your ownership wasn't disjoint; re-read the file, reconcile by hand, keep both intents, and tighten ownership next round.
- An agent reports it couldn't do an item → re-prompt with sharper constraints, or downgrade scope and leave the item `- [ ]`. **Never** mark `- [x]` something that wasn't done.
- A verification step is flaky → re-run once. If it fails twice, treat it as real and stop.

## What this skill is NOT

- Not a code generator — all implementation is delegated.
- Not a phase planner — phases are already defined in `plan/`.
- Not a multi-phase runner — it ships exactly one phase, then stops. Invoke again for the next.
- Not idempotent on partial failure — if Step 4 fails, the tree is left dirty for you to inspect.

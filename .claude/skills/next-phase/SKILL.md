---
name: next-phase
description: Drive the next incomplete phase of IMPROVEMENT_PLAN.md to completion. Auto-detects the next phase (A → B → C), spawns specialized sub-agents IN PARALLEL to do the work, runs phase verification, updates IMPROVEMENT_PLAN.md / PRD.md / CHANGELOG.md, then commits and pushes to the current branch.
context: fork
---

# /next-phase — Ship the next phase of IMPROVEMENT_PLAN.md

You orchestrate one phase of `IMPROVEMENT_PLAN.md` from start to push. You do not do the implementation yourself — you delegate to specialized sub-agents in parallel and integrate their work.

## Hard rules

- **Never amend.** Always create a new commit.
- **Never `--no-verify`, `--no-gpg-sign`, or force-push.**
- **Never `git add -A` / `git add .`** — stage files by name.
- If the working tree is dirty before Step 1, **stop and report** — don't sweep someone else's work into the commit.
- If `npm run build` or any verification step fails, **stop before commit** and leave the tree as-is. Report the failure.
- All sub-agent calls in Step 3 go out in a **single message with multiple `Agent` tool calls** so they run in parallel.

## Step 1 — Detect the next phase

1. Read `IMPROVEMENT_PLAN.md` from the repo root.
2. Walk the `## Phase X — vX.Y.Z` headers in document order (A → B → C).
3. The **current phase** is the first phase containing at least one `- [ ]` line.
4. If every checkbox in the file is `[x]`, output `All phases complete — nothing to do.` and exit.
5. Record:
   - Phase ID (`A`, `B`, or `C`)
   - Phase title and target version (e.g. `v3.0.19 "Cleanup"`)
   - The full list of unchecked items, verbatim, with their parent subsection (A1, A2, …).
6. Run `git status --short` and `git rev-parse --abbrev-ref HEAD`. If the tree is dirty (anything other than `IMPROVEMENT_PLAN.md` itself or untracked plan-mode files), stop.

## Step 2 — Plan parallel delegation

Group every unchecked item by the agent that should own it. Use this mapping:

| Item pattern | Sub-agent |
|---|---|
| Security hardening, audit phase 4/5/6, API-key revalidation, auth bearer | `security-auditor` |
| Edits to `src/core/AuthManager.js`, `server.js` (handler/transport), reliability/logging, request IDs, dead-code removal in `src/`, dependency removal in `package.json` | `mcp-implementation` |
| Decompose `server.js`, extract `registerTool.js` / schemas / transports, split large tools, browser pool, cache extraction | `mcp-implementation` |
| Streamable HTTP transport, OAuth 2.1, structured outputs, OpenTelemetry, Prometheus | `mcp-implementation` |
| Unit tests, integration tests, coverage gate, MCP Inspector check, `npm test`, `node test-tools.js`, `npm audit` | `testing-validation` |
| Soak test, RSS/memory verification, browser-pool load test | `performance-monitor` |
| `docs/PRODUCTION_READINESS.md`, `docs/oauth-quickstart.md`, `docs/observability/*`, `CHANGELOG.md` body, README updates | `api-documenter` |
| `package.json` version bump, npm metadata, Docker verification | `deployment-manager` |

**Do NOT delegate** the final commit + push or the `IMPROVEMENT_PLAN.md` checkbox flips. You do those yourself in Step 5.

Within each agent's group, items are sequential. Across groups, they run in parallel.

## Step 3 — Execute agents in parallel

Send **one message** containing one `Agent` tool call per group that has items. Each prompt must:

1. State the phase ID + version + a one-line goal.
2. Include the agent's owned items **verbatim** from `IMPROVEMENT_PLAN.md` (don't paraphrase — the checkbox text is the contract).
3. List the files the agent is allowed to touch (from `IMPROVEMENT_PLAN.md` "Critical files (by phase)").
4. Explicitly forbid touching items outside its group, editing `IMPROVEMENT_PLAN.md`, committing, or pushing.
5. End with: *"Report back the exact files you modified and a one-line summary per item. Do not summarize what you would have done — only what you actually did."*

Example prompt skeleton (do not copy literally — fill in real items):

```
You are working on Phase A (v3.0.19 "Cleanup") of IMPROVEMENT_PLAN.md.
Your owned items (copy from the plan, verbatim):
- [ ] <item 1>
- [ ] <item 2>

Allowed files: <list from "Critical files (by phase)">
Forbidden: editing IMPROVEMENT_PLAN.md, committing, pushing, touching items outside this list.

When done, report: (1) files modified, (2) one-line outcome per item.
```

## Step 4 — Integrate and verify

After all agents return:

1. Run `git status --short` and `git diff --stat` to see what actually changed.
2. For each owned item, confirm the described work is reflected in the diff. **Trust the code, not the agent's summary.** If an item wasn't done, re-delegate it or do it yourself.
3. Run the phase's verification block. Pick by phase ID:

   **Phase A:**
   ```bash
   npm test && node test-tools.js && npm audit && npm run build
   ```

   **Phase B** — Phase A block plus:
   ```bash
   node tests/integration/mcp-protocol-compliance.test.js && \
   npm run docker:build && npm run docker:prod
   # plus the soak test from IMPROVEMENT_PLAN.md §B5 (delegated to performance-monitor)
   ```

   **Phase C** — Phase B block plus MCP Inspector / OAuth PKCE / `/metrics` checks from §C6.

4. If anything fails: **stop**. Do not edit `IMPROVEMENT_PLAN.md`. Do not commit. Report which step failed and the relevant output.

## Step 5 — Update plan, commit, push

Only on full verification success:

1. **Edit `IMPROVEMENT_PLAN.md`:** flip every completed `- [ ]` → `- [x]` for the current phase. Directly under the `## Phase X` header, append a line: `**Completed:** YYYY-MM-DD` (use today's actual date).
2. **Edit `PRD.md`:** append the new version entry per the standing project rule (see `CLAUDE.md`). Match the format of prior version entries already in that file.
3. **Edit `CHANGELOG.md`:** append a new section for the version with a summary of what shipped. Match the format of prior entries.
4. Stage **named files only**:
   ```bash
   git add IMPROVEMENT_PLAN.md PRD.md CHANGELOG.md <other modified files>
   ```
   List every file the agents touched. Never `git add -A`.
5. Commit with a HEREDOC. Title format: `Phase <ID> — <Phase title> (<version>)`. Body: short bullet list of the section headings that shipped (A1–A5, etc.).
   ```bash
   git commit -m "$(cat <<'EOF'
   Phase A — Cleanup (v3.0.19)

   - A1 Security hardening (audit phases 4 & 5 closed)
   - A2 Reliability fixes
   - A3 Dead code & dependencies removed
   - A4 Documentation updates
   - A5 Verification

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```
6. `git push` to the current branch. Do not push to `main` and do not force.
7. Final report to the user: phase ID, commit SHA, branch, what shipped (one line per subsection), and the next phase that will run on the next `/next-phase` invocation.

## When agents conflict or stall

- Two agents touched the same file → re-read the file, reconcile by hand, keep both intents.
- An agent reports it couldn't do an item → either re-prompt with sharper constraints, or downgrade scope and leave the item `[ ]` in `IMPROVEMENT_PLAN.md`. Never silently mark something `[x]` that wasn't done.
- A verification step is flaky → re-run once. If it fails twice, treat it as a real failure and stop.

## What this skill is NOT

- Not a code generator — all implementation is delegated.
- Not a phase planner — the phases are already defined in `IMPROVEMENT_PLAN.md`.
- Not idempotent on partial failure — if Step 4 fails, the working tree is left dirty for the user to inspect.

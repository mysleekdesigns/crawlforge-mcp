# CrawlForge Upgrade PRD — CLI + LLM Extraction + Skills System

## Context

CrawlForge MCP Server (v3.0.12) has 20 specialized tools and strong security/stealth features, but Firecrawl has leapfrogged in developer experience with a CLI, skills system, and AI workflows. This PRD covers the top 3 upgrades to close the gap while preserving CrawlForge's unique advantages (stealth, localization, NLP, change tracking, local processing).

**Goal:** Add a CLI layer, LLM-powered structured extraction, and a skills system — without breaking any of the 20 existing MCP tools or the current setup flow.

**Last Updated:** 2026-03-30

---

## Progress Summary

| Phase | Status | Completion |
|-------|--------|------------|
| Pre-requisite: Extract Creator Mode | ✅ Complete | 100% |
| Phase 1: LLM-Powered Structured Extraction | ✅ Complete | 100% |
| Phase 2: CLI Layer | ❌ Not Started | 0% |
| Phase 3: Skills System | ❌ Not Started | 0% |

**Current tool count:** 20 (19 original + extract_structured)

---

## Pre-requisite: Extract Creator Mode ✅ COMPLETE

**Problem:** `AuthManager.js` and `searchWeb.js` both imported `isCreatorModeVerified()` from `server.js`. Importing any tool that depends on AuthManager would trigger the entire MCP server startup. The CLI cannot reuse tool classes without fixing this.

**Solution:** Extracted creator mode logic into `src/core/creatorMode.js`, updated all imports.

### Completed:
- [x] Created `src/core/creatorMode.js` — crypto, dotenv, hash check, `_creatorModeVerified` flag, `isCreatorModeVerified()` export, timing-safe hash comparison, auto secret cleanup
- [x] Updated `server.js` (line 5) — re-exports from `./src/core/creatorMode.js`
- [x] Updated `src/core/AuthManager.js` (line 9) — imports from `./creatorMode.js`
- [x] Updated `src/tools/search/searchWeb.js` (line 8) — imports from `../../core/creatorMode.js`
- [x] Verified: `npm start` works (MCP server)
- [x] Verified: `npm test` passes
- [x] Verified: Creator mode activates with secret

---

## Phase 1: LLM-Powered Structured Extraction ✅ COMPLETE

**Why first:** Self-contained, extends existing LLMManager, and is Firecrawl's strongest differentiator. Most infrastructure already exists.

### 1.1 Add `extractStructured()` to LLMManager — ✅ Done

**File:** `src/core/llm/LLMManager.js` (lines 326-448)

- [x] Added `async extractStructured(content, schema, options = {})` method (lines 326-372)
- [x] System prompt instructs LLM to extract data matching JSON Schema, return ONLY valid JSON
- [x] Accepts optional `prompt` parameter for extraction guidance
- [x] Uses `temperature: 0.1` for deterministic extraction
- [x] `maxTokens` scales with schema complexity (default 1000, max 2000)
- [x] Truncates content to `maxContentLength` (default 6000 chars)
- [x] Parses JSON response and validates against schema via `validateAgainstSchema()` (lines 377-405)
- [x] Added `fallbackStructuredExtraction(content, schema)` (lines 410-448) — keyword/regex matching for primitives

### 1.2 Create ExtractStructuredTool — ✅ Done

**File:** `src/tools/extract/extractStructured.js` (280 lines)

- [x] `ExtractStructuredSchema` with Zod: url, schema, prompt, llmConfig, fallbackToSelectors, selectorHints
- [x] Class `ExtractStructuredTool` with `constructor(options)` and `async execute(params)`
- [x] Execute flow: fetch URL -> parse HTML with Cheerio -> strip scripts/styles -> truncate -> LLM extraction -> validate -> return
- [x] Return shape: `{ url, data, extraction_method, confidence, schema_used, processingTime, validation }`
- [x] Lightweight JSON Schema validator (types, required fields, enums)
- [x] CSS selector fallback with `_cssExtraction()` and type coercion via `_coerceValue()`
- [x] Keyword fallback if CSS fails
- [x] Confidence scoring via `_calculateConfidence()` based on method and validation

### 1.3 Register in server.js — ✅ Done

- [x] Imported `ExtractStructuredTool` from `./src/tools/extract/extractStructured.js`
- [x] Registered with `server.registerTool("extract_structured", ...)` (line 1214)
- [x] Wrapped with `withAuth("extract_structured", ...)`
- [x] Tool has `destroy()` method for cleanup

### 1.4 Credit Cost — ✅ Done

- [x] Added `extract_structured: 4` to `getToolCost()` in `src/core/AuthManager.js` (line 290)

### 1.5 Verification — ✅ Done

- [x] `npm start` — MCP server starts, lists 20 tools
- [x] `npm test` — MCP protocol compliance passes
- [x] All 20 tools verified passing via `test-tools.js`
- [x] Existing 19 tools still work unchanged

---

## Phase 2: CLI Layer (2-3 weeks)

**Why:** Makes CrawlForge usable by humans, scriptable in CI/CD, composable with Unix tools. Foundation for skills and workflows.

### 2.1 CLI Infrastructure

**New files:**
- [ ] `bin/cli.js` — entry point with shebang, Commander.js program
- [ ] `src/cli/ToolAdapter.js` — wraps tool classes for CLI use (init, execute, cleanup)
- [ ] `src/cli/AuthAdapter.js` — CLI version of withAuth (credit check, usage reporting, friendly errors)
- [ ] `src/cli/formatters/json.js` — JSON output formatter
- [ ] `src/cli/formatters/text.js` — plain text/markdown formatter
- [ ] `src/cli/formatters/table.js` — tabular output for lists
- [ ] `src/cli/utils.js` — TTY detection, spinner helpers, error formatting

**Key design decisions:**
- `crawlforge` bin MUST remain pointing to `server.js` (MCP clients depend on it)
- New bin entry: `crawlforge-cli` -> `bin/cli.js`
- Global flags: `--json`, `--pretty`, `--output <file>`, `--format <fmt>`, `--quiet`, `--api-key`, `--timeout`
- TTY detection: when piped, output plain text/JSON; when interactive, use colors/spinners
- Spinners/progress write to stderr so stdout stays clean for piping

### 2.2 Package.json Updates

- [ ] Add `"crawlforge-cli": "bin/cli.js"` to `bin`
- [ ] Add `"bin/"` to `files` array
- [ ] Add dependencies: `commander`, `ora`, `chalk`
- [ ] Add script: `"cli": "node bin/cli.js"`

### 2.3 Phase 2a — MVP Commands (first week)

- [ ] `crawlforge-cli scrape <url>` — wraps ExtractContentTool (markdown output default)
- [ ] `crawlforge-cli search <query>` — wraps SearchWebTool
- [ ] `crawlforge-cli crawl <url>` — wraps CrawlDeepTool (with `--depth`, `--limit`)
- [ ] `crawlforge-cli map <url>` — wraps MapSiteTool
- [ ] `crawlforge-cli setup` — delegates to setup.js
- [ ] `crawlforge-cli credits` — shows credit balance via AuthManager

### 2.4 Phase 2b — Full Commands (second week)

- [ ] `crawlforge-cli stealth <url>` — wraps StealthBrowserManager (CrawlForge unique!)
- [ ] `crawlforge-cli track <url>` — wraps TrackChangesTool (`--baseline`, `--compare`)
- [ ] `crawlforge-cli analyze <url>` — wraps AnalyzeContentTool (NLP, CrawlForge unique!)
- [ ] `crawlforge-cli research <topic>` — wraps DeepResearchTool
- [ ] `crawlforge-cli extract <url>` — wraps ExtractStructuredTool (from Phase 1)
- [ ] `crawlforge-cli batch <file>` — wraps BatchScrapeTool (reads URLs from file)
- [ ] `crawlforge-cli download <url>` — map + scrape + save to directory
- [ ] `crawlforge-cli <url>` — shorthand for scrape (detect bare URL as default command)

### 2.5 ToolAdapter Pattern

```javascript
// src/cli/ToolAdapter.js
export class ToolAdapter {
  constructor(ToolClass, config = {})
  async run(params, outputOptions)  // init tool, execute, format output, cleanup
  formatOutput(result, options)      // delegate to formatter
  cleanup()                          // call tool.destroy() if exists
}
```

Key insight: Tool classes return raw JS objects from `execute()`. The MCP wrapping (`{ content: [{ type: "text", text: ... }] }`) happens in server.js callbacks, NOT in the tools. So the CLI can call `tool.execute()` directly.

### 2.6 Auth Flow for CLI

- [ ] Priority order: `--api-key` flag > `CRAWLFORGE_API_KEY` env > `~/.crawlforge/config.json` > creator mode
- [ ] `AuthAdapter.withCliAuth(toolName, fn)` — same credit check/report as server.js `withAuth()` but throws CLI-friendly errors
- [ ] Show credit balance after operations (unless `--quiet`)

### 2.7 Testing

- [ ] Unit tests: formatters, TTY detection, auth adapter (`tests/cli/`)
- [ ] Integration: each command `--help` exits 0
- [ ] Integration: `crawlforge-cli scrape https://example.com --json` returns valid JSON
- [ ] Pipe test: `crawlforge-cli scrape https://example.com | head -5` works

### 2.8 Verification

- [ ] `npm start` — MCP server still works (unchanged)
- [ ] `crawlforge-cli --help` — shows all commands
- [ ] `crawlforge-cli scrape https://example.com` — returns markdown content
- [ ] `crawlforge-cli search "web scraping" --json | jq .` — pipe works
- [ ] `crawlforge-cli stealth https://example.com` — stealth mode works from terminal
- [ ] All 20 MCP tools still functional via Claude Code/Cursor

**Depends on:** Phase 1 (complete) — ExtractStructuredTool for `crawlforge-cli extract` command

---

## Phase 3: Skills System (1-2 weeks)

**Why:** Skills make CrawlForge discoverable by AI agents without MCP configuration. Dramatically lowers adoption barrier.

### 3.1 Skill Content Files

**New directory:** `skills/` (top-level, ships with npm package)

- [ ] `skills/crawlforge-mcp.md` — comprehensive MCP tool usage skill
  - All 20 tools with descriptions and example calls
  - Workflow patterns: search -> extract -> analyze
  - Credit optimization tips
  - Highlights unique features (stealth, localization, tracking, NLP)
- [ ] `skills/crawlforge-cli.md` — CLI usage skill (for Bash-capable agents)
  - All CLI commands with examples
  - Pipe patterns and composition
  - CI/CD integration examples
- [ ] `skills/crawlforge-stealth.md` — specialized stealth/localization skill
  - When to use stealth vs regular fetch
  - Country profiles and geo-targeting
  - Anti-detection best practices
- [ ] `skills/crawlforge-research.md` — deep research workflow skill
  - Multi-source research patterns
  - LLM-powered extraction with schemas
  - Combining tools for comprehensive analysis

### 3.2 SkillInstaller Class

**New file:** `src/skills/SkillInstaller.js`

- [ ] `detectAgents()` — returns `{ claudeCode: bool, cursor: bool, vscode: bool }`
  - Claude Code: check `~/.claude.json` or `~/.claude/` exists
  - Cursor: check `~/.cursor/` exists
  - VS Code: check for `.github/` or VS Code settings
- [ ] `installForClaudeCode(options)` — writes to `~/.claude/commands/crawlforge.md` (creates global `/crawlforge` slash command)
- [ ] `installForCursor(options)` — appends to `.cursorrules` or `.cursor/rules/crawlforge.md`
- [ ] `installForVSCode(options)` — writes to `.github/copilot-instructions.md`
- [ ] `installAll(options)` — install to all detected agents
- [ ] `checkInstallStatus()` — version check, reports if update available
- [ ] `uninstall(agent)` — remove installed skills

### 3.3 Integration with Setup

**Modify:** `setup.js`

- [ ] Add `--skills` flag handling: `npx crawlforge-setup --skills`
- [ ] Add `--skills --agent claude` for specific agent targeting
- [ ] Add skills installation as optional step at end of normal setup flow
- [ ] Add `--uninstall-skills` flag to remove installed skills

### 3.4 Package.json Updates

- [ ] Add `"skills/"` to `files` array (ships with npm package)
- [ ] Optionally add `"crawlforge-skills": "src/skills/cli.js"` bin entry

### 3.5 Skill Content Strategy

Skills should reference BOTH MCP tools AND CLI commands:
- MCP section: structured tool calls with parameters
- CLI section: bash commands for agents with shell access
- Best practices: when to use which approach
- Each skill includes a version header: `<!-- crawlforge-skill v1.0.0 -->`

### 3.6 Conflict Handling

- [ ] Check for existing content before writing
- [ ] Back up existing files before modifying
- [ ] Use `--force` flag to override
- [ ] For `.cursorrules`: append with clear section markers, don't replace
- [ ] Namespaced filenames: `crawlforge-*.md` to avoid conflicts

### 3.7 Testing

- [ ] Unit test: `detectAgents()` with mocked filesystem
- [ ] Unit test: skill file generation produces valid markdown
- [ ] Unit test: conflict detection and backup logic
- [ ] Integration: full install flow to temp directory
- [ ] Manual: install to Claude Code, verify `/crawlforge` command appears

### 3.8 Verification

- [ ] `npx crawlforge-setup --skills` — detects agents and installs
- [ ] Claude Code recognizes `/crawlforge` slash command
- [ ] Skill content accurately describes all 20 tools + CLI commands
- [ ] Existing setup flow (`npx crawlforge-setup`) unchanged
- [ ] All MCP tools still work

---

## Key Files Reference

| File | Role | Phase | Status |
|------|------|-------|--------|
| `server.js` | MCP server, tool registration | Pre-req, Phase 1 | ✅ Done |
| `src/core/creatorMode.js` | Creator mode logic | Pre-req | ✅ Done |
| `src/core/AuthManager.js` | Auth, credits | Pre-req, Phase 1 | ✅ Done |
| `src/core/llm/LLMManager.js` | LLM orchestration | Phase 1 | ✅ Done |
| `src/tools/extract/extractStructured.js` | Structured extraction tool | Phase 1 | ✅ Done |
| `src/tools/search/searchWeb.js` | Search tool (import fix) | Pre-req | ✅ Done |
| `bin/cli.js` | CLI entry point (NEW) | Phase 2 | ❌ Not started |
| `src/cli/` | CLI infrastructure (NEW) | Phase 2 | ❌ Not started |
| `skills/` | User-facing skill files (NEW) | Phase 3 | ❌ Not started |
| `src/skills/SkillInstaller.js` | Skill installer (NEW) | Phase 3 | ❌ Not started |
| `setup.js` | Setup wizard | Phase 3 | ❌ Not started |
| `package.json` | Dependencies, bin entries | All phases | ⏳ Phase 1 done |

## Existing Code to Reuse

| Component | Location | Reused For |
|-----------|----------|------------|
| `LLMManager.generateCompletion()` | `src/core/llm/LLMManager.js:100` | Structured extraction |
| `analyzeRelevance()` pattern | `src/core/llm/LLMManager.js:233` | extractStructured method template |
| `fallbackRelevanceAnalysis()` | `src/core/llm/LLMManager.js:342` | fallbackStructuredExtraction template |
| Tool `execute()` methods | All tool classes | CLI ToolAdapter wrapping |
| `AuthManager.checkCredits()` | `src/core/AuthManager.js` | CLI AuthAdapter |
| `configureMcpClients()` | `setup.js` | Skills agent detection |
| `getToolConfig()` | `src/constants/config.js` | CLI tool initialization |

## What's Next

**Immediate priority:** Phase 2 (CLI Layer) — this unlocks CrawlForge for non-MCP users, CI/CD pipelines, and scriptable workflows. The pre-requisite work (creatorMode extraction) was specifically done to enable CLI tool reuse without triggering MCP server startup.

**Branch:** `crawlforge-cli-upgrade` (created, no CLI work committed yet)

**Key dependencies resolved:**
- Tool classes can now be imported independently (creatorMode extracted)
- ExtractStructuredTool available for `crawlforge-cli extract` command
- All 20 tools verified and production-ready

---

## End-to-End Verification Plan

After all phases complete:
1. `npm start` — MCP server runs, 20 tools listed ✅ (verified)
2. `npm test` — MCP protocol compliance passes ✅ (verified)
3. `crawlforge-cli --help` — CLI shows all commands
4. `crawlforge-cli scrape https://example.com` — returns content
5. `crawlforge-cli search "test" --json | jq .` — piping works
6. `crawlforge-cli stealth https://example.com` — stealth mode via CLI
7. Test `extract_structured` via Claude Code MCP tool call ✅ (verified)
8. `npx crawlforge-setup --skills` — installs skills
9. All 20 MCP tools work via Claude Code and Cursor ✅ (verified)
10. Run `node test-tools.js` — full tool validation ✅ (20/20 tools passing)

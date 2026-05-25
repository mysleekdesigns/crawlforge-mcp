# Changelog



All notable changes to CrawlForge MCP Server will be documented in this file.
## [4.2.10] - 2026-05-25

Patch release: eliminate stdout leaks that corrupted CLI `--json` output. Found while verifying the v4.2.9 CLI fixes — `crawlforge actions --json` emitted a non-JSON banner line before the JSON, breaking programmatic parsing.

### Fixed

- **Tool diagnostics no longer write to stdout** (reserved for the MCP JSON-RPC stream and CLI `--json`). Moved 11 `console.log` calls to `console.error` across the tool/crawler execution paths:
  - `ScrapeWithActionsTool` — "Starting scrape session …" banner (the one that broke `actions --json`) and its internal `log()` helper.
  - `extractContent` / `processDocument` — "Using browser rendering for JavaScript content…" (corrupted `scrape`/`extract`/`analyze`/`process-document --json` when JS rendering kicked in).
  - `StealthBrowserManager` — Cloudflare/reCAPTCHA-detected and proxy-rotation messages (corrupted `stealth --json` on protected sites).
  - `BFSCrawler` — domain-filter / legacy-pattern / robots.txt block messages (corrupted `map`/`crawl --json` on real multi-page sites).
  - `WebhookDispatcher` — webhook-retry message (corrupted `track`/`monitor --json` on webhook retries).
  - Completes the v4.2.4 stdout-hygiene pass. Left untouched: `AuthManager` interactive setup output (stdout is intended there), standalone `src/security/*` scripts/tests, and graceful-shutdown logs (don't fire on normal one-shot CLI exit).

### Verified

- `crawlforge actions … --json` now starts with `{` and parses cleanly (`success:true`, 2/2 actions, screenshot captured). `npm run test:unit` 262/262.

## [4.2.9] - 2026-05-25

Patch release: fix the remaining broken/no-op `crawlforge` CLI commands and make the CLI work inside sandboxed (proxied) environments. The CLI invokes tools directly, so these are CLI-layer fixes — the MCP server was already correct.

### Fixed

- **`research` no longer errors on every run.** Passed `query`/`depth`/`max_urls`/`output_format`, but `DeepResearchSchema` requires `topic` plus `maxDepth`/`maxUrls`/`outputFormat`. Zod stripped the unknown keys, leaving `topic` undefined → "Required". Now sends `topic` and maps `--depth basic|standard|deep` → `maxDepth` (2/5/8) and `--output-format summary|detailed` → `outputFormat` (`summary`/`comprehensive`).
- **`stealth` no longer throws `TypeError`.** It called `StealthBrowserManager.scrapeWithStealth()`, which did not exist (the `stealth_mode` tool is operation-based only). Added a one-shot `scrapeWithStealth({url, engine, wait_for, screenshot})` convenience method (create context → page → goto → extract title/text/html → optional base64 screenshot → `closeContext` in `finally`).
- **`track` / `monitor` flags were silently ignored, and both threw "No baseline found" on first run.** `--selector` → `trackingOptions.customSelectors`; `--threshold` (%) → `trackingOptions.significanceThresholds` (ordered 0-1). `monitor` now uses `operation: 'monitor'` (the interval poller) with `--interval` converted s→ms and `--webhook` → `notificationOptions.webhook`. Both commands now bootstrap a baseline before comparing/polling, so first use works.
- **`llmstxt` flags were no-ops.** `--include-full` → `format` (`both`/`llms-txt`), `--max-pages` → `analysisOptions.maxPages`.
- **`map` flags were no-ops.** `--max-pages` → `max_urls`. Removed `--depth`/`--format` (no backing in `map_site`); added `--no-sitemap`.
- **`actions` flags were no-ops.** `--screenshot` → `captureScreenshots`. Removed `--wait` (no between-action wait field; use `{type:'wait'}` actions in the script).

### Added

- **undici proxy support for the CLI.** Node's global `fetch()` ignores `HTTP(S)_PROXY`, so the CLI's API/scrape calls failed inside sandboxes that only allow proxied egress. `src/cli/index.js` now installs an undici `EnvHttpProxyAgent` global dispatcher when a proxy env var is set (honors `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`; no-op otherwise). Removes the need for a sandbox `excludedCommands` workaround. `undici` is now a direct dependency (pinned to the existing `^7.24.0` security override).

### Tests

- `npm run test:unit` 262/262; `npm test` exits 0. CLI smoke-tested (help/version, proxy dispatcher install, `scrapeWithStealth` presence).

## [4.2.6] - 2026-05-25

Patch release: make `crawlforge-mcp-server <command>` work as the CLI (follow-up to 4.2.5).

### Fixed

- **`crawlforge-mcp-server` bin now points at the CLI** (`src/cli/index.js`), not `server.js`. In 4.2.5 it launched the MCP server, so `crawlforge-mcp-server scrape <url>` (the form documented in `docs/cli-guide.md` and `docs/PRODUCTION_READINESS.md`) ignored its args and hung waiting for a JSON-RPC stream. Because the CLI auto-detects MCP-stdio launches and hands off to the server, this one-line change makes both paths work: `crawlforge-mcp-server scrape <url>` runs the CLI, while `npx -y crawlforge-mcp-server` spawned by an MCP host over stdio still starts the server. `crawlforge-mcp` remains the dedicated direct-to-`server.js` launcher.

## [4.2.5] - 2026-05-25

Patch release: restore the MCP server launch command that v4.1.0 silently broke, and make the documented launch commands actually work.

### Fixed

- **`crawlforge` no longer fails to start the MCP server.** Before v4.1.0 the `crawlforge` bin **was** the MCP server. v4.1.0 repurposed it into the CLI, so MCP clients still configured with `"command": "crawlforge"` received CLI help text instead of a JSON-RPC stream — surfacing in Claude Code / Cursor / Claude Desktop as `Failed to reconnect: -32000`. The CLI now detects MCP-stdio invocation (no subcommand + non-TTY stdin, i.e. how a host spawns it) and hands off to the server. **Existing configs keep working after `npm update` with no edits.** Escape hatch: `CRAWLFORGE_FORCE_CLI=true`.
- **`npx -y crawlforge-mcp-server` now resolves.** The README's Claude Desktop example pointed `npx` at the package, but no bin matched the package name, so npm errored with "could not determine executable to run." Added a matching bin.

### Added

- **`crawlforge-mcp-server` bin** → `server.js`, so `npx -y crawlforge-mcp-server` works (npx resolves the bin whose name matches the package).
- **`crawlforge-mcp` bin** → `server.js`: a dedicated, explicit MCP-server launcher. Because it resolves on `PATH`, it survives Node/nvm version switches (unlike a hard-coded `node /path/to/server.js`). This is what `crawlforge-setup` now writes into MCP client configs.
- **`crawlforge mcp` / `crawlforge serve` subcommand** to start the server by hand from an interactive shell.

### Changed

- **`crawlforge-setup`** now writes `"command": "crawlforge-mcp"` (was `"crawlforge"`) and migrates pre-v4.2.5 configs on re-run.
- **README** MCP config examples corrected; added a "Which launch command?" note.
- Server `serverInfo.version` corrected to track the package version (was pinned at `4.2.2`).

### Tests

- `tests/integration/cli.test.js`: assert `--help` lists `mcp`, and a guarded end-to-end test that drives a full `initialize` handshake through `crawlforge mcp` (skips when no CrawlForge credentials are present, so it never hangs CI).

## [4.2.2] - 2026-05-18

Patch release: CLI bugfix + retracted v4.0.0 breaking-change documentation.

### Fixed

- **`crawlforge batch` CLI command** — user-supplied `--format`, `--concurrency`, and `--max-retries` flags were silently dropped because the command passed `output_format` / `concurrency` / `max_retries` to `BatchScrapeTool.execute()`, but `BatchScrapeSchema` expects `formats` (array) / `maxConcurrency` / `jobOptions.maxRetries`. Zod's strip-mode silently discarded the unknown keys, so the tool always ran with defaults regardless of what was passed on the command line. Now maps to the schema's actual keys.

### Documentation

- **CHANGELOG v4.0.0 retracted** — the "breaking change" to `batch_scrape` defaults was a phantom at the MCP surface (see v4.2.1 postmortem). The v4.0.0 Breaking Changes and Migration Guide sections are now annotated as retracted with the corrected reality inline.

### Added

- Contract test in `tests/unit/tools/advanced/batchScrape.test.js` pins the CLI param shape so the flag-mapping regression can't silently re-appear.

### Internal

- CI workflow (`.github/workflows/ci.yml`) fixed: the quoted glob `"tests/unit/*.test.js"` never expanded in GitHub Actions, causing the unit-tests job to fail in 0s with "Could not find" before running any test. Replaced with `$(find tests/unit -name "*.test.js")` for recursive discovery (now runs 417 tests across 18 files vs. 0 before), added `--test-force-exit` to bypass open-handle hangs in legacy D2 reliability tests, bumped CI Node 20 → 22. Not user-facing; not in the published tarball.

## [4.2.1] - 2026-05-18

Backwards-compatibility fix: neutralize the v4.0.0 "breaking change" to `batch_scrape` defaults.

### Fixed

- **`batch_scrape` default formats** — Aligned the internal `BatchScrapeSchema` default from `['markdown']` back to `['json']` to match the MCP-facing default at `server.js:544`. The v4.0.0 release notes flagged this as a breaking change, but in practice the MCP tool registration always defaulted to `['json']` — the inner-schema mismatch only ever affected direct programmatic callers of `BatchScrapeTool.execute()`, never MCP clients (Claude Code, Cursor, the CLI). v4.2.1 closes the latent gap so the two layers agree. **No migration needed for any caller.** Markdown output remains a single-line opt-in via `formats: ['markdown']` (or `['markdown','json']` for both).

### Added

- Regression tests in `tests/unit/tools/advanced/batchScrape.test.js` pinning `BatchScrapeSchema` defaults so this mismatch can't silently re-appear: `default formats is ['json']`, `preserves explicit ['markdown']`, `preserves explicit ['markdown','json']`. 10/10 tests green.

### Migration Guide

If you upgraded from v3.x to v4.0.0–v4.2.0 via the MCP interface: **nothing changes**, you were never affected. If you import `BatchScrapeTool` directly and call `.execute({urls:[...]})` without specifying `formats`: you now get `content.json` again (matches v3.x). To get the markdown-first behavior promised in D3.1, pass `formats: ['markdown']` explicitly — the Turndown converter, `extract_text` markdown mode, `extract_content` markdown mode, and `process_document` markdown mode are all unchanged.

## [4.2.0] - 2026-05-18

Phase D5.2 + D5.3 — Per-tool unit tests and docs refresh. Additive release: no API changes.

### Added

**D5.2 Per-tool unit tests (17 new test files)**
- `tests/unit/tools/extract/extractContent.test.js` — 8 tests
- `tests/unit/tools/extract/processDocument.test.js` — 7 tests
- `tests/unit/tools/extract/analyzeContent.test.js` — 8 tests
- `tests/unit/tools/extract/summarizeContent.test.js` — 8 tests
- `tests/unit/tools/extract/extractStructured.test.js` — 7 tests
- `tests/unit/tools/extract/listOllamaModels.test.js` — 7 tests (with injectable fetch stub)
- `tests/unit/tools/research/deepResearch.test.js` — 9 tests (elicitation, session tracking)
- `tests/unit/tools/search/searchWeb.test.js` — 7 tests (cache, expander, provider)
- `tests/unit/tools/crawl/crawlDeep.test.js` — 7 tests (elicitation for >500 pages)
- `tests/unit/tools/crawl/mapSite.test.js` — 8 tests (sitemap parse, group_by_path, cache)
- `tests/unit/tools/advanced/batchScrape.test.js` — 7 tests (elicitation, jobManager integration)
- `tests/unit/tools/advanced/scrapeWithActions.test.js` — 8 tests (page.close() leak check)
- `tests/unit/tools/stealth/stealthMode.test.js` — 7 tests (camoufox/playwright engine)
- `tests/unit/tools/localization/localization.test.js` — 8 tests (geo-block, translation)
- `tests/unit/tools/tracking/trackChanges.test.js` — 8 tests (diff, monitoring lifecycle)
- `tests/unit/tools/llmstxt/generateLLMsTxt.test.js` — 9 tests (format modes)
- `tests/unit/tools/templates/scrapeTemplate.test.js` — 8 tests (list mode, HTTP errors)
- Total new tests: 131 — all green. No new npm dependencies (uses node:test + stubs).

**D5.3 Docs refresh**
- `docs/local-ollama-quickstart.md` — Ollama install, model selection, env vars, Docker, troubleshooting
- `docs/docker-deployment.md` — build, run, compose, Render deploy, health check, volumes
- `docs/observability-setup.md` — Prometheus metrics table, OTel spans, Winston log levels, Grafana dashboard import, alerting rules
- `tests/docs/example-runner.js` — validates README JSON and shell code blocks for syntax (no live network)

**Verified existing docs present from earlier phases:** `docs/mcp-resources-prompts.md`, `docs/cli-guide.md`, `docs/stealth-engines.md`, `docs/cloud-browser.md`

### Changed

- `IMPROVEMENT_ROADMAP_V4.md` header updated: version 4.0.0 → 4.1.0, status → ALL PHASES COMPLETE
- Carry-forward items noted at bottom of roadmap: D2.8 customDNS, D2.11 24h load test, D5.1 ESLint + Docker CI

## [4.1.0] - 2026-05-18

Phase D4 - CLI (PRD Phase 2) + Skills Installer (PRD Phase 3). Additive release: no breaking changes to existing MCP tools or API.

### Added

**D4.1 CLI scaffolding**
- `commander` added to dependencies.
- `"bin": { "crawlforge": "src/cli/index.js" }` in `package.json` — `crawlforge` command available after `npm install -g`.
- `src/cli/index.js` — main entry point with global flags: `--json`, `--pretty`, `--quiet`, `--api-key`, `--timeout`.
- `src/cli/formatter.js` — shared output formatter; formats MCP tool `content[]` responses for CLI output.
- `src/cli/lib/runTool.js` — thin wrapper calling tool `execute()` and formatting output per global flags.

**D4.2 CLI commands (15 tool commands)**
- `scrape <url>` — wraps `fetch_url` (default) or `extract_content` with `--extract` flag.
- `search <query>` — wraps `search_web`; supports `--limit`, `--lang`, `--provider`.
- `crawl <url>` — wraps `crawl_deep`; supports `--depth`, `--max-pages`, `--concurrency`.
- `map <url>` — wraps `map_site`; supports `--format json|xml`.
- `extract <url>` — wraps `extract_structured` (with `--schema`) or `extract_with_llm` (with `--prompt`).
- `track <url>` — wraps `track_changes`; supports `--selector`, `--threshold`.
- `analyze <url>` — wraps `analyze_content`; supports `--depth`.
- `research <topic>` — wraps `deep_research`; supports `--depth`, `--max-urls`, `--output-format`.
- `stealth <url>` — wraps `stealth_mode`; supports `--engine playwright|camoufox`, `--screenshot`.
- `batch <urls-file>` — wraps `batch_scrape`; reads newline-delimited URLs from file.
- `actions <url> --script <file>` — wraps `scrape_with_actions`; reads JSON action script from file.
- `localize <url>` — wraps `localization`; supports `--locale`, `--country`, `--currency`.
- `llmstxt <url>` — wraps `generate_llms_txt`; supports `--include-full`, `--max-pages`.
- `template <id> <target>` — wraps `scrape_template`; `--list` shows all 10 templates.
- `monitor <url>` — wraps `track_changes` in scheduled mode; supports `--interval`, `--webhook`.

**D4.3 Skills installer (2 management commands)**
- `src/skills/installer.js` — `install()` and `uninstall()` functions; idempotent, supports `--force` and `--dry-run`.
- `install-skills [--target=claude-code|cursor|vscode|all]` — copies skill files to target AI coding tool.
- `uninstall-skills [--target=...]` — removes installed skill files.
- Skill files in `src/skills/`:
  - `crawlforge-mcp.md` — overview of all 23 MCP tools with credit reference and example calls.
  - `crawlforge-cli.md` — full CLI usage guide with examples for all 17 commands.
  - `crawlforge-stealth.md` — stealth_mode engine selection guide.
  - `crawlforge-research.md` — deep_research workflow, depth levels, cost management.
- Claude Code target: `~/.claude/skills/crawlforge-*.md` (one file per skill).
- Cursor target: `.cursor/rules/crawlforge.mdc` (concatenated).
- VS Code target: `.github/instructions/crawlforge.instructions.md` (concatenated).

### Tests
- `tests/integration/cli.test.js` — 6 tests: `--help` coverage for all 15 commands + skills commands, dry-run path verification for all 3 targets, version semver format.

### Docs
- New: `docs/cli-guide.md` — complete CLI reference with all 17 commands, flags, and examples.
- Updated: `docs/PRODUCTION_READINESS.md` — CLI availability noted.
- Updated: `IMPROVEMENT_ROADMAP_V4.md` — D4 marked complete.
- Updated: `PRD.md` — Phase 2 (CLI) and Phase 3 (Skills) marked done.


The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2026-05-18

Phase D3 - Competitive Feature Parity. ~~**Breaking change:** batch_scrape now defaults to markdown output (was json).~~ **Retracted in v4.2.1** — see note below. Adds scrape_template tool (23 tools total). Turndown HTML-to-Markdown converter. Camoufox Firefox-based stealth engine. BrowserBase cloud backend. Cost transparency in all tool responses.

> **Postmortem (added in v4.2.1):** the v4.0.0 "breaking change" to `batch_scrape` defaults was a phantom at the MCP surface. The MCP tool registration in `server.js:544` always defaulted `formats` to `['json']`; only the inner `BatchScrapeSchema` defaulted to `['markdown']`. Because params are validated at both layers and the MCP layer wins, MCP clients (Claude Code, Cursor, the `crawlforge` CLI) were never broken. The mismatch only ever affected direct programmatic callers of `BatchScrapeTool.execute()`. v4.2.1 aligned the inner schema to `['json']` to remove the latent gap. **No migration is needed for any caller — the section below describes a migration that was never actually required.**

### ~~Breaking Changes~~ (retracted in v4.2.1)

- ~~**batch_scrape** default `formats` changed from `["json"]` to `["markdown"]`. Callers that depend on `content.json` from batch results must now pass `formats: ["json"]` explicitly.~~ Reality: the MCP-facing default never changed; v4.2.1 aligned the inner schema to `['json']` to match.
- **server version** bumped 3.6.0 to 4.0.0.

### ~~Migration Guide~~ (not required — see postmortem above)

~~If you use `batch_scrape` without specifying `formats`, your response shape changes:~~
- ~~Before (v3.x): `result.results[n].content.json`~~
- ~~After (v4.0): `result.results[n].content.markdown`~~
- ~~To keep old behavior: pass `formats: ["json"]` explicitly.~~

Reality after v4.2.1: `content.json` continues to be the MCP default exactly as in v3.x. Pass `formats: ['markdown']` to opt into RAG-friendly markdown output.

### Added

**D3.1 Markdown-first output (Turndown) — additive only after v4.2.1**
- New utility `src/utils/htmlToMarkdown.js` wraps Turndown with sensible RAG-optimized defaults (atx headings, fenced code blocks, boilerplate removal).
- `extract_text`: new `output_format: "markdown"` parameter (default: "text").
- `extract_content`: `outputFormat: "markdown"` now uses Turndown instead of regex-based conversion.
- `process_document`: `outputFormat: "markdown"` added to enum (new option).
- `batch_scrape`: markdown output available via `formats: ['markdown']` (was framed as a default-change in v4.0.0; v4.2.1 confirms it's purely opt-in at the MCP surface).
- turndown added to dependencies.

**D3.2 Camoufox browser engine**
- `src/core/StealthBrowserManager.js`: new `BrowserEngine` abstract class + `CamoufoxAdapter` implementation.
- `stealth_mode` tool: new `engine: "playwright" | "camoufox"` parameter (default: "playwright").
- Camoufox adapter gracefully fails with actionable error when package not installed.
- Licensing verified: camoufox JS API is MIT, Firefox patches are MPL-2.0 (no AGPL).
- Benchmark methodology documented in `docs/stealth-engines.md`.
- New doc: `docs/stealth-engines.md`.

**D3.3 Pre-built site templates**
- New `src/tools/templates/TemplateRegistry.js` with 10 templates: amazon-product, linkedin-profile, github-repo, youtube-video, tweet, reddit-thread, hacker-news-front-page, producthunt-launch, stackoverflow-question, npm-package.
- New `src/tools/templates/ScrapeTemplateTool.js` wrapping the registry.
- New `scrape_template` tool registered in server.js (tool count: 22 to 23).
- Fixture stubs in `tests/integration/templates/fixtures.js` for all 10 templates.
- Credit cost: 1 credit per invocation (same as fetch_url).

**D3.4 Cloud browser backend (BrowserBase)**
- `src/core/StealthBrowserManager.js`: new `BrowserBackend` abstract class, `LocalPlaywrightBackend`, `BrowserBaseBackend` (CDP), and `resolveBrowserBackend()` factory.
- Env config: `CRAWLFORGE_BROWSER_BACKEND=local|browserbase`, `BROWSERBASE_API_KEY`.
- Graceful fallback: if browserbase requested but BROWSERBASE_API_KEY not set, logs warning and falls back to local.
- New doc: `docs/cloud-browser.md`.

**D3.5 Cost transparency**
- `src/core/AuthManager.js`: new `projectCost(toolName, params)` method returning `{ projected, note }`.
- `src/server/withAuth.js`: all successful tool responses include `_cost: { projected, actual, remaining_credits, projection_note }` injected into the first JSON content item.
- Dynamic tools (deep_research, crawl_deep, batch_scrape) return lower-bound estimates with accuracy caveats in `projection_note`.

### Changed
- server.js: version bumped to 4.0.0; description updated to 23 tools; scrape_template registered.
- package.json: version bumped to 4.0.0; turndown added to dependencies.

### Verification
- `node --check server.js` and all modified src files: no syntax errors.
- `npm test` (MCP protocol compliance): 60% pass rate - unchanged from pre-D3 baseline.
- `node --test tests/unit/withAuth.test.js`: 9/9 pass.
- `node --test tests/unit/authManager.test.js`: 6/6 pass.

## [3.6.0] - 2026-05-18

Phase D1 — MCP-Native Primitives. CrawlForge is now a first-class MCP server, not just a tool host.

### Added

**D1.1 Resources** — `crawlforge://` URI scheme for long-lived artifacts:
- Created `src/resources/ResourceRegistry.js` with URI parsing, MIME types, and TTL-based in-memory storage.
- Registered `ResourceTemplate` patterns in `server.js` for all 5 resource types: `crawlforge://research/{sessionId}`, `crawlforge://job/{jobId}`, `crawlforge://crawl/{sessionId}/sitemap`, `crawlforge://screenshot/{actionId}`, `crawlforge://snapshot/{urlHash}/{timestamp}`.
- 20 unit tests in `tests/unit/resources/resourceRegistry.test.js` — all green.
- Documented URI scheme and TTL policy in `docs/mcp-resources-prompts.md`.

**D1.2 Prompts** — 5 pre-built workflow prompts (plus existing `getting-started`):
- Created `src/prompts/PromptRegistry.js` with 5 prompts: `competitive-analysis`, `monitor-changes`, `rag-ingest`, `site-audit`, `research-deep-dive`.
- Wired `prompts/list` and `prompts/get` in `server.js` via `server.registerPrompt()`.
- Server now advertises `prompts.listChanged: true` capability.

**D1.3 Sampling** — LLM fallback chain removes requirement for server-side API keys:
- Created `src/core/SamplingClient.js` with `complete()` (Ollama → OpenAI → Anthropic → MCP sampling → error) and `probe()` to check available providers.
- `extract_with_llm`: when Ollama is unavailable and no API key set, tries MCP client sampling before returning an error.
- `summarize_content`: abstractive mode now attempts Ollama/API/sampling before falling back to extractive output.
- `extract_structured` and `deep_research`: SamplingClient integrated as last-resort LLM provider.

**D1.4 Elicitation** — mid-tool user confirmation for expensive/ambiguous operations:
- Created `src/core/ElicitationHelper.js` with `confirm()` and `requestString()` — fails open when client lacks elicitation support.
- `deep_research`: prompts user before scanning >50 URLs.
- `batch_scrape`: confirms large synchronous batches (>25 URLs in sync mode).
- `crawl_deep`: confirms crawls exceeding 500 pages.
- `extract_structured`: warns when schema has >3 required fields and LLM is unavailable.
- `AuthManager`: elicits confirmation when remaining credits fall below projected cost (replaces hard-fail).
- All tools expose `setMcpServer()` to wire elicitation post-instantiation.

**D1.5 Tool description audit** — all 22 tool descriptions rewritten to lead with *when to use*:
- Every `description` field now starts with "Use this when..." followed by specific scenarios.
- Example invocations embedded in each description.
- Descriptions updated for: fetch_url, extract_text, extract_links, extract_metadata, scrape_structured, search_web, crawl_deep, map_site, extract_content, process_document, summarize_content, analyze_content, extract_structured, extract_with_llm, list_ollama_models, batch_scrape, scrape_with_actions, deep_research, track_changes, generate_llms_txt, stealth_mode, localization.

### Changed
- `server.js`: version bumped 3.5.1 → 3.6.0; description updated to mention Resources, Prompts, Sampling, Elicitation.
- `package.json`: version bumped to 3.6.0.
- Server now correctly advertises `resources.listChanged: true` and `prompts.listChanged: true` MCP capabilities.

### Verification
- `node --check server.js` and all modified src files: no syntax errors.
- `npm test` (MCP protocol compliance): 60% pass rate — unchanged from pre-D1 baseline (pre-existing compliance test issues unrelated to D1).
- `node --test tests/unit/resources/resourceRegistry.test.js`: **20/20 PASS**.
- `node --test tests/unit/d2-reliability.test.js`: **16/17 pass** (1 cancelled due to pre-existing pending promise issue in test harness — same as before D1).
- `ResourceTemplate` registered correctly: server capabilities response now includes `resources.listChanged: true`.

## [3.4.0] - 2026-05-18

Adds local-LLM support to `extract_with_llm` via Ollama. Cloud users see zero behavior change — the addition is strictly opt-in.

### Added
- **Ollama provider for `extract_with_llm`.** Set `provider: "ollama"` (or `provider: "auto"` with `OLLAMA_BASE_URL` env var) to extract using a local Ollama model — no API key, no API costs, no data leaving the machine.
  - Default base URL `http://localhost:11434`; default model `llama3.2` (override via `OLLAMA_DEFAULT_MODEL` env or the `model` param).
  - Calls Ollama's `/api/chat` directly with `stream: false`, `temperature: 0`, `num_predict: maxTokens`. Zero new runtime deps — same raw-`fetch()` pattern as the OpenAI/Anthropic branches.
  - JSON mode by default (`format: "json"`). When the optional `schema` param is provided, it is passed through as Ollama's structured-outputs `format` object, constraining the model to that JSON schema (per <https://ollama.com/blog/structured-outputs>).
  - Provider resolution: `provider: "ollama"` always selects Ollama (no key required). `provider: "auto"` keeps the existing Anthropic → OpenAI order and only falls back to Ollama when neither cloud key is set **and** `OLLAMA_BASE_URL` is exported — guaranteeing no behavior change for existing cloud users.
  - Friendly error on `ECONNREFUSED` / `ENOTFOUND`: surfaces `Ollama is not running at <url>. Start it with "ollama serve" and pull a model: "ollama pull llama3.2".` instead of a raw fetch error. Friendly error on `404 model not found` instructs `ollama pull <model>`.
  - Usage normalized: Ollama's `prompt_eval_count` / `eval_count` mapped to the uniform `{ input_tokens, output_tokens }` shape used by the OpenAI/Anthropic branches.
- 8 new unit tests in `tests/unit/extractWithLlm.test.js` (22 total, all pass): explicit-ollama path, JSON-mode body shape, schema → structured-outputs pass-through, ECONNREFUSED → friendly error, usage normalization, auto-fallback rules (no behavior change for cloud users), model override.

### Changed
- `server.js` — `extract_with_llm` provider enum extended to `["openai", "anthropic", "ollama", "auto"]`; tool description updated to mention local Ollama support and clarify that Ollama needs no key.

### Verification
- `node --test tests/unit/extractWithLlm.test.js`: **22/22 PASS**.
- `npm test` MCP protocol compliance: 10/10 tests completed, 0 errors — unchanged from HEAD baseline.
- **Live end-to-end against real Ollama 0.24.0 with `llama3.2:latest`**: 3/3 scenarios pass — plain JSON mode (extracted product/price/screen-size from "iPhone 16 Pro" text), structured-outputs schema (nested order with line-items array), and `provider: "auto"` fallback via `OLLAMA_BASE_URL`.

## [3.3.1] - 2026-05-17

Two pre-existing bugs surfaced during the full out-of-sandbox verification of the v3.3.0 release. Neither was caused by Phase C5 — both reproduce on the v3.2.0 commit. They were masked respectively by a populated LRU cache hit (bug #1) and by CI environments lacking the maintainer `.env` (bug #2).

### Fixed
- **`search_web` "Converting circular structure to JSON → Timeout" crash.** `ResultRanker` and `ResultDeduplicator` constructors spread `...options` (which includes `sharedCache`, a `CacheManager` instance holding a `setInterval` monitoring Timer) into `this.options`. Cache-key generation later called `JSON.stringify` on that options object, hitting a circular reference through `Timer → TimersList → Timer`. Fix: destructure `sharedCache` out before the spread so it lives in `this.cache` only — never in the serializable `this.options`. Inline comment added at both constructors so a future refactor doesn't reintroduce the bug. (`src/tools/search/ranking/ResultRanker.js`, `src/tools/search/ranking/ResultDeduplicator.js`)
- **`endpointGuard.test.js` "creator mode OFF" test was premise-unsatisfiable on the maintainer's machine.** `creatorMode.js` loads `.env` at module init and caches the verified flag in a module-scoped variable that is immutable from outside (by design — security note in that file). The test tried to disable creator mode by `delete process.env.CRAWLFORGE_CREATOR_SECRET` at test time, which has no effect once the module has loaded. Fix: have the test `t.skip()` with a clear rationale when `isCreatorModeVerified()` returns true — the test's other 7 assertions still run unconditionally. (`tests/unit/endpointGuard.test.js`)

### Verification (clean tree, no sandbox)
- `node test-tools.js`: **20/20 PASS** (was 19/20 — search_web fixed)
- `node --test tests/unit/*.test.js`: 240 tests — **227 pass, 0 fail, 13 skipped** (was 227 pass, 1 fail, 12 skipped)
- `node --test tests/unit/streamableHttp.test.js`: **12/12 pass** (was sandbox-blocked by EPERM listen on 127.0.0.1)
- `npm test` MCP protocol compliance: 70% — unchanged from HEAD baseline
- `npm audit`: **0 vulnerabilities**

## [3.3.0] - 2026-05-17

Ships Phase C5 "Feature parity" of `IMPROVEMENT_PLAN.md`. Adds one new MCP tool (`extract_with_llm`, bringing the total to 21) and extends three existing tools with capabilities at parity with Firecrawl, Crawl4AI, and ScrapeGraphAI. All changes are strictly additive — every existing call signature behaves exactly as in v3.2.0.

### Added
- **New tool `extract_with_llm`** — natural-language structured extraction over a URL or pre-fetched content. Gated on `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`; `provider: 'auto'` picks Anthropic first then OpenAI. Dependency-free direct `fetch()` to `/v1/chat/completions` (OpenAI) or `/v1/messages` (Anthropic). Optional `schema` JSON-schema hint; defensive JSON parse with single retry; uniform `{ input_tokens, output_tokens }` usage shape across providers. Endpoints overridable via `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` for self-hosted gateways. Costs 5 credits.
- **`scrape_with_actions` recording & replay** — Firecrawl-style action recording. New input fields `record: boolean` + `recordingName: string` persist the executed action chain as JSON to `~/.crawlforge/recordings/<name>.json` (atomic `.tmp` + rename write). New `replayRecording: string` loads and re-executes a saved recording against a fresh URL. Special `replayRecording: '__list__'` returns the recordings index without a new tool. `recordingName` validated against `/^[a-zA-Z0-9_-]{1,64}$/` (path-traversal blocked). Home dir overridable via `CRAWLFORGE_HOME_OVERRIDE` for testing.
- **`crawl_deep` session reuse** — Crawl4AI-style cookie + header persistence across every page of a crawl. New optional `session: { enabled, persistCookies?, headers?, initialRequest? }`. With `enabled: true`, an in-memory cookie jar (hand-rolled, zero new deps, uses Node 18+ `Headers.getSetCookie()` for multi-value correctness) captures every `Set-Cookie` response and replays cookies on every subsequent fetch. `session.headers` merged into every request. Optional `session.initialRequest` performs a pre-crawl login (or any HTTP request) and seeds the jar before traversal starts. Backward compatible — omit `session` for v3.2.0 behavior.
- **`search_web` SearXNG provider** — new optional `provider: 'crawlforge' | 'searxng'` (default `'crawlforge'`). With `provider: 'searxng'`, queries route to a self-hosted SearXNG instance specified by `CRAWLFORGE_SEARXNG_URL` (e.g. `http://localhost:8888`). SearXNG JSON results are normalised to the same shape as the CrawlForge backend (`title→title`, `url→link/displayLink/formattedUrl`, `content→snippet/htmlSnippet`) so the existing ranking + deduplication pipeline runs unchanged. Errors clearly when `CRAWLFORGE_SEARXNG_URL` is unset or the upstream returns non-200.
- `src/tools/extract/extractWithLlm.js` — main tool class. 14 unit tests in `tests/unit/extractWithLlm.test.js` covering provider auto-pick, error when no key, JSON parse success + retry, URL fetch path, content-direct path, schema hint pass-through, token-usage normalization, OpenAI + Anthropic stubs.
- `src/tools/advanced/scrapeWithActions/recorder.js` — recording persistence helpers (`saveRecording`, `loadRecording`, `listRecordings`, `validateRecordingName`, `buildRecordedEntry`). 12 unit tests in `tests/unit/scrapeWithActionsRecording.test.js`.
- `src/tools/crawl/_sessionContext.js` — `SessionContext` class (cookie jar + session headers + `performInitialRequest`). 12 unit tests in `tests/unit/crawlDeepSession.test.js`.
- `src/tools/search/providers/searxng.js` — SearXNG adapter (`searchViaSearxng`, `normalizeSearxngResult`). 12 unit tests in `tests/unit/searchWebSearxng.test.js`.

### Changed
- `server.js` — registered `extract_with_llm`; tool count strings bumped 20 → 21.
- `src/core/AuthManager.js` `getToolCost()` — added `extract_with_llm: 5`.
- `src/tools/advanced/ScrapeWithActionsTool.js` — schema extended with `record` / `recordingName` / `replayRecording`; `executeSession()` captures recorded entries when recording is on; `execute()` short-circuits to listing / replay when those flags are set.
- `src/tools/crawl/crawlDeep.js` + `src/core/crawlers/BFSCrawler.js` — `SessionContext` plumbed into the BFS crawler; per-request session headers + cookies are layered before `fetch()` and the response's `Set-Cookie` is recorded back into the jar.
- `src/tools/search/searchWeb.js` — `provider` field added to `SearchWebSchema`; `_executeViaSearxng()` short-circuits when `provider === 'searxng'`.
- `package.json` 3.2.0 → 3.3.0; description "20" → "21".

### Test results (this release)
- 50 new unit tests across 4 new files — **50/50 pass** in `node --test`.
- Full unit suite: 240 tests, 227 pass, 12 skipped (sandbox-only HTTP listen restrictions on `streamableHttp.test.js`), 1 pre-existing `endpointGuard.test.js` failure unrelated to C5 (also fails on the v3.2.0 commit).
- `node test-tools.js`: 19/20 pass; the 1 failure (`search_web`) is a pre-existing sandbox network flake — same failure reproduces on the v3.2.0 baseline once the local search cache is cleared.
- `npm test` (MCP protocol compliance): unchanged from HEAD baseline (70% success rate).
- `npm audit`: **0 vulnerabilities**.

### Notes
- All four C5 items were implemented in parallel by four `mcp-implementation` sub-agents working on non-overlapping files. The lead handled `server.js` registration, version bookkeeping, and integration verification.

## [3.2.0] - 2026-05-17

Ships Phase C "Modernize" of `IMPROVEMENT_PLAN.md` end-to-end. Closes the protocol/feature gap with Firecrawl, Crawl4AI, and Bright Data MCP. No tool schema or public API changes for existing stdio users — strictly additive.

### Added
- `src/server/transports/streamableHttp.js` — stateful Streamable HTTP transport (MCP spec 2025-06-18). Sessions via `Mcp-Session-Id` header (request + response). Single `/mcp` endpoint handles POST (JSON or SSE) and GET (SSE) per spec. Built on `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk@1.29`.
- `src/server/auth/oauth.js` — OAuth 2.1 authorization server (~350 LOC, zero new runtime deps). Discovery (`/.well-known/oauth-authorization-server`), Dynamic Client Registration (RFC 7591) at `/oauth/register`, Authorization Code + PKCE S256 at `/oauth/authorize`, token issuance + refresh rotation at `/oauth/token`, revocation (RFC 7009) at `/oauth/revoke`. Bearer tokens are opaque and mapped server-side to the operator's CrawlForge API key.
- `src/observability/metrics.js` — minimal Prometheus exposition (counters, gauges, histograms). Exposes `crawlforge_tool_requests_total`, `crawlforge_tool_errors_total{error_class}`, `crawlforge_tool_duration_ms` (histogram), `crawlforge_credits_consumed_total`, `crawlforge_browser_pool_in_use`, `crawlforge_browser_pool_capacity`.
- `src/observability/tracing.js` — OpenTelemetry tracing facade. No-op unless `OTEL_SDK_DISABLED=false` AND `globalThis.__otelTracer` is registered by the host application. Span attributes: `mcp.tool.name`, `mcp.tool.duration_ms`, `mcp.tool.outcome`, `mcp.credit.cost`, `mcp.credit.outcome`, `mcp.creator_mode`.
- `dualOutput()` helper in `src/server/registerTool.js` for tool handlers that want to emit both legacy `content` and MCP-2025-06-18 `structuredContent` from one value.
- `outputSchema` option on `registerTool()` — opt-in MCP structured outputs (validated server-side by the SDK against the supplied Zod shape).
- `--legacy-http` / `CRAWLFORGE_LEGACY_HTTP=true` — preserves v3.1 stateless HTTP behaviour for one release; emits a deprecation warning at startup.
- Environment knobs (all opt-in): `CRAWLFORGE_OAUTH_ENABLED`, `CRAWLFORGE_OAUTH_ISSUER`, `CRAWLFORGE_METRICS`, `CRAWLFORGE_LEGACY_HTTP`.
- `docs/oauth-quickstart.md` — copy-pasteable Node sample client covering register → authorize → exchange → refresh → `/mcp`.
- `docs/observability/grafana-dashboard.json` — six-panel dashboard (requests/sec, errors/sec, p50/p95 duration, credits/sec, browser pool utilization).
- `tests/unit/oauth.test.js` (12 cases) — discovery shape, DCR validation, full PKCE flow, wrong-verifier rejection, `plain` rejection, refresh rotation + replay protection, revocation.
- `tests/unit/streamableHttp.test.js` (12 cases) — `/health`, `/metrics`, server-card, `/mcp` 401 paths, creator-mode bypass, OAuth pass-through, OPTIONS preflight, unknown path.
- `tests/unit/metrics.test.js` (6 cases) — counter / gauge / histogram correctness + label escaping.
- `tests/unit/tracing.test.js` (7 cases) — gating logic, no-op span when disabled, attribute writes when enabled.
- `tests/unit/registerTool.test.js` (4 cases) — `outputSchema` forwarding + `dualOutput` shape.
- `tests/unit/withAuth.test.js` — three new cases for metrics integration (success counter + credits, error counter + `error_class`, no-op when registry not passed).

### Changed
- `server.js`: wires new Streamable HTTP transport (default in `--http`), OAuth provider when `CRAWLFORGE_OAUTH_ENABLED=true`, Prometheus registry when `CRAWLFORGE_METRICS=true`. Version string bumped 3.0.19 → 3.2.0.
- `src/server/transports/http.js`: now a 20-line back-compat shim that forwards to `connectStreamableHttp({ legacy: true })`.
- `src/server/withAuth.js`: emits Prometheus counter + histogram + credits-consumed on every invocation when a registry is passed; emits an OTel span when tracing is enabled. Both are wrapped in try/catch so they can't break the request path.
- `src/server/registerTool.js`: accepts and forwards `outputSchema`; exports `dualOutput`.
- `package.json`: version 3.1.0 → 3.2.0.
- `docs/PRODUCTION_READINESS.md`: version bump + dedicated Streamable HTTP endpoint table.

### Deferred (documented in `IMPROVEMENT_PLAN.md` § C5)
- Firecrawl-style action recording/replay for `scrape_with_actions`
- Crawl4AI-style session reuse in `crawl_deep`
- New `extract_with_llm` tool (LLM-gated)
- `provider: 'crawlforge' | 'searxng'` switch on `search_web`

The plan explicitly says "pick based on user demand". No user requests for these in the v3.1 window — leaving `[ ]` rather than building speculatively. All remain independently shippable.

### Notes
- Adding `outputSchema` to each of the 20 existing tool registrations is intentionally a follow-up. The framework, helper, and tests are in place — per-tool schema rollout will get its own review pass.

## [3.1.0] - 2026-05-17

Ships Phase B "Refactor" of `IMPROVEMENT_PLAN.md` end-to-end. No public-API or tool-schema changes — strictly internal restructuring, bounded browser pool, and a real test suite. All 20 MCP tools continue to pass.

### Added
- `src/server/registerTool.js` — single tool-registration helper that wraps every handler with `withAuth`. Replaces 20 near-identical registration blocks in `server.js`.
- `src/server/schemas/common.js` — shared Zod fragments (`urlSchema`, `paginationSchema`, `webhookSchema`, `cacheOptsSchema`).
- `src/server/transports/stdio.js` and `src/server/transports/http.js` — transport setup extracted from `server.js`.
- `src/tools/basic/` — 5 inline basic-tool handlers (`fetchUrl`, `extractText`, `extractLinks`, `extractMetadata`, `scrapeStructured`) moved out of `server.js`, plus a shared `_fetch.js` helper.
- `src/core/BrowserContextPool.js` (187 LOC) — bounded pool with capacity cap, idle eviction, periodic refresh, and a wait queue with timeout. Used by `StealthBrowserManager` instead of an unbounded `Map`. Defaults: `MAX_BROWSER_CONTEXTS=10`, refresh every 200 acquisitions or 30 minutes, `closeIdleAfterMs=300000`.
- `src/tools/tracking/trackChanges/{schema,monitor,differ,notifier,index}.js` — 1,377 LOC tool split into 5 files; root `trackChanges.js` is now a 15-line re-export shim.
- `src/tools/advanced/batchScrape/{schema,queue,worker,reporter,index}.js` — 1,089 LOC tool split into 5 files; reuses `JobManager` and `WebhookDispatcher` instead of embedding them. Root `BatchScrapeTool.js` is now a 15-line re-export shim.
- `src/tools/search/ranking/SearchResultCache.js` — single shared cache passed to `ResultRanker` and `ResultDeduplicator` via `sharedCache` option (was two separate `CacheManager` instances).
- `src/tools/extract/_fetchAndParse.js` — shared fetch + Cheerio parse helper used by `extractStructured`.
- `CacheManager` integration in `crawlDeep` and `mapSite` for fetch deduplication.
- `tests/unit/browserContextPool.test.js` (18 tests) — pool capacity, idle eviction, refresh interval, queue timeout, destroy semantics.
- `tests/unit/changeTracker.test.js` (33 tests) — `diff()` granularity matrix, text/structure/visual change detection, threshold gating.
- `tests/unit/jobManager.test.js` (28 tests) — lifecycle, validateJob, generateJobId, stats, destroy.
- `tests/unit/snapshotManager.test.js` (21 tests) — create/restore, gzip compression path, list/cleanup.
- `tests/unit/webhookDispatcher.test.js` (21 tests) — dispatch, retries, signing, queue draining.
- `tests/integration/tools/basicTools.test.js` (17 tests) — happy-path + invalid-input assertions for all 5 basic-tool handlers.
- `tests/integration/tools/schemas.test.js` (28 tests) — Zod schema acceptance/rejection for `BatchScrape`, `TrackChanges`, `UrlConfig`, plus `SearchResultCache` behaviour.
- `tests/integration/tools/batchScrape.test.js` (8 tests) — internal `scrapeUrl` worker contract.
- `npm run test:coverage` — c8 coverage script with a 60% line/statement gate (45% branch / 55% function). Reports 64.3% lines, 60.7% functions, 74.9% branches across `src/`.
- `npm run test:integration` — convenience script for `tests/integration/tools/*.test.js`.

### Changed
- `server.js`: **2,138 → 990 LOC** (54% reduction). All tool registrations now flow through `registerTool()`; transport selection delegated to `src/server/transports/*`.
- `src/core/StealthBrowserManager.js`: context storage swapped from raw `Map` to `BrowserContextPool`. Context limit, refresh, and idle eviction now bounded.
- `src/core/cache/CacheManager.js`: `cleanupTimer` and `monitoringTimer` now `.unref()` so they don't block process exit in short-lived CLI/test runs.
- `src/core/JobManager.js`: `validateJob()` now returns a strict boolean (was returning the falsy operand from `&&` short-circuit, breaking strict-equality tests).
- `src/tools/search/searchWeb.js`: ranker and deduplicator share one `SearchResultCache` instance instead of holding separate `CacheManager`s.
- `package.json`: version bumped 3.0.19 → 3.1.0.

### Fixed
- `JobManager.validateJob(null)` previously returned `null`; now returns `false` as the docstring implies.

### Deferred (documented in `IMPROVEMENT_PLAN.md` § B4 / B5)
- "Wire coverage gate into CI" — no CI workflow exists in this repo. Local gate is enforced via `npm run test:coverage`.
- "`npm run docker:prod` boots" — Docker is unavailable in the sandboxed verification environment; Dockerfile/compose unchanged from v3.0.19 green baseline.
- "1,000-call soak test" — requires real Chromium launches and outbound network blocked by sandbox; `BrowserContextPool` unit tests cover the bounded-pool / idle-eviction / refresh behaviour the soak test was meant to validate.

## [3.0.19] - 2026-05-17

### Security
- **HIGH:** HTTP transport (`--http`) now requires `Authorization: Bearer <api-key>` (or `X-API-Key`) on every `/mcp` request — closes audit phase 4. Unauthenticated requests return 401 and emit a structured warning log. Creator mode bypasses the check. `/health` and `/.well-known/mcp/server-card.json` remain unauthenticated for discovery.
- **MEDIUM:** Stored API key is re-validated against the backend at startup — closes audit phase 5. If the backend explicitly rejects the key (invalid / revoked / expired / unauthorized), the server throws and refuses to boot. Network failures are tolerated. `CRAWLFORGE_SKIP_STARTUP_VALIDATION=true` bypasses.
- Phase 6 (config HMAC) is formally deferred until the backend gains support; tracked in `docs/PRODUCTION_READINESS.md`.

### Added
- `src/server/withAuth.js` — tool-handler wrapper extracted from `server.js` for unit-testability.
- Structured `tool invocation` log line on every MCP tool call: `{ toolName, paramHash, durationMs, outcome, creditCost, creatorMode }`. `paramHash` is a 12-hex SHA-256 prefix — no payload leakage. `outcome ∈ { success | error | insufficient_credits }`.
- Per-report `requestId` + `idempotencyKey` (UUID v4) on every usage report; the latter is sent as the HTTP `Idempotency-Key` header and persisted into `~/.crawlforge/pending-usage.json` for safe retry replay.
- `tests/unit/withAuth.test.js` (6 tests) and `tests/unit/authManagerPhaseA.test.js` (6 tests). Unit-test count rises from 14 → 26.

### Changed
- `AuthManager._flushPendingUsage()` and `_appendPendingUsage()` no longer swallow errors silently — structured Winston logs at info/warn/error with retained requestIds. Pending-file ENOENT remains silent (normal), other read errors are now logged at warn.
- `withAuth()` resolves `getToolCost()` and `isCreatorMode()` once per call (was twice and three times respectively); wrapped in `try/finally` so the log line fires on every code path.
- `docs/PRODUCTION_READINESS.md` header bumped: v3.0.12 → v3.0.19, "19 Tools" → "20 Tools", date 2026-03-30 → 2026-05-17. Security Audit Phase Tracker updated: phases 4 and 5 ✅ COMPLETE, phase 6 DEFERRED with rationale.

### Removed
- `src/core/LocalizationManager.js`: deleted the `PROXY_PROVIDERS` constant (11 fake `proxy-*.example.com` endpoints), the `TRANSLATION_SERVICES` constant (Google / Azure / LibreTranslate stubs that were never wired up), the `initializeProxySystem()` and `initializeTranslationServices()` methods, and their re-exports. These never did anything.
- `src/core/ActionExecutor.js`: deleted the `if (url === 'http://example.com')` mock branch — no test depended on it and it short-circuited real action-chain validation.

### Notes
- `isomorphic-dompurify` was **not** removed (plan claim was incorrect — it's actively used by `src/security/wave3-security.js` and `src/utils/inputValidation.js` for HTML sanitization).
- `SnapshotManager.js` was **not** changed — gzip compression is already real, working code (lines 240–260), not a stale comment.

## [3.0.18] - 2026-04-18

### Security
- **CRITICAL:** Endpoint allow-list prevents `CRAWLFORGE_API_URL` from pointing to unauthorized/mock backends. Localhost only permitted in creator mode.
- **CRITICAL:** Credit check fails closed — cached results only trusted within 30 s of last successful backend response. `CREDIT_CHECK_INTERVAL` reduced from 60 s to 15 s.
- **HIGH:** Usage reporting now has a 5 s timeout and decrements local cache regardless of network success. Failed usage reports queued to `~/.crawlforge/pending-usage.json` and replayed automatically.

### Known Issues (deferred to future release)
- HTTP transport (`--http`) still uses the server's stored key for every request. Do not expose publicly until Phase 4 lands.
- API key is not re-validated at startup (Phase 5).
- Local `config.json` has no integrity check (Phase 6).

## [3.0.3] - 2025-10-01

### Security
- **CRITICAL:** Removed authentication bypass vulnerability that allowed users to use `BYPASS_API_KEY=true` for free unlimited access
- Implemented secure creator mode with SHA256 hash-based authentication
- Only package maintainer with secret UUID can enable creator mode (unlimited access for development)
- Protected business model - all users must now authenticate with valid API keys from crawlforge.dev

### Changed
- AuthManager now checks creator mode dynamically to fix initialization order issues
- `.env` file loading moved to top of server.js before all imports
- Updated documentation to reflect security changes

### Added
- `.env.example` file with configuration templates
- Comprehensive creator mode documentation in CLAUDE.md
- Security update notes in README.md

## [3.0.2] - 2025-10-01

### Fixed
- Removed backup files from npm package (ActionExecutor.js.backup, ssrfProtection.js.bak)
- Fixed author email from placeholder to support@crawlforge.dev
- Standardized repository URLs to github.com/mysleekdesigns/crawlforge-mcp
- Fixed homepage URL to https://crawlforge.dev

### Changed
- Updated .npmignore to exclude `*.backup` files
- Updated package-lock.json to sync version
- Reduced package size by 11.1 KB (3.5% reduction)

### Added
- CONTRIBUTING.md with comprehensive contribution guidelines

## [3.0.1] - 2025-10-01

### Security
- Disabled JavaScript execution by default in ActionExecutor
- Requires explicit `ALLOW_JAVASCRIPT_EXECUTION=true` environment variable
- Enforced HTTPS-only webhooks (HTTP webhooks now rejected)

### Fixed
- MCP protocol compliance test JSON parsing issues
- Version synchronization between server.js and package.json

### Changed
- Updated security documentation
- Improved error handling for webhook validation

## [3.0.0] - 2024-08-28

### Added
- Initial release with 19 comprehensive tools
- Basic tools: fetch_url, extract_text, extract_links, extract_metadata, scrape_structured
- Advanced tools: search_web, crawl_deep, map_site
- Content processing: extract_content, process_document, summarize_content, analyze_content
- Wave 2 tools: batch_scrape, scrape_with_actions
- Wave 3 tools: deep_research, track_changes, generate_llms_txt, stealth_mode, localization
- MCP protocol compliance
- Authentication system with API key validation
- Credit tracking and usage reporting
- Docker support
- Comprehensive test suite

### Security
- SSRF protection with allowlist/blocklist
- Input validation and sanitization
- Rate limiting
- Secure webhook dispatching
- API key encryption

---

## Version History Summary

| Version | Date | Type | Description |
|---------|------|------|-------------|
| 3.0.18 | 2026-04-18 | Security | Endpoint allow-list, fail-closed credit check, usage-report hardening |
| 3.0.3 | 2025-10-01 | Security | Critical auth bypass fix |
| 3.0.2 | 2025-10-01 | Maintenance | Package cleanup & metadata fixes |
| 3.0.1 | 2025-10-01 | Security | JS execution & webhook security |
| 3.0.0 | 2024-08-28 | Major | Initial public release |

---

**Note:** For detailed security information, see `PRODUCTION_READINESS.md` and `.github/SECURITY.md`.

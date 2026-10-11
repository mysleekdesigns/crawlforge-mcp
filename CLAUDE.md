# CLAUDE.md

Guidance for Claude Code when working in this repository. File-specific detail lives in path-scoped rules under `.claude/rules/` (tool registration and billing, search tools, stealth engines, security guards); they load when matching files are read.

## Working guidelines

These bias toward caution over speed; for trivial tasks, use judgment.

1. **Think before coding.** Don't assume, and don't hide confusion.
   - State your assumptions. If uncertain, ask.
   - If several interpretations exist, present them rather than picking one silently.
   - If a simpler approach exists, say so, and push back when warranted.
2. **Simplicity first.** Write the minimum code that solves the problem.
   - No features, abstractions, configurability or error handling beyond what was asked or what can actually happen.
   - If 200 lines could be 50, rewrite it.
3. **Surgical changes.** Touch only what you must.
   - Don't "improve" adjacent code, comments or formatting, and don't refactor what isn't broken. Match the existing style.
   - Remove imports, variables and functions your change made unused. Mention pre-existing dead code; don't delete it unless asked.
   - Every changed line should trace to the request.
4. **Goal-driven execution.** Turn the task into a check you can run, and loop until it passes: "fix the bug" → a test that reproduces it, then make it pass; "refactor X" → tests pass before and after. For multi-step work, state a brief plan with a verification step for each item.

## Project overview

CrawlForge MCP Server — an MCP server providing 31 web scraping, crawling and content-processing tools (6 inline in `server.js` + 25 advanced). Node ESM, MCP SDK v2 (`@modelcontextprotocol/server`), Zod. The version lives in `package.json`.

## Development commands

```bash
npm install
npm run setup                # first run, users only; or export CRAWLFORGE_API_KEY=...
npm start                    # stdio server
npm run start:http           # HTTP transport
npm run dev                  # verbose logging

npm run test:unit            # node:test over tests/unit/**, no live network
npm test                     # MCP protocol compliance
npm run test:integration
node test-tools.js           # functional test of every tool
node test-real-world.js      # real-world scenarios

npm run docker:build         # also docker:dev, docker:prod
```

- Single test file: `node --test --test-force-exit tests/unit/<file>.test.js`. The flag must come **before** the path (after it, it is silently ignored). Without it, the Playwright handle that `StealthBrowserManager` leaves open hangs the runner after all tests pass; `npm run test:unit` already sets it.
- Phase D regressions (agent hard stops, unified scrape, map_site ranking): `tests/unit/phaseD-regressions.test.js`.
- CLI (`crawlforge --help`): `init`, `scrape`, `batch`, `install-skills`, … — full reference in `docs/cli-guide.md`.

### Debugging

- **stdout is reserved** for the MCP JSON-RPC stream and CLI `--json` output. All diagnostics (Winston logs, status banners) go to stderr.
- `NODE_ENV=development` for verbose logging and memory monitoring (logs every 60s above 200MB); `node --expose-gc server.js` for memory profiling.
- Cached responses are in `cache/`; application logs in `logs/`.

## Architecture

`server.js` is the entry point: loads `.env` early (creator mode), sets up `AuthManager`, registers every tool through `withAuth()` for credit tracking, connects the stdio transport, and cleans up browsers and job managers on graceful shutdown.

### Core (`src/core/`)

- **AuthManager** — API-key validation, credit tracking, usage reporting; `getToolCost` is the source of truth for prices.
- **AgentOrchestrator** — powers `agent`: NL prompt → PLAN→GATHER→ACT→DECIDE→SHAPE loop. Its three hard stops (maxSteps ≤10, maxUrls ≤20, wall-clock) are enforced by the orchestrator, never delegated to the LLM; has a degraded no-LLM-key path.
- **ResearchOrchestrator** — multi-stage research with query expansion and synthesis.
- **StealthBrowserManager** — anti-detection scraping, Chromium or Camoufox (see `.claude/rules/stealth.md`).
- **ActionExecutor** — Playwright browser automation for `scrape_with_actions`.
- **JobManager** / **WebhookDispatcher** — async jobs for batch operations and their completion callbacks.
- **PerformanceManager**, **LocalizationManager**, **ChangeTracker**, **SnapshotManager**.
- MCP features: **ResourceRegistry** (`crawlforge://` resources), **PromptRegistry** (`src/prompts/`, 5 workflow prompts), **SamplingClient** (with Ollama fallback), **ElicitationHelper** (user confirmation on expensive operations).
- **endpointGuard** — allowlist for the server's own backend calls.

### Tools (`src/tools/`)

| Directory | Tools |
|---|---|
| `basic/` | fetchUrl, extractText, extractLinks, extractMetadata, scrapeStructured |
| `scrape/` | unifiedScrape — `scrape`: one fetch, one cheerio load, a `formats` array, per-format `warnings[]` |
| `agent/` | `agent` (AgentOrchestrator) |
| `advanced/` | BatchScrapeTool, ScrapeWithActionsTool, BrowserSessionTool |
| `crawl/` | crawlDeep, mapSite (optional `search=` ranks URLs into `ranked_urls`) |
| `extract/` | analyzeContent, extractContent, extractStructured, extractWithLlm, listOllamaModels, processDocument, summarizeContent |
| `research/` | deepResearch |
| `result/` | readResult — search/slice/lines/json_path over a stored over-threshold result by `result_handle` |
| `search/` | searchWeb (proxied through the CrawlForge.dev API), serpRank (DataForSEO), redditSearch (community archives) — see `.claude/rules/search-tools.md` |
| `templates/` | ScrapeTemplateTool (10 site templates) |
| `tracking/` | trackChanges |
| `llmstxt/` | generateLLMsTxt |

**The 31 MCP tools.** Inline (6): fetch_url, extract_text, extract_links, extract_metadata, extract_embedded_state, scrape_structured. Advanced (25): search_web, serp_rank, reddit_search, crawl_deep, map_site, extract_content, process_document, summarize_content, analyze_content, extract_structured, extract_with_llm, list_ollama_models, batch_scrape, get_batch_results, scrape_with_actions, deep_research, track_changes, generate_llms_txt, stealth_mode, localization, scrape_template, scrape, agent, read_result, browser_session.

Adding or changing a tool: `.claude/rules/tool-registration.md`.

## Configuration

Defaults and validation: `src/constants/config.js`. User auth is stored in `~/.crawlforge/config.json`; development env in `.env`.

```bash
CRAWLFORGE_API_KEY=your_api_key_here
MAX_WORKERS=10
QUEUE_CONCURRENCY=10
CACHE_TTL=3600000
RATE_LIMIT_REQUESTS_PER_SECOND=10
MAX_CRAWL_DEPTH=5
MAX_PAGES_PER_CRAWL=100
RESPECT_ROBOTS_TXT=true
```

- Stealth variables (`CRAWLFORGE_STEALTH_ENGINE`, `CRAWLFORGE_STEALTH_PROXIES`, `CRAWLFORGE_IMPIT`, `CRAWLFORGE_CLEARANCE_JAR`): `.claude/rules/stealth.md`.
- Robots, blocklist and Web Bot Auth signing variables: `.claude/rules/security-guards.md`.
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are optional and only affect `deep_research`: set, it synthesizes the report itself; unset, it returns raw evidence for the calling LLM to synthesize.

## Security

- SSRF is enforced on every live fetch path through `ssrfGuard()`/`safeFetch()`; never call `fetch` directly on a user-supplied URL.
- References: `docs/sandboxing-and-approvals.md` (canonical), `docs/security-audit-report.md`, `docs/SECURITY.md`; CI checks in `.github/workflows/ci.yml` and `.github/workflows/security.yml`. Run `npm audit` locally.

## Project management rules

- Delegate to a sub-agent only for a genuinely independent, parallelizable track — not for work finishable in a few tool calls, and never to verify your own output (Claude 5 models over-delegate when told to parallelize).
- Put all documentation `.md` files in `docs/`.
- When a phase completes: run `npm run test:unit` and `npm test` and fix all failures, update `docs/PRODUCTION_READINESS.md`, then push all changes to GitHub.

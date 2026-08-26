# CrawlForge Upgrade PRD — CLI + LLM Extraction + Skills System

## Context

CrawlForge MCP Server (v4.2.2) has 23 specialized tools, MCP-native primitives (Resources, Prompts, Sampling, Elicitation from D1/v3.6.0), a CLI (D4/v4.1.0), and strong security/stealth features. This PRD covers the top 3 upgrades that closed the developer-experience gap with Firecrawl while preserving CrawlForge's unique advantages (stealth, localization, NLP, change tracking, local processing).

**Goal:** Add a CLI layer, LLM-powered structured extraction, and a skills system — all three shipped in v4.1.0 — without breaking any existing MCP tools or the current setup flow.

**Last Updated:** 2026-08-24

**Unreleased (prototype, on `development`)** — optional **official Reddit Data API passthrough** for `reddit_search`. Opt-in via `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` (user's own Reddit "script" app); **unconfigured behavior is byte-for-byte unchanged**. App-only OAuth (`client_credentials`) → `oauth.reddit.com` serves `posts`/`thread` requests with live scores and complete comment trees on the user's own free 100-QPM quota, preferred in `auto` mode with the Arctic Shift/PullPush archives as fallback. Deliberate limits fall back to the archives: no comment full-text search, no date-range filter (Reddit exposes only coarse `t` buckets). New `source:"reddit_api"`. New files: `src/tools/search/redditNormalize.js` (shared normalizers) + `src/tools/search/adapters/redditOfficialApi.js` (mirrors the DataForSEO bring-your-own-creds pattern). 1026 unit tests pass / 0 fail (+10 new), MCP compliance 100%. **NOT released** — no version bump/publish; open questions (credit cost, private-user grant, website credit parity, docs sweep) in `docs/reddit-access-and-oauth.md`. Research on why reddit.com can't be scraped directly (4-layered block) and the realistic access paths in 2026 is in the same doc.

**v5.0.0 released 2026-08-05** — major release bundling remediation Phases 0–6 (see Release History below). Breaking: Node floor `>=18` → `>=20.16`.

**v5.0.1 released 2026-08-20** — patch release: thirteen defects from the full-surface live tool test (see "Live tool-test remediation" below), including the critical `crawl_deep` event-loop starvation, the init stanza pointing at a nonexistent npm package, empty junk snapshots written on every detected change, and `SnapshotManager` splitting content from metadata for custom storage dirs.

**v5.0.2 released 2026-08-20** — patch release: the four content-quality defects deferred from v5.0.1 (analyze_content entity extraction, extract_structured price fallback, generate_llms_txt inventory/API mislabeling, github-repo template React-layout selectors).

**v5.0.3 released 2026-08-20** — patch release: second full-surface live retest (27 MCP tools + 23 CLI commands): five hard defects fixed (agent-tool synthesis + prompt-named-site URL seeding, camoufox false "not installed" via CJS load + real `Camoufox()` API, playwright-core 1.62 vs camoufox Firefox protocol mismatch fixed with `viewport: null` — this had also silently broken deep_research's camoufox fallback, llmstxt CLI `--max-pages` validation, stale `map` CLI docs) plus the monitor store move from cwd-relative `./monitors` to `~/.crawlforge/monitors` with legacy migration, and all nine content-quality warns (see "Second live retest remediation" below). 974/975 unit tests pass, MCP compliance 100%.

**v5.0.4 released 2026-08-20** — patch release: third full-surface live retest (27 MCP tools via a 10-agent workflow judging returned content, 24 CLI subcommands live) came back green except one hard defect: the `agent` tool fetched the right page but could not answer from it. Fixed with three coupled changes (structured `flattenBodyText()` extraction in `_fetchAndParse.js` using a U+E000 block-boundary sentinel; SHAPE priority boost so seeds/prompt-named sites outrank generic term-overlap decoys; synthesis prompt hardened against small-model "I cannot browse" refusals) and verified end-to-end over MCP stdio against the live HN front page. Also fixed: CLI `search` ignored the key stored in `~/.crawlforge/config.json` (`getToolConfig` now reads `CRAWLFORGE_API_KEY` at call time, after the CLI's key-resolution hook). 980 unit tests pass (6 new), MCP compliance 100% (see "Third live retest remediation" below). GitHub Release v5.0.4 published 2026-08-20 and marked Latest.

**v5.1.0 released 2026-08-24** — minor release: new **`reddit_search`** tool (28 tools total). Reddit.com 403-blocks every direct CrawlForge path (fetch_url with browser UA, old.reddit.com scrape, reddit-thread template, stealth_mode advanced — all verified live; block is IP/TLS-reputation based), so the tool queries the community archives instead: Arctic Shift (near-real-time, nested comment trees) primary for subreddit/author-scoped searches and thread mode, PullPush (Pushshift-compatible) for cross-subreddit full-text search and as error-only fallback. Routing enforced by Arctic Shift's live-verified constraint (keyword search → HTTP 400 without a scope). One bounded 3s retry absorbs both archives' transient throttles (PullPush 429; Arctic Shift 422 "Timeout. Maybe slow down a bit"). Normalized output (full permalinks, ISO dates, 2000-char text caps + truncation flags, provenance notes), structured outputSchema, 2 credits, no credentials needed. 1018 unit tests / 1017 pass / 1 skipped (31 new), MCP compliance 100% with 28 tools, live-verified over MCP stdio against r/ClaudeAI. Backend billing parity note: crawlforge-website `TOOL_CREDIT_COSTS` needs `reddit_search: 2`.

**v5.2.0 released 2026-08-26** — minor release: new **`shopify-product`** template (reads the store's own `/products/<handle>.json`, so a price cannot be misread from a hidden Dawn-theme badge or invented by an LLM), `fetch_url` now reports `responseTime` and `crawl_deep` reports `cached`/`crawled_at`, remote Ollama via `OLLAMA_API_KEY`, and internal-proxy auth so the REST API can forward browser/LLM tools without double-billing. Fixes: `amazon-product` returned nulls against every current Amazon page (fixtures had been written to match the selectors, not the site); `track_changes` scored price moves by page share so a monitor never fired at the default threshold, and `customSelectors` never scoped anything; `scrape` deleted framework-streamed content and counted script payload as page text; Ollama was never registered as an LLM provider; seven `scrape_with_actions` Playwright defects; the stealth-browser renderer leak that OOM-killed the hosted instance; `CACHE_DIR`/`CACHE_ENABLE_DISK` did nothing. The `scrape_template` extractors moved to the shared **`crawlforge-extractors`** package, which the REST API runs too, so the two surfaces can no longer drift. 1122 unit tests / 1121 pass / 1 skipped, MCP compliance 100% with 28 tools.

**v5.2.1 released 2026-08-26** — patch release: two fixes that reached the hosted server on release day but not the npm tarball. `shopify-product` was missing from the `scrape_template` description registered with the MCP server — the copy a client model reads when choosing a template — so an agent asked for a Shopify product would fall back to scraping the rendered page. And `track_changes` structural scores could never fall below 0.5: `structuralSimilarity` averaged a tag comparison with a hierarchy comparison whose object was initialised empty and never written, so that half returned a constant 1 and a page rebuilt from the same tags into completely different nesting scored a perfect 1.0. Body reading and structural scoring now live in the shared **`crawlforge-extractors`** package (≥1.1.0) alongside the templates, so the charset handling and body-size cap are the same on both surfaces. 1122 unit tests / 1121 pass / 1 skipped, MCP compliance 100% with 28 tools.

**v5.0.5 released 2026-08-23** — patch release: `serp_rank` live-verified end-to-end against a real DataForSEO account (direct tool + MCP stdio). The tool itself was sound — organic position 1 for python.org, honest `found:false` for a non-ranking target, `{configured:false}` when unconfigured — but the test invalidated two numbers the code asserted: the request timeout (raised 30s → 60s → **120s** after two consecutive depth-100 lookups aborted at exactly 60,004 ms; `DATAFORSEO_TIMEOUT_MS` overrides) and the price (**$0.002 per 10 results of `depth`**, not per call — the old depth-100 default billed $0.02, 10× the documented figure). Default `depth` lowered 100 → **20** ($0.004, ~19s). Also ships the Smithery static-server-card tool list (27 tools derived from the live registry instead of a drifted hand-written table) and fixes `serverInfo.version`, hard-coded two patches stale at 5.0.2. 982 unit tests / 981 pass / 0 fail / 1 skipped, MCP compliance 100%.

---

## v4.8.0 — Real Agent Skills, Security Enforcement, Branding/Screenshot, Change Scheduling

Delivered 2026-06-28. Additive minor; no breaking changes to tool schemas, outputs, or credit costs.

**Why:** A competitive review (dogfooded via CrawlForge's own `deep_research`/`scrape`) against Firecrawl found CrawlForge already ahead on agent/research/tracking/local-LLM, but four real gaps — two of which were latent bugs where advertised controls did nothing.

1. **Skills overhaul (Workstream A).** Converted the inert bare-markdown "skills" into 7 real auto-activating Claude Agent Skills (`src/skills/agent-skills/<name>/SKILL.md`, frontmatter + trigger-rich descriptions, progressive-disclosure `references/`). Installer rewritten with preserved signatures + self-healing migration of legacy files; opt-in forced-eval hook; `npm run skills:gen`.
2. **Additive `scrape` capabilities (Workstream B).** New `branding` format (static design tokens: colors/fonts/logo/spacing) and a working `screenshot` format (was a no-op) returning `crawlforge://screenshot/{id}` resources via the shared browser pool. Both opt-in; default scrape stays a single cheap fetch.
3. **Security hardening (Workstream C).** Wired SSRF protection into the live fetch path for the first time (undici connect-time `lookup`, redirect- and rebinding-safe, staged default/strict); fixed MCP elicitation (`elicit`→`elicitInput`, capability gate, action parsing) so cost/safety confirmations actually fire; per-host rate limiting; `executeJavaScript` length/timeout/audit hardening.
4. **Built-in change scheduling (Workstream D).** Replaced dead `create_scheduled_monitor`/`stop_scheduled_monitor` ops with a real persisted scheduler (`MonitorScheduler` + `MonitorStore`), added `list_scheduled_monitors`, plain-English LLM-judged alert `goal` (degrades gracefully), baseline rehydration, and `monitor:create/list/stop/run-due` CLI (cron escape hatch).

**Verification:** 448/448 unit tests pass (+42 new); MCP protocol compliance boots clean (0 errors); all 26 tools still register.

---

## Release History

### `serp_rank` live verification — depth default 100 → 20, timeout 60s → 120s, cost docs corrected 10× (2026-08-23, no version bump)

Live-testing `serp_rank` end-to-end against the real DataForSEO account (direct tool + MCP stdio `tools/call`) confirmed the tool itself is sound — python.org returned at organic **position 1** (rank_absolute 2) with a valid `checkUrl`, an absent target honestly returned `found:false`/`position:null` rather than a fabricated rank, and the unconfigured path returned `{configured:false}` — but it invalidated two numbers the codebase had been asserting.

**1. The 60 s cap raised earlier the same day was still too low at the default depth.** Two consecutive `depth:100` lookups both aborted at exactly 60,004 ms. Measured latency for the *same* endpoint in one session: ~13–15 s at `depth:10`, and 30 s / 44.9 s / >60 s (×2) at `depth:100`. Default raised to **120 s** (`DATAFORSEO_TIMEOUT_MS` still overrides). A timed-out lookup is *not* free — DataForSEO has already run the scrape and bills it — so an over-tight cap buys nothing and costs money.

**2. The documented price was wrong by 10×.** `~US$0.002/call` is the `depth:10` price; Live Advanced bills **US$0.002 per 10 results of `depth`**, so the old `depth:100` default was **$0.02** per lookup. Confirmed two ways: the API's own `cost` field (0.002 at depth 10, 0.02 at depth 100, 0.004 at depth 20) and the account balance dropping $0.042 across three billed calls. Corrected in `.env.example`, `CLAUDE.md`, the adapter header, and the `AuthManager` cost notice (historical release entries left as written).

**3. Default `depth` lowered 100 → 20** (`src/tools/search/serpRank.js` zod schema + the adapter's own fallback, kept in sync): two pages of Google for **$0.004** and ~19 s instead of one deep scan for $0.02 and 30–60+ s. Ranks below 20 now report `found:false` until the caller raises `depth` (max still 200). The server-side `depth` description states the new default and the per-10 billing.

**Also fixed:** `server.js` hard-coded `version: "5.0.2"` in `serverInfo` — two patches stale against `package.json` 5.0.4; now 5.0.4.

**Verification:** `npm run test:unit` **982 tests / 981 pass / 0 fail / 1 skipped** (serpRank suite 30/30 with the updated default assertions); `npm test` **100.0% COMPLIANT / 0 errors**; live MCP stdio `tools/call serp_rank` with no `depth` argument returned `depthScanned:20`, `cost:0.004` in 18.9 s against `serverInfo` 5.0.4.

### Fix: `serp_rank` timed out on healthy DataForSEO lookups (2026-08-22, no version bump)

The DataForSEO Live Advanced endpoint runs a real-time Google scrape, so its latency tracks their capacity rather than a fixed cost — the *same* keyword was observed answering in 11 s and in 28 s. The adapter's 30 s abort cap sat inside that spread, so healthy lookups were being killed and surfaced to the user as a timeout error (billed by DataForSEO all the same, since the scrape had already run). Default raised to **60 s** (`src/tools/search/adapters/dataforseoSearch.js`), overridable per-deployment via **`DATAFORSEO_TIMEOUT_MS`**, with the explicit `options.timeoutMs` constructor argument still winning over the env var for tests/self-host. A non-numeric env value falls back to the 60 s default rather than `NaN`. Documented in `.env.example` next to the existing `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` keys. The cap still exists to stop a hung connection wedging the tool — it is now set above the slow end of the observed range instead of through the middle of it. **Tests:** the default-value assertion in `tests/unit/serpRank.test.js` updated to 60000, plus one new case covering env override, options-precedence, and the non-numeric fallback (env var saved/restored). **Verification:** `npm run test:unit` **982 tests / 981 pass / 0 fail / 1 skipped**; `npm test` 100.0% COMPLIANT / 0 errors.

### Third live retest remediation — agent synthesis root-caused three layers deep, CLI stored-key resolution (2026-08-20, released in v5.0.4)

A third full-surface live retest (all 27 MCP tools via a 10-agent workflow grading returned content quality, all 24 CLI subcommands plus global flags against live sites) ran clean — 29 pass / 1 by-design warn (stealth_mode create_page returns navigation metadata only) — except the `agent` tool, which fetched news.ycombinator.com successfully on every attempt yet never named the #1 story.

**`agent` synthesis (3 coupled causes, each proven insufficient alone by re-testing live after each fix):**
1. **Flat text extraction** (`src/tools/extract/_fetchAndParse.js`): `$('body').text().replace(/\s+/g,' ')` joined adjacent elements with no separator, welding every HN rank/title/points into one string. New exported `flattenBodyText()`: mark block-element boundaries (`p, div, li, tr, h1–h6, blockquote, pre, table, ul, ol, dl, section, article, header, footer`; `td/th` get spaces; `br` too) with a U+E000 private-use sentinel, collapse all whitespace, convert sentinel runs to newlines. NUL was tried first and silently vanished — cheerio's `.after()`/`.replaceWith()` parse their argument as HTML and the HTML parser strips NUL. Runs on a detached clone: `unifiedScrape` reuses the returned `$`.
2. **SHAPE ordering buried the named source** (`src/core/AgentOrchestrator.js`): evidence was ordered purely by prompt-term overlap, so an NFL article containing "title"/"story"/"current" outranked the explicitly-named HN front page in the synthesis input. Seeds + prompt-named sites (the `priorityUrls` the GATHER phase already treats as most authoritative) now get a +1000 ordering boost.
3. **Small-model refusal**: with perfect, correctly-ordered input, llama3.2 still answered "I'm unable to access the internet". The synthesis prompt now opens with "the sources below have ALREADY been fetched … do not refuse for lack of browsing ability"; with that wording all four installed Ollama models answered the isolated test correctly.

**Model finding:** on the real ~13KB five-source synthesis prompt, llama3.2 alone still failed while qwen2.5:3b (same 3B size), mistral:7b, and gemma3:12b all succeeded — `OLLAMA_DEFAULT_MODEL=qwen2.5:3b` is the recommended env override when agent answers degrade; the code default stays llama3.2.

**CLI `search` stored-key bug** (`src/constants/config.js`): the CLI's preAction hook (flag → env → `~/.crawlforge/config.json`) sets `process.env.CRAWLFORGE_API_KEY` after `config.js` has already been imported, and the config snapshot captured the env at import time — so a stored-key-only user always got "CrawlForge API key is required" from `crawlforge search`. `getToolConfig('search_web')` now reads the env at call time; verified live from a non-repo cwd with no env var.

**Verification:** 980 unit tests pass, 0 fail (6 new regression tests: `fetchAndParse-text-structure.test.js` ×5 including a no-`$`-mutation guard, `agent-shape-priority.test.js` ×1 asserting the named site precedes higher-overlap decoys in the captured synthesis prompt); `npm test` MCP compliance 100%; live stdio `tools/call agent` names the real current HN #1 story.

### Second live retest remediation — agent synthesis, camoufox engine, monitor home store, nine content-quality warns (2026-08-20, released in v5.0.3)

A second full-surface live test (all 27 MCP tools via an 8-agent workflow judging returned content, all 23 CLI commands via scripted live runs) after v5.0.2 found 15 defects; every fix was researched via `search_web`, reproduced against live-captured fixtures, and re-verified live end-to-end.

**Hard defects (5):**
1. **`agent` tool wrong/fabricated answers** (`AgentOrchestrator.js`): the LLM's preamble line became search query #1 and a flat 12K truncation fed synthesis only the first-queued sources — fixed with preamble filtering, a per-source context budget with relevance ordering, anti-fabrication synthesis rules (cite sources, never invent URLs), and seeding the URL queue with sites named in the prompt.
2. **camoufox false "not installed"** (`StealthBrowserManager.js`): camoufox's `exports.import` is a broken esbuild ESM bundle (`Dynamic require of "events"`); adapter now loads the CJS entry via `createRequire` and calls the real `Camoufox()` API (`camoufox.launch` never existed), distinguishing genuinely-absent from failed-to-load.
3. **playwright-core 1.62 vs camoufox Firefox protocol** (regression since the v5.0.0 dep upgrade; camoufox pins ^1.54): any fixed-viewport context fails `Browser.setDefaultViewport` on unknown fields — fixed with `viewport: null` (skips the call) in both `createStealthContext` and `ResearchOrchestrator._stealthFetchOnce`, un-breaking deep_research's camoufox anti-bot fallback.
4. **llmstxt CLI**: `--max-pages` outside 10–500 dumped a raw zod error; now validated pre-invocation with a friendly message.
5. **CLI docs**: `map` documented nonexistent `--depth`/`--format` flags; `monitor:create/list/stop/run-due`, `init`, and `mcp` were undocumented.

**Monitor store relocation:** `MonitorStore` defaulted to cwd-relative `./monitors`, so `monitor:list`/`stop`/`run-due` silently saw different stores per directory and the documented cron workflow broke. Now defaults to `~/.crawlforge/monitors` (consistent with `~/.crawlforge/config.json`) with best-effort one-time migration of legacy `./monitors` files; verified live across different working directories.

**Content-quality warns (9, all live-verified):** track_changes unchanged-compare contradiction (`changeType:"none"` now; set-based Jaccard clamps structuralSimilarity to [0,1]; createBaseline read a nonexistent `.analysis` so sections/elements/contentHash were always 0); batch_scrape markdown dropped non-p/li content (hand-rolled walk replaced with the shared Turndown helper — batch markdown also no longer includes nav/footer boilerplate, matching `scrape`); HN template `posted` carried permalinks and job posts leaked age into `comments`; extract_text leaked Wikipedia's `<noscript>` tracking pixel as literal markup; localization FR dateFormat was MM/DD/YYYY (full 26-country audit), auto_detect now works content-only, and language confidence is stopword-density-based; extractive summarizer omitted the lead definitional sentence (lead-position bonus + brevity penalty); analyze_content topics were always empty (confidence normalized against max phrase frequency) and entities noisy (punctuation stripping, case-insensitive dedupe, "X v. Y" legal-case guard, ALL-CAPS org demotion); scrape_with_actions silently ignored scroll `x`/`y` (now supported at ActionExecutor, tool-schema, and MCP-schema layers, reporting `scrolledTo`).

**Verification:** 974/975 unit tests pass (0 fail, ~50 new regression tests), `npm test` MCP compliance 100%, plus live re-runs of every fixed path (camoufox scrape of example.com, agent answering from the real HN front page, cross-directory monitor lifecycle, MCP-layer scroll `scrolledTo {x:0,y:500}`).

### Live tool-test remediation — crawl_deep event-loop starvation, serp_rank schema, Playwright browsers (2026-08-20, released in v5.0.1)

A live test of all 27 tools against real websites surfaced three defects; all fixed same-day and re-verified end-to-end over MCP stdio.

- **crawl_deep event-loop starvation (critical).** `BFSCrawler.extractLinkMetadata` re-parsed the full page HTML with cheerio and re-serialized `$('body').text()` for *every link* on a page — O(links × page size) synchronous CPU on the main thread. On link-dense pages (iana.org, ~1,500 links, MB-scale table HTML) the server pegged 180% CPU / 4.9 GB and starved the event loop for 13+ minutes, hanging *all* concurrent MCP calls and even blocking SIGTERM/graceful shutdown. Since `enable_link_analysis` defaults to true, any default crawl of a link-dense site hit this. Fix: `processUrl` parses the page once and computes body text once, passing both into `extractLinkMetadata(href, $, bodyText)`; dead per-link `linkHtml` serialization removed. Retest: the identical IANA crawl completes in ~168s with 0 errors and the server answers other calls in 0.1s while/after crawling.
- **serp_rank output schema rejected valid paid responses.** The DataForSEO adapter deliberately emits `snippet: null` for organic items without a description, but `serpRankResultShape.snippet` lacked `.nullable()` — one null-snippet competitor discarded the whole (already-billed) lookup with an output-validation error. Fix: `snippet: z.string().nullable().optional()` + null-snippet regression case in `phase6-output-schemas.test.js`. Retest on a real SERP containing a null-snippet item validates cleanly.
- **Playwright browsers out of date (environment).** The updated playwright package expected chromium build 1234; the local cache topped out at 1228, failing `stealth_mode`, `scrape_with_actions`, and `scrape`'s screenshot format. Fixed via `npx playwright install chromium`; all three retested green (stealth context/page/cleanup, 3/3 actions + screenshot, screenshot format).

**Verification:** `npm run test:unit` 913 pass / 0 fail; `npm test` 100% MCP-compliant; previously blocked `deep_research`, `agent`, and `generate_llms_txt` (real site, 100 pages) all verified working.

**Follow-up (same day): page-limit enforcement.** Two limit overshoots found during the retest, both fixed and live-verified:

- **`crawl_deep` `max_pages` overshoot.** The cap check ran at the start of each queued task, but `visited.add` happened after an awaited robots.txt lookup — so with queue concurrency, many tasks passed the check before any registered (asked 5, crawled 10). Fix: re-check the cap and dedupe synchronously at the `visited.add` site, making the cap exact. Live retest: `max_pages: 6` crawls exactly 6.
- **`generate_llms_txt` ignored `analysisOptions.maxPages`/`maxDepth`.** The tool passed per-call options only to `analyzeWebsite()`, but `LLMsTxtAnalyzer` reads its crawl caps from *constructor* options — so the schema-validated caps landed in metadata and nowhere else (asked 10, analyzed 100). Fix: spread `analysisOptions` into the analyzer constructor. Live retest: `maxPages: 10` analyzes exactly 10.

Both re-verified: `npm run test:unit` 913 pass / 0 fail, `npm test` 100% MCP-compliant. Note for testers: `crawl_deep` caches whole results for 1h keyed by params — identical re-runs return the cached (pre-fix) result; vary a param to bypass.

**Follow-up (same day): full-surface sweep — 27/27 MCP tools + 23/23 CLI commands live-tested.** A multi-agent workflow plus inline runs exercised every MCP tool and every CLI subcommand against real websites (config-mutating commands under an isolated HOME; monitors created and cleaned up). One new defect found and fixed:

- **CLI `stealth` broken on every default invocation.** `src/cli/commands/stealth.js` defaulted `--engine` to `playwright`, but the engine enum was renamed to `chromium | camoufox` when Camoufox landed in v4.0.0 — the schema rejected the default with `invalid_enum_value`. Fixed: default is `chromium`, help text updated, and `playwright` is still accepted as a back-compat alias. Verified live: `crawlforge stealth https://quotes.toscrape.com/js/ --json` now renders the JS-only page (quotes present ⇒ browser actually executed JS).

Sweep verdict: everything else passes. Notable non-blocking observations for a future DECISION: CLI `track` cannot compare across invocations (ChangeTracker baselines are in-memory only — each CLI run re-creates the baseline; needs a persistent baseline store for CLI semantics); `monitor:stop` removes the monitor but reports `stopped:false` in a fresh process; `crawlforge init` requires a stored/env API key even in creator mode; `generate_llms_txt` output omits a URL inventory and its API-detection heuristic mislabels ordinary pages; known quality gaps re-confirmed (analyze_content entity extraction empty, extract_structured css_fallback misses price fields, github-repo template watchers/language/topics null). Suites re-verified after the fix: 913/0 unit, 100% MCP-compliant.

**Follow-up (same day): track / monitor:stop / init fixed.** The three CLI observations above were greenlit and fixed, plus one latent v4.8.0 bug the work uncovered:

- **`track` now compares across invocations.** New `TrackChangesTool.rehydrateBaseline(url, trackingOptions)` (called at the top of `compareWithBaseline`) rebuilds the in-memory baseline from the newest persisted snapshot — the same mechanism as the monitor path's `_ensureBaseline`, fixing fresh CLI runs *and* restarted MCP servers in one place. First run still creates the baseline; later runs genuinely compare, with the baseline rolling forward through change snapshots (matching monitor-restart semantics).
- **Latent since v4.8.0: baseline rehydration never worked.** `SnapshotManager.querySnapshots` returns stored content as a **Buffer**, and both rehydration sites guarded with `typeof content === 'string'` — silently rejecting every snapshot (masked by the fail-soft catch; monitors just re-baselined on first fire after restart). Both sites now normalize Buffers to utf8 strings.
- **`monitor:stop`/`stopByUrl` load the store before deciding.** In a fresh process the unloaded `MonitorStore` made `existed` always false (and `stopByUrl` a silent no-op) even though the file was removed. Both now use the same lazy-load guard as `runDueOnce`, and `stop_scheduled_monitor` returns a truthful contract: found+removed ⇒ `success:true, stopped:true`; unknown id ⇒ `success:false` + error (CLI exit 1).
- **`init` proceeds keyless in creator mode** via `isCreatorModeVerified()`, writing the already-supported env-less MCP stanza (the creator secret is never written into client configs; the registered server re-derives creator mode from its own environment). Machines with neither key nor secret still exit 1 with the setup guidance.

Verification: +6 unit tests (cross-process rehydration cycle incl. baseline roll-forward, fresh-store stop + unknown-id contract, keyless/keyed stanza shapes); suites 920 tests / 919 pass / 0 fail (1 known skip) twice consecutively, `npm test` 100% MCP-compliant; live CLI runs confirm all three behaviors.

**Found during the v5.0.1 release prep: init stanza referenced a nonexistent npm package.** `mcpStanza` wrote `npx -y crawlforge@latest mcp`, but no npm package named `crawlforge` exists (the published package is `crawlforge-mcp-server`) — every init-generated client config was broken, and the unclaimed name was a supply-chain squatting risk. Fixed to `crawlforge-mcp-server@latest` (whose package-name bin routes to the CLI's `mcp` subcommand, verified via the stdio initialize handshake).

**Follow-up (post-v5.0.1): the four content-quality observations fixed.** All greenlit and closed:

- **`analyze_content` entities always empty.** `ContentAnalyzer.extractEntities` called `doc.dates()`, which in compromise v14 lives in the uninstalled `compromise-dates` plugin — the throw aborted the whole extraction (people/places/organizations worked fine) and the catch returned empties with a swallowed stderr warn. Fixed with core-build `doc.match('#Date+')` (no new dependency). Live: the repro sentence now yields Tim Cook / Microsoft / California, 8 entities.
- **`extract_structured` css_fallback missed price.** `SEMANTIC_FIELD_SELECTORS` had no commerce entry, and the literal `.price` selector can't match the `price_color` class token. Added `price: ['[itemprop="price"]', '[class*="price"]']` — books.toscrape now yields `£53.74`.
- **`generate_llms_txt` thin output + "Sapiens" mislabeled as an API.** Two cooperating defects: the API link filter used substring matching, so "S-**api**-ens" qualified (now word-boundary `\b(api|developer)s?\b`); and the "## Pages" sitemap fallback ran *after* the APIs section, so that lone false-positive suppressed the whole URL inventory (fallback now runs before). Live: books.toscrape gets a real `## Pages` listing, zero fake APIs; crawlforge.dev's categorized sections unchanged.
- **github-repo template null watchers/language/topics.** GitHub's logged-out React layout dropped the old markup. Watchers now read from `.octicon-eye + strong` (aria-label kept as classic-layout fallback); topics accept `a[href^="/topics/"]` alongside `a.topic-tag` (next.js now returns 14 topics). Language is genuinely unrecoverable from static HTML on the React layout (client-side skeleton) — stays null there by design, `itemprop` fallback retained for classic pages.

+5 unit tests (entity repro, price_color fixture, Pages-not-suppressed-by-APIs, word-boundary API matching, React-layout github fixture); suites 925 tests / 924 pass / 0 fail, `npm test` 100% MCP-compliant.

**Also found during release prep (via a flaky rehydration test — both latent production bugs):** (1) the `changeDetected` handler stored `details.current || ''`, but change records carry diff analysis, never content — every significant change wrote a zero-byte junk snapshot, which could timestamp-tie with the real snapshot and make rehydration pick the empty and give up; the handler now stores only when content exists, and both rehydration sites skip empty snapshots (legacy-polluted stores still rehydrate). (2) `SnapshotManager` anchored `metadataDir`/`tempDir` to the global `~/.crawlforge/snapshots` even with a custom `storageDir`, splitting content from metadata and sharing one metadata store across all custom-dir instances; both now derive from the effective storage dir. Rehydration test then passed 8/8 consecutive runs.

### Repo housekeeping — root markdown moved to docs/ (2026-08-05, released in v5.0.0)

`CHANGELOG.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `OPEN_CORE_PLAN.md`, `SECURITY.md`, and `SKILL.md` moved from the repo root into `docs/` (git-mv, history preserved); root keeps only `README.md`, `PRD.md`, and `CLAUDE.md` (Claude Code only auto-loads project instructions from root, and it ships in the npm package from that path). All cross-references updated: README links, `docs/CHANGELOG.md`/`docs/SECURITY.md` relative links, `scripts/generate-skill-md.mjs` output path (`npm run skills:gen` now writes `docs/SKILL.md`), and CLAUDE.md's stale `.github/SECURITY.md` pointer. GitHub still recognizes the community-health files in `docs/`. Follow-up: `SKILL.md` re-synced via `npm run skills:gen`, picking up the v4.10.0 "Prefer CrawlForge for web work" section it was missing. Also: `--test-force-exit` added to the `test:unit` script (matching `test:coverage`) — the d2-reliability Playwright handle otherwise hangs the runner at exit after all tests pass; suite now finishes in ~26s.

### Remediation Phase 6 — MCP-spec adoption & competitive parity (2026-08-05, released in v5.0.0)

Executes the greenlit subset of the remediation plan's Phase 6 (DECISION phase; user approved all of Track A plus two Track B items — the rest of Track B and all of Track C were explicitly deferred).

- **Structured output** — `scrape`, `map_site`, `serp_rank`, `search_web`, `extract_structured`, `crawl_deep` now declare `outputSchema` (permissive zod shapes in `src/schemas/toolOutputSchemas.js`) and return `structuredContent` alongside the legacy JSON text via `dualOutput`.
- **SEP-1303** — zod input-validation failures surface as `isError:true` tool results (not `-32602` protocol errors); behavior arrived with SDK 1.30 and is now pinned by dedicated unit + live-server regression tests.
- **Wire hygiene** (`src/server/specHygiene.js`) — JSON Schema 2020-12 dialect stamped on every tool schema, deterministic (sorted) `tools/list`, SEP-2549-style `_meta["io.modelcontextprotocol/cacheable"]` `{ttlMs, cacheScope}` hints on 10 read-only tools, SEP-973 icons on server/tools/prompts.
- **Async task pattern** (`src/server/taskSupport.js`) — `crawl_deep`, `batch_scrape`, `deep_research`, `agent` registered through the MCP `io.modelcontextprotocol/tasks` extension with `taskSupport:'optional'`: task-aware clients get a handle immediately and poll `tasks/get`/`tasks/result` (plus `tasks/list`/`tasks/cancel`); synchronous clients are unaffected.
- **Client-side tool selection** (`src/server/toolFilter.js`) — `CRAWLFORGE_TOOLS` / `CRAWLFORGE_TOOL_GROUPS` env whitelist over 12 groups; unset = all 27 tools; `batch_scrape` auto-enables `get_batch_results`.
- **MCP Registry** — `server.json` completed against the 2025-12-11 registry schema (env-var declarations, websiteUrl) + GitHub-OIDC publish workflow (`.github/workflows/publish-mcp-registry.yml`) firing on release; manual fallback in `docs/mcp-registry.md`.
- Docs: `docs/mcp-spec-adoption.md` (wire-level examples), README env/spec-features sections.

**Verification:** unit 914 tests — 913 pass / 1 skip / 0 fail (5 new phase6 suites); `npm test` 100.0% COMPLIANT, 0 errors; live stdio integration (`tests/integration/phase6-spec-adoption.test.js`) 3/3 — spec fields, SEP-1303, and both filter modes exercised against the real server.

### Remediation Phase 5 — Dependency modernization, Node ≥ 20 floor (2026-08-05, released in v5.0.0)

Sixth phase of the [remediation plan](./plan/README.md) — the user-approved **DECISION** phase: raises the Node floor, retires every abandoned dependency, and takes the security-only-in-a-major upgrades the old floor blocked. `npm audit` drops from 4 moderate to **0 vulnerabilities**. **Node floor:** `engines.node` `>=18.0.0` → `>=20.16.0` (Node 18 EOL April 2025; 20.16 is pdf-parse 2.4.5's own floor) — Dockerfile `node:20-alpine` and CI Node 22 already comply, no changes needed. **Removed outright (all verified imported nowhere or replaced):** `node-cron` (scheduling has been `MonitorScheduler` setInterval since Phase 3 — removal clears the vulnerable-`uuid` chain GHSA-w5hq-g745-h8pq), `@googleapis/customsearch` (`search_web`'s Google adapter calls the REST endpoint directly), `node-summarizer` (abandoned 2019 — `ContentAnalyzer`'s extractive path rewritten as a `compromise`-based Luhn-style word-frequency scorer with identical result shapes and abstractive-degradation behavior). **Majors taken:** `pdf-parse` 1.1.1 → **2.4.5** exact-pin (ESM rewrite on pdfjs-dist 5; `PDFProcessor` ported to the `PDFParse` class API — `password` now actually decrypts (closes the Phase 2 no-op), page ranges via native `getText({partial})`, encrypted flag reads the real `EncryptFilterName`; SSRF guard/timeout/size caps preserved); `commander` 12 → ^14.0.3 (CLI audited, zero code changes); `p-queue` 8 → ^9.3.3 (dead `throwOnTimeout: true` removed — v9 always throws, semantics identical); `diff` 8 → ^9.0.0 (only `diffWords/diffLines/diffChars` used — zero code changes); `@hono/node-server` override 1.19.x → **2.0.12** (our own overrides block was pinning the vulnerable line — clears GHSA-frvp-7c67-39w9). Deferred unchanged to a "Node 22 + SDK v2" initiative: `undici` 8, `jsdom` 30, `zod` 4. **Supply chain (ChainDrop npm worm, active since 2026-08-04):** every install `--ignore-scripts`; every adopted version publish-date-gated pre-2026-08-04 (incl. new transitives `@napi-rs/canvas@0.1.80`, `pdfjs-dist@5.4.296`, `p-timeout@7.0.1`); lockfile diff (12 added / 6 changed / 28 removed) cross-checked against the Socket + StepSecurity compromised lists — zero matches; IoC scans clean before and after. **Tests:** `processDocument.test.js` rewritten for true-ESM pdf-parse; new `tests/fixtures/pdfBuilder.js` fixture generator + `tests/unit/core/processing/PDFProcessor.test.js` (multi-page, page-range, password decryption). Unit total 835 → **845**. No version bump (unreleased, ships with the next publish). **Verification:** `npm run test:unit` **845 tests / 844 pass / 0 fail / 1 skipped**; `npm test` **100.0% COMPLIANT / 0 errors**; `node test-tools.js` 20/20; `npm audit` **0 vulnerabilities**. Files: `package.json`, `package-lock.json`, `src/core/processing/PDFProcessor.js`, `src/core/analysis/ContentAnalyzer.js`, `src/core/queue/QueueManager.js`, 3 test files (1 rewritten, 2 new).

### Remediation Phase 4 — HTTP transport, protocol hygiene & medium/low cleanup (2026-08-04, released in v5.0.0)

Fifth phase of the [remediation plan](./plan/README.md) — closes all **19 Phase 4 findings** (3 confirmed high, 6 medium, 10 low) from the [2026-08 audit](./docs/CODEBASE_AUDIT_2026-08.md): the HTTP/remote deployment path and the remaining protocol-hygiene/medium/low catalog. **Streamable HTTP transport:** stateful mode rebuilt on the SDK's documented per-session pattern — a `Map<sessionId, {transport, server}>` with a fresh `StreamableHTTPServerTransport` + cloned `McpServer` per `initialize`, disposal on DELETE/`onsessionclosed`, JSON-RPC 404 for unknown sessions — so a second concurrent client, reconnect-via-re-initialize, and DELETE-then-fresh-initialize all work (previously one shared transport = one session ever, and any clean disconnect bricked `/mcp` until restart); legacy stateless mode (`--legacy-http`) constructs a fresh transport + server per request inside a try/catch that ends the response with a JSON-RPC 500 (previously every request after the first died as an unhandled rejection with a hung client); discovery metadata derives the version live from `package.json` (was hard-coded 3.5.1) and computes the server-card tool count from the registered-tools map (27, was "20 tools"). **Protocol hygiene:** `getting-started` prompt moved to the `registerPrompt` config-object API (the old positional call advertised a bogus required arg and failed every `prompts/get` with -32602/-32603); `scrape` strips base64 screenshot bytes from the JSON result once stored in the resource registry (metadata + `crawlforge://screenshot/{id}` URI only); `AuthManager.runSetup`/`clearConfig` banners moved to stderr so first-launch auto-setup can't corrupt the stdio JSON-RPC channel (stdout-hygiene test now scans AuthManager); insufficient-credits refusals carry `isError: true`. **Key/config:** `search_web` falls back to the `~/.crawlforge/config.json` API key when the env var is absent (setup-configured users previously got guaranteed-failure calls half-billed at 2 credits); `projectCost` reads `crawl_deep`'s snake_case `max_pages`. **Webhooks:** HMAC signs the exact serialized POST body (full envelope — standard raw-body verification finally matches) and thrown HTTP errors carry `.response = { status }` so `retryableStatusCodes` actually fire. **Tool layer:** `extract_structured` invokes its dormant elicitation before the CSS fallback (>3 required fields, no LLM — fail-open); `extract_with_llm`/`summarize_content` gain `setMcpServer()` wiring so the MCP-sampling fallback leg can run; `scrape` screenshot failures surface the real error instead of "capture produced no image"; `BrowserBaseBackend.connect` errors include HTTP status + body (was an empty `Error`); `scrape_with_actions` `metadata.finalUrl` fixed (was always undefined); recordings preserve `executeJavaScript.script` so `captureIntermediateStates` replays pass schema validation. **Tests:** transport suite covers second session / reconnect / DELETE+reinit / multi-request legacy against a real listening server (31 tests); the compliance suite gains prompts/list + prompts/get coverage for all 6 prompts; `withAuth` covers the checkCredits-throws path (no billing on refusal); real-lifecycle tests assert page+context close on goto failure, webhook abort at `config.timeout` with body-string HMAC, and `batchResults` TTL eviction. Unit total 825 → **835**. No version bump (unreleased, ships with the next publish). **Verification:** `npm run test:unit` **835 tests / 834 pass / 0 fail / 1 skipped**; `npm test` **100.0% COMPLIANT / 0 errors** (11 groups incl. new prompt checks). Files: `server.js`, `src/server/transports/streamableHttp.js`, `src/server/withAuth.js`, 3 under `src/core/`, 6 under `src/tools/`, 6 test files.

### Remediation Phase 3 — Resource leaks, timeouts & robustness (2026-08-03, released in v5.0.0)

Fourth phase of the [remediation plan](./plan/README.md) — closes all **24 Phase 3 findings** (7 high, 12 medium, 5 low) from the [2026-08 audit](./docs/CODEBASE_AUDIT_2026-08.md): the "safe to run for days" class — timers, browser contexts, and unbounded caches that accumulate for the process lifetime, plus body reads with no deadline. **Browser lifecycle:** `ActionExecutor.initializePage` closes the already-created page **and its context** when navigation/stealth setup throws (every failed `page.goto` previously orphaned a live page); the per-chain `finally` and `BrowserProcessor.processURL` now close the owning non-stealth `BrowserContext`, not just the page (one context leaked per `scrape_with_actions`/`extract_content` browser call); `executionHistory` entries strip `finalHtml`, `screenshots`, `capturedStates`, and each screenshot action's base64 payload inside `results` (counts/sizes retained — up to hundreds of MB no longer pinned across the 100-entry history); `destroy()` guards each `page.close()` so one crashed page can't abort browser shutdown; `BrowserProcessor.cleanup()` tears down the `LocalizationManager` it constructs; `extractContentTool`/`processDocumentTool` added to `gracefulShutdown`'s `toolsToCleanup`. **Research budget:** `processWithTimeLimit` races against one shared wall-clock deadline (set once per research session — stages no longer each get the full `timeLimit`), passes an `AbortSignal` the stage batch loops check, clears the racer timer in a `finally` (was a live ≤5-min timer per stage), and waits for a timed-out stage to unwind before compilation (no more sorting `detailedFindings` while the abandoned loop still pushes into it). **Caches bounded:** `crawl_deep` destroys its per-crawl `CacheManager` in a `finally` (`BFSCrawler.destroy()` — dropped instances now GC-verified via WeakRef + `--expose-gc`; previously N crawls leaked N caches × 1000 HTML bodies re-JSON.stringified every 60 s forever); `batch_scrape` `batchResults` gets an LRU cap (20 batches), on-read expiry eviction, and an unref'd periodic TTL sweep; `SnapshotManager` `.meta` files no longer embed the full page `content`/`delta.deltaData` (persisted only in the `.snap`; legacy fat `.meta` files defensively stripped on load) and `metadataCache` is bounded; `ChangeTracker` history is trimmed to `maxHistoryLength`, and the schema's `maxHistoryEntries`/`retainHistory` are finally honored. **Deadlines on every body read:** `_fetch.js` keeps the abort timer armed through the body stream (the advertised `timeout` finally covers slowloris/trickled bodies on all 5 basic tools) and reassembles chunks in one pass (was O(n²) — 1.5 s of event-loop block at 25 MB); `batchScrape/worker.js` body reads are timed and size-capped (a trickling server can no longer hold a sync batch's semaphore slot indefinitely); `_fetchAndParse.js` (scrape/extract/llm/document path) enforces the 25 MB `config.fetch.maxBodySize` cap; `PDFProcessor` downloads get a real 30 s `AbortSignal` (the old `timeout:` init option was silently ignored) plus a size cap; SearXNG searches time out at 15 s; `WebhookDispatcher` delivery + health checks use `AbortSignal.timeout` (one hung endpoint stalled the whole serialized queue); `branding` stylesheet fetches run concurrently (pool of 4) under a single ≤10 s overall deadline (was up to ~160 s sequential); `BFSCrawler`'s per-domain replacement timer is reassigned to `timeoutId` so it's actually cleared (was one leaked pending timer per fetched page). **Init & module lifecycle:** `SnapshotManager`/`TrackChangesTool` move from fire-and-forget constructor `initialize()` (opaque `'Unhandled error.'` rejections) to an awaited, memoized `ensureInitialized()` called from every entry point, with snapshot storage rooted at `~/.crawlforge/snapshots` instead of `process.cwd()` (Claude Desktop launches with cwd `/` — writes silently failed); the module-level `trackChangesTool` eager singleton is replaced by a lazy Proxy (same export surface; importing the module no longer constructs a duplicate ChangeTracker/SnapshotManager stack, creates `cache/`+`snapshots/` dirs in cwd, or hangs the process on a non-unref'd timer); `StealthBrowserManager.launchStealthBrowser` gets a single-flight guard (two interleaved launches orphaned a `--no-sandbox` Chromium); `LocalizationManager` health-check intervals are unref'd (handles were already stored/cleared) — standalone test children now exit without `--test-force-exit`. **Tests:** +23 (802 → **825**, 1 deliberately skipped) in two new suites — `phase3-leaks.test.js` (12: WeakRef/`--expose-gc` GC assertions, LRU/TTL/meta-strip/bounded-cache, history stripping, import-side-effect and cleanup-teardown child-process exit checks) and `phase3-timeouts.test.js` (11: local trickle-body servers proving `_fetch`/worker/`_fetchAndParse`/SearXNG/webhook abort at their deadlines, research racer-cleared + signal-abort assertions, PDF oversize fast-reject). No version bump (unreleased, ships with the next publish). **Verification:** `npm run test:unit` **825 tests / 824 pass / 0 fail / 1 skipped**; `npm test` **100.0% COMPLIANT / 0 errors**. Files: `server.js`, 10 files under `src/core/`, 8 under `src/tools/`, 2 new test suites.

### Remediation Phase 2 — Tool-breaking correctness bugs (2026-08-03, released in v5.0.0)

Third phase of the [remediation plan](./plan/README.md) — closes all **52 Phase 2 findings** (1 critical, 13 high, 24 medium, 14 low/test-gap) from the [2026-08 audit](./docs/CODEBASE_AUDIT_2026-08.md): the "silently wrong output" class. **The critical:** `crawl_deep`'s BFS awaited child pages from inside an occupied p-queue slot, so the per-task queue timeout measured the *whole recursive crawl* (any crawl >30 s threw away every fetched page as `Promise timed out`) and low concurrency deadlocked outright — children are now fire-and-forget onto the queue with `crawl()` driving to `onIdle()`; verified completing multi-page crawls at `concurrency: 1`. **Cache lies fixed:** `crawl_deep`/`map_site` cache keys now cover every response-changing param (extract_content/patterns/robots/session; search/domain-filter/metadata/grouping) — the v4.6.0 `map_site` `search` ranking is no longer dropped on cache hits. **Ignored-options class:** server.js `options` schemas for `extract_content`/`summarize_content`/`analyze_content` get `.passthrough()` (zod was stripping every documented key); `summarize_content`'s extractive summarizer actually runs for the first time (`new SummarizerManager(text, n)` + `getSummaryByRank()`; `summaryLength` now effective); partial `ranking_weights`/`deduplication_thresholds` deep-merge instead of wholesale-replacing (no NaN scores / disabled dedup checks); `deep_research` `maxUrls>500` no longer deterministically fails (per-query clamp ≤100), its 4 dropped LLM state maps are restored, and its advertised flags/searchConfig finally reach the orchestrator on the constructor's real contract. **Wrong-output class:** `extract_links` resolves relative hrefs against the page URL (not origin), honors `<base href>`, and classifies protocol-relative links external (mirrored in `scrape`); `scrape` formats no longer mutate the shared cheerio doc (order-independent) and binary content-types error explicitly; charset-aware body decoding (Content-Type/`<meta>`); `scrape_structured` keeps parallel arrays index-aligned with null placeholders and parses `@`-containing selectors; `extract_structured` survives non-CSS-identifier schema keys and surfaces LLM failures; `extract_with_llm` normalizes schemas for Ollama like Anthropic; `process_document` handles `sourceType:'file'`, errors on out-of-range PDF `pageRange`, drops the never-functional PDF `password` option, and (with `extract_content`) stops treating `#anchor`/`/apple` URLs as SPA signals; `analyze_content` language-alternative confidences un-inverted. **Tracking/core:** `track_changes` `get_history`/`monitor` no longer TypeError on documented default calls; content similarity is token-Jaccard on content (was Hamming distance between sha256 hex strings — trivial edits scored ~0% similar and fired 'moderate' alerts); `SnapshotManager`'s stub delta path (data loss: retrieval returned the *previous* version) removed in favor of full compressed persistence; `generate_llms_txt` uses a fresh analyzer per call (no cross-call domain/error contamination) and the server schema mirrors the tool (`checkSecurity` default **false** — no surprise /admin//login probing; `probeRateLimit`/`robotsStyle` reachable); `scrape_with_actions` failure paths return per-action results + the error screenshot, `captureIntermediateStates` works without `ALLOW_JAVASCRIPT_EXECUTION`; `batch_scrape` async batches are pollable in-flight, `cancelBatch` actually aborts (AbortController), `statusCheckUrl` names the real tool; `agent` `maxSteps`/`maxUrls` decoupled (hard stops unchanged); `CircuitBreaker.execute()` fixed; `youtube-video` template survives relative canonicals. **Tests:** +289 (513 → **802**) — the six stub-based extract suites replaced with real-module tests, table-driven template coverage across all 10 extractors, real `LocalizationManager` cleanup test, new `bfsCrawler`/`sitemapParser`/`urlNormalizer`/`circuitBreaker`/`llmsTxtAnalyzer`/`researchOrchestrator-limits`/`resultRanker`/`resultDeduplicator`/`server-schema-regressions` suites, snapshot delta round-trip, cache-key sensitivity, and a reproduction test per 🟠 HIGH finding; `test:unit` glob widened to `tests/unit/**/*.test.js` so the `tools/**` subtree finally runs under the standard command (gap flagged since v4.7.0). No version bump (unreleased, ships with the next publish). **Verification:** `npm run test:unit` **802/802**; `npm test` **100.0% COMPLIANT / 0 errors**; live re-smokes green (crawl_deep concurrency:1, summarize short≠long, extract_links `/docs/` resolution, finite partial-weight ranking, cache-key correctness). Files: `server.js`, `package.json`, 33 files across `src/core/`, `src/tools/`, `src/utils/`, ~25 test files (9 new suites).

### Remediation Phase 1 — Critical security holes: SSRF · OAuth · secrets · billing (2026-08-03, released in v5.0.0)

Second phase of the [remediation plan](./plan/README.md) — closes all **14 Phase 1 findings** (4 critical, 5 high, 4 medium, 1 test-gap) from the [2026-08 audit](./docs/CODEBASE_AUDIT_2026-08.md), i.e. the security half of the 5 confirmed criticals. **SSRF core (`src/utils/ssrfGuard.js`):** fixed the IP-literal bypass (pre-flight `ipBlocked()` on `net.isIP` hostnames + a `buildConnector` wrap validating IP-literal redirect hops per-connect, which `lookup`-based guarding can never see), fixed IPv4-mapped/compatible IPv6 (`::ffff:127.0.0.1` and friends normalized to embedded IPv4 in both stage-1 and strict modes), wired the previously dead `BLOCKED_DOMAINS` config into pre-flight, made the allowlist per-hop, and exported a shared `assertUrlAllowed()` for non-fetch subsystems. **Path wiring:** `scrape_with_actions` Playwright navigation now validates before `page.goto` **and** re-checks `page.url()` after (closing the browser internal-network read primitive); `map_site` page/metadata fetches, `process_document` PDF downloads, `WebhookDispatcher` delivery + health checks, and `deep_research` webhook notifications (now with a 10s timeout) all moved to `safeFetch`. **OAuth:** `/oauth/authorize` requires proof of the operator API key (Bearer header or `api_key` param, constant-time hash comparison) before issuing a code — the anonymous register→authorize→token mint billed to the operator is closed. **Secrets:** usage-telemetry params run through `maskSecrets()` before `POST /api/v1/usage` (+ `cookie` pattern); `deep_research` no longer logs `llmConfig` API keys. **Billing:** the error half-charge only applies once the handler actually ran (credit-check throws bill zero); `checkCredits` distinguishes 401/403 (descriptive invalid-key error) from 5xx (grace window) instead of silently returning undefined → "Insufficient credits"; usage reporting checks `response.ok` and queues/retains rejected events instead of dropping them. **Tests:** +33 — literal-IP/mapped-IPv6/kill-switch(subprocess)/redirect-hop(end-to-end) cases in `ssrfGuard.test.js`, plus new `phase1-ssrf-paths.test.js` (blocked-target test per fetch path), `phase1-oauth.test.js`, `phase1-billing.test.js`; legacy `oauth.test.js` flows updated to present key proof. No version bump (unreleased, ships with the next publish). **Verification:** `npm run test:unit` **513/513**; `npm test` **100.0% COMPLIANT / 0 errors**. Files: `src/utils/ssrfGuard.js`, `src/core/ActionExecutor.js`, `src/core/WebhookDispatcher.js`, `src/core/processing/PDFProcessor.js`, `src/core/AuthManager.js`, `src/server/withAuth.js`, `src/server/auth/oauth.js`, `src/tools/crawl/mapSite.js`, `src/tools/research/deepResearch.js`, `src/utils/secretMask.js`, `tests/unit/ssrfGuard.test.js`, `tests/unit/oauth.test.js`, `tests/unit/phase1-ssrf-paths.test.js` (new), `tests/unit/phase1-oauth.test.js` (new), `tests/unit/phase1-billing.test.js` (new).

### Remediation Phase 0 — Dependency currency & audit cleanup (2026-08-03, released in v5.0.0)

First phase of the [remediation plan](./plan/README.md) produced by the [2026-08 deep codebase audit](./docs/CODEBASE_AUDIT_2026-08.md) (109 defects catalogued; baseline green). **Zero code change:** `npm update` within existing caret ranges + one new `overrides` entry (`"adm-zip": "^0.6.0"`). `npm audit` dropped from **16 vulnerabilities (8 high, 6 moderate, 2 low)** to **4 moderate (0 high/critical)** — beating the phase target, since the adm-zip HIGH cleared too. Key bumps: `undici` 7.29.0 (2 HIGH advisories cleared), `@modelcontextprotocol/sdk` 1.30.0, `isomorphic-dompurify` 3.19.0 (held on jsdom 29.x to preserve the Node ≥18 floor), plus routine caret minors. **Honest deviations:** the moderate `@hono/node-server` advisory (GHSA-frvp-7c67-39w9) did not clear — the pre-existing overrides pin keeps it on 1.x for Node ≥18 (fix needs 2.0.5+/Node ≥20); it and `node-cron`→`uuid` (GHSA-w5hq-g745-h8pq, breaking major) are deferred to Phase 5's Node-floor decision. No version bump (nothing user-facing shipped). **Verification:** `npm run test:unit` 480/480; `npm test` 100.0% COMPLIANT / 0 errors. Files: `package.json`, `package-lock.json`, `docs/security-audit-report.md`, `CHANGELOG.md`, `plan/`, `docs/CODEBASE_AUDIT_2026-08.md` (audit report + plan first committed here).

### v4.10.0 — Steer any MCP client toward CrawlForge for web work (2026-07-13)

**Why:** A member asked for CrawlForge to be the *preferred* tool whenever web scraping, web search, or deep research happens — in Claude Code or any other LLM — and applied **automatically on package upgrade**, not as a one-off per-developer config. Exploration surfaced the deciding constraint: `package.json` `postinstall` is **echo-only**, so skills/config-merge artifacts (`~/.claude/skills`, `~/.claude.json`) do **not** refresh on `npm upgrade`. The only artifact that updates automatically is the **MCP server binary** (the client relaunches `npx crawlforge@latest mcp`). So the steer had to live in the MCP layer.

**What (server.js).** Added a second `ServerOptions` argument to `new McpServer(...)` carrying an **`instructions`** string (SDK `^1.29.0` supports it; the slot was previously unused). It is returned in the `initialize` result and — per the MCP spec — clients MAY inject it into the model's system context as a hint. It routes web search → `search_web`/`serp_rank`, page fetch/scrape → `scrape`/`fetch_url`, main content → `extract_content`, site crawl → `map_site`+`crawl_deep`, research → `deep_research`, batch → `batch_scrape`, anti-bot → `stealth_mode`/`scrape_with_actions`, with an explicit fall-back-to-built-ins-when-unavailable clause (guidance posture, chosen over a hard block). Reinforced by a one-clause "Preferred over the client's built-in …" addition to the 4 overlapping tool descriptions (`search_web`, `fetch_url`, `scrape`, `deep_research`), which are always shown in `tools/list`.

**Secondary (skill).** `src/skills/agent-skills/crawlforge-getting-started/SKILL.md` gained a "Prefer CrawlForge for web work" section — reinforces the same routing for Claude Code / Cursor / VSCode, but only reaches members who re-run `crawlforge install-skills` / `crawlforge init` (echo-only `postinstall`), so it complements rather than replaces the MCP-layer change.

**Also shipped.** `serp_rank` now returns the full top-10 organic SERP listing alongside the target domain's rank positions (commit `f0a9f63`, made ~74 min after v4.9.0 was published to npm at 16:56 UTC 2026-07-01, so it first reached npm in this 4.10.0 publish — not in 4.9.0).

**Honest limitation:** guidance, not enforcement — an MCP server cannot disable a client's own `WebSearch`/`WebFetch`; hard-blocking is only possible in each client's own config (Claude Code hooks/permissions) and cannot be pushed via the package. Deliberately out of scope.

**Verification:** live `initialize` handshake confirmed the response now carries the `instructions` string (spawned `server.js`, sent an `initialize` request, asserted `result.instructions` contains the steer); server boots clean. Version bumped `4.9.0 → 4.10.0` across `package.json`, `package-lock.json`, `server.json` (×2), `server.js` (`McpServer` version), `CLAUDE.md`, `CHANGELOG.md`. Files: `server.js`, `src/skills/agent-skills/crawlforge-getting-started/SKILL.md`, `CHANGELOG.md`, `CLAUDE.md`, `package.json`, `package-lock.json`, `server.json`, `PRD.md`. **Left open (maintainer step):** commit/push and `npm publish` — members receive the steer only after the new version is published and their client relaunches `crawlforge@latest`.

### v4.9.0 — `serp_rank` tool + billing hardening (real Google organic rank via DataForSEO) (2026-07-01)

Added the **27th** MCP tool, `serp_rank` — reports where a target domain ranks in Google's **real organic SERP** for a keyword (the position `search_web`/Google Custom Search cannot give). Backed by the DataForSEO **Google Organic Live Advanced** API (`POST /v3/serp/google/organic/live/advanced`, HTTP Basic auth). **New files:** `src/tools/search/serpRank.js` (tool: Zod schema, subdomain-aware domain matching, multi-position collection, `{configured:false}` graceful degradation — never fabricates a rank), `src/tools/search/adapters/dataforseoSearch.js` (adapter: `status_code:20000` envelope+task checks, `rank_group`/`rank_absolute` normalization, 401/402/429 error mapping, 30s `AbortSignal.timeout`), `tests/unit/serpRank.test.js` (26 network-free cases against the real classes via a stubbed `fetch`), `scripts/smoke-serp-rank.mjs` (live one-shot smoke). **Wiring:** registered in `server.js` (import + `new SerpRankTool()` + `registerTool` + banner array/count 26→27); credentials via `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` (documented in `.env.example`), billed to the user's own DataForSEO account (~US$0.002–0.004/call), separate from CrawlForge credits.

**Billing (`AuthManager.getToolCost` + `withAuth`).** `serp_rank` costs **5** credits when configured and **0** when DataForSEO env is unset (the tool short-circuits to a no-op). Two `withAuth` hardenings, product-wide: (1) a `creditCost === 0` call now emits **no** usage event at all (so the backend can't re-price a free no-op, and the `Math.max(1, …)` error floor can't bill a "free" call 1 credit); (2) a tool that returns `{ isError:true }` (the shared self-catching pattern) is now treated as an **error outcome** billed at the **half** rate — not full — honoring CLAUDE.md's "half credits on error" contract for every tool.

**Adversarial verification (4-agent workflow) + live proof.** An independent review found and I fixed: **`depth` max was `700` but DataForSEO caps it at 200** (confirmed against the live docs; `700` is the *keyword* char-limit) → capped at 200 in `serpRank.js` + `server.js`; the free-no-op usage-event leak (above); and a tautological sort test (rewritten with an out-of-order fixture) plus added coverage for null `rank_group`, adapter defaults, the `split('?')` host-normalization branch, the `AbortError` alias, and `ZodError`/enum/bounds rejects. The **featured-snippet** review finding was overstated (a snippet page still surfaces as its `organic` item) → left organic-only by decision. **Live smoke** (`node scripts/smoke-serp-rank.mjs`, real API) confirmed the wire format end-to-end: `github.com` at organic position 1, `organicResults:16`, `cost:$0.004`.

**Docs synced to 27 tools** (current-facing only; historical CHANGELOG/PRD records left at 26): `CLAUDE.md`, `README.md`, `SKILL.md`, `src/skills/agent-skills/crawlforge-getting-started/SKILL.md`, `package.json`, `server.json`, `docs/PRODUCTION_READINESS.md`, `docs/registry-submission.md`, plus the `server.js` McpServer description + getting-started prompt.

**Tests:** `npm run test:unit` **477/477** (+29) sandbox-off; MCP compliance **100% COMPLIANT / 0 errors**; cost-parity **27 tools / 0 mismatches**. **Backend parity DONE:** added `serp_rank: 5` to `crawlforge-website/src/lib/credits.ts` `TOOL_CREDIT_COSTS` (+ jest test; commit `6f4be7a`) and synced `scripts/verify-cost-parity.mjs` (commit `db3f725`). **Bumped 4.8.1 → 4.9.0** (`package.json`, `package-lock.json`, `server.json` ×2, `server.js` McpServer version, `CLAUDE.md`, `CHANGELOG.md`); merged `development` → `main` and pushed both; `npm publish` as owner `slacey75`. Standalone/global MCP clients pick this up via `npm install -g crawlforge-mcp-server@latest`; the project `.mcp.json` local `server.js` goes live on `/mcp` reconnect. **Known/left-open:** website display surfaces (tool catalog/playground/docs) don't yet list `serp_rank` — billing works without them; separate front-end follow-up. Files: `src/tools/search/serpRank.js` (new), `src/tools/search/adapters/dataforseoSearch.js` (new), `server.js`, `src/core/AuthManager.js`, `src/server/withAuth.js`, `.env.example`, `tests/unit/serpRank.test.js` (new), `tests/unit/authManager.test.js`, `tests/unit/withAuth.test.js`, `tests/unit/phaseC-regressions.test.js`, `tests/unit/phaseD-regressions.test.js`, `scripts/smoke-serp-rank.mjs` (new), `CLAUDE.md`, `README.md`, `SKILL.md`, `src/skills/agent-skills/crawlforge-getting-started/SKILL.md`, `package.json`, `server.json`, `docs/PRODUCTION_READINESS.md`, `docs/registry-submission.md`, `PRD.md`.

### v4.8.1 — Fix: deep_research dropped its top-level `sources` list in LLM-synthesis mode (2026-06-28)

The reported "deep_research drops its sources list" symptom had a still-open, distinct manifestation from the earlier `credibilityThreshold` fix (which refuted the raw-evidence-mode variant). Root cause: `DeepResearchTool.formatResults()` (`src/tools/research/deepResearch.js`) has two divergent branches. The **raw_evidence** branch (no LLM key — this server's default) always emits a top-level `sources[]`. The **llm** branch only emitted `sources` for `outputFormat:'citations_only'`; the default `comprehensive` returned the list under `supportingEvidence`, `summary` under `topSources`, and `conflicts_focus` returned **no source list at all**. **Trigger:** `enableLLMFeatures` flips true whenever `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` is in the server env **or the caller passes `llmConfig.{openai,anthropic}.apiKey` in the tool params** (the schema explicitly supports this) — so on a key-less server, any caller who supplies an LLM key (a documented usage) lost `sources` from the default output. **Fix (surgical, 1 addition):** lift a single canonical `sources[]` (`{title,url,credibility,relevance}` mapped from `supportingEvidence`) into the shared `formatted` base object so every output format and both synthesis modes return it; `citations_only`'s explicit `sources` (identical shape) is unchanged and the raw_evidence branch is untouched. At every format the source list is now present. **Reproduction:** the live `deep_research` MCP path was blocked by an external Google search-API quota exhaustion at the time, so the bug + fix were proven deterministically by driving the real `formatResults()` offline across all 4 formats × both modes (8/8 now return `sources`). New regression tests in `tests/unit/tools/research/deepResearch.test.js` exercise the **real** `DeepResearchTool.formatResults()` (the existing suite there was fully stubbed) — 4 LLM-mode formats + 1 raw_evidence parity check. Tests: default `npm run test:unit` **448/448**; full recursive `tests/unit/**` **610/610** sandbox-off; MCP compliance **100% COMPLIANT / 0 errors / 26 tools**. **Coverage gap (pre-existing, unchanged):** `test:unit` globs only `tests/unit/*.test.js`, so the `tools/**` regression tests run under the recursive command, not the default gate. **Bumped 4.8.0 → 4.8.1 and published to npm as owner `slacey75`** — also realigned `server.json` (×2), `server.js` (`McpServer` version), and `package-lock.json`, which the 4.8.0 release had left pinned at `4.7.2` (only `package.json` was bumped then). Merged `development` → `main` (fast-forward) and pushed both. Standalone/global MCP clients pick this up via `npm install -g crawlforge-mcp-server@latest`; the project `.mcp.json` local `server.js` goes live on `/mcp` reconnect. Files: `src/tools/research/deepResearch.js`, `tests/unit/tools/research/deepResearch.test.js`, `package.json`, `package-lock.json`, `server.json`, `server.js`, `CLAUDE.md`, `CHANGELOG.md`, `PRD.md`.

### Fix: honest per-test console output in MCP compliance harness (2026-06-28, branch `fix/compliance-console-honest-logging`, no version bump)

`tests/integration/mcp-protocol-compliance.test.js` printed `✅ <name> test completed` as the **unconditional last line of every test method's `try` block** — decoupled from the `success` boolean it had just recorded via `addTest` — so the 3 methods that score `success:false` (`errorHandling`, `toolExecution`, `parameterValidation`) still rendered a green ✅, contradicting the suite's own `70.0% / NON_COMPLIANT` score (`passedTests = filter(t => t.success)`; `successRate < 90 ⇒ NON_COMPLIANT`). The summary line likewise hardcoded `✅ Status: ${status}` next to `NON_COMPLIANT`. Fix is **logging-only** (no assertion or scoring change): each per-test line now reflects the recorded success boolean — `✅ … passed` vs `⚠️ … completed with failures` — keeping `❌` reserved for thrown exceptions in the `catch`; the summary status line shows `✅`/`⚠️`/`❌` by compliance status. Verified by running the suite: 7 tests now show ✅, the 3 show ⚠️, status shows `❌ NON_COMPLIANT`, Success Rate unchanged at **70.0%**, suite still exits 0. The 70% itself remains the pre-existing **deterministic** baseline (the `errorHandling`/`parameterValidation` cases assert JSON-RPC `-32602` for tool/param errors that MCP correctly returns in-band as `isError:true`; `toolExecution`/`responseSchema`/`largePayloadHandling` depend on live `httpbin.org`) — not a regression and intentionally **not** changed here, only made visible. On branch only; not merged or published. Files: `tests/integration/mcp-protocol-compliance.test.js`, `PRD.md`.

### v4.7.2 — fix scrape_with_actions + extract_structured (full live tool audit, 2026-06-28)

Second full live audit of all 26 MCP tools — each invoked through the real `mcp__crawlforge__*` interface and judged on *actual output*, not just "no exception thrown" (a 26-way parallel sweep). **24 tools passed outright; `extract_structured` and `scrape_with_actions` were genuinely broken**, root-causing to **6 distinct defects**: (1) the `ActionExecutor` wait validator rejected `{type:"wait", timeout:1000}` — the exact shape the project's own `test-tools.js` uses — because `timeout` was treated only as the abort deadline, not a wait duration; (2) `scrape_with_actions` `formats:["markdown"]` returned the literal placeholder `"Content not available in markdown format"` because `extractFinalContent()` never set `outputFormat:'markdown'`; (3) successful `screenshot` actions were never collected into `executionContext.screenshots` (only error screenshots were) so `screenshots[]` was always empty; (4) the documented `crawlforge://screenshot/{actionId}` resources were never created — `ResourceRegistry.storeScreenshot()` existed but was never called; (5) **latent, first reachable via #4:** `resources/read` threw for *every* resource type because the MCP SDK passes the read callback a `URL` object while `parseResourceUri()` calls `String#startsWith`; (6) `extract_structured`'s CSS fallback returned empty `{}` with no LLM + no `selectorHints` because a field literally named `title` never mapped to `<h1>`/`<title>`. Fixes: wait accepts `timeout` as a duration (no selector/text) with an abort-race guard (`ActionExecutor.js`); markdown `outputFormat` plumbed through (`ScrapeWithActionsTool.js`); successful screenshots collected (`ActionExecutor.js`); handler registers screenshots + attaches `resourceUri` (`server.js`); `readResource()` coerces URI→string (`ResourceRegistry.js`); semantic-selector last-resort map for common field names (`extractStructured.js`). Verified end-to-end through a freshly-spawned `server.js` (real browser + full JSON-RPC round-trip incl. `resources/list`+`read`), plus dedicated pure + real-browser integration scripts — all green. Tests: default `npm run test:unit` **406/406** sandbox-off (the 13 `streamableHttp`/`searchWebSearxng` cases are the pre-existing `listen EPERM` sandbox artifacts; pass 24/24 with network). MCP compliance unchanged at its pre-existing **70%** baseline — proven pre-existing by a `git stash` A/B (clean tree also 70% / 0 errors). Bumped 4.7.1 → 4.7.2 (`package.json`, `package-lock.json`, `server.json` ×2, `server.js` McpServer version, `CHANGELOG.md`). Merged `development` → `main` and pushed both; `npm publish` as owner `slacey75`; **global/standalone MCP clients pick this up via `npm install -g crawlforge-mcp-server@latest`** (the project `.mcp.json` runs local `server.js`, so it goes live on `/mcp` reconnect). Files: `src/core/ActionExecutor.js`, `src/tools/advanced/ScrapeWithActionsTool.js`, `src/tools/extract/extractStructured.js`, `src/resources/ResourceRegistry.js`, `server.js`, `package.json`, `package-lock.json`, `server.json`, `CHANGELOG.md`, `PRD.md`.

### v4.7.1 — publish deep_research + generate_llms_txt fixes (2026-06-28)

Patch release bundling the two same-day fixes below — `deep_research` `credibilityThreshold` was a dead no-op, and `generate_llms_txt` rendered literal `undefined` in `llms-full.txt` — and publishing them to npm. Both surfaced from a full live audit of all 26 MCP tools (every tool confirmed functional, zero runtime errors; these were the only defects). Bumped 4.7.0 → 4.7.1 (`package.json`, `server.json` ×2, `server.js` McpServer version, `CHANGELOG.md`). Merged `development` → `main` (clean fast-forward, no divergence) and pushed both branches; `npm publish` as owner `slacey75`. Tests: default `npm run test:unit` **406/406**; full recursive `tests/unit` (all 43 files incl. the `tools/**` subtree) **563/563**, sandbox-off. The project `.mcp.json` already runs local `server.js`, so those sessions had the fixes after an `/mcp` reconnect; **standalone/global MCP clients pick this up via `npm install -g crawlforge-mcp-server@latest`**. Files: `package.json`, `server.json`, `server.js`, `CHANGELOG.md`, `PRD.md`.

### Fix: generate_llms_txt rendered literal "undefined" + ignore .mcp.json (2026-06-28, no version bump)

A full live audit of all 26 MCP tools (run against the project `.mcp.json` MCP, which serves local `server.js` in creator mode) found every tool functional with zero runtime errors — and surfaced ONE genuine output defect in `generate_llms_txt`. The `llms-full.txt` "Rate Limiting and Technical Guidelines" section printed literal `undefined` (`Delay between requests: undefinedms`, `Maximum concurrent requests: undefined`, `Requests per minute: undefined maximum`, a bare `undefined` justification, `Average response time: undefinedms`). Root cause: `LLMsTxtAnalyzer.analyzeRateLimiting()` is intentionally gated behind `probeRateLimit:true` (its 5 sequential requests are intrusive), so on the default path `this.analysis.rateLimit` stays the empty-object init `{}` — but the `generateLLMsFullTxt` template guard `if (analysis.rateLimit)` treats `{}` as truthy and renders its undefined fields. Reproduced on both books.toscrape.com (73 pages analyzed) and example.com (0 pages). Fix: `LLMsTxtAnalyzer.js` now initializes `rateLimit` with conservative defaults (recommendedDelay 1000ms / maxConcurrency 5 / recommendedRPM 30 + an honest "defaults applied; live probing not performed" reasoning; `averageResponseTime: null`) — the same defaults the codebase already used in `generateRateLimitGuidelines()`; the measured path still overwrites them when `probeRateLimit:true`. `generateLLMsTxt.js` only renders the `Average response time` line when actually measured (`averageResponseTime != null`). Added 2 real-renderer regression tests to `tests/unit/tools/llmstxt/generateLLMsTxt.test.js` (the existing suite was entirely stub-based and never exercised the real `generateLLMsFullTxt`). Verified: un-probed render shows conservative defaults with zero `undefined`; probed render still shows the measured value. Tests: default `npm run test:unit` **406/406**; full recursive run of all 43 `tests/unit` files (incl. the `tools/**` subtree) **563/563**, sandbox-off. Also added `.mcp.json` (local creator-mode MCP config holding the creator secret + Google keys) to `.gitignore`. **Not version-bumped or published**; since the project MCP runs local `server.js`, the fix goes live after an `/mcp` reconnect. **Coverage gap flagged (pre-existing, not fixed here):** `package.json` `test:unit` globs only `tests/unit/*.test.js`, so the 17 `tests/unit/tools/**` files (incl. this one) never run under the default command/CI. Files: `src/core/LLMsTxtAnalyzer.js`, `src/tools/llmstxt/generateLLMsTxt.js`, `tests/unit/tools/llmstxt/generateLLMsTxt.test.js`, `.gitignore`, `PRD.md`.

### Fix: deep_research credibilityThreshold was a dead no-op (2026-06-28, no version bump)

`deep_research`'s `credibilityThreshold` param (schema-validated `z.number().min(0).max(1).default(0.3)`) was silently ignored — setting it had zero effect. Two faults: (1) `deepResearch.js` routed it into `buildResearchOptions()` (the `conductResearch` options bag) instead of `buildOrchestratorConfig()`, so the `ResearchOrchestrator` constructor never saw it; and (2) the constructor never destructured `credibilityThreshold` anyway, and `verifySourceCredibility()` hardcoded `overallCredibility >= 0.3` — ignoring options entirely. **Reviewed the original bug report's impact claim ("drops every extracted source in creator/raw-evidence mode") and refuted it empirically:** with `enableLLMFeatures:false`, on-topic sources score ~0.55–0.77 (base credibility ≥~0.49 × relevance multiplier ~1.0) and clear the 0.3 floor; only near-zero-overlap sources drop. Verified kept-source counts: default→3/4, `0.0`→4/4, `0.7`→1/4. Because the hardcode equalled the schema default, default-config callers were already correct — the bug only bit anyone who set a non-default value. Fix: constructor now reads `credibilityThreshold = 0.3` and stores `this.credibilityThreshold` clamped to `[0,1]`; `verifySourceCredibility()` uses it. Also wired **two further hardcoded `0.3` inclusion gates** the report didn't mention — `compileSupportingEvidence()` (raw-evidence path) and `generateKeyFindings()` (LLM path) — to the same knob, so `credibilityThreshold:0.0` no longer silently re-drops sub-0.3 sources downstream; left the separate `0.6` *consensus* bar (`detectConsensus`) alone. `deepResearch.js` now passes the param via `scopeConfig` (reaches all 5 research approaches) and the dead `buildResearchOptions` line is removed. At the default 0.3 every changed gate is behavior-identical → no regression. New regression tests `tests/unit/phaseD-regressions.test.js` `D5.1`/`D5.2` (constructor wiring + clamp + kept-count behavior at thresholds 0/0.3/0.7). Unit **406/406** sandbox-off (the 13 `searchWebSearxng`/`streamableHttp` cases are the pre-existing `listen EPERM 127.0.0.1` sandbox artifacts only). **Not version-bumped or published** — takes effect for live MCP clients only after an npm publish. Files: `src/core/ResearchOrchestrator.js`, `src/tools/research/deepResearch.js`, `tests/unit/phaseD-regressions.test.js`, `PRD.md`.

### v4.7.0 — Reverted open-core free tier (all tools paid + API key required) (2026-06-27)

Product decision: undo the open-core "15 free local tools" model. **Every tool is now metered and requires an API key — there is no free tier.** Per-tool costs reverted to the historical "Scheme B" paid table (the scheme the website billing backend, docs, and templates always used — distinct from the MCP backend's old internal table, which differed on ~8 tools e.g. `search_web` 2-vs-5, `map_site` 5-vs-2). `AuthManager.getToolCost()` now returns no zeros: **1 cr** (`fetch_url`, `extract_text`, `extract_links`, `extract_metadata`, `scrape_template`, `list_ollama_models`, `get_batch_results`), **2 cr** (`scrape_structured`, `extract_content`, `map_site`, `process_document`, `localization`, `scrape`), **3 cr** (`track_changes`, `analyze_content`, `extract_structured`, `extract_with_llm`), **4 cr** (`summarize_content`, `crawl_deep`), **5 cr** (`stealth_mode`, `scrape_with_actions`, `batch_scrape`, `search_web`, `generate_llms_txt`), **8 cr** (`agent`), **10 cr** (`deep_research`). The `scrape` screenshot surcharge special-case is dropped (flat 2). Mechanics: removed the `freeTier` 0-cost short-circuit in `withAuth.js` (every call now checks credits + reports usage on success and error), removed `AuthManager.checkCredits(0) → true`, and reverted the `server.js` no-key startup banner — the server still starts so the MCP client can list tools, but every tool call errors `not configured` until a key is set. `getToolCost(tool, params)` → `getToolCost(tool)` (params no longer affect cost). Tests updated (`authManager.test.js` Scheme B table + key-required assertions; `withAuth.test.js` metered-tool tests); `scripts/smoke-free-tier.mjs` replaced with `scripts/smoke-require-key.mjs` (server starts keyless, `fetch_url` + `search_web` both demand a key, banner on stderr — 5/5). Unit **401/401** sandbox-off; MCP compliance at its pre-existing **70%** baseline (0 errors, 26 tools). Website reverted in lockstep (`src/lib/credits.ts` `TOOL_CREDIT_COSTS`, pricing page + i18n, docs `list_ollama_models` 0→1, templates `CREDIT_COSTS`); `scripts/verify-cost-parity.mjs` confirms both maps match. **Bumped 4.6.6 → 4.7.0** (`package.json`, `server.json` ×2, `server.js`, `CHANGELOG.md`); **takes effect for live MCP clients only after an npm publish.** `docs/tier-map.md` + `OPEN_CORE_PLAN.md` marked superseded. Files: `src/core/AuthManager.js`, `src/server/withAuth.js`, `server.js`, `src/tools/search/searchWeb.js`, `README.md`, `CHANGELOG.md`, `package.json`, `server.json`, `scripts/smoke-require-key.mjs` (new, replaces `smoke-free-tier.mjs`), `tests/unit/{authManager,withAuth}.test.js`, `PRD.md`; website: `src/lib/credits.ts`, `src/app/[locale]/pricing/page.tsx`, docs/templates, i18n. **Follow-up (same day):** removed two stale README lines that still claimed "the 15 local tools never consume credits" / "the 15 free local tools run without one" (pricing "All plans include" bullet + Security & Privacy bullet) — missed in the original revert; both now read as metered-for-all. Merged into `main`, `crawlforge-cli-upgrade`, and `revert/paid-tiers-require-api-key` and pushed.

### v4.6.6 — deep_research stealth extraction fallback + Camoufox engine (2026-06-16)

Follow-up to v4.6.5. v4.6.5 fixed *relevance*; live testing showed the remaining ceiling was *extraction* — the highest-value discussion sources (Reddit, Quora, forums) and DataDome/Cloudflare-protected pages return HTTP 403 to the plain `fetch` path, and (verified) realistic browser headers don't bypass them. Added a stealth-browser fallback to `ResearchOrchestrator.exploreSourcesInDepth()`: when normal extraction yields no usable content, the source is retried through a real fingerprinted browser and re-extracted from the rendered HTML. Bounded (`maxStealthRetries` default 8 + per-page timeout), lazy (browser stack loads only on first block), torn down after the extraction stage, and block/challenge pages are rejected by rendered content (title + body-length heuristics) rather than initial HTTP status so challenge shells never pollute results. New metrics `stealthRetries`/`stealthRecovered`; env toggles `RESEARCH_STEALTH_FALLBACK`, `RESEARCH_STEALTH_ENGINE`, `RESEARCH_MAX_STEALTH_RETRIES`.

Engine work: headless Chromium proved unable to clear modern challenges (tested — Cloudflare Turnstile/DataDome/hard 403 all block it), so the default `auto` engine prefers **Camoufox** (Firefox anti-detect), which verified-recovered Quora (3.5k chars) and Trustpilot (16k chars) that were otherwise fully blocked. Integrating it surfaced two real bugs: (1) the repo's `CamoufoxAdapter` called a non-existent `camoufox.launch` and the `camoufox` package's ESM bundle has a broken dynamic-require — the orchestrator loads the CJS build via `createRequire` and calls `Camoufox()` directly, with a macOS `properties.json` path bridge; (2) **`extract_content` silently ignored pre-rendered `html`** — `ExtractContentSchema` never declared the field its handler reads, so Zod stripped it and the tool always re-fetched the (blocked) URL, defeating both the stealth path and `scrape_with_actions` post-action pages. Camoufox is an optionalDependency (graceful fall back to Chromium stealth → plain fetch when absent); the Firefox binary is a one-time `npx camoufox fetch`. Hard IP-reputation blocks (Reddit edge 403) still resist headless stealth from any IP — residential proxies, out of scope. Unit 377/377 sandbox-on (+3 new tests in `tests/unit/researchStealthFallback.test.js`; the 13 `streamableHttp`/`searchWebSearxng` cases pass 24/24 sandbox-off). Shipped as **v4.6.6**. Files: `src/core/ResearchOrchestrator.js`, `src/tools/extract/extractContent.js`, `package.json`, `tests/unit/researchStealthFallback.test.js` (new), `CHANGELOG.md`, `PRD.md`.

### v4.6.5 — Fix: deep_research relevance (query-expansion pollution + off-topic authority) (2026-06-16)

Follow-up to v4.6.4. That release restored search *execution*; live use showed the searches still returned junk on commercial topics — a competitor-analysis run came back with ~2 usable sources, and instrumented repro surfaced DNI SCIF specs, university course catalogs and a DLA logistics handbook ranked as "top sources." Root causes: (1) `ResearchOrchestrator.generateResearchVariations()` appended academic/scientific suffixes (`what is …`, `… explained`, `… research paper`, `… peer reviewed`) to *every* topic regardless of `researchApproach`, dragging web search toward abstract government/academic PDFs; (2) `researchApproach` never reached query generation — it only set ranking weights in `buildOrchestratorConfig()`, so the orchestrator always behaved as `broad`; (3) `verifySourceCredibility()` rewarded `.gov`/`.edu` with 0.9 domain authority irrespective of topical relevance, so unrelated authoritative pages dominated. Three fixes: approach-aware query variations (`academic` keeps scholarly suffixes; `current_events` uses recency terms; `broad`/`focused`/`comparative` use commercial intent — `review`, `comparison`, `vs alternatives`, `pricing`, `best …`, `company`; stale hardcoded `2024` dropped); `researchApproach` now plumbed into the orchestrator constructor; credibility blended with per-source relevance (`overallCredibility *= 0.4 + 0.6 * relevanceScore`) so zero-overlap sources drop below the 0.3 threshold. Verified via instrumented repro: a clean commercial topic ("Sweetwater music gear retailer competitor comparison") now returns entirely on-topic sources (Sweetwater coverage, samash "Sweetwater vs Guitar Center", Reverb comparison, Yelp reviews) with no government/academic noise. Scoped out by request: bot-protected discussion sources (Reddit, Quora, gearspace, Facebook) return HTTP 403 to the plain-`fetch` extraction path — confirmed that realistic browser headers do **not** bypass their TLS-fingerprint/JS-challenge defenses; recovering those needs a browser/stealth extraction path. Unit 374/374 sandbox-on (the 13 `streamableHttp`/`searchWebSearxng` cases pass 24/24 sandbox-off; `listen EPERM` only). Shipped as **v4.6.5** (`package.json`, `server.json` ×2, `server.js` synced) and published to npm. Files: `src/core/ResearchOrchestrator.js`, `src/tools/research/deepResearch.js`, `CHANGELOG.md`, `PRD.md`.

### CI test fixes — stale basic-tool assertions + coverage hang (2026-06-15, no version bump)

GitHub's `test:coverage` job surfaced three failing assertions in `tests/integration/tools/basicTools.test.js`, all stale test expectations that hadn't been updated when the B1 contracts changed (no source bug): (1) `extractMetadata` title — test still expected `<title>` ('Test Page') but B1's fallback chain is `og:title → <title> → h1`, so it now returns 'OG Title'; (2) `scrapeStructured` `elements_found` — B1 made it a per-field DOM-match object, but the test asserted `>= 1` on the object (`NaN`); (3) `extractLinks` `filter_external` — the integration test asserted "keeps internal", but Phase A (A1.1, v4.3.0) deliberately defined `filter_external:true` to return **only external** links and locked it with a regression test, so the *integration* test was wrong (the code was correct — an initial code "fix" was reverted after the A1.1 regression test caught it). All three corrected to match shipped contracts. Separately, the "Error: The operation was canceled" at the end of the CI coverage step was the `test:coverage` script hanging on the dangling Playwright handle left by importing `StealthBrowserManager` (the same case CLAUDE.md documents); added `--test-force-exit` to the script (the unit-test CI step already had it). The other 14 "failures" in a local coverage run are the pre-existing `searchWebSearxng`/`streamableHttp` suites that fail only under the command sandbox's `listen EPERM 127.0.0.1` restriction — verified 451/451 green with the sandbox disabled. Files: `tests/integration/tools/basicTools.test.js`, `package.json`, `PRD.md`.

### v4.6.4 — Fix: deep_research silent zero-source runs + agent-pro search key plumbing (2026-06-09)

Root-caused a live report of `deep_research` finishing in <1s with `urlsProcessed: 0` despite claiming 4–5 search queries ran. `ResearchOrchestrator` builds its own private `SearchWebTool`, and no layer of the stack passed it the `search_web` config: `server.js` constructs `DeepResearchTool()` with no options (`getToolConfig` has no `deep_research` entry), and `buildOrchestratorConfig()`'s per-approach `searchConfig` blocks held only ranking/dedup weights. Every internal search threw "API key is required"; `gatherInitialSources()` swallowed it per-query, and `metrics.searchQueries` incremented *before* `execute()` — so the run looked like searches happened. Pre open-core Phase 2 the keyless constructor threw loudly; the Phase-2 key-optional constructor turned this into silent `success: true` with zero sources, meaning the production search path likely never worked outside creator mode. Four fixes: (1) `buildOrchestratorConfig()` merges `getToolConfig('search_web')` into `searchConfig` for all five approaches (the three approaches defining their own `searchConfig` previously clobbered any base value); (2) `AgentOrchestrator._getResearchOrchestrator()` now forwards `this._searchConfig` (same hole in `agent model:"pro"` — its direct search tool got the config but the pro orchestrator didn't); (3) `gatherInitialSources()` throws when *all* attempted queries fail (first underlying error included) and counts `searchQueries` only on actual execution — partial failure still proceeds; (4) since `conductResearch()` never rejects (returns a `handleResearchError()` payload), both `DeepResearchTool.execute()` and the agent pro path now detect the `error` field and return `success: false` instead of formatting the payload into a success-shaped result. New `tests/unit/researchSearchKey.test.js` (11 regression tests). Unit 398/398; MCP compliance at its pre-existing 70% baseline. Shipped as **v4.6.4** (`package.json`, `server.json` ×2, `server.js` McpServer version synced) and published to npm so the globally-installed MCP binary picks it up. Files: `src/tools/research/deepResearch.js`, `src/core/ResearchOrchestrator.js`, `src/core/AgentOrchestrator.js`, `tests/unit/researchSearchKey.test.js` (new), `CHANGELOG.md`, `PRD.md`.

### Open-core Phase 3 — 90-day usage pull + decision gate (2026-06-09, read-only, no code change)

Final phase of this session's `OPEN_CORE_PLAN.md` work. New read-only `crawlforge-website/scripts/usage-by-tool-90d.ts` (Prisma groupBy over `UsageLog`, internal pseudo-tools excluded, paid-plan split via `User.planId != 'free'`) ran against production (DATABASE_URL pulled by the user via `vercel env pull`; temp env file deleted immediately after extraction). Findings (2026-03-11 → 2026-06-09): 6 active users (1 paid), 2,932 total credits, 1,974 paid. `search_web` dominates with **82.7% of paid credits** (1,633 cr / 380 calls) and is already server-side/enforceable; `deep_research` is a distant second (6.6%, 13 calls); the newly-freed Tier-0 tools carried only ~10% of paid credits; `stealth_mode` had essentially zero usage (1 free-tier call). **Decision gate: stop after Phase 4 — Phase 5 not justified by data.** Phase 4 (`stealth_mode` server-side migration) stays justified strategically as the enforcement proof-of-pattern, not by current revenue. Recorded in `OPEN_CORE_PLAN.md` Phase 3 table. Files: `OPEN_CORE_PLAN.md`, `PRD.md`; website: `scripts/usage-by-tool-90d.ts` (committed earlier this session).

### Open-core Phase 2 — Free Tier 0 + key-optional client (2026-06-09, no version bump yet)

Second phase of `OPEN_CORE_PLAN.md`: the 15 Tier-0 tools are now officially free and run **without any API key**. `src/server/withAuth.js` short-circuits 0-cost invocations — no credit check, no usage report on success *or* error (the error path's `Math.max(1, …)` would otherwise have charged 1 credit for a free tool); `_cost.actual: 0` metadata, the single invocation log line, and metrics are kept. Cost resolution is now params-aware (`getToolCost(toolName, params)`), so `scrape` + `screenshot` format bills 2. `AuthManager.checkCredits(0)` returns true before the "not configured" hard-fail (defense in depth). The `server.js` no-key startup gate no longer `process.exit(0)`s — the server starts in free-tier mode with a stderr notice (stdout stays clean for MCP JSON-RPC); `SearchWebTool`'s constructor-time key requirement (which crashed the now-reachable no-key startup at server.js:142) moved to execute() time, preserving the SearXNG no-key path. Copy: README restructured to "15 free local tools + 11 metered premium tools", plan names reconciled to the live Stripe engine (Free/Hobby $19/Professional $99/Business $399); website pricing page re-tiered (`toolCredits` + `pricing.credits` i18n strings in en/es/ms/zh-Hans) and the playground gained `scrape`/`get_batch_results`/`agent` entries (required once `ToolName` grew). Verified live via new `scripts/smoke-free-tier.mjs` (clean-HOME stdio run: starts keyless, `fetch_url` succeeds with `_cost.actual===0`, `search_web` still demands a key, free-tier banner on stderr — 6/6). Client unit 387/387 (6 new Phase-2 tests in `withAuth.test.js`/`authManager.test.js`); MCP compliance at its pre-existing 70% baseline; website `type-check` and `test:unit:stable` green. Files: `src/server/withAuth.js`, `src/core/AuthManager.js`, `server.js`, `src/tools/search/searchWeb.js`, `README.md`, `scripts/smoke-free-tier.mjs` (new), tests; website: `src/app/[locale]/pricing/page.tsx`, `src/app/[locale]/playground/playground-client.tsx`, `messages/{en,es,ms,zh-Hans}.json`.

### Open-core Phase 1 — Reconciled credit-cost table (2026-06-09, no version bump yet)

First phase of `OPEN_CORE_PLAN.md` (with `docs/tier-map.md` as the cost source of truth). The client (`src/core/AuthManager.js getToolCost()`) and backend (`crawlforge-website/src/lib/credits.ts TOOL_CREDIT_COSTS`) tables had drifted (e.g. `search_web` 2 vs 5, `stealth_mode` 10 vs 5) — and because `/api/v1/usage` does `creditsUsed || getToolCreditCost(tool)`, the client's number silently billed. Both repos now share one 26-tool table: 15 Tier-0 free-local tools at 0 credits (incl. `extract_structured`, confirmed Tier 0 — user's own LLM; and `get_batch_results` — retrieval of an already-paid job) and 11 Tier-1 metered tools (`map_site`/`track_changes` 3, `generate_llms_txt`/`search_web`/`crawl_deep`/`batch_scrape`/`scrape_with_actions`/`localization` 5, `agent` 8, `deep_research`/`stealth_mode` 10). `getToolCost(tool, params)` is now params-aware: the browser-backed `screenshot` format of `scrape` costs 2, all other formats 0. Fixed the `|| 1` → `?? 1` fallback in both repos (0-cost lookups previously resolved to 1). New `scripts/verify-cost-parity.mjs` diffs the two tables (26 tools, 0 mismatches). Backend `tests/unit/lib/credits.test.ts` updated to the new table. Client unit 381/381; MCP compliance at its pre-existing 70% baseline (identical failure set to the 2026-06-07 report); backend `test:unit:stable` green. Behavior note: Tier-0 tools now *report* 0 credits but still require a key until open-core Phase 2 lands the 0-cost short-circuit + key-optional startup. Files: `src/core/AuthManager.js`, `scripts/verify-cost-parity.mjs` (new), `docs/tier-map.md`, `OPEN_CORE_PLAN.md`, `PRD.md`; website: `src/lib/credits.ts`, `tests/unit/lib/credits.test.ts`.

### v4.6.3 — README npm-parity fix (2026-06-07)

README header banner switched from a relative-path SVG (`assets/banner.svg`) to an absolute raw-GitHub URL to the JPG export (`assets/banner.jpg`). npm's README renderer blocks SVG and mishandles relative image paths, so the banner was broken on the npm package page while fine on GitHub; the absolute JPG renders identically on both. README text was already byte-identical between GitHub and the published npm tarball — only the banner rendering differed. Since npm only refreshes a package README on publish, this shipped as a version bump: `package.json`, `server.json` (manifest + npm entry), and the `McpServer` version in `server.js` (which had lagged at `4.5.0`) all synced to `4.6.3`, then `npm publish`. Files: `README.md`, `package.json`, `server.json`, `server.js`, `CHANGELOG.md`, `PRD.md`.

### Docs move: IMPROVEMENT_PLAN.md → docs/ (2026-06-07, no version bump)

Relocated `IMPROVEMENT_PLAN.md` from the repo root to `docs/IMPROVEMENT_PLAN.md` (identical content, pure `git mv`) to conform to the CLAUDE.md rule "Put all documentation md files into the docs/ folder." No code or tool changes.

### v4.6.2 — MCP registry submission prep (2026-06-07)

Follow-up to the GitHub discoverability pass: enables publication to the **official MCP
registry** and the community `awesome-mcp-servers` directories. Required a version bump because
the registry validates the **published npm tarball**, not local files (two failures surfaced
this live during `mcp-publisher publish`):
- **422** — registry caps `server.json` `description` at **≤100 chars** (trimmed to 84).
- **400** — registry rejected the package: the npm tarball for `4.6.1` lacked `mcpName`.
  `mcpName` must ship *inside the published package*, so `4.6.1` → **`4.6.2`** and re-publish
  to npm before `mcp-publisher publish`.

Changes:
- **package.json** — `version` 4.6.1 → 4.6.2; added `"mcpName": "io.github.mysleekdesigns/crawlforge-mcp-server"`.
- **server.json** (new, repo root) — `2025-12-11` schema; npm `crawlforge-mcp-server`, stdio, version 4.6.2; ≤100-char description.
- **docs/registry-submission.md** (new) — `mcp-publisher` runbook + ready-to-paste PR entries for punkpeye/appcypher `awesome-mcp-servers` (wong2 → mcpservers.org/submit; mcp.so).

Maintainer runs `npm publish` (4.6.2, tarball now carries `mcpName`) → `mcp-publisher publish`
→ opens the awesome-list PRs. Validated: `server.json` parses; `name` == `package.json.mcpName`;
versions in sync; description 84 chars.

### GitHub discoverability pass (2026-06-07, no version bump)

Docs/metadata-only change to make the repo (`github.com/mysleekdesigns/crawlforge-mcp`) easier to find on GitHub, modeled on a live analysis of Firecrawl's repo (`firecrawl/firecrawl`, 130k★) performed with CrawlForge's own MCP tools (`scrape` + `extract_metadata`). Firecrawl's findability levers we lacked: 19 GitHub Topics (we had **zero** — the biggest gap), a punchy social-card description, a custom social-preview image, and a banner + comparison/feature tables + community files. Changes (no `src/` code touched):
- **README.md** — centered SVG banner, expanded badge row + "Star us" CTA, Table of Contents, "Why CrawlForge?" value props, a **CrawlForge-vs-Firecrawl-vs-raw-API comparison table**, tool lists converted to grouped tables, back-to-top links.
- **package.json** — fixed stale description ("23 tools / v4.0" → 26 tools, current capabilities); keywords 24 → 36 (added `mcp-server`, `claude`, `cursor`, `ollama`, `ai-agents`, `deep-research`, `stealth-browser`, `html-to-markdown`, `llm`, `crawl`, `batch-scrape`, `screenshot`).
- **assets/** — new `banner.svg` (README header) + `social-preview.svg` (1280×640 source for the GitHub social card; PNG export uploaded manually — web-UI only).
- **Community files** — `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/FUNDING.yml`, root `SECURITY.md` + `CODE_OF_CONDUCT.md` (lights up GitHub's community-profile checklist).
- **GitHub repo metadata** — 20 MCP-tuned Topics + new description/homepage set via `gh repo edit` (requires maintainer `gh` re-auth; see plan). Manual follow-up: upload the social-preview PNG; submit to MCP awesome-lists / official MCP registry.

Verification: `npm test` exit 0; unit suite 381/381 pass (sandbox-off; HTTP-bind tests need a real `127.0.0.1` listen). SVGs well-formed; `package.json` parses.

### v4.6.1 — Patch: agent autonomous-search fix (2026-06-07)

Caught by live MCP smoke testing of the freshly-published v4.6.0 binary. The `agent` tool's GATHER phase (`src/core/AgentOrchestrator.js`) parsed search results as the MCP content-wrapped shape (`sr.content[0].text`), but `SearchWebTool.execute()` returns the **raw** results object — so `parsed` was always `null`, no URLs were ever queued, and every `agent` call without seed `urls[]` returned `{degraded:true, reason:"No content could be fetched…"}` (`steps:0`). Autonomous research — the headline Phase D capability — was effectively non-functional; only the seed-URL path worked. The Phase D unit test masked it by mocking `_searchTool.execute()` with the content-wrapped shape (encoding the orchestrator's wrong assumption). Fix: orchestrator now handles both shapes; all six search-tool mocks in `tests/unit/phaseD-regressions.test.js` corrected to the real raw shape so the suite guards the path. Verified live (`agent({prompt})` no-URL now searches → fetches → synthesizes). Unit suite 381/0 (sandbox-off); `npm test` 0 errors. Version 4.6.0 → 4.6.1. Files: `src/core/AgentOrchestrator.js`, `tests/unit/phaseD-regressions.test.js`, `CHANGELOG.md`, `PRD.md`, `package.json`.

### v4.6.0 — Phase D: Firecrawl-Competitive — Agent + Unified Scrape + Onboarding (2026-06-07)

Fourth execution phase of `IMPROVEMENT_PLAN.md`. Closes the three Firecrawl feature gaps with no clean CrawlForge equivalent — an autonomous **agent**, a **unified scrape** entry point, and **ranked map** — plus a one-command onboarding flow, all **local-first** (MCP-native primitives + local-LLM via Ollama; no cloud proxy/reliability layer). Purely additive: tool count 24 → 26, no breaking changes to existing tools.

**D1 — Ease-of-use:**
- New `scrape` tool (`src/tools/scrape/unifiedScrape.js`) — single fetch + one cheerio load, dispatches a `formats` array (`markdown` / `html` / `rawHtml` / `text` / `links` / `metadata` / `screenshot` / `{type:"json",schema,prompt?}`) plus `onlyMainContent`; partial-success is non-fatal via per-format `warnings[]`. Mirrors the `generateFormats()` output shape and reuses `extractBlockText`, the Readability→markdown helper, `htmlToMarkdown`, and `ExtractWithLlm` — no N-fetch fan-out.
- `extract_text` (`src/tools/basic/extractText.js`) — `extractBlockText($)` and the Readability→markdown conversion are now exported helpers so `scrape` reuses them against an already-loaded `$`; no behavior change to `extract_text`.
- `map_site` `search=` (`src/tools/crawl/mapSite.js`, `server.js`) — optional `search` string ranks discovered URLs via the existing `ResultRanker` (lazy singleton to avoid a per-request `CacheManager` timer) and emits `ranked_urls:[{url,score}]`; default (no-`search`) output shape unchanged.
- New `crawlforge init` CLI command (`src/cli/commands/init.js`, registered in `src/cli/index.js`) — orchestrates API-key detection + skill install (`install({target})`) + idempotent MCP-stanza merge into `~/.claude.json` / Claude Desktop / Cursor `~/.cursor/mcp.json` (the one genuinely new bit); flags `--all` / `--client` / `--yes`. `package.json` postinstall hint updated.
- New `SKILL.md` (repo root) — canonical agent-fetchable capabilities reference concatenated from `src/skills/*.md` with a Phase-D tools section; referenced from `README.md`.

**D2 — `agent` tool:**
- New `agent` tool (`src/tools/agent/agent.js` + `src/core/AgentOrchestrator.js`) — NL prompt → autonomous search/navigate/extract → prose-or-structured output, no URLs required. Hardcoded PLAN → GATHER → ACT → DECIDE → SHAPE state machine over existing pieces (`SearchWebTool`, `fetchAndParse`, `ExtractWithLlm`, `SamplingClient`, and `ResearchOrchestrator` for the `pro` tier). **Three independent hard stops — `maxSteps` (≤10), `maxUrls` (≤20), and a wall-clock budget — plus "answer found", all enforced in the orchestrator, never delegated to the LLM.** No-LLM-key path returns `{degraded:true, reason, ...evidence}` so the host LLM finishes (mirrors `deep_research`); `ElicitationHelper` confirms `pro`/expensive runs (fail-open).
- Registration & cost (`server.js`, `src/core/AuthManager.js`) — `scrape` and `agent` registered with `withAuth` after `deep_research`, added to startup tool list (24 → 26) and graceful-shutdown cleanup; `getToolCost()` `scrape:2` / `agent:8`; `projectCost()` scales `scrape` with format count and `agent` with `maxUrls` + `pro` tier (external LLM billed by provider, not in credits).

**D3 — Verification:** new `tests/unit/phaseD-regressions.test.js` (34 tests, mocked LLM/search/fetch — no live network; asserts the agent loop's `maxSteps`/`maxUrls`/wall-clock hard stops + clamps, the no-LLM degraded path, unified `scrape` single-fetch multi-format + partial-success, and `map_site` `search=` ranking). Full `npm run test:unit` green except the pre-existing `streamableHttp` / `searchWebSearxng` suites, which fail only under the sandbox's `listen EPERM` localhost-bind restriction and pass cleanly with the sandbox disabled (0 failures, verified). `npm test` MCP harness exits 0 (0 errors; 60% rate unchanged from v4.5.0). `node test-tools.js` 15/15 + 5 network-skipped (100%). Version bumped 4.5.0 → 4.6.0; tool count 24 → 26. **Deferred:** live MCP smoke tests (require publish + global-binary reinstall) and the optional `crawlforge://skill` MCP resource. Files: `IMPROVEMENT_PLAN.md`, `PRD.md`, `CHANGELOG.md`, `package.json`, `server.js`, `src/core/AuthManager.js`, `src/tools/basic/extractText.js`, `src/tools/crawl/mapSite.js`, `src/cli/index.js`, `README.md`, 4 new files (`src/tools/scrape/unifiedScrape.js`, `src/core/AgentOrchestrator.js`, `src/tools/agent/agent.js`, `src/cli/commands/init.js`), `SKILL.md`, `tests/unit/phaseD-regressions.test.js`, and a 1-line truth fix in `tests/unit/phaseC-regressions.test.js` (banner 24 → 26).

**Docs sync (follow-up):** `CLAUDE.md` (was stale at v4.2.4 / 23 tools → 4.6.0 / 26 tools, added `AgentOrchestrator`, `scrape/` + `agent/` tool dirs, `crawlforge init`, single-test-file command) and `README.md` (was listing 22 tools / claiming "23" → 26; added the 4 missing tools — `scrape`, `agent`, `scrape_template`, `get_batch_results` — in their correct credit tiers, `map_site search=` note, and a `crawlforge init` Quick-Start callout) brought current with the v4.6.0 surface.

### v4.5.0 — Phase C: Robustness, Security & Polish (2026-06-07)

Third and final execution phase of `IMPROVEMENT_PLAN.md`. Closes all C-series items — no memory/DoS vectors, correct timeouts, polite networking, consistent contracts, accurate metadata.

**C1 — Robustness:**
- `fetch_url` (`src/tools/basic/_fetch.js`) — added a body-size cap (Content-Length pre-check + streaming byte-count guard, configurable via `MAX_FETCH_BODY_SIZE`, default 25 MB → `src/constants/config.js`); User-Agent now derived from `package.json` version (`CrawlForge/<version> (+https://crawlforge.dev)`) instead of the stale `CrawlForge/1.0.0`.
- Fetch timeouts — `extractContent.js`, `processDocument.js`, `trackChanges/differ.js` switched the non-standard `timeout:` option to a real `signal: AbortSignal.timeout(...)`.
- `generate_llms_txt` (`LLMsTxtAnalyzer.js`) — intrusive probing is now opt-in: `checkSecurity` and new `probeRateLimit` default to `false`; API/security path probes run in bounded parallel batches (`PROBE_CONCURRENCY=6`) instead of long sequential loops; rate-limit probing only fires when explicitly requested.
- `crawl_deep` (`BFSCrawler.js`) — per-domain rate-limiter map (reuse rather than recreate per URL); domain/robots block messages moved from `console.error` to `logger.debug`.

**C2 — Stealth:**
- `stealth_mode` (`StealthBrowserManager.js`) — `engine` config (`'chromium'` default | `'camoufox'`); engine switch tears down a mismatched running browser and delegates to `CamoufoxAdapter` when selected; `sec-ch-ua` brand versions now derived from the resolved User-Agent's Chrome major version so the two headers stay consistent.

**C3 — Tool quality:**
- New `get_batch_results` tool (`server.js`) — paginated retrieval of `batch_scrape` results by `batchId` (tool count 23 → 24); also restored `list_ollama_models` to the startup tool list.
- `localization` — `handle_geo_blocking` renamed to `detect_geo_blocking` (no bypass is actually applied; returns recommendations only); fixed the US phone regex (`\\d` → `\d`).
- `extract_with_llm` — forces Anthropic structured output via tool-use (`tools` + `tool_choice`) when a `schema` is given; validates output with zod (`valid` / `validationErrors`); `parseJson` recovers the first *balanced* embedded JSON object/array (string/escape-aware, tolerates prose before and after); surfaces input-truncation metadata (`truncated`, `original_length`).
- `list_ollama_models` — hardened against non-array responses; `modified_at` normalized to ISO 8601.
- `process_document` — true page-range extraction (`pageRange:{start,end}` via per-page `pagerender` capture; `extractPDFPages` no longer returns all pages); server `options` schema made passthrough so granular options reach the tool; markdown builder de-dups the `<title>` heading vs the first `<h1>`.
- `batch_scrape` — webhook delivery status returned on the result.
- `extract_structured` — User-Agent unified to the versioned `CrawlForge/<version>` string.

**Verification:** `npm run test:unit` 360/360 pass (sandbox-off), incl. new `tests/unit/phaseC-regressions.test.js` (27 tests); `node test-tools.js` 20/20; `npm test` MCP harness exits 0 (0 errors); `npm audit` 4 pre-existing moderate (uuid/node-cron transitive, out of scope). Version bumped 4.4.0 → 4.5.0. Follow-up fix `9484000` (during initial WIP commit) — the body-size cap unconditionally read `response.headers.get()` / `response.body.getReader()` and crashed all 5 basic tools on responses without a Headers object or `ReadableStream` body (caught by the phaseA/phaseB regression mocks); now optional-chained with the streaming guard skipped when no readable body is present.

### v4.4.0 — Phase B: Result-Quality Upgrades (2026-06-06)

Second execution phase of `IMPROVEMENT_PLAN.md`. Closed all 12 Phase-B quality items — "working" tools now return accurate, well-structured, high-fidelity data.

**B1 — Extraction fidelity:**
- `extract_content` / `process_document` — corrected the inverted Flesch Reading-Ease formula to `206.835 − 1.015·avgWordsPerSentence − 84.6·avgSyllablesPerWord` (was char-based and inverted); added a `_countSyllables` helper and exposed `avgSyllablesPerWord`. Higher score = easier reading. `src/core/processing/ContentProcessor.js`
- `extract_text` — text mode now joins block-level elements with `\n\n` instead of collapsing all whitespace; markdown mode runs `@mozilla/readability` before Turndown, and `turndown-plugin-gfm` renders HTML tables as GFM pipe tables. `src/tools/basic/extractText.js`, `src/utils/htmlToMarkdown.js`
- `extract_metadata` — now parses and returns `json_ld` and `microdata` (previously advertised but absent); title follows an `og:title → <title> → h1` fallback chain. `src/tools/basic/extractMetadata.js`
- `scrape_structured` — added `@attr` attribute-extraction syntax (`a@href`, `img@src`), a `max_results` param, and changed `elements_found` from a result-key count to a per-field DOM-match-count object. `src/tools/basic/scrapeStructured.js`, `server.js`
- `extract_structured` — moved the "CSS fallback used" note from `validationErrors` into a separate `extractionNotes` array (no longer penalizes confidence); improved `ul/ol > li` array/list extraction. `src/tools/extract/extractStructured.js`
- `extract_content` — added `extractionMethod` (`readability` / `fallback_boilerplate_removal` / `raw_body_text`), `fallback_reason`, `confidence`, and `finalUrl` so callers can distinguish Readability output from last-resort body text. `src/tools/extract/extractContent.js`

**B2 — Crawl & search quality:**
- `crawl_deep` — new `content_max_length` param + `truncated` flag replacing the hardcoded 500-char cut; no `...` appended to already-short content. `src/tools/crawl/crawlDeep.js`, `server.js`
- `map_site` — now reuses `src/utils/sitemapParser.js` for sitemap-index recursion, gzip (`.xml.gz`) decompression, real cheerio XML parsing (CDATA/entities), and robots.txt sitemap discovery; `min=Infinity` fixed to `null`. `src/tools/crawl/mapSite.js`
- `search_web` — `total_results` is now a Number; real per-term BM25 IDF (replacing the constant `df`); true 64-bit SimHash via two independent FNV-1a seeds (bits 32-63 no longer mirror 0-31); top-level `finalScore`/`contentHash`/`scores`/internal fields stripped unless detail flags are set. `src/tools/search/providers/searxng.js`, `ranking/ResultRanker.js`, `ranking/ResultDeduplicator.js`, `searchWeb.js`
- `analyze_content` — word-boundary (`\bword\b`) topic categorization and emotion detection, eliminating substring false-positives (`'happy'`→`'app'`, `'glade'`→`'glad'`). `src/tools/extract/analyzeContent.js`

**B3 — Tracking & research quality:**
- `track_changes` — token-based Jaccard `calculateSimilarity()` (was length-only) with a sensible `DEFAULT_CHANGE_THRESHOLD = 0.85`. `src/tools/tracking/trackChanges/differ.js`
- `deep_research` — the no-LLM `raw_evidence` path now honors `outputFormat` (`summary` trims to top-5, `citations_only` returns citation shape + `citationSummary`, `conflicts_focus` surfaces a `conflictsNote`) and ranks evidence by credibility instead of silently ignoring the format. `src/tools/research/deepResearch.js`

**B4 — Verification:** new `tests/unit/phaseB-regressions.test.js` (56 reproduce→pass tests across all 12 items). Full recursive unit suite 488/488 green sandbox-off (the sandbox-on `listen EPERM 127.0.0.1` failures are the pre-existing HTTP-transport/searxng port-binding cases). `node test-tools.js` 20/20 (100%). `npm test` MCP harness exits 0 (0 errors). Version bumped 4.3.0 → 4.4.0; added `turndown-plugin-gfm` dependency. Files: `IMPROVEMENT_PLAN.md`, `PRD.md`, `CHANGELOG.md`, `server.js`, `package.json`, `package-lock.json`, 17 src files, 3 doc files, 1 new test.

### v4.3.0 — Phase A: Critical Fixes & Restored Capabilities (2026-06-06)

First execution phase of `IMPROVEMENT_PLAN.md` (from the 23-tool audit). Closed all 9 Phase-A critical-correctness items and restored 6 silently-dropped MCP capabilities.

**A1 — Correctness fixes:**
- `extract_links` — inverted `filter_external` guard so `filter_external:true` now returns only *external* links (was returning internal-only). `src/tools/basic/extractLinks.js`
- `analyze_content` — `import { franc, francAll }` and call `francAll(...)` (franc v6 has no `franc.all`); unblocks all language detection and `summarize_content`'s `metadata.language`. `src/core/analysis/ContentAnalyzer.js`
- `summarize_content` — implemented the missing `_abstractiveSummaryViaSampling()` (routes through `SamplingClient`); when abstractive can't run it now returns the extractive result with explicit `degraded`/`degradedReason` flags instead of silently masking. `src/tools/extract/summarizeContent.js`
- `extract_with_llm` — removed the undefined `callViaSampling(...)` call and wired the real `getSamplingClient()` fallback (was corrupting the most common error message). `src/tools/extract/extractWithLlm.js`
- `deep_research` — empty/failed extractions (`{"text":""}`) are no longer counted as `contentExtracted` or surfaced; guards on `contentData.success` + non-empty trimmed text. `src/core/ResearchOrchestrator.js`
- `track_changes` — no-baseline case returns a clean `No baseline found for <url> — run create_baseline first` error and no longer emits an unhandled `'error'` event. `src/core/ChangeTracker.js`
- `scrape_template` — fixed `hacker-news-front-page` selectors (`.subtext` is the sibling row after `tr.athing`, not `.spacer`); score/author/comments now populate. `src/tools/templates/TemplateRegistry.js`
- `generate_llms_txt` — default output is now spec-compliant llmstxt.org markdown (`# Title`, `> summary`, `## Section` headers with `[name](url)` lists) instead of robots.txt directives; legacy robots-style output kept behind `outputOptions.robotsStyle:true`. `src/tools/llmstxt/generateLLMsTxt.js`

**A2 — Restored MCP capabilities** (server.js inputSchemas were subsets of the tools' Zod schemas):
- `crawl_deep` — forwards `domain_filter`, `session`, `import_filter_config`, `enable_link_analysis`, `link_analysis_options`.
- `search_web` — forwards the 10 dropped params (`provider`, `expand_query`, `expansion_options`, `enable_ranking`, `ranking_weights`, `enable_deduplication`, `deduplication_thresholds`, `include_ranking_details`, `include_deduplication_details`, `localization`).
- `map_site` — forwards `domain_filter` / `import_filter_config`.
- `scrape_with_actions` — full action schema (`duration`, `distance`, `direction`, `captureAfter`, `clear`, `button`, `clickCount`, `delay`, `force`, `position`, `modifiers`, `smooth`, `toElement`, `condition`, `fullPage`, `quality`, `format`, `args`, `returnResult`), so `{type:'wait',duration:1000}` works; reconciled the `formAutoFill` `{fields:[…]}` contract end-to-end; and "final content" now reads the post-action live page (via `ActionExecutor` capturing `finalHtml`/`finalUrl` + `extractContent` accepting pre-rendered `html`) instead of re-fetching the original URL.

**A3 — Verification:** new `tests/unit/phaseA-regressions.test.js` (12 reproduce→pass tests, one per A1/A2 item). `npm run test:unit` 277/277 green (sandbox-off; the sandbox-on `listen EPERM` failures are the pre-existing HTTP-transport/searxng port-binding cases). `node test-tools.js` 20/20 (100%). `npm test` MCP harness exits 0 with all 23 tools discovered. Version bumped 4.2.12 → 4.3.0 (server `McpServer` version corrected from stale 4.2.6). `npm audit`: 4 pre-existing moderate advisories (uuid/node-cron transitive) — out of Phase-A scope. Files: `IMPROVEMENT_PLAN.md`, `PRD.md`, `CHANGELOG.md`, `server.js`, `package.json`, 10 src files, 1 new test.

### Unreleased — Full 23-tool audit + IMPROVEMENT_PLAN.md (2026-06-06)

Ran a 21-agent audit (code-review → live-test → web-research via `search_web` → adversarial verification) across all 23 MCP tools. Found **9 critical + ~49 high** issues — e.g. `extract_links` inverted `filter_external`, `analyze_content` broken `franc.all` (franc v6 needs `francAll`), `summarize_content`/`extract_with_llm` calling undefined sampling methods, `deep_research` surfacing empty extractions as the literal `'{"text":""}'`, `scrape_with_actions`/`crawl_deep`/`search_web` MCP schemas silently dropping advanced params, and `generate_llms_txt` emitting robots.txt directives instead of the spec llms.txt markdown.

Captured as `IMPROVEMENT_PLAN.md` at the repo root: a three-release roadmap — **Phase A v4.3.0** "Critical Fixes & Restored Capabilities" → **Phase B v4.4.0** "Result-Quality Upgrades" → **Phase C v4.5.0** "Robustness, Security & Polish" — structured for the `/next-phase` skill (A→B→C, `- [ ]` items, "Critical files (by phase)", per-phase verification). Every `file:line` reference was adversarially re-verified against source (34 claims: 29 confirmed exactly, 5 refined, 0 refuted). No tool code changed yet — fixes execute phase-by-phase. Files: `IMPROVEMENT_PLAN.md` (new), `PRD.md`.

### v4.2.12 — stealth_mode fingerprint consistency + create_page output fix (2026-06-06)

Published to npm so the registry matches HEAD ahead of the 23-tool audit work (the `crawlforge` MCP server runs the global `crawlforge-mcp` binary, so live testing needs the published package current). Two fixes to `stealth_mode` found while live-testing the Playwright engine:

- **Fingerprint OS consistency** (`src/core/StealthBrowserManager.js`): the user-agent, `sec-ch-ua-platform` header, and `navigator.platform` were each drawn from `osDistribution` by three *independent* `weightedRandom()` calls, so a fingerprint could advertise a Windows UA with `navigator.platform: "Linux x86_64"` — trivially detectable. `generateAdvancedFingerprint()` now picks the OS once (new `selectOS()`, which infers OS from a `customUserAgent` via `inferOSFromUserAgent()`) and threads it through `selectRealisticUserAgent`, `generateAdvancedHeaders`/`generateSecChUaPlatform`, and `generateHardwareFingerprint`/`selectRealisticPlatform`. `architecture` pinned to `x86_64` to match the all-x86 processor/platform pool. Verified: 500/500 random fingerprints internally consistent; custom macOS UA → `MacIntel` + `"macOS"`.
- **create_page output leak** (`server.js`): the `create_page` operation returned the raw Playwright `Response` handle (`{_type:"Response",_guid:…}`, non-serializable) as `url`. Replaced with a serializable `navigation` object: `{ requestedUrl, finalUrl, status, ok, title }`.

**Verification:** `d2-reliability.test.js` (StealthBrowserManager) 16/16; full `npm run test:unit` green sandbox-off (the 13 sandbox-on failures are the pre-existing `streamableHttp`/`searxng` `listen EPERM` cases that can't bind a local port under Claude Code's sandbox — confirmed identical on a clean tree).

### v4.2.11 — Release the v4.2.10 stdout-hygiene regression lock (2026-05-25)

Maintenance bump. No shippable code changed: the npm tarball is byte-identical to 4.2.10 because the `files` allow-list (`server.js`, `setup.js`, `src/`, `README.md`, `LICENSE`, `CLAUDE.md`, `package.json`) excludes `tests/`. The bump exists to release the post-4.2.10 test-hardening work and keep the published version in lockstep with the repo. The added `tests/unit/stdout-hygiene.test.js` is a source scan that fails if any `console.log` reappears in the tool/crawler/stealth/webhook execution paths (regression-locking the v4.2.10 fix), paired with the `tests/fixtures/cli/actions-wait-screenshot.json` fixture. **Verification:** `npm run test:unit` passes sandbox-off (sandbox-on `listen EPERM 127.0.0.1` failures are HTTP-transport tests that can't bind a local port under Claude Code's sandbox); `npm test` exits 0.

### v4.2.10 — Eliminate stdout leaks corrupting CLI `--json` output (2026-05-25)

Found while live-verifying the v4.2.9 CLI fixes: `crawlforge actions --json` printed a `"Starting scrape session …"` banner to **stdout** before the JSON, so any consumer parsing stdout as JSON failed on line 1. A sweep found the same bug class (`console.log` → stdout) in several other tool/core execution paths, each corrupting a different command's `--json`. Fixed all 11 by moving them to `console.error`:

- `ScrapeWithActionsTool`: the session banner (`actions`) + its internal `log()` helper.
- `extractContent` / `processDocument`: "Using browser rendering…" (`scrape`/`extract`/`analyze`/`process-document`).
- `StealthBrowserManager`: Cloudflare/reCAPTCHA/proxy-rotation messages (`stealth` on protected sites).
- `BFSCrawler`: domain-filter / legacy-pattern / robots.txt block messages (`map`/`crawl` on real sites).
- `WebhookDispatcher`: webhook-retry message (`track`/`monitor` with webhooks).

Deliberately left: `AuthManager` interactive setup output (stdout is intended for the `crawlforge-setup` UX), standalone `src/security/*` scripts/tests, and graceful-shutdown logs (don't fire on normal one-shot CLI exit; `runTool` `process.exit()`s after flushing). Completes the v4.2.4 stdout-hygiene pass — the MCP JSON-RPC stream and CLI `--json` are now the sole stdout writers during tool execution. **Verification:** `crawlforge actions … --json` output now starts with `{` and parses cleanly (`success:true`, 2/2 actions, screenshot captured), confirmed against the global 4.2.10 install (banner now on stderr, 0 occurrences on stdout); `npm run test:unit` 265/265. **Regression-locked** by `tests/unit/stdout-hygiene.test.js` — a source scan that fails if any `console.log` reappears in the tool/crawler/stealth/webhook execution paths (with the `actions` script fixture at `tests/fixtures/cli/actions-wait-screenshot.json`).

### v4.2.9 — CLI command fixes (research/stealth/llmstxt/map/track/monitor/actions) + undici proxy for sandboxes (2026-05-25)

Completes the CLI-correctness sweep started in v4.2.4 (which fixed `template`/`analyze`/`localize`). The CLI invokes tools directly, so each command must match the tool's Zod schema; none of these touch the MCP server, which was already correct.

**Fully-broken commands (errored every run):**
- `research`: sent `query`/`depth`/`max_urls`/`output_format`; `DeepResearchSchema` requires `topic` + `maxDepth`/`maxUrls`/`outputFormat`. Unknown keys were stripped → `topic` undefined → "Required". Now sends `topic`, maps `--depth basic|standard|deep` → `maxDepth` (2/5/8) and `--output-format summary|detailed` → `outputFormat` (`summary`/`comprehensive`).
- `stealth`: called `StealthBrowserManager.scrapeWithStealth()`, which never existed (`stealth_mode` is operation-based: `create_context`/`create_page`). Added a `scrapeWithStealth({url, engine, wait_for, screenshot})` convenience method (context → page → goto → extract title/text/html → optional base64 screenshot → `closeContext` in `finally`).

**Param-shape no-ops (Zod strips unknown keys, so flags silently did nothing):**
- `llmstxt`: `--include-full` → `format`, `--max-pages` → `analysisOptions.maxPages`.
- `map`: `--max-pages` → `max_urls`; removed unsupported `--depth`/`--format`, added `--no-sitemap`.
- `track`: `--selector` → `trackingOptions.customSelectors`, `--threshold` (%) → `significanceThresholds` (ordered 0-1). **Also** `compare` threw "No baseline found" on first run — now bootstraps a baseline first.
- `monitor`: switched from a fabricated `scheduled`/`interval_seconds`/`webhook_url` shape to `operation: 'monitor'` (the setInterval poller) with `--interval` s→ms (min 60s) and `--webhook` → `notificationOptions.webhook`; selector/threshold mapped as in `track`; bootstraps a baseline before polling.
- `actions`: `--screenshot` → `captureScreenshots`; removed `--wait` (no between-action wait field — use `{type:'wait'}` actions in the script).

**Durable sandbox fix:** Node's global `fetch()` (undici) ignores `HTTP(S)_PROXY`, so the CLI's calls to `www.crawlforge.dev` and scrape targets failed inside sandboxes that require proxied egress (hence the `excludedCommands` workaround). `src/cli/index.js` now installs an undici `EnvHttpProxyAgent` global dispatcher when a proxy env var is present (honors `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`; no-op otherwise), scoped to the CLI entry so MCP/stdio is unchanged. `undici` added as a direct dependency at the existing `^7.24.0` override.

**Verification:** `npm run test:unit` 262/262 (sandbox-off; the sandbox-on `listen EPERM 127.0.0.1` failures are HTTP-transport tests that can't bind under Claude Code's sandbox); `npm test` exits 0; CLI smoke tests pass (help/version, proxy dispatcher installs without crash, `scrapeWithStealth` resolves).

### v4.2.8 — Logger no longer crashes on `logger.error(message)` (null-deref) (2026-05-25)

Fix for a shared-Logger bug that masked real errors as a confusing null-deref. **Root cause:** `Logger.error(message, error = null, ...)` calls `trackError(error, ...)` whenever `enableErrorTracking` is on, but `trackError` read `error.name` unconditionally. The common pattern `logger.error(\`... ${err.message}\`)` (message only, no error object) therefore threw `Cannot read properties of null (reading 'name')`, replacing the original error. **Surfaced via** `generate_llms_txt` on swing.com: a benign crawl timeout was logged via that pattern, the logger crashed, and the client received the null-deref instead of a completed result. **Fix:** `Logger.error` only calls `trackError` when an Error was actually passed, and `trackError` is now null-safe (`error?.name ?? 'UnknownError'`, etc.) so the shared logger can never throw. **Verification:** `generate_llms_txt` on swing.com now completes (`pagesAnalyzed=0`, same as example.com — the timeout is non-fatal); `npm run test:unit` 262/262. Root-caused from a live stack trace captured via the CrawlForge tool path.

### v4.2.7 — MCP server no longer self-terminates on stray errors (2026-05-25)

Resilience fix for the long-running stdio MCP server. **Root cause:** `server.js` registered global `unhandledRejection` and `uncaughtException` handlers that both called `gracefulShutdown()` → `process.exit()`. A single unhandled rejection anywhere — including background async work inside one tool — tore down the entire server, disconnecting every other tool mid-session (observed during a live site audit: `analyze_content` became uncallable partway through after an unrelated failure). **Fix:** both handlers now log to stderr and keep serving; `SIGINT`/`SIGTERM` still run `gracefulShutdown` for clean exits, so only the error paths changed. **Verification:** `node --check server.js`; `npm run test:unit` 262/262 (sandbox-off — the sandbox-on `listen EPERM 127.0.0.1` failures are HTTP-transport tests that can't bind a port under Claude Code's sandbox); live smoke test against the reconnected server confirmed it stays up and serving after a tool error. Diagnosed using the CrawlForge MCP itself.

### v4.2.6 — `crawlforge-mcp-server` bin repointed to the CLI (2026-05-25)

Follow-up to 4.2.5. The `crawlforge-mcp-server` bin pointed at `server.js`, so `crawlforge-mcp-server scrape <url>` (documented in `docs/cli-guide.md` / `docs/PRODUCTION_READINESS.md`) hung instead of scraping. Repointed it to `src/cli/index.js`; since the CLI auto-detects MCP-stdio launches and hands off to the server, both `crawlforge-mcp-server scrape <url>` (CLI) and `npx -y crawlforge-mcp-server` (MCP server over stdio) now work. `crawlforge-mcp` stays the dedicated direct-to-`server.js` launcher. Verified: `crawlforge-mcp-server scrape https://www.firecrawl.dev/` returns content; piped `crawlforge-mcp-server` completes an MCP initialize handshake.

### v4.2.5 — MCP launch-command regression fix + nvm-proof launcher bins (2026-05-25)

Restores the MCP server launch path that v4.1.0 silently broke and hardens it against future breakage. **Root cause:** before v4.1.0 the `crawlforge` bin *was* the MCP server; v4.1.0 turned that bin into the CLI, so every MCP client still configured with `"command": "crawlforge"` (which `crawlforge-setup` itself wrote) received CLI help text instead of JSON-RPC — `Failed to reconnect: -32000`.

**Fix (so existing users update with nothing breaking):**
- `src/cli/index.js` detects MCP-stdio invocation — no subcommand + non-TTY stdin (how a host spawns it), or explicit `crawlforge mcp`/`serve`, or `CRAWLFORGE_MCP_STDIO=true` — and hands off to `server.js`. Existing `"command": "crawlforge"` configs work again after `npm update`, **no edits required**. Escape hatch: `CRAWLFORGE_FORCE_CLI=true`.
- Added bins: `crawlforge-mcp-server` → `server.js` (makes the README's `npx -y crawlforge-mcp-server` resolve — npx matches the bin to the package name) and `crawlforge-mcp` → `server.js` (dedicated, PATH-resolved launcher that survives Node/nvm version switches, unlike a hard-coded `node /path/server.js`).
- `crawlforge-setup` now writes `"command": "crawlforge-mcp"` and migrates pre-v4.2.5 configs on re-run. README config examples corrected. `serverInfo.version` now tracks the package version (was pinned at `4.2.2`).

**Verification:** all four launch paths confirmed (bare-piped, `mcp` subcommand, `--help`, `FORCE_CLI`); `tests/integration/cli.test.js` 8/8 (incl. a full `initialize` handshake via `crawlforge mcp`); `npm run test:unit` and `npm test` green. Grounded in research via the CrawlForge MCP itself (`search_web` + `fetch_url` of the npm-exec docs confirming npx multi-bin resolution).

### v4.2.4 (Development) — Full test/verification pass + CLI command fixes + stdout hygiene (2026-05-25)

End-to-end verification that the MCP server, all 23 tools, and the CLI work and return Claude-Code-usable results. **Verification (all green):** unit `262/262` pass; MCP protocol compliance discovers all 23 tools and returns valid tool data (error/validation responses arrive as spec-correct `isError` content with `-32602` codes + Zod messages, which the legacy compliance test mis-scores as 70% because it expects top-level JSON-RPC `error` objects); functional `test-tools.js` `20/20`; real-world scenarios `4/4`. The 3 tools not in `test-tools.js` were verified directly via a live MCP probe: `list_ollama_models`, `scrape_template`, `extract_with_llm` (live Ollama). Confirmed `node --test` needs `--test-force-exit` (a Playwright handle from importing `StealthBrowserManager` in `d2-reliability.test.js` otherwise delays exit ~100s); the only other "failures" were sandbox `listen EPERM 127.0.0.1` artifacts.

**CLI command fixes** (the CLI invokes tools directly, separate from the MCP server which was already correct):
- `template`: passed `template_id` but `ScrapeTemplateTool` expects `template` (→ "Unknown template undefined"); `--list` called a nonexistent `listTemplates()`. Now passes `template`, uses the tool's built-in `execute({template:'list'})`, and accepts optional `[id] [target]`.
- `analyze`: passed `{url}` to a text-only `analyze_content` tool (always failed Zod `text` required). Now fetches & cleans the page via `extract_content` first, then analyzes the text.
- `localize`: called a nonexistent `LocalizationManager.fetchWithLocalization()`. Now derives a locale config (`configureCountry`) and fetches the URL with localized `Accept-Language`/`User-Agent` headers, returning `{localization, request_headers, response}`.
- API key resolution: CLI now falls back to the stored `~/.crawlforge/config.json` key (set by `crawlforge-setup`) when no `--api-key`/env is provided — previously `search` failed with "API key required" for configured users.

**stdout hygiene** — stdout is now reserved for the MCP JSON-RPC stream and CLI `--json` output; all status/diagnostic output moved to stderr: `AuthManager` ("🚀 Creator Mode Active"), `server.js` auto-config line, `creatorMode.js` banner, `searchProviderFactory.js` ("🔍 Creator Mode"), the `ActionExecutor`/`BatchScrapeTool` `console.log` loggers, and the winston Console transport (added `stderrLevels` for all levels). Verified: MCP server stdout line 1 is pure JSON-RPC; all CLI commands emit clean JSON.

**Process-exit fix** — one-shot CLI commands no longer hang after printing output (background timers — metrics, cache/connection cleanup — kept the event loop alive): `runTool` now flushes stdout then exits (new `exitOnSuccess` option, default true; `monitor` passes false to stay long-running), and `PerformanceManager`'s metrics interval is `.unref()`'d. The long-running MCP server is unaffected (it stays up via its stdio transport and does not use `runTool`).

Touched 14 files (+128/−24); package version bumped to 4.2.4. No MCP tool behaviour changed.

### v4.2.2 (Documentation refresh) - Sandboxing/approvals doc + stale-version cleanup (2026-05-25)

Documentation-only follow-up. Triggered by an external email asking how CrawlForge handles sandboxing and approvals — the answer required assembling facts spread across `endpointGuard`, `ssrfProtection`, `ElicitationHelper`, `ActionExecutor`, and `StealthBrowserManager`, and surfaced that `CLAUDE.md` was still pinned at v3.0.12 / 20 tools.

**Updated for v4.2.2 / 23 tools / D1 primitives:** `CLAUDE.md` (version, tool count, dev commands incl. CLI, Core Infrastructure adds ResourceRegistry/PromptRegistry/SamplingClient/ElicitationHelper/endpointGuard, new Sandboxing & Approvals section); `README.md` (22→23 tools in two places, new Security & Approvals subsection); `PRD.md` (intro paragraph); `docs/PRODUCTION_READINESS.md` (4.1.0→4.2.2); `server.js:113` (getting-started prompt 22→23 tools).

**New canonical doc:** `docs/sandboxing-and-approvals.md` (~204 lines) — assembles the three layers (network/browser/approvals), enumerates the SSRF blocklist, the endpointGuard allow-list, the `scrape_with_actions` action allowlist, the `ALLOW_JAVASCRIPT_EXECUTION` env-var gate, and the four ElicitationHelper trigger conditions. Includes an honest "known limitations / gaps" section (SSRF is blocklist not allowlist; stealth uses `--no-sandbox`; robots.txt is fail-open; no per-action elicitation inside `scrape_with_actions`; elicitation capability not declared in capabilities block).

**Moved:** `crawlforge-api-update.md` (root) → `docs/security-remediation-plan.md`. `IMPROVEMENT_PLAN.md` and `IMPROVEMENT_ROADMAP_V4.md` (both drained) → `docs/archive/`. Conforms to CLAUDE.md rule "Put all documentation md files into the docs/ folder."

**Deleted (stale v3.0.x point-in-time reports, superseded by current code + `docs/security-patch-v3.0.18.md`):** `docs/security-audit-report.md`, `docs/testing-validation-report.md`, `docs/tool-registration-verification-report.md`, `docs/auth-credit-system-validation.md` (had been flagging a CRITICAL that was FIXED in v3.0.18), `docs/production-readiness-phase1-fixes.md`, `docs/user-journey-validation-report.md`, `docs/user-journey-executive-summary.md`, `docs/mcp-protocol-review.md` (predated D1 primitives). `report.md` (root v3.0.16 tool-testing report, superseded by v4.2.0 per-tool unit suite).

No code or behaviour changes; package version unchanged at 4.2.2.

### v4.2.2 (Development) - CLI batch fix + retracted v4.0.0 breaking-change docs (2026-05-18)

Patch release. Fixes `crawlforge batch` CLI flag mapping: `--format` / `--concurrency` / `--max-retries` were silently dropped due to wrong param key names. Maps now to `formats` / `maxConcurrency` / `jobOptions.maxRetries`. Adds a contract test pinning the CLI param shape. CHANGELOG v4.0.0 entry annotated as retracted with postmortem. CI workflow internal fix (recursive test discovery + force-exit + Node 22). No API surface changes.

### v4.2.1 (Development) - Backwards-Compat Fix for batch_scrape (2026-05-18)

Patch release that neutralizes the v4.0.0 "breaking change" to `batch_scrape` defaults. The internal `BatchScrapeSchema` defaulted to `['markdown']` while the MCP tool registration at `server.js:544` defaulted to `['json']` — because params are validated twice (MCP layer then tool layer), the MCP default always won, so MCP clients were never actually broken. v4.2.1 aligns the internal schema to `['json']` to close the latent mismatch. Three regression tests pin the schema defaults. No migration needed.

### v4.2.0 (Development) - Phase D5.2 Per-Tool Tests + D5.3 Docs Refresh (2026-05-18)

Phase D5.2 ships 131 new unit tests across 17 tools. Phase D5.3 ships 3 new docs and a README code-block validator. This completes the entire v4.0 roadmap.

**D5.2 Unit tests (17 files, 131 tests, all green):** Stubs injected via constructors — no live network, no Playwright browser launched. Tools covered: extractContent, processDocument, analyzeContent, summarizeContent, extractStructured, listOllamaModels, deepResearch, searchWeb, crawlDeep, mapSite, batchScrape, scrapeWithActions, stealthMode, localization, trackChanges, generateLLMsTxt, scrapeTemplate. Uses node:test runner (no new framework dependency).

**D5.3 Docs refresh:** `docs/local-ollama-quickstart.md` (install, model guide, Docker, troubleshooting). `docs/docker-deployment.md` (build, compose, Render deploy, HEALTHCHECK). `docs/observability-setup.md` (Prometheus metrics table, OTel spans, Grafana dashboard, alert rules). `tests/docs/example-runner.js` validates README JSON/shell blocks (syntax only, no live network).

**IMPROVEMENT_ROADMAP_V4.md:** Status updated to "ALL PHASES COMPLETE — D1 ✓ D2 ✓ D3 ✓ D4 ✓ D5 ✓ — v4.x shipped". Header version corrected to 4.1.0. Carry-forward items documented (D2.8, D2.11, D5.1 ESLint).

**Phase summary:** PRD Phase 1 (MCP tools): COMPLETE (23 tools). PRD Phase 2 (CLI): COMPLETE (v4.1.0). PRD Phase 3 (Skills): COMPLETE (v4.1.0). Roadmap Phases D1–D5: ALL COMPLETE.

### v4.1.0 (Development) - Phase D4 CLI + Skills Installer (2026-05-18)

Phase D4 ships the `crawlforge` CLI (PRD Phase 2) and skills installer (PRD Phase 3).

**D4.1 CLI scaffolding:** commander added. `src/cli/index.js` entry with global flags (`--json`, `--pretty`, `--quiet`, `--api-key`, `--timeout`). `src/cli/formatter.js` shared formatter. `src/cli/lib/runTool.js` thin wrapper around tool.execute().

**D4.2 15 CLI commands:** scrape, search, crawl, map, extract, track, analyze, research, stealth, batch, actions, localize, llmstxt, template, monitor. Each command in its own file under `src/cli/commands/`. All commands invoke tool.execute() directly — no credit logic duplication.

**D4.3 Skills installer:** `src/skills/installer.js` with install()/uninstall(). 4 skill files: crawlforge-mcp.md, crawlforge-cli.md, crawlforge-stealth.md, crawlforge-research.md. Targets: Claude Code (~/.claude/skills/), Cursor (.cursor/rules/crawlforge.mdc), VS Code (.github/instructions/crawlforge.instructions.md). Idempotent; --force to overwrite; --dry-run to preview.

**PRD Phase 2 (CLI): COMPLETE. PRD Phase 3 (Skills): COMPLETE.**

**Verification:** node --check across all 21 CLI files: all pass. `node src/cli/index.js --help` shows all 17 commands. `tests/integration/cli.test.js` 6/6 pass.

### v4.0.0 (Development) - Phase D3 Competitive Feature Parity (2026-05-18)

Phase D3 ships Markdown-first output, Camoufox Firefox stealth engine, 10 pre-built site templates, BrowserBase cloud backend, and cost transparency across all tools.

**D3.1 Markdown-first (Turndown):** htmlToMarkdown utility using Turndown. extract_text gains output_format:markdown. extract_content convertToMarkdown now uses Turndown. process_document gains markdown outputFormat. batch_scrape defaults to formats:["markdown"] (BREAKING from v3.x ["json"] default).

**D3.2 Camoufox engine:** BrowserEngine interface + CamoufoxAdapter in StealthBrowserManager. stealth_mode gains engine:"playwright"|"camoufox" param. Camoufox is MIT-licensed (Firefox patches MPL-2.0). Docs: docs/stealth-engines.md.

**D3.3 Pre-built templates:** TemplateRegistry with 10 templates (amazon-product, linkedin-profile, github-repo, youtube-video, tweet, reddit-thread, hacker-news-front-page, producthunt-launch, stackoverflow-question, npm-package). New scrape_template tool (tool count 22 to 23). Offline fixtures in tests/integration/templates/fixtures.js.

**D3.4 Cloud browser backend:** BrowserBackend interface, LocalPlaywrightBackend, BrowserBaseBackend (CDP). Toggle via CRAWLFORGE_BROWSER_BACKEND=local|browserbase + BROWSERBASE_API_KEY. Graceful fallback to local. Docs: docs/cloud-browser.md.

**D3.5 Cost transparency:** AuthManager.projectCost(). _cost: { projected, actual, remaining_credits, projection_note } injected into all tool responses via withAuth. Dynamic tools document lower-bound accuracy caveats in projection_note.

**Verification:** node --check server.js OK. npm test 60% (pre-existing baseline). withAuth tests 9/9. authManager tests 6/6.

### v3.6.0 (Development) - Phase D1 MCP-Native Primitives (2026-05-18)

Phase D1 ships Resources, Prompts, Sampling, and Elicitation primitives (MCP spec 2025-11-25). D1.1: ResourceRegistry with crawlforge:// URI scheme (5 types), 20 tests green. D1.2: PromptRegistry with 5 workflow prompts. D1.3: SamplingClient with Ollama-API-sampling fallback chain. D1.4: ElicitationHelper wired into 5 tools. D1.5: All 22 tool descriptions rewritten to lead with when-to-use + examples. Server version bumped to 3.6.0.

### v3.5.2 (Development) — Phase D2 Reliability Hardening + D5.1 CI Workflows (2026-05-17)

**10 audit findings fixed** in `src/core/` — all covered by regression tests in `tests/unit/d2-reliability.test.js`:

- **D2.1 AuthManager credit race** — promise queue serializes concurrent `reportUsage` calls
- **D2.2 StealthBrowserManager leak** — `_setFingerprint` LRU cap at `_maxContexts`
- **D2.3 ResearchOrchestrator LLM cost** — per-session token budget with abort + `_cost` in response
- **D2.4 ActionExecutor page leaks** — `initializePage` inside try/finally; safe `page.close()`
- **D2.5 WebhookDispatcher retry storms** — per-webhook jittered exponential backoff; batch cap at 10
- **D2.6 JobManager cascade + eviction** — cascade-cancel dependents; LRU eviction at `maxJobs`; TTL expiry for all states
- **D2.7 PerformanceManager routing** — routes by live queue depth + wait time; AbortController on shutdown
- **D2.8 Localization/ChangeTracker** — LRU-capped Maps; `hashContentAsync` offloads >256KB to `worker_threads`
- **D2.9 Secret masking** — `src/utils/secretMask.js` + Winston global masking format
- **D2.10 URL dedup** — `deduplicateSources` uses per-session `visitedUrls`; cache-hit returns existing extracted content

**D5.1 GitHub Actions** — `.github/workflows/ci.yml` (5 jobs) + `.github/workflows/security.yml` (daily scans)

---

### v3.5.1 — Render deploy fix: align default port with Render's scanner (2026-05-18)

Fixes a Render deploy that timed out with "Port scan timeout reached, no open ports detected" even though the server was logging "running on port 10000" — Render's default scan target matches the app's `$PORT`-resolved port, but the Dockerfile's `EXPOSE 3000` + the in-code default of `3000` were misaligned with that and the broken HEALTHCHECK didn't actually probe the HTTP server. Net symptom: the app was listening, but the surrounding metadata pointed at the wrong port and the healthcheck was a no-op.

- `Dockerfile` — `EXPOSE 3000` → `EXPOSE 10000`; added `ENV PORT=10000` so the container default matches Render's default; HEALTHCHECK replaced (was `node -e "console.log('Health check passed')"` — always passed) with a real fetch against `http://127.0.0.1:$PORT/health`.
- `server.js` — `process.env.PORT || '3000'` → `process.env.PORT || '10000'` so local-Docker / non-PaaS runs also bind to the expected port.
- `src/server/transports/streamableHttp.js` — startup log now prints `listening on ${host}:${port}` (e.g. `0.0.0.0:10000`) instead of `http://localhost:${port}` — the latter was misleading when debugging "is it actually bound to 0.0.0.0?".
- New `render.yaml` blueprint — explicit `type: web`, `runtime: docker`, `healthCheckPath: /health`, `MCP_HTTP=true`, `CRAWLFORGE_API_KEY` flagged as a dashboard-only secret (`sync: false`).

**Operator action required:** in the Render dashboard for the existing service, confirm the "Port" field is either empty (Render auto-detects) or set to `10000`. If it's set to `3000` from an earlier deploy, change it to `10000` and re-deploy.

### v3.5.0 — Ollama is now the default for `extract_with_llm` + new `list_ollama_models` tool (2026-05-18)

Flips `extract_with_llm` so a **local Ollama model is the default** (was: OpenAI/Anthropic cloud). No API key is required to use the tool out of the box. Adds a new `list_ollama_models` MCP tool so a user / agent can discover which models are installed locally and pick one for the `model` parameter. **Breaking for existing `provider: "auto"` users with cloud keys set** — auto now resolves to Ollama regardless of whether `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is present. Cloud providers remain fully supported via explicit `provider: "openai" | "anthropic"`.

**Implementation:**
- `src/tools/extract/extractWithLlm.js` — `resolveProvider()` simplified: `provider: "auto"` (and `"ollama"`) always returns `{ provider: 'ollama', apiKey: null }`. The `OLLAMA_BASE_URL` opt-in gate is gone; `ollamaBaseUrl()` already defaults to `http://localhost:11434`. Explicit `"openai"` / `"anthropic"` branches still validate the corresponding API key and surface a clear error if missing. The pre-existing friendly `ECONNREFUSED` / `404 model not found` error messages are unchanged.
- New file `src/tools/extract/listOllamaModels.js` — thin wrapper around `GET /api/tags`. Returns each model's `name`, `size_bytes`, `modified_at`, `family`, `parameter_size`, `quantization`, plus a `hint` field that tells the user to run `ollama pull <name>` if zero models are installed, or to pass any listed name as the `extract_with_llm` `model` param.
- `server.js` — imports/instantiates `ListOllamaModelsTool`, registers the `list_ollama_models` tool (no params; `readOnlyHint`, `idempotentHint`). Updates `extract_with_llm` description and the `provider` / `model` field descriptions so MCP clients see the new defaults. Server description and getting-started prompt bumped 20 → 21 / 21 → 22 tools.
- `README.md` — feature blurb 20 → 22 tools; "Advanced Tools" list adds `extract_with_llm` and `list_ollama_models`; new "Local-LLM quickstart" snippet plus `OLLAMA_BASE_URL` / `OLLAMA_DEFAULT_MODEL` env-var docs.

**Tests:**
- `tests/unit/extractWithLlm.test.js` rewritten where the old contract was asserted. Tests 1–3 now verify auto → Ollama regardless of which cloud keys are set; test 19 now verifies the `OLLAMA_BASE_URL` override is respected (was: "auto does NOT pick ollama without env vars"). Removed test 20 (cloud-priority assertion no longer holds). **20/20 pass.**
- `npm test` (MCP protocol compliance): exits successfully; 60% rate is the pre-existing baseline on `main` — no regression from this change.

**Verification not yet run:**
- Live end-to-end against a real Ollama instance with the new `list_ollama_models` tool — to be done by reconnecting the MCP client (`/mcp`) so it picks up the updated schemas, then calling `list_ollama_models()` followed by `extract_with_llm({ url, prompt })`.

### v3.4.0 — Local Ollama support for `extract_with_llm` (2026-05-18)

Adds local-LLM support to `extract_with_llm` via Ollama, alongside the existing OpenAI + Anthropic cloud providers. Lets users extract structured data with no API key, no API costs, and no data leaving their machine — using whichever model they have pulled locally (default `llama3.2`). Strictly opt-in: existing cloud users see zero behavior change.

**Implementation (`src/tools/extract/extractWithLlm.js`, `server.js`):**
- New `callOllama()` calls Ollama's `/api/chat` directly with raw `fetch()` (same pattern as the existing OpenAI/Anthropic branches — zero new runtime deps). Sends `stream: false`, `temperature: 0`, `num_predict: maxTokens`. When the optional `schema` param is provided it is passed through as Ollama's structured-outputs `format` object; otherwise `format: "json"` for JSON mode.
- `resolveProvider()` extended: `provider: "ollama"` always selects Ollama (no key required). `provider: "auto"` keeps the Anthropic → OpenAI order and only falls back to Ollama when neither cloud key is set **and** `OLLAMA_BASE_URL` is exported — guarantees no behavior change for existing cloud users.
- Defaults are beginner-friendly: base URL `http://localhost:11434`, model `llama3.2`. Both overridable via `OLLAMA_BASE_URL` / `OLLAMA_DEFAULT_MODEL` env vars or per-call `model` param.
- Friendly error on `ECONNREFUSED` / `ENOTFOUND`: `Ollama is not running at <url>. Start it with "ollama serve" and pull a model: "ollama pull llama3.2".` Friendly error on `404 model not found`: `ollama pull <model>`.
- Usage normalized to the uniform `{ input_tokens, output_tokens }` shape (mapped from Ollama's `prompt_eval_count` / `eval_count`).
- `extract_with_llm` provider enum extended to `["openai", "anthropic", "ollama", "auto"]`; description updated to mention local Ollama.

**Verification:**
- `node --test tests/unit/extractWithLlm.test.js`: **22/22 pass** (14 pre-existing + 8 new Ollama tests).
- `npm test` MCP protocol compliance: 10/10 tests completed, 0 errors — unchanged from baseline.
- **Live end-to-end against real Ollama 0.24.0 with `llama3.2:latest`**: 3/3 scenarios pass — plain JSON mode (extracted product/price/screen-size), structured-outputs schema (nested order with line-items array), and `provider: "auto"` fallback via `OLLAMA_BASE_URL`.

### v3.3.1 — Post-C5 verification fixes (2026-05-17)

Two pre-existing bugs surfaced during the full out-of-sandbox verification of the v3.3.0 release. Neither was caused by Phase C5 — both reproduce on v3.2.0 — but they were unmasked when v3.3.0 verification ran outside the sandbox and against a freshly-cleared cache.

**Fix 1 — `search_web` circular-JSON crash on cache miss.** `ResultRanker` and `ResultDeduplicator` constructors were spreading `...options` (which includes `sharedCache`, a `CacheManager` instance holding a `setInterval` monitoring Timer) into `this.options`. Cache-key generation later called `JSON.stringify` on that options object, hitting a circular reference through `Timer → TimersList → Timer`. Destructured `sharedCache` out before the spread so it lives in `this.cache` only — never in the serializable `this.options`. Bug was masked in earlier verification runs by hitting a populated LRU cache hit.

**Fix 2 — `endpointGuard` "creator mode OFF" test premise-unsatisfiable.** `creatorMode.js` loads `.env` at module init and caches the verified flag in a module-scoped variable that is immutable from outside (by design). The test at `tests/unit/endpointGuard.test.js:94` tried to disable creator mode by `delete process.env.CRAWLFORGE_CREATOR_SECRET` at test time, which has no effect once the module has loaded — so the test always failed on the maintainer's machine but passed in CI. Now `t.skip()` with a clear rationale when `isCreatorModeVerified()` returns true; the other 7 assertions still run unconditionally.

**Verification (clean tree, no sandbox):**
- `node test-tools.js`: **20/20 pass** (was 19/20 — search_web fixed)
- Full unit suite: 240 tests, 227 pass, 0 fail, 13 skipped
- `streamableHttp.test.js`: 12/12 pass (was sandbox-blocked)
- `npm test` MCP compliance: 70% — unchanged from HEAD baseline
- `npm audit`: 0 vulnerabilities

### v3.3.0 — Phase C5 "Feature parity" (2026-05-17)

Ships the four feature-parity items deferred from Phase C: one new MCP tool (`extract_with_llm`, total now 21) plus capability extensions to three existing tools at parity with Firecrawl, Crawl4AI, and ScrapeGraphAI. Implemented by four `mcp-implementation` sub-agents in parallel; lead handled central registration + verification. All changes strictly additive — every existing call signature behaves exactly as in v3.2.0.

**C5.1 — `scrape_with_actions` recording & replay (Firecrawl parity):**
- New input fields `record: boolean` + `recordingName: string` capture each executed action plus its `timestamp_ms_since_start`, persisted as JSON to `~/.crawlforge/recordings/<name>.json` via an atomic `.tmp` + rename write.
- New input field `replayRecording: string` loads a saved recording and re-executes it through the existing `ActionExecutor` against a fresh URL. Special value `replayRecording: '__list__'` returns the recordings index inline.
- `recordingName` validated against `/^[a-zA-Z0-9_-]{1,64}$/` — path traversal blocked. Home dir overridable via `CRAWLFORGE_HOME_OVERRIDE` for testing.
- New `src/tools/advanced/scrapeWithActions/recorder.js` + 12 unit tests.

**C5.2 — `crawl_deep` session reuse (Crawl4AI parity):**
- New optional `session: { enabled, persistCookies?, headers?, initialRequest? }`. With `enabled: true`, an in-memory cookie jar persists every `Set-Cookie` response and replays cookies on every subsequent fetch within the crawl. Session `headers` merged into every request.
- Optional `session.initialRequest` performs a pre-crawl login (or any HTTP request) and seeds the jar before traversal begins — enables authenticated-area crawling.
- Zero new runtime deps; hand-rolled jar uses Node 18+ `Headers.getSetCookie()` for multi-value correctness.
- New `src/tools/crawl/_sessionContext.js`; `BFSCrawler.fetchPage()` layers session headers + cookies before `fetch()` and records the response's `Set-Cookie` back into the jar. 12 unit tests.

**C5.3 — `extract_with_llm` (ScrapeGraphAI parity):**
- New 21st tool. Takes a URL or pre-fetched `content` plus a natural-language `prompt`; returns parsed JSON.
- `provider: 'openai' | 'anthropic' | 'auto'` (default `'auto'` — Anthropic first then OpenAI based on env keys). Errors clearly when neither key is set.
- Direct `fetch()` to OpenAI `/v1/chat/completions` (default `gpt-4o-mini`, `response_format: { type: 'json_object' }`) or Anthropic `/v1/messages` (default `claude-haiku-4-5-20251001`). Zero new runtime deps.
- Endpoints overridable via `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` for self-hosted gateways.
- Defensive JSON parse with single retry; uniform `{ input_tokens, output_tokens }` usage shape across providers. Optional `schema` JSON-schema-like hint passed through to the prompt.
- Costs 5 credits per invocation. 14 unit tests.

**C5.4 — `search_web` SearXNG provider (self-host parity; addresses r/LocalLLaMA `1nfvhyh`):**
- New optional `provider: 'crawlforge' | 'searxng'` (default `'crawlforge'`). When `'searxng'`, queries route to a self-hosted SearXNG JSON API at `CRAWLFORGE_SEARXNG_URL` (e.g. `http://localhost:8888`).
- Standard search params (`query`, `limit`, `page`, `safeSearch`, `language`) mapped to SearXNG's `q` / `pageno` / `safesearch` / `language`.
- SearXNG results normalised to the CrawlForge result shape so the shared ranking + deduplication + caching pipeline runs unchanged.
- Errors clearly when `CRAWLFORGE_SEARXNG_URL` is unset or the upstream returns non-200.
- New `src/tools/search/providers/searxng.js`. 12 unit tests.

**Tool registration & metadata:**
- `server.js` — imports + instantiates `ExtractWithLlm`; registers `extract_with_llm` with full Zod input schema and `withAuth()` wrapper; advertise-string and `allTools` bumped 20 → 21.
- `src/core/AuthManager.js` `getToolCost()` — added `extract_with_llm: 5`.
- `package.json` 3.2.0 → 3.3.0; description "20" → "21".

**Verification:**
- 50 new unit tests across 4 new files — **50/50 pass**.
- Full unit suite: 240 tests, 227 pass, 12 skipped (sandbox-only HTTP listen on `streamableHttp.test.js`), 1 pre-existing `endpointGuard.test.js` failure unrelated to C5 (reproduces on v3.2.0 commit).
- `node test-tools.js`: 19/20 (the 1 failure is a pre-existing sandbox network flake; reproduces on v3.2.0 once local search cache is cleared).
- `npm test` MCP compliance: unchanged from HEAD baseline (70%).
- `npm audit`: **0 vulnerabilities**.

**Deferred items now closed:** the four `[ ]` C5 entries in `IMPROVEMENT_PLAN.md` are now ticked. Phases A, B, C all complete.

### v3.2.0 — Phase C "Modernize" (2026-05-17)

Ships Phase C of `IMPROVEMENT_PLAN.md` end-to-end via `/next-phase`. Closes the protocol/feature gap with Firecrawl, Crawl4AI, and Bright Data MCP: Streamable HTTP transport with stateful sessions, OAuth 2.1 with PKCE for remote deployments, the framework for structured tool outputs, and a no-op-by-default observability stack (OpenTelemetry tracing facade + Prometheus `/metrics`). No tool schema or public API changes for existing stdio users — strictly additive.

**C1 — Streamable HTTP transport (MCP spec 2025-06-18):**
- `src/server/transports/streamableHttp.js` (new) — replaces the v3.1 stateless HTTP with a stateful Streamable HTTP transport built on `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk@1.29`. Session IDs are minted via `randomUUID()` and returned on the `Mcp-Session-Id` response header; clients resume state by re-sending the header on subsequent requests. Single `/mcp` endpoint serves POST (JSON or SSE) and GET (SSE) per spec.
- `--legacy-http` / `CRAWLFORGE_LEGACY_HTTP=true` flag preserves v3.1 stateless behaviour for one release; the existing `src/server/transports/http.js` is now a thin shim that forwards to `connectStreamableHttp({ legacy: true })`. Legacy mode logs a deprecation warning at startup and will be removed in v3.3.0.
- `Mcp-Session-Id` added to `Access-Control-Allow-Headers` and `Access-Control-Expose-Headers` so browser-based MCP clients can resume.
- New `host` option on `connectStreamableHttp` (defaults `0.0.0.0`) for test bindings.
- `docs/PRODUCTION_READINESS.md` now lists every Streamable HTTP endpoint in a dedicated table.

**C2 — OAuth 2.1 authorization:**
- `src/server/auth/oauth.js` (new, ~350 LOC, zero new runtime dependencies) — implements the OAuth 2.1 subset required by the MCP authorization spec: discovery (`/.well-known/oauth-authorization-server`), Dynamic Client Registration (RFC 7591) at `/oauth/register`, Authorization Code + PKCE S256 at `/oauth/authorize`, token issuance/refresh at `/oauth/token`, and revocation (RFC 7009) at `/oauth/revoke`. `plain` PKCE method is explicitly rejected. Refresh tokens rotate on every use.
- Opaque bearer tokens are minted server-side and carry a `mappedApiKey` link to the operator's existing CrawlForge API key, so `withAuth()` credit tracking continues to work unchanged. Public clients only — no client secrets.
- Auto-approve consent model: possession of the operator's `CRAWLFORGE_API_KEY` IS the authorization. Multi-tenant deployments swap the auto-approve path in `handleAuthorize()` for a real consent UI.
- In-memory token storage by default; a `storage` adapter (`setClient/getClient/setCode/takeCode/setToken/getToken/deleteToken`) can be supplied for multi-instance deployments.
- Opt-in via `CRAWLFORGE_OAUTH_ENABLED=true` (HTTP transport only). Stdio transport keeps the static API key — no breaking change for existing local users.
- `docs/oauth-quickstart.md` (new) — copy-pasteable Node sample for register / authorize / exchange / refresh / call `/mcp`.

**C3 — Structured tool outputs (MCP SDK ≥1.10):**
- `src/server/registerTool.js` extended to accept an optional `outputSchema` and forward it to `server.registerTool()`. When set, the SDK validates `structuredContent` returned by the handler against the schema; legacy clients keep reading the JSON-stringified `content[].text`.
- `dualOutput(structured)` helper exported from `registerTool.js` — convenience for handlers that want to emit both `structuredContent` and the legacy `content` block from a single value.
- The 20 existing tool registrations in `server.js` are left unchanged (no schemas attached yet). The framework is in place; per-tool schema rollout is intentionally deferred to a follow-up so each tool gets a careful schema review and per-tool test update rather than a rushed batch change. Unit test (`registerTool.test.js`) asserts the mechanism end-to-end.

**C4 — Observability:**
- `src/observability/metrics.js` (new, ~150 LOC, zero new dependencies) — minimal Prometheus exposition (counters, gauges, histograms) conforming to format 0.0.4. Exposes `crawlforge_tool_requests_total`, `crawlforge_tool_errors_total{error_class}`, `crawlforge_tool_duration_ms` (histogram with 10/50/100/250/500/1000/2500/5000/10000/30000 ms buckets), `crawlforge_credits_consumed_total`, and the two `crawlforge_browser_pool_*` gauges. Off by default — opt-in via `CRAWLFORGE_METRICS=true` in HTTP mode.
- `src/observability/tracing.js` (new) — OpenTelemetry facade that calls into `globalThis.__otelTracer.startSpan(...)` if present, no-op otherwise. Disabled unless `OTEL_SDK_DISABLED=false` AND a tracer is registered. Span attributes: `mcp.tool.name`, `mcp.tool.duration_ms`, `mcp.tool.outcome`, `mcp.credit.cost`, `mcp.credit.outcome`, `mcp.creator_mode`. We don't add `@opentelemetry/sdk-node` to `package.json` — operators install it themselves and we discover it through `globalThis`.
- `withAuth()` now records both metrics and tracing on every invocation (still produces exactly one log line; observability calls are wrapped so they can't break the request path).
- `docs/observability/grafana-dashboard.json` (new) — six-panel dashboard: requests/sec, errors/sec, p50/p95 duration, credits/sec, browser pool utilization.

**C5 — Feature parity (intentionally deferred):**

The plan explicitly says "pick based on user demand". None of the four candidates (Firecrawl-style action recording, Crawl4AI-style session reuse in `crawl_deep`, `extract_with_llm` tool, `searxng` provider for `search_web`) have been requested by users in the v3.1 window. Leaving them `[ ]` in `IMPROVEMENT_PLAN.md` with a note rather than building speculatively. They remain independently shippable in any future minor.

**C6 — Verification:**
- `node --test tests/unit/*.test.js`: **190 pass / 0 fail** (added 70 cases: oauth 12, metrics 6, tracing 7, registerTool 4, streamableHttp 12, withAuth metrics path 3, plus existing).
- `node --test tests/integration/tools/*.test.js`: **53 pass / 0 fail**.
- `npm test` (MCP protocol compliance): unchanged from HEAD baseline (10 tests, all pre-existing 70% success rate — not regressed by Phase C).
- `node test-tools.js`: **20/20 tools pass** (3.4 s total).
- `npm audit`: **0 vulnerabilities**.
- `node --check` syntax verification on every modified/new file: OK.
- MCP Inspector / OAuth PKCE / `/metrics` end-to-end against a live HTTP server are exercised through the `streamableHttp.test.js` and `oauth.test.js` suites (they boot a real `McpServer` + Node HTTP server on `127.0.0.1` and drive the full flows). A separate manual Inspector run against `http://localhost:3000/mcp` is documented in `docs/oauth-quickstart.md` for operators.

**Files (new):**
- `src/server/transports/streamableHttp.js`
- `src/server/auth/oauth.js`
- `src/observability/metrics.js`
- `src/observability/tracing.js`
- `docs/oauth-quickstart.md`
- `docs/observability/grafana-dashboard.json`
- `tests/unit/{streamableHttp,oauth,metrics,tracing,registerTool}.test.js`

**Files (modified):**
- `server.js` — wire new transport + OAuth + metrics; version bump to 3.2.0
- `src/server/registerTool.js` — accept `outputSchema`, export `dualOutput`
- `src/server/withAuth.js` — emit metrics + OTel span (no-ops if disabled)
- `src/server/transports/http.js` — now a back-compat shim
- `tests/unit/withAuth.test.js` — three new metrics-integration cases
- `package.json` — version 3.1.0 → 3.2.0
- `docs/PRODUCTION_READINESS.md` — version bump + Streamable HTTP endpoint table
- `IMPROVEMENT_PLAN.md` — Phase C checkboxes flipped (C1–C4); C5 left `[ ]` with rationale
- `CHANGELOG.md` — `[3.2.0]` section

---

### v3.1.0 — Phase B "Refactor" (2026-05-17)

Ships Phase B of `IMPROVEMENT_PLAN.md` end-to-end via `/next-phase`. Strictly internal restructuring — no public-API or tool-schema changes. All 20 MCP tools continue to pass. Bumps minor because of substantial internal reorganization (server.js cut in half, new bounded browser pool, real test suite) that downstream forks would need to be aware of.

**B1 — Decomposed `server.js` (2,138 → 990 LOC, 54% reduction):**
- `src/server/registerTool.js` (new) — single tool-registration helper that wraps every handler with `withAuth`. Replaces 20 near-identical registration blocks.
- `src/server/schemas/common.js` (new) — shared Zod fragments (`urlSchema`, `paginationSchema`, `webhookSchema`, `cacheOptsSchema`).
- `src/server/transports/{stdio,http}.js` (new) — transport setup extracted from `server.js`.
- `src/tools/basic/` (new) — 5 inline basic-tool handlers (`fetchUrl`, `extractText`, `extractLinks`, `extractMetadata`, `scrapeStructured`) moved out of `server.js`, plus a shared `_fetch.js` helper.

**B2 — Browser lifecycle (`StealthBrowserManager.js`):**
- `src/core/BrowserContextPool.js` (new, 187 LOC) — bounded pool with capacity cap (default `MAX_BROWSER_CONTEXTS=10`, configurable via env), idle eviction (`closeIdleAfterMs`, default 5 min), periodic browser refresh (every 200 acquisitions or 30 minutes — Playwright best practice), and a wait queue with timeout so excess requests fail fast instead of piling up.
- `StealthBrowserManager` now stores contexts in `BrowserContextPool` instead of an unbounded `Map`, closing the memory-leak vector flagged in the original audit.

**B3 — Tool bloat reduction:**
- `src/tools/tracking/trackChanges.js` (1,377 LOC) split into `trackChanges/{schema,monitor,differ,notifier,index}.js`; root file is now a 15-line re-export shim.
- `src/tools/advanced/BatchScrapeTool.js` (1,089 LOC) split into `batchScrape/{schema,queue,worker,reporter,index}.js`; root file is now a 15-line re-export shim. Now reuses `JobManager` and `WebhookDispatcher` instead of embedding them.
- `ResultRanker` + `ResultDeduplicator` no longer hold separate `CacheManager` instances; they now share a single `SearchResultCache` (`src/tools/search/ranking/SearchResultCache.js`) passed via `sharedCache` option from `searchWeb.js`.
- `src/tools/extract/_fetchAndParse.js` (new) — shared fetch + Cheerio parse helper used by `extractStructured`. `extractContent` and `processDocument` use the higher-level `ContentProcessor` and weren't refactored to use the low-level helper (would have been a no-op change).
- `CacheManager` wired into `crawlDeep` and `mapSite` for fetch deduplication.

**B4 — Real test suite:**
- New unit tests (121 cases total): `browserContextPool` (18), `changeTracker` (33), `jobManager` (28), `snapshotManager` (21), `webhookDispatcher` (21).
- New integration test suites (53 cases total): `basicTools.test.js` (17), `schemas.test.js` (28), `batchScrape.test.js` (8). Cover happy-path + invalid-input assertions for the 5 basic tools and Zod schema acceptance/rejection for `BatchScrape`, `TrackChanges`, `UrlConfig`, plus `SearchResultCache` behaviour.
- `npm run test:coverage` — c8 coverage script with a 60% line / 60% statement / 45% branch / 55% function gate. Reports **64.3% lines, 60.7% functions, 74.9% branches, 64.3% statements** across `src/`. Target met.
- `npm run test:integration` — convenience runner for `tests/integration/tools/*.test.js`.
- "Wire coverage gate into CI" left as `[ ]`: no CI workflow exists in this repo (`.github/workflows/` does not exist). Local gate is enforced through the new `npm run test:coverage` script and tracked for Phase C.

**B5 — Verification:**
- `node --test` against all unit + integration suites: 188 pass / 0 fail.
- `npm test` (MCP protocol compliance): unchanged from HEAD baseline (the 60% success rate is pre-existing).
- `node test-tools.js`: 14 PASS / 6 SKIP (sandboxed-network skips, same as HEAD).
- `npm audit`: 0 vulnerabilities.
- `npm run docker:prod` and the 1,000-call `scrape_with_actions` soak test are deferred to Phase C verification because the sandbox blocks Docker and outbound Chromium traffic. The `BrowserContextPool` unit tests directly assert the bounded-pool / idle-eviction / refresh behaviour the soak test was meant to validate.

**Two small bug fixes surfaced while writing the test suite:**
- `JobManager.validateJob(null)` previously returned `null` (the falsy operand from `&&` short-circuit); now returns a strict `false` as the docstring implies.
- `CacheManager.cleanupTimer` and `monitoringTimer` now `.unref()` so they don't block process exit in short-lived CLI/test runs.

Files: `server.js`, `src/core/StealthBrowserManager.js`, `src/core/BrowserContextPool.js` (new), `src/core/cache/CacheManager.js`, `src/core/JobManager.js`, `src/server/{registerTool.js, schemas/common.js, transports/stdio.js, transports/http.js}` (all new), `src/tools/basic/*` (new), `src/tools/tracking/trackChanges.js` (now shim) + `src/tools/tracking/trackChanges/*` (new), `src/tools/advanced/BatchScrapeTool.js` (now shim) + `src/tools/advanced/batchScrape/*` (new), `src/tools/search/searchWeb.js`, `src/tools/search/ranking/{ResultRanker,ResultDeduplicator,SearchResultCache}.js`, `src/tools/extract/extractStructured.js`, `src/tools/extract/_fetchAndParse.js` (new), `src/tools/crawl/{crawlDeep,mapSite}.js`, `tests/unit/{browserContextPool,changeTracker,jobManager,snapshotManager,webhookDispatcher}.test.js` (all new), `tests/integration/tools/{basicTools,schemas,batchScrape}.test.js` (all new), `package.json`, `package-lock.json`, `IMPROVEMENT_PLAN.md`, `CHANGELOG.md`, `PRD.md`.

---

### v3.0.19 — Phase A "Cleanup" (2026-05-17)

Ships Phase A of `IMPROVEMENT_PLAN.md` end-to-end via `/next-phase`. Closes the two deferred security-audit phases (4 and 5), fixes the silent-failure usage-report bugs, and removes the two pieces of dead code that were not booby-trapped (LocalizationManager proxy/translation stubs, ActionExecutor `example.com` mock branch). No public API or schema changes — strictly internal hardening.

**A1 — Security hardening (audit phases 4 & 5 closed):**
- Phase 5: `AuthManager.initialize()` now calls `validateApiKey()` against the backend at startup. If the backend explicitly rejects the key (invalid / revoked / expired / unauthorized), the server throws and refuses to boot. Connection errors are tolerated — runtime fail-closed credit check from v3.0.18 handles revocation. `CRAWLFORGE_SKIP_STARTUP_VALIDATION=true` bypasses the check.
- Phase 4: HTTP transport (`--http` / `MCP_HTTP=true`) now requires `Authorization: Bearer <api-key>` (or `X-API-Key`) on every `/mcp` request, verified against the stored key. Unauthenticated requests get 401 + a structured log line. Creator mode bypasses the check. The `/health` and `/.well-known/mcp/server-card.json` endpoints remain unauthenticated for discovery.
- Phase 6 (config HMAC) is now formally tracked as deferred in `docs/PRODUCTION_READINESS.md` — requires backend changes outside this repo; will land alongside the v3.2.0 OAuth 2.1 work.

**A2 — Reliability fixes (silent-failure bugs):**
- `withAuth()` is extracted from `server.js` into `src/server/withAuth.js` (so it's directly unit-testable) and wrapped in `try/finally`. Every invocation now emits exactly one `tool invocation` log line: `{ toolName, paramHash, durationMs, outcome, creditCost, creatorMode }`. `outcome ∈ { 'success' | 'error' | 'insufficient_credits' }`. `paramHash` is the first 12 hex chars of a SHA-256 of the params — no payload leakage. Redundant double-call to `getToolCost()` removed; creator-mode check hoisted to one site.
- `AuthManager.reportUsage()` now stamps every usage report with a `requestId` and `idempotencyKey` (UUID v4) and sends the latter as the HTTP `Idempotency-Key` header. The same keys are persisted into `~/.crawlforge/pending-usage.json` so retries from disk are safe to replay.
- `AuthManager._flushPendingUsage()` and `_appendPendingUsage()` no longer swallow errors silently. Successful flushes log their requestIds at info; failed replays log at warn with the retained requestIds; the 1 MB queue-cap eviction logs dropped IDs at warn; pending-file read errors other than ENOENT log at warn.

**A3 — Dead code removal:**
- `src/core/LocalizationManager.js`: removed the `PROXY_PROVIDERS` constant (11 fake `proxy-*.example.com` endpoints), the `TRANSLATION_SERVICES` constant (Google / Azure / LibreTranslate stubs that were never wired up), the `initializeProxySystem()` and `initializeTranslationServices()` methods, and their calls from `initialize()`. The state Maps and `getStats()` fields are retained because they're referenced by other methods elsewhere in the file (and always empty now). The export list no longer re-exports the deleted constants.
- `src/core/ActionExecutor.js`: removed the legacy `if (url === 'http://example.com')` mock branch (lines 174–216 of the original). No test depended on it.
- **NOT removed:** `isomorphic-dompurify` (plan claim was wrong — it's imported by `src/security/wave3-security.js` and `src/utils/inputValidation.js`). **Not changed:** `SnapshotManager.js` gzip — already real, working code; nothing to fix.

**A4 — Documentation:**
- `docs/PRODUCTION_READINESS.md` header bumped (v3.0.12 → v3.0.19; "19 Tools" → "20 Tools"; date updated). The Security Audit Phase Tracker now shows Phase 4 and Phase 5 as ✅ COMPLETE in v3.0.19; Phase 6 stays DEFERRED with an explanation of why.
- `CHANGELOG.md`: new `[3.0.19]` section.
- `IMPROVEMENT_PLAN.md`: Phase A checkboxes flipped; the two items left unchecked carry inline notes explaining why the plan premise was incorrect.

**A5 — Verification:**
- New unit suite `tests/unit/authManagerPhaseA.test.js` (6 tests): startup-validation rejection, success, network tolerance, env bypass, plus idempotency-key plumbing on success and failure paths.
- New unit suite `tests/unit/withAuth.test.js` (6 tests, including 2 for `hashParams`): asserts the "exactly one log line per invocation" contract across success / error / insufficient-credits / creator-mode paths.
- `npm run test:unit`: 26 tests pass (was 14).
- `npm test`: MCP protocol compliance unchanged from HEAD baseline (60% success rate is pre-existing — see commit 104e7e4).
- `node test-tools.js`: 14 PASS, 6 SKIP for sandboxed network; same as HEAD.
- `npm audit`: 0 vulnerabilities (4 pre-existing transitive advisories in `fast-uri` / `hono` / `ip-address` / `express-rate-limit` cleared via `npm audit fix`).
- No build script in this pure-ESM JS project; replaced with `node --check` syntax verification on every modified file.

Files: `src/core/AuthManager.js`, `src/core/LocalizationManager.js`, `src/core/ActionExecutor.js`, `server.js`, `src/server/withAuth.js` (new), `tests/unit/withAuth.test.js` (new), `tests/unit/authManagerPhaseA.test.js` (new), `docs/PRODUCTION_READINESS.md`, `package.json`, `package-lock.json`, `IMPROVEMENT_PLAN.md`, `CHANGELOG.md`, `PRD.md`.

---

### Unreleased — `/next-phase` orchestration skill + IMPROVEMENT_PLAN.md (2026-05-17)

Added `IMPROVEMENT_PLAN.md` at the repo root: a three-release roadmap (Phase A v3.0.19 "Cleanup" → Phase B v3.1.0 "Refactor" → Phase C v3.2.0 "Modernize") drafted from a full audit of the codebase and current MCP best practices (Streamable HTTP, OAuth 2.1, structured outputs).

Added `.claude/skills/next-phase/SKILL.md` — a workflow skill that drives one phase of the plan to completion end-to-end. Invoking `/next-phase` auto-detects the first phase with unchecked `[ ]` items, fires the right sub-agents (`security-auditor`, `mcp-implementation`, `testing-validation`, `performance-monitor`, `api-documenter`, `deployment-manager`) **in parallel**, runs that phase's verification block (`npm test`, `node test-tools.js`, `npm audit`, `npm run build`, plus phase-specific soak / Inspector / OAuth / `/metrics` checks), then flips `[ ]` → `[x]` in `IMPROVEMENT_PLAN.md`, appends entries to `PRD.md` and `CHANGELOG.md`, and commits + pushes to the current branch. Safety rails: never amends, never `--no-verify`, never force-pushes, never `git add -A`; halts before commit if any verification step fails.

No source/runtime code changed. Files: `IMPROVEMENT_PLAN.md` (new), `.claude/skills/next-phase/SKILL.md` (new), `PRD.md`.

---

### Unreleased — `deep_research` raw-evidence mode + scope/metric fixes (2026-04-30)

`deep_research` previously appeared broken when called from Claude Code: it returned `success: true` but emitted unreadable text fragments in `keyFindings`, `consensus`, `conflicts`, and `recommendations`. Root cause: the tool tried to do its own LLM-powered synthesis but, when no `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` was configured, silently fell back to a frequency-based keyword extractor that produced garbage. MCP "sampling" (server-to-host LLM calls) is not yet supported in Claude Code ([anthropics/claude-code#1785](https://github.com/anthropics/claude-code/issues/1785)), so the tool cannot route through the user's Max plan.

**Fix 1 — raw-evidence mode:** When no LLM provider is configured, `ResearchOrchestrator.synthesizeInformation` now skips the broken keyword pipeline and returns a clean `synthesisMode: "raw_evidence"` payload — per-source `{title, url, credibility, contentSnippet, topSentences}` plus an explanatory `note` directing the calling LLM (Claude Code on a Max/Pro plan) to do the synthesis itself. The legacy LLM-enhanced path is unchanged when keys are present. `.env.example` and `CLAUDE.md` now document the optional LLM keys.

**Fix 2 — scope-param propagation in `buildOrchestratorConfig()`:** The `academic`, `current_events`, `comparative`, and `focused` (partial) approach branches silently dropped `maxUrls`, `timeLimit`, and `concurrency` from the user's request, falling back to orchestrator defaults (`maxUrls: 100`, `timeLimit: 120000`). For example, calling with `researchApproach: "current_events", maxUrls: 6` returned 15 sources. Each branch now spreads a shared `scopeConfig` so user-supplied scope is honored across all approaches.

**Fix 3 — performance/depth metrics:** `performance.totalProcessingTime` was being snapshot into the result *before* it was assigned (always reported `0`); now set before `compileResearchResults` runs. `metadata.researchDepth` was vestigial — initialized to `0` and never updated; now incremented after each of the five orchestration stages so the field reflects how far the pipeline got (`5` = full success, `<5` = partial completion before failure).

Files: `src/core/ResearchOrchestrator.js`, `src/tools/research/deepResearch.js`, `.env.example`, `CLAUDE.md`, `PRD.md`. All 20 MCP tools continue to pass `node test-tools.js`.

---

### v3.0.18 — Security Patch (2026-04-18)

Closes three critical/high audit findings identified in the 2026-04-18 security audit of v3.0.17. No public API changes; all 20 MCP tools continue to pass.

**Phase 1 — Endpoint allow-list (CRITICAL):** `CRAWLFORGE_API_URL` is now validated against an allow-list of permitted CrawlForge backend hosts (`www.crawlforge.dev`, `crawlforge.dev`, `api.crawlforge.dev`). Localhost is only accepted when verified creator mode is active. The server exits at startup if the endpoint fails validation.

**Phase 2 — Fail-closed credit check (CRITICAL):** Cached credit results are now only trusted within a 30-second window of the last successful backend response. `CREDIT_CHECK_INTERVAL` reduced from 60 s to 15 s. Blocking outbound network no longer grants indefinite free access.

**Phase 3 — Usage-report hardening (HIGH):** Usage-report fetch has a 5-second timeout. Local credit cache is decremented regardless of network outcome. Failed reports are queued to `~/.crawlforge/pending-usage.json` (capped at 1 MB) and replayed on the next successful report or server startup.

**Deferred:** Phases 4 (HTTP transport per-request auth), 5 (startup key re-validation), and 6 (config HMAC) are intentionally deferred; see `docs/PRODUCTION_READINESS.md` for open-item tracking.

---

### v3.0.17 — Security Patch (2026-04-15)

Cleared all 12 `npm audit` advisories (8 high, 3 moderate, 1 low) flagged by Socket.dev against v3.0.16. No public API changes; all 20 MCP tools verified passing post-upgrade.

**Direct dependency bumps:**
- `@modelcontextprotocol/sdk`: `^1.17.3` → `^1.29.0` (resolves GHSA-345p-7cg4-v4c7 cross-client data leak; cascades fix to `hono`, `@hono/node-server`, `ajv`, `path-to-regexp`)
- `isomorphic-dompurify`: `^2.26.0` → `^3.9.0` (resolves 4 `dompurify` advisories including mutation-XSS and prototype pollution)
- `jsdom`: `^26.1.0` → `^29.0.2` (dedupes with isomorphic-dompurify v3's inner dep)
- `jest` + `@jest/globals` (dev): `^30.0.5` → `^30.3.0` (refreshes `minimatch`, `brace-expansion`, `picomatch` to patched versions)

**Transitive `overrides` added** (for deps whose parents are latest-already or unmaintained): `undici ^7.24.0`, `underscore ^1.13.8`, `qs ^6.14.2`, `path-to-regexp ^8.4.2`, `@hono/node-server ^1.19.13`, `hono ^4.12.4`, `dompurify ^3.4.0`.

**Verification:** `npm audit` reports 0 vulnerabilities. MCP protocol compliance: 10/10. `test-tools.js`: 20/20 tools PASS. `test-real-world.js`: 4/4 scenarios PASS.

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

# CrawlForge MCP Server - Production Readiness

**Version:** 4.6.0 | **Status:** ✅ PRODUCTION READY | **Updated:** 2026-06-07

---

## Quick Status

| Category | Status |
|----------|--------|
| CrawlForge.dev Integration | ✅ Complete |
| Security | ✅ 9.7/10 |
| All 27 Tools | ✅ Working |
| MCP Compliance | ✅ Harness exits 0 (0 errors) |
| Functional Tests | ✅ `test-tools.js` 15/15 + 5 network-skipped (100%) |
| Unit Tests | ✅ Green sandbox-off (`npm run test:unit`); incl. `phaseD-regressions.test.js` 34/34 |
| npm Published | ✅ Yes |

**Production Readiness Score:** 98.5/100


---

## Stealth Review Phase 2 — Engine routing and proxy plumbing (Complete locally; hosted gate outstanding, one item deliberately not shipped)

**Completed:** 2026-09-21 | **Version:** 6.7.0 tree (no version bump — no credit change, and no existing call changes behaviour) | **Plan:** [`STEALTH_REVIEW_2026-09.md`](./STEALTH_REVIEW_2026-09.md) §6 Phase 2

Five parallel sub-agents (stealth core, tool surface, research paths, deploy/Docker, documentation), integrated in the main session against the **diff** rather than the agents' summaries — which is what caught the two corrections below. **Routing:** `scrape.escalate_engine` and `stealth_mode.engine` default to `'auto'`, reusing the semantic `deep_research` already had under `RESEARCH_STEALTH_ENGINE` so one vocabulary covers every entry point. `resolveStealthEngine(requested)` → `{engine, fallbackWarning}` is the single resolver; every caller pushes that warning into its own result, so a Camoufox→Chromium downgrade is never silent. Naming an engine still pins it exactly. `server.js` had been collapsing anything non-Camoufox to Chromium, which would have defeated `'auto'` outright. **Surface:** `engine` on `browser_session` and `scrape_with_actions`, carried through `BrowserProcessor` to *both* `launchStealthBrowser` and `createStealthContext` — passing it to only one relaunched on the default underneath. **Proxies:** `CRAWLFORGE_STEALTH_PROXIES` consumed in `resolveProxy()`, the one choke point for every path through `StealthBrowserManager`, plus separate wiring for `ResearchOrchestrator`, which launches Camoufox directly and bypasses the manager. Kept distinct from the localization-owned `PROXY_ROTATION_*`. **Fixed:** Camoufox's UA self-contradicted on ~half of all launches (`camoufox@0.1.19` rewrites persona versions with a non-global regex, so it reaches `rv:` and stops while `Firefox/` keeps browserforge's draw) — measured **4/8** on the installed 135 binary, now **8/8** with the persona generated at the binary's own major, confirmed on a real launch through the manager. The Chrome-shaped extra-stealth init script is no longer injected into Firefox, and `headless:'virtual'` no longer collapses to plain headless. **Docker:** the image could never have run Camoufox — musl cannot load a glibc-linked binary, and npm silently drops the optional `camoufox` subtree on Node 20 (its transitive `language-tags@2.1.0` needs ≥22); base moved to `node:22-bookworm-slim`. `npm run test:unit` **2423 tests / 0 failed (181 files)**; `npm test` **100.0% COMPLIANT / 0 errors**.

**Two claims corrected during integration, both found by reading the code rather than the reports:**

- **`geoip` was already shipped in Phase 1** (`StealthBrowserManager.js:508`, `geoip: !!proxy`). Verified rather than rebuilt — the coordinating agent caught this before dispatching and told its child not to reimplement it.
- **The `agent` tool does not read the server proxy**, contrary to the checklist item and to the wording that had already propagated into README, CHANGELOG, CLAUDE.md, the review doc and both agent skills. `AgentOrchestrator.js` contains no stealth or browser call at all; the agent gains a browsing path in Phase 3. All six files corrected to the five paths that actually read it.

**Open, and deliberately named rather than glossed:**

- **Hosted verification is outstanding.** The phase's own gate requires the Phase 0 harness on the hosted instance against the residential baseline for Indeed and Harrods. That baseline does not exist and cannot be produced from a dev machine. Run `npm run bench:stealth -- --out docs/stealth-bench-baseline-2026-09-21-hosted.md` there, then compare. Phase 2 is **implemented and locally verified, not hosted-verified.**
- **The Camoufox binary was not upgraded, on purpose.** Upstream is 152.0.4-beta.30; `camoufox@0.1.19`'s bundled data knows Firefox up to 151, so on a current binary *every* generated UA self-contradicts — measurably worse than the installed 135. A newer binary is the wrong fix; a current client is the right one, which makes the `camoufox-js` evaluation the live half of that item. It stays unchecked.
- **`engines.node` stays `>=20.16.0`.** Node 20 users get no Camoufox at all (silent optional-subtree drop) and therefore Chromium via `'auto'` — now *with* a warning saying why. Bumping to `>=22` is breaking and belongs to a release decision.
- Camoufox costs ~**+0.8 s and +400 MB RSS** per call (148 ms / 253 MB vs 946 ms / 667 MB), which `'auto'` now pays on the common path. It is also the only engine that cleared Indeed and Harrods in the Phase 0 baseline.
- Phase 1's `persona-os-vs-host` remains baselined for Camoufox. Pinning the persona OS would close it, but that is Phase 1's finding and this change deliberately did not move that baseline.

---

## Stealth Review Phase 1 — Contained correctness fixes (Complete, one gate clause reduced not closed)

**Completed:** 2026-09-21 | **Version:** 6.7.0 tree (no version bump — no tool, schema or credit change) | **Plan:** [`STEALTH_REVIEW_2026-09.md`](./STEALTH_REVIEW_2026-09.md) §6 Phase 1

All ten checklist items shipped by three parallel sub-agents (engine/fingerprint in `StealthBrowserManager.js`, verdict layer in `challengeDetection.js`/`stealthVerdict.js`, documentation), integrated and measured by the PM against the Phase 0 harness — with a clean HEAD worktree run the same afternoon as the "before", so every claim is a comparison rather than a recollection. **Verdict:** the finding-6 false positive is closed; quora.com is a Pass on both engines with its real title and 397 characters of body text. The cause was narrower than the review assumed — the page's only `cf-chl-` token is `cf-chl-widget-<id>_response`, the hidden input Turnstile names itself, so widget markers and challenge bootstrap are now separated and `scrape`'s direct upstream import was routed through the wrapper. **Fingerprint:** `navigator.webdriver` reports `false`, `Object.getOwnPropertyNames(navigator)` is empty (the four spoofs moved to `Navigator.prototype`), `userAgentData` carries "Google Chrome" and no headless brand, the UA's Chrome major comes from the installed binary, the persona OS is the host's, and worker identity moved to CDP emulation with cores and memory now observed rather than drawn. **Flags:** `--disable-web-security` + `--disable-site-isolation-trials` removed from the stealth browser, four stealth-driver defaults taken off via `ignoreDefaultArgs`, five no-op WebRTC flags replaced by `--webrtc-ip-handling-policy=disable_non_proxied_udp`, hover/pointer blink settings added, and `page.route('**/*')` deleted with the random asset aborts. **Gate:** three of four clauses met — rebrowser **all green** on Chromium (was two red rows), no WebRTC candidate with a real address, quora.com a Pass; the fourth, CreepJS worker identity, went from three mismatched fields to one and is **not** closed. Detector self-probes **19 pass / 0 fail / 1 skip** across both engines; seven of eight `ci-baseline.json` ids deleted. `npm run test:unit` **2372 tests / 0 failed (178 files)**; `npm test` **100.0% COMPLIANT / 0 errors**.

**Open, and deliberately named rather than glossed:** CreepJS's remaining worker user agent (`HeadlessChrome/151`) is read from a SharedWorker — a separate CDP target playwright-core attaches nothing to, with no `Emulation` domain on a worker session — so closing it means blocking SharedWorker or attaching to those targets, neither contained. `persona-os-vs-host` stays baselined for Camoufox because camoufox npm 0.1.19 ignores its own `os` option (it forwards the key to `fingerprint-generator`, which wants `operatingSystems`): measured one Mac persona in three on a Mac host; Phase 2 owns that client. incolumitas' new `WEBDRIVER` FAIL is an fpscanner-era test demanding `navigator.webdriver === undefined`, which is the shape rebrowser marks red. sannysoft's `Permissions (New)` and `navigator.javaEnabled` rows fail identically on HEAD; the likely cause (a plain `query` on the `Permissions` instance resolving `{ state }` rather than a `PermissionStatus`) is recorded for a later phase. The Phase 0 hosted-instance baseline also remains outstanding.

---

## Stealth Review Phase 0 — Repeatable benchmark harness (Complete, less the hosted baseline)

**Completed:** 2026-09-21 | **Version:** 6.7.0 tree (no version bump — no product code changed) | **Plan:** [`STEALTH_REVIEW_2026-09.md`](./STEALTH_REVIEW_2026-09.md) §6 Phase 0 | **Baseline:** [`stealth-bench-baseline-2026-09-21-residential.md`](./stealth-bench-baseline-2026-09-21-residential.md)

First phase of the 2026-09 stealth plan, shipped by four parallel sub-agents (harness core, detector assertions, CI wiring, documentation) and integrated, run and gate-verified by the PM. **Harness:** `scripts/stealth-bench.mjs` + `scripts/lib/stealth-bench/` reproduces the review's section 2 by command — twelve bot walls and five detector pages across the plain fetch, Chromium stealth and Camoufox, robots-gated, with the exit IP classified in the header. **Assertions:** ten in-page self-probes encode section 2.3 (webdriver, `userAgentData` brands, worker-vs-main UA/platform/cores/languages, WebRTC candidates, UA-vs-binary, persona OS, headless markers) plus five third-party page parsers. **CI:** `.github/workflows/stealth-detectors.yml` runs the self-probes only, gated against `ci-baseline.json` so known leaks stay green and regressions go red, followed by the forced-`navigator.webdriver` negative control. **Gate:** both verification items pass — the wall matrix reproduced eleven of the twelve rows of §2.2 (Harrods Camoufox-only, stackoverflow both engines, trustpilot robots-skipped, Quora still the finding-6 false positive), with leboncoin/Chromium flipping Pass→Blocked between two runs an hour apart on the same IP, which is within the "one run per cell is noisy" tolerance the gate allows and is itself the harness's first useful finding; and `--self-check` exits 0 only by catching the forced `webdriver === true` on both engines. `npm run test:unit` **2322 tests / 0 failed (176 files)**; `npm test` **100.0% COMPLIANT / 0 errors**.

Two parsers (rebrowser rows, CreepJS worker-vs-main) skipped on the first run and were fixed against the live pages before the baseline was committed. The run also corrected three claims in the review itself — the Chromium UA pool is randomised rather than Windows-only, the spoofed UA does reach Web Workers (what leaks is `platform`/`hardwareConcurrency`), and WebRTC host candidates are mDNS-only, leaving the finding-9 IPv6 leak unconfirmed pending a STUN-backed check.

**Open:** the hosted-instance baseline. It measures the datacenter exit IP and therefore has to be run on the hosted instance (`npm run bench:stealth -- --out docs/stealth-bench-baseline-<date>-hosted.md`); it was deliberately not inferred. Phase 2's verification gate depends on it.

---

## Remediation Phase 1 — Critical Security Holes: SSRF · OAuth · Secrets · Billing (Complete)

**Completed:** 2026-08-03 | **Version:** 4.10.0 tree (unreleased) | **Plan:** [`plan/phase-1-critical-security.md`](../plan/phase-1-critical-security.md) (audit: [`CODEBASE_AUDIT_2026-08.md`](./CODEBASE_AUDIT_2026-08.md))

All 14 Phase 1 findings closed by six parallel sub-agents (SSRF core, fetch-path wiring, browser navigation, OAuth, billing/secrets, regression tests), integrated and gate-verified by the PM. **SSRF:** IP-literal bypass fixed (pre-flight `ipBlocked()` + per-connect IP-literal validation on redirect hops), IPv4-mapped IPv6 normalized, `BLOCKED_DOMAINS` enforced, and every previously raw fetch path wired to the guard — `scrape_with_actions` Playwright navigation (pre-`goto` + post-navigation re-check), `map_site` page/metadata fetches, `process_document` PDF downloads, webhook delivery/health checks, `deep_research` webhook notifications. **OAuth:** `/oauth/authorize` now demands proof of the operator API key (constant-time comparison) — anonymous token mint closed. **Secrets:** usage telemetry masked via `maskSecrets()`; `deep_research` no longer logs `llmConfig` keys. **Billing:** zero charge when the credit check itself refuses the call; 401/403 reported as invalid/revoked key (not "insufficient credits"); usage-report rejections queued, not silently dropped. **Gate:** all 7 verification-gate items pass — literal-IP/mapped-IPv6/redirect-hop/kill-switch SSRF tests, per-path blocked-target tests (`phase1-ssrf-paths.test.js`), OAuth anonymous-rejection tests (`phase1-oauth.test.js`), telemetry-masking + zero-bill tests (`phase1-billing.test.js`); `npm run test:unit` **513/513**; `npm test` **100.0% COMPLIANT / 0 errors**. Details in `CHANGELOG.md` ([Unreleased]) and `PRD.md`.

---

## Remediation Phase 0 — Dependency Currency & Audit Cleanup (Complete)

**Completed:** 2026-08-03 | **Version:** 4.10.0 tree (no version bump — zero code change) | **Plan:** [`plan/phase-0-dependency-currency.md`](../plan/phase-0-dependency-currency.md) (audit: [`CODEBASE_AUDIT_2026-08.md`](./CODEBASE_AUDIT_2026-08.md))

First phase of the 2026-08 remediation plan. `npm update` within existing caret ranges + a new `"adm-zip": "^0.6.0"` overrides entry took `npm audit` from **16 vulnerabilities (8 high, 6 moderate, 2 low)** to **4 moderate (0 high/critical)**. Cleared: 2 undici HIGHs (GHSA-vmh5-mc38-953g, GHSA-p88m-4jfj-68fv), the adm-zip HIGH (camoufox install-time chain), the DOMPurify moderates (isomorphic-dompurify 3.19.0, held on jsdom 29.x for the Node ≥18 floor). Key bumps: `@modelcontextprotocol/sdk` 1.30.0, `undici` 7.29.0. Remaining 4 moderates deferred to Phase 5's Node-floor decision: `@hono/node-server` chain (GHSA-frvp-7c67-39w9, pinned to 1.x for Node ≥18) and `node-cron`→`uuid` (GHSA-w5hq-g745-h8pq, breaking major). **Gate:** `npm run test:unit` 480/480; `npm test` 100.0% COMPLIANT / 0 errors. Details in [`security-audit-report.md`](./security-audit-report.md) and `CHANGELOG.md` ([Unreleased]).

---

## IMPROVEMENT_PLAN Phase D — Firecrawl-Competitive: Agent + Unified Scrape + Onboarding (Complete)

**Completed:** 2026-06-07 | **Version:** 4.6.0 | **Regression tests:** `tests/unit/phaseD-regressions.test.js` (34/34 pass)

Closed the three Firecrawl feature gaps with no clean CrawlForge equivalent, all local-first (no cloud proxy/reliability layer). Purely additive: tool count 24 → 26, no breaking changes.

**D1 — Ease-of-use**

| Item | Change |
|------|--------|
| `scrape` (new tool) | Single fetch + one cheerio load → dispatches a `formats` array (`markdown`/`html`/`rawHtml`/`text`/`links`/`metadata`/`screenshot`/`{type:"json",schema,prompt?}`) + `onlyMainContent`; partial-success via per-format `warnings[]`. `src/tools/scrape/unifiedScrape.js` |
| `extract_text` | `extractBlockText($)` + Readability→markdown conversion exported for reuse; no behavior change. `src/tools/basic/extractText.js` |
| `map_site` `search=` | Optional `search` ranks discovered URLs (lazy `ResultRanker` singleton) → `ranked_urls:[{url,score}]`; default output unchanged. `src/tools/crawl/mapSite.js` |
| `crawlforge init` (new CLI) | API-key detection + skill install + idempotent MCP-stanza merge into Claude Code / Claude Desktop / Cursor configs; `--all`/`--client`/`--yes`. `src/cli/commands/init.js` |
| `SKILL.md` | Canonical agent-fetchable capabilities reference (concatenated `src/skills/*.md` + Phase-D tools section); referenced from README. |

**D2 — `agent` tool**

| Item | Change |
|------|--------|
| `agent` (new tool) | NL prompt → autonomous search/navigate/extract → prose-or-structured output, no URLs required. Orchestrates `SearchWebTool`, `fetchAndParse`, `ExtractWithLlm`, `SamplingClient`, and `ResearchOrchestrator` (`pro` tier). `src/tools/agent/agent.js`, `src/core/AgentOrchestrator.js` |
| Bounded loop | Hardcoded PLAN→GATHER→ACT→DECIDE→SHAPE; **three independent hard stops (`maxSteps`≤10, `maxUrls`≤20, wall-clock) + "answer found", enforced in the orchestrator, never the LLM.** |
| No-LLM-key path | Returns `{degraded:true, reason, ...evidence}` so the host LLM finishes (mirrors `deep_research`); `ElicitationHelper` confirms `pro` runs (fail-open). |
| Registration & cost | `scrape`/`agent` registered with `withAuth` + graceful-shutdown cleanup; `getToolCost` `scrape:2`/`agent:8`; `projectCost` scales with formats / `maxUrls`+tier. `server.js`, `src/core/AuthManager.js` |

**D3 — Verification:** `phaseD-regressions.test.js` 34/34 (mocked LLM/search/fetch, no live network; asserts the agent hard stops + clamps, the degraded path, unified `scrape` single-fetch multi-format + partial-success, and `map_site` `search=` ranking). Full unit suite green sandbox-off (sandbox-on `streamableHttp`/`searchWebSearxng` `listen EPERM` failures are the pre-existing localhost-bind cases). `npm test` exits 0 (0 errors). `node test-tools.js` 15/15 + 5 network-skipped. **Deferred:** live MCP smoke tests (require publish + global-binary reinstall) and the optional `crawlforge://skill` MCP resource. See `IMPROVEMENT_PLAN.md`, `PRD.md`, and `CHANGELOG.md` [4.6.0].

---

## IMPROVEMENT_PLAN Phase B — Result-Quality Upgrades (Complete)

**Completed:** 2026-06-06 | **Version:** 4.4.0 | **Regression tests:** `tests/unit/phaseb-regressions.test.js`

Upgraded output quality across 11 tools in three areas:

**B1 — Extraction fidelity**

| Tool | Change |
|------|--------|
| `extract_content` / `process_document` | Flesch Reading-Ease formula corrected (206.835 − components; higher score = easier reading); new `avgSyllablesPerWord` field added to readability output |
| `extract_text` | Text mode preserves block structure (`\n\n` between block-level elements); markdown mode now runs `@mozilla/readability` first, then Turndown with `turndown-plugin-gfm` for table support |
| `extract_metadata` | Parses and returns `json_ld` and `microdata` fields (previously advertised but absent); improved title fallback chain: `og:title` → `<title>` → `h1` |
| `scrape_structured` | New `@attr` extraction syntax (e.g. `a@href`, `img@src`); new `max_results` param; `elements_found` is now a per-field DOM-match-count object instead of a key count |
| `extract_structured` | "CSS fallback used" note moved from `validationErrors` to a dedicated `extractionNotes` field (no longer penalizes confidence); improved `ul/ol > li` array extraction |
| `extract_content` | New output fields: `extractionMethod`, `fallback_reason`, `confidence`, `finalUrl` |

**B2 — Crawl & search quality**

| Tool | Change |
|------|--------|
| `crawl_deep` | New `content_max_length` param + `truncated` flag replace the hardcoded 500-character cut |
| `map_site` | Full sitemap-index `<loc>` recursion; gzipped sitemap (`.xml.gz`) support; robots.txt sitemap discovery; proper XML/cheerio parsing (replaces regex); `min` field no longer returns `Infinity` |
| `search_web` | `total_results` typed as Number (was String); BM25 ranking uses real per-term IDF; 64-bit SimHash deduplication; internal `finalScore` and `contentHash` fields no longer leaked in default output |
| `analyze_content` | Word-boundary matching for topic and emotion detection (fixes substring false-positives such as `'happy'` matching `'app'`) |

**B3 — Tracking & research quality**

| Tool | Change |
|------|--------|
| `track_changes` | Content similarity uses real token-based Jaccard instead of length-only comparison; default change threshold is `0.85` |
| `deep_research` | No-LLM `raw_evidence` path now honors `outputFormat` (`summary` / `citations_only` / `conflicts_focus`) and ranks evidence by relevance |

See `IMPROVEMENT_PLAN.md` and `CHANGELOG.md` [4.4.0].

**Next:** Phase C (v4.5.0) "Robustness, Security & Polish".


---


## IMPROVEMENT_PLAN Phase A — Critical Fixes & Restored Capabilities (Complete)

**Completed:** 2026-06-06 | **Version:** 4.3.0 | **Regression tests:** `tests/unit/phaseA-regressions.test.js` (12/12 pass)

Closed all 9 Phase-A correctness bugs and restored 6 silently-dropped MCP capabilities from the 23-tool audit. Highlights: `extract_links` `filter_external` inversion fixed; `analyze_content` language detection unblocked (`francAll`); `summarize_content` abstractive mode implemented with a `degraded` fallback; `extract_with_llm` undefined `callViaSampling` removed; `deep_research` no longer surfaces empty `{"text":""}` extractions; `track_changes` no-baseline returns a clean error; `scrape_template` HN selectors fixed; `generate_llms_txt` now emits spec-compliant llmstxt.org markdown. `crawl_deep`/`search_web`/`map_site`/`scrape_with_actions` MCP schemas now forward all advanced params, and `scrape_with_actions` reads the post-action live page for final content. See `IMPROVEMENT_PLAN.md` and `CHANGELOG.md` [4.3.0].


---


## Roadmap Phase D4 — CLI + Skills Installer (Complete)

**Completed:** 2026-05-18 | **Integration tests:** `tests/integration/cli.test.js` (6/6 pass)

| Component | Status |
|-----------|--------|
| CLI scaffolding (`src/cli/index.js`, formatter, runTool) | Complete |
| 15 tool commands (scrape, search, crawl, map, extract, track, analyze, research, stealth, batch, actions, localize, llmstxt, template, monitor) | Complete |
| Skills installer (`src/skills/installer.js`) | Complete |
| 4 skill markdown files (mcp, cli, stealth, research) | Complete |
| Claude Code target (`~/.claude/skills/`) | Complete |
| Cursor target (`.cursor/rules/crawlforge.mdc`) | Complete |
| VS Code target (`.github/instructions/crawlforge.instructions.md`) | Complete |
| CLI integration tests | 6/6 pass |

**CLI availability:**
```bash
# Global install
npm install -g crawlforge-mcp-server
crawlforge --help

# Without installing
npx crawlforge-mcp-server scrape https://example.com

# Install skills into Claude Code
crawlforge install-skills --target claude-code
```

## Roadmap Phase D2 — Reliability & Cost Hardening (Complete)

**Completed:** 2026-05-17 | **Regression tests:** `tests/unit/d2-reliability.test.js` (16/16 pass)

| Finding | Fix | Status |
|---------|-----|--------|
| D2.1 AuthManager credit race | Promise queue serializes `reportUsage` calls | ✅ |
| D2.2 StealthBrowserManager fingerprint leak | LRU cap via `_setFingerprint` helper | ✅ |
| D2.3 Unbounded LLM cost in ResearchOrchestrator | Per-session `tokenBudget`; `_cost` in response | ✅ |
| D2.4 ActionExecutor page leaks | `initializePage` inside try/finally; safe `page.close()` | ✅ |
| D2.5 WebhookDispatcher retry storms | Backoff+jitter per webhook; batch cap at 10 | ✅ |
| D2.6 JobManager cascade + max enforcement | Cascade-cancel dependents; LRU eviction at `maxJobs` | ✅ |
| D2.7 PerformanceManager saturation routing | Routes by live queue depth/wait time; AbortController on shutdown | ✅ |
| D2.8 Localization cache + ChangeTracker hash | LRU-capped Maps; `hashContentAsync` offloads to worker | ✅ |
| D2.9 Secret leakage in logs | `src/utils/secretMask.js` + Winston global masking format | ✅ |
| D2.10 ResearchOrchestrator URL dedup | `deduplicateSources` uses per-session `visitedUrls`; cache hits reuse extracted content | ✅ |

## Roadmap Phase D5.1 — GitHub Actions CI (Complete)

**Completed:** 2026-05-17

| Workflow | File | Status |
|----------|------|--------|
| CI Pipeline | `.github/workflows/ci.yml` | ✅ |
| Daily Security Scan | `.github/workflows/security.yml` | ✅ |

CI jobs: lint-and-syntax, unit-tests, mcp-compliance, coverage, docker-build.
Security: daily npm audit + gitleaks secret scan + CodeQL analysis.


---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 4.6.0 | 2026-06-07 | Phase D Firecrawl-Competitive — new `scrape` (unified single-fetch multi-format) and `agent` (bounded autonomous loop, no URLs required) tools; `map_site` `search=` relevance ranking; `crawlforge init` CLI (API-key + skills + MCP-stanza merge); canonical `SKILL.md`; tool count 24 → 26 |
| 4.5.0 | 2026-06-07 | Phase C Robustness, Security & Polish — fetch body-size cap; AbortSignal timeouts; opt-in/parallelized llms.txt probing; per-domain rate-limiter; camoufox engine selection; sec-ch-ua/UA consistency; version-derived UA; localization phone/geo fixes; extract_with_llm schema validation + JSON recovery; ISO timestamps in list_ollama_models; new `get_batch_results` tool; PDF page ranges; tool count 23 → 24 |
| 4.4.0 | 2026-06-06 | Result-Quality Upgrades — Flesch formula corrected; block-preserving extract_text; JSON-LD/microdata in extract_metadata; @attr syntax + max_results + per-field elements_found in scrape_structured; extraction provenance fields in extract_content; content_max_length in crawl_deep; full sitemap-index recursion in map_site; numeric total_results + real BM25/SimHash in search_web; word-boundary topic/emotion matching in analyze_content; token Jaccard similarity in track_changes; outputFormat honored in no-LLM deep_research path |
| 4.3.0 | 2026-06-06 | Critical Fixes & Restored Capabilities — 9 correctness bugs fixed; 6 MCP schema capabilities restored |
| 3.2.0 | 2026-05-17 | Modernize — Streamable HTTP transport (stateful sessions, `Mcp-Session-Id`), OAuth 2.1 with PKCE + DCR, structured tool outputs (`outputSchema` / `dualOutput`), OpenTelemetry tracing facade, Prometheus `/metrics`, Grafana dashboard, OAuth quickstart docs |
| 3.1.0 | 2026-05-17 | Refactor — `server.js` 2,138 → 990 LOC, bounded `BrowserContextPool`, trackChanges/batchScrape decomposed, shared `SearchResultCache`, 188 unit + integration tests (64.3% line coverage on `src/`) |
| 3.0.19 | 2026-05-17 | Cleanup — close audit phases 4 & 5, structured tool-invocation logging, request IDs + idempotency keys on usage reports, dead-code removal in LocalizationManager/ActionExecutor |
| 3.0.18 | 2026-04-18 | Security patch — endpoint allow-list, fail-closed credit check, usage-report hardening (audit phases 1/2/3) |
| 3.0.12 | 2026-03-30 | Add functional test files (test-tools.js, test-real-world.js) |
| 3.0.10 | 2026-01-16 | Auto-configure Claude Code & Cursor MCP clients |
| 3.0.9 | 2026-01-16 | Fix API endpoint (api → www.crawlforge.dev) |
| 3.0.8 | 2026-01-12 | Search API proxy via CrawlForge.dev |
| 3.0.7 | 2026-01-09 | Fix HIGH severity dependency vulnerabilities |
| 3.0.6 | 2026-01-09 | Fix PNG screenshot quality option |
| 3.0.3 | 2025-10-01 | Secure creator mode, auth bypass fix |

---

## API Endpoints

### CrawlForge.dev backend (outbound, from server)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/auth/validate` | Validate API key |
| `GET /api/v1/credits` | Check credit balance |
| `POST /api/v1/usage` | Report tool usage |
| `POST /api/v1/search` | Google Search proxy |

### Streamable HTTP transport (v3.2.0+, when `--http` is used)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/mcp` | POST / GET / DELETE | MCP Streamable HTTP (stateful sessions via `Mcp-Session-Id` header) |
| `/health` | GET | Liveness probe (`{ status, version, mode }`) |
| `/metrics` | GET | Prometheus exposition (when `CRAWLFORGE_METRICS=true`) |
| `/.well-known/mcp/server-card.json` | GET | Smithery gateway discovery |
| `/.well-known/oauth-authorization-server` | GET | OAuth 2.1 discovery (when `CRAWLFORGE_OAUTH_ENABLED=true`) |
| `/oauth/register` | POST | OAuth Dynamic Client Registration (RFC 7591) |
| `/oauth/authorize` | GET | OAuth authorization (PKCE S256 required) |
| `/oauth/token` | POST | OAuth token + refresh |
| `/oauth/revoke` | POST | OAuth token revocation (RFC 7009) |

The legacy stateless transport from v3.1.x has been removed. `/mcp` serves the 2025 era over the sessionful Streamable HTTP transport and the 2026-07-28 era statelessly on the same route.

---

## Credit Costs

| Tool Type | Credits | Tools |
|-----------|---------|-------|
| Basic | 1 | fetch_url, extract_text, extract_links, extract_metadata |
| Standard | 2-3 | scrape_structured, search_web, summarize_content, analyze_content, process_document, extract_content, generate_llms_txt, track_changes |
| Premium | 5-10 | crawl_deep, map_site, batch_scrape, scrape_with_actions, localization, deep_research, stealth_mode |

---

## Security Summary

All HIGH priority items resolved:
- ✅ JavaScript execution disabled by default
- ✅ HTTPS-only webhooks enforced
- ✅ SHA-256 creator mode authentication
- ✅ SSRF protection (industry-leading)
- ✅ Zod input validation on all tools

### Security Audit — Phase Tracker (audit date 2026-04-18, v3.0.17 baseline)

| Phase | Severity | Description | Status |
|-------|----------|-------------|--------|
| Phase 1 | CRITICAL | Endpoint allow-list (`CRAWLFORGE_API_URL` validation) | ✅ COMPLETE in v3.0.18 |
| Phase 2 | CRITICAL | Fail-closed credit check (30 s grace window, interval 15 s) | ✅ COMPLETE in v3.0.18 |
| Phase 3 | HIGH | Usage-report hardening (5 s timeout, cache decrement, pending queue) | ✅ COMPLETE in v3.0.18 |
| Phase 4 | HIGH | HTTP transport per-request auth (Bearer / X-API-Key, fail-closed) | ✅ COMPLETE in v3.0.19 |
| Phase 5 | MEDIUM | API key re-validation on startup (refuse boot if backend rejects) | ✅ COMPLETE in v3.0.19 |
| Phase 6 | LOW | Config HMAC integrity check | DEFERRED — requires backend changes outside this repo. Tracked as future work; will land alongside the v3.2.0 OAuth 2.1 work (Phase C2 of `IMPROVEMENT_PLAN.md`). |

---

## User Setup Flow

```bash
npm install -g crawlforge-mcp-server
npx crawlforge-setup  # Auto-configures Claude Code & Cursor
# Restart IDE
```

---

## Related Documentation

| Document | Location |
|----------|----------|
| Security Audit | `/docs/security-audit-report.md` |
| Testing Report | `/docs/testing-validation-report.md` |
| MCP Protocol | `/docs/mcp-protocol-review.md` |
| User Journey | `/docs/user-journey-validation-report.md` |

---

## Contact

**Project Owner:** Simon Lacey

---

*Last reviewed: 2026-01-16*


## Phase D1 — MCP-Native Primitives (v3.6.0)

| Sub-phase | Status | Details |
|-----------|--------|---------|
| D1.1 Resources | COMPLETE | ResourceRegistry.js, 5 crawlforge:// URI types, 20 unit tests green |
| D1.2 Prompts | COMPLETE | PromptRegistry.js, 5 workflow prompts registered via registerPrompt() |
| D1.3 Sampling | COMPLETE | SamplingClient.js with Ollama-API-MCP fallback chain in 4 tools |
| D1.4 Elicitation | COMPLETE | ElicitationHelper.js wired into 5 tools and AuthManager |
| D1.5 Tool audit | COMPLETE | All 22 tool descriptions rewritten (when-to-use + examples) |

Server capabilities now include: resources.listChanged, prompts.listChanged, tools.listChanged.

## Remediation Plan — 2026-08 Codebase Audit

Execution status of the 7-phase plan in `plan/` (109 code findings from `docs/CODEBASE_AUDIT_2026-08.md`).

| Phase | Status | Details |
|-------|--------|---------|
| 0 Dependency currency | COMPLETE 2026-08-03 | `npm update` + adm-zip override; `npm audit` 16 vulns → 4 moderate (0 high/critical) |
| 1 Critical security (14) | COMPLETE 2026-08-03 | SSRF IP-literal/mapped-IPv6 bypasses, OAuth anonymous token mint, telemetry secret leakage, billing-on-refusal all closed; unit 513/513; MCP 100.0% |
| 2 Correctness (52) | COMPLETE 2026-08-03 | crawl_deep BFS timeout critical, cache-key lies, stripped `options`, never-running summarizer, snapshot delta data-loss, NaN ranking + 46 more; six stub suites replaced with real-module tests; unit **802/802**; MCP **100.0% / 0 errors**; live re-smokes green |
| 3 Leaks & robustness (24) | COMPLETE 2026-08-03 | Browser page/context leaks (failed goto, per-call contexts, executionHistory payloads), per-crawl CacheManager leak (GC-verified), batchResults LRU+TTL, snapshot `.meta` content strip + bounded metadataCache, research wall-clock deadline + racer cleanup, body-read timeouts/size caps on every fetch path (basic/batch/scrape/PDF/SearXNG/webhook/branding), lazy `ensureInitialized()` + `~/.crawlforge/snapshots` storage, trackChanges lazy singleton, stealth single-flight launch; +23 tests in `phase3-leaks`/`phase3-timeouts` suites; unit **825 (824 pass / 1 skip / 0 fail)**; MCP **100.0% / 0 errors** |
| 4 Transport & cleanup (19) | COMPLETE 2026-08-04 | Streamable HTTP rebuilt on per-session transport map (second session / reconnect / DELETE+reinit all work; legacy mode serves every request), `getting-started` prompt retrievable, screenshot base64 stripped from `scrape` results, `search_web` config-file key fallback, stdout-clean auto-setup, webhook HMAC over the delivered body + working retry codes, elicitation/sampling wiring, discovery metadata real (v4.10.0 / 27 tools), `isError` on credit refusal + 5 more lows; transport/prompt/lifecycle regression tests added; unit **835 (834 pass / 1 skip / 0 fail)**; MCP **100.0% / 0 errors** |
| 5 Dependency modernization | COMPLETE 2026-08-05 | DECISION approved: `engines.node` >=18 → **>=20.16.0** (Dockerfile/CI already compliant). Removed `node-cron` (unused — clears uuid GHSA-w5hq-g745-h8pq), `@googleapis/customsearch` (unused), `node-summarizer` (extractive path rewritten on `compromise`); majors taken: `pdf-parse` 2.4.5 (PDFParse class port — password decryption now real, native page ranges), `commander` ^14.0.3 (zero code changes), `p-queue` ^9.3.3 (dead `throwOnTimeout` removed), `diff` ^9.0.0 (zero code changes); `@hono/node-server` override → 2.0.12. **`npm audit` 4 moderate → 0 vulnerabilities.** ChainDrop worm protocol enforced on every install (--ignore-scripts, pre-2026-08-04 publish-date gate, compromised-list cross-check zero matches, IoC scans clean before/after). Deferred to Node 22 + SDK v2: undici 8, jsdom 30, zod 4. Unit **845 (844 pass / 1 skip / 0 fail)**; MCP **100.0% / 0 errors**; test-tools 20/20 |
| 6 MCP-spec & competitive | COMPLETE 2026-08-05 (approved subset) | DECISION phase — user greenlit all of Track A + two Track B items. Shipped: structured output (`outputSchema` + `structuredContent`) on scrape/map_site/serp_rank/search_web/extract_structured/crawl_deep; SEP-1303 validation-as-tool-error pinned by regression tests; JSON Schema 2020-12 on the wire + deterministic sorted tools/list + SEP-2549-style cacheable `_meta` hints (10 read-only tools) + SEP-973 icons (`src/server/specHygiene.js`); async task pattern via the MCP tasks extension (`taskSupport:'optional'`) on crawl_deep/batch_scrape/deep_research/agent (`src/server/taskSupport.js`); `CRAWLFORGE_TOOLS`/`CRAWLFORGE_TOOL_GROUPS` whitelist (`src/server/toolFilter.js`); MCP Registry `server.json` (2025-12-11 schema) + OIDC publish workflow. Deferred by decision: hosted remote endpoint/OAuth, keyless tier, scheduled monitoring, persistent sessions, redactPII, vertical groups, SDK v2 migration. Unit **914 (913 pass / 1 skip / 0 fail)**; MCP **100.0% / 0 errors**; live phase6 integration 3/3 |


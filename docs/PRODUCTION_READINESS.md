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

The legacy stateless transport from v3.1.x is preserved behind `--legacy-http` for one release and will be removed in v3.3.0.

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
| 3 Leaks & robustness (24) | PENDING | Next up |
| 4 Transport & cleanup (19) | PENDING | |
| 5 Dependency modernization | PENDING | DECISION phase (Node floor) |
| 6 MCP-spec & competitive | PENDING | DECISION phase (roadmap) |


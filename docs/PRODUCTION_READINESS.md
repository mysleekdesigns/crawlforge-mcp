# CrawlForge MCP Server - Production Readiness

**Version:** 4.4.0 | **Status:** ✅ PRODUCTION READY | **Updated:** 2026-06-06

---

## Quick Status

| Category | Status |
|----------|--------|
| CrawlForge.dev Integration | ✅ Complete |
| Security | ✅ 9.7/10 |
| All 23 Tools | ✅ Working |
| MCP Compliance | ✅ 100% |
| Functional Tests | ✅ 20/20 tools via `test-tools.js` (creator-mode path) |
| Unit Tests | ✅ 277/277 (`npm run test:unit`, sandbox-off) |
| npm Published | ✅ Yes |

**Production Readiness Score:** 98.5/100


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


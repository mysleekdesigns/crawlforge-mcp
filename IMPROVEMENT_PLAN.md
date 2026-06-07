# CrawlForge MCP Server — Tool Improvement Plan

**Baseline:** v4.2.12 · **Drives:** Phase A → v4.3.0, Phase B → v4.4.0, Phase C → v4.5.0
**Source:** 21-agent audit (code-review → live-test → web-research → synthesis) across all 10 tool groups / 23 tools, 2026-06-06. Every `file:line` below was then adversarially re-verified against source (34 claims: 29 confirmed exactly, 5 refined, 0 refuted).

> **Goal:** every tool returns correct, non-empty, non-crashing results for its documented use case (Phase A), then produces best-in-class output quality (Phase B), then is robust/secure/consistent (Phase C). Surgical changes; prefer existing dependencies.

> **`/next-phase` note:** the skill's hardcoded Phase-A verification runs `npm run build`, which does **not** exist in this repo. Use the real commands in each phase's **Verification** block: `npm run test:unit`, `npm test`, `node test-tools.js`.

---

## Tool status (from the audit)

| Tool | worksLive (v4.2.10) | quality | Headline problem | Phase |
|------|------|------|------|------|
| fetch_url | yes | good | No body-size cap (memory DoS); stale UA | C |
| extract_text | yes | fair | Whitespace collapse glues blocks; weak boilerplate removal | B |
| extract_links | yes | good | **`filter_external` inverted** | A |
| extract_metadata | yes | good | Advertised JSON-LD/microdata never parsed | B |
| scrape_structured | yes | good | Can't tell "no match" from "bad selector"; text-only (no attrs) | B |
| crawl_deep | partial | good | **MCP drops domain_filter/session**; **500-char truncation** | A/B |
| map_site | yes | good | No sitemap-index recursion/gzip; regex XML parse | A/B |
| search_web | yes | good | **MCP drops 10 params**; leaked score fields; string total_results; BM25/SimHash broken | A/B |
| extract_content | not-tested | unknown | **Inverted Flesch**; silent fallback; ineffective timeout | B/C |
| process_document | not-tested | unknown | PDF layout loss (UNVERIFIED — confirm first) | C |
| summarize_content | partial | fair | **abstractive mode throws (missing method)** | A |
| analyze_content | partial | fair | **language detection broken (`franc.all`)**; substring false-positives | A/B |
| extract_with_llm | yes | good | **`callViaSampling` undefined**; Anthropic JSON unenforced | A/C |
| extract_structured | yes | fair | Note mislabeled as error; confidence penalized; naive arrays | B |
| list_ollama_models | yes | excellent | Minor: Array.isArray guard; ISO timestamps | C |
| deep_research | partial | poor | **Empty extractions surfaced as `{"text":""}`**; outputFormat ignored | A/B |
| batch_scrape | yes | good | Pagination unreachable; markdown title dup | C |
| scrape_with_actions | partial | poor | **MCP strips action fields**; final content re-fetches original | A |
| stealth_mode | yes | fair | sec-ch-ua brand vs UA version mismatch; engine ignored (OS/create_page fixed in 4.2.12) | C |
| localization | yes | good | geo-blocking advisory-only; US phone regex broken | C |
| scrape_template | partial | fair | **HN subtext selectors broken** | A |
| track_changes | partial | fair | **no-baseline emits unhandled `error` event**; length-only similarity | A/B |
| generate_llms_txt | yes | poor | **Emits robots.txt, not spec llms.txt**; serial intrusive probing | A/C |

---

## Phase A — v4.3.0 "Critical Fixes & Restored Capabilities"
**Completed:** 2026-06-06
**Goal:** Every tool's documented core use case works correctly and signals failure honestly. Each fix ships a reproducing→passing regression test.

### A1 — Broken behavior (correctness)
- [x] **extract_links** — invert the `filter_external` guard so `filter_external:true` returns only *external* links (currently returns internal-only). `src/tools/basic/extractLinks.js:44` (S)
- [x] **analyze_content** — fix language detection: `import { franc, francAll } from 'franc'` and call `francAll(...)` (franc v6 has no `franc.all`). Unblocks all language detection and `summarize_content`'s `metadata.language`. `src/core/analysis/ContentAnalyzer.js:7,319` (S)
- [x] **summarize_content** — implement the missing `_abstractiveSummaryViaSampling()` (route through `SamplingClient`/`LLMManager`); if abstractive can't run, return the extractive result **with an explicit `degraded`/reason flag** instead of silently masking. `src/tools/extract/summarizeContent.js:136` (M)
- [x] **extract_with_llm** — remove the undefined `callViaSampling(...)` call: either wire the already-imported (currently dead) `getSamplingClient()` fallback, or drop the fallback and surface the real Ollama error. `src/tools/extract/extractWithLlm.js:320,13-19` (S)
- [x] **deep_research / ResearchOrchestrator** — skip failed/empty extractions: check `contentData.success` and non-empty `content.text` before counting `contentExtracted` or serializing (stop producing the literal `'{"text":""}'`). `src/core/ResearchOrchestrator.js:520-528` (M)
- [x] **track_changes** — return a clean `No baseline — run create_baseline first` error and stop emitting an unhandled `'error'` event for the expected no-baseline case. `src/core/ChangeTracker.js:178-180,250-253` (S)
- [x] **scrape_template** — fix the `hacker-news-front-page` selectors: the row after `tr.athing` is `.subtext` (not `.spacer`), so score/author/posted/comments come back null on every story. `src/tools/templates/TemplateRegistry.js:163-179` (S)
- [x] **generate_llms_txt** — emit spec-compliant llms.txt markdown (`# Title`, `> summary`, detail paragraphs, `## Section` headers with `[name](url): notes` lists per llmstxt.org) instead of robots.txt directives (`User-agent:`/`Crawl-delay:`/`Disallow:`). Keep the robots-style output behind an explicit option if still wanted. `src/tools/llmstxt/generateLLMsTxt.js:125-218` (L)

### A2 — Restored MCP capabilities
*(Root cause: `server.js` `registerTool` inputSchemas are subsets of the tools' real Zod schemas, silently dropping advanced params. For each, either forward the params or remove them from the docs.)*
- [x] **crawl_deep** — forward `domain_filter`, `session`, `import_filter_config`, `enable_link_analysis`, `link_analysis_options` through the MCP schema + handler. `server.js:333-355` (M)
- [x] **search_web** — forward the 10 dropped params (`provider`, `expand_query`, `expansion_options`, `enable_ranking`, `ranking_weights`, `enable_deduplication`, `deduplication_thresholds`, `include_ranking_details`, `include_deduplication_details`, `localization`), incl. the SearXNG provider path. `server.js:307-325` (M)
- [x] **map_site** — forward `domain_filter` / `import_filter_config`. `server.js:360-375` (S)
- [x] **scrape_with_actions** — carry all action params in the MCP action schema (`duration`, `milliseconds`, `distance`, `direction`, `captureAfter`, `clear`, `force`, `button`, `clickCount`, `delay`, `position`, `modifiers`, `smooth`, `toElement`, `condition`, `fullPage`, `quality`, `format`, `args`, `returnResult`) so the documented `{type:'wait',duration:1000}` works. `server.js:579-591` (M)
- [x] **scrape_with_actions** — reconcile the `formAutoFill` contract mismatch (MCP declares `{fields:[{selector,value,...}]}`; tool expects `z.record(string)` and treats keys as selectors). Pick one shape end-to-end. `server.js:595-604` vs `src/tools/advanced/ScrapeWithActionsTool.js:125,447-498` (S)
- [x] **scrape_with_actions** — make "final content" read the post-action live page instead of re-fetching the original URL with a fresh `ExtractContentTool`. `src/tools/advanced/ScrapeWithActionsTool.js:588-610` (M)

### A3 — Verification & tests
- [x] Add a reproducing→passing regression test for every A1/A2 item (extend `tests/unit/tools/...` and `tests/integration/tools/...`).
- [x] `npm run test:unit` + `npm test` + `node test-tools.js` green; update `docs/PRODUCTION_READINESS.md`.

---

## Phase B — v4.4.0 "Result-Quality Upgrades"
**Completed:** 2026-06-06
**Goal:** "Working" tools return accurate, well-structured, high-fidelity data.

### B1 — Extraction fidelity
- [x] **extract_content / process_document** — fix the inverted Flesch Reading-Ease formula (subtract components from 206.835; use syllables-per-word, not chars) and align both tools' implementations + `getReadabilityLevel`. `src/core/processing/ContentProcessor.js:406,425-433` (S)
- [x] **extract_text** — preserve block structure (join block-level elements with `\n\n` for text mode); run `@mozilla/readability` before Turndown for markdown mode; load `turndown-plugin-gfm` for tables. `src/tools/basic/extractText.js:27,29`, `src/utils/htmlToMarkdown.js` (M)
- [x] **extract_metadata** — parse JSON-LD/microdata (advertised but absent); stronger title fallback chain (og:title → `<title>` → h1). `src/tools/basic/extractMetadata.js` (S)
- [x] **scrape_structured** — support attribute extraction (`href`/`src`/`@attr`), add `max_results`, and fix `elements_found` which counts result *keys* rather than actual DOM matches (return real per-field match counts). The bad-selector vs no-match distinction already exists (try/catch) but rarely fires since cheerio doesn't throw on valid-but-empty selectors. `src/tools/basic/scrapeStructured.js:29,31,47` (M)
- [x] **extract_structured** — move the "CSS fallback used" note out of `validationErrors` into its own `extractionNotes`; stop penalizing confidence for that note; improve array/list extraction (detect `ul/ol > li`, support a repeating base selector). `src/tools/extract/extractStructured.js:215-220,234-262` (M)
- [x] **extract_content** — add `extractionMethod` / `fallback_reason` / `confidence` + `finalUrl` so callers can tell Readability output from last-resort body text. `src/tools/extract/extractContent.js:192-216` (M)

### B2 — Crawl & search quality
- [x] **crawl_deep** — add a `content_max_length` param + `truncated` flag (replace the hardcoded 500-char cut; don't append `...` to already-short content). `src/tools/crawl/crawlDeep.js:255` (M)
- [x] **map_site** — recurse sitemap-index `<loc>` entries; handle gzipped sitemaps (`.xml.gz`); replace the naive `/<loc>…<\/loc>/` regex with a real XML/cheerio parser (handle CDATA/entities); discover sitemaps via robots.txt; fix `min=Infinity→null`. **Reuse the existing `src/utils/sitemapParser.js`.** `src/tools/crawl/mapSite.js:167-193,235` (M)
- [x] **search_web** — type `total_results` as a Number (`providers/searxng.js:120` wraps it in `String()`); compute real BM25 IDF (per-term document frequency, not the constant `df=Math.min(len*0.1,1)`); use a true 64-bit SimHash (`stringHash` is 32-bit and `>>` is mod-32, so bits 32-63 duplicate 0-31); strip the leaked top-level `finalScore` and `contentHash` fields when details aren't requested (the cleanup at `searchWeb.js:281-293,409-414` only removes the nested `rankingDetails`/`deduplicationInfo`). `searchWeb.js:300,419`, `ranking/ResultRanker.js:105-106,199`, `ranking/ResultDeduplicator.js:113-114,570-578` (M)
- [x] **analyze_content** — word-boundary topic categorization + emotion detection (stop substring false-positives: `'happy'`→`'app'`, `'glade'`→`'glad'`). `src/tools/extract/analyzeContent.js:271,401` (M)

### B3 — Tracking & research quality
- [x] **track_changes** — real content similarity (Jaccard/diff-based) instead of length-only comparison; sensible default change threshold. `src/tools/tracking/trackChanges/differ.js` (M)
- [x] **deep_research** — the no-LLM `raw_evidence` early-return (intentional) bypasses the `outputFormat` switch, so `summary`/`citations_only`/`conflicts_focus` silently do nothing without an LLM. Either document `outputFormat` as LLM-only **or** add lightweight no-LLM formatting; also rank evidence by relevance. `src/tools/research/deepResearch.js:382-394,401-456` (S)

### B4 — Verification & tests
- [x] Regression/quality tests for each B item; suites green; update docs.

---

## Phase C — v4.5.0 "Robustness, Security & Polish"
**Completed:** 2026-06-07 (all items shipped; full suites green)
**Goal:** No memory/DoS vectors, correct timeouts, polite networking, consistent contracts, accurate metadata.

### C1 — Resource safety & network
- [x] **_fetch.js** — enforce a configurable max body-size cap (Content-Length check + streaming abort) to prevent memory-exhaustion across all basic tools. `src/tools/basic/_fetch.js:19` (M)
- [x] **timeouts** — replace ineffective `timeout:` options with `AbortSignal.timeout(...)` wherever native `fetch` is used (Node fetch ignores `timeout`). `src/tools/extract/extractContent.js:161-166`, `src/tools/tracking/trackChanges/differ.js:11-22`, et al. (S)
- [x] **generate_llms_txt / LLMsTxtAnalyzer** — parallelize + cap the dozens of sequential probe fetches; make intrusive path/security/rate probing opt-in. `src/core/LLMsTxtAnalyzer.js:176-264,297-352` (M)
- [x] **BFSCrawler** — keep a per-domain rate-limiter map (don't recreate the limiter when `effectiveRateLimit` changes); route filter/robots decisions through the logger, not raw `console.error` (stdout-hygiene). `src/core/crawlers/BFSCrawler.js:145-159,179-181` (M)

### C2 — Stealth / anti-detection (post-4.2.12 residuals)
- [x] **stealth_mode** — sync the `sec-ch-ua` brand version to the chosen UA's Chrome major version (currently hardcoded `120` vs UA `121`). `src/core/StealthBrowserManager.js:538-548` (S)
- [x] **stealth_mode** — honor/validate `engine:'camoufox'` in the operation-based `create_context`/`create_page` API (currently always launches Chromium). `src/core/StealthBrowserManager.js:338-387,1942-1965` (M)

### C3 — Polish & consistency
- [x] **fetch_url / extract_structured** — version-derived realistic User-Agent (drop stale `CrawlForge/1.0.0`). `src/tools/basic/_fetch.js:22`, `src/tools/extract/extractStructured.js` (S)
- [x] **localization** — fix the US phone regex escaping (`\\d`→`\d`); make geo-blocking honest (apply a real strategy or rename to "detect"). `src/core/LocalizationManager.js:507-544,1323-1390` (S)
- [x] **extract_with_llm** — schema-validate output (zod), add JSON-substring recovery (balanced embedded JSON), enforce Anthropic structured output via tool-use; surface truncation metadata (`truncated`, `original_length`). `src/tools/extract/extractWithLlm.js:73,87-94,136-143,356-371` (M)
- [x] **list_ollama_models** — normalize `modified_at` to ISO timestamps and harden non-array response handling (currently only a `|| []` fallback at line 44). `src/tools/extract/listOllamaModels.js:44,47` (S)
- [x] **batch_scrape** — register `get_batch_results` / accept a `page` param; de-dup the markdown title; return webhook delivery status. `src/tools/advanced/BatchScrapeTool.js`, `src/tools/advanced/batchScrape/*` (S)
- [x] **process_document** — *re-verified*: fixed page-range extraction (per-page `pagerender` capture + true `pageRange:{start,end}` slice; `maxPages` no longer clobbers the range) and made the server `options` schema passthrough so granular options reach the tool. Multi-column/table layout remains a documented pdf-parse limitation (engine swap out of scope). `src/core/processing/PDFProcessor.js`, `src/tools/extract/processDocument.js`, `server.js` (M)

### C4 — Verification & tests
- [x] Regression tests (`tests/unit/phaseC-regressions.test.js`, 27 tests); full suites green: `npm run test:unit` 360/360, `node test-tools.js` 20/20, `npm test` exits 0 (0 errors); `npm audit` 4 pre-existing moderate (uuid/node-cron transitive, out of scope).

---

## Quick Wins (high value, low effort)

| Item | Tool | File | Why |
|------|------|------|-----|
| Invert `filter_external` | extract_links | `extractLinks.js:44` | Returns the opposite set today |
| `franc.all`→`francAll` | analyze_content | `ContentAnalyzer.js:7,319` | Unblocks ALL language detection (+ summarize) |
| Remove undefined `callViaSampling` | extract_with_llm | `extractWithLlm.js:320` | Corrupts the most common error message |
| Fix Flesch formula | extract_content/process_document | `ContentProcessor.js:406` | Every readability score is wrong |
| Fix HN selectors | scrape_template | `TemplateRegistry.js:163-179` | 4 fields × 30 stories null → populated |
| Clean no-baseline error | track_changes | `ChangeTracker.js:178-180,251` | Stops a leaked unhandled-error |
| US phone `\\d`→`\d` | localization | `LocalizationManager.js:~1390` | Dead regex → working |
| Strip leaked `finalScore`/`contentHash` | search_web | `searchWeb.js:281-293` | Leaks internals on every default call |
| `total_results`→Number | search_web | `searchWeb.js:300,419` | String contract bug |
| Logger not `console.error` | BFSCrawler | `BFSCrawler.js:145-159` | stdout-hygiene |
| Version-derived UA | fetch_url | `_fetch.js:22` | Accurate v4.2.x identity |
| ISO timestamps + non-array safety | list_ollama_models | `listOllamaModels.js:44,47` | Consistent output, crash-proofing |

---

## Critical files (by phase)

- **Phase A:** `src/tools/basic/extractLinks.js`, `src/core/analysis/ContentAnalyzer.js`, `src/tools/extract/summarizeContent.js`, `src/tools/extract/extractWithLlm.js`, `src/core/ResearchOrchestrator.js`, `src/core/ChangeTracker.js`, `src/tools/templates/TemplateRegistry.js`, `src/tools/llmstxt/generateLLMsTxt.js`, `server.js` (crawl_deep/search_web/map_site/scrape_with_actions registrations), `src/tools/advanced/ScrapeWithActionsTool.js`.
- **Phase B:** `src/core/processing/ContentProcessor.js`, `src/tools/basic/extractText.js`, `src/utils/htmlToMarkdown.js`, `src/tools/basic/extractMetadata.js`, `src/tools/basic/scrapeStructured.js`, `src/tools/extract/extractStructured.js`, `src/tools/extract/extractContent.js`, `src/tools/crawl/crawlDeep.js`, `src/tools/crawl/mapSite.js`, `src/utils/sitemapParser.js`, `src/tools/search/searchWeb.js`, `src/tools/search/ranking/ResultRanker.js`, `src/tools/search/ranking/ResultDeduplicator.js`, `src/tools/extract/analyzeContent.js`, `src/tools/tracking/trackChanges/differ.js`, `src/tools/research/deepResearch.js`.
- **Phase C:** `src/tools/basic/_fetch.js`, `src/core/LLMsTxtAnalyzer.js`, `src/core/crawlers/BFSCrawler.js`, `src/core/StealthBrowserManager.js`, `src/core/LocalizationManager.js`, `src/tools/extract/listOllamaModels.js`, `src/tools/advanced/BatchScrapeTool.js`, `src/core/processing/PDFProcessor.js`.

---

## Verification (per phase)

1. **Automated:** `npm run test:unit` (add `--test-force-exit` if it hangs ~100s on the Playwright handle), `npm test`, `npm run test:integration`. One reproducing→passing regression test per Phase-A/B fix.
2. **Functional:** `node test-tools.js`, `node test-real-world.js`, `node tests/integration/mcp-protocol-compliance.test.js`.
3. **Live MCP smoke tests** (after publishing the phase + reconnecting the MCP server) against example.com / Wikipedia / HN, e.g.:
   - `extract_links {filter_external:true}` → only external links
   - `crawl_deep` with a `domain_filter` blacklist → start URL respected; `content_max_length` honored
   - `search_web` default response has **no** top-level `scores`/`contentHash` keys; `total_results` is a number
   - `scrape_with_actions {actions:[{type:'wait',duration:1000}]}` → succeeds
   - `generate_llms_txt` output starts with `# ` and contains `## ` sections
   - `analyze_content {detectLanguage:true}` → populated `language`
4. **Stdout-hygiene & memory:** keep `tests/unit/stdout-hygiene.test.js` green after the BFSCrawler change; add a large-body fetch-rejection test (Phase C).
5. **Per-phase ritual (CLAUDE.md):** run suites → fix failures → update `docs/PRODUCTION_READINESS.md` + `PRD.md` + `CHANGELOG.md` → commit + push.

---

## Already fixed in v4.2.12 / explicitly refuted (do NOT re-action)

- **Fixed in v4.2.12:** `stealth_mode` fingerprint OS/UA/`navigator.platform` consistency (`selectOS()` threading) and `create_page` serializable `navigation` output. The audit's *live* failures for these were the stale globally-installed v4.2.10 and no longer apply (re-verify after MCP reconnect).
- **Refuted by the audit (no action):** `extract_with_llm` token normalization already correct; Ollama `format=schema` enforcement correct; `deep_research` elicitation does not over-trigger; `SamplingClient` already passes system prompt + maxTokens; `localization` bypass methods are defined; `stealth_mode` proxyRotation is guarded; `batch_scrape` HTTP-status fidelity preserved.
- **UNVERIFIED (confirm before acting):** `process_document` PDF layout/page-range findings (code-review only; re-test in Phase C before changing).

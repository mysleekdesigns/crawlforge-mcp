#!/usr/bin/env node
/**
 * Live regression sweep: drive all 28 tools over real MCP stdio and assert the
 * ground truths the 2026-08-28 quality sweep established (TOOL_QUALITY_PLAN.md
 * item 7.1). One assertion per defect fixed in Phases 1-6, so none of them can
 * come back silently.
 *
 * Every call goes through the SDK Client + StdioClientTransport, never
 * `execute()`. MCP validates a tool's result against its declared outputSchema
 * and a direct `execute()` call does not, so a schema drift is only visible on
 * this path — that is how a broken reddit_search survived three releases.
 *
 * The spawned server gets CACHE_ENABLE_DISK=false. With the disk cache on, a
 * run replays an earlier response with `cached: true` and the sweep reports
 * green for the wrong reason. A cached sweep is worse than no sweep.
 *
 * Creator mode (CRAWLFORGE_CREATOR_SECRET in the gitignored .env) is what lets
 * this run without spending credits. Without it the script exits rather than
 * running a degraded sweep quietly.
 *
 * Compliance: every call takes the default, robots-respecting path — nothing
 * here passes respect_robots:false — and the checks run one at a time rather
 * than fanning out across ~30 live hosts.
 *
 * Usage:
 *   node scripts/tool-sweep.mjs                     # default tier only
 *   node scripts/tool-sweep.mjs --all               # + paid, slow and browser tiers
 *   node scripts/tool-sweep.mjs --all --skip-paid   # everything except the billed lookup
 *   node scripts/tool-sweep.mjs --only=scrape,track_changes
 *
 * Cost: the default tier spends no money and takes a few minutes. `--all` adds
 *   - serp_rank: one DataForSEO lookup, ~US$0.002, needs DATAFORSEO_LOGIN/PASSWORD
 *   - deep_research: several minutes and many upstream fetches
 *   - agent: one autonomous run
 *   - stealth_mode / scrape_with_actions: two Chromium launches
 * search_web spends Google API quota on every run. When that is exhausted the
 * check SKIPs; re-run it explicitly with provider 'searxng' (CLAUDE.md) — this
 * script never falls back on its own.
 *
 * A live target that is down, rate-limited or re-styled is a SKIP, not a FAIL.
 * Only a genuinely violated assertion FAILs, and only a FAIL exits non-zero.
 */

import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO = resolve(import.meta.dirname, '..');
dotenv.config({ path: resolve(REPO, '.env'), quiet: true });

// ─── Targets ──────────────────────────────────────────────────────────────────
// The live pages the 2026-08-28 sweep used. All are public, unauthenticated and
// allowed to our product token; changing one changes what the assertions mean.

const SP500 = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const CLOUDFLARE_POST = 'https://blog.cloudflare.com/dns-cache-memory-optimization-1111/';
const IANA_EXAMPLE = 'https://www.iana.org/help/example-domains';
const PYTHON_HOME = 'https://www.python.org';
const PYTHON_DOWNLOADS = 'https://www.python.org/downloads/';
const W9_PDF = 'https://www.irs.gov/pub/irs-pdf/fw9.pdf';
const WIKI_SCRAPING = 'https://en.wikipedia.org/wiki/Web_scraping';
const UUID = 'https://httpbin.org/uuid';
const MCP_SITE = 'https://modelcontextprotocol.io';
const DOCS = 'https://www.crawlforge.dev/docs';
const RESEARCH_TOPIC = 'What anti-bot systems do major websites use in 2026';

// A single Chinese paragraph: 5 sentences, 174 characters, 96 segmented words.
// This exact input reproduced 5.2 (readability said 1 word / 1 sentence while
// statistics said 96 / 1 in the same response).
const CHINESE_PARAGRAPH = [
  '北京市是中华人民共和国的首都，也是全国的政治、文化、教育与国际交往中心。',
  '这座城市位于华北平原的北部边缘，西面和北面环绕着连绵起伏的燕山山脉。',
  '故宫、天坛和颐和园等世界文化遗产每年吸引着数以千万计的国内外游客前来参观。',
  '中关村聚集了大量的高科技企业和研究机构，被人们称为中国的硅谷。',
  '密集的地铁网络与两座国际机场共同支撑着这座超大城市的日常通勤和对外联系。'
].join('');

// 3.3's paired false-positive control. The opener is navigation-shaped on every
// feature the boilerplate strip can measure — 37 chars, 7 words, one trailing
// terminator — and is real prose, so it must survive. It is deliberately over
// 30 characters: the REST surface drops every sentence of <= 20 chars for
// unrelated reasons, which would make a shorter fixture prove nothing.
const SHORT_OPENER = 'The wind blew cold across the estuary.';
const CONTROL_PROSE = [
  SHORT_OPENER,
  'The tide turned before dawn and the boats swung slowly on their moorings.',
  'By morning the fishermen had gone out past the sandbar with nets mended twice that winter.',
  'Nobody in the village expected much of the catch, but the weather held and they came back full.'
].join('\n');

// ─── Assertion plumbing ───────────────────────────────────────────────────────

class Fail extends Error {}
class Skipped extends Error {}

const expect = (condition, message) => { if (!condition) throw new Fail(message); };
const skip = (message) => { throw new Skipped(message); };

/** A target that is down, throttled or newly robots-disallowed is not a regression. */
const TRANSIENT =
  /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed|\b(429|500|502|503|504)\b|too many requests|service unavailable|rate limit|quota|robots\.txt|disallow|retry-after/i;

const looksTransient = (message = '') => TRANSIENT.test(message);

const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; } };

// ─── Harness ──────────────────────────────────────────────────────────────────

let client;
let serverLog = '';

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['server.js'],
    cwd: REPO,
    // Disk cache off, or a replayed response silently inverts every comparison.
    env: { ...process.env, CACHE_ENABLE_DISK: 'false' },
    stderr: 'pipe'
  });
  client = new Client({ name: 'tool-sweep', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  // Attach after connect (transport.stderr only exists once the child is
  // spawned); the startup banner is still buffered on the pipe at this point.
  transport.stderr.on('data', (chunk) => {
    serverLog = (serverLog + chunk.toString()).slice(-32768);
  });
}

/** One tools/call. Returns the parsed result; throws on an MCP-level error. */
async function call(name, args, timeout = 120000) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
  const text = result.content?.[0]?.text ?? '';
  if (result.isError) throw new Error(`${name}: ${text.slice(0, 300)}`);
  if (result.structuredContent) return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name}: result is not JSON: ${text.slice(0, 200)}`);
  }
}

// ─── Checks ───────────────────────────────────────────────────────────────────
// tier: 'default' runs always; 'paid' bills money; 'slow' takes minutes;
// 'browser' launches Chromium. Non-default tiers need --all or --only.

/** Carried between checks so a batch can be read back and a browser torn down. */
const state = {};

const CHECKS = [
  {
    tool: 'fetch_url', tier: 'default', what: 'raw HTTP fetch',
    run: async () => {
      const r = await call('fetch_url', { url: 'https://example.com' });
      expect(r.status === 200, `expected HTTP 200, got ${r.status}`);
      expect(typeof r.body === 'string' && r.body.length > 0, 'empty response body');
      return `${r.status}, ${r.size} bytes`;
    }
  },
  {
    tool: 'extract_text', tier: 'default', what: 'page text',
    run: async () => {
      const r = await call('extract_text', { url: 'https://example.com' });
      expect(r.text.includes('Example Domain'), `text missing the page heading: ${r.text.slice(0, 80)}`);
      expect(r.word_count > 0, 'word_count is 0');
      return `${r.word_count} words`;
    }
  },
  {
    tool: 'extract_links', tier: 'default', what: 'link discovery',
    run: async () => {
      const r = await call('extract_links', { url: PYTHON_HOME });
      expect(r.total_count > 0, 'no links found');
      // Only relative hrefs are resolved; the page also carries `javascript:;`
      // anchors, which are returned verbatim and are not a resolution failure.
      const resolved = r.links.filter((l) => /^[/#]/.test(l.original_href || '') && /^https?:/.test(l.href));
      expect(resolved.length > 0, 'no relative link was resolved against the base URL');
      return `${r.total_count} links, ${resolved.length} resolved from relative`;
    }
  },
  {
    tool: 'extract_metadata', tier: 'default', what: 'SEO metadata',
    run: async () => {
      const r = await call('extract_metadata', { url: 'https://example.com' });
      expect(r.title === 'Example Domain', `title was ${JSON.stringify(r.title)}`);
      return r.title;
    }
  },
  {
    tool: 'extract_embedded_state', tier: 'default', what: 'embedded JS state (3.1)',
    run: async () => {
      const r = await call('extract_embedded_state', { url: 'https://www.ticketmaster.com/discover/concerts' });
      const names = (r.found || []).map((f) => f.name);
      expect(names.includes('next_data'), `sources found: ${names.join(', ') || 'none'}`);
      return `${names.length} sources (${names.join(', ')}), ${r.bytes} B`;
    }
  },
  {
    tool: 'scrape', tier: 'default', what: '1.1 data tables survive onlyMainContent',
    run: async () => {
      const r = await call('scrape', { url: SP500, formats: ['markdown'] });
      const rows = (r.content?.markdown || '').split('\n').filter((l) => l.trim().startsWith('|'));
      // The constituents list changes size; the defect returned zero rows.
      expect(rows.length >= 400, `only ${rows.length} pipe-table lines (was 505 when fixed, 0 when broken)`);
      expect(
        (r.warnings || []).some((w) => /re-attached \d+ data table/.test(w)),
        `no table re-attach warning: ${JSON.stringify(r.warnings)}`
      );
      return `${rows.length} pipe-table lines`;
    }
  },
  {
    tool: 'scrape', tier: 'default', what: '1.1 control — a normal article re-attaches nothing',
    run: async () => {
      const r = await call('scrape', { url: CLOUDFLARE_POST, formats: ['markdown'] });
      expect((r.content?.markdown || '').length > 5000, 'article markdown is suspiciously short');
      expect(
        !(r.warnings || []).some((w) => /re-attached/.test(w)),
        `re-attached a table on a page that dropped none: ${JSON.stringify(r.warnings)}`
      );
      return `${r.content.markdown.length} chars, no re-attach`;
    }
  },
  {
    tool: 'scrape', tier: 'default', what: '6.5 branding fonts carry no var() fragment',
    run: async () => {
      const r = await call('scrape', { url: 'https://www.crawlforge.dev', formats: ['branding'] });
      const families = (r.content?.branding?.fonts || []).map((f) => f.family);
      expect(families.length > 0, 'no font families extracted');
      const leaked = families.filter((f) => f.includes('var('));
      expect(leaked.length === 0, `font list leaks CSS variable text: ${JSON.stringify(leaked)}`);
      const lead = families.slice(0, 3);
      expect(
        lead.includes('JetBrains Mono') && lead.includes('Inter'),
        `expected the list to lead with the real families, got ${JSON.stringify(lead)}`
      );
      return lead.join(', ');
    }
  },
  {
    tool: 'scrape_structured', tier: 'default', what: '3.2 row_selector pairs each version with its own date',
    run: async () => {
      const r = await call('scrape_structured', {
        url: PYTHON_DOWNLOADS,
        row_selector: '.download-list-widget .list-row-container > li',
        selectors: { version: '.release-number a', date: '.release-date' }
      });
      expect(Array.isArray(r.data) && r.data.length >= 10, `expected records, got ${JSON.stringify(r.data).slice(0, 120)}`);
      const header = r.data.filter((row) => row.date === 'Release date');
      expect(header.length === 0, `${header.length} record(s) paired with the literal table header "Release date"`);
      // The page lists 2.x releases as well as 3.x, so the version test is on
      // the shape, not the branch.
      expect(r.data.every((row) => row.version === null || /^Python \d+\.\d+/.test(row.version)),
        `a record carried something other than a version: ${JSON.stringify(r.data.find((row) => row.version && !/^Python \d+\.\d+/.test(row.version)))}`);
      return `${r.data.length} aligned records`;
    }
  },
  {
    tool: 'search_web', tier: 'default', what: '6.1 limit is met after deduplication',
    run: async () => {
      const r = await call('search_web', { query: 'site:github.com model context protocol server', limit: 6 });
      // processing.deduplication now reports over the over-fetched page, so its
      // counts deliberately do not line up with results.length.
      expect(r.results.length === 6, `asked for 6, got ${r.results.length} (was 3-4 before the over-fetch)`);
      return `6 results, dedup removed ${r.processing?.deduplication?.duplicatesRemoved ?? '?'} of ${r.processing?.deduplication?.originalCount ?? '?'}`;
    }
  },
  {
    tool: 'serp_rank', tier: 'paid', what: 'crawlforge.dev ranks 1 for its brand keyword',
    run: async () => {
      if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
        skip('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set in .env');
      }
      const r = await call('serp_rank', { keyword: 'crawlforge', target: 'crawlforge.dev', location_name: 'United States', depth: 20 });
      if (r.configured === false) skip('serp_rank reports unconfigured — credentials not picked up');
      expect(r.found === true, 'crawlforge.dev did not appear in the scanned SERP');
      expect(r.position === 1, `expected position 1, got ${r.position}`);
      return `position 1, $${r.cost}`;
    }
  },
  {
    tool: 'reddit_search', tier: 'default', what: 'scoped archive search returns posts',
    run: async () => {
      const r = await call('reddit_search', { subreddit: 'rust', query: 'scraping', limit: 3 });
      expect(r.count > 0, 'no posts returned');
      expect(r.results.every((p) => p.subreddit === 'rust'), 'a result came from outside the requested subreddit');
      return `${r.count} posts via ${r.source}`;
    }
  },
  {
    tool: 'crawl_deep', tier: 'default', what: '2.1 include_patterns no longer blocks the seed / 2.2 depth_distribution is crawl depth',
    run: async () => {
      const maxDepth = 1;
      const r = await call('crawl_deep', { url: DOCS, include_patterns: ['/docs/'], max_depth: maxDepth, max_pages: 10 }, 240000);
      // 2.1 — the exact call that used to die with "Start URL blocked by domain filter".
      expect(r.pages_found > 0, `crawl returned no pages: ${r.error || 'no error reported'}`);
      const outside = (r.results || []).map((p) => p.url).filter((u) => !u.includes('/docs'));
      expect(outside.length === 0, `crawled outside the include pattern: ${JSON.stringify(outside)}`);
      // 2.2 — the distribution must be crawl depth, and path depth must have its own field.
      const dist = r.site_structure?.depth_distribution || {};
      const total = Object.values(dist).reduce((a, b) => a + b, 0);
      expect(total === r.pages_found, `depth_distribution sums to ${total}, pages_found is ${r.pages_found}`);
      const over = Object.keys(dist).filter((k) => Number(k) > maxDepth);
      expect(over.length === 0, `depth_distribution has keys above max_depth ${maxDepth}: ${over.join(',')}`);
      expect(r.site_structure?.path_depth_distribution, 'path_depth_distribution is missing');
      return `${r.pages_found} pages, depth ${JSON.stringify(dist)}`;
    }
  },
  {
    tool: 'map_site', tier: 'default', what: 'URL discovery',
    run: async () => {
      const r = await call('map_site', { url: 'https://www.crawlforge.dev', max_urls: 15 });
      expect(r.total_urls > 0, 'no URLs discovered');
      return `${r.total_urls} URLs`;
    }
  },
  {
    tool: 'extract_content', tier: 'default', what: 'main-article extraction',
    run: async () => {
      const r = await call('extract_content', { url: CLOUDFLARE_POST });
      expect(r.success === true, `extraction failed: ${r.error}`);
      expect(/terabytes/i.test(r.title || ''), `title was ${JSON.stringify(r.title)}`);
      expect((r.content?.text || '').length > 1000, 'extracted body is suspiciously short');
      return `${r.content.text.length} chars via ${r.extractionMethod}`;
    }
  },
  {
    tool: 'process_document', tier: 'default', what: 'real W-9 metadata (SE:W:CAR:MP) / 5.1 one readability score',
    run: async () => {
      const r = await call('process_document', { source: W9_PDF, sourceType: 'pdf_url' });
      expect(r.documentType === 'pdf', `documentType was ${r.documentType} — the PDF was not parsed`);
      expect(r.metadata?.author === 'SE:W:CAR:MP', `metadata.author was ${JSON.stringify(r.metadata?.author)}`);
      // 5.1 — the two fields were 100 "Very Easy" against 54.75 "Fairly Difficult".
      const own = r.readabilityScore;
      const quality = r.qualityAssessment?.metrics?.readability;
      expect(own && quality, 'one of the two readability fields is missing');
      expect(own.score === quality.score, `readabilityScore.score ${own.score} != qualityAssessment ${quality.score}`);
      expect(own.level === quality.level, `readability level "${own.level}" != "${quality.level}"`);
      return `${r.metadata.author}, readability ${own.score} "${own.level}" in both fields`;
    }
  },
  {
    tool: 'summarize_content', tier: 'default', what: '3.3 the summary does not lead with navigation chrome',
    run: async () => {
      const page = await call('extract_text', { url: WIKI_SCRAPING });
      expect(/^Jump to content/.test(page.text), 'the source page no longer opens with the nav line this check exists for');
      const r = await call('summarize_content', { text: page.text });
      const summary = r.summary?.text || '';
      expect(summary.length > 0, 'empty summary');
      expect(!/Jump to content/i.test(summary), `summary still carries the skip link: ${summary.slice(0, 120)}`);
      expect(!/^From Wikipedia, the free encyclopedia/i.test(summary), `summary leads with page chrome: ${summary.slice(0, 120)}`);
      return `${r.summary.sentences.length} sentences, leads "${summary.slice(0, 48)}…"`;
    }
  },
  {
    tool: 'summarize_content', tier: 'default', what: '3.3 control — a genuine short opening sentence is kept',
    run: async () => {
      const r = await call('summarize_content', { text: CONTROL_PROSE });
      expect(
        (r.summary?.text || '').includes(SHORT_OPENER),
        `the opening sentence was stripped as boilerplate: ${JSON.stringify(r.summary?.text?.slice(0, 120))}`
      );
      return 'opener retained';
    }
  },
  {
    tool: 'analyze_content', tier: 'default', what: '5.2 CJK word counts agree and Flesch is withheld',
    run: async () => {
      const r = await call('analyze_content', { text: CHINESE_PARAGRAPH });
      const readability = r.readability;
      const stats = r.statistics;
      expect(readability?.metrics && stats, 'readability or statistics block missing');
      expect(readability.metrics.words === stats.words,
        `readability says ${readability.metrics.words} words, statistics says ${stats.words}`);
      expect(readability.metrics.sentences === stats.sentences,
        `readability says ${readability.metrics.sentences} sentences, statistics says ${stats.sentences}`);
      expect(stats.words > 90, `${stats.words} words — the CJK segmenter is not being used`);
      expect(stats.sentences === 5, `${stats.sentences} sentences, expected 5 。-terminated ones`);
      expect(readability.score === undefined && readability.level === undefined,
        `Flesch was fabricated for Chinese: score ${readability.score} "${readability.level}"`);
      expect(readability.notApplicable === 'flesch-requires-syllable-based-language',
        `notApplicable was ${JSON.stringify(readability.notApplicable)}`);
      return `${stats.words} words / ${stats.sentences} sentences in both blocks`;
    }
  },
  {
    tool: 'extract_structured', tier: 'default', what: '1.3 the LLM answers from the article, not the page chrome',
    run: async () => {
      const r = await call('extract_structured', {
        url: CLOUDFLARE_POST,
        schema: { type: 'object', properties: { headline: { type: 'string' }, memory_saved: { type: 'string' } }, required: ['headline'] }
      });
      const headline = r.data?.headline;
      expect(headline !== 'Skip to content', 'headline is the skip link — page chrome reached the model again');
      expect(/terabytes/i.test(headline || ''), `headline was ${JSON.stringify(headline)}`);
      expect(r.data?.memory_saved != null && r.data.memory_saved !== '', `memory_saved was ${JSON.stringify(r.data?.memory_saved)}`);
      return `${JSON.stringify(headline).slice(0, 60)}…, memory_saved ${JSON.stringify(r.data.memory_saved)}`;
    }
  },
  {
    tool: 'extract_structured', tier: 'default', what: '1.3 control — IANA returns the full page title',
    run: async () => {
      const r = await call('extract_structured', {
        url: IANA_EXAMPLE,
        schema: { type: 'object', properties: { page_title: { type: 'string' } }, required: ['page_title'] }
      });
      expect(r.data?.page_title === 'Example Domains', `page_title was ${JSON.stringify(r.data?.page_title)}, not "Example Domains"`);
      return r.data.page_title;
    }
  },
  {
    tool: 'extract_with_llm', tier: 'default', what: '1.2 never {} with success:true',
    run: async () => {
      const r = await call('extract_with_llm', {
        url: PYTHON_HOME,
        prompt: 'What is the current stable version of Python and its one-line tagline?'
      }, 240000);
      state.pythonExtraction = r;
      const keys = Object.keys(r.data || {});
      expect(r.success === false || keys.length > 0,
        'returned an empty object with success:true — the empty-result guard is gone');
      return r.success === false ? `declined, naming ${r.model}` : `${keys.length} keys from ${r.model}`;
    }
  },
  {
    tool: 'extract_with_llm', tier: 'default', what: 'returns the current Python version',
    run: async () => {
      const r = state.pythonExtraction;
      if (!r) skip('the 1.2 check did not run');
      if (r.success === false) skip(`the model (${r.model}) returned no data this run — 1.2's guard fired, which is the designed behaviour`);
      // Ground truth read off python.org itself, so this does not go stale.
      const home = await call('fetch_url', { url: PYTHON_HOME });
      const expected = home.body.match(/Python (3\.\d+\.\d+)/)?.[1];
      if (!expected) skip('python.org no longer advertises a version string this check can read');
      expect(JSON.stringify(r.data).includes(expected), `expected ${expected} somewhere in ${JSON.stringify(r.data)}`);
      return `${expected} via ${r.model}`;
    }
  },
  {
    tool: 'list_ollama_models', tier: 'default', what: 'local models are listed',
    run: async () => {
      const r = await call('list_ollama_models', {});
      if (r.success === false) skip(`Ollama not reachable at ${r.baseUrl}`);
      expect(r.count > 0, 'Ollama is running but reports no installed models');
      return `${r.count} models`;
    }
  },
  {
    tool: 'batch_scrape', tier: 'default', what: 'sync batch of two URLs',
    run: async () => {
      const r = await call('batch_scrape', {
        urls: ['https://example.com', IANA_EXAMPLE],
        formats: ['markdown'],
        mode: 'sync'
      });
      expect(r.success === true, 'batch reported failure');
      expect(r.successfulUrls === 2, `${r.successfulUrls} of 2 URLs succeeded`);
      state.batchId = r.batchId;
      return `${r.successfulUrls}/2 in ${r.executionTime}ms`;
    }
  },
  {
    tool: 'get_batch_results', tier: 'default', what: 'paginated read-back of a batch',
    run: async () => {
      if (!state.batchId) skip('no batchId — the batch_scrape check did not produce one');
      const r = await call('get_batch_results', { batchId: state.batchId, page: 1, pageSize: 5 });
      expect(r.results.length >= 1, 'no results returned for a completed batch');
      return `${r.results.length} results`;
    }
  },
  {
    tool: 'track_changes', tier: 'default', what: '3.1 a text-only change is counted, not reported as zero',
    run: async () => {
      await call('track_changes', { url: UUID, operation: 'create_baseline' });
      const r = await call('track_changes', { url: UUID, operation: 'compare' });
      expect(r.hasChanges === true, 'httpbin.org/uuid returned the same UUID twice — nothing to diff');
      expect(r.summary.totalChanges > 0,
        `summary.totalChanges is ${r.summary.totalChanges} while details.textChanges holds ${r.details?.textChanges?.[0]?.changes?.length ?? 0} segments`);
      expect(typeof r.summary.textChanges === 'number',
        'summary.textChanges counter is missing beside added/removed/modified');
      return `hasChanges, totalChanges ${r.summary.totalChanges} (textChanges ${r.summary.textChanges})`;
    }
  },
  {
    tool: 'generate_llms_txt', tier: 'default', what: '6.2 the root and the key sections survive the page budget',
    run: async () => {
      const r = await call('generate_llms_txt', { url: MCP_SITE, analysisOptions: { maxPages: 15 } }, 300000);
      const txt = r.files?.['llms.txt'] || '';
      const urls = [...txt.matchAll(/\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
      expect(urls.length > 0, 'llms.txt lists no URLs');
      expect(urls.some((u) => u.replace(/\/$/, '') === MCP_SITE), `site root absent from ${urls.length} listed URLs`);
      expect(urls.some((u) => u.includes('/docs')), 'no docs entry');
      expect(urls.some((u) => u.includes('/specification')), 'no specification entry');
      return `${urls.length} URLs incl. root, docs and specification`;
    }
  },
  {
    tool: 'localization', tier: 'default', what: 'country emulation',
    run: async () => {
      const r = await call('localization', { operation: 'configure_country', countryCode: 'DE', language: 'de' });
      expect(r.timezone === 'Europe/Berlin', `timezone was ${r.timezone}`);
      expect(r.currency === 'EUR', `currency was ${r.currency}`);
      return `${r.countryCode}/${r.language} → ${r.timezone}`;
    }
  },
  {
    tool: 'scrape_template', tier: 'default', what: '6.3 github-repo returns the About text, not GitHub boilerplate',
    run: async () => {
      // Two repos with real About descriptions. anthropics/anthropic-sdk-python
      // is deliberately not used: api.github.com returns "description": null for
      // it, so its correct answer is null and it cannot pin this fix.
      const cases = [
        ['https://github.com/expressjs/express', 'Fast, unopinionated, minimalist web framework for node.'],
        ['https://github.com/facebook/react', 'The library for web and native user interfaces.']
      ];
      const seen = [];
      for (const [url, expected] of cases) {
        const r = await call('scrape_template', { template: 'github-repo', url });
        const description = r.data?.description;
        expect(!/Contribute to .+ development by creating an account on GitHub/.test(description || ''),
          `${url} returned GitHub's OG boilerplate: ${JSON.stringify(description)}`);
        expect(description === expected, `${url} returned ${JSON.stringify(description)}, expected ${JSON.stringify(expected)}`);
        seen.push(description);
      }
      return `${seen.length} repos returned their About text`;
    }
  },
  {
    tool: 'scrape_with_actions', tier: 'browser', what: 'browser action chain',
    run: async () => {
      const r = await call('scrape_with_actions', {
        url: 'https://example.com',
        actions: [{ type: 'wait', duration: 500 }],
        formats: ['markdown'],
        captureScreenshots: false
      }, 240000);
      expect(r.success !== false, `action chain failed: ${r.error}`);
      expect(r.successfulActions === 1, `${r.successfulActions} of ${r.totalActions} actions succeeded`);
      // The body copy, not the <h1>: the returned content is Readability's
      // article, which drops the heading on a page this small.
      const markdown = r.content?.markdown || '';
      expect(/documentation examples/.test(markdown), `page content missing from the result: ${JSON.stringify(r.content).slice(0, 200)}`);
      return `${r.successfulActions} action, ${markdown.length} chars of markdown`;
    }
  },
  {
    tool: 'stealth_mode', tier: 'browser', what: '6.4 fingerprint is internally coherent',
    run: async () => {
      const context = await call('stealth_mode', { operation: 'create_context', verbose: true }, 240000);
      try {
        const fp = context.fingerprint || {};
        const ua = fp.userAgent || '';
        const os = /Macintosh|Mac OS X/.test(ua) ? 'macos' : /X11|Linux/.test(ua) ? 'linux' : 'windows';
        const PLATFORM = { windows: 'Win32', macos: 'MacIntel', linux: 'Linux x86_64' };
        const SEC_CH = { windows: '"Windows"', macos: '"macOS"', linux: '"Linux"' };
        // Fonts and device labels each OS ships that the other two do not.
        const FONTS = {
          windows: ['Segoe UI', 'Calibri', 'Consolas'],
          macos: ['SF Pro Display', 'Helvetica Neue', 'Menlo'],
          linux: ['Ubuntu', 'DejaVu Sans', 'Liberation Sans']
        };
        const DEVICES = { windows: /Realtek|\(04f2:|\(046d:/, macos: /FaceTime|MacBook/, linux: /Built-in Audio Analog|Integrated Camera: |DisplayPort/ };

        expect(fp.hardware?.platform === PLATFORM[os],
          `UA says ${os} but navigator.platform is ${JSON.stringify(fp.hardware?.platform)}`);
        expect(fp.headers?.['sec-ch-ua-platform'] === SEC_CH[os],
          `UA says ${os} but sec-ch-ua-platform is ${fp.headers?.['sec-ch-ua-platform']}`);
        const labels = (fp.mediaDevices || []).map((d) => d.label).join(' | ');
        expect(DEVICES[os].test(labels), `UA says ${os} but mediaDevices read ${labels}`);
        const foreign = Object.entries(FONTS)
          .filter(([name]) => name !== os)
          .flatMap(([, fonts]) => fonts)
          .filter((f) => (fp.fonts || []).includes(f));
        expect(foreign.length === 0, `UA says ${os} but the font list ships ${foreign.join(', ')}`);

        const ip = fp.webRTC?.publicIP || '';
        expect(!/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip),
          `webRTC.publicIP is not routable: ${ip}`);
        return `${os} coherent across UA/platform/sec-ch-ua/devices/fonts, publicIP ${ip}`;
      } finally {
        await call('stealth_mode', { operation: 'cleanup' }).catch(() => {});
      }
    }
  },
  {
    tool: 'deep_research', tier: 'slow', what: '4.1-4.3 no front matter, 3+ source domains, real consensus',
    run: async () => {
      const r = await call('deep_research', { topic: RESEARCH_TOPIC }, 900000);
      const findings = r.findings || [];
      expect(findings.length > 0, 'no findings returned');
      // 4.1 — the top finding was an arXiv author/affiliation block starting "DOI: XXXXXXX".
      const frontMatter = findings
        .map((f) => f.finding || '')
        .filter((t) => /^\s*(DOI[:\s]|Retrieved from|CCS Concepts)/i.test(t) || /Checking your browser/i.test(t));
      expect(frontMatter.length === 0, `front-matter admitted as findings: ${JSON.stringify(frontMatter)}`);
      // 4.3 — all five findings once came from a single URL.
      const domains = new Set(findings.flatMap((f) => (f.sources || []).map(domainOf)).filter(Boolean));
      expect(domains.size >= 3, `only ${domains.size} distinct source domain(s): ${[...domains].join(', ')}`);
      // The shipped half of 4.4/4.5: semantic grouping made consensus reachable.
      // Conflict detection is on when a measured judgement model (gemma3:12b)
      // is installed, but a real run rarely holds a true contradiction, so
      // conflicts > 0 is not assertable; 4.4's criterion (c) is judged by the
      // three live runs recorded in TOOL_QUALITY_PLAN.md, not here.
      expect((r.consensus || []).length > 0, 'consensusAreas is 0 — claim grouping produced no cross-source group');
      // At least one corroborated finding, not all of them: generateKeyFindings
      // drains singleton groups once the corroborated ones are spent, so how
      // many findings clear supportingClaims > 1 depends on how many groups
      // merged that run. Measured 2026-08-28: 4 of 10 corroborated on a 10-
      // finding run. "None merged" is the regression; "not all merged" is not.
      const corroborated = findings.filter((f) => f.supportingClaims > 1).length;
      expect(corroborated > 0, `all ${findings.length} findings have supportingClaims 1 — semantic grouping merged nothing`);
      return `${findings.length} findings (${corroborated} corroborated) over ${domains.size} domains, ${r.consensus.length} consensus areas`;
    }
  },
  {
    tool: 'agent', tier: 'slow', what: 'autonomous run from a prompt',
    run: async () => {
      const r = await call('agent', { prompt: 'What is the current stable version of Python? Answer from python.org.', maxSteps: 3, maxUrls: 3 }, 600000);
      expect(r.success !== false, `agent run failed: ${r.reason || r.error}`);
      expect(r.answer != null && JSON.stringify(r.answer).length > 40, `agent returned no answer: ${JSON.stringify(r.answer)}`);
      return `${r.steps} steps, ${r.urls_fetched} URLs${r.degraded ? ' (degraded, no LLM)' : ''}`;
    }
  }
];

// ─── Runner ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const runAll = args.includes('--all');
const skipPaid = args.includes('--skip-paid');
const only = (args.find((a) => a.startsWith('--only=')) || '')
  .slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);

/** true to run, or a string explaining why this check is not selected. */
function selection(check) {
  if (only.length) return only.includes(check.tool) || `not in --only=${only.join(',')}`;
  if (check.tier === 'default') return true;
  if (!runAll) return `${check.tier} tier — pass --all or --only=${check.tool}`;
  if (check.tier === 'paid' && skipPaid) return 'paid tier excluded by --skip-paid';
  return true;
}

const results = [];
const record = (status, check, detail) => {
  results.push({ status, tool: check.tool, what: check.what, detail });
  console.error(`  ${status}  ${check.tool} — ${check.what}${detail ? `\n        ${detail}` : ''}`);
};

console.error('CrawlForge tool sweep — 28 tools over real MCP stdio, disk cache off.');
console.error(
  only.length ? `Running only: ${only.join(', ')}`
    : runAll ? `Running every tier${skipPaid ? ' except paid' : ''}.`
      : 'Running the default tier. Paid, slow and browser tiers are skipped — pass --all for those.'
);
console.error(
  'Cost: creator mode spends no CrawlForge credits. search_web spends Google API quota.' +
  (runAll && !skipPaid ? ' serp_rank bills DataForSEO ~US$0.002.' : '') +
  (runAll ? ' deep_research and agent take minutes; stealth_mode and scrape_with_actions launch Chromium.' : '')
);
console.error('');

await connect();

// Creator mode is what keeps this free; a degraded sweep must not run quietly.
const bannerSeen = await new Promise((done) => {
  const deadline = Date.now() + 3000;
  const poll = () => {
    if (serverLog.includes('Creator Mode Enabled')) return done(true);
    if (Date.now() > deadline) return done(false);
    setTimeout(poll, 100);
  };
  poll();
});
if (!bannerSeen) {
  console.error('✖ The server did not report creator mode. Set CRAWLFORGE_CREATOR_SECRET in .env');
  console.error('  and re-run — without it every call bills credits against a live API key.');
  await client.close();
  process.exit(1);
}
console.error('Creator mode verified on the spawned server.\n');

// The tool count has drifted before; pin it before asserting anything about the tools.
const listed = (await client.listTools()).tools.map((t) => t.name);
const countCheck = { tool: 'tools/list', what: 'the server registers exactly 28 tools' };
if (listed.length === 28) record('PASS', countCheck, '28 tools');
else record('FAIL', countCheck, `${listed.length} tools registered: ${listed.join(', ')}`);

// Nothing may be exercised by accident and nothing may go unexercised.
const covered = new Set(CHECKS.map((c) => c.tool));
const uncovered = listed.filter((t) => !covered.has(t));
const coverCheck = { tool: 'coverage', what: 'every registered tool has at least one check' };
if (uncovered.length === 0) record('PASS', coverCheck, `${covered.size} tools covered`);
else record('FAIL', coverCheck, `no check exercises: ${uncovered.join(', ')}`);

for (const check of CHECKS) {
  const select = selection(check);
  if (select !== true) { record('SKIP', check, select); continue; }
  console.error(`→ ${check.tool} — ${check.what}`);
  try {
    record('PASS', check, await check.run());
  } catch (error) {
    if (error instanceof Skipped) record('SKIP', check, error.message);
    else if (error instanceof Fail) record('FAIL', check, error.message);
    else if (looksTransient(error.message)) record('SKIP', check, `live target unavailable — ${error.message}`);
    else record('FAIL', check, error.message);
  }
}

await client.close();

// ─── Summary ──────────────────────────────────────────────────────────────────

const width = (key) => Math.max(...results.map((r) => r[key].length));
const toolWidth = width('tool');
const whatWidth = Math.min(width('what'), 64);

console.log('');
console.log(`${'TOOL'.padEnd(toolWidth)}  RESULT  CHECK`);
console.log('-'.repeat(toolWidth + 8 + whatWidth));
for (const r of results) {
  console.log(`${r.tool.padEnd(toolWidth)}  ${r.status.padEnd(6)}  ${r.what}`);
  if (r.detail) console.log(`${' '.repeat(toolWidth + 10)}${r.status === 'PASS' ? '' : '→ '}${r.detail}`);
}

const tally = (status) => results.filter((r) => r.status === status).length;
console.log('');
console.log(`${tally('PASS')} passed, ${tally('FAIL')} failed, ${tally('SKIP')} skipped.`);
process.exit(tally('FAIL') === 0 ? 0 : 1);

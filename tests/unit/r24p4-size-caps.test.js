/**
 * R24 Phase 4 — 4.3 size caps and 4.4 payload bloat.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test --test-force-exit tests/unit/r24p4-size-caps.test.js
 *
 * 4.3: extract_links, extract_metadata, search_web, scrape_template, map_site,
 * agent, generate_llms_txt and track_changes (list operations) returned any
 * size inline — a Shopify collection came back from scrape_template as
 * 124 KB. Each is now shaped through withAuth into a preview plus a
 * result_handle that read_result opens.
 *
 * 4.4: extract_content shipped its text three times plus the article HTML and
 * every srcset; search_web repeated a static capabilities block per query;
 * map_site listed each URL four times; scrape_with_actions repeated its
 * action results under attempts[] (tested in tools/advanced/scrapeWithActions).
 *
 * No network: tool handlers are stubbed, the store is a temp-dir ResultStore.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ResultStore, setResultStoreForTests } from '../../src/core/ResultStore.js';
import { readResultHandler } from '../../src/tools/result/readResult.js';
import { makeWithAuth } from '../../src/server/withAuth.js';
import { INLINE_THRESHOLD_TOOLS, readDottedPath, applyInlineThreshold } from '../../src/server/inlineThreshold.js';
import { OUTPUT_SCHEMAS } from '../../src/schemas/toolOutputSchemas.js';
import { MapSiteTool } from '../../src/tools/crawl/mapSite.js';
import { ExtractContentTool } from '../../src/tools/extract/extractContent.js';
import { SearchWebTool } from '../../src/tools/search/searchWeb.js';
import { ResultRanker } from '../../src/tools/search/ranking/ResultRanker.js';
import { ResultDeduplicator } from '../../src/tools/search/ranking/ResultDeduplicator.js';
import { SearchResultCache } from '../../src/tools/search/ranking/SearchResultCache.js';
import authManager from '../../src/core/AuthManager.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawlforge-r24p4-'));
const store = new ResultStore({ baseDir: dir });
before(() => setResultStoreForTests(store));
after(() => {
  setResultStoreForTests(null);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const withAuth = makeWithAuth({
  authManager: {
    isCreatorMode: () => false,
    getToolCost: (name, params) => authManager.getToolCost(name, params),
    projectCost: (name, params) => authManager.projectCost(name, params),
    checkCredits: async () => true,
    reportUsage: async () => {},
    creditCache: new Map([['key', 1_000_000]])
  },
  logger: { info() {}, warn() {}, error() {}, debug() {} }
});

/** Run `result` through withAuth as `tool` and return the parsed text sent. */
async function send(tool, result, params, { structured = false } = {}) {
  const handler = withAuth(tool, async () => ({
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    ...(structured ? { structuredContent: result } : {})
  }));
  const sent = await handler(params);
  return { body: JSON.parse(sent.content[0].text), sent };
}

async function readBack(params) {
  const out = await readResultHandler(params);
  assert.notEqual(out.isError, true, out.content[0].text);
  return JSON.parse(out.content[0].text);
}

const links = Array.from({ length: 400 }, (_, i) => ({ url: `https://shop.example/p/${i}`, text: `Product ${i}`, type: 'internal' }));

test('4.3 extract_links over the limit: counts inline, the list behind the handle', async () => {
  const result = { links, total_count: 400, internal_count: 400, external_count: 0, other_count: 0, base_url: 'https://shop.example/' };
  const { body } = await send('extract_links', result, { url: 'https://shop.example/', max_inline_chars: 2000 });
  assert.equal(body.truncated, true);
  assert.equal(body.total_count, 400);
  assert.equal('links' in body, false);
  const read = await readBack({ handle: body.result_handle, operation: 'json_path', path: 'links[399].url' });
  assert.equal(read.value, 'https://shop.example/p/399');
});

test('4.3 extract_metadata over the limit keeps the tag maps inline', async () => {
  const result = {
    title: 'Shop', description: 'A shop', keywords: ['a', 'b'], og_tags: { title: 'Shop' }, twitter_tags: {},
    json_ld: Array.from({ length: 200 }, (_, i) => ({ '@type': 'Product', name: `P${i}`, sku: `sku-${i}` })),
    microdata: [], url: 'https://shop.example/'
  };
  const { body } = await send('extract_metadata', result, { url: 'https://shop.example/', max_inline_chars: 2000 });
  assert.equal(body.truncated, true);
  assert.deepEqual(body.og_tags, { title: 'Shop' });
  assert.deepEqual(body.keywords, ['a', 'b']);
  assert.equal('json_ld' in body, false);
  const read = await readBack({ handle: body.result_handle, operation: 'json_path', path: 'json_ld[150].sku' });
  assert.equal(read.value, 'sku-150');
});

test('4.3 scrape_template: a large collection comes back as a preview + handle', async () => {
  const result = { template: 'shopify-collection', url: 'https://store.example/collections/all', count: 300, data: { products: Array.from({ length: 300 }, (_, i) => ({ title: `Shoe ${i}`, price: '95.00' })) } };
  const { body } = await send('scrape_template', result, { template: 'shopify-collection', max_inline_chars: 3000 });
  assert.equal(body.truncated, true);
  assert.equal(body.count, 300);
  assert.equal(body.view, 'json');
  const read = await readBack({ handle: body.result_handle, operation: 'search', query: 'Shoe 299' });
  assert.equal(read.total_matches, 1);
});

test('4.3 search_web: a batch over the limit is shaped, and the shaped result fits the output schema', async () => {
  const entry = (q) => ({ query: q, results: Array.from({ length: 10 }, (_, i) => ({ title: `${q} ${i}`, link: `https://${q}.example/${i}`, snippet: 's'.repeat(300) })) });
  const result = { queries: ['a', 'b', 'c'], count: 3, results_by_query: ['a', 'b', 'c'].map(entry) };
  const { body, sent } = await send('search_web', result, { queries: ['a', 'b', 'c'], max_inline_chars: 2000 }, { structured: true });
  assert.equal(body.truncated, true);
  assert.deepEqual(body.queries, ['a', 'b', 'c']);
  assert.equal(body.count, 3);
  const parsed = z.object(OUTPUT_SCHEMAS.search_web).strict().safeParse(sent.structuredContent);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  const read = await readBack({ handle: body.result_handle, operation: 'json_path', path: 'results_by_query[2].results[9].link' });
  assert.equal(read.value, 'https://c.example/9');
});

test('4.3 map_site: shaped with the counts inline, and the shaped result fits the output schema', async () => {
  const urls = Array.from({ length: 500 }, (_, i) => `https://docs.example/guide/${i % 2 ? 'b' : 'a'}/page-${i}`);
  const tool = new MapSiteTool({ cacheEnabled: false });
  const result = {
    base_url: 'https://docs.example', total_urls: urls.length, urls: tool.groupByPath(urls), metadata: {},
    site_map: tool.generateSiteMap(urls), statistics: tool.generateStatistics(urls), domain_filter_config: null, filter_stats: null
  };
  const { body, sent } = await send('map_site', result, { url: 'https://docs.example/', max_inline_chars: 3000 }, { structured: true });
  assert.equal(body.truncated, true);
  assert.equal(body.total_urls, 500);
  assert.deepEqual(body.site_map, { root: 0, sections: { guide: { count: 500, subsections: { a: 250, b: 250 } } }, depth_levels: { 3: 500 } });
  assert.equal(body.statistics.total_urls, 500);
  const parsed = z.object(OUTPUT_SCHEMAS.map_site).strict().safeParse(sent.structuredContent);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  const read = await readBack({ handle: body.result_handle, operation: 'json_path', path: 'urls./guide' });
  assert.equal(read.value.length, 500);
});

test('4.3 agent: a prose answer is the text view; the sources stay inline', async () => {
  const answer = 'The answer. '.repeat(500);
  const result = { success: true, answer, search_results: [{ url: 'https://a.example' }], evidence: [{ url: 'https://a.example' }], degraded: false, steps: 2, urls_fetched: 1, provenance: { checked: true, unverified: [] } };
  const { body } = await send('agent', result, { prompt: 'q', max_inline_chars: 2000 });
  assert.equal(body.truncated, true);
  assert.equal(body.view_path, 'answer');
  assert.equal(body.preview, answer.slice(0, 2000));
  assert.deepEqual(body.evidence, [{ url: 'https://a.example' }]);
  assert.deepEqual(body.provenance, { checked: true, unverified: [] });
  const read = await readBack({ handle: body.result_handle, operation: 'slice', offset: 5000, length: 12 });
  assert.equal(read.text, answer.slice(5000, 5012));
});

test('4.3 generate_llms_txt: llms-full.txt is the view, llms.txt and the object warnings stay inline', async () => {
  const full = '# Site\n\n' + 'Detailed section. '.repeat(1000);
  const short = '# Site\n\n> A site.\n';
  const warnings = [{ type: 'robots', message: '3 discovered URL(s) were left out because robots.txt disallows them for CrawlForge.' }];
  const result = { baseUrl: 'https://site.example', analysisStats: { pagesAnalyzed: 3 }, files: { 'llms.txt': short, 'llms-full.txt': full }, recommendations: [], complianceLevel: 'standard', warnings };
  const { body } = await send('generate_llms_txt', result, { url: 'https://site.example', max_inline_chars: 2000 });
  assert.equal(body.truncated, true);
  assert.equal(body.view_path, 'files.llms-full.txt');
  assert.equal(body.preview, full.slice(0, 2000));
  assert.deepEqual(body.files, { 'llms.txt': short });
  assert.deepEqual(body.analysisStats, { pagesAnalyzed: 3 });
  assert.deepEqual(body.warnings[0], warnings[0], 'a {type, message} warning is not dropped');
  assert.match(body.warnings.at(-1), /files\.llms\.txt kept inline/);
  const read = await readBack({ handle: body.result_handle, operation: 'search', query: 'Detailed section' });
  assert.equal(read.view_path, 'files.llms-full.txt');
  assert.equal(read.total_matches, 1000);
});

test('4.3 track_changes: list operations are shaped, a compare is not', async () => {
  const history = Array.from({ length: 300 }, (_, i) => ({ timestamp: i, changeType: 'moderate', summary: 'x'.repeat(50) }));
  const result = { success: true, operation: 'get_history', url: 'https://a.example', history, pagination: { total: 300, limit: 300, offset: 0, hasMore: false }, timespan: { earliest: 0, latest: 299, totalEntries: 300 } };
  const { body } = await send('track_changes', result, { url: 'https://a.example', operation: 'get_history', max_inline_chars: 2000 });
  assert.equal(body.truncated, true);
  assert.deepEqual(body.pagination, result.pagination);
  const read = await readBack({ handle: body.result_handle, operation: 'json_path', path: 'history[299].timestamp' });
  assert.equal(read.value, 299);

  const rule = INLINE_THRESHOLD_TOOLS.track_changes;
  for (const operation of ['get_history', 'export_history', 'list_scheduled_monitors', 'get_dashboard', 'generate_trend_report']) {
    assert.equal(rule.when({ operation }), true, operation);
  }
  for (const operation of ['create_baseline', 'compare', 'monitor', undefined]) {
    assert.equal(rule.when({ operation }), false, String(operation));
  }
});

test('4.3 track_changes export_history as csv: the csv is the text view', () => {
  const csv = 'timestamp,url\n' + Array.from({ length: 200 }, (_, i) => `${i},https://a.example/${i}`).join('\n');
  const out = applyInlineThreshold('track_changes', { success: true, operation: 'export_history', export: { format: 'csv', csv } },
    { operation: 'export_history', max_inline_chars: 1000 }, { store, env: {} });
  assert.equal(out.result.view_path, 'export.csv');
  assert.equal(out.result.preview, csv.slice(0, 1000));
});

test('readDottedPath reads a key that holds dots', () => {
  const obj = { files: { 'llms.txt': 'short', 'llms-full.txt': 'long' }, content: { markdown: '# md' } };
  assert.equal(readDottedPath(obj, 'files.llms.txt'), 'short');
  assert.equal(readDottedPath(obj, 'files.llms-full.txt'), 'long');
  assert.equal(readDottedPath(obj, 'content.markdown'), '# md');
  assert.equal(readDottedPath(obj, 'files.missing.txt'), undefined);
});

// ── 4.4 ─────────────────────────────────────────────────────────────────────

test('4.4 map_site: every URL appears once in the result', () => {
  const urls = ['https://caddyserver.com/docs/install', 'https://caddyserver.com/docs/quick-starts/static-files', 'https://caddyserver.com/'];
  const tool = new MapSiteTool({ cacheEnabled: false });
  const result = { urls: tool.groupByPath(urls), site_map: tool.generateSiteMap(urls), statistics: tool.generateStatistics(urls) };
  const json = JSON.stringify(result);
  for (const url of urls) assert.equal(json.split(JSON.stringify(url)).length - 1, 1, url);
  assert.deepEqual(result.site_map, {
    root: 1,
    sections: { docs: { count: 2, subsections: { 'quick-starts': 1, install: 1 } } },
    depth_levels: { 0: 1, 2: 1, 3: 1 }
  });
});

test('4.4 extract_content: the text once, no article HTML, no srcset', async () => {
  // Several paragraphs: Readability's excerpt is the first one, which is
  // metadata; the closing paragraph must appear once.
  const para = 'This is a long paragraph of article content that should be picked up by Readability as the main content of the page. '.repeat(3);
  const body = `<p>${para}</p>`.repeat(4) + '<p>The closing paragraph says something only once in the whole article body.</p>';
  const html = `<html><head><title>T</title></head><body><article><h1>T</h1>${body}` +
    '<img src="/a.jpg" alt="A" srcset="/a-1x.jpg 1x, /a-2x.jpg 2x, /a-3x.jpg 3x"></article></body></html>';
  const result = await new ExtractContentTool().execute({ url: 'https://example.com/a', html });
  assert.equal(result.extractionMethod, 'readability');
  assert.equal('content' in result.readability, false, 'no article HTML');
  assert.equal('textContent' in result.readability, false, 'no second copy of the text');
  assert.equal(typeof result.readability.length, 'number');
  assert.ok(result.content.text.includes('long paragraph'));
  assert.equal(JSON.stringify(result).split('says something only once').length - 1, 1, 'the text once');
  assert.deepEqual(result.images.map((img) => [img.src, img.alt, 'srcset' in img]), [['/a.jpg', 'A', false]]);

  const withHtml = await new ExtractContentTool().execute({ url: 'https://example.com/a', html, options: { includeCleanedHTML: true } });
  assert.match(withHtml.content.cleanedHTML, /<p>/, 'the article HTML is still there when asked for');
});

function searchTool() {
  const tool = Object.create(SearchWebTool.prototype);
  const sharedCache = new SearchResultCache({ ttl: 3600000, enabled: false });
  tool.resultRanker = new ResultRanker({ cacheEnabled: false, sharedCache });
  tool.resultDeduplicator = new ResultDeduplicator({ cacheEnabled: false, sharedCache });
  tool.cache = null;
  tool.isCreatorModeFallback = false;
  tool.searchAdapter = {
    async search() {
      return { items: [{ title: 't', link: 'https://a.example/', snippet: 's' }], searchInformation: { totalResults: '1', searchTime: 0.1 } };
    }
  };
  return tool;
}

test('4.4 search_web: no capabilities block, single or batch', async () => {
  const tool = searchTool();
  const single = await tool.execute({ query: 'a' });
  assert.deepEqual(single.provider, { name: 'crawlforge', backend: 'Google Search' });
  const batch = await tool.execute({ queries: ['a', 'b', 'c'] });
  assert.equal(JSON.stringify(batch).includes('capabilities'), false);
  assert.equal(batch.results_by_query.length, 3);
});

test('search_web errors carry no "Search failed: " of their own (server.js adds it once)', async () => {
  const tool = searchTool();
  tool.searchAdapter = { async search() { throw new Error('upstream 502'); } };
  await assert.rejects(() => tool.execute({ query: 'a' }), (error) => error.message === 'upstream 502');
});

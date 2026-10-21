/**
 * Live sweep 2026-10-20, Phase 6 items 6.3 and 6.8.
 *
 * Run: node --test --test-force-exit tests/unit/phase6Search.test.js
 *
 * 6.3 search_web next_offset is offset + the upstream results this page
 *     consumed (duplicates removed here included), on both paths. The SearXNG
 *     path used page * limit, which ignored the offset inside a page, dropped
 *     the rest of each SearXNG page, and read SearXNG page 2 for offset 5 even
 *     though SearXNG pages are sized by the instance, not by `limit`.
 * 6.8 serp_rank reported seResultsCount: 0 beside 28 organic results: Google's
 *     mobile SERP shows no "About N results" total and DataForSEO reports 0.
 *     That 0 is unknown, so it is omitted, never shown as zero.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { SearchWebTool } from '../../src/tools/search/searchWeb.js';
import { ResultRanker } from '../../src/tools/search/ranking/ResultRanker.js';
import { ResultDeduplicator } from '../../src/tools/search/ranking/ResultDeduplicator.js';
import { SearchResultCache } from '../../src/tools/search/ranking/SearchResultCache.js';
import { SerpRankTool } from '../../src/tools/search/serpRank.js';
import { DataForSEOSearchAdapter } from '../../src/tools/search/adapters/dataforseoSearch.js';

// ── 6.3 search_web ──────────────────────────────────────────────────────────

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india',
  'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango'];

// 20 distinct items; item 2 duplicates item 0 (scheme/www/slash only).
function stream() {
  const items = WORDS.map((w, i) => ({
    title: `${w} guide number ${i}`,
    url: `https://${w}.example/page-${i}`,
    content: `Everything about ${w} in one place, entry ${i}.`
  }));
  items[2] = { ...items[0], url: 'http://www.alpha.example/page-0/' };
  return items;
}

function buildTool() {
  const tool = Object.create(SearchWebTool.prototype);
  const sharedCache = new SearchResultCache({ ttl: 3600000, enabled: false });
  tool.resultRanker = new ResultRanker({ cacheEnabled: false, sharedCache });
  tool.resultDeduplicator = new ResultDeduplicator({ cacheEnabled: false, sharedCache });
  tool.cache = null;
  tool.isCreatorModeFallback = false;
  return tool;
}

/** A SearXNG stub serving `items` in pages of `pageSize`; records the pages asked for. */
async function searxng(items, pageSize) {
  const pages = [];
  const server = http.createServer((req, res) => {
    const page = Number(new URL(req.url, 'http://x').searchParams.get('pageno'));
    pages.push(page);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: items.slice((page - 1) * pageSize, page * pageSize) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  process.env.CRAWLFORGE_SEARXNG_URL = `http://127.0.0.1:${server.address().port}`;
  return { pages, close: () => server.close() };
}

afterEach(() => { delete process.env.CRAWLFORGE_SEARXNG_URL; });

test('6.3 SearXNG: next_offset counts the stream items consumed, including a removed duplicate', async () => {
  const stub = await searxng(stream(), 10);
  try {
    const tool = buildTool();
    const params = { query: 'guide', limit: 5, provider: 'searxng' };
    const page1 = await tool.execute({ ...params, offset: 0 });
    assert.equal(page1.results.length, 5);
    assert.equal(page1.processing.deduplication.duplicatesRemoved, 1);
    // Items 0..5 fed page 1 (item 2 was a duplicate), so page 2 starts at 6.
    assert.equal(page1.next_offset, 6);

    const page2 = await tool.execute({ ...params, offset: page1.next_offset });
    const seen = new Set(page1.results.map(r => r.link));
    for (const r of page2.results) assert.ok(!seen.has(r.link), `${r.link} is on both pages`);
    // Nothing is skipped either: page 2 starts at stream item 6.
    assert.equal(page2.results[0].link, 'https://golf.example/page-6');
    assert.equal(page2.next_offset, 11);
  } finally {
    stub.close();
  }
});

test('6.3 SearXNG: offset is an item offset across SearXNG pages, not a page index', async () => {
  const stub = await searxng(stream(), 10);
  try {
    const response = await buildTool().execute({
      query: 'guide', limit: 3, offset: 12, provider: 'searxng', enable_deduplication: false
    });
    // Items 12..14 live on SearXNG page 2 (10 per page); offset 12 / limit 3
    // used to read page 5, which is past the end.
    assert.deepEqual(response.results.map(r => r.link),
      ['https://mike.example/page-12', 'https://november.example/page-13', 'https://oscar.example/page-14']);
    assert.equal(response.next_offset, 15);
    assert.deepEqual(stub.pages, [1, 2]);
  } finally {
    stub.close();
  }
});

test('6.3 SearXNG: the stream ends at a page that adds no new URL', async () => {
  const stub = await searxng(stream().slice(0, 4), 10);
  try {
    const response = await buildTool().execute({
      query: 'guide', limit: 10, offset: 0, provider: 'searxng', enable_deduplication: false
    });
    assert.equal(response.results.length, 4);
    assert.equal(response.next_offset, 4);
    assert.deepEqual(stub.pages, [1, 2]);
  } finally {
    stub.close();
  }
});

test('6.3 crawlforge path: 5 results after dedup and next_offset 6 is offset + upstream consumed', async () => {
  const tool = buildTool();
  const items = stream().map(r => ({ title: r.title, link: r.url, snippet: r.content }));
  tool.searchAdapter = {
    async search(params) {
      const start = params.start - 1;
      return { items: items.slice(start, start + params.num), searchInformation: { totalResults: null } };
    }
  };
  const page = await tool.execute({ query: 'guide', limit: 5, offset: 0, expand_query: false });
  assert.equal(page.results.length, 5);
  assert.equal(page.next_offset, 6);
});

// ── 6.8 serp_rank ───────────────────────────────────────────────────────────

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function stubDataForSEO(seResultsCount, organicCount) {
  const items = Array.from({ length: organicCount }, (_, i) => ({
    type: 'organic', rank_group: i + 1, rank_absolute: i + 1,
    domain: `site${i}.co.uk`, url: `https://site${i}.co.uk/`, title: `hosting ${i}`, description: 'hosting'
  }));
  global.fetch = async () => ({
    ok: true, status: 200, statusText: 'OK',
    json: async () => ({
      status_code: 20000, cost: 0.002,
      tasks: [{ status_code: 20000, result: [{ keyword: 'hosting', se_results_count: seResultsCount, items }] }]
    })
  });
}

test('6.8 a 0 total beside organic results is unknown: null from the adapter, omitted by serp_rank', async () => {
  stubDataForSEO(0, 28);
  const { meta } = await new DataForSEOSearchAdapter('u', 'p').search({ keyword: 'hosting', device: 'mobile' });
  assert.equal(meta.organicCount, 28);
  assert.equal(meta.seResultsCount, null);

  const res = await new SerpRankTool({ login: 'u', password: 'p' }).execute({
    keyword: 'hosting', target: 'site3.co.uk', location_name: 'United Kingdom', device: 'mobile'
  });
  assert.equal(res.organicResults, 28);
  assert.equal(res.seResultsCount, undefined);
  assert.ok(!('seResultsCount' in JSON.parse(JSON.stringify(res))));
});

test('6.8 a reported total passes through, and 0 stays 0 when there are no organic results', async () => {
  stubDataForSEO(4560000, 28);
  let res = await new SerpRankTool({ login: 'u', password: 'p' }).execute({ keyword: 'hosting', target: 'x.com' });
  assert.equal(res.seResultsCount, 4560000);

  stubDataForSEO(0, 0);
  res = await new SerpRankTool({ login: 'u', password: 'p' }).execute({ keyword: 'hosting', target: 'x.com' });
  assert.equal(res.seResultsCount, 0);
});

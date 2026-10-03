/**
 * Live test R24 Phase 3, item 3.6 — search_web output quality.
 *
 * Run: node --test --test-force-exit tests/unit/r24p3-search-web.test.js
 *
 * - Pagination: deduplication backfills a page from the over-fetched margin,
 *   so the next page must start after the backfilled items (`next_offset`),
 *   not at offset + limit, or they appear on both pages.
 * - BM25 was 0 for every result: the classic IDF is negative for a term in
 *   more than half the results, and a search's results all contain its terms.
 * - The capabilities block said "2 credits per search"; the price is 5.
 * - Query expansion was computed and reported on every call but only ever
 *   used as a zero-result fallback; it is now computed and reported only then.
 *
 * The constructor is skipped (Object.create) so LocalizationManager does not
 * hold the event loop open, matching tests/unit/searchWebDedupBackfill.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { SearchWebTool, firstUnshownIndex } from '../../src/tools/search/searchWeb.js';
import { ResultRanker } from '../../src/tools/search/ranking/ResultRanker.js';
import { ResultDeduplicator } from '../../src/tools/search/ranking/ResultDeduplicator.js';
import { SearchResultCache } from '../../src/tools/search/ranking/SearchResultCache.js';
import { SearchProviderFactory } from '../../src/tools/search/adapters/searchProviderFactory.js';
import { SEARCH_WEB_CREDITS } from '../../src/tools/search/batchSearch.js';

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india',
  'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango'];

// 20 distinct provider items; item 2 duplicates item 0 (scheme/www/slash only).
function providerResults() {
  const items = WORDS.map((w, i) => ({
    title: `${w} guide number ${i}`,
    link: `https://${w}.example/page-${i}`,
    snippet: `Everything about ${w} in one place, entry ${i}.`
  }));
  items[2] = { ...items[0], link: 'http://www.alpha.example/page-0/' };
  return items;
}

function buildTool(page, { expander } = {}) {
  const requests = [];
  const tool = Object.create(SearchWebTool.prototype);
  const sharedCache = new SearchResultCache({ ttl: 3600000, enabled: false });
  tool.resultRanker = new ResultRanker({ cacheEnabled: false, sharedCache });
  tool.resultDeduplicator = new ResultDeduplicator({ cacheEnabled: false, sharedCache });
  tool.cache = null;
  tool.isCreatorModeFallback = false;
  tool.queryExpander = expander;
  tool.searchAdapter = {
    async search(params) {
      requests.push(params);
      const items = typeof page === 'function' ? page(params) : page;
      const start = (params.start || 1) - 1;
      return {
        items: items.slice(start, start + Math.min(params.num || 10, 10)),
        searchInformation: { totalResults: String(items.length), searchTime: 0.1 }
      };
    }
  };
  return { tool, requests };
}

test('3.6 paging with next_offset never repeats a URL across pages', async () => {
  const { tool } = buildTool(providerResults());
  const params = { query: 'guide', limit: 5, expand_query: false };

  const page1 = await tool.execute({ ...params, offset: 0 });
  assert.equal(page1.results.length, 5);
  assert.equal(page1.processing.deduplication.duplicatesRemoved, 1);
  // Provider items 0..5 fed page 1 (item 2 was a duplicate), so page 2 starts at 6.
  assert.equal(page1.next_offset, 6);

  const page2 = await tool.execute({ ...params, offset: page1.next_offset });
  const seen = new Set(page1.results.map(r => r.link));
  for (const r of page2.results) assert.ok(!seen.has(r.link), `${r.link} is on both pages`);
  assert.equal(page2.next_offset, 11);
});

test('3.6 next_offset is offset + limit when nothing was deduplicated', async () => {
  const { tool } = buildTool(providerResults().filter((_, i) => i !== 2));
  const page = await tool.execute({ query: 'guide', limit: 5, offset: 3, expand_query: false });
  assert.equal(page.next_offset, 8);
});

test('3.6 the SearXNG path reports next_offset at the next page boundary', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      results: providerResults().map(item => ({ title: item.title, url: item.link, content: item.snippet }))
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  process.env.CRAWLFORGE_SEARXNG_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const { tool } = buildTool([]);
    const response = await tool.execute({ query: 'guide', limit: 5, offset: 3, provider: 'searxng' });
    assert.equal(response.next_offset, 5); // offset 3 reads page 1; page 2 starts at 5
  } finally {
    delete process.env.CRAWLFORGE_SEARXNG_URL;
    server.close();
  }
});

test('3.6 firstUnshownIndex: end of the provider page, and the no-dedup path', () => {
  assert.equal(firstUnshownIndex([{}, {}], 5, 2), 2);
  assert.equal(firstUnshownIndex([{}, {}, {}, {}], 2, 4), 2);
  assert.equal(firstUnshownIndex([{ originalIndex: 0 }, { originalIndex: 1 }, { originalIndex: 4 }, { originalIndex: 3 }], 2, 5), 3);
});

test('3.6 BM25 is non-zero when every result contains the query terms', async () => {
  const ranker = new ResultRanker({ cacheEnabled: false });
  const results = ['one', 'two', 'three', 'four'].map((w, i) => ({
    title: `python web scraping tutorial ${w}`,
    link: `https://site${i}.example/${w}`,
    snippet: i === 0 ? 'python python scraping' : `a ${w} page`
  }));
  const ranked = await ranker.rankResults(results, 'python scraping', {});
  for (const r of ranked) assert.ok(r.scores.bm25 > 0, `bm25 was ${r.scores.bm25}`);
  // Higher term frequency still scores higher.
  const top = ranked.find(r => r.link.includes('site0'));
  const other = ranked.find(r => r.link.includes('site1'));
  assert.ok(top.scores.bm25 > other.scores.bm25);
});

test('3.6 the capabilities block states the real price', () => {
  assert.equal(SEARCH_WEB_CREDITS, 5);
  assert.equal(SearchProviderFactory.getProviderCapabilities('crawlforge').creditCost, '5 credits per search');
});

function spyExpander() {
  const calls = [];
  return {
    calls,
    async expandQuery(query) {
      calls.push(query);
      return [query, `${query} synonym`, `${query} other`];
    }
  };
}

test('3.6 expansion is not computed or reported when the original query finds results', async () => {
  const expander = spyExpander();
  const { tool, requests } = buildTool(providerResults(), { expander });
  const response = await tool.execute({ query: 'guide', limit: 5 });

  assert.equal(expander.calls.length, 0);
  assert.equal(requests.length, 1);
  assert.equal(response.expanded_queries, undefined);
  assert.equal(response.effective_query, undefined);
  assert.equal(response.processing.query_expansion, null);
});

test('3.6 a zero-result query is retried once with its expanded form, and says so', async () => {
  const expander = spyExpander();
  const page = params => (params.query === 'guide' ? [] : providerResults());
  const { tool, requests } = buildTool(page, { expander });
  const response = await tool.execute({ query: 'guide', limit: 5 });

  assert.equal(expander.calls.length, 1);
  assert.deepEqual(requests.map(r => r.query), ['guide', 'guide synonym']);
  assert.deepEqual(response.expanded_queries, ['guide', 'guide synonym']);
  assert.equal(response.effective_query, 'guide synonym');
  assert.deepEqual(response.processing.query_expansion, {
    original_query: 'guide',
    used_query: 'guide synonym',
    search_attempts: 2
  });
  assert.equal(response.results.length, 5);
});

test('3.6 a failed original search still falls back to the expanded form', async () => {
  const expander = spyExpander();
  const page = params => {
    if (params.query === 'guide') throw new Error('backend down');
    return providerResults();
  };
  const { tool, requests } = buildTool(page, { expander });
  const response = await tool.execute({ query: 'guide', limit: 5 });
  assert.equal(requests.length, 2);
  assert.equal(response.effective_query, 'guide synonym');
});

/**
 * Regression tests for search_web backfilling after deduplication.
 *
 * Run: node --test tests/unit/searchWebDedupBackfill.test.js
 *
 * The tool used to ask the provider for exactly `limit` items, so a result
 * page containing duplicates came back short — the reported symptom was
 * `limit: 6` returning 4 results with 2 removed as duplicates. It now
 * over-fetches a margin and trims back to `limit` after deduplication.
 *
 * The constructor is skipped (Object.create) so LocalizationManager does not
 * hold the event loop open, matching tests/unit/searchWebSearxng.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { SearchWebTool } from '../../src/tools/search/searchWeb.js';
import { ResultRanker } from '../../src/tools/search/ranking/ResultRanker.js';
import { ResultDeduplicator } from '../../src/tools/search/ranking/ResultDeduplicator.js';
import { SearchResultCache } from '../../src/tools/search/ranking/SearchResultCache.js';

// ---------------------------------------------------------------------------
// Canned provider page: 10 items, 2 of which duplicate an earlier entry.
// Both duplicates sit inside the first 6 so a `limit: 6` request that does not
// over-fetch can only return 4.
// ---------------------------------------------------------------------------

const PROVIDER_PAGE = [
  {
    title: 'Alpha: getting started',
    link: 'https://alpha-docs.example/getting-started',
    snippet: 'Install and configure Alpha from scratch in a few minutes.'
  },
  {
    title: 'Beta release notes 2026',
    link: 'https://beta.example.net/releases/2026',
    snippet: 'Everything that changed in the Beta 2026 release train.'
  },
  {
    // Duplicate of index 0 — differs only by scheme, www and trailing slash
    title: 'Alpha: getting started',
    link: 'http://www.alpha-docs.example/getting-started/',
    snippet: 'Install and configure Alpha from scratch in a few minutes.'
  },
  {
    title: 'Gamma throughput benchmarks',
    link: 'https://gamma.example.org/benchmarks',
    snippet: 'Latency and throughput measurements for the Gamma runtime.'
  },
  {
    // Exact duplicate of index 1
    title: 'Beta release notes 2026',
    link: 'https://beta.example.net/releases/2026',
    snippet: 'Everything that changed in the Beta 2026 release train.'
  },
  {
    title: 'Delta migration guide',
    link: 'https://delta.example.com/docs/migration',
    snippet: 'Moving an existing deployment onto Delta without downtime.'
  },
  {
    title: 'Epsilon security advisory',
    link: 'https://security.example.io/advisories/epsilon',
    snippet: 'Advisory covering the Epsilon authentication weakness.'
  },
  {
    title: 'Zeta pricing explained',
    link: 'https://zeta.example.co/pricing',
    snippet: 'How Zeta bills per seat and what the included quota covers.'
  },
  {
    title: 'Eta community forum thread',
    link: 'https://forum.example.dev/t/eta-questions/119',
    snippet: 'Long running discussion thread about Eta configuration.'
  },
  {
    title: 'Theta changelog archive',
    link: 'https://theta.example.systems/changelog/archive',
    snippet: 'Historical changelog entries for every Theta version.'
  }
];

const UNIQUE_LINKS_IN_ORDER = [
  PROVIDER_PAGE[0].link,
  PROVIDER_PAGE[1].link,
  PROVIDER_PAGE[3].link,
  PROVIDER_PAGE[5].link,
  PROVIDER_PAGE[6].link,
  PROVIDER_PAGE[7].link,
  PROVIDER_PAGE[8].link,
  PROVIDER_PAGE[9].link
];

/**
 * Build a SearchWebTool with a stub adapter that behaves like Google's API:
 * one page per request, at most 10 items, 1-based `start`.
 */
function buildTool(page = PROVIDER_PAGE) {
  const requests = [];
  const tool = Object.create(SearchWebTool.prototype);
  const sharedCache = new SearchResultCache({ ttl: 3600000, enabled: false });

  tool.resultRanker = new ResultRanker({ cacheEnabled: false, sharedCache });
  tool.resultDeduplicator = new ResultDeduplicator({ cacheEnabled: false, sharedCache });
  tool.cache = null;
  tool.isCreatorModeFallback = false;
  tool.searchAdapter = {
    async search(params) {
      requests.push(params);
      const start = (params.start || 1) - 1;
      const num = Math.min(params.num || 10, 10); // Google's per-request cap
      return {
        items: page.slice(start, start + num),
        searchInformation: { totalResults: String(page.length), searchTime: 0.12 }
      };
    }
  };

  return { tool, requests };
}

function baseParams(overrides = {}) {
  return {
    query: 'alpha beta gamma',
    limit: 6,
    expand_query: false,
    ...overrides
  };
}

test('limit: 6 returns 6 results when the provider page contains duplicates', async () => {
  const { tool, requests } = buildTool();

  const response = await tool.execute(baseParams());

  assert.equal(response.results.length, 6);
  assert.equal(response.limit, 6);

  const links = response.results.map(r => r.link).sort();
  assert.deepEqual(links, UNIQUE_LINKS_IN_ORDER.slice(0, 6).sort());

  // Exactly one backend search, over-fetched beyond `limit`
  assert.equal(requests.length, 1);
  assert.ok(requests[0].num > 6, `expected over-fetch, got num=${requests[0].num}`);

  // Deduplication still reports what it actually removed from the fetched page
  assert.equal(response.processing.deduplication.duplicatesRemoved, 2);
});

test('the over-fetched margin never leaks into the results', async () => {
  const withoutDuplicates = PROVIDER_PAGE.filter((_, i) => i !== 2 && i !== 4);
  const { tool } = buildTool(withoutDuplicates);

  const response = await tool.execute(baseParams());

  assert.equal(response.results.length, 6);
  assert.deepEqual(
    response.results.map(r => r.link).sort(),
    withoutDuplicates.slice(0, 6).map(r => r.link).sort()
  );
});

test('trimming applies when deduplication is disabled', async () => {
  const { tool } = buildTool();

  const response = await tool.execute(baseParams({ enable_deduplication: false }));

  assert.equal(response.results.length, 6);
  assert.equal(response.processing.deduplication, null);
});

test('a limit the provider cannot fill returns the unique results, unpadded', async () => {
  const { tool, requests } = buildTool();

  const response = await tool.execute(baseParams({ limit: 20 }));

  // 10 items on the page, 2 of them duplicates — no padding, no extra search
  assert.equal(response.results.length, 8);
  assert.equal(requests.length, 1);
  assert.deepEqual(response.results.map(r => r.link).sort(), UNIQUE_LINKS_IN_ORDER.slice().sort());
});

test('the SearXNG provider path also returns `limit` results after dedup', async () => {
  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, 'http://localhost');
    if (parsed.pathname !== '/search') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      results: PROVIDER_PAGE.map(item => ({
        title: item.title,
        url: item.link,
        content: item.snippet
      }))
    }));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  process.env.CRAWLFORGE_SEARXNG_URL = `http://127.0.0.1:${server.address().port}`;

  try {
    const { tool } = buildTool();
    const response = await tool.execute(baseParams({ provider: 'searxng' }));

    assert.equal(response.results.length, 6);
    assert.equal(response.provider.name, 'searxng');
  } finally {
    delete process.env.CRAWLFORGE_SEARXNG_URL;
    server.close();
  }
});

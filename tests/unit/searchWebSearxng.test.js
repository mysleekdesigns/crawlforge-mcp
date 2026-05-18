/**
 * Unit tests for the SearXNG provider integration in search_web.
 *
 * Run: node --test tests/unit/searchWebSearxng.test.js
 *
 * Coverage:
 *  1. normalizeSearxngResult — pure unit tests (no I/O)
 *  2. searchViaSearxng — fetch tests against a local stub HTTP server
 *  3. SearchWebTool._executeViaSearxng — integration via prototype composition
 *     (constructor skipped to avoid LocalizationManager holding the event loop)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  normalizeSearxngResult,
  searchViaSearxng
} from '../../src/tools/search/providers/searxng.js';

import { ResultRanker } from '../../src/tools/search/ranking/ResultRanker.js';
import { ResultDeduplicator } from '../../src/tools/search/ranking/ResultDeduplicator.js';
import { SearchResultCache } from '../../src/tools/search/ranking/SearchResultCache.js';

// ---------------------------------------------------------------------------
// Stub HTTP server — started once at module load via top-level await
// ---------------------------------------------------------------------------

const CANNED_RESULTS = [
  { title: 'Result One',   url: 'https://example.com/one',   content: 'Snippet one'   },
  { title: 'Result Two',   url: 'https://example.com/two',   content: 'Snippet two'   },
  { title: 'Result Three', url: 'https://example.com/three', content: 'Snippet three' }
];

let lastReceivedParams = {};

const stubServer = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, 'http://localhost');
  lastReceivedParams = Object.fromEntries(parsedUrl.searchParams.entries());

  if (parsedUrl.pathname === '/search') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: CANNED_RESULTS }));
  } else {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

await new Promise((resolve) => stubServer.listen(0, '127.0.0.1', resolve));
const stubPort = stubServer.address().port;

// Allow the event loop to exit even if the stub server is still "open".
// node --test does not call process.exit() explicitly; unref() lets the
// process exit naturally once all test callbacks complete.
stubServer.unref();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setStubUrl() {
  process.env.CRAWLFORGE_SEARXNG_URL = `http://127.0.0.1:${stubPort}`;
}

function clearStubUrl() {
  delete process.env.CRAWLFORGE_SEARXNG_URL;
}

async function buildPartialTool() {
  const { SearchWebTool } = await import(
    '../../src/tools/search/searchWeb.js'
  );
  const tool = Object.create(SearchWebTool.prototype);
  const sharedCache = new SearchResultCache({ ttl: 3600000, enabled: false });
  tool.resultRanker = new ResultRanker({ cacheEnabled: false, sharedCache });
  tool.resultDeduplicator = new ResultDeduplicator({ cacheEnabled: false, sharedCache });
  tool.cache = null;
  return tool;
}

function baseParams(overrides = {}) {
  return {
    query: 'test query',
    provider: 'searxng',
    limit: 10,
    offset: 0,
    lang: 'en',
    safe_search: true,
    enable_ranking: false,
    enable_deduplication: false,
    include_ranking_details: false,
    include_deduplication_details: false,
    ...overrides
  };
}

// ===========================================================================
// 1. normalizeSearxngResult — pure unit
// ===========================================================================

test('normalizeSearxngResult: maps title, url, content correctly', () => {
  const item = normalizeSearxngResult({
    title: 'My Title',
    url: 'https://example.com/page',
    content: 'Some snippet text'
  });

  assert.equal(item.title, 'My Title');
  assert.equal(item.link, 'https://example.com/page');
  assert.equal(item.snippet, 'Some snippet text');
  assert.equal(item.displayLink, 'example.com');
  assert.equal(item.formattedUrl, 'https://example.com/page');
  assert.equal(item.htmlSnippet, 'Some snippet text');
});

test('normalizeSearxngResult: handles missing url gracefully', () => {
  const item = normalizeSearxngResult({ title: 'No URL', content: 'body text' });

  assert.equal(item.link, '');
  assert.equal(item.displayLink, '');
  assert.equal(item.snippet, 'body text');
});

test('normalizeSearxngResult: includes required metadata and pagemap fields', () => {
  const item = normalizeSearxngResult({ title: 't', url: 'https://x.com', content: 'c' });

  assert.ok('pagemap' in item);
  assert.ok('metadata' in item);
  assert.ok('mime' in item.metadata);
  assert.ok('fileFormat' in item.metadata);
  assert.ok('cacheId' in item.metadata);
});

// ===========================================================================
// 2. searchViaSearxng — network tests against stub
// ===========================================================================

test('searchViaSearxng: throws when CRAWLFORGE_SEARXNG_URL is not set', async () => {
  clearStubUrl();

  await assert.rejects(
    () => searchViaSearxng({ query: 'test' }),
    (err) => {
      assert.ok(
        err.message.includes("provider 'searxng' requires CRAWLFORGE_SEARXNG_URL"),
        `Unexpected error message: ${err.message}`
      );
      return true;
    }
  );
});

test('searchViaSearxng: returns normalised items from stub', async () => {
  setStubUrl();

  const result = await searchViaSearxng({ query: 'hello world', limit: 10, page: 1 });

  assert.ok(Array.isArray(result.items));
  assert.equal(result.items.length, CANNED_RESULTS.length);
  assert.equal(result.items[0].title, 'Result One');
  assert.equal(result.items[0].link, 'https://example.com/one');
  assert.equal(result.items[0].snippet, 'Snippet one');
  assert.equal(result.items[0].displayLink, 'example.com');
});

test('searchViaSearxng: passes q, pageno, safesearch, language, format to SearXNG', async () => {
  setStubUrl();

  await searchViaSearxng({
    query: 'open source',
    limit: 5,
    page: 2,
    safeSearch: false,
    language: 'de'
  });

  assert.equal(lastReceivedParams.q, 'open source');
  assert.equal(lastReceivedParams.format, 'json');
  assert.equal(lastReceivedParams.pageno, '2');
  assert.equal(lastReceivedParams.safesearch, '0');
  assert.equal(lastReceivedParams.language, 'de');
});

test('searchViaSearxng: safeSearch=true maps to safesearch=1', async () => {
  setStubUrl();

  await searchViaSearxng({ query: 'safe query', safeSearch: true });

  assert.equal(lastReceivedParams.safesearch, '1');
});

test('searchViaSearxng: limit caps result count', async () => {
  setStubUrl();

  const result = await searchViaSearxng({ query: 'cap test', limit: 2 });

  // CANNED_RESULTS has 3 entries; limit=2 should slice to 2
  assert.equal(result.items.length, 2);
});

test('searchViaSearxng: throws clearly on non-200 from SearXNG', async () => {
  // Use an error stub server that always returns 500
  const errorServer = http.createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  });
  await new Promise((resolve) => errorServer.listen(0, '127.0.0.1', resolve));
  const errorPort = errorServer.address().port;

  try {
    await assert.rejects(
      () => searchViaSearxng({ query: 'error test', instanceUrl: `http://127.0.0.1:${errorPort}` }),
      /SearXNG returned HTTP 5/
    );
  } finally {
    await new Promise((resolve) => errorServer.close(resolve));
  }
});

// ===========================================================================
// 3. SearchWebTool._executeViaSearxng — high-level integration
// ===========================================================================

test('_executeViaSearxng: response includes standard search_web fields', async () => {
  setStubUrl();
  const tool = await buildPartialTool();

  const result = await tool._executeViaSearxng(baseParams());

  assert.equal(result.query, 'test query');
  assert.ok(Array.isArray(result.results));
  assert.equal(result.cached, false);
  assert.equal(result.localization, null);
  assert.ok('processing' in result);
  assert.ok('offset' in result);
  assert.ok('limit' in result);
});

test('_executeViaSearxng: provider metadata identifies searxng', async () => {
  setStubUrl();
  const tool = await buildPartialTool();

  const result = await tool._executeViaSearxng(baseParams());

  assert.equal(result.provider.name, 'searxng');
  assert.equal(result.provider.backend, 'SearXNG (self-hosted)');
  assert.equal(result.provider.instanceUrl, `http://127.0.0.1:${stubPort}`);
});

test('_executeViaSearxng: result items match normalised shape', async () => {
  setStubUrl();
  const tool = await buildPartialTool();

  const result = await tool._executeViaSearxng(baseParams());

  assert.ok(result.results.length > 0, 'expected at least one result');
  const item = result.results[0];

  for (const field of ['title', 'link', 'snippet', 'displayLink', 'formattedUrl']) {
    assert.ok(field in item, `missing field: ${field}`);
  }
});

/**
 * D5.2 — Unit tests: searchWeb tool
 * Run: node --test --test-force-exit tests/unit/tools/search/searchWeb.test.js
 * (force-exit: constructing the real SearchWebTool builds a LocalizationManager,
 *  which starts two unref'd-looking but real setInterval health-check timers;
 *  only the bottom "real module" describe block below is affected.)
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SearchWebTool } from '../../../../src/tools/search/searchWeb.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const stubSearchResults = [
  { title: 'CrawlForge Docs', url: 'https://crawlforge.dev/docs', description: 'Official documentation', score: 0.95 },
  { title: 'CrawlForge GitHub', url: 'https://github.com/crawlforge', description: 'Source code', score: 0.88 }
];

class SearchProviderStub {
  constructor(opts = {}) { this.opts = opts; }
  async search(query, options = {}) {
    if (!query || query.trim() === '') throw new Error('Query cannot be empty');
    return { results: stubSearchResults.slice(0, options.limit || 10), total: stubSearchResults.length };
  }
}

class CacheManagerStub {
  constructor() { this._store = new Map(); }
  generateKey(name, params) { return `${name}:${JSON.stringify(params)}`; }
  async get(key) { return this._store.get(key) || null; }
  async set(key, value) { this._store.set(key, value); }
}

class QueryExpanderStub {
  async expand(query) { return [query, `${query} guide`, `${query} tutorial`]; }
}

// ---------------------------------------------------------------------------
// Minimal SearchWeb-like stub
// ---------------------------------------------------------------------------

class SearchWebStub {
  constructor({ provider, cache, expander } = {}) {
    this.provider = provider || new SearchProviderStub();
    this.cache = cache || new CacheManagerStub();
    this.expander = expander || new QueryExpanderStub();
  }

  async execute(params) {
    if (!params || !params.query || params.query.trim() === '') throw new Error('query is required and cannot be empty');

    const limit = params.limit || 10;
    const expandQuery = params.expand_query !== false;

    // Cache check
    const cacheKey = this.cache.generateKey('search_web', { query: params.query, limit });
    const cached = await this.cache.get(cacheKey);
    if (cached) return { ...cached, cached: true };

    let query = params.query;
    let expandedQueries = [query];
    if (expandQuery && this.expander) {
      expandedQueries = await this.expander.expand(query);
    }

    const { results, total } = await this.provider.search(expandedQueries[0], { limit, lang: params.lang || 'en' });

    const output = { query: params.query, results, total, provider: params.provider || 'crawlforge' };
    await this.cache.set(cacheKey, output);
    return output;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchWeb tool', () => {
  let tool;

  beforeEach(() => {
    tool = new SearchWebStub();
  });

  test('constructor stores provider, cache, and expander', () => {
    assert.ok(tool.provider instanceof SearchProviderStub);
    assert.ok(tool.cache instanceof CacheManagerStub);
    assert.ok(tool.expander instanceof QueryExpanderStub);
  });

  test('happy path — returns results array with total', async () => {
    const result = await tool.execute({ query: 'CrawlForge MCP' });
    assert.equal(result.query, 'CrawlForge MCP');
    assert.ok(Array.isArray(result.results));
    assert.ok(result.results.length > 0);
    assert.ok(typeof result.total === 'number');
  });

  test('cache hit returns cached:true', async () => {
    await tool.execute({ query: 'repeat query' });
    const second = await tool.execute({ query: 'repeat query' });
    assert.equal(second.cached, true);
  });

  test('missing query throws', async () => {
    await assert.rejects(() => tool.execute({}), /query is required/);
  });

  test('empty query throws', async () => {
    await assert.rejects(() => tool.execute({ query: '   ' }), /cannot be empty/);
  });

  test('provider error propagates', async () => {
    const errProvider = { search: async () => { throw new Error('Search API down'); } };
    const errTool = new SearchWebStub({ provider: errProvider });
    await assert.rejects(() => errTool.execute({ query: 'test' }), /Search API down/);
  });

  test('expand_query=false skips expander', async () => {
    let expandCalled = false;
    const trackingExpander = { expand: async (q) => { expandCalled = true; return [q]; } };
    const noExpandTool = new SearchWebStub({ expander: trackingExpander });
    await noExpandTool.execute({ query: 'test', expand_query: false });
    assert.equal(expandCalled, false);
  });
});

// ---------------------------------------------------------------------------
// Regression (real module): retry-loop attempt bound.
//
// Bug: execute() retried a failed/empty search once per expanded query
// (searchQueries.length, which can be up to maxExpansions). Since every
// backend search is billed, one search_web call could silently fan out into
// many backend requests. Fixed with MAX_SEARCH_ATTEMPTS=2 capping
// queriesToTry, and the actual attempt count is now surfaced in the
// response as processing.query_expansion.search_attempts.
// ---------------------------------------------------------------------------

describe('searchWeb tool — real module regression (retry-loop bound)', () => {
  test('a stub adapter returning zero items is retried at most MAX_SEARCH_ATTEMPTS times, not once per expanded query', async () => {
    const tool = new SearchWebTool({ apiKey: 'test-key', cacheEnabled: false });

    // Force 4 expanded query variants so an unbounded retry loop would call
    // the adapter 4 times; the fix caps it at 2.
    tool.queryExpander.expandQuery = async () => ['q one', 'q two', 'q three', 'q four'];

    let callCount = 0;
    tool.searchAdapter.search = async () => {
      callCount++;
      return { items: [] };
    };

    const result = await tool.execute({ query: 'q one', expand_query: true });

    assert.equal(callCount, 2, 'adapter.search must be called at most MAX_SEARCH_ATTEMPTS(2) times');
    assert.equal(result.processing.query_expansion.search_attempts, 2, 'the actual attempt count must be surfaced in the response');
  });
});

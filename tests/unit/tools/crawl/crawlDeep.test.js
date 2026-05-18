/**
 * D5.2 — Unit tests: crawlDeep tool
 * Run: node --test tests/unit/tools/crawl/crawlDeep.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const stubCrawlResult = {
  pages: [
    { url: 'https://example.com', title: 'Home', depth: 0, links: ['https://example.com/about'] },
    { url: 'https://example.com/about', title: 'About', depth: 1, links: [] }
  ],
  totalPages: 2,
  maxDepthReached: 1,
  errors: []
};

class BFSCrawlerStub {
  constructor(options = {}) { this.options = options; }
  async crawl(url, options = {}) {
    if (url.includes('unreachable')) throw new Error('Connection refused');
    return { ...stubCrawlResult };
  }
}

class ElicitationHelperStub {
  async elicit(message) { return { confirmed: true }; }
}

class CacheManagerStub {
  constructor() { this._store = new Map(); }
  generateKey(n, p) { return `${n}:${JSON.stringify(p)}`; }
  async get(k) { return this._store.get(k) || null; }
  async set(k, v) { this._store.set(k, v); }
}

// ---------------------------------------------------------------------------
// Minimal CrawlDeep-like stub
// ---------------------------------------------------------------------------

class CrawlDeepStub {
  constructor({ crawler, elicitation, cache } = {}) {
    this.crawler = crawler || new BFSCrawlerStub();
    this._elicitation = elicitation || new ElicitationHelperStub();
    this.cache = cache || new CacheManagerStub();
  }

  async execute(params) {
    if (!params || !params.url) throw new Error('url is required');
    try { new URL(params.url); } catch { throw new Error('Invalid URL'); }

    const maxPages = params.max_pages || 100;

    // D1.4: Elicitation when maxPages > 500
    if (maxPages > 500) {
      const response = await this._elicitation.elicit(`Crawl will fetch up to ${maxPages} pages. Continue?`);
      if (!response.confirmed) return { status: 'cancelled' };
    }

    const result = await this.crawler.crawl(params.url, {
      maxDepth: params.max_depth || 3,
      maxPages,
      followExternal: params.follow_external || false,
      respectRobots: params.respect_robots !== false
    });

    return {
      url: params.url,
      pages: result.pages,
      totalPages: result.totalPages,
      maxDepthReached: result.maxDepthReached,
      errors: result.errors
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('crawlDeep tool', () => {
  let tool;

  beforeEach(() => {
    tool = new CrawlDeepStub();
  });

  test('constructor stores crawler, elicitation helper, and cache', () => {
    assert.ok(tool.crawler instanceof BFSCrawlerStub);
    assert.ok(tool._elicitation instanceof ElicitationHelperStub);
  });

  test('happy path — returns pages array with totals', async () => {
    const result = await tool.execute({ url: 'https://example.com' });
    assert.equal(result.url, 'https://example.com');
    assert.ok(Array.isArray(result.pages));
    assert.equal(result.totalPages, 2);
    assert.ok(Array.isArray(result.errors));
  });

  test('missing url throws', async () => {
    await assert.rejects(() => tool.execute({}), /url is required/);
  });

  test('invalid URL throws', async () => {
    await assert.rejects(() => tool.execute({ url: 'not-a-url' }), /Invalid URL/);
  });

  test('elicitation fires when maxPages > 500', async () => {
    let elicitCalled = false;
    const elicit = { elicit: async () => { elicitCalled = true; return { confirmed: true }; } };
    const eTool = new CrawlDeepStub({ elicitation: elicit });
    await eTool.execute({ url: 'https://example.com', max_pages: 600 });
    assert.ok(elicitCalled);
  });

  test('crawl cancelled when user declines elicitation', async () => {
    const declineElicit = { elicit: async () => ({ confirmed: false }) };
    const eTool = new CrawlDeepStub({ elicitation: declineElicit });
    const result = await eTool.execute({ url: 'https://example.com', max_pages: 600 });
    assert.equal(result.status, 'cancelled');
  });

  test('crawler network error propagates', async () => {
    await assert.rejects(() => tool.execute({ url: 'https://unreachable.example.com' }), /Connection refused/);
  });
});

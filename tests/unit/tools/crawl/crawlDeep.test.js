/**
 * D5.2 — Unit tests: crawlDeep tool
 * Run: node --test tests/unit/tools/crawl/crawlDeep.test.js
 */

import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// The real-module describe block below (Phase 2 fixes) needs safeFetch to
// reach a local server. safeFetch enforces SSRF protection (blocks loopback
// by default), so ALLOWED_DOMAINS must be set BEFORE the first transitive
// import of src/constants/config.js — hence the dynamic import here rather
// than a static one. `node --test` runs each file in its own subprocess, so
// this does not leak into sibling test files.
process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;
const { CrawlDeepTool } = await import('../../../../src/tools/crawl/crawlDeep.js');

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

// ---------------------------------------------------------------------------
// Real-module tests (Phase 2 fixes) — CrawlDeepTool + BFSCrawler against a
// local HTTP server, no stubs.
// ---------------------------------------------------------------------------

describe('crawlDeep tool — real module (Phase 2 fixes)', () => {
  let server;
  let baseUrl;

  before(async () => {
    const pages = {
      '/': '<html><body><a href="/keep">Keep</a><a href="/skip">Skip</a></body></html>',
      '/keep': '<html><body>KEEP CONTENT MARKER</body></html>',
      '/skip': '<html><body>SKIP CONTENT MARKER</body></html>'
    };
    server = http.createServer((req, res) => {
      const path = req.url.split('?')[0];
      if (path === '/robots.txt') { res.writeHead(404); res.end(); return; }
      const body = pages[path];
      if (body) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(body);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('completes with concurrency:1 at max_depth:3 with no BFS deadlock/timeout error', async () => {
    const realTool = new CrawlDeepTool({ cacheEnabled: false, timeout: 5000 });
    const result = await realTool.execute({
      url: baseUrl,
      max_depth: 3,
      max_pages: 10,
      concurrency: 1,
      respect_robots: false,
      enable_link_analysis: false
    });
    assert.ok(result.pages_crawled >= 3, `expected all 3 pages crawled, got pages_crawled=${result.pages_crawled}`);
    assert.equal(result.error_count, 0, `expected no crawl errors, got: ${JSON.stringify(result.errors)}`);
  });

  test('response exposes a scalar error_count (not clobbered by the errors array key)', async () => {
    const realTool = new CrawlDeepTool({ cacheEnabled: false, timeout: 5000 });
    const result = await realTool.execute({
      url: baseUrl,
      max_depth: 1,
      max_pages: 10,
      respect_robots: false,
      enable_link_analysis: false
    });
    assert.equal(typeof result.error_count, 'number', 'error_count must be a scalar number');
    assert.ok(Array.isArray(result.errors), 'errors must still be an array');
    assert.equal(result.error_count, result.errors.length);
  });

  test('cache key differs for extract_content:true vs extract_content:false (no stale cross-contamination)', async () => {
    const realTool = new CrawlDeepTool({ cacheEnabled: true, timeout: 5000 });
    const common = { url: baseUrl, max_depth: 1, max_pages: 10, respect_robots: false, enable_link_analysis: false };

    const withContent = await realTool.execute({ ...common, extract_content: true });
    const withoutContent = await realTool.execute({ ...common, extract_content: false });

    const keepPageWith = withContent.results.find(r => r.url.endsWith('/keep'));
    const keepPageWithout = withoutContent.results.find(r => r.url.endsWith('/keep'));

    assert.ok(keepPageWith?.content?.includes('KEEP CONTENT MARKER'), 'extract_content:true call should include page content');
    assert.equal(keepPageWithout?.content, undefined, 'extract_content:false call must NOT return the extract_content:true cached content');
  });

  test('cache key differs for exclude_patterns (excluded page is genuinely skipped, not served from a stale cache hit)', async () => {
    const realTool = new CrawlDeepTool({ cacheEnabled: true, timeout: 5000 });
    const common = { url: baseUrl, max_depth: 1, max_pages: 10, respect_robots: false, enable_link_analysis: false, extract_content: false };

    const unfiltered = await realTool.execute({ ...common });
    const filtered = await realTool.execute({ ...common, exclude_patterns: ['.*/skip$'] });

    const unfilteredUrls = unfiltered.results.map(r => r.url);
    const filteredUrls = filtered.results.map(r => r.url);

    assert.ok(unfilteredUrls.some(u => u.endsWith('/skip')), 'unfiltered call should visit /skip');
    assert.ok(!filteredUrls.some(u => u.endsWith('/skip')), 'exclude_patterns call must not visit /skip (and must not reuse the unfiltered cache entry)');
  });
});

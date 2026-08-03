/**
 * Unit tests for src/core/crawlers/BFSCrawler.js
 *
 * Reproduction tests for the Phase 2 fix: processUrl() used to `await
 * this.queue.add(...)` for child URLs from inside a task that already held a
 * p-queue slot, which (a) pinned that slot for the whole recursive crawl,
 * starving other tasks whenever concurrency <= depth, and (b) made the
 * per-task queue timeout measure the entire crawl instead of one page fetch.
 * Both symptoms surfaced as `crawl()` rejecting with "Promise timed out ...".
 *
 * These tests exercise the REAL BFSCrawler + safeFetch against a local HTTP
 * server (no mocks). safeFetch enforces SSRF protection, which blocks
 * loopback targets by default; ALLOWED_DOMAINS must be set BEFORE the first
 * (transitive) import of src/constants/config.js, so it is set here ahead of
 * a dynamic import of BFSCrawler. `node --test` runs each test file in its
 * own subprocess, so this does not leak into sibling test files.
 *
 * Run: node --test tests/unit/bfsCrawler.test.js --test-force-exit
 * (local server .listen() needs the sandbox disabled — see CLAUDE.md)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');

// ---------------------------------------------------------------------------
// Fixture site — a small linked tree, 3 levels deep, 8 pages total:
//   / (0) -> /a, /b, /c (1) -> /a1, /a2, /b1 (2) -> /a1a (3)
// ---------------------------------------------------------------------------

const PAGES = {
  '/': '<html><head><title>Home</title></head><body><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></body></html>',
  '/a': '<html><head><title>A</title></head><body><a href="/a1">A1</a><a href="/a2">A2</a><a href="/">Home</a></body></html>',
  '/b': '<html><head><title>B</title></head><body><a href="/b1">B1</a></body></html>',
  '/c': '<html><head><title>C</title></head><body>No links here.</body></html>',
  '/a1': '<html><head><title>A1</title></head><body><a href="/a1a">A1A</a></body></html>',
  '/a2': '<html><head><title>A2</title></head><body>No links.</body></html>',
  '/b1': '<html><head><title>B1</title></head><body>No links.</body></html>',
  '/a1a': '<html><head><title>A1A</title></head><body>Leaf page.</body></html>'
};
const ALL_PAGES = Object.keys(PAGES);

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/robots.txt') {
      res.writeHead(404);
      res.end();
      return;
    }
    const body = PAGES[path];
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

function makeCrawler(overrides = {}) {
  return new BFSCrawler({
    respectRobots: false,
    enableLinkAnalysis: false,
    timeout: 5000,
    ...overrides
  });
}

describe('BFSCrawler — deadlock/timeout fix', () => {
  test('completes with concurrency:1 and max_depth:3 (previously deadlocked)', async () => {
    const crawler = makeCrawler({ concurrency: 1, maxDepth: 3, maxPages: 20 });
    const result = await crawler.crawl(baseUrl);

    assert.equal(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`);
    assert.equal(result.urls.length, ALL_PAGES.length, 'expected all 8 pages to be visited');
    assert.equal(result.results.length, ALL_PAGES.length);
  });

  test('does not fail with "Promise timed out" at low concurrency (1, 2, 3, 5)', async () => {
    for (const concurrency of [1, 2, 3, 5]) {
      const crawler = makeCrawler({ concurrency, maxDepth: 3, maxPages: 20 });
      const result = await crawler.crawl(baseUrl);
      const timeoutErrors = result.errors.filter(e => /timed out/i.test(e.error));
      assert.equal(timeoutErrors.length, 0, `concurrency:${concurrency} produced timeout errors: ${JSON.stringify(timeoutErrors)}`);
      assert.equal(result.urls.length, ALL_PAGES.length, `concurrency:${concurrency} should still discover all pages`);
    }
  });

  test('completes with default-ish options (respectRobots:true, robots.txt 404 -> allow all)', async () => {
    const crawler = makeCrawler({ respectRobots: true, concurrency: 2, maxDepth: 3, maxPages: 20 });
    const result = await crawler.crawl(baseUrl);
    assert.equal(result.errors.length, 0);
    assert.equal(result.urls.length, ALL_PAGES.length);
  });
});

describe('BFSCrawler — max_pages / max_depth limits', () => {
  test('max_pages caps the number of visited URLs', async () => {
    // concurrency:1 keeps the visited-size check/increment race-free so the
    // cap is exact rather than a fuzzy upper bound.
    const crawler = makeCrawler({ concurrency: 1, maxDepth: 3, maxPages: 3 });
    const result = await crawler.crawl(baseUrl);
    assert.equal(result.urls.length, 3, `expected exactly 3 URLs visited, got ${result.urls.length}`);
  });

  test('max_depth:1 only visits the root and its direct links (4 pages)', async () => {
    const crawler = makeCrawler({ concurrency: 5, maxDepth: 1, maxPages: 20 });
    const result = await crawler.crawl(baseUrl);

    const visitedPaths = result.urls.map(u => new URL(u).pathname).sort();
    assert.deepEqual(visitedPaths, ['/', '/a', '/b', '/c'], 'depth-2/3 pages (/a1, /a2, /b1, /a1a) must not be visited');
  });

  test('max_depth:0 only visits the root', async () => {
    const crawler = makeCrawler({ concurrency: 5, maxDepth: 0, maxPages: 20 });
    const result = await crawler.crawl(baseUrl);
    assert.deepEqual(result.urls, [baseUrl + '/']);
  });
});

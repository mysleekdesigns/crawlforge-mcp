/**
 * Unit tests for TOOL_QUALITY_PLAN Phase 2.
 *
 * 2.1 — `include_patterns` used to block the crawl's own start URL. BFSCrawler
 * normalizes the seed (normalizeUrl strips the trailing slash), then tested it with
 * the include-pattern gate, so `{url: '.../docs', include_patterns: ['/docs/']}` died
 * with "Start URL blocked by domain filter" before fetching anything. Two independent
 * bugs: the seed should not be subject to a scope filter at all, and a pattern written
 * with a trailing slash should still match the URL it was written for.
 *
 * 2.2 — `depth_distribution` counted URL path segments instead of crawl depth.
 *
 * As in bfsCrawler.test.js, ALLOWED_DOMAINS must be set BEFORE the first (transitive)
 * import of src/constants/config.js, so BFSCrawler is imported dynamically below.
 *
 * Run: node --test tests/unit/crawlDeepIncludePatterns.test.js --test-force-exit
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');
const { CrawlDeepTool } = await import('../../src/tools/crawl/crawlDeep.js');

// A docs section plus an out-of-scope blog, so an include pattern has something to exclude.
const PAGES = {
  '/docs/': '<html><head><title>Docs</title></head><body><a href="/docs/getting-started">GS</a><a href="/docs/api">API</a><a href="/blog/post">Blog</a></body></html>',
  '/docs/getting-started': '<html><head><title>Getting started</title></head><body><a href="/docs/api">API</a></body></html>',
  '/docs/api': '<html><head><title>API</title></head><body>Leaf.</body></html>',
  '/blog/post': '<html><head><title>Blog post</title></head><body>Out of scope.</body></html>'
};

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
    // The seed is requested as '/docs' (normalizeUrl strips the slash); serve the
    // same page for both forms.
    const body = PAGES[path] || PAGES[`${path}/`];
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
    concurrency: 1,
    maxDepth: 2,
    maxPages: 20,
    ...overrides
  });
}

describe('BFSCrawler — include_patterns no longer block the start URL (2.1)', () => {
  test('the exact failing call crawls /docs and stays inside /docs/', async () => {
    const crawler = makeCrawler();
    const result = await crawler.crawl(`${baseUrl}/docs`, {
      includePatterns: ['/docs/']
    });

    const paths = result.urls.map(u => new URL(u).pathname).sort();
    assert.deepEqual(paths, ['/docs', '/docs/api', '/docs/getting-started']);
    assert.ok(!paths.includes('/blog/post'), 'include pattern must still scope the crawl');
  });

  test('a trailing-slash pattern matches a seed normalizeUrl stripped it from', async () => {
    // The regression pin: '/docs/' as a pattern against a '/docs' seed. Before the fix
    // this threw "Start URL blocked by domain filter: Not in whitelist or include patterns".
    const crawler = makeCrawler();
    const result = await crawler.crawl(`${baseUrl}/docs/`, {
      includePatterns: ['/docs/']
    });
    assert.ok(result.urls.length > 0, 'seed with an explicit trailing slash must crawl');
  });

  test('any include_patterns value no longer kills the crawl before it starts', async () => {
    // Even a pattern the seed cannot match must not block the seed — it only scopes
    // which links get followed from it.
    const crawler = makeCrawler({ maxDepth: 1 });
    const result = await crawler.crawl(`${baseUrl}/docs`, {
      includePatterns: ['/docs/api']
    });

    const paths = result.urls.map(u => new URL(u).pathname).sort();
    assert.deepEqual(paths, ['/docs', '/docs/api']);
  });

  test('exclude_patterns on the seed still block, as before', async () => {
    const crawler = makeCrawler();
    await assert.rejects(
      () => crawler.crawl(`${baseUrl}/docs`, { excludePatterns: ['/docs'] }),
      /Start URL blocked by domain filter/,
      'the seed exemption must not weaken exclude patterns'
    );
  });
});

describe('CrawlDeepTool.analyzeSiteStructure — depth_distribution is crawl depth (2.2)', () => {
  test('distribution comes from the recorded crawl depth, not URL path segments', () => {
    const tool = new CrawlDeepTool();
    // Path depth and crawl depth disagree here: /a/b/c/d is 4 segments but was
    // reached at depth 1.
    const pages = [
      { url: 'https://example.com/', depth: 0 },
      { url: 'https://example.com/a/b/c/d', depth: 1 },
      { url: 'https://example.com/e', depth: 1 }
    ];
    const structure = tool.analyzeSiteStructure(pages.map(p => p.url), pages);

    assert.deepEqual(structure.depth_distribution, { 0: 1, 1: 2 });
    const sum = Object.values(structure.depth_distribution).reduce((a, b) => a + b, 0);
    assert.equal(sum, pages.length, 'distribution must sum to the number of pages found');
    const maxKey = Math.max(...Object.keys(structure.depth_distribution).map(Number));
    assert.equal(maxKey, 1, 'keys must never exceed max_depth');
  });

  test('URL path depth is kept under its own field', () => {
    const tool = new CrawlDeepTool();
    const pages = [{ url: 'https://example.com/a/b/c/d', depth: 1 }];
    const structure = tool.analyzeSiteStructure(pages.map(p => p.url), pages);

    assert.deepEqual(structure.path_depth_distribution, { 4: 1 });
    assert.deepEqual(structure.depth_distribution, { 1: 1 });
  });
});

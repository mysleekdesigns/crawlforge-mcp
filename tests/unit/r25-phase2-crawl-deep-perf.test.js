/**
 * R25 Phase 2, item 2.1: crawl_deep link analysis blocked the event loop.
 * extractLinkMetadata ran `a[href="..."]` over the whole page for every link,
 * so a link-dense page cost links x page size of synchronous work, and the
 * other crawls queued behind it failed with p-queue's "Task timed out ...
 * (queue has N running, M waiting)", which describes the queue, not the task.
 * Also: getPathPattern reported the file bugs.html as the directory /bugs.html/.
 *
 * Real BFSCrawler + safeFetch against a local HTTP server, as in
 * bfsCrawler.test.js: ALLOWED_DOMAINS must be set before the first
 * (transitive) import of src/constants/config.js.
 *
 * Run: node --test --test-force-exit tests/unit/r25-phase2-crawl-deep-perf.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');
const { QueueManager } = await import('../../src/core/queue/QueueManager.js');

const DENSE_LINKS = 4000;
const ROUTES = {
  // Two anchors share /x: the metadata must come from the first, as the
  // old `a[href="/x"]`.first() query returned.
  '/': '<html><head><title>Home</title></head><body><p>Intro text.</p>' +
    '<a href="/x" title="first title" class="first" rel="next">First X</a>' +
    '<p>Middle.</p><a href="/x" title="second title">Second X</a>' +
    '<a href="bugs.html">Bugs</a></body></html>',
  '/dense': '<html><head><title>Dense</title></head><body>' +
    Array.from({ length: DENSE_LINKS }, (_, i) => `<p>Paragraph ${i} of filler text.</p><a href="/p${i}.html">Page ${i}</a>`).join('') +
    '</body></html>'
};

let server;
let origin;
before(async () => {
  server = http.createServer((req, res) => {
    const body = ROUTES[req.url.split('?')[0]];
    if (body) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
});

function makeCrawler(overrides = {}) {
  return new BFSCrawler({
    respectRobots: false,
    enableLinkAnalysis: true,
    cacheEnabled: false,
    timeout: 5000,
    ...overrides
  });
}

describe('crawl_deep link metadata comes from one anchor index per page (R25 2.1)', () => {
  test('a repeated href takes the first anchor, as the old selector did', async () => {
    const crawler = makeCrawler({ maxDepth: 0, maxPages: 1 });
    await crawler.crawl(`${origin}/`);

    const all = [...crawler.getLinkAnalyzer().linkMetadata.entries()];
    const [, x] = all.find(([key]) => key.endsWith('/x'));
    assert.equal(x.href, '/x');
    assert.equal(x.anchorText, 'First X');
    assert.equal(x.title, 'first title');
    assert.equal(x.className, 'first');
    assert.equal(x.rel, 'next');
    assert.match(x.context, /Intro text\.First X/);

    const [, bugs] = all.find(([key]) => key.endsWith('/bugs.html'));
    assert.equal(bugs.anchorText, 'Bugs');
  });

  test(`the ${DENSE_LINKS} links of one page cost well under a second`, async () => {
    // Before the fix the per-link query alone took ~3 s for this page. Only
    // extractLinkMetadata is timed: this flat page is slow for Readability's
    // main-content pass, which is not what this test is about.
    const crawler = makeCrawler({ maxDepth: 0, maxPages: 1 });
    const extract = crawler.extractLinkMetadata.bind(crawler);
    let spent = 0;
    crawler.extractLinkMetadata = (...args) => {
      const started = performance.now();
      try { return extract(...args); } finally { spent += performance.now() - started; }
    };
    const result = await crawler.crawl(`${origin}/dense`);

    assert.equal(result.results.length, 1);
    assert.equal(crawler.getLinkAnalyzer().linkMetadata.size, DENSE_LINKS);
    assert.ok(spent < 1000, `link metadata took ${Math.round(spent)} ms`);
  });
});

describe('getPathPattern (R25 2.1)', () => {
  const crawler = new BFSCrawler({ enableLinkAnalysis: false });
  for (const [pathname, expected] of [
    ['/', '/'],
    ['/bugs.html', '/bugs.html'],
    ['/3/bugs.html', '/3/bugs.html'],
    ['/docs', '/docs/'],
    ['/docs/', '/docs/'],
    ['/3/tutorial/', '/3/tutorial/...'],
    ['/3/tutorial/appetite.html', '/3/tutorial/...'],
    ['/.well-known', '/.well-known/']
  ]) {
    test(`${pathname} -> ${expected}`, () => {
      assert.equal(crawler.getPathPattern(pathname), expected);
    });
  }
});

describe('QueueManager timeout error names the time budget (R25 2.1)', () => {
  test('a task that runs too long rejects with its budget, not the queue state', async () => {
    const queue = new QueueManager({ timeout: 50 });
    await assert.rejects(
      queue.add(() => new Promise(resolve => setTimeout(resolve, 300))),
      (error) => {
        assert.equal(
          error.message,
          'Task ran over its 0.05 s time budget; it may have been starved by other work running in this process.'
        );
        assert.equal(error.cause?.name, 'TimeoutError');
        return true;
      }
    );
  });

  test("a task's own error passes through unchanged", async () => {
    const queue = new QueueManager({ timeout: 1000 });
    await assert.rejects(queue.add(async () => { throw new Error('HTTP 500'); }), /^Error: HTTP 500$/);
  });
});

/**
 * Live sweep 2026-10-20, Phase 6 polish — map_site, extract_metadata, crawl_deep.
 * Run: node --test --test-force-exit tests/unit/phase6CrawlMetadata.test.js
 *
 * 6.2  map_site listed `/` and `/index.html` as two URLs: the same page.
 * 6.5  extract_metadata returned the whole http-equiv content-type string
 *      ("text/html; charset=utf-8") as `charset`, and `description` with the
 *      page's surrounding whitespace.
 * 6.6  crawl_deep titles kept the page's newlines and indentation, and
 *      filterDecisions counted a URL the SSRF guard refused as `allowed`.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// safeFetch blocks loopback unless ALLOWED_DOMAINS names it, and config.js
// reads it on first import — so it is set before the dynamic imports.
process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;
const { MapSiteTool } = await import('../../src/tools/crawl/mapSite.js');
const { extractMetadataHandler } = await import('../../src/tools/basic/extractMetadata.js');
const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');

const PAGES = {
  '/': '<html><head><title>Home</title></head><body>' +
    '<a href="/index.html">Home again</a><a href="/docs/">Docs</a>' +
    '<a href="/docs/index.htm">Docs again</a><a href="/about.html">About</a></body></html>',
  '/meta-equiv': `<html><head>
    <meta http-equiv="content-type" content="text/html; charset=utf-8">
    <meta name="description" content="
      A description with padding.   ">
    <title>Equiv</title></head><body></body></html>`,
  '/meta-charset': '<html><head><meta charset="utf-8"><title>Charset</title></head><body></body></html>',
  '/crawl': `<html><head><title>
      Spread
      over   lines
    </title></head><body><a href="http://169.254.169.254/latest/meta-data/">metadata</a></body></html>`,
  '/crawl-hop': '<html><head><title>Hop</title></head><body><a href="/hop">hop</a></body></html>'
};

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/hop') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    const body = PAGES[req.url.split('?')[0]];
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('6.2 — map_site folds index.html / index.htm into the directory', () => {
  test('/ and /index.html are one URL; /docs/ and /docs/index.htm are one URL', async () => {
    const tool = new MapSiteTool({ cacheEnabled: false, timeout: 5000 });
    const result = await tool.execute({ url: `${baseUrl}/`, group_by_path: false });
    assert.deepEqual([...result.urls].sort(), [`${baseUrl}/`, `${baseUrl}/about.html`, `${baseUrl}/docs`].sort());
  });
});

describe('6.5 — extract_metadata charset and description', () => {
  const run = async (path) => JSON.parse((await extractMetadataHandler({ url: `${baseUrl}${path}` })).content[0].text);

  test('http-equiv content-type gives only the charset token', async () => {
    const meta = await run('/meta-equiv');
    assert.equal(meta.charset, 'UTF-8');
  });

  test('<meta charset> gives the charset token', async () => {
    const meta = await run('/meta-charset');
    assert.equal(meta.charset, 'UTF-8');
  });

  test('description is trimmed', async () => {
    const meta = await run('/meta-equiv');
    assert.equal(meta.description, 'A description with padding.');
  });
});

describe('6.6 — crawl_deep titles and filterDecisions', () => {
  const crawl = () => new BFSCrawler({
    maxDepth: 1,
    maxPages: 5,
    followExternal: true,
    respectRobots: false,
    timeout: 5000,
    enableLinkAnalysis: false
  }).crawl(`${baseUrl}/crawl`);

  test('title whitespace is collapsed', async () => {
    const out = await crawl();
    assert.equal(out.results[0].title, 'Spread over lines');
  });

  test('an SSRF-refused URL is counted as blocked, not allowed', async () => {
    const out = await crawl();
    const ssrfError = out.errors.find((e) => e.code === 'SSRF_BLOCKED');
    assert.ok(ssrfError, `expected an SSRF_BLOCKED error, got ${JSON.stringify(out.errors)}`);

    const stats = out.stats.filterDecisions;
    assert.equal(stats.total, 2);
    assert.equal(stats.allowed, 1);
    assert.equal(stats.blocked, 1);
    assert.equal(stats.blockedReasons['SSRF protection'], 1);
  });

  // 7.1 (re-sweep 2026-10-21): a refusal on a redirect hop comes back from the
  // dispatcher as a fetch cause; safeFetch rethrew it without the code.
  test('a URL refused on a redirect hop is counted as blocked', async () => {
    const out = await new BFSCrawler({
      maxDepth: 1,
      maxPages: 5,
      respectRobots: false,
      timeout: 5000,
      enableLinkAnalysis: false
    }).crawl(`${baseUrl}/crawl-hop`);
    const hopError = out.errors.find((e) => e.url.endsWith('/hop'));
    assert.equal(hopError?.code, 'SSRF_BLOCKED', `got ${JSON.stringify(out.errors)}`);

    const stats = out.stats.filterDecisions;
    assert.equal(stats.allowed, 1);
    assert.equal(stats.blocked, 1);
    assert.equal(stats.blockedReasons['SSRF protection'], 1);
  });
});

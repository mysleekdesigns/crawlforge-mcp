/**
 * Unit tests for the blocked-page verdict inside `scrape` (Phase 0, 0.1) and
 * the host memory it writes (0.6).
 *
 * Cloudflare, Amazon, DataDome, PerimeterX, Akamai and Vercel answer a
 * blocked request with a page of their own. The stealth path has named
 * these since 5.6.2; `scrape` reported them as a clean success — a
 * Cloudflare interstitial was `success:true, title: "Just a moment..."`.
 * Every vendor fixture is served with 200 first, so the status can never be
 * what decides; the document is. A live probe (2026-09-05) then showed real
 * walls reach a plain fetch as HTTP 403, a body fetchAndParse used to throw
 * away — so the same fixture is served as a 403 too, and plain HTTP error
 * pages get the verdict's status branch with the real code.
 *
 * Exercises the REAL UnifiedScrapeTool + fetchAndParse against a local HTTP
 * server. The fetch path enforces SSRF protection (blocks loopback by
 * default), so ALLOWED_DOMAINS is set BEFORE the first transitive import of
 * src/constants/config.js. The fixtures are copies of the ones
 * crawlforge-extractors tests its tables with, so both surfaces are held to
 * the same pages.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/scrapeBlockedVerdict.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');
const { fetchAndParse } = await import('../../src/tools/extract/_fetchAndParse.js');
const { getHostBlock, getHostBackoffMs, _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');

const FIXTURES = fileURLToPath(new URL('../fixtures/blocked/', import.meta.url));
const VENDORS = ['cloudflare', 'amazon', 'datadome', 'perimeterx', 'akamai', 'vercel'];

const NORMAL_PAGE = `<!doctype html><html><head><title>A real page</title></head>
<body><main><h1>A real page</h1><p>${'Ordinary prose that a reader would see. '.repeat(20)}</p></main></body></html>`;

const errorPage = (title) =>
  `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>The server will not serve this resource.</p></body></html>`;

// Non-2xx documents: [status, body, extra headers]
const ERROR_ROUTES = {
  '/cloudflare-403': [403, () => readFileSync(`${FIXTURES}cloudflare.html`, 'utf8'), {}],
  '/forbidden': [403, () => errorPage('Forbidden'), {}],
  '/missing': [404, () => errorPage('Not Found'), {}],
  '/unavailable': [503, () => errorPage('Service Unavailable'), { 'Retry-After': '2' }],
  '/binary-403': [403, () => 'not a document', { 'Content-Type': 'application/octet-stream' }]
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
    if (path === '/normal') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(NORMAL_PAGE);
      return;
    }
    if (ERROR_ROUTES[path]) {
      const [status, body, headers] = ERROR_ROUTES[path];
      res.writeHead(status, { 'Content-Type': 'text/html', ...headers });
      res.end(body());
      return;
    }
    // Every wall is served as a 200, exactly as the vendors serve them.
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(`${FIXTURES}${path.slice(1)}.html`, 'utf8'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  _resetHostRateLimiter();
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const tool = new UnifiedScrapeTool();
const scrape = (path, extra = {}) =>
  tool.execute({ url: `${baseUrl}/${path}`, formats: ['markdown'], resolveHiddenContent: 'off', ...extra });

describe('a challenge page served with HTTP 200 is a failure that names the vendor', () => {
  for (const vendor of VENDORS) {
    test(vendor, async () => {
      const result = await scrape(vendor);
      assert.equal(result.success, false);
      assert.equal(result.status, 200);
      assert.equal(result.blocked.vendor, vendor);
      assert.ok(result.blocked.evidence, 'evidence names what gave the wall away');
      assert.deepEqual(result.content, {});
      assert.match(result.error, /a plain fetch/);
      assert.equal(result.url, `${baseUrl}/${vendor}`);
      assert.equal(getHostBlock(result.url).vendor, vendor);
    });
  }
});

describe('an empty shell and a soft-error placeholder fail without a vendor', () => {
  test('empty shell: no title, no text', async () => {
    const result = await scrape('empty-shell');
    assert.equal(result.success, false);
    assert.equal(result.blocked, undefined);
    assert.deepEqual(result.content, {});
    assert.match(result.error, /A plain fetch reached .* no title and no text/);
    assert.match(result.error, /only a browser renders it/);
  });

  test('soft error: short page with an error title', async () => {
    const result = await scrape('soft-error');
    assert.equal(result.success, false);
    assert.equal(result.blocked, undefined);
    assert.equal(result.title, 'Error Page');
    assert.deepEqual(result.content, {});
    assert.match(result.error, /rendered an error page titled "Error Page"/);
  });
});

describe('a non-2xx document reaches the verdict with its real status', () => {
  test('a Cloudflare wall served as 403 names the vendor and the status', async () => {
    const result = await scrape('cloudflare-403');
    assert.equal(result.success, false);
    assert.equal(result.status, 403);
    assert.equal(result.blocked.vendor, 'cloudflare');
    assert.deepEqual(result.content, {});
    assert.equal(getHostBlock(result.url).vendor, 'cloudflare');
  });

  test('a plain 403 with no vendor on the page is an IP or WAF block', async () => {
    const result = await scrape('forbidden');
    assert.equal(result.success, false);
    assert.equal(result.status, 403);
    assert.equal(result.blocked, undefined);
    assert.match(result.error, /^HTTP 403: /);
    assert.match(result.error, /IP-reputation or WAF/);
    assert.doesNotMatch(result.error, /content returned/, 'scrape drops the error page, so the message must not say it is attached');
    assert.deepEqual(result.content, {});
  });

  test('a 404 is a missing URL', async () => {
    const result = await scrape('missing');
    assert.equal(result.success, false);
    assert.equal(result.status, 404);
    assert.equal(result.blocked, undefined);
    assert.match(result.error, /does not exist/);
    assert.doesNotMatch(result.error, /content returned/);
  });

  test('a binary 403 body is a fetch failure, not a verdict', async () => {
    await assert.rejects(
      () => scrape('binary-403'),
      { message: `scrape: fetch failed for ${baseUrl}/binary-403: HTTP 403: Forbidden` }
    );
  });

  test('the default fetchAndParse path still throws on a non-2xx', async () => {
    await assert.rejects(
      () => fetchAndParse(`${baseUrl}/forbidden`, { timeoutMs: 3000 }),
      { message: 'HTTP 403: Forbidden' }
    );
  });
});

describe('a real page is unchanged, and clears the host memory', () => {
  test('blocked, then clean: the memory follows the last verdict', async () => {
    const blocked = await scrape('cloudflare');
    assert.equal(blocked.success, false);
    assert.equal(getHostBlock(`${baseUrl}/anything`).vendor, 'cloudflare');

    const result = await scrape('normal', { formats: ['markdown', 'metadata'] });
    assert.equal(result.success, true);
    assert.equal(result.error, undefined);
    assert.equal(result.blocked, undefined);
    assert.equal(result.title, undefined, 'a clean result carries no verdict fields');
    assert.match(result.content.markdown, /Ordinary prose that a reader would see/);
    assert.equal(result.content.metadata.title, 'A real page');
    assert.equal(getHostBlock(`${baseUrl}/anything`), null);
  });
});

// Last on purpose: the Retry-After it records makes every later request to
// this host wait it out, which is the point of the signal.
describe('a 503 still fails and its Retry-After still reaches the host backoff', () => {
  test('503 with Retry-After: 2', async () => {
    const result = await scrape('unavailable');
    assert.equal(result.success, false);
    assert.equal(result.status, 503);
    assert.equal(result.blocked, undefined);
    assert.match(result.error, /^HTTP 503: /);
    assert.ok(getHostBackoffMs(`${baseUrl}/`) > 0, 'the politeness signal survives the new path');
  });
});

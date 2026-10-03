/**
 * Regressions from the R24 live sweep (LIVE_TEST_R24_FIX_PLAN.md, Phase 1):
 *
 *   1.5  batch_scrape returned a PDF's bytes as successful text. It now
 *        refuses the URL with the message `scrape` gives it.
 *   1.8  scrape's `text` format carried a <noscript> body as literal tags,
 *        and a success with empty markdown said nothing.
 *
 * The Fastly challenge verdict from 1.8 is in scrapeBlockedVerdict.test.js
 * and scrapeEscalation.test.js, next to the other vendors.
 *
 * Real modules against a local HTTP server; ALLOWED_DOMAINS is set before
 * the first transitive import of src/constants/config.js.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/r24-scrape-batch.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');
const { fetchAndParse } = await import('../../src/tools/extract/_fetchAndParse.js');
const { scrapeUrl } = await import('../../src/tools/advanced/batchScrape/worker.js');
const { scrapeUrlsBatch } = await import('../../src/tools/advanced/batchScrape/queue.js');

const PROSE = 'Ordinary prose that a reader would see. '.repeat(20);

const ROUTES = {
  // w3.org serves its dummy PDF with exactly this Content-Type.
  '/dummy.pdf': [200, 'application/pdf; qs=0.001', '%PDF-1.4\n%äüöß\n2 0 obj\nstream\nendstream\n'],
  '/image': [200, 'image/png', '\u0089PNG'],
  '/missing.pdf': [404, 'application/pdf', '%PDF-1.4'],
  '/page': [200, 'text/html', `<html><head><title>A page</title></head><body><main><h1>A page</h1><p>${PROSE}</p></main></body></html>`],
  '/plain': [200, 'text/plain; charset=utf-8', 'plain text body'],
  '/untyped': [200, null, '<html><head><title>Untyped</title></head><body><p>No Content-Type header.</p></body></html>'],
  '/noscript': [200, 'text/html', `<html><head><title>A page</title></head><body>
<noscript><div class="noscript-container"><span class="noscript-span">JavaScript is disabled in your browser.</span></div></noscript>
<main><h1>A page</h1><p>${PROSE}</p></main></body></html>`],
  // Everything a reader sees is in <nav>, which the markdown converter drops.
  '/nav-only': [200, 'text/html', '<html><head><title>Menu</title></head><body><nav><a href="/a">Products</a> <a href="/b">Pricing</a></nav></body></html>']
};

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const route = ROUTES[req.url.split('?')[0]];
    if (!route) {
      res.writeHead(404);
      res.end();
      return;
    }
    const [status, type, body] = route;
    res.writeHead(status, type ? { 'Content-Type': type } : {});
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

describe('1.5 batch_scrape refuses a binary body instead of decoding it as text', () => {
  test('a PDF fails with the refusal scrape gives the same URL', async () => {
    const url = `${baseUrl}/dummy.pdf`;
    const result = await scrapeUrl({ url }, { formats: ['text'] }, 5000);
    assert.equal(result.success, false);
    assert.equal(result.content, undefined);
    assert.equal(
      result.error,
      'Unsupported content type "application/pdf; qs=0.001" — this looks like binary content, not HTML/text. Use process_document for PDFs/documents/binary files.'
    );
    // Not a second wording: what scrape's own fetch throws, character for character.
    await assert.rejects(() => fetchAndParse(url, { tool: 'scrape' }), (err) => err.message === result.error);
    await assert.rejects(
      () => new UnifiedScrapeTool().execute({ url, formats: ['text'] }),
      (err) => err.message === `scrape: fetch failed for ${url}: ${result.error}`
    );
  });

  test('the PDF fails alone; the page beside it in the batch still succeeds', async () => {
    const results = await scrapeUrlsBatch(
      [{ url: `${baseUrl}/dummy.pdf` }, { url: `${baseUrl}/page` }, { url: `${baseUrl}/image` }],
      { formats: ['text'], maxConcurrency: 3 },
      5000
    );
    assert.deepEqual(results.map((r) => r.success), [false, true, false]);
    assert.match(results[0].error, /^Unsupported content type "application\/pdf/);
    assert.match(results[1].content.text, /Ordinary prose/);
    assert.match(results[2].error, /^Unsupported content type "image\/png"/);
  });

  test('an error status keeps its own message whatever the body type', async () => {
    const result = await scrapeUrl({ url: `${baseUrl}/missing.pdf` }, { formats: ['text'] }, 5000);
    assert.equal(result.success, false);
    assert.match(result.error, /^HTTP 404/);
  });

  test('text/plain and a response with no Content-Type are still read', async () => {
    const plain = await scrapeUrl({ url: `${baseUrl}/plain` }, { formats: ['text'] }, 5000);
    assert.equal(plain.success, true, plain.error);
    assert.equal(plain.content.text, 'plain text body');
    const untyped = await scrapeUrl({ url: `${baseUrl}/untyped` }, { formats: ['text'] }, 5000);
    assert.equal(untyped.success, true, untyped.error);
    assert.equal(untyped.content.text, 'No Content-Type header.');
  });
});

describe('1.8 scrape: noscript markup and empty markdown', () => {
  const tool = new UnifiedScrapeTool();
  const scrape = (path, extra = {}) =>
    tool.execute({ url: `${baseUrl}${path}`, resolveHiddenContent: 'off', ...extra });

  for (const onlyMainContent of [true, false]) {
    test(`text carries no <noscript> markup (onlyMainContent:${onlyMainContent})`, async () => {
      const result = await scrape('/noscript', { formats: ['text'], onlyMainContent });
      assert.equal(result.success, true);
      assert.match(result.content.text, /Ordinary prose/);
      assert.doesNotMatch(result.content.text, /[<>]|noscript/);
    });
  }

  test('a success with empty markdown carries a warning', async () => {
    const result = await scrape('/nav-only', { formats: ['markdown'], onlyMainContent: false });
    assert.equal(result.success, true);
    assert.equal(result.content.markdown, '');
    assert.equal(result.warnings.filter((w) => /^markdown: the page produced no markdown/.test(w)).length, 1);
    assert.match(result.warnings.join('\n'), /escalate:true/);
  });

  test('a page with markdown carries no such warning', async () => {
    const result = await scrape('/page', { formats: ['markdown'] });
    assert.equal(result.success, true);
    assert.ok(!(result.warnings || []).some((w) => /produced no markdown/.test(w)));
  });
});

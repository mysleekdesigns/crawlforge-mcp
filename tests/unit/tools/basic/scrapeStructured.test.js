/**
 * Unit tests for src/tools/basic/scrapeStructured.js (scrapeStructuredHandler)
 *
 * Reproduction tests for the Phase 2 fixes:
 *  - Multi-match fields used `elements.map((_, el) => extract(el)).get()`;
 *    cheerio's map() drops null/undefined results, so an element missing the
 *    requested attribute silently vanished from the array instead of leaving
 *    a placeholder — desynchronizing the array from elements_found and from
 *    parallel fields (index-aligned rows in a table/list scrape). Fixed to
 *    build the array from `elements.toArray().map(extract)` so length always
 *    equals elements_found.
 *  - parseSelectorSpec split on the LAST "@" whenever present, so a selector
 *    like `a[href*="@"]` (find mailto/contact links) was misparsed as
 *    selector `a[href*="` + attribute `"]`, throwing "Attribute value didn't
 *    end". Fixed to only treat a trailing "@attr" as an attribute suffix
 *    when it looks like a real attribute name outside brackets/quotes.
 *
 * Exercises the REAL scrapeStructuredHandler + fetchWithTimeout against a
 * local HTTP server. fetchWithTimeout enforces SSRF protection (blocks
 * loopback by default), so ALLOWED_DOMAINS is set here BEFORE the first
 * transitive import of src/constants/config.js via a dynamic import.
 * `node --test` runs each test file in its own subprocess, so this does not
 * leak into sibling files.
 *
 * Run: node --test tests/unit/tools/basic/scrapeStructured.test.js --test-force-exit
 * (local server .listen() needs the sandbox disabled — see CLAUDE.md)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { scrapeStructuredHandler } = await import('../../../../src/tools/basic/scrapeStructured.js');

let server;
let baseUrl;

before(async () => {
  const pages = {
    '/gallery': `<html><body>
      <img src="a.png">
      <img>
      <img src="c.png">
    </body></html>`,
    '/contact': `<html><body>
      <a href="mailto:sales@example.com">Sales</a>
      <a href="mailto:support@example.com">Support</a>
      <a href="/about">About (no @)</a>
    </body></html>`
  };
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
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

function parseResult(result) {
  assert.equal(result.isError, undefined, `handler returned an error: ${result.content?.[0]?.text}`);
  return JSON.parse(result.content[0].text);
}

describe('scrapeStructuredHandler', () => {
  test('an element missing the requested attribute produces a null placeholder, not a dropped index', async () => {
    const result = await scrapeStructuredHandler({
      url: `${baseUrl}/gallery`,
      selectors: { imgs: 'img@src' }
    });
    const data = parseResult(result);

    assert.equal(data.elements_found.imgs, 3, 'DOM has 3 <img> elements');
    assert.deepEqual(data.data.imgs, ['a.png', null, 'c.png'], 'array length must equal elements_found, with null for the missing attribute');
  });

  test('selector a[href*="@"] is not misparsed as attribute syntax', async () => {
    const result = await scrapeStructuredHandler({
      url: `${baseUrl}/contact`,
      selectors: { mailtoLinks: 'a[href*="@"]' }
    });
    const data = parseResult(result);

    assert.equal(data.elements_found.mailtoLinks, 2, 'expected the two mailto: links to match, not an "Invalid selector" error');
    assert.deepEqual(data.data.mailtoLinks, ['Sales', 'Support']);
  });

  test('a genuinely invalid selector still reports a per-field error without crashing the whole call', async () => {
    const result = await scrapeStructuredHandler({
      url: `${baseUrl}/contact`,
      selectors: { broken: ':::not-a-selector', ok: 'a' }
    });
    const data = parseResult(result);

    assert.ok(data.data.broken?.error, 'expected the broken selector to report a field-level error');
    assert.ok(Array.isArray(data.data.ok) || typeof data.data.ok === 'string', 'the other field must still resolve normally');
  });
});

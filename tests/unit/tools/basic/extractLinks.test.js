/**
 * Unit tests for src/tools/basic/extractLinks.js (extractLinksHandler)
 *
 * Reproduction tests for the Phase 2 fixes:
 *  - baseUrl used to default to `new URL(url).origin`, so a relative href on
 *    a non-root page (e.g. /docs/page.html) resolved against the origin
 *    instead of the page's own directory — "about.html" became
 *    "/about.html" instead of "/docs/about.html". Fixed to default to the
 *    final response URL (and honor an explicit base_url override).
 *  - protocol-relative hrefs ("//other.example.org/x") were always
 *    classified is_external:false because only http(s):// hrefs took the
 *    external-detection branch. Fixed to compute isExternal from the
 *    resolved absolute URL's origin in every branch.
 *  - <base href> was ignored entirely; it is now read once per document and
 *    used as the resolution base for relative hrefs.
 *
 * Exercises the REAL extractLinksHandler + fetchWithTimeout against a local
 * HTTP server. fetchWithTimeout enforces SSRF protection (blocks loopback by
 * default), so ALLOWED_DOMAINS is set here BEFORE the first transitive
 * import of src/constants/config.js via a dynamic import. `node --test` runs
 * each test file in its own subprocess, so this does not leak into sibling
 * files.
 *
 * Run: node --test tests/unit/tools/basic/extractLinks.test.js --test-force-exit
 * (local server .listen() needs the sandbox disabled — see CLAUDE.md)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { extractLinksHandler } = await import('../../../../src/tools/basic/extractLinks.js');

let server;
let baseUrl;

before(async () => {
  const pages = {
    '/docs/page.html': `<html><body>
      <a href="about.html">About</a>
      <a href="//other.example.org/x">Protocol-relative external</a>
    </body></html>`,
    '/docs/based.html': `<html><head><base href="https://cdn.example.com/assets/"></head><body>
      <a href="about.html">About via base</a>
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

describe('extractLinksHandler', () => {
  test('relative href on a non-root page resolves against the page URL, not the origin', async () => {
    const result = await extractLinksHandler({ url: `${baseUrl}/docs/page.html` });
    const data = parseResult(result);

    const about = data.links.find(l => l.original_href === 'about.html');
    assert.ok(about, 'expected an "about.html" link entry');
    assert.equal(about.href, `${baseUrl}/docs/about.html`, 'must resolve against /docs/, not the origin root');
  });

  test('protocol-relative href is classified is_external:true', async () => {
    const result = await extractLinksHandler({ url: `${baseUrl}/docs/page.html` });
    const data = parseResult(result);

    const external = data.links.find(l => l.original_href === '//other.example.org/x');
    assert.ok(external, 'expected the protocol-relative link entry');
    assert.equal(external.is_external, true);
    assert.equal(external.href, 'http://other.example.org/x'); // inherits the page's actual scheme (http, this test server)
  });

  test('internal_count / external_count reflect the protocol-relative classification', async () => {
    const result = await extractLinksHandler({ url: `${baseUrl}/docs/page.html` });
    const data = parseResult(result);

    assert.equal(data.total_count, 2);
    assert.equal(data.internal_count, 1);
    assert.equal(data.external_count, 1);
  });

  test('<base href> is honored as the resolution base for relative hrefs', async () => {
    const result = await extractLinksHandler({ url: `${baseUrl}/docs/based.html` });
    const data = parseResult(result);

    const about = data.links.find(l => l.original_href === 'about.html');
    assert.ok(about, 'expected an "about.html" link entry');
    assert.equal(about.href, 'https://cdn.example.com/assets/about.html');
    assert.equal(about.is_external, true, 'the <base>-resolved URL is on a different origin than the page');
  });

  test('an explicit base_url override still wins over both <base href> and the page URL', async () => {
    const result = await extractLinksHandler({ url: `${baseUrl}/docs/based.html`, base_url: `${baseUrl}/override/` });
    const data = parseResult(result);

    const about = data.links.find(l => l.original_href === 'about.html');
    assert.equal(about.href, `${baseUrl}/override/about.html`);
  });
});

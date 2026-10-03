/**
 * extract_links / extract_text report what the target answered (fix plan
 * Phase E1): a named vendor's wall on any status fails naming the vendor and
 * the status, any other non-2xx fails as "Target answered HTTP <n>", and a
 * 200 page extracts as before. The wall bodies are the shared fixtures the
 * scrape verdict tests use. A target that never answers (a timeout, an
 * unreachable host) fails saying which and why (Phase E5).
 *
 * Mocks globalThis.fetch (no live network); robots.txt answers 404.
 *
 * Run: node --test --test-force-exit tests/unit/tools/basic/extractTargetFailure.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { extractLinksHandler } = await import('../../../../src/tools/basic/extractLinks.js');
const { extractTextHandler } = await import('../../../../src/tools/basic/extractText.js');
const { LADDER_TIMEOUT_MS } = await import('../../../../src/utils/fetchLadder.js');

const FIXTURES = fileURLToPath(new URL('../../../fixtures/blocked/', import.meta.url));
const CLOUDFLARE = readFileSync(`${FIXTURES}cloudflare.html`, 'utf8');
const AKAMAI = readFileSync(`${FIXTURES}akamai.html`, 'utf8');
const F5 = readFileSync(`${FIXTURES}f5.html`, 'utf8');
const EMPTY_SHELL = readFileSync(`${FIXTURES}empty-shell.html`, 'utf8');

const PAGE = `<html><head><title>Docs</title></head><body>
<p>A real page with enough text to be the page.</p>
<a href="/about">About</a>
</body></html>`;

const HANDLERS = [
  ['extract_links', extractLinksHandler, 'Failed to extract links: '],
  ['extract_text', extractTextHandler, 'Failed to extract text: ']
];

// Each test uses its own host, so the per-host throttle never waits.
let hostSeq = 0;
function nextUrl() {
  hostSeq += 1;
  return `https://target-${hostSeq}.example.com/page`;
}

function mockFetch(status, body, contentType = 'text/html; charset=utf-8') {
  const orig = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    if (url.endsWith('/robots.txt')) {
      return { ok: false, status: 404, statusText: 'Not Found', url, headers: new Headers(), text: async () => '' };
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      url,
      headers: new Headers({ 'content-type': contentType }),
      text: async () => body
    };
  };
  return () => { globalThis.fetch = orig; };
}

async function call(handler, status, body, contentType) {
  const restore = mockFetch(status, body, contentType);
  try {
    return await handler({ url: nextUrl() });
  } finally {
    restore();
  }
}

for (const [tool, handler, prefix] of HANDLERS) {
  describe(`${tool}: what the target answered`, () => {
    test('a 403 Cloudflare challenge fails naming the vendor and the status', async () => {
      const res = await call(handler, 403, CLOUDFLARE);
      assert.equal(res.isError, true);
      const text = res.content[0].text;
      assert.ok(text.startsWith(`${prefix}Target answered HTTP 403: cloudflare served a challenge page`), text);
      assert.match(text, /a plain fetch did not pass it/);
    });

    test('a challenge served with 200 is a wall, not a page', async () => {
      const res = await call(handler, 200, CLOUDFLARE);
      assert.equal(res.isError, true);
      assert.ok(res.content[0].text.startsWith(`${prefix}Target answered HTTP 200: cloudflare served a challenge page`), res.content[0].text);
    });

    test('an Akamai access-denied 403 names akamai', async () => {
      const res = await call(handler, 403, AKAMAI);
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /Target answered HTTP 403: akamai served a challenge page/);
    });

    test("walmart's F5 Request Rejected page served as 444 names f5", async () => {
      const res = await call(handler, 444, F5);
      assert.equal(res.isError, true);
      assert.ok(res.content[0].text.startsWith(`${prefix}Target answered HTTP 444: f5 served a challenge page`), res.content[0].text);
    });

    test('a 503 with a plain body fails with the status alone', async () => {
      const res = await call(handler, 503, 'Service Unavailable', 'text/plain');
      assert.equal(res.isError, true);
      assert.equal(res.content[0].text, `${prefix}Target answered HTTP 503`);
    });

    test('a non-textual error body is not read for a verdict', async () => {
      const res = await call(handler, 403, CLOUDFLARE, 'application/octet-stream');
      assert.equal(res.content[0].text, `${prefix}Target answered HTTP 403`);
    });

    test('an empty shell on a 200 is not raised', async () => {
      const res = await call(handler, 200, EMPTY_SHELL);
      assert.equal(res.isError, undefined, res.content[0].text);
    });
  });
}

/** Robots.txt answers 404; the page request goes to `page(init)`. */
function mockPageFetch(page) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    if (url.endsWith('/robots.txt')) {
      return { ok: false, status: 404, statusText: 'Not Found', url, headers: new Headers(), text: async () => '' };
    }
    return page(init);
  };
  return () => { globalThis.fetch = orig; };
}

for (const [tool, handler, prefix] of HANDLERS) {
  describe(`${tool}: a target that never answers`, () => {
    test('a fetch held past the 15 s timeout fails naming the timeout', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let requested;
      const pageRequested = new Promise((resolve) => { requested = resolve; });
      // What undici does when the signal fires: reject with an AbortError.
      const restore = mockPageFetch((init) => new Promise((_, reject) => {
        requested();
        init.signal.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
      }));
      try {
        const pending = handler({ url: nextUrl() });
        await pageRequested;
        t.mock.timers.tick(LADDER_TIMEOUT_MS);
        const res = await pending;
        assert.equal(res.isError, true);
        assert.equal(res.content[0].text, `${prefix}Request timeout after ${LADDER_TIMEOUT_MS}ms`);
      } finally {
        restore();
      }
    });

    test('an unreachable host fails naming the URL and the cause', async () => {
      const url = nextUrl();
      const host = new URL(url).hostname;
      // undici's shape: a bare "fetch failed" with the reason in `cause`.
      const restore = mockPageFetch(async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
        });
      });
      try {
        const res = await handler({ url });
        assert.equal(res.isError, true);
        assert.equal(res.content[0].text, `${prefix}Could not reach ${url} (getaddrinfo ENOTFOUND ${host})`);
      } finally {
        restore();
      }
    });
  });
}

describe('a 200 page extracts as before', () => {
  test('extract_links', async () => {
    const res = await call(extractLinksHandler, 200, PAGE);
    assert.equal(res.isError, undefined, res.content[0].text);
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.total_count, 1);
    assert.match(data.links[0].href, /\/about$/);
  });

  test('extract_text', async () => {
    const res = await call(extractTextHandler, 200, PAGE);
    assert.equal(res.isError, undefined, res.content[0].text);
    const data = JSON.parse(res.content[0].text);
    assert.match(data.text, /A real page with enough text/);
  });
});

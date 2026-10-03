/**
 * extract_text / extract_links on scrape's fetch ladder (fix plan Phase E2):
 * escalate:true runs the stealth stage only on a wall (named vendor, 403,
 * 429, 444, a failed 2xx) and never on a 404, a 5xx or while a Retry-After
 * window is open; the charge is 1 unless
 * the stage ran (then 6); a binary body is UNSUPPORTED_CONTENT_TYPE without
 * escalating; JSON comes back with a note; a short Retry-After is waited out
 * once; an empty client-rendered shell succeeds with rendered:false.
 *
 * The REAL handlers and fetchWithTimeout run against a local HTTP server; the
 * stealth stage is a FAKE injected in place of server.js's stealthEscalation,
 * so no browser launches.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/fetchLadder.test.js
 */

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { createExtractTextHandler } = await import('../../src/tools/basic/extractText.js');
const { createExtractLinksHandler } = await import('../../src/tools/basic/extractLinks.js');
const { CLIENT_RENDERED_WARNING, isClientRenderedShell } = await import('../../src/utils/fetchLadder.js');
const { requestContext, reportedActualCost } = await import('../../src/server/requestContext.js');
const { appendFallbackHint, SCRAPE_ESCALATED_HINT } = await import('../../src/server/fallbackHints.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');
const { default: authManager } = await import('../../src/core/AuthManager.js');

const BLOCKED = fileURLToPath(new URL('../fixtures/blocked/', import.meta.url));
const CLOUDFLARE = readFileSync(`${BLOCKED}cloudflare.html`, 'utf8');
const EMPTY_SHELL = readFileSync(`${BLOCKED}empty-shell.html`, 'utf8');

const PAGE = '<!doctype html><html><head><title>Docs</title></head><body><main>' +
  '<p>' + 'A real page with enough text to be the page. '.repeat(10) + '</p>' +
  '<a href="/about">About</a></main></body></html>';
const RENDERED = '<!doctype html><html><head><title>Rendered</title></head><body><main>' +
  '<p>' + 'The content the wall was hiding. '.repeat(20) + '</p>' +
  '<a href="https://other.example/x">Out</a></main></body></html>';
const ERROR_PAGE = (title) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;

let server;
let baseUrl;
const hits = new Map();

// path → [status, body, headers]; a function is called with the hit count.
const ROUTES = {
  '/page': () => [200, PAGE],
  '/cloudflare': () => [200, CLOUDFLARE],
  '/bare-403': () => [403, ERROR_PAGE('403 Forbidden')],
  '/rate-limited': () => [429, ERROR_PAGE('Too Many Requests')],
  '/refused': () => [444, ''],
  '/missing': () => [404, ERROR_PAGE('Not Found')],
  '/broken': () => [503, ERROR_PAGE('Service Unavailable')],
  '/empty-shell': () => [200, EMPTY_SHELL],
  '/pdf': () => [200, '%PDF-1.4 binary', { 'Content-Type': 'application/pdf' }],
  '/png': () => [200, 'PNG', { 'Content-Type': 'image/png' }],
  '/json': () => [200, '{"items":[{"id":1,"name":"a"}]}', { 'Content-Type': 'application/json; charset=utf-8' }],
  '/rss': () => [200, '<rss><channel><title>Feed</title><item><title>One</title></item></channel></rss>', { 'Content-Type': 'application/rss+xml' }],
  '/retry-short': (n) => (n === 1 ? [429, ERROR_PAGE('Too Many Requests'), { 'Retry-After': '1' }] : [200, PAGE]),
  '/retry-zero-503': () => [503, ERROR_PAGE('Service Unavailable'), { 'Retry-After': '0' }],
  '/retry-long': (n) => (n === 1 ? [429, ERROR_PAGE('Too Many Requests'), { 'Retry-After': '30' }] : [200, PAGE]),
  '/retry-again': () => [429, ERROR_PAGE('Too Many Requests'), { 'Retry-After': '0' }],
  '/retry-then-bare': (n) => (n === 1 ? [429, ERROR_PAGE('Too Many Requests'), { 'Retry-After': '0' }] : [429, ERROR_PAGE('Too Many Requests')]),
  '/binary-403': () => [403, 'denied', { 'Content-Type': 'application/octet-stream' }]
};

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('User-agent: *\nAllow: /\n');
    }
    const n = (hits.get(path) ?? 0) + 1;
    hits.set(path, n);
    const [status, body, headers = {}] = (ROUTES[path] ?? (() => [404, ERROR_PAGE('Not Found')]))(n);
    res.writeHead(status, { 'Content-Type': 'text/html', ...headers });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// Every test uses the same host; a Retry-After one test recorded must not
// throttle the next.
afterEach(() => {
  hits.clear();
  _resetHostRateLimiter();
});

/** A stealth stage that never launches a browser. */
function fakeEscalator({ html = RENDERED, status = 200, engine = 'chromium', text } = {}) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    return { html, url: args.url, title: 'Rendered', text: text ?? 'The content the wall was hiding. '.repeat(20), status, engine, warnings: [] };
  };
  fn.calls = calls;
  return fn;
}

/** Run a handler inside a request context so setActualCost has somewhere to write. */
async function run(handler, params) {
  let result;
  let reported;
  await requestContext.run({ preflightRefusal: null, actualCost: null }, async () => {
    result = await handler(params);
    reported = reportedActualCost();
  });
  const text = result.content[0].text;
  let body = null;
  try { body = JSON.parse(text); } catch { /* plain-text error */ }
  return { result, body, text, reported };
}

const TOOLS = [
  ['extract_text', createExtractTextHandler, 'Failed to extract text: '],
  ['extract_links', createExtractLinksHandler, 'Failed to extract links: ']
];

for (const [tool, create, prefix] of TOOLS) {
  describe(`${tool}: escalation`, () => {
    test('a wall without escalate fails as before and never calls the stage', async () => {
      const stage = fakeEscalator();
      const { result, text, reported } = await run(create({ escalateFetch: stage }), { url: `${baseUrl}/cloudflare` });
      assert.equal(result.isError, true);
      assert.ok(text.startsWith(`${prefix}Target answered HTTP 200: cloudflare served a challenge page`), text);
      assert.equal(stage.calls.length, 0);
      assert.equal(reported, null, 'no setActualCost when escalate was not asked for');
    });

    for (const path of ['/cloudflare', '/bare-403', '/rate-limited', '/refused', '/empty-shell']) {
      test(`escalate:true on ${path} runs the stage and charges 6`, async () => {
        const stage = fakeEscalator();
        const { result, body, reported } = await run(create({ escalateFetch: stage }), { url: `${baseUrl}${path}`, escalate: true });
        assert.equal(result.isError, undefined, result.content[0].text);
        assert.equal(stage.calls.length, 1);
        assert.equal(stage.calls[0].engine, 'auto');
        assert.equal(body.escalated, true);
        assert.equal(body.stealth.engine, 'chromium');
        assert.equal('rendered' in body, false);
        assert.ok(body.warnings.some((w) => /^escalate: the plain fetch (was blocked by cloudflare|did not return the page); the chromium stealth browser returned it$/.test(w)), body.warnings.join('\n'));
        assert.equal(reported, 6);
        if (tool === 'extract_text') assert.match(body.text, /The content the wall was hiding/);
        else assert.equal(body.links[0].href, 'https://other.example/x');
      });
    }

    test('the warning names the vendor the plain fetch hit', async () => {
      const { body } = await run(create({ escalateFetch: fakeEscalator() }), { url: `${baseUrl}/cloudflare`, escalate: true });
      assert.equal(body.stealth.vendor_detected, 'cloudflare');
      assert.ok(body.warnings.includes('escalate: the plain fetch was blocked by cloudflare; the chromium stealth browser returned it'), body.warnings.join('\n'));
    });

    test('impit getting the page is named as such', async () => {
      const { body } = await run(create({ escalateFetch: fakeEscalator({ engine: 'impit' }) }), { url: `${baseUrl}/bare-403`, escalate: true });
      assert.ok(body.warnings.includes('escalate: the plain fetch did not return the page; a Chrome TLS handshake (impit, honest User-Agent) returned it'), body.warnings.join('\n'));
    });

    for (const path of ['/missing', '/broken']) {
      test(`escalate:true on ${path} never escalates and charges 1`, async () => {
        const stage = fakeEscalator();
        const { result, body, reported } = await run(create({ escalateFetch: stage }), { url: `${baseUrl}${path}`, escalate: true });
        assert.equal(result.isError, true);
        assert.equal(stage.calls.length, 0);
        assert.equal(body.escalated, false);
        assert.match(body.error, /^Target answered HTTP (404|503)$/);
        assert.equal(reported, 1);
      });
    }

    test('escalate:true on a page the plain fetch got: escalated:false, charge 1', async () => {
      const stage = fakeEscalator();
      const { result, body, reported } = await run(create({ escalateFetch: stage }), { url: `${baseUrl}/page`, escalate: true });
      assert.equal(result.isError, undefined);
      assert.equal(stage.calls.length, 0);
      assert.equal(body.escalated, false);
      assert.equal('stealth' in body, false);
      assert.equal(reported, 1);
    });

    test('a page without escalate carries no escalation fields', async () => {
      const { body } = await run(create(), { url: `${baseUrl}/page` });
      for (const key of ['escalated', 'stealth', 'rendered', 'warnings']) assert.equal(key in body, false, key);
    });

    test('still walled after the stage: a JSON error that gets the escalated hint', async () => {
      const stage = fakeEscalator({ html: CLOUDFLARE, text: '' });
      const { result, body, reported } = await run(create({ escalateFetch: stage }), { url: `${baseUrl}/cloudflare`, escalate: true });
      assert.equal(result.isError, true);
      assert.equal(body.success, false);
      assert.equal(body.escalated, true);
      assert.equal(body.blocked.vendor, 'cloudflare');
      assert.ok(body.warnings.some((w) => w.endsWith('did not get it either')));
      assert.equal(reported, 6);
      appendFallbackHint(tool, result);
      assert.equal(JSON.parse(result.content[0].text).next_step, SCRAPE_ESCALATED_HINT);
    });

    test('a bare 403 escalates whatever its body type', async () => {
      const stage = fakeEscalator();
      const { result, body } = await run(create({ escalateFetch: stage }), { url: `${baseUrl}/binary-403`, escalate: true });
      assert.equal(result.isError, undefined, result.content[0].text);
      assert.equal(stage.calls.length, 1);
      assert.equal(body.escalated, true);
    });

    for (const path of ['/retry-long', '/retry-again']) {
      test(`an open Retry-After window (${path}) is not overridden by the stage`, async () => {
        const stage = fakeEscalator();
        const { result, body, reported } = await run(create({ escalateFetch: stage }), { url: `${baseUrl}${path}`, escalate: true });
        assert.equal(result.isError, true);
        assert.equal(stage.calls.length, 0);
        assert.equal(body.escalated, false);
        assert.equal(body.error, 'Target answered HTTP 429');
        assert.equal(reported, 1);
      });
    }

    test('a retry answered without Retry-After still escalates', async () => {
      const stage = fakeEscalator();
      const { result } = await run(create({ escalateFetch: stage }), { url: `${baseUrl}/retry-then-bare`, escalate: true });
      assert.equal(result.isError, undefined, result.content[0].text);
      assert.equal(hits.get('/retry-then-bare'), 2);
      assert.equal(stage.calls.length, 1);
    });

    test('no stage wired: the warning says so and the charge stays 1', async () => {
      const { result, body, reported } = await run(create(), { url: `${baseUrl}/bare-403`, escalate: true });
      assert.equal(result.isError, true);
      assert.equal(body.escalated, false);
      assert.ok(body.warnings.includes('escalate: no stealth stage is wired into this server build'));
      assert.equal(reported, 1);
    });
  });

  describe(`${tool}: content-type gate`, () => {
    for (const path of ['/pdf', '/png']) {
      test(`${path} is UNSUPPORTED_CONTENT_TYPE and never escalates`, async () => {
        const stage = fakeEscalator();
        const { result, text, reported } = await run(create({ escalateFetch: stage }), { url: `${baseUrl}${path}`, escalate: true });
        assert.equal(result.isError, true);
        const type = path === '/pdf' ? 'application/pdf' : 'image/png';
        assert.ok(text.startsWith(`${prefix}UNSUPPORTED_CONTENT_TYPE: Unsupported content type ${type}: ${tool} reads ${tool === 'extract_links' ? 'HTML' : 'HTML and text'}\nNext step: process_document`), text);
        assert.equal(stage.calls.length, 0);
        assert.equal(reported, 1);
      });
    }

    test('application/rss+xml is read as text', async () => {
      const { result } = await run(create(), { url: `${baseUrl}/rss` });
      assert.equal(result.isError, undefined, result.content[0].text);
    });

    test('application/json comes back with a note', async () => {
      const { result, body } = await run(create(), { url: `${baseUrl}/json` });
      assert.equal(result.isError, undefined);
      if (tool === 'extract_text') {
        assert.equal(body.text, '{"items":[{"id":1,"name":"a"}]}');
        assert.deepEqual(body.warnings, ['the target returned application/json; its body is returned as text']);
      } else {
        assert.deepEqual(body.links, []);
        assert.deepEqual(body.warnings, ['the target returned application/json; it has no HTML links']);
      }
    });
  });

  describe(`${tool}: Retry-After`, () => {
    test('a 429 asking for 1 s is waited out and retried once', async () => {
      const started = Date.now();
      const { result } = await run(create(), { url: `${baseUrl}/retry-short` });
      assert.equal(result.isError, undefined, result.content[0].text);
      assert.equal(hits.get('/retry-short'), 2);
      assert.ok(Date.now() - started >= 900, `waited ${Date.now() - started} ms`);
    });

    test('a 503 is retried once, and only once', async () => {
      const { result, text } = await run(create(), { url: `${baseUrl}/retry-zero-503` });
      assert.equal(result.isError, true);
      assert.equal(text, `${prefix}Target answered HTTP 503`);
      assert.equal(hits.get('/retry-zero-503'), 2);
    });

    test('a Retry-After over 10 s is not waited for', async () => {
      const { result } = await run(create(), { url: `${baseUrl}/retry-long` });
      assert.equal(result.isError, true);
      assert.equal(hits.get('/retry-long'), 1);
    });

    test('no Retry-After, no retry', async () => {
      await run(create(), { url: `${baseUrl}/rate-limited` });
      assert.equal(hits.get('/rate-limited'), 1);
    });
  });

  describe(`${tool}: client-rendered shell`, () => {
    test('an empty #root on a 200 succeeds with rendered:false and the warning', async () => {
      const { result, body } = await run(create(), { url: `${baseUrl}/empty-shell` });
      assert.equal(result.isError, undefined, result.content[0].text);
      assert.equal(body.rendered, false);
      assert.deepEqual(body.warnings, [CLIENT_RENDERED_WARNING]);
    });
  });
}

describe('isClientRenderedShell', () => {
  test('#root, #app and #__next with no text are shells; text or no root is not', () => {
    for (const id of ['root', 'app', '__next']) {
      assert.equal(isClientRenderedShell(`<html><body><div id="${id}"></div><script>x()</script></body></html>`), true, id);
    }
    assert.equal(isClientRenderedShell('<html><body><div id="root"><p>Hello</p></div></body></html>'), false);
    assert.equal(isClientRenderedShell('<html><body><p>Short page.</p></body></html>'), false);
    assert.equal(isClientRenderedShell(`<html><body><div id="root"></div><p>${'x'.repeat(200)}</p></body></html>`), false);
  });

  test('a short page saying it needs JavaScript is a shell, with no mount point', () => {
    // scrapingcourse.com/javascript-rendering, condensed
    assert.equal(isClientRenderedShell('<html><body><h1>JS Rendering Challenge</h1><p>Enable JavaScript to see products</p><div id="product-grid"><div class="product-item"></div></div></body></html>'), true);
    assert.equal(isClientRenderedShell('<html><body><p>This site requires JavaScript.</p></body></html>'), true);
    assert.equal(isClientRenderedShell(`<html><body><p>Enable JavaScript for the comments.</p><p>${'x'.repeat(200)}</p></body></html>`), false);
  });
});

describe('price', () => {
  test('projected 1, or 1+5 with escalate:true', () => {
    for (const tool of ['extract_text', 'extract_links']) {
      assert.equal(authManager.getToolCost(tool, {}), 1);
      assert.equal(authManager.getToolCost(tool, { escalate: true }), 6);
      assert.equal(authManager.getToolCost(tool, { escalate: 'true' }), 1, 'only exactly true prices the stage');
    }
  });
});

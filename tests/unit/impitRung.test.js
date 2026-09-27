/**
 * Stealth review Phase 7: the impit step inside escalation
 * (src/utils/impitRung.js). A fake client stands in for impit, so nothing
 * here touches the network: the tests hold the identity it presents, the
 * verdict it applies, and the SSRF check on every redirect hop.
 *
 * ALLOWED_DOMAINS is set before config loads so example.com skips the DNS
 * lookup; the metadata address is refused regardless of the allowlist.
 *
 * Run: node --test --test-force-exit tests/unit/impitRung.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ALLOWED_DOMAINS = 'example.com,www.example.com';
delete process.env.SSRF_PROTECTION_ENABLED;

const { impitFetchPage, loadImpit, impitEnabled, IMPIT_ENGINE } = await import('../../src/utils/impitRung.js');
const { CRAWLFORGE_USER_AGENT } = await import('../../src/utils/fetchIdentity.js');

const PAGE = '<html><head><title>Real page</title></head><body><p>' +
  'The content a reader came for. '.repeat(40) + '</p></body></html>';
const CHALLENGE = '<html><head><title>Just a moment...</title></head><body>' +
  '<div id="challenge-running"></div>' +
  '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>';

/** A fake Impit that answers each fetch from a url → Response map. */
function fakeImpit(routes) {
  const seen = { options: null, urls: [] };
  class FakeImpit {
    constructor(options) { seen.options = options; }
    async fetch(url) {
      seen.urls.push(url);
      const route = routes[url];
      if (!route) throw new Error(`unexpected fetch ${url}`);
      if (route instanceof Error) throw route;
      return route();
    }
  }
  return { FakeImpit, seen };
}

const html = (body, status = 200) => () => new Response(body, { status, headers: { 'content-type': 'text/html' } });
const redirect = (location) => () => new Response(null, { status: 302, headers: { location } });

describe('impitFetchPage', () => {
  let savedProxies;
  beforeEach(() => { savedProxies = process.env.CRAWLFORGE_STEALTH_PROXIES; delete process.env.CRAWLFORGE_STEALTH_PROXIES; });
  afterEach(() => {
    if (savedProxies === undefined) delete process.env.CRAWLFORGE_STEALTH_PROXIES;
    else process.env.CRAWLFORGE_STEALTH_PROXIES = savedProxies;
  });

  test('presents a Chrome TLS profile with the honest CrawlForge User-Agent and follows no redirect itself', async () => {
    const { FakeImpit, seen } = fakeImpit({ 'https://example.com/a': html(PAGE) });
    await impitFetchPage('https://example.com/a', { Impit: FakeImpit });
    assert.match(seen.options.browser, /^chrome/);
    assert.equal(seen.options.headers['user-agent'], CRAWLFORGE_USER_AGENT);
    assert.equal(seen.options.followRedirects, false);
    assert.equal(seen.options.proxyUrl, undefined, 'no proxy unless the operator set one');
  });

  test('returns the page, named impit, when the verdict passes', async () => {
    const { FakeImpit } = fakeImpit({ 'https://example.com/a': html(PAGE) });
    const page = await impitFetchPage('https://example.com/a', { Impit: FakeImpit });
    assert.ok(page, 'a real page comes back');
    assert.equal(page.engine, IMPIT_ENGINE);
    assert.equal(page.status, 200);
    assert.equal(page.title, 'Real page');
    assert.equal(page.url, 'https://example.com/a');
    assert.match(page.text, /The content a reader came for/);
    assert.match(page.html, /<title>Real page<\/title>/);
  });

  test('returns null for a challenge page, so the browser runs', async () => {
    const { FakeImpit } = fakeImpit({ 'https://example.com/a': html(CHALLENGE, 403) });
    assert.equal(await impitFetchPage('https://example.com/a', { Impit: FakeImpit }), null);
  });

  test('returns null for a client-rendered shell whose visible text is only the app\'s fallback', async () => {
    // quora.com through impit: a normal title, 846 KB of HTML, and 59
    // characters of visible text. The verdict alone passed it.
    const shell = '<html><head><title>What is the best way to learn programming? - Quora</title></head><body>' +
      '<div id="root">Something went wrong. Wait a moment and try again.<button>Try again</button></div>' +
      `<script>window.__DATA__=${JSON.stringify('x'.repeat(5000))}</script></body></html>`;
    const { FakeImpit } = fakeImpit({ 'https://example.com/q': html(shell) });
    assert.equal(await impitFetchPage('https://example.com/q', { Impit: FakeImpit }), null);
  });

  test('returns null when the request itself fails', async () => {
    const { FakeImpit } = fakeImpit({ 'https://example.com/a': new Error('TLS handshake refused') });
    assert.equal(await impitFetchPage('https://example.com/a', { Impit: FakeImpit }), null);
  });

  test('follows a redirect hop by hop and reports the final URL', async () => {
    const { FakeImpit, seen } = fakeImpit({
      'https://example.com/a': redirect('/b'),
      'https://example.com/b': html(PAGE)
    });
    const page = await impitFetchPage('https://example.com/a', { Impit: FakeImpit });
    assert.deepEqual(seen.urls, ['https://example.com/a', 'https://example.com/b']);
    assert.equal(page.url, 'https://example.com/b');
  });

  test('refuses a redirect into the cloud metadata address before fetching it', async () => {
    const { FakeImpit, seen } = fakeImpit({
      'https://example.com/a': redirect('http://169.254.169.254/latest/meta-data/')
    });
    await assert.rejects(
      () => impitFetchPage('https://example.com/a', { Impit: FakeImpit }),
      (err) => err.code === 'SSRF_BLOCKED'
    );
    assert.deepEqual(seen.urls, ['https://example.com/a'], 'the metadata address was never requested');
  });

  test('gives up after too many redirects', async () => {
    const routes = {};
    for (let i = 0; i < 10; i++) routes[`https://example.com/${i}`] = redirect(`/${i + 1}`);
    const { FakeImpit } = fakeImpit(routes);
    assert.equal(await impitFetchPage('https://example.com/0', { Impit: FakeImpit }), null);
  });

  test('goes out through the operator\'s stealth proxy when one is set', async () => {
    process.env.CRAWLFORGE_STEALTH_PROXIES = 'http://proxy.example.net:8080, http://second.example.net:8080';
    const { FakeImpit, seen } = fakeImpit({ 'https://example.com/a': html(PAGE) });
    await impitFetchPage('https://example.com/a', { Impit: FakeImpit });
    assert.equal(seen.options.proxyUrl, 'http://proxy.example.net:8080');
  });
});

test('loadImpit finds the installed optional dependency', async () => {
  const Impit = await loadImpit();
  assert.equal(typeof Impit, 'function');
});

test('CRAWLFORGE_IMPIT=off turns the step off for a deployment; anything else leaves it on', () => {
  const saved = process.env.CRAWLFORGE_IMPIT;
  try {
    delete process.env.CRAWLFORGE_IMPIT;
    assert.equal(impitEnabled(), true);
    for (const value of ['off', 'OFF', ' off ']) {
      process.env.CRAWLFORGE_IMPIT = value;
      assert.equal(impitEnabled(), false, value);
    }
    for (const value of ['', 'on', 'true', '0']) {
      process.env.CRAWLFORGE_IMPIT = value;
      assert.equal(impitEnabled(), true, value);
    }
  } finally {
    if (saved === undefined) delete process.env.CRAWLFORGE_IMPIT;
    else process.env.CRAWLFORGE_IMPIT = saved;
  }
});

test('server.js asks impitEnabled() before the impit try', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  const stage = src.slice(src.indexOf('const stealthEscalation = async'));
  assert.match(stage, /if \(engine === 'auto' && impitEnabled\(\) && await loadImpit\(\)\)/);
  assert.ok(stage.indexOf('impitEnabled()') < stage.indexOf('impitFetchPage('), 'the switch is read before the request');
});

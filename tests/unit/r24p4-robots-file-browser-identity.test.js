/**
 * R24 Phase 4, items 4.2 and 4.6.
 *
 * 4.2 — robots.txt itself is exempt from the robots gate. A site whose
 * robots.txt disallows everything (lobste.rs, imdb.com) refused the one fetch
 * that shows a caller why. Exactly /robots.txt with no query passes; every
 * other path is still decided, including where a redirect from it lands.
 *
 * 4.6 — the non-stealth browser's identity. BrowserProcessor.createPage sent
 * the binary's "HeadlessChrome" UA, no Accept-Language, and a
 * Content-Security-Policy REQUEST header. It now sends the binary's UA with
 * "Chrome" and the CrawlForge token appended (a caller's userAgent still
 * wins), a real Accept-Language, and no CSP header.
 *
 * Local HTTP server, so ALLOWED_DOMAINS is set before config.js loads.
 * Run: node --test --test-force-exit tests/unit/r24p4-robots-file-browser-identity.test.js
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1,localhost';
delete process.env.SSRF_PROTECTION_ENABLED;

const { _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');
const { RobotsChecker } = await import('../../src/utils/robotsChecker.js');
const { fetchWithTimeout } = await import('../../src/tools/basic/_fetch.js');
const { browserUserAgent, CRAWLFORGE_USER_AGENT } = await import('../../src/utils/fetchIdentity.js');
const { BrowserProcessor } = await import('../../src/core/processing/BrowserProcessor.js');

const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';

let server;
let port;
let seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    const host = req.headers.host.split(':')[0];
    seen.push({ host, path: pathname, url: req.url, headers: req.headers });
    if (pathname === '/headers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(req.headers));
    }
    // localhost: robots.txt redirects to a path robots.txt disallows.
    if (host === 'localhost' && pathname === '/robots.txt') {
      res.writeHead(302, { Location: '/not-robots' });
      return res.end();
    }
    if (pathname === '/robots.txt' || pathname === '/not-robots') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(DISALLOW_ALL);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>page</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

beforeEach(() => {
  _resetRobotsGate();
  _resetHostRateLimiter();
  seen = [];
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

describe('4.2 robots.txt is not subject to robots.txt', () => {
  test('isRobotsFile is exactly /robots.txt with no query', () => {
    assert.equal(RobotsChecker.isRobotsFile('https://lobste.rs/robots.txt'), true);
    assert.equal(RobotsChecker.isRobotsFile('https://lobste.rs/robots.txt#x'), true);
    assert.equal(RobotsChecker.isRobotsFile('https://lobste.rs/robots.txt?x=1'), false);
    assert.equal(RobotsChecker.isRobotsFile('https://lobste.rs/a/robots.txt'), false);
    assert.equal(RobotsChecker.isRobotsFile('https://lobste.rs/robots.txt/'), false);
    assert.equal(RobotsChecker.isRobotsFile('https://lobste.rs/'), false);
  });

  test('on a disallow-all host, /robots.txt is fetched and / is still refused', async () => {
    const base = `http://127.0.0.1:${port}`;
    const file = await fetchWithTimeout(`${base}/robots.txt`, { tool: 'fetch_url' });
    assert.equal(file.status, 200);
    assert.equal(await file.text(), DISALLOW_ALL);

    for (const path of ['/', '/page', '/robots.txt?x=1']) {
      await assert.rejects(
        () => fetchWithTimeout(`${base}${path}`, { tool: 'fetch_url' }),
        (err) => err.code === 'ROBOTS_DISALLOWED',
        `${path} must still be refused`
      );
    }
    assert.equal(seen.some((r) => r.path === '/page' || r.url === '/robots.txt?x=1'), false,
      'a refused path is never requested');
  });

  test('a /robots.txt that redirects to another path is refused at the hop', async () => {
    await assert.rejects(
      () => fetchWithTimeout(`http://localhost:${port}/robots.txt`, { tool: 'fetch_url' }),
      (err) => err.code === 'ROBOTS_DISALLOWED' && /redirects to .*\/not-robots/.test(err.message)
    );
  });
});

describe('4.6 non-stealth browser identity', () => {
  const HEADLESS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.7922.34 Safari/537.36';

  test('browserUserAgent spells Chrome and appends the canonical token', () => {
    assert.equal(
      browserUserAgent(HEADLESS),
      `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36 ${CRAWLFORGE_USER_AGENT}`
    );
  });

  /** A BrowserProcessor whose browser records the context options it is given. */
  function fakeProcessor() {
    const processor = new BrowserProcessor();
    const contexts = [];
    processor._browserUserAgent = HEADLESS;
    processor.browser = {
      newContext: async (options) => {
        const ctx = {
          options,
          extraHeaderCalls: [],
          setExtraHTTPHeaders: async (h) => { ctx.extraHeaderCalls.push(h); },
          addCookies: async () => {},
          newPage: async () => ({ route: async () => {}, addInitScript: async () => {} })
        };
        contexts.push(ctx);
        return ctx;
      }
    };
    return { processor, contexts };
  }

  test('createPage: honest Chrome UA, Accept-Language, no CSP request header', async () => {
    const { processor, contexts } = fakeProcessor();
    await processor.createPage({});
    const [ctx] = contexts;
    assert.equal(ctx.options.userAgent, browserUserAgent(HEADLESS));
    assert.doesNotMatch(ctx.options.userAgent, /Headless/);
    assert.equal(ctx.options.extraHTTPHeaders['Accept-Language'], 'en-US,en;q=0.9');
    assert.ok(!('javaScriptEnabled' in ctx.options), 'scripts stay on unless asked off');
    assert.deepEqual(ctx.extraHeaderCalls, [], 'no header is set on the context after creation');
  });

  test('createPage: a caller userAgent and headers win; a locale brings its own language', async () => {
    const { processor, contexts } = fakeProcessor();
    await processor.createPage({ userAgent: 'Mine/1.0', extraHeaders: { 'Accept-Language': 'fr-FR' } });
    await processor.createPage({ locale: 'de-DE', extraHeaders: { 'Accept-Language': 'de-DE,de;q=0.9' } });
    assert.equal(contexts[0].options.userAgent, 'Mine/1.0');
    assert.equal(contexts[0].options.extraHTTPHeaders['Accept-Language'], 'fr-FR');
    assert.deepEqual(contexts[1].options.extraHTTPHeaders, { 'Accept-Language': 'de-DE,de;q=0.9' });
  });

  test('createPage: enableJavaScript:false turns scripts off in the browser, not by header', async () => {
    const { processor, contexts } = fakeProcessor();
    await processor.createPage({ enableJavaScript: false });
    assert.equal(contexts[0].options.javaScriptEnabled, false);
    assert.deepEqual(contexts[0].extraHeaderCalls, []);
  });

  test('real Chromium: the wire carries the honest UA, Accept-Language, matching platform, no CSP', async (t) => {
    const processor = new BrowserProcessor();
    try {
      await processor.initBrowser();
    } catch {
      t.skip('no Chromium binary available');
      return;
    }
    try {
      const page = await processor.createPage({ enableImages: true });
      await page.goto(`http://127.0.0.1:${port}/headers`);
      const headers = JSON.parse(await page.textContent('body'));
      await page.context().close();

      const ua = headers['user-agent'];
      assert.doesNotMatch(ua, /HeadlessChrome/);
      assert.match(ua, /Chrome\/\d+/);
      assert.ok(ua.endsWith(` ${CRAWLFORGE_USER_AGENT}`), ua);
      assert.equal(headers['accept-language'], 'en-US,en;q=0.9');
      assert.equal(headers['content-security-policy'], undefined);
      // Chromium derives Sec-Ch-Ua-Platform from the binary; the UA is the
      // binary's own, so the two name the same platform.
      const platform = { '"macOS"': /Macintosh/, '"Linux"': /Linux/, '"Windows"': /Windows/ }[headers['sec-ch-ua-platform']];
      assert.ok(platform, `unexpected platform ${headers['sec-ch-ua-platform']}`);
      assert.match(ua, platform);
    } finally {
      await processor.browser?.close();
    }
  });
});

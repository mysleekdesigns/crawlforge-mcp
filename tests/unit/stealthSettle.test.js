/**
 * Regression lock: a stealth scrape waits for the page to stop changing.
 *
 * scrapeWithStealth navigates with waitUntil:'domcontentloaded' and then waits
 * only for the document to become non-empty (_waitOutEmptyDocument) or to stop
 * being an interstitial (_waitOutChallenge). Neither notices a page that
 * already has prose and writes the part the caller came for a moment later, so
 * the read could land mid-render and a half-finished page came back as a
 * successful scrape.
 *
 * The 6.6.2 bench read exactly this as a format bug — "markdown silently
 * dropped the verdict, text captured it" — but the two calls it compared were
 * two page loads, and only one of them raced. One call asking for markdown and
 * text returns the same content in both, because both are built from the same
 * render. The defect was the timing, not the format, and that distinction
 * matters: the bench's conclusion would have put a false rule in the docs.
 *
 * Loopback needs ALLOWED_DOMAINS before the first transitive import of
 * src/constants/config.js, as in tests/unit/stealthScrape.test.js. node --test
 * gives each file its own subprocess, so it does not leak into sibling tests.
 *
 * Run: node --test --test-force-exit tests/unit/stealthSettle.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { StealthBrowserManager } = await import('../../src/core/StealthBrowserManager.js');

const LATE_MARKER = 'VERDICT_RENDERED_LATE';
const SUBRESOURCE_DELAY_MS = 900;

// Prose in the initial HTML, so the document is never empty and every wait
// before the settle passes it as finished. The marker is written by a load
// handler, and an image the server holds back keeps the load event away from
// DOMContentLoaded — the ordinary shape of a page whose payload is rendered by
// something navigation does not wait for. (A `defer` script would not do: those
// run BEFORE DOMContentLoaded, so goto would have waited for it already.)
const PAGE = `<!doctype html><html><head><title>Late render</title></head><body>
  <h1>Bot detection results</h1>
  <p>This paragraph is in the initial HTML, so the document is never empty.</p>
  <div id="verdict"></div>
  <img src="/slow.png" alt="">
  <script>
    window.addEventListener('load', function () {
      document.getElementById('verdict').textContent = '${LATE_MARKER}';
    });
  </script>
</body></html>`;

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nAllow: /\n');
      return;
    }
    if (path === '/slow.png') {
      // A 1x1 GIF, held back so the load event lands well after DOMContentLoaded.
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'image/gif' });
        res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
      }, SUBRESOURCE_DELAY_MS);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('content that renders after DOMContentLoaded is captured', () => {
  test('the late verdict is in the text AND the html of the same scrape', async (t) => {
    const manager = new StealthBrowserManager();
    t.after(async () => { await manager.cleanup().catch(() => {}); });

    const scraped = await manager.scrapeWithStealth({ url: `${baseUrl}/late`, engine: 'chromium' });

    assert.match(scraped.text, new RegExp(LATE_MARKER), 'innerText has the late content');
    assert.match(scraped.html, new RegExp(LATE_MARKER),
      'and so does the HTML — both are read from one render, so they cannot disagree');
    assert.ok(scraped.gracedMs >= SUBRESOURCE_DELAY_MS - 200,
      `the extra wait is reported (gracedMs was ${scraped.gracedMs})`);
  });

  test('a page that is already finished is not waited on', async (t) => {
    const manager = new StealthBrowserManager();
    t.after(async () => { await manager.cleanup().catch(() => {}); });

    const still = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><head><title>Static</title></head><body><p>done</p></body></html>');
    });
    await new Promise((resolve) => still.listen(0, '127.0.0.1', resolve));
    t.after(async () => { await new Promise((resolve) => still.close(resolve)); });

    const scraped = await manager.scrapeWithStealth({
      url: `http://127.0.0.1:${still.address().port}/`,
      engine: 'chromium'
    });
    assert.match(scraped.text, /done/);
    assert.ok(scraped.gracedMs < 150,
      `a settled page is barely waited on (gracedMs was ${scraped.gracedMs})`);
  });
});

describe('the settle survives a page it cannot reach', () => {
  test('a page that throws returns 0 rather than failing the scrape', async () => {
    const manager = new StealthBrowserManager();
    const page = {
      waitForLoadState: async () => { throw new Error('Target page, context or browser has been closed'); },
      evaluate: async () => { throw new Error('Target page, context or browser has been closed'); }
    };
    assert.equal(await manager._settleDom(page), 0);
    assert.ok(await manager._settleRender(page) < 150, 'and the whole settle gives up quickly');
  });
});

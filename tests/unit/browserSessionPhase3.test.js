/**
 * browser_session and scrape_with_actions against pages that move under them
 * (live sweep 2026-10-20, Phase 3 items 3.2, 3.3 and 3.4).
 *
 *   3.2 — a page that swaps an input out after load: the first snapshot's ref
 *         still types into the input that is there now.
 *   3.3 — a refused `navigate`, refused before it leaves (a blocked address)
 *         or partway (a redirect hop to one), leaves a logged-in session on
 *         its logged-in page.
 *   3.4 — `selector@value` reads what was typed, not the attribute.
 *
 * Real Chromium through the real guarded proxy, as browserSsrfProxy.test.js
 * does: the fixture site is served as `localhost` (allowlisted, standing in for
 * a public site) and the refused target is 127.0.0.1, which is not. Skips when
 * Chromium is not installed. ALLOWED_DOMAINS is set before the first import of
 * config.js.
 *
 * Run: node --test --test-force-exit tests/unit/browserSessionPhase3.test.js
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = 'localhost';
delete process.env.SSRF_PROTECTION_ENABLED;
delete process.env.SSRF_STRICT;
delete process.env.CRAWLFORGE_STEALTH_PROXIES;

const { ActionExecutor } = await import('../../src/core/ActionExecutor.js');
const { BrowserSessionTool } = await import('../../src/tools/advanced/BrowserSessionTool.js');
const { BrowserSessionStore } = await import('../../src/core/browser/SessionStore.js');
const ExtractContentTool = (await import('../../src/tools/extract/extractContent.js')).default;
const { ScrapeWithActionsTool } = await import('../../src/tools/advanced/ScrapeWithActionsTool.js');
const { requestContext } = await import('../../src/server/requestContext.js');
const { _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');

let hasChromium = false;
try {
  const { chromium } = await import('playwright');
  await (await chromium.launch()).close();
  hasChromium = true;
} catch { /* no browser binary — the suites skip */ }

/** The address nothing may reach. */
let hits = [];
let listener;
let L;
let site;
let base;

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => { server.closeAllConnections?.(); return new Promise((resolve) => server.close(resolve)); };

const PAGES = {
  // The search box is replaced 300 ms after load by a new element with the
  // same role and name, as Wikipedia's is. Typing into the new one echoes.
  '/replace': `<html><head><title>Replace</title></head><body>
<input id="q" aria-label="Search">
<div id="echo"></div>
<script>
  addEventListener('load', () => setTimeout(() => {
    const fresh = document.createElement('input');
    fresh.setAttribute('aria-label', 'Search');
    fresh.oninput = () => { echo.textContent = 'typed:' + fresh.value; };
    q.replaceWith(fresh);
  }, 300));
</script>
</body></html>`,
  // The same swap, done on demand by a button, so the test can make it
  // happen after the snapshot instead of racing the page's timer.
  '/swap': `<html><head><title>Swap</title></head><body>
<input id="q" aria-label="Search">
<button id="swap" onclick="swapNow()">Swap</button>
<div id="echo"></div>
<script>
  function swapNow() {
    const fresh = document.createElement('input');
    fresh.setAttribute('aria-label', 'Search');
    fresh.oninput = () => { echo.textContent = 'typed:' + fresh.value; };
    document.querySelector('input').replaceWith(fresh);
  }
</script>
</body></html>`,
  // The swap leaves two inputs named "Search": re-resolving would be a guess.
  '/swap-twice': `<html><head><title>Swap twice</title></head><body>
<input id="q" aria-label="Search">
<button id="swap" onclick="swapNow()">Swap</button>
<script>
  function swapNow() {
    const make = () => { const el = document.createElement('input'); el.setAttribute('aria-label', 'Search'); return el; };
    q.replaceWith(make(), make());
  }
</script>
</body></html>`,
  '/form': `<html><head><title>Form</title></head><body>
<input type="number" id="qty" value="1">
<textarea id="note"></textarea>
<a id="home" href="/home">Home</a>
</body></html>`
};

before(async () => {
  listener = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<p>internal</p>');
  });
  L = await listen(listener);

  site = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    if (pathname === '/robots.txt') {
      res.writeHead(404);
      return res.end();
    }
    if (pathname === '/login') {
      res.writeHead(302, { 'Set-Cookie': 'sid=alice; Path=/', Location: '/account' });
      return res.end();
    }
    if (pathname === '/account') {
      const loggedIn = /(?:^|;\s*)sid=alice/.test(req.headers.cookie || '');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<html><head><title>Account</title></head><body><p>${
        loggedIn ? 'Signed in as alice' : 'Please sign in'
      }</p></body></html>`);
    }
    if (pathname === '/redirect') {
      res.writeHead(302, { Location: `http://127.0.0.1:${L}/hop` });
      return res.end();
    }
    if (pathname === '/redirect-tls') {
      res.writeHead(302, { Location: `https://127.0.0.1:${L}/hop` });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGES[pathname] || '<html><body>not a fixture</body></html>');
  });
  base = `http://localhost:${await listen(site)}`;
});

beforeEach(() => {
  hits = [];
  _resetRobotsGate();
  _resetHostRateLimiter();
});

after(async () => {
  await close(listener);
  await close(site);
});

describe('browser_session', { skip: !hasChromium && 'Chromium not installed' }, () => {
  let executor;
  let extractContentTool;
  let store;
  let tool;
  before(() => {
    executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
    extractContentTool = new ExtractContentTool();
    store = new BrowserSessionStore();
    tool = new BrowserSessionTool({ store, actionExecutor: executor, extractContentTool, enableLogging: false });
  });
  after(async () => {
    await store.destroy();
    await executor.destroy().catch(() => {});
    await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    await extractContentTool.browserProcessor?.localizationManager?.cleanup().catch(() => {});
  });

  const call = (operation, extra = {}) => tool.execute({ operation, ...extra });

  test('3.2: the first snapshot\'s ref types into an input the page replaced after load', async () => {
    const { sessionId } = await call('open', { url: `${base}/replace` });
    try {
      const snapshot = await call('snapshot', { session_id: sessionId });
      assert.match(snapshot.snapshot.tree, /@e1 \[textbox\] "Search"/, snapshot.snapshot.tree);
      const acted = await call('act', {
        session_id: sessionId,
        actions: [{ type: 'type', selector: '@e1', text: 'hello', retries: 0 }]
      });
      assert.equal(acted.success, true, acted.error);
      const read = await call('read', { session_id: sessionId, formats: ['text'] });
      assert.match(read.content.text, /typed:hello/);
    } finally {
      await call('close', { session_id: sessionId });
    }
  });

  test('3.2: a ref whose element was replaced after the snapshot is re-resolved by role and name', async () => {
    const { sessionId } = await call('open', { url: `${base}/swap` });
    try {
      const snapshot = await call('snapshot', { session_id: sessionId });
      assert.match(snapshot.snapshot.tree, /@e1 \[textbox\] "Search"/, snapshot.snapshot.tree);
      // A CSS click, not a ref: the snapshot's refs stay as they were.
      const swapped = await call('act', { session_id: sessionId, actions: [{ type: 'click', selector: '#swap' }] });
      assert.equal(swapped.success, true, swapped.error);

      const acted = await call('act', {
        session_id: sessionId,
        actions: [{ type: 'type', selector: '@e1', text: 'hello', retries: 0 }]
      });
      assert.equal(acted.success, true, acted.error);
      const read = await call('read', { session_id: sessionId, formats: ['text'] });
      assert.match(read.content.text, /typed:hello/);
    } finally {
      await call('close', { session_id: sessionId });
    }
  });

  test('3.2: a ref detached mid-action ("not attached to the DOM") is re-resolved and the action run again', async () => {
    const { sessionId } = await call('open', { url: `${base}/swap` });
    const original = executor.executeActionByType;
    try {
      await call('snapshot', { session_id: sessionId });
      const { page } = store.get(sessionId, tool.ownerId());
      // The swap lands while the action is running, as Wikipedia's did: the
      // first attempt replaces the input and fails the way Playwright does.
      let attempts = 0;
      executor.executeActionByType = async function (...args) {
        if (++attempts === 1) {
          await page.click('#swap');
          throw new Error('locator.pressSequentially: Element is not attached to the DOM');
        }
        return original.apply(this, args);
      };

      const acted = await call('act', {
        session_id: sessionId,
        actions: [{ type: 'type', selector: '@e1', text: 'hello', retries: 0 }]
      });
      assert.equal(acted.success, true, acted.error);
      assert.equal(attempts, 2, 'run once more, not more');
      const read = await call('read', { session_id: sessionId, formats: ['text'] });
      assert.match(read.content.text, /typed:hello/);
    } finally {
      executor.executeActionByType = original;
      await call('close', { session_id: sessionId });
    }
  });

  test('3.2: a replaced ref with no unique role-and-name match still fails', async () => {
    const { sessionId } = await call('open', { url: `${base}/swap-twice` });
    try {
      await call('snapshot', { session_id: sessionId });
      await call('act', { session_id: sessionId, actions: [{ type: 'click', selector: '#swap' }] });
      const acted = await call('act', {
        session_id: sessionId,
        actions: [{ type: 'type', selector: '@e1', text: 'hello', retries: 0, timeout: 2000 }]
      });
      assert.equal(acted.success, false, 'two candidates: no guess');
    } finally {
      await call('close', { session_id: sessionId });
    }
  });

  for (const [label, target] of [
    ['a blocked address, refused before it leaves', () => `http://127.0.0.1:${L}/admin`],
    ['a redirect hop to a blocked address, refused partway', () => `${base}/redirect`],
    ['an https redirect hop to a blocked address, refused partway', () => `${base}/redirect-tls`]
  ]) {
    test(`3.3: ${label}: the logged-in page survives`, async () => {
      const { sessionId } = await call('open', { url: `${base}/login` });
      try {
        const before = await call('read', { session_id: sessionId, formats: ['text'] });
        assert.match(before.content.text, /Signed in as alice/);

        const acted = await call('act', { session_id: sessionId, actions: [{ type: 'navigate', url: target() }] });
        assert.equal(acted.success, false, 'the navigate is refused');
        assert.deepEqual(hits, [], 'the blocked address was never requested');
        // Refused up front, the page never left; refused partway, it was
        // reloaded, and the caller is told which.
        if (label.includes('partway')) assert.match(acted.error, /returned to .*\/account/);
        else assert.doesNotMatch(acted.error, /returned to/);

        const after = await call('read', { session_id: sessionId, formats: ['text'] });
        assert.equal(new URL(after.url).pathname, '/account', after.url);
        assert.match(after.content.text, /Signed in as alice/);
      } finally {
        await call('close', { session_id: sessionId });
      }
    });
  }
});

describe('scrape_with_actions', { skip: !hasChromium && 'Chromium not installed' }, () => {
  let executor;
  let extractContentTool;
  let tool;
  before(() => {
    executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
    extractContentTool = new ExtractContentTool();
    tool = new ScrapeWithActionsTool({ actionExecutor: executor, extractContentTool, enableLogging: false });
  });
  after(async () => {
    await executor.destroy().catch(() => {});
    await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    await extractContentTool.browserProcessor?.localizationManager?.cleanup().catch(() => {});
  });

  test('3.4: @value reads what was typed; other @attr reads the attribute', async () => {
    const result = await requestContext.run({ preflightRefusal: null }, () => tool.execute({
      url: `${base}/form`,
      actions: [
        { type: 'type', selector: '#qty', text: '42', clear: true },
        { type: 'type', selector: '#note', text: 'a note' }
      ],
      formats: ['json'],
      extractionOptions: {
        selectors: {
          qty: 'input[type=number]@value',
          note: '#note@value',
          type: '#qty@type',
          href: '#home@href',
          missing: '#home@data-none',
          text: '#home'
        }
      }
    }));
    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.content.json.extracted, {
      qty: '42',
      note: 'a note',
      type: 'number',
      href: '/home',
      missing: null,
      text: 'Home'
    });
  });
});

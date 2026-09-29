/**
 * Unit tests: the render wait before a snapshot and after an interaction
 * (ACTIONS_EMBEDDED_STATE_FIX_PLAN.md — 1.1).
 * Run: node --test --test-force-exit tests/unit/core/browserSettle.test.js
 *
 * Whether a page is quiet is a question only a real page can answer — DOM
 * mutations and request events come from the browser — so these run against a
 * local http server and skip when Chromium isn't installed, the same shape as
 * tests/unit/core/browserSnapshot.test.js.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const {
  settlePage,
  trackRequests,
  QUIET_CAP_MS,
  NETWORK_QUIET_MS
} = await import('../../../src/core/browser/settle.js');
const { captureSnapshot } = await import('../../../src/core/browser/snapshot.js');
const { ActionExecutor } = await import('../../../src/core/ActionExecutor.js');

let browser = null;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
} catch {
  browser = null; // no browser binary available — the whole file skips
}

// Renders its only button after a fetch that takes 400 ms — after `load`, so a
// walk at domcontentloaded or load finds nothing.
const RENDER_LATE = `<html><body style="margin:0"><div id="app"></div><script>
fetch('/data?delay=400').then((r) => r.text()).then(() => {
  app.innerHTML = '<button id="late">Rendered late</button>';
});
</script></body></html>`;

const PAGES = {
  '/static': '<html><head><title>Static</title></head><body><button>Go</button></body></html>',
  '/render-late': RENDER_LATE,
  // Never stops mutating: the DOM window can never close.
  '/churn': `<html><body><div id="tick">0</div><script>
setInterval(() => { tick.textContent = +tick.textContent + 1; }, 100);
</script></body></html>`,
  // A request that never answers: the network window can never close.
  '/hang-page': `<html><body><button>Go</button><script>fetch('/hang');</script></body></html>`,
  // One request answered late, one refused: both must leave the count.
  '/mixed': `<html><body><button>Go</button><script>
fetch('/data?delay=300').catch(() => {});
fetch('/fail').catch(() => {});
</script></body></html>`,
  // An SPA "route change": the click fetches, then re-renders. No navigation,
  // so no load event ever fires for it.
  '/spa': `<html><body><button id="go" onclick="
fetch('/data?delay=400').then((r) => r.text()).then(() => {
  out.innerHTML = '<a href=&quot;/item/1&quot;>Item 1</a><a href=&quot;/item/2&quot;>Item 2</a>';
})">Load items</button><div id="out"></div></body></html>`
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/hang') return; // never answered
  if (url.pathname === '/fail') {
    req.socket.destroy(); // surfaces as requestfailed
    return;
  }
  if (url.pathname === '/data') {
    setTimeout(() => res.end('ok'), Number(url.searchParams.get('delay')) || 0);
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.end(PAGES[url.pathname] || '<html><body>not a fixture</body></html>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  if (browser) await browser.close();
  server.closeAllConnections();
  server.close();
});

async function withPage(path, fn) {
  const page = await browser.newPage();
  try {
    if (path) await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

describe('settlePage', { skip: !browser && 'Chromium not installed' }, () => {
  test('a quiet page releases on the quiet window, not the cap', async () => {
    await withPage('/static', async (page) => {
      const result = await settlePage(page);
      assert.equal(result.settled_by, 'quiet');
      assert.ok(result.waited_ms >= NETWORK_QUIET_MS - 50, `waited ${result.waited_ms} ms`);
      assert.ok(result.waited_ms < 1500, `a static page should cost ~${NETWORK_QUIET_MS} ms, took ${result.waited_ms}`);
    });
  });

  test('a page that never stops mutating releases at the cap', async () => {
    await withPage('/churn', async (page) => {
      const result = await settlePage(page);
      assert.equal(result.settled_by, 'cap');
      assert.ok(result.waited_ms >= QUIET_CAP_MS - 50, `waited ${result.waited_ms} ms`);
      assert.ok(result.waited_ms < QUIET_CAP_MS + 1500, `the cap must hold, took ${result.waited_ms}`);
    });
  });

  test('a request that never answers releases at the budget, never beyond it', async () => {
    await withPage(null, async (page) => {
      trackRequests(page); // attached before navigation so the hanging fetch is counted
      await page.goto(BASE + '/hang-page', { waitUntil: 'domcontentloaded' });
      const result = await settlePage(page, { timeout: 1200 });
      assert.equal(result.settled_by, 'cap');
      assert.ok(result.waited_ms < 1700, `the budget must hold, took ${result.waited_ms}`);
      assert.equal(trackRequests(page).inFlight.size, 1, 'the hanging request is the one holding it open');
    });
  });

  test('finished and failed requests both leave the in-flight count', async () => {
    await withPage(null, async (page) => {
      let failed = 0;
      page.on('requestfailed', () => { failed++; });
      trackRequests(page);
      await page.goto(BASE + '/mixed', { waitUntil: 'domcontentloaded' });
      const result = await settlePage(page);
      assert.equal(failed, 1, 'the fixture really produced a failed request');
      assert.equal(trackRequests(page).inFlight.size, 0);
      assert.equal(result.settled_by, 'quiet');
    });
  });

  test('listeners are attached once per page, however often it settles', async () => {
    await withPage('/static', async (page) => {
      const before = page.listenerCount('request');
      const first = trackRequests(page);
      await settlePage(page);
      await settlePage(page);
      assert.equal(trackRequests(page), first, 'one tracker per page');
      assert.equal(page.listenerCount('request'), before + 1);
      assert.equal(page.listenerCount('requestfinished'), 1);
      assert.equal(page.listenerCount('requestfailed'), 1);
    });
  });

  test('a closed page ends the wait without throwing', async () => {
    const page = await browser.newPage();
    await page.goto(BASE + '/static');
    await page.close();
    const result = await settlePage(page);
    assert.equal(result.settled_by, 'closed');
    assert.ok(result.waited_ms < 500);
  });

  test('a navigation during the wait does not throw', async () => {
    await withPage('/churn', async (page) => {
      const settling = settlePage(page, { timeout: 2000 });
      await page.goto(BASE + '/static');
      const result = await settling;
      assert.ok(['quiet', 'cap'].includes(result.settled_by));
    });
  });
});

describe('the snapshot waits for the page to render', { skip: !browser && 'Chromium not installed' }, () => {
  test('content rendered after load is in the first snapshot, with the wait recorded', async () => {
    await withPage('/render-late', async (page) => {
      const snapshot = await captureSnapshot(page);
      assert.match(snapshot.tree, /\[button\] "Rendered late"/);
      assert.equal(snapshot.settled_by, 'quiet');
      assert.equal(typeof snapshot.waited_ms, 'number');
    });
  });
});

describe('settleAfterInteraction', { skip: !browser && 'Chromium not installed' }, () => {
  test('a click that re-renders without navigating is waited out', async () => {
    const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false, actionDelay: 0 });
    try {
      await withPage('/spa', async (page) => {
        const result = await executor.executeActionsOnPage(page, [{ type: 'click', selector: '#go' }]);
        assert.equal(result.success, true, result.error);
        // Read straight after the action returns — no wait in between.
        assert.equal(await page.locator('#out a').count(), 2);
      });
    } finally {
      await executor.destroy().catch(() => {});
      await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    }
  });

  test('never runs longer than the timeout it is given', async () => {
    const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
    try {
      await withPage('/churn', async (page) => {
        const started = Date.now();
        const result = await executor.settleAfterInteraction(page, 800, started);
        assert.equal(result.settled_by, 'cap');
        assert.ok(Date.now() - started < 1300, `took ${Date.now() - started} ms`);
      });
    } finally {
      await executor.destroy().catch(() => {});
      await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    }
  });

  test('gets only what is left of the action timeout', async () => {
    const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
    try {
      await withPage('/churn', async (page) => {
        const started = Date.now();
        // The action already spent 1500 ms of its 2000 ms on the element.
        const result = await executor.settleAfterInteraction(page, 2000, started - 1500);
        assert.equal(result.settled_by, 'cap');
        assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
      });
    } finally {
      await executor.destroy().catch(() => {});
      await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    }
  });
});

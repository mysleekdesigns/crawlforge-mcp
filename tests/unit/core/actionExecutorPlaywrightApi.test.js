/**
 * Unit tests: ActionExecutor against a real Chromium page.
 * Run: node --test tests/unit/core/actionExecutorPlaywrightApi.test.js
 *
 * These cover seven defects that every fake-page test in the suite was blind
 * to, because a stub can implement whatever API the executor happens to call —
 * including APIs Playwright does not have. They need a real browser to mean
 * anything, so they run against a local http server and skip when Chromium
 * isn't installed.
 *
 * Fixture-backed, no network. The pages are served from 127.0.0.1, which
 * ALLOWED_DOMAINS below lets past ActionExecutor's SSRF pre-flight (same
 * pattern as tests/unit/phase3-leaks.test.js).
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { ActionExecutor } = await import('../../../src/core/ActionExecutor.js');

let chromium;
let browser = null;
try {
  ({ chromium } = await import('playwright'));
  browser = await chromium.launch();
} catch {
  browser = null; // no browser binary available — the whole file skips
}

// `loadCount` lets a fixture change between loads, which is how the retry test
// below proves a re-navigation actually happened.
let loadCount = 0;

const FIXTURE = (load) => `<html><body style="margin:0">
<button id="stable">stable</button>
<button id="lateEnabled" disabled>late</button>
<button id="alwaysDisabled" disabled>never</button>
<button class="dup">one</button><button class="dup">two</button>
<div style="height:3000px"></div>
<button id="far">far down</button>
<a id="navLink" href="/page2">go</a>
<div style="position:relative">
  <button id="covered">covered</button>
  <div id="overlay" style="position:absolute;inset:0;background:red"></div>
</div>
<div id="count">0</div>
<button id="inc" onclick="count.textContent=+count.textContent+1">inc</button>
${load >= 2 ? '<button id="ok">present from the second load on</button>' : ''}
<script>setTimeout(() => { lateEnabled.disabled = false; }, 700);</script>
</body></html>`;

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url === '/page2') {
    res.end('<html><body><h1 id="page2marker">Page Two</h1></body></html>');
    return;
  }
  res.end(FIXTURE(++loadCount));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  if (browser) await browser.close();
  server.close();
});

/**
 * Real ActionExecutor, with only the browser-launch seam replaced — the same
 * seam tests/unit/tools/advanced/scrapeWithActions.test.js fakes, except here
 * it hands back a genuine Playwright page instead of a stub.
 */
async function withExecutor(fn, options = {}) {
  const executor = new ActionExecutor({
    enableLogging: false,
    enableScreenshotOnError: false,
    ...options
  });
  executor.browserProcessor.initializePage = async () => browser.newPage();
  try {
    return await fn(executor);
  } finally {
    await executor.destroy().catch(() => {});
    // BrowserProcessor eagerly builds a LocalizationManager whose health-check
    // timers destroy() doesn't clear — see tests/unit/phase3-leaks.test.js.
    await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
  }
}

describe('ActionExecutor against real Playwright APIs', { skip: !browser && 'Chromium not installed' }, () => {
  /**
   * The wait action's schema advertises enabled/disabled/stable, but they were
   * passed to page.waitForSelector({ state }), which accepts only
   * attached/detached/visible/hidden and rejects the rest outright. All three
   * documented conditions failed 100% of the time.
   */
  for (const [condition, selector] of [
    ['enabled', '#lateEnabled'],
    ['disabled', '#alwaysDisabled'],
    ['stable', '#stable'],
    ['visible', '#stable'],
    ['hidden', '#nothingHere']
  ]) {
    test(`wait condition "${condition}" is honoured, not rejected`, async () => {
      await withExecutor(async (executor) => {
        const result = await executor.executeActionChain(BASE, {
          actions: [{ type: 'wait', selector, condition, timeout: 5000 }]
        });
        assert.equal(result.success, true, `condition "${condition}" failed: ${result.error}`);
      });
    });
  }

  /**
   * scrollIntoView() is a DOM method; neither an ElementHandle nor a Locator
   * has it, so scroll-to-element threw "scrollIntoView is not a function"
   * every time. scrollIntoViewIfNeeded() is the Playwright equivalent.
   */
  test('scroll toElement scrolls instead of throwing a TypeError', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(BASE, {
        actions: [{ type: 'scroll', toElement: '#far', timeout: 5000 }]
      });
      assert.equal(result.success, true, `scroll failed: ${result.error}`);
      assert.equal(result.results[0].result.scrolledToElement, '#far');
    });
  });

  /**
   * The per-action Promise.race used to fire at the same deadline as the work
   * it was racing and win, replacing Playwright's error (which selector, what
   * it was waiting for) with a bare "Action timeout".
   */
  test('a failing action reports Playwright\'s error, not a bare "Action timeout"', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(BASE, {
        actions: [{ type: 'click', selector: '#doesNotExist', timeout: 1500, retries: 0 }]
      });
      assert.equal(result.success, false);
      assert.match(result.error, /doesNotExist/, 'the error must name the selector it gave up on');
      assert.doesNotMatch(result.error, /^Action failed: Action timeout$/);
    });
  });

  /**
   * Locators are strict by default and throw on a selector matching more than
   * one element. page.waitForSelector() silently took the first match, so the
   * conversion to locators uses .first() to keep existing chains working.
   */
  test('a selector matching several elements still acts on the first', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(BASE, {
        actions: [{ type: 'click', selector: '.dup', timeout: 4000 }]
      });
      assert.equal(result.success, true, `strict-mode violation leaked through: ${result.error}`);
    });
  });

  /**
   * Nothing waited on the document a click replaced, so a following action
   * could run against the outgoing page. Locator auto-waiting hides this at
   * localhost speeds; the explicit waitForLoadState is what makes it hold when
   * navigation is slow.
   */
  test('a navigating click has committed before the next action runs', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(BASE, {
        actions: [
          { type: 'click', selector: '#navLink', timeout: 5000 },
          { type: 'wait', selector: '#page2marker', condition: 'visible', timeout: 3000 }
        ]
      });
      assert.equal(result.success, true, `navigation chain failed: ${result.error}`);
      assert.match(result.finalUrl, /\/page2$/);
    });
  });

  /**
   * A chain retry replayed the actions against whatever the failed attempt had
   * left on screen, never reloading. The fixture only serves #ok from its
   * second load onward, so this chain can only succeed if attempt 2 really
   * re-navigated — and #count proves the earlier clicks were not replayed on
   * top of the first attempt's state (2, not 4).
   */
  test('a chain retry reloads the starting URL instead of replaying on a dirty page', async () => {
    await withExecutor(async (executor) => {
      loadCount = 0;
      const result = await executor.executeActionChain(BASE, {
        retryChain: 1,
        actions: [
          { type: 'click', selector: '#inc', timeout: 4000 },
          { type: 'click', selector: '#inc', timeout: 4000 },
          { type: 'click', selector: '#ok', timeout: 1500, retries: 0 }
        ]
      });

      assert.equal(result.success, true, `retry never reached a fresh page: ${result.error}`);
      assert.equal(loadCount, 2, 'the retry must issue a second navigation');
      assert.match(
        result.finalHtml,
        /id="count">2</,
        'each attempt must start from a fresh page — 4 would mean the retry replayed on top of attempt 1'
      );
    });
  });

  /**
   * Every recovery strategy was gated behind `action.retries > 0` while the
   * schema defaulted retries to 0, so none of them could ever run. #covered is
   * click-blocked by an overlay, which the waitAndRetry strategy clears with a
   * forced click.
   */
  test('error-recovery strategies run by default', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(BASE, {
        actions: [{ type: 'click', selector: '#covered', timeout: 1500 }]
      });
      const action = result.results[0];
      assert.equal(action.success, true);
      assert.equal(action.recovered, true, 'the click should have been recovered, not just failed');
      assert.equal(action.recoveryStrategy, 'waitAndRetry');
    });
  });

  test('retries:0 still opts an action out of recovery', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(BASE, {
        actions: [{ type: 'click', selector: '#covered', timeout: 1500, retries: 0 }]
      });
      const action = result.results[0];
      assert.equal(action.success, false);
      assert.notEqual(action.recovered, true);
    });
  });
});

/**
 * Recovery is bounded, and the bound is what makes it safe to have on by
 * default: an action that fails has already spent its whole timeout doing so,
 * and nothing enforces the chain-level `timeout`, so an unbounded walk through
 * every strategy would multiply the cost of a chain that could never succeed.
 * No browser needed — the strategies are swapped for counters.
 */
describe('ActionExecutor error-recovery budget', () => {
  async function withExecutorNoBrowser(fn, options = {}) {
    const executor = new ActionExecutor({ enableLogging: false, ...options });
    try {
      return await fn(executor);
    } finally {
      await executor.destroy().catch(() => {});
      await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    }
  }

  test('retries caps how many strategies are tried', async () => {
    await withExecutorNoBrowser(async (executor) => {
      const tried = [];
      executor.errorRecoveryStrategies.set('click', [
        { name: 'a', recover: async () => { tried.push('a'); throw new Error('no'); } },
        { name: 'b', recover: async () => { tried.push('b'); throw new Error('no'); } },
        { name: 'c', recover: async () => { tried.push('c'); return { success: true, data: {} }; } }
      ]);
      const attempt = (retries) =>
        executor.attemptErrorRecovery({}, { type: 'click', retries }, new Error('x'), {});

      await attempt(1);
      assert.deepEqual(tried, ['a'], 'retries:1 must stop after the first strategy');

      tried.length = 0;
      const wide = await attempt(3);
      assert.deepEqual(tried, ['a', 'b', 'c'], 'a bigger budget works through the list in order');
      assert.equal(wide.success, true);
      assert.equal(wide.strategy, 'c');

      tried.length = 0;
      const off = await attempt(0);
      assert.deepEqual(tried, [], 'retries:0 must try nothing');
      assert.equal(off.success, false);
    });
  });

  test('a recovery strategy never gets more time than the action itself', async () => {
    await withExecutorNoBrowser(async (executor) => {
      assert.equal(executor.recoveryTimeout({}), 5000, 'capped, not another full 60s deadline');
      assert.equal(executor.recoveryTimeout({ timeout: 1200 }), 1200, 'and never exceeds the action timeout');
      assert.equal(executor.actionTimeout({}), 60000, 'the action itself still gets its full deadline');
    }, { defaultTimeout: 60000 });
  });
});

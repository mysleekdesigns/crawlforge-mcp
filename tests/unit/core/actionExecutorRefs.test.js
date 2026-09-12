/**
 * Unit tests: snapshot refs end-to-end through ActionExecutor.
 * Run: node --test --test-force-exit tests/unit/core/actionExecutorRefs.test.js
 *
 * Phase 1 of the browser-session plan lets any action target an `@e1` ref a
 * prior `snapshot` action assigned instead of a guessed CSS selector. That only
 * means anything against a real DOM — a stub page would happily "click" a
 * selector no element carries — so these run against a local http server and
 * skip when Chromium isn't installed, the same shape as
 * tests/unit/core/actionExecutorPlaywrightApi.test.js.
 *
 * Each fixture below exposes exactly ONE interactive element, so the ref under
 * test is `@e1` by the contract (refs are `e1`, `e2`, … in assignment order);
 * soleRef() reads the snapshot result back to say so out loud when it isn't.
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

const PAGES = {
  // One interactive element, and a counter that proves a click landed on it.
  '/click': `<html><body style="margin:0">
<button id="inc" onclick="count.textContent = +count.textContent + 1">Increment</button>
<div id="count">0</div>
</body></html>`,
  // An input's value never reaches the serialized HTML, so echo it into a div.
  '/typing': `<html><body style="margin:0">
<input id="email" oninput="echo.textContent = this.value">
<div id="echo"></div>
</body></html>`,
  // Refs taken here are invalidated by the navigation the chain performs next.
  '/stale': `<html><body style="margin:0">
<button id="gone">still here</button>
</body></html>`,
  '/page2': '<html><body><h1 id="page2marker">Page Two</h1></body></html>'
};

const server = http.createServer((req, res) => {
  if (req.url === '/robots.txt') {
    res.setHeader('content-type', 'text/plain');
    res.end('User-agent: *\nAllow: /\n');
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.end(PAGES[req.url] || '<html><body>not a fixture</body></html>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  if (browser) await browser.close();
  server.close();
});

/** Real ActionExecutor with only the browser-launch seam replaced. */
async function withExecutor(fn) {
  const executor = new ActionExecutor({
    enableLogging: false,
    enableScreenshotOnError: false
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

/**
 * The one ref a snapshot assigned, read back out of its own tree.
 *
 * Asserting the fixture really produced a single ref is what makes hard-coding
 * `@e1` in the chains below safe: if the walk ever refs something else first,
 * this says so instead of leaving a click to fail for an unexplained reason.
 */
function soleRef(snapshot) {
  const refs = [...new Set(snapshot.tree.match(/@e[1-9]\d*/g) || [])];
  assert.equal(refs.length, 1, `expected exactly one ref in the snapshot, got: ${refs.join(', ') || 'none'}`);
  return refs[0];
}

describe('ActionExecutor snapshot refs', { skip: !browser && 'Chromium not installed' }, () => {
  test('a ref from a snapshot action clicks the element it named', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(`${BASE}/click`, {
        actions: [
          { type: 'snapshot' },
          { type: 'click', selector: '@e1' },
          // Same element by plain CSS: refs must not cost the existing path.
          { type: 'click', selector: '#inc' }
        ]
      });

      assert.equal(result.success, true, result.error);
      const snapshot = result.results[0].result;
      assert.equal(soleRef(snapshot), '@e1');
      assert.equal(snapshot.refCount, 1);
      assert.ok(snapshot.snapshotId, 'snapshot result carries an id');

      assert.equal(result.results[1].success, true, result.results[1].error);
      assert.equal(result.results[2].success, true, result.results[2].error);
      // The ref click and the CSS click both landed on #inc.
      assert.match(result.finalHtml, /<div id="count">2<\/div>/);
    });
  });

  test('the action result echoes the ref the caller wrote, not the resolved selector', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(`${BASE}/click`, {
        actions: [{ type: 'snapshot' }, { type: 'click', selector: '@e1' }]
      });

      assert.equal(result.success, true, result.error);
      assert.equal(result.results[1].result.selector, '@e1');
    });
  });

  test('a ref types into the input it named', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(`${BASE}/typing`, {
        actions: [
          { type: 'snapshot' },
          { type: 'type', selector: '@e1', text: 'hello@example.com' }
        ]
      });

      assert.equal(result.success, true, result.error);
      assert.equal(soleRef(result.results[0].result), '@e1');
      assert.equal(result.results[1].success, true, result.results[1].error);
      assert.match(result.finalHtml, /<div id="echo">hello@example\.com<\/div>/);
    });
  });

  test('a ref used after a navigation fails as a stale ref, promptly', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(`${BASE}/stale`, {
        actions: [
          { type: 'snapshot' },
          { type: 'navigate', url: `${BASE}/page2` },
          // continueOnError so the chain reports the failed action rather than
          // throwing before its result can be inspected.
          { type: 'click', selector: '@e1', continueOnError: true }
        ]
      });

      assert.equal(result.success, true, result.error);
      assert.equal(result.results[1].success, true, result.results[1].error);

      const failed = result.results[2];
      assert.equal(failed.success, false, 'a ref from the previous document must not resolve');
      assert.match(failed.error, /snapshot/i, `error should point at re-snapshotting: ${failed.error}`);
      assert.ok(!/timed? ?out/i.test(failed.error), `stale ref must not surface as a timeout: ${failed.error}`);
      // Error recovery is skipped for a stale ref: its first click strategy
      // opens with a fixed 1000ms delay, so anything under that proves the
      // action failed instead of spending the recovery budget.
      assert.ok(failed.executionTime < 900, `expected a prompt failure, took ${failed.executionTime}ms`);
    });
  });
});

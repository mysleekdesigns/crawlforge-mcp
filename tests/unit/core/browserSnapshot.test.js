/**
 * Unit tests: the page snapshot and its element refs.
 * Run: node --test --test-force-exit tests/unit/core/browserSnapshot.test.js
 *
 * The snapshot is an injected DOM walk, so only a real DOM can say whether it
 * is right: computed styles, `el.labels`, bounding rects and aria-hidden
 * subtrees all have to come from the browser. Fixture-backed and served from
 * 127.0.0.1, no network; the whole file skips when Chromium isn't installed
 * (same pattern as actionExecutorPlaywrightApi.test.js).
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  captureSnapshot,
  resolveRef,
  attachRefTracking,
  isRef,
  StaleRefError,
  REF_ATTRIBUTE
} from '../../../src/core/browser/snapshot.js';

let browser = null;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
} catch {
  browser = null; // no browser binary available — the whole file skips
}

/**
 * Every kind of node the walk has to make a decision about: named four
 * different ways, hidden four different ways, plus a heading and a landmark
 * that only interactiveOnly:false should reach.
 */
const FIXTURE = `<html><head><title>Snapshot Fixture</title></head><body style="margin:0">
<h1>Welcome</h1>
<form>
  <label for="email">Email address</label>
  <input id="email" type="email">
  <input type="text" aria-label="Search query">
  <input type="text" placeholder="Zip code">
  <button id="go">Go</button>
</form>
<a href="/page2">More information...</a>
<div aria-hidden="true"><button id="ghost">Ghost</button></div>
<button style="display:none">Gone</button>
<button style="visibility:hidden">Invisible</button>
<button style="width:0;height:0;padding:0;border:0;font-size:0">Zero</button>
<input type="hidden" name="csrf" value="x">
</body></html>`;

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(req.url === '/page2'
    ? '<html><head><title>Page Two</title></head><body><button id="other">Other</button></body></html>'
    : FIXTURE);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  if (browser) await browser.close();
  server.close();
});

async function withPage(fn, { navigate = true } = {}) {
  const page = await browser.newPage();
  try {
    if (navigate) await page.goto(BASE);
    return await fn(page);
  } finally {
    await page.close();
  }
}

describe('captureSnapshot', { skip: !browser && 'Chromium not installed' }, () => {
  test('refs run in document order, with the role and accessible name of each control', async () => {
    await withPage(async (page) => {
      const snapshot = await captureSnapshot(page);

      assert.deepEqual(snapshot.tree.split('\n'), [
        '[document] "Snapshot Fixture"',
        '  @e1 [textbox] "Email address"',   // named by label[for]
        '  @e2 [textbox] "Search query"',    // named by aria-label
        '  @e3 [textbox] "Zip code"',        // named by placeholder
        '  @e4 [button] "Go"',
        '  @e5 [link] "More information..."'
      ]);
      assert.equal(snapshot.refCount, 5);
      assert.equal(snapshot.nodeCount, 5);
      assert.equal(snapshot.truncated, false);
      assert.equal(snapshot.interactiveOnly, true);
      assert.equal(snapshot.url, `${BASE}/`);
      assert.equal(snapshot.title, 'Snapshot Fixture');
      assert.match(snapshot.snapshotId, /^[0-9a-f]{8}$/);
    });
  });

  test('hidden, invisible and zero-size elements are left out', async () => {
    await withPage(async (page) => {
      const { tree, refCount } = await captureSnapshot(page);

      assert.equal(refCount, 5, 'only the five reachable controls may be reffed');
      for (const excluded of ['Ghost', 'Gone', 'Invisible', 'Zero', 'csrf']) {
        assert.doesNotMatch(tree, new RegExp(excluded), `${excluded} should not be in the tree`);
      }
      assert.equal(await page.locator(`[${REF_ATTRIBUTE}]`).count(), 5, 'and none of them may be stamped');
    });
  });

  test('the node cap stops the walk and says so', async () => {
    await withPage(async (page) => {
      const snapshot = await captureSnapshot(page, { maxNodes: 2 });

      assert.equal(snapshot.refCount, 2);
      assert.equal(snapshot.nodeCount, 2);
      assert.equal(snapshot.truncated, true);
      assert.deepEqual(snapshot.tree.split('\n'), [
        '[document] "Snapshot Fixture"',
        '  @e1 [textbox] "Email address"',
        '  @e2 [textbox] "Search query"'
      ]);
    });
  });

  test('interactiveOnly:false adds structure, and still refs only what can be acted on', async () => {
    await withPage(async (page) => {
      const snapshot = await captureSnapshot(page, { interactiveOnly: false });

      assert.deepEqual(snapshot.tree.split('\n'), [
        '[document] "Snapshot Fixture"',
        '  [heading] "Welcome"',
        '  [form]',
        '    @e1 [textbox] "Email address"',
        '    @e2 [textbox] "Search query"',
        '    @e3 [textbox] "Zip code"',
        '    @e4 [button] "Go"',
        '  @e5 [link] "More information..."'
      ]);
      assert.equal(snapshot.refCount, 5, 'the heading and the landmark must not consume refs');
      assert.equal(snapshot.nodeCount, 7);
      assert.equal(snapshot.interactiveOnly, false);
    });
  });

  test('re-snapshotting renumbers instead of leaving retired ids behind', async () => {
    await withPage(async (page) => {
      await captureSnapshot(page);
      const second = await captureSnapshot(page, { maxNodes: 2 });

      assert.equal(second.refCount, 2);
      assert.equal(
        await page.locator(`[${REF_ATTRIBUTE}]`).count(),
        2,
        'the first walk\'s stamps must be cleared, or @e5 would still answer'
      );
    });
  });
});

describe('resolveRef', { skip: !browser && 'Chromium not installed' }, () => {
  test('a live ref becomes a plain CSS selector for the element it named', async () => {
    await withPage(async (page) => {
      await captureSnapshot(page);

      assert.equal(resolveRef(page, '@e1'), `[${REF_ATTRIBUTE}="e1"]`);
      assert.equal(await page.locator(resolveRef(page, '@e1')).getAttribute('id'), 'email');
      assert.equal(await page.locator(resolveRef(page, '@e4')).textContent(), 'Go');
    });
  });

  test('a ref used before any snapshot says to take one', async () => {
    await withPage(async (page) => {
      assert.throws(() => resolveRef(page, '@e5'), (error) => {
        assert.ok(error instanceof StaleRefError);
        assert.equal(error.name, 'StaleRefError');
        assert.match(error.message, /no snapshot has been taken on this page/);
        return true;
      });
    });
  });

  test('navigating invalidates the refs, loudly', async () => {
    await withPage(async (page) => {
      attachRefTracking(page);
      await captureSnapshot(page);
      assert.equal(resolveRef(page, '@e1'), `[${REF_ATTRIBUTE}="e1"]`);

      const navigated = page.waitForEvent('framenavigated');
      await page.goto(`${BASE}/page2`);
      await navigated;

      assert.throws(() => resolveRef(page, '@e1'), (error) => {
        assert.ok(error instanceof StaleRefError);
        assert.match(error.message, /the page navigated since the last snapshot/);
        assert.match(error.message, /take a new snapshot/);
        return true;
      });
    });
  });

  test('a ref past the end of the current snapshot names the range', async () => {
    await withPage(async (page) => {
      await captureSnapshot(page);

      assert.throws(
        () => resolveRef(page, '@e9'),
        (error) => error instanceof StaleRefError &&
          /the current snapshot has 5 refs \(@e1-@e5\)/.test(error.message)
      );
    });
  });

  test('something that is not a ref at all is a programming error, not a stale ref', async () => {
    await withPage(async (page) => {
      await captureSnapshot(page);

      assert.throws(() => resolveRef(page, '#email'), (error) => {
        assert.ok(!(error instanceof StaleRefError), 'callers gate on isRef() — this is their bug');
        assert.match(error.message, /expects an element ref/);
        return true;
      });
    });
  });
});

describe('isRef', () => {
  test('accepts element refs and nothing else', () => {
    for (const accepted of ['@e1', '@e12', '@e999']) {
      assert.equal(isRef(accepted), true, `${accepted} is a ref`);
    }
    for (const rejected of ['@e0', '@e01', 'e1', '#id', '@ex', '@e', '@e1 ', '', '@e1.5', null, undefined, 1, {}]) {
      assert.equal(isRef(rejected), false, `${JSON.stringify(rejected)} is not a ref`);
    }
  });
});

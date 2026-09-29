/**
 * Unit tests: the page snapshot and its element refs.
 * Run: node --test --test-force-exit tests/unit/core/browserSnapshot.test.js
 *
 * The snapshot is Playwright's native `ariaSnapshot({ mode: 'ai' })` translated
 * into our tree, with an injected DOM walk as the fallback, so only a real DOM
 * can say whether it is right: computed styles, accessible names, bounding
 * rects, shadow roots and frames all have to come from the browser.
 * Fixture-backed and served from 127.0.0.1, no network; the browser suites skip
 * when Chromium isn't installed (same pattern as
 * actionExecutorPlaywrightApi.test.js).
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { HumanBehaviorSimulator } from '../../../src/utils/HumanBehaviorSimulator.js';
import {
  captureSnapshot,
  resolveRef,
  attachRefTracking,
  clearRefs,
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
 * Every kind of node the snapshot has to make a decision about: named four
 * different ways, hidden four different ways, plus a heading and a landmark
 * that only interactiveOnly:false should reach. The form carries a label
 * because an unnamed <form> has no `form` role in ARIA — the native snapshot
 * reports it as a plain generic, so it would not be a landmark at all.
 */
const FIXTURE = `<html><head><title>Snapshot Fixture</title></head><body style="margin:0">
<h1>Welcome</h1>
<form aria-label="Sign up">
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

/**
 * What the walk could never see: a control inside an open shadow root, one
 * inside a same-origin iframe, a contenteditable editing host (a TinyMCE-style
 * iframe body among them), and an onclick <div> known only by its pointer
 * cursor. Each click writes to #log in its own document.
 */
const PAGES = {
  '/page2': '<html><head><title>Page Two</title></head><body><button id="other">Other</button></body></html>',
  '/shadow': `<html><head><title>Shadow</title></head><body style="margin:0">
<div style="height:3000px">spacer</div>
<div id="host"></div><div id="log"></div>
<script>
  const button = document.createElement('button');
  button.textContent = 'Shadow btn';
  button.onclick = () => { log.textContent = 'shadow clicked'; };
  host.attachShadow({ mode: 'open' }).append(button);
</script>
</body></html>`,
  '/frame': `<html><head><title>Frames</title></head><body style="margin:0">
<button>Top</button>
<iframe src="/inner"></iframe>
<iframe src="/editor" title="Editor frame"></iframe>
</body></html>`,
  '/inner': `<html><body style="margin:0">
<button id="in-frame" onclick="log.textContent = 'frame clicked'">In frame</button><div id="log"></div>
</body></html>`,
  '/editor': `<html><body contenteditable="true" aria-label="Rich Text Area"><p>Your content goes here.</p></body></html>`,
  '/widgets': `<html><head><title>Widgets</title></head><body style="margin:0">
<div contenteditable="true" aria-label="Message"><p>Draft</p></div>
<div onclick="log.textContent = 'card clicked'" style="cursor:pointer">Open card <span>details</span></div>
<div>Plain text</div><div id="log"></div>
</body></html>`
};

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(PAGES[req.url] || FIXTURE);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  if (browser) await browser.close();
  server.close();
});

async function withPage(fn, { navigate = true, path = '/' } = {}) {
  const page = await browser.newPage();
  try {
    if (navigate) await page.goto(BASE + path);
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
        '  @e5 [link] "More information..."',
        // aria-hidden but on screen and clickable: Playwright's ai mode keeps
        // it (visibility "ariaOrVisible"), and an agent can act on it. Its
        // accessible name is empty, so it is captioned by its text.
        '  @e6 [button] "Ghost"'
      ]);
      assert.equal(snapshot.refCount, 6);
      assert.equal(snapshot.nodeCount, 6);
      assert.equal(snapshot.truncated, false);
      assert.equal(snapshot.interactiveOnly, true);
      assert.equal(snapshot.source, 'aria');
      assert.equal(snapshot.url, `${BASE}/`);
      assert.equal(snapshot.title, 'Snapshot Fixture');
      assert.match(snapshot.snapshotId, /^[0-9a-f]{8}$/);
    });
  });

  test('hidden, invisible and zero-size elements are left out', async () => {
    await withPage(async (page) => {
      const { tree, refCount } = await captureSnapshot(page);

      assert.equal(refCount, 6, 'only the six on-screen controls may be reffed');
      for (const excluded of ['Gone', 'Invisible', 'Zero', 'csrf']) {
        assert.doesNotMatch(tree, new RegExp(excluded), `${excluded} should not be in the tree`);
      }
      assert.equal(await page.locator(`[${REF_ATTRIBUTE}]`).count(), 0,
        'the native snapshot resolves through aria-ref and stamps nothing');
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
        '  [form] "Sign up"',
        '    @e1 [textbox] "Email address"',
        '    @e2 [textbox] "Search query"',
        '    @e3 [textbox] "Zip code"',
        '    @e4 [button] "Go"',
        '  @e5 [link] "More information..."',
        '  @e6 [button] "Ghost"'
      ]);
      assert.equal(snapshot.refCount, 6, 'the heading and the landmark must not consume refs');
      assert.equal(snapshot.nodeCount, 8);
      assert.equal(snapshot.interactiveOnly, false);
    });
  });

  test('re-snapshotting renumbers instead of leaving retired ids behind', async () => {
    await withPage(async (page) => {
      await captureSnapshot(page);
      const second = await captureSnapshot(page, { maxNodes: 2 });

      assert.equal(second.refCount, 2);
      assert.throws(() => resolveRef(page, '@e5'), StaleRefError,
        'a ref only the first snapshot assigned must not still answer');
    });
  });

  test('a control inside an open shadow root is reffed and clickable', async () => {
    await withPage(async (page) => {
      const snapshot = await captureSnapshot(page);

      assert.deepEqual(snapshot.tree.split('\n'), ['[document] "Shadow"', '  @e1 [button] "Shadow btn"']);
      await page.locator(resolveRef(page, '@e1')).click();
      assert.equal(await page.locator('#log').textContent(), 'shadow clicked');
    }, { path: '/shadow' });
  });

  test('frames are walked: their controls are reffed in document order and clickable', async () => {
    await withPage(async (page) => {
      await page.frameLocator('iframe >> nth=0').locator('#in-frame').waitFor();
      const snapshot = await captureSnapshot(page, { interactiveOnly: false });

      assert.deepEqual(snapshot.tree.split('\n'), [
        '[document] "Frames"',
        '  @e1 [button] "Top"',
        '  [iframe]',
        '    @e2 [button] "In frame"',
        '  [iframe]',
        // The TinyMCE shape: the frame's body is the contenteditable editor.
        '    @e3 [textbox] "Rich Text Area"'
      ]);
      // Our refs stay contiguous; the selector is Playwright's frame-scoped ref.
      assert.match(resolveRef(page, '@e2'), /^aria-ref=f\d+e\d+$/);
      await page.locator(resolveRef(page, '@e2')).click();
      assert.equal(await page.frameLocator('iframe >> nth=0').locator('#log').textContent(), 'frame clicked');

      await page.locator(resolveRef(page, '@e3')).fill('typed into the frame');
      assert.equal(await page.frameLocator('iframe >> nth=1').locator('body').textContent(), 'typed into the frame');
    }, { path: '/frame' });
  });

  test('an editing host and a pointer-cursor <div> count as interactive; plain text does not', async () => {
    await withPage(async (page) => {
      const snapshot = await captureSnapshot(page);

      assert.deepEqual(snapshot.tree.split('\n'), [
        '[document] "Widgets"',
        '  @e1 [textbox] "Message"',
        '  @e2 [generic] "Open card details"'
      ]);
      await page.locator(resolveRef(page, '@e2')).click();
      assert.equal(await page.locator('#log').textContent(), 'card clicked');
    }, { path: '/widgets' });
  });

  test('falls back to the injected walk when the native snapshot fails, and says so', async () => {
    await withPage(async (page) => {
      page.ariaSnapshot = async () => { throw new Error('ariaSnapshot unavailable'); };
      const snapshot = await captureSnapshot(page);

      assert.equal(snapshot.source, 'walk');
      assert.deepEqual(snapshot.tree.split('\n'), [
        '[document] "Snapshot Fixture"',
        '  @e1 [textbox] "Email address"',
        '  @e2 [textbox] "Search query"',
        '  @e3 [textbox] "Zip code"',
        '  @e4 [button] "Go"',
        '  @e5 [link] "More information..."'   // the walk honours aria-hidden
      ]);
      assert.equal(await page.locator(`[${REF_ATTRIBUTE}]`).count(), 5, 'the walk stamps what it refs');
      assert.equal(resolveRef(page, '@e1'), `[${REF_ATTRIBUTE}="e1"]`);
      assert.equal(await page.locator(resolveRef(page, '@e1')).getAttribute('id'), 'email');

      // A re-walk clears the first walk's stamps, or @e5 would still answer.
      await captureSnapshot(page, { maxNodes: 2 });
      assert.equal(await page.locator(`[${REF_ATTRIBUTE}]`).count(), 2);
    });
  });
});

describe('resolveRef', { skip: !browser && 'Chromium not installed' }, () => {
  test('a live ref becomes a Playwright selector for the element it named', async () => {
    await withPage(async (page) => {
      await captureSnapshot(page);

      assert.match(resolveRef(page, '@e1'), /^aria-ref=e\d+$/);
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
      assert.match(resolveRef(page, '@e1'), /^aria-ref=/);

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
          /the current snapshot has 6 refs \(@e1-@e6\)/.test(error.message)
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


/**
 * A navigation landing *during* the walk is the one case a real browser will
 * not reproduce on demand: the window is a few milliseconds wide and nothing
 * drives it. These drive it directly instead — a stub page whose evaluate()
 * clears the refs before it resolves is exactly what a framenavigated event
 * arriving mid-walk does. No Chromium needed, so they run even when the
 * fixture-backed suites above skip.
 */
describe('a navigation during the walk', () => {
  const WALK_RESULT = {
    title: 'Second page',
    lines: ['  @e1 [button] "Go"'],
    refs: [{ id: 'e1', role: 'button', name: 'Go', tag: 'button' }],
    truncated: false
  };

  /** @param {(attempt: number) => boolean} navigatesOn */
  const stubPage = (navigatesOn) => {
    let attempts = 0;
    const page = {
      on() {},
      mainFrame: () => 'main',
      url: () => 'https://example.test/',
      get attempts() { return attempts; },
      async evaluate() {
        attempts++;
        if (navigatesOn(attempts)) clearRefs(page);
        return WALK_RESULT;
      }
    };
    return page;
  };

  test('is retried against the new document', async () => {
    const page = stubPage((attempt) => attempt === 1);
    const snapshot = await captureSnapshot(page);

    assert.equal(page.attempts, 2, 'the first walk described a document that had gone');
    assert.equal(snapshot.refCount, 1);
    assert.equal(resolveRef(page, '@e1'), `[${REF_ATTRIBUTE}="e1"]`,
      'the refs published are the ones the surviving walk assigned');
  });

  test('gives up rather than publish a tree for a page nobody is on', async () => {
    const page = stubPage(() => true);

    await assert.rejects(() => captureSnapshot(page), (error) => {
      assert.ok(error instanceof StaleRefError);
      assert.match(error.message, /navigated while the snapshot was being taken/);
      return true;
    });
    assert.equal(page.attempts, 2, 'one retry, not an unbounded loop');
    // No refs were published, so acting on one names the snapshot rather than
    // timing out on a selector that can never match.
    assert.throws(() => resolveRef(page, '@e1'), StaleRefError);
  });

  /** A page with a native snapshot, whose first call runs into a navigation. */
  const nativeStubPage = ({ throwsOnNavigation }) => {
    let attempts = 0;
    const page = {
      on() {},
      mainFrame: () => 'main',
      url: () => 'https://example.test/',
      frames: () => [],
      title: async () => 'Second page',
      get attempts() { return attempts; },
      async evaluate() { throw new Error('the walk must not run'); },
      async ariaSnapshot() {
        attempts++;
        if (attempts === 1) {
          clearRefs(page);
          if (throwsOnNavigation) throw new Error('Execution context was destroyed');
        }
        return '- generic [active] [ref=e1]:\n  - button "Go" [ref=e2]';
      }
    };
    return page;
  };

  for (const throwsOnNavigation of [false, true]) {
    test(`a native capture the navigation ${throwsOnNavigation ? 'broke' : 'outdated'} is retried, not handed to the walk`, async () => {
      const page = nativeStubPage({ throwsOnNavigation });
      const snapshot = await captureSnapshot(page);

      assert.equal(page.attempts, 2);
      assert.equal(snapshot.source, 'aria');
      assert.equal(snapshot.tree, '[document] "Second page"\n  @e1 [button] "Go"');
      assert.equal(resolveRef(page, '@e1'), 'aria-ref=e2', 'our @e1 is Playwright\'s e2');
    });
  }
});

/**
 * The stealth path hands a resolved ref to HumanBehaviorSimulator as a raw
 * selector string. A native ref is `aria-ref=…` and may live in a shadow root
 * or a frame, none of which document.querySelector() can take.
 */
describe('HumanBehaviorSimulator with snapshot refs', { skip: !browser && 'Chromium not installed' }, () => {
  const simulator = new HumanBehaviorSimulator({
    mouseMovements: { enabled: false },
    interactions: { hoverBeforeClick: false, clickDelay: { min: 0, max: 0 } }
  });

  test('scrolls to a ref inside a shadow root', async () => {
    await withPage(async (page) => {
      await captureSnapshot(page);
      assert.equal(await page.evaluate(() => window.scrollY), 0);

      await simulator.simulateScroll(page, { target: resolveRef(page, '@e1') });
      await page.waitForFunction(() => window.scrollY > 1000);
    }, { path: '/shadow' });
  });

  test('reads the text length of a ref', async () => {
    await withPage(async (page) => {
      await captureSnapshot(page);
      // Resolves (a short read) rather than throwing on a non-CSS selector.
      await simulator.simulateReadingTime(page, resolveRef(page, '@e1'));
    }, { path: '/shadow' });
  });

  test('clicks a ref inside a frame', async () => {
    await withPage(async (page) => {
      await page.frameLocator('iframe >> nth=0').locator('#in-frame').waitFor();
      await captureSnapshot(page);

      await simulator.simulateClick(page, resolveRef(page, '@e2'), { timeout: 5000 });
      assert.equal(await page.frameLocator('iframe >> nth=0').locator('#log').textContent(), 'frame clicked');
    }, { path: '/frame' });
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

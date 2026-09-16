/**
 * Regression lock: a Firefox page's own JavaScript error must not kill the process.
 *
 * Camoufox's Juggler reports Page.uncaughtError with only frameId, message and
 * stack — no `location`. playwright-core 1.62 forwards that missing location
 * into Page.addPageError, and the BrowserContext dispatcher reads
 * `pageError.location.url` off it regardless. The TypeError is thrown inside
 * the protocol dispatch loop, where nothing awaits it, so it arrives as an
 * uncaughtException.
 *
 * Measured before the fix: `<script>null.boom;</script>` on a local page, through
 * scrapeWithStealth on camoufox, ended the node process. bot.sannysoft.com did
 * the same in the ordinary course of running its checks. server.js's catch-all
 * uncaughtException handler absorbed it — every other consumer (the CLI,
 * deep_research embedded, direct use of StealthBrowserManager) did not.
 *
 * These tests drive playwright's real Page.prototype, because the point is that
 * the value reaches the real dispatcher's read. They need no browser.
 *
 * Run: node --test --test-force-exit tests/unit/firefoxPageErrorGuard.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

import { guardFirefoxPageErrors, _resetFirefoxPageErrorGuard } from '../../src/utils/firefoxPageErrorGuard.js';

const require = createRequire(import.meta.url);
const pagePrototype = require('playwright-core/lib/coreBundle').server.Page.prototype;

/** The parts of a server-side Page that addPageError touches. */
const fakePage = () => {
  const emitted = [];
  return {
    emitted,
    _pageErrors: [],
    _initialized: true,
    emitOnContext: (_event, pageError) => { emitted.push(pageError); }
  };
};

describe('guardFirefoxPageErrors', () => {
  test('reports success and is idempotent', () => {
    _resetFirefoxPageErrorGuard();
    assert.equal(guardFirefoxPageErrors(), true);
    assert.equal(guardFirefoxPageErrors(), true, 'a second call is a no-op, not a second wrapper');
  });

  test('a page error with no location still has a readable location.url', () => {
    guardFirefoxPageErrors();
    const page = fakePage();
    // Exactly what FFPage._onUncaughtError does with camoufox's payload: an
    // Error, and params.location — which is not there.
    pagePrototype.addPageError.call(page, new Error('TypeError: null has no properties'), undefined);

    assert.equal(page.emitted.length, 1);
    const [pageError] = page.emitted;
    // The read that used to throw. The dispatcher does all three.
    assert.equal(pageError.location.url, '');
    assert.equal(pageError.location.lineNumber, 0);
    assert.equal(pageError.location.columnNumber, 0);
  });

  test('a real location is passed through untouched', () => {
    guardFirefoxPageErrors();
    const page = fakePage();
    const location = { url: 'https://example.com/app.js', lineNumber: 12, columnNumber: 7 };
    pagePrototype.addPageError.call(page, new Error('boom'), location);

    assert.equal(page.emitted[0].location, location, 'Chromium and WebKit must be unaffected');
  });

  test('the error itself is not swallowed — it still reaches the page error list', () => {
    guardFirefoxPageErrors();
    const page = fakePage();
    const error = new Error('TypeError: null has no properties');
    pagePrototype.addPageError.call(page, error, undefined);

    assert.equal(page._pageErrors.length, 1, 'the guard fills in a location, it does not drop the error');
    assert.equal(page._pageErrors[0].error, error);
    assert.equal(page.emitted[0].error, error, 'a caller listening for pageerror still gets it');
  });
});

describe('every camoufox launch installs the guard', () => {
  // A launch site added without it brings the crash back for that path, and
  // nothing else in the suite would notice.
  for (const file of ['src/core/StealthBrowserManager.js', 'src/core/ResearchOrchestrator.js']) {
    test(`${file} calls guardFirefoxPageErrors before Camoufox()`, () => {
      const source = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      const guardAt = source.indexOf('guardFirefoxPageErrors()');
      const launchAt = source.indexOf('Camoufox(');
      assert.ok(guardAt !== -1, 'the guard is called');
      assert.ok(launchAt !== -1, 'camoufox is launched here');
      assert.ok(guardAt < launchAt, 'and the guard comes first — it must be in place before a page can run');
    });
  }
});

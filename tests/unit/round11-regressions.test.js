/**
 * Round 11 regressions (2026-08-30).
 *
 * 1. stealth_mode engine switching: a camoufox request made while a chromium
 *    browser was already running silently reused chromium, because
 *    createStealthContext only called launchStealthBrowser when no browser
 *    existed — skipping the engine-mismatch guard inside it. Proven live with
 *    a CSS.supports('-moz-appearance') probe: chromium-then-camoufox returned
 *    moz:false before the fix, moz:true after. (UA strings prove nothing here:
 *    the fingerprint randomizer hands Chrome-like UAs to Firefox and vice versa.)
 *
 * 2. stealth_mode create_context dropped the tool-level `engine` param
 *    entirely — only operation:"scrape" forwarded it.
 *
 * 3. extract_structured: a model that saw no answer for a required field
 *    sometimes replies with a placeholder ("N/A") instead of null. Placeholders
 *    carry no digits, so the provenance guard had nothing to check and the
 *    step-3c full-text retry never fired. git-scm.com found this: Readability
 *    drops the version box, the model answered "N/A", the page says 2.55.0.
 *
 * Run: node --test tests/unit/round11-regressions.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StealthBrowserManager } from '../../src/core/StealthBrowserManager.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const fakeBrowser = (onClose) => ({
  isConnected: () => true,
  close: async () => { onClose?.(); }
});

describe('R11.1 engine mismatch guard in launchStealthBrowser', () => {
  test('camoufox request tears down a running chromium browser and relaunches', async () => {
    const manager = new StealthBrowserManager();
    let closed = false;
    const launches = [];
    manager.browser = fakeBrowser(() => { closed = true; });
    manager._launchedEngine = 'chromium';
    manager._doLaunchStealthBrowser = async (config) => {
      launches.push(config.engine);
      manager.browser = fakeBrowser();
      manager._launchedEngine = config.engine;
      return manager.browser;
    };

    await manager.launchStealthBrowser({ engine: 'camoufox' });
    assert.equal(closed, true, 'running chromium browser must be closed');
    assert.deepEqual(launches, ['camoufox'], 'a camoufox launch must replace it');
  });

  test('matching engine reuses the running browser without a relaunch', async () => {
    const manager = new StealthBrowserManager();
    const launches = [];
    const running = fakeBrowser();
    manager.browser = running;
    manager._launchedEngine = 'chromium';
    manager._doLaunchStealthBrowser = async (config) => {
      launches.push(config.engine);
      return manager.browser;
    };

    const browser = await manager.launchStealthBrowser({ engine: 'chromium' });
    assert.equal(browser, running, 'same-engine request returns the running browser');
    assert.deepEqual(launches, [], 'no relaunch on a matching engine');
  });

  test('createStealthContext consults launchStealthBrowser even when a browser is running', async () => {
    const manager = new StealthBrowserManager();
    manager.browser = fakeBrowser();
    manager._launchedEngine = 'chromium';
    const seen = [];
    const sentinel = new Error('launch-consulted');
    // Throwing right after the launch decision keeps the test from needing a
    // full fake context — the point is only that the guarded call happens.
    manager.launchStealthBrowser = async (config) => {
      seen.push(config.engine);
      throw sentinel;
    };

    await assert.rejects(
      () => manager.createStealthContext({ engine: 'camoufox' }),
      (e) => e === sentinel
    );
    assert.deepEqual(seen, ['camoufox'],
      'createStealthContext must always route through launchStealthBrowser, ' +
      'whose engine-mismatch guard is the only thing that can swap engines');
  });
});

describe('R11.2 create_context forwards the tool-level engine', () => {
  test('server.js maps engine for create_context the way scrape does', () => {
    const src = read('server.js');
    const createContextCall = src.match(
      /createStealthContext\(\{\s*\.\.\.\(stealthConfig \|\| \{\}\),\s*engine:\s*engine === 'camoufox' \? 'camoufox' : 'chromium'\s*\}\)/
    );
    assert.ok(createContextCall,
      'create_context must pass the mapped engine into createStealthContext');
  });
});

describe('R11.3 extract_structured placeholder-aware retry', () => {
  const src = read('src/tools/extract/extractStructured.js');

  test('placeholder answers in required fields count as missing', () => {
    assert.ok(/isPlaceholder/.test(src), 'placeholder detector present');
    assert.ok(/missingRequired/.test(src), 'missingRequired computed');
    const detector = src.match(/const isPlaceholder = [\s\S]*?;\n/);
    assert.ok(detector, 'detector definition found');
    // eslint-disable-next-line no-new-func
    const isPlaceholder = new Function(`${detector[0]} return isPlaceholder;`)();
    for (const v of [null, undefined, '', '  ', 'N/A', 'n/a', 'NA', 'unknown', 'Not Available', 'none', 'null']) {
      assert.equal(isPlaceholder(v), true, `${JSON.stringify(v)} is a placeholder`);
    }
    for (const v of ['2.55.0', '0', 'Nashville', 'not applicable to v2', 'naïve']) {
      assert.equal(isPlaceholder(v), false, `${JSON.stringify(v)} is a real value`);
    }
  });

  test('the retry trigger and keep-comparison both use missingRequired', () => {
    assert.ok(/guarded\.missingRequired\.length > 0/.test(src),
      'retry must fire on missing (nulled OR placeholder) required fields');
    assert.ok(/retryGuarded\.missingRequired\.length < guarded\.missingRequired\.length/.test(src),
      'a retry is kept only when strictly fewer required fields are missing');
    assert.ok(!/guarded\.nulledRequired\.length > 0/.test(src),
      'the old null-only trigger must not remain');
  });
});

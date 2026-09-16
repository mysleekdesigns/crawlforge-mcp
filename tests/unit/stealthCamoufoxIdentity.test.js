/**
 * Regression lock: camoufox is not dressed up as Chromium.
 *
 * camoufox exists because it spoofs in its own C++/Juggler layer, where a page
 * cannot find the seam. We were undoing that on every camoufox context:
 *
 *   - `contextOptions.userAgent` overwrote camoufox's Firefox identity, and for
 *     this engine the browser distribution is left open — so roughly two thirds
 *     of camoufox contexts announced a CHROME User-Agent on a Gecko engine.
 *   - `extraHTTPHeaders` carried sec-ch-ua, sec-ch-ua-mobile and
 *     sec-ch-ua-platform: Chromium client hints Firefox has never implemented.
 *     A detector can act on that before any script runs, and
 *     applyPageStealthMeasures set them a second time at page level.
 *   - Every anti-fingerprinting init script was injected on top of the engine's
 *     own spoofing, main-world JS against an engine that needs none.
 *
 * None of this clears deviceandbrowserinfo.com's hasInconsistentWorkerValues on
 * camoufox — that flag stays set with all of our spoofing disabled, so it is
 * camoufox's own leak. These tests hold our share of the problem at zero.
 *
 * Run: node --test --test-force-exit tests/unit/stealthCamoufoxIdentity.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { StealthBrowserManager, CamoufoxAdapter } from '../../src/core/StealthBrowserManager.js';

const PROXIED = {
  proxyRotation: { enabled: true, proxies: ['http://alice:s3cret@proxy.example.com:8080'], rotationInterval: 300000 }
};

const fakeContext = () => {
  const target = { initScripts: [] };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'then') return undefined;
      if (prop === 'addInitScript') return async (fn, arg) => { t.initScripts.push({ fn, arg }); };
      return async () => [];
    }
  });
};

const fakeBrowser = (engine) => {
  const browser = {
    engine,
    closed: false,
    newContextOptions: [],
    isConnected: () => !browser.closed,
    close: async () => { browser.closed = true; },
    process: () => null,
    newContext: async (options) => { browser.newContextOptions.push(options); return fakeContext(); }
  };
  return browser;
};

/** Leave _doLaunchStealthBrowser's real camoufox branch in play; replace only the launcher. */
const stubCamoufox = (t) => {
  const realLaunch = CamoufoxAdapter.prototype.launch;
  const realAvailable = CamoufoxAdapter.prototype.isAvailable;
  CamoufoxAdapter.prototype.isAvailable = async () => true;
  CamoufoxAdapter.prototype.launch = async () => fakeBrowser('camoufox');
  t.after(() => {
    CamoufoxAdapter.prototype.launch = realLaunch;
    CamoufoxAdapter.prototype.isAvailable = realAvailable;
  });
};

const stubChromium = (manager) => {
  manager._doLaunchStealthBrowser = async (config) => {
    manager.browser = fakeBrowser(config.engine);
    manager._launchedEngine = config.engine;
    return manager.browser;
  };
  return manager;
};

// ── identity ────────────────────────────────────────────────────────────────

describe('camoufox keeps its own browser identity', () => {
  test('no User-Agent and no client-hint headers are forced onto a camoufox context', async (t) => {
    stubCamoufox(t);
    const manager = new StealthBrowserManager();
    await manager.createStealthContext({ engine: 'camoufox' });

    const options = manager.browser.newContextOptions[0];
    assert.ok(!('userAgent' in options), 'camoufox announces its own Firefox UA');
    assert.ok(!('extraHTTPHeaders' in options), 'sec-ch-ua* are Chromium client hints Firefox never sends');
    await manager.cleanup();
  });

  test('chromium still gets both — the fix must not reach across engines', async () => {
    const manager = stubChromium(new StealthBrowserManager());
    await manager.createStealthContext({ engine: 'chromium' });

    const options = manager.browser.newContextOptions[0];
    assert.match(options.userAgent, /Chrome\/\d+/);
    assert.ok(options.extraHTTPHeaders['sec-ch-ua'], 'Chromium does send client hints');
    await manager.cleanup();
  });

  test('behind a proxy, geoip owns the locale, timezone and geolocation', async (t) => {
    stubCamoufox(t);
    const manager = new StealthBrowserManager();
    await manager.createStealthContext({ engine: 'camoufox', ...PROXIED });

    const options = manager.browser.newContextOptions[0];
    for (const key of ['locale', 'timezoneId', 'geolocation']) {
      assert.ok(!(key in options), `${key} would override what camoufox derived from the exit IP`);
    }
    assert.ok(options.proxy, 'the proxy itself is still set on the context');
    await manager.cleanup();
  });

  test('with no proxy there is nothing to derive from, so the caller\'s locale stands', async (t) => {
    stubCamoufox(t);
    const manager = new StealthBrowserManager();
    await manager.createStealthContext({ engine: 'camoufox', locale: 'de-DE' });

    const options = manager.browser.newContextOptions[0];
    assert.equal(options.locale, 'de-DE');
    assert.ok(options.timezoneId, 'and its timezone with it');
    await manager.cleanup();
  });
});

describe('the fingerprint we report matches what is applied', () => {
  test('camoufox reports null for the fields its engine owns', async (t) => {
    stubCamoufox(t);
    const manager = new StealthBrowserManager();
    const { fingerprint } = await manager.createStealthContext({ engine: 'camoufox', ...PROXIED });

    const summary = manager.summarizeFingerprint(fingerprint);
    assert.deepEqual(summary, {
      userAgent: null,
      platform: null,
      locale: null,
      timezone: null,
      viewport: null
    }, 'create_context must not report a Chrome UA and a persona camoufox never uses');
    await manager.cleanup();
  });

  test('without a proxy only the identity is the engine\'s; the locale is still ours', async (t) => {
    stubCamoufox(t);
    const manager = new StealthBrowserManager();
    const { fingerprint } = await manager.createStealthContext({ engine: 'camoufox', locale: 'de-DE' });

    const summary = manager.summarizeFingerprint(fingerprint);
    assert.equal(summary.userAgent, null);
    assert.equal(summary.locale, 'de-DE');
    assert.ok(summary.timezone, 'and the timezone that goes with it');
    await manager.cleanup();
  });

  test('chromium reports a full fingerprint, as before', async () => {
    const manager = stubChromium(new StealthBrowserManager());
    const { fingerprint } = await manager.createStealthContext({ engine: 'chromium' });

    const summary = manager.summarizeFingerprint(fingerprint);
    assert.match(summary.userAgent, /Chrome\/\d+/);
    assert.ok(summary.platform);
    assert.ok(summary.viewport.width > 0);
    await manager.cleanup();
  });
});

// ── injection ───────────────────────────────────────────────────────────────

describe('nothing is injected into camoufox', () => {
  for (const level of ['basic', 'medium', 'advanced']) {
    test(`a camoufox context at the ${level} level gets no init scripts`, async (t) => {
      stubCamoufox(t);
      const manager = new StealthBrowserManager();
      const { context } = await manager.createStealthContext({ engine: 'camoufox', level });
      assert.deepEqual(context.initScripts, []);
      await manager.cleanup();
    });
  }

  test('chromium is still fully instrumented', async () => {
    const manager = stubChromium(new StealthBrowserManager());
    const { context } = await manager.createStealthContext({ engine: 'chromium', level: 'advanced' });
    assert.ok(context.initScripts.length > 5, 'the Chromium path is unchanged');
    await manager.cleanup();
  });

  test('page-level headers are not set on a non-Chromium page', async () => {
    // applyPageStealthMeasures set them a second time, after the context had
    // been cleaned — so the guard has to exist in both places.
    const manager = new StealthBrowserManager();
    const headerCalls = [];
    const page = (engineName) => ({
      route: async () => {},
      setExtraHTTPHeaders: async (headers) => { headerCalls.push(headers); },
      context: () => ({ browser: () => ({ browserType: () => ({ name: () => engineName }) }) })
    });
    const fingerprint = { headers: { 'sec-ch-ua': '"Chromium";v="151"' } };

    await manager.applyPageStealthMeasures(page('firefox'), { level: 'medium' }, fingerprint);
    assert.deepEqual(headerCalls, [], 'camoufox runs on firefox — no client hints');

    await manager.applyPageStealthMeasures(page('chromium'), { level: 'medium' }, fingerprint);
    assert.deepEqual(headerCalls, [fingerprint.headers], 'Chromium still gets them');
  });
});

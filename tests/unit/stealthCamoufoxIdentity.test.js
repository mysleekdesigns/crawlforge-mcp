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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { StealthBrowserManager, CamoufoxAdapter, resolveStealthEngine } from '../../src/core/StealthBrowserManager.js';

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

/**
 * Leave _doLaunchStealthBrowser's real camoufox branch in play; replace only
 * the launcher. Returns the configs it was launched with — camoufox fixes its
 * identity at launch, so that is where several of these settings now land.
 */
const stubCamoufox = (t) => {
  const realLaunch = CamoufoxAdapter.prototype.launch;
  const realAvailable = CamoufoxAdapter.prototype.isAvailable;
  const launches = [];
  CamoufoxAdapter.prototype.isAvailable = async () => true;
  CamoufoxAdapter.prototype.launch = async (config) => { launches.push(config); return fakeBrowser('camoufox'); };
  t.after(() => {
    CamoufoxAdapter.prototype.launch = realLaunch;
    CamoufoxAdapter.prototype.isAvailable = realAvailable;
  });
  return launches;
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

  test('with no proxy the caller\'s locale reaches the launcher, not the context', async (t) => {
    const launches = stubCamoufox(t);
    const manager = new StealthBrowserManager();
    await manager.createStealthContext({ engine: 'camoufox', locale: 'de-DE' });

    // The caller still gets de-DE — but from camoufox itself, which sets
    // language, Accept-Language and Intl in its own engine. Playwright's
    // Firefox context override reaches the document and not the worker started
    // from it, so setting it there read ["de-DE"] in the page beside camoufox's
    // own list in the worker (2026-09-21 benchmark, worker-languages).
    assert.equal(launches[0].locale, 'de-DE', 'the caller\'s locale must not be dropped');
    const options = manager.browser.newContextOptions[0];
    assert.ok(!('locale' in options), 'and must not be set a second time on the context');
    assert.ok(options.timezoneId, 'with no exit IP to derive one from, the persona timezone stands');
    await manager.cleanup();
  });

  test('behind a proxy the locale is geoip\'s, so the caller\'s is not passed either', async (t) => {
    const launches = stubCamoufox(t);
    const manager = new StealthBrowserManager();
    await manager.createStealthContext({ engine: 'camoufox', locale: 'de-DE', ...PROXIED });

    // A de-DE persona behind a US exit IP is the contradiction geoip exists to
    // avoid, so the exit IP wins — the same precedence the timezone and
    // geolocation already follow.
    assert.equal(launches[0].locale, null);
    assert.equal(launches[0].geoip, true);
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
    // Reported because it was applied — at launch, where camoufox owns it.
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

/**
 * Regression lock: the UA's two version tokens agree.
 *
 * camoufox@0.1.19 rewrites persona version tokens with a non-global regex, so
 * its rewrite reaches `rv:` and stops. `Firefox/` keeps whatever browserforge
 * drew, and on the installed 135 binary 4 of 8 launches announced a Firefox
 * that was not the one running. Phase 2 made camoufox the DEFAULT engine, so
 * that coin flip moved onto the default path — hence the pin, and hence this.
 */
describe('camoufox persona is pinned to the installed binary version', () => {
  const adapter = new CamoufoxAdapter();

  const withVersionDir = (version, fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camoufox-ver-'));
    try {
      fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ version }));
      return fn({ INSTALL_DIR: dir });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  test('returns null rather than guessing when version.json is unreadable', () => {
    assert.equal(adapter._pinnedFingerprint({ INSTALL_DIR: '/nonexistent-camoufox-dir' }), null);
    assert.equal(adapter._pinnedFingerprint({}), null);
  });

  test('returns null for a version browserforge has no data for', () => {
    // 152 is outside browserforge's set. Handing back a persona on some other
    // version would reintroduce the exact mismatch the pin exists to close.
    assert.equal(withVersionDir('152.0.4', (c) => adapter._pinnedFingerprint(c)), null);
  });

  test('a returned persona always has rv: and Firefox/ agreeing on that version', () => {
    const fingerprint = withVersionDir('135.0.1', (c) => adapter._pinnedFingerprint(c));
    if (fingerprint === null) {
      // No browserforge data for 135 in this install — the contract is "null
      // or a matching persona", and null is the honest half of it.
      return;
    }
    const ua = fingerprint.navigator.userAgent;
    assert.match(ua, /Firefox/, 'camoufox only accepts Firefox personas');
    assert.equal(ua.match(/rv:(\d+)/)?.[1], '135', `rv: token in ${ua}`);
    assert.equal(ua.match(/Firefox\/(\d+)/)?.[1], '135', `Firefox/ token in ${ua}`);
  });

  test('repeated draws never disagree', () => {
    for (let i = 0; i < 12; i++) {
      const fingerprint = withVersionDir('135.0.1', (c) => adapter._pinnedFingerprint(c));
      if (fingerprint === null) return;
      const ua = fingerprint.navigator.userAgent;
      assert.equal(
        ua.match(/rv:(\d+)/)?.[1],
        ua.match(/Firefox\/(\d+)/)?.[1],
        `draw ${i} self-contradicts: ${ua}`
      );
    }
  });
});

/**
 * Regression lock: the persona's OS follows the host where browserforge can
 * supply one, and an impossible OS+version pair never costs us the version pin.
 *
 * camoufox@0.1.19 drops its own `os` option (it sends `os`, the generator wants
 * `operatingSystems`), so a Linux host shipped a macOS persona. Phase 2
 * generates the persona itself and can use the right key. The catch: browserforge
 * has NO Firefox 135 on Linux and THROWS rather than returning a mismatch, and an
 * unguarded throw would lose the version pin too — putting the UA back exactly
 * where it started, on the one platform the hosted instance runs.
 */
describe('camoufox persona OS follows the host, without risking the version pin', () => {
  const adapter = new CamoufoxAdapter();
  const realHostOs = CamoufoxAdapter._hostOperatingSystem;

  const withVersionDir = (version, fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camoufox-os-'));
    try {
      fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ version }));
      return fn({ INSTALL_DIR: dir });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  test('host OS mapping uses the generator\'s vocabulary', () => {
    assert.equal(typeof CamoufoxAdapter._hostOperatingSystem(), 'string');
    assert.equal(CamoufoxAdapter._osFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:135.0) Gecko/20100101 Firefox/135.0'), 'macos');
    assert.equal(CamoufoxAdapter._osFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0'), 'windows');
    assert.equal(CamoufoxAdapter._osFromUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:135.0) Gecko/20100101 Firefox/135.0'), 'linux');
    // Android is Linux-derived but is not the host OS this compares against.
    assert.equal(CamoufoxAdapter._osFromUserAgent('Mozilla/5.0 (Android 14; Mobile; rv:135.0) Gecko/20100101 Firefox/135.0'), null);
  });

  test('a host with no data for the pinned version still gets a version-coherent persona', () => {
    // linux + Firefox 135 is exactly that pair: the generator throws.
    CamoufoxAdapter._hostOperatingSystem = () => 'linux';
    try {
      for (let i = 0; i < 6; i++) {
        const fingerprint = withVersionDir('135.0.1', (c) => adapter._pinnedFingerprint(c));
        assert.notEqual(fingerprint, null, 'the throw must not cost us the version pin');
        const ua = fingerprint.navigator.userAgent;
        assert.equal(
          ua.match(/rv:(\d+)/)?.[1],
          ua.match(/Firefox\/(\d+)/)?.[1],
          `draw ${i} lost version coherence: ${ua}`
        );
      }
    } finally {
      CamoufoxAdapter._hostOperatingSystem = realHostOs;
    }
  });

  test('where the pair IS available the persona claims the host OS', () => {
    CamoufoxAdapter._hostOperatingSystem = () => 'windows';
    try {
      const fingerprint = withVersionDir('135.0.1', (c) => adapter._pinnedFingerprint(c));
      if (fingerprint === null) return;
      assert.equal(CamoufoxAdapter._osFromUserAgent(fingerprint.navigator.userAgent), 'windows');
    } finally {
      CamoufoxAdapter._hostOperatingSystem = realHostOs;
    }
  });
});

/**
 * Regression lock: an operator can pin which engine `auto` resolves to, because
 * which engine wins depends on the exit IP and no single global default is right.
 */
describe('CRAWLFORGE_STEALTH_ENGINE pins auto per deployment', () => {
  const withEngineEnv = async (value, fn) => {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'CRAWLFORGE_STEALTH_ENGINE');
    const before = process.env.CRAWLFORGE_STEALTH_ENGINE;
    if (value === undefined) delete process.env.CRAWLFORGE_STEALTH_ENGINE;
    else process.env.CRAWLFORGE_STEALTH_ENGINE = value;
    try { return await fn(); }
    finally {
      if (had) process.env.CRAWLFORGE_STEALTH_ENGINE = before;
      else delete process.env.CRAWLFORGE_STEALTH_ENGINE;
    }
  };

  test('chromium and playwright both pin auto to chromium, with no warning', async () => {
    for (const value of ['chromium', 'playwright', 'CHROMIUM', '  chromium  ']) {
      await withEngineEnv(value, async () => {
        assert.deepEqual(await resolveStealthEngine('auto'), { engine: 'chromium', fallbackWarning: null });
        assert.deepEqual(await resolveStealthEngine(undefined), { engine: 'chromium', fallbackWarning: null });
      });
    }
  });

  test('an unrecognised value is ignored rather than fatal', async () => {
    await withEngineEnv('nonsense', async () => {
      const resolved = await resolveStealthEngine('auto');
      assert.ok(['camoufox', 'chromium'].includes(resolved.engine));
    });
  });

  test('a caller naming an engine still overrides the deployment pin', async () => {
    await withEngineEnv('chromium', async () => {
      assert.deepEqual(await resolveStealthEngine('camoufox'), { engine: 'camoufox', fallbackWarning: null });
    });
  });
});

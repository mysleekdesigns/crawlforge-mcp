/**
 * Phase 1 of docs/STEALTH_REVIEW_2026-09.md: the fingerprint leaks and flag
 * tells the Phase 0 benchmark measured, locked as unit assertions.
 *
 * Eight checks in scripts/lib/stealth-bench/ci-baseline.json were failing at
 * v6.7.0. What a unit test can hold is the code that produces them — the flags
 * on the command line, the brand list handed to the renderer, the OS the
 * persona is drawn from, the version the UA states, and which identity fields
 * are set through CDP rather than defined onto the document's navigator by an
 * init script (an init script does not run in a Worker, which is the whole
 * shape of the worker-* failures). Whether the browser then reports what it was
 * told is the benchmark's job, not this file's: nothing here launches anything.
 *
 * Run: node --test --test-force-exit tests/unit/stealthPhase1.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

import { StealthBrowserManager, CamoufoxAdapter } from '../../src/core/StealthBrowserManager.js';

// ── fakes ───────────────────────────────────────────────────────────────────

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

const fakeBrowser = (engine, version = '151.0.7922.34') => {
  const browser = {
    engine,
    closed: false,
    newContextOptions: [],
    version: () => version,
    on: () => {},
    isConnected: () => !browser.closed,
    close: async () => { browser.closed = true; },
    process: () => null,
    newContext: async (options) => { browser.newContextOptions.push(options); return fakeContext(); }
  };
  return browser;
};

/** Replace playwright's launcher, keeping _doLaunchStealthBrowser's real arg building. */
const captureChromiumLaunch = (t, { version } = {}) => {
  const real = chromium.launch;
  const calls = [];
  chromium.launch = async (options) => {
    calls.push(options);
    return fakeBrowser('chromium', version);
  };
  t.after(() => { chromium.launch = real; });
  return calls;
};

/** Replace camoufox's launcher, keeping the real camoufox branch in play. */
const captureCamoufoxLaunch = (t) => {
  const realLaunch = CamoufoxAdapter.prototype.launch;
  const realAvailable = CamoufoxAdapter.prototype.isAvailable;
  const calls = [];
  CamoufoxAdapter.prototype.isAvailable = async () => true;
  CamoufoxAdapter.prototype.launch = async (config) => { calls.push(config); return fakeBrowser('camoufox'); };
  t.after(() => {
    CamoufoxAdapter.prototype.launch = realLaunch;
    CamoufoxAdapter.prototype.isAvailable = realAvailable;
  });
  return calls;
};

/** The source of every init script a context was given, as one string. */
const initScriptSource = (context) =>
  context.initScripts.map(({ fn }) => (typeof fn === 'function' ? fn.toString() : String(fn))).join('\n');

/**
 * A browser-shaped enough sandbox to RUN the init scripts in, so the
 * own-property invariant is asserted the way a page reads it rather than by
 * grepping the source. Only what the scripts actually touch is stubbed:
 * Navigator with the five prototype members Chromium 151 has, an empty
 * PluginArray (the branch that replaces the plugin list), permissions,
 * mediaDevices and Notification.
 */
function browserSandbox() {
  const iface = (name, members) => {
    const Ctor = function () {};
    Object.defineProperty(Ctor, 'name', { value: name });
    for (const [key, descriptor] of Object.entries(members)) {
      Object.defineProperty(Ctor.prototype, key, { configurable: true, enumerable: true, ...descriptor });
    }
    return Ctor;
  };

  const Plugin = iface('Plugin', {});
  const MimeType = iface('MimeType', {});
  const MimeTypeArray = iface('MimeTypeArray', {});
  const PluginArray = iface('PluginArray', {});
  const emptyPlugins = Object.create(PluginArray.prototype);
  Object.defineProperty(emptyPlugins, 'length', { value: 0 });

  // The native values are deliberately distinguishable from the spoofed ones,
  // so a test that reads a spoofed value proves the script ran.
  const Navigator = iface('Navigator', {
    webdriver: { get: () => false },
    connection: { get: () => ({ effectiveType: 'native' }) },
    plugins: { get: () => emptyPlugins },
    mimeTypes: { get: () => Object.create(MimeTypeArray.prototype) },
    getBattery: { writable: true, value: function getBattery() { return Promise.resolve({ native: true }); } },
    permissions: { get: () => ({ query: async () => ({ state: 'granted' }) }) },
    mediaDevices: { get: () => ({ enumerateDevices: async () => [] }) }
  });

  const navigator = Object.create(Navigator.prototype);
  const context = vm.createContext({
    Navigator, navigator, Plugin, MimeType, PluginArray, MimeTypeArray,
    Notification: { permission: 'default' },
    screen: {}, document: {}, location: { href: 'https://example.com/' }
  });
  context.window = context;
  return context;
}

/** Run one init-script function inside the sandbox, with its serialized argument. */
function runInitScript(sandbox, { fn, arg }) {
  vm.runInContext(`(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`, sandbox);
}

// ── launch flags ────────────────────────────────────────────────────────────

describe('the launch command line no longer names a stealth driver', () => {
  test('patchright\'s four flags are off the args AND off the defaults', async (t) => {
    const calls = captureChromiumLaunch(t);
    const manager = new StealthBrowserManager();
    await manager.launchStealthBrowser({ engine: 'chromium', level: 'advanced' });

    const { args, ignoreDefaultArgs } = calls[0];
    // Playwright passes all four by default, so dropping them from args is
    // only half the job — both halves have to be here.
    for (const flag of ['--disable-component-update', '--disable-default-apps', '--disable-extensions', '--disable-popup-blocking']) {
      assert.ok(!args.includes(flag), `${flag} is still on the command line`);
      assert.ok(ignoreDefaultArgs.includes(flag), `${flag} is still in Playwright's defaults`);
    }
    await manager.cleanup();
  });

  test('--disable-web-security and --disable-site-isolation-trials are gone', async (t) => {
    const calls = captureChromiumLaunch(t);
    const manager = new StealthBrowserManager();
    await manager.launchStealthBrowser({ engine: 'chromium', level: 'advanced' });

    // Readable from any page in one line (a cross-origin fetch that should
    // throw and does not), and a contradiction of this file's own decision to
    // leave bypassCSP unset.
    assert.ok(!calls[0].args.includes('--disable-web-security'));
    assert.ok(!calls[0].args.includes('--disable-site-isolation-trials'));
    await manager.cleanup();
  });

  test('headless reports a real mouse, and WebRTC is held to the proxied route', async (t) => {
    const calls = captureChromiumLaunch(t);
    const manager = new StealthBrowserManager();
    await manager.launchStealthBrowser({ engine: 'chromium' });

    const { args } = calls[0];
    assert.ok(
      args.includes('--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'),
      'headless otherwise answers hover:none, which no desktop persona does'
    );
    assert.ok(args.includes('--webrtc-ip-handling-policy=disable_non_proxied_udp'));
    // The five it replaced disabled hardware codecs, not the address leak.
    assert.ok(!args.some((arg) => arg.startsWith('--disable-webrtc-')), 'the hardware-codec flags are gone');
    await manager.cleanup();
  });
});

// ── the version the UA states ───────────────────────────────────────────────

describe('the user agent states the version of the binary that launched', () => {
  test('the pool is built from playwright-core\'s browsers.json', () => {
    const require = createRequire(import.meta.url);
    const file = path.join(path.dirname(require.resolve('playwright-core')), 'browsers.json');
    const installed = JSON.parse(fs.readFileSync(file, 'utf8')).browsers.find((b) => b.name === 'chromium');

    const manager = new StealthBrowserManager();
    assert.equal(manager.chromeVersion, installed.browserVersion);
    for (const [os, pool] of Object.entries(manager.userAgentPools.chrome)) {
      assert.equal(pool.length, 1, `${os} still draws from a pool of versions`);
      assert.equal(Number(pool[0].match(/Chrome\/(\d+)/)[1]), manager.chromeMajor, `${os} UA mis-states the binary`);
    }
  });

  test('a system Chromium of another version re-derives the pool at launch', async (t) => {
    captureChromiumLaunch(t, { version: '162.0.1234.5' });
    const manager = new StealthBrowserManager();
    await manager.launchStealthBrowser({ engine: 'chromium' });

    assert.equal(manager.chromeMajor, 162);
    const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
    assert.match(fp.userAgent, /Chrome\/162\.0\.0\.0/);
    assert.match(fp.headers['sec-ch-ua'], /"Google Chrome";v="162"/);
    await manager.cleanup();
  });
});

// ── the OS the persona claims ───────────────────────────────────────────────

describe('the persona OS is observed, not drawn', () => {
  test('hostOS maps the platform this process is on', () => {
    const manager = new StealthBrowserManager();
    const expected = { darwin: 'macos', win32: 'windows' }[process.platform] || 'linux';
    assert.equal(manager.hostOS(), expected);
    assert.equal(manager.selectOS({ useRandomUserAgent: true }), expected);
    // A pinned UA still wins: the caller named the OS by naming the UA.
    assert.equal(
      manager.selectOS({ customUserAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36' }),
      'linux'
    );
  });

  test('camoufox is told which OS to generate, instead of drawing one', async (t) => {
    const calls = captureCamoufoxLaunch(t);
    const manager = new StealthBrowserManager();
    await manager.launchStealthBrowser({ engine: 'camoufox' });

    assert.equal(calls[0].os, manager.hostOS(), 'left unset, camoufox picks one of the three at random');
    // A plain string: camoufox ignores a one-element ARRAY and falls back to
    // the random draw, which yields a Windows persona (measured 2026-09-21).
    assert.equal(typeof calls[0].os, 'string');
    await manager.cleanup();
  });

  test('the adapter passes os and locale through to camoufox\'s own option names', async () => {
    const adapter = new CamoufoxAdapter();
    const seen = [];
    adapter._load = async () => ({ Camoufox: async (options) => { seen.push(options); return fakeBrowser('camoufox'); } });
    adapter._ensureMacOSLayout = async () => {};

    await adapter.launch({ headless: true, os: 'macos', locale: 'de-DE' });
    assert.equal(seen[0].os, 'macos');
    assert.equal(seen[0].locale, 'de-DE');

    await adapter.launch({ headless: true });
    assert.ok(!('os' in seen[1]), 'an option we did not ask for is still left off entirely');
    assert.ok(!('locale' in seen[1]));
  });
});

// ── userAgentData ───────────────────────────────────────────────────────────

describe('userAgentData is a real Chrome, in every field it is read from', () => {
  test('brands carry Google Chrome and no headless brand', () => {
    const manager = new StealthBrowserManager();
    const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
    const metadata = manager.generateUserAgentMetadata(fp);
    const major = fp.userAgent.match(/Chrome\/(\d+)/)[1];

    assert.ok(metadata.brands.some((b) => b.brand === 'Google Chrome' && b.version === major));
    assert.ok(!metadata.brands.some((b) => /headless/i.test(b.brand)));
    // fullVersionList is where a high-entropy read would otherwise find the
    // binary's own "HeadlessChrome" — omitting it means Chromium fills it in.
    assert.ok(metadata.fullVersionList.length === metadata.brands.length);
    assert.ok(!metadata.fullVersionList.some((b) => /headless/i.test(b.brand)));
    assert.equal(metadata.fullVersion, manager.chromeVersion);
    assert.equal(metadata.platform, { macos: 'macOS', windows: 'Windows', linux: 'Linux' }[manager.hostOS()]);
    assert.equal(metadata.mobile, false);
  });

  test('the sec-ch-ua header and the JS brands are one list', () => {
    const manager = new StealthBrowserManager();
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
    const header = manager.generateSecChUaHeader(ua);
    for (const { brand, version } of manager.generateUserAgentBrands(ua)) {
      assert.ok(header.includes(`"${brand}";v="${version}"`), `${brand} is in the JS brands but not the header`);
    }
  });

  test('a custom UA on another major does not borrow this binary\'s build number', () => {
    const manager = new StealthBrowserManager();
    const metadata = manager.generateUserAgentMetadata({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      hardware: { platform: 'Win32', hardwareConcurrency: 8 }
    });
    assert.equal(metadata.fullVersion, '138.0.0.0');
    assert.ok(metadata.brands.every((b) => b.version === '8' || b.version === '138'));
  });
});

// ── the worker vantage point ────────────────────────────────────────────────

describe('identity is emulated, not defined onto the document', () => {
  const cdpPage = (engineName, sent) => ({
    context: () => ({
      browser: () => ({ browserType: () => ({ name: () => engineName }) }),
      newCDPSession: async () => ({ send: async (method, params) => { sent.push([method, params]); } })
    }),
    setExtraHTTPHeaders: async () => {},
    route: async () => { throw new Error('applyPageStealthMeasures must not route the page'); }
  });

  test('a chromium page is told its UA, platform, languages and brands', async () => {
    const manager = new StealthBrowserManager();
    const fp = manager.generateAdvancedFingerprint({ locale: 'de-DE', useRandomUserAgent: true });
    const sent = [];
    await manager.applyPageStealthMeasures(cdpPage('chromium', sent), { level: 'medium' }, fp);

    const ua = sent.find(([method]) => method === 'Emulation.setUserAgentOverride');
    assert.ok(ua, 'the user agent override is what carries the brands');
    assert.equal(ua[1].userAgent, fp.userAgent);
    assert.equal(ua[1].platform, fp.hardware.platform);
    assert.ok(ua[1].userAgentMetadata.brands.some((b) => b.brand === 'Google Chrome'));

    // The plain tag, not "de-DE,de": this override reaches the document only,
    // while a worker's navigator.languages comes from the context locale, so a
    // second entry re-creates the mismatch it was meant to close (measured
    // 2026-09-21, worker-languages). And not omitted either — that would clear
    // the override Playwright installed.
    assert.equal(ua[1].acceptLanguage, 'de-DE');

    // No hardware override: hardwareConcurrency is the host's own value now, so
    // there is nothing to set, and Emulation is not available on a worker
    // target anyway.
    assert.ok(!sent.some(([method]) => method === 'Emulation.setHardwareConcurrencyOverride'));
  });

  test('a camoufox page gets nothing: Firefox has no CDP and needs none', async () => {
    const manager = new StealthBrowserManager();
    const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
    const sent = [];
    await manager.applyPageStealthMeasures(cdpPage('firefox', sent), { level: 'medium' }, fp);
    assert.deepEqual(sent, []);
  });

  test('the Accept-Language header still carries the fallback the document does not', () => {
    const manager = new StealthBrowserManager();
    const fp = manager.generateAdvancedFingerprint({ locale: 'de-DE', useRandomUserAgent: true });
    // What a real Chrome does for a single-locale preference: the header
    // expands, navigator.languages does not.
    assert.equal(fp.headers['Accept-Language'], 'de-DE,de;q=0.9');
  });

  test('nothing becomes an own property of the navigator instance', async () => {
    const manager = new StealthBrowserManager();
    manager._doLaunchStealthBrowser = async (config) => {
      manager.browser = fakeBrowser(config.engine);
      manager._launchedEngine = config.engine;
      return manager.browser;
    };
    const { context } = await manager.createStealthContext({ engine: 'chromium', level: 'advanced' });

    // Run them for real rather than grepping: a real Chrome answers
    // Object.getOwnPropertyNames(navigator) with an empty array, because every
    // property it has is inherited. rebrowser prints that list, and it read
    // ["connection","plugins","mimeTypes","getBattery"] (2026-09-21 bench).
    const sandbox = browserSandbox();
    for (const script of context.initScripts) {
      try {
        runInitScript(sandbox, script);
      } catch (error) {
        // A script that needs a DOM this stub does not have is not under test
        // here; one that puts a property on navigator is, and it would have to
        // get that far first.
        if (/is not defined|is not a function/.test(error.message)) continue;
        throw error;
      }
    }

    assert.deepEqual(
      Object.getOwnPropertyNames(sandbox.navigator), [],
      'every spoofed navigator member belongs on Navigator.prototype'
    );
    // …and the spoofs did land on the prototype, so the assertion above is not
    // passing because nothing ran. The stub's own values say "native".
    assert.equal(sandbox.navigator.connection.effectiveType, '4g');
    assert.equal(typeof Object.getOwnPropertyDescriptor(sandbox.Navigator.prototype, 'connection').get, 'function');
    // getBattery is a WebIDL operation: a writable value on the prototype, not
    // an accessor, which is the shape a real Navigator has.
    const battery = Object.getOwnPropertyDescriptor(sandbox.Navigator.prototype, 'getBattery');
    assert.equal(typeof battery.value, 'function');
    assert.equal(battery.writable, true);
    assert.equal(battery.configurable, true);
    assert.equal(typeof (await sandbox.navigator.getBattery()).level, 'number', 'the spoofed battery, not the stub\'s');
    // The empty plugin list was replaced, on the prototype.
    assert.equal(sandbox.navigator.plugins.length, 5);
    assert.ok(sandbox.navigator.plugins instanceof sandbox.PluginArray);
    await manager.cleanup();
  });

  test('no init script defines platform, hardwareConcurrency, languages or deviceMemory', async () => {
    const manager = new StealthBrowserManager();
    manager._doLaunchStealthBrowser = async (config) => {
      manager.browser = fakeBrowser(config.engine);
      manager._launchedEngine = config.engine;
      return manager.browser;
    };
    const { context } = await manager.createStealthContext({ engine: 'chromium', level: 'advanced' });
    const source = initScriptSource(context);

    for (const field of ['platform', 'hardwareConcurrency', 'languages', 'deviceMemory']) {
      assert.ok(
        !source.includes(`defineProperty(navigator, '${field}'`),
        `${field} is still defined onto the document's navigator, where a worker cannot see it`
      );
    }
    await manager.cleanup();
  });
});

// ── hardware is observed, not drawn ─────────────────────────────────────────

describe('the core count and device memory are the host\'s own', () => {
  test('hardwareConcurrency is what the machine has, so a worker cannot contradict it', () => {
    const manager = new StealthBrowserManager();
    // Emulation.setHardwareConcurrencyOverride is page-level and a Worker is a
    // separate target with no Emulation domain, so there is no override that
    // reaches one. 16 cores in the document beside 32 in the worker is the
    // contradiction; reporting 32 in both is not (2026-09-21 benchmark).
    const expected = manager.hostHardwareConcurrency();
    assert.ok(expected > 0);
    for (let i = 0; i < 20; i++) {
      const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
      assert.equal(fp.hardware.hardwareConcurrency, expected);
    }
  });

  test('the processor persona matches the count it claims', () => {
    const manager = new StealthBrowserManager();
    const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
    const cores = Number(/(\d+)-Core/.exec(fp.hardware.processor)?.[1]);
    if (Number.isFinite(cores)) {
      assert.ok(
        cores === fp.hardware.hardwareConcurrency || cores * 2 === fp.hardware.hardwareConcurrency,
        `${fp.hardware.processor} does not fit ${fp.hardware.hardwareConcurrency} threads`
      );
    }
  });

  test('deviceMemory is Chromium\'s approximation of the host\'s RAM', () => {
    const manager = new StealthBrowserManager();
    const value = manager.hostDeviceMemory();
    // The clamp is why 16 and 32 are values no real browser reports.
    assert.ok([0.25, 0.5, 1, 2, 4, 8].includes(value), `${value} is not a value Chrome reports`);
    assert.equal(manager.generateAdvancedFingerprint({ locale: 'en-US' }).hardware.deviceMemory, value);
  });

  test('the Worker wrapper is installed only when the platform is not the host\'s', async () => {
    const manager = new StealthBrowserManager();
    manager._doLaunchStealthBrowser = async (config) => {
      manager.browser = fakeBrowser(config.engine);
      manager._launchedEngine = config.engine;
      return manager.browser;
    };
    const wraps = (context) => context.initScripts.some((s) => s.fn.toString().includes('NativeWorker'));

    const own = await manager.createStealthContext({ engine: 'chromium', level: 'advanced' });
    assert.ok(!wraps(own.context), 'a host-OS persona has nothing for the wrapper to reconcile');

    const foreign = { windows: 'X11; Linux x86_64', macos: 'X11; Linux x86_64', linux: 'Macintosh; Intel Mac OS X 10_15_7' };
    const pinned = await manager.createStealthContext({
      engine: 'chromium',
      level: 'advanced',
      customUserAgent: `Mozilla/5.0 (${foreign[manager.hostOS()]}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36`
    });
    assert.ok(wraps(pinned.context), 'a pinned foreign UA is the one case a worker can still contradict');
    await manager.cleanup();
  });
});

// ── navigator.webdriver ─────────────────────────────────────────────────────

describe('navigator.webdriver answers false and keeps the property', () => {
  test('the init script reports false instead of deleting it', async () => {
    const manager = new StealthBrowserManager();
    manager._doLaunchStealthBrowser = async (config) => {
      manager.browser = fakeBrowser(config.engine);
      manager._launchedEngine = config.engine;
      return manager.browser;
    };
    const { context } = await manager.createStealthContext({ engine: 'chromium' });
    const source = initScriptSource(context);

    // A missing property is its own tell: every real Chrome has it and answers
    // false, and rebrowser marks a deleted one red.
    assert.ok(!/delete\s+window\.navigator\.__proto__\.webdriver/.test(source));
    assert.ok(!/delete\s+window\.navigator\.webdriver/.test(source));
    assert.ok(/webdriver[\s\S]{0,120}get: \(\) => false/.test(source), 'it has to answer false');
    await manager.cleanup();
  });

  test('the flag that makes it false natively is still on the command line', async (t) => {
    const calls = captureChromiumLaunch(t);
    const manager = new StealthBrowserManager();
    await manager.launchStealthBrowser({ engine: 'chromium' });
    assert.ok(calls[0].args.includes('--disable-blink-features=AutomationControlled'));
    assert.ok(calls[0].ignoreDefaultArgs.includes('--enable-automation'));
    await manager.cleanup();
  });
});

// ── request interception ────────────────────────────────────────────────────

describe('a stealth page is not routed', () => {
  test('applyPageStealthMeasures installs no route handler', async () => {
    const manager = new StealthBrowserManager();
    let routed = false;
    const page = {
      route: async () => { routed = true; },
      setExtraHTTPHeaders: async () => {},
      context: () => ({
        browser: () => ({ browserType: () => ({ name: () => 'chromium' }) }),
        newCDPSession: async () => ({ send: async () => {} })
      })
    };
    // No userAgent on this fingerprint, so the CDP step returns before asking
    // for a session — the route is the only thing under test here.
    await manager.applyPageStealthMeasures(page, { level: 'advanced' }, { headers: {} });
    assert.equal(routed, false, 'every request round-tripping through node is a timing tell of its own');
  });

  test('nothing is dropped at any level', () => {
    for (const level of ['basic', 'medium', 'advanced']) {
      for (const type of ['document', 'script', 'image', 'font', 'stylesheet', 'xhr']) {
        assert.equal(StealthBrowserManager.shouldAbortRequest(type, level), false, `${type} at ${level}`);
      }
    }
  });
});

// ── the challenge wait-out ──────────────────────────────────────────────────

describe('a custom-titled interstitial gets its wait before the verdict', () => {
  const page = (title, html) => {
    const calls = [];
    return {
      calls,
      title: async () => title,
      content: async () => html,
      waitForFunction: async (...args) => { calls.push(['waitForFunction', args[1]]); },
      waitForLoadState: async (state) => { calls.push(['waitForLoadState', state]); }
    };
  };

  test('the Cloudflare bootstrap triggers the wait even when the title is the hostname', async () => {
    const manager = new StealthBrowserManager();
    // nowsecure.nl's interstitial is titled "nowsecure.nl", so a title-only
    // test skipped the wait entirely and the block verdict fired on a challenge
    // that had not been given its chance (2026-09-21 benchmark, section 2.2).
    const p = page('nowsecure.nl', '<html><body><script>window._cf_chl_opt={cvId:"3"};</script></body></html>');
    await manager._waitOutChallenge(p, { timeoutMs: 10 });
    assert.deepEqual(p.calls, [['waitForFunction', 'nowsecure.nl'], ['waitForLoadState', 'domcontentloaded']]);
  });

  test('a real page that merely embeds a Turnstile widget is still not waited on', async () => {
    const manager = new StealthBrowserManager();
    const p = page(
      'Sign in — Quora',
      '<html><body><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script><p>Log in</p></body></html>'
    );
    await manager._waitOutChallenge(p, { timeoutMs: 10 });
    assert.deepEqual(p.calls, [], 'the widget script host is not a challenge bootstrap');
  });

  test('a page that refuses its html still gets the title-only decision', async () => {
    const manager = new StealthBrowserManager();
    const calls = [];
    // A page mid-navigation answers title() and refuses content(). Losing the
    // marker branch for that call is acceptable; skipping the wait on a known
    // wall is not.
    await manager._waitOutChallenge({
      title: async () => 'Just a moment...',
      content: async () => { throw new Error('Execution context was destroyed'); },
      waitForFunction: async () => { calls.push('waitForFunction'); },
      waitForLoadState: async () => { calls.push('waitForLoadState'); }
    }, { timeoutMs: 10 });
    assert.deepEqual(calls, ['waitForFunction', 'waitForLoadState']);
  });

  test('a page that cannot be read at all is not waited on', async () => {
    const manager = new StealthBrowserManager();
    const calls = [];
    await manager._waitOutChallenge({
      title: async () => { throw new Error('Target page, context or browser has been closed'); },
      content: async () => { throw new Error('Target page, context or browser has been closed'); },
      waitForFunction: async () => { calls.push('waitForFunction'); },
      waitForLoadState: async () => { calls.push('waitForLoadState'); }
    }, { timeoutMs: 10 });
    assert.deepEqual(calls, []);
  });
});

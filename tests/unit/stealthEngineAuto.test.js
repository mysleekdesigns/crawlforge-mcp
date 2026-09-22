/**
 * Phase 2 of the 2026-09 stealth review: the engine that passes the walls is
 * the one that runs by default, and every stealth path can be given an exit IP.
 *
 * Before this, `scrape.escalate_engine`, `stealth_mode.engine` and the manager's
 * own schema all defaulted to Chromium, so the engine the review measured as
 * the one that gets through (camoufox) only ran when a caller knew to name it.
 * The new default is 'auto': camoufox when it is installed, Chromium when it is
 * not — and never silently, which is what these tests hold.
 *
 * The other half is CRAWLFORGE_STEALTH_PROXIES: a server-level proxy list for
 * the paths that have no caller to pass one (the escalation stage, the agent,
 * browser_session). A caller's own list always wins, and a proxy that arrives
 * from the server-level list has to switch camoufox's geoip on exactly like a
 * caller-supplied one — a proxied browser whose geolocation disagrees with its
 * exit IP is a cleaner detection signal than no proxy at all.
 *
 * No browser is launched here: the camoufox launcher and the Chromium launch
 * are stubbed, which is also what lets these run where a browser cannot.
 *
 * Run: node --test --test-force-exit tests/unit/stealthEngineAuto.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// scrapeWithStealth navigates through safeGoto, which blocks loopback. The two
// tests that drive it use a fake page on 127.0.0.1, so the allowlist is set
// before the first transitive import of src/constants/config.js.
process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { StealthBrowserManager, CamoufoxAdapter, resolveStealthEngine } =
  await import('../../src/core/StealthBrowserManager.js');
const { serverStealthProxies } = await import('../../src/constants/config.js');
const { SCRAPE_ESCALATION_SHAPE } = await import('../../src/tools/scrape/escalation.js');

// ── doubles ─────────────────────────────────────────────────────────────────

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
    on: () => {},
    newContext: async (options) => { browser.newContextOptions.push(options); return fakeContext(); }
  };
  return browser;
};

/** Stub the Chromium half only, so the engine decision above it stays real. */
const stubChromiumLaunch = (manager) => {
  const real = manager._doLaunchStealthBrowser.bind(manager);
  manager._doLaunchStealthBrowser = async (config) => {
    await manager._resolveConfigEngine(config);
    if (config.engine === 'camoufox') return real(config);
    manager.browser = fakeBrowser('chromium');
    manager._launchedEngine = 'chromium';
    return manager.browser;
  };
  return manager;
};

/**
 * Replace camoufox's availability and launcher, leaving the real camoufox
 * branch of _doLaunchStealthBrowser in play — that branch is where headless
 * mode, the proxy and geoip are decided.
 */
const stubCamoufox = (t, { available = true } = {}) => {
  const launches = [];
  const realLaunch = CamoufoxAdapter.prototype.launch;
  const realAvailable = CamoufoxAdapter.prototype.isAvailable;
  CamoufoxAdapter.prototype.isAvailable = async () => {
    if (available instanceof Error) throw available;
    return available;
  };
  CamoufoxAdapter.prototype.launch = async (config) => {
    launches.push(config);
    return fakeBrowser('camoufox');
  };
  t.after(() => {
    CamoufoxAdapter.prototype.launch = realLaunch;
    CamoufoxAdapter.prototype.isAvailable = realAvailable;
  });
  return launches;
};

/** Run body with process.platform reporting `platform`, then put it back. */
const onPlatform = async (platform, body) => {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    await body();
  } finally {
    Object.defineProperty(process, 'platform', real);
  }
};

const withEnv = async (value, body) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'CRAWLFORGE_STEALTH_PROXIES');
  const before = process.env.CRAWLFORGE_STEALTH_PROXIES;
  if (value === undefined) delete process.env.CRAWLFORGE_STEALTH_PROXIES;
  else process.env.CRAWLFORGE_STEALTH_PROXIES = value;
  try {
    await body();
  } finally {
    if (had) process.env.CRAWLFORGE_STEALTH_PROXIES = before;
    else delete process.env.CRAWLFORGE_STEALTH_PROXIES;
  }
};

// ── resolveStealthEngine ────────────────────────────────────────────────────

describe('resolveStealthEngine answers for every spelling a tool uses', () => {
  test('an explicitly named engine is returned unchanged, with no warning', async (t) => {
    // Named with camoufox UNAVAILABLE: an explicit request must not be
    // downgraded, or the "camoufox is not installed" error at launch — the
    // only thing that tells an operator to install it — never fires.
    stubCamoufox(t, { available: false });

    assert.deepEqual(await resolveStealthEngine('camoufox'), { engine: 'camoufox', fallbackWarning: null });
    assert.deepEqual(await resolveStealthEngine('chromium'), { engine: 'chromium', fallbackWarning: null });
    // 'playwright' is the tool layer's public name for chromium.
    assert.deepEqual(await resolveStealthEngine('playwright'), { engine: 'chromium', fallbackWarning: null });
  });

  test('"auto", undefined and null all prefer camoufox when it is installed', async (t) => {
    stubCamoufox(t);
    for (const requested of ['auto', undefined, null]) {
      assert.deepEqual(await resolveStealthEngine(requested), { engine: 'camoufox', fallbackWarning: null });
    }
  });

  test('"auto" falls back to chromium with a warning that names why', async (t) => {
    stubCamoufox(t, { available: false });
    const resolved = await resolveStealthEngine('auto');
    assert.equal(resolved.engine, 'chromium');
    assert.match(resolved.fallbackWarning, /camoufox/i);
    assert.match(resolved.fallbackWarning, /chromium/i);
  });

  test('an installed-but-broken camoufox degrades instead of crashing the caller', async (t) => {
    // isAvailable() throws for a package that is present and will not load.
    // That is still a reason to run Chromium, not to fail a scrape — but the
    // real reason has to reach the caller, since "not installed" would send
    // them to reinstall something already there.
    stubCamoufox(t, { available: new Error('camoufox is installed but failed to load: bad ELF header') });
    const resolved = await resolveStealthEngine('auto');
    assert.equal(resolved.engine, 'chromium');
    assert.match(resolved.fallbackWarning, /failed to load: bad ELF header/);
  });
});

// ── the schema defaults ─────────────────────────────────────────────────────

describe('"auto" is the default the schemas hand out', () => {
  test('the manager config schema defaults engine to "auto"', () => {
    const schema = new StealthBrowserManager().getStealthConfigSchema();
    assert.equal(schema.parse({}).engine, 'auto');
    assert.equal(schema.parse({ engine: 'camoufox' }).engine, 'camoufox');
    assert.equal(schema.parse({ engine: 'chromium' }).engine, 'chromium');
  });

  test('scrape.escalate_engine defaults to "auto" and still accepts "playwright"', () => {
    const field = SCRAPE_ESCALATION_SHAPE.escalate_engine;
    assert.equal(field.parse(undefined), 'auto');
    assert.equal(field.parse('playwright'), 'playwright');
    assert.equal(field.parse('camoufox'), 'camoufox');
    assert.throws(() => field.parse('firefox'));
  });
});

// ── the launch path ─────────────────────────────────────────────────────────

describe('a caller may pass "auto" straight through to the manager', () => {
  test('_doLaunchStealthBrowser resolves it itself and records the engine', async (t) => {
    const launches = stubCamoufox(t);
    const manager = new StealthBrowserManager();

    await manager._doLaunchStealthBrowser(manager.getStealthConfigSchema().parse({ engine: 'auto' }));
    assert.equal(launches.length, 1, 'camoufox was the engine actually launched');
    assert.equal(manager._launchedEngine, 'camoufox');
    assert.equal(manager._engineFallbackWarning, null);
    await manager.cleanup();
  });

  test('the fallback is recorded on the instance, not swallowed', async (t) => {
    stubCamoufox(t, { available: false });
    const manager = stubChromiumLaunch(new StealthBrowserManager());

    await manager.launchStealthBrowser({ engine: 'auto' });
    assert.equal(manager._launchedEngine, 'chromium');
    assert.match(manager._engineFallbackWarning, /fell back to chromium/i);
    await manager.cleanup();
    assert.equal(manager._engineFallbackWarning, null, 'cleanup leaves nothing to misreport');
  });

  test('a later call that names an engine leaves no stale warning behind', async (t) => {
    // The instance field describes the browser that is running. A call that
    // asked for chromium by name did not fall back to it, and must not still
    // read as the downgrade an earlier 'auto' call found.
    stubCamoufox(t, { available: false });
    const manager = stubChromiumLaunch(new StealthBrowserManager());

    await manager.launchStealthBrowser({ engine: 'auto' });
    assert.ok(manager._engineFallbackWarning);

    await manager.launchStealthBrowser({ engine: 'chromium' });
    assert.equal(manager._engineFallbackWarning, null);
    await manager.cleanup();
  });

  test('"auto" does not park and relaunch the browser it already has', async (t) => {
    // An unresolved 'auto' never equals _launchedEngine, so the engine-mismatch
    // branch would fire on every call and leave a second browser behind it.
    const launches = stubCamoufox(t);
    const manager = new StealthBrowserManager();

    const first = await manager.launchStealthBrowser({ engine: 'auto' });
    const second = await manager.launchStealthBrowser({ engine: 'auto' });
    assert.equal(first, second, 'the running browser is reused');
    assert.equal(launches.length, 1);
    assert.ok(!manager._parkedBrowsers || manager._parkedBrowsers.size === 0);
    await manager.cleanup();
  });

  test('a context created with "auto" reports the engine it actually got', async (t) => {
    stubCamoufox(t, { available: false });
    const manager = stubChromiumLaunch(new StealthBrowserManager());

    const created = await manager.createStealthContext({ engine: 'auto' });
    assert.equal(created.engine, 'chromium');
    assert.match(created.engineFallbackWarning, /camoufox/i);
    await manager.cleanup();
  });

  test('scrapeWithStealth returns the fallback warning and the engine that ran', async () => {
    const manager = new StealthBrowserManager();
    manager.createStealthContext = async () => {
      manager._launchedEngine = 'chromium';
      return { contextId: 'ctx-auto', engine: 'chromium', engineFallbackWarning: 'Stealth engine fell back to chromium: camoufox is not installed (npm install camoufox).' };
    };
    manager.createStealthPage = async () => fakeStealthPage();
    manager.closeContext = async () => {};

    const scraped = await manager.scrapeWithStealth({ url: 'http://127.0.0.1:1/x', engine: 'auto' });
    assert.equal(scraped.engine, 'chromium');
    assert.deepEqual(scraped.warnings, [
      'Stealth engine fell back to chromium: camoufox is not installed (npm install camoufox).'
    ]);
  });

  test('a camoufox run carries no warning and an empty warnings list', async () => {
    const manager = new StealthBrowserManager();
    manager.createStealthContext = async () => {
      manager._launchedEngine = 'camoufox';
      return { contextId: 'ctx-cf', engine: 'camoufox', engineFallbackWarning: null };
    };
    manager.createStealthPage = async () => fakeStealthPage();
    manager.closeContext = async () => {};

    const scraped = await manager.scrapeWithStealth({ url: 'http://127.0.0.1:1/x' });
    assert.equal(scraped.engine, 'camoufox');
    assert.deepEqual(scraped.warnings, []);
  });
});

/** The narrowest page double scrapeWithStealth will read to the end. */
function fakeStealthPage() {
  return {
    on: () => {},
    context: () => ({ browser: () => null }),
    url: () => 'http://127.0.0.1:1/x',
    goto: async () => ({ status: () => 200 }),
    title: async () => 'A page',
    content: async () => '<html><body>Some content on the page</body></html>',
    evaluate: async (fn) => {
      const source = String(fn);
      if (source.includes('document.title')) return true;
      if (source.includes('MutationObserver')) return 0;
      return 'Some content on the page';
    },
    waitForTimeout: async () => {},
    waitForFunction: async () => {},
    waitForLoadState: async () => {},
    isClosed: () => false,
    screenshot: async () => 'shot'
  };
}

// ── headless: 'virtual' on Linux ────────────────────────────────────────────

describe('camoufox runs in Xvfb on Linux and headless everywhere else', () => {
  test('a Linux host asks for "virtual"', async (t) => {
    const launches = stubCamoufox(t);
    await onPlatform('linux', async () => {
      const manager = new StealthBrowserManager();
      await manager.launchStealthBrowser({ engine: 'camoufox' });
      await manager.cleanup();
    });
    assert.equal(launches[0].headless, 'virtual');
  });

  test('a developer machine stays plain headless', async (t) => {
    const launches = stubCamoufox(t);
    await onPlatform('darwin', async () => {
      const manager = new StealthBrowserManager();
      await manager.launchStealthBrowser({ engine: 'camoufox' });
      await manager.cleanup();
    });
    assert.equal(launches[0].headless, true);
  });

  test('the adapter passes a string mode through instead of collapsing it to true', async () => {
    // `config.headless !== false` turned 'virtual' into `true` — plain
    // headless, the one mode it exists to avoid.
    const captured = [];
    class FakeAdapter extends CamoufoxAdapter {
      async _load() {
        return { Camoufox: async (options) => { captured.push(options); return { engine: 'camoufox' }; } };
      }
      async _ensureMacOSLayout() { /* no install to fix up */ }
    }

    await new FakeAdapter().launch({ headless: 'virtual', launchOptions: {} });
    await new FakeAdapter().launch({ headless: true, launchOptions: {} });
    await new FakeAdapter().launch({ headless: false, launchOptions: {} });
    await new FakeAdapter().launch({ launchOptions: {} });

    assert.deepEqual(captured.map((o) => o.headless), ['virtual', true, false, true]);
  });
});

// ── CRAWLFORGE_STEALTH_PROXIES ──────────────────────────────────────────────

describe('serverStealthProxies reads the operator list at call time', () => {
  test('unset is an empty list', async () => {
    await withEnv(undefined, () => assert.deepEqual(serverStealthProxies(), []));
  });

  test('a comma-separated list is trimmed and emptied of blanks', async () => {
    await withEnv(' http://one.example:1 , , http://two.example:2,', () => {
      assert.deepEqual(serverStealthProxies(), ['http://one.example:1', 'http://two.example:2']);
    });
  });

  test('the value is re-read, never frozen at import', async () => {
    await withEnv('http://first.example:1', () => {
      assert.deepEqual(serverStealthProxies(), ['http://first.example:1']);
    });
    await withEnv('http://second.example:2', () => {
      assert.deepEqual(serverStealthProxies(), ['http://second.example:2']);
    });
  });
});

describe('the server-level list is the fallback, never the override', () => {
  test('resolveProxy uses it when the caller passed nothing', async () => {
    await withEnv('http://alice:s3cret@server.example:8080', () => {
      const manager = new StealthBrowserManager();
      assert.deepEqual(manager.resolveProxy({}), {
        server: 'http://server.example:8080', username: 'alice', password: 's3cret'
      });
    });
  });

  test("a caller's own proxy always wins", async () => {
    await withEnv('http://server.example:8080', () => {
      const manager = new StealthBrowserManager();
      const resolved = manager.resolveProxy({
        proxyRotation: { enabled: true, proxies: ['http://caller.example:3128'], rotationInterval: 300000 }
      });
      assert.deepEqual(resolved, { server: 'http://caller.example:3128' });
    });
  });

  test('it rotates on the schema default interval, having no rotation block of its own', async () => {
    await withEnv('http://one.example:1,http://two.example:2', () => {
      const manager = new StealthBrowserManager();
      assert.equal(manager.resolveProxy({}).server, 'http://one.example:1');
      assert.equal(manager.resolveProxy({}).server, 'http://one.example:1', 'no rotation inside the interval');
      manager.proxyManager.lastRotation = Date.now() - 300001;
      assert.equal(manager.resolveProxy({}).server, 'http://two.example:2');
    });
  });

  test('still nothing at all when neither side configured a proxy', async () => {
    await withEnv(undefined, () => {
      assert.equal(new StealthBrowserManager().resolveProxy({}), null);
    });
  });
});

describe('geoip follows the proxy, wherever the proxy came from', () => {
  test('a server-level proxy switches camoufox geoip on, exactly like a caller one', async (t) => {
    // The Phase 1 rule is `geoip: !!proxy`. It has to keep holding now that a
    // proxy can arrive from the environment: a proxied camoufox that did not
    // derive its location from the exit IP reports one country behind another
    // country's address.
    const launches = stubCamoufox(t);
    await withEnv('http://server.example:8080', async () => {
      const manager = new StealthBrowserManager();
      await manager.launchStealthBrowser({ engine: 'camoufox' });
      await manager.cleanup();
    });
    assert.deepEqual(launches[0].proxy, { server: 'http://server.example:8080' });
    assert.equal(launches[0].geoip, true);
    assert.equal(launches[0].locale, null, 'geoip derives the locale from the exit IP; ours must not override it');
  });

  test('no proxy anywhere still means no geoip lookup', async (t) => {
    const launches = stubCamoufox(t);
    await withEnv(undefined, async () => {
      const manager = new StealthBrowserManager();
      await manager.launchStealthBrowser({ engine: 'camoufox' });
      await manager.cleanup();
    });
    assert.equal(launches[0].proxy, null);
    assert.equal(launches[0].geoip, false);
  });
});

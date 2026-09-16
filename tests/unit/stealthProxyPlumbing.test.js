/**
 * Regression lock for stealth proxy plumbing.
 *
 * The 6.6.2 bot-detection bench recommended running `stealthConfig.proxyRotation`
 * with residential proxies to get past Cloudflare's IP reputation check. That
 * configuration did nothing at all, in three separate ways:
 *
 *   1. The proxy was pushed onto Chromium's `--proxy-server=` flag, which has
 *      nowhere to carry the `user:pass` every residential proxy is issued with.
 *      An authenticating proxy answered 407 and the navigation failed.
 *   2. camoufox never saw a proxy: its launch path returns before the argument
 *      list is built, so the Firefox engine ran unproxied whatever was asked for.
 *   3. It was read once, at browser launch, and the browser is cached for the
 *      life of the process — so `rotationInterval` could never elapse anywhere
 *      that mattered.
 *
 * On top of that the rotation advanced its index BEFORE its first read, so a
 * list of more than one proxy silently started at the second entry.
 *
 * The fix moves the proxy onto the context (`newContext({ proxy })`), which both
 * engines honour with credentials. That was verified against a local
 * authenticating proxy on both chromium and camoufox before it was written;
 * the live test at the bottom of this file keeps the chromium half honest.
 *
 * Run: node --test --test-force-exit tests/unit/stealthProxyPlumbing.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';

import { StealthBrowserManager, CamoufoxAdapter } from '../../src/core/StealthBrowserManager.js';

const rotation = (proxies, rotationInterval = 300000) => ({
  proxyRotation: { enabled: true, proxies, rotationInterval }
});

// ── parsing ─────────────────────────────────────────────────────────────────

describe('parseProxyEntry splits credentials out of the proxy URL', () => {
  const manager = new StealthBrowserManager();

  test('user:pass@host:port becomes separate fields', () => {
    assert.deepEqual(
      manager.parseProxyEntry('http://alice:s3cret@proxy.example.com:8080'),
      { server: 'http://proxy.example.com:8080', username: 'alice', password: 's3cret' }
    );
  });

  test('a percent-encoded password is decoded for the proxy', () => {
    // A password containing "@" or ":" has to arrive encoded to parse at all.
    const parsed = manager.parseProxyEntry('http://alice:p%40ss%3Aword@proxy.example.com:8080');
    assert.equal(parsed.password, 'p@ss:word');
  });

  test('a bare host:port is treated as an http proxy', () => {
    assert.deepEqual(
      manager.parseProxyEntry('proxy.example.com:3128'),
      { server: 'http://proxy.example.com:3128' }
    );
  });

  test('socks5 keeps its scheme — URL.origin would be the string "null"', () => {
    const parsed = manager.parseProxyEntry('socks5://user:pw@10.0.0.9:1080');
    assert.equal(parsed.server, 'socks5://10.0.0.9:1080');
    assert.equal(parsed.username, 'user');
    assert.notEqual(parsed.server, 'null');
  });

  test('a credential-free proxy gets no username or password keys', () => {
    assert.deepEqual(
      manager.parseProxyEntry('https://proxy.example.com'),
      { server: 'https://proxy.example.com' }
    );
  });

  test('a malformed or unsupported entry throws instead of being dropped', () => {
    // A proxy that silently fails to apply is the exact defect being fixed:
    // the caller believes their traffic is proxied and it is not.
    assert.throws(() => manager.parseProxyEntry(''), /non-empty strings/);
    assert.throws(() => manager.parseProxyEntry(null), /non-empty strings/);
    assert.throws(() => manager.parseProxyEntry('ftp://proxy.example.com:21'), /scheme/);
  });

  test('the error message does not echo the password', () => {
    try {
      manager.parseProxyEntry('ftp://alice:s3cret@proxy.example.com:21');
      assert.fail('expected a throw');
    } catch (err) {
      assert.ok(!err.message.includes('s3cret'), `password leaked into: ${err.message}`);
    }
  });
});

// ── rotation ────────────────────────────────────────────────────────────────

describe('resolveProxy picks and rotates', () => {
  test('no proxy when rotation is disabled or the list is empty', () => {
    const manager = new StealthBrowserManager();
    assert.equal(manager.resolveProxy({}), null);
    assert.equal(manager.resolveProxy({ proxyRotation: { enabled: false, proxies: ['h:1'] } }), null);
    assert.equal(manager.resolveProxy({ proxyRotation: { enabled: true, proxies: [] } }), null);
  });

  test('the first call uses the FIRST proxy in the list', () => {
    const manager = new StealthBrowserManager();
    const config = rotation(['http://one.example:1', 'http://two.example:2']);
    assert.equal(manager.resolveProxy(config).server, 'http://one.example:1');
  });

  test('the proxy holds until the interval elapses, then advances and wraps', () => {
    const manager = new StealthBrowserManager();
    const config = rotation(['http://one.example:1', 'http://two.example:2'], 60000);

    assert.equal(manager.resolveProxy(config).server, 'http://one.example:1');
    assert.equal(manager.resolveProxy(config).server, 'http://one.example:1', 'no rotation inside the interval');

    manager.proxyManager.lastRotation = Date.now() - 61000;
    assert.equal(manager.resolveProxy(config).server, 'http://two.example:2');

    manager.proxyManager.lastRotation = Date.now() - 61000;
    assert.equal(manager.resolveProxy(config).server, 'http://one.example:1', 'wraps back to the head');
  });

  test('get_stats reports the proxy state, with the credentials stripped', () => {
    const manager = new StealthBrowserManager();
    assert.deepEqual(manager.getStats().proxyStatus, { enabled: false, currentProxy: null, totalProxies: 0 });

    manager.resolveProxy(rotation(['http://alice:s3cret@one.example:1', 'http://two.example:2']));
    const status = manager.getStats().proxyStatus;
    assert.deepEqual(status, {
      enabled: true,
      currentProxy: 'http://one.example:1',
      totalProxies: 2
    });
    assert.ok(!JSON.stringify(status).includes('s3cret'), 'get_stats must not return proxy credentials');
  });
});

// ── wiring ──────────────────────────────────────────────────────────────────

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

const stubLaunch = (manager) => {
  manager._doLaunchStealthBrowser = async (config) => {
    const browser = {
      engine: config.engine,
      closed: false,
      newContextOptions: [],
      isConnected: () => !browser.closed,
      close: async () => { browser.closed = true; },
      process: () => null,
      newContext: async (options) => {
        browser.newContextOptions.push(options);
        return fakeContext();
      }
    };
    manager.browser = browser;
    manager._launchedEngine = config.engine;
    return browser;
  };
  return manager;
};

const PARSED = { server: 'http://proxy.example.com:8080', username: 'alice', password: 's3cret' };
const ENTRY = 'http://alice:s3cret@proxy.example.com:8080';

/**
 * Replace the camoufox launcher, leaving _doLaunchStealthBrowser's real camoufox
 * branch in play — that branch is where the proxy and the engine's own options
 * are decided, so a stub above it would test nothing.
 */
const stubCamoufox = (t) => {
  const launches = [];
  const realLaunch = CamoufoxAdapter.prototype.launch;
  const realAvailable = CamoufoxAdapter.prototype.isAvailable;
  CamoufoxAdapter.prototype.isAvailable = async () => true;
  CamoufoxAdapter.prototype.launch = async (config) => {
    launches.push(config);
    const browser = {
      engine: 'camoufox',
      closed: false,
      newContextOptions: [],
      isConnected: () => !browser.closed,
      close: async () => { browser.closed = true; },
      process: () => null,
      newContext: async (options) => { browser.newContextOptions.push(options); return fakeContext(); }
    };
    return browser;
  };
  t.after(() => {
    CamoufoxAdapter.prototype.launch = realLaunch;
    CamoufoxAdapter.prototype.isAvailable = realAvailable;
  });
  return launches;
};

describe('the proxy reaches the browser context on both engines', () => {
  test('chromium contexts are created with the parsed proxy', async () => {
    const manager = stubLaunch(new StealthBrowserManager());
    await manager.createStealthContext({ engine: 'chromium', ...rotation([ENTRY]) });
    assert.deepEqual(manager.browser.newContextOptions[0].proxy, PARSED);
    await manager.cleanup();
  });

  test('camoufox contexts get the proxy its browser was launched with', async (t) => {
    const launches = stubCamoufox(t);
    const manager = new StealthBrowserManager();
    await manager.createStealthContext({ engine: 'camoufox', ...rotation([ENTRY]) });

    assert.deepEqual(launches[0].proxy, PARSED, 'the launcher is told about the proxy');
    assert.deepEqual(manager.browser.newContextOptions[0].proxy, PARSED,
      'and so is the context — camoufox routes a launch-time proxy but drops its credentials');
    await manager.cleanup();
  });

  test('a camoufox browser stays on its launch proxy when the rotation moves on', async (t) => {
    // camoufox derives its geolocation, timezone and locale from the proxy it
    // was launched with. Rotating underneath it would put the first proxy's
    // city behind the second proxy's exit IP.
    stubCamoufox(t);
    const manager = new StealthBrowserManager();
    const config = rotation([ENTRY, 'http://second.example:2'], 60000);
    await manager.createStealthContext({ engine: 'camoufox', ...config });

    manager.proxyManager.lastRotation = Date.now() - 61000;
    await manager.createStealthContext({ engine: 'camoufox', ...config });

    assert.deepEqual(manager.browser.newContextOptions[1].proxy, PARSED);
    await manager.cleanup();
  });

  test('no proxy option at all when rotation is off', async () => {
    const manager = stubLaunch(new StealthBrowserManager());
    await manager.createStealthContext({ engine: 'chromium' });
    assert.ok(!('proxy' in manager.browser.newContextOptions[0]));
    await manager.cleanup();
  });

  test('the launch path no longer builds a --proxy-server argument', () => {
    // The flag cannot carry credentials and pinned the whole process to one
    // proxy. Asserted against the source because the defect was an argument
    // that was built and then never had any effect.
    const source = fs.readFileSync(new URL('../../src/core/StealthBrowserManager.js', import.meta.url), 'utf8');
    assert.ok(
      !/stealthArgs\.push\(`--proxy-server=/.test(source),
      'the proxy belongs on the context, not on a Chromium launch flag'
    );
  });
});

// ── camoufox's own options ──────────────────────────────────────────────────

describe('camoufox is launched with its own features turned on', () => {
  test('geoip is asked for when there is a proxy, and only then', async (t) => {
    const launches = stubCamoufox(t);
    const manager = new StealthBrowserManager();

    await manager.launchStealthBrowser({ engine: 'camoufox' });
    assert.equal(launches[0].geoip, false, 'no proxy, nothing to derive a location from');
    await manager.cleanup();

    const proxied = new StealthBrowserManager();
    await proxied.launchStealthBrowser({ engine: 'camoufox', ...rotation([ENTRY]) });
    assert.equal(launches[1].geoip, true);
    await proxied.cleanup();
  });

  test('blockWebRTC and simulateHumanBehavior reach the engine', async (t) => {
    const launches = stubCamoufox(t);
    const manager = new StealthBrowserManager();
    await manager.launchStealthBrowser({ engine: 'camoufox', blockWebRTC: false, simulateHumanBehavior: true });
    assert.equal(launches[0].blockWebRTC, false);
    assert.equal(launches[0].humanize, true);
    await manager.cleanup();
  });

  test('the adapter maps our names onto camoufox\'s snake_case options', async () => {
    // camoufox reads block_webrtc / humanize / geoip / proxy. Anything it does
    // not recognise is passed through to Playwright and silently ignored, which
    // is how this engine came to run with all of its features off.
    let captured = null;
    class FakeAdapter extends CamoufoxAdapter {
      async _load() {
        return { Camoufox: async (options) => { captured = options; return { engine: 'camoufox' }; } };
      }
      async _ensureMacOSLayout() { /* no install to fix up */ }
    }

    await new FakeAdapter().launch({
      headless: true,
      proxy: PARSED,
      geoip: true,
      blockWebRTC: true,
      humanize: true,
      launchOptions: {}
    });

    assert.deepEqual(captured, {
      headless: true,
      proxy: PARSED,
      geoip: true,
      block_webrtc: true,
      humanize: true
    });
  });

  test('options we did not ask for are left off entirely', async () => {
    let captured = null;
    class FakeAdapter extends CamoufoxAdapter {
      async _load() {
        return { Camoufox: async (options) => { captured = options; return { engine: 'camoufox' }; } };
      }
      async _ensureMacOSLayout() { /* no install to fix up */ }
    }

    await new FakeAdapter().launch({ headless: true, blockWebRTC: false, humanize: false, launchOptions: {} });
    assert.deepEqual(captured, { headless: true });
  });
});

// ── live: the whole point is that the traffic actually goes through ─────────

describe('a real chromium context authenticates against a real proxy', () => {
  test('the request arrives at the proxy with credentials', async (t) => {
    const USER = 'cfuser';
    const PASS = 'p@ss:word/1';
    const MARKER = 'PROXY_ROUTED_OK';
    const seen = [];

    // The proxy answers every absolute-URI request itself, so the target host
    // never needs DNS: if the marker renders, the request went through here.
    const proxy = http.createServer((req, res) => {
      const auth = req.headers['proxy-authorization'];
      seen.push({ url: req.url, auth: auth || null });
      const ok = auth
        && Buffer.from(auth.split(' ')[1] || '', 'base64').toString('utf8') === `${USER}:${PASS}`;
      if (!ok) {
        res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="cf"', 'Content-Type': 'text/html' });
        res.end('<html><body>need auth</body></html>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h1>${MARKER}</h1></body></html>`);
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const port = proxy.address().port;

    const manager = new StealthBrowserManager();
    t.after(async () => {
      await manager.cleanup().catch(() => {});
      await new Promise((resolve) => proxy.close(resolve));
    });

    // The password carries "@", ":" and "/" — the characters that make a proxy
    // URL ambiguous — so it is passed percent-encoded, as a proxy list would.
    const entry = `http://${USER}:${encodeURIComponent(PASS)}@127.0.0.1:${port}`;
    const { contextId } = await manager.createStealthContext({ engine: 'chromium', ...rotation([entry]) });
    const page = await manager.createStealthPage(contextId);
    await page.goto('http://proxied.invalid/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const body = await page.evaluate(() => document.body.innerText);

    assert.match(body, new RegExp(MARKER), 'the page was served by the proxy');
    assert.ok(seen.some((hit) => hit.auth), 'the proxy saw a Proxy-Authorization header');
  });
});

/**
 * Phase 5 (5.3) of the actions + embedded-state plan:
 * scrape_with_actions.browserOptions.proxyRotation routes a stealth chain
 * through the caller's own proxies.
 *
 *   - refused without stealth:true, like engine:"camoufox"
 *   - with stealth:true it reaches the executor, and BrowserProcessor hands it
 *     to both the stealth launch and the context
 *   - a caller's proxy on loopback or a metadata address is refused by the
 *     SSRF guard (stealth_mode's list included); the operator's
 *     CRAWLFORGE_STEALTH_PROXIES is not
 *   - no proxy password in the result or the refusal
 *
 * Run: node --test --test-force-exit tests/unit/scrapeWithActionsProxy.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.ALLOWED_DOMAINS;
delete process.env.SSRF_PROTECTION_ENABLED;

const { ScrapeWithActionsTool } = await import('../../src/tools/advanced/ScrapeWithActionsTool.js');
const { BrowserProcessor } = await import('../../src/core/processing/BrowserProcessor.js');
const { StealthBrowserManager, CamoufoxAdapter, redactProxyEntry } = await import('../../src/core/StealthBrowserManager.js');
const fs = await import('node:fs');

const ENTRY = 'http://alice:s3cret@proxy.example.com:8080';
const ROTATION = { enabled: true, proxies: [ENTRY] };
const CLICK = [{ type: 'click', selector: '#go' }];

function makeTool(capture) {
  return new ScrapeWithActionsTool({
    enableLogging: false,
    actionExecutor: {
      executeActionChain: async (url, chainConfig, browserOptions) => {
        capture.browserOptions = structuredClone(browserOptions);
        return {
          success: true,
          results: chainConfig.actions.map((a, i) => ({ id: `a${i}`, type: a.type, success: true, result: {} })),
          screenshots: [],
          finalHtml: '<html><body>done</body></html>',
          finalUrl: url,
          navigations: []
        };
      },
      getStats: () => ({}),
      destroy: async () => {}
    },
    extractContentTool: {
      execute: async () => ({ success: true, content: { text: 'page text' }, metadata: { title: 'Page' } })
    }
  });
}

describe('browserOptions.proxyRotation on scrape_with_actions', () => {
  test('refused without stealth:true, before any browser work', async () => {
    const capture = {};
    await assert.rejects(
      () => makeTool(capture).execute({ url: 'https://example.com/', actions: CLICK, browserOptions: { proxyRotation: ROTATION } }),
      /proxyRotation requires browserOptions\.stealth:true/
    );
    assert.equal(capture.browserOptions, undefined, 'the executor was never called');
  });

  test('with stealth:true it reaches the executor in stealth_mode\'s shape', async () => {
    const capture = {};
    await makeTool(capture).execute({
      url: 'https://example.com/',
      actions: CLICK,
      browserOptions: { stealth: true, engine: 'chromium', proxyRotation: ROTATION }
    });
    assert.deepEqual(capture.browserOptions.proxyRotation, { enabled: true, proxies: [ENTRY], rotationInterval: 300000 });
  });

  test('the result echoes the options with the proxy credentials removed', async () => {
    const result = await makeTool({}).execute({
      url: 'https://example.com/',
      actions: CLICK,
      browserOptions: { stealth: true, engine: 'chromium', proxyRotation: { enabled: true, proxies: [ENTRY, 'bob:hunter2@bare.example:3128'] } }
    });
    assert.deepEqual(result.metadata.browserOptions.proxyRotation.proxies, [
      'http://proxy.example.com:8080',
      'bare.example:3128'
    ]);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('s3cret') && !serialized.includes('hunter2'), 'no proxy password anywhere in the result');
  });

  test('BrowserProcessor hands it to both the launch and the context', async () => {
    const capture = {};
    const processor = new BrowserProcessor();
    const page = {
      route: async () => {},
      addInitScript: async () => {},
      context: () => ({ addCookies: async () => {} })
    };
    processor.stealthManager = {
      launchStealthBrowser: async (config) => { capture.launch = config; },
      createStealthContext: async (config) => { capture.context = config; return { context: {}, contextId: 'ctx-1' }; },
      createStealthPage: async () => page,
      closeContext: async () => {}
    };

    await processor.createStealthPage({
      stealthMode: { enabled: true, engine: 'camoufox', level: 'medium' },
      proxyRotation: ROTATION
    });

    assert.deepEqual(capture.launch.proxyRotation, ROTATION, 'camoufox takes its proxy at launch');
    assert.deepEqual(capture.context.proxyRotation, ROTATION, 'Chromium takes it per context');
  });
});

// ── the SSRF guard on a caller's proxy ──────────────────────────────────────

/** A manager whose launch is stubbed, so a refusal can be told from a launch. */
function stubbedManager() {
  const manager = new StealthBrowserManager();
  manager.launches = 0;
  manager._doLaunchStealthBrowser = async (config) => {
    manager.launches++;
    const browser = {
      newContextOptions: [],
      isConnected: () => true,
      close: async () => {},
      process: () => null,
      newContext: async (options) => {
        browser.newContextOptions.push(options);
        return new Proxy({}, { get: (t, prop) => (prop === 'then' ? undefined : async () => []) });
      }
    };
    manager.browser = browser;
    manager._launchedEngine = config.engine;
    return browser;
  };
  return manager;
}

describe('a caller\'s proxy is held to the SSRF guard', () => {
  for (const entry of ['http://alice:s3cret@127.0.0.1:8080', 'http://alice:s3cret@169.254.169.254:80', 'alice:s3cret@169.254.169.254']) {
    test(`${redactProxyEntry(entry)} is refused before a browser launches, and the password is not echoed`, async () => {
      const manager = stubbedManager();
      await assert.rejects(
        () => manager.createStealthContext({ engine: 'chromium', proxyRotation: { enabled: true, proxies: [entry] } }),
        (err) => {
          assert.equal(err.code, 'SSRF_BLOCKED');
          assert.match(err.message, /proxyRotation: proxy host/);
          assert.ok(!err.message.includes('s3cret'), `password leaked into: ${err.message}`);
          return true;
        }
      );
      assert.equal(manager.launches, 0);
    });
  }

  test('a public proxy host passes', async () => {
    const manager = stubbedManager();
    await manager.createStealthContext({ engine: 'chromium', proxyRotation: { enabled: true, proxies: ['http://93.184.215.14:8080'] } });
    assert.equal(manager.browser.newContextOptions[0].proxy.server, 'http://93.184.215.14:8080');
    await manager.cleanup();
  });

  test('the operator\'s CRAWLFORGE_STEALTH_PROXIES is exempt — it may run a local proxy', async (t) => {
    process.env.CRAWLFORGE_STEALTH_PROXIES = 'http://127.0.0.1:3128';
    t.after(() => { delete process.env.CRAWLFORGE_STEALTH_PROXIES; });
    const manager = stubbedManager();
    await manager.createStealthContext({ engine: 'chromium' });
    assert.equal(manager.browser.newContextOptions[0].proxy.server, 'http://127.0.0.1:3128');
    await manager.cleanup();
  });
});

describe('redactProxyEntry', () => {
  test('removes credentials with or without a scheme', () => {
    assert.equal(redactProxyEntry('http://alice:s3cret@proxy.example.com:8080'), 'http://proxy.example.com:8080');
    assert.equal(redactProxyEntry('alice:s3cret@proxy.example.com:8080'), 'proxy.example.com:8080');
    assert.equal(redactProxyEntry('socks5://u:p@ss@h.example:1080'), 'socks5://h.example:1080');
    assert.equal(redactProxyEntry('proxy.example.com:3128'), 'proxy.example.com:3128');
  });
});

describe('a usage report never carries a proxy list', () => {
  test('maskSecrets masks proxyRotation.proxies wherever it sits in the params', async () => {
    // AuthManager.reportUsage sends maskSecrets(params) to the backend; a
    // proxy entry carries its password under the neutral key `proxies`.
    const { maskSecrets } = await import('../../src/utils/secretMask.js');
    const masked = maskSecrets({
      browserOptions: { stealth: true, proxyRotation: ROTATION },
      stealthConfig: { proxyRotation: ROTATION }
    });
    assert.ok(!JSON.stringify(masked).includes('s3cret'), JSON.stringify(masked));
    assert.equal(masked.browserOptions.proxyRotation.enabled, true, 'the rest of the block is kept');
  });
});

// ── a per-call proxy on camoufox is refused ─────────────────────────────────
//
// camoufox applies its proxy at browser launch and shares that browser across
// calls, so a caller's proxy would carry later callers' traffic on the
// caller's credentials. Refused on the engine that will actually run.

const CAMOUFOX_REFUSAL = /proxyRotation is refused on the camoufox engine/;

/** "auto" resolves to camoufox: the package reports itself available, no env pin. */
function autoResolvesToCamoufox(t) {
  const realAvailable = CamoufoxAdapter.prototype.isAvailable;
  const pinned = process.env.CRAWLFORGE_STEALTH_ENGINE;
  CamoufoxAdapter.prototype.isAvailable = async () => true;
  delete process.env.CRAWLFORGE_STEALTH_ENGINE;
  t.after(() => {
    CamoufoxAdapter.prototype.isAvailable = realAvailable;
    if (pinned !== undefined) process.env.CRAWLFORGE_STEALTH_ENGINE = pinned;
  });
}

/** Records every camoufox launch without starting a browser. */
function stubCamoufoxLaunch(t) {
  const launches = [];
  const realLaunch = CamoufoxAdapter.prototype.launch;
  const realAvailable = CamoufoxAdapter.prototype.isAvailable;
  CamoufoxAdapter.prototype.isAvailable = async () => true;
  CamoufoxAdapter.prototype.launch = async (config) => {
    launches.push(config);
    return {
      newContextOptions: [],
      isConnected: () => true,
      close: async () => {},
      process: () => null,
      async newContext(options) {
        this.newContextOptions.push(options);
        return new Proxy({}, { get: (target, prop) => (prop === 'then' ? undefined : async () => []) });
      }
    };
  };
  t.after(() => {
    CamoufoxAdapter.prototype.launch = realLaunch;
    CamoufoxAdapter.prototype.isAvailable = realAvailable;
  });
  return launches;
}

describe('scrape_with_actions refuses a per-call proxy on camoufox', () => {
  for (const engine of ['camoufox', 'auto']) {
    test(`engine:"${engine}" (resolving to camoufox) is refused before the chain starts`, async (t) => {
      autoResolvesToCamoufox(t);
      const capture = {};
      await assert.rejects(
        () => makeTool(capture).execute({
          url: 'https://example.com/',
          actions: CLICK,
          browserOptions: { stealth: true, engine, proxyRotation: ROTATION }
        }),
        (err) => {
          assert.match(err.message, CAMOUFOX_REFUSAL);
          assert.match(err.message, /engine:"chromium"/);
          assert.ok(!err.message.includes('s3cret'), err.message);
          return true;
        }
      );
      assert.equal(capture.browserOptions, undefined, 'the executor was never called');
    });
  }

  test('camoufox with no proxyRotation still runs', async (t) => {
    autoResolvesToCamoufox(t);
    const capture = {};
    await makeTool(capture).execute({ url: 'https://example.com/', actions: CLICK, browserOptions: { stealth: true, engine: 'camoufox' } });
    assert.equal(capture.browserOptions.stealthMode.engine, 'camoufox');
  });
});

describe('stealth_mode refuses a per-call proxy on camoufox', () => {
  // stealth_mode's handler is inline in server.js; the manager is the
  // backstop every stealth_mode browser operation goes through.
  for (const engine of ['camoufox', 'auto']) {
    test(`createStealthContext with engine:"${engine}" is refused before any launch`, async (t) => {
      autoResolvesToCamoufox(t);
      const launches = stubCamoufoxLaunch(t);
      const manager = new StealthBrowserManager();
      await assert.rejects(
        () => manager.createStealthContext({ engine, proxyRotation: ROTATION }),
        CAMOUFOX_REFUSAL
      );
      assert.equal(launches.length, 0);
      assert.equal(manager.browser, null);
    });
  }

  test('the scrape and create_context operations refuse on the resolved engine, before the browser', () => {
    const src = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    assert.match(src, /const resolvedEngine = await resolveStealthEngine\(engine\);\s*assertProxyEngineAllowed\(resolvedEngine\.engine, stealthConfig\);/);
    assert.match(src, /const contextEngine = await resolveStealthEngine\(engine\);\s*assertProxyEngineAllowed\(contextEngine\.engine, stealthConfig\);/);
  });
});

describe('camoufox takes its launch proxy only from the operator list', () => {
  test('the operator\'s CRAWLFORGE_STEALTH_PROXIES still reaches the launch and the context', async (t) => {
    const launches = stubCamoufoxLaunch(t);
    process.env.CRAWLFORGE_STEALTH_PROXIES = ENTRY;
    t.after(() => { delete process.env.CRAWLFORGE_STEALTH_PROXIES; });
    const manager = new StealthBrowserManager();
    await manager.createStealthContext({ engine: 'camoufox' });
    assert.equal(launches[0].proxy.server, 'http://proxy.example.com:8080');
    assert.equal(manager.browser.newContextOptions[0].proxy.server, 'http://proxy.example.com:8080');
    await manager.cleanup();
  });

  test('the launch path ignores a caller list even when reached past the refusal', async (t) => {
    // Structural: _doLaunchStealthBrowser is what keeps a browser alive across
    // calls, so it must not read proxyRotation for camoufox at all.
    const launches = stubCamoufoxLaunch(t);
    delete process.env.CRAWLFORGE_STEALTH_PROXIES;
    const manager = new StealthBrowserManager();
    await manager._doLaunchStealthBrowser({ engine: 'camoufox', proxyRotation: ROTATION });
    assert.equal(launches[0].proxy, null);
    await manager.cleanup();
  });

  test('Chromium per-call proxies are unchanged', async () => {
    const manager = stubbedManager();
    await manager.createStealthContext({ engine: 'chromium', proxyRotation: { enabled: true, proxies: ['http://alice:s3cret@93.184.215.14:8080'] } });
    assert.deepEqual(manager.browser.newContextOptions[0].proxy, { server: 'http://93.184.215.14:8080', username: 'alice', password: 's3cret' });
    await manager.cleanup();
  });
});

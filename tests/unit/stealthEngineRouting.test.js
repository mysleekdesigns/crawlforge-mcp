/**
 * Unit tests: Phase 2 engine routing — one `engine` vocabulary
 * ('auto'|'chromium'|'camoufox'|'playwright') across browser_session,
 * scrape_with_actions and the BrowserProcessor underneath them.
 *
 * Wiring tests: ActionExecutor and StealthBrowserManager are stubbed, because
 * what is being proved is that the engine the caller asked for reaches the
 * layer that launches a browser — and that an 'auto' which lands on Chromium
 * says so out loud. No Playwright process is needed for either.
 *
 * The expected value for 'auto' is read from resolveStealthEngine rather than
 * written down: camoufox is installed in this repo but not on every box, and a
 * test that hard-codes one answer would pass for the wrong reason on the other.
 *
 * Run: node --test --test-force-exit tests/unit/stealthEngineRouting.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ScrapeWithActionsTool } = await import('../../src/tools/advanced/ScrapeWithActionsTool.js');
const { BrowserSessionTool } = await import('../../src/tools/advanced/BrowserSessionTool.js');
const { BrowserProcessor } = await import('../../src/core/processing/BrowserProcessor.js');
const { resolveStealthEngine } = await import('../../src/core/StealthBrowserManager.js');

/** What 'auto' means on THIS machine — camoufox when installed, else chromium. */
const AUTO = await resolveStealthEngine('auto');

// ── Fakes ───────────────────────────────────────────────────────────────────

/** A page that satisfies everything the two tools touch, and nothing more. */
function makeFakePage(url = 'https://example.com/') {
  return {
    url: () => url,
    title: async () => 'Test Page',
    content: async () => '<html><body>page</body></html>',
    evaluate: async () => 'page text',
    close: async () => {}
  };
}

/** Captures the browserOptions scrape_with_actions hands the executor. */
function makeCapturingExecutor(capture) {
  return {
    executeActionChain: async (url, chainConfig, browserOptions) => {
      capture.browserOptions = browserOptions;
      return {
        success: true,
        results: chainConfig.actions.map((a, i) => ({
          id: `action_${i}`, type: a.type, success: true, result: {}, executionTime: 1, timestamp: Date.now()
        })),
        screenshots: [],
        finalHtml: '<html><body>done</body></html>',
        finalUrl: url,
        metadata: {}
      };
    },
    getStats: () => ({}),
    destroy: async () => {}
  };
}

/** Captures the browserOptions browser_session hands initializePage. */
function makeCapturingSessionExecutor(capture, pageEngine = null) {
  return {
    initializePage: async (url, browserOptions) => {
      capture.browserOptions = browserOptions;
      const page = makeFakePage(url);
      // What BrowserProcessor stamps on a page it made; null for a page that
      // predates the stamp, which sessionInfo must tolerate.
      if (pageEngine) page.__crawlforgeEngine = pageEngine;
      return page;
    },
    getStats: () => ({}),
    destroy: async () => {}
  };
}

function makeFakeExtract() {
  return {
    execute: async () => ({
      success: true,
      content: { text: 'page text', html: '<p>page</p>', markdown: '# page' },
      metadata: { title: 'Test Page' }
    })
  };
}

const CLICK = [{ type: 'click', selector: '#go' }];

function makeActionsTool(capture) {
  return new ScrapeWithActionsTool({
    actionExecutor: makeCapturingExecutor(capture),
    extractContentTool: makeFakeExtract(),
    enableLogging: false
  });
}

function makeSessionTool(capture, pageEngine = null) {
  return new BrowserSessionTool({
    actionExecutor: makeCapturingSessionExecutor(capture, pageEngine),
    extractContentTool: makeFakeExtract(),
    enableLogging: false
  });
}

// ── scrape_with_actions ─────────────────────────────────────────────────────

test('scrape_with_actions: stealth with no engine resolves auto and forwards it', async () => {
  const capture = {};
  const result = await makeActionsTool(capture).execute({
    url: 'https://example.com/',
    actions: CLICK,
    browserOptions: { stealth: true }
  });

  assert.deepEqual(capture.browserOptions.stealthMode, { enabled: true, engine: AUTO.engine });
  assert.equal(result.engine, AUTO.engine);
  // A fallback is only reported when there was one to report.
  assert.equal(
    result.warnings?.[0],
    AUTO.fallbackWarning || undefined,
    'an auto→chromium fallback must be surfaced, and nothing invented when there was none'
  );
});

test('scrape_with_actions: engine:"camoufox" reaches the executor unmapped', async () => {
  const capture = {};
  const result = await makeActionsTool(capture).execute({
    url: 'https://example.com/',
    actions: CLICK,
    browserOptions: { stealth: true, engine: 'camoufox' }
  });

  assert.deepEqual(capture.browserOptions.stealthMode, { enabled: true, engine: 'camoufox' });
  assert.equal(result.engine, 'camoufox');
  assert.equal(result.warnings, undefined, 'a named engine is never a fallback');
});

test('scrape_with_actions: engine:"playwright" still means chromium', async () => {
  const capture = {};
  await makeActionsTool(capture).execute({
    url: 'https://example.com/',
    actions: CLICK,
    browserOptions: { stealth: true, engine: 'playwright' }
  });

  assert.equal(capture.browserOptions.stealthMode.engine, 'chromium');
});

test('scrape_with_actions: engine without stealth is refused for camoufox only', async () => {
  const capture = {};
  await assert.rejects(
    () => makeActionsTool(capture).execute({
      url: 'https://example.com/',
      actions: CLICK,
      browserOptions: { engine: 'camoufox' }
    }),
    /requires browserOptions\.stealth:true/
  );

  // chromium/auto without stealth need no refusal — Chromium is what the
  // standard pool runs anyway.
  const plain = await makeActionsTool(capture).execute({
    url: 'https://example.com/',
    actions: CLICK,
    browserOptions: { engine: 'chromium' }
  });
  assert.equal(capture.browserOptions.stealthMode, undefined);
  assert.equal(plain.engine, 'chromium');
});

// ── browser_session ─────────────────────────────────────────────────────────

test('browser_session: open with stealth resolves auto and forwards it', async () => {
  const capture = {};
  const result = await makeSessionTool(capture, AUTO.engine).execute({
    operation: 'open',
    url: 'https://example.com/',
    stealth: true
  });

  assert.deepEqual(capture.browserOptions.stealthMode, { enabled: true, engine: AUTO.engine });
  assert.equal(result.engine, AUTO.engine, 'the session echoes the engine that actually ran');
  assert.equal(result.warnings?.[0], AUTO.fallbackWarning || undefined);
});

test('browser_session: engine:"camoufox" reaches the executor unmapped', async () => {
  const capture = {};
  const result = await makeSessionTool(capture, 'camoufox').execute({
    operation: 'open',
    url: 'https://example.com/',
    stealth: true,
    engine: 'camoufox'
  });

  assert.deepEqual(capture.browserOptions.stealthMode, { enabled: true, engine: 'camoufox' });
  assert.equal(result.engine, 'camoufox');
  assert.equal(result.warnings, undefined);
});

test('browser_session: engine:"playwright" still means chromium', async () => {
  const capture = {};
  await makeSessionTool(capture, 'chromium').execute({
    operation: 'open',
    url: 'https://example.com/',
    stealth: true,
    engine: 'playwright'
  });

  assert.equal(capture.browserOptions.stealthMode.engine, 'chromium');
});

test('browser_session: a plain session is unchanged — no stealthMode, no engine claim', async () => {
  const capture = {};
  const result = await makeSessionTool(capture).execute({
    operation: 'open',
    url: 'https://example.com/'
  });

  assert.equal(capture.browserOptions.stealthMode, undefined);
  assert.equal(result.engine, undefined, 'an unstamped page must not be given an engine');
});

test('browser_session: engine:"camoufox" without stealth is refused, not downgraded', async () => {
  const capture = {};
  await assert.rejects(
    () => makeSessionTool(capture).execute({
      operation: 'open',
      url: 'https://example.com/',
      engine: 'camoufox'
    }),
    (err) => err.code === 'ENGINE_NEEDS_STEALTH'
  );
  assert.equal(capture.browserOptions, undefined, 'the refusal lands before a page is made');
});

// ── BrowserProcessor ────────────────────────────────────────────────────────

/**
 * The layer the two tools share: it must hand the resolved engine to BOTH the
 * launch and the context (createStealthContext re-validates the config it is
 * given, so a context asked for without one relaunches on the default).
 */
function makeProcessorWithFakeManager(capture) {
  const processor = new BrowserProcessor();
  const page = {
    close: async () => {},
    route: async () => {},
    addInitScript: async () => { capture.initScripts = (capture.initScripts || 0) + 1; },
    context: () => ({ addCookies: async () => {} })
  };
  processor.stealthManager = {
    launchStealthBrowser: async (config) => { capture.launchEngine = config.engine; },
    createStealthContext: async (config) => {
      capture.contextEngine = config.engine;
      capture.contextConfig = config;
      return { context: {}, contextId: 'ctx-1' };
    },
    createStealthPage: async () => page,
    closeContext: async () => {}
  };
  return { processor, page };
}

test('BrowserProcessor: the resolved engine reaches both the launch and the context', async () => {
  const capture = {};
  const { processor, page } = makeProcessorWithFakeManager(capture);

  const made = await processor.createStealthPage({
    stealthMode: { enabled: true, engine: 'camoufox', level: 'medium' }
  });

  assert.equal(capture.launchEngine, 'camoufox');
  assert.equal(capture.contextEngine, 'camoufox');
  assert.equal(made, page);
  assert.equal(page.__crawlforgeEngine, 'camoufox', 'the page carries the engine that made it');
});

test('BrowserProcessor: no engine keeps today\'s chromium behaviour', async () => {
  const capture = {};
  const { processor } = makeProcessorWithFakeManager(capture);

  await processor.createStealthPage({ stealthMode: { enabled: true, level: 'medium' } });

  assert.equal(capture.launchEngine, 'chromium');
  assert.equal(capture.contextEngine, 'chromium');
});

test('BrowserProcessor: the Chrome-shaped init script is not injected into camoufox', async () => {
  const chromiumCapture = {};
  const { processor: chromiumProcessor } = makeProcessorWithFakeManager(chromiumCapture);
  await chromiumProcessor.createStealthPage({
    stealthMode: { enabled: true, engine: 'chromium', level: 'medium' }
  });
  assert.equal(chromiumCapture.initScripts, 1, 'chromium still gets the window.chrome shim');

  const camoufoxCapture = {};
  const { processor: camoufoxProcessor } = makeProcessorWithFakeManager(camoufoxCapture);
  await camoufoxProcessor.createStealthPage({
    stealthMode: { enabled: true, engine: 'camoufox', level: 'medium' }
  });
  assert.equal(
    camoufoxCapture.initScripts,
    undefined,
    'a Firefox page given window.chrome is a tell no real Firefox has'
  );
});

test('BrowserProcessor: no proxy of its own, so the server-level list applies', async () => {
  const capture = {};
  const { processor } = makeProcessorWithFakeManager(capture);

  await processor.createStealthPage({ stealthMode: { enabled: true, engine: 'chromium', level: 'medium' } });

  // Neither browser_session nor scrape_with_actions takes a proxy from the
  // caller, and this layer invents none — so StealthBrowserManager.resolveProxy
  // sees an empty request and falls through to CRAWLFORGE_STEALTH_PROXIES.
  // A proxyRotation block here would shadow that list with an empty one.
  assert.equal(capture.contextConfig.proxyRotation, undefined);
});

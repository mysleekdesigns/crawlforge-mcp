/**
 * Unit tests for the Phase 1 additions to scrape_with_actions:
 *   - browserOptions.stealth       -> browserOptions.stealthMode.enabled
 *   - respect_robots               -> browserOptions.respectRobots
 *   - select / hover / navigate accepted by the tool's own action schema
 *   - a stealth page hands its pooled context back on teardown
 *
 * ActionExecutor is stubbed throughout — these are wiring tests, and no
 * Playwright process is needed to prove an option reaches the layer that
 * consumes it.
 *
 * Run: node --test tests/unit/scrapeWithActionsStealth.test.js --test-force-exit
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ScrapeWithActionsTool } = await import('../../src/tools/advanced/ScrapeWithActionsTool.js');
const { BrowserProcessor } = await import('../../src/core/processing/BrowserProcessor.js');

// ── Fakes ───────────────────────────────────────────────────────────────────

/** Captures the browserOptions and action chain the tool hands the executor. */
function makeCapturingExecutor(capture) {
  return {
    executeActionChain: async (url, chainConfig, browserOptions) => {
      capture.url = url;
      capture.actions = chainConfig.actions;
      capture.browserOptions = browserOptions;
      return {
        success: true,
        results: chainConfig.actions.map((a, i) => ({
          id: `action_${i}`,
          type: a.type,
          success: true,
          result: {},
          executionTime: 1,
          timestamp: Date.now()
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

function makeFakeExtract() {
  return {
    execute: async () => ({
      success: true,
      content: { text: 'page text', html: '<p>page</p>', markdown: '# page' },
      metadata: { title: 'Test Page' }
    })
  };
}

function makeTool(capture) {
  return new ScrapeWithActionsTool({
    actionExecutor: makeCapturingExecutor(capture),
    extractContentTool: makeFakeExtract(),
    enableLogging: false
  });
}

const CLICK = [{ type: 'click', selector: '#go' }];

// ── stealth ─────────────────────────────────────────────────────────────────

test('stealth: browserOptions.stealth=true becomes stealthMode.enabled', async () => {
  const capture = {};
  await makeTool(capture).execute({
    url: 'https://example.com/',
    actions: CLICK,
    browserOptions: { stealth: true }
  });

  assert.deepEqual(capture.browserOptions.stealthMode, { enabled: true });
});

test('stealth: off by default — no stealthMode is sent', async () => {
  const capture = {};
  await makeTool(capture).execute({ url: 'https://example.com/', actions: CLICK });

  assert.equal(capture.browserOptions.stealthMode, undefined);
});

// ── respect_robots ──────────────────────────────────────────────────────────

test('respect_robots: false is forwarded to the executor as respectRobots', async () => {
  const capture = {};
  await makeTool(capture).execute({
    url: 'https://example.com/',
    actions: CLICK,
    respect_robots: false
  });

  assert.equal(capture.browserOptions.respectRobots, false);
});

test('respect_robots: omitted leaves the configured default in force', async () => {
  const capture = {};
  await makeTool(capture).execute({ url: 'https://example.com/', actions: CLICK });

  assert.equal(capture.browserOptions.respectRobots, undefined);
});

// ── new action types accepted by the tool's schema ──────────────────────────

test('the tool accepts select, hover and navigate actions', async () => {
  const capture = {};
  const result = await makeTool(capture).execute({
    url: 'https://example.com/search',
    actions: [
      { type: 'select', selector: '#author', value: 'Albert Einstein' },
      { type: 'hover', selector: '.menu' },
      { type: 'navigate', url: 'https://example.com/page/2' }
    ]
  });

  assert.equal(result.success, true);
  assert.deepEqual(capture.actions.map(a => a.type), ['select', 'hover', 'navigate']);
  assert.equal(capture.actions[0].value, 'Albert Einstein');
  assert.equal(capture.actions[2].url, 'https://example.com/page/2');
});

test('a select action with neither value nor values is rejected', async () => {
  const capture = {};
  await assert.rejects(
    () => makeTool(capture).execute({
      url: 'https://example.com/search',
      actions: [{ type: 'select', selector: '#author' }]
    })
  );
});

// ── stealth teardown ────────────────────────────────────────────────────────

test('releaseStealthPage closes the page and returns its pooled context slot', async () => {
  const processor = new BrowserProcessor();
  let pageClosed = false;
  const closedContexts = [];

  const page = { close: async () => { pageClosed = true; } };
  processor.activeContexts.set('ctx-1', { context: {}, page });
  processor.activeContexts.set('ctx-2', { context: {}, page: { close: async () => {} } });
  processor.stealthManager = { closeContext: async (id) => { closedContexts.push(id); } };

  await processor.releaseStealthPage(page);

  assert.equal(pageClosed, true, 'the stealth page must be closed');
  assert.deepEqual(closedContexts, ['ctx-1'], 'only the page\'s own context is released');
  assert.equal(processor.activeContexts.has('ctx-1'), false, 'the released context must be dropped');
  assert.equal(processor.activeContexts.has('ctx-2'), true, 'other contexts are untouched');
});

test('releaseStealthPage survives a page it does not know and a missing stealth manager', async () => {
  const processor = new BrowserProcessor();
  let pageClosed = false;

  await processor.releaseStealthPage({ close: async () => { pageClosed = true; } });

  assert.equal(pageClosed, true);
  assert.equal(processor.activeContexts.size, 0);
});

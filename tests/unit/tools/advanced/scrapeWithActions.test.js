/**
 * Unit tests: scrapeWithActions tool (real module — src/tools/advanced/ScrapeWithActionsTool.js)
 * Run: node --test tests/unit/tools/advanced/scrapeWithActions.test.js
 *
 * ScrapeWithActionsTool accepts an `actionExecutor` via constructor injection
 * (the seam the tool itself provides for testing without launching a real
 * browser), so these tests exercise the real tool end-to-end with a fake
 * ActionExecutor. extractFinalContent uses the real ExtractContentTool
 * against chainResult.finalHtml, which needs no network either (see
 * tests/unit/tools/extract/extractContent.test.js).
 *
 * See tests/unit/scrapeWithActionsRecording.test.js for the recording/replay
 * feature and the captureIntermediateStates fix reproduction tests.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Local-loopback allowlist so ActionExecutor's real SSRF pre-flight
// (assertUrlAllowed, exercised by the browser-lifecycle tests below) doesn't
// need real DNS/network. Must be set before the first (transitive) import of
// src/constants/config.js — see tests/unit/phase3-leaks.test.js for the same
// pattern — hence the dynamic imports below instead of static top-of-file ones.
process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { ScrapeWithActionsTool } = await import('../../../../src/tools/advanced/ScrapeWithActionsTool.js');
const { ActionExecutor } = await import('../../../../src/core/ActionExecutor.js');

function makeFakeChainResult(actions, overrides = {}) {
  const now = Date.now();
  return {
    success: true,
    results: actions.map((a, i) => ({ id: `action_${i}`, type: a.type, success: true, executionTime: 5, timestamp: now + i, description: a.description })),
    capturedStates: [],
    screenshots: [],
    finalHtml: '<html><head><title>Result Page</title></head><body><h1>Result Page</h1><p>Done.</p></body></html>',
    finalUrl: 'https://example.com',
    metadata: { finalUrl: 'https://example.com' },
    ...overrides
  };
}

function makeFakeExecutor({ onExecute } = {}) {
  return {
    executeActionChain: async (url, chainConfig, browserOptions) => {
      const actions = chainConfig.actions;
      if (onExecute) return onExecute(url, chainConfig, browserOptions);
      return makeFakeChainResult(actions);
    },
    getStats: () => ({}),
    destroy: async () => {}
  };
}

const CLICK_ACTION = { type: 'click', selector: '#btn', continueOnError: false, retries: 0, captureAfter: false, clickCount: 1, delay: 0, force: false, button: 'left' };
const WAIT_ACTION = { type: 'wait', duration: 100, continueOnError: false, retries: 0, captureAfter: false };

describe('scrapeWithActions tool (real module)', () => {
  let tool;

  beforeEach(() => {
    tool = new ScrapeWithActionsTool({ actionExecutor: makeFakeExecutor(), enableLogging: false });
  });

  test('constructor wires the injected actionExecutor (no browser launched)', () => {
    assert.ok(tool.actionExecutor);
    assert.ok(tool.extractContentTool, 'a real ExtractContentTool is constructed by default');
  });

  test('happy path — click and wait actions complete successfully', async () => {
    const result = await tool.execute({
      url: 'https://example.com',
      actions: [CLICK_ACTION, WAIT_ACTION]
    });
    assert.equal(result.success, true);
    assert.equal(result.url, 'https://example.com');
    assert.equal(result.totalActions, 2);
    assert.equal(result.successfulActions, 2);
    assert.equal(result.failedActions, 0);
    assert.ok(result.content.json || result.content.text || result.content.html, 'some content format should be present');
  });

  test('a failed action is reported in actionResults without throwing', async () => {
    const executor = makeFakeExecutor({
      onExecute: (url, chainConfig) => {
        const results = chainConfig.actions.map((a, i) => ({
          id: `action_${i}`, type: a.type, success: i !== 0, executionTime: 5, timestamp: Date.now(), error: i === 0 ? 'selector not found' : undefined
        }));
        return makeFakeChainResult(chainConfig.actions, { results, success: false, error: 'selector not found' });
      }
    });
    const failTool = new ScrapeWithActionsTool({ actionExecutor: executor, enableLogging: false });
    const result = await failTool.execute({ url: 'https://example.com', actions: [CLICK_ACTION, WAIT_ACTION] });
    assert.equal(result.failedActions, 1);
    assert.equal(result.actionResults[0].error, 'selector not found');
  });

  test('missing url fails Zod validation and rejects', async () => {
    await assert.rejects(() => tool.execute({ actions: [WAIT_ACTION] }));
  });

  test('missing actions (without replayRecording) rejects with a clear message', async () => {
    await assert.rejects(() => tool.execute({ url: 'https://example.com' }), /actions is required/);
  });

  test('invalid URL rejects', async () => {
    await assert.rejects(() => tool.execute({ url: 'not-valid', actions: [WAIT_ACTION] }));
  });

  test('executor error propagates as a thrown error', async () => {
    const errExecutor = { executeActionChain: async () => { throw new Error('Browser crashed'); }, getStats: () => ({}), destroy: async () => {} };
    const errTool = new ScrapeWithActionsTool({ actionExecutor: errExecutor, enableLogging: false });
    await assert.rejects(() => errTool.execute({ url: 'https://example.com', actions: [WAIT_ACTION] }), /Browser crashed/);
  });

  test('concurrent session limit is enforced', async () => {
    let releaseFirst;
    const blockingExecutor = makeFakeExecutor({
      onExecute: async (url, chainConfig) => {
        await new Promise((resolve) => { releaseFirst = resolve; });
        return makeFakeChainResult(chainConfig.actions);
      }
    });
    const limitedTool = new ScrapeWithActionsTool({ actionExecutor: blockingExecutor, enableLogging: false, maxConcurrentSessions: 1 });

    const firstCall = limitedTool.execute({ url: 'https://example.com', actions: [WAIT_ACTION] });
    // Give the first call a chance to register itself as an active session.
    await new Promise((r) => setTimeout(r, 10));

    await assert.rejects(
      () => limitedTool.execute({ url: 'https://example.com', actions: [WAIT_ACTION] }),
      /Maximum concurrent sessions/
    );

    releaseFirst();
    await firstCall;
  });

  test('shouldCaptureAfterAction is true for click/type/press only', () => {
    assert.equal(tool.shouldCaptureAfterAction({ type: 'click' }), true);
    assert.equal(tool.shouldCaptureAfterAction({ type: 'type' }), true);
    assert.equal(tool.shouldCaptureAfterAction({ type: 'press' }), true);
    assert.equal(tool.shouldCaptureAfterAction({ type: 'wait' }), false);
    assert.equal(tool.shouldCaptureAfterAction({ type: 'scroll' }), false);
  });

  test('processActionResults maps raw results to a stable public shape', () => {
    const raw = [{ id: 'a1', type: 'click', success: true, description: 'Click button', executionTime: 12, timestamp: 111, error: undefined, result: { ok: true }, recovered: false }];
    const mapped = tool.processActionResults(raw);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].id, 'a1');
    assert.equal(mapped[0].type, 'click');
    assert.equal(mapped[0].success, true);
    assert.equal(mapped[0].executionTime, 12);
  });
});

/**
 * All tests above fully stub out ActionExecutor.executeActionChain (via
 * makeFakeExecutor), which is the intended seam for testing
 * ScrapeWithActionsTool without a real browser — but it also means a
 * failure between page creation and page.goto() resolving never exercises
 * the REAL cleanup code in ActionExecutor.initializePage
 * (src/core/ActionExecutor.js): a leaked page/context on every failed
 * navigation would be entirely invisible to this file. The tests below
 * construct a real ActionExecutor and fake only the one seam Playwright
 * itself would occupy (browserProcessor.initializePage), so a page.goto()
 * rejection runs through the tool's actual try/catch/finally cleanup —
 * matching the pattern used in tests/unit/phase3-leaks.test.js.
 */
describe('ActionExecutor browser lifecycle (real module — src/core/ActionExecutor.js)', () => {
  function makeFakePage({ closeTracker }) {
    const fakeContext = { close: async () => { closeTracker.contextClosed = true; closeTracker.count++; } };
    return {
      goto: async () => { throw new Error('net::ERR_CONNECTION_REFUSED'); },
      url: () => 'http://127.0.0.1/phase4-fake-page',
      content: async () => '<html></html>',
      close: async () => { closeTracker.pageClosed = true; closeTracker.count++; },
      context: () => fakeContext
    };
  }

  test('initializePage closes both the page and its owning context when page.goto() rejects', async () => {
    const executor = new ActionExecutor({ enableScreenshotOnError: false, defaultTimeout: 500 });
    const closeTracker = { pageClosed: false, contextClosed: false, count: 0 };
    executor.browserProcessor.initializePage = async () => makeFakePage({ closeTracker });

    try {
      await assert.rejects(
        () => executor.initializePage('http://127.0.0.1/phase4-fake-page', {}),
        /ERR_CONNECTION_REFUSED/
      );
      assert.equal(closeTracker.pageClosed, true, 'page.close() must be awaited when page.goto() rejects');
      assert.equal(closeTracker.contextClosed, true, 'the owning context.close() must be awaited when page.goto() rejects');
    } finally {
      await executor.destroy();
      // BrowserProcessor's constructor eagerly creates a LocalizationManager
      // whose health-check timers aren't torn down by executor.destroy() —
      // see the "bonus finding" describe block in tests/unit/phase3-leaks.test.js.
      await executor.browserProcessor.localizationManager?.cleanup();
    }
  });

  test('executeActionChain (real chain path) reports the goto failure and still closes page+context exactly once each', async () => {
    const executor = new ActionExecutor({ enableScreenshotOnError: false, defaultTimeout: 500 });
    const closeTracker = { pageClosed: false, contextClosed: false, count: 0 };
    executor.browserProcessor.initializePage = async () => makeFakePage({ closeTracker });

    try {
      // executeActionChain catches errors internally and resolves with
      // success:false (it never rejects) — see its outer try/catch, which
      // is why ScrapeWithActionsTool's fakes above return { success: false }
      // rather than throwing for a failed chain.
      const result = await executor.executeActionChain(
        'http://127.0.0.1/phase4-fake-page',
        { actions: [{ type: 'wait', duration: 10 }] }
      );
      assert.equal(result.success, false);
      assert.match(result.error, /ERR_CONNECTION_REFUSED/);
      // initializePage's own catch already closed page+context before
      // rethrowing; executeActionChain's outer finally only closes `page` if
      // it was assigned (which only happens on success), so this must be
      // exactly 2 (page once, context once) — not 4 (double-close) or 0 (leak).
      assert.equal(closeTracker.count, 2, 'page and context must each be closed exactly once, not leaked or double-closed');
    } finally {
      await executor.destroy();
      await executor.browserProcessor.localizationManager?.cleanup();
    }
  });
});

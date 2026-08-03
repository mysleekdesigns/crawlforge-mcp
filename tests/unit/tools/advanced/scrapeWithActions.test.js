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
import { ScrapeWithActionsTool } from '../../../../src/tools/advanced/ScrapeWithActionsTool.js';

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

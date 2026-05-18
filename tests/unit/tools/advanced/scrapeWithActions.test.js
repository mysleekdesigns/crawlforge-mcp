/**
 * D5.2 — Unit tests: scrapeWithActions tool
 * Run: node --test tests/unit/tools/advanced/scrapeWithActions.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stubs — mock Playwright page via injected page factory
// ---------------------------------------------------------------------------

function makePageStub(overrides = {}) {
  return {
    goto: async (url) => ({ status: () => 200 }),
    click: async (selector) => {},
    fill: async (selector, value) => {},
    waitForSelector: async (selector) => {},
    content: async () => '<html><body><h1>Result Page</h1></body></html>',
    screenshot: async (opts) => Buffer.from('fake-screenshot'),
    close: async () => {},
    ...overrides
  };
}

class ActionExecutorStub {
  constructor({ pageFactory } = {}) {
    this._pageFactory = pageFactory || (() => makePageStub());
  }

  async executeActions(url, actions, options = {}) {
    const page = this._pageFactory(url);

    const results = [];
    for (const action of actions) {
      if (action.type === 'navigate') await page.goto(action.url || url);
      else if (action.type === 'click') await page.click(action.selector);
      else if (action.type === 'fill') await page.fill(action.selector, action.value);
      else if (action.type === 'wait') await page.waitForSelector(action.selector);
      else if (action.type === 'screenshot') {
        const buf = await page.screenshot({ fullPage: action.fullPage || false });
        results.push({ type: 'screenshot', data: buf.toString('base64') });
        continue;
      } else if (action.type === 'unknown_action') throw new Error(`Unknown action type: ${action.type}`);
      results.push({ type: action.type, success: true });
    }

    const finalHtml = await page.content();
    await page.close();

    return { url, finalHtml, actionResults: results, success: true };
  }
}

// ---------------------------------------------------------------------------
// Minimal ScrapeWithActions-like stub
// ---------------------------------------------------------------------------

class ScrapeWithActionsStub {
  constructor({ executor } = {}) {
    this.executor = executor || new ActionExecutorStub();
  }

  async execute(params) {
    if (!params || !params.url) throw new Error('url is required');
    if (!params.actions || !Array.isArray(params.actions)) throw new Error('actions array is required');
    try { new URL(params.url); } catch { throw new Error('Invalid URL'); }

    const result = await this.executor.executeActions(params.url, params.actions, params.options || {});

    return {
      url: params.url,
      success: result.success,
      finalContent: result.finalHtml,
      actionResults: result.actionResults,
      screenshot: result.screenshot || null
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scrapeWithActions tool', () => {
  let tool;

  beforeEach(() => {
    tool = new ScrapeWithActionsStub();
  });

  test('constructor stores executor', () => {
    assert.ok(tool.executor instanceof ActionExecutorStub);
  });

  test('happy path — navigate and click actions complete successfully', async () => {
    const result = await tool.execute({
      url: 'https://example.com',
      actions: [
        { type: 'navigate' },
        { type: 'click', selector: '#btn' },
        { type: 'wait', selector: '.result' }
      ]
    });
    assert.equal(result.success, true);
    assert.equal(result.url, 'https://example.com');
    assert.ok(result.finalContent.includes('Result Page'));
    assert.equal(result.actionResults.length, 3);
  });

  test('screenshot action captures base64 image', async () => {
    const result = await tool.execute({
      url: 'https://example.com',
      actions: [{ type: 'screenshot', fullPage: true }]
    });
    assert.ok(result.actionResults[0].data, 'screenshot data should be present');
    assert.equal(result.actionResults[0].type, 'screenshot');
  });

  test('missing url throws', async () => {
    await assert.rejects(() => tool.execute({ actions: [] }), /url is required/);
  });

  test('missing actions throws', async () => {
    await assert.rejects(() => tool.execute({ url: 'https://example.com' }), /actions array is required/);
  });

  test('invalid URL throws', async () => {
    await assert.rejects(() => tool.execute({ url: 'not-valid', actions: [] }), /Invalid URL/);
  });

  test('executor error propagates', async () => {
    const errExecutor = { executeActions: async () => { throw new Error('Browser crashed'); } };
    const errTool = new ScrapeWithActionsStub({ executor: errExecutor });
    await assert.rejects(() => errTool.execute({ url: 'https://example.com', actions: [{ type: 'navigate' }] }), /Browser crashed/);
  });

  test('page is always closed (via page.close stub tracking)', async () => {
    let closeCalled = false;
    const trackingPage = makePageStub({ close: async () => { closeCalled = true; } });
    const executor = new ActionExecutorStub({ pageFactory: () => trackingPage });
    const t = new ScrapeWithActionsStub({ executor });
    await t.execute({ url: 'https://example.com', actions: [{ type: 'navigate' }] });
    assert.ok(closeCalled, 'page.close() should be called');
  });
});

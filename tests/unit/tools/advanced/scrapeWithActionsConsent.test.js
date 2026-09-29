/**
 * Unit tests: scrape_with_actions browserOptions.consent (tool layer).
 * Run: node --test --test-force-exit tests/unit/tools/advanced/scrapeWithActionsConsent.test.js
 *
 * Same fake-executor seam as scrapeWithActions.test.js: these pin the schema
 * default, the pass-through to ActionExecutor, and the result field. The
 * autoconsent behaviour itself is tested against a real page in
 * tests/unit/core/browserConsent.test.js.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { ScrapeWithActionsTool } = await import('../../../../src/tools/advanced/ScrapeWithActionsTool.js');

const WAIT_ACTION = { type: 'wait', duration: 100 };

function toolReturning(consent) {
  const seen = {};
  const executor = {
    executeActionChain: async (url, chainConfig, browserOptions) => {
      seen.browserOptions = browserOptions;
      return {
        success: true,
        results: chainConfig.actions.map((a, i) => ({ id: `a${i}`, type: a.type, success: true, executionTime: 1, timestamp: Date.now() })),
        capturedStates: [],
        screenshots: [],
        finalHtml: '<html><head><title>T</title></head><body><h1>T</h1><p>Body.</p></body></html>',
        finalUrl: url,
        ...(consent ? { consent } : {})
      };
    },
    getStats: () => ({}),
    destroy: async () => {}
  };
  return { tool: new ScrapeWithActionsTool({ actionExecutor: executor, enableLogging: false }), seen };
}

describe('scrape_with_actions browserOptions.consent', () => {
  test('defaults to "off" and the result has no consent field', async () => {
    const { tool, seen } = toolReturning();
    const result = await tool.execute({ url: 'https://example.com', actions: [WAIT_ACTION], browserOptions: {}, captureScreenshots: false });
    assert.equal(result.success, true, result.error);
    assert.equal(seen.browserOptions.consent, 'off');
    assert.equal('consent' in result, false);
  });

  test('"reject" reaches ActionExecutor and its consent object is returned', async () => {
    const consent = { cmp: 'Sourcepoint-frame', action: 'optOut', ms: 812 };
    const { tool, seen } = toolReturning(consent);
    const result = await tool.execute({
      url: 'https://example.com', actions: [WAIT_ACTION], browserOptions: { consent: 'reject' }, captureScreenshots: false
    });
    assert.equal(seen.browserOptions.consent, 'reject');
    assert.deepEqual(result.consent, consent);
  });

  test('an unknown mode is refused by the schema', async () => {
    const { tool } = toolReturning();
    await assert.rejects(
      tool.execute({ url: 'https://example.com', actions: [WAIT_ACTION], browserOptions: { consent: 'yes' } })
    );
  });
});

/**
 * Regression tests: deep_research stealth-browser extraction fallback.
 *
 * Run: node --test --test-force-exit tests/unit/researchStealthFallback.test.js
 *
 * Many high-value discussion sources (Reddit, Quora, forums) return HTTP 403
 * to the plain fetch/extract path. exploreSourcesInDepth() now retries blocked
 * sources through a real fingerprinted browser (_stealthFetchHtml) and re-runs
 * extraction on the rendered HTML. These tests mock _stealthFetchHtml so no
 * real browser (Playwright) is launched.
 *
 * S1 a blocked source is recovered via the stealth fallback (metrics counted)
 * S2 enableStealthFallback:false skips the fallback entirely
 * S3 maxStealthRetries caps the number of stealth attempts per run
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ResearchOrchestrator } from '../../src/core/ResearchOrchestrator.js';

// Build an extractTool stub: the plain path (no `html`) reports blocked;
// the stealth re-extract (with `html`) returns real content.
function stubExtractTool(orch) {
  orch.extractTool.execute = async ({ html }) => {
    if (html) {
      return { success: true, content: { text: 'recovered article body with plenty of words' }, metadata: {}, structuredData: {} };
    }
    return { success: false, error: 'HTTP 403: Forbidden', content: { text: '' } };
  };
}

const source = (n) => ({ link: `https://forum.example.com/thread/${n}`, title: `Thread ${n}`, snippet: 'snippet' });

describe('S1 stealth fallback recovers a blocked source', () => {
  test('blocked extract -> stealth HTML -> re-extract -> counted + returned', async () => {
    const orch = new ResearchOrchestrator({ enableStealthFallback: true, maxStealthRetries: 8 });
    orch.initializeResearchSession('s1', 'forum discussion', Date.now());
    stubExtractTool(orch);
    let stealthCalls = 0;
    orch._stealthFetchHtml = async () => { stealthCalls++; return '<html><body>recovered article body with plenty of words</body></html>'; };

    const findings = await orch.exploreSourcesInDepth([source(1)], {});

    assert.equal(stealthCalls, 1, 'stealth fetch should be attempted once');
    assert.equal(orch.metrics.stealthRetries, 1);
    assert.equal(orch.metrics.stealthRecovered, 1);
    assert.equal(findings.length, 1, 'recovered source should be returned');
    assert.match(findings[0].extractedContent, /recovered article body/);
    // never launched a real browser, so nothing to clean up
    assert.equal(orch._stealthManager, null);
  });
});

describe('S2 fallback disabled', () => {
  test('enableStealthFallback:false -> no stealth attempt, blocked source dropped', async () => {
    const orch = new ResearchOrchestrator({ enableStealthFallback: false });
    orch.initializeResearchSession('s2', 'forum discussion', Date.now());
    stubExtractTool(orch);
    let stealthCalls = 0;
    orch._stealthFetchHtml = async () => { stealthCalls++; return '<html>x</html>'; };

    const findings = await orch.exploreSourcesInDepth([source(1)], {});

    assert.equal(stealthCalls, 0, 'stealth must not be attempted when disabled');
    assert.equal(orch.metrics.stealthRetries, 0);
    assert.equal(findings.length, 0, 'blocked source with no fallback is dropped');
  });
});

describe('S3 retry budget is capped', () => {
  test('maxStealthRetries limits attempts across many blocked sources', async () => {
    const orch = new ResearchOrchestrator({ enableStealthFallback: true, maxStealthRetries: 2, concurrency: 1 });
    orch.initializeResearchSession('s3', 'forum discussion', Date.now());
    stubExtractTool(orch);
    let stealthCalls = 0;
    // stealth returns null (still blocked) so nothing is recovered, but the
    // attempt counter must still stop at the cap.
    orch._stealthFetchHtml = async () => { stealthCalls++; return null; };

    await orch.exploreSourcesInDepth([source(1), source(2), source(3), source(4), source(5)], {});

    assert.equal(stealthCalls, 2, 'stealth attempts must not exceed maxStealthRetries');
    assert.equal(orch.metrics.stealthRetries, 2);
    assert.equal(orch.metrics.stealthRecovered, 0);
  });
});

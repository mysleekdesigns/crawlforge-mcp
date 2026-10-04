/**
 * Unit tests for src/server/errorText.js and its withAuth wiring (R24 4.5).
 *
 * Run: node --test tests/unit/errorText.test.js
 *
 * Contract: error results reach the model without ANSI codes, Playwright call
 * logs, stack frames or a doubled "X failed: X failed:" prefix; success
 * results and page content are untouched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanErrorText, normalizeErrorResult } from '../../src/server/errorText.js';
import { makeWithAuth } from '../../src/server/withAuth.js';

// Verbatim from the live scrape_with_actions repro (a wait for a selector that never appears).
const PLAYWRIGHT = "Action failed: locator.waitFor: Timeout 1500ms exceeded.\nCall log:\n\u001b[2m  - waiting for locator('#never-there').first() to be visible\u001b[22m\n";

test('ANSI codes and the Playwright call log are dropped', () => {
  assert.equal(cleanErrorText(PLAYWRIGHT), 'Action failed: locator.waitFor: Timeout 1500ms exceeded.');
  assert.equal(
    cleanErrorText('page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating to "https://a.com/", waiting until "load"\n  - done\nNext step: x'),
    'page.goto: Timeout 30000ms exceeded.\nNext step: x'
  );
});

test('stack frame lines are dropped, the message kept', () => {
  const stack = 'TypeError: boom\n    at fn (/srv/a.js:1:2)\n    at /srv/b.js:3:4\n    at <anonymous>';
  assert.equal(cleanErrorText(stack), 'TypeError: boom');
});

test('an immediately repeated "X failed:" prefix collapses to one', () => {
  assert.equal(
    cleanErrorText("Search failed: Search failed: provider 'searxng' requires CRAWLFORGE_SEARXNG_URL in environment"),
    "Search failed: provider 'searxng' requires CRAWLFORGE_SEARXNG_URL in environment"
  );
  assert.equal(cleanErrorText('Scrape with actions failed: Scrape with actions failed: Action failed: x'), 'Scrape with actions failed: Action failed: x');
  // Different prefixes are different information.
  assert.equal(cleanErrorText('Scrape failed: scrape: fetch failed for a'), 'Scrape failed: scrape: fetch failed for a');
});

test('JSON bodies: error strings at any depth are cleaned, page content is not', () => {
  const body = {
    success: false,
    error: PLAYWRIGHT,
    actionResults: [{ type: 'wait', error: PLAYWRIGHT }],
    attempts: [{ error: PLAYWRIGHT, results: [{ error: PLAYWRIGHT }] }],
    errors: [PLAYWRIGHT],
    content: { text: 'page text\u001b[2m kept' }
  };
  const result = { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: structuredClone(body) };
  normalizeErrorResult(result);
  for (const parsed of [JSON.parse(result.content[0].text), result.structuredContent]) {
    const clean = 'Action failed: locator.waitFor: Timeout 1500ms exceeded.';
    assert.equal(parsed.error, clean);
    assert.equal(parsed.actionResults[0].error, clean);
    assert.equal(parsed.attempts[0].error, clean);
    assert.equal(parsed.attempts[0].results[0].error, clean);
    assert.equal(parsed.errors[0], clean);
    assert.equal(parsed.content.text, 'page text\u001b[2m kept');
  }
});

test('success results are untouched', () => {
  const text = JSON.stringify({ success: true, error: PLAYWRIGHT });
  const result = { content: [{ type: 'text', text }] };
  normalizeErrorResult(result);
  assert.equal(result.content[0].text, text);
  const plain = { content: [{ type: 'text', text: PLAYWRIGHT }] };
  normalizeErrorResult(plain);
  assert.equal(plain.content[0].text, PLAYWRIGHT);
});

test('withAuth cleans plain-text and success:false error results before the hint', async () => {
  const auth = {
    isCreatorMode: () => true,
    getToolCost: () => 0,
    checkCredits: async () => true,
    projectCost: () => ({ projected: 0, note: 'test' }),
    reportUsage: async () => {}
  };
  const withAuth = makeWithAuth({ authManager: auth, logger: { info() {} } });

  const search = await withAuth('search_web', async () => ({
    content: [{ type: 'text', text: 'Search failed: Search failed: upstream 502' }], isError: true
  }))({ query: 'x' });
  assert.match(search.content[0].text, /^Search failed: upstream 502\nNext step: /);

  const actions = await withAuth('scrape_with_actions', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ success: false, error: PLAYWRIGHT, actionResults: [{ error: PLAYWRIGHT }] }) }]
  }))({});
  const text = actions.content[0].text;
  assert.doesNotMatch(text, /\\u001b|Call log/);
  const parsed = JSON.parse(text);
  assert.equal(parsed.error, 'Action failed: locator.waitFor: Timeout 1500ms exceeded.');
  assert.equal(typeof parsed.next_step, 'string');
});

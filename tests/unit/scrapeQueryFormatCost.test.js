/**
 * Unit tests for the price of `scrape`'s query-scoped formats (Phase 1):
 * AuthManager.getToolCost('scrape', params) = 2 + 1 when a highlights or
 * question format is present (once per call) + 3 when any of them asks for
 * mode:"model" (once per call). The rule is scrapeFormatSurcharge in
 * src/tools/scrape/formats.js, which the tool also reads when it lowers the
 * charge for a model step that never ran.
 *
 * getToolCost sees the RAW params — before validation — so anything that is
 * not an array of formats must price as the base.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test tests/unit/scrapeQueryFormatCost.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { default: authManager } = await import('../../src/core/AuthManager.js');
const { scrapeFormatSurcharge } = await import('../../src/tools/scrape/formats.js');

const cost = (formats) => authManager.getToolCost('scrape', formats === undefined ? undefined : { formats });
const costOf = (params) => authManager.getToolCost('scrape', params);

test('scrape base price is 2, with or without string formats', () => {
  assert.equal(cost(undefined), 2);
  assert.equal(cost(['markdown']), 2);
  assert.equal(cost(['markdown', 'links', 'screenshot', { type: 'json', prompt: 'x' }]), 2);
});

test('a highlights format adds 1', () => {
  assert.equal(cost(['markdown', { type: 'highlights', query: 'price' }]), 3);
  assert.equal(cost([{ type: 'highlights', query: 'price', mode: 'extractive' }]), 3);
});

test('a question format adds 1', () => {
  assert.equal(cost([{ type: 'question', question: 'how much?' }]), 3);
});

test('highlights and question together add 1 once', () => {
  assert.equal(cost([{ type: 'highlights', query: 'price' }, { type: 'question', question: 'how much?' }]), 3);
  assert.equal(cost([{ type: 'highlights', query: 'a' }, { type: 'highlights', query: 'b' }]), 3);
});

test('mode:"model" on any of them adds 3 once', () => {
  assert.equal(cost([{ type: 'question', question: 'how much?', mode: 'model' }]), 6);
  assert.equal(cost([{ type: 'highlights', query: 'price', mode: 'model' }, { type: 'question', question: 'q', mode: 'model' }]), 6);
  assert.equal(cost(['markdown', { type: 'highlights', query: 'price' }, { type: 'question', question: 'q', mode: 'model' }]), 6);
});

test('garbage formats price as the base', () => {
  assert.equal(cost('highlights'), 2);
  assert.equal(cost(42), 2);
  assert.equal(cost(null), 2);
  assert.equal(cost([null, 3, 'markdown', { type: 'nope', mode: 'model' }, { mode: 'model' }]), 2);
  assert.deepEqual(scrapeFormatSurcharge({ type: 'highlights' }), { query: 0, model: 0 });
});

test('projectCost surfaces the add-ons in the note and projects the full price', () => {
  const projection = authManager.projectCost('scrape', { formats: [{ type: 'question', question: 'q', mode: 'model' }] });
  assert.equal(projection.projected, 6);
  assert.match(projection.note, /adds 1 once per call/);
  assert.match(projection.note, /mode:"model" adds 3 once/);
  assert.match(projection.note, /json format may incur external LLM cost/);
});

// Phase 3: escalate:true projects the stealth browser's own 5 on top, because
// that is the ceiling the call may reach. The tool reports the lower actual.
test('escalate:true adds 5, and only exactly true does', () => {
  assert.equal(costOf({ escalate: true }), 7);
  assert.equal(costOf({ url: 'https://example.com/', escalate: true, formats: ['markdown'] }), 7);
  assert.equal(costOf({ escalate: false }), 2);
  for (const notTrue of [undefined, null, 'true', 1, {}, []]) {
    assert.equal(costOf({ escalate: notTrue }), 2, `priced as the base: ${JSON.stringify(notTrue)}`);
  }
});

test('the escalation surcharge stacks with the query-format ones', () => {
  assert.equal(costOf({ escalate: true, formats: [{ type: 'highlights', query: 'price' }] }), 8);
  assert.equal(costOf({ escalate: true, formats: [{ type: 'question', question: 'q', mode: 'model' }] }), 11);
});

test('projectCost explains the 7 and that the actual drops back to the base', () => {
  const projection = authManager.projectCost('scrape', { url: 'https://example.com/', escalate: true });
  assert.equal(projection.projected, 7);
  assert.match(projection.note, /escalate:true adds 5/);
  assert.match(projection.note, /drops back to the base/);
});

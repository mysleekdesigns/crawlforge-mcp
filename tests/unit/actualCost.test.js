/**
 * Unit tests for the outcome-aware charge channel (Phase 0.2):
 * setActualCost / reportedActualCost in src/server/requestContext.js, read by
 * src/server/withAuth.js when it decides the charge.
 *
 * Run: node --test tests/unit/actualCost.test.js
 *
 * Invariant under test: actual = min(reported, projected). A handler can only
 * lower the charge, never raise it; an error result still halves; a refusal
 * still bills zero; an unreported call bills exactly as before.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWithAuth } from '../../src/server/withAuth.js';
import {
  markPreflightRefusal,
  reportedActualCost,
  requestContext,
  setActualCost
} from '../../src/server/requestContext.js';

function makeFakeLogger() {
  const calls = [];
  return {
    calls,
    info(message, context) { calls.push({ level: 'info', message, context }); },
    warn(message, context) { calls.push({ level: 'warn', message, context }); },
    error(message, error, context) { calls.push({ level: 'error', message, error, context }); },
    debug(message, context) { calls.push({ level: 'debug', message, context }); }
  };
}

function makeFakeAuth({ creatorMode = false, creditsOk = true, toolCost = 1 } = {}) {
  const reportCalls = [];
  return {
    reportCalls,
    isCreatorMode: () => creatorMode,
    getToolCost: () => toolCost,
    checkCredits: async () => creditsOk,
    projectCost: () => ({ projected: toolCost, note: 'test' }),
    reportUsage: async (...args) => { reportCalls.push(args); }
  };
}

function setup(toolCost) {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ toolCost });
  const withAuth = makeWithAuth({ authManager: auth, logger });
  return { auth, withAuth };
}

const ok = (body = { ok: true }) => ({ content: [{ type: 'text', text: JSON.stringify(body) }] });
const failed = (body = { error: 'boom' }) => ({ ...ok(body), isError: true });
const costOf = (result) => JSON.parse(result.content[0].text)._cost;

test('actualCost: reported above projected is clamped to projected', async () => {
  const { auth, withAuth } = setup(5);
  const wrapped = withAuth('scrape', async () => { setActualCost(9); return ok(); });

  const cost = costOf(await wrapped({ url: 'https://example.com/' }));

  assert.equal(cost.projected, 5);
  assert.equal(cost.actual, 5, 'the projection is the ceiling');
  assert.equal(auth.reportCalls.length, 1);
  assert.equal(auth.reportCalls[0][1], 5, 'reportUsage receives the projection, not the inflated report');
});

test('actualCost: reported below projected bills the reported value on success', async () => {
  const { auth, withAuth } = setup(5);
  const wrapped = withAuth('scrape', async () => { setActualCost(2); return ok(); });

  const cost = costOf(await wrapped({ url: 'https://example.com/' }));

  assert.equal(cost.projected, 5, 'the published price is still surfaced');
  assert.equal(cost.actual, 2);
  assert.equal(auth.reportCalls[0][1], 2);
  assert.equal(auth.reportCalls[0][3], 200);
});

test('actualCost: reported below projected on an isError result bills max(1, floor(reported * 0.5))', async () => {
  const { auth, withAuth } = setup(8);
  const wrapped = withAuth('scrape', async () => { setActualCost(5); return failed(); });

  const cost = costOf(await wrapped({ url: 'https://example.com/' }));

  assert.equal(cost.actual, 2, 'floor(5 * 0.5)');
  assert.equal(auth.reportCalls[0][1], 2);
  assert.equal(auth.reportCalls[0][3], 500);
});

test('actualCost: a reported 1 on an isError result still bills the 1-credit floor', async () => {
  const { auth, withAuth } = setup(8);
  const wrapped = withAuth('scrape', async () => { setActualCost(1); return failed(); });

  const cost = costOf(await wrapped({ url: 'https://example.com/' }));

  assert.equal(cost.actual, 1, 'max(1, floor(0.5))');
  assert.equal(auth.reportCalls[0][1], 1);
});

test('actualCost: a thrown error halves the reported value, not the projection', async () => {
  const { auth, withAuth } = setup(8);
  const wrapped = withAuth('crawl_deep', async () => { setActualCost(4); throw new Error('boom'); });

  await assert.rejects(() => wrapped({ url: 'https://example.com/' }), /boom/);

  assert.equal(auth.reportCalls.length, 1);
  assert.equal(auth.reportCalls[0][1], 2, 'floor(4 * 0.5), not floor(8 * 0.5)');
});

test('actualCost: unreported falls back to the projection', async () => {
  const { auth, withAuth } = setup(5);
  const success = withAuth('scrape', async () => ok());
  const error = withAuth('scrape', async () => failed());

  assert.equal(costOf(await success({ url: 'https://a.example/' })).actual, 5);
  assert.equal(auth.reportCalls[0][1], 5);
  assert.equal(costOf(await error({ url: 'https://b.example/' })).actual, 2, 'floor(5 * 0.5)');
  assert.equal(auth.reportCalls[1][1], 2);
});

test('actualCost: a refusal still bills zero even when a cost was reported', async () => {
  const { auth, withAuth } = setup(5);
  const wrapped = withAuth('scrape', async () => {
    markPreflightRefusal('ROBOTS_DISALLOWED');
    setActualCost(3);
    return failed({ error: 'robots.txt disallows this path' });
  });

  const cost = costOf(await wrapped({ url: 'https://example.com/private' }));

  assert.equal(cost.actual, 0);
  assert.equal(auth.reportCalls.length, 0, 'a refusal must not report usage at all');
});

test('actualCost: reported 0 on success surfaces _cost.actual=0 and emits no usage event', async () => {
  const { auth, withAuth } = setup(5);
  const wrapped = withAuth('scrape', async () => { setActualCost(0); return ok(); });

  const cost = costOf(await wrapped({ url: 'https://example.com/' }));

  assert.equal(cost.projected, 5);
  assert.equal(cost.actual, 0);
  assert.equal(auth.reportCalls.length, 0, 'nothing for the backend to (re-)price');
});

test('actualCost: the reported value does not leak into the next invocation on the same wrapper', async () => {
  const { auth, withAuth } = setup(5);
  let report = true;
  const wrapped = withAuth('scrape', async () => {
    if (report) setActualCost(1);
    return ok();
  });

  await wrapped({ url: 'https://a.example/' });
  report = false;
  const cost = costOf(await wrapped({ url: 'https://b.example/' }));

  assert.equal(auth.reportCalls[0][1], 1);
  assert.equal(cost.actual, 5, 'the second call is unreported and bills the projection');
  assert.equal(auth.reportCalls[1][1], 5);
});

test('actualCost: setActualCost ignores non-finite and negative values, and is a no-op without a store', () => {
  requestContext.run({}, () => {
    for (const bad of [-1, NaN, Infinity, -Infinity, '3', null, undefined]) {
      setActualCost(bad);
      assert.equal(reportedActualCost(), null, `ignored: ${String(bad)}`);
    }
    setActualCost(2);
    assert.equal(reportedActualCost(), 2);
  });

  // Outside any request context there is nowhere to write; must not throw.
  setActualCost(2);
  assert.equal(reportedActualCost(), null);
});

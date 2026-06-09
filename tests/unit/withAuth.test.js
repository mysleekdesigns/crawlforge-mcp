/**
 * Unit tests for src/server/withAuth.js (v3.0.19, audit phase A2).
 *
 * Run: node --test tests/unit/withAuth.test.js
 *
 * Contract under test: every withAuth invocation emits exactly one
 * `tool invocation` log line with { toolName, paramHash, durationMs, outcome,
 * creditCost, creatorMode }, regardless of outcome (success / error /
 * insufficient credits).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWithAuth, hashParams } from '../../src/server/withAuth.js';

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
  const checkCalls = [];
  const costCalls = [];
  return {
    reportCalls,
    checkCalls,
    costCalls,
    isCreatorMode: () => creatorMode,
    getToolCost: (tool, params) => { costCalls.push([tool, params]); return toolCost; },
    checkCredits: async (...args) => { checkCalls.push(args); return creditsOk; },
    projectCost: () => ({ projected: toolCost, note: 'test' }),
    reportUsage: async (...args) => { reportCalls.push(args); }
  };
}

test('hashParams: produces deterministic 12-char hex for equal inputs', () => {
  const a = hashParams({ url: 'https://example.com', n: 1 });
  const b = hashParams({ url: 'https://example.com', n: 1 });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{12}$/);
});

test('hashParams: different inputs produce different hashes', () => {
  const a = hashParams({ url: 'https://a.com' });
  const b = hashParams({ url: 'https://b.com' });
  assert.notEqual(a, b);
});

test('withAuth: success path emits exactly one log line with outcome=success', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 2 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const handler = withAuth('fetch_url', async (params) => ({
    content: [{ type: 'text', text: `ok:${params.url}` }]
  }));

  const result = await handler({ url: 'https://example.com' });

  assert.equal(result.content[0].text, 'ok:https://example.com');
  assert.equal(logger.calls.length, 1, 'exactly one log line per invocation');
  const line = logger.calls[0];
  assert.equal(line.level, 'info');
  assert.equal(line.message, 'tool invocation');
  assert.equal(line.context.toolName, 'fetch_url');
  assert.equal(line.context.outcome, 'success');
  assert.equal(line.context.creditCost, 2);
  assert.equal(line.context.creatorMode, false);
  assert.match(line.context.paramHash, /^[0-9a-f]{12}$/);
  assert.ok(typeof line.context.durationMs === 'number' && line.context.durationMs >= 0);
  assert.equal(auth.reportCalls.length, 1, 'reportUsage called once on success');
});

test('withAuth: error path emits log line with outcome=error and rethrows', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 3 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const handler = withAuth('crawl_deep', async () => {
    throw new Error('handler exploded');
  });

  await assert.rejects(() => handler({ url: 'https://x.com' }), /handler exploded/);

  assert.equal(logger.calls.length, 1, 'still exactly one log line on error');
  const line = logger.calls[0];
  assert.equal(line.context.outcome, 'error');
  assert.equal(line.context.toolName, 'crawl_deep');
  assert.equal(auth.reportCalls.length, 1, 'reportUsage still called on error (half credits)');
});

test('withAuth: insufficient credits emits log line with outcome=insufficient_credits', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: false, toolCost: 5 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  let handlerCalled = false;
  const handler = withAuth('deep_research', async () => {
    handlerCalled = true;
    return { content: [{ type: 'text', text: 'never' }] };
  });

  const result = await handler({ query: 'x' });

  assert.equal(handlerCalled, false, 'handler must not run when credits are insufficient');
  const text = JSON.parse(result.content[0].text);
  assert.equal(text.error, 'Insufficient credits');
  assert.equal(logger.calls.length, 1, 'one log line per invocation, even on early return');
  assert.equal(logger.calls[0].context.outcome, 'insufficient_credits');
  assert.equal(auth.reportCalls.length, 0, 'no usage report when credits insufficient');
});

test('withAuth: creator mode skips credit checks and reports, but still logs', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creatorMode: true, toolCost: 10 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const handler = withAuth('stealth_mode', async () => ({ content: [{ type: 'text', text: 'ok' }] }));
  await handler({});

  assert.equal(logger.calls.length, 1, 'creator mode still produces one log line');
  const line = logger.calls[0];
  assert.equal(line.context.creatorMode, true);
  assert.equal(line.context.creditCost, 0, 'creator mode reports zero credit cost');
  assert.equal(line.context.outcome, 'success');
  assert.equal(auth.reportCalls.length, 0, 'no usage report in creator mode');
});

// ─── Open-core Phase 2 — free Tier-0 tools (cost 0) ──────────────────────────

test('withAuth: 0-cost tool skips credit check and usage report, still logs and runs', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 0 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const handler = withAuth('fetch_url', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true }) }]
  }));
  const result = await handler({ url: 'https://example.com' });

  assert.equal(auth.checkCalls.length, 0, 'no credit check for a free tool');
  assert.equal(auth.reportCalls.length, 0, 'no usage report for a free tool');
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed._cost.actual, 0, '_cost.actual surfaces 0');
  assert.equal(logger.calls.length, 1, 'still exactly one log line');
  assert.equal(logger.calls[0].context.creditCost, 0);
  assert.equal(logger.calls[0].context.outcome, 'success');
});

test('withAuth: 0-cost tool error path reports no usage (no half-credit charge)', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 0 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  await assert.rejects(
    () => withAuth('extract_text', async () => { throw new Error('boom'); })({}),
    /boom/
  );

  assert.equal(auth.reportCalls.length, 0, 'free tool must not be charged half credits on error');
  assert.equal(logger.calls[0].context.outcome, 'error');
});

test('withAuth: resolves cost with params (scrape screenshot surcharge)', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 2 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const params = { url: 'https://example.com', formats: ['markdown', 'screenshot'] };
  await withAuth('scrape', async () => ({ content: [{ type: 'text', text: '{}' }] }))(params);

  assert.deepEqual(auth.costCalls[0], ['scrape', params], 'getToolCost receives the invocation params');
  assert.equal(auth.checkCalls.length, 1, 'metered invocation still checks credits');
  assert.equal(auth.reportCalls.length, 1, 'metered invocation still reports usage');
  assert.equal(auth.reportCalls[0][1], 2, 'reports the params-resolved cost');
});

// ─── v3.2.0 (C4) — observability ──────────────────────────────────────────────

function makeFakeMetrics() {
  const events = [];
  return {
    events,
    incCounter(name, labels, by = 1) { events.push({ kind: 'counter', name, labels, by }); },
    setGauge(name, labels, value) { events.push({ kind: 'gauge', name, labels, value }); },
    observeHistogram(name, labels, value) { events.push({ kind: 'hist', name, labels, value }); }
  };
}

test('withAuth: metrics — success increments requests + histogram + credits', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 3 });
  const metrics = makeFakeMetrics();
  const withAuth = makeWithAuth({ authManager: auth, logger, metrics });

  await withAuth('fetch_url', async () => ({ content: [{ type: 'text', text: 'ok' }] }))({ url: 'x' });

  const counter = metrics.events.find(e => e.kind === 'counter' && e.name === 'crawlforge_tool_requests_total');
  assert.ok(counter, 'requests counter incremented');
  assert.equal(counter.labels.tool, 'fetch_url');
  assert.equal(counter.labels.outcome, 'success');

  const credits = metrics.events.find(e => e.kind === 'counter' && e.name === 'crawlforge_credits_consumed_total');
  assert.ok(credits, 'credits counter incremented on success');
  assert.equal(credits.by, 3);

  const hist = metrics.events.find(e => e.kind === 'hist');
  assert.ok(hist, 'duration histogram observed');
});

test('withAuth: metrics — error path emits errors counter with error_class', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 1 });
  const metrics = makeFakeMetrics();
  const withAuth = makeWithAuth({ authManager: auth, logger, metrics });

  class BoomError extends Error {
    constructor(msg) { super(msg); this.name = 'BoomError'; }
  }
  await assert.rejects(
    () => withAuth('crawl_deep', async () => { throw new BoomError('nope'); })({})
  );

  const err = metrics.events.find(e => e.kind === 'counter' && e.name === 'crawlforge_tool_errors_total');
  assert.ok(err);
  assert.equal(err.labels.error_class, 'BoomError');
});

test('withAuth: metrics — works fine when no registry is passed', async () => {
  // Just verifying no metrics-related throw — covered by all the earlier tests too,
  // but make it explicit.
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 1 });
  const withAuth = makeWithAuth({ authManager: auth, logger });
  await withAuth('x', async () => ({ content: [] }))({});
});

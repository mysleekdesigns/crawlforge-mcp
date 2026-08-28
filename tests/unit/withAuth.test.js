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
import { markPreflightRefusal } from '../../src/server/requestContext.js';

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
  assert.equal(result.isError, true, 'insufficient-credits refusal is a proper MCP error result');
  const text = JSON.parse(result.content[0].text);
  assert.equal(text.error, 'Insufficient credits');
  assert.equal(logger.calls.length, 1, 'one log line per invocation, even on early return');
  assert.equal(logger.calls[0].context.outcome, 'insufficient_credits');
  assert.equal(auth.reportCalls.length, 0, 'no usage report when credits insufficient');
});

test('withAuth: checkCredits throwing rejects the call and bills nothing (handler never ran)', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 5 });
  auth.checkCredits = async () => { throw new Error('billing backend unreachable'); };
  const withAuth = makeWithAuth({ authManager: auth, logger });

  let handlerCalled = false;
  const handler = withAuth('deep_research', async () => {
    handlerCalled = true;
    return { content: [{ type: 'text', text: 'never' }] };
  });

  await assert.rejects(() => handler({ query: 'x' }), /billing backend unreachable/);

  assert.equal(handlerCalled, false, 'handler must not run when the credit check itself throws');
  assert.equal(auth.reportCalls.length, 0, 'no usage report when the credit check throws — nothing ran to bill');
  assert.equal(logger.calls.length, 1, 'still exactly one log line');
  assert.equal(logger.calls[0].context.outcome, 'error');
  assert.equal(logger.calls[0].context.toolName, 'deep_research');
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

// ─── All tools are metered (no free tier) ────────────────────────────────────

test('withAuth: metered tool checks credits and reports usage on success', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 1 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const handler = withAuth('fetch_url', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true }) }]
  }));
  const result = await handler({ url: 'https://example.com' });

  assert.equal(auth.checkCalls.length, 1, 'credit check runs for every tool');
  assert.equal(auth.reportCalls.length, 1, 'usage reported for every tool');
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed._cost.actual, 1, '_cost.actual surfaces the charged cost');
  assert.equal(logger.calls.length, 1, 'still exactly one log line');
  assert.equal(logger.calls[0].context.creditCost, 1);
  assert.equal(logger.calls[0].context.outcome, 'success');
});

test('withAuth: metered tool error path reports a half-credit charge', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 4 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  await assert.rejects(
    () => withAuth('crawl_deep', async () => { throw new Error('boom'); })({}),
    /boom/
  );

  assert.equal(auth.reportCalls.length, 1, 'half-credit charge reported on error');
  assert.equal(logger.calls[0].context.outcome, 'error');
});

test('withAuth: a returned { isError:true } is an error outcome billed at half, without throwing', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 4 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const handler = withAuth('serp_rank', async () => ({
    content: [{ type: 'text', text: 'SERP rank check failed: boom' }],
    isError: true
  }));
  const result = await handler({ keyword: 'k', target: 't' });

  assert.equal(result.isError, true, 'the graceful isError result is returned, not thrown');
  assert.equal(auth.reportCalls.length, 1, 'usage reported once');
  assert.equal(auth.reportCalls[0][1], 2, 'charged half of 4 on an isError result');
  assert.equal(auth.reportCalls[0][3], 500, 'reported with a 500 responseStatus');
  assert.equal(logger.calls[0].context.outcome, 'error', 'logged as an error outcome');
});

test('withAuth: a zero-cost call emits no usage event and surfaces _cost.actual=0', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 0 }); // e.g. serp_rank unconfigured no-op
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const handler = withAuth('serp_rank', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ configured: false }) }]
  }));
  const result = await handler({ keyword: 'k', target: 't' });

  assert.equal(auth.reportCalls.length, 0, 'no usage event for a free (0-cost) call');
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed._cost.actual, 0, '_cost.actual is 0 for the free no-op');
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

// ─── Internal proxy requests (requestContext) ────────────────────────────────

test('withAuth: internal request runs the tool but never checks or reports credits', async () => {
  const { requestContext } = await import('../../src/server/requestContext.js');
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 5 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const handler = withAuth('stealth_mode', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true }) }]
  }));

  const result = await requestContext.run({ internal: true }, () => handler({ url: 'https://example.com' }));

  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.ok, true, 'tool ran normally');
  assert.equal(parsed._cost.actual, 0, 'internal request surfaces zero actual cost');
  assert.equal(parsed._cost.remaining_credits, null, 'static key balance is not surfaced to internal callers');
  assert.equal(auth.checkCalls.length, 0, 'no credit check for internal requests');
  assert.equal(auth.reportCalls.length, 0, 'no usage report for internal requests — the website already billed');
  assert.equal(logger.calls.length, 1, 'still exactly one log line');
  assert.equal(logger.calls[0].context.internal, true);
  assert.equal(logger.calls[0].context.creatorMode, false);
  assert.equal(logger.calls[0].context.creditCost, 0);
});

test('withAuth: internal request error path reports nothing (no half-credit charge)', async () => {
  const { requestContext } = await import('../../src/server/requestContext.js');
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 4 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const handler = withAuth('scrape_with_actions', async () => { throw new Error('browser died'); });

  await assert.rejects(
    () => requestContext.run({ internal: true }, () => handler({})),
    /browser died/
  );

  assert.equal(auth.reportCalls.length, 0, 'no usage report on internal error');
  assert.equal(logger.calls[0].context.outcome, 'error');
  assert.equal(logger.calls[0].context.internal, true);
});

test('withAuth: outside a request context, billing behaves exactly as before', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 2 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const handler = withAuth('fetch_url', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true }) }]
  }));
  await handler({ url: 'https://example.com' });

  assert.equal(auth.checkCalls.length, 1, 'credit check still runs');
  assert.equal(auth.reportCalls.length, 1, 'usage still reported');
  assert.equal(logger.calls[0].context.internal, false, 'internal flag defaults to false');
});

// ── Option B: a pre-flight compliance refusal costs nothing ──────────────────
// robots.txt disallowed the path, or the host is blocklisted. Nothing was
// fetched, so neither the full price nor the half-credit error rate applies.
// The half rate exists for work that ran and then failed.

test('withAuth: a robots refusal is free and emits no usage event', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 5 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const wrapped = withAuth('stealth_mode', async () => {
    // Exactly how the gate + a tool's own catch block behave: the gate stamps
    // the invocation, the handler swallows the error into an isError result.
    markPreflightRefusal('ROBOTS_DISALLOWED');
    return { content: [{ type: 'text', text: '{"error":"robots.txt disallows this path"}' }], isError: true };
  });

  const result = await wrapped({ url: 'https://example.com/private' });

  assert.equal(auth.reportCalls.length, 0, 'a refusal must not report usage at all');
  const cost = JSON.parse(result.content[0].text)._cost;
  assert.equal(cost.actual, 0, 'a refusal must cost 0, not the half rate');
  assert.equal(cost.projected, 5, 'the published price is still surfaced');
});

test('withAuth: a blocklisted host is free too', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 5 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const wrapped = withAuth('scrape', async () => {
    markPreflightRefusal('HOST_BLOCKED');
    return { content: [{ type: 'text', text: '{"error":"host is blocklisted"}' }], isError: true };
  });

  await wrapped({ url: 'https://blocked.example/' });
  assert.equal(auth.reportCalls.length, 0);
});

test('withAuth: a refusal that throws is free, and does not bill the error rate', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 5 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const wrapped = withAuth('scrape_with_actions', async () => {
    markPreflightRefusal('ROBOTS_DISALLOWED');
    const err = new Error('robots.txt disallows this path');
    err.code = 'ROBOTS_DISALLOWED';
    throw err;
  });

  await assert.rejects(() => wrapped({ url: 'https://example.com/private' }), /robots\.txt/);
  assert.equal(auth.reportCalls.length, 0, 'the throw path must not bill a refusal either');
});

test('withAuth: a genuine failure still bills the half-credit error rate', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 5 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  // No refusal stamp: the fetch happened and then something broke.
  const wrapped = withAuth('stealth_mode', async () => ({
    content: [{ type: 'text', text: '{"error":"navigation timeout"}' }], isError: true
  }));

  await wrapped({ url: 'https://example.com/' });
  assert.equal(auth.reportCalls.length, 1, 'a real failure still reports usage');
  assert.equal(auth.reportCalls[0][1], 2, 'and still bills the half rate (floor(5 * 0.5))');
});

test('withAuth: a refusal on one URL does not zero a call that still succeeded', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 5 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  // batch_scrape skipping one disallowed URL and returning results for the rest
  // did real work for the others, so it bills in full.
  const wrapped = withAuth('batch_scrape', async () => {
    markPreflightRefusal('ROBOTS_DISALLOWED');
    return { content: [{ type: 'text', text: '{"results":[{"ok":true}]}' }] };
  });

  await wrapped({ urls: ['https://a.example/', 'https://b.example/private'] });
  assert.equal(auth.reportCalls.length, 1, 'partial work is still billed');
  assert.equal(auth.reportCalls[0][1], 5);
});

test('withAuth: the refusal stamp does not leak between invocations', async () => {
  const logger = makeFakeLogger();
  const auth = makeFakeAuth({ creditsOk: true, toolCost: 5 });
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const refusing = withAuth('scrape', async () => {
    markPreflightRefusal('ROBOTS_DISALLOWED');
    return { content: [{ type: 'text', text: '{"error":"refused"}' }], isError: true };
  });
  const succeeding = withAuth('scrape', async () => ({
    content: [{ type: 'text', text: '{"ok":true}' }]
  }));

  await refusing({ url: 'https://example.com/private' });
  await succeeding({ url: 'https://example.com/' });

  assert.equal(auth.reportCalls.length, 1, 'only the successful call reports usage');
  assert.equal(auth.reportCalls[0][1], 5, 'and it is billed in full, not zeroed by the previous refusal');
});

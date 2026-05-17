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
  return {
    reportCalls,
    isCreatorMode: () => creatorMode,
    getToolCost: () => toolCost,
    checkCredits: async () => creditsOk,
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

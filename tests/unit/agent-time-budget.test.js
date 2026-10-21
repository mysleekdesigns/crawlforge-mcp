/**
 * Regression test: agent runs past its documented wall-clock limit.
 *
 * Run: node --test --test-force-exit tests/unit/agent-time-budget.test.js
 *
 * Defect (R25 sweep, 2026-10-19): one agent run took 183 s against a 120 s
 * limit. deadline() was never checked around the LLM calls, and
 * SamplingClient.complete took no time budget, so each provider's 30 s
 * timeout added up and the MCP sampling fallback had no timeout at all.
 * Fix: complete() takes an optional timeoutMs that bounds every provider call
 * and is raced against the sampling fallback; the orchestrator passes the time
 * left into every LLM call, skips corrective rewrites when time is short, and
 * a run that reaches the limit returns degraded with the evidence so far.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const origFetch = globalThis.fetch;
const ENV_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OLLAMA_DEFAULT_MODEL'];
const savedEnv = {};

// The stubbed providers below hang on promises with no I/O behind them, and
// the budget is an AbortSignal.timeout, whose timer is unref'd. With nothing
// else holding the event loop, Node 22's test runner cancels every test
// ("Promise resolution is still pending but the event loop has already
// resolved"); Node 24's runner keeps the loop alive itself and hid this. In
// production a real socket or the transport holds the loop, so this ref'd
// timer stands in for it.
let keepAlive;

beforeEach(() => {
  keepAlive = setInterval(() => {}, 60_000);
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  delete process.env.ANTHROPIC_API_KEY;
  // Skips the /api/tags model lookup, which has its own 3 s bound.
  process.env.OLLAMA_DEFAULT_MODEL = 'stub-model';
});

afterEach(() => {
  clearInterval(keepAlive);
  globalThis.fetch = origFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** A request that never answers: it ends only when its signal aborts. */
function hangUntilAborted(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

const isLlmUrl = url => /\/api\/generate$|\/v1\/chat\/completions$|\/v1\/messages$/.test(String(url));

test('SamplingClient.complete stops slow providers and a hung sampling fallback at the budget', async () => {
  const { SamplingClient } = await import('../../src/core/SamplingClient.js');
  process.env.OPENAI_API_KEY = 'sk-test';

  const llmCalls = [];
  globalThis.fetch = (url, init) => { llmCalls.push(String(url)); return hangUntilAborted(init.signal); };
  let samplingOptions;
  const client = new SamplingClient({
    mcpServer: { server: { createMessage: (_params, options) => { samplingOptions = options; return new Promise(() => {}); } } }
  });

  const started = Date.now();
  await assert.rejects(client.complete('q', { timeoutMs: 300 }), err => err.code === 'LLM_TIMEOUT');
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 1000, `complete() took ${elapsed} ms against a 300 ms budget`);
  assert.equal(llmCalls.length, 2, 'Ollama and OpenAI were both tried');
  assert.ok(samplingOptions?.signal, 'the sampling request carries the budget signal');
});

test('SamplingClient.complete without a budget keeps the old fallback error', async () => {
  const { SamplingClient } = await import('../../src/core/SamplingClient.js');
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async () => { throw new Error('connection refused'); };

  await assert.rejects(new SamplingClient({}).complete('q'), err => /No LLM available/.test(err.message) && err.code === undefined);
});

/** Pages that match the prompt, LLM endpoints that never answer. */
function stubWeb() {
  globalThis.fetch = async (url, init) => {
    if (isLlmUrl(url)) return hangUntilAborted(init.signal);
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: () => null },
      text: async () => '<html><body><p>The widget release notes list version 4.2.0 of the widget.</p></body></html>'
    };
  };
}

function searchStub() {
  return {
    execute: async () => ({
      results: [
        { link: 'https://widgets.example/notes', title: 'Widget release notes', snippet: 'widget release' },
        { link: 'https://widgets.example/blog', title: 'Widget blog', snippet: 'widget release' }
      ]
    })
  };
}

test('agent with a slow LLM returns degraded at the wall clock with the evidence kept', async () => {
  const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');
  const { SamplingClient } = await import('../../src/core/SamplingClient.js');
  delete process.env.OPENAI_API_KEY;
  stubWeb();

  const o = new AgentOrchestrator({});
  // The real client: Ollama hangs, and the sampling fallback never answers.
  o._samplingClient = new SamplingClient({ mcpServer: { server: { createMessage: () => new Promise(() => {}) } } });
  o._searchTool = searchStub();

  const wallClockMs = 1500;
  const started = Date.now();
  const result = await o.run({ prompt: 'Which widget release is listed in the notes?', maxUrls: 2, wallClockMs });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < wallClockMs + 500, `run took ${elapsed} ms against a ${wallClockMs} ms limit`);
  assert.equal(result.success, true);
  assert.equal(result.degraded, true);
  assert.match(result.reason, /time limit/);
  assert.equal(result.answer, null);
  assert.ok(result.evidence.length >= 1, 'the evidence gathered before the limit is kept');
  assert.ok(result.evidence[0].text.includes('4.2.0'), 'evidence keeps its text for the caller to synthesize');
  assert.ok(result.search_results.length >= 1, 'the sources are kept');
});

test('agent schema path that runs out of time returns the time-limit result with evidence', async () => {
  const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');
  stubWeb();

  const o = new AgentOrchestrator({});
  o._samplingClient = { complete: async () => ({ text: 'widget release notes', provider: 'mock' }) };
  o._searchTool = searchStub();
  o._extractWithLlm = {
    execute: async ({ signal }) => {
      await hangUntilAborted(signal).catch(() => {});
      return { success: false, error: 'LLM call aborted: timeout' };
    }
  };

  const wallClockMs = 800;
  const started = Date.now();
  const result = await o.run({
    prompt: 'Which widget release is listed in the notes?',
    schema: { type: 'object', properties: { version: { type: 'string' } } },
    maxUrls: 2,
    wallClockMs
  });

  assert.ok(Date.now() - started < wallClockMs + 500);
  assert.equal(result.degraded, true);
  assert.match(result.reason, /time limit/);
  assert.ok(result.evidence[0].text.includes('4.2.0'));
});

test('agent skips the corrective rewrite when time is short and flags the answer instead', async () => {
  const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');
  stubWeb();

  const o = new AgentOrchestrator({});
  const budgets = [];
  o._samplingClient = {
    complete: async (_p, options) => {
      budgets.push(options.timeoutMs);
      // PLAN, then an answer stating a version no source shows.
      return { text: budgets.length === 1 ? 'widget release notes' : 'The notes list widget 9.9.9.', provider: 'mock' };
    }
  };
  o._searchTool = searchStub();

  // 10 s is under the rewrite threshold from the start.
  const result = await o.run({ prompt: 'Which widget release is listed in the notes?', maxUrls: 2, wallClockMs: 10_000 });

  assert.equal(budgets.length, 2, 'PLAN and synthesis only: no rewrite call');
  assert.ok(budgets[0] <= 2500, `PLAN gets at most a quarter of the wall clock, got ${budgets[0]}`);
  assert.ok(budgets[1] > 0 && budgets[1] <= 10_000, 'synthesis gets the time left');
  assert.deepEqual(result.provenance.unverified, ['9.9.9']);
  assert.match(result.answer, /Provenance warning: "9\.9\.9"/);
});

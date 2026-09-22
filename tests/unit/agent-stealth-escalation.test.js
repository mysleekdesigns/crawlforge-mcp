/**
 * Stealth review Phase 3 — the agent retries a walled page in the stealth
 * browser automatically, capped, and bills only the retries that got the page.
 *
 * Run: node --test --test-force-exit tests/unit/agent-stealth-escalation.test.js
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AgentOrchestrator } from '../../src/core/AgentOrchestrator.js';
import { AgentTool } from '../../src/tools/agent/agent.js';
import { AGENT_MAX_ESCALATIONS, agentEscalationSurcharge } from '../../src/tools/agent/escalation.js';
import { requestContext, reportedActualCost } from '../../src/server/requestContext.js';
import authManager from '../../src/core/AuthManager.js';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

const PROMPT = 'What is the overall star rating for Burger King reviews?';
const WALL = '<html><head><title>Just a moment...</title></head><body><div id="cf-wrapper">Checking your browser</div><script>window._cf_chl_opt={cType:"managed"}</script></body></html>';
const REAL_TEXT = 'Burger King reviews. Overall rating 3.3 out of 5 stars, based on 58,941 reviews from employees.';

/** Plain fetch: every URL in `walled` answers with a Cloudflare 403; the rest with a real page. */
function mockFetch({ walled = [], status = 403, body = WALL } = {}) {
  globalThis.fetch = async (url) => {
    const isWalled = walled.some(w => String(url).startsWith(w));
    return {
      ok: !isWalled,
      status: isWalled ? status : 200,
      statusText: isWalled ? 'Forbidden' : 'OK',
      url: String(url),
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html' : null) },
      text: async () => (isWalled ? body : `<html><head><title>Real</title></head><body><p>${REAL_TEXT}</p></body></html>`)
    };
  };
}

function orchestrator({ escalateFetch, searchResults = [] } = {}) {
  const o = new AgentOrchestrator({ escalateFetch });
  o._samplingClient = { complete: async () => { throw new Error('no llm in unit tests'); } };
  o._searchTool = { execute: async () => ({ results: searchResults }) };
  return o;
}

function stealthStub(calls) {
  return async ({ url, engine }) => {
    calls.push({ url, engine });
    return { url, title: 'Burger King Reviews', text: REAL_TEXT, html: `<html><body><p>${REAL_TEXT}</p></body></html>`, status: 200, engine: 'camoufox', warnings: [] };
  };
}

test('a walled seed URL is retried in the stealth browser and its evidence is marked via:"stealth", not snippet', async () => {
  const seed = 'https://walled.example/cmp/reviews';
  mockFetch({ walled: [seed] });
  const calls = [];
  const usage = {};
  const result = await orchestrator({ escalateFetch: stealthStub(calls) }).run({ prompt: PROMPT, urls: [seed], maxUrls: 1, usage });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].engine, 'auto', 'the resolver, not the agent, picks the engine');
  assert.equal(usage.escalations, 1);
  assert.equal(result.stealth_retries, 1);
  assert.equal(result.stealth_retries_charged, 1);
  const ev = result.evidence.find(e => e.url === seed);
  assert.ok(ev, 'seed must be in evidence');
  assert.equal(ev.via, 'stealth');
  assert.notEqual(ev.snippet, true);
  assert.match(ev.text, /58,941/);
});

test('a walled DISCOVERED URL with a relevant snippet keeps the snippet fallback and spends no retry', async () => {
  const found = 'https://walled.example/found';
  mockFetch({ walled: [found] });
  const calls = [];
  const usage = {};
  const result = await orchestrator({
    escalateFetch: stealthStub(calls),
    searchResults: [{ link: found, title: 'Found', snippet: 'Burger King reviews overall rating 3.3' }]
  }).run({ prompt: PROMPT, maxUrls: 1, usage });

  assert.equal(calls.length, 0);
  assert.equal(usage.escalations, 0);
  const ev = result.evidence.find(e => e.url === found);
  assert.equal(ev.snippet, true);
});

test('a walled discovered URL with NO relevant snippet is retried', async () => {
  const found = 'https://walled.example/found';
  mockFetch({ walled: [found] });
  const calls = [];
  const result = await orchestrator({
    escalateFetch: stealthStub(calls),
    searchResults: [{ link: found, title: 'Found', snippet: '' }]
  }).run({ prompt: PROMPT, maxUrls: 1 });
  assert.equal(calls.length, 1);
  assert.equal(result.evidence[0].via, 'stealth');
});

test(`retries are capped at ${AGENT_MAX_ESCALATIONS} per run`, async () => {
  const seeds = ['https://a.example/x', 'https://b.example/x', 'https://c.example/x', 'https://d.example/x'];
  mockFetch({ walled: seeds });
  const calls = [];
  const usage = {};
  await orchestrator({ escalateFetch: stealthStub(calls) }).run({ prompt: PROMPT, urls: seeds, maxUrls: 4, maxSteps: 10, usage });
  assert.equal(calls.length, AGENT_MAX_ESCALATIONS);
  assert.equal(usage.escalations, AGENT_MAX_ESCALATIONS);
});

test('a 404 is not a wall: no retry', async () => {
  const seed = 'https://gone.example/x';
  mockFetch({ walled: [seed], status: 404, body: '<html><head><title>Not Found</title></head><body>Not found</body></html>' });
  const calls = [];
  await orchestrator({ escalateFetch: stealthStub(calls) }).run({ prompt: PROMPT, urls: [seed], maxUrls: 1 });
  assert.equal(calls.length, 0);
});

test('a retry is skipped when less than 20s of wall clock remain', async () => {
  const seed = 'https://walled.example/x';
  mockFetch({ walled: [seed] });
  const calls = [];
  await orchestrator({ escalateFetch: stealthStub(calls) }).run({ prompt: PROMPT, urls: [seed], maxUrls: 1, wallClockMs: 10_000 });
  assert.equal(calls.length, 0);
});

test('a stealth retry that throws counts toward the cap, is not charged, and is reported in warnings', async () => {
  const seed = 'https://walled.example/x';
  mockFetch({ walled: [seed] });
  const usage = {};
  const result = await orchestrator({ escalateFetch: async () => { throw new Error('browser crashed'); } })
    .run({ prompt: PROMPT, urls: [seed], maxUrls: 1, usage });
  assert.equal(usage.escalations, 1);
  assert.equal(usage.charged, 0);
  assert.equal(result.stealth_retries_charged, 0);
  assert.ok(result.warnings.some(w => /browser crashed/.test(w)));
});

test('a stealth retry that meets the wall again counts toward the cap but is not charged', async () => {
  const seed = 'https://walled.example/x';
  mockFetch({ walled: [seed] });
  const usage = {};
  const result = await orchestrator({
    escalateFetch: async ({ url }) => ({ url, title: 'Just a moment...', text: 'Checking your browser', html: WALL, status: 403, warnings: [] })
  }).run({ prompt: PROMPT, urls: [seed], maxUrls: 1, usage });
  assert.equal(usage.escalations, 1);
  assert.equal(usage.charged, 0);
  assert.equal(result.stealth_retries, 1);
  assert.equal(result.stealth_retries_charged, 0);
  assert.ok(result.warnings.some(w => /did not get the page either/.test(w)));
});

test('without an injected stealth stage the agent keeps its pre-Phase-3 behaviour', async () => {
  const seed = 'https://walled.example/x';
  mockFetch({ walled: [seed] });
  const usage = {};
  const result = await orchestrator({}).run({ prompt: PROMPT, urls: [seed], maxUrls: 1, usage });
  assert.equal(usage.escalations, 0);
  assert.equal(result.stealth_retries, 0);
});

test('pricing: projection is the ceiling, the reported cost is base + 5 per retry that got the page', async () => {
  const am = authManager;
  assert.equal(am.getToolCost('agent', {}), 8 + 5 * AGENT_MAX_ESCALATIONS);
  assert.equal(am.getToolCost('agent', { maxUrls: 1 }), 13);
  assert.equal(am.getToolCost('agent', { model: 'pro' }), 8);
  assert.equal(agentEscalationSurcharge({ model: 'pro' }), 0);

  const seed = 'https://walled.example/x';
  mockFetch({ walled: [seed] });
  const tool = new AgentTool({ escalateFetch: stealthStub([]) });
  tool._orchestrator._samplingClient = { complete: async () => { throw new Error('no llm'); } };
  tool._orchestrator._searchTool = { execute: async () => ({ results: [] }) };
  const cost = await requestContext.run({}, async () => {
    await tool.execute({ prompt: PROMPT, urls: [seed], maxUrls: 1 });
    return reportedActualCost();
  });
  assert.equal(cost, 13);

  mockFetch({ walled: [] });
  const cleanCost = await requestContext.run({}, async () => {
    await tool.execute({ prompt: PROMPT, urls: ['https://open.example/x'], maxUrls: 1 });
    return reportedActualCost();
  });
  assert.equal(cleanCost, 8, 'a run with no retry costs the base price');

  mockFetch({ walled: [seed] });
  const blockedTool = new AgentTool({ escalateFetch: async ({ url }) => ({ url, title: 'Just a moment...', text: 'Checking your browser', html: WALL, status: 403, warnings: [] }) });
  blockedTool._orchestrator._samplingClient = { complete: async () => { throw new Error('no llm'); } };
  blockedTool._orchestrator._searchTool = { execute: async () => ({ results: [] }) };
  const blockedCost = await requestContext.run({}, async () => {
    await blockedTool.execute({ prompt: PROMPT, urls: [seed], maxUrls: 1 });
    return reportedActualCost();
  });
  assert.equal(blockedCost, 8, 'a retry blocked again is free');
});

/**
 * Regression test for AgentOrchestrator current-state task handling.
 *
 * Run: node --test tests/unit/agent-current-state.test.js
 *
 * Defect (2026-08-26 live sweep): asked "What is the #1 story on Hacker News
 * right now?", the unseeded agent searched, fetched only dated articles ABOUT
 * Hacker News that ranked for the task's words, never fetched the live front
 * page, and reported a January thread as the current #1 (success:true,
 * degraded:false). Fix: deterministic recency-marker detection gates three
 * things — PLAN forces the first search query to the bare entity name, GATHER
 * domain-votes the results and promotes the dominant domain's root (the live
 * front page) into the queue front and priorityUrls (+1000 at SHAPE; the raw
 * top result is NOT trusted — CSE ranked thehackernews.com above
 * news.ycombinator.com for "Hacker News"), and the synthesis prompt orders
 * the model to answer from the first (live) source, never from dated content.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

test('isCurrentStateTask detects recency markers deterministically', async () => {
  const { isCurrentStateTask } = await import('../../src/core/AgentOrchestrator.js');

  // The exact live-sweep repro prompt must trigger.
  assert.equal(isCurrentStateTask(
    'What is the #1 story on Hacker News right now? Report its exact title and points.'
  ), true);
  assert.equal(isCurrentStateTask('What is the price of bitcoin currently?'), true);
  assert.equal(isCurrentStateTask('What is the top post today?'), true);
  assert.equal(isCurrentStateTask('What is the latest version of Next.js?'), true);
  assert.equal(isCurrentStateTask('What is the #1 movie at the box office now?'), true);

  // Non-time-sensitive tasks must NOT trigger.
  assert.equal(isCurrentStateTask('What does the npm package left-pad do?'), false);
  assert.equal(isCurrentStateTask('Explain how HTTP caching works'), false);
  assert.equal(isCurrentStateTask(''), false);
  assert.equal(isCurrentStateTask(undefined), false);
});

test('current-state task: dominant-domain live root leads synthesis and prompts carry the directives', async () => {
  const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');

  const o = new AgentOrchestrator({});

  // Capture every prompt handed to the sampling client; call 1 is PLAN, the
  // synthesis call is the one containing "--- Source:" blocks.
  const seenPrompts = [];
  o._samplingClient = {
    complete: async (p) => {
      seenPrompts.push(p);
      return { text: seenPrompts.length === 1 ? 'Example Hub' : 'mock answer', provider: 'mock' };
    }
  };

  // TOP result is a look-alike wrong site (the 2026-08-26 retest failure:
  // CSE ranked thehackernews.com first for "Hacker News"); the real site's
  // domain dominates the results (front page + an old item page). Decoy
  // pages are stuffed with the task's own words so they win on term overlap.
  const LIVE = 'https://live-hub.example/';
  const WRONG_TOP = 'https://wrong-site.example/';
  const OLD_ITEM = 'https://live-hub.example/item?id=1';
  o._searchTool = {
    execute: async () => ({
      results: [
        { link: WRONG_TOP, title: 'Wrong Site — hub of example items', snippet: 'decoy' },
        { link: LIVE, title: 'Example Hub', snippet: 'live front page' },
        { link: OLD_ITEM, title: 'An old Example Hub item', snippet: 'dated' }
      ]
    })
  };

  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    text: async () => url === LIVE
      ? '<html><body><p>ZWX item one 42 points</p></body></html>'
      : '<html><body><p>the exact title of the item right now report exact title points example</p></body></html>'
  });

  // No seed urls, no domain named in the prompt — domain-vote promotion is
  // the only way the live front page can outrank the decoys.
  const result = await o.run({
    prompt: 'What is the #1 item on Example Hub right now? Report its exact title and points.',
    maxSteps: 5,
    maxUrls: 5
  });

  assert.equal(result.success, true);
  assert.ok(result.evidence.some(e => e.url === LIVE),
    'dominant domain root (live front page) must be fetched into evidence');

  // PLAN must carry the entity-name directive.
  assert.ok(seenPrompts[0].includes('CURRENT live state'),
    'plan prompt must carry the current-state entity-name directive');
  assert.ok(seenPrompts[0].includes('FIRST query must be ONLY the name'),
    'plan prompt must force the first query to the bare entity name');

  // Synthesis must carry the answer-from-live-source rule.
  const synthesis = seenPrompts.find(p => p.includes('--- Source:'));
  assert.ok(synthesis, 'a synthesis prompt with source blocks must be produced');
  assert.ok(synthesis.includes('The task asks about the CURRENT state'),
    'synthesis prompt must carry the current-state rule');
  assert.ok(synthesis.includes('NEVER present older or dated content'),
    'synthesis prompt must forbid presenting dated content as current');

  // The live front page must lead the source blocks despite losing on term
  // overlap AND not being the top-ranked search result.
  const liveIdx = synthesis.indexOf(`--- Source: ${LIVE}`);
  const decoyIdx = Math.min(...[WRONG_TOP, OLD_ITEM].map(u => {
    const i = synthesis.indexOf(`--- Source: ${u}`);
    return i === -1 ? Infinity : i;
  }));
  assert.ok(liveIdx !== -1, 'live front page source block must be present in synthesis input');
  assert.ok(liveIdx < decoyIdx,
    `live front page block (at ${liveIdx}) must precede decoy blocks (first at ${decoyIdx})`);
});

test('non-time-sensitive task: no current-state directives, no priority promotion', async () => {
  const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');

  const o = new AgentOrchestrator({});

  const seenPrompts = [];
  o._samplingClient = {
    complete: async (p) => {
      seenPrompts.push(p);
      return { text: seenPrompts.length === 1 ? 'left-pad npm package' : 'mock answer', provider: 'mock' };
    }
  };

  o._searchTool = {
    execute: async () => ({
      results: [{ link: 'https://pkg.example/left-pad', title: 'left-pad', snippet: 'pads strings' }]
    })
  };

  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    text: async () => '<html><body><p>left-pad is a package that pads strings</p></body></html>'
  });

  const result = await o.run({
    prompt: 'What does the npm package left-pad do?',
    maxSteps: 3,
    maxUrls: 3
  });

  assert.equal(result.success, true);
  assert.ok(!seenPrompts[0].includes('CURRENT live state'),
    'plan prompt must not carry the current-state directive');
  const synthesis = seenPrompts.find(p => p.includes('--- Source:'));
  assert.ok(synthesis, 'a synthesis prompt with source blocks must be produced');
  assert.ok(!synthesis.includes('The task asks about the CURRENT state'),
    'synthesis prompt must not carry the current-state rule');
});

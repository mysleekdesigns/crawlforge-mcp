/**
 * Regression test for AgentOrchestrator SHAPE-stage source ordering.
 *
 * Run: node --test tests/unit/agent-shape-priority.test.js
 *
 * Defect (2026-08-20 round-4 live retest): SHAPE ordered evidence purely by
 * prompt-term overlap, so a generic article that happened to contain the
 * task's words ("title", "story", "current") outranked the site the prompt
 * explicitly named — an NFL article buried the news.ycombinator.com front
 * page and the synthesis LLM answered "the sources do not contain it".
 * Prompt-named sites (and seed URLs) must lead the synthesis input.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

test('SHAPE puts the prompt-named site first even when decoys win on term overlap', async () => {
  const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');

  const o = new AgentOrchestrator({});

  // Capture every prompt handed to the sampling client; the synthesis call is
  // the one containing "--- Source:" blocks.
  const seenPrompts = [];
  o._samplingClient = {
    complete: async (p) => {
      seenPrompts.push(p);
      return { text: 'q1', provider: 'mock' };
    }
  };

  const DECOYS = ['https://decoy-a.example/post', 'https://decoy-b.example/post'];
  o._searchTool = {
    execute: async () => ({
      results: DECOYS.map((u, i) => ({ link: u, title: `Decoy ${i}`, snippet: 'decoy' }))
    })
  };

  // Decoy pages are stuffed with the task's own words (high term overlap);
  // the named site's page shares only one term ("current") with the prompt.
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    text: async () => url.includes('named-site')
      ? '<html><body><p>ZWX current top item one</p></body></html>'
      : '<html><body><p>the exact title of the current story report, story title report</p></body></html>'
  });

  const result = await o.run({
    prompt: 'Go to https://named-site.example and report the exact title of the current #1 story.',
    maxSteps: 5,
    maxUrls: 5
  });

  assert.equal(result.success, true);
  assert.ok(result.evidence.some(e => e.url.startsWith('https://named-site.example')),
    'named site must be fetched into evidence');

  const synthesis = seenPrompts.find(p => p.includes('--- Source:'));
  assert.ok(synthesis, 'a synthesis prompt with source blocks must be produced');

  const namedIdx = synthesis.indexOf('--- Source: https://named-site.example');
  const decoyIdx = Math.min(...DECOYS.map(u => {
    const i = synthesis.indexOf(`--- Source: ${u}`);
    return i === -1 ? Infinity : i;
  }));
  assert.ok(namedIdx !== -1, 'named site source block must be present in synthesis input');
  assert.ok(namedIdx < decoyIdx,
    `named site block (at ${namedIdx}) must precede decoy blocks (first at ${decoyIdx})`);
});

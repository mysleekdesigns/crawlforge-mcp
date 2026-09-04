/**
 * Regression test: AgentOrchestrator PLAN parsing with a fenced or quoted list.
 *
 * Run: node --test tests/unit/agent-plan-fences.test.js
 *
 * R14 (2026-09-03): asked for the current Julia release, the planner's model
 * wrapped its query list in a markdown fence. The fence lines survived the
 * line filter, so two of the run's three searches were for the literal
 * string "```" and returned Stack Exchange threads about backquotes.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

test('fence lines and wrapping quotes never become search queries', async () => {
  const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');
  const o = new AgentOrchestrator({});

  let calls = 0;
  o._samplingClient = {
    complete: async () => {
      calls++;
      return {
        text: calls === 1
          ? '```\n"julialang.org current version"\n`julia stable release`\n```'
          : 'mock answer',
        provider: 'mock'
      };
    }
  };

  const queries = [];
  o._searchTool = {
    execute: async ({ query }) => {
      queries.push(query);
      return { results: [{ link: 'https://example.test/', title: 'Example', snippet: 'julia' }] };
    }
  };
  globalThis.fetch = async (url) => ({
    ok: true, status: 200, url, headers: { get: () => null },
    text: async () => '<html><body><p>julia version 1.12.7</p></body></html>'
  });

  await o.run({ prompt: 'What is the latest julia version?', maxSteps: 2, maxUrls: 3 });

  assert.ok(queries.length > 0, 'the planner must produce at least one query');
  for (const q of queries) {
    assert.ok(!/`/.test(q), `query must carry no backticks: ${JSON.stringify(q)}`);
    assert.ok(!/^["']|["']$/.test(q), `query must carry no wrapping quotes: ${JSON.stringify(q)}`);
    assert.match(q, /[\p{L}\p{N}]/u, 'a query must contain a letter or digit');
  }
  assert.deepEqual(queries, ['julialang.org current version', 'julia stable release']);
});

/**
 * Regression tests for the R24 live sweep's `agent` findings (2026-10-03,
 * LIVE_TEST_R24_FIX_PLAN.md item 1.10): wrong answers returned unflagged.
 *
 * Run: node --test --test-force-exit tests/unit/agent-r24-regressions.test.js
 *
 *   1. "latest stable version of the TypeScript npm package" was searched as
 *      the single word "npm": the current-state planner is told to reduce its
 *      first query to a bare name and kept the wrong one.
 *   2. A question about "this page" with a seed URL ran a web search anyway
 *      and merged unrelated Reddit snippets into the evidence.
 *   3. A schema with `required` fields came back with one null as
 *      structured:true, degraded:false.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

const page = (body) => async (url) => ({
  ok: true, status: 200, url, headers: { get: () => null },
  text: async () => `<html><head><title>t</title></head><body><p>${body}</p></body></html>`
});

/** An orchestrator whose planner answers `plan`, with every search recorded. */
async function orchestrator(plan) {
  const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');
  const o = new AgentOrchestrator({});
  let calls = 0;
  o._samplingClient = {
    complete: async () => ({ text: ++calls === 1 ? plan : 'mock answer', provider: 'mock' })
  };
  const queries = [];
  o._searchTool = {
    execute: async ({ query }) => {
      queries.push(query);
      return { results: [{ link: 'https://found.example/', title: 'Found', snippet: 'an unrelated typescript books thread' }] };
    }
  };
  return { o, queries };
}

test('namedTerms keeps the names a prompt uses and skips sentence-opening capitals', async () => {
  const { namedTerms } = await import('../../src/core/AgentOrchestrator.js');
  assert.deepEqual(namedTerms('What is the latest stable version of the TypeScript npm package?'), ['TypeScript']);
  assert.deepEqual(namedTerms('What is the #1 story on Hacker News right now? Report its title.'), ['Hacker', 'News']);
  assert.deepEqual(namedTerms("TypeScript's latest release? See https://Example.com/A"), ['TypeScript']);
  assert.deepEqual(namedTerms('what is the latest julia version'), []);
  assert.deepEqual(namedTerms(undefined), []);
});

test('current-state plan: a first query that dropped the named entity gets it back, qualifier kept', async () => {
  const { o, queries } = await orchestrator('npm');
  globalThis.fetch = page('typescript package version 7.0.2');

  await o.run({ prompt: 'What is the latest stable version of the TypeScript npm package?', maxSteps: 1, maxUrls: 2 });

  assert.equal(queries[0], 'TypeScript npm');
});

test('current-state plan: a first query that already names the entity is left alone', async () => {
  const { o, queries } = await orchestrator('typescript npm\ntypescript latest release');
  globalThis.fetch = page('typescript package version 7.0.2');

  await o.run({ prompt: 'What is the latest stable version of the TypeScript npm package?', maxSteps: 1, maxUrls: 2 });

  assert.deepEqual(queries, ['typescript npm', 'typescript latest release']);
});

test('isSeedScopedTask needs both seed URLs and a prompt that points at them', async () => {
  const { isSeedScopedTask } = await import('../../src/core/AgentOrchestrator.js');
  const seeds = ['https://books.example/'];
  assert.equal(isSeedScopedTask('How many books are listed in total on this page?', seeds), true);
  assert.equal(isSeedScopedTask('Summarise these URLs', seeds), true);
  assert.equal(isSeedScopedTask('What does the given website sell?', seeds), true);
  // Seeds are "URLs to include": without a reference to them the search still runs.
  assert.equal(isSeedScopedTask('What are the best book shops online?', seeds), false);
  // No seeds: "this page" points at nothing the agent was given.
  assert.equal(isSeedScopedTask('How many books are on this page?', []), false);
  assert.equal(isSeedScopedTask('How many books are on this page?', undefined), false);
});

test('a question scoped to the seed URLs runs no web search', async () => {
  const { o, queries } = await orchestrator('count books on webpage\nwebpage book count');
  const fetched = [];
  globalThis.fetch = async (url) => { fetched.push(String(url)); return page('1000 results, showing 1 to 20 books')(url); };

  const SEED = 'https://books.example/';
  const result = await o.run({ prompt: 'How many books are listed in total on this page?', urls: [SEED] });

  assert.deepEqual(queries, [], 'no search may run for a seed-scoped question');
  assert.deepEqual(result.search_results, []);
  assert.deepEqual(result.evidence, [{ url: SEED }]);
  assert.ok(fetched.every(u => !u.includes('found.example')), 'only the seed is fetched');
});

test('seed URLs without a scoped prompt still search', async () => {
  const { o, queries } = await orchestrator('best online book shops');
  globalThis.fetch = page('book shops online');

  await o.run({ prompt: 'What are the best book shops online?', urls: ['https://books.example/'], maxSteps: 2 });

  assert.deepEqual(queries, ['best online book shops']);
});

const SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, author: { type: 'string' }, upc: { type: 'string' } },
  required: ['title', 'author', 'upc']
};

async function runSchema(data, schema = SCHEMA) {
  const { o } = await orchestrator('unused');
  o._extractWithLlm = { execute: async () => ({ success: true, data }) };
  globalThis.fetch = page('A Light in the Attic, UPC a897fe39b1053632, this page of books');
  return o.run({ prompt: 'Report the title, author and UPC of the book on this page.', urls: ['https://books.example/b'], schema });
}

test('schema run: a required field left null sets degraded:true with a warning', async () => {
  const result = await runSchema({ title: 'A Light in the Attic', author: null, upc: 'a897fe39b1053632' });

  assert.equal(result.success, true);
  assert.equal(result.structured, true);
  assert.equal(result.degraded, true);
  assert.match(result.reason, /Required field "author" is null/);
  assert.deepEqual(result.warnings, [result.reason]);
  // The fields that were found are still returned.
  assert.equal(result.answer.title, 'A Light in the Attic');
});

test('schema run: a missing or empty required field counts as null', async () => {
  const result = await runSchema({ title: '', upc: 'a897fe39b1053632' });

  assert.equal(result.degraded, true);
  assert.match(result.reason, /Required fields "title", "author" are null/);
});

test('schema run: all required fields present, or a null optional field, is not degraded', async () => {
  const full = await runSchema({ title: 'A Light in the Attic', author: 'S', upc: 'a897fe39b1053632' });
  assert.equal(full.degraded, false);
  assert.equal(full.reason, undefined);
  assert.equal(full.warnings, undefined);

  const optional = await runSchema(
    { title: 'A Light in the Attic', author: null, upc: 'a897fe39b1053632' },
    { ...SCHEMA, required: ['title', 'upc'] }
  );
  assert.equal(optional.degraded, false);
});

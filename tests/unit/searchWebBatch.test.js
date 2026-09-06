/**
 * Unit tests for search_web's batch form — `queries` (Phase 5, 5.1).
 *
 * Run: node --test tests/unit/searchWebBatch.test.js
 *
 * Contract under test:
 *  - `queries` takes 1..10 strings; 0 and 11 are rejected by the schema
 *  - exactly one of `query` / `queries`; both or neither is an error
 *  - each query runs through the SAME execute() pipeline, and a single-query
 *    call's response is unchanged by the batch code existing
 *  - one failed query does not sink the others
 *  - the price is 5 per query, read defensively from the raw param
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SEARCH_QUERIES,
  SEARCH_QUERIES_PARAM,
  EXACTLY_ONE_QUERY_MESSAGE,
  searchQueryCount
} from '../../src/tools/search/batchSearch.js';
import { SearchWebTool } from '../../src/tools/search/searchWeb.js';
import { makeWithAuth } from '../../src/server/withAuth.js';
import { markPreflightRefusal } from '../../src/server/requestContext.js';
import AuthManager from '../../src/core/AuthManager.js';

// A tool whose single-query pipeline is replaced by a recorder, so the batch
// wrapper is tested for what it does (fan out, key, isolate failures) and not
// for what the search backend returns. Constructor skipped: it builds a
// LocalizationManager that holds the event loop open.
function makeRecordingTool({ fail = () => false } = {}) {
  const tool = Object.create(SearchWebTool.prototype);
  const seen = [];
  const single = SearchWebTool.prototype.execute;
  tool.execute = async function (params) {
    // Route through the real execute() so the batch/single split under test is
    // the real one; only the pipeline below it is stubbed.
    if (params?.queries !== undefined) return single.call(this, params);
    if (params?.query === undefined) return single.call(this, params);
    seen.push(params);
    if (fail(params.query)) throw new Error(`Search failed: backend refused "${params.query}"`);
    return { query: params.query, results: [{ title: params.query, link: 'https://example.com' }], limit: params.limit ?? 10 };
  };
  tool.seen = seen;
  return tool;
}

test('SEARCH_QUERIES_PARAM accepts 1 and 10 queries and rejects 0 and 11', () => {
  const schema = SEARCH_QUERIES_PARAM.queries;
  assert.deepEqual(schema.parse(['one']), ['one']);
  const ten = Array.from({ length: MAX_SEARCH_QUERIES }, (_, i) => `q${i}`);
  assert.deepEqual(schema.parse(ten), ten);
  assert.equal(schema.parse(undefined), undefined);

  assert.throws(() => schema.parse([]), /at least 1|Array must contain at least 1/);
  assert.throws(() => schema.parse([...ten, 'eleven']), /at most 10|Array must contain at most 10/);
  assert.throws(() => schema.parse(['']), /at least 1 character|String must contain at least 1/);
});

test('searchQueryCount prices defensively: getToolCost runs before validation', () => {
  assert.equal(searchQueryCount(undefined), 1);
  assert.equal(searchQueryCount('not an array'), 1);
  assert.equal(searchQueryCount([]), 1);
  assert.equal(searchQueryCount(['a']), 1);
  assert.equal(searchQueryCount(['a', 'b', 'c']), 3);
  // A caller who sends more than the schema allows never produces a silly
  // projection — the schema rejects that call before it is billed at all.
  assert.equal(searchQueryCount(new Array(500).fill('q')), MAX_SEARCH_QUERIES);
});

test('getToolCost: 5 per query, 5 for the single-query form', () => {
  assert.equal(AuthManager.getToolCost('search_web', { query: 'one' }), 5);
  assert.equal(AuthManager.getToolCost('search_web', { queries: ['a'] }), 5);
  assert.equal(AuthManager.getToolCost('search_web', { queries: ['a', 'b'] }), 10);
  assert.equal(AuthManager.getToolCost('search_web', { queries: new Array(10).fill('q') }), 50);
  assert.equal(AuthManager.getToolCost('search_web', { queries: 'garbage' }), 5);
});

test('a single-query call is untouched by the batch path', async () => {
  const tool = makeRecordingTool();
  const result = await tool.execute({ query: 'mcp servers', limit: 3 });
  assert.deepEqual(result, {
    query: 'mcp servers',
    results: [{ title: 'mcp servers', link: 'https://example.com' }],
    limit: 3
  });
  // No batch keys leaked into the single-query shape.
  assert.equal('results_by_query' in result, false);
  assert.equal('queries' in result, false);
  assert.deepEqual(tool.seen.map((p) => p.query), ['mcp servers']);
});

test('queries fans out through the same pipeline and comes back keyed per query', async () => {
  const tool = makeRecordingTool();
  const result = await tool.execute({ queries: ['alpha', 'beta', 'gamma'], limit: 4 });

  assert.deepEqual(result.queries, ['alpha', 'beta', 'gamma']);
  assert.equal(result.count, 3);
  assert.equal(result.results_by_query.length, 3);
  assert.deepEqual(result.results_by_query.map((e) => e.query), ['alpha', 'beta', 'gamma']);

  // Each entry carries what a single call returns, plus its query.
  assert.deepEqual(result.results_by_query[0], {
    query: 'alpha',
    results: [{ title: 'alpha', link: 'https://example.com' }],
    limit: 4
  });

  // Every other parameter reached every query.
  assert.deepEqual(tool.seen.map((p) => p.query), ['alpha', 'beta', 'gamma']);
  assert.ok(tool.seen.every((p) => p.limit === 4));
  // `queries` never recurses into the per-query call.
  assert.ok(tool.seen.every((p) => p.queries === undefined));
});

test('one failed query does not sink the rest', async () => {
  const tool = makeRecordingTool({ fail: (q) => q === 'bad' });
  const result = await tool.execute({ queries: ['good', 'bad', 'also good'] });

  assert.equal(result.count, 3);
  assert.equal(result.results_by_query[0].error, undefined);
  assert.match(result.results_by_query[1].error, /backend refused "bad"/);
  assert.equal(result.results_by_query[1].results, undefined);
  assert.equal(result.results_by_query[2].results.length, 1);
});

test('exactly one of query / queries', async () => {
  const tool = makeRecordingTool();
  await assert.rejects(() => tool.execute({ query: 'a', queries: ['b'] }), new RegExp(EXACTLY_ONE_QUERY_MESSAGE.slice(0, 40)));
  await assert.rejects(() => tool.execute({ limit: 5 }), new RegExp(EXACTLY_ONE_QUERY_MESSAGE.slice(0, 40)));
  // An explicitly-undefined query alongside queries is the shape server.js
  // sends (it destructures both), and must take the batch path.
  const result = await tool.execute({ query: undefined, queries: ['only'] });
  assert.equal(result.count, 1);
});

test('queries validation is enforced inside the tool too, not only at the wire', async () => {
  const tool = makeRecordingTool();
  await assert.rejects(() => tool.execute({ queries: [] }));
  await assert.rejects(() => tool.execute({ queries: new Array(11).fill('q') }));
  assert.equal(tool.seen.length, 0, 'a rejected batch never reaches the pipeline');
});

test('a query that never reached a backend is not billed for one (G4)', async () => {
  const auth = {
    reportCalls: [],
    isCreatorMode: () => false,
    getToolCost: () => 15, // three queries
    checkCredits: async () => true,
    projectCost: () => ({ projected: 15, note: 'test' }),
    reportUsage: async (...args) => { auth.reportCalls.push(args); }
  };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const withAuth = makeWithAuth({ authManager: auth, logger });
  const tool = makeRecordingTool({ fail: (q) => q !== 'good' });

  const handler = withAuth('search_web', async (params) => ({
    content: [{ type: 'text', text: JSON.stringify(await tool.execute(params)) }]
  }));

  const parsed = JSON.parse((await handler({ queries: ['good', 'bad', 'worse'] })).content[0].text);
  assert.equal(parsed._cost.projected, 15);
  assert.equal(parsed._cost.actual, 5, 'only the query that ran is billed');
  assert.equal(auth.reportCalls[0][1], 5);

  // And a batch where nothing ran at all costs nothing and reports no usage.
  const allFail = makeRecordingTool({ fail: () => true });
  const auth2 = { ...auth, reportCalls: [], reportUsage: async (...a) => { auth2.reportCalls.push(a); } };
  const handler2 = makeWithAuth({ authManager: auth2, logger })('search_web', async (params) => ({
    content: [{ type: 'text', text: JSON.stringify(await allFail.execute(params)) }]
  }));
  const none = JSON.parse((await handler2({ queries: ['a', 'b', 'c'] })).content[0].text);
  assert.equal(none._cost.actual, 0);
  assert.equal(auth2.reportCalls.length, 0);
});

test('a call with neither query nor queries costs nothing (G4)', async () => {
  // `query` stopped being a required field when `queries` arrived, so the SDK
  // no longer rejects this call at -32602 with no charge — it reaches the
  // handler. Without the BAD_REQUEST refusal it would be billed the
  // half-credit error rate for a search that never ran.
  const auth = {
    reportCalls: [],
    isCreatorMode: () => false,
    getToolCost: () => 5,
    checkCredits: async () => true,
    projectCost: () => ({ projected: 5, note: 'test' }),
    reportUsage: async (...args) => { auth.reportCalls.push(args); }
  };
  const withAuth = makeWithAuth({ authManager: auth, logger: { info() {}, warn() {}, error() {}, debug() {} } });

  // The shape server.js's handler has: refuse before anything is fetched.
  const handler = withAuth('search_web', async ({ query, queries }) => {
    if (!query && !queries) {
      markPreflightRefusal('BAD_REQUEST');
      return { content: [{ type: 'text', text: EXACTLY_ONE_QUERY_MESSAGE }], isError: true };
    }
    return { content: [{ type: 'text', text: '{}' }] };
  });

  const result = await handler({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /exactly one of/);
  assert.equal(auth.reportCalls.length, 0, 'a refused call reports no usage at all');
});

test('the batch wrapper sits above the provider short-circuit, so searxng inherits it', async () => {
  // provider:"searxng" short-circuits inside execute(); the batch wrapper runs
  // first, so each query reaches that branch on its own.
  const tool = makeRecordingTool();
  const result = await tool.execute({ queries: ['a', 'b'], provider: 'searxng' });
  assert.equal(result.count, 2);
  assert.ok(tool.seen.every((p) => p.provider === 'searxng'));
});

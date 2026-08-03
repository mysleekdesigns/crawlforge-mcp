/**
 * Unit tests: ResultRanker (real module, no mocks)
 * Run: node --test tests/unit/tools/search/resultRanker.test.js
 *
 * Regression coverage for two Phase 2 fixes in
 * src/tools/search/ranking/ResultRanker.js:
 *
 * R1 rankResults() deep-merges caller-supplied `weights`/`bm25`/`authority`/
 *    `freshness` sub-objects into the defaults instead of replacing them
 *    wholesale. Before the fix, a partial override like {weights:{bm25:0.7}}
 *    wiped out semantic/authority/freshness (leaving them `undefined`), and
 *    computeFinalScore() then produced NaN for every result.
 * R2 computeBM25Score() returns 0 (not NaN) when the query tokenizes to zero
 *    terms (e.g. "C#" -> tokenize() drops single-char tokens -> []), which
 *    previously divided `score / queryTerms.length` as 0/0.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ResultRanker } from '../../../../src/tools/search/ranking/ResultRanker.js';

const sampleResults = () => [
  {
    title: 'Node.js Streams Guide',
    link: 'https://example.com/node-streams',
    snippet: 'A complete guide to node js streams and how they work'
  },
  {
    title: 'Python Basics Tutorial',
    link: 'https://example.org/python-basics',
    snippet: 'Learn python basics with this tutorial'
  },
  {
    title: 'Untitled',
    link: 'not a valid url at all',
    snippet: ''
  }
];

describe('ResultRanker — partial weights deep-merge (R1)', () => {
  test('rankResults with a partial weights override returns finite finalScore for every result', async () => {
    const ranker = new ResultRanker({ cacheEnabled: false });
    const ranked = await ranker.rankResults(sampleResults(), 'node guide', { weights: { bm25: 0.7 } });

    assert.equal(ranked.length, 3);
    for (const result of ranked) {
      assert.ok(Number.isFinite(result.finalScore), `finalScore must be finite, got ${result.finalScore}`);
    }
  });

  test('the merged weights (not just the override) are reported in rankingDetails', async () => {
    const ranker = new ResultRanker({ cacheEnabled: false });
    const ranked = await ranker.rankResults(sampleResults(), 'node guide', { weights: { bm25: 0.7 } });

    const { weights } = ranked[0].rankingDetails;
    assert.equal(weights.bm25, 0.7, 'the overridden weight must be applied');
    // Defaults must survive the merge instead of becoming undefined.
    assert.equal(weights.semantic, 0.3);
    assert.equal(weights.authority, 0.2);
    assert.equal(weights.freshness, 0.1);
  });

  test('partial bm25/authority/freshness sub-option overrides also merge with defaults', async () => {
    const ranker = new ResultRanker({ cacheEnabled: false });
    const ranked = await ranker.rankResults(sampleResults(), 'node guide', {
      bm25: { k1: 2.0 },
      authority: { httpsBoost: 0.5 },
      freshness: { decayRate: 0.2 }
    });

    for (const result of ranked) {
      assert.ok(Number.isFinite(result.finalScore));
    }
  });

  test('no options — default full weights still produce finite, sorted scores', async () => {
    const ranker = new ResultRanker({ cacheEnabled: false });
    const ranked = await ranker.rankResults(sampleResults(), 'node streams guide', {});

    for (const result of ranked) {
      assert.ok(Number.isFinite(result.finalScore));
    }
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i - 1].finalScore >= ranked[i].finalScore, 'results must be sorted descending by finalScore');
    }
  });
});

describe('ResultRanker — BM25 all-short-token query guard (R2)', () => {
  test('computeBM25Score returns 0 (not NaN) for a query that tokenizes to zero terms', () => {
    const ranker = new ResultRanker({ cacheEnabled: false });
    const results = sampleResults();
    const score = ranker.computeBM25Score(results[0], 'C#', results, ranker.options.bm25);
    assert.equal(score, 0);
    assert.ok(!Number.isNaN(score));
  });

  test('a poisoned BM25 score does not propagate NaN through rankResults', async () => {
    const ranker = new ResultRanker({ cacheEnabled: false });
    const ranked = await ranker.rankResults(sampleResults(), 'C#', {});
    for (const result of ranked) {
      assert.ok(Number.isFinite(result.finalScore), `finalScore must be finite for query "C#", got ${result.finalScore}`);
      assert.equal(result.scores.bm25, 0);
    }
  });
});

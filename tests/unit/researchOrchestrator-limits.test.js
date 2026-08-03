/**
 * Regression tests: ResearchOrchestrator per-query search paging + research
 * session state shape.
 *
 * Run: node --test --test-force-exit tests/unit/researchOrchestrator-limits.test.js
 * (force-exit: gatherInitialSources runs inside processWithTimeLimit(), which
 *  leaves an uncleared setTimeout for the research time limit — same reason
 *  tests/unit/researchSearchKey.test.js needs it.)
 *
 * Bug: SearchWebSchema caps `limit` at 100 per call. gatherInitialSources()
 * used to request `Math.ceil(this.maxUrls / queries.length)` in a single
 * searchTool.execute() call — with maxUrls=1000 and few queries this exceeded
 * 100 and every internal search threw a zod 'too_big' validation error.
 * The fix (searchWithPaging) fans a query out across multiple paged calls,
 * each capped at <=100.
 *
 * Also covers: initializeResearchSession()'s researchState now includes
 * llmAnalysis/semanticSimilarities/relevanceScores Maps and a
 * synthesisHistory array (previously absent, so downstream code reading them
 * saw undefined).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ResearchOrchestrator } from '../../src/core/ResearchOrchestrator.js';

describe('gatherInitialSources — per-query limit is clamped to <=100', () => {
  test('maxUrls=1000 with 2 queries never requests a limit >100 from SearchWebTool', async () => {
    const ro = new ResearchOrchestrator({ maxUrls: 1000, searchConfig: { apiKey: 'test-key' } });
    const capturedLimits = [];
    ro.searchTool.execute = async ({ query, limit }) => {
      capturedLimits.push(limit);
      return {
        results: [{ title: `Result for ${query}`, link: `https://example.com/${encodeURIComponent(query)}`, snippet: 'snippet text here' }]
      };
    };

    const sources = await ro.gatherInitialSources(['query one', 'query two'], {});

    assert.ok(capturedLimits.length >= 2, 'both queries should have issued at least one search call');
    for (const limit of capturedLimits) {
      assert.ok(limit <= 100, `limit ${limit} must not exceed SearchWebSchema's cap of 100`);
    }
    assert.equal(sources.length, 2);
  });

  test('a single query desiring >100 sources pages across multiple calls instead of one oversized request', async () => {
    const ro = new ResearchOrchestrator({ maxUrls: 300, searchConfig: { apiKey: 'test-key' } });
    const capturedLimits = [];
    let callCount = 0;
    ro.searchTool.execute = async ({ limit }) => {
      capturedLimits.push(limit);
      callCount++;
      // First page is full (forces another page); second page is short
      // (signals exhaustion so searchWithPaging stops).
      const count = callCount === 1 ? 100 : 20;
      return {
        results: Array.from({ length: count }, (_, i) => ({
          title: `r${callCount}-${i}`,
          link: `https://example.com/${callCount}/${i}`,
          snippet: 'snippet text'
        }))
      };
    };

    await ro.gatherInitialSources(['solo query'], {});

    assert.ok(capturedLimits.length >= 2, 'a query desiring >100 sources must page across multiple search calls');
    for (const limit of capturedLimits) {
      assert.ok(limit <= 100);
    }
  });
});

describe('research session state shape', () => {
  test('constructor initializes researchState with llmAnalysis/semanticSimilarities/relevanceScores Maps and a synthesisHistory array', () => {
    const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
    assert.ok(ro.researchState.llmAnalysis instanceof Map);
    assert.ok(ro.researchState.semanticSimilarities instanceof Map);
    assert.ok(ro.researchState.relevanceScores instanceof Map);
    assert.ok(Array.isArray(ro.researchState.synthesisHistory));
  });

  test('initializeResearchSession() resets to the same shape, discarding stale entries', () => {
    const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
    ro.researchState.llmAnalysis.set('stale-key', true);
    ro.researchState.synthesisHistory.push('stale-entry');

    ro.initializeResearchSession('session-1', 'topic', Date.now());

    assert.ok(ro.researchState.llmAnalysis instanceof Map);
    assert.equal(ro.researchState.llmAnalysis.size, 0, 'fresh session must not carry over stale Map entries');
    assert.ok(ro.researchState.semanticSimilarities instanceof Map);
    assert.ok(ro.researchState.relevanceScores instanceof Map);
    assert.ok(Array.isArray(ro.researchState.synthesisHistory));
    assert.equal(ro.researchState.synthesisHistory.length, 0, 'fresh session must not carry over stale array entries');
  });
});

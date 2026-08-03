/**
 * D5.2 — Unit tests: deepResearch tool
 * Run: node --test tests/unit/tools/research/deepResearch.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DeepResearchTool } from '../../../../src/tools/research/deepResearch.js';

// ---------------------------------------------------------------------------
// Stub ResearchOrchestrator
// ---------------------------------------------------------------------------

const stubResearchResult = {
  sessionId: 'session-abc123',
  topic: 'CrawlForge MCP',
  status: 'completed',
  report: {
    executive_summary: 'CrawlForge provides 23 MCP tools for web scraping.',
    key_findings: ['Finding 1', 'Finding 2'],
    sources: [{ url: 'https://example.com', title: 'Example', credibility: 0.9 }],
    conflicts: [],
    synthesis: 'Comprehensive scraping solution.'
  },
  raw_evidence: [],
  timing: { start: Date.now() - 5000, end: Date.now(), duration: 5000 },
  _cost: { projected: 10, actual: 8, remaining_credits: 92 }
};

class ResearchOrchestratorStub {
  constructor(options = {}) { this.options = options; }
  async conductResearch(params) {
    if (!params.topic) throw new Error('topic is required');
    if (params.topic.length < 3) throw new Error('topic too short');
    return { ...stubResearchResult, topic: params.topic };
  }
  async cleanup() {}
}

class ElicitationHelperStub {
  async elicit(prompt, options) { return { confirmed: true }; }
}

// ---------------------------------------------------------------------------
// Minimal DeepResearch-like stub
// ---------------------------------------------------------------------------

class DeepResearchStub {
  constructor({ orchestrator, elicitation } = {}) {
    this.orchestrator = orchestrator || new ResearchOrchestratorStub();
    this._elicitation = elicitation || new ElicitationHelperStub();
    this.activeSessions = new Map();
  }

  async execute(params) {
    if (!params || !params.topic) throw new Error('topic is required');
    if (typeof params.topic !== 'string' || params.topic.length < 3) throw new Error('topic must be at least 3 characters');

    // D1.4: Elicitation when projected cost > 50 credits (stub: elicit for maxUrls > 100)
    if (params.maxUrls && params.maxUrls > 100) {
      const response = await this._elicitation.elicit('Research will fetch many URLs. Continue?', {});
      if (!response.confirmed) return { status: 'cancelled', reason: 'user_declined' };
    }

    const result = await this.orchestrator.conductResearch({
      topic: params.topic,
      maxDepth: params.maxDepth || 5,
      maxUrls: params.maxUrls || 50,
      timeLimit: params.timeLimit || 120000
    });

    this.activeSessions.set(result.sessionId, result);
    return result;
  }

  async destroy() {
    await this.orchestrator.cleanup();
    this.activeSessions.clear();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deepResearch tool', () => {
  let tool;

  beforeEach(() => {
    tool = new DeepResearchStub();
  });

  test('constructor stores orchestrator and active sessions map', () => {
    assert.ok(tool.orchestrator instanceof ResearchOrchestratorStub);
    assert.ok(tool.activeSessions instanceof Map);
  });

  test('happy path — returns research result with report', async () => {
    const result = await tool.execute({ topic: 'CrawlForge MCP' });
    assert.equal(result.status, 'completed');
    assert.equal(result.topic, 'CrawlForge MCP');
    assert.ok(result.report.executive_summary);
    assert.ok(Array.isArray(result.report.sources));
    assert.ok(result._cost);
  });

  test('session stored in activeSessions after research', async () => {
    const result = await tool.execute({ topic: 'CrawlForge MCP' });
    assert.ok(tool.activeSessions.has(result.sessionId));
  });

  test('missing topic param throws', async () => {
    await assert.rejects(() => tool.execute({}), /topic is required/);
  });

  test('topic too short throws', async () => {
    await assert.rejects(() => tool.execute({ topic: 'ab' }), /at least 3/);
  });

  test('elicitation fires when maxUrls > 100', async () => {
    let elicitCalled = false;
    const elicit = { elicit: async () => { elicitCalled = true; return { confirmed: true }; } };
    const eTool = new DeepResearchStub({ elicitation: elicit });
    await eTool.execute({ topic: 'Test topic', maxUrls: 200 });
    assert.ok(elicitCalled, 'elicitation should be triggered for large maxUrls');
  });

  test('research cancelled when user declines elicitation', async () => {
    const declineElicit = { elicit: async () => ({ confirmed: false }) };
    const eTool = new DeepResearchStub({ elicitation: declineElicit });
    const result = await eTool.execute({ topic: 'Test topic', maxUrls: 200 });
    assert.equal(result.status, 'cancelled');
  });

  test('destroy clears active sessions', async () => {
    await tool.execute({ topic: 'CrawlForge MCP' });
    assert.ok(tool.activeSessions.size > 0);
    await tool.destroy();
    assert.equal(tool.activeSessions.size, 0);
  });

  test('orchestrator error propagates', async () => {
    const errOrch = { conductResearch: async () => { throw new Error('research engine down'); }, cleanup: async () => {} };
    const errTool = new DeepResearchStub({ orchestrator: errOrch });
    await assert.rejects(() => errTool.execute({ topic: 'Valid topic' }), /research engine down/);
  });
});

// ---------------------------------------------------------------------------
// Regression: formatResults must always surface a top-level `sources` list.
// Previously, in LLM-synthesis mode only `citations_only` returned `sources`;
// `comprehensive`/`summary` exposed it under other keys and `conflicts_focus`
// dropped it entirely. The raw_evidence branch always returned `sources`.
// ---------------------------------------------------------------------------

describe('deepResearch formatResults — source list parity (regression)', () => {
  const realTool = new DeepResearchTool();

  const llmResults = {
    researchSummary: {},
    metadata: {},
    findings: [{ finding: 'f', credibility: 0.8, sources: ['https://a.example/1'] }],
    supportingEvidence: [
      { title: 'A', url: 'https://a.example/1', credibility: 0.8 },
      { title: 'B', url: 'https://b.example/2', credibility: 0.6 }
    ],
    consensus: [],
    conflicts: [{ type: 'contradiction', severity: 0.8 }],
    researchGaps: [],
    recommendations: [{ type: 'validation', description: 'validate' }],
    credibilityAssessment: { averageCredibility: 0.7, highCredibilitySources: 1 },
    performance: {},
    activityLog: []
  };

  for (const outputFormat of ['comprehensive', 'summary', 'citations_only', 'conflicts_focus']) {
    test(`LLM mode returns top-level sources[] for outputFormat=${outputFormat}`, () => {
      const out = realTool.formatResults(llmResults, { outputFormat });
      assert.ok(Array.isArray(out.sources), `expected sources[] in ${outputFormat}`);
      assert.equal(out.sources.length, 2);
      assert.equal(out.sources[0].url, 'https://a.example/1');
    });
  }

  test('raw_evidence mode still returns sources[]', () => {
    const rawResults = {
      synthesisMode: 'raw_evidence',
      sources: [{ title: 'A', url: 'https://a.example/1', credibility: 0.8 }],
      findings: [],
      researchSummary: {}, metadata: {}, performance: {}, activityLog: []
    };
    const out = realTool.formatResults(rawResults, { outputFormat: 'comprehensive' });
    assert.ok(Array.isArray(out.sources));
    assert.equal(out.sources.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Regression: buildOrchestratorConfig() config contract — the keys
// SearchWebTool's constructor and ResearchOrchestrator actually read.
//
// Bug 1: academic/current_events set rankingWeights and comparative set
// deduplicationThresholds — back-compat-only keys that SearchWebTool's
// constructor never reads (it reads searchConfig.rankingOptions.weights /
// deduplicationOptions.thresholds). The approach-specific tuning never
// actually reached ranking/deduplication.
// Bug 2: enableSourceVerification/enableConflictDetection (params the tool's
// own schema advertises) and cacheResults were dropped before reaching the
// orchestrator config for every approach.
// ---------------------------------------------------------------------------

describe('deepResearch buildOrchestratorConfig — searchConfig.rankingOptions/deduplicationOptions + flag propagation (regression)', () => {
  const configTool = new DeepResearchTool();
  const baseParams = { maxDepth: 5, maxUrls: 50, timeLimit: 60000, concurrency: 5, credibilityThreshold: 0.3 };

  test('academic approach emits searchConfig.rankingOptions.weights (constructor-compatible key)', () => {
    const cfg = configTool.buildOrchestratorConfig({ ...baseParams, researchApproach: 'academic' });
    assert.deepEqual(cfg.searchConfig.rankingOptions, {
      weights: { authority: 0.4, semantic: 0.3, bm25: 0.2, freshness: 0.1 }
    });
    // Back-compat key stays in sync with the new one.
    assert.deepEqual(cfg.searchConfig.rankingWeights, cfg.searchConfig.rankingOptions.weights);
  });

  test('current_events approach emits searchConfig.rankingOptions.weights', () => {
    const cfg = configTool.buildOrchestratorConfig({ ...baseParams, researchApproach: 'current_events' });
    assert.deepEqual(cfg.searchConfig.rankingOptions, {
      weights: { freshness: 0.4, semantic: 0.3, bm25: 0.2, authority: 0.1 }
    });
  });

  test('comparative approach emits searchConfig.deduplicationOptions.thresholds', () => {
    const cfg = configTool.buildOrchestratorConfig({ ...baseParams, researchApproach: 'comparative' });
    assert.deepEqual(cfg.searchConfig.deduplicationOptions, {
      thresholds: { url: 0.9, title: 0.8, content: 0.7 }
    });
    assert.deepEqual(cfg.searchConfig.deduplicationThresholds, cfg.searchConfig.deduplicationOptions.thresholds);
  });

  for (const approach of ['broad', 'focused', 'academic', 'current_events', 'comparative']) {
    test(`${approach} approach propagates enableSourceVerification/enableConflictDetection/cacheResults to the orchestrator config`, () => {
      const cfg = configTool.buildOrchestratorConfig({
        ...baseParams,
        researchApproach: approach,
        enableSourceVerification: false,
        enableConflictDetection: false,
        cacheResults: false
      });
      assert.equal(cfg.enableSourceVerification, false, `${approach}: enableSourceVerification must reach the orchestrator config`);
      assert.equal(cfg.enableConflictDetection, false, `${approach}: enableConflictDetection must reach the orchestrator config`);
      assert.equal(cfg.cacheEnabled, false, `${approach}: cacheResults:false must reach cacheEnabled`);
    });
  }
});

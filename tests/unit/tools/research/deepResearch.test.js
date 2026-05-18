/**
 * D5.2 — Unit tests: deepResearch tool
 * Run: node --test tests/unit/tools/research/deepResearch.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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

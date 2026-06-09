/**
 * Regression tests: deep_research / agent(pro) internal search configuration.
 *
 * Run: node --test --test-force-exit tests/unit/researchSearchKey.test.js
 * (force-exit: ResearchOrchestrator.processWithTimeLimit leaves an uncleared
 *  setTimeout for the research time limit, which otherwise delays exit ~30s.)
 *
 * Bug: ResearchOrchestrator builds its own private SearchWebTool, but no layer
 * of the deep_research stack passed the search_web tool config (apiKey /
 * apiBaseUrl) down to it. Every internal search threw "API key is required",
 * the per-query catch swallowed it, and research reported a successful run
 * with searchQueries:4-5 (counter incremented before execution) and
 * urlsProcessed:0. The agent tool's pro path had the same hole.
 *
 * R1  DeepResearchTool.buildOrchestratorConfig() merges getToolConfig('search_web')
 *     into searchConfig for every researchApproach (incl. the three approaches
 *     that define their own searchConfig and used to clobber it)
 * R2  AgentOrchestrator passes its searchConfig into the pro ResearchOrchestrator
 * R3  gatherInitialSources throws when ALL search queries fail (no more silent
 *     zero-source success) and does not count failed searches in metrics
 * R4  gatherInitialSources tolerates partial failure (one query fails, one
 *     succeeds) and counts only the successful search
 * R5  Error payloads from conductResearch (which never rejects) are surfaced
 *     as failures by DeepResearchTool and the agent pro path (source check)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Must be set before the tool modules (and src/constants/config.js) load.
process.env.CRAWLFORGE_API_KEY = 'test-key-123';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const readSrc = (p) => readFileSync(join(repoRoot, p), 'utf8');

const baseParams = {
  maxDepth: 5,
  maxUrls: 50,
  timeLimit: 60000,
  concurrency: 5
};

describe('R1 buildOrchestratorConfig plumbs search_web config into the orchestrator', async () => {
  const { DeepResearchTool } = await import('../../src/tools/research/deepResearch.js');
  const tool = new DeepResearchTool();

  for (const approach of ['broad', 'focused', 'academic', 'current_events', 'comparative']) {
    test(`searchConfig.apiKey present for researchApproach=${approach}`, () => {
      const cfg = tool.buildOrchestratorConfig({ ...baseParams, researchApproach: approach });
      assert.equal(cfg.searchConfig?.apiKey, 'test-key-123');
      assert.ok(cfg.searchConfig?.apiBaseUrl, 'apiBaseUrl should also be plumbed');
    });
  }

  test('approach-specific search options survive the merge', () => {
    const academic = tool.buildOrchestratorConfig({ ...baseParams, researchApproach: 'academic' });
    assert.equal(academic.searchConfig.rankingWeights.authority, 0.4);

    const comparative = tool.buildOrchestratorConfig({ ...baseParams, researchApproach: 'comparative' });
    assert.equal(comparative.searchConfig.deduplicationThresholds.url, 0.9);
  });
});

describe('R2 AgentOrchestrator passes searchConfig to the pro ResearchOrchestrator', async () => {
  test('internal SearchWebTool gets the agent searchConfig apiKey', async () => {
    const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');
    const o = new AgentOrchestrator({ searchConfig: { apiKey: 'agent-key' } });
    const ro = await o._getResearchOrchestrator();
    assert.ok(ro.searchTool.searchAdapter, 'orchestrator SearchWebTool must have an adapter');
    assert.equal(ro.searchTool.searchAdapter.apiKey, 'agent-key');
  });
});

describe('R3 gatherInitialSources fails loudly when every search throws', async () => {
  const { ResearchOrchestrator } = await import('../../src/core/ResearchOrchestrator.js');

  test('throws instead of returning a successful empty run', async () => {
    const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'k' } });
    ro.searchTool.execute = async () => { throw new Error('CrawlForge API key is required'); };

    await assert.rejects(
      () => ro.gatherInitialSources(['query one', 'query two'], {}),
      /All 2 search queries failed.*API key is required/
    );
    assert.equal(ro.metrics.searchQueries, 0, 'failed searches must not be counted as run');
  });
});

describe('R4 gatherInitialSources tolerates partial search failure', async () => {
  const { ResearchOrchestrator } = await import('../../src/core/ResearchOrchestrator.js');

  test('one failing query does not sink the run; only successes counted', async () => {
    const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'k' } });
    ro.searchTool.execute = async ({ query }) => {
      if (query === 'bad') throw new Error('boom');
      return {
        results: [{ title: 'Result', link: 'https://example.com/a', snippet: 'snippet text' }]
      };
    };

    const sources = await ro.gatherInitialSources(['good', 'bad'], {});
    assert.equal(sources.length, 1);
    assert.equal(sources[0].link, 'https://example.com/a');
    assert.equal(ro.metrics.searchQueries, 1);
  });
});

describe('R5 conductResearch error payloads are surfaced as failures', () => {
  test('DeepResearchTool returns success:false on orchestrator error payload', () => {
    const src = readSrc('src/tools/research/deepResearch.js');
    assert.match(src, /researchResults\?\.error/);
    assert.match(src, /success:\s*false,\s*\n\s*sessionId,\s*\n\s*error:\s*researchResults\.error/);
  });

  test('agent pro path returns success:false on orchestrator error payload', () => {
    const src = readSrc('src/core/AgentOrchestrator.js');
    assert.match(src, /result\?\.error/);
    assert.match(src, /searchConfig:\s*this\._searchConfig/);
  });
});

/**
 * Unit tests: deep_research llmConfig.provider reaches the LLM manager.
 *
 * The schema accepted `provider` but buildOrchestratorConfig passed llmConfig
 * through untouched, and LLMManager selects on `defaultProvider` — so an
 * explicit provider was validated and then ignored. The enum also lacked
 * 'ollama', the zero-config default every other LLM tool already offers.
 *
 * Run: node --test tests/unit/deepResearchLlmProvider.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.CRAWLFORGE_API_KEY = process.env.CRAWLFORGE_API_KEY || 'test-key-123';
const { DeepResearchTool } = await import('../../src/tools/research/deepResearch.js');

const baseParams = { maxDepth: 5, maxUrls: 50, timeLimit: 60000, concurrency: 5, researchApproach: 'broad' };

describe('deep_research llmConfig.provider', () => {
  const tool = new DeepResearchTool();
  let savedOpenAi;
  let savedAnthropic;
  beforeEach(() => {
    savedOpenAi = process.env.OPENAI_API_KEY;
    savedAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (savedOpenAi === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedOpenAi;
    if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedAnthropic;
  });

  test('"ollama" is accepted and becomes the manager\'s defaultProvider', () => {
    const cfg = tool.buildOrchestratorConfig({
      ...baseParams,
      llmConfig: { provider: 'ollama', ollama: { model: 'gemma3:4b' } }
    });
    assert.equal(cfg.llmConfig.defaultProvider, 'ollama');
    assert.equal(cfg.llmConfig.ollama.model, 'gemma3:4b');
    assert.equal('provider' in cfg.llmConfig, false, 'the schema field is translated, not duplicated');
  });

  test('an omitted provider means auto, as before', () => {
    const cfg = tool.buildOrchestratorConfig({ ...baseParams, llmConfig: { enableSemanticAnalysis: false } });
    assert.equal(cfg.llmConfig.defaultProvider, 'auto');
    assert.equal(cfg.llmConfig.enableSemanticAnalysis, false);
  });

  test('a cloud provider with a key in the request is accepted', () => {
    const cfg = tool.buildOrchestratorConfig({
      ...baseParams,
      llmConfig: { provider: 'anthropic', anthropic: { apiKey: 'sk-ant-test' } }
    });
    assert.equal(cfg.llmConfig.defaultProvider, 'anthropic');
    assert.equal(cfg.llmConfig.anthropic.apiKey, 'sk-ant-test');
  });

  test('a cloud provider with a key in the environment is accepted', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const cfg = tool.buildOrchestratorConfig({ ...baseParams, llmConfig: { provider: 'openai' } });
    assert.equal(cfg.llmConfig.defaultProvider, 'openai');
  });

  test('a cloud provider with no key anywhere is refused up front, naming the fix', () => {
    assert.throws(
      () => tool.buildOrchestratorConfig({ ...baseParams, llmConfig: { provider: 'openai' } }),
      /provider "openai" needs an API key.*OPENAI_API_KEY.*ollama/s
    );
  });

  test('the schema accepts "ollama" and rejects a provider it has never heard of', async () => {
    const accepted = await tool.execute({ topic: 'x', llmConfig: { provider: 'not-a-provider' } });
    assert.equal(accepted.success, false);
    assert.match(JSON.stringify(accepted.details ?? accepted.error), /provider/);
  });
});

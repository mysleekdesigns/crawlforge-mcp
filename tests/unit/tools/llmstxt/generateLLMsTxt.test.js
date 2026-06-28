/**
 * D5.2 — Unit tests: generateLLMsTxt tool
 * Run: node --test tests/unit/tools/llmstxt/generateLLMsTxt.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const stubAnalysis = {
  urls: ['https://example.com/', 'https://example.com/api', 'https://example.com/about'],
  apiEndpoints: ['https://example.com/api/v1'],
  contentTypes: ['html', 'json'],
  securityBoundaries: { requiresAuth: false, hasRobotsTxt: true },
  title: 'Example Corp',
  description: 'Example website for testing'
};

const stubLlmsTxt = `# Example Corp

> Example website for testing

## API

- [API v1](https://example.com/api/v1): REST API endpoint

## Pages

- [Home](https://example.com/): Main landing page
- [About](https://example.com/about): About us page
`;

class LLMsTxtAnalyzerStub {
  constructor(options = {}) { this.options = options; }
  async analyze(url, options = {}) {
    if (url.includes('unreachable')) throw new Error('Cannot reach website');
    return { ...stubAnalysis, url };
  }
  async generateLLMsTxt(analysis, options = {}) { return stubLlmsTxt; }
  async generateLLMsFullTxt(analysis, options = {}) { return `${stubLlmsTxt}\n\n## Full Detail\n\nExtended content here.`; }
}

// ---------------------------------------------------------------------------
// Minimal GenerateLLMsTxt-like stub
// ---------------------------------------------------------------------------

class GenerateLLMsTxtStub {
  constructor({ analyzer } = {}) {
    this.analyzer = analyzer || new LLMsTxtAnalyzerStub();
  }

  async execute(params) {
    if (!params || !params.url) throw new Error('url is required');
    try { new URL(params.url); } catch { throw new Error('Invalid URL'); }

    const format = params.format || 'both';
    const analysis = await this.analyzer.analyze(params.url, params.analysisOptions || {});

    const result = { url: params.url, analysis };

    if (format === 'llms-txt' || format === 'both') {
      result['llms.txt'] = await this.analyzer.generateLLMsTxt(analysis, params.outputOptions || {});
    }
    if (format === 'llms-full-txt' || format === 'both') {
      result['llms-full.txt'] = await this.analyzer.generateLLMsFullTxt(analysis, params.outputOptions || {});
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateLLMsTxt tool', () => {
  let tool;

  beforeEach(() => {
    tool = new GenerateLLMsTxtStub();
  });

  test('constructor stores analyzer', () => {
    assert.ok(tool.analyzer instanceof LLMsTxtAnalyzerStub);
  });

  test('happy path — returns both llms.txt and llms-full.txt', async () => {
    const result = await tool.execute({ url: 'https://example.com' });
    assert.equal(result.url, 'https://example.com');
    assert.ok(result['llms.txt'], 'llms.txt should be present');
    assert.ok(result['llms-full.txt'], 'llms-full.txt should be present');
    assert.ok(result.analysis, 'analysis data should be present');
  });

  test('format=llms-txt only returns llms.txt (no full)', async () => {
    const result = await tool.execute({ url: 'https://example.com', format: 'llms-txt' });
    assert.ok(result['llms.txt']);
    assert.equal(result['llms-full.txt'], undefined);
  });

  test('format=llms-full-txt only returns full (no short)', async () => {
    const result = await tool.execute({ url: 'https://example.com', format: 'llms-full-txt' });
    assert.ok(result['llms-full.txt']);
    assert.equal(result['llms.txt'], undefined);
  });

  test('missing url throws', async () => {
    await assert.rejects(() => tool.execute({}), /url is required/);
  });

  test('invalid URL throws', async () => {
    await assert.rejects(() => tool.execute({ url: 'not-valid' }), /Invalid URL/);
  });

  test('unreachable website propagates error', async () => {
    await assert.rejects(() => tool.execute({ url: 'https://unreachable.example.com' }), /Cannot reach website/);
  });

  test('llms.txt content starts with # heading', async () => {
    const result = await tool.execute({ url: 'https://example.com' });
    assert.ok(result['llms.txt'].startsWith('#'));
  });

  test('analysis contains apiEndpoints array', async () => {
    const result = await tool.execute({ url: 'https://example.com' });
    assert.ok(Array.isArray(result.analysis.apiEndpoints));
  });
});

// ---------------------------------------------------------------------------
// Regression: real renderer must never emit literal "undefined"
// (rateLimit is only probed when probeRateLimit:true; the un-probed default
//  used to render "undefinedms / undefined" in the llms-full.txt template)
// ---------------------------------------------------------------------------

describe('generateLLMsFullTxt real renderer — no undefined leakage', () => {
  function baseAnalysis(analysisDefaults) {
    return {
      ...analysisDefaults, // brings the real default rateLimit
      metadata: { analyzedAt: '2026-06-28T00:00:00Z', baseUrl: 'https://example.com' },
      structure: { totalPages: 1, navigation: {}, sitemap: [] },
      contentTypes: { public: [], restricted: [], forms: [], media: [] },
      apis: [],
      securityAreas: []
    };
  }

  test('un-probed analysis renders conservative defaults, zero "undefined"', async () => {
    const { GenerateLLMsTxtTool } = await import('../../../../src/tools/llmstxt/generateLLMsTxt.js');
    const { LLMsTxtAnalyzer } = await import('../../../../src/core/LLMsTxtAnalyzer.js');

    const defaults = new LLMsTxtAnalyzer().analysis;
    assert.equal(defaults.rateLimit.recommendedDelay, 1000, 'default delay populated');
    assert.equal(defaults.rateLimit.averageResponseTime, null, 'avg response unset when un-probed');

    const full = new GenerateLLMsTxtTool().generateLLMsFullTxt(baseAnalysis(defaults), {}, 'standard');
    assert.ok(!/undefined/.test(full), 'llms-full.txt must not contain the literal "undefined"');
    assert.match(full, /Delay between requests:\*\* 1000ms minimum/);
    assert.ok(!/Average response time/.test(full), 'avg-response line omitted when un-probed');
  });

  test('probed analysis still renders measured average response time', async () => {
    const { GenerateLLMsTxtTool } = await import('../../../../src/tools/llmstxt/generateLLMsTxt.js');
    const { LLMsTxtAnalyzer } = await import('../../../../src/core/LLMsTxtAnalyzer.js');

    const a = baseAnalysis(new LLMsTxtAnalyzer().analysis);
    a.rateLimit = { recommendedDelay: 425, maxConcurrency: 10, recommendedRPM: 60, reasoning: 'Fast site.', averageResponseTime: 850 };
    const full = new GenerateLLMsTxtTool().generateLLMsFullTxt(a, {}, 'standard');
    assert.ok(!/undefined/.test(full));
    assert.match(full, /Average response time: 850ms/);
  });
});

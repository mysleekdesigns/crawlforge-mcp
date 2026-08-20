/**
 * Regression tests: GenerateLLMsTxtTool builds a fresh LLMsTxtAnalyzer per
 * execute() call instead of reusing one shared instance.
 * Run: node --test tests/unit/llmsTxtAnalyzer.test.js
 *
 * Bug: GenerateLLMsTxtTool's constructor used to build a single
 * `this.analyzer = new LLMsTxtAnalyzer(...)` and reuse it across every
 * execute() call. LLMsTxtAnalyzer keeps all per-analysis state (errors,
 * apis, structure, ...) as mutable instance fields (`this.analysis.*`), so
 * concurrent or successive calls mutated the same object, letting one run's
 * results (or errors) leak into another's. The fix constructs
 * `new LLMsTxtAnalyzer(...)` fresh inside execute().
 *
 * These tests patch LLMsTxtAnalyzer.prototype.analyzeWebsite with a fake
 * implementation (no network/mapSite/crawlDeep calls) that mutates
 * `this.analysis` the same way the real method does, so we can observe
 * whether state is shared across GenerateLLMsTxtTool.execute() calls.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { LLMsTxtAnalyzer } from '../../src/core/LLMsTxtAnalyzer.js';
import { GenerateLLMsTxtTool } from '../../src/tools/llmstxt/generateLLMsTxt.js';

let originalAnalyzeWebsite;

before(() => {
  originalAnalyzeWebsite = LLMsTxtAnalyzer.prototype.analyzeWebsite;
  // Fake analysis: yields mid-flight (setTimeout) so concurrent calls on
  // separate instances genuinely interleave, then pushes exactly one error
  // entry tagged with the URL. A shared/stale analyzer instance would show
  // up here as `errors.length > 1` (leftover entries from a prior run).
  LLMsTxtAnalyzer.prototype.analyzeWebsite = async function fakeAnalyzeWebsite(url) {
    this.analysis.metadata = { baseUrl: url, analyzedAt: new Date().toISOString(), analysisTimeMs: 1 };
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.analysis.structure = { totalPages: 1, sitemap: [], sections: {}, navigation: {}, hierarchy: {}, robotsTxt: null };
    this.analysis.apis = [];
    this.analysis.contentTypes = { public: [], restricted: [], dynamic: [], static: [], forms: [], media: [], documents: [] };
    this.analysis.securityAreas = [];
    this.analysis.guidelines = { crawling: {}, apis: {}, rateLimit: {}, content: {}, security: {}, compliance: {} };
    this.analysis.errors.push({ phase: 'test', error: `run:${url}`, timestamp: new Date().toISOString() });
    return this.analysis;
  };
});

after(() => {
  LLMsTxtAnalyzer.prototype.analyzeWebsite = originalAnalyzeWebsite;
});

describe('GenerateLLMsTxtTool — analyzer instance hygiene', () => {
  test('constructor does not hold a shared this.analyzer (fresh instance per execute)', () => {
    const tool = new GenerateLLMsTxtTool();
    assert.equal(tool.analyzer, undefined, 'GenerateLLMsTxtTool must not cache a shared LLMsTxtAnalyzer instance');
  });

  test('two sequential executions do not cross-contaminate analyzer state', async () => {
    const tool = new GenerateLLMsTxtTool();

    const run1 = await tool.execute({ url: 'https://run1.example.com/', outputOptions: { includeAnalysis: true } });
    assert.equal(run1.analysis.errors.length, 1);
    assert.equal(run1.analysis.errors[0].error, 'run:https://run1.example.com/');

    const run2 = await tool.execute({ url: 'https://run2.example.com/', outputOptions: { includeAnalysis: true } });
    assert.equal(run2.analysis.errors.length, 1, 'run 2 must not carry over run 1\'s error entries');
    assert.equal(run2.analysis.errors[0].error, 'run:https://run2.example.com/');
    assert.equal(run2.analysis.metadata.baseUrl, 'https://run2.example.com/');
  });

  test('two concurrent executions do not cross-contaminate analyzer state', async () => {
    const tool = new GenerateLLMsTxtTool();

    const [r1, r2] = await Promise.all([
      tool.execute({ url: 'https://concurrent-a.example.com/', outputOptions: { includeAnalysis: true } }),
      tool.execute({ url: 'https://concurrent-b.example.com/', outputOptions: { includeAnalysis: true } })
    ]);

    assert.equal(r1.analysis.errors.length, 1, 'concurrent run A must not see run B\'s error entries');
    assert.equal(r1.analysis.errors[0].error, 'run:https://concurrent-a.example.com/');
    assert.equal(r2.analysis.errors.length, 1, 'concurrent run B must not see run A\'s error entries');
    assert.equal(r2.analysis.errors[0].error, 'run:https://concurrent-b.example.com/');
  });
});

// Reproduction (2026-08-20): detectAPIEndpoints used substring matching on
// link text, so "Sapiens: A Brief History of Humankind" qualified as an API
// link ("s-api-ens"). Word-boundary matching keeps real API links only.
describe('LLMsTxtAnalyzer.detectAPIEndpoints — word-boundary API link matching', () => {
  test('embedded "api" inside a word does not qualify; a real API doc link does', async () => {
    const analyzer = new LLMsTxtAnalyzer();
    const base = 'https://books.toscrape.com';
    const homepage = '<html><body>' +
      '<a href="catalogue/sapiens-a-brief-history-of-humankind_996/index.html">Sapiens: A Brief History of Humankind</a>' +
      '<a href="/docs/api">API documentation</a>' +
      '</body></html>';
    analyzer.fetchWithTimeout = async (url) => {
      if (url.replace(/\/$/, '') === base) {
        return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => homepage };
      }
      return { ok: false, status: 404, headers: { get: () => null } };
    };
    await analyzer.detectAPIEndpoints(base);
    const urls = analyzer.analysis.apis.map((a) => a.url);
    assert.ok(!urls.some((u) => u.includes('/catalogue/')), `book page misdetected as API: ${JSON.stringify(urls)}`);
    assert.ok(urls.some((u) => u.endsWith('/docs/api')), `real API doc link missed: ${JSON.stringify(urls)}`);
  });
});

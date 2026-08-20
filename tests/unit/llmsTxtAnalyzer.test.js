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
let originalFetchHomePageMetadata;

before(() => {
  // execute() also fetches the homepage for title/description metadata;
  // stub it so these unit tests stay fully offline.
  originalFetchHomePageMetadata = GenerateLLMsTxtTool.prototype.fetchHomePageMetadata;
  GenerateLLMsTxtTool.prototype.fetchHomePageMetadata = async () => null;

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
  GenerateLLMsTxtTool.prototype.fetchHomePageMetadata = originalFetchHomePageMetadata;
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

// Reproduction (2026-08-20, quotes.toscrape.com maxPages 10): spec llms.txt
// labeled 6 of 10 links "[1]" because names came from the URL's LAST path
// segment ("/tag/abilities/page/1" -> "1"), and the blockquote summary was
// always boilerplate. Names must prefer the page <title> captured during
// analysis, else a humanized FULL path; the summary must prefer the
// homepage's meta/og description.
describe('GenerateLLMsTxtTool — spec llms.txt link names and site description', () => {
  const sitemap = [
    'https://quotes.toscrape.com/',
    'https://quotes.toscrape.com/login',
    'https://quotes.toscrape.com/author/Albert-Einstein',
    'https://quotes.toscrape.com/tag/abilities/page/1',
    'https://quotes.toscrape.com/tag/deep-thoughts/page/1'
  ];
  const makeAnalysis = (overrides = {}) => ({
    metadata: { baseUrl: 'https://quotes.toscrape.com', analyzedAt: new Date().toISOString() },
    structure: {
      totalPages: sitemap.length,
      sitemap,
      sections: { content: [], navigation: [], media: [], tools: [], documentation: [], other: sitemap },
      navigation: {}, hierarchy: {}, robotsTxt: null
    },
    contentTypes: { public: [], restricted: [], dynamic: [], static: [], forms: [], media: [], documents: [] },
    apis: [],
    securityAreas: [],
    errors: [],
    ...overrides
  });

  test('no link is ever labeled by a bare numeric segment; full path is humanized', () => {
    const tool = new GenerateLLMsTxtTool();
    const out = tool.generateSpecLLMsTxt(makeAnalysis(), {});
    const labels = [...out.matchAll(/^- \[([^\]]*)\]/gm)].map((m) => m[1]);
    assert.equal(labels.length, sitemap.length);
    for (const label of labels) {
      assert.ok(!/^\d+$/.test(label.trim()), `bare numeric link label "${label}" in:\n${out}`);
    }
    assert.ok(out.includes('- [Tag: abilities — page 1](https://quotes.toscrape.com/tag/abilities/page/1)'), out);
    assert.ok(out.includes('- [Tag: deep thoughts — page 1](https://quotes.toscrape.com/tag/deep-thoughts/page/1)'), out);
    assert.ok(out.includes('- [Author: Albert Einstein](https://quotes.toscrape.com/author/Albert-Einstein)'), out);
    assert.ok(out.includes('- [Login](https://quotes.toscrape.com/login)'), out);
  });

  test('page <title> captured during analysis is preferred; duplicated titles fall back to path', () => {
    const tool = new GenerateLLMsTxtTool();
    const analysis = makeAnalysis({
      contentTypes: {
        public: [
          { url: 'https://quotes.toscrape.com/login', metadata: { title: 'Login — Quotes to Scrape' } },
          { url: 'https://quotes.toscrape.com/tag/abilities/page/1', metadata: { title: 'Quotes to Scrape' } },
          { url: 'https://quotes.toscrape.com/tag/deep-thoughts/page/1', metadata: { title: 'Quotes to Scrape' } }
        ]
      }
    });
    const out = tool.generateSpecLLMsTxt(analysis, {});
    assert.ok(out.includes('- [Login — Quotes to Scrape](https://quotes.toscrape.com/login)'), out);
    // A <title> shared by several pages cannot identify one page — path wins.
    assert.ok(!out.includes('[Quotes to Scrape](https://quotes.toscrape.com/tag/'), out);
    assert.ok(out.includes('- [Tag: abilities — page 1](https://quotes.toscrape.com/tag/abilities/page/1)'), out);
  });

  test('homepage title names the root link; meta description becomes the blockquote summary', () => {
    const tool = new GenerateLLMsTxtTool();
    const homePage = tool.extractHomePageMetadata(
      '<html><head><title>Quotes to Scrape</title>' +
      '<meta name="description" content="  A sandbox site full of\n famous quotes to practice scraping.  "></head>' +
      '<body><h1>ignored</h1></body></html>'
    );
    assert.deepEqual(homePage, { title: 'Quotes to Scrape', description: 'A sandbox site full of famous quotes to practice scraping.' });
    const out = tool.generateSpecLLMsTxt(makeAnalysis({ homePage }), {});
    assert.ok(out.includes('> A sandbox site full of famous quotes to practice scraping.'), out);
    assert.ok(!out.includes('Site map and key resources for'), out);
    assert.ok(out.includes('- [Quotes to Scrape](https://quotes.toscrape.com/)'), out);
  });

  test('og:description is used when meta description is absent; boilerplate only when neither exists', () => {
    const tool = new GenerateLLMsTxtTool();
    const ogOnly = tool.extractHomePageMetadata(
      '<html><head><title>T</title><meta property="og:description" content="OG summary"></head></html>'
    );
    assert.equal(ogOnly.description, 'OG summary');

    // quotes.toscrape.com's real homepage has no meta/og description at all.
    const bare = tool.extractHomePageMetadata('<html><head><title>Quotes to Scrape</title></head><body><h1>Quotes to Scrape</h1></body></html>');
    assert.equal(bare.description, '');
    const out = tool.generateSpecLLMsTxt(makeAnalysis({ homePage: bare }), {});
    assert.ok(out.includes('> Site map and key resources for https://quotes.toscrape.com,'), out);
  });

  test('humanizePath edge cases never yield bare numbers', () => {
    const tool = new GenerateLLMsTxtTool();
    assert.equal(tool.humanizePath('/'), 'Home');
    assert.equal(tool.humanizePath('/page/2'), 'Page 2');
    assert.equal(tool.humanizePath('/2'), 'Page 2');
    assert.equal(tool.humanizePath('/catalogue/page-2.html'), 'Catalogue — page 2');
    assert.equal(tool.humanizePath('/tag/abilities/page/1'), 'Tag: abilities — page 1');
    assert.equal(tool.humanizePath('/docs/api/auth'), 'Docs: api / auth');
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

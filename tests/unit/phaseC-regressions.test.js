/**
 * Phase C (v4.5.0 "Robustness, Security & Polish") regression tests.
 *
 * Run: node --test tests/unit/phaseC-regressions.test.js
 *
 * Covers every C-series fix with a reproduce-then-pass regression test.
 * Network-dependent paths are exercised by stubbing globalThis.fetch; no live
 * network calls are made.
 *
 * C1.1  _fetch.js            — body-size cap (Content-Length + streaming); defensive
 *                              against responses with no Headers / no ReadableStream body
 * C1.2  timeouts            — real AbortSignal.timeout() (not the no-op `timeout:` option)
 * C1.3  LLMsTxtAnalyzer.js  — checkSecurity / probeRateLimit are opt-in (default false)
 * C1.4  BFSCrawler.js       — per-domain rate-limiter map; logger, not console.error
 * C2.1  StealthBrowserManager — engine enum in schema; sec-ch-ua brand version follows UA
 * C3.1  _fetch.js / extractStructured — version-derived User-Agent (not CrawlForge/1.0.0)
 * C3.2  LocalizationManager — detectGeoBlocking (renamed); US phone regex \d (not \\d)
 * C3.3  extractWithLlm.js   — JSON-substring recovery; Anthropic tool-use; output validation
 * C3.4  listOllamaModels.js — non-array hardening; modified_at normalized to ISO 8601
 * C3.5  batchScrape         — get_batch_results / getBatchResults pagination
 * C3.6  PDFProcessor.js     — true page-range extraction (pageRange + _renderPage)
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const readSrc = (p) => readFileSync(join(repoRoot, p), 'utf8');

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

// Build a streaming-body Response-like object from a string.
function streamResponse(body, { headers = {}, status = 200 } = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://example.com/',
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    body: {
      getReader() {
        let done = false;
        return {
          read() {
            if (done) return Promise.resolve({ done: true, value: undefined });
            done = true;
            return Promise.resolve({ done: false, value: bytes });
          },
          cancel() {}
        };
      }
    }
  };
}

// ---------------------------------------------------------------------------
// C1.1 _fetch.js — body-size cap, defensive against non-standard responses
// ---------------------------------------------------------------------------

describe('C1.1 _fetch body-size cap + defensive handling', () => {
  test('returns a mock response with no Headers/body unchanged (no crash)', async () => {
    const { fetchWithTimeout } = await import('../../src/tools/basic/_fetch.js');
    globalThis.fetch = async () => ({ ok: true, status: 200, url: 'https://x/', text: async () => '<html/>' });
    const res = await fetchWithTimeout('https://x/');
    assert.equal(res.ok, true);
    assert.equal(await res.text(), '<html/>'); // native .text() preserved
  });

  test('rejects when Content-Length exceeds the cap', async () => {
    const { fetchWithTimeout } = await import('../../src/tools/basic/_fetch.js');
    const huge = String(100 * 1024 * 1024);
    globalThis.fetch = async () => streamResponse('x', { headers: { 'content-length': huge } });
    await assert.rejects(() => fetchWithTimeout('https://x/'), /too large/i);
  });

  test('streams and reassembles a normal body, exposing .text()', async () => {
    const { fetchWithTimeout } = await import('../../src/tools/basic/_fetch.js');
    globalThis.fetch = async () => streamResponse('hello world');
    const res = await fetchWithTimeout('https://x/');
    assert.equal(await res.text(), 'hello world');
  });

  test('cap is configurable via config.fetch.maxBodySize', async () => {
    const { config } = await import('../../src/constants/config.js');
    assert.equal(typeof config.fetch.maxBodySize, 'number');
    assert.ok(config.fetch.maxBodySize > 0);
  });
});

// ---------------------------------------------------------------------------
// C1.2 timeouts — AbortSignal.timeout(), not the ignored `timeout:` option
// ---------------------------------------------------------------------------

describe('C1.2 real fetch timeouts', () => {
  for (const file of [
    'src/tools/extract/extractContent.js',
    'src/tools/extract/processDocument.js',
    'src/tools/tracking/trackChanges/differ.js'
  ]) {
    test(`${file} uses AbortSignal.timeout and not a bare timeout: option`, () => {
      const src = readSrc(file);
      assert.ok(src.includes('AbortSignal.timeout'), `${file} should use AbortSignal.timeout`);
      assert.ok(!/\btimeout:\s*\d/.test(src), `${file} should not pass a numeric timeout: option to fetch`);
    });
  }
});

// ---------------------------------------------------------------------------
// C1.3 LLMsTxtAnalyzer — intrusive probing is opt-in
// ---------------------------------------------------------------------------

describe('C1.3 LLMsTxtAnalyzer opt-in probing', () => {
  test('checkSecurity and probeRateLimit default to false', async () => {
    const { LLMsTxtAnalyzer } = await import('../../src/core/LLMsTxtAnalyzer.js');
    const a = new LLMsTxtAnalyzer();
    assert.equal(a.options.checkSecurity, false);
    assert.equal(a.options.probeRateLimit, false);
  });

  test('they can be explicitly enabled', async () => {
    const { LLMsTxtAnalyzer } = await import('../../src/core/LLMsTxtAnalyzer.js');
    const a = new LLMsTxtAnalyzer({ checkSecurity: true, probeRateLimit: true });
    assert.equal(a.options.checkSecurity, true);
    assert.equal(a.options.probeRateLimit, true);
  });
});

// ---------------------------------------------------------------------------
// C1.4 BFSCrawler — per-domain limiter map; logger not console.error
// ---------------------------------------------------------------------------

describe('C1.4 BFSCrawler rate-limiter + logging', () => {
  test('maintains a per-domain rate-limiter map', async () => {
    const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');
    const c = new BFSCrawler();
    assert.ok(c._domainRateLimiters instanceof Map);
  });

  test('filter/robots block messages route through logger, not console.error', () => {
    const src = readSrc('src/core/crawlers/BFSCrawler.js');
    assert.ok(src.includes('logger.debug'), 'should use logger.debug');
    assert.ok(!src.includes('console.error(`Domain filter blocks'), 'no raw console.error for filter blocks');
  });
});

// ---------------------------------------------------------------------------
// C2.1 StealthBrowserManager — engine selection + UA-matched sec-ch-ua
// ---------------------------------------------------------------------------

describe('C2.1 StealthBrowserManager engine + sec-ch-ua', () => {
  test('config schema accepts an engine field (chromium | camoufox)', () => {
    const src = readSrc('src/core/StealthBrowserManager.js');
    assert.ok(/engine:\s*z\.enum\(\['chromium',\s*'camoufox'\]\)/.test(src), 'engine enum present in schema');
  });

  test('generateSecChUaHeader derives brand version from the UA Chrome version', async () => {
    const { StealthBrowserManager } = await import('../../src/core/StealthBrowserManager.js');
    const m = new StealthBrowserManager();
    const header = m.generateSecChUaHeader('Mozilla/5.0 ... Chrome/131.0.0.0 Safari/537.36');
    assert.ok(header.includes('131'), `sec-ch-ua should reflect Chrome 131, got: ${header}`);
    assert.ok(!header.includes('"120"'), 'should not hardcode the old 120 version');
  });
});

// ---------------------------------------------------------------------------
// C3.1 version-derived User-Agent
// ---------------------------------------------------------------------------

describe('C3.1 version-derived User-Agent', () => {
  test('_fetch and extractStructured no longer hardcode CrawlForge/1.0.0', () => {
    assert.ok(!readSrc('src/tools/basic/_fetch.js').includes('CrawlForge/1.0.0'));
    assert.ok(!readSrc('src/tools/extract/extractStructured.js').includes('CrawlForge-MCP/3.0'));
  });

  test('the UA string embeds the package version', async () => {
    const pkg = JSON.parse(readSrc('package.json'));
    const src = readSrc('src/tools/basic/_fetch.js');
    assert.ok(src.includes('_pkg.version'), 'UA derived from package.json version');
    assert.ok(typeof pkg.version === 'string');
  });
});

// ---------------------------------------------------------------------------
// C3.2 LocalizationManager — detectGeoBlocking rename + US phone regex
// ---------------------------------------------------------------------------

describe('C3.2 localization detectGeoBlocking + phone regex', () => {
  test('detectGeoBlocking exists; handleGeoBlocking removed', async () => {
    const { LocalizationManager } = await import('../../src/core/LocalizationManager.js');
    const m = new LocalizationManager();
    assert.equal(typeof m.detectGeoBlocking, 'function');
    assert.equal(m.handleGeoBlocking, undefined);
  });

  test('US phone regex uses \\d, not the dead \\\\d', () => {
    const src = readSrc('src/core/LocalizationManager.js');
    assert.ok(!src.includes('\\\\d{3}'), 'literal backslash-d must be fixed');
  });
});

// ---------------------------------------------------------------------------
// C3.3 extractWithLlm — JSON recovery, Anthropic tool-use, schema validation
// ---------------------------------------------------------------------------

describe('C3.3 extract_with_llm robustness', () => {
  test('recovers an embedded JSON object from a prose-wrapped Ollama response', async () => {
    const { ExtractWithLlm } = await import('../../src/tools/extract/extractWithLlm.js');
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: 'Sure! Here is the data: {"a": 1, "b": "x"} — done.' }, prompt_eval_count: 1, eval_count: 1, model: 'llama3.2' })
    });
    const res = await new ExtractWithLlm().execute({ content: 'irrelevant', prompt: 'extract', provider: 'auto' });
    assert.equal(res.success, true);
    assert.deepEqual(res.data, { a: 1, b: 'x' });
  });

  test('Anthropic tool-use end-to-end', async () => {
    const { ExtractWithLlm } = await import('../../src/tools/extract/extractWithLlm.js');
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    let sentBody = null;
    globalThis.fetch = async (_url, opts) => {
      sentBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'tool_use', name: 'extract_data', input: { title: 'Hello' } }],
          usage: { input_tokens: 5, output_tokens: 3 },
          model: 'claude-haiku-4-5'
        })
      };
    };
    try {
      const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
      const res = await new ExtractWithLlm().execute({ content: 'x', prompt: 'extract', provider: 'anthropic', schema });
      assert.equal(res.success, true);
      assert.deepEqual(res.data, { title: 'Hello' });
      assert.equal(res.valid, true);
      assert.equal(sentBody.tool_choice.type, 'tool');
      assert.equal(sentBody.tools[0].name, 'extract_data');
    } finally {
      process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  test('schema validation flags a missing required field', async () => {
    const { ExtractWithLlm } = await import('../../src/tools/extract/extractWithLlm.js');
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '{"wrong": 1}' }, prompt_eval_count: 1, eval_count: 1, model: 'llama3.2' })
    });
    const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
    const res = await new ExtractWithLlm().execute({ content: 'x', prompt: 'extract', provider: 'auto', schema });
    assert.equal(res.success, true);
    assert.equal(res.valid, false);
    assert.ok(Array.isArray(res.validationErrors) && res.validationErrors.length > 0);
  });
});

// ---------------------------------------------------------------------------
// C3.4 listOllamaModels — non-array hardening + ISO timestamps
// ---------------------------------------------------------------------------

describe('C3.4 list_ollama_models hardening', () => {
  test('normalizes modified_at to ISO 8601', async () => {
    const { ListOllamaModelsTool } = await import('../../src/tools/extract/listOllamaModels.js');
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ models: [{ name: 'm', size: 1, modified_at: 'Mon, 01 Jan 2024 00:00:00 GMT', details: {} }] })
    });
    const res = await new ListOllamaModelsTool().execute();
    assert.equal(res.success, true);
    assert.equal(res.models[0].modified_at, new Date('Mon, 01 Jan 2024 00:00:00 GMT').toISOString());
  });

  test('survives a non-array models field', async () => {
    const { ListOllamaModelsTool } = await import('../../src/tools/extract/listOllamaModels.js');
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ models: 'oops' }) });
    const res = await new ListOllamaModelsTool().execute();
    assert.equal(res.success, true);
    assert.deepEqual(res.models, []);
  });
});

// ---------------------------------------------------------------------------
// C3.5 batch_scrape — get_batch_results pagination
// ---------------------------------------------------------------------------

describe('C3.5 batch_scrape getBatchResults', () => {
  test('BatchScrapeTool exposes getBatchResults(batchId, page, pageSize)', async () => {
    const mod = await import('../../src/tools/advanced/batchScrape/index.js');
    const Tool = mod.BatchScrapeTool || mod.default;
    const inst = new Tool();
    assert.equal(typeof inst.getBatchResults, 'function');
    assert.ok(inst.getBatchResults.length >= 1);
  });

  test('server registers the get_batch_results tool', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes('registerTool("get_batch_results"'));
    // Banner count updated to 26 in Phase D (scrape + agent tools added)
    assert.ok(src.includes('Tools available (26)'));
  });
});

// ---------------------------------------------------------------------------
// C3.6 PDFProcessor — true page-range extraction
// ---------------------------------------------------------------------------

describe('C3.6 PDFProcessor page-range extraction', () => {
  test('exposes _renderPage and a pageRange-driven extractPDFPages', async () => {
    const { PDFProcessor } = await import('../../src/core/processing/PDFProcessor.js');
    const p = new PDFProcessor();
    assert.equal(typeof p._renderPage, 'function');
    assert.equal(typeof p.extractPDFPages, 'function');
  });

  test('extractPDFPages forwards a pageRange to processPDF and slices captured pages', async () => {
    const { PDFProcessor } = await import('../../src/core/processing/PDFProcessor.js');
    const p = new PDFProcessor();
    let forwarded = null;
    p.processPDF = async (params) => {
      forwarded = params;
      // Simulate captured pages 1..5; slice [2..4] via the recorded pageRange.
      const pages = ['p1', 'p2', 'p3', 'p4', 'p5'];
      const { start, end } = params.options.pageRange;
      const slice = pages.slice(start - 1, end);
      return { success: true, text: slice.join('\n\n'), extractedPages: { start, end, count: slice.length } };
    };
    const res = await p.extractPDFPages({ source: 'x', sourceType: 'file', startPage: 2, endPage: 4 });
    assert.deepEqual(forwarded.options.pageRange, { start: 2, end: 4 });
    assert.equal(res.text, 'p2\n\np3\n\np4');
    assert.equal(res.extractedPages.count, 3);
  });

  test('_renderPage records per-page text and returns it', async () => {
    const { PDFProcessor } = await import('../../src/core/processing/PDFProcessor.js');
    const p = new PDFProcessor();
    const sink = [];
    const fakePage = {
      getTextContent: async () => ({
        items: [
          { str: 'Hello', transform: [1, 0, 0, 1, 0, 700] },
          { str: 'World', transform: [1, 0, 0, 1, 0, 680] } // different Y → newline
        ]
      })
    };
    const text = await p._renderPage(fakePage, sink);
    assert.equal(text, 'Hello\nWorld');
    assert.deepEqual(sink, ['Hello\nWorld']);
  });
});

/**
 * Unit tests: extractStructured tool (real module — src/tools/extract/extractStructured.js)
 * Run: node --test tests/unit/tools/extract/extractStructured.test.js
 *
 * ExtractStructuredTool fetches its target through safeFetch (SSRF-guarded),
 * so these tests spin up a local HTTP server on 127.0.0.1 and allowlist it
 * via ALLOWED_DOMAINS — set *before* the guarded modules are first imported,
 * since config.js reads ALLOWED_DOMAINS once at import time. No live network
 * or LLM calls are made: OPENAI_API_KEY / ANTHROPIC_API_KEY are cleared so
 * LLMManager.isAvailable() is false and every test exercises the real CSS
 * selector fallback path.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isInputRequiredResult, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';

process.env.ALLOWED_DOMAINS = 'localhost';
const savedOpenAiKey = process.env.OPENAI_API_KEY;
const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
// Ollama needs no key, so clearing the cloud keys is no longer enough to keep
// these tests off the LLM path — a developer running Ollama locally would
// otherwise exercise a live model here.
process.env.DISABLE_OLLAMA = 'true';

const { ExtractStructuredTool } = await import('../../../../src/tools/extract/extractStructured.js');
const { LLMManager } = await import('../../../../src/core/llm/LLMManager.js');

// ---------------------------------------------------------------------------
// Local fixture server — serves canned HTML per path, no live network.
// ---------------------------------------------------------------------------

const PAGES = {
  '/product': '<html><head><title>Widget Page</title></head><body><h1>Widget Pro</h1><span class="price">$49.99</span></body></html>',
  '/no-match': '<html><head><title>Empty</title></head><body><div>nothing matches any selector</div></body></html>',
  // books.toscrape.com-style markup: price is in class "price_color", which
  // the exact-token `.price` selector cannot match.
  '/book': '<html><head><title>Book Page</title></head><body><h1>Tipping the Velvet</h1><p class="price_color">£53.74</p><p class="instock availability">In stock</p></body></html>',
  // Chrome-heavy page, modelled on the blog.cloudflare.com post that made
  // extract_structured answer `headline: "Skip to content"`: the real headline
  // is only reachable through a main-content pass.
  '/chrome-heavy': `<html><head><title>How we saved 100 terabytes of memory | Example Blog</title></head><body>
    <nav><a href="#main">Skip to content</a><a href="/tags/dns">DNS</a><a href="/tags/rust">Rust</a></nav>
    <header><h1>How we saved 100 terabytes of memory</h1></header>
    <article>
      <p>${'Five successive changes to how cache entries are stored in memory cut the per-entry footprint by more than half. '.repeat(6)}</p>
      <p>${'Across the fleet those changes freed roughly one hundred terabytes of memory, with no measurable latency cost. '.repeat(6)}</p>
    </article>
    <footer><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Use</a></footer>
  </body></html>`,
  // racket-lang.org-style page: the answer lives in a banner outside the
  // article, which Readability drops.
  '/banner': `<html><head><title>Racket</title></head><body>
    <nav><a href="#main">Skip to content</a></nav>
    <div class="announce">Racket version 9.3 is available.</div>
    <main><h1>Racket, the Language-Oriented Programming Language</h1>
      <p>${'Racket is a general-purpose programming language and a platform for language creation. '.repeat(8)}</p>
    </main>
  </body></html>`,
  // Long enough that main content plus page text overflows the budget.
  '/long-article': `<html><head><title>A very long article | Example Blog</title></head><body>
    <nav><a href="#main">Skip to content</a></nav>
    <header><h1>A very long article</h1></header>
    <article><p>${'Each of these sentences is part of an article that runs well past the budget the model is shown. '.repeat(160)}</p></article>
    <footer><a href="/privacy">Privacy Policy</a></footer>
  </body></html>`
};

// Served as text/plain so fetchAndParse classifies it as non-markup.
const PLAIN_BODY = '{"headline":"From a JSON endpoint","memory_saved":"100 TB"}';

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/plain') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(PLAIN_BODY);
      return;
    }
    const html = PAGES[path];
    if (!html) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (savedOpenAiKey !== undefined) process.env.OPENAI_API_KEY = savedOpenAiKey;
  if (savedAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
});

describe('extractStructured tool (real module, CSS fallback — no LLM configured)', () => {
  let tool;

  test('constructor stores llmManager placeholder and a real elicitation helper', () => {
    tool = new ExtractStructuredTool();
    assert.equal(tool.llmManager, null);
    assert.ok(tool._elicitation);
  });

  test('happy path — extracts title (semantic h1 fallback) and price (.price class) via CSS fallback', async () => {
    const schema = { type: 'object', properties: { title: { type: 'string' }, price: { type: 'string' } }, required: ['title'] };
    const result = await tool.execute({ url: `${baseUrl}/product`, schema });
    assert.equal(result.extraction_method, 'css_fallback');
    assert.equal(result.data.title, 'Widget Pro');
    assert.equal(result.data.price, '$49.99');
    assert.equal(result.validation.valid, true);
  });

  // Reproduction test for the CSS-fallback crash fix: schema keys containing
  // spaces/parens (which become invalid CSS selector fragments, e.g.
  // Reproduction (2026-08-20): "price" had no semantic-selector entry, so
  // markup like books.toscrape.com's <p class="price_color"> silently
  // yielded no price field; the semantic table now tries [class*="price"].
  test('price extracts from a price_color class via the semantic [class*="price"] fallback', async () => {
    const schema = { type: 'object', properties: { title: { type: 'string' }, price: { type: 'string' } }, required: ['title'] };
    const result = await tool.execute({ url: `${baseUrl}/book`, schema });
    assert.equal(result.extraction_method, 'css_fallback');
    assert.equal(result.data.title, 'Tipping the Velvet');
    assert.equal(result.data.price, '£53.74');
  });

  // `.price(USD)` -> "Attribute selector didn't terminate") used to throw
  // inside the single un-guarded loop, aborting extraction for every field
  // and returning extraction_method: 'none'. Each field is now tried in its
  // own try/catch, so a bad key only loses that one field.
  test('a schema key that produces an invalid CSS selector no longer aborts the whole extraction', async () => {
    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        'price(USD)': { type: 'string' },
        'job title': { type: 'string' }
      },
      required: ['title']
    };
    const result = await tool.execute({ url: `${baseUrl}/product`, schema });

    assert.notEqual(result.extraction_method, 'none', 'a bad key must not abort the whole extraction');
    assert.equal(result.extraction_method, 'css_fallback');
    assert.equal(result.data.title, 'Widget Pro', 'the valid "title" key must still extract');
    assert.ok(!('error' in result), 'no top-level error');
    assert.equal(result.validation.errors.length, 0, 'no validation errors — invalid-selector keys are skipped, not reported as failures');
  });

  test('falls through to keyword fallback, and reports it as keyword_fallback, when no CSS selector matches anything', async () => {
    const schema = { type: 'object', properties: { headline: { type: 'string' } } };
    const result = await tool.execute({ url: `${baseUrl}/no-match`, schema });
    assert.equal(result.extraction_method, 'keyword_fallback');
    assert.ok(result.data);
  });

  test('missing required field is reported in validation.errors', async () => {
    const schema = { type: 'object', properties: { title: { type: 'string' }, isbn: { type: 'string' } }, required: ['title', 'isbn'] };
    const result = await tool.execute({ url: `${baseUrl}/product`, schema });
    assert.equal(result.validation.valid, false);
    assert.ok(result.validation.errors.some((e) => e.includes('isbn')));
  });

  test('invalid URL returns a structured failure (not a thrown error)', async () => {
    const schema = { type: 'object', properties: { title: { type: 'string' } } };
    const result = await tool.execute({ url: 'not-a-url', schema });
    assert.equal(result.extraction_method, 'none');
    assert.match(result.error, /Structured extraction failed/);
  });

  test('404 response returns a structured failure', async () => {
    const schema = { type: 'object', properties: { title: { type: 'string' } } };
    const result = await tool.execute({ url: `${baseUrl}/missing`, schema });
    assert.equal(result.extraction_method, 'none');
    assert.match(result.error, /404/);
  });

  test('selectorHints are honored over automatic field-name matching', async () => {
    const schema = { type: 'object', properties: { headline: { type: 'string' } } };
    const result = await tool.execute({
      url: `${baseUrl}/product`,
      schema,
      selectorHints: { headline: 'h1' }
    });
    assert.equal(result.data.headline, 'Widget Pro');
  });

  // Reproduction test: an LLM failure (as opposed to "no LLM configured") is
  // now surfaced in extractionNotes instead of silently disappearing.
  test('an LLM-path failure is recorded in extractionNotes alongside the CSS fallback result', async () => {
    const originalIsAvailable = LLMManager.prototype.isAvailable;
    LLMManager.prototype.isAvailable = () => { throw new Error('LLM boom'); };
    try {
      const schema = { type: 'object', properties: { title: { type: 'string' } } };
      const result = await tool.execute({ url: `${baseUrl}/product`, schema });
      assert.equal(result.extraction_method, 'css_fallback');
      assert.equal(result.data.title, 'Widget Pro');
      assert.ok(
        result.extractionNotes.some((n) => n.includes('LLM extraction failed: LLM boom')),
        `expected an LLM-failure note, got: ${JSON.stringify(result.extractionNotes)}`
      );
    } finally {
      LLMManager.prototype.isAvailable = originalIsAvailable;
    }
  });
});

// ---------------------------------------------------------------------------
// LLM path. The whole-body textContent fetchAndParse returns was handed
// straight to the model, which answered from the first heading-shaped string
// it saw — "Skip to content" on the Cloudflare blog post. Main content alone
// then hid the racket-lang.org version banner, which Readability drops. The
// model now reads the main content first and the page text after it, when
// both fit the budget. A stubbed LLM captures what the tool actually sends,
// so these tests pin the input, not a model's answer.
// ---------------------------------------------------------------------------

/** Replace the tool's LLMManager with a stub; returns the captured input. */
function stubLlm(tool, result) {
  const captured = { input: null };
  tool._ensureLLMManager = () => ({
    ready: async () => true,
    extractStructured: async (content) => {
      captured.input = content;
      return { method: 'llm', ...result };
    }
  });
  return captured;
}

describe('extractStructured — the LLM reads main content first, then the page', () => {
  test('the input opens with the headline; nav and footer chrome come after the article', async () => {
    const tool = new ExtractStructuredTool();
    const captured = stubLlm(tool, { data: { headline: 'x' }, valid: true, validationErrors: [] });

    await tool.execute({
      url: `${baseUrl}/chrome-heavy`,
      schema: { type: 'object', properties: { headline: { type: 'string' } }, required: ['headline'] }
    });

    assert.ok(
      captured.input.startsWith('How we saved 100 terabytes of memory'),
      `expected the headline first, got: ${JSON.stringify(captured.input.slice(0, 80))}`
    );
    assert.match(captured.input, /per-entry footprint/, 'the article body is still there');
    const article = captured.input.indexOf('per-entry footprint');
    assert.ok(captured.input.indexOf('Skip to content') > article, 'nav chrome only after the article');
    assert.ok(captured.input.indexOf('Privacy Policy') > article, 'footer chrome only after the article');
  });

  test('a banner Readability drops is still in view, after the main content', async () => {
    const tool = new ExtractStructuredTool();
    const captured = stubLlm(tool, { data: { version: 'x' }, valid: true, validationErrors: [] });

    await tool.execute({
      url: `${baseUrl}/banner`,
      schema: { type: 'object', properties: { version: { type: 'string' } }, required: ['version'] }
    });

    assert.ok(captured.input.startsWith('Racket, the Language-Oriented'), 'the main content leads');
    assert.match(captured.input, /Racket version 9\.3 is available/);
    // The whole page follows the main content: its nav text is there, after
    // the article.
    assert.ok(
      captured.input.indexOf('Skip to content') > captured.input.indexOf('language creation'),
      'the page text follows the main content'
    );
  });

  // R17 (2026-09-04): main content alone hid the page head, where swift.org
  // keeps the current release ("Install (6.3.3)") and the article body listed
  // the previous one. The head of the whole page now follows a cut article.
  test('a page too long for both gets the main content first, then the page head', async () => {
    const tool = new ExtractStructuredTool();
    const captured = stubLlm(tool, { data: { headline: 'x' }, valid: true, validationErrors: [] });

    await tool.execute({
      url: `${baseUrl}/long-article`,
      schema: { type: 'object', properties: { headline: { type: 'string' } }, required: ['headline'] }
    });

    assert.ok(captured.input.startsWith('A very long article'));
    const article = captured.input.indexOf('Each of these sentences');
    assert.ok(captured.input.indexOf('Skip to content') > article, 'the page head follows the article');
    assert.ok(captured.input.length > 15000, `most of the article is shown, got ${captured.input.length} chars`);
    assert.ok(captured.input.length <= 24000, `within the shown-text budget, got ${captured.input.length} chars`);
  });

  test('a non-markup body (text/plain) is passed through whole', async () => {
    const tool = new ExtractStructuredTool();
    const captured = stubLlm(tool, { data: { headline: 'x' }, valid: true, validationErrors: [] });

    await tool.execute({
      url: `${baseUrl}/plain`,
      schema: { type: 'object', properties: { headline: { type: 'string' } } }
    });

    assert.equal(captured.input, PLAIN_BODY);
  });
});

describe('extractStructured — a missing required field is a top-level failure', () => {
  test('success:false and a top-level error when a required field is absent', async () => {
    const tool = new ExtractStructuredTool();
    const schema = { type: 'object', properties: { title: { type: 'string' }, isbn: { type: 'string' } }, required: ['title', 'isbn'] };
    const result = await tool.execute({ url: `${baseUrl}/product`, schema });

    assert.equal(result.success, false);
    assert.match(result.error, /isbn/);
    assert.equal(result.validation.valid, false);
  });

  test('a required field the model returned empty counts as missing', async () => {
    const tool = new ExtractStructuredTool();
    stubLlm(tool, { data: { headline: '', authors: [], memory_saved: null }, valid: false, validationErrors: ['Field "memory_saved": expected string, got object'] });

    const result = await tool.execute({
      url: `${baseUrl}/chrome-heavy`,
      schema: {
        type: 'object',
        properties: { headline: { type: 'string' }, authors: { type: 'array' }, memory_saved: { type: 'string' } },
        required: ['headline', 'authors', 'memory_saved']
      }
    });

    assert.equal(result.success, false);
    assert.match(result.error, /headline, authors, memory_saved/);
  });

  test('success:true when every required field is filled', async () => {
    const tool = new ExtractStructuredTool();
    const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
    const result = await tool.execute({ url: `${baseUrl}/product`, schema });

    assert.equal(result.success, true);
    assert.ok(!('error' in result));
  });
});

// ---------------------------------------------------------------------------
// 4.4 — the no-LLM/required-fields gate is an input-required round trip. The
// SDK answers it by re-entering execute() from the top, so the gate has moved
// above the page fetch: its condition (no LLM, and a schema demanding more
// than 3 required fields) is settled before any network work.
// ---------------------------------------------------------------------------

const GATE_KEY = 'extract_structured:no_llm_required_fields';
const askableCtx = () => ({ mcpReq: { envelope: { [CLIENT_CAPABILITIES_META_KEY]: { elicitation: {} } } } });
const answeredCtx = (response) => ({ mcpReq: { inputResponses: { [GATE_KEY]: response } } });

const fourRequired = {
  type: 'object',
  properties: { title: { type: 'string' }, price: { type: 'string' }, sku: { type: 'string' }, stock: { type: 'string' } },
  required: ['title', 'price', 'sku', 'stock']
};
const threeRequired = {
  type: 'object',
  properties: { title: { type: 'string' }, price: { type: 'string' }, sku: { type: 'string' } },
  required: ['title', 'price', 'sku']
};

describe('extractStructured — no-LLM required-fields gate (real module)', () => {
  test('3 required fields are never gated', async () => {
    const tool = new ExtractStructuredTool();
    const result = await tool.execute({ url: `${baseUrl}/product`, schema: threeRequired }, askableCtx());
    assert.equal(isInputRequiredResult(result), false);
    assert.equal(result.extraction_method, 'css_fallback');
  });

  test('fallbackToSelectors:false is never gated (there is no CSS pass to warn about)', async () => {
    const tool = new ExtractStructuredTool();
    const result = await tool.execute(
      { url: `${baseUrl}/product`, schema: fourRequired, fallbackToSelectors: false },
      askableCtx()
    );
    assert.equal(isInputRequiredResult(result), false);
    assert.equal(result.extraction_method, 'keyword_fallback');
  });

  test('> 3 required fields with no LLM asks before the page is fetched', async () => {
    const tool = new ExtractStructuredTool();
    // A URL that 404s: reaching the fetch would return the "Structured
    // extraction failed" payload instead of a question.
    const result = await tool.execute({ url: `${baseUrl}/never-fetched`, schema: fourRequired }, askableCtx());
    assert.ok(isInputRequiredResult(result), 'the gate must return an input_required result verbatim');
    assert.ok(result.inputRequests[GATE_KEY]);
  });

  test('an accepted answer proceeds on re-entry', async () => {
    const tool = new ExtractStructuredTool();
    const result = await tool.execute(
      { url: `${baseUrl}/product`, schema: fourRequired },
      answeredCtx({ action: 'accept', content: { confirmed: true } })
    );
    assert.equal(isInputRequiredResult(result), false);
    assert.equal(result.extraction_method, 'css_fallback');
  });

  test('a declined answer returns the cancelled payload', async () => {
    const tool = new ExtractStructuredTool();
    const result = await tool.execute(
      { url: `${baseUrl}/product`, schema: fourRequired },
      answeredCtx({ action: 'decline' })
    );
    assert.equal(result.success, false);
    assert.equal(result.url, `${baseUrl}/product`);
    assert.deepEqual(result.data, {});
    assert.equal(result.extraction_method, 'none');
    assert.equal(result.confidence, 0);
    assert.deepEqual(result.schema_used, fourRequired);
    assert.equal(result.error, 'Extraction cancelled by user (elicitation declined).');
    assert.deepEqual(result.validation, {
      valid: false,
      errors: ['Extraction cancelled by user (elicitation declined).']
    });
  });

  test('a client that cannot be asked proceeds unasked (fail-open, unchanged)', async () => {
    const tool = new ExtractStructuredTool();
    const result = await tool.execute({ url: `${baseUrl}/product`, schema: fourRequired }, undefined);
    assert.equal(isInputRequiredResult(result), false);
    assert.equal(result.extraction_method, 'css_fallback');
  });
});

/**
 * R19 (2026-09-07): a required array that came back full of stray page text
 * was neither missing nor empty, so `success` stayed true while `validation`
 * said nothing — the shallow validator had passed it. With the validator
 * fixed, a required field in the wrong shape has to fail the call too.
 */
describe('extractStructured — a required field in the wrong shape fails the call', () => {
  const rowsSchema = {
    type: 'object',
    properties: {
      countries: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, capital: { type: 'string' } } }
      }
    },
    required: ['countries']
  };

  test('an array of strings where objects were required is not a success', async () => {
    const tool = new ExtractStructuredTool();
    stubLlm(tool, {
      data: { countries: ['Countries of the World: A Simple Example', 'build a simple web scraper'] },
      valid: false,
      validationErrors: ['Field "countries.0": expected object, got string']
    });

    const result = await tool.execute({ url: `${baseUrl}/product`, schema: rowsSchema });

    assert.equal(result.success, false, 'junk rows must not report success');
    assert.match(result.error, /wrong shape: countries/);
    assert.equal(result.validation.valid, false);
  });

  test('a correctly shaped required array still succeeds', async () => {
    const tool = new ExtractStructuredTool();
    stubLlm(tool, {
      data: { countries: [{ name: 'Andorra', capital: 'Andorra la Vella' }] },
      valid: true,
      validationErrors: []
    });

    const result = await tool.execute({ url: `${baseUrl}/product`, schema: rowsSchema });

    assert.equal(result.success, true, result.error || '');
  });

  test('a missing required field still reports missing, not wrong shape', async () => {
    const tool = new ExtractStructuredTool();
    stubLlm(tool, {
      data: { countries: [] },
      valid: false,
      validationErrors: ['Missing required field: countries']
    });

    const result = await tool.execute({ url: `${baseUrl}/product`, schema: rowsSchema });

    assert.equal(result.success, false);
    assert.match(result.error, /missing or empty: countries/);
    assert.doesNotMatch(result.error, /wrong shape/, 'an empty array is reported once, as empty');
  });
});

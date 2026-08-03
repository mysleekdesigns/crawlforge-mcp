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

process.env.ALLOWED_DOMAINS = 'localhost';
const savedOpenAiKey = process.env.OPENAI_API_KEY;
const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { ExtractStructuredTool } = await import('../../../../src/tools/extract/extractStructured.js');
const { LLMManager } = await import('../../../../src/core/llm/LLMManager.js');

// ---------------------------------------------------------------------------
// Local fixture server — serves canned HTML per path, no live network.
// ---------------------------------------------------------------------------

const PAGES = {
  '/product': '<html><head><title>Widget Page</title></head><body><h1>Widget Pro</h1><span class="price">$49.99</span></body></html>',
  '/no-match': '<html><head><title>Empty</title></head><body><div>nothing matches any selector</div></body></html>'
};

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
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

  test('falls through to keyword fallback (still extraction_method css_fallback) when no CSS selector matches anything', async () => {
    const schema = { type: 'object', properties: { headline: { type: 'string' } } };
    const result = await tool.execute({ url: `${baseUrl}/no-match`, schema });
    assert.equal(result.extraction_method, 'css_fallback');
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

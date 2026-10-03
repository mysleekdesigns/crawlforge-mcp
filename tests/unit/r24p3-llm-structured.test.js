/**
 * R24 Phase 3.4 — extract_structured string fields, fallback types, confidence.
 *
 * Run: node --test --test-force-exit tests/unit/r24p3-llm-structured.test.js
 *
 * Live repro (2026-10-03, gemma3:4b): hono.dev states no version, and
 * extract_structured returned `version: "latest"`, `name: "HonoWeb"` with
 * `confidence: 0.9` and `validation.valid: true`. The numeric provenance guard
 * cannot see a word, so nothing checked it. A typeless schema (the tool's own
 * example omits `type`) validated as "anything", so the CSS fallback reported
 * `valid: true` for "2 reviews" in an integer field. No live network: a local
 * HTTP server serves the page and the LLM is stubbed.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { load } from 'cheerio';

process.env.ALLOWED_DOMAINS = 'localhost';
process.env.DISABLE_OLLAMA = 'true';
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { ExtractStructuredTool, verifyFieldShapes } = await import('../../src/tools/extract/extractStructured.js');

const PAGE = `<html><head><title>Hono - Web framework built on Web Standards</title></head><body>
  <nav><a href="/docs">Docs</a><a href="/latest">latest</a></nav>
  <main><h1>Hono</h1>
    <p>Fast, lightweight, built on Web Standards. Support for any JavaScript runtime.</p>
    <p>Released under the MIT License. Copyright Yusuke Wada.</p>
  </main>
</body></html>`;

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Replace the tool's LLMManager with one that answers `answers` in turn. */
function stubLlm(tool, ...answers) {
  const calls = [];
  tool._ensureLLMManager = () => ({
    ready: async () => true,
    extractStructured: async (content) => {
      calls.push(content);
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      return { method: 'llm', valid: true, validationErrors: [], ...answer };
    }
  });
  return calls;
}

describe('verifyFieldShapes', () => {
  const schema = {
    properties: {
      version: { type: 'string' }, latestVersion: { type: 'string' }, version_name: { type: 'string' },
      sku: { type: 'string' }, productSKU: { type: 'string' }, isbn13: { type: 'string' }, title: { type: 'string' }
    }
  };

  test('a version field without a number is nulled with a reason', () => {
    const { data, unverified } = verifyFieldShapes({ version: 'latest', latestVersion: 'stable' }, schema);
    assert.equal(data.version, null);
    assert.equal(data.latestVersion, null);
    assert.deepEqual(unverified.map((u) => [u.path, u.value, u.reason]), [
      ['version', 'latest', 'not_a_version'],
      ['latestVersion', 'stable', 'not_a_version']
    ]);
  });

  test('a real version, and a version NAME, are kept', () => {
    const { data, unverified } = verifyFieldShapes({ version: 'v4.6.0', version_name: 'Sequoia' }, schema);
    assert.equal(data.version, 'v4.6.0');
    assert.equal(data.version_name, 'Sequoia');
    assert.equal(unverified.length, 0);
  });

  test('an identifier field holding a phrase is nulled; a one-token id is kept', () => {
    const { data, unverified } = verifyFieldShapes(
      { sku: 'Dark Roast Coffee', productSKU: 'COLLECTION-CO-DARK-ROAST', isbn13: '978-0-596-51774-8', title: 'Dark Roast Coffee' },
      schema
    );
    assert.equal(data.sku, null);
    assert.equal(data.productSKU, 'COLLECTION-CO-DARK-ROAST');
    assert.equal(data.isbn13, '978-0-596-51774-8');
    assert.equal(data.title, 'Dark Roast Coffee', 'a field not named for an identifier is prose');
    assert.deepEqual(unverified, [{ path: 'sku', value: 'Dark Roast Coffee', reason: 'not_an_identifier' }]);
  });
});

describe('extract_structured LLM path (stubbed model)', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' }, version: { type: 'string' }, license: { type: 'string' } },
    required: ['name', 'version']
  };

  test('version "latest" is nulled, reported, and fails the required field', async () => {
    const tool = new ExtractStructuredTool();
    stubLlm(tool, { data: { name: 'Hono', version: 'latest', license: 'MIT License' } });
    const result = await tool.execute({ url: `${baseUrl}/`, schema });

    assert.equal(result.data.version, null);
    assert.equal(result.success, false);
    assert.match(result.error, /version/);
    assert.equal(result.validation.valid, false);
    assert.ok(result.validation.errors.some((e) => /"version": "latest" is not a version/.test(e)), JSON.stringify(result.validation.errors));
    assert.equal(result.provenance.nulled, 1);
    assert.deepEqual(result.provenance.unverified, [{ path: 'version', value: 'latest', reason: 'not_a_version' }]);
    assert.ok(result.extractionNotes.some((n) => /^Field shape: 1 value/.test(n)), JSON.stringify(result.extractionNotes));
    assert.ok(result.confidence < 0.9, `confidence ${result.confidence}`);
  });

  test('a shape-nulled required field gets the full-text retry, like a placeholder', async () => {
    const tool = new ExtractStructuredTool();
    const calls = stubLlm(tool,
      { data: { name: 'Hono', version: 'latest' } },
      { data: { name: 'Hono', version: 'MIT' } }
    );
    await tool.execute({ url: `${baseUrl}/`, schema });
    assert.equal(calls.length, 2, 'a retry on the whole page text was made');
  });

  test('verify_numbers:false turns the shape check off with the rest of the guard', async () => {
    const tool = new ExtractStructuredTool();
    stubLlm(tool, { data: { name: 'Hono', version: 'latest' } });
    const result = await tool.execute({ url: `${baseUrl}/`, schema, verify_numbers: false });
    assert.equal(result.data.version, 'latest');
    assert.equal(result.provenance.enabled, false);
  });

  test('confidence is not a constant: an ungrounded or partial answer scores below a grounded full one', async () => {
    const twoFields = { type: 'object', properties: { name: { type: 'string' }, license: { type: 'string' } } };

    const grounded = new ExtractStructuredTool();
    stubLlm(grounded, { data: { name: 'Hono', license: 'MIT License' } });
    const full = await grounded.execute({ url: `${baseUrl}/`, schema: twoFields });

    const invented = new ExtractStructuredTool();
    stubLlm(invented, { data: { name: 'HonoWeb', license: 'Apache 2.0' } });
    const madeUp = await invented.execute({ url: `${baseUrl}/`, schema: twoFields });

    const half = new ExtractStructuredTool();
    stubLlm(half, { data: { name: 'Hono', license: null } });
    const partial = await half.execute({ url: `${baseUrl}/`, schema: twoFields });

    assert.equal(full.confidence, 0.9, 'every field filled and found on the page');
    assert.ok(madeUp.confidence < full.confidence, `ungrounded ${madeUp.confidence} vs ${full.confidence}`);
    assert.ok(partial.confidence < full.confidence, `partial ${partial.confidence} vs ${full.confidence}`);
  });

  test('the provider and model that answered are reported', async () => {
    const tool = new ExtractStructuredTool();
    stubLlm(tool, { data: { name: 'Hono', version: '4.6.0' }, provider: 'ollama', model: 'gemma3:12b' });
    const result = await tool.execute({
      url: `${baseUrl}/`,
      schema: { type: 'object', properties: { name: { type: 'string' }, version: { type: 'string' } } },
      verify_numbers: false
    });
    assert.equal(result.extraction_method, 'llm');
    assert.equal(result.provider, 'ollama');
    assert.equal(result.model, 'gemma3:12b');
  });
});

describe('extract_structured CSS fallback types', () => {
  const tool = new ExtractStructuredTool();
  const $ = load('<html><body><h1>Dark Roast</h1><span class="reviews">2 reviews</span><span class="rating">4.5 out of 5</span><span class="stock">In stock</span></body></html>');

  test('the first number in the text is the value, for number and integer fields', () => {
    const r = tool._cssExtraction($, { type: 'object', properties: { reviews: { type: 'integer' }, rating: { type: 'number' } } }, {});
    assert.equal(r.data.reviews, 2);
    assert.equal(r.data.rating, 4.5, 'not 4.55 — the two numbers are not run together');
    assert.equal(r.valid, true);
  });

  test('text with no number in an integer field is reported invalid', () => {
    const r = tool._cssExtraction($, { type: 'object', properties: { stock: { type: 'integer' } } }, {});
    assert.equal(r.data.stock, 'In stock');
    assert.equal(r.valid, false);
  });

  test('a typeless schema is validated as an object: "2 reviews" is not an integer (R24)', async () => {
    const result = await tool.execute({
      url: `${baseUrl}/`,
      schema: { properties: { name: { type: 'integer' } } },
      selectorHints: { name: 'h1' }
    });
    assert.equal(result.extraction_method, 'css_fallback');
    assert.equal(result.data.name, 'Hono');
    assert.equal(result.validation.valid, false, 'a word in an integer field is a wrong type, not valid');
    assert.ok(result.validation.errors.some((e) => /expected number, got string/.test(e)), JSON.stringify(result.validation.errors));
  });
});

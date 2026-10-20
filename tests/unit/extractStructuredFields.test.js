/**
 * extract_structured returns every requested field (live sweep 2026-10-20, 2.3).
 *
 * books.toscrape "A Light in the Attic" with {title, price, upc,
 * in_stock_count, rating_stars} returned only title and price, with no nulls
 * and no notes, though all five values are on the page: the UPC is a
 * <th>/<td> row, the stock count is inside "In stock (22 available)", and the
 * rating is the class token in `<p class="star-rating Three">`.
 *
 * The fixture is a live capture of that page, served from 127.0.0.1. No LLM
 * runs: the cloud keys are cleared and Ollama is disabled, so the CSS
 * fallback is exercised, and the LLM path is covered with a stub.
 *
 * Run: node --test --test-force-exit tests/unit/extractStructuredFields.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

process.env.ALLOWED_DOMAINS = 'localhost';
const savedOpenAiKey = process.env.OPENAI_API_KEY;
const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
process.env.DISABLE_OLLAMA = 'true';

const { ExtractStructuredTool } = await import('../../src/tools/extract/extractStructured.js');

const FIXTURE = readFileSync(new URL('../fixtures/books-toscrape-light-in-the-attic.html', import.meta.url), 'utf8');

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    price: { type: 'string' },
    upc: { type: 'string' },
    in_stock_count: { type: 'integer' },
    rating_stars: { type: 'integer' }
  }
};

let server;
let url;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(FIXTURE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://localhost:${server.address().port}/catalogue/a-light-in-the-attic_1000/index.html`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (savedOpenAiKey !== undefined) process.env.OPENAI_API_KEY = savedOpenAiKey;
  if (savedAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
});

describe('extract_structured on the books.toscrape fixture', () => {
  test('the CSS fallback returns all five fields with the page values', async () => {
    const result = await new ExtractStructuredTool().execute({ url, schema: SCHEMA });
    assert.equal(result.extraction_method, 'css_fallback');
    assert.deepEqual(result.data, {
      title: 'A Light in the Attic',
      price: '£51.77',
      upc: 'a897fe39b1053632',
      in_stock_count: 22,
      rating_stars: 3
    });
    assert.deepEqual(result.missing_fields, []);
    assert.equal(result.validation.valid, true);
  });

  test('a numeric price field reads the number', async () => {
    const schema = { properties: { price: { type: 'number' } } };
    const result = await new ExtractStructuredTool().execute({ url, schema });
    assert.equal(result.data.price, 51.77);
  });

  test('a field the page does not have is null and listed in missing_fields', async () => {
    const schema = { properties: { ...SCHEMA.properties, isbn: { type: 'string' } } };
    const result = await new ExtractStructuredTool().execute({ url, schema });
    assert.ok('isbn' in result.data, 'every requested field is present in data');
    assert.equal(result.data.isbn, null);
    assert.deepEqual(result.missing_fields, ['isbn']);
    assert.ok(result.extractionNotes.some((n) => n.includes('isbn')), 'a note names the missing field');
    assert.equal(result.data.upc, 'a897fe39b1053632');
  });

  test('an LLM answer that leaves fields out gets nulls and missing_fields', async () => {
    const tool = new ExtractStructuredTool();
    tool._ensureLLMManager = () => ({
      ready: async () => true,
      extractStructured: async () => ({
        method: 'llm',
        data: { title: 'A Light in the Attic', price: '£51.77' },
        valid: true,
        validationErrors: []
      })
    });
    const result = await tool.execute({ url, schema: SCHEMA });
    assert.equal(result.extraction_method, 'llm');
    assert.deepEqual(Object.keys(result.data).sort(), Object.keys(SCHEMA.properties).sort());
    assert.equal(result.data.upc, null);
    assert.equal(result.data.in_stock_count, null);
    assert.equal(result.data.rating_stars, null);
    assert.deepEqual(result.missing_fields, ['upc', 'in_stock_count', 'rating_stars']);
  });
});

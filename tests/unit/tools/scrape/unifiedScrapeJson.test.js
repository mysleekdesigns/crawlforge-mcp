/**
 * Unit tests: the json format of UnifiedScrapeTool.
 *
 * Run: node --test tests/unit/tools/scrape/unifiedScrapeJson.test.js --test-force-exit
 *
 * Regression (2026-08-25): the json branch read only `result.success` from
 * extract_with_llm and dropped everything else it reports. So on a long page:
 *
 *   - a schema echo ({"type":"object","properties":{...}}) arrived as
 *     content.json with no warning at all
 *   - output that failed schema validation (`valid:false`) was presented as
 *     clean data
 *   - input clipped at the 50k character cap (`truncated:true`) was invisible,
 *     so missing fields looked like they were absent from the page
 *
 * Both a page server and a stub Ollama run locally, so no live model is used
 * and the failures are deterministic.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;
const savedOllamaUrl = process.env.OLLAMA_BASE_URL;

const { UnifiedScrapeTool } = await import('../../../../src/tools/scrape/unifiedScrape.js');

let pageServer;
let ollamaServer;
let baseUrl;

/** Canned /api/chat replies; the last one repeats. */
let replies = [];
let callCount = 0;

const SMALL_PAGE = '<html><body><h1>Widget Pro</h1><p>Price: $49.99</p></body></html>';
// Comfortably past extract_with_llm's 50,000-character input cap.
const LONG_PAGE =
  '<html><body><h1>Widget Pro</h1>' +
  '<p>Filler paragraph with enough words to add up quickly.</p>'.repeat(1200) +
  '<p>Price: $49.99</p></body></html>';

const SCHEMA = { type: 'object', properties: { title: { type: 'string' }, price: { type: 'string' } } };

before(async () => {
  pageServer = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const body = path === '/long' ? LONG_PAGE : path === '/page' ? SMALL_PAGE : null;
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body);
  });
  await new Promise((resolve) => pageServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${pageServer.address().port}`;

  ollamaServer = http.createServer((req, res) => {
    if (req.url === '/api/chat') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const content = replies[Math.min(callCount, replies.length - 1)];
        callCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'stub', message: { role: 'assistant', content } }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => ollamaServer.listen(0, '127.0.0.1', resolve));
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${ollamaServer.address().port}`;
});

after(async () => {
  await new Promise((resolve) => pageServer.close(resolve));
  await new Promise((resolve) => ollamaServer.close(resolve));
  if (savedOllamaUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = savedOllamaUrl;
});

beforeEach(() => {
  callCount = 0;
  replies = [];
});

const scrape = (path, opts = {}) =>
  new UnifiedScrapeTool().execute({
    url: `${baseUrl}${path}`,
    formats: [{ type: 'json', schema: SCHEMA }],
    onlyMainContent: false,
    resolveHiddenContent: 'off',
    ...opts
  });

describe('UnifiedScrapeTool — json format failure reporting', () => {
  test('a schema echo becomes an error with a warning, not silent data', async () => {
    const echo = JSON.stringify({ type: 'object', properties: { title: { type: 'null' }, price: { type: 'null' } } });
    replies = [echo, echo];

    const result = await scrape('/page');

    assert.ok(result.content.json.error, 'content.json must carry an error, not the echoed schema');
    assert.ok(!('properties' in result.content.json), 'the schema document must not be returned as data');
    assert.ok(
      (result.warnings || []).some((w) => /json: extraction failed/.test(w)),
      `expected a json warning, got: ${JSON.stringify(result.warnings)}`
    );
  });

  test('output that violates the requested schema is returned but warned about', async () => {
    // price declared as string, returned as a number.
    replies = [JSON.stringify({ title: 'Widget Pro', price: 49.99 })];

    const result = await scrape('/page');

    assert.equal(result.content.json.title, 'Widget Pro', 'usable data is still returned');
    assert.ok(
      (result.warnings || []).some((w) => /did not match the requested schema/.test(w)),
      `expected a schema-mismatch warning, got: ${JSON.stringify(result.warnings)}`
    );
  });

  test('input clipped at the character cap is reported', async () => {
    replies = [JSON.stringify({ title: 'Widget Pro', price: '$49.99' })];

    const result = await scrape('/long');

    assert.deepEqual(result.content.json, { title: 'Widget Pro', price: '$49.99' });
    assert.ok(
      (result.warnings || []).some((w) => /truncated from \d+ chars/.test(w)),
      `expected a truncation warning, got: ${JSON.stringify(result.warnings)}`
    );
  });

  test('a clean extraction produces no json warnings', async () => {
    replies = [JSON.stringify({ title: 'Widget Pro', price: '$49.99' })];

    const result = await scrape('/page');

    assert.deepEqual(result.content.json, { title: 'Widget Pro', price: '$49.99' });
    assert.ok(
      !(result.warnings || []).some((w) => w.startsWith('json:')),
      `expected no json warnings, got: ${JSON.stringify(result.warnings)}`
    );
  });
});

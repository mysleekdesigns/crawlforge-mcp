/**
 * Unit tests: listOllamaModels tool (real module — src/tools/extract/listOllamaModels.js)
 * Run: node --test tests/unit/tools/extract/listOllamaModels.test.js
 *
 * ListOllamaModelsTool uses the global `fetch` directly (not the SSRF-guarded
 * safeFetch) and re-reads OLLAMA_BASE_URL on every execute() call, so a local
 * HTTP server on 127.0.0.1 with OLLAMA_BASE_URL pointed at it exercises the
 * real module end-to-end with no live network and no stubbing.
 */

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ListOllamaModelsTool } from '../../../../src/tools/extract/listOllamaModels.js';

const MOCK_TAGS_RESPONSE = {
  models: [
    { name: 'llama3:8b', size: 4000000000, modified_at: '2024-01-01T00:00:00.000Z', details: { family: 'llama', parameter_size: '8B', quantization_level: 'Q4_0' } },
    { name: 'mistral:7b', size: 3800000000, modified_at: '2024-01-02T00:00:00.000Z', details: { family: 'mistral', parameter_size: '7B', quantization_level: 'Q4_K_M' } }
  ]
};

let server;
let baseUrl;
let responder = () => ({ status: 200, body: MOCK_TAGS_RESPONSE });
let lastRequestUrl = null;

before(async () => {
  server = http.createServer((req, res) => {
    lastRequestUrl = req.url;
    const { status, body, raw } = responder();
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(raw !== undefined ? raw : JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

let savedBaseUrl;
beforeEach(() => {
  savedBaseUrl = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = baseUrl;
  responder = () => ({ status: 200, body: MOCK_TAGS_RESPONSE });
  lastRequestUrl = null;
});
afterEach(() => {
  if (savedBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = savedBaseUrl;
});

describe('listOllamaModels tool (real module)', () => {
  test('happy path — returns model list with metadata from a real /api/tags response', async () => {
    const tool = new ListOllamaModelsTool();
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.equal(result.baseUrl, baseUrl);
    assert.equal(result.count, 2);
    assert.equal(result.models[0].name, 'llama3:8b');
    assert.equal(result.models[0].family, 'llama');
    assert.equal(result.models[0].size_bytes, 4000000000);
    assert.equal(lastRequestUrl, '/api/tags');
  });

  test('modified_at is normalized to ISO 8601', async () => {
    responder = () => ({ status: 200, body: { models: [{ name: 'x', size: 1, modified_at: '2024-01-01 00:00:00 +0000 UTC', details: {} }] } });
    const tool = new ListOllamaModelsTool();
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.equal(result.models[0].modified_at, new Date('2024-01-01 00:00:00 +0000 UTC').toISOString());
  });

  test('non-array top-level response (already an array of models) is handled', async () => {
    responder = () => ({ status: 200, body: [{ name: 'bare-array-model', size: 1, details: {} }] });
    const tool = new ListOllamaModelsTool();
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.equal(result.count, 1);
    assert.equal(result.models[0].name, 'bare-array-model');
  });

  test('connection refused (nothing listening) returns success:false with a helpful error', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1'; // reserved port, nothing listens here
    const tool = new ListOllamaModelsTool();
    const result = await tool.execute();
    assert.equal(result.success, false);
    assert.match(result.error, /Could not reach Ollama/);
  });

  test('non-200 HTTP status returns success:false', async () => {
    responder = () => ({ status: 503, body: {} });
    const tool = new ListOllamaModelsTool();
    const result = await tool.execute();
    assert.equal(result.success, false);
    assert.match(result.error, /503/);
  });

  test('invalid JSON body returns success:false', async () => {
    responder = () => ({ status: 200, raw: 'not json{{' });
    const tool = new ListOllamaModelsTool();
    const result = await tool.execute();
    assert.equal(result.success, false);
    assert.match(result.error, /Invalid JSON/);
  });

  test('empty models array returns count:0 and the "no models" hint', async () => {
    responder = () => ({ status: 200, body: { models: [] } });
    const tool = new ListOllamaModelsTool();
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.equal(result.count, 0);
    assert.deepEqual(result.models, []);
    assert.match(result.hint, /ollama pull/);
  });

  test('custom OLLAMA_BASE_URL (with trailing slash) is normalized and used', async () => {
    process.env.OLLAMA_BASE_URL = `${baseUrl}/`;
    const tool = new ListOllamaModelsTool();
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.equal(result.baseUrl, baseUrl);
  });
});

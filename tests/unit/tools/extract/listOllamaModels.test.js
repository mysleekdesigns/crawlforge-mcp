/**
 * D5.2 — Unit tests: listOllamaModels tool
 * Run: node --test tests/unit/tools/extract/listOllamaModels.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline stub of ListOllamaModelsTool with injectable fetch
// ---------------------------------------------------------------------------

const MOCK_TAGS_RESPONSE = {
  models: [
    { name: 'llama3:8b', size: 4000000000, modified_at: '2024-01-01T00:00:00Z', details: { family: 'llama', parameter_size: '8B', quantization_level: 'Q4_0' } },
    { name: 'mistral:7b', size: 3800000000, modified_at: '2024-01-02T00:00:00Z', details: { family: 'mistral', parameter_size: '7B', quantization_level: 'Q4_K_M' } }
  ]
};

class ListOllamaModelsStub {
  constructor({ fetchFn, baseUrl } = {}) {
    this._fetch = fetchFn || null;
    this._baseUrl = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  }

  async execute() {
    const url = `${this._baseUrl}/api/tags`;
    let response;
    try {
      response = await this._fetch(url);
    } catch (err) {
      return { success: false, baseUrl: this._baseUrl, error: `Could not reach Ollama at ${url}: ${err.message}.` };
    }

    if (!response.ok) {
      return { success: false, baseUrl: this._baseUrl, error: `Ollama responded ${response.status} at ${url}.` };
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      return { success: false, baseUrl: this._baseUrl, error: `Invalid JSON from Ollama: ${err.message}` };
    }

    const models = (data.models || []).map(m => ({
      name: m.name,
      size_bytes: m.size,
      modified_at: m.modified_at,
      family: m.details?.family,
      parameter_size: m.details?.parameter_size,
      quantization: m.details?.quantization_level
    }));

    return { success: true, baseUrl: this._baseUrl, count: models.length, models };
  }
}

// ---------------------------------------------------------------------------
// Helper to create mock fetch responses
// ---------------------------------------------------------------------------

function makeFetch(status, body, rejectWith = null) {
  return async (_url) => {
    if (rejectWith) throw new Error(rejectWith);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listOllamaModels tool', () => {
  test('constructor stores baseUrl with trailing slash stripped', () => {
    const tool = new ListOllamaModelsStub({ fetchFn: makeFetch(200, MOCK_TAGS_RESPONSE), baseUrl: 'http://localhost:11434/' });
    assert.equal(tool._baseUrl, 'http://localhost:11434');
  });

  test('happy path — returns model list with metadata', async () => {
    const tool = new ListOllamaModelsStub({ fetchFn: makeFetch(200, MOCK_TAGS_RESPONSE) });
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.equal(result.count, 2);
    assert.equal(result.models[0].name, 'llama3:8b');
    assert.equal(result.models[0].family, 'llama');
  });

  test('connection refused returns success:false with helpful error', async () => {
    const tool = new ListOllamaModelsStub({ fetchFn: makeFetch(0, null, 'ECONNREFUSED') });
    const result = await tool.execute();
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Could not reach Ollama'));
  });

  test('non-200 HTTP status returns success:false', async () => {
    const tool = new ListOllamaModelsStub({ fetchFn: makeFetch(503, {}) });
    const result = await tool.execute();
    assert.equal(result.success, false);
    assert.ok(result.error.includes('503'));
  });

  test('invalid JSON body returns success:false', async () => {
    const brokenFetch = async () => ({
      ok: true, status: 200,
      json: async () => { throw new SyntaxError('Unexpected token'); }
    });
    const tool = new ListOllamaModelsStub({ fetchFn: brokenFetch });
    const result = await tool.execute();
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Invalid JSON'));
  });

  test('empty models array returns count:0', async () => {
    const tool = new ListOllamaModelsStub({ fetchFn: makeFetch(200, { models: [] }) });
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.equal(result.count, 0);
    assert.deepEqual(result.models, []);
  });

  test('custom baseUrl is used in requests', async () => {
    let calledUrl = null;
    const captureFetch = async (url) => { calledUrl = url; return { ok: true, status: 200, json: async () => ({ models: [] }) }; };
    const tool = new ListOllamaModelsStub({ fetchFn: captureFetch, baseUrl: 'http://myserver:11434' });
    await tool.execute();
    assert.ok(calledUrl.startsWith('http://myserver:11434'));
  });
});

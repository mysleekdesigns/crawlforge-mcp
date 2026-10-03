/**
 * R24 Phase 3.5 — model selection for schema extraction, and reporting it.
 *
 * Run: node --test --test-force-exit tests/unit/r24p3-llm-model.test.js
 *
 * Live (2026-10-03): extract_with_llm auto-picked gemma3:4b with gemma3:12b
 * installed, and on the R24 pages 4b answered hono.dev's version as "latest"
 * and djangoproject.com's LTS patch from the wrong row, where 12b answered
 * null and 5.2.17. extract_structured did not say which model ran at all.
 * A stub Ollama server answers each chat with the model it was asked to run.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const saved = {
  base: process.env.OLLAMA_BASE_URL,
  model: process.env.OLLAMA_DEFAULT_MODEL,
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY
};
delete process.env.OLLAMA_DEFAULT_MODEL;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { selectOllamaModel } = await import('../../src/utils/ollamaConfig.js');
const { LLMManager } = await import('../../src/core/llm/LLMManager.js');
const { ExtractWithLlm } = await import('../../src/tools/extract/extractWithLlm.js');

let server;
let installed = [];

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.endsWith('/api/tags')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: installed.map((name) => ({ name })) }));
      return;
    }
    if (req.url.endsWith('/api/chat')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { model } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model, message: { role: 'assistant', content: JSON.stringify({ ran: model }) }, done: true }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [key, env] of [['base', 'OLLAMA_BASE_URL'], ['model', 'OLLAMA_DEFAULT_MODEL'], ['openai', 'OPENAI_API_KEY'], ['anthropic', 'ANTHROPIC_API_KEY']]) {
    if (saved[key] === undefined) delete process.env[env];
    else process.env[env] = saved[key];
  }
});

beforeEach(() => {
  delete process.env.OLLAMA_DEFAULT_MODEL;
});

/** A distinct path per case defeats the per-base-URL installed-model cache. */
function freshEndpoint(tag) {
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${server.address().port}/${tag}`;
}

describe('the extraction role', () => {
  test('prefers gemma3:12b over gemma3:4b; the default role is unchanged', async () => {
    installed = ['gemma3:4b', 'gemma3:12b', 'gemma4:31b', 'llama3.2:latest'];
    freshEndpoint('role-both');
    assert.equal(await selectOllamaModel('extraction'), 'gemma3:12b');
    assert.equal(await selectOllamaModel(), 'gemma3:4b', 'agent / scrape json keep the faster default');
  });

  test('falls through to the default ranking when gemma3:12b is absent', async () => {
    installed = ['llama3.2:latest', 'gemma3:4b'];
    freshEndpoint('role-absent');
    assert.equal(await selectOllamaModel('extraction'), 'gemma3:4b');
  });

  test('OLLAMA_DEFAULT_MODEL still wins', async () => {
    installed = ['gemma3:4b', 'gemma3:12b'];
    freshEndpoint('role-pinned');
    process.env.OLLAMA_DEFAULT_MODEL = 'mistral:7b';
    assert.equal(await selectOllamaModel('extraction'), 'mistral:7b');
  });
});

describe('LLMManager.extractStructured reports what answered', () => {
  test('provider and model come back with the data, from the extraction role', async () => {
    installed = ['gemma3:4b', 'gemma3:12b'];
    freshEndpoint('manager');
    const manager = new LLMManager({ defaultProvider: 'ollama' });
    const result = await manager.extractStructured('page text', { type: 'object', properties: { ran: { type: 'string' } } });
    assert.equal(result.method, 'llm');
    assert.equal(result.data.ran, 'gemma3:12b', 'the extraction-role model was the one asked');
    assert.equal(result.provider, 'ollama');
    assert.equal(result.model, 'gemma3:12b');
  });

  test('generateCompletion without answeredBy is unchanged (still returns text)', async () => {
    installed = ['gemma3:4b'];
    freshEndpoint('plain');
    const manager = new LLMManager({ defaultProvider: 'ollama' });
    assert.equal(await manager.generateCompletion('x'), JSON.stringify({ ran: 'gemma3:4b' }));
  });
});

describe('extract_with_llm auto-selection', () => {
  test('auto picks the extraction-role model and reports it', async () => {
    installed = ['gemma3:4b', 'gemma3:12b'];
    freshEndpoint('ewl');
    const result = await new ExtractWithLlm().execute({ content: 'Hono 4.6.0', prompt: 'which model ran', verify_numbers: false });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.model, 'gemma3:12b');
    assert.equal(result.data.ran, 'gemma3:12b');
  });
});

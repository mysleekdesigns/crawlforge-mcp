/**
 * Unit tests: Ollama provider registration in LLMManager.
 *
 * Run: node --test tests/unit/llmManagerOllama.test.js
 *
 * Regression (2026-08-25): LLMManager only ever registered OpenAI and
 * Anthropic, both gated on an API key. On a machine running Ollama with no
 * cloud keys, isAvailable() returned false, so extract_structured skipped LLM
 * extraction entirely and reported extraction_method "css_fallback", and
 * deep_research silently disabled every LLM feature (ResearchOrchestrator
 * reads isAvailable() in its constructor).
 *
 * A stub Ollama server stands in for the real one so the tests neither require
 * nor accidentally use a locally-installed Ollama.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const savedEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  DISABLE_OLLAMA: process.env.DISABLE_OLLAMA
};
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISABLE_OLLAMA;

const { LLMManager } = await import('../../src/core/llm/LLMManager.js');

let server;
/** Last /api/chat request body, so tests can assert on what was sent. */
let lastChatBody = null;
/** Canned reply for /api/chat. */
let chatContent = '{"title":"Widget Pro","price":"$49.99"}';

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }));
      return;
    }
    if (req.url === '/api/chat') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        lastChatBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: chatContent } }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  lastChatBody = null;
  chatContent = '{"title":"Widget Pro","price":"$49.99"}';
});

describe('LLMManager + Ollama', () => {
  test('a reachable Ollama makes the manager available with no API key set', async () => {
    const manager = new LLMManager({});
    assert.ok(manager.providers.has('ollama'), 'ollama must be registered');
    assert.equal(await manager.ready(), true, 'a reachable Ollama means an LLM is available');
    assert.equal(manager.defaultProvider, 'ollama');
  });

  test('an unreachable Ollama is de-registered rather than reported as available', async () => {
    const saved = process.env.OLLAMA_BASE_URL;
    // Port 1 is reserved and refuses immediately.
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
    try {
      const manager = new LLMManager({});
      assert.equal(await manager.ready(), false);
      assert.equal(manager.providers.has('ollama'), false);
      assert.equal(manager.isAvailable(), false, 'isAvailable() is accurate once probed');
    } finally {
      process.env.OLLAMA_BASE_URL = saved;
    }
  });

  test('the reachability probe runs once and is cached', async () => {
    const manager = new LLMManager({});
    let probes = 0;
    const provider = manager.providers.get('ollama');
    const original = provider.isAvailable.bind(provider);
    provider.isAvailable = async () => { probes++; return original(); };

    await manager.ready();
    await manager.ready();
    await manager.ready();
    assert.equal(probes, 1, 'ready() must not re-probe on every call');
  });

  test('DISABLE_OLLAMA keeps the provider out (so tests stay off a dev machine\'s Ollama)', async () => {
    process.env.DISABLE_OLLAMA = 'true';
    try {
      const manager = new LLMManager({});
      assert.equal(manager.providers.has('ollama'), false);
      assert.equal(await manager.ready(), false);
    } finally {
      delete process.env.DISABLE_OLLAMA;
    }
  });

  test('a configured cloud provider still outranks the local default', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    try {
      const manager = new LLMManager({});
      assert.equal(manager.defaultProvider, 'openai');
      assert.equal(manager.fallbackProvider, 'ollama', 'ollama is the fallback, not the primary');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  test('extractStructured routes through Ollama and reports method "llm"', async () => {
    const manager = new LLMManager({});
    await manager.ready();

    const schema = { type: 'object', properties: { title: { type: 'string' }, price: { type: 'string' } }, required: ['title'] };
    const result = await manager.extractStructured('Widget Pro costs $49.99', schema);

    assert.equal(result.method, 'llm');
    assert.deepEqual(result.data, { title: 'Widget Pro', price: '$49.99' });
    assert.equal(result.valid, true);
    assert.equal(lastChatBody.format, 'json', 'output must be constrained to JSON');
    assert.equal(lastChatBody.stream, false);
  });

  test('an LLM reply that is not JSON is reported as a fallback, not as an LLM extraction', async () => {
    chatContent = 'Sure! Here is what I found on the page.';
    const manager = new LLMManager({});
    await manager.ready();

    const schema = { type: 'object', properties: { title: { type: 'string' } } };
    const result = await manager.extractStructured('Widget Pro', schema);

    assert.equal(result.method, 'keyword_fallback', 'a failed parse must not be labelled "llm"');
    assert.ok(result.error, 'the parse failure is surfaced to the caller');
  });
});

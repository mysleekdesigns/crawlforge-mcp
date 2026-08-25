/**
 * Unit tests: schema-echo detection in extract_with_llm.
 *
 * Run: node --test tests/unit/extractWithLlmSchemaEcho.test.js
 *
 * Regression (2026-08-25): the schema is embedded in the prompt as an output
 * hint, and on long inputs the model latches onto it and returns the schema
 * document instead of page data:
 *
 *   {"type":"object","properties":{"title":{"type":"null"},"price":{"type":"null"}}}
 *
 * That is well-formed JSON, so it parsed; and with no required fields declared
 * it also passed schema validation. It reached callers as
 * success:true with confident-looking nonsense as `data`.
 *
 * A stub Ollama server drives the responses so the failure is deterministic —
 * against a live model the echo is intermittent and cannot be pinned in a test.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const savedBaseUrl = process.env.OLLAMA_BASE_URL;
const { ExtractWithLlm } = await import('../../src/tools/extract/extractWithLlm.js');

let server;
/** Queue of canned /api/chat reply strings; the last one repeats. */
let replies = [];
let callCount = 0;

before(async () => {
  server = http.createServer((req, res) => {
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (savedBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = savedBaseUrl;
});

beforeEach(() => {
  callCount = 0;
  replies = [];
});

const SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, price: { type: 'string' } }
};

const run = (schema = SCHEMA) =>
  new ExtractWithLlm().execute({
    content: 'Widget Pro. Price: $49.99.',
    prompt: 'Extract structured data from this page content.',
    schema,
    provider: 'ollama'
  });

describe('extract_with_llm schema-echo detection', () => {
  test('a full schema document is retried, then reported as a failure', async () => {
    const echo = JSON.stringify({ type: 'object', properties: { title: { type: 'null' }, price: { type: 'null' } } });
    replies = [echo, echo];

    const result = await run();

    assert.equal(result.success, false, 'a schema echo must not be reported as a successful extraction');
    assert.match(result.error, /echoed the output schema/i);
    assert.equal(callCount, 2, 'the echo should be retried once before giving up');
  });

  test('per-field type declarations are caught too', async () => {
    // No "properties" wrapper — just the property map echoed back.
    const echo = JSON.stringify({ title: { type: 'string' }, price: { type: 'string' } });
    replies = [echo, echo];

    const result = await run();
    assert.equal(result.success, false);
    assert.match(result.error, /echoed the output schema/i);
  });

  test('a retry that returns real data succeeds', async () => {
    replies = [
      JSON.stringify({ type: 'object', properties: { title: { type: 'null' } } }),
      JSON.stringify({ title: 'Widget Pro', price: '$49.99' })
    ];

    const result = await run();
    assert.equal(result.success, true);
    assert.deepEqual(result.data, { title: 'Widget Pro', price: '$49.99' });
    assert.equal(callCount, 2);
  });

  test('genuine data is never mistaken for an echo', async () => {
    replies = [JSON.stringify({ title: 'Widget Pro', price: '$49.99' })];

    const result = await run();
    assert.equal(result.success, true);
    assert.equal(callCount, 1, 'valid output must not trigger a retry');
    assert.deepEqual(result.data, { title: 'Widget Pro', price: '$49.99' });
  });

  test('a field the caller declared as an object may legitimately hold a "type" key', async () => {
    const schema = {
      type: 'object',
      properties: { address: { type: 'object' } }
    };
    replies = [JSON.stringify({ address: { type: 'home', city: 'Boston' } })];

    const result = await run(schema);
    assert.equal(result.success, true, 'a declared object field is not a type declaration');
    assert.deepEqual(result.data, { address: { type: 'home', city: 'Boston' } });
  });

  test('a caller asking for a field named "properties" is not flagged', async () => {
    const schema = {
      type: 'object',
      properties: { properties: { type: 'string' } }
    };
    replies = [JSON.stringify({ properties: 'three bedrooms' })];

    const result = await run(schema);
    assert.equal(result.success, true);
    assert.deepEqual(result.data, { properties: 'three bedrooms' });
  });
});

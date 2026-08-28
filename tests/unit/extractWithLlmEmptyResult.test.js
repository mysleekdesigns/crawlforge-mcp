/**
 * Unit tests: empty-result detection in extract_with_llm.
 *
 * Run: node --test tests/unit/extractWithLlmEmptyResult.test.js
 *
 * Regression (2026-08-27): a schemaless prompt against python.org with the
 * auto-selected gemma3:4b answered with `{}` and 2 output tokens. That parses,
 * it is not a schema echo, and there was no guard for it — so it reached the
 * caller as success:true with `data: {}`, indistinguishable from a page that
 * genuinely holds nothing.
 *
 * Same stub-Ollama approach as extractWithLlmSchemaEcho.test.js: against a live
 * model the empty answer is intermittent and cannot be pinned in a test.
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

/** Schemaless, like the python.org call that exposed the gap. */
const run = (extra = {}) =>
  new ExtractWithLlm().execute({
    content: 'Python 3.14.7 is the latest release. Python is a programming language that lets you work quickly.',
    prompt: 'Extract the latest Python version and the site tagline',
    provider: 'ollama',
    model: 'stub-model',
    ...extra
  });

describe('extract_with_llm empty-result detection', () => {
  test('{} is retried, then reported as a failure naming the model', async () => {
    replies = ['{}', '{}'];

    const result = await run();

    assert.equal(result.success, false, '{} must not be reported as a successful extraction');
    assert.match(result.error, /stub-model/, 'the failure must name the model that produced it');
    assert.match(result.error, /OLLAMA_DEFAULT_MODEL/, 'the remedy must be stated');
    assert.equal(callCount, 2, 'an empty result should be retried once before giving up');
  });

  test('[] is empty too', async () => {
    replies = ['[]', '[]'];

    const result = await run();
    assert.equal(result.success, false);
    assert.equal(callCount, 2);
  });

  test('an object whose every value is null/blank/[] is empty', async () => {
    const blank = JSON.stringify({ version: null, tagline: '', links: [] });
    replies = [blank, blank];

    const result = await run();
    assert.equal(result.success, false);
    assert.match(result.error, /every field was empty/i);
  });

  test('emptiness is judged through nesting', async () => {
    const blank = JSON.stringify({ releases: [{ version: null }, { version: '  ' }] });
    replies = [blank, blank];

    const result = await run();
    assert.equal(result.success, false);
  });

  test('a retry that returns real data succeeds', async () => {
    replies = ['{}', JSON.stringify({ version: '3.14.7', tagline: 'Work quickly' })];

    const result = await run();
    assert.equal(result.success, true);
    assert.deepEqual(result.data, { version: '3.14.7', tagline: 'Work quickly' });
    assert.equal(callCount, 2);
  });

  test('zero and false are data, not emptiness', async () => {
    replies = [JSON.stringify({ count: 0, found: false })];

    const result = await run();
    assert.equal(result.success, true, 'a legitimate zero/false answer must not be rejected');
    assert.equal(callCount, 1, 'real data must not trigger a retry');
    assert.deepEqual(result.data, { count: 0, found: false });
  });

  test('one populated field is enough', async () => {
    replies = [JSON.stringify({ version: '3.14.7', tagline: null })];

    const result = await run();
    assert.equal(result.success, true);
    assert.equal(callCount, 1);
  });

  test('a non-empty array of records is data', async () => {
    replies = [JSON.stringify([{ version: '3.14.7' }])];

    const result = await run();
    assert.equal(result.success, true);
    assert.equal(callCount, 1);
    assert.deepEqual(result.data, [{ version: '3.14.7' }]);
  });

  test('an empty result is caught with a schema hint too', async () => {
    const schema = { type: 'object', properties: { version: { type: 'string' } } };
    replies = ['{}', '{}'];

    const result = await run({ schema });
    assert.equal(result.success, false, 'schema validation with no required fields passes {} — the guard must not');
    assert.match(result.error, /stub-model/);
  });
});

/**
 * Unit tests for src/tools/extract/extractWithLlm.js
 *
 * Run: node --test tests/unit/extractWithLlm.test.js
 *
 * Tests mock global fetch to intercept both LLM API calls (OpenAI / Anthropic)
 * and URL fetch calls, avoiding any need for real network or TCP listeners.
 *
 * Coverage:
 *  1.  provider auto-pick: prefers Anthropic when ANTHROPIC_API_KEY is set
 *  2.  provider auto-pick: falls back to OpenAI when only OPENAI_API_KEY is set
 *  3.  error when neither key is present
 *  4.  JSON parse success — OpenAI path
 *  5.  JSON parse success — Anthropic path
 *  6.  JSON parse retry: bad JSON on first call, valid JSON on retry
 *  7.  JSON parse final failure: both calls return non-JSON
 *  8.  URL fetch + extract path
 *  9.  content-direct path (no URL)
 * 10.  schema hint passed through in user message
 * 11.  token usage returned and normalized (OpenAI uses prompt_tokens)
 * 12.  token usage returned — Anthropic uses input_tokens natively
 * 13.  error when neither url nor content provided
 * 14.  error when prompt is missing
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ── Stub response builders ────────────────────────────────────────────────────

function openaiSuccess(data) {
  return {
    id: 'chatcmpl-test',
    model: 'gpt-4o-mini',
    choices: [{ message: { role: 'assistant', content: JSON.stringify(data) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 }
  };
}

function anthropicSuccess(data) {
  return {
    id: 'msg-test',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: JSON.stringify(data) }],
    usage: { input_tokens: 80, output_tokens: 40 }
  };
}

function ollamaSuccess(data, model = 'llama3.2') {
  return {
    model,
    message: { role: 'assistant', content: JSON.stringify(data) },
    done: true,
    prompt_eval_count: 60,
    eval_count: 30
  };
}

/** Minimal fetch mock that returns a JSON response body. */
function makeFetchMock(handler) {
  return async (url, options) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const result = await handler(urlStr, options);
    const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      statusText: result.statusText ?? String(result.status),
      url: urlStr,
      text: async () => body,
      json: async () => JSON.parse(body)
    };
  };
}

// ── Environment helper ────────────────────────────────────────────────────────

const ENV_KEYS = [
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL',
  'OLLAMA_BASE_URL', 'OLLAMA_DEFAULT_MODEL'
];

function withEnv(vars, fn) {
  const saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ExtractWithLlm', () => {
  let Tool;
  let originalFetch;

  before(async () => {
    const mod = await import('../../src/tools/extract/extractWithLlm.js');
    Tool = mod.ExtractWithLlm;
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(handler) {
    globalThis.fetch = makeFetchMock(handler);
  }

  // Fake HTML page served for URL tests
  const FAKE_HTML = '<html><body><h1>Test Page</h1><p>Hello from stub page.</p></body></html>';
  const FAKE_PAGE_URL = 'https://example-test.invalid/page';

  // ── Tests ──────────────────────────────────────────────────────────────────

  test('1. auto provider: picks Anthropic when ANTHROPIC_API_KEY is set', async () => {
    await withEnv({
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      OPENAI_API_KEY: 'test-openai-key'
    }, async () => {
      let calledUrl = '';
      mockFetch(async (url) => {
        calledUrl = url;
        if (url.includes('/v1/messages')) {
          return { status: 200, body: anthropicSuccess({ name: 'Alice' }) };
        }
        return { status: 500, body: { error: 'wrong endpoint' } };
      });

      const result = await new Tool().execute({
        content: 'Name: Alice', prompt: 'Extract the name', provider: 'auto'
      });

      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.equal(result.provider, 'anthropic');
      assert.deepEqual(result.data, { name: 'Alice' });
      assert.ok(calledUrl.includes('/v1/messages'), `should call Anthropic, called: ${calledUrl}`);
    });
  });

  test('2. auto provider: falls back to OpenAI when only OPENAI_API_KEY is set', async () => {
    await withEnv({ OPENAI_API_KEY: 'test-openai-key' }, async () => {
      let calledUrl = '';
      mockFetch(async (url) => {
        calledUrl = url;
        if (url.includes('/v1/chat/completions')) {
          return { status: 200, body: openaiSuccess({ name: 'Bob' }) };
        }
        return { status: 500, body: { error: 'wrong endpoint' } };
      });

      const result = await new Tool().execute({
        content: 'Name: Bob', prompt: 'Extract the name', provider: 'auto'
      });

      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.equal(result.provider, 'openai');
      assert.deepEqual(result.data, { name: 'Bob' });
      assert.ok(calledUrl.includes('/v1/chat/completions'), `should call OpenAI, called: ${calledUrl}`);
    });
  });

  test('3. error when neither key is present', async () => {
    await withEnv({}, async () => {
      const result = await new Tool().execute({
        content: 'some text', prompt: 'extract something', provider: 'auto'
      });
      assert.equal(result.success, false);
      assert.ok(
        result.error.includes('OPENAI_API_KEY') || result.error.includes('ANTHROPIC_API_KEY'),
        `error should mention missing keys, got: ${result.error}`
      );
    });
  });

  test('4. JSON parse success — OpenAI path', async () => {
    await withEnv({ OPENAI_API_KEY: 'key' }, async () => {
      const expected = { title: 'Hello World', author: 'Test' };
      mockFetch(async () => ({ status: 200, body: openaiSuccess(expected) }));
      const result = await new Tool().execute({
        content: '<h1>Hello World</h1><p>By Test</p>',
        prompt: 'Extract title and author',
        provider: 'openai'
      });
      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.deepEqual(result.data, expected);
      assert.equal(result.provider, 'openai');
    });
  });

  test('5. JSON parse success — Anthropic path', async () => {
    await withEnv({ ANTHROPIC_API_KEY: 'key' }, async () => {
      const expected = { price: 9.99, currency: 'USD' };
      mockFetch(async () => ({ status: 200, body: anthropicSuccess(expected) }));
      const result = await new Tool().execute({
        content: 'Price: $9.99 USD',
        prompt: 'Extract price and currency',
        provider: 'anthropic'
      });
      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.deepEqual(result.data, expected);
      assert.equal(result.provider, 'anthropic');
    });
  });

  test('6. JSON parse retry: bad JSON on first call, valid JSON on retry', async () => {
    await withEnv({ OPENAI_API_KEY: 'key' }, async () => {
      let callCount = 0;
      mockFetch(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 200,
            body: {
              choices: [{ message: { role: 'assistant', content: 'not valid json at all!' } }],
              usage: { prompt_tokens: 10, completion_tokens: 5 }
            }
          };
        }
        return { status: 200, body: openaiSuccess({ retried: true }) };
      });
      const result = await new Tool().execute({
        content: 'some data', prompt: 'extract it', provider: 'openai'
      });
      assert.ok(result.success, `should succeed on retry, got: ${JSON.stringify(result)}`);
      assert.deepEqual(result.data, { retried: true });
      assert.equal(callCount, 2, 'should have made exactly 2 calls');
    });
  });

  test('7. JSON parse final failure: both calls return non-JSON', async () => {
    await withEnv({ OPENAI_API_KEY: 'key' }, async () => {
      mockFetch(async () => ({
        status: 200,
        body: {
          choices: [{ message: { role: 'assistant', content: 'still not json' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        }
      }));
      const result = await new Tool().execute({
        content: 'some data', prompt: 'extract it', provider: 'openai'
      });
      assert.equal(result.success, false);
      assert.ok(result.error.includes('JSON'), `error should mention JSON, got: ${result.error}`);
      assert.ok('raw' in result, 'should include raw response');
    });
  });

  test('8. URL fetch + extract path', async () => {
    await withEnv({ OPENAI_API_KEY: 'key' }, async () => {
      mockFetch(async (url) => {
        if (url === FAKE_PAGE_URL) {
          return { status: 200, body: FAKE_HTML };
        }
        if (url.includes('/v1/chat/completions')) {
          return { status: 200, body: openaiSuccess({ heading: 'Test Page' }) };
        }
        return { status: 404, body: 'not found' };
      });
      const result = await new Tool().execute({
        url: FAKE_PAGE_URL,
        prompt: 'Extract the heading',
        provider: 'openai'
      });
      assert.ok(result.success, `URL fetch should succeed, got: ${JSON.stringify(result)}`);
      assert.deepEqual(result.data, { heading: 'Test Page' });
    });
  });

  test('9. content-direct path: content provided instead of URL', async () => {
    await withEnv({ OPENAI_API_KEY: 'key' }, async () => {
      mockFetch(async () => ({ status: 200, body: openaiSuccess({ items: [1, 2, 3] }) }));
      const result = await new Tool().execute({
        content: 'items: 1, 2, 3',
        prompt: 'Extract list of items',
        provider: 'openai'
      });
      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.deepEqual(result.data, { items: [1, 2, 3] });
    });
  });

  test('10. schema hint is passed through to LLM in user message', async () => {
    await withEnv({ OPENAI_API_KEY: 'key' }, async () => {
      let capturedBody = null;
      mockFetch(async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { status: 200, body: openaiSuccess({ x: 1 }) };
      });
      const schema = { type: 'object', properties: { x: { type: 'number' } } };
      await new Tool().execute({
        content: 'x equals one', prompt: 'Get x value', schema, provider: 'openai'
      });
      assert.ok(capturedBody !== null, 'fetch should have been called');
      const userMsg = capturedBody.messages.find(m => m.role === 'user')?.content ?? '';
      assert.ok(
        userMsg.includes('"properties"'),
        `schema hint should appear in user message, got: ${userMsg.slice(0, 300)}`
      );
    });
  });

  test('11. token usage normalized: OpenAI prompt_tokens -> input_tokens', async () => {
    await withEnv({ OPENAI_API_KEY: 'key' }, async () => {
      mockFetch(async () => ({ status: 200, body: openaiSuccess({ v: 1 }) }));
      const result = await new Tool().execute({
        content: 'text', prompt: 'extract v', provider: 'openai'
      });
      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.ok('usage' in result, 'should have usage field');
      assert.ok('input_tokens' in result.usage, 'should have input_tokens');
      assert.ok('output_tokens' in result.usage, 'should have output_tokens');
      assert.equal(result.usage.input_tokens, 100);
      assert.equal(result.usage.output_tokens, 50);
    });
  });

  test('12. token usage: Anthropic uses input_tokens natively', async () => {
    await withEnv({ ANTHROPIC_API_KEY: 'key' }, async () => {
      mockFetch(async () => ({ status: 200, body: anthropicSuccess({ v: 2 }) }));
      const result = await new Tool().execute({
        content: 'text', prompt: 'extract v', provider: 'anthropic'
      });
      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.equal(result.usage.input_tokens, 80);
      assert.equal(result.usage.output_tokens, 40);
    });
  });

  test('13. error when neither url nor content provided', async () => {
    await withEnv({ OPENAI_API_KEY: 'key' }, async () => {
      const result = await new Tool().execute({ prompt: 'extract something', provider: 'openai' });
      assert.equal(result.success, false);
      assert.ok(
        result.error.includes('url') || result.error.includes('content'),
        `error should mention url/content, got: ${result.error}`
      );
    });
  });

  test('14. error when prompt is missing', async () => {
    await withEnv({ OPENAI_API_KEY: 'key' }, async () => {
      const result = await new Tool().execute({ content: 'some text', provider: 'openai' });
      assert.equal(result.success, false);
      assert.ok(
        result.error.includes('prompt'),
        `error should mention prompt, got: ${result.error}`
      );
    });
  });

  // ── Ollama tests ─────────────────────────────────────────────────────────────

  test('15. ollama: explicit provider works with no API keys set', async () => {
    await withEnv({ OLLAMA_BASE_URL: 'http://localhost:11434' }, async () => {
      let calledUrl = '';
      let capturedBody = null;
      mockFetch(async (url, opts) => {
        calledUrl = url;
        capturedBody = JSON.parse(opts.body);
        return { status: 200, body: ollamaSuccess({ city: 'Paris' }) };
      });
      const result = await new Tool().execute({
        content: 'Capital of France is Paris',
        prompt: 'Extract the city',
        provider: 'ollama'
      });
      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.equal(result.provider, 'ollama');
      assert.equal(result.model, 'llama3.2');
      assert.deepEqual(result.data, { city: 'Paris' });
      assert.ok(calledUrl.includes('/api/chat'), `should call /api/chat, called: ${calledUrl}`);
      assert.equal(capturedBody.format, 'json', 'should send format: "json" when no schema');
      assert.equal(capturedBody.stream, false);
    });
  });

  test('16. ollama: schema is sent as structured-outputs format', async () => {
    await withEnv({}, async () => {
      let capturedBody = null;
      mockFetch(async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { status: 200, body: ollamaSuccess({ x: 7 }) };
      });
      const schema = { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] };
      const result = await new Tool().execute({
        content: 'x is seven',
        prompt: 'extract x',
        schema,
        provider: 'ollama'
      });
      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.deepEqual(capturedBody.format, schema, 'schema should be passed as format object');
    });
  });

  test('17. ollama: ECONNREFUSED yields friendly "not running" error', async () => {
    await withEnv({}, async () => {
      globalThis.fetch = async () => {
        const err = new Error('fetch failed');
        err.cause = { code: 'ECONNREFUSED' };
        throw err;
      };
      const result = await new Tool().execute({
        content: 'anything', prompt: 'extract', provider: 'ollama'
      });
      assert.equal(result.success, false);
      assert.ok(
        /Ollama is not running/i.test(result.error),
        `expected friendly not-running message, got: ${result.error}`
      );
      assert.ok(
        /ollama serve|ollama pull/i.test(result.error),
        `expected install hints, got: ${result.error}`
      );
    });
  });

  test('18. ollama: token usage normalized from prompt_eval_count / eval_count', async () => {
    await withEnv({}, async () => {
      mockFetch(async () => ({ status: 200, body: ollamaSuccess({ ok: true }) }));
      const result = await new Tool().execute({
        content: 'text', prompt: 'is it ok?', provider: 'ollama'
      });
      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.equal(result.usage.input_tokens, 60);
      assert.equal(result.usage.output_tokens, 30);
    });
  });

  test('19. auto: does NOT pick ollama when no cloud key and no OLLAMA_BASE_URL', async () => {
    await withEnv({}, async () => {
      const result = await new Tool().execute({
        content: 'text', prompt: 'extract', provider: 'auto'
      });
      assert.equal(result.success, false);
      assert.ok(
        result.error.includes('OPENAI_API_KEY') || result.error.includes('ANTHROPIC_API_KEY'),
        `error should mention missing keys, got: ${result.error}`
      );
    });
  });

  test('20. auto: cloud keys still take priority over OLLAMA_BASE_URL', async () => {
    await withEnv({
      OPENAI_API_KEY: 'k',
      OLLAMA_BASE_URL: 'http://localhost:11434'
    }, async () => {
      let calledUrl = '';
      mockFetch(async (url) => {
        calledUrl = url;
        return { status: 200, body: openaiSuccess({ a: 1 }) };
      });
      const result = await new Tool().execute({
        content: 'a is 1', prompt: 'extract a', provider: 'auto'
      });
      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.equal(result.provider, 'openai');
      assert.ok(calledUrl.includes('/v1/chat/completions'));
    });
  });

  test('21. auto: falls back to ollama when OLLAMA_BASE_URL set and no cloud keys', async () => {
    await withEnv({ OLLAMA_BASE_URL: 'http://localhost:11434' }, async () => {
      mockFetch(async () => ({ status: 200, body: ollamaSuccess({ ok: true }) }));
      const result = await new Tool().execute({
        content: 'text', prompt: 'extract', provider: 'auto'
      });
      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.equal(result.provider, 'ollama');
    });
  });

  test('22. ollama: model param overrides default llama3.2', async () => {
    await withEnv({}, async () => {
      let capturedBody = null;
      mockFetch(async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { status: 200, body: ollamaSuccess({ ok: true }, 'qwen2.5') };
      });
      const result = await new Tool().execute({
        content: 'text', prompt: 'extract', provider: 'ollama', model: 'qwen2.5'
      });
      assert.ok(result.success, `should succeed, got: ${JSON.stringify(result)}`);
      assert.equal(capturedBody.model, 'qwen2.5');
      assert.equal(result.model, 'qwen2.5');
    });
  });
});

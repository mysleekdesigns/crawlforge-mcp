/**
 * SamplingClient — fallback chain (Ollama → server-side key → MCP sampling)
 * and the 4.5 deprecation notice on the MCP-sampling rung.
 * Run: node --test tests/unit/samplingClient.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SamplingClient } from '../../src/core/SamplingClient.js';

const DEPRECATION_MARKER = '[deprecation] MCP sampling';

const realFetch = globalThis.fetch;
const realConsoleError = console.error;
const savedEnv = {};
let stderrLines;

/** Capture console.error (stderr) and pin the env the chain reads. */
beforeEach(() => {
  stderrLines = [];
  console.error = (...args) => stderrLines.push(args.join(' '));
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OLLAMA_DEFAULT_MODEL']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // Skip the /api/tags probe inside selectOllamaModel so only /api/generate
  // reaches the stub below.
  process.env.OLLAMA_DEFAULT_MODEL = 'gemma3:4b';
});

afterEach(() => {
  console.error = realConsoleError;
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Route stubbed responses by URL substring; anything unmatched throws. */
function stubFetch(routes) {
  globalThis.fetch = async (url) => {
    const href = String(url);
    for (const [needle, respond] of Object.entries(routes)) {
      if (href.includes(needle)) return respond();
    }
    throw new Error(`connection refused: ${href}`);
  };
}

const jsonResponse = (body) => ({ ok: true, json: async () => body });

/** SamplingClient options whose rung-3 MCP sampling is available and returns `text`. */
const samplingServer = (text) => ({
  mcpServer: {
    server: {
      createMessage: async () => ({ content: { type: 'text', text } }),
    },
  },
});

describe('SamplingClient fallback chain', () => {
  test('rung 1 (Ollama) serves and emits no deprecation notice', async () => {
    stubFetch({ '11434': () => jsonResponse({ response: 'from ollama' }) });
    const client = new SamplingClient(samplingServer('from sampling'));

    const result = await client.complete('hi');

    assert.deepEqual(result, { text: 'from ollama', provider: 'ollama' });
    assert.equal(stderrLines.some((l) => l.includes(DEPRECATION_MARKER)), false);
  });

  test('rung 2 (server-side key) serves and emits no deprecation notice', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    stubFetch({
      'api.openai.com': () => jsonResponse({ choices: [{ message: { content: 'from openai' } }] }),
    });
    const client = new SamplingClient(samplingServer('from sampling'));

    const result = await client.complete('hi');

    assert.deepEqual(result, { text: 'from openai', provider: 'openai' });
    assert.equal(stderrLines.some((l) => l.includes(DEPRECATION_MARKER)), false);
  });

  test('rung 3 (MCP sampling) serves and emits the deprecation notice naming 2027-07-28', async () => {
    stubFetch({});
    const client = new SamplingClient(samplingServer('from sampling'));

    const result = await client.complete('hi');

    assert.deepEqual(result, { text: 'from sampling', provider: 'sampling' });
    const notice = stderrLines.filter((l) => l.includes(DEPRECATION_MARKER));
    assert.equal(notice.length, 1, 'exactly one deprecation line');
    assert.match(notice[0], /2026-07-28/);
    assert.match(notice[0], /2027-07-28/);
  });

  test('no notice when sampling returns empty text — the chain still fails', async () => {
    stubFetch({});
    const client = new SamplingClient(samplingServer(''));

    await assert.rejects(() => client.complete('hi'), /No LLM available/);
    assert.equal(stderrLines.some((l) => l.includes(DEPRECATION_MARKER)), false);
  });

  test('no notice when there is no MCP server at all', async () => {
    stubFetch({});
    const client = new SamplingClient({});

    await assert.rejects(() => client.complete('hi'), /No LLM available/);
    assert.equal(stderrLines.some((l) => l.includes(DEPRECATION_MARKER)), false);
  });
});

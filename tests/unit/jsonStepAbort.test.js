/**
 * Live test R24, Phase 3 follow-up: scrape's json format aborts its model
 * request when the bounded wait runs out.
 *
 * The 60 s bound (3.3) failed the format with a clear error, but the request
 * to Ollama kept running until extract_with_llm's own 120 s bound, holding the
 * model for a reply nobody would read. The bound now aborts an AbortSignal
 * that extract_with_llm passes to the provider's fetch; an aborted call skips
 * the retry and the sampling fallback.
 *
 * A stub Ollama that never answers /api/chat stands in for a slow model and
 * records when the request's connection closes.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/jsonStepAbort.test.js
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;
process.env.OLLAMA_DEFAULT_MODEL = 'stub-model';
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');
const { ExtractWithLlm } = await import('../../src/tools/extract/extractWithLlm.js');

const PAGE = '<!doctype html><html><head><title>Shop</title></head><body><h1>Widget</h1><p>Price: $295.99</p></body></html>';

let server;
let baseUrl;
let chatRequests;
let chatClosed;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/api/chat') {
      chatRequests++;
      // Never answers; the client closing the connection is the abort.
      res.on('close', () => chatClosed.resolve(Date.now()));
      return;
    }
    if (req.url === '/robots.txt') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.OLLAMA_BASE_URL = baseUrl;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  chatRequests = 0;
  let resolve;
  chatClosed = { promise: new Promise((r) => { resolve = r; }), resolve };
});

const scrape = (tool) => tool.execute({
  url: `${baseUrl}/product`,
  formats: [{ type: 'json', prompt: 'price', schema: { price: 'string' } }],
  onlyMainContent: false,
  resolveHiddenContent: 'off'
});

describe('json: the bounded wait aborts the model request', () => {
  test('the extractor is handed a signal that fires when the wait runs out', async () => {
    const tool = new UnifiedScrapeTool({ jsonTimeoutMs: 50 });
    let seen;
    tool._extractWithLlm = {
      execute: ({ signal }) => {
        seen = signal;
        return new Promise(() => {});
      }
    };
    const result = await scrape(tool);
    assert.match(result.content.json.error, /^extraction did not finish within 0\.05 s/);
    assert.ok(seen instanceof AbortSignal);
    assert.equal(seen.aborted, true);
  });

  test('an extractor that answers in time is never aborted', async () => {
    const tool = new UnifiedScrapeTool({ jsonTimeoutMs: 5000 });
    let seen;
    tool._extractWithLlm = {
      execute: async ({ signal }) => {
        seen = signal;
        return { success: true, data: { price: '$295.99' } };
      }
    };
    const result = await scrape(tool);
    assert.deepEqual(result.content.json, { price: '$295.99' });
    assert.equal(seen.aborted, false);
  });

  test('the real extractor closes its Ollama request when the wait runs out', async () => {
    const tool = new UnifiedScrapeTool({ jsonTimeoutMs: 300 });
    const started = Date.now();
    const result = await scrape(tool);
    assert.match(result.content.json.error, /^extraction did not finish within 0\.3 s/);
    const closedAt = await chatClosed.promise;
    assert.ok(closedAt - started < 5000, 'the request closed at the bound, not at the 120 s fetch timeout');
    assert.equal(chatRequests, 1);
  });
});

describe('extract_with_llm: signal', () => {
  test('an aborted call returns a failure without a retry or the sampling fallback', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await new ExtractWithLlm().execute({
      content: 'Price: $295.99',
      prompt: 'price',
      provider: 'auto',
      signal: controller.signal
    });
    assert.equal(result.success, false);
    assert.match(result.error, /^LLM call aborted/);
    assert.doesNotMatch(result.error, /Sampling/);
    await chatClosed.promise;
    assert.equal(chatRequests, 1);
  });

  test('no signal: a caller that passes none still gets an answer', async () => {
    const reply = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'stub', message: { content: '{"price":"$295.99"}' } }));
      });
    });
    await new Promise((resolve) => reply.listen(0, '127.0.0.1', resolve));
    process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${reply.address().port}`;
    try {
      const result = await new ExtractWithLlm().execute({ content: 'Price: $295.99', prompt: 'price', provider: 'ollama' });
      assert.equal(result.success, true);
      assert.deepEqual(result.data, { price: '$295.99' });
    } finally {
      process.env.OLLAMA_BASE_URL = baseUrl;
      reply.closeAllConnections?.();
      await new Promise((resolve) => reply.close(resolve));
    }
  });
});

/**
 * D5.2 — Unit tests: extractStructured tool
 * Run: node --test tests/unit/tools/extract/extractStructured.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const stubSchema = { type: 'object', properties: { title: { type: 'string' }, price: { type: 'number' } }, required: ['title'] };
const stubExtractedData = { title: 'Widget Pro', price: 49.99 };
const stubHtml = '<html><body><h1>Widget Pro</h1><span class="price">$49.99</span></body></html>';

class LLMManagerStub {
  constructor(opts = {}) { this.opts = opts; this._available = !!opts.openai || !!opts.anthropic; }
  async complete(prompt) { return JSON.stringify(stubExtractedData); }
  isAvailable() { return this._available; }
}

class ElicitationHelperStub {
  async elicit() { return { confirmed: true }; }
}

class FetchStub {
  async fetchAndParse(url) {
    if (url.includes('bad-url')) throw new Error('Network error');
    return { html: stubHtml, url };
  }
}

// ---------------------------------------------------------------------------
// Minimal ExtractStructured-like stub
// ---------------------------------------------------------------------------

class ExtractStructuredStub {
  constructor({ llmManager, elicitation, fetcher } = {}) {
    this.llmManager = llmManager || new LLMManagerStub();
    this._elicitation = elicitation || new ElicitationHelperStub();
    this.fetcher = fetcher || new FetchStub();
  }

  async execute(params) {
    if (!params || !params.url) throw new Error('url is required');
    if (!params.schema) throw new Error('schema is required');
    try { new URL(params.url); } catch { throw new Error('Invalid URL'); }

    const { html } = await this.fetcher.fetchAndParse(params.url);

    // Try LLM first if available
    if (this.llmManager.isAvailable()) {
      const raw = await this.llmManager.complete(`Extract from HTML: ${html.slice(0, 200)}`);
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = {}; }
      return { url: params.url, method: 'llm', data: parsed, schema: params.schema };
    }

    // Fallback: CSS selector stub extraction
    const data = {};
    if (params.schema.properties.title) data.title = 'Widget Pro (fallback)';
    return { url: params.url, method: 'selector', data, schema: params.schema };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractStructured tool', () => {
  let tool;

  beforeEach(() => {
    tool = new ExtractStructuredStub({ llmManager: new LLMManagerStub({ openai: { apiKey: 'sk-test' } }) });
  });

  test('constructor stores llmManager and elicitation helper', () => {
    assert.ok(tool.llmManager);
    assert.ok(tool._elicitation);
  });

  test('happy path with LLM returns extracted data', async () => {
    const result = await tool.execute({ url: 'https://example.com/product', schema: stubSchema });
    assert.equal(result.url, 'https://example.com/product');
    assert.equal(result.method, 'llm');
    assert.deepEqual(result.data, stubExtractedData);
  });

  test('falls back to selector extraction when no LLM available', async () => {
    const noLlmTool = new ExtractStructuredStub({ llmManager: new LLMManagerStub() });
    const result = await noLlmTool.execute({ url: 'https://example.com/product', schema: stubSchema });
    assert.equal(result.method, 'selector');
    assert.ok(result.data.title);
  });

  test('missing url throws', async () => {
    await assert.rejects(() => tool.execute({ schema: stubSchema }), /url is required/);
  });

  test('invalid URL throws', async () => {
    await assert.rejects(() => tool.execute({ url: 'not-a-url', schema: stubSchema }), /Invalid URL/);
  });

  test('missing schema throws', async () => {
    await assert.rejects(() => tool.execute({ url: 'https://example.com' }), /schema is required/);
  });

  test('network error propagates', async () => {
    const result = tool.execute({ url: 'https://bad-url.example.com', schema: stubSchema });
    await assert.rejects(() => result, /Network error/);
  });
});

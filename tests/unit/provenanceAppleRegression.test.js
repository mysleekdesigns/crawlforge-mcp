/**
 * Regression: the numeric provenance guard on the page that fabricated prices.
 *
 * Run: node --test tests/unit/provenanceAppleRegression.test.js
 *
 * Fixture: tests/fixtures/provenance/apple-macbook-air.html — condensed from a
 * live capture of https://www.apple.com/shop/buy-mac/macbook-air taken
 * 2026-08-29 (HTTP 200, 606,174 bytes, robots-allowed). Measured on that
 * capture: the MacBook Air prices exist ONLY inside the page's embedded
 * PRODUCT_SELECTION_BOOTSTRAP JSON. The rendered text carries none of them, and
 * Readability's main-content pass — what extract_structured actually feeds the
 * model — keeps the FAQ block, which has no price in it at all. Handed that, a
 * model writes 20 confident prices it cannot have read.
 *
 * Both halves of the fix are pinned here:
 *   - fabricated numbers come back null with a machine-readable reason;
 *   - the three REAL prices, which are absent from everything the model was
 *     shown, survive — because the guard checks the full fetched source.
 *
 * No live LLM: the model's output is the canned fabrication, so the test is
 * deterministic.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

process.env.ALLOWED_DOMAINS = 'localhost';
// LLMManager probes a local Ollama when nothing else is configured; a developer
// with Ollama running would otherwise reach a live model in the CSS-path test.
process.env.DISABLE_OLLAMA = 'true';
const savedKeys = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL
};
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { ExtractStructuredTool } = await import('../../src/tools/extract/extractStructured.js');
const { ExtractWithLlm } = await import('../../src/tools/extract/extractWithLlm.js');

const FIXTURE = readFileSync(
  new URL('../fixtures/provenance/apple-macbook-air.html', import.meta.url),
  'utf8'
);

/**
 * 20 prices, one per configuration — every one verified absent from the capture
 * (not as a number, and not as a digit run inside a longer number).
 */
const FABRICATED_PRICES = [
  899, 949, 999, 1049, 1149, 1249, 1349, 1449, 1549, 1649,
  1699, 1749, 1799, 1849, 1949, 2049, 2149, 2249, 2299, 2349
];

/** The prices the page really quotes. Only in the embedded JSON, never in text. */
const REAL_PRICES = { price_16gb_1tb: '$1,299.00', price_24gb_512gb: 1399, price_24gb_1tb: '1,499.00' };

/** What the model returns: 20 inventions plus the three it could not have read. */
function fabricatedModelOutput() {
  return {
    product: 'MacBook Air',
    configurations: FABRICATED_PRICES.map((price, i) => ({ sku: `MBA-CFG-${i + 1}`, price: `$${price}.00` })),
    ...REAL_PRICES
  };
}

const SCHEMA = {
  type: 'object',
  properties: {
    product: { type: 'string' },
    configurations: { type: 'array' },
    price_16gb_1tb: { type: 'string' },
    price_24gb_512gb: { type: 'number' },
    price_24gb_1tb: { type: 'string' }
  }
};

// ── Servers: the fixture page, and a stub Ollama for extract_with_llm ────────

let pageServer;
let ollamaServer;
let pageUrl;
/** Canned /api/chat reply for the stub Ollama. */
let ollamaReply = '{}';

before(async () => {
  pageServer = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/macbook-air') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(FIXTURE);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolve) => pageServer.listen(0, '127.0.0.1', resolve));
  pageUrl = `http://localhost:${pageServer.address().port}/macbook-air`;

  ollamaServer = http.createServer((req, res) => {
    if (req.url === '/api/chat') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'stub-model', message: { role: 'assistant', content: ollamaReply } }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => ollamaServer.listen(0, '127.0.0.1', resolve));
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${ollamaServer.address().port}`;
});

after(async () => {
  await new Promise((resolve) => pageServer.close(resolve));
  await new Promise((resolve) => ollamaServer.close(resolve));
  for (const [key, value] of Object.entries(savedKeys)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Replace the tool's LLMManager with one returning `data`; captures the input. */
function stubLlm(tool, data) {
  const captured = { input: null };
  tool._ensureLLMManager = () => ({
    ready: async () => true,
    extractStructured: async (content) => {
      captured.input = content;
      return { method: 'llm', data, valid: true, validationErrors: [] };
    }
  });
  return captured;
}

// ── extract_structured ───────────────────────────────────────────────────────

describe('extract_structured — replaying the Apple page that produced 20 fabricated prices', () => {
  test('every fabricated price comes back null with a reason, and the real ones survive', async () => {
    const tool = new ExtractStructuredTool();
    const captured = stubLlm(tool, fabricatedModelOutput());

    const result = await tool.execute({ url: pageUrl, schema: SCHEMA });

    // The reason the model invented them: not one price is in what it was given.
    assert.doesNotMatch(captured.input, /1,?299/, 'the model was shown no price — that is the bug being guarded');
    assert.doesNotMatch(captured.input, /1,?499/);

    assert.equal(result.extraction_method, 'llm');
    for (const [i, config] of result.data.configurations.entries()) {
      assert.equal(config.price, null, `fabricated price ${FABRICATED_PRICES[i]} was returned as data`);
      // The SKUs are invented by this test's stub alongside the prices, and
      // "MBA-CFG-n" appears nowhere in the page. Since round 10 the guard also
      // covers digit-bearing literals — versions, dates, SKUs — so a fabricated
      // SKU is nulled for the same reason a fabricated price is. It used to
      // pass through, which is how a made-up version reached callers as valid.
      assert.equal(config.sku, null, 'a SKU absent from the page is a fabrication too');
    }

    assert.equal(result.provenance.enabled, true);
    // Prices and SKUs, one of each per configuration.
    assert.equal(result.provenance.nulled, FABRICATED_PRICES.length * 2);
    assert.equal(result.provenance.unverified.length, FABRICATED_PRICES.length * 2);
    for (const entry of result.provenance.unverified) {
      assert.equal(entry.reason, 'not_found_in_source');
      assert.match(entry.path, /^configurations\[\d+\]\.(price|sku)$/);
    }
    // Both classes are reported verbatim, so nothing disappears silently. The
    // walker reports fields in key order, which puts each config's sku before
    // its price.
    assert.deepEqual(
      result.provenance.unverified.filter((u) => u.path.endsWith('.price')).map((u) => u.value),
      FABRICATED_PRICES.map((p) => `$${p}.00`),
      'the removed prices are reported verbatim'
    );
    assert.deepEqual(
      result.provenance.unverified.filter((u) => u.path.endsWith('.sku')).map((u) => u.value),
      FABRICATED_PRICES.map((_, i) => `MBA-CFG-${i + 1}`),
      'the removed SKUs are reported verbatim'
    );

    // The anti-false-positive half: these three are on the page but in NONE of
    // the text the model saw. Checking against the trimmed main content would
    // have nulled all three.
    assert.equal(result.data.price_16gb_1tb, '$1,299.00');
    assert.equal(result.data.price_24gb_512gb, 1399);
    assert.equal(result.data.price_24gb_1tb, '1,499.00');
    assert.equal(result.provenance.verified, 3);
  });

  test('the nulling is reported in extractionNotes too', async () => {
    const tool = new ExtractStructuredTool();
    stubLlm(tool, { price: '$2,299.00' });

    const result = await tool.execute({ url: pageUrl, schema: SCHEMA });

    assert.ok(
      result.extractionNotes.some((n) => n.includes('Numeric provenance') && n.includes('$2,299.00')),
      `expected a provenance note, got: ${JSON.stringify(result.extractionNotes)}`
    );
  });

  test('a nulled REQUIRED field makes the extraction a failure, not a success carrying a null', async () => {
    const tool = new ExtractStructuredTool();
    stubLlm(tool, { product: 'MacBook Air', price: 2299 });

    const result = await tool.execute({
      url: pageUrl,
      schema: { type: 'object', properties: { product: { type: 'string' }, price: { type: 'number' } }, required: ['product', 'price'] }
    });

    assert.equal(result.success, false);
    assert.match(result.error, /price/);
    assert.equal(result.data.price, null);
  });

  test('verify_numbers:false returns the fabrications untouched — the pre-fix behaviour, on request', async () => {
    const tool = new ExtractStructuredTool();
    stubLlm(tool, fabricatedModelOutput());

    const result = await tool.execute({ url: pageUrl, schema: SCHEMA, verify_numbers: false });

    assert.equal(result.data.configurations[0].price, '$899.00');
    assert.deepEqual(result.provenance, { enabled: false });
  });

  test('the CSS fallback is not guarded — it can only return text it read off the page', async () => {
    const tool = new ExtractStructuredTool();

    const result = await tool.execute({
      url: pageUrl,
      schema: { type: 'object', properties: { title: { type: 'string' } } }
    });

    assert.notEqual(result.extraction_method, 'llm');
    assert.deepEqual(result.provenance, { enabled: false });
  });
});

// ── extract_with_llm ─────────────────────────────────────────────────────────

describe('extract_with_llm — same guard, its own provider chain', () => {
  test('a fabricated price is nulled while a price only in the raw html survives', async () => {
    ollamaReply = JSON.stringify({ headline: 'Buy MacBook Air', invented: 2299, real: '$1,299.00' });

    const result = await new ExtractWithLlm().execute({
      url: pageUrl,
      prompt: 'Extract the headline and the MacBook Air prices',
      provider: 'ollama',
      model: 'stub-model'
    });

    assert.equal(result.success, true, `expected success, got: ${JSON.stringify(result)}`);
    assert.equal(result.data.invented, null);
    assert.equal(result.data.real, '$1,299.00', 'a price present only in the embedded JSON must survive');
    assert.equal(result.data.headline, 'Buy MacBook Air');
    assert.equal(result.provenance.enabled, true);
    assert.equal(result.provenance.verified, 1);
    assert.deepEqual(result.provenance.unverified, [
      { path: 'invented', value: 2299, reason: 'not_found_in_source' }
    ]);
  });

  test('verify_numbers:false leaves the fabrication in place and says the guard was off', async () => {
    ollamaReply = JSON.stringify({ invented: 2299 });

    const result = await new ExtractWithLlm().execute({
      url: pageUrl,
      prompt: 'Extract the price',
      provider: 'ollama',
      model: 'stub-model',
      verify_numbers: false
    });

    assert.equal(result.data.invented, 2299);
    assert.deepEqual(result.provenance, { enabled: false });
  });

  test('with `content` supplied instead of a url, that content is the source', async () => {
    ollamaReply = JSON.stringify({ price: 1299, invented: 2299 });

    const result = await new ExtractWithLlm().execute({
      content: 'MacBook Air 15-inch — $1,299.00',
      prompt: 'Extract the price',
      provider: 'ollama',
      model: 'stub-model'
    });

    assert.equal(result.data.price, 1299);
    assert.equal(result.data.invented, null);
  });
});

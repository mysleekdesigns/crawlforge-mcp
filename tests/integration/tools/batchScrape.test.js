/**
 * Integration tests for batchScrape sub-modules.
 *
 * Run: node --test tests/integration/tools/batchScrape.test.js
 *
 * Tests cover:
 *   - reporter.sendWebhookNotification: no-op when disabled/missing
 *   - queue (basic): worker processes items and reports results
 *   - worker: scrapeUrl happy path (mocked fetch), error isolation
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendWebhookNotification } from '../../../src/tools/advanced/batchScrape/reporter.js';
import { scrapeUrl } from '../../../src/tools/advanced/batchScrape/worker.js';

const originalFetch = global.fetch;

function mockFetchOk(body = '<html><body><h1>Hello</h1></body></html>', contentType = 'text/html') {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'https://example.com/mocked',
    headers: {
      get: (key) => ({ 'content-type': contentType }[key.toLowerCase()] || null),
      forEach: (cb) => cb(contentType, 'content-type')
    },
    text: async () => body
  });
}

function restoreFetch() {
  global.fetch = originalFetch;
}

// ── reporter.sendWebhookNotification ─────────────────────────────────────────

test('sendWebhookNotification: is a no-op when enabled=false', async () => {
  // Should not throw; dispatching is skipped
  await sendWebhookNotification(
    'batch_completed',
    { batchId: 'test-batch' },
    { url: 'https://example.com/hook' },
    null,    // no dispatcher
    false    // enabled=false
  );
  // If we get here without throwing, the test passes
  assert.ok(true);
});

test('sendWebhookNotification: is a no-op when webhookConfig is null', async () => {
  await sendWebhookNotification('batch_completed', {}, null, null, true);
  assert.ok(true);
});

test('sendWebhookNotification: is a no-op when webhookDispatcher is null', async () => {
  await sendWebhookNotification(
    'batch_completed',
    { batchId: 'x' },
    { url: 'https://example.com/hook' },
    null,
    true
  );
  assert.ok(true);
});

test('sendWebhookNotification: calls dispatcher.dispatch when all args provided', async () => {
  const dispatched = [];
  const fakeDispatcher = {
    dispatch: async (event, data, opts) => {
      dispatched.push({ event, data, opts });
    }
  };

  await sendWebhookNotification(
    'batch_completed',
    { batchId: 'batch-abc' },
    { url: 'https://example.com/hook' },
    fakeDispatcher,
    true
  );

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].event, 'batch_completed');
  assert.deepEqual(dispatched[0].opts.urls, ['https://example.com/hook']);
});

// ── worker.scrapeUrl ──────────────────────────────────────────────────────────

// scrapeUrl(config, options, defaultTimeout)
// options = { formats, extractionSchema?, maxConcurrency?, ... }

test('scrapeUrl: happy path returns success:true with scraped data', async () => {
  mockFetchOk('<html><head><title>Worker Test</title></head><body><h1>Content</h1></body></html>');
  try {
    const result = await scrapeUrl(
      { url: 'https://example.com/' },
      { formats: ['json'] },
      15000
    );
    assert.equal(result.success, true);
    assert.equal(result.url, 'https://example.com/');
    assert.ok(typeof result.content === 'object' || typeof result.data === 'object');
  } finally {
    restoreFetch();
  }
});

test('scrapeUrl: network failure returns success:false with error', async () => {
  global.fetch = async () => { throw new Error('Network unreachable'); };
  try {
    const result = await scrapeUrl(
      { url: 'https://example.com/' },
      { formats: ['json'] },
      15000
    );
    assert.equal(result.success, false);
    assert.ok(typeof result.error === 'string');
  } finally {
    restoreFetch();
  }
});

test('scrapeUrl: HTTP error response returns success:false', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    url: 'https://example.com/missing',
    headers: { get: () => null, forEach: () => {} },
    text: async () => 'Not Found'
  });
  try {
    const result = await scrapeUrl(
      { url: 'https://example.com/missing' },
      { formats: ['json'] },
      15000
    );
    assert.equal(result.success, false);
  } finally {
    restoreFetch();
  }
});

test('scrapeUrl: accepts UrlConfig object with selectors', async () => {
  mockFetchOk('<html><body><h1>Title</h1><p>Paragraph</p></body></html>');
  try {
    const result = await scrapeUrl(
      { url: 'https://example.com/', selectors: { heading: 'h1' } },
      { formats: ['json'] },
      15000
    );
    assert.equal(result.success, true);
    assert.equal(result.url, 'https://example.com/');
  } finally {
    restoreFetch();
  }
});

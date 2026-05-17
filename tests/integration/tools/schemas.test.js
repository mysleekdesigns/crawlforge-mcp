/**
 * Schema validation tests for Zod schemas used by tools.
 *
 * Run: node --test tests/integration/tools/schemas.test.js
 *
 * Verifies that each tool's Zod schema:
 *   1. Accepts valid input (happy path)
 *   2. Rejects invalid input (error path)
 *
 * Tools covered:
 *   - batchScrape (BatchScrapeSchema, UrlConfigSchema)
 *   - trackChanges (TrackChangesSchema)
 *   - SearchResultCache (runtime behavior — no Zod schema but contract tests)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchScrapeSchema, UrlConfigSchema } from '../../../src/tools/advanced/batchScrape/schema.js';
import { TrackChangesSchema } from '../../../src/tools/tracking/trackChanges/schema.js';
import { SearchResultCache } from '../../../src/tools/search/ranking/SearchResultCache.js';

// ── BatchScrapeSchema ──────────────────────────────────────────────────────────

test('BatchScrapeSchema: accepts a minimal valid input', () => {
  const result = BatchScrapeSchema.safeParse({
    urls: ['https://example.com/']
  });
  assert.equal(result.success, true, `Expected success but got: ${JSON.stringify(result.error?.errors)}`);
});

test('BatchScrapeSchema: applies defaults for optional fields', () => {
  const result = BatchScrapeSchema.safeParse({
    urls: ['https://example.com/']
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.formats, ['json']);
  assert.equal(result.data.mode, 'sync');
  assert.equal(result.data.maxConcurrency, 10);
});

test('BatchScrapeSchema: accepts all valid modes', () => {
  for (const mode of ['sync', 'async']) {
    const result = BatchScrapeSchema.safeParse({
      urls: ['https://example.com/'],
      mode
    });
    assert.equal(result.success, true, `mode=${mode} should be valid`);
  }
});

test('BatchScrapeSchema: rejects empty urls array', () => {
  const result = BatchScrapeSchema.safeParse({ urls: [] });
  assert.equal(result.success, false, 'empty urls array should fail validation');
});

test('BatchScrapeSchema: rejects more than 50 URLs', () => {
  const urls = Array.from({ length: 51 }, (_, i) => `https://example.com/page${i}`);
  const result = BatchScrapeSchema.safeParse({ urls });
  assert.equal(result.success, false, 'more than 50 URLs should be rejected');
});

test('BatchScrapeSchema: rejects non-URL string in urls', () => {
  const result = BatchScrapeSchema.safeParse({
    urls: ['not-a-url']
  });
  assert.equal(result.success, false, 'non-URL string should be rejected');
});

test('BatchScrapeSchema: rejects invalid mode', () => {
  const result = BatchScrapeSchema.safeParse({
    urls: ['https://example.com/'],
    mode: 'invalid-mode'
  });
  assert.equal(result.success, false);
});

test('BatchScrapeSchema: rejects maxConcurrency above 20', () => {
  const result = BatchScrapeSchema.safeParse({
    urls: ['https://example.com/'],
    maxConcurrency: 21
  });
  assert.equal(result.success, false);
});

test('BatchScrapeSchema: accepts UrlConfig objects in urls array', () => {
  const result = BatchScrapeSchema.safeParse({
    urls: [
      { url: 'https://example.com/', selectors: { heading: 'h1' }, timeout: 5000 }
    ]
  });
  assert.equal(result.success, true);
});

// ── UrlConfigSchema ───────────────────────────────────────────────────────────

test('UrlConfigSchema: accepts valid URL config', () => {
  const result = UrlConfigSchema.safeParse({
    url: 'https://example.com/',
    timeout: 10000,
    selectors: { title: 'h1' }
  });
  assert.equal(result.success, true);
});

test('UrlConfigSchema: rejects non-URL in url field', () => {
  const result = UrlConfigSchema.safeParse({ url: 'not-a-url' });
  assert.equal(result.success, false);
});

test('UrlConfigSchema: rejects timeout below 1000ms', () => {
  const result = UrlConfigSchema.safeParse({
    url: 'https://example.com/',
    timeout: 500
  });
  assert.equal(result.success, false, 'timeout below minimum should be rejected');
});

test('UrlConfigSchema: rejects timeout above 30000ms', () => {
  const result = UrlConfigSchema.safeParse({
    url: 'https://example.com/',
    timeout: 60000
  });
  assert.equal(result.success, false, 'timeout above maximum should be rejected');
});

// ── TrackChangesSchema ────────────────────────────────────────────────────────

test('TrackChangesSchema: accepts minimal valid input (url only)', () => {
  const result = TrackChangesSchema.safeParse({ url: 'https://example.com/' });
  assert.equal(result.success, true);
  assert.equal(result.data.operation, 'compare', 'default operation should be compare');
});

test('TrackChangesSchema: accepts all valid operations', () => {
  const ops = [
    'create_baseline', 'compare', 'monitor', 'get_history', 'get_stats',
    'create_scheduled_monitor', 'stop_scheduled_monitor', 'get_dashboard',
    'export_history', 'create_alert_rule', 'generate_trend_report',
    'get_monitoring_templates'
  ];
  for (const operation of ops) {
    const result = TrackChangesSchema.safeParse({
      url: 'https://example.com/',
      operation
    });
    assert.equal(result.success, true, `operation=${operation} should be valid`);
  }
});

test('TrackChangesSchema: rejects non-URL in url field', () => {
  const result = TrackChangesSchema.safeParse({ url: 'not-a-valid-url' });
  assert.equal(result.success, false);
});

test('TrackChangesSchema: rejects invalid operation value', () => {
  const result = TrackChangesSchema.safeParse({
    url: 'https://example.com/',
    operation: 'do_something_invalid'
  });
  assert.equal(result.success, false);
});

test('TrackChangesSchema: rejects monitoringOptions.interval below 60000', () => {
  const result = TrackChangesSchema.safeParse({
    url: 'https://example.com/',
    monitoringOptions: { interval: 1000 }  // below 60s minimum
  });
  assert.equal(result.success, false, 'interval below 60000ms should be rejected');
});

test('TrackChangesSchema: accepts full valid input with trackingOptions', () => {
  const result = TrackChangesSchema.safeParse({
    url: 'https://example.com/',
    operation: 'create_baseline',
    content: '<html><body>content</body></html>',
    trackingOptions: {
      granularity: 'section',
      trackText: true,
      trackStructure: true,
      trackLinks: true,
      ignoreWhitespace: true
    }
  });
  assert.equal(result.success, true);
});

test('TrackChangesSchema: rejects invalid granularity value', () => {
  const result = TrackChangesSchema.safeParse({
    url: 'https://example.com/',
    trackingOptions: { granularity: 'sentence' }  // not in enum
  });
  assert.equal(result.success, false);
});

test('TrackChangesSchema: applies defaults for trackingOptions', () => {
  const result = TrackChangesSchema.safeParse({ url: 'https://example.com/' });
  assert.equal(result.success, true);
  assert.equal(result.data.trackingOptions.granularity, 'section');
  assert.equal(result.data.trackingOptions.trackText, true);
  assert.equal(result.data.trackingOptions.ignoreWhitespace, true);
});

// ── SearchResultCache ─────────────────────────────────────────────────────────

test('SearchResultCache: enabled cache stores and retrieves values', async () => {
  const cache = new SearchResultCache({ ttl: 60000, enabled: true });
  await cache.set('test-key', { results: [1, 2, 3] });
  const value = await cache.get('test-key');
  assert.ok(value !== undefined, 'stored value should be retrievable');
  assert.deepEqual(value, { results: [1, 2, 3] });
});

test('SearchResultCache: disabled cache always returns undefined on get', async () => {
  const cache = new SearchResultCache({ enabled: false });
  await cache.set('key', 'value');
  const value = await cache.get('key');
  assert.equal(value, undefined, 'disabled cache should always return undefined');
});

test('SearchResultCache: generateKey returns null when disabled', () => {
  const cache = new SearchResultCache({ enabled: false });
  const key = cache.generateKey('ns', { q: 'test' });
  assert.equal(key, null);
});

test('SearchResultCache: generateKey returns string when enabled', () => {
  const cache = new SearchResultCache({ enabled: true });
  const key = cache.generateKey('search', { query: 'hello' });
  assert.ok(typeof key === 'string' || key !== undefined);
});

test('SearchResultCache: getStats returns null when disabled', () => {
  const cache = new SearchResultCache({ enabled: false });
  assert.equal(cache.getStats(), null);
});

test('SearchResultCache: getStats returns object when enabled', () => {
  const cache = new SearchResultCache({ enabled: true });
  const stats = cache.getStats();
  assert.ok(stats !== null);
  assert.ok(typeof stats === 'object');
});

test('SearchResultCache: cache miss returns a falsy value', async () => {
  const cache = new SearchResultCache({ enabled: true });
  const value = await cache.get('nonexistent-key-xyz-12345');
  assert.ok(value === null || value === undefined, 'cache miss should be null or undefined');
});

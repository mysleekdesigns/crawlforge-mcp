/**
 * Unit tests for src/core/WebhookDispatcher.js
 *
 * Run: node --test tests/unit/webhookDispatcher.test.js
 *
 * Tests cover:
 *   - registerWebhook: HTTPS enforcement, config stored correctly
 *   - registerWebhook: rejects HTTP URLs
 *   - registerWebhook: rejects missing URL
 *   - unregisterWebhook: removes entry, returns correct boolean
 *   - generateSignature: produces sha256= HMAC prefix
 *   - recordSuccess / recordFailure: update healthChecks and stats
 *   - dispatch: queues events to matching registered webhooks
 *   - dispatch: returns empty when no webhooks registered
 *   - dispatch: filters by event type
 *   - getHealthSummary: structure
 *   - getStats: shape and field presence
 *   - clearFailedUrls: removes per-url and all
 *   - destroy: clears state
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { WebhookDispatcher } from '../../src/core/WebhookDispatcher.js';

const HTTPS_URL = 'https://example.com/hook';
const HTTPS_URL_2 = 'https://other.com/hook';

// Create a dispatcher without persistence or health monitoring to keep tests fast
function makeDispatcher(overrides = {}) {
  const queueDir = path.join(os.tmpdir(), `wd-test-${Math.random().toString(36).slice(2)}`);
  return new WebhookDispatcher({
    queueDir,
    enablePersistence: false,
    enableHealthMonitoring: false,
    enableLogging: false,
    ...overrides
  });
}

// ── registerWebhook ─────────────────────────────────────────────────────────

test('WebhookDispatcher: registerWebhook stores configuration for HTTPS URL', () => {
  const wd = makeDispatcher();
  const config = wd.registerWebhook(HTTPS_URL, { events: ['job_complete'] });
  assert.equal(config.url, HTTPS_URL);
  assert.ok(Array.isArray(config.events));
  assert.ok(config.events.includes('job_complete'));
  assert.equal(wd.webhookUrls.has(HTTPS_URL), true);
  wd.destroy();
});

test('WebhookDispatcher: registerWebhook also accepts object signature { url, ... }', () => {
  const wd = makeDispatcher();
  const config = wd.registerWebhook({ url: HTTPS_URL, events: ['*'] });
  assert.equal(config.url, HTTPS_URL);
  wd.destroy();
});

test('WebhookDispatcher: registerWebhook rejects HTTP URLs', () => {
  const wd = makeDispatcher();
  assert.throws(
    () => wd.registerWebhook('http://insecure.example.com/hook'),
    /HTTPS/i
  );
  wd.destroy();
});

test('WebhookDispatcher: registerWebhook rejects missing URL', () => {
  const wd = makeDispatcher();
  assert.throws(
    () => wd.registerWebhook(null),
    /Invalid webhook configuration/i
  );
  wd.destroy();
});

test('WebhookDispatcher: registerWebhook emits webhookRegistered event', () => {
  const wd = makeDispatcher();
  let emitted = null;
  wd.on('webhookRegistered', (url) => { emitted = url; });
  wd.registerWebhook(HTTPS_URL);
  assert.equal(emitted, HTTPS_URL);
  wd.destroy();
});

// ── unregisterWebhook ───────────────────────────────────────────────────────

test('WebhookDispatcher: unregisterWebhook removes the URL and returns true', () => {
  const wd = makeDispatcher();
  wd.registerWebhook(HTTPS_URL);
  const removed = wd.unregisterWebhook(HTTPS_URL);
  assert.equal(removed, true);
  assert.equal(wd.webhookUrls.has(HTTPS_URL), false);
  wd.destroy();
});

test('WebhookDispatcher: unregisterWebhook returns false for unknown URL', () => {
  const wd = makeDispatcher();
  const removed = wd.unregisterWebhook('https://not-registered.example.com/');
  assert.equal(removed, false);
  wd.destroy();
});

// ── generateSignature ────────────────────────────────────────────────────────

test('WebhookDispatcher: generateSignature returns sha256= prefixed HMAC', () => {
  const wd = makeDispatcher();
  const sig = wd.generateSignature({ foo: 'bar' }, 'my-secret');
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  wd.destroy();
});

test('WebhookDispatcher: generateSignature is deterministic for equal inputs', () => {
  const wd = makeDispatcher();
  const payload = { event: 'test', data: { n: 42 } };
  const sig1 = wd.generateSignature(payload, 'secret');
  const sig2 = wd.generateSignature(payload, 'secret');
  assert.equal(sig1, sig2);
  wd.destroy();
});

test('WebhookDispatcher: generateSignature differs for different secrets', () => {
  const wd = makeDispatcher();
  const payload = { event: 'test' };
  const sig1 = wd.generateSignature(payload, 'secret-a');
  const sig2 = wd.generateSignature(payload, 'secret-b');
  assert.notEqual(sig1, sig2);
  wd.destroy();
});

// ── recordSuccess / recordFailure ────────────────────────────────────────────

test('WebhookDispatcher: recordSuccess marks health as healthy', () => {
  const wd = makeDispatcher();
  wd.registerWebhook(HTTPS_URL);
  wd.recordSuccess(HTTPS_URL, 100);
  const health = wd.healthChecks.get(HTTPS_URL);
  assert.equal(health.status, 'healthy');
  assert.equal(health.consecutiveFailures, 0);
  wd.destroy();
});

test('WebhookDispatcher: recordFailure increments consecutiveFailures', () => {
  const wd = makeDispatcher();
  wd.registerWebhook(HTTPS_URL);
  wd.recordFailure(HTTPS_URL, new Error('timeout'));
  wd.recordFailure(HTTPS_URL, new Error('timeout'));
  const health = wd.healthChecks.get(HTTPS_URL);
  assert.equal(health.status, 'unhealthy');
  assert.equal(health.consecutiveFailures, 2);
  wd.destroy();
});

// ── dispatch ─────────────────────────────────────────────────────────────────

test('WebhookDispatcher: dispatch returns empty array when no webhooks registered', async () => {
  const wd = makeDispatcher();
  const results = await wd.dispatch('job_complete', { jobId: '123' });
  assert.deepEqual(results, []);
  wd.destroy();
});

test('WebhookDispatcher: dispatch queues events for matching registered webhooks', async () => {
  const wd = makeDispatcher();
  wd.registerWebhook(HTTPS_URL, { events: ['*'] });

  const results = await wd.dispatch('job_complete', { jobId: 'abc' });
  assert.equal(results.length, 1);
  assert.equal(results[0].queued, true);
  assert.equal(results[0].url, HTTPS_URL);
  wd.destroy();
});

test('WebhookDispatcher: dispatch filters by event type', async () => {
  const wd = makeDispatcher();
  wd.registerWebhook(HTTPS_URL, { events: ['job_complete'] });
  wd.registerWebhook(HTTPS_URL_2, { events: ['job_failed'] });

  const results = await wd.dispatch('job_complete', {});
  assert.equal(results.length, 1, 'only the matching webhook should receive the event');
  assert.equal(results[0].url, HTTPS_URL);
  wd.destroy();
});

test('WebhookDispatcher: dispatch skips disabled webhooks', async () => {
  const wd = makeDispatcher();
  wd.registerWebhook(HTTPS_URL, { events: ['*'], enabled: false });
  const results = await wd.dispatch('job_complete', {});
  assert.deepEqual(results, []);
  wd.destroy();
});

// ── getStats ──────────────────────────────────────────────────────────────────

test('WebhookDispatcher: getStats returns expected shape', () => {
  const wd = makeDispatcher();
  const stats = wd.getStats();
  assert.ok(typeof stats.totalEvents === 'number');
  assert.ok(typeof stats.successfulDeliveries === 'number');
  assert.ok(typeof stats.failedDeliveries === 'number');
  assert.ok(typeof stats.queueSize === 'number');
  assert.ok(typeof stats.registeredUrls === 'number');
  wd.destroy();
});

// ── getHealthSummary ──────────────────────────────────────────────────────────

test('WebhookDispatcher: getHealthSummary reflects registered webhooks', () => {
  const wd = makeDispatcher();
  wd.registerWebhook(HTTPS_URL);
  const summary = wd.getHealthSummary();
  assert.equal(summary.totalUrls, 1);
  assert.ok(typeof summary.healthyUrls === 'number');
  assert.ok(typeof summary.unhealthyUrls === 'number');
  wd.destroy();
});

// ── clearFailedUrls ───────────────────────────────────────────────────────────

test('WebhookDispatcher: clearFailedUrls(url) clears only that entry', () => {
  const wd = makeDispatcher();
  wd.registerWebhook(HTTPS_URL);
  wd.registerWebhook(HTTPS_URL_2);
  wd.recordFailure(HTTPS_URL, new Error('fail'));
  wd.recordFailure(HTTPS_URL_2, new Error('fail'));
  wd.clearFailedUrls(HTTPS_URL);
  assert.equal(wd.failedUrls.has(HTTPS_URL), false);
  assert.equal(wd.failedUrls.has(HTTPS_URL_2), true);
  wd.destroy();
});

test('WebhookDispatcher: clearFailedUrls() with no arg clears all', () => {
  const wd = makeDispatcher();
  wd.registerWebhook(HTTPS_URL);
  wd.registerWebhook(HTTPS_URL_2);
  wd.recordFailure(HTTPS_URL, new Error('fail'));
  wd.recordFailure(HTTPS_URL_2, new Error('fail'));
  wd.clearFailedUrls();
  assert.equal(wd.failedUrls.size, 0);
  wd.destroy();
});

// ── destroy ───────────────────────────────────────────────────────────────────

test('WebhookDispatcher: destroy clears all internal state', () => {
  const wd = makeDispatcher();
  wd.registerWebhook(HTTPS_URL);
  wd.destroy();
  assert.equal(wd.webhookUrls.size, 0);
  assert.equal(wd.queue.length, 0);
  assert.equal(wd.healthChecks.size, 0);
});

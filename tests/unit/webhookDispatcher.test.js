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
 *   - deliverWebhook (real delivery against a local self-signed HTTPS
 *     fixture server): signature verifies against the exact raw POST body,
 *     and a slow endpoint is aborted at config.timeout rather than hanging.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';

// Local-loopback allowlist so the real delivery tests below (a local HTTPS
// fixture server) don't need real DNS/network and aren't blocked by the
// SSRF guard's default loopback rule. Must be set before the first
// (transitive) import of src/constants/config.js — see
// tests/unit/phase3-leaks.test.js for the same pattern — hence the dynamic
// import instead of a static top-of-file one.
process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { WebhookDispatcher } = await import('../../src/core/WebhookDispatcher.js');

const HTTPS_URL = 'https://example.com/hook';
const HTTPS_URL_2 = 'https://other.com/hook';

// Pre-generated self-signed cert/key (CN=127.0.0.1, SAN IP:127.0.0.1, valid
// to 2036) for the local HTTPS fixture server used by the real-delivery
// tests below. WebhookDispatcher's outbound safeFetch goes through a shared
// undici Agent (src/utils/ssrfGuard.js) that has no per-request hook for a
// custom CA, so — same as any self-signed local test server — Node's global
// TLS verification is disabled for this file only (each `node --test` file
// runs in its own process, so this can't leak into other test files).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDBmHpYSefzk2Ey
QXGc85+ZXLpx7bBMlNYOk9+WxkewuDuiLnkp3yoqBvNWxCDwWnfUqFzuds15MOCL
vDhdiKp3sY6fRwHZxM/JPg1P7RRyWod7lizb3j/83NTwvQKRlQXG/1YqgUZiELEB
v/ZqSlMlkiE9OXwo04qCPy1N6t6Qr8ksSIMGpYaggncwyAWs3t4nou4P9isT1eEq
yNBFVR4BMMV2kL5hVwjJW5RYQopwTYrXMFGscTvnw/Usiy/KNX1lWkU0DMVY2EXN
7/wrhFm3vVKY2MDwp1+NGgjZtXoTzTTKOWqsO743p8KuWCYV+BE8KuXixrygge/S
mfidZFbhAgMBAAECggEAXpb2qC6sI0nOQrTRIyOxxkgVXNcKvdA26nZ713pXytOp
Z2uXjcrZGiG9QZaglW9Of1wn0+e+K0mjXQMA80p0J/lcOxyBnfpYn/YuoO+wftMW
wV612lO0JgNsE5f2KlWKthlJ64iwb/fB1J4LcxGPoJrOnNB6hqQdV9gwdZKdXkl7
H2IXH4TBJNPHtvmdcP9Y/ozAHrFfAj61A4sUFV6B/FWG9uOw9if5O50EbW0+298O
gfjoMdqsfC9PRM+Cu5Xk1xZA04aW30EMbhN3c4EbDsUkFpwsVjmqAgW+vwzLHOhc
Ilu9chMieCy/OOfebxQVCvLyih5+/Gc4sirOCw2lJQKBgQDxG42vZIbRfg9RhF/e
wd9SqFskCL6X9icbkcqhZqHQCgHfeFf+ymI9c+NTu+eslSgtCnTNWbYUrk1756+U
RqMUMpM8S9bjrJ2QJ4JPuVyJGJ1QWBJQhNMVqM9qG+FeCS2iKVfk7WgqG6FX+9wa
C3BadsBzm4B+pdw2TdT8NYeM6wKBgQDNjadzjCa+tzNmkZ8tNHa071AdRiXaSc7a
TVJjBix8dt0BecZ9ExVSYnF26mLoNVPUMZ1uaVVSQuf+3kt/aWBHydZs5jNR7ai2
P6w0USYTWMcRfCqElK60FKE2jjcpyXA2JbsTxhCpgD7dVClnDcelo13BO+vqonSg
y7X+flSIYwKBgEsqKtaGAV2n7gCcwwJ/8C4lnBw0ua5IJ9L5dXExvLpNlF3ld5FP
6KZ9zV3aU5RC/75i5xzpndD+sdsx1FPmXYq7ZZlDj190/b3mA0L1Z3q5+LkGa9c8
QU4cTWUoAe8970MBnowY0wNlj7wNIYXhEQqywLaJwNo6vNcVFpP14Cc3AoGAZ2Fk
I6AMaIT5TA/XT8QAI/XshBygsw3GBFM5KWaUfzDE7JYTdxpe8eVjDZzKi+EuPR2L
AVnmuI2/4pZowDb+Xnyr5G9OxljSLn8Nm+5oSPiwfiHFvJKO3zE095xFMDYIwqLt
WP+Xp7hBZc2LWTI8BBmK8MGzYHm+UJTD/rAI0eMCgYA6I+fJw74H4iZccTX3TkZ6
Fk7q2BNatbP08mFIJKG25iAe+P5ylvoHMSArMWa/xrLD0sBXxUfrT31i6/yS77b/
rY5cjxKDDUPDE7/DzfeihEfoDelrXbAWEAjrCGlA78UVhyaV4dJggP8082egGdcW
MnHZhW23NLZh227bNjf0hw==
-----END PRIVATE KEY-----
`;

const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDGjCCAgKgAwIBAgIUQZlESFbeGcfMJOk1hzlr7pkjcUYwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDgwMzIyNDAxMVoXDTM2MDcz
MTIyNDAxMVowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAwZh6WEnn85NhMkFxnPOfmVy6ce2wTJTWDpPflsZHsLg7
oi55Kd8qKgbzVsQg8Fp31Khc7nbNeTDgi7w4XYiqd7GOn0cB2cTPyT4NT+0UclqH
e5Ys294//NzU8L0CkZUFxv9WKoFGYhCxAb/2akpTJZIhPTl8KNOKgj8tTerekK/J
LEiDBqWGoIJ3MMgFrN7eJ6LuD/YrE9XhKsjQRVUeATDFdpC+YVcIyVuUWEKKcE2K
1zBRrHE758P1LIsvyjV9ZVpFNAzFWNhFze/8K4RZt71SmNjA8KdfjRoI2bV6E800
yjlqrDu+N6fCrlgmFfgRPCrl4sa8oIHv0pn4nWRW4QIDAQABo2QwYjAdBgNVHQ4E
FgQU4qlDY1SKnBdEe3RHM8xpHEAZuE4wHwYDVR0jBBgwFoAU4qlDY1SKnBdEe3RH
M8xpHEAZuE4wDwYDVR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMA0GCSqG
SIb3DQEBCwUAA4IBAQAM2HqWdMhT5ERTRjZQ+KZ+G1kuBr8oikSJyRQr5LByY0xC
lEp+2knN6FwpZ5I9qkbKGA+lDoC03Dm4oIgjJLbbFS+9Mq61V1McVi/nvPFUubGx
a5txprnsTJIijA0Mh34dv5LmxpfPGqNxeJVhgS3lBCDCIAcl5aJ1DyyddJI/tzwO
fG8pSIKNJNNP82ywBCAU/1aFz0WN1TCWq4Oy3kRKijh67OuBHk4L7MDUMtRoZ6/7
H61HmlBBlUm4i8HGrIhukxoQ6q7l1cpXvW5aQN0zrJLEfNBpb+In3BTTHTgHhA2j
6oXTNjO9xqiaZdRHfdhUa783WGkHgw4SOBZgO14O
-----END CERTIFICATE-----
`;

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
// generateSignature signs the exact serialized request body that is POSTed
// (deliverWebhook's `body` string — the {event,id,timestamp,data,metadata}
// envelope), not a payload sub-object, so receivers verifying over the raw
// HTTP body get a matching digest. These tests pass an already-serialized
// string, matching that real call site.

test('WebhookDispatcher: generateSignature returns sha256= prefixed HMAC', () => {
  const wd = makeDispatcher();
  const sig = wd.generateSignature(JSON.stringify({ foo: 'bar' }), 'my-secret');
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  wd.destroy();
});

test('WebhookDispatcher: generateSignature is deterministic for equal inputs', () => {
  const wd = makeDispatcher();
  const body = JSON.stringify({ event: 'test', data: { n: 42 } });
  const sig1 = wd.generateSignature(body, 'secret');
  const sig2 = wd.generateSignature(body, 'secret');
  assert.equal(sig1, sig2);
  wd.destroy();
});

test('WebhookDispatcher: generateSignature differs for different secrets', () => {
  const wd = makeDispatcher();
  const body = JSON.stringify({ event: 'test' });
  const sig1 = wd.generateSignature(body, 'secret-a');
  const sig2 = wd.generateSignature(body, 'secret-b');
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

// ── deliverWebhook (real delivery against a local HTTPS fixture server) ───────
//
// The tests above never exercise an actual delivery (dispatch() with
// immediate:true is the only path that calls deliverWebhook synchronously),
// so the signature-over-the-wrong-thing bug and the ignored fetch timeout
// were both invisible to this file. These use a real local HTTPS server so
// deliverWebhook's request body/headers can be inspected exactly as the
// receiving end would see them.

describe('WebhookDispatcher: deliverWebhook (real HTTPS delivery)', () => {
  let server;
  let baseUrl;
  let lastRequest = null;

  before(async () => {
    server = https.createServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT }, (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (req.url === '/hang') return; // never respond — for the timeout test below
        lastRequest = { headers: req.headers, rawBody: Buffer.concat(chunks).toString('utf8') };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `https://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections(); // the /hang route deliberately never ends its response
    await new Promise((resolve) => server.close(resolve));
  });

  test('signs the exact serialized body it POSTs — signature verifies against the raw request body received', async () => {
    const wd = makeDispatcher({ maxRetries: 0 });
    const secret = 'delivery-test-secret';
    const url = `${baseUrl}/hook`;
    wd.registerWebhook(url, { events: ['*'], signingSecret: secret });

    try {
      const results = await wd.dispatch('job_complete', { jobId: 'abc123' }, { urls: [url], immediate: true });
      assert.equal(results.length, 1);
      assert.equal(results[0].success, true, `expected a successful delivery, got: ${JSON.stringify(results[0])}`);
      assert.equal(results[0].status, 200);

      assert.ok(lastRequest, 'the fixture server should have received the request');
      const receivedSignature = lastRequest.headers['x-webhook-signature'];
      assert.match(receivedSignature, /^sha256=[0-9a-f]{64}$/);

      const expectedSignature = 'sha256=' + crypto.createHmac('sha256', secret).update(lastRequest.rawBody).digest('hex');
      assert.equal(
        receivedSignature,
        expectedSignature,
        'X-Webhook-Signature must verify against the exact raw request body the receiver sees (not just an in-memory payload sub-object)'
      );

      // The signed body is also the real envelope deliverWebhook constructs.
      const parsedBody = JSON.parse(lastRequest.rawBody);
      assert.equal(parsedBody.event, 'job_complete');
      assert.deepEqual(parsedBody.data, { jobId: 'abc123' });
    } finally {
      wd.destroy();
    }
  });

  test('aborts delivery at config.timeout instead of hanging on a slow/unresponsive endpoint', async () => {
    const wd = makeDispatcher({ maxRetries: 0 });
    const url = `${baseUrl}/hang`;
    const timeout = 150;
    wd.registerWebhook(url, { events: ['*'], timeout });

    try {
      const startedAt = Date.now();
      const results = await wd.dispatch('job_complete', { jobId: 'slow' }, { urls: [url], immediate: true });
      const elapsed = Date.now() - startedAt;

      assert.equal(results.length, 1);
      assert.equal(results[0].success, false, 'a hung endpoint must not be reported as a successful delivery');
      assert.match(results[0].error, /abort/i, `expected an abort-related error, got: ${results[0].error}`);

      // Generous upper bound (well under this file's default test timeout)
      // that would fail if the timeout were silently ignored — the /hang
      // route never responds, so an unbounded wait would hang the test runner.
      assert.ok(
        elapsed < timeout + 2000,
        `delivery took ${elapsed}ms — expected it to abort at ~${timeout}ms, not hang waiting on the unresponsive endpoint`
      );
    } finally {
      wd.destroy();
    }
  });
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

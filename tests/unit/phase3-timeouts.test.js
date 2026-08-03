/**
 * Phase 3 — Resource Leaks, Timeouts & Robustness regression tests.
 *
 * Run: node --test tests/unit/phase3-timeouts.test.js --test-force-exit
 * (force-exit: WebhookDispatcher starts a 100ms setInterval in its
 *  constructor regardless of options — cleared via wd.destroy() in each
 *  test's finally, but --test-force-exit is kept as a backstop per repo
 *  convention.)
 *
 * Every test below spins up a real 127.0.0.1 server (port 0 / ephemeral) that
 * either trickles a response body (headers + one chunk, then never ends) or
 * never responds at all, then proves the tool under test aborts at its
 * configured deadline instead of hanging.
 *
 * A per-test `{ timeout: N }` option is used throughout as a safety net: if a
 * fix described in plan/phase-3-leaks-robustness.md hasn't landed yet, the
 * affected fetch would otherwise hang past Node's default undici timeouts
 * (minutes), stalling the whole run. With the option, node:test instead fails
 * that single test after N ms and moves on — a "test timed out" failure in
 * this file means the corresponding fix has not landed (or regressed), not
 * that the suite is stuck.
 *
 * SSRF_PROTECTION_ENABLED is disabled for this file's process only, before
 * any module under test is imported (config.js reads it once at import time,
 * hence the dynamic imports below instead of static ones) — otherwise every
 * 127.0.0.1 target here would be rejected by the SSRF guard's default
 * blockedDomains list (127.0.0.1/localhost). See src/utils/ssrfGuard.js.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.SSRF_PROTECTION_ENABLED = 'false';

const { fetchWithTimeout } = await import('../../src/tools/basic/_fetch.js');
const { fetchUrl, scrapeUrl } = await import('../../src/tools/advanced/batchScrape/worker.js');
const { fetchAndParse } = await import('../../src/tools/extract/_fetchAndParse.js');
const { searchViaSearxng } = await import('../../src/tools/search/providers/searxng.js');
const { WebhookDispatcher } = await import('../../src/core/WebhookDispatcher.js');
const { ResearchOrchestrator } = await import('../../src/core/ResearchOrchestrator.js');
const { PDFProcessor } = await import('../../src/core/processing/PDFProcessor.js');

// ── local test-server helpers ───────────────────────────────────────────────

const openServers = [];

function listen(server) {
  openServers.push(server);
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function closeServer(server) {
  server.closeAllConnections?.(); // force-close hung keep-alive sockets (Node >=18.2)
  await new Promise((resolve) => server.close(resolve));
  const idx = openServers.indexOf(server);
  if (idx !== -1) openServers.splice(idx, 1);
}

function urlFor(server, path = '/') {
  return `http://127.0.0.1:${server.address().port}${path}`;
}

/** Sends 200 + headers + a small first chunk, then never calls res.end(). */
function trickleServer(extraHeaders = {}) {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html', ...extraHeaders });
    res.write('<html><body>partial content that never finishes...');
    // deliberately never end the response
  });
}

/** Accepts the TCP connection but never writes a response at all. */
function neverRespondServer() {
  return http.createServer(() => { /* no res.write / res.end */ });
}

// Backstop in case a test fails before its own finally/close block runs.
after(async () => {
  await Promise.all(openServers.slice().map((s) => closeServer(s).catch(() => {})));
});

// ── 1. src/tools/basic/_fetch.js ────────────────────────────────────────────

test('_fetch.js fetchWithTimeout: aborts a trickling body at the timeout instead of hanging', { timeout: 8000 }, async () => {
  const server = await listen(trickleServer());
  try {
    const start = Date.now();
    await assert.rejects(
      () => fetchWithTimeout(urlFor(server), { timeout: 2000 }),
      /Request timeout after 2000ms/
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 6000, `expected rejection within ~6s of a 2s body-read timeout, took ${elapsed}ms`);
  } finally {
    await closeServer(server);
  }
});

test(
  '_fetch.js fetchWithTimeout: Content-Length size cap (skipped — already covered by existing tests)',
  { skip: 'oversized-Content-Length rejection is pre-existing behavior for this helper; this file adds coverage for the new body-read timeout only' },
  () => {}
);

// ── 2. src/tools/advanced/batchScrape/worker.js ─────────────────────────────

test('batchScrape/worker.js fetchUrl: aborts a trickling body at the timeout instead of hanging', { timeout: 8000 }, async () => {
  const server = await listen(trickleServer());
  try {
    const start = Date.now();
    await assert.rejects(
      () => fetchUrl(urlFor(server), { timeout: 2000 }),
      /Request timeout after 2000ms/
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 6000, `expected rejection within ~6s of a 2s body-read timeout, took ${elapsed}ms`);
  } finally {
    await closeServer(server);
  }
});

test('batchScrape/worker.js scrapeUrl: returns a failed result (not a hang) against a trickling body', { timeout: 8000 }, async () => {
  const server = await listen(trickleServer());
  try {
    const start = Date.now();
    const result = await scrapeUrl({ url: urlFor(server) }, { formats: ['text'] }, 2000);
    const elapsed = Date.now() - start;
    assert.equal(result.success, false, 'expected scrapeUrl to report failure rather than hang on a trickling body');
    assert.match(result.error, /Request timeout after 2000ms/);
    assert.ok(elapsed < 6000, `expected failure within ~6s of a 2s timeout, took ${elapsed}ms`);
  } finally {
    await closeServer(server);
  }
});

// ── 3. src/tools/extract/_fetchAndParse.js ──────────────────────────────────

test('_fetchAndParse.js: an oversized Content-Length is rejected fast, without buffering the body', { timeout: 20000 }, async () => {
  const server = await listen(trickleServer({ 'Content-Length': String(50 * 1024 * 1024) })); // 50MB declared, never actually sent
  try {
    const start = Date.now();
    await assert.rejects(
      () => fetchAndParse(urlFor(server), { timeoutMs: 15000 }),
      /too large/i
    );
    const elapsed = Date.now() - start;
    // The Content-Length pre-check should reject immediately after headers
    // arrive, well before the 15s AbortSignal timeout would ever fire.
    assert.ok(elapsed < 5000, `expected the size cap to reject quickly (well under the 15s timeout), took ${elapsed}ms — looks like the body-size cap has not landed`);
  } finally {
    await closeServer(server);
  }
});

test('_fetchAndParse.js: a trickling body (no oversized Content-Length) still aborts at timeoutMs', { timeout: 8000 }, async () => {
  const server = await listen(trickleServer());
  try {
    const start = Date.now();
    await assert.rejects(() => fetchAndParse(urlFor(server), { timeoutMs: 2000 }));
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 6000, `expected the AbortSignal timeout to fire within ~6s of a 2s timeoutMs, took ${elapsed}ms`);
  } finally {
    await closeServer(server);
  }
});

// ── 4. src/tools/search/providers/searxng.js ────────────────────────────────

test('searxng.js searchViaSearxng: rejects with a timeout instead of hanging indefinitely', { timeout: 25000 }, async () => {
  const server = await listen(neverRespondServer());
  try {
    const start = Date.now();
    await assert.rejects(
      () => searchViaSearxng({ query: 'test query', instanceUrl: urlFor(server) }),
      /timed out/i
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 19000, `expected rejection within ~20s (fixed 15s AbortSignal.timeout), took ${elapsed}ms`);
  } finally {
    await closeServer(server);
  }
});

// ── 5. src/core/WebhookDispatcher.js ────────────────────────────────────────

test('WebhookDispatcher deliverWebhook: fails within its configured timeout instead of hanging', { timeout: 8000 }, async () => {
  const server = await listen(neverRespondServer());
  const wd = new WebhookDispatcher({
    queueDir: '/tmp/phase3-webhook-test-unused',
    enablePersistence: false,
    enableHealthMonitoring: false,
    enableLogging: false,
    maxRetries: 0 // avoid RetryManager's backoff delay so the test stays fast
  });

  // registerWebhook() enforces HTTPS-only URLs, which our local test server
  // can't satisfy — inject the internal config directly instead (same shape
  // registerWebhook itself builds) to exercise deliverWebhook() in isolation.
  const url = urlFor(server, '/hook');
  wd.webhookUrls.set(url, {
    id: 'phase3-test-hook',
    url,
    enabled: true,
    events: ['*'],
    headers: {},
    timeout: 1500,
    maxRetries: 0,
    retryDelay: 100,
    signingSecret: null,
    metadata: {},
    createdAt: Date.now(),
    lastUsed: null
  });

  try {
    const start = Date.now();
    const results = await wd.dispatch('test_event', { hello: 'world' }, { immediate: true, urls: [url] });
    const elapsed = Date.now() - start;
    assert.equal(results.length, 1);
    assert.equal(results[0].success, false, 'expected delivery to fail (not hang) against a never-responding server');
    assert.ok(elapsed < 5000, `expected failure within ~5s of a 1.5s webhook timeout, took ${elapsed}ms`);
  } finally {
    wd.destroy(); // stops the dispatcher's own 100ms queue-processing interval
    await closeServer(server);
  }
});

// ── 6. src/core/ResearchOrchestrator.js processWithTimeLimit ───────────────

test('ResearchOrchestrator.processWithTimeLimit: the racer timer is cleared once the stage resolves', async () => {
  const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
  ro.researchState.deadline = Date.now() + 30000;

  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const created = new Set();
  const cleared = new Set();
  global.setTimeout = (...args) => {
    const id = originalSetTimeout(...args);
    created.add(id);
    return id;
  };
  global.clearTimeout = (id) => {
    cleared.add(id);
    return originalClearTimeout(id);
  };

  try {
    await ro.processWithTimeLimit(async () => 'quick result');
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }

  assert.ok(created.size >= 1, 'expected processWithTimeLimit to create at least one timer');
  for (const id of created) {
    assert.ok(cleared.has(id), `timer ${String(id)} created by processWithTimeLimit was never cleared — leaked racer timer`);
  }
});

test('ResearchOrchestrator.processWithTimeLimit: aborts the stage signal at the deadline and resolves once it unwinds', { timeout: 8000 }, async () => {
  const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
  const deadlineMs = 300;
  ro.researchState.deadline = Date.now() + deadlineMs;

  let observedSignal = null;
  let sawAbort = false;
  const slowStage = async (signal) => {
    observedSignal = signal;
    // Mirrors the real stage loops (e.g. exploreSourcesInDepth), which check
    // signal.aborted between fast iterations rather than running unbounded.
    for (let i = 0; i < 200; i++) {
      if (signal.aborted) { sawAbort = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  const start = Date.now();
  await ro.processWithTimeLimit(slowStage);
  const elapsed = Date.now() - start;

  assert.ok(observedSignal instanceof AbortSignal, 'expected the stage function to receive an AbortSignal');
  assert.ok(sawAbort, 'expected the stage to observe signal.aborted once the shared deadline passed');
  assert.ok(
    elapsed < deadlineMs + 2000,
    `expected processWithTimeLimit to resolve shortly after the ${deadlineMs}ms deadline once the stage unwound, took ${elapsed}ms`
  );
});

// ── 7. src/core/processing/PDFProcessor.js ──────────────────────────────────

test('PDFProcessor.downloadPDFFromURL: oversized Content-Length rejects fast (does not wait out the 30s fetch timeout)', { timeout: 10000 }, async () => {
  // A real 30s trickle-then-timeout test is too slow for a unit test (per the
  // task's own guidance); the size-cap path added alongside the timeout fix
  // is fast and independently verifiable via the Content-Length pre-check.
  const server = await listen(trickleServer({
    'Content-Type': 'application/pdf',
    'Content-Length': String(200 * 1024 * 1024) // 200MB declared, never actually sent
  }));
  const processor = new PDFProcessor();
  try {
    const start = Date.now();
    await assert.rejects(
      () => processor.downloadPDFFromURL(urlFor(server)),
      /too large/i
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5000, `expected the Content-Length size cap to reject quickly, took ${elapsed}ms — looks like the size cap has not landed`);
  } finally {
    await closeServer(server);
  }
});

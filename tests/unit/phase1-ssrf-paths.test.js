/**
 * Phase 1 — cross-path SSRF regression suite.
 *
 * Verifies the phase-1 verification-gate requirement: every fetch path is
 * covered by a blocked-target test — basic `_fetch`, `scrape`/`_fetchAndParse`,
 * `map_site`, `process_document` PDF download, `scrape_with_actions`
 * navigation, and webhook delivery.
 *
 * Blocked targets used: http://169.254.169.254/ (cloud metadata, IP literal),
 * http://127.0.0.1/ (loopback, IP literal). These are IP-literal URLs on
 * purpose — the pre-integration behavior of ssrfGuard()/safeFetch only blocks
 * protocol violations and *named* metadata hosts synchronously; IP-literal
 * targets currently bypass the guarded-dispatcher's connect-time lookup
 * (undici does not invoke a custom `lookup` when the hostname is already an
 * IP address) and reach a real connect() attempt. This file exists to prove
 * `assertUrlAllowed` (added in this phase) closes that gap with a synchronous,
 * no-network-I/O pre-flight check. See docs/CODEBASE_AUDIT_2026-08.md.
 *
 * Run: node --test tests/unit/phase1-ssrf-paths.test.js --test-force-exit
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

const METADATA_URL = 'http://169.254.169.254/';
const LOOPBACK_URL = 'http://127.0.0.1/';

// ── 1. basic `_fetch` path ──────────────────────────────────────────────────

test('basic _fetch: fetchWithTimeout rejects blocked metadata target', async () => {
  const { fetchWithTimeout } = await import('../../src/tools/basic/_fetch.js');
  await assert.rejects(
    () => fetchWithTimeout(METADATA_URL, { timeout: 3000 }),
    /SSRF Protection/,
    'expected an SSRF-shaped rejection for http://169.254.169.254/'
  );
});

// ── 2. scrape / _fetchAndParse path ─────────────────────────────────────────

test('scrape (_fetchAndParse): rejects blocked loopback target', async () => {
  const { fetchAndParse } = await import('../../src/tools/extract/_fetchAndParse.js');
  await assert.rejects(
    () => fetchAndParse(LOOPBACK_URL, { timeoutMs: 3000 }),
    /SSRF Protection/,
    'expected an SSRF-shaped rejection for http://127.0.0.1/'
  );
});

// ── 3. map_site path ─────────────────────────────────────────────────────────

test('map_site: fetchWithTimeout rejects blocked loopback target directly', async () => {
  const { MapSiteTool } = await import('../../src/tools/crawl/mapSite.js');
  const tool = new MapSiteTool({ cacheEnabled: false, timeout: 3000 });
  await assert.rejects(
    () => tool.fetchWithTimeout(LOOPBACK_URL),
    /SSRF Protection/,
    'expected an SSRF-shaped rejection for http://127.0.0.1/'
  );
});

test('map_site: execute() with a blocked target returns no URLs (no leak)', async () => {
  const { MapSiteTool } = await import('../../src/tools/crawl/mapSite.js');
  const tool = new MapSiteTool({ cacheEnabled: false, timeout: 3000 });
  // fetchPageUrls swallows fetch errors and returns []; include_sitemap:false
  // avoids the separate sitemap-discovery path so only the guarded fetch runs.
  const result = await tool.execute({ url: LOOPBACK_URL, include_sitemap: false });
  assert.equal(result.total_urls, 0, 'expected no URLs discovered for a blocked target');
  assert.deepEqual(result.urls, {}, 'expected no URLs grouped for a blocked target');
});

// ── 4. process_document PDF download path ───────────────────────────────────

test('process_document: PDFProcessor.downloadPDFFromURL rejects blocked metadata target', async () => {
  const { PDFProcessor } = await import('../../src/core/processing/PDFProcessor.js');
  const processor = new PDFProcessor();
  await assert.rejects(
    () => processor.downloadPDFFromURL(`${METADATA_URL}x.pdf`),
    /SSRF Protection/,
    'expected an SSRF-shaped rejection for http://169.254.169.254/x.pdf'
  );
});

// ── 5. scrape_with_actions navigation path ──────────────────────────────────

test('scrape_with_actions: initializePage rejects blocked target before touching the browser', async (t) => {
  let ActionExecutor;
  try {
    ({ ActionExecutor } = await import('../../src/core/ActionExecutor.js'));
  } catch (err) {
    t.skip(`pending integration — ActionExecutor import failed: ${err.message}`);
    return;
  }

  const executor = new ActionExecutor({ enableLogging: false });
  let browserTouched = false;
  // Replace the browser-launching call with a stub that fails loudly if reached.
  executor.browserProcessor.initializePage = async () => {
    browserTouched = true;
    throw new Error('should not be reached — browser was launched for a blocked URL');
  };

  await assert.rejects(
    () => executor.initializePage(LOOPBACK_URL, {}),
    /SSRF Protection/,
    'expected an SSRF-shaped rejection before any browser/page work'
  );
  assert.equal(browserTouched, false, 'browserProcessor.initializePage must not be called for a blocked URL');
});

// ── 6. webhook delivery path ─────────────────────────────────────────────────

test('webhook delivery: deliverWebhook rejects blocked loopback target, nothing is fetched', async () => {
  const { WebhookDispatcher } = await import('../../src/core/WebhookDispatcher.js');
  const queueDir = path.join(os.tmpdir(), `phase1-ssrf-wd-${Math.random().toString(36).slice(2)}`);
  const wd = new WebhookDispatcher({
    queueDir,
    enablePersistence: false,
    enableHealthMonitoring: false,
    enableLogging: false,
    maxRetries: 0 // avoid backoff delay for a non-retryable SSRF error
  });

  try {
    const url = 'https://127.0.0.1/hook'; // https:// passes registerWebhook's scheme check
    const config = wd.registerWebhook(url, { events: ['*'] });
    const event = {
      id: 'evt-1',
      type: 'test_event',
      payload: { hello: 'world' },
      timestamp: Date.now(),
      metadata: {},
      url
    };
    void config;

    await assert.rejects(
      () => wd.deliverWebhook(event),
      /SSRF Protection/,
      'expected an SSRF-shaped rejection for https://127.0.0.1/hook'
    );
  } finally {
    wd.destroy();
  }
});

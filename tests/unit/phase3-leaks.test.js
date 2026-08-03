/**
 * Phase 3 — Resource Leaks, Timeouts & Robustness: verification-gate regression tests.
 *
 * Covers the "Leak assertions" bullet of the Phase 3 verification gate
 * (plan/phase-3-leaks-robustness.md):
 *   - CacheManager / BFSCrawler: destroy() lets the instance be GC'd (WeakRef + --expose-gc).
 *   - BatchScrapeTool.batchResults: expired entries evicted on read; bounded size (LRU cap).
 *   - SnapshotManager: .meta files no longer embed full content; metadataCache is bounded.
 *   - LocalizationManager: cleanup() clears its health-check intervals.
 *   - trackChanges/index.js: importing the module no longer eagerly constructs a
 *     TrackChangesTool (no cache/ or snapshots/ dirs, no hang).
 *   - ActionExecutor: executionHistory entries strip finalHtml/screenshot payloads.
 *
 * Six implementation agents may be landing these fixes concurrently with this file.
 * A failing test here can mean either a real regression or a fix that simply hasn't
 * landed yet — see the final report for which is which.
 *
 * No live network: WeakRef/timer checks run in spawned `node --expose-gc` child
 * scripts against local temp dirs; the ActionExecutor test uses a fully faked
 * Playwright `page` (no browser launch) with ALLOWED_DOMAINS=127.0.0.1 so the SSRF
 * pre-flight check (which needs to run) never touches real DNS/network.
 *
 * Run: node --test tests/unit/phase3-leaks.test.js --test-force-exit
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Local-loopback allowlist so ActionExecutor's SSRF pre-flight (assertUrlAllowed)
// doesn't need real DNS/network for the faked-page test below. Must be set before
// the first (transitive) import of src/constants/config.js — see bfsCrawler.test.js
// for the same pattern. `node --test` runs each test file in its own subprocess, so
// this does not leak into sibling test files.
process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

function srcUrl(relPath) {
  return pathToFileURL(path.join(REPO_ROOT, relPath)).href;
}

async function mkTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * Run `code` as a standalone ESM script in a child `node` process.
 * Returns { stdout, stderr, timedOut }. `timedOut: true` means the process
 * had to be killed — i.e. something kept the event loop alive (a leaked timer).
 */
async function runChildScript(code, { args = [], timeoutMs = 15000, cwd } = {}) {
  const dir = await mkTempDir('phase3-leaks-child-');
  const scriptPath = path.join(dir, 'script.mjs');
  await fs.writeFile(scriptPath, code, 'utf8');
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [...args, scriptPath],
      { timeout: timeoutMs, cwd: cwd || dir }
    );
    return { stdout, stderr, timedOut: false };
  } catch (err) {
    const timedOut = err.killed === true || err.signal === 'SIGTERM';
    return { stdout: err.stdout || '', stderr: err.stderr || '', timedOut, error: err };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function lastJsonLine(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

// Project modules imported dynamically, after the env vars above are set (see
// bfsCrawler.test.js for why: src/core modules transitively import
// src/constants/config.js, which reads ALLOWED_DOMAINS at import time).
const { CacheManager } = await import(srcUrl('src/core/cache/CacheManager.js'));
const { BFSCrawler } = await import(srcUrl('src/core/crawlers/BFSCrawler.js'));
const { BatchScrapeTool } = await import(srcUrl('src/tools/advanced/batchScrape/index.js'));
const { SnapshotManager } = await import(srcUrl('src/core/SnapshotManager.js'));
const { ActionExecutor } = await import(srcUrl('src/core/ActionExecutor.js'));

// ---------------------------------------------------------------------------
// 1. CacheManager — destroy() clears its cleanup/monitoring interval timers.
//
// NOTE ON METHODOLOGY: the plan asks for a WeakRef + --expose-gc leak check
// (matching how the audit itself verified this bug). That was tried first here
// and discarded: in this environment, a bare `new (await import('lru-cache')).LRUCache()`
// — entirely unrelated to CacheManager/BFSCrawler — is never observed as
// collected by `global.gc()` even after 50 iterations under allocation
// pressure, with both minor and forced-major/sync GC, and regardless of
// setTimeout vs setImmediate scheduling used to yield between calls (a plain
// class instance with no lru-cache involvement WAS reliably collected the
// same way). That points to a lru-cache@11.5.2 / Node v24.3.0 GC interaction
// having nothing to do with this fix, which would make a WeakRef assertion a
// guaranteed false negative for every test in this describe block. Instead,
// we assert the literal, synchronously-observable claim of the fix: that
// destroy() calls clearInterval on both timers (Node sets the internal
// `_destroyed` flag synchronously when a Timeout is cleared).
// ---------------------------------------------------------------------------

describe('CacheManager leak fix (src/core/cache/CacheManager.js)', () => {
  test('destroy() clears the cleanup and monitoring interval timers', () => {
    const cache = new CacheManager({
      diskCacheDir: path.join(os.tmpdir(), 'phase3-cache-destroy-test'),
      enableDiskCache: false
    });
    try {
      assert.ok(cache.cleanupTimer, 'expected CacheManager to create a cleanupTimer');
      assert.ok(cache.monitoringTimer, 'expected CacheManager to create a monitoringTimer');
      assert.equal(cache.cleanupTimer._destroyed, false);
      assert.equal(cache.monitoringTimer._destroyed, false);

      cache.destroy();

      assert.equal(cache.cleanupTimer._destroyed, true, 'destroy() must clearInterval the cleanup timer');
      assert.equal(cache.monitoringTimer._destroyed, true, 'destroy() must clearInterval the monitoring timer');
    } finally {
      cache.destroy(); // idempotent safety net
    }
  });

  test('a short-lived process that constructs (without destroying) a CacheManager still exits promptly', async () => {
    // The cleanup/monitoring timers are .unref()'d regardless of destroy(), so this
    // only proves the unref discipline holds — it does NOT prove the instance/its
    // cached data is released (destroy() is still required for that; see the
    // synchronous _destroyed assertion above).
    const code = `
      const { CacheManager } = await import(${JSON.stringify(srcUrl('src/core/cache/CacheManager.js'))});
      new CacheManager({ diskCacheDir: ${JSON.stringify(path.join(os.tmpdir(), 'phase3-cache-unref-test'))}, enableDiskCache: false });
      console.log(JSON.stringify({ done: true }));
    `;
    const { stdout, timedOut } = await runChildScript(code, { timeoutMs: 8000 });
    assert.equal(timedOut, false, 'process should exit promptly (cleanup/monitoring timers must be unref\'d)');
    assert.match(stdout, /"done":true/);
  });
});

// ---------------------------------------------------------------------------
// 2. BFSCrawler — destroy() releases its owned CacheManager's timers.
// ---------------------------------------------------------------------------

describe('BFSCrawler leak fix (src/core/crawlers/BFSCrawler.js)', () => {
  test('destroy() tears down the underlying CacheManager (clearInterval on both timers)', () => {
    const crawler = new BFSCrawler({ maxDepth: 1, maxPages: 1 });
    assert.equal(typeof crawler.destroy, 'function', 'BFSCrawler must expose a destroy()/cleanup() method');

    const cache = crawler.cache;
    assert.ok(cache?.cleanupTimer && cache?.monitoringTimer, 'expected the crawler\'s CacheManager to have created its timers');
    assert.equal(cache.cleanupTimer._destroyed, false);
    assert.equal(cache.monitoringTimer._destroyed, false);

    crawler.destroy();

    assert.equal(cache.cleanupTimer._destroyed, true, 'BFSCrawler.destroy() must clear its CacheManager\'s cleanup timer');
    assert.equal(cache.monitoringTimer._destroyed, true, 'BFSCrawler.destroy() must clear its CacheManager\'s monitoring timer');
  });

  test('crawlDeep-style usage: N construct+destroy cycles leave no accumulation of live timers', () => {
    const crawlers = [];
    for (let i = 0; i < 5; i++) {
      crawlers.push(new BFSCrawler({ maxDepth: 1, maxPages: 1 }));
    }
    for (const crawler of crawlers) crawler.destroy();
    for (const crawler of crawlers) {
      assert.equal(crawler.cache.cleanupTimer._destroyed, true);
      assert.equal(crawler.cache.monitoringTimer._destroyed, true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. BatchScrapeTool.batchResults — TTL sweep on read + LRU cap.
// ---------------------------------------------------------------------------

describe('BatchScrapeTool.batchResults bounding (src/tools/advanced/batchScrape/index.js)', () => {
  test('getBatchResults deletes expired cache entries on read (not just skips them)', async () => {
    const tool = new BatchScrapeTool({ enableJobPersistence: false, enableWebhookNotifications: false });
    try {
      const batchId = 'phase3_expired_batch';
      tool.batchResults.set(batchId, {
        results: [{ url: 'https://example.com/expired', success: true }],
        timestamp: Date.now() - 10_000,
        ttl: 100 // already well expired
      });

      await assert.rejects(() => tool.getBatchResults(batchId), /not found/i);
      assert.equal(
        tool.batchResults.has(batchId),
        false,
        'an expired batch entry must be evicted from the cache on read, not merely fall through to "not found" while still occupying memory'
      );
    } finally {
      await tool.destroy();
    }
  });

  test('batchResults does not grow without bound as more batches are cached than the configured cap', async () => {
    const cap = 10;
    const tool = new BatchScrapeTool({ enableJobPersistence: false, enableWebhookNotifications: false, maxCachedBatches: cap });
    try {
      const N = 50;
      for (let i = 0; i < N; i++) {
        // Exercise the tool's real write path (the one _processBatchSync /
        // the async job executor actually use), not the raw Map — a cap
        // enforced only in that helper would otherwise be invisible to a
        // test that pokes the Map directly.
        tool._cacheBatchResult(`phase3_batch_${i}`, [{ url: `https://example.com/${i}`, success: true }]);
      }
      assert.ok(
        tool.batchResults.size <= cap,
        `expected batchResults to be capped at maxCachedBatches (${cap}), got ${tool.batchResults.size}`
      );
    } finally {
      await tool.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. SnapshotManager — .meta files no longer embed full content;
//    metadataCache is bounded.
// ---------------------------------------------------------------------------

describe('SnapshotManager metadata leak fix (src/core/SnapshotManager.js)', () => {
  async function ready(manager) {
    if (typeof manager.ensureInitialized === 'function') {
      await manager.ensureInitialized();
    } else if (manager._initPromise) {
      await manager._initPromise;
    }
  }

  test('.meta files no longer embed the full snapshot content', async () => {
    const storageDir = await mkTempDir('phase3-snapshot-meta-');
    const manager = new SnapshotManager({
      storageDir,
      metadataDir: path.join(storageDir, 'metadata'),
      tempDir: path.join(storageDir, 'temp'),
      cacheEnabled: true
    });
    try {
      await ready(manager);

      const MARKER = 'PHASE3_LEAK_TEST_CONTENT_MARKER_' + 'Q'.repeat(2000);
      const stored = await manager.storeSnapshot('https://example.com/phase3-leak-test', MARKER, {
        contentType: 'text/html'
      });

      const metaPath = path.join(storageDir, 'metadata', `${stored.snapshotId}.meta`);
      const metaRaw = await fs.readFile(metaPath, 'utf8');
      assert.ok(
        !metaRaw.includes(MARKER),
        '.meta file must not embed the full snapshot content (should be stripped, kept only in the .snap file)'
      );

      // Round-trip: content must still be fully recoverable from the .snap file.
      const retrieved = await manager.retrieveSnapshot(stored.snapshotId, { includeContent: true });
      assert.equal(
        retrieved.content,
        MARKER,
        'retrieveSnapshot must still return the full original content (read from the .snap file, not the stripped .meta)'
      );
    } finally {
      await manager.shutdown().catch(() => {});
      await fs.rm(storageDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test('metadataCache stays bounded as more snapshots are stored than a configured cache size', async () => {
    const storageDir = await mkTempDir('phase3-snapshot-bound-');
    const cap = 5;
    const manager = new SnapshotManager({
      storageDir,
      metadataDir: path.join(storageDir, 'metadata'),
      tempDir: path.join(storageDir, 'temp'),
      cacheEnabled: true,
      // snapshotCache is bounded by `cacheSize`; metadataCache is bounded
      // separately by `metadataCacheSize` (default 10000) — see
      // SnapshotManager.js's boundedMetadataCacheSet()/updateCache().
      cacheSize: cap,
      metadataCacheSize: cap
    });
    try {
      await ready(manager);

      const total = 30;
      for (let i = 0; i < total; i++) {
        await manager.storeSnapshot(`https://example.com/phase3-page-${i}`, `content-${i}`, {});
      }

      assert.ok(
        manager.metadataCache.size <= cap,
        `expected metadataCache to be bounded at metadataCacheSize (${cap}), got ${manager.metadataCache.size}`
      );
    } finally {
      await manager.shutdown().catch(() => {});
      await fs.rm(storageDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// 5. LocalizationManager — cleanup() clears the health-check intervals.
// ---------------------------------------------------------------------------

describe('LocalizationManager cleanup fix (src/core/LocalizationManager.js)', () => {
  test('cleanup() clears health-check intervals so a short-lived process exits promptly', async () => {
    const code = `
      const { LocalizationManager } = await import(${JSON.stringify(srcUrl('src/core/LocalizationManager.js'))});
      const manager = new LocalizationManager();
      // Let the async initialize() (fired un-awaited from the constructor) finish
      // setting up its health-check intervals before we clean them up.
      await new Promise(r => setTimeout(r, 300));
      await manager.cleanup();
      console.log(JSON.stringify({ done: true }));
    `;
    const { stdout, stderr, timedOut } = await runChildScript(code, { timeoutMs: 8000 });
    assert.equal(
      timedOut,
      false,
      `process should exit promptly after cleanup() — a live setInterval would otherwise keep it alive. stderr:\n${stderr}`
    );
    assert.match(stdout, /"done":true/);
  });
});

// ---------------------------------------------------------------------------
// 6. trackChanges/index.js — no eager module-level singleton.
// ---------------------------------------------------------------------------

describe('trackChanges eager-singleton fix (src/tools/tracking/trackChanges/index.js)', () => {
  test('importing the module does not eagerly construct a TrackChangesTool (no cache/ or snapshots/ dirs, no hang)', async () => {
    const tmpCwd = await mkTempDir('phase3-trackchanges-cwd-');
    try {
      const code = `
        await import(${JSON.stringify(srcUrl('src/tools/tracking/trackChanges/index.js'))});
        console.log(JSON.stringify({ imported: true }));
      `;
      const { stdout, stderr, timedOut } = await runChildScript(code, { timeoutMs: 15000, cwd: tmpCwd });
      assert.equal(timedOut, false, `importing the module should not hang the process. stderr:\n${stderr}`);
      assert.match(stdout, /"imported":true/);

      const cacheDirExists = await fs.access(path.join(tmpCwd, 'cache')).then(() => true, () => false);
      const snapshotsDirExists = await fs.access(path.join(tmpCwd, 'snapshots')).then(() => true, () => false);
      assert.equal(
        cacheDirExists,
        false,
        'importing the module should not eagerly create a cache/ directory in cwd — the module-level singleton must be lazy'
      );
      assert.equal(
        snapshotsDirExists,
        false,
        'importing the module should not eagerly create a snapshots/ directory in cwd — the module-level singleton must be lazy'
      );
    } finally {
      await fs.rm(tmpCwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// 7. ActionExecutor.executionHistory — no finalHtml / screenshot payloads retained.
// ---------------------------------------------------------------------------

describe('ActionExecutor executionHistory leak fix (src/core/ActionExecutor.js)', () => {
  test('history entries strip finalHtml and screenshot payloads (retain only metadata)', async () => {
    // defaultTimeout kept short: executeActionInternal races each action against
    // an un-cleared setTimeout (ref'd) that otherwise keeps this process alive
    // for the full default 10s even after the action resolves instantly.
    const executor = new ActionExecutor({ enableScreenshotOnError: false, defaultTimeout: 500 });
    try {
      const FINAL_HTML_MARKER = 'PHASE3_LEAK_TEST_FINAL_HTML_' + 'Z'.repeat(2048);
      const screenshotBuffer = Buffer.from('PHASE3_LEAK_TEST_SCREENSHOT_' + 'Y'.repeat(2048));

      // Fully faked Playwright page — no browser launch, no network. The SSRF
      // pre-flight in ActionExecutor.initializePage still runs against a real
      // (loopback, allowlisted) URL, but browserProcessor.initializePage itself
      // is monkey-patched so no Chromium is ever spawned.
      const fakePage = {
        goto: async () => {},
        url: () => 'http://127.0.0.1/phase3-fake-page',
        content: async () => FINAL_HTML_MARKER,
        screenshot: async () => screenshotBuffer,
        close: async () => {},
        // Non-stealth pages get their owning BrowserContext closed in
        // ActionExecutor's finally block (separate Phase 3 context-leak fix).
        context: () => ({ close: async () => {} })
      };
      executor.browserProcessor.initializePage = async () => fakePage;

      const result = await executor.executeActionChain('http://127.0.0.1/phase3-fake-page', {
        actions: [{ type: 'screenshot', fullPage: true }]
      });
      assert.equal(result.success, true, 'expected the (faked) action chain to succeed');

      const entry = executor.executionHistory[executor.executionHistory.length - 1];
      assert.ok(entry, 'expected an execution history entry to have been recorded');

      const serialized = JSON.stringify(entry);
      assert.ok(
        !serialized.includes(FINAL_HTML_MARKER),
        'execution history must not retain the full finalHtml payload'
      );
      assert.ok(
        !serialized.includes(screenshotBuffer.toString('base64')),
        'execution history must not retain the base64 screenshot payload'
      );
    } finally {
      // destroy() clears executionHistory, so it must run AFTER the assertions above.
      await executor.destroy();
      // Separate, pre-existing gap (see the describe block below): destroy() /
      // browserProcessor.cleanup() never tears down the LocalizationManager
      // BrowserProcessor's constructor eagerly creates, so without this its
      // two ref'd health-check timers would keep this process (and, in real
      // usage, the whole MCP server) alive for up to 10 minutes.
      await executor.browserProcessor.localizationManager?.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Bonus finding (not one of the 6 assigned items, flagged for follow-up):
// BrowserProcessor's constructor unconditionally creates a LocalizationManager
// (src/core/processing/BrowserProcessor.js:146), but BrowserProcessor.cleanup()
// never calls localizationManager.cleanup() — so its two ref'd (non-unref'd)
// health-check timers (setupHealthChecks(), every 5/10 minutes) leak for the
// process lifetime on every ActionExecutor / scrape_with_actions call. This
// directly undermines the "gracefulShutdown leaves no live timer handles"
// verification-gate item, so it's included here even though it's outside the
// 6 items this file was scoped to.
// ---------------------------------------------------------------------------

describe('BrowserProcessor -> LocalizationManager cleanup gap (bonus finding)', () => {
  test('browserProcessor.cleanup() should tear down its LocalizationManager\'s health-check timers', async () => {
    const executor = new ActionExecutor();
    try {
      const lm = executor.browserProcessor.localizationManager;
      assert.ok(lm, 'expected BrowserProcessor to have created a LocalizationManager');

      // Give the async initialize() (fired un-awaited from LocalizationManager's
      // constructor) time to set up its health-check intervals.
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(
        Array.isArray(lm.healthCheckIntervals) && lm.healthCheckIntervals.length > 0,
        'expected LocalizationManager to have created health-check intervals'
      );
      assert.ok(
        lm.healthCheckIntervals.every((t) => t._destroyed === false),
        'expected the health-check intervals to still be live before cleanup'
      );

      await executor.browserProcessor.cleanup();

      assert.ok(
        lm.healthCheckIntervals === null || lm.healthCheckIntervals.every((t) => t._destroyed === true),
        'browserProcessor.cleanup() must clear its LocalizationManager\'s health-check timers (call localizationManager.cleanup())'
      );
    } finally {
      await executor.browserProcessor.localizationManager?.cleanup();
    }
  });
});

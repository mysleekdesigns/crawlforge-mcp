/**
 * D5.2 — Unit tests: trackChanges tool
 * Run: node --test tests/unit/tools/tracking/trackChanges.test.js
 */

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { TrackChangesSchema } from '../../../../src/tools/tracking/trackChanges/schema.js';
import { TrackChangesTool } from '../../../../src/tools/tracking/trackChanges/index.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const stubSnapshot = {
  id: 'snap-001',
  url: 'https://example.com',
  timestamp: Date.now(),
  contentHash: 'abc123hash',
  content: { text: 'Current page content here.', html: '<p>Current page content here.</p>' }
};

const stubDiff = {
  hasChanged: true,
  changeSignificance: 'moderate',
  addedLines: 5,
  removedLines: 2,
  percentChanged: 15.3,
  changes: [{ type: 'addition', content: 'New paragraph added' }]
};

class ChangeTrackerStub {
  constructor(options = {}) { this.options = options; }
  async hashContentAsync(content) { return `hash-${content.length}`; }
  async diff(oldContent, newContent) { return { ...stubDiff }; }
}

class SnapshotManagerStub {
  constructor(options = {}) { this._snapshots = new Map(); }
  async getLatestSnapshot(url) { return this._snapshots.get(url) || null; }
  async saveSnapshot(url, content) {
    const snap = { ...stubSnapshot, url, content };
    this._snapshots.set(url, snap);
    return snap;
  }
}

class CacheManagerStub {
  constructor() { this._store = new Map(); }
  generateKey(n, p) { return `${n}:${JSON.stringify(p)}`; }
  async get(k) { return this._store.get(k) || null; }
  async set(k, v) { this._store.set(k, v); }
}

// Minimal fetcher
async function fetchContentStub(url) {
  if (url.includes('unreachable')) throw new Error('Network timeout');
  return { text: 'Current page content here.', html: '<p>Current page content here.</p>', fetchedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Minimal TrackChanges-like stub
// ---------------------------------------------------------------------------

class TrackChangesStub {
  constructor({ changeTracker, snapshotManager, cache, fetchFn } = {}) {
    this.changeTracker = changeTracker || new ChangeTrackerStub();
    this.snapshotManager = snapshotManager || new SnapshotManagerStub();
    this.cache = cache || new CacheManagerStub();
    this._fetch = fetchFn || fetchContentStub;
    this.activeMonitors = new Map();
  }

  async execute(params) {
    if (!params || !params.url) throw new Error('url is required');
    try { new URL(params.url); } catch { throw new Error('Invalid URL'); }

    const content = await this._fetch(params.url);
    const currentHash = await this.changeTracker.hashContentAsync(content.text);

    const previousSnapshot = await this.snapshotManager.getLatestSnapshot(params.url);
    let diff = null;

    if (previousSnapshot) {
      diff = await this.changeTracker.diff(previousSnapshot.content?.text || '', content.text);
    }

    const newSnapshot = await this.snapshotManager.saveSnapshot(params.url, content);

    return {
      url: params.url,
      hasChanged: diff ? diff.hasChanged : false,
      isFirstCheck: !previousSnapshot,
      currentHash,
      snapshot: newSnapshot,
      diff
    };
  }

  async startMonitoring(url, interval, options = {}) {
    this.activeMonitors.set(url, { url, interval, options, startedAt: Date.now() });
    return { monitorId: url, status: 'active' };
  }

  async stopMonitoring(url) {
    const existed = this.activeMonitors.has(url);
    this.activeMonitors.delete(url);
    return { stopped: existed };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('trackChanges tool', () => {
  let tool;

  beforeEach(() => {
    tool = new TrackChangesStub();
  });

  test('constructor stores changeTracker, snapshotManager, and cache', () => {
    assert.ok(tool.changeTracker instanceof ChangeTrackerStub);
    assert.ok(tool.snapshotManager instanceof SnapshotManagerStub);
    assert.ok(tool.activeMonitors instanceof Map);
  });

  test('first check — isFirstCheck=true and hasChanged=false', async () => {
    const result = await tool.execute({ url: 'https://example.com' });
    assert.equal(result.url, 'https://example.com');
    assert.equal(result.isFirstCheck, true);
    assert.equal(result.hasChanged, false);
    assert.ok(result.snapshot);
    assert.ok(result.currentHash);
  });

  test('second check — diff returned when snapshot exists', async () => {
    await tool.execute({ url: 'https://example.com' }); // First check — saves snapshot
    const result = await tool.execute({ url: 'https://example.com' }); // Second check
    assert.equal(result.isFirstCheck, false);
    assert.ok(result.diff, 'diff should be present on second check');
    assert.equal(typeof result.diff.hasChanged, 'boolean');
  });

  test('missing url throws', async () => {
    await assert.rejects(() => tool.execute({}), /url is required/);
  });

  test('invalid URL throws', async () => {
    await assert.rejects(() => tool.execute({ url: 'not-url' }), /Invalid URL/);
  });

  test('network fetch error propagates', async () => {
    await assert.rejects(() => tool.execute({ url: 'https://unreachable.example.com' }), /Network timeout/);
  });

  test('startMonitoring adds to activeMonitors', async () => {
    const result = await tool.startMonitoring('https://example.com', 300000);
    assert.ok(tool.activeMonitors.has('https://example.com'));
    assert.equal(result.status, 'active');
  });

  test('stopMonitoring removes from activeMonitors', async () => {
    await tool.startMonitoring('https://example.com', 300000);
    const result = await tool.stopMonitoring('https://example.com');
    assert.equal(result.stopped, true);
    assert.ok(!tool.activeMonitors.has('https://example.com'));
  });
});

// ---------------------------------------------------------------------------
// Real-module tests (Phase 2 fix) — TrackChangesTool + TrackChangesSchema
// against the real implementation, no stubs.
//
// Reproduction test: queryOptions/monitoringOptions were declared
// `.optional()` with no `.default({})`, but getChangeHistory/setupMonitoring
// dereference `queryOptions.limit` / `monitoringOptions.interval`
// unconditionally. Calling the documented default shape
// ({url, operation:'get_history'} / {url, operation:'monitor'}) threw
// "Cannot read properties of undefined (reading 'limit'/'interval')",
// surfaced as a plain (non-isError) result by the server wrapper.
// ---------------------------------------------------------------------------

describe('trackChanges tool — real module (Phase 2 fix)', () => {
  test('schema: queryOptions and monitoringOptions default to {} (populated with inner defaults) when omitted', () => {
    const parsed = TrackChangesSchema.parse({ url: 'https://example.com', operation: 'get_history' });
    assert.deepEqual(parsed.queryOptions, { limit: 50, offset: 0, includeContent: false });

    const parsedMonitor = TrackChangesSchema.parse({ url: 'https://example.com', operation: 'monitor' });
    assert.equal(parsedMonitor.monitoringOptions.interval, 300000);
    assert.equal(parsedMonitor.monitoringOptions.enabled, false);
  });

  describe('execute() with real TrackChangesTool', () => {
    let realTool;
    const trackedUrl = 'https://example.com/track-changes-repro-page';

    beforeEach(() => {
      realTool = new TrackChangesTool({
        snapshotStorageDir: path.join(os.tmpdir(), `trackchanges-test-${Math.random().toString(36).slice(2)}`),
        monitorStorageDir: path.join(os.tmpdir(), `trackchanges-monitors-test-${Math.random().toString(36).slice(2)}`)
      });
    });

    after(async () => {
      // Belt-and-braces: make sure no leftover monitor timers survive this file.
      if (realTool) await realTool.shutdown().catch(() => {});
    });

    test('{url, operation:"get_history"} — the documented default call — does not throw TypeError', async () => {
      const result = await realTool.execute({ url: trackedUrl, operation: 'get_history' });
      assert.equal(result.success, true, `expected success, got error: ${result.error}`);
      assert.equal(result.operation, 'get_history');
      assert.ok(Array.isArray(result.history));
    });

    test('compare works across processes: baseline rehydrates from the persisted snapshot', async () => {
      // Simulate separate CLI invocations: each tool instance is a fresh
      // process (empty in-memory baseline Map) sharing one snapshot dir.
      const sharedSnapshots = path.join(os.tmpdir(), `trackchanges-rehydrate-${Math.random().toString(36).slice(2)}`);
      const sharedMonitors = path.join(os.tmpdir(), `trackchanges-rehydrate-mon-${Math.random().toString(36).slice(2)}`);
      const mkTool = () => new TrackChangesTool({ snapshotStorageDir: sharedSnapshots, monitorStorageDir: sharedMonitors });
      const url = 'https://example.com/rehydrate-page';

      const toolA = mkTool();
      const r1 = await toolA.execute({ url, operation: 'create_baseline', content: 'AAA content' });
      assert.equal(r1.success, true, `baseline failed: ${r1.error}`);
      await new Promise((r) => setTimeout(r, 10)); // distinct snapshot timestamps

      const toolB = mkTool();
      const r2 = await toolB.execute({ url, operation: 'compare', content: 'BBB changed content' });
      assert.equal(r2.success, true, `cross-process compare failed: ${r2.error}`);
      assert.equal(r2.operation, 'compare');
      assert.equal(r2.hasChanges, true);
      await new Promise((r) => setTimeout(r, 10));

      // The change snapshot rolls the baseline forward for the next process.
      const toolC = mkTool();
      const r3 = await toolC.execute({ url, operation: 'compare', content: 'BBB changed content' });
      assert.equal(r3.success, true, `second cross-process compare failed: ${r3.error}`);
      assert.equal(r3.hasChanges, false);

      for (const t of [toolA, toolB, toolC]) await t.shutdown().catch(() => {});
    });

    test('create_baseline reports real sections/contentHash/createdAt (not the always-0 mapping bug)', async () => {
      // Regression: index.js read baseline.analysis?.hashes — a property the
      // ChangeTracker summary return never had — so sections/elements were
      // always 0 and contentHash/createdAt undefined for every page.
      const html = '<html><body><header>H</header><nav>N</nav><main>M</main><footer>F</footer></body></html>';
      const result = await realTool.execute({ url: trackedUrl, operation: 'create_baseline', html });
      assert.equal(result.success, true, `baseline failed: ${result.error}`);
      assert.ok(result.baseline.sections > 0, `expected sections > 0 for semantic HTML, got ${result.baseline.sections}`);
      assert.ok(typeof result.baseline.contentHash === 'string' && result.baseline.contentHash.length > 0);
      assert.ok(typeof result.baseline.createdAt === 'number');
    });

    test('stop_scheduled_monitor with an unknown id reports success:false', async () => {
      const result = await realTool.execute({
        url: trackedUrl,
        operation: 'stop_scheduled_monitor',
        scheduledMonitorOptions: { monitorId: 'no-such-monitor-id' }
      });
      assert.equal(result.success, false);
      assert.equal(result.stopped, false);
      assert.match(result.error, /No scheduled monitor found/);
    });

    test('{url, operation:"monitor"} — the documented default call — does not throw TypeError', async () => {
      const result = await realTool.execute({ url: trackedUrl, operation: 'monitor' });
      assert.equal(result.success, true, `expected success, got error: ${result.error}`);
      assert.equal(result.operation, 'monitor');
      assert.equal(result.monitoring.enabled, true);
      assert.equal(result.monitoring.interval, 300000);

      // Clean up the interval timer setupMonitoring() started.
      realTool.stopMonitoring(trackedUrl);
    });
  });
});

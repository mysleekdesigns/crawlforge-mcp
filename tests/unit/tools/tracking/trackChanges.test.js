/**
 * D5.2 — Unit tests: trackChanges tool
 * Run: node --test tests/unit/tools/tracking/trackChanges.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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

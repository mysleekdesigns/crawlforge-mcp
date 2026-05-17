/**
 * Unit tests for src/core/SnapshotManager.js
 *
 * Run: node --test tests/unit/snapshotManager.test.js
 *
 * Each test creates a SnapshotManager with a unique tmpdir so tests
 * do not share filesystem state.
 *
 * Tests cover:
 *   - storeSnapshot: creates files, returns expected shape
 *   - storeSnapshot: rejects null/undefined content
 *   - retrieveSnapshot: reads back stored content
 *   - retrieveSnapshot: throws for unknown snapshotId
 *   - querySnapshots: returns all and filters by URL
 *   - deleteSnapshots: removes snapshot, updates stats
 *   - generateSnapshotId: produces unique 16-char hex strings
 *   - hashContent: deterministic SHA-256 hex
 *   - calculateContentSimilarity: edge cases
 *   - getStats: correct shape
 *   - getRetentionPolicy: returns defaults
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { SnapshotManager } from '../../src/core/SnapshotManager.js';

const VALID_URL = 'https://example.com/snapshot-test';
const VALID_URL_2 = 'https://other.example.com/page';
const SAMPLE_CONTENT = '<html><body><p>Hello snapshot world</p></body></html>';

function makeTempDir() {
  return path.join(os.tmpdir(), `sm-test-${Math.random().toString(36).slice(2)}`);
}

function makeManager(overrides = {}) {
  const base = makeTempDir();
  return new SnapshotManager({
    storageDir: base,
    metadataDir: path.join(base, 'metadata'),
    tempDir: path.join(base, 'temp'),
    enableCompression: false,   // keep tests deterministic
    enableDeltaStorage: false,  // simplify behaviour
    retentionPolicy: {
      maxSnapshots: 100,
      autoCleanup: false,       // don't run timers during tests
      cleanupInterval: 24 * 60 * 60 * 1000
    },
    ...overrides
  });
}

// Wait for the async initialize() to settle before tests
async function waitForInit(mgr) {
  // SnapshotManager.initialize() is called in constructor.
  // Give it one event-loop tick plus a small buffer.
  await new Promise(r => setTimeout(r, 50));
  return mgr;
}

// ── storeSnapshot ─────────────────────────────────────────────────────────────

test('SnapshotManager: storeSnapshot returns expected result shape', async () => {
  const mgr = await waitForInit(makeManager());
  const result = await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT);

  assert.ok(typeof result.snapshotId === 'string', 'snapshotId should be a string');
  assert.equal(result.url, VALID_URL);
  assert.ok(typeof result.timestamp === 'number');
  assert.ok(typeof result.contentHash === 'string');
  assert.ok(typeof result.size === 'number');

  mgr.stopCleanupTimer();
});

test('SnapshotManager: storeSnapshot persists file to disk', async () => {
  const mgr = await waitForInit(makeManager());
  const result = await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT);

  const filePath = path.join(mgr.options.storageDir, `${result.snapshotId}.snap`);
  const stat = await fs.stat(filePath);
  assert.ok(stat.isFile(), 'snapshot file should exist on disk');

  mgr.stopCleanupTimer();
});

test('SnapshotManager: storeSnapshot updates stats.totalSnapshots', async () => {
  const mgr = await waitForInit(makeManager());
  const before = mgr.stats.totalSnapshots;
  await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT);
  assert.ok(mgr.stats.totalSnapshots > before);
  mgr.stopCleanupTimer();
});

test('SnapshotManager: storeSnapshot rejects null content', async () => {
  const mgr = await waitForInit(makeManager());
  await assert.rejects(
    () => mgr.storeSnapshot(VALID_URL, null),
    /Content cannot be null/i
  );
  mgr.stopCleanupTimer();
});

test('SnapshotManager: storeSnapshot coerces non-string content to string', async () => {
  const mgr = await waitForInit(makeManager());
  // Should not throw — converts 42 to "42"
  const result = await mgr.storeSnapshot(VALID_URL, 42);
  assert.ok(typeof result.snapshotId === 'string');
  mgr.stopCleanupTimer();
});

// ── retrieveSnapshot ──────────────────────────────────────────────────────────

test('SnapshotManager: retrieveSnapshot reads back original content', async () => {
  const mgr = await waitForInit(makeManager());
  const { snapshotId } = await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT);
  const snap = await mgr.retrieveSnapshot(snapshotId, { includeContent: true });

  assert.ok(snap, 'snapshot should be retrieved');
  // Content is read back from disk as a Buffer or string
  const content = Buffer.isBuffer(snap.content) ? snap.content.toString() : snap.content;
  assert.equal(content, SAMPLE_CONTENT);

  mgr.stopCleanupTimer();
});

test('SnapshotManager: retrieveSnapshot throws for unknown snapshotId', async () => {
  const mgr = await waitForInit(makeManager());
  await assert.rejects(
    () => mgr.retrieveSnapshot('no-such-snapshot-id'),
    /not found/i
  );
  mgr.stopCleanupTimer();
});

test('SnapshotManager: retrieveSnapshot uses cache on second call', async () => {
  const mgr = await waitForInit(makeManager());
  const { snapshotId } = await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT);

  const before = mgr.stats.cacheHits;
  await mgr.retrieveSnapshot(snapshotId);
  await mgr.retrieveSnapshot(snapshotId); // second call should hit cache
  assert.ok(mgr.stats.cacheHits > before, 'second retrieval should be a cache hit');

  mgr.stopCleanupTimer();
});

// ── querySnapshots ────────────────────────────────────────────────────────────

test('SnapshotManager: querySnapshots returns all stored snapshots', async () => {
  const mgr = await waitForInit(makeManager());
  await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT);
  await mgr.storeSnapshot(VALID_URL_2, SAMPLE_CONTENT + ' extra');

  const result = await mgr.querySnapshots({});
  assert.ok(result.snapshots.length >= 2);
  mgr.stopCleanupTimer();
});

test('SnapshotManager: querySnapshots filters by URL', async () => {
  const mgr = await waitForInit(makeManager());
  await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT);
  await mgr.storeSnapshot(VALID_URL_2, SAMPLE_CONTENT);

  const result = await mgr.querySnapshots({ url: VALID_URL });
  assert.ok(result.snapshots.every(s => s.url === VALID_URL));
  mgr.stopCleanupTimer();
});

test('SnapshotManager: querySnapshots respects limit', async () => {
  const mgr = await waitForInit(makeManager());
  await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT + '1');
  await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT + '2');
  await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT + '3');

  const result = await mgr.querySnapshots({ limit: 2 });
  assert.ok(result.snapshots.length <= 2);
  mgr.stopCleanupTimer();
});

// ── deleteSnapshots ───────────────────────────────────────────────────────────

test('SnapshotManager: deleteSnapshots removes snapshot from disk and cache', async () => {
  const mgr = await waitForInit(makeManager());
  const { snapshotId } = await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT);
  const results = await mgr.deleteSnapshots([snapshotId]);

  assert.ok(results.deleted.includes(snapshotId));
  assert.equal(results.failed.length, 0);

  await assert.rejects(
    () => mgr.retrieveSnapshot(snapshotId),
    /not found/i
  );
  mgr.stopCleanupTimer();
});

test('SnapshotManager: deleteSnapshots reports failure for unknown snapshotId', async () => {
  const mgr = await waitForInit(makeManager());
  const results = await mgr.deleteSnapshots(['ghost-id']);
  assert.ok(results.failed.length >= 1);
  assert.equal(results.deleted.length, 0);
  mgr.stopCleanupTimer();
});

// ── generateSnapshotId ────────────────────────────────────────────────────────

test('SnapshotManager: generateSnapshotId produces unique 16-char hex strings', () => {
  const mgr = makeManager();
  const id1 = mgr.generateSnapshotId(VALID_URL, Date.now());
  const id2 = mgr.generateSnapshotId(VALID_URL, Date.now());
  assert.match(id1, /^[0-9a-f]{16}$/);
  assert.notEqual(id1, id2, 'IDs should be unique (random component)');
  mgr.stopCleanupTimer();
});

// ── hashContent ───────────────────────────────────────────────────────────────

test('SnapshotManager: hashContent is deterministic SHA-256 hex', () => {
  const mgr = makeManager();
  const h1 = mgr.hashContent('test content');
  const h2 = mgr.hashContent('test content');
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  mgr.stopCleanupTimer();
});

// ── calculateContentSimilarity ────────────────────────────────────────────────

test('SnapshotManager: calculateContentSimilarity returns 1.0 for identical content', () => {
  const mgr = makeManager();
  assert.equal(mgr.calculateContentSimilarity('abc', 'abc'), 1.0);
  mgr.stopCleanupTimer();
});

test('SnapshotManager: calculateContentSimilarity returns 0.0 when one content is empty', () => {
  const mgr = makeManager();
  assert.equal(mgr.calculateContentSimilarity('', 'some content'), 0.0);
  assert.equal(mgr.calculateContentSimilarity('some content', ''), 0.0);
  mgr.stopCleanupTimer();
});

test('SnapshotManager: calculateContentSimilarity returns 1.0 for two empty strings', () => {
  const mgr = makeManager();
  assert.equal(mgr.calculateContentSimilarity('', ''), 1.0);
  mgr.stopCleanupTimer();
});

// ── getStats ──────────────────────────────────────────────────────────────────

test('SnapshotManager: getStats returns expected shape', async () => {
  const mgr = await waitForInit(makeManager());
  const stats = mgr.getStats();
  assert.ok(typeof stats.totalSnapshots === 'number');
  assert.ok(typeof stats.totalStorageSize === 'number');
  assert.ok(typeof stats.cacheHits === 'number');
  assert.ok(typeof stats.cacheMisses === 'number');
  assert.ok(typeof stats.storageEfficiency === 'object');
  mgr.stopCleanupTimer();
});

// ── getRetentionPolicy ────────────────────────────────────────────────────────

test('SnapshotManager: getRetentionPolicy returns current policy', () => {
  const mgr = makeManager();
  const policy = mgr.getRetentionPolicy();
  assert.ok(typeof policy.maxSnapshots === 'number');
  assert.ok(typeof policy.maxAge === 'number');
  assert.ok(typeof policy.autoCleanup === 'boolean');
  mgr.stopCleanupTimer();
});

// ── storeSnapshot emits event ─────────────────────────────────────────────────

test('SnapshotManager: storeSnapshot emits snapshotStored event', async () => {
  const mgr = await waitForInit(makeManager());
  let emitted = null;
  mgr.on('snapshotStored', (info) => { emitted = info; });

  await mgr.storeSnapshot(VALID_URL, SAMPLE_CONTENT);
  assert.ok(emitted !== null, 'snapshotStored event should be emitted');
  assert.ok(typeof emitted.snapshotId === 'string');

  mgr.stopCleanupTimer();
});

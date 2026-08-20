/**
 * Unit tests for src/core/ChangeTracker.js
 *
 * Run: node --test tests/unit/changeTracker.test.js
 *
 * Tests cover:
 *   - hashContent: deterministic, differs on different input
 *   - createSnapshot: returns snapshot shape, stores in contentHistory
 *   - getSnapshotHistory: returns ordered list
 *   - detectChangesFromSnapshot: no baseline -> hasChanges:false
 *   - detectChangesFromSnapshot: identical content -> hasChanges:false
 *   - detectChangesFromSnapshot: changed content -> hasChanges:true with significance
 *   - detectChangesFromSnapshot: invalid URL throws
 *   - calculateSimilarity: same hash -> 1; different hashes -> < 1
 *   - calculateSignificanceScore: object format with textChanges/structuralChanges
 *   - createBaseline: returns success shape and stores in snapshots
 *   - getChangeHistory: returns for tracked URL
 *   - startMonitoring: creates a monitor entry
 *   - stopMonitoring: removes monitor
 *   - differ.mergeHistoryData: merges without duplication
 *   - differ.matchesSignificanceFilter: correct ordering
 *   - differ.meetsNotificationThreshold: correct logic
 *   - differ.calculateAverageInterval
 *   - differ.calculateSignificanceDistribution
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeTracker } from '../../src/core/ChangeTracker.js';
import {
  mergeHistoryData,
  matchesSignificanceFilter,
  meetsNotificationThreshold,
  calculateAverageInterval,
  calculateSignificanceDistribution
} from '../../src/tools/tracking/trackChanges/differ.js';

const VALID_URL = 'https://example.com/page';
const HTML1 = '<html><body><h1>Hello World</h1><p>Some content here.</p></body></html>';
const HTML2 = '<html><body><h1>Hello World</h1><p>Different content entirely.</p></body></html>';
const HTML_IDENTICAL = HTML1;

// ── hashContent ─────────────────────────────────────────────────────────────

test('ChangeTracker: hashContent is deterministic for same input', () => {
  const ct = new ChangeTracker();
  const h1 = ct.hashContent('hello');
  const h2 = ct.hashContent('hello');
  assert.equal(h1, h2);
});

test('ChangeTracker: hashContent differs for different inputs', () => {
  const ct = new ChangeTracker();
  const h1 = ct.hashContent('hello');
  const h2 = ct.hashContent('world');
  assert.notEqual(h1, h2);
});

test('ChangeTracker: hashContent handles empty string', () => {
  const ct = new ChangeTracker();
  const h = ct.hashContent('');
  assert.ok(typeof h === 'string' && h.length > 0);
});

// ── generateContentHash ─────────────────────────────────────────────────────

test('ChangeTracker: generateContentHash is deterministic', () => {
  const ct = new ChangeTracker();
  const h1 = ct.generateContentHash('test');
  const h2 = ct.generateContentHash('test');
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

// ── createSnapshot ──────────────────────────────────────────────────────────

test('ChangeTracker: createSnapshot returns snapshot with expected shape', async () => {
  const ct = new ChangeTracker();
  const snap = await ct.createSnapshot(VALID_URL, HTML1);
  assert.equal(snap.url, VALID_URL);
  assert.equal(snap.content, HTML1);
  assert.ok(typeof snap.contentHash === 'string');
  assert.ok(typeof snap.timestamp === 'number');
  assert.equal(snap.version, 1);
});

test('ChangeTracker: createSnapshot stores in contentHistory', async () => {
  const ct = new ChangeTracker();
  await ct.createSnapshot(VALID_URL, HTML1);
  const history = ct.getSnapshotHistory(VALID_URL);
  assert.ok(Array.isArray(history));
  assert.equal(history.length, 1);
  assert.equal(history[0].url, VALID_URL);
});

test('ChangeTracker: multiple snapshots accumulate in contentHistory', async () => {
  const ct = new ChangeTracker();
  await ct.createSnapshot(VALID_URL, HTML1);
  await ct.createSnapshot(VALID_URL, HTML2);
  const history = ct.getSnapshotHistory(VALID_URL);
  assert.equal(history.length, 2);
});

// ── getSnapshotHistory ───────────────────────────────────────────────────────

test('ChangeTracker: getSnapshotHistory returns empty array for unknown URL', () => {
  const ct = new ChangeTracker();
  const history = ct.getSnapshotHistory('https://unknown.example.com/');
  assert.deepEqual(history, []);
});

// ── detectChangesFromSnapshot ────────────────────────────────────────────────

test('ChangeTracker: detectChangesFromSnapshot returns hasChanges:false when no baseline', async () => {
  const ct = new ChangeTracker();
  const result = await ct.detectChangesFromSnapshot(VALID_URL, HTML1);
  assert.equal(result.hasChanges, false);
  assert.equal(result.significance, 'none');
});

test('ChangeTracker: detectChangesFromSnapshot returns hasChanges:false for identical content', async () => {
  const ct = new ChangeTracker();
  await ct.createSnapshot(VALID_URL, HTML1);
  const result = await ct.detectChangesFromSnapshot(VALID_URL, HTML_IDENTICAL);
  assert.equal(result.hasChanges, false);
});

test('ChangeTracker: detectChangesFromSnapshot returns hasChanges:true for changed content', async () => {
  const ct = new ChangeTracker();
  await ct.createSnapshot(VALID_URL, HTML1);
  const result = await ct.detectChangesFromSnapshot(VALID_URL, HTML2);
  assert.equal(result.hasChanges, true);
  assert.ok(typeof result.score === 'number');
  assert.ok(['minor', 'moderate', 'major'].includes(result.significance));
});

test('ChangeTracker: detectChangesFromSnapshot throws for invalid URL format', async () => {
  const ct = new ChangeTracker();
  await assert.rejects(
    () => ct.detectChangesFromSnapshot('not-a-url', HTML1),
    /Invalid URL/i
  );
});

// ── calculateSimilarity ──────────────────────────────────────────────────────

test('ChangeTracker: calculateSimilarity returns 1.0 for identical hashes', () => {
  const ct = new ChangeTracker();
  const h = ct.hashContent('same content');
  assert.equal(ct.calculateSimilarity(h, h), 1);
});

test('ChangeTracker: calculateSimilarity returns < 1 for different hashes', () => {
  const ct = new ChangeTracker();
  const h1 = ct.hashContent('content a');
  const h2 = ct.hashContent('content b that is quite different');
  const sim = ct.calculateSimilarity(h1, h2);
  assert.ok(sim >= 0 && sim < 1);
});

// ── calculateSignificanceScore ───────────────────────────────────────────────

test('ChangeTracker: calculateSignificanceScore returns 0 for null input', () => {
  const ct = new ChangeTracker();
  assert.equal(ct.calculateSignificanceScore(null), 0);
});

test('ChangeTracker: calculateSignificanceScore handles object format', () => {
  const ct = new ChangeTracker();
  const score = ct.calculateSignificanceScore({
    textChanges: { additions: 100, deletions: 50, modifications: 20 },
    structuralChanges: { additions: 5, deletions: 3 },
    totalLength: 500
  });
  assert.ok(typeof score === 'number');
  assert.ok(score >= 0 && score <= 1);
});

test('ChangeTracker: calculateSignificanceScore handles array format (legacy)', () => {
  const ct = new ChangeTracker();
  const score = ct.calculateSignificanceScore([
    { type: 'added', count: 10 },
    { type: 'removed', count: 5 }
  ]);
  assert.ok(typeof score === 'number');
  assert.ok(score >= 0 && score <= 1);
});

// ── compareWithBaseline: content-similarity fix (production path) ────────────
//
// Reproduction test for the Phase 2 fix: detectChanges() used to compute
// changes.similarity as a Hamming distance between two sha256 hex digests
// (calculateSimilarity(hash1, hash2)), which is ~0.0 for any content change
// no matter how trivial, since a single-character edit changes ~every hex
// digit of the hash. That pushed even a one-word typo fix to a `moderate`+
// classification via calculateChangeSignificance's `(1 - similarity) * 0.3`
// term. The fix computes changes.similarity from the actual content (a
// token-Jaccard similarity), keeping hash equality only as the fast
// identical/changed short-circuit. This exercises the real production path
// (createBaseline -> compareWithBaseline -> detectChanges), not the
// hash-based calculateSimilarity(hash1,hash2) helper tested below (which is
// unchanged and still hash-only by design).

const NATO_BASELINE = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu';
const NATO_ONE_WORD_EDIT = NATO_BASELINE.replace('hotel', 'hotell'); // single-character edit to one of 26 words

test('ChangeTracker: compareWithBaseline scores a one-word edit as highly similar (> 0.9), not ~0', async () => {
  const ct = new ChangeTracker();
  await ct.createBaseline(VALID_URL, NATO_BASELINE);
  const result = await ct.compareWithBaseline(VALID_URL, NATO_ONE_WORD_EDIT);

  assert.ok(
    result.metrics.contentSimilarity > 0.9,
    `expected contentSimilarity > 0.9 for a 1-word edit out of 26, got ${result.metrics.contentSimilarity}`
  );
});

test('ChangeTracker: compareWithBaseline does NOT classify a trivial one-word edit as moderate+ significance', async () => {
  const ct = new ChangeTracker();
  await ct.createBaseline(VALID_URL, NATO_BASELINE);
  const result = await ct.compareWithBaseline(VALID_URL, NATO_ONE_WORD_EDIT);

  assert.ok(
    ['none', 'minor'].includes(result.significance),
    `expected 'none' or 'minor' significance for a trivial edit, got '${result.significance}'`
  );
});

test('ChangeTracker: compareWithBaseline scores completely different content as low similarity', async () => {
  const ct = new ChangeTracker();
  await ct.createBaseline(VALID_URL, NATO_BASELINE);
  const result = await ct.compareWithBaseline(VALID_URL, 'Something entirely unrelated with zero shared vocabulary whatsoever here today.');

  assert.ok(result.metrics.contentSimilarity < 0.3, `expected low similarity for unrelated content, got ${result.metrics.contentSimilarity}`);
});

// ── compareWithBaseline: unchanged compare must be labeled neutrally ─────────

test('ChangeTracker: compareWithBaseline on identical content reports changeType "none" and a neutral description', async () => {
  const ct = new ChangeTracker();
  await ct.createBaseline(VALID_URL, HTML1);
  const result = await ct.compareWithBaseline(VALID_URL, HTML_IDENTICAL);

  assert.equal(result.hasChanges, false);
  assert.equal(result.changeType, 'none');
  assert.equal(result.summary.changeDescription, 'No significant changes detected');
  assert.equal(result.summary.totalChanges, 0);
});

test('ChangeTracker: compareWithBaseline on genuinely changed content still reports a non-"none" changeType', async () => {
  const ct = new ChangeTracker();
  await ct.createBaseline(VALID_URL, NATO_BASELINE);
  const result = await ct.compareWithBaseline(VALID_URL, 'Something entirely unrelated with zero shared vocabulary whatsoever here today.');

  assert.equal(result.hasChanges, true);
  assert.notEqual(result.changeType, 'none');
});

// ── structuralSimilarity: 0-1 metric, never out of range ─────────────────────

test('ChangeTracker: calculateTagSimilarity stays within [0,1] despite duplicate tags', () => {
  const ct = new ChangeTracker();
  // Duplicate-laden lists made the old bag-vs-set Jaccard exceed 1 (3/2 = 1.5 here).
  const dupSim = ct.calculateTagSimilarity(
    [{ tag: 'div' }, { tag: 'div' }, { tag: 'p' }],
    [{ tag: 'div' }, { tag: 'p' }]
  );
  assert.equal(dupSim, 1);

  const partialSim = ct.calculateTagSimilarity(
    [{ tag: 'div' }, { tag: 'div' }, { tag: 'span' }],
    [{ tag: 'div' }, { tag: 'p' }]
  );
  assert.ok(partialSim >= 0 && partialSim <= 1, `expected [0,1], got ${partialSim}`);
  assert.ok(Math.abs(partialSim - 1 / 3) < 1e-9);
});

test('ChangeTracker: compareWithBaseline reports structuralSimilarity within [0,1] for duplicate-heavy HTML', async () => {
  const ct = new ChangeTracker();
  const before = '<html><body><div>a</div><div>b</div><div>c</div><p>x</p><p>y</p></body></html>';
  const after = '<html><body><div>a</div><p>x</p></body></html>';
  await ct.createBaseline(VALID_URL, before, { trackStructure: true });
  const result = await ct.compareWithBaseline(VALID_URL, after);

  const s = result.metrics.structuralSimilarity;
  assert.ok(s >= 0 && s <= 1, `structuralSimilarity out of range: ${s}`);
});

// ── createBaseline ───────────────────────────────────────────────────────────

test('ChangeTracker: createBaseline returns success result for valid URL+content', async () => {
  const ct = new ChangeTracker();
  const result = await ct.createBaseline(VALID_URL, HTML1);
  assert.equal(result.success, true);
  assert.equal(result.url, VALID_URL);
  assert.equal(result.version, 1);
  assert.ok(typeof result.contentHash === 'string');
});

test('ChangeTracker: createBaseline throws or rejects for invalid URL', async () => {
  const ct = new ChangeTracker();
  // Suppress EventEmitter 'error' events so they don't crash the test process
  ct.on('error', () => {});
  await assert.rejects(
    () => ct.createBaseline('bad-url', HTML1),
    (err) => {
      // The rejection message may come from Zod, EventEmitter, or the
      // ChangeTracker wrapper — just assert it rejects at all.
      return err instanceof Error;
    }
  );
});

// ── startMonitoring / stopMonitoring ─────────────────────────────────────────

test('ChangeTracker: startMonitoring creates a monitor entry', async () => {
  const ct = new ChangeTracker();
  const monitor = await ct.startMonitoring(VALID_URL, { interval: 60000 });
  assert.ok(monitor.id.startsWith('monitor_'));
  assert.equal(monitor.url, VALID_URL);
  assert.equal(ct.activeMonitors.has(VALID_URL), true);
});

test('ChangeTracker: stopMonitoring removes the monitor and returns true', async () => {
  const ct = new ChangeTracker();
  await ct.startMonitoring(VALID_URL);
  const stopped = ct.stopMonitoring(VALID_URL);
  assert.equal(stopped, true);
  assert.equal(ct.activeMonitors.has(VALID_URL), false);
});

test('ChangeTracker: stopMonitoring returns false for untracked URL', () => {
  const ct = new ChangeTracker();
  assert.equal(ct.stopMonitoring('https://not-tracked.example.com/'), false);
});

// ── getStats / getStatistics ──────────────────────────────────────────────────

test('ChangeTracker: getStats returns expected numeric shape', async () => {
  const ct = new ChangeTracker();
  const stats = ct.getStats();
  assert.ok(typeof stats.pagesTracked === 'number');
  assert.ok(typeof stats.changesDetected === 'number');
  assert.ok(typeof stats.monitoredUrls === 'number');
});

test('ChangeTracker: getStatistics returns totalMonitors count', async () => {
  const ct = new ChangeTracker();
  await ct.startMonitoring(VALID_URL);
  const stats = ct.getStatistics();
  assert.ok(typeof stats.totalMonitors === 'number');
  assert.ok(stats.totalMonitors >= 1);
});

// ── cleanup ───────────────────────────────────────────────────────────────────

test('ChangeTracker: cleanup clears internal maps', async () => {
  const ct = new ChangeTracker();
  await ct.createSnapshot(VALID_URL, HTML1);
  await ct.startMonitoring(VALID_URL);
  ct.cleanup();
  assert.equal(ct.contentHistory.size, 0);
  assert.equal(ct.activeMonitors.size, 0);
});

// ── differ utilities ──────────────────────────────────────────────────────────

test('differ.mergeHistoryData: deduplicates entries within 60s window', () => {
  const now = Date.now();
  const changeHistory = [{ timestamp: now, significance: 'minor', data: 'change' }];
  const snapshotHistory = [{ timestamp: now + 10, snapshotId: 'snap-1', significance: 'minor' }];

  const merged = mergeHistoryData(changeHistory, snapshotHistory);
  assert.equal(merged.length, 1, 'entries within 60s should be merged');
  assert.equal(merged[0].hasSnapshot, true);
  assert.equal(merged[0].snapshotId, 'snap-1');
});

test('differ.mergeHistoryData: keeps separate entries farther than 60s apart', () => {
  const now = Date.now();
  const changeHistory = [{ timestamp: now - 120_000, significance: 'minor' }];
  const snapshotHistory = [{ timestamp: now, snapshotId: 'snap-2', significance: 'major' }];

  const merged = mergeHistoryData(changeHistory, snapshotHistory);
  assert.equal(merged.length, 2);
});

test('differ.matchesSignificanceFilter: none matches any filter level', () => {
  assert.equal(matchesSignificanceFilter({ significance: 'none' }, 'none'), true);
  assert.equal(matchesSignificanceFilter({ significance: 'none' }, 'minor'), false);
});

test('differ.matchesSignificanceFilter: major matches major and below', () => {
  assert.equal(matchesSignificanceFilter({ significance: 'major' }, 'minor'), true);
  assert.equal(matchesSignificanceFilter({ significance: 'major' }, 'major'), true);
  assert.equal(matchesSignificanceFilter({ significance: 'major' }, 'critical'), false);
});

test('differ.meetsNotificationThreshold: moderate meets moderate and below', () => {
  assert.equal(meetsNotificationThreshold('moderate', 'minor'), true);
  assert.equal(meetsNotificationThreshold('moderate', 'moderate'), true);
  assert.equal(meetsNotificationThreshold('moderate', 'major'), false);
});

test('differ.calculateAverageInterval: returns null for < 2 entries', () => {
  assert.equal(calculateAverageInterval([]), null);
  assert.equal(calculateAverageInterval([{ timestamp: 1000 }]), null);
});

test('differ.calculateAverageInterval: correct average for 3 entries', () => {
  const history = [
    { timestamp: 3000 },
    { timestamp: 2000 },
    { timestamp: 1000 }
  ];
  const avg = calculateAverageInterval(history);
  assert.equal(avg, 1000);
});

test('differ.calculateSignificanceDistribution: counts correctly', () => {
  const history = [
    { significance: 'minor' },
    { significance: 'major' },
    { significance: 'minor' },
    { significance: 'critical' },
    {}  // no significance field
  ];
  const dist = calculateSignificanceDistribution(history);
  assert.equal(dist.minor, 2);
  assert.equal(dist.major, 1);
  assert.equal(dist.critical, 1);
  assert.equal(dist.none, 1);
  assert.equal(dist.moderate, 0);
});

/**
 * MonitorScheduler (v4.8) — recurring change-monitoring engine.
 * Run: node --test tests/unit/monitorScheduler.test.js
 *
 * Fully stubbed: no real network, no real browser/LLM, controlled clock.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MonitorStore } from '../../src/core/MonitorStore.js';
import { MonitorScheduler } from '../../src/core/MonitorScheduler.js';

const origFetch = global.fetch;
let CONTENT = 'AAA';
function mockFetch() {
  global.fetch = async () => ({
    ok: true, status: 200, url: 'https://m.test/', headers: { get: () => 'text/html' },
    text: async () => CONTENT, body: null,
  });
}
afterEach(() => { global.fetch = origFetch; });

function fakeTool() {
  const snapshots = new Map();
  return {
    changeTracker: {
      snapshots,
      async createBaseline(url, content) { snapshots.set(url, [{ content }]); return { version: 1 }; },
      async compareWithBaseline(url, content) {
        const base = snapshots.get(url)?.[0]?.content;
        const hasChanges = base !== content;
        return { hasChanges, significance: hasChanges ? 'major' : 'none', summary: { changeDescription: 'd' } };
      },
    },
    snapshotManager: {
      async querySnapshots() { return { snapshots: [] }; },
      async storeSnapshot() { return { id: 's1' }; },
    },
  };
}

function makeStore() {
  return new MonitorStore({ storageDir: join(mkdtempSync(join(tmpdir(), 'cf-sch-')), 'monitors') });
}

describe('MonitorScheduler._fire', () => {
  test('first fire creates a baseline; subsequent change is detected', async () => {
    mockFetch();
    CONTENT = 'AAA';
    const tool = fakeTool();
    const scheduler = new MonitorScheduler({ tool, store: makeStore() });
    const mon = await scheduler.createMonitor({ url: 'https://m.test/', interval: 60000, notificationThreshold: 'minor' });

    const def = scheduler.store.get(mon.id);
    const f1 = await scheduler._fire(def);
    assert.equal(f1.baselineCreated, true);

    CONTENT = 'BBB-different';
    const f2 = await scheduler._fire(def);
    assert.equal(f2.hasChanges, true);
    assert.equal(f2.significance, 'major');
    assert.ok(def.stats.checks >= 2);
    scheduler.stopAll();
  });

  test('change below threshold is not flagged as a notification', async () => {
    mockFetch();
    CONTENT = 'AAA';
    const tool = fakeTool();
    // compareWithBaseline returns "none" when unchanged
    const scheduler = new MonitorScheduler({ tool, store: makeStore() });
    const mon = await scheduler.createMonitor({ url: 'https://m.test/', interval: 60000, notificationThreshold: 'critical' });
    const def = scheduler.store.get(mon.id);
    await scheduler._fire(def);            // baseline
    const f2 = await scheduler._fire(def); // same content -> no change
    assert.equal(f2.notified, false);
    scheduler.stopAll();
  });
});

describe('MonitorScheduler._judgeGoal (graceful degradation)', () => {
  const tool = fakeTool();
  test('no goal -> threshold mode, meaningful', async () => {
    const s = new MonitorScheduler({ tool, store: makeStore() });
    const r = await s._judgeGoal({ goal: null }, { summary: {} });
    assert.deepEqual(r, { meaningful: true, mode: 'threshold' });
  });
  test('goal but no LLM -> degraded-no-llm, still meaningful (fail open)', async () => {
    const s = new MonitorScheduler({ tool, store: makeStore(), samplingClient: null });
    const r = await s._judgeGoal({ goal: 'price changes' }, { summary: {} });
    assert.equal(r.mode, 'degraded-no-llm');
    assert.equal(r.meaningful, true);
  });
  test('LLM says not meaningful -> suppressed', async () => {
    const samplingClient = { complete: async () => ({ text: '{"meaningful": false, "reason": "nav only"}' }) };
    const s = new MonitorScheduler({ tool, store: makeStore(), samplingClient });
    const r = await s._judgeGoal({ goal: 'price changes' }, { summary: { x: 1 } });
    assert.equal(r.meaningful, false);
    assert.equal(r.mode, 'llm');
  });
  test('LLM throws -> degraded-llm-error, fail open', async () => {
    const samplingClient = { complete: async () => { throw new Error('no provider'); } };
    const s = new MonitorScheduler({ tool, store: makeStore(), samplingClient });
    const r = await s._judgeGoal({ goal: 'price changes' }, { summary: {} });
    assert.equal(r.mode, 'degraded-llm-error');
    assert.equal(r.meaningful, true);
  });
});

describe('MonitorScheduler lifecycle', () => {
  test('runDueOnce fires due monitors; stopAll leaves no timers', async () => {
    mockFetch();
    CONTENT = 'AAA';
    const tool = fakeTool();
    const scheduler = new MonitorScheduler({ tool, store: makeStore() });
    const mon = await scheduler.createMonitor({ url: 'https://m.test/', interval: 60000 });
    // force due
    const def = scheduler.store.get(mon.id);
    def.nextDueAt = 0;
    await scheduler.store.save(def);

    const res = await scheduler.runDueOnce();
    assert.ok(res.fired >= 1);

    scheduler.stopAll();
    assert.equal(scheduler.timers.size, 0);
  });

  test('stopMonitor removes from store and timers', async () => {
    const tool = fakeTool();
    const scheduler = new MonitorScheduler({ tool, store: makeStore() });
    const mon = await scheduler.createMonitor({ url: 'https://m.test/', interval: 60000 });
    const r = await scheduler.stopMonitor(mon.id);
    assert.equal(r.stopped, true);
    assert.equal(scheduler.list().length, 0);
    scheduler.stopAll();
  });
});

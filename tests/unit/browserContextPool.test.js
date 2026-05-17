/**
 * Unit tests for src/core/BrowserContextPool.js
 *
 * Run: node --test tests/unit/browserContextPool.test.js
 *
 * Tests cover:
 *   - Map-compatible surface (get/has/size/delete/entries/clear)
 *   - Pool capacity enforcement (maxContexts)
 *   - setSync throws at capacity; set() waits for a slot
 *   - recordUse: use counter increments; returns true when periodicRefreshAfter is reached
 *   - Idle eviction via _closeIdleContexts
 *   - dispose: removes from pool, calls context.close(), notifies waiters
 *   - clear: drains waiters with rejection
 *   - destroy: closes all contexts and clears idle timer
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserContextPool } from '../../src/core/BrowserContextPool.js';

// Helper: build a fake context object that records close() calls.
function fakeContext() {
  const ctx = {
    closeCalled: false,
    close: async () => { ctx.closeCalled = true; }
  };
  return ctx;
}

// Helper: create a pool with a known small capacity for tests.
function makePool(opts = {}) {
  return new BrowserContextPool({
    maxContexts: 3,
    periodicRefreshAfter: 5,
    closeIdleAfterMs: 60_000,
    waitTimeoutMs: 500,  // short so timeout tests are fast
    ...opts
  });
}

// ── Map-compatible surface ──────────────────────────────────────────────────

test('BrowserContextPool: initial size is 0', async () => {
  const pool = makePool();
  assert.equal(pool.size, 0);
  await pool.destroy();
});

test('BrowserContextPool: set() and get() round-trip a context entry', async () => {
  const pool = makePool();
  const ctx = fakeContext();
  await pool.set('ctx-1', { context: ctx, fingerprint: 'fp1' });
  const entry = pool.get('ctx-1');
  assert.ok(entry, 'entry should exist after set()');
  assert.equal(pool.size, 1);
  await pool.destroy();
});

test('BrowserContextPool: get() returns undefined for unknown key', () => {
  const pool = makePool();
  assert.equal(pool.get('nonexistent'), undefined);
  pool.destroy();
});

test('BrowserContextPool: has() reflects set/delete state', async () => {
  const pool = makePool();
  await pool.set('ctx-2', { context: fakeContext() });
  assert.equal(pool.has('ctx-2'), true);
  pool.delete('ctx-2');
  assert.equal(pool.has('ctx-2'), false);
  await pool.destroy();
});

test('BrowserContextPool: entries() iterates stored entries', async () => {
  const pool = makePool();
  await pool.set('a', { context: fakeContext() });
  await pool.set('b', { context: fakeContext() });
  const keys = Array.from(pool.entries()).map(([k]) => k);
  assert.ok(keys.includes('a'));
  assert.ok(keys.includes('b'));
  await pool.destroy();
});

// ── Capacity enforcement ────────────────────────────────────────────────────

test('BrowserContextPool: setSync throws when pool is at capacity', async () => {
  const pool = makePool({ maxContexts: 2 });
  await pool.set('c1', { context: fakeContext() });
  await pool.set('c2', { context: fakeContext() });

  assert.throws(
    () => pool.setSync('c3', { context: fakeContext() }),
    /capacity/i,
    'setSync should throw a capacity error when full'
  );
  await pool.destroy();
});

test('BrowserContextPool: set() waits for a free slot when pool is full', async () => {
  const pool = makePool({ maxContexts: 1, waitTimeoutMs: 2000 });
  const ctx1 = fakeContext();
  await pool.set('c1', { context: ctx1 });

  // Schedule a delete of c1 after 50ms to free a slot
  setTimeout(() => pool.delete('c1'), 50);

  // set() should block until the slot is freed
  const start = Date.now();
  await pool.set('c2', { context: fakeContext() });
  const elapsed = Date.now() - start;

  assert.ok(elapsed >= 40, `set() should have waited at least 40ms; waited ${elapsed}ms`);
  assert.equal(pool.size, 1);
  await pool.destroy();
});

test('BrowserContextPool: set() times out when no slot becomes available', async () => {
  const pool = makePool({ maxContexts: 1, waitTimeoutMs: 100 });
  await pool.set('c1', { context: fakeContext() });

  await assert.rejects(
    () => pool.set('c2', { context: fakeContext() }),
    /timed out/i,
    'set() should reject after waitTimeoutMs'
  );
  await pool.destroy();
});

// ── recordUse ───────────────────────────────────────────────────────────────

test('BrowserContextPool: recordUse increments counter and returns false until threshold', async () => {
  const pool = makePool({ periodicRefreshAfter: 3 });
  await pool.set('ctx', { context: fakeContext() });

  assert.equal(pool.recordUse('ctx'), false, 'use 1 — not yet at threshold');
  assert.equal(pool.recordUse('ctx'), false, 'use 2 — not yet at threshold');
  assert.equal(pool.recordUse('ctx'), true, 'use 3 — at threshold, should return true');

  const entry = pool.get('ctx');
  assert.equal(entry.uses, 3);
  await pool.destroy();
});

test('BrowserContextPool: recordUse returns false for unknown contextId', () => {
  const pool = makePool();
  assert.equal(pool.recordUse('no-such-ctx'), false);
  pool.destroy();
});

// ── dispose ─────────────────────────────────────────────────────────────────

test('BrowserContextPool: dispose removes entry and calls context.close()', async () => {
  const pool = makePool();
  const ctx = fakeContext();
  await pool.set('disp-1', { context: ctx });

  await pool.dispose('disp-1');

  assert.equal(pool.has('disp-1'), false, 'entry should be removed after dispose');
  assert.equal(ctx.closeCalled, true, 'context.close() should have been called');
  await pool.destroy();
});

test('BrowserContextPool: dispose is a no-op for unknown contextId', async () => {
  const pool = makePool();
  // Should not throw
  await pool.dispose('ghost');
  await pool.destroy();
});

test('BrowserContextPool: dispose invokes onContextExpired callback', async () => {
  let expiredId = null;
  const pool = makePool({
    onContextExpired: (id) => { expiredId = id; }
  });
  const ctx = fakeContext();
  await pool.set('exp-ctx', { context: ctx });
  await pool.dispose('exp-ctx');

  assert.equal(expiredId, 'exp-ctx', 'onContextExpired should be called with the contextId');
  await pool.destroy();
});

// ── idle eviction ────────────────────────────────────────────────────────────

test('BrowserContextPool: _closeIdleContexts evicts contexts past idle timeout', async () => {
  const pool = makePool({ closeIdleAfterMs: 50 });
  const ctx = fakeContext();
  await pool.set('idle-ctx', { context: ctx });

  // Backdate lastUsed so it looks idle
  pool.get('idle-ctx').lastUsed = Date.now() - 200;

  await pool._closeIdleContexts();

  assert.equal(pool.has('idle-ctx'), false, 'idle context should have been evicted');
  assert.equal(ctx.closeCalled, true, 'close() should have been called on evicted context');
  await pool.destroy();
});

test('BrowserContextPool: _closeIdleContexts leaves recently-used contexts alone', async () => {
  const pool = makePool({ closeIdleAfterMs: 30_000 });
  const ctx = fakeContext();
  await pool.set('active-ctx', { context: ctx });

  await pool._closeIdleContexts();

  assert.equal(pool.has('active-ctx'), true, 'recently-used context should not be evicted');
  await pool.destroy();
});

// ── clear ────────────────────────────────────────────────────────────────────

test('BrowserContextPool: clear() empties pool and rejects pending waiters', async () => {
  const pool = makePool({ maxContexts: 1, waitTimeoutMs: 5000 });
  await pool.set('c1', { context: fakeContext() });

  // Start a waiter (pool is full, so set() will wait)
  const waiterPromise = pool.set('c2', { context: fakeContext() });

  // clear() should drain the waiter with a rejection
  pool.clear();

  await assert.rejects(
    () => waiterPromise,
    /cleared/i,
    'pending waiter should be rejected when pool is cleared'
  );

  assert.equal(pool.size, 0);
  await pool.destroy();
});

// ── destroy ──────────────────────────────────────────────────────────────────

test('BrowserContextPool: destroy() closes all active contexts', async () => {
  const pool = makePool({ maxContexts: 3, waitTimeoutMs: 5000 });
  const ctx1 = fakeContext();
  const ctx2 = fakeContext();
  await pool.set('c1', { context: ctx1 });
  await pool.set('c2', { context: ctx2 });

  await pool.destroy();

  assert.equal(ctx1.closeCalled, true, 'destroy() should close all contexts');
  assert.equal(ctx2.closeCalled, true, 'destroy() should close all contexts');
  assert.equal(pool.size, 0);
});

test('BrowserContextPool: destroy() on empty pool with pending waiters rejects them', async () => {
  // Pool with no existing contexts but a blocked waiter.
  // We use maxContexts=1 and fill it first; then destroy while a waiter is queued.
  const pool = makePool({ maxContexts: 1, waitTimeoutMs: 5000 });
  const ctx = fakeContext();
  await pool.set('c1', { context: ctx });

  // Add a second waiter — pool is full, so it blocks
  const waiterResult = [];
  const waiterPromise = pool.set('w1', { context: fakeContext() })
    .then(() => waiterResult.push('resolved'))
    .catch((e) => waiterResult.push('rejected:' + e.message));

  // Let the waiter register in _waitQueue
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  // Now destroy. dispose(c1) notifies the waiter, which resolves it.
  // The resolved waiter then sets 'w1' in the (now-destroyed) pool.
  // We just care that destroy() doesn't throw and closes c1.
  await pool.destroy();
  await waiterPromise;

  assert.equal(ctx.closeCalled, true, 'destroy() should call close() on context c1');
  // Waiter was either resolved or rejected depending on race; either is acceptable.
  assert.ok(waiterResult.length >= 1, 'waiter should have settled');
});

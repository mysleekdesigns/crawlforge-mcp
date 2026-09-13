/**
 * Unit tests: the browser session store.
 * Run: node --test --test-force-exit tests/unit/core/browserSessionStore.test.js
 *
 * No browser here, deliberately — the store never touches the page it holds, it
 * only hands it back through the caller's `releasePage`. A plain object stands
 * in for the page and a counting stub for the callback, which is what lets
 * these tests assert the thing that actually matters on a 2 GB box: that every
 * close path releases a page exactly once, and that no path leaves one behind.
 *
 * Expiry is driven by back-dating a session's clocks rather than by waiting or
 * by fake timers. create() clamps a ttl up to TTL_MIN_MS (30s), so an injected
 * millisecond ttl is not available; moving `createdAt` or `lastUsedAt` tests
 * each of the two clocks on its own, with no sleeping.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  BrowserSessionStore,
  SessionNotFoundError,
  SessionLimitError,
  TTL_MIN_MS,
  ACTIVITY_TTL_MAX_MS,
  ACTIVITY_TTL_DEFAULT_MS
} from '../../../src/core/browser/SessionStore.js';

// An id that is well-formed but was never issued.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const stores = [];

/** A store whose sweep timer never fires on its own — the tests call sweep(). */
function makeStore(opts = {}) {
  const store = new BrowserSessionStore({ sweepIntervalMs: 3_600_000, ...opts });
  stores.push(store);
  return store;
}

/** A releasePage stub that counts its calls, and can be made to throw. */
function releaseSpy({ throws = false } = {}) {
  const spy = async () => {
    spy.calls++;
    if (throws) throw new Error('page already closed');
  };
  spy.calls = 0;
  return spy;
}

function open(store, ownerId, releasePage = releaseSpy(), extra = {}) {
  return store.create({
    ownerId,
    page: { id: `page-${ownerId}` },
    releasePage,
    url: 'https://example.test/',
    ...extra
  });
}

function captureError(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return assert.fail('expected the call to throw');
}

after(async () => {
  for (const store of stores) await store.destroy();
});

describe('ownership', () => {
  test('another owner gets the identical error an unknown id gets', () => {
    const store = makeStore();
    const session = open(store, 'key-a');

    const wrongOwner = captureError(() => store.get(session.id, 'key-b'));
    const unknownId = captureError(() => store.get(UNKNOWN_ID, 'key-b'));

    assert.ok(wrongOwner instanceof SessionNotFoundError);
    assert.equal(wrongOwner.code, 'SESSION_NOT_FOUND');
    assert.equal(wrongOwner.message, unknownId.message);
    assert.equal(wrongOwner.name, unknownId.name);
    // The message must not confirm the id exists, so it never repeats it back.
    assert.ok(!wrongOwner.message.includes(session.id));

    // ...and the owner still has it.
    assert.equal(store.get(session.id, 'key-a').id, session.id);
  });

  test('another owner cannot close the session, and its page is not released', async () => {
    const store = makeStore();
    const release = releaseSpy();
    const session = open(store, 'key-a', release);

    await assert.rejects(
      () => store.close(session.id, 'key-b'),
      (err) => err instanceof SessionNotFoundError && err.code === 'SESSION_NOT_FOUND'
    );
    assert.equal(release.calls, 0);
    assert.equal(store.get(session.id, 'key-a').id, session.id);
  });

  test('list is scoped to one owner', () => {
    const store = makeStore({ maxTotal: 10 });
    const mine = open(store, 'key-a');
    open(store, 'key-a');
    open(store, 'key-b');

    const listed = store.list('key-a');
    assert.equal(listed.length, 2);
    assert.ok(listed.some((s) => s.id === mine.id));
    assert.equal(store.list('key-b').length, 1);
    assert.deepEqual(store.list('key-c'), []);

    // Both clocks are reported, so the caller can see which one will fire first.
    const [first] = listed;
    assert.equal(first.expiresAt, mine.createdAt + mine.ttlMs);
    assert.equal(first.idleExpiresAt, mine.lastUsedAt + mine.activityTtlMs);
    // Pages and callbacks stay inside the store.
    assert.deepEqual(Object.keys(first).sort(), [
      'createdAt', 'expiresAt', 'id', 'idleExpiresAt', 'lastUsedAt', 'stealth', 'url'
    ]);
  });
});

describe('expiry', () => {
  test('the absolute TTL ends the session and releases the page once', async () => {
    const store = makeStore();
    const release = releaseSpy();
    const session = open(store, 'key-a', release);

    session.createdAt = Date.now() - session.ttlMs - 1;

    assert.throws(() => store.get(session.id, 'key-a'), SessionNotFoundError);
    assert.equal(release.calls, 1);
    assert.equal(store.getStats().total, 0);

    // The sweep must not find it again — that would be a second release.
    assert.equal(await store.sweep(), 0);
    assert.equal(release.calls, 1);
  });

  test('the idle TTL ends a session still inside its absolute TTL', async () => {
    const store = makeStore();
    const release = releaseSpy();
    const session = open(store, 'key-a', release);

    session.lastUsedAt = Date.now() - session.activityTtlMs - 1;
    assert.ok(Date.now() < session.createdAt + session.ttlMs, 'absolute TTL should still be running');

    assert.throws(() => store.get(session.id, 'key-a'), SessionNotFoundError);
    assert.equal(release.calls, 1);
    assert.equal(await store.sweep(), 0);
    assert.equal(release.calls, 1);
  });

  test('touch restarts the idle clock and records the new url', () => {
    const store = makeStore();
    const release = releaseSpy();
    const session = open(store, 'key-a', release);

    session.lastUsedAt = Date.now() - session.activityTtlMs - 1;
    store.touch(session, 'https://example.test/dashboard');

    assert.equal(store.get(session.id, 'key-a').url, 'https://example.test/dashboard');
    assert.equal(release.calls, 0);

    // Without a url the recorded one is kept, not cleared.
    store.touch(session);
    assert.equal(session.url, 'https://example.test/dashboard');
  });

  test('create clamps ttls into range instead of throwing', () => {
    const store = makeStore();
    const session = open(store, 'key-a', releaseSpy(), {
      ttlMs: 5,
      activityTtlMs: 999_999_999
    });

    assert.equal(session.ttlMs, TTL_MIN_MS);
    assert.equal(session.activityTtlMs, ACTIVITY_TTL_MAX_MS);

    // Garbage falls back to the default rather than producing a NaN clock.
    const junk = open(store, 'key-a', releaseSpy(), { activityTtlMs: 'soon' });
    assert.equal(junk.activityTtlMs, ACTIVITY_TTL_DEFAULT_MS);
  });
});

describe('caps', () => {
  test('the per-owner cap refuses rather than waiting', () => {
    const store = makeStore({ maxPerOwner: 2, maxTotal: 10 });
    open(store, 'key-a');
    open(store, 'key-a');

    // A synchronous throw is the point: a queue here would hang the tool call
    // until a session TTL expired, minutes away.
    const err = captureError(() => open(store, 'key-a'));
    assert.ok(err instanceof SessionLimitError);
    assert.equal(err.code, 'SESSION_LIMIT');
    assert.match(err.message, /maximum per API key/);
    assert.equal(store.getStats().byOwner['key-a'], 2);
  });

  test('the cap is per owner, so one key cannot lock another out', () => {
    const store = makeStore({ maxPerOwner: 1, maxTotal: 10 });
    open(store, 'key-a');
    const theirs = open(store, 'key-b');

    assert.equal(store.get(theirs.id, 'key-b').id, theirs.id);
    assert.deepEqual(store.getStats(), { total: 2, byOwner: { 'key-a': 1, 'key-b': 1 } });
  });

  test('an expired session does not count against the cap', () => {
    const store = makeStore({ maxPerOwner: 1, maxTotal: 10 });
    const release = releaseSpy();
    const stale = open(store, 'key-a', release);
    stale.createdAt = Date.now() - stale.ttlMs - 1;

    const fresh = open(store, 'key-a');
    assert.equal(release.calls, 1, 'the expired session should have been released, not merely dropped');
    assert.equal(store.getStats().total, 1);
    assert.equal(store.get(fresh.id, 'key-a').id, fresh.id);
  });

  test('a per-call maxPerOwner tightens the cap for that owner alone', () => {
    // How the tool holds a hosted REST customer to one session on a box whose
    // whole capacity is three, without changing what a stdio install gets.
    const store = makeStore({ maxPerOwner: 3, maxTotal: 10 });
    open(store, 'rest:token-a', releaseSpy(), { maxPerOwner: 1 });

    const err = captureError(() => open(store, 'rest:token-a', releaseSpy(), { maxPerOwner: 1 }));
    assert.ok(err instanceof SessionLimitError);
    assert.equal(err.code, 'SESSION_LIMIT');
    assert.match(err.message, /1 open browser session,/, 'the refusal counts in the singular');

    // The store's own cap is untouched for everyone who did not ask for one.
    open(store, 'key-a');
    open(store, 'key-a');
    open(store, 'key-a');
    assert.deepEqual(store.getStats(), { total: 4, byOwner: { 'rest:token-a': 1, 'key-a': 3 } });
  });

  test('the process-wide cap refuses once the store is full', () => {
    const store = makeStore({ maxPerOwner: 5, maxTotal: 2 });
    open(store, 'key-a');
    open(store, 'key-b');

    const err = captureError(() => open(store, 'key-c'));
    assert.ok(err instanceof SessionLimitError);
    assert.match(err.message, /maximum of 2 browser sessions/);
  });
});

describe('sweep', () => {
  test('closes only what is expired and returns the count', async () => {
    const store = makeStore({ maxPerOwner: 5, maxTotal: 10 });
    const staleRelease = releaseSpy();
    const idleRelease = releaseSpy();
    const liveRelease = releaseSpy();

    const stale = open(store, 'key-a', staleRelease);
    const idle = open(store, 'key-b', idleRelease);
    const live = open(store, 'key-a', liveRelease);

    stale.createdAt = Date.now() - stale.ttlMs - 1;
    idle.lastUsedAt = Date.now() - idle.activityTtlMs - 1;

    assert.equal(await store.sweep(), 2);
    assert.equal(staleRelease.calls, 1);
    assert.equal(idleRelease.calls, 1);
    assert.equal(liveRelease.calls, 0);
    assert.equal(store.get(live.id, 'key-a').id, live.id);
    assert.equal(await store.sweep(), 0);
  });

  test('a releasePage that throws still removes the session', async () => {
    const store = makeStore();
    const release = releaseSpy({ throws: true });
    const session = open(store, 'key-a', release);

    await store.close(session.id, 'key-a');

    assert.equal(release.calls, 1);
    assert.equal(store.getStats().total, 0);
    assert.throws(() => store.get(session.id, 'key-a'), SessionNotFoundError);
  });
});

describe('close and destroy', () => {
  test('close releases the page exactly once, and a second close refuses', async () => {
    const store = makeStore();
    const release = releaseSpy();
    const session = open(store, 'key-a', release);

    await store.close(session.id, 'key-a');
    assert.equal(release.calls, 1);

    await assert.rejects(
      () => store.close(session.id, 'key-a'),
      (err) => err instanceof SessionNotFoundError
    );
    assert.equal(release.calls, 1);
  });

  test('destroy releases every session and empties the store', async () => {
    const store = makeStore({ maxPerOwner: 5, maxTotal: 10 });
    const first = releaseSpy();
    const second = releaseSpy();
    open(store, 'key-a', first);
    open(store, 'key-b', second);

    await store.destroy();

    assert.equal(first.calls, 1);
    assert.equal(second.calls, 1);
    assert.deepEqual(store.getStats(), { total: 0, byOwner: {} });

    // Safe to call twice — nothing is released a second time.
    await store.destroy();
    assert.equal(first.calls, 1);
  });
});

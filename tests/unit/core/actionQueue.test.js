/**
 * Unit tests: the shared browser-slot limiter (src/core/browser/actionQueue.js).
 * Run: node --test --test-force-exit tests/unit/core/actionQueue.test.js
 *
 * Every test builds its own small limiter through createActionQueue, so none of
 * them waits on the process-wide one or on the environment it was sized from.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createActionQueue, actionQueue } from '../../../src/core/browser/actionQueue.js';

/** A job that runs until the test releases it. */
function gate() {
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  return { release, released };
}

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

describe('actionQueue', () => {
  test('never runs more jobs at once than its concurrency', async () => {
    const limiter = createActionQueue({ concurrency: 3, timeoutMs: 5_000 });
    let running = 0;
    let peak = 0;
    const jobs = Array.from({ length: 7 }, () => limiter.run(async () => {
      running++;
      peak = Math.max(peak, running);
      await tick(10);
      running--;
      return 'done';
    }));

    const results = await Promise.all(jobs);
    assert.deepEqual(results, Array(7).fill('done'));
    assert.equal(peak, 3);
  });

  test('a queued job runs as soon as a slot frees', async () => {
    const limiter = createActionQueue({ concurrency: 1, timeoutMs: 5_000 });
    const first = gate();
    const firstJob = limiter.run(() => first.released);
    let secondStarted = false;
    const secondJob = limiter.run(async () => { secondStarted = true; return 2; });

    await tick();
    assert.equal(secondStarted, false, 'the second job must wait while the only slot is held');
    assert.equal(limiter.running, 1);
    assert.equal(limiter.queued, 1);

    first.release(1);
    assert.equal(await firstJob, 1);
    assert.equal(await secondJob, 2);
    assert.equal(secondStarted, true);
  });

  test('a wait that outlasts the timeout rejects naming the depth and the limit, and never runs', async () => {
    const limiter = createActionQueue({ concurrency: 1, timeoutMs: 40 });
    const holder = gate();
    const held = limiter.run(() => holder.released);
    let ranLate = false;

    await assert.rejects(
      limiter.run(() => { ranLate = true; }, { label: 'scrape_with_actions' }),
      (error) => {
        assert.match(error.message, /^scrape_with_actions timed out after 0\.04 s waiting for a browser slot/);
        assert.match(error.message, /1 running, 1 queued/);
        assert.match(error.message, /CRAWLFORGE_MAX_ACTION_SESSIONS=1/);
        return true;
      }
    );
    assert.equal(limiter.queued, 0, 'the timed-out job must leave the queue');

    // Free the slot: a job that had only been abandoned, not removed, would run now.
    holder.release();
    await held;
    await tick(20);
    assert.equal(ranLate, false, 'a timed-out job must never run later');
  });

  test('the timeout bounds the wait, not the run', async () => {
    const limiter = createActionQueue({ concurrency: 1, timeoutMs: 20 });
    // Runs well past the wait timeout; it had its slot from the start.
    assert.equal(await limiter.run(async () => { await tick(60); return 'slow'; }), 'slow');
  });

  test('the process-wide limiter defaults to 3 slots and a 60 s wait', () => {
    if (process.env.CRAWLFORGE_MAX_ACTION_SESSIONS || process.env.CRAWLFORGE_ACTION_QUEUE_TIMEOUT_MS) return;
    assert.equal(actionQueue.concurrency, 3);
    assert.equal(actionQueue.timeoutMs, 60_000);
  });

  test('garbage in the environment falls back to the defaults', () => {
    const saved = { ...process.env };
    try {
      process.env.CRAWLFORGE_MAX_ACTION_SESSIONS = 'zero';
      process.env.CRAWLFORGE_ACTION_QUEUE_TIMEOUT_MS = '-5';
      const limiter = createActionQueue();
      assert.equal(limiter.concurrency, 3);
      assert.equal(limiter.timeoutMs, 60_000);

      process.env.CRAWLFORGE_MAX_ACTION_SESSIONS = '5';
      process.env.CRAWLFORGE_ACTION_QUEUE_TIMEOUT_MS = '1500';
      const sized = createActionQueue();
      assert.equal(sized.concurrency, 5);
      assert.equal(sized.timeoutMs, 1500);
    } finally {
      process.env = saved;
    }
  });
});

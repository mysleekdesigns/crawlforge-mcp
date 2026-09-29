/**
 * actionQueue — the one process-wide budget of browser slots that
 * `scrape_with_actions` chains and `browser_session` opens share.
 *
 * A caller over the limit WAITS for a slot instead of being refused: the live
 * review's fourth parallel scrape_with_actions call was rejected outright with
 * "Maximum concurrent sessions (3) reached". It now queues for up to
 * CRAWLFORGE_ACTION_QUEUE_TIMEOUT_MS and only then fails, with a message that
 * names the queue depth and the limit.
 *
 * A slot covers the slow part of a browser job — context/page creation and
 * navigation — not the life of whatever it produced. browser_session takes one
 * for `open` only (see BrowserSessionTool.openSession); its session caps live
 * in SessionStore and are policy, which still refuses.
 */

import PQueue from 'p-queue';

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 60_000;

/** A positive integer from the environment, or the default for anything else. */
function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * @param {Object} [opts]
 * @param {number} [opts.concurrency] — slots that may run at once
 * @param {number} [opts.timeoutMs]   — longest a caller waits for a slot
 */
export function createActionQueue({
  concurrency = positiveInt(process.env.CRAWLFORGE_MAX_ACTION_SESSIONS, DEFAULT_CONCURRENCY),
  timeoutMs = positiveInt(process.env.CRAWLFORGE_ACTION_QUEUE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
} = {}) {
  const queue = new PQueue({ concurrency });

  /**
   * Run `fn` once a slot is free, holding the slot until `fn` settles.
   *
   * The timeout bounds the WAIT, never the run: the timer is cleared the moment
   * the job starts. That matters because p-queue races a running job against
   * its signal and frees the slot on abort while `fn` carries on — an abort
   * after start would let a fourth browser job in beside three live ones.
   * Before start, the abort removes the job from the queue, so a caller that
   * timed out never runs later.
   */
  function run(fn, { label = 'browser job' } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // Read before the abort removes this job: the depth the caller waited behind.
      controller.abort(new Error(
        `${label} timed out after ${timeoutMs / 1000} s waiting for a browser slot: ` +
        `${queue.pending} running, ${queue.size} queued ` +
        `(CRAWLFORGE_MAX_ACTION_SESSIONS=${concurrency}). Retry shortly, or raise ` +
        'CRAWLFORGE_MAX_ACTION_SESSIONS / CRAWLFORGE_ACTION_QUEUE_TIMEOUT_MS if the machine has room.'
      ));
    }, timeoutMs);
    timer.unref?.();

    return queue.add(() => {
      clearTimeout(timer);
      return fn();
    }, { signal: controller.signal });
  }

  return {
    run,
    concurrency,
    timeoutMs,
    get running() { return queue.pending; },
    get queued() { return queue.size; }
  };
}

/**
 * The process-wide limiter both tools use. Tools take an `actionQueue` option
 * so a test can hand them a small private one; production never passes it.
 */
export const actionQueue = createActionQueue();

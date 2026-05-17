/**
 * BrowserContextPool — bounded Playwright browser-context pool.
 *
 * Replaces the unbounded `this.contexts = new Map()` in StealthBrowserManager
 * with a pool that:
 *   - enforces a hard cap (MAX_BROWSER_CONTEXTS, default 10)
 *   - disposes contexts after N uses (periodicRefreshAfter, default 200)
 *   - closes idle contexts after a configurable timeout
 *   - maintains a concurrency wait-queue so excess callers fail fast
 *     (timeout: waitTimeoutMs, default 10 000 ms) rather than accumulating
 *
 * The Map-compatible surface (get/set/delete/entries/clear/size) lets
 * StealthBrowserManager adopt it with minimal changes.
 */

const DEFAULT_MAX_CONTEXTS = parseInt(process.env.MAX_BROWSER_CONTEXTS || '10', 10);
const DEFAULT_PERIODIC_REFRESH_AFTER = 200;   // context uses before forced close+relaunch
const DEFAULT_CLOSE_IDLE_AFTER_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;

export class BrowserContextPool {
  /**
   * @param {Object} [opts]
   * @param {number}   [opts.maxContexts]
   * @param {number}   [opts.periodicRefreshAfter] — max uses per context before disposal
   * @param {number}   [opts.closeIdleAfterMs]
   * @param {number}   [opts.waitTimeoutMs] — max wait for a free slot; fails fast after
   * @param {Function} [opts.onContextExpired] — async (contextId, contextData) => void
   */
  constructor(opts = {}) {
    this._maxContexts = opts.maxContexts ?? DEFAULT_MAX_CONTEXTS;
    this._periodicRefreshAfter = opts.periodicRefreshAfter ?? DEFAULT_PERIODIC_REFRESH_AFTER;
    this._closeIdleAfterMs = opts.closeIdleAfterMs ?? DEFAULT_CLOSE_IDLE_AFTER_MS;
    this._waitTimeoutMs = opts.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this._onContextExpired = opts.onContextExpired || null;

    /** @type {Map<string, { context: any, fingerprint: any, config: any, uses: number, lastUsed: number, created: number }>} */
    this._contexts = new Map();

    /** Pending callers waiting for a free slot */
    this._waitQueue = [];

    /** Periodic idle-checker timer */
    this._idleTimer = setInterval(() => this._closeIdleContexts(), Math.min(this._closeIdleAfterMs, 60_000));
    this._idleTimer.unref?.(); // don't prevent process exit
  }

  // ── Map-compatible surface ──────────────────────────────────────────────────

  get size() { return this._contexts.size; }

  get(contextId) { return this._contexts.get(contextId) ?? undefined; }

  has(contextId) { return this._contexts.has(contextId); }

  entries() { return this._contexts.entries(); }

  keys() { return this._contexts.keys(); }

  values() { return this._contexts.values(); }

  /**
   * Register a context.  Throws if the pool is full and no slot becomes
   * available within waitTimeoutMs.
   */
  async set(contextId, contextData) {
    if (this._contexts.size >= this._maxContexts) {
      await this._waitForSlot();
    }
    this._contexts.set(contextId, {
      ...contextData,
      uses: 0,
      lastUsed: Date.now(),
      created: Date.now()
    });
    return this;
  }

  /**
   * Synchronous set — for callers that already verified there is capacity.
   * Throws immediately if pool is at capacity.
   */
  setSync(contextId, contextData) {
    if (this._contexts.size >= this._maxContexts) {
      throw new Error(`BrowserContextPool is at capacity (${this._maxContexts} contexts). Use await pool.set() to wait for a free slot.`);
    }
    this._contexts.set(contextId, {
      ...contextData,
      uses: 0,
      lastUsed: Date.now(),
      created: Date.now()
    });
    return this;
  }

  delete(contextId) {
    const deleted = this._contexts.delete(contextId);
    if (deleted) this._notifyWaiter();
    return deleted;
  }

  clear() {
    this._contexts.clear();
    // Drain any waiters with rejections so they don't hang
    const waiters = this._waitQueue.splice(0);
    waiters.forEach(({ reject }) => reject(new Error('BrowserContextPool cleared')));
  }

  // ── Pool-specific API ───────────────────────────────────────────────────────

  /**
   * Record a use for the given context.
   * Returns true if the context should be closed and re-created (refresh needed).
   * @param {string} contextId
   */
  recordUse(contextId) {
    const entry = this._contexts.get(contextId);
    if (!entry) return false;
    entry.uses++;
    entry.lastUsed = Date.now();
    return entry.uses >= this._periodicRefreshAfter;
  }

  /**
   * Dispose a context (close it + remove from pool).
   * @param {string} contextId
   */
  async dispose(contextId) {
    const entry = this._contexts.get(contextId);
    if (!entry) return;
    this._contexts.delete(contextId);
    this._notifyWaiter();
    try {
      await entry.context?.close();
    } catch {
      // ignore close errors
    }
    this._onContextExpired?.(contextId, entry);
  }

  /**
   * Close all idle contexts (lastUsed > closeIdleAfterMs ago).
   */
  async _closeIdleContexts() {
    const now = Date.now();
    for (const [contextId, entry] of this._contexts.entries()) {
      if (now - entry.lastUsed > this._closeIdleAfterMs) {
        await this.dispose(contextId);
      }
    }
  }

  /**
   * Wait until a slot becomes available (or time out).
   */
  _waitForSlot() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waitQueue.findIndex(w => w.resolve === resolve);
        if (idx !== -1) this._waitQueue.splice(idx, 1);
        reject(new Error(`BrowserContextPool: timed out waiting for a free context slot after ${this._waitTimeoutMs}ms`));
      }, this._waitTimeoutMs);

      this._waitQueue.push({ resolve, reject, timer });
    });
  }

  /** Notify the oldest pending waiter that a slot is now free. */
  _notifyWaiter() {
    if (this._waitQueue.length === 0) return;
    const { resolve, timer } = this._waitQueue.shift();
    clearTimeout(timer);
    resolve();
  }

  /** Destroy the pool — closes all contexts and clears the idle timer. */
  async destroy() {
    clearInterval(this._idleTimer);
    for (const contextId of Array.from(this._contexts.keys())) {
      await this.dispose(contextId);
    }
    const waiters = this._waitQueue.splice(0);
    waiters.forEach(({ reject }) => reject(new Error('BrowserContextPool destroyed')));
  }
}

export default BrowserContextPool;

/**
 * BrowserSessionStore — the registry behind a browser session that outlives a
 * single tool call.
 *
 * A session is a page the caller gets to keep: log in once, then click, type
 * and snapshot across several calls without paying for the login every time.
 * This file holds those pages, decides when one has gone stale, and hands it
 * back. How a page was made — stealth or not, which engine, which context — is
 * the caller's business, never ours.
 *
 * NO SECOND POOL. Sessions hold pages whose browser contexts are already
 * registered in StealthBrowserManager's BrowserContextPool by the code that
 * opened them. Constructing a pool here would double-count every context
 * against a cap that exists to protect a 2 GB box, so do not "fix" the missing
 * pool. The plan's "context id" field is carried implicitly by `releasePage`,
 * the closure the creator supplies to give the page back: the store knows how
 * to return a page, not how it was built, and so imports neither
 * BrowserProcessor nor StealthBrowserManager.
 *
 * REFS NEED NO FIELD either. Element refs (`@e1`) live in a page-scoped WeakMap
 * inside src/core/browser/snapshot.js, so a session that keeps its page keeps
 * its refs for free — and loses them exactly when it should, on navigation or
 * when the page closes. A second copy here could only disagree with that one.
 *
 * OWNERSHIP IS A TENANT BOUNDARY, not a convenience. Ids are random and every
 * lookup is scoped to the caller; a wrong owner is answered with the same
 * "session not found" an unknown id gets, so ids cannot be probed from the
 * outside. See SessionNotFoundError.
 */

import { randomUUID } from 'node:crypto';

/**
 * Thrown for an unknown id, a wrong owner and an expired session alike.
 *
 * It takes no message on purpose: a call site cannot vary what it says, so the
 * three cases cannot drift apart over time and start telling a caller which one
 * they hit. That sameness is what makes session ids non-enumerable, and it is
 * also why the message never echoes the id back.
 */
export class SessionNotFoundError extends Error {
  constructor() {
    super(
      'Session not found. It may have expired, been closed, or never existed — ' +
      'open a new session and try again.'
    );
    this.name = 'SessionNotFoundError';
    this.code = 'SESSION_NOT_FOUND';
  }
}

/** Thrown when a new session would breach the per-owner or process-wide cap. */
export class SessionLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionLimitError';
    this.code = 'SESSION_LIMIT';
  }
}

// Two clocks, and their bounds. The numbers match Firecrawl's session TTLs so
// that our documentation reads familiar to anyone arriving from theirs.
export const TTL_DEFAULT_MS = 600_000;            // 10 minutes from creation
export const TTL_MIN_MS = 30_000;
export const TTL_MAX_MS = 3_600_000;              // 1 hour
export const ACTIVITY_TTL_DEFAULT_MS = 300_000;   // 5 minutes since last use
export const ACTIVITY_TTL_MIN_MS = 10_000;
export const ACTIVITY_TTL_MAX_MS = 3_600_000;

export const DEFAULT_MAX_SESSIONS_PER_OWNER = 3;

// Every live session pins one browser context for as long as it lives, and
// one-shot scrapes draw contexts from the same pool — which caps at
// MAX_BROWSER_CONTEXTS. Sessions therefore get at most half of it, so a burst
// of them can never leave an ordinary scrape waiting on a slot that will not
// free for another ten minutes.
//
// This is the SECOND reader of that variable — BrowserContextPool.js reads it
// with the same '10' fallback — and "half the pool" holds only while the two
// defaults agree. Change one and change this one with it. Deliberately not an
// import of the pool's constant: nothing in this file may reach for the pool
// (see the header), and a grep for MAX_BROWSER_CONTEXTS finds both sites.
const CONTEXT_CAP = parseInt(process.env.MAX_BROWSER_CONTEXTS || '10', 10) || 10;
export const DEFAULT_MAX_SESSIONS_TOTAL = Math.max(1, Math.floor(CONTEXT_CAP / 2));

const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

/** Caller-supplied ttls are clamped, not rejected — see create(). */
function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

export class BrowserSessionStore {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.maxPerOwner] — concurrent sessions one API key may hold
   * @param {number} [opts.maxTotal] — concurrent sessions the process may hold
   * @param {number} [opts.sweepIntervalMs]
   */
  constructor(opts = {}) {
    this._maxPerOwner = opts.maxPerOwner ?? DEFAULT_MAX_SESSIONS_PER_OWNER;
    this._maxTotal = opts.maxTotal ?? DEFAULT_MAX_SESSIONS_TOTAL;

    // The only index. A store holds single digits of sessions, so the
    // per-owner questions (cap, list, stats) are answered by scanning this map
    // rather than by a second one that could fall out of step with it.
    /** @type {Map<string, { id: string, ownerId: string, page: any, releasePage: Function, url: string|null, stealth: boolean, createdAt: number, lastUsedAt: number, ttlMs: number, activityTtlMs: number }>} */
    this._sessions = new Map();

    this._sweepTimer = setInterval(() => {
      // An unhandled rejection inside a timer callback takes the server down
      // with it. _release never rejects, and this is what keeps that true even
      // if someone later changes it.
      this.sweep().catch(() => {});
    }, opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
    this._sweepTimer.unref?.(); // never hold the process open
  }

  /**
   * Register a live page as a session.
   *
   * @param {Object} args
   * @param {string} args.ownerId — the caller's API-key identity; the tenant boundary
   * @param {any} args.page — the Playwright page the session keeps
   * @param {() => Promise<void>} args.releasePage — hands the page, and its context, back
   * @param {string} [args.url]
   * @param {boolean} [args.stealth=false]
   * @param {number} [args.ttlMs] — clamped into [TTL_MIN_MS, TTL_MAX_MS]
   * @param {number} [args.activityTtlMs] — clamped into [ACTIVITY_TTL_MIN_MS, ACTIVITY_TTL_MAX_MS]
   * @param {number} [args.maxPerOwner] — a tighter cap for THIS owner, in place
   *   of the store's. Some callers are not equal: a hosted REST customer shares
   *   one box with every other one, where a stdio install has the box to itself.
   *   Only the creator may say so, because only the creator knows who is asking.
   * @throws {SessionLimitError} when the owner is at maxPerOwner, or the store at maxTotal
   */
  create({ ownerId, page, releasePage, url = null, stealth = false, ttlMs, activityTtlMs, maxPerOwner }) {
    // Both of these are load-bearing rather than defensive: without an ownerId
    // two tenants' sessions would share one anonymous bucket, and without a
    // releasePage the page's context is pinned with no way to give it back.
    if (!ownerId) {
      throw new TypeError('BrowserSessionStore.create requires an ownerId');
    }
    if (typeof releasePage !== 'function') {
      throw new TypeError('BrowserSessionStore.create requires a releasePage callback');
    }

    // Expired-but-unswept sessions must not count against the caps: a caller
    // whose three sessions all timed out a second ago is not over quota.
    this._purgeExpired();

    // A refusal, never a queue. BrowserContextPool can make a caller wait for a
    // slot because a context frees in milliseconds; a session slot frees on its
    // TTL, minutes away, so waiting would simply hang the call.
    const ownerCap = maxPerOwner ?? this._maxPerOwner;
    if (this._countFor(ownerId) >= ownerCap) {
      throw new SessionLimitError(
        `You already have ${ownerCap} open browser session${ownerCap === 1 ? '' : 's'}, the maximum per API key. ` +
        `Close one before opening another — sessions also close themselves when their TTL expires.`
      );
    }
    if (this._sessions.size >= this._maxTotal) {
      throw new SessionLimitError(
        `The server is holding its maximum of ${this._maxTotal} browser sessions. ` +
        `Try again shortly, or use a one-shot scrape instead of a session.`
      );
    }

    const now = Date.now();
    const session = {
      id: randomUUID(),
      ownerId,
      page,
      releasePage,
      url,
      stealth,
      createdAt: now,
      lastUsedAt: now,
      // Clamped rather than rejected: the tool validates the caller-facing
      // seconds with zod, so anything arriving out of range here is a bug on
      // our side of the boundary, not a caller error to report.
      ttlMs: clamp(ttlMs, TTL_MIN_MS, TTL_MAX_MS, TTL_DEFAULT_MS),
      activityTtlMs: clamp(activityTtlMs, ACTIVITY_TTL_MIN_MS, ACTIVITY_TTL_MAX_MS, ACTIVITY_TTL_DEFAULT_MS)
    };

    this._sessions.set(session.id, session);
    return session;
  }

  /**
   * Look a session up on behalf of its owner. It records nothing — touch() does
   * that — so a read never extends a session's life by accident.
   *
   * Unknown id, wrong owner and expired session all raise the identical
   * SessionNotFoundError.
   *
   * @throws {SessionNotFoundError}
   */
  get(sessionId, ownerId) {
    const session = this._sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) throw new SessionNotFoundError();

    if (this._isExpired(session, Date.now())) {
      // Expiry is not the sweep's alone to notice. A session that timed out
      // between sweeps is gone the moment it is asked for, and its page goes
      // back now rather than up to half a minute later. get() is synchronous,
      // so the release runs unawaited; _release never rejects.
      this._sessions.delete(sessionId);
      this._release(session);
      throw new SessionNotFoundError();
    }

    return session;
  }

  /** Record activity, and the page's new url when it moved. Restarts the idle clock. */
  touch(session, url) {
    session.lastUsedAt = Date.now();
    if (url) session.url = url;
  }

  /**
   * Close a session on behalf of its owner and give its page back.
   * @throws {SessionNotFoundError}
   */
  async close(sessionId, ownerId) {
    const session = this.get(sessionId, ownerId);
    // Out of the map BEFORE the first await. That is what makes releasePage run
    // exactly once when two closes race, and what stops a throwing release from
    // leaving a dead session behind for someone to find.
    this._sessions.delete(sessionId);
    await this._release(session);
  }

  /** One owner's live sessions, in the shape the tool reports. Pages stay in here. */
  list(ownerId) {
    this._purgeExpired();
    const sessions = [];
    for (const session of this._sessions.values()) {
      if (session.ownerId !== ownerId) continue;
      sessions.push({
        id: session.id,
        url: session.url,
        stealth: session.stealth,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        expiresAt: session.createdAt + session.ttlMs,
        idleExpiresAt: session.lastUsedAt + session.activityTtlMs
      });
    }
    return sessions;
  }

  /**
   * Close everything past either clock. This is the backstop that keeps an
   * abandoned session from pinning a browser context for the life of the
   * process — on the 2 GB box that is an outage, not a leak.
   *
   * @returns {Promise<number>} sessions closed
   */
  async sweep() {
    const expired = this._takeExpired(Date.now());
    await Promise.all(expired.map((session) => this._release(session)));
    return expired.length;
  }

  /** Close every session and stop the sweep. Safe to call twice. */
  async destroy() {
    clearInterval(this._sweepTimer);
    const sessions = Array.from(this._sessions.values());
    this._sessions.clear();
    await Promise.all(sessions.map((session) => this._release(session)));
  }

  getStats() {
    const byOwner = {};
    for (const session of this._sessions.values()) {
      byOwner[session.ownerId] = (byOwner[session.ownerId] || 0) + 1;
    }
    return { total: this._sessions.size, byOwner };
  }

  // ── internals ───────────────────────────────────────────────────────────────

  _countFor(ownerId) {
    let count = 0;
    for (const session of this._sessions.values()) {
      if (session.ownerId === ownerId) count++;
    }
    return count;
  }

  /** Past its absolute TTL, or idle past its activity TTL — whichever fires first. */
  _isExpired(session, now) {
    return now >= session.createdAt + session.ttlMs
      || now >= session.lastUsedAt + session.activityTtlMs;
  }

  /** Remove every expired session from the map and return them, still unreleased. */
  _takeExpired(now) {
    const expired = [];
    for (const [id, session] of this._sessions.entries()) {
      if (this._isExpired(session, now)) {
        this._sessions.delete(id);
        expired.push(session);
      }
    }
    return expired;
  }

  /** _takeExpired for the synchronous paths, which have no way to await the releases. */
  _purgeExpired() {
    for (const session of this._takeExpired(Date.now())) this._release(session);
  }

  /**
   * Give one page back. Never rejects: by the time this runs the session is
   * already out of the map, so a failed close is the pool's problem rather than
   * anything the caller can act on — the same call BrowserContextPool.dispose
   * makes about a context that will not close.
   */
  async _release(session) {
    try {
      await session.releasePage();
    } catch {
      // ignore release errors
    }
  }
}

export default BrowserSessionStore;

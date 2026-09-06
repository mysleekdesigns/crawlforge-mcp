/**
 * ResultStore — where a tool result lives once it is too large to return
 * inline (Phase 2, result handles).
 *
 * Local and per-process: the store is on the machine the server runs on,
 * which is where the result already was. Nothing leaves it. Entries are
 * written under ~/.crawlforge/results/ (same root as SnapshotManager's
 * snapshots), indexed in memory, evicted least-recently-used once the total
 * passes maxBytes, and dropped after ttlMs whatever happens. A result that
 * cannot be written to disk stays in memory instead — put never fails for a
 * disk error.
 *
 * Handles are `res_<uuid>` (or a caller-supplied key such as a batch id).
 * RESULT_HANDLE_PATTERN is the path-traversal guard: every method rejects a
 * handle that does not match before touching the filesystem.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const RESULT_HANDLE_PATTERN = /^(res|batch)_[A-Za-z0-9_-]{1,80}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{4,80}$/;

export class ResultStore {
  /**
   * @param {object} [options]
   * @param {string} [options.baseDir] — directory for the result files (default ~/.crawlforge/results)
   * @param {number} [options.maxBytes] — LRU budget in serialised bytes (default 200 MB)
   * @param {number} [options.ttlMs] — how long an entry is readable (default 1 hour)
   * @param {number} [options.sweepIntervalMs] — expiry sweep period (default 5 minutes)
   * @param {object} [options.logger] — optional logger with warn()
   */
  constructor({
    baseDir,
    maxBytes = 200 * 1024 * 1024,
    ttlMs = 60 * 60 * 1000,
    sweepIntervalMs = 5 * 60 * 1000,
    logger = null
  } = {}) {
    this.baseDir = baseDir || path.join(os.homedir(), '.crawlforge', 'results');
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.logger = logger;
    // Insertion order is LRU order: get() re-inserts the entry it read.
    this.index = new Map();
    this.totalBytes = 0;

    this._cleanupStaleFiles();

    // .unref() so this timer never blocks process exit on its own — matches
    // SnapshotManager's cleanupTimer.
    this._sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    if (typeof this._sweepTimer.unref === 'function') this._sweepTimer.unref();
  }

  /**
   * Store a payload. Never throws for a disk error.
   * @param {string} toolName
   * @param {unknown} payload — any JSON-serialisable value
   * @param {{ key?: string, meta?: object }} [options] — key: caller-supplied handle
   * @returns {string} handle
   */
  put(toolName, payload, { key, meta = {} } = {}) {
    let handle;
    if (key !== undefined) {
      if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
        throw new Error(`ResultStore: invalid key "${key}"`);
      }
      if (!RESULT_HANDLE_PATTERN.test(key)) {
        throw new Error(`ResultStore: key "${key}" must start with res_ or batch_ to be readable as a handle`);
      }
      handle = key;
    } else {
      handle = `res_${randomUUID()}`;
    }

    const json = JSON.stringify(payload);
    const bytes = Buffer.byteLength(json);
    const createdAt = Date.now();
    const entry = { handle, toolName, bytes, createdAt, expiresAt: createdAt + this.ttlMs, meta };

    // Re-put under the same key replaces the old entry (and its bytes).
    if (this.index.has(handle)) this.delete(handle);

    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
      fs.writeFileSync(this._file(handle), json);
    } catch (error) {
      entry.inMemory = true;
      entry.json = json;
      this.logger?.warn?.(`ResultStore: could not write ${handle} to ${this.baseDir}, keeping it in memory: ${error.message}`);
    }

    this.index.set(handle, entry);
    this.totalBytes += bytes;
    this._evict(handle);
    return handle;
  }

  /**
   * @param {string} handle
   * @returns {{ handle: string, toolName: string, payload: unknown, bytes: number, createdAt: number, expiresAt: number, meta: object } | null}
   */
  get(handle) {
    const entry = this._live(handle);
    if (!entry) return null;

    let payload;
    try {
      const json = entry.inMemory ? entry.json : fs.readFileSync(this._file(handle), 'utf8');
      payload = JSON.parse(json);
    } catch {
      // A missing or corrupt file is treated as gone, never thrown.
      this.delete(handle);
      return null;
    }

    // Refresh recency.
    this.index.delete(handle);
    this.index.set(handle, entry);

    const { toolName, bytes, createdAt, expiresAt, meta } = entry;
    return { handle, toolName, payload, bytes, createdAt, expiresAt, meta };
  }

  /** Live and unexpired, without a disk read. */
  has(handle) {
    return this._live(handle) !== null;
  }

  delete(handle) {
    if (!RESULT_HANDLE_PATTERN.test(handle)) return false;
    const entry = this.index.get(handle);
    if (!entry) return false;
    this.index.delete(handle);
    this.totalBytes -= entry.bytes;
    if (!entry.inMemory) {
      try { fs.unlinkSync(this._file(handle)); } catch { /* already gone */ }
    }
    return true;
  }

  /** Index entries without payloads. */
  list() {
    return [...this.index.values()].map(({ handle, toolName, bytes, createdAt, expiresAt, meta, inMemory }) => (
      { handle, toolName, bytes, createdAt, expiresAt, meta, inMemory: inMemory === true }
    ));
  }

  /** Remove expired entries and their files. */
  sweep() {
    const now = Date.now();
    for (const [handle, entry] of this.index) {
      if (entry.expiresAt <= now) this.delete(handle);
    }
  }

  close() {
    if (this._sweepTimer) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _file(handle) {
    return path.join(this.baseDir, `${handle}.json`);
  }

  /** The index entry when the handle is valid, known and unexpired; else null. */
  _live(handle) {
    if (typeof handle !== 'string' || !RESULT_HANDLE_PATTERN.test(handle)) return null;
    const entry = this.index.get(handle);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.delete(handle);
      return null;
    }
    return entry;
  }

  /** Evict least-recently-used entries until the budget holds; never `keep`. */
  _evict(keep) {
    for (const handle of this.index.keys()) {
      if (this.totalBytes <= this.maxBytes) return;
      if (handle === keep) return;
      this.delete(handle);
    }
  }

  /**
   * Best-effort removal of result files older than the TTL. Other server
   * processes may share the directory, so a file younger than the TTL is
   * never touched here even though this process did not write it.
   */
  _cleanupStaleFiles() {
    try {
      const cutoff = Date.now() - this.ttlMs;
      for (const name of fs.readdirSync(this.baseDir)) {
        if (!name.endsWith('.json') || !RESULT_HANDLE_PATTERN.test(name.slice(0, -5))) continue;
        const file = path.join(this.baseDir, name);
        try {
          if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
        } catch { /* raced with another process */ }
      }
    } catch { /* no directory yet, or unreadable — nothing to clean */ }
  }
}

// ── Process singleton ────────────────────────────────────────────────────────

let singleton = null;

/** The process-wide store; CRAWLFORGE_RESULTS_DIR overrides its directory. */
export function getResultStore() {
  if (!singleton) {
    singleton = new ResultStore({ baseDir: process.env.CRAWLFORGE_RESULTS_DIR || undefined });
  }
  return singleton;
}

/** Test seam: replace (or with null, reset) the singleton. */
export function setResultStoreForTests(store) {
  singleton = store;
}

export default ResultStore;

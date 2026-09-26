/**
 * ClearanceJar — a solved bot-wall challenge is not solved again for its lifetime.
 *
 * Stealth review Phase 4 (docs/STEALTH_REVIEW_2026-09.md). Every stealth
 * context used to start cold, so a Cloudflare or DataDome challenge the browser
 * had just passed was served again on the next call to the same site. The
 * vendors hand out a clearance cookie when a challenge passes; this keeps those
 * cookies and gives them back to the next stealth context that would present
 * the same identity.
 *
 * Three rules keep it honest:
 *
 * - **Only clearance cookies.** The allow-list below is the vendors' own
 *   clearance and bot-management cookies. Nothing a site sets for a login, a
 *   cart or a preference is ever kept, so a browser_session one caller logged
 *   into cannot leak its session into another caller's context — on the hosted
 *   instance those are different customers.
 * - **Keyed on who solved it.** cf_clearance is bound to the IP and the User
 *   Agent that earned it, and a TLS stack that is not the one that earned it is
 *   scored too. The key is the engine, the exact User-Agent and the proxy
 *   identity (server + username, never the password), so a clearance earned
 *   through one exit is never presented from another. A rotating proxy behind
 *   one fixed username can still change exit underneath a key; the vendor then
 *   challenges again, the verdict reports a block, and the host is discarded.
 * - **Bounded.** Expiry is the cookie's own, capped at MAX_TTL_MS; the jar
 *   holds at most MAX_KEYS identities and MAX_COOKIES_PER_KEY cookies each, and
 *   the file is rewritten only when its contents change.
 *
 * Persisted at ~/.crawlforge/stealth-clearance.json (mode 0600) so an MCP
 * server that a client restarts per session keeps its clearances.
 * CRAWLFORGE_CLEARANCE_JAR=off disables the jar entirely.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Cloudflare's clearance (cf_clearance) and bot-management (__cf_bm) cookies,
 * and DataDome's (datadome). Exact names: a prefix match would sweep in
 * whatever else a site happens to name alike.
 */
export const CLEARANCE_COOKIE_NAMES = new Set(['cf_clearance', '__cf_bm', 'datadome']);

/** No clearance outlives this, whatever expiry the vendor set. */
export const MAX_TTL_MS = 24 * 60 * 60 * 1000;
/** A session cookie (no expiry) is kept this long. */
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const MAX_KEYS = 32;
export const MAX_COOKIES_PER_KEY = 200;

const DEFAULT_FILE = path.join(os.homedir(), '.crawlforge', 'stealth-clearance.json');

/** Whether a cookie domain (".example.com" or "example.com") covers `host`. */
function domainCovers(domain, host) {
  const d = String(domain || '').replace(/^\./, '').toLowerCase();
  const h = String(host || '').toLowerCase();
  return Boolean(d) && (h === d || h.endsWith(`.${d}`));
}

export class ClearanceJar {
  /**
   * @param {{ file?: string|null, now?: () => number }} [options]
   *   file: where the jar persists; null keeps it in memory only.
   */
  constructor({ file = DEFAULT_FILE, now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    /** @type {Map<string, Map<string, object>>} key → (domain|path|name → cookie) */
    this.entries = null;
  }

  /**
   * The identity a clearance is bound to, or null when it cannot be named — an
   * unknown User-Agent cannot be matched, so nothing is stored or reused for it.
   *
   * @param {{ engine?: string|null, userAgent?: string|null, proxy?: {server?: string, username?: string}|null }} identity
   * @returns {string|null}
   */
  static keyFor({ engine, userAgent, proxy } = {}) {
    if (!engine || !userAgent) return null;
    const exit = proxy?.server ? `${proxy.server}|${proxy.username || ''}` : 'direct';
    // Hashed so the file names no proxy host, account or persona in clear.
    return crypto.createHash('sha256').update(`${engine}\n${userAgent}\n${exit}`).digest('hex');
  }

  /** Clearance cookies stored for `key` that have not expired, Playwright-shaped. */
  cookiesFor(key) {
    if (!key) return [];
    const bucket = this._load().get(key);
    if (!bucket) return [];
    const nowS = this.now() / 1000;
    const live = [...bucket.values()].filter((c) => c.expires > nowS);
    if (live.length !== bucket.size) {
      this._replace(key, live);
      this._save();
    }
    return live;
  }

  /**
   * Keep the clearance cookies from `cookies` (the output of
   * BrowserContext.cookies()) under `key`, replacing older copies.
   * @returns {number} how many clearance cookies were kept
   */
  store(key, cookies = []) {
    if (!key) return 0;
    const nowMs = this.now();
    const kept = [];
    for (const c of cookies) {
      if (!c || !CLEARANCE_COOKIE_NAMES.has(c.name) || !c.value || !c.domain) continue;
      const vendorExpiryMs = c.expires > 0 ? c.expires * 1000 : nowMs + SESSION_TTL_MS;
      const expiresMs = Math.min(vendorExpiryMs, nowMs + MAX_TTL_MS);
      if (expiresMs <= nowMs) continue;
      kept.push({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        expires: Math.floor(expiresMs / 1000),
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
        sameSite: c.sameSite || 'Lax'
      });
    }
    if (!kept.length) return 0;

    const entries = this._load();
    const bucket = entries.get(key) || new Map();
    let changed = false;
    for (const c of kept) {
      const id = `${c.domain}|${c.path}|${c.name}`;
      const old = bucket.get(id);
      if (old && old.value === c.value && old.expires === c.expires) continue;
      bucket.delete(id); // re-insert at the end: insertion order is recency
      bucket.set(id, c);
      changed = true;
    }
    if (!changed) return kept.length;
    while (bucket.size > MAX_COOKIES_PER_KEY) bucket.delete(bucket.keys().next().value);
    entries.delete(key);
    entries.set(key, bucket);
    while (entries.size > MAX_KEYS) entries.delete(entries.keys().next().value);
    this._save();
    return kept.length;
  }

  /**
   * Drop every clearance for `host` under `key` — called when a stealth render
   * still met the wall, so a clearance that no longer works is not replayed.
   * @returns {number} how many cookies were dropped
   */
  discard(key, host) {
    if (!key || !host) return 0;
    const bucket = this._load().get(key);
    if (!bucket) return 0;
    let dropped = 0;
    for (const [id, c] of bucket) {
      if (domainCovers(c.domain, host)) {
        bucket.delete(id);
        dropped++;
      }
    }
    if (dropped) {
      if (!bucket.size) this.entries.delete(key);
      this._save();
    }
    return dropped;
  }

  _replace(key, cookies) {
    const entries = this._load();
    if (!cookies.length) {
      entries.delete(key);
      return;
    }
    entries.set(key, new Map(cookies.map((c) => [`${c.domain}|${c.path}|${c.name}`, c])));
  }

  _load() {
    if (this.entries) return this.entries;
    this.entries = new Map();
    if (!this.file) return this.entries;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return this.entries; // absent or unreadable: start empty
    }
    const nowS = this.now() / 1000;
    for (const [key, cookies] of Object.entries(raw?.entries || {})) {
      if (!Array.isArray(cookies)) continue;
      const live = cookies.filter((c) => c && CLEARANCE_COOKIE_NAMES.has(c.name) && c.expires > nowS);
      if (live.length) this._replace(key, live.slice(-MAX_COOKIES_PER_KEY));
    }
    while (this.entries.size > MAX_KEYS) this.entries.delete(this.entries.keys().next().value);
    return this.entries;
  }

  _save() {
    if (!this.file) return;
    const out = { version: 1, entries: {} };
    for (const [key, bucket] of this.entries) out.entries[key] = [...bucket.values()];
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch {
      // Persistence is an optimisation: an unwritable home directory costs the
      // next process a challenge, not this call its result.
    }
  }
}

let shared;

/**
 * The process-wide jar, shared by every StealthBrowserManager (server.js,
 * BrowserProcessor and ResearchOrchestrator each construct their own), or null
 * when CRAWLFORGE_CLEARANCE_JAR=off.
 * @returns {ClearanceJar|null}
 */
export function sharedClearanceJar() {
  if (String(process.env.CRAWLFORGE_CLEARANCE_JAR || '').toLowerCase() === 'off') return null;
  shared ??= new ClearanceJar();
  return shared;
}

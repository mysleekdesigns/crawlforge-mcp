/**
 * Shared per-host outbound rate limiter (politeness / abuse protection).
 *
 * Throttles outbound scraping requests per target host so a single tool call
 * (batch_scrape, map_site, the basic fetch path, etc.) cannot hammer one origin.
 * Mirrors the per-domain limiter BFSCrawler already uses, driven by the shared
 * config so all paths agree on a default.
 *
 * Backwards-compatible: default 10 req/s + 100 req/min per host (the existing
 * effective behaviour), enabled by RATE_LIMIT_PER_DOMAIN (default true). Setting
 * RATE_LIMIT_PER_DOMAIN=false disables the throttle entirely — there is no global
 * cross-host cap, so broad multi-host crawls are never slowed by this.
 *
 * Two politeness signals the host itself sends are honoured on top of that
 * (ground rule G6 — load we impose is load someone pays for):
 *   - robots.txt `Crawl-delay`, passed in per request by the robots gate;
 *   - `Retry-After` on a 429/503, recorded by the fetch helpers so the *next*
 *     request to that host waits instead of retrying straight into the wall.
 * Both are host-scoped and survive RATE_LIMIT_PER_DOMAIN=false: an operator
 * turning off our own throttle is not a licence to ignore the site's.
 */
import { RateLimiter } from './rateLimiter.js';
import { config } from '../constants/config.js';

let _limiter = null;
function limiter() {
  if (!_limiter) {
    _limiter = new RateLimiter({
      requestsPerSecond: config.rateLimit.requestsPerSecond,
      requestsPerMinute: config.rateLimit.requestsPerMinute,
      perDomain: true,
    });
  }
  return _limiter;
}

/** host → { lastRequestAt, notBefore } */
const hostState = new Map();

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function stateFor(host) {
  let state = hostState.get(host);
  if (!state) {
    state = { lastRequestAt: 0, notBefore: 0 };
    hostState.set(host, state);
  }
  return state;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parse a `Retry-After` header into milliseconds.
 * Accepts delta-seconds ("2") and an HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT").
 * Returns 0 for anything unparseable, negative, or absent.
 * @param {string|null|undefined} value
 * @param {number} [now] epoch ms, for deterministic tests
 * @returns {number}
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;

  if (/^\d+$/.test(raw)) return parseInt(raw, 10) * 1000;

  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - now);

  return 0;
}

/**
 * Record a `Retry-After` the host asked for. Subsequent requests to that host
 * wait it out. Capped at 5 minutes so a hostile or mistaken header cannot pin a
 * worker indefinitely.
 * @param {string} url
 * @param {string|null|undefined} retryAfterHeader
 * @returns {number} the backoff applied, in ms (0 if none)
 */
export function noteRetryAfter(url, retryAfterHeader) {
  const host = hostOf(url);
  if (!host) return 0;

  const delayMs = Math.min(parseRetryAfter(retryAfterHeader), 5 * 60 * 1000);
  if (delayMs <= 0) return 0;

  const state = stateFor(host);
  state.notBefore = Math.max(state.notBefore, Date.now() + delayMs);
  return delayMs;
}

/** Remaining backoff for a host in ms (0 if none). Diagnostic/test hook. */
export function getHostBackoffMs(url) {
  const host = hostOf(url);
  if (!host) return 0;
  const state = hostState.get(host);
  return state ? Math.max(0, state.notBefore - Date.now()) : 0;
}

/**
 * Wait (if necessary) until another request to this URL's host is allowed.
 * Never throws — a limiter failure must not block a legitimate fetch.
 * @param {string} url
 * @param {{ crawlDelayMs?: number }} [options] `crawlDelayMs` from robots.txt
 */
export async function throttleHost(url, options = {}) {
  const host = hostOf(url);
  const crawlDelayMs = Number(options.crawlDelayMs) > 0 ? Number(options.crawlDelayMs) : 0;

  if (host) {
    const state = stateFor(host);

    // The host's own signals, honoured whether or not our throttle is enabled.
    const waits = [];
    if (state.notBefore > Date.now()) waits.push(state.notBefore - Date.now());
    if (crawlDelayMs > 0 && state.lastRequestAt > 0) {
      waits.push(state.lastRequestAt + crawlDelayMs - Date.now());
    }
    const wait = Math.max(0, ...waits);
    if (wait > 0) await sleep(wait);

    state.lastRequestAt = Date.now();
  }

  if (config.rateLimit.perDomain === false) return; // our own throttle disabled
  try {
    await limiter().checkLimit(url);
  } catch {
    /* never block a fetch on a limiter error */
  }
}

/** Test/diagnostic hook. */
export function _resetHostRateLimiter() {
  _limiter = null;
  hostState.clear();
}

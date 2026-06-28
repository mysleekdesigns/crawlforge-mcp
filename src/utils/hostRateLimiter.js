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

/**
 * Wait (if necessary) until another request to this URL's host is allowed.
 * Never throws — a limiter failure must not block a legitimate fetch.
 * @param {string} url
 */
export async function throttleHost(url) {
  if (config.rateLimit.perDomain === false) return; // feature disabled
  try {
    await limiter().checkLimit(url);
  } catch {
    /* never block a fetch on a limiter error */
  }
}

/** Test/diagnostic hook. */
export function _resetHostRateLimiter() {
  _limiter = null;
}

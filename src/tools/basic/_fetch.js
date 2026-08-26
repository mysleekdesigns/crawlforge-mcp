/**
 * Shared HTTP fetch helper for basic tools.
 * Applies an AbortController timeout and a default User-Agent.
 */

import { readBody } from 'crawlforge-extractors';
import { config } from '../../constants/config.js';
import { createRequire } from 'module';
import { ssrfGuard, isSsrfError } from '../../utils/ssrfGuard.js';
import { throttleHost } from '../../utils/hostRateLimiter.js';

// Derive User-Agent from package version so it reflects the actual release.
const _require = createRequire(import.meta.url);
const _pkg = _require('../../../package.json');
const CRAWLFORGE_UA = `CrawlForge/${_pkg.version} (+https://crawlforge.dev)`;

/**
 * Fetch a URL with a configurable timeout and body-size cap.
 *
 * Content-Length is checked before the body is read; if absent or lying, the
 * accumulated byte count is checked during streaming.  Both checks use the
 * configurable cap from config.fetch.maxBodySize (env MAX_FETCH_BODY_SIZE,
 * default 25 MB).
 *
 * @param {string} url
 * @param {{ timeout?: number, headers?: Record<string,string> }} [options]
 * @returns {Promise<Response & { _body: string }>}
 */
export async function fetchWithTimeout(url, options = {}) {
  const { timeout = 10000, headers = {} } = options;
  const maxBodySize = config.fetch.maxBodySize;

  // SSRF pre-flight (protocol / metadata host). Throws a clear error before any
  // connection is attempted; `guard.dispatcher` enforces IP rules at connect time.
  const guard = ssrfGuard(url);

  // Per-host politeness throttle (before the timeout window starts).
  await throttleHost(url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Started after the politeness throttle so the figure is the target's
  // latency and not our own waiting — a monitor polling one host repeatedly
  // would otherwise read its own throttle delay as the site being slow.
  const startedAt = Date.now();

  // The timeout must stay armed for the entire body read, not just until
  // headers arrive — a stalled/trickling body (slowloris, hung proxy) would
  // otherwise hang the awaiting reader.read() forever. clearTimeout runs in
  // this finally, after the body has been fully consumed (or an error has
  // already ended the request), and any abort() during that window rejects
  // the in-flight reader.read() with an AbortError, which we map below.
  try {
    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': CRAWLFORGE_UA,
          ...headers
        },
        ...guard
      });
    } catch (error) {
      if (isSsrfError(error)) {
        throw new Error(error.cause?.message || error.message);
      }
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }

    // Reading is delegated to crawlforge-extractors so the REST API applies
    // the same cap and the same charset handling to the same page.
    let bodyText;
    try {
      bodyText = await readBody(response, { maxBytes: maxBodySize });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }

    // Attach the pre-read text so callers can call .text() on the result.
    return Object.assign(response, {
      text: () => Promise.resolve(bodyText),
      json: () => Promise.resolve(JSON.parse(bodyText)),
      _body: bodyText,
      _responseTime: Date.now() - startedAt
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

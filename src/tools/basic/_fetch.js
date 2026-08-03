/**
 * Shared HTTP fetch helper for basic tools.
 * Applies an AbortController timeout and a default User-Agent.
 */

import { config } from '../../constants/config.js';
import { createRequire } from 'module';
import { ssrfGuard, isSsrfError } from '../../utils/ssrfGuard.js';
import { throttleHost } from '../../utils/hostRateLimiter.js';

// Derive User-Agent from package version so it reflects the actual release.
const _require = createRequire(import.meta.url);
const _pkg = _require('../../../package.json');
const CRAWLFORGE_UA = `CrawlForge/${_pkg.version} (+https://crawlforge.dev)`;

/**
 * Determine the charset to decode a response body with: Content-Type header
 * first, then a <meta charset> sniff of the first bytes, defaulting to utf-8.
 * @param {Response} response
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function detectCharset(response, bytes) {
  const contentType = response.headers?.get?.('content-type') || '';
  const headerMatch = /charset=["']?([\w-]+)/i.exec(contentType);
  if (headerMatch) {
    return headerMatch[1].trim().toLowerCase();
  }

  // <meta charset> tags must appear within the first 1024 bytes per the
  // HTML5 spec's prescan algorithm; ASCII-range bytes decode identically
  // under latin1 regardless of the document's real encoding.
  const sniffLength = Math.min(bytes.byteLength, 1024);
  const sniffText = new TextDecoder('latin1').decode(bytes.subarray(0, sniffLength));
  const metaMatch =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniffText) ||
    /<meta[^>]+http-equiv=["']?content-type["']?[^>]*content=["'][^"']*charset=([\w-]+)/i.exec(sniffText);
  if (metaMatch) {
    return metaMatch[1].trim().toLowerCase();
  }

  return 'utf-8';
}

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

    // --- Body-size cap ---

    // Early rejection via Content-Length (servers may omit or lie — guard below
    // handles that case). Optional-chained so non-standard responses (e.g. test
    // mocks) without a Headers object don't throw.
    const contentLengthHeader = response.headers?.get?.('content-length') ?? null;
    if (contentLengthHeader !== null) {
      const declared = parseInt(contentLengthHeader, 10);
      if (!isNaN(declared) && declared > maxBodySize) {
        throw new Error(
          `Response body too large: Content-Length ${declared} exceeds limit of ${maxBodySize} bytes`
        );
      }
    }

    // Only the streaming byte-count guard requires a readable body. Responses
    // without a ReadableStream body (already-buffered responses, test mocks)
    // are returned unchanged so callers' native .text()/.json() still work.
    if (!response.body || typeof response.body.getReader !== 'function') {
      return response;
    }

    // Stream the body and abort if accumulated bytes exceed the cap.
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBodySize) {
          reader.cancel();
          throw new Error(
            `Response body too large: exceeded limit of ${maxBodySize} bytes`
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }

    // Reassemble the raw bytes in a single pass (totalBytes is already known,
    // so this is one allocation + one copy per chunk, not the O(n^2) cost of
    // reallocating/copying the whole buffer on every chunk), then decode using
    // the response's actual charset (Content-Type header, falling back to a
    // <meta charset> sniff) instead of always assuming UTF-8.
    const mergedBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      mergedBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const charset = detectCharset(response, mergedBytes);
    let bodyText;
    try {
      bodyText = new TextDecoder(charset).decode(mergedBytes);
    } catch {
      // Unrecognized charset label — fall back to UTF-8 rather than throwing.
      bodyText = new TextDecoder().decode(mergedBytes);
    }

    // Attach the pre-read text so callers can call .text() on the result.
    // We wrap it in a minimal compatible object.
    return Object.assign(response, {
      text: () => Promise.resolve(bodyText),
      json: () => Promise.resolve(JSON.parse(bodyText)),
      _body: bodyText
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

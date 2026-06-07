/**
 * Shared HTTP fetch helper for basic tools.
 * Applies an AbortController timeout and a default User-Agent.
 */

import { config } from '../../constants/config.js';
import { createRequire } from 'module';

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': CRAWLFORGE_UA,
        ...headers
      }
    });
    clearTimeout(timeoutId);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }

  // --- Body-size cap ---

  // Early rejection via Content-Length (servers may omit or lie — guard below
  // handles that case).
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const declared = parseInt(contentLengthHeader, 10);
    if (!isNaN(declared) && declared > maxBodySize) {
      throw new Error(
        `Response body too large: Content-Length ${declared} exceeds limit of ${maxBodySize} bytes`
      );
    }
  }

  // Stream the body and abort if accumulated bytes exceed the cap.
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

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

  // Reassemble and expose as a response-like object that callers can use.
  const bodyText = new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const merged = new Uint8Array(acc.byteLength + chunk.byteLength);
      merged.set(acc, 0);
      merged.set(chunk, acc.byteLength);
      return merged;
    }, new Uint8Array(0))
  );

  // Attach the pre-read text so callers can call .text() on the result.
  // We wrap it in a minimal compatible object.
  return Object.assign(response, {
    text: () => Promise.resolve(bodyText),
    json: () => Promise.resolve(JSON.parse(bodyText)),
    _body: bodyText
  });
}

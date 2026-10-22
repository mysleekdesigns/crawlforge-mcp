/**
 * pageCache — one copy of each fetched page per process, shared by the two
 * fetch seams (REPEAT_CALL_REDUCTION_PLAN Phase 1).
 *
 * fetchWithTimeout (fetch_url, extract_metadata, scrape_structured,
 * extract_text, extract_links) and fetchAndParse (scrape,
 * extract_embedded_state, extract_structured, extract_with_llm, agent) both go
 * through throughPageCache, so asking for the same page again with other
 * formats, paths or selectors reuses the first fetch. What is kept is the
 * response (status, final URL, headers, body), never a tool's output.
 *
 * Bounded by bytes, least recently used first out (CRAWLFORGE_PAGE_CACHE_MB,
 * default 64; 0 turns it off). Memory only. A copy is served while it is
 * younger than `maxAge` (default 10 min, D2); `maxAge: 0` fetches fresh and
 * stores the result, `noCache: true` neither reads nor writes.
 *
 * Off on the hosted HTTP server and for internal (REST-proxy) requests until
 * tenant isolation lands (D3), and off under NODE_ENV=test unless a test turns
 * it on with _resetPageCache({ enabled: true }) (likewise inside node --test).
 */

import { createHash } from 'node:crypto';
import { canonicalUrl } from '../utils/canonicalUrl.js';
import { config } from '../constants/config.js';
import { preflightDecision } from '../utils/robotsGate.js';
import { plainVerdict } from '../tools/basic/_targetFailure.js';
import { isInternalRequest, recordPageCache } from '../server/requestContext.js';

export const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_CACHE_MB = 64;
// A bot wall is tens of KB. Larger bodies skip the verdict's second parse.
const VERDICT_MAX_BYTES = 1024 * 1024;
// Requests that carry a credential are never served from or stored in the cache.
const CREDENTIAL_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);

/** key -> entry, least recently used first */
const entries = new Map();
/** in-flight key -> Promise<{ result, page, entry }> */
const inflight = new Map();
let totalBytes = 0;
let testOverride = null;

function maxBytes() {
  if (testOverride?.maxBytes != null) return testOverride.maxBytes;
  const raw = process.env.CRAWLFORGE_PAGE_CACHE_MB;
  const mb = raw === undefined || raw === '' ? DEFAULT_CACHE_MB : Number(raw);
  return (Number.isFinite(mb) && mb >= 0 ? mb : DEFAULT_CACHE_MB) * 1024 * 1024;
}

/** Whether this process and this request may use the cache at all. */
export function pageCacheActive() {
  // node --test marks its test processes with NODE_TEST_CONTEXT.
  const underTest = process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT !== undefined;
  if (underTest && !testOverride?.enabled) return false;
  if (process.argv.includes('--http') || process.env.MCP_HTTP === 'true') return false;
  if (isInternalRequest()) return false;
  return maxBytes() > 0;
}

/**
 * The fetch, canonicalised: URL, method, robots setting, identity, the
 * caller's headers and API key, and which seam asked (the two send different
 * Accept headers). Hashed, so no header value or key is kept in memory as a
 * key. Null when the request must not touch the cache.
 */
export function pageCacheKey(url, options, variant) {
  const canonical = canonicalUrl(url);
  if (!canonical) return null;
  if (options.method && String(options.method).toUpperCase() !== 'GET') return null;
  const headers = Object.entries(options.headers || {})
    .map(([name, value]) => [name.toLowerCase(), String(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (headers.some(([name]) => CREDENTIAL_HEADERS.has(name))) return null;
  const respect = options.respectRobots === undefined
    ? config.crawling.respectRobots
    : options.respectRobots !== false;
  const userAgent = typeof options.userAgent === 'string' ? options.userAgent.trim() || null : null;
  return createHash('sha256')
    .update(JSON.stringify([variant, 'GET', canonical, respect, userAgent, headers, options.apiKey ?? null]))
    .digest('hex');
}

/** The status, final URL, headers and body of a fetched response, as stored. */
export function pageFromResponse(response, body) {
  const headers = [];
  if (typeof response.headers?.forEach === 'function') {
    response.headers.forEach((value, name) => headers.push([name.toLowerCase(), value]));
  } else {
    // A headers object with only get() (test doubles): keep what the seams read.
    for (const name of ['content-type', 'cache-control']) {
      const value = response.headers?.get?.(name);
      if (value != null) headers.push([name, value]);
    }
  }
  return {
    status: response.status,
    statusText: response.statusText ?? '',
    url: response.url,
    redirected: response.redirected === true,
    headers,
    body,
    fetchedAt: Date.now()
  };
}

export function pageHeader(page, name) {
  return page.headers.find(([key]) => key === name)?.[1] ?? null;
}

/** 2xx, storable, and not a bot wall (the same verdict extract_text applies). */
function cacheable(page) {
  if (!(page.status >= 200 && page.status <= 299) || typeof page.body !== 'string') return false;
  if (/\bno-store\b/i.test(pageHeader(page, 'cache-control') ?? '')) return false;
  if (Buffer.byteLength(page.body) <= VERDICT_MAX_BYTES) {
    const verdict = plainVerdict(
      { status: page.status, url: page.url, _body: page.body, headers: new Headers(page.headers) },
      page.url
    );
    if (verdict?.blocked) return false;
  }
  return true;
}

function store(key, page) {
  if (!cacheable(page)) return null;
  const entry = {
    status: page.status,
    statusText: page.statusText,
    url: page.url,
    redirected: page.redirected,
    headers: page.headers,
    body: page.body,
    responseTime: page.responseTime,
    fetchedAt: page.fetchedAt
  };
  entry.bytes = Buffer.byteLength(entry.body) + Buffer.byteLength(JSON.stringify(entry.headers)) + (entry.url?.length ?? 0);
  const cap = maxBytes();
  if (entry.bytes > cap) return null;
  drop(key);
  entries.set(key, entry);
  totalBytes += entry.bytes;
  for (const [oldKey] of entries) {
    if (totalBytes <= cap) break;
    drop(oldKey);
  }
  return entry;
}

function drop(key) {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  totalBytes -= entry.bytes;
}

function lookup(key, maxAge) {
  const entry = entries.get(key);
  if (!entry || Date.now() - entry.fetchedAt > maxAge) return null;
  entries.delete(key);
  entries.set(key, entry); // most recently used
  return entry;
}

/**
 * fetchAndParse asks for HTML (Accept: text/html…); fetchWithTimeout sends no
 * Accept. A server that answered "any type" with HTML has an HTML variant, so
 * a request preferring HTML gets the same: that copy serves fetchAndParse. The
 * other direction is not safe (an API may answer `*\/*` with JSON).
 */
function lookupHtmlFromPlain(url, options, maxAge) {
  const entry = lookup(pageCacheKey(url, options, 'plain'), maxAge);
  const type = (entry && pageHeader(entry, 'content-type')) || '';
  return /^\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(type) ? entry : null;
}

async function serveHit(url, options, entry, fromEntry) {
  // The blocklist and robots.txt are asked again; only the request is skipped.
  const decision = await preflightDecision(url, options);
  if (entry.redirected && entry.url) await preflightDecision(entry.url, options, { redirectedFrom: url });
  recordPageCache('hit', entry.fetchedAt);
  return fromEntry(entry, decision.warnings);
}

/**
 * Serve a page from the cache, or fetch it once and keep it.
 *
 * @param {string} url
 * @param {{ maxAge?: number, noCache?: boolean, headers?: object, userAgent?: string,
 *   respectRobots?: boolean, apiKey?: string, method?: string, errorDocuments?: boolean }} options
 * @param {'plain'|'html'} variant the seam asking
 * @param {() => Promise<{ result: any, page: object }>} fetchFresh the seam's
 *   own fetch: its usual return value plus the page as pageFromResponse gives it
 * @param {(entry: object, warnings: string[]) => any} fromEntry the seam's
 *   return value built from a stored page
 */
export async function throughPageCache(url, options, variant, fetchFresh, fromEntry) {
  if (!pageCacheActive()) return (await fetchFresh()).result;

  const key = options.noCache === true ? null : pageCacheKey(url, options, variant);
  if (key === null) {
    const { result, page } = await fetchFresh();
    recordPageCache('bypass', page?.fetchedAt);
    return result;
  }

  const maxAge = Number.isFinite(options.maxAge) && options.maxAge >= 0 ? options.maxAge : DEFAULT_MAX_AGE_MS;
  // A caller that reads error bodies (errorDocuments) must not inherit the
  // throw of one that does not, so the two never share an in-flight fetch.
  const flightKey = options.errorDocuments ? `${key}:errors` : key;

  if (maxAge > 0) {
    const entry = lookup(key, maxAge) ?? (variant === 'html' ? lookupHtmlFromPlain(url, options, maxAge) : null);
    if (entry) return serveHit(url, options, entry, fromEntry);
    const pending = inflight.get(flightKey);
    if (pending) {
      // A failed fetch rejects every caller waiting on it; nothing is stored.
      const shared = await pending;
      if (shared.entry) return serveHit(url, options, shared.entry, fromEntry);
      // Not storable (non-2xx, a wall): this call makes its own request.
    }
  }

  const run = fetchFresh().then(({ result, page }) => ({ result, page, entry: page ? store(key, page) : null }));
  if (!inflight.has(flightKey)) inflight.set(flightKey, run);
  try {
    const { result, page } = await run;
    recordPageCache(maxAge > 0 ? 'miss' : 'bypass', page?.fetchedAt);
    return result;
  } finally {
    if (inflight.get(flightKey) === run) inflight.delete(flightKey);
  }
}

/** Bytes currently held (for tests and diagnostics). */
export function pageCacheBytes() {
  return totalBytes;
}

/**
 * Empty the cache. Tests pass `{ enabled: true }` to turn it on under
 * NODE_ENV=test or node --test, optionally with a small `maxBytes`; no argument restores the
 * defaults.
 */
export function _resetPageCache(override = null) {
  entries.clear();
  inflight.clear();
  totalBytes = 0;
  testOverride = override;
}

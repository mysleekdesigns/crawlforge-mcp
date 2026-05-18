/**
 * _sessionContext.js
 *
 * Lightweight in-memory cookie jar for crawl session reuse.
 * Zero external runtime dependencies — Set-Cookie headers are parsed
 * with a minimal hand-rolled implementation that handles the attributes
 * needed for a single-host crawl session (name, value, path, domain,
 * secure, httponly, max-age, expires).
 *
 * Rationale for not using set-cookie-parser / tough-cookie:
 *   - We only need same-origin cookie persistence within one crawl run.
 *   - The crawl never spans multiple registered domains in a way that
 *     requires full RFC 6265 compliance (partitioned jars, public suffix
 *     list, etc.).
 *   - Keeping zero new runtime deps satisfies the project constraint.
 */

/**
 * Parse a single Set-Cookie header value into a cookie object.
 * Returns null if the header is empty or unparseable.
 *
 * @param {string} header - Raw Set-Cookie header value
 * @param {string} requestUrl - URL that issued the Set-Cookie response
 * @returns {{ name: string, value: string, domain: string, path: string,
 *             secure: boolean, expires: number|null }|null}
 */
function parseSetCookie(header, requestUrl) {
  if (!header) return null;

  const parts = header.split(';').map(s => s.trim());
  if (parts.length === 0 || !parts[0].includes('=')) return null;

  const eqIdx = parts[0].indexOf('=');
  const name = parts[0].slice(0, eqIdx).trim();
  const value = parts[0].slice(eqIdx + 1).trim();
  if (!name) return null;

  let requestUrlObj;
  try {
    requestUrlObj = new URL(requestUrl);
  } catch {
    return null;
  }

  // Defaults derived from the request URL
  let domain = requestUrlObj.hostname;
  let path = '/';
  let secure = false;
  let expires = null; // null = session cookie (lives until crawl ends)

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const lower = part.toLowerCase();

    if (lower.startsWith('domain=')) {
      // Strip leading dot — we do exact hostname matching
      domain = part.slice('domain='.length).trim().replace(/^\./, '');
    } else if (lower.startsWith('path=')) {
      path = part.slice('path='.length).trim() || '/';
    } else if (lower === 'secure') {
      secure = true;
    } else if (lower.startsWith('max-age=')) {
      const maxAge = parseInt(part.slice('max-age='.length), 10);
      if (!isNaN(maxAge)) {
        expires = maxAge <= 0 ? 0 : Date.now() + maxAge * 1000;
      }
    } else if (lower.startsWith('expires=')) {
      const dateStr = part.slice('expires='.length).trim();
      const ts = Date.parse(dateStr);
      if (!isNaN(ts) && expires === null) {
        // max-age takes precedence over expires
        expires = ts;
      }
    }
    // httponly is intentionally ignored — not relevant for a server-side crawler
  }

  return { name, value, domain, path, secure, expires };
}

/**
 * Determine whether a stored cookie should be sent for the given URL.
 *
 * @param {object} cookie - Stored cookie object
 * @param {URL} urlObj - Parsed URL of the outgoing request
 * @returns {boolean}
 */
function cookieMatchesUrl(cookie, urlObj) {
  // Honour expiry
  if (cookie.expires !== null && Date.now() > cookie.expires) return false;

  // Domain: exact match or subdomain match (cookie.domain is already dot-stripped)
  const host = urlObj.hostname;
  if (host !== cookie.domain && !host.endsWith('.' + cookie.domain)) return false;

  // Secure flag
  if (cookie.secure && urlObj.protocol !== 'https:') return false;

  // Path: request path must start with cookie path
  const reqPath = urlObj.pathname || '/';
  if (!reqPath.startsWith(cookie.path)) return false;

  return true;
}

/**
 * SessionContext — holds the shared cookie jar and custom headers for one
 * crawl session. Passed into BFSCrawler so every page fetch participates
 * in the same session.
 */
export class SessionContext {
  /**
   * @param {object} [options]
   * @param {boolean} [options.persistCookies=true]
   * @param {Record<string,string>} [options.headers={}]
   */
  constructor(options = {}) {
    this.persistCookies = options.persistCookies !== false; // default true
    this.headers = options.headers || {};
    /** @type {Array<{name,value,domain,path,secure,expires}>} */
    this._jar = [];
  }

  /**
   * Record cookies from a fetch Response.
   * Handles the `set-cookie` header (Node fetch returns it as a single
   * string value; actual multi-cookie responses are represented as multiple
   * headers which the Headers API coalesces with ', ' for some values — we
   * deal with raw strings from getSetCookie() when available).
   *
   * @param {Response} response - Native fetch Response
   * @param {string} requestUrl - URL the response came from
   */
  recordCookies(response, requestUrl) {
    if (!this.persistCookies) return;

    // Node 18+ exposes `getSetCookie()` which returns an array, one per header
    const rawHeaders = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);

    for (const raw of rawHeaders) {
      const cookie = parseSetCookie(raw, requestUrl);
      if (!cookie) continue;
      // Upsert: replace any existing cookie with same name+domain+path
      const idx = this._jar.findIndex(
        c => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path
      );
      if (cookie.expires !== null && Date.now() > cookie.expires) {
        // Explicit deletion (max-age=0 or past expires)
        if (idx !== -1) this._jar.splice(idx, 1);
      } else if (idx !== -1) {
        this._jar[idx] = cookie;
      } else {
        this._jar.push(cookie);
      }
    }
  }

  /**
   * Build the `Cookie` header string for outgoing requests to the given URL.
   *
   * @param {string} url
   * @returns {string} Cookie header value, or empty string
   */
  getCookieHeader(url) {
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch {
      return '';
    }

    const matching = this._jar.filter(c => cookieMatchesUrl(c, urlObj));
    return matching.map(c => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Merge session headers + cookie header into a headers object.
   * The caller's own headers take priority over session headers.
   *
   * @param {string} url
   * @param {Record<string,string>} baseHeaders - Headers already built by the caller
   * @returns {Record<string,string>}
   */
  applyToHeaders(url, baseHeaders) {
    const merged = { ...this.headers, ...baseHeaders };
    const cookieHeader = this.getCookieHeader(url);
    if (cookieHeader) {
      // Append to any existing Cookie header rather than clobber
      const existing = merged['Cookie'] || merged['cookie'] || '';
      merged['Cookie'] = existing ? `${existing}; ${cookieHeader}` : cookieHeader;
    }
    return merged;
  }

  /**
   * Perform an optional "initial request" (e.g. a login POST) and capture
   * any cookies it sets into the jar. Returns the response body text.
   *
   * @param {{ url: string, method?: string, headers?: Record<string,string>, body?: string }} req
   * @returns {Promise<{ status: number, body: string }>}
   */
  async performInitialRequest(req) {
    const { url, method = 'GET', headers: extraHeaders = {}, body } = req;

    const requestHeaders = this.applyToHeaders(url, {
      'User-Agent': 'MCP-WebScraper/1.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...extraHeaders
    });

    const fetchOpts = {
      method,
      headers: requestHeaders,
      redirect: 'follow'
    };

    if (body) {
      fetchOpts.body = body;
    }

    const response = await fetch(url, fetchOpts);
    this.recordCookies(response, url);

    const text = await response.text().catch(() => '');
    return { status: response.status, body: text };
  }

  /** Number of cookies currently held in the jar (for diagnostics). */
  get cookieCount() {
    return this._jar.length;
  }
}

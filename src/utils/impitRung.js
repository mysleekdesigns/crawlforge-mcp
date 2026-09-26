/**
 * impitRung.js — the browser-TLS HTTP try inside the escalation stage
 * (stealth review Phase 7).
 *
 * Some walls refuse Node's TLS handshake whatever the headers and accept a
 * Chrome one: quora.com passed 0/4 over Node TLS and 4/4 over impit's Chrome
 * profile (residential spike, 2026-09-26). impit makes that request without
 * launching a browser, so the escalation stage tries it first and runs the
 * browser only when it does not get the page.
 *
 * Owner decisions this module keeps (docs/STEALTH_REVIEW_2026-09.md, Phase 7):
 * - It runs only inside escalation, whose callers already opted into a browser
 *   identity. The plain fetch never uses it.
 * - The User-Agent stays the honest CrawlForge one; only the TLS handshake and
 *   impit's profile headers are Chrome's. indeed.com passed 3/4 that way and
 *   0/4 with a Chrome UA.
 * - The price is escalation's own (2 + 5), whichever step got the page.
 *
 * impit is an optional dependency with native bindings. When it is missing or
 * fails to load, `loadImpit()` resolves to null and escalation runs the
 * browser exactly as before.
 *
 * impit resolves DNS itself, outside the undici dispatcher ssrfGuard installs,
 * so redirects are followed here, one hop at a time, and every hop is checked
 * with DNS resolution — the same check safeGoto applies to a navigation.
 */

import { load } from 'cheerio';
import { readBody } from 'crawlforge-extractors';
import { resolveUserAgent } from './fetchIdentity.js';
import { assertUrlAllowed } from './ssrfGuard.js';
import { stealthDocumentVerdict } from './stealthVerdict.js';
import { config, serverStealthProxies } from '../constants/config.js';

/** The engine name escalation reports when this step got the page. */
export const IMPIT_ENGINE = 'impit';

const IMPIT_BROWSER = 'chrome151';
const IMPIT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

// impit reads the HTML the server sent; it runs no JavaScript. quora.com
// passed the verdict through it with a normal title over 59 characters of
// "Something went wrong. Wait a moment and try again." — the client app's
// fallback, not the page (measured 2026-09-26). The browser renders the
// real page, so a document this thin goes to the browser instead.
const MIN_UNRENDERED_TEXT_CHARS = 200;

let impitClass; // undefined: not tried yet; null: unavailable

/**
 * The Impit class, or null when the optional dependency is absent or its
 * native bindings do not load on this platform. Tried once per process.
 * @returns {Promise<Function|null>}
 */
export async function loadImpit() {
  if (impitClass === undefined) {
    try {
      const mod = await import('impit');
      impitClass = mod.Impit ?? mod.default?.Impit ?? null;
    } catch {
      impitClass = null;
    }
  }
  return impitClass;
}

/**
 * Fetch `url` over a Chrome TLS handshake with the honest User-Agent and
 * return the page when it passes the document verdict, or null when it does
 * not (a wall, an error page, an empty shell) or the request failed. A null
 * means "run the browser"; this function never throws for a failed fetch.
 *
 * An SSRF refusal on any hop DOES throw: the browser would be refused the same
 * URL, so falling through to it would only fail slower.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {Function} [options.Impit] the client class (tests inject a fake)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ html: string, text: string, title: string, url: string, status: number, engine: string } | null>}
 */
export async function impitFetchPage(url, { Impit, timeoutMs = IMPIT_TIMEOUT_MS } = {}) {
  const ImpitClass = Impit ?? await loadImpit();
  if (!ImpitClass) return null;

  // The operator's exit address, as the browser would use: a wall that has
  // seen the server's own IP should not see it again from this step.
  const proxyUrl = serverStealthProxies()[0];
  const client = new ImpitClass({
    browser: IMPIT_BROWSER,
    headers: { 'user-agent': resolveUserAgent() },
    followRedirects: false,
    timeout: timeoutMs,
    ...(proxyUrl ? { proxyUrl } : {})
  });

  const deadline = Date.now() + timeoutMs;
  let current = url;
  let response;
  for (let hop = 0; ; hop++) {
    await assertUrlAllowed(current, { resolveDns: true });
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    try {
      response = await client.fetch(current, { timeout: remaining });
    } catch {
      return null;
    }
    const location = response.status >= 300 && response.status < 400 ? response.headers?.get?.('location') : null;
    if (!location) break;
    if (hop >= MAX_REDIRECTS) return null;
    try {
      current = new URL(location, current).href;
    } catch {
      return null;
    }
    if (!/^https?:\/\//i.test(current)) return null;
  }

  let html;
  try {
    html = await readBody(response, { maxBytes: config.fetch.maxBodySize });
  } catch {
    return null;
  }

  const $ = load(html);
  const title = $('title').first().text().trim();
  $('script, style, noscript, template').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const verdict = stealthDocumentVerdict(
    { url: current, title, text, html, status: response.status },
    { fetcher: 'impit', rendered: false, contentReturned: false }
  );
  if (!verdict.success || text.length < MIN_UNRENDERED_TEXT_CHARS) return null;

  return { html, text, title, url: current, status: response.status, engine: IMPIT_ENGINE };
}

/** Test hook: forget whether impit loaded. */
export function _resetImpitLoader() {
  impitClass = undefined;
}

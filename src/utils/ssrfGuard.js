/**
 * SSRF guard for the live outbound fetch path.
 *
 * This wires the (previously unused) SSRF protections into the actual scraping
 * fetch helpers. Enforcement happens at TCP connect time via a custom undici
 * connector, so it covers the initial request, every redirect hop (including
 * hops that land on a bare IP literal, which Node's `net.connect` never hands
 * to a `lookup` callback), and closes the DNS-rebinding window (the validated
 * IP is the one connected to — there is no second, unchecked resolution).
 *
 * Two levels:
 *  - Stage 1 (default): blocks connections to loopback, link-local /
 *    cloud-metadata (169.254.0.0/16, incl. 169.254.169.254), and 0.0.0.0.
 *    These are never legitimate public-scrape targets, so impact is ~zero.
 *  - Stage 2 (SSRF_STRICT=true): full private-range enforcement (RFC1918, ULA,
 *    multicast, CGNAT, etc.) via the existing SSRFProtection range logic.
 *
 * IP-literal hostnames (loopback/metadata expressed as dotted-quad, decimal,
 * hex, or IPv4-mapped/compatible IPv6 such as `::ffff:127.0.0.1`) are checked
 * directly against the same rules — DNS resolution is not the only path in.
 *
 * Controls (backwards-compatible defaults):
 *  - SSRF_PROTECTION_ENABLED=false  -> disable the guard entirely (kill switch).
 *  - ALLOWED_DOMAINS=a.com,b.com    -> bypass the guard for trusted hosts
 *    (e.g. a local dev server at localhost). Matches host or any subdomain.
 *    Checked fresh for every hop (initial request and each redirect), so an
 *    allowlisted first hop does not unguard a subsequent hop to a different,
 *    non-allowlisted host.
 *  - BLOCKED_DOMAINS=a.com,b.com    -> extra hostname denylist (host or
 *    subdomain match), checked at pre-flight alongside the IP-literal checks.
 *  - SSRF_STRICT=true               -> Stage 2 full enforcement.
 */
import dns from 'node:dns';
import net from 'node:net';
import { Agent, buildConnector } from 'undici';
import { config } from '../constants/config.js';
import { SSRFProtection } from './ssrfProtection.js';
import { fetchResigned } from './resignedFetch.js';

// Reused only for its (well-tested) CIDR range math — no network state.
const _ssrf = new SSRFProtection();

// Narrow Stage-1 ranges: things no legitimate public scrape ever targets.
const STAGE1_RANGES = ['127.0.0.0/8', '169.254.0.0/16', '0.0.0.0/8', '::1/128', 'fe80::/10'];

// Literal cloud-metadata / service-discovery hostnames blocked even before DNS.
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.azure.com', 'metadata']);

function strictMode() {
  return process.env.SSRF_STRICT === 'true';
}

function stripBrackets(host) {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * Extracts the embedded IPv4 address from an IPv4-mapped/compatible IPv6
 * literal (e.g. `::ffff:127.0.0.1` or its fully-expanded hex-group form
 * `0:0:0:0:0:ffff:7f00:1`), returning null if `ip` isn't one of those forms.
 * @param {string} ip
 * @returns {string|null}
 */
function extractMappedIPv4(ip) {
  let s = ip.toLowerCase().split('%')[0]; // drop a zone id, if present

  // A dotted-quad tail (e.g. "::ffff:127.0.0.1") -> two hex groups, so the
  // rest of this function only has to deal with one address shape.
  const dottedTail = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedTail) {
    const quad = dottedTail[2].split('.').map(Number);
    if (quad.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    const hi = ((quad[0] << 8) | quad[1]).toString(16);
    const lo = ((quad[2] << 8) | quad[3]).toString(16);
    s = `${dottedTail[1]}${hi}:${lo}`;
  }

  let groups;
  if (s.includes('::')) {
    const [left, right] = s.split('::');
    const leftParts = left ? left.split(':').filter(Boolean) : [];
    const rightParts = right ? right.split(':').filter(Boolean) : [];
    const missing = 8 - leftParts.length - rightParts.length;
    if (missing < 0) return null;
    groups = [...leftParts, ...Array(missing).fill('0'), ...rightParts];
  } else {
    groups = s.split(':');
  }
  if (groups.length !== 8) return null;

  const first5AreZero = groups.slice(0, 5).every((g) => parseInt(g || '0', 16) === 0);
  if (!first5AreZero || groups[5] !== 'ffff') return null;

  const hi = parseInt(groups[6], 16);
  const lo = parseInt(groups[7], 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * Whether a resolved (or literal) IP must be blocked for the current mode.
 * IPv4-mapped/compatible IPv6 literals are normalized to their embedded IPv4
 * address first, so they can't slip past the same checks a bare IPv4 gets.
 * @param {string} ip
 * @returns {boolean}
 */
export function ipBlocked(ip) {
  const mapped = net.isIPv6(ip) ? extractMappedIPv4(ip) : null;
  const effectiveIp = mapped || ip;
  if (strictMode()) {
    // Full enforcement: anything not explicitly allowed by SSRFProtection.
    return !_ssrf.isIPAllowed(effectiveIp);
  }
  if (effectiveIp === '127.0.0.1' || effectiveIp === '::1' || effectiveIp === '0.0.0.0') return true;
  return STAGE1_RANGES.some((range) => _ssrf.isIPInRange(effectiveIp, range));
}

function ssrfBlockedError(message) {
  return Object.assign(new Error(`SSRF Protection: ${message}`), { code: 'SSRF_BLOCKED' });
}

function throwBlocked(message) {
  throw ssrfBlockedError(message);
}

function hostMatchesList(host, list) {
  return (list || []).some((d) => {
    const dd = String(d).trim().toLowerCase();
    return dd && (host === dd || host.endsWith('.' + dd));
  });
}

function isAllowlisted(host, allowed) {
  return hostMatchesList(host, allowed);
}

function isBlockedDomain(host, blocked) {
  return hostMatchesList(host, blocked);
}

/**
 * Shared, synchronous pre-flight: protocol, allowlist, metadata hosts,
 * BLOCKED_DOMAINS, and (for IP-literal hosts) ipBlocked(). Throws
 * (code SSRF_BLOCKED) on any violation. Used by both `ssrfGuard()` and
 * `assertUrlAllowed()` so the two never drift.
 * @param {URL} u
 * @param {object} sec config.security.ssrfProtection
 * @returns {{ host: string, allowlisted: boolean, ipLiteral: number }}
 */
function preflightHostCheck(u, sec) {
  if (!['http:', 'https:'].includes(u.protocol)) {
    throwBlocked(`protocol '${u.protocol}' is not allowed`);
  }

  const host = stripBrackets(u.hostname.toLowerCase());
  if (isAllowlisted(host, sec.allowedDomains)) {
    return { host, allowlisted: true, ipLiteral: net.isIP(host) };
  }

  if (METADATA_HOSTS.has(host)) {
    throwBlocked(`blocked metadata host '${host}'`);
  }
  if (isBlockedDomain(host, sec.blockedDomains)) {
    throwBlocked(`blocked hostname '${host}'`);
  }

  const ipLiteral = net.isIP(host);
  if (ipLiteral && ipBlocked(host)) {
    throwBlocked(`blocked IP literal '${host}'`);
  }

  return { host, allowlisted: false, ipLiteral };
}

/**
 * undici connect-time lookup: resolves the host, rejects if ANY resolved address
 * is blocked, otherwise hands undici the validated address(es) — so the socket
 * connects to exactly what we checked (rebinding-safe). Allowlisted hostnames
 * are resolved normally, with no address filtering.
 */
function ssrfLookup(hostname, opts, callback) {
  const sec = config.security?.ssrfProtection;
  if (isAllowlisted(hostname.toLowerCase(), sec?.allowedDomains)) {
    return dns.lookup(hostname, opts, callback);
  }
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    for (const { address } of addresses) {
      if (ipBlocked(address)) {
        return callback(ssrfBlockedError(`${hostname} resolves to blocked address ${address}`));
      }
    }
    if (opts && opts.all) return callback(null, addresses);
    const first = addresses[0];
    callback(null, first.address, first.family);
  });
}

/**
 * Wraps undici's base connector to also cover IP-literal hosts, which
 * `net.connect` never routes through `lookup` — so hostname-based DNS
 * rebinding checks (ssrfLookup, above) alone can't catch a redirect straight
 * to e.g. `http://127.0.0.1/`. Checked per-connect, so every hop (initial
 * request and each redirect) is validated independently.
 */
function guardedConnect(baseConnect) {
  return function connect(opts, callback) {
    const hostname = stripBrackets(String(opts.hostname || opts.host || '').toLowerCase());
    if (net.isIP(hostname)) {
      const sec = config.security?.ssrfProtection;
      if (!isAllowlisted(hostname, sec?.allowedDomains) && ipBlocked(hostname)) {
        return callback(ssrfBlockedError(`blocked IP literal '${hostname}'`));
      }
    }
    return baseConnect(opts, callback);
  };
}

let _agent = null;
function guardedDispatcher() {
  if (!_agent) {
    const baseConnect = buildConnector({ lookup: ssrfLookup });
    _agent = new Agent({ connect: guardedConnect(baseConnect) });
  }
  return _agent;
}

/**
 * Pre-flight check + dispatcher selection for an outbound scrape target.
 * Returns `{ dispatcher }` to spread into fetch options; the dispatcher is
 * always the guarded one (it enforces allowlist/blocklist/IP checks per-hop
 * internally) so redirects can never escape it. `{}` is returned only when
 * the guard is disabled outright (kill switch). Throws (code SSRF_BLOCKED)
 * for pre-flight violations (protocol, metadata host, BLOCKED_DOMAINS, or a
 * blocked IP-literal host) on the initial URL.
 *
 * @param {string} url
 * @returns {{ dispatcher?: import('undici').Agent }}
 */
export function ssrfGuard(url) {
  const sec = config.security?.ssrfProtection;
  if (!sec || sec.enabled === false) return {}; // kill switch -> default fetch behavior

  let u;
  try {
    u = new URL(url);
  } catch {
    return {}; // let fetch surface its own invalid-URL error
  }

  preflightHostCheck(u, sec); // throws on violation

  return { dispatcher: guardedDispatcher() };
}

/**
 * Shared pre-flight helper for subsystems that don't go through `safeFetch`
 * (e.g. Playwright navigation). Resolves (returns undefined) when the URL is
 * allowed; throws an Error with `code: 'SSRF_BLOCKED'` (message starting
 * `SSRF Protection:`) when blocked.
 *
 * Kill switch and allowlist behave exactly as in `ssrfGuard()`. When
 * `resolveDns` is true and the host is a (non-allowlisted, non-IP-literal)
 * hostname, it is resolved via `dns.promises.lookup` and every returned
 * address is checked with `ipBlocked()`; a DNS failure here is not itself
 * treated as a block (the caller's own fetch/connect will surface it).
 *
 * @param {string} urlString
 * @param {{ resolveDns?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function assertUrlAllowed(urlString, { resolveDns = false } = {}) {
  const sec = config.security?.ssrfProtection;
  if (!sec || sec.enabled === false) return; // kill switch

  let u;
  try {
    u = new URL(urlString);
  } catch {
    return; // let the caller's own URL parsing surface the error
  }

  const { host, allowlisted, ipLiteral } = preflightHostCheck(u, sec); // throws on violation
  if (allowlisted || ipLiteral || !resolveDns) return;

  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    return; // DNS failures are not ours to enforce; let the caller's own fetch surface them
  }
  for (const { address } of addresses) {
    if (ipBlocked(address)) {
      throwBlocked(`${host} resolves to blocked address ${address}`);
    }
  }
}

/** True if an error (or its fetch `cause`) came from the SSRF guard. */
export function isSsrfError(err) {
  return err?.code === 'SSRF_BLOCKED' || err?.cause?.code === 'SSRF_BLOCKED';
}

/**
 * Drop-in replacement for global `fetch` that applies the SSRF guard.
 * Behaviour-preserving for allowed URLs: all options pass through unchanged and
 * the native Response is returned; only a guarded dispatcher is injected. For
 * blocked targets it throws a clear `SSRF Protection: ...` error (pre-flight) or
 * the fetch rejects at connect time with an SSRF_BLOCKED cause.
 *
 * A crawl request (one carrying a Web Bot Auth signature, or the gate's
 * `onRedirect`) has its redirects followed one hop at a time, each through the
 * same dispatcher, each gated and each signed for itself (see resignedFetch.js).
 *
 * @param {string} url
 * @param {RequestInit & { onRedirect?: (to: string) => Promise<void> }} [options]
 * @returns {Promise<Response>}
 */
export async function safeFetch(url, options = {}) {
  const guard = ssrfGuard(url); // throws on protocol / metadata-host / blocklist / IP-literal violations
  try {
    return await fetchResigned(url, { ...options, ...guard });
  } catch (err) {
    if (isSsrfError(err)) {
      throw new Error(err.cause?.message || err.message);
    }
    throw err;
  }
}

/**
 * Where a navigation went after the URL it was asked for: every HTTP redirect
 * hop in order, then the URL the page stands on when that is somewhere else
 * again (a client-side redirect). Fragments are ignored; they never reach a
 * server.
 *
 * @param {string} landed the page's current URL
 * @param {string} [url] the URL the navigation was asked for
 * @param {import('playwright').Response|null} [response] what `page.goto` returned
 * @returns {string[]}
 */
export function navigationHops(landed, url, response) {
  const bare = (value) => {
    try {
      const parsed = new URL(value);
      parsed.hash = '';
      return parsed.href;
    } catch {
      return value;
    }
  };
  const chain = [];
  for (let request = response?.request?.(); request; request = request.redirectedFrom()) {
    chain.unshift(request.url());
  }
  const hops = chain.slice(1);
  if (/^https?:\/\//i.test(landed) && bare(landed) !== bare(hops.at(-1) ?? url)) hops.push(landed);
  return hops;
}

/**
 * The checks a navigation gets once it has happened: the SSRF guard on where
 * the page landed, and the caller's `onRedirect` gate on every hop that led
 * there.
 *
 * A fetch is refused a redirect before the hop is requested (resignedFetch.js).
 * A browser follows redirects itself and Playwright hands no redirect hop to a
 * route handler, so here the hop has already been requested by the time anyone
 * can ask about it. What is held instead is everything after: a refusal empties
 * the page before it is thrown, so nothing of the refused document can be read,
 * acted on or captured, including by a caller that keeps the page. For the same
 * reason the gate is told the hop is `alreadyRequested`: there is nothing left
 * for a Crawl-delay to space.
 *
 * Call it again with the URL a navigation landed on, and no response, before
 * reading a page that had time to move on by itself.
 *
 * @param {import('playwright').Page} page
 * @param {string} url the URL the navigation was asked for
 * @param {import('playwright').Response|null} [response] what `page.goto` returned
 * @param {(to: string, hop?: { alreadyRequested?: boolean }) => Promise<void>} [onRedirect]
 *   refuses a hop by throwing
 * @returns {Promise<string>} the URL the page stood on when it was checked
 */
export async function assertNavigationAllowed(page, url, response, onRedirect) {
  try {
    const landedUrl = page.url();
    if (/^https?:\/\//i.test(landedUrl)) {
      await assertUrlAllowed(landedUrl, { resolveDns: true });
    }
    if (onRedirect) {
      for (const hop of navigationHops(landedUrl, url, response)) {
        await onRedirect(hop, { alreadyRequested: true });
      }
    }
    return landedUrl;
  } catch (error) {
    await page.goto('about:blank').catch(() => {});
    throw error;
  }
}

/**
 * SSRF-safe wrapper around Playwright's `page.goto`. The navigate analog of
 * safeFetch: a browser drives its own DNS resolution, so URL/host checks alone
 * miss DNS-rebinding and private-IP targets — resolveDns:true closes that.
 * Checks the URL before navigating, then re-checks where the navigation went
 * (see assertNavigationAllowed), because a redirect could carry us into a
 * blocked range, or past the caller's `onRedirect` gate, even when the
 * original URL was safe. Returns the Response so callers can read the status.
 * Every other option passes through unchanged; behaviour-preserving for
 * allowed URLs.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {Parameters<import('playwright').Page['goto']>[1] & { onRedirect?: (to: string) => Promise<void> }} [options]
 * @returns {Promise<import('playwright').Response|null>}
 */
export async function safeGoto(page, url, options = {}) {
  const { onRedirect, ...gotoOptions } = options;
  await assertUrlAllowed(url, { resolveDns: true });
  const response = await page.goto(url, gotoOptions);
  await assertNavigationAllowed(page, url, response, onRedirect);
  return response;
}

// Exposed for unit tests.
export const __ssrfInternals = {
  ssrfLookup,
  isAllowlisted,
  isBlockedDomain,
  extractMappedIPv4,
  STAGE1_RANGES,
};

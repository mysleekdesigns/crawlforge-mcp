/**
 * SSRF guard for the live outbound fetch path.
 *
 * This wires the (previously unused) SSRF protections into the actual scraping
 * fetch helpers. Enforcement happens at TCP connect time via a custom undici
 * dispatcher `lookup`, so it covers the initial request, every redirect hop, and
 * closes the DNS-rebinding window (the validated IP is the one connected to —
 * there is no second, unchecked resolution).
 *
 * Two levels:
 *  - Stage 1 (default): blocks connections to loopback, link-local /
 *    cloud-metadata (169.254.0.0/16, incl. 169.254.169.254), and 0.0.0.0.
 *    These are never legitimate public-scrape targets, so impact is ~zero.
 *  - Stage 2 (SSRF_STRICT=true): full private-range enforcement (RFC1918, ULA,
 *    multicast, CGNAT, etc.) via the existing SSRFProtection range logic.
 *
 * Controls (backwards-compatible defaults):
 *  - SSRF_PROTECTION_ENABLED=false  -> disable the guard entirely (kill switch).
 *  - ALLOWED_DOMAINS=a.com,b.com    -> bypass the guard for trusted hosts
 *    (e.g. a local dev server at localhost). Matches host or any subdomain.
 *  - SSRF_STRICT=true               -> Stage 2 full enforcement.
 */
import dns from 'node:dns';
import { Agent } from 'undici';
import { config } from '../constants/config.js';
import { SSRFProtection } from './ssrfProtection.js';

// Reused only for its (well-tested) CIDR range math — no network state.
const _ssrf = new SSRFProtection();

// Narrow Stage-1 ranges: things no legitimate public scrape ever targets.
const STAGE1_RANGES = ['127.0.0.0/8', '169.254.0.0/16', '0.0.0.0/8', '::1/128', 'fe80::/10'];

// Literal cloud-metadata / service-discovery hostnames blocked even before DNS.
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.azure.com', 'metadata']);

function strictMode() {
  return process.env.SSRF_STRICT === 'true';
}

/**
 * Whether a resolved IP must be blocked for the current mode.
 * @param {string} ip
 * @returns {boolean}
 */
export function ipBlocked(ip) {
  if (strictMode()) {
    // Full enforcement: anything not explicitly allowed by SSRFProtection.
    return !_ssrf.isIPAllowed(ip);
  }
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
  return STAGE1_RANGES.some((range) => _ssrf.isIPInRange(ip, range));
}

/**
 * undici connect-time lookup: resolves the host, rejects if ANY resolved address
 * is blocked, otherwise hands undici the validated address(es) — so the socket
 * connects to exactly what we checked (rebinding-safe).
 */
function ssrfLookup(hostname, opts, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    for (const { address } of addresses) {
      if (ipBlocked(address)) {
        return callback(
          Object.assign(
            new Error(`SSRF Protection: ${hostname} resolves to blocked address ${address}`),
            { code: 'SSRF_BLOCKED' }
          )
        );
      }
    }
    if (opts && opts.all) return callback(null, addresses);
    const first = addresses[0];
    callback(null, first.address, first.family);
  });
}

let _agent = null;
function guardedDispatcher() {
  if (!_agent) {
    _agent = new Agent({ connect: { lookup: ssrfLookup } });
  }
  return _agent;
}

function isAllowlisted(host, allowed) {
  return (allowed || []).some((d) => {
    const dd = String(d).trim().toLowerCase();
    return dd && (host === dd || host.endsWith('.' + dd));
  });
}

/**
 * Pre-flight check + dispatcher selection for an outbound scrape target.
 * Returns `{ dispatcher }` to spread into fetch options. `dispatcher` is
 * undefined when the guard is disabled or the host is explicitly allowlisted.
 * Throws (code SSRF_BLOCKED) for protocol / metadata-host pre-flight violations.
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

  if (!['http:', 'https:'].includes(u.protocol)) {
    throw Object.assign(new Error(`SSRF Protection: protocol '${u.protocol}' is not allowed`), {
      code: 'SSRF_BLOCKED',
    });
  }

  const host = u.hostname.toLowerCase();
  if (isAllowlisted(host, sec.allowedDomains)) return {}; // explicit escape hatch

  if (METADATA_HOSTS.has(host)) {
    throw Object.assign(new Error(`SSRF Protection: blocked metadata host '${host}'`), {
      code: 'SSRF_BLOCKED',
    });
  }

  return { dispatcher: guardedDispatcher() };
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
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function safeFetch(url, options = {}) {
  const guard = ssrfGuard(url); // throws on protocol / metadata-host violations
  try {
    return await fetch(url, { ...options, ...guard });
  } catch (err) {
    if (isSsrfError(err)) {
      throw new Error(err.cause?.message || err.message);
    }
    throw err;
  }
}

// Exposed for unit tests.
export const __ssrfInternals = { ssrfLookup, isAllowlisted, STAGE1_RANGES };

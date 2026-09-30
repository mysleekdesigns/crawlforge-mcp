/**
 * fetch for a crawl request, following redirects one hop at a time so that
 * every hop is gated and signed for itself.
 *
 * fetch follows a redirect on its own, forwarding the request headers
 * unchanged and asking nobody. That went wrong twice:
 *
 *  - The gate ran once, for the URL the caller asked for. A redirect could
 *    then land on a path robots.txt disallows, or on a host the platform
 *    blocklist refuses, and be fetched anyway.
 *  - `preflightFetch` signs once. A same-host redirect arrived with a nonce
 *    the site had already seen, which a verifier that tracks nonces rejects as
 *    a replay, and a cross-host redirect arrived with a signature over the
 *    previous host's `@authority`, which no verifier accepts. Both made a
 *    genuine CrawlForge request look forged.
 *
 * A request takes the manual path when it carries a signature or an
 * `onRedirect` gate, and follows redirects. Everything else (webhooks, an
 * explicit `redirect: 'manual'`) is handed to fetch exactly as before.
 */

import { signRequestHeaders } from './webBotAuth.js';

/** fetch's own limit. */
const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SIGNATURE_HEADERS = ['signature', 'signature-input', 'signature-agent'];
/** What fetch drops when a redirect leaves the origin. */
const CROSS_ORIGIN_HEADERS = ['authorization', 'cookie', 'host', 'proxy-authorization'];
/** What fetch drops when a redirect turns the request into a GET. */
const BODY_HEADERS = ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length'];

/**
 * Resolve a `Location` header the way fetch does. Some sites send it as raw
 * UTF-8 rather than percent-encoded; the header arrives as a binary string, so
 * those bytes are read back as UTF-8 before the URL is parsed.
 */
function locationUrl(location, base) {
  const raw = /[^\x20-\x7e]/.test(location) ? Buffer.from(location, 'latin1').toString('utf8') : location;
  return new URL(raw, base);
}

/**
 * The caller's abort signal with the time a hop's gate takes given back.
 *
 * The gate for the URL a caller asked for runs before the caller starts its
 * timeout. The gate for a redirect runs inside it, and may wait out the next
 * host's Crawl-delay: 30 s on a host that asks for it, against a fetch timeout
 * of 15. Charged to the timeout, that wait would fail the fetch as if the site
 * had not answered. So the caller's abort reaches the fetch late by however
 * long the gates have held it, and not while one is still holding it.
 *
 * @param {AbortSignal} [callerSignal]
 * @returns {{ signal?: AbortSignal, gated: <T>(gate: () => Promise<T>) => Promise<T> }}
 *   `signal` replaces the caller's on every later hop; `gated` runs a gate
 *   with its time counted
 */
function gateTimeRefund(callerSignal) {
  if (!callerSignal) return { gated: (gate) => gate() };

  const controller = new AbortController();
  let gateMs = 0;
  let inGate = false;
  let abortedAt = null;
  let timer;

  const deliver = () => {
    if (abortedAt === null || inGate) return;
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(callerSignal.reason),
      Math.max(0, abortedAt + gateMs - Date.now())
    );
    // A fetch that finished long ago must not keep the process up for this.
    timer.unref?.();
  };
  const onAbort = () => {
    abortedAt = Date.now();
    deliver();
  };
  if (callerSignal.aborted) onAbort();
  else callerSignal.addEventListener('abort', onAbort, { once: true });

  return {
    signal: controller.signal,
    async gated(gate) {
      const startedAt = Date.now();
      inGate = true;
      clearTimeout(timer);
      try {
        return await gate();
      } finally {
        inGate = false;
        gateMs += Date.now() - startedAt;
        deliver();
      }
    }
  };
}

/**
 * @param {string} url
 * @param {RequestInit & { onRedirect?: (to: string) => Promise<void> }} [options]
 *   `onRedirect` is awaited with each redirect target before it is requested;
 *   it refuses the hop by throwing. The time it takes is not charged to
 *   `signal` (see {@link gateTimeRefund}).
 * @returns {Promise<Response>}
 */
export async function fetchResigned(url, options = {}) {
  const { onRedirect, ...fetchOptions } = options;
  const signed = new Headers(fetchOptions.headers).has('signature-input');
  if ((!signed && !onRedirect) || (fetchOptions.redirect ?? 'follow') !== 'follow') {
    return fetch(url, fetchOptions);
  }

  let current = String(url);
  // The first hop goes out with the caller's headers and signal untouched.
  let init = { ...fetchOptions, redirect: 'manual' };
  let refund = null;

  for (let hop = 0; ; hop++) {
    const response = await fetch(current, init);
    const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get('location') : null;
    if (!location) {
      if (hop > 0) Object.defineProperty(response, 'redirected', { value: true });
      return response;
    }
    // Released, not awaited: the next hop must not wait on a body nobody reads.
    response.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new TypeError('fetch failed: redirect count exceeded');

    const next = locationUrl(location, current);
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      throw new TypeError('fetch failed: redirect to a URL that is not http(s)');
    }
    if (onRedirect) {
      refund ??= gateTimeRefund(fetchOptions.signal);
      await refund.gated(() => onRedirect(next.href));
    }

    const headers = new Headers(init.headers);
    if (next.origin !== new URL(current).origin) {
      for (const name of CROSS_ORIGIN_HEADERS) headers.delete(name);
    }

    const method = (init.method ?? 'GET').toUpperCase();
    const becomesGet = response.status === 303
      ? method !== 'GET' && method !== 'HEAD'
      : method === 'POST' && (response.status === 301 || response.status === 302);
    if (becomesGet) {
      for (const name of BODY_HEADERS) headers.delete(name);
      init = { ...init, method: 'GET', body: undefined };
    }

    if (signed) {
      for (const name of SIGNATURE_HEADERS) headers.delete(name);
      for (const [name, value] of Object.entries(signRequestHeaders(next.href) ?? {})) {
        headers.set(name, value);
      }
    }

    init = { ...init, headers, ...(refund?.signal ? { signal: refund.signal } : {}) };
    current = next.href;
  }
}

/**
 * undici rejects a DNS, refused or reset connection with a bare TypeError
 * "fetch failed" and keeps the reason (`getaddrinfo ENOTFOUND host`,
 * `ECONNREFUSED`) in `cause`. A tool that reports only `error.message` makes a
 * typoed domain and a dead host read the same, and the not_found hint in
 * fallbackHints.js, which keys on ENOTFOUND, never matches (R25 3.1).
 *
 * @param {Error} error
 * @param {string} url
 * @returns {string} "Could not reach <url> (<reason>)" for that error, as the
 *   REST route's FETCH_FAILED says it; any other error's own message
 */
export function fetchErrorMessage(error, url) {
  if (!(error instanceof TypeError) || error.message !== 'fetch failed') return error.message;
  const reason = error.cause?.message || error.cause?.code;
  return `Could not reach ${url}${reason ? ` (${reason})` : ''}`;
}

/**
 * The error to rethrow: undici's bare "fetch failed" becomes a TypeError
 * with fetchErrorMessage's text, keeping undici's cause and its code, so
 * `err.cause?.code` checks and RetryManager's code list still see
 * ENOTFOUND / ECONNREFUSED. Any other error comes back unchanged. Applied in
 * safeFetch and fetchWithTimeout, so every tool that prints only
 * `err.message` names the cause.
 *
 * The URL is named without its query or credentials: these two also fetch
 * key-based connector URLs (`?key=...`), and the message reaches the caller.
 *
 * @param {Error} error
 * @param {string|URL} url
 * @returns {Error}
 */
export function withFetchCause(error, url) {
  let shown;
  try {
    const parsed = new URL(url);
    shown = `${parsed.origin}${parsed.pathname}`;
  } catch {
    shown = 'the URL';
  }
  const message = fetchErrorMessage(error, shown);
  if (message === error.message) return error;
  const wrapped = new TypeError(message, { cause: error.cause });
  if (error.cause?.code) wrapped.code = error.cause.code;
  return wrapped;
}

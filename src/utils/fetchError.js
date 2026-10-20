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

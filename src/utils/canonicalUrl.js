/**
 * canonicalUrl — one spelling per page, for keys that must match when two
 * calls ask for the same page (the invocation log's urlKey now, the page cache
 * of REPEAT_CALL_REDUCTION_PLAN Phase 1 next).
 *
 * Rules (plan 1.2): lowercase scheme and host, drop the default port (80 for
 * http, 443 for https) and the #fragment, keep path and query string exactly
 * as written. An empty path is the root path ("/"), which is what is requested.
 * Anything that does not parse as a URL returns null.
 */

export function canonicalUrl(input) {
  if (typeof input !== 'string') return null;
  let u;
  try { u = new URL(input.trim()); } catch { return null; }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    u.hash = '';
    return u.href;
  }

  // WHATWG URL already lowercases scheme and host and drops a default port,
  // but it also rewrites the path (dot segments, percent-encoding), so the
  // path and query are taken from the original string instead.
  const rest = input.trim().match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^#]*)/i)?.[1] ?? '';
  const userinfo = u.username ? `${u.username}${u.password ? `:${u.password}` : ''}@` : '';
  const pathAndQuery = rest === '' || rest.startsWith('?') ? `/${rest}` : rest;
  return `${u.protocol}//${userinfo}${u.host}${pathAndQuery}`;
}

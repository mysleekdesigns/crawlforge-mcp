/**
 * Per-request context for the HTTP transports.
 *
 * The streamable HTTP transport authenticates every request, but tool handlers
 * are wrapped once at registration time (withAuth) with no per-request
 * plumbing. AsyncLocalStorage bridges that gap: the transport runs each
 * request inside a context, and withAuth reads it at invocation time.
 *
 * Today the only flag is `internal`: a request authenticated with the
 * INTERNAL_PROXY_SECRET (the crawlforge-website REST proxy). Internal requests
 * run tools normally but are billing-exempt — the website has already checked
 * and charged the end user's credits, so metering here would double-bill.
 *
 * The flag lives on the request context, never on the MCP session: a session
 * id created by an internal request grants nothing to a later request that
 * authenticates by other means.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage();

/** True when the current async context belongs to an internal-proxy request. */
export function isInternalRequest() {
  return requestContext.getStore()?.internal === true;
}

/**
 * Record that the compliance gate refused this invocation before anything was
 * fetched — robots.txt disallowed the path, or the host is on the permanent
 * blocklist.
 *
 * withAuth reads this when it decides the charge. The flag rather than the
 * error's `code` is deliberate: tool handlers catch their own errors and
 * return `{ isError: true }` with only a message, so the typed error never
 * reaches withAuth. It also survives both routes a refusal can take — thrown,
 * or swallowed into an isError result.
 *
 * @param {string} code 'ROBOTS_DISALLOWED' | 'HOST_BLOCKED'
 */
export function markPreflightRefusal(code) {
  const store = requestContext.getStore();
  if (store) store.preflightRefusal = code;
}

/** The refusal code recorded for this invocation, or null. */
export function preflightRefusal() {
  return requestContext.getStore()?.preflightRefusal ?? null;
}

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

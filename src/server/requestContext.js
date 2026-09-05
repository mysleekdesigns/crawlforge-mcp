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

/**
 * Report what this invocation actually spent, in credits, when that is less
 * than the projection. A handler that skipped expensive work — Phase 3's
 * escalation stops at the first tier that succeeds — has no other way to say
 * so: withAuth otherwise derives the charge from the tool's price alone.
 *
 * withAuth clamps the value to the projection. `_cost.projected` is the
 * ceiling a caller saw before the call, so a report can only ever lower the
 * charge, never raise it. Non-finite or negative values are ignored.
 *
 * @param {number} n credits actually spent
 */
export function setActualCost(n) {
  const store = requestContext.getStore();
  if (store && Number.isFinite(n) && n >= 0) store.actualCost = n;
}

/** The actual cost reported for this invocation, or null when unreported. */
export function reportedActualCost() {
  return requestContext.getStore()?.actualCost ?? null;
}

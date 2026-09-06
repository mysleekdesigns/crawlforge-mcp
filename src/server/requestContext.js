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

/**
 * Record the McpServer instance that is actually serving this request, and the
 * wire era it speaks.
 *
 * Neither HTTP leg serves from the top-level McpServer that server.js
 * registers everything on: the 2025-era path connects one clone per session,
 * and the modern leg builds a fresh clone per request (see
 * transports/streamableHttp.js). Only a clone is ever `.connect()`ed, so only a
 * clone has a negotiated protocol version, the client's declared capabilities,
 * and a channel to send a server-to-client request on. The template has none of
 * those, which is why anything reading them off it (ElicitationHelper) got
 * `undefined` on every HTTP request.
 *
 * Stdio stamps nothing: there the top-level instance IS the connected one, and
 * the accessors below return null so callers fall back to it.
 *
 * @param {object|null} server the serving McpServer
 * @param {'legacy'|'modern'|null} [era] the wire era it serves
 */
export function setServingServer(server, era = null) {
  const store = requestContext.getStore();
  if (!store) return;
  store.servingServer = server ?? null;
  store.servingEra = era;
}

/** The McpServer serving this request, or null on stdio / outside a context. */
export function servingServer() {
  return requestContext.getStore()?.servingServer ?? null;
}

/** The wire era serving this request: 'legacy' | 'modern' | null (stdio). */
export function servingEra() {
  return requestContext.getStore()?.servingEra ?? null;
}

/**
 * The JSON-RPC id of the request being served, or null when unknown.
 *
 * A server-to-client request sent from inside a tool has to say which inbound
 * request it belongs to: the 2025-era streamable HTTP transport routes an
 * unrelated request to the standalone GET SSE stream and silently DROPS it when
 * the client never opened one, which turns an elicitation prompt into a
 * 60-second stall before it fails open. withAuth stamps this from the SDK's
 * per-request `ctx`; stdio has no streams to pick between and ignores it.
 */
export function servingRequestId() {
  return requestContext.getStore()?.servingRequestId ?? null;
}

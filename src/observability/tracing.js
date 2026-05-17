/**
 * OpenTelemetry-style tracing facade.
 *
 * Disabled by default. When `OTEL_SDK_DISABLED !== 'false'`, all calls are
 * no-ops with zero overhead (no SDK loaded). To enable, install
 * `@opentelemetry/api` + `@opentelemetry/sdk-node` in the host application
 * and set `OTEL_SDK_DISABLED=false`.
 *
 * Why a facade instead of importing `@opentelemetry/api` directly?
 *   - CrawlForge ships via npm; we don't want to force the OTel runtime
 *     on every user. The facade pattern matches `@opentelemetry/api`'s
 *     no-op-by-default design but doesn't add the dependency to package.json.
 *   - Operators who want tracing install the SDK themselves and configure
 *     OTEL_* env vars. We call into `globalThis.__otelTracer` if present.
 *
 * Span attributes set on every tool invocation:
 *   - mcp.tool.name
 *   - mcp.tool.duration_ms
 *   - mcp.tool.outcome
 *   - mcp.credit.cost
 */

const NOOP_SPAN = {
  setAttribute() { return this; },
  setAttributes() { return this; },
  setStatus() { return this; },
  recordException() { return this; },
  end() {}
};

export function isTracingEnabled() {
  return process.env.OTEL_SDK_DISABLED === 'false' && Boolean(globalThis.__otelTracer);
}

export function startToolSpan(toolName) {
  if (!isTracingEnabled()) return NOOP_SPAN;
  try {
    const tracer = globalThis.__otelTracer;
    const span = tracer.startSpan(`mcp.tool.${toolName}`, {
      attributes: { 'mcp.tool.name': toolName }
    });
    return span;
  } catch {
    return NOOP_SPAN;
  }
}

/**
 * Record a complete tool invocation. Convenience wrapper used by withAuth.
 *
 * @param {string} toolName
 * @param {object} attrs   — { duration_ms, outcome, credit_cost, creator_mode }
 * @param {Error}  [error]
 */
export function recordToolInvocation(toolName, attrs, error) {
  if (!isTracingEnabled()) return;
  try {
    const span = startToolSpan(toolName);
    span.setAttributes({
      'mcp.tool.duration_ms': attrs.duration_ms,
      'mcp.tool.outcome': attrs.outcome,
      'mcp.credit.cost': attrs.credit_cost,
      'mcp.credit.outcome': attrs.outcome,
      'mcp.creator_mode': Boolean(attrs.creator_mode)
    });
    if (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
    }
    span.end();
  } catch {
    // tracing must never break the request path
  }
}

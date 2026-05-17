/**
 * Unit tests for src/observability/tracing.js (v3.2.0, C4).
 *
 * Run: node --test tests/unit/tracing.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTracingEnabled, startToolSpan, recordToolInvocation } from '../../src/observability/tracing.js';

test('isTracingEnabled: false by default (no SDK, no env)', () => {
  delete process.env.OTEL_SDK_DISABLED;
  delete globalThis.__otelTracer;
  assert.equal(isTracingEnabled(), false);
});

test('isTracingEnabled: false when env disables it explicitly', () => {
  process.env.OTEL_SDK_DISABLED = 'true';
  globalThis.__otelTracer = { startSpan: () => ({}) };
  assert.equal(isTracingEnabled(), false);
  delete globalThis.__otelTracer;
});

test('isTracingEnabled: true when env=false AND tracer present', () => {
  process.env.OTEL_SDK_DISABLED = 'false';
  globalThis.__otelTracer = { startSpan: () => ({}) };
  assert.equal(isTracingEnabled(), true);
  delete globalThis.__otelTracer;
  delete process.env.OTEL_SDK_DISABLED;
});

test('startToolSpan: returns no-op span when disabled', () => {
  delete globalThis.__otelTracer;
  delete process.env.OTEL_SDK_DISABLED;
  const span = startToolSpan('fetch_url');
  // No-op span has all method shims
  assert.equal(typeof span.setAttribute, 'function');
  assert.equal(typeof span.end, 'function');
  // Calling them must not throw
  span.setAttribute('k', 'v');
  span.setAttributes({ a: 1 });
  span.setStatus({ code: 1 });
  span.recordException(new Error('x'));
  span.end();
});

test('startToolSpan: calls tracer.startSpan when enabled', () => {
  let captured = null;
  globalThis.__otelTracer = {
    startSpan(name, opts) {
      captured = { name, opts };
      return {
        setAttribute() {}, setAttributes() {}, setStatus() {}, recordException() {}, end() {}
      };
    }
  };
  process.env.OTEL_SDK_DISABLED = 'false';
  startToolSpan('fetch_url');
  assert.equal(captured.name, 'mcp.tool.fetch_url');
  assert.equal(captured.opts.attributes['mcp.tool.name'], 'fetch_url');
  delete globalThis.__otelTracer;
  delete process.env.OTEL_SDK_DISABLED;
});

test('recordToolInvocation: sets expected attributes on the span', () => {
  const calls = [];
  const span = {
    setAttribute() {},
    setAttributes(attrs) { calls.push({ kind: 'attrs', attrs }); },
    setStatus(s) { calls.push({ kind: 'status', s }); },
    recordException(e) { calls.push({ kind: 'exception', e: e.message }); },
    end() { calls.push({ kind: 'end' }); }
  };
  globalThis.__otelTracer = { startSpan: () => span };
  process.env.OTEL_SDK_DISABLED = 'false';

  const err = new Error('boom');
  recordToolInvocation('fetch_url', {
    duration_ms: 123,
    outcome: 'error',
    credit_cost: 2,
    creator_mode: false
  }, err);

  const attrs = calls.find(c => c.kind === 'attrs').attrs;
  assert.equal(attrs['mcp.tool.duration_ms'], 123);
  assert.equal(attrs['mcp.tool.outcome'], 'error');
  assert.equal(attrs['mcp.credit.cost'], 2);
  assert.equal(attrs['mcp.creator_mode'], false);
  assert.ok(calls.find(c => c.kind === 'exception' && c.e === 'boom'));
  assert.ok(calls.find(c => c.kind === 'status'));
  assert.ok(calls.find(c => c.kind === 'end'));

  delete globalThis.__otelTracer;
  delete process.env.OTEL_SDK_DISABLED;
});

test('recordToolInvocation: no-op + no throw when disabled', () => {
  delete globalThis.__otelTracer;
  delete process.env.OTEL_SDK_DISABLED;
  // Must not throw, must not require any global state
  recordToolInvocation('fetch_url', {
    duration_ms: 10, outcome: 'success', credit_cost: 1, creator_mode: false
  });
});

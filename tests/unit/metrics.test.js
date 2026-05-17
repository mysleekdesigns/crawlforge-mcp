/**
 * Unit tests for src/observability/metrics.js (v3.2.0, C4).
 *
 * Run: node --test tests/unit/metrics.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetricsRegistry } from '../../src/observability/metrics.js';

test('incCounter: accumulates and renders Prometheus format', async () => {
  const m = createMetricsRegistry();
  m.incCounter('crawlforge_tool_requests_total', { tool: 'fetch_url', outcome: 'success' });
  m.incCounter('crawlforge_tool_requests_total', { tool: 'fetch_url', outcome: 'success' });
  m.incCounter('crawlforge_tool_requests_total', { tool: 'fetch_url', outcome: 'error' });
  const out = await m.render();
  assert.match(out, /# TYPE crawlforge_tool_requests_total counter/);
  assert.match(out, /crawlforge_tool_requests_total\{outcome="success",tool="fetch_url"\} 2/);
  assert.match(out, /crawlforge_tool_requests_total\{outcome="error",tool="fetch_url"\} 1/);
});

test('setGauge: latest value wins and renders as gauge type', async () => {
  const m = createMetricsRegistry();
  m.setGauge('crawlforge_browser_pool_in_use', {}, 3);
  m.setGauge('crawlforge_browser_pool_in_use', {}, 7);
  const out = await m.render();
  assert.match(out, /# TYPE crawlforge_browser_pool_in_use gauge/);
  assert.match(out, /crawlforge_browser_pool_in_use 7/);
});

test('observeHistogram: emits buckets, sum, count', async () => {
  const m = createMetricsRegistry();
  m.observeHistogram('crawlforge_tool_duration_ms', { tool: 'fetch_url' }, 30);
  m.observeHistogram('crawlforge_tool_duration_ms', { tool: 'fetch_url' }, 120);
  m.observeHistogram('crawlforge_tool_duration_ms', { tool: 'fetch_url' }, 800);
  const out = await m.render();
  assert.match(out, /# TYPE crawlforge_tool_duration_ms histogram/);
  // 30ms only in the le=50 bucket and above
  assert.match(out, /crawlforge_tool_duration_ms_bucket\{tool="fetch_url",le="50"\} 1/);
  assert.match(out, /crawlforge_tool_duration_ms_bucket\{tool="fetch_url",le="250"\} 2/);
  assert.match(out, /crawlforge_tool_duration_ms_bucket\{tool="fetch_url",le="1000"\} 3/);
  assert.match(out, /crawlforge_tool_duration_ms_bucket\{tool="fetch_url",le="\+Inf"\} 3/);
  assert.match(out, /crawlforge_tool_duration_ms_sum\{tool="fetch_url"\} 950/);
  assert.match(out, /crawlforge_tool_duration_ms_count\{tool="fetch_url"\} 3/);
});

test('label escaping: handles quotes/backslashes/newlines safely', async () => {
  const m = createMetricsRegistry();
  m.incCounter('crawlforge_tool_errors_total', { tool: 'x', error_class: 'has"quote\\backslash' });
  const out = await m.render();
  assert.match(out, /error_class="has\\"quote\\\\backslash"/);
});

test('render: produces valid Prometheus content-type', () => {
  const m = createMetricsRegistry();
  assert.equal(m.contentType, 'text/plain; version=0.0.4; charset=utf-8');
});

test('multiple metric families render with distinct HELP/TYPE blocks', async () => {
  const m = createMetricsRegistry();
  m.incCounter('crawlforge_tool_requests_total', { tool: 'a' });
  m.setGauge('crawlforge_browser_pool_in_use', {}, 1);
  m.observeHistogram('crawlforge_tool_duration_ms', { tool: 'a' }, 5);
  const out = await m.render();
  assert.match(out, /# TYPE crawlforge_tool_requests_total counter/);
  assert.match(out, /# TYPE crawlforge_browser_pool_in_use gauge/);
  assert.match(out, /# TYPE crawlforge_tool_duration_ms histogram/);
});

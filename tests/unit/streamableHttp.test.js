/**
 * Unit tests for src/server/transports/streamableHttp.js (v3.2.0, C1).
 *
 * Run: node --test tests/unit/streamableHttp.test.js
 *
 * We mount the transport against a stub McpServer + stub AuthManager and
 * exercise the HTTP surface (health, metrics, server-card, /mcp auth gate,
 * OAuth pass-through). The MCP body itself is opaque to these tests —
 * we only verify the layer above transport.handleRequest().
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { connectStreamableHttp } from '../../src/server/transports/streamableHttp.js';
import { createMetricsRegistry } from '../../src/observability/metrics.js';

function makeAuth({ apiKey = 'cf-test', creator = false } = {}) {
  return {
    isCreatorMode: () => creator,
    getConfig: () => ({ apiKey })
  };
}
function quietLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

async function fetchPath(port, path, { method = 'GET', headers = {}, body } = {}) {
  const url = `http://localhost:${port}${path}`;
  return fetch(url, { method, headers, body });
}

async function startServer(opts = {}) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const auth = opts.auth ?? makeAuth();
  const logger = quietLogger();
  // Pick a random port by passing 0
  const port = 0;
  const { httpServer, transport } = await connectStreamableHttp(server, auth, logger, {
    port,
    host: '127.0.0.1',
    legacy: opts.legacy === true,
    oauth: opts.oauth ?? null,
    metrics: opts.metrics ?? null
  });
  // listen(0) — read actual port off the http server
  const actualPort = httpServer.address().port;
  return { server, httpServer, transport, port: actualPort, auth };
}

async function close(env) {
  await new Promise((resolve) => env.httpServer.close(resolve));
  await env.transport.close?.();
  await env.server.close?.();
}

test('GET /health returns 200 with mode', async () => {
  const env = await startServer();
  try {
    const res = await fetchPath(env.port, '/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.mode, 'streamable-stateful');
  } finally {
    await close(env);
  }
});

test('GET /health in legacy mode reports legacy-stateless', async () => {
  const env = await startServer({ legacy: true });
  try {
    const res = await fetchPath(env.port, '/health');
    const body = await res.json();
    assert.equal(body.mode, 'legacy-stateless');
  } finally {
    await close(env);
  }
});

test('GET /metrics returns 404 when metrics disabled', async () => {
  const env = await startServer();
  try {
    const res = await fetchPath(env.port, '/metrics');
    assert.equal(res.status, 404);
  } finally {
    await close(env);
  }
});

test('GET /metrics returns Prometheus exposition when enabled', async () => {
  const metrics = createMetricsRegistry();
  metrics.incCounter('crawlforge_tool_requests_total', { tool: 'x', outcome: 'success' });
  const env = await startServer({ metrics });
  try {
    const res = await fetchPath(env.port, '/metrics');
    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type');
    assert.match(ct, /text\/plain/);
    const body = await res.text();
    assert.match(body, /crawlforge_tool_requests_total\{.*outcome="success".*tool="x".*\} 1/);
  } finally {
    await close(env);
  }
});

test('GET /.well-known/mcp/server-card.json returns Smithery card', async () => {
  const env = await startServer();
  try {
    const res = await fetchPath(env.port, '/.well-known/mcp/server-card.json');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.transport.type, 'streamable-http');
    assert.equal(body.transport.url, '/mcp');
  } finally {
    await close(env);
  }
});

test('POST /mcp without auth → 401', async () => {
  const env = await startServer();
  try {
    const res = await fetchPath(env.port, '/mcp', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Unauthorized');
  } finally {
    await close(env);
  }
});

test('POST /mcp with wrong API key → 401', async () => {
  const env = await startServer();
  try {
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json', authorization: 'Bearer NOPE' }
    });
    assert.equal(res.status, 401);
  } finally {
    await close(env);
  }
});

test('creator mode skips auth on /mcp', async () => {
  const env = await startServer({ auth: makeAuth({ creator: true }) });
  try {
    // No auth header at all — should pass auth gate and hit transport.handleRequest
    // which will respond with some MCP error (we just need NOT 401).
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body: '{"jsonrpc":"2.0","method":"ping","id":1}',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    });
    assert.notEqual(res.status, 401);
  } finally {
    await close(env);
  }
});

test('OAuth pass-through: /.well-known/oauth-authorization-server reaches provider', async () => {
  let handled = false;
  const fakeOauth = {
    matches: (url, method) => url === '/.well-known/oauth-authorization-server' && method === 'GET',
    handle: async (_req, res) => {
      handled = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ issuer: 'http://x' }));
    },
    validateBearer: async () => ({ ok: false })
  };
  const env = await startServer({ oauth: fakeOauth });
  try {
    const res = await fetchPath(env.port, '/.well-known/oauth-authorization-server');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.issuer, 'http://x');
    assert.equal(handled, true);
  } finally {
    await close(env);
  }
});

test('OAuth bearer accepted for /mcp when static key does not match', async () => {
  const fakeOauth = {
    matches: () => false,
    handle: async () => {},
    validateBearer: async (token) => token === 'good-token' ? { ok: true, mappedApiKey: 'cf-test' } : { ok: false }
  };
  const env = await startServer({ oauth: fakeOauth });
  try {
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body: '{"jsonrpc":"2.0","method":"ping","id":1}',
      headers: { 'content-type': 'application/json', authorization: 'Bearer good-token', accept: 'application/json, text/event-stream' }
    });
    assert.notEqual(res.status, 401, 'OAuth-validated bearer must NOT be 401');
  } finally {
    await close(env);
  }
});

test('OPTIONS preflight returns 204 + CORS headers', async () => {
  const env = await startServer();
  try {
    const res = await fetchPath(env.port, '/mcp', { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-headers') ?? '', /Mcp-Session-Id/);
  } finally {
    await close(env);
  }
});

test('Unknown path returns 404', async () => {
  const env = await startServer();
  try {
    const res = await fetchPath(env.port, '/nope');
    assert.equal(res.status, 404);
  } finally {
    await close(env);
  }
});

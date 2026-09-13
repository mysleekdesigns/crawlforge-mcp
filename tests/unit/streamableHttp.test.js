/**
 * Unit tests for src/server/transports/streamableHttp.js (v3.2.0, C1).
 *
 * Run: node --test tests/unit/streamableHttp.test.js
 *
 * We mount the transport against a stub McpServer + stub AuthManager and
 * exercise the HTTP surface (health, metrics, server-card, /mcp auth gate,
 * OAuth pass-through). Most of the MCP body is opaque to these tests — we
 * verify the layer above transport.handleRequest(), plus (since 4.2) that the
 * dual-era routing sends each era to the right leg.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from "@modelcontextprotocol/server";
import { z } from 'zod';
import { connectStreamableHttp } from '../../src/server/transports/streamableHttp.js';
import { applySpecHygiene } from '../../src/server/specHygiene.js';
import { internalOwnerToken, isInternalRequest, servingEra, servingServer } from '../../src/server/requestContext.js';
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

// timeoutMs guards tests that exercise the "second request" failure modes below:
// against the old single-shared-transport code, some of these requests never
// resolve (unhandled rejection inside the http server's request callback, no
// response ever written) rather than erroring, which would otherwise hang the
// whole suite. 5s is generous for a local stub server.
async function fetchPath(port, path, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}) {
  const url = `http://localhost:${port}${path}`;
  return fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
}

const jsonRpcHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

function initializeBody(id) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  });
}

/**
 * A 2026-07-28 per-request envelope. Every modern request carries one in
 * `params._meta`; its absence is what makes a request 2025-era.
 */
const MODERN_ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {}
};

/** A 2026-era request body + the SEP-2243 headers the SDK cross-checks against it. */
function modernRequest(id, method, params = {}) {
  const headers = { ...jsonRpcHeaders, 'mcp-method': method };
  if (typeof params.name === 'string') headers['mcp-name'] = params.name;
  return {
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: MODERN_ENVELOPE } })
  };
}

async function startServer(opts = {}) {
  const server = opts.server ?? new McpServer({ name: 'test', version: '0.0.0' });
  const auth = opts.auth ?? makeAuth();
  const logger = quietLogger();
  // Pick a random port by passing 0
  const port = 0;
  const handle = await connectStreamableHttp(server, auth, logger, {
    port,
    host: '127.0.0.1',
    oauth: opts.oauth ?? null,
    metrics: opts.metrics ?? null
  });
  // listen(0) — read actual port off the http server
  const actualPort = handle.httpServer.address().port;
  return { server, handle, httpServer: handle.httpServer, port: actualPort, auth };
}

async function close(env) {
  // The handle's own close() tears down live sessions and the modern leg's
  // in-flight instances before closing the listener.
  await env.handle.close();
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

// 4.2: /health reports the protocol revisions served. Render's probe and the
// release checks read `status`/`version`/`mode`, so those stay alongside it.
test('GET /health reports both eras protocol versions', async () => {
  const env = await startServer();
  try {
    const res = await fetchPath(env.port, '/health');
    const body = await res.json();
    assert.ok(Array.isArray(body.protocolVersions), 'protocolVersions is an array');
    assert.equal(body.protocolVersions[0], '2026-07-28', 'modern revision first');
    assert.ok(body.protocolVersions.includes('2025-06-18'), 'the 2025 era is still served');
    assert.ok(body.version, 'version is still reported');
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

// ─── Session lifecycle (stateful mode) ──────────────────────────────────────
// The SDK's StreamableHTTPServerTransport rejects a second 'initialize' on the
// SAME transport instance with 400 "Server already initialized". A correct
// stateful implementation must hand each new session its own transport (a
// sessionId -> transport map), so concurrent/repeat/reconnect initializes each
// succeed with their own distinct Mcp-Session-Id. Auth is bypassed (creator
// mode) so these tests isolate transport/session behavior from the auth gate.

test('stateful mode: two concurrent initialize requests each succeed with distinct sessions', async () => {
  const env = await startServer({ auth: makeAuth({ creator: true }) });
  try {
    const [res1, res2] = await Promise.all([
      fetchPath(env.port, '/mcp', { method: 'POST', body: initializeBody(1), headers: jsonRpcHeaders }),
      fetchPath(env.port, '/mcp', { method: 'POST', body: initializeBody(2), headers: jsonRpcHeaders })
    ]);
    assert.equal(res1.status, 200, 'first initialize succeeds');
    assert.equal(res2.status, 200, 'second, concurrent initialize succeeds (not "Server already initialized")');
    const session1 = res1.headers.get('mcp-session-id');
    const session2 = res2.headers.get('mcp-session-id');
    assert.ok(session1, 'first response carries a session id');
    assert.ok(session2, 'second response carries a session id');
    assert.notEqual(session1, session2, 'concurrent initializes get distinct sessions');
  } finally {
    await close(env);
  }
});

test('stateful mode: re-initializing after a prior session (client reconnect) succeeds', async () => {
  const env = await startServer({ auth: makeAuth({ creator: true }) });
  try {
    const res1 = await fetchPath(env.port, '/mcp', { method: 'POST', body: initializeBody(1), headers: jsonRpcHeaders });
    assert.equal(res1.status, 200);
    const session1 = res1.headers.get('mcp-session-id');
    assert.ok(session1);

    // A second, independent client initializing (e.g. after the first dropped
    // its connection without sending DELETE) must not be rejected by whatever
    // served the first session.
    const res2 = await fetchPath(env.port, '/mcp', { method: 'POST', body: initializeBody(2), headers: jsonRpcHeaders });
    assert.equal(res2.status, 200, 're-initialize after a prior session must still succeed');
    const session2 = res2.headers.get('mcp-session-id');
    assert.ok(session2);
    assert.notEqual(session2, session1, 'reconnect gets a fresh session id');
  } finally {
    await close(env);
  }
});

test('stateful mode: DELETE terminates a session, then a fresh initialize still succeeds', async () => {
  const env = await startServer({ auth: makeAuth({ creator: true }) });
  try {
    const res1 = await fetchPath(env.port, '/mcp', { method: 'POST', body: initializeBody(1), headers: jsonRpcHeaders });
    assert.equal(res1.status, 200);
    const session1 = res1.headers.get('mcp-session-id');
    assert.ok(session1);

    const delRes = await fetchPath(env.port, '/mcp', {
      method: 'DELETE',
      headers: { ...jsonRpcHeaders, 'mcp-session-id': session1 }
    });
    assert.notEqual(delRes.status, 401);
    assert.ok(delRes.status < 500, `DELETE should not 5xx (got ${delRes.status})`);

    const res2 = await fetchPath(env.port, '/mcp', { method: 'POST', body: initializeBody(2), headers: jsonRpcHeaders });
    assert.equal(res2.status, 200, 'fresh initialize after DELETE must succeed');
    const session2 = res2.headers.get('mcp-session-id');
    assert.ok(session2);
    assert.notEqual(session2, session1, 'the post-DELETE session is a new one, not the terminated one');
  } finally {
    await close(env);
  }
});

// ─── Modern (2026-07-28) stateless leg: multiple requests must not hang ────
// Was 'legacy mode: a second and third request each get a proper response'.
// The `--legacy-http` stateless mode this exercised is gone (4.2); the same
// hazard now lives on the modern leg, which is also stateless and also builds
// a fresh instance per request. A stale-instance reuse bug there would show up
// as a hang, which fetchPath's timeout surfaces as a rejected fetch.

test('modern leg: a second and third stateless request each get a proper response, no hang', async () => {
  const env = await startServer({ server: makeEchoToolServer(), auth: makeAuth({ creator: true }) });
  try {
    const send = (id) => {
      const { headers, body } = modernRequest(id, 'tools/list');
      return fetchPath(env.port, '/mcp', { method: 'POST', body, headers });
    };

    const res1 = await send(1);
    assert.equal(res1.status, 200, 'first request succeeds');

    const res2 = await send(2);
    assert.equal(res2.status, 200, 'second request must get a real response, not hang');

    const res3 = await send(3);
    assert.equal(res3.status, 200, 'third request must also get a real response');
  } finally {
    await close(env);
  }
});

// ─── Tool calls over stateful HTTP sessions ─────────────────────────────────
// Session servers are clones of the template (cloneServerForSession), built by
// copying the SDK's internal `_registered*` tables and re-running its
// `set*RequestHandlers`. That reaches into SDK internals, so this test is the
// regression guard that a tools/call still completes over a real session after
// an SDK upgrade — it caught nothing on the v2 move only because v2 kept every
// field name; the next upgrade may not.

/** Parses a Streamable HTTP response body (plain JSON or single-response SSE). */
async function readRpcBody(res) {
  const text = await res.text();
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/event-stream')) {
    const dataLines = text.split('\n').filter((l) => l.startsWith('data: '));
    return JSON.parse(dataLines[dataLines.length - 1].slice('data: '.length));
  }
  return JSON.parse(text);
}

/** A template server registered the way server.js registers its tools. */
function makeEchoToolServer() {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.registerTool('slow_echo', {
    description: 'test tool',
    inputSchema: { text: z.string() }
  }, async (args) => ({ content: [{ type: 'text', text: `echo:${args.text}` }] }));
  return server;
}

test('stateful mode: a tool call completes over a session (clone carries the tool tables)', async () => {
  const env = await startServer({ server: makeEchoToolServer(), auth: makeAuth({ creator: true }) });
  try {
    const initRes = await fetchPath(env.port, '/mcp', { method: 'POST', body: initializeBody(1), headers: jsonRpcHeaders });
    assert.equal(initRes.status, 200);
    const sessionId = initRes.headers.get('mcp-session-id');
    assert.ok(sessionId);
    await initRes.text(); // drain

    const notifRes = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      headers: { ...jsonRpcHeaders, 'mcp-session-id': sessionId }
    });
    assert.ok(notifRes.status < 300);

    const callRes = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'slow_echo', arguments: { text: 'hi' } } }),
      headers: { ...jsonRpcHeaders, 'mcp-session-id': sessionId }
    });
    assert.equal(callRes.status, 200);
    const body = await readRpcBody(callRes);
    assert.equal(body.error, undefined, `tools/call must not error (got: ${JSON.stringify(body.error)})`);
    assert.equal(body.result?.content?.[0]?.text, 'echo:hi');
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

// ─── Internal proxy secret (X-Internal-Secret) ───────────────────────────────

test('POST /mcp with a valid X-Internal-Secret authenticates without an API key', async () => {
  process.env.INTERNAL_PROXY_SECRET = 'test-internal-secret';
  const env = await startServer();
  try {
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      headers: { ...jsonRpcHeaders, 'x-internal-secret': 'test-internal-secret' },
      body: initializeBody(1)
    });
    assert.equal(res.status, 200, 'internal secret passes the auth gate');
  } finally {
    delete process.env.INTERNAL_PROXY_SECRET;
    await close(env);
  }
});

test('POST /mcp with a wrong X-Internal-Secret is rejected, not passed to the key paths', async () => {
  process.env.INTERNAL_PROXY_SECRET = 'test-internal-secret';
  const env = await startServer();
  try {
    // Even a valid API key alongside a wrong internal secret must fail:
    // presenting the header claims internal identity, and that claim is false.
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      headers: {
        ...jsonRpcHeaders,
        'x-internal-secret': 'wrong-secret',
        authorization: 'Bearer cf-test'
      },
      body: initializeBody(1)
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Unauthorized');
  } finally {
    delete process.env.INTERNAL_PROXY_SECRET;
    await close(env);
  }
});

test('POST /mcp with X-Internal-Secret is rejected when the deployment has no secret configured', async () => {
  delete process.env.INTERNAL_PROXY_SECRET;
  const env = await startServer();
  try {
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      headers: { ...jsonRpcHeaders, 'x-internal-secret': 'anything' },
      body: initializeBody(1)
    });
    assert.equal(res.status, 401, 'header without configured secret never authenticates');
  } finally {
    await close(env);
  }
});

// ─── Dual-era routing (4.2) ─────────────────────────────────────────────────
// The same /mcp route serves both protocol eras: a request carrying the
// 2026-07-28 `_meta` envelope is answered statelessly by createMcpHandler, one
// without it by the sessionful 2025 path. Every check below runs against the
// SAME listening server, so the routing itself is under test, not two configs.

test('dual-era: a 2026-era tools/list resolves with no session id', async () => {
  const env = await startServer({ server: makeEchoToolServer(), auth: makeAuth({ creator: true }) });
  try {
    const { headers, body } = modernRequest(1, 'tools/list');
    const res = await fetchPath(env.port, '/mcp', { method: 'POST', body, headers });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('mcp-session-id'), null, 'the modern era is stateless — no session issued');
    const rpc = await readRpcBody(res);
    assert.equal(rpc.error, undefined, `tools/list must not error (got: ${JSON.stringify(rpc.error)})`);
    assert.equal(rpc.result.tools[0].name, 'slow_echo');
  } finally {
    await close(env);
  }
});

test('dual-era: a 2026-era tools/call resolves with no session id', async () => {
  const env = await startServer({ server: makeEchoToolServer(), auth: makeAuth({ creator: true }) });
  try {
    const { headers, body } = modernRequest(2, 'tools/call', { name: 'slow_echo', arguments: { text: 'hi' } });
    const res = await fetchPath(env.port, '/mcp', { method: 'POST', body, headers });
    assert.equal(res.status, 200);
    const rpc = await readRpcBody(res);
    assert.equal(rpc.error, undefined, `tools/call must not error (got: ${JSON.stringify(rpc.error)})`);
    assert.equal(rpc.result.content[0].text, 'echo:hi');
  } finally {
    await close(env);
  }
});

test('dual-era: a 2025-era session still works alongside the modern leg', async () => {
  const env = await startServer({ server: makeEchoToolServer(), auth: makeAuth({ creator: true }) });
  try {
    // Modern first, so the 2025 session is opened on a server that has already
    // served a stateless request.
    const modern = modernRequest(1, 'tools/list');
    const modernRes = await fetchPath(env.port, '/mcp', { method: 'POST', body: modern.body, headers: modern.headers });
    assert.equal(modernRes.status, 200);
    await modernRes.text();

    const initRes = await fetchPath(env.port, '/mcp', { method: 'POST', body: initializeBody(2), headers: jsonRpcHeaders });
    assert.equal(initRes.status, 200);
    const sessionId = initRes.headers.get('mcp-session-id');
    assert.ok(sessionId, 'the 2025 era still issues a session id');
    await initRes.text();

    const callRes = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'slow_echo', arguments: { text: 'legacy' } } }),
      headers: { ...jsonRpcHeaders, 'mcp-session-id': sessionId }
    });
    assert.equal(callRes.status, 200);
    const rpc = await readRpcBody(callRes);
    assert.equal(rpc.result?.content?.[0]?.text, 'echo:legacy');
  } finally {
    await close(env);
  }
});

// Auth is the single biggest regression risk of the dual-era split: it must run
// BEFORE era routing, so a keyless request is refused identically on both legs.
test('dual-era: a 2026-era request with no API key is refused exactly like a 2025-era one', async () => {
  const env = await startServer();
  try {
    const modern = modernRequest(1, 'tools/list');
    const modernRes = await fetchPath(env.port, '/mcp', { method: 'POST', body: modern.body, headers: modern.headers });
    assert.equal(modernRes.status, 401, 'modern era refuses without a key');
    assert.equal((await modernRes.json()).error, 'Unauthorized');

    const legacyRes = await fetchPath(env.port, '/mcp', { method: 'POST', body: initializeBody(1), headers: jsonRpcHeaders });
    assert.equal(legacyRes.status, 401, '2025 era refuses without a key');
    assert.equal((await legacyRes.json()).error, 'Unauthorized');
  } finally {
    await close(env);
  }
});

test('dual-era: a valid API key is accepted on the modern leg', async () => {
  const env = await startServer({ server: makeEchoToolServer() });
  try {
    const { headers, body } = modernRequest(1, 'tools/list');
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body,
      headers: { ...headers, authorization: 'Bearer cf-test' }
    });
    assert.equal(res.status, 200);
    const rpc = await readRpcBody(res);
    assert.equal(rpc.error, undefined);
  } finally {
    await close(env);
  }
});

// The SDK owns these two rejections (validateStandardRequestHeaders /
// classifyInboundRequest). The assertions are here to prove the composition
// actually routes into them, not to re-implement the checks.
test('dual-era: a Mcp-Method header disagreeing with the body is rejected -32020', async () => {
  const env = await startServer({ server: makeEchoToolServer(), auth: makeAuth({ creator: true }) });
  try {
    const { headers, body } = modernRequest(1, 'tools/list');
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body,
      headers: { ...headers, 'mcp-method': 'tools/call' }
    });
    assert.equal(res.status, 400);
    const rpc = await res.json();
    assert.equal(rpc.error.code, -32020);
    assert.match(rpc.error.message, /headers and body disagree/);
  } finally {
    await close(env);
  }
});

test('dual-era: a Mcp-Name header disagreeing with the body is rejected -32020', async () => {
  const env = await startServer({ server: makeEchoToolServer(), auth: makeAuth({ creator: true }) });
  try {
    const { headers, body } = modernRequest(1, 'tools/call', { name: 'slow_echo', arguments: { text: 'hi' } });
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body,
      headers: { ...headers, 'mcp-name': 'other_tool' }
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, -32020);
  } finally {
    await close(env);
  }
});

test('dual-era: a non-JSON Content-Type on a modern request is rejected 415', async () => {
  const env = await startServer({ auth: makeAuth({ creator: true }) });
  try {
    const { body } = modernRequest(1, 'tools/list');
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body,
      headers: { 'content-type': 'text/plain', accept: 'application/json, text/event-stream', 'mcp-method': 'tools/list' }
    });
    assert.equal(res.status, 415);
  } finally {
    await close(env);
  }
});

// ─── 4.6: server/discover cache hint + list ordering ────────────────────────

test('4.6: server/discover carries the ttlMs / cacheScope cache hint', async () => {
  const env = await startServer({ server: makeEchoToolServer(), auth: makeAuth({ creator: true }) });
  try {
    const { headers, body } = modernRequest(1, 'server/discover');
    const res = await fetchPath(env.port, '/mcp', { method: 'POST', body, headers });
    assert.equal(res.status, 200);
    const rpc = await readRpcBody(res);
    assert.equal(rpc.error, undefined, `server/discover must not error (got: ${JSON.stringify(rpc.error)})`);
    assert.equal(rpc.result.ttlMs, 300000, 'ttlMs comes from the configured cache hint, not the 0 default');
    assert.equal(rpc.result.cacheScope, 'public', 'cacheScope comes from the hint, not the private default');
  } finally {
    await close(env);
  }
});

// Pins the hard-coded MODERN_PROTOCOL_VERSIONS in streamableHttp.js against the
// SDK's own (unexported) modern list: an SDK upgrade that adds a revision fails
// here instead of leaving /health quietly wrong.
test('4.6: server/discover supportedVersions match what /health advertises', async () => {
  const env = await startServer({ server: makeEchoToolServer(), auth: makeAuth({ creator: true }) });
  try {
    const { headers, body } = modernRequest(1, 'server/discover');
    const res = await fetchPath(env.port, '/mcp', { method: 'POST', body, headers });
    const rpc = await readRpcBody(res);

    const health = await (await fetchPath(env.port, '/health')).json();
    const modernFromHealth = health.protocolVersions.filter((v) => v >= '2026-07-28');
    assert.deepEqual(rpc.result.supportedVersions, modernFromHealth);
  } finally {
    await close(env);
  }
});

// 4.6 keeps the ten SEP-2549 cacheable tools/call markers and specHygiene's
// deterministic ordering. Both live on wrappers applied to the template's own
// Protocol instance, so they only reach an HTTP client if cloneServerForSession
// re-applies them to each per-session / per-request clone.
test('4.6: session clones keep specHygiene ordering and the tools/call cache marker', async () => {
  const server = makeEchoToolServer();
  server.registerTool('fetch_url', {
    description: 'cacheable read-only tool',
    inputSchema: { url: z.string() }
  }, async () => ({ content: [{ type: 'text', text: 'ok' }] }));
  applySpecHygiene(server);

  const env = await startServer({ server, auth: makeAuth({ creator: true }) });
  try {
    const initRes = await fetchPath(env.port, '/mcp', { method: 'POST', body: initializeBody(1), headers: jsonRpcHeaders });
    const sessionId = initRes.headers.get('mcp-session-id');
    await initRes.text();

    const listRes = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      headers: { ...jsonRpcHeaders, 'mcp-session-id': sessionId }
    });
    const names = (await readRpcBody(listRes)).result.tools.map((t) => t.name);
    assert.deepEqual(names, [...names].sort(), 'tools/list is alphabetically ordered over a session');

    const callRes = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fetch_url', arguments: { url: 'https://example.com' } } }),
      headers: { ...jsonRpcHeaders, 'mcp-session-id': sessionId }
    });
    const hint = (await readRpcBody(callRes)).result._meta?.['io.modelcontextprotocol/cacheable'];
    assert.deepEqual(hint, { ttlMs: 300000, cacheScope: 'private' });
  } finally {
    await close(env);
  }
});

// The internal-proxy billing exemption rides on AsyncLocalStorage
// (requestContext), set before era routing and read inside the tool handler.
// The modern leg adds two hops (toNodeHandler -> handler.fetch -> factory), so
// this asserts the context still reaches the handler on that path — losing it
// would silently double-bill every website REST proxy call.
test('dual-era: the internal-proxy request context reaches a tool handler on the modern leg', async () => {
  process.env.INTERNAL_PROXY_SECRET = 'test-internal-secret';
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.registerTool('report_context', {
    description: 'reports the request context flag',
    inputSchema: {}
  }, async () => ({ content: [{ type: 'text', text: String(isInternalRequest()) }] }));

  const env = await startServer({ server });
  try {
    const { headers, body } = modernRequest(1, 'tools/call', { name: 'report_context', arguments: {} });
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body,
      headers: { ...headers, 'x-internal-secret': 'test-internal-secret' }
    });
    assert.equal(res.status, 200);
    const rpc = await readRpcBody(res);
    assert.equal(rpc.result.content[0].text, 'true', 'isInternalRequest() must be true inside the handler');
  } finally {
    delete process.env.INTERNAL_PROXY_SECRET;
    await close(env);
  }
});

// ── The per-user owner token (X-CrawlForge-Owner) ─────────────────────────────
//
// The internal secret says which SERVICE is calling; this header says which of
// that service's customers it is calling for, and browser_session binds a live
// browser page to the answer. Two properties are load-bearing, and both are
// decided here rather than in the tool: the header is honoured ONLY on a
// request that already proved the internal secret, and a value that is not
// plain bounded hex is treated as absent — never coerced into a tenant key.

/** A template server whose one tool reports the owner token the context resolved to. */
function makeOwnerProbeServer() {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.registerTool('report_owner', {
    description: 'reports the owner token on the request context',
    inputSchema: {}
  }, async () => ({ content: [{ type: 'text', text: String(internalOwnerToken()) }] }));
  return server;
}

/** What internalOwnerToken() resolves to inside a handler, for these request headers. */
async function ownerTokenSeenBy(extraHeaders) {
  const env = await startServer({ server: makeOwnerProbeServer() });
  try {
    const { headers, body } = modernRequest(1, 'tools/call', { name: 'report_owner', arguments: {} });
    const res = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      body,
      headers: { ...headers, ...extraHeaders }
    });
    assert.equal(res.status, 200);
    return (await readRpcBody(res)).result.content[0].text;
  } finally {
    await close(env);
  }
}

test('owner token: a valid header on an internal request reaches the tool handler', async () => {
  process.env.INTERNAL_PROXY_SECRET = 'test-internal-secret';
  const token = 'a'.repeat(32);
  try {
    const seen = await ownerTokenSeenBy({
      'x-internal-secret': 'test-internal-secret',
      'x-crawlforge-owner': token
    });
    assert.equal(seen, token);
  } finally {
    delete process.env.INTERNAL_PROXY_SECRET;
  }
});

test('owner token: a malformed value is absent, never a strange owner', async () => {
  process.env.INTERNAL_PROXY_SECRET = 'test-internal-secret';
  const rejected = {
    'non-hex characters': 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
    'uppercase hex': 'A'.repeat(32),
    'too short': 'abc',
    'oversized': 'a'.repeat(4096),
    'a path fragment': '../'.repeat(11),
    'empty': ''
  };
  try {
    for (const [why, value] of Object.entries(rejected)) {
      const seen = await ownerTokenSeenBy({
        'x-internal-secret': 'test-internal-secret',
        'x-crawlforge-owner': value
      });
      assert.equal(seen, 'null', `${why}: must be treated as no owner at all`);
    }
    // Absent is the same answer, which is the point — the tool cannot tell a
    // malformed token from a missing one, and refuses either way.
    const absent = await ownerTokenSeenBy({ 'x-internal-secret': 'test-internal-secret' });
    assert.equal(absent, 'null');
  } finally {
    delete process.env.INTERNAL_PROXY_SECRET;
  }
});

test('owner token: a request that did not prove the internal secret cannot claim an owner', async () => {
  // A perfectly well-formed token, presented by an ordinary API-key caller.
  // Honouring it would let anyone with a key name any customer's tenant.
  const seen = await ownerTokenSeenBy({
    authorization: 'Bearer cf-test',
    'x-crawlforge-owner': 'a'.repeat(32)
  });
  assert.equal(seen, 'null', 'the owner header is only ever read on the internal-secret branch');
});

// ── The serving instance (elicitation over HTTP) ──────────────────────────────
//
// Neither leg serves from the template McpServer: the 2025-era path connects a
// clone per session, the modern leg builds one per request. Only a connected
// clone knows the negotiated protocol version and the client's declared
// capabilities, so anything reading those off the template (ElicitationHelper)
// got undefined on every HTTP request. Both legs now stamp the serving clone on
// the request context — these two assert it arrives, and that it is NOT the
// template.

/** A template server whose one tool reports what the request context resolved to. */
function makeServingProbeServer() {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.registerTool('report_serving', {
    description: 'reports the serving instance from the request context',
    inputSchema: {}
  }, async () => {
    const resolved = servingServer();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          era: servingEra(),
          resolved: resolved !== null,
          isTemplate: resolved === server,
          negotiated: resolved?.server?.getNegotiatedProtocolVersion?.() ?? null,
          clientCapabilities: resolved?.server?.getClientCapabilities?.() ?? null,
          templateNegotiated: server.server.getNegotiatedProtocolVersion?.() ?? null
        })
      }]
    };
  });
  return server;
}

test('serving instance: the 2025-era session clone reaches the tool handler, not the template', async () => {
  const server = makeServingProbeServer();
  const env = await startServer({ server, auth: makeAuth({ creator: true }) });
  try {
    const initRes = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      headers: jsonRpcHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          // A bare `elicitation: {}` — the pre-mode 2025 meaning is form.
          capabilities: { elicitation: {} },
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      })
    });
    const sessionId = initRes.headers.get('mcp-session-id');
    await initRes.text();

    const callRes = await fetchPath(env.port, '/mcp', {
      method: 'POST',
      headers: { ...jsonRpcHeaders, 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'report_serving', arguments: {} } })
    });
    const seen = JSON.parse((await readRpcBody(callRes)).result.content[0].text);

    assert.equal(seen.resolved, true, 'a serving instance was stamped');
    assert.equal(seen.isTemplate, false, 'it is the session clone, not the template');
    assert.equal(seen.era, 'legacy');
    assert.equal(seen.negotiated, '2025-11-25', 'the clone knows the negotiated revision');
    // The SDK normalises a bare 2025 `elicitation: {}` to `{ form: {} }`; either
    // shape satisfies ElicitationHelper's formElicitationDeclared().
    assert.deepEqual(seen.clientCapabilities, { elicitation: { form: {} } }, 'the clone knows what the client declared');
    assert.equal(seen.templateNegotiated, null, 'the template is still never connected — the bug this fixes');
  } finally {
    await close(env);
  }
});

test('serving instance: the modern leg stamps its per-request clone and reports the modern era', async () => {
  const server = makeServingProbeServer();
  const env = await startServer({ server, auth: makeAuth({ creator: true }) });
  try {
    const { headers, body } = modernRequest(1, 'tools/call', { name: 'report_serving', arguments: {} });
    const res = await fetchPath(env.port, '/mcp', { method: 'POST', body, headers });
    const seen = JSON.parse((await readRpcBody(res)).result.content[0].text);

    assert.equal(seen.resolved, true);
    assert.equal(seen.isTemplate, false);
    assert.equal(seen.era, 'modern');
    assert.equal(seen.negotiated, '2026-07-28', 'a modern serving instance reports the modern revision');
    assert.equal(seen.templateNegotiated, null);
  } finally {
    await close(env);
  }
});

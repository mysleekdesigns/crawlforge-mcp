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
import { z } from 'zod';
import { connectStreamableHttp } from '../../src/server/transports/streamableHttp.js';
import { createMetricsRegistry } from '../../src/observability/metrics.js';
import { createTaskStore, TASK_EXECUTION, TASKS_CAPABILITY, makeTaskToolHandler } from '../../src/server/taskSupport.js';

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

function pingBody(id) {
  return JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' });
}

async function startServer(opts = {}) {
  const server = opts.server ?? new McpServer({ name: 'test', version: '0.0.0' });
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
  // env.transport may no longer be a single shared instance once the target
  // per-session/per-request transport rewrite lands — stay defensive.
  await env.transport?.close?.();
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

// ─── Legacy stateless mode: multiple requests must not hang ────────────────
// The SDK throws 'Stateless transport cannot be reused across requests' when
// the same sessionIdGenerator:undefined transport handles a second request.
// The old streamableHttp.js code had no try/catch around
// transport.handleRequest(), so that throw was an unhandled rejection and the
// second request's response was NEVER written — a hang, not an error. The
// fix is a fresh transport per request. fetchPath's timeout keeps a hang from
// blocking the suite; a hang shows up here as a rejected/aborted fetch.

test('legacy mode: a second and third request each get a proper response, no hang', async () => {
  const env = await startServer({ legacy: true, auth: makeAuth({ creator: true }) });
  try {
    const send = (id) => fetchPath(env.port, '/mcp', { method: 'POST', body: pingBody(id), headers: jsonRpcHeaders });

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

// ─── Task-capable tools over stateful HTTP sessions ─────────────────────────
// Session servers are clones of the template (cloneServerForSession); the clone
// must inherit the template's taskStore or every tools/call on a task-capable
// tool (crawl_deep, batch_scrape, deep_research, agent) dies with the SDK's
// 'No task store provided for task-capable tool.'

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

/** A template server registered the way server.js registers agent & friends. */
function makeTaskToolServer() {
  const taskStore = createTaskStore({});
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { taskStore });
  server.server.registerCapabilities(TASKS_CAPABILITY);
  server.experimental.tasks.registerToolTask('slow_echo', {
    description: 'test task tool',
    inputSchema: { text: z.string() },
    execution: TASK_EXECUTION
  }, makeTaskToolHandler({
    name: 'slow_echo',
    run: async (args) => ({ content: [{ type: 'text', text: `echo:${args.text}` }] }),
    taskStore,
    logger: quietLogger()
  }));
  return server;
}

test('stateful mode: a task-capable tool completes over a session (clone inherits taskStore)', async () => {
  const env = await startServer({ server: makeTaskToolServer(), auth: makeAuth({ creator: true }) });
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

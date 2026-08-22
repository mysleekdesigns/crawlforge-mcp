/**
 * Streamable HTTP transport (MCP spec 2025-06-18).
 *
 * Single endpoint at /mcp:
 *   - POST /mcp           — JSON-RPC request, response as JSON or SSE stream
 *   - GET  /mcp           — SSE stream for server → client notifications
 *   - DELETE /mcp         — terminate session
 *
 * Session resumption:
 *   - Server generates a session id and returns it as `Mcp-Session-Id` on init
 *   - Clients re-send `Mcp-Session-Id` on subsequent requests to resume state
 *
 * Auth:
 *   - Bearer / X-API-Key required per request (creator mode bypasses)
 *   - When OAuth is enabled (CRAWLFORGE_OAUTH_ENABLED=true), OAuth bearer
 *     tokens are validated by the OAuth provider and mapped server-side to
 *     a CrawlForge API key. See src/server/auth/oauth.js.
 *
 * Observability:
 *   - GET /metrics returns Prometheus exposition (when observability enabled)
 *   - GET /health returns liveness probe
 *
 * Replaces the legacy stateless http.js. Old /mcp endpoint behavior is
 * preserved when CRAWLFORGE_LEGACY_HTTP=true (one-release deprecation window);
 * `http.js`'s connectHttp() forwards straight into this module's legacy mode.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const SERVER_VERSION = pkg.version;

/**
 * Build the `tools` array for the Smithery static server card, straight from
 * the live tool registry.
 *
 * Smithery scans a published server to populate its listing, but our /mcp
 * endpoint 401s without a key, so the scan cannot enumerate anything. Their
 * documented fallback is a static server card carrying the metadata — and a
 * card with no `tools` leaves the listing showing whatever was typed in by
 * hand at publish time, which is how it goes stale.
 *
 * Deriving it here means the card tracks the registry on every release instead
 * of drifting. Tool `inputSchema`s are registered as ZodRawShapes, so wrap
 * before converting; a tool whose schema will not convert is still listed,
 * with an open object schema, rather than dropped.
 */
function buildToolCards(server) {
  const registered = server?._registeredTools ?? {};
  return Object.entries(registered)
    .filter(([, tool]) => tool?.enabled !== false)
    .map(([name, tool]) => {
      let inputSchema = { type: 'object', properties: {} };
      try {
        const shape = tool?.inputSchema;
        if (shape) {
          const zodObject = typeof shape?.safeParse === 'function' ? shape : z.object(shape);
          const converted = zodToJsonSchema(zodObject, { $refStrategy: 'none' });
          delete converted.$schema;
          inputSchema = converted;
        }
      } catch {
        // Keep the tool visible with an open schema rather than hiding it.
      }
      const card = { name, description: tool?.description ?? tool?.annotations?.title ?? '', inputSchema };
      if (tool?.annotations) card.annotations = tool.annotations;
      return card;
    });
}

/**
 * The MCP SDK's Protocol.connect() allows at most one active transport per
 * Server/McpServer instance (it throws 'Already connected to a transport'
 * otherwise), and each StreamableHTTPServerTransport instance represents
 * exactly one session. So genuine multi-session support needs one McpServer
 * per session, not just one transport per session.
 *
 * connectStreamableHttp() only receives a single already-configured McpServer
 * (all 27 tools/resources/prompts registered by server.js before this runs),
 * so instead of re-running that registration per session, this clones a
 * fresh McpServer and copies over the already-registered tool/resource/
 * prompt tables — plain config + handler-closure references, no per-connection
 * state — then re-runs the same internal handler-wiring methods McpServer
 * itself calls from registerTool/registerResource/registerPrompt. This
 * depends on @modelcontextprotocol/sdk 1.29.0's internal McpServer field
 * names (`_registered*`, `set*RequestHandlers`); re-check on SDK upgrades.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} templateServer
 */
function cloneServerForSession(templateServer) {
  const low = templateServer.server;
  const sessionServer = new McpServer(low._serverInfo, { instructions: low._instructions });

  sessionServer._registeredTools = templateServer._registeredTools;
  sessionServer._registeredResources = templateServer._registeredResources;
  sessionServer._registeredResourceTemplates = templateServer._registeredResourceTemplates;
  sessionServer._registeredPrompts = templateServer._registeredPrompts;

  if (templateServer._toolHandlersInitialized) sessionServer.setToolRequestHandlers();
  if (templateServer._resourceHandlersInitialized) sessionServer.setResourceRequestHandlers();
  if (templateServer._promptHandlersInitialized) sessionServer.setPromptRequestHandlers();
  if (templateServer._completionHandlerInitialized) sessionServer.setCompletionRequestHandler();

  return sessionServer;
}

/** Best-effort close — swallows errors so cleanup never throws into a request handler. */
function safeClose(closable) {
  if (closable && typeof closable.close === 'function') {
    Promise.resolve(closable.close()).catch(() => {});
  }
}

function sendRpcError(res, status, code, message) {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

/**
 * Stateful, session-aware Streamable HTTP transport.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('../../core/AuthManager.js').default} authManager
 * @param {import('../../utils/Logger.js').logger} logger
 * @param {object} [options]
 * @param {number} [options.port=3000]
 * @param {boolean} [options.legacy=false]  — if true, run in stateless mode (3.1 behavior)
 * @param {object} [options.oauth]          — OAuth provider (see src/server/auth/oauth.js)
 * @param {object} [options.metrics]        — Prometheus registry (see src/observability/metrics.js)
 */
export async function connectStreamableHttp(server, authManager, logger, options = {}) {
  const port = options.port ?? 3000;
  const host = options.host ?? '0.0.0.0';
  const legacy = options.legacy === true;
  const oauthProvider = options.oauth ?? null;
  const metrics = options.metrics ?? null;

  const mode = legacy ? 'legacy-stateless' : 'streamable-stateful';
  const toolCount = Object.keys(server._registeredTools ?? {}).length;

  // sessionId -> { transport, server }. One StreamableHTTPServerTransport (and
  // therefore one cloned McpServer — see cloneServerForSession) per session.
  const sessions = new Map();

  const httpServer = createServer(async (req, res) => {
    // CORS — Smithery + browser-based MCP clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, mcp-session-id, Authorization, X-API-Key');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health probe
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: SERVER_VERSION, mode }));
      return;
    }

    // Prometheus metrics endpoint
    if (req.url === '/metrics') {
      if (!metrics) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('metrics disabled — set OTEL_SDK_DISABLED=false to enable');
        return;
      }
      try {
        const body = await metrics.render();
        res.writeHead(200, { 'Content-Type': metrics.contentType });
        res.end(body);
      } catch (err) {
        logger.error('metrics render failed', { error: err?.message });
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('metrics error');
      }
      return;
    }

    // Smithery discovery
    if (req.url === '/.well-known/mcp/server-card.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        serverInfo: {
          name: 'crawlforge',
          version: SERVER_VERSION,
          description: `Production-ready MCP server with ${toolCount} web scraping, crawling, and content processing tools. Features stealth browsing, deep research, structured extraction, and change tracking.`,
          homepage: 'https://www.crawlforge.dev',
          icon: 'https://www.crawlforge.dev/icon.png'
        },
        transport: { type: 'streamable-http', url: '/mcp' },
        authentication: { required: true, schemes: ['apiKey'] },
        tools: buildToolCards(server),
        resources: [],
        prompts: [],
        configSchema: {
          type: 'object',
          properties: {
            apiKey: {
              type: 'string',
              title: 'CrawlForge API Key',
              description: 'Your CrawlForge API key. Get one free at https://www.crawlforge.dev/signup (includes 1,000 credits)',
              'x-from': { header: 'x-api-key' }
            }
          },
          required: ['apiKey']
        }
      }));
      return;
    }

    // OAuth 2.1 discovery + endpoints (only if OAuth is enabled)
    if (oauthProvider && oauthProvider.handle && oauthProvider.matches(req.url, req.method)) {
      await oauthProvider.handle(req, res);
      return;
    }

    // MCP endpoint
    if (req.url === '/mcp' || req.url === '/' || req.url?.startsWith('/mcp?')) {
      // Per-request auth (bypassed in creator mode)
      if (!authManager.isCreatorMode()) {
        const authResult = await authenticateRequest(req, authManager, oauthProvider);
        if (!authResult.ok) {
          logger.warn('Streamable HTTP request rejected', {
            reason: authResult.reason,
            remoteAddress: req.socket?.remoteAddress
          });
          res.writeHead(authResult.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: authResult.error,
            message: authResult.message
          }));
          return;
        }
      }

      if (legacy) {
        // Stateless mode: the SDK forbids reusing a transport (or its connected
        // Server) across requests, so build a fresh pair per request and always
        // end the response, even on failure.
        let sessionServer;
        let reqTransport;
        try {
          sessionServer = cloneServerForSession(server);
          reqTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          await sessionServer.connect(reqTransport);
          await reqTransport.handleRequest(req, res);
        } catch (err) {
          logger.error('Legacy Streamable HTTP request failed', { error: err?.message });
          sendRpcError(res, 500, -32603, 'Internal server error');
        } finally {
          res.on('close', () => {
            safeClose(reqTransport);
            safeClose(sessionServer);
          });
        }
        return;
      }

      // Stateful mode: route by Mcp-Session-Id. A request without the header
      // must be a fresh initialize, which gets its own transport + server pair
      // (independent of any prior session's lifecycle) so reconnects/re-inits
      // never hit a stuck 'already initialized' transport.
      const sessionIdHeader = req.headers['mcp-session-id'];
      const existing = sessionIdHeader ? sessions.get(String(sessionIdHeader)) : undefined;

      if (existing) {
        await existing.transport.handleRequest(req, res);
        return;
      }

      if (sessionIdHeader) {
        // Unknown/expired session id — nothing to route this to.
        sendRpcError(res, 404, -32001, 'Session not found');
        return;
      }

      if (req.method !== 'POST') {
        // GET/DELETE always require an existing session's Mcp-Session-Id.
        sendRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
        return;
      }

      const sessionServer = cloneServerForSession(server);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, { transport, server: sessionServer });
        },
        onsessionclosed: (sid) => {
          sessions.delete(sid);
        }
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };

      try {
        await sessionServer.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        logger.error('Streamable HTTP session initialization failed', { error: err?.message });
        safeClose(transport);
        safeClose(sessionServer);
        sendRpcError(res, 500, -32603, 'Internal server error');
      }
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      const actual = httpServer.address()?.port ?? port;
      console.error(`CrawlForge MCP Server v${SERVER_VERSION} listening on ${host}:${actual} (Streamable HTTP, ${mode})`);
      console.error(`MCP endpoint:   http://${host}:${actual}/mcp`);
      console.error(`Health check:   http://${host}:${actual}/health`);
      if (metrics) console.error(`Metrics:        http://${host}:${actual}/metrics`);
      if (oauthProvider) console.error(`OAuth discovery: http://${host}:${actual}/.well-known/oauth-authorization-server`);
      resolve();
    });
  });

  return {
    httpServer,
    sessions,
    /** Closes every live session's transport + server, then the HTTP server. */
    async close() {
      for (const { transport, server: sessionServer } of sessions.values()) {
        safeClose(transport);
        safeClose(sessionServer);
      }
      sessions.clear();
      await new Promise((resolve) => httpServer.close(() => resolve()));
    }
  };
}

/**
 * Validate a request's credentials.
 *
 * Accepts:
 *   - `Authorization: Bearer <crawlforge-api-key>` (legacy static key)
 *   - `X-API-Key: <crawlforge-api-key>` (legacy static key)
 *   - `Authorization: Bearer <oauth-access-token>` if OAuth is enabled —
 *     the OAuth provider validates the token and maps it to the API key.
 *
 * @returns {Promise<{ok: true} | {ok: false, status: number, error: string, message: string, reason: string}>}
 */
async function authenticateRequest(req, authManager, oauthProvider) {
  const authHeader = (req.headers['authorization'] || '').toString();
  const apiKeyHeader = (req.headers['x-api-key'] || '').toString();
  const expectedKey = authManager.getConfig()?.apiKey;

  let providedKey = '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    providedKey = authHeader.slice(7).trim();
  } else if (apiKeyHeader.length > 0) {
    providedKey = apiKeyHeader.trim();
  }

  if (!providedKey) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized',
      message: 'CrawlForge Streamable HTTP transport requires Authorization: Bearer <api-key-or-oauth-token> (or X-API-Key) on every request.',
      reason: 'missing-credentials'
    };
  }

  // Static API key match
  if (expectedKey && providedKey === expectedKey) {
    return { ok: true };
  }

  // OAuth token path
  if (oauthProvider && typeof oauthProvider.validateBearer === 'function') {
    const result = await oauthProvider.validateBearer(providedKey);
    if (result?.ok) return { ok: true };
  }

  return {
    ok: false,
    status: 401,
    error: 'Unauthorized',
    message: 'Invalid API key or OAuth token.',
    reason: 'invalid-credentials'
  };
}

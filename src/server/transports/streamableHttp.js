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
 * preserved when CRAWLFORGE_LEGACY_HTTP=true (one-release deprecation window).
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const SERVER_VERSION = '3.2.0';

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

  // Stateful mode: server generates session ids. Stateless when legacy=true.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: legacy ? undefined : () => randomUUID()
  });
  await server.connect(transport);

  const mode = legacy ? 'legacy-stateless' : 'streamable-stateful';

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
          description: 'Production-ready MCP server with 20 web scraping, crawling, and content processing tools. Features stealth browsing, deep research, structured extraction, and change tracking.',
          homepage: 'https://www.crawlforge.dev',
          icon: 'https://www.crawlforge.dev/icon.png'
        },
        transport: { type: 'streamable-http', url: '/mcp' },
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

      await transport.handleRequest(req, res);
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

  return { transport, httpServer };
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

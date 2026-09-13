/**
 * Dual-era Streamable HTTP transport.
 *
 * One endpoint at /mcp serves both protocol eras, routed by the SDK's own
 * classification (`isLegacyRequest`) so this module can never disagree with it:
 *
 *   - 2026-07-28 ("modern"): stateless, one server instance per request, each
 *     request carrying its own `_meta` envelope (protocol version, clientInfo,
 *     clientCapabilities) plus the SEP-2243 `Mcp-Method` / `Mcp-Name` headers.
 *     Served by `createMcpHandler(..., { legacy: 'reject' })`, which owns the
 *     Content-Type gate (415), the header/body cross-checks (-32020) and
 *     `server/discover`.
 *   - 2025-era ("legacy"): the sessionful path below — POST /mcp initialize
 *     issues an `Mcp-Session-Id`, GET /mcp opens the notification SSE stream,
 *     DELETE /mcp terminates the session. One transport + cloned McpServer per
 *     session, kept in the `sessions` Map.
 *
 * Auth:
 *   - Bearer / X-API-Key required per request on BOTH eras, before any era
 *     routing happens (creator mode bypasses, loopback only)
 *   - When OAuth is enabled (CRAWLFORGE_OAUTH_ENABLED=true), OAuth bearer
 *     tokens are validated by the OAuth provider and mapped server-side to
 *     a CrawlForge API key. See src/server/auth/oauth.js.
 *
 * Observability:
 *   - GET /metrics returns Prometheus exposition (when observability enabled)
 *   - GET /health returns liveness probe + the protocol revisions served
 */
import { McpServer, createMcpHandler, isLegacyRequest, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport, toNodeHandler, toWebRequest } from "@modelcontextprotocol/node";
import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { requestContext, setServingServer } from '../requestContext.js';
import { applySpecHygiene } from '../specHygiene.js';

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const SERVER_VERSION = pkg.version;

/**
 * Protocol revisions this endpoint serves, newest first: the modern era's
 * revisions followed by the 2025-era list the SDK negotiates via `initialize`.
 *
 * The modern list mirrors the SDK's internal SUPPORTED_MODERN_PROTOCOL_VERSIONS,
 * which is deliberately not exported. streamableHttp.test.js pins it against a
 * live `server/discover` result, so an SDK upgrade that adds a revision fails a
 * test rather than drifting silently.
 */
const MODERN_PROTOCOL_VERSIONS = Object.freeze(['2026-07-28']);
const PROTOCOL_VERSIONS = Object.freeze([...MODERN_PROTOCOL_VERSIONS, ...SUPPORTED_PROTOCOL_VERSIONS]);

/**
 * SEP-2549 cache hint for the `server/discover` result (2026-07-28 only). The
 * advertisement is the same for every caller and only changes when the server
 * is redeployed, so it is `public`; the 5-minute TTL matches the tools/call
 * hints in specHygiene.js. Without a hint the SDK emits `0` / `'private'`.
 */
const DISCOVER_CACHE_HINT = Object.freeze({ ttlMs: 300000, cacheScope: 'public' });

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
        if (tool?.inputSchema) {
          // The SDK's own conversion, so the card mirrors what tools/list serves.
          const converted = { ...server.toolInputSchemaJson(name) };
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
 * (all 28 tools/resources/prompts registered by server.js before this runs),
 * so instead of re-running that registration per session, this clones a
 * fresh McpServer and copies over the already-registered tool/resource/
 * prompt tables — plain config + handler-closure references, no per-connection
 * state — then re-runs the same internal handler-wiring methods McpServer
 * itself calls from registerTool/registerResource/registerPrompt. This
 * depends on the SDK's internal McpServer/Server field names
 * (`_registered*`, `set*RequestHandlers`, `_capabilities`); re-verified
 * against @modelcontextprotocol/server 2.0.0, which still exposes all of
 * them. `_taskStore` is gone — v2 removed experimental tasks (SEP-2663).
 * Re-check on SDK upgrades.
 *
 * The same clone backs a 2025-era session and a single 2026-era request, so
 * both eras serve exactly the same tools — the SDK's "one factory for both
 * legs" rule.
 *
 * applySpecHygiene() runs on the clone because its wrappers live on the
 * template's own Protocol instance, not in the `_registered*` tables the clone
 * copies: without this call an HTTP client got unsorted, icon-less tools/list
 * results and no SEP-2549 cache markers on tools/call, while a stdio client
 * got all three.
 *
 * @param {import('@modelcontextprotocol/server').McpServer} templateServer
 */
function cloneServerForSession(templateServer) {
  const low = templateServer.server;
  // capabilities must survive the clone so the session server advertises the
  // same surface as the template. cacheHints only reaches the 2026-era encode
  // seam (it rides a symbol-keyed property that is never serialized), so a
  // 2025-era response is byte-identical with or without it.
  const sessionServer = new McpServer(low._serverInfo, {
    instructions: low._instructions,
    capabilities: low._capabilities,
    cacheHints: { 'server/discover': DISCOVER_CACHE_HINT }
  });

  sessionServer._registeredTools = templateServer._registeredTools;
  sessionServer._registeredResources = templateServer._registeredResources;
  sessionServer._registeredResourceTemplates = templateServer._registeredResourceTemplates;
  sessionServer._registeredPrompts = templateServer._registeredPrompts;

  if (templateServer._toolHandlersInitialized) sessionServer.setToolRequestHandlers();
  if (templateServer._resourceHandlersInitialized) sessionServer.setResourceRequestHandlers();
  if (templateServer._promptHandlersInitialized) sessionServer.setPromptRequestHandlers();
  if (templateServer._completionHandlerInitialized) sessionServer.setCompletionRequestHandler();

  applySpecHygiene(sessionServer);

  return sessionServer;
}

/** Reads a request body to completion as UTF-8. */
async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
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
 * Dual-era Streamable HTTP transport: stateless 2026-07-28 and sessionful
 * 2025-era traffic on the same /mcp route.
 *
 * @param {import('@modelcontextprotocol/server').McpServer} server
 * @param {import('../../core/AuthManager.js').default} authManager
 * @param {import('../../utils/Logger.js').logger} logger
 * @param {object} [options]
 * @param {number} [options.port=3000]
 * @param {object} [options.oauth]          — OAuth provider (see src/server/auth/oauth.js)
 * @param {object} [options.metrics]        — Prometheus registry (see src/observability/metrics.js)
 */
export async function connectStreamableHttp(server, authManager, logger, options = {}) {
  const port = options.port ?? 3000;
  // Bind loopback by default so a local `--http` server is not exposed to the
  // LAN. Managed hosts need 0.0.0.0 to be reachable by their router: Render sets
  // $RENDER; $MCP_HTTP_HOST is an explicit override for any other platform.
  const host = options.host ?? process.env.MCP_HTTP_HOST ?? (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  const hostIsLoopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  if (authManager.isCreatorMode() && !hostIsLoopback) {
    console.error(`WARNING: creator mode is enabled but the server is bound to ${host} (non-loopback) — per-request auth will NOT be bypassed. Bind to 127.0.0.1 to use creator mode.`);
  }
  const oauthProvider = options.oauth ?? null;
  const metrics = options.metrics ?? null;

  const mode = 'streamable-stateful';
  const toolCount = Object.keys(server._registeredTools ?? {}).length;

  // sessionId -> { transport, server }. One StreamableHTTPServerTransport (and
  // therefore one cloned McpServer — see cloneServerForSession) per session.
  // 2025-era only: the modern era is stateless and holds nothing here.
  const sessions = new Map();

  // 2026-07-28 leg. `legacy: 'reject'` keeps it strict — every 2025-era request
  // is routed to the sessions Map above by isLegacyRequest before it can reach
  // this handler, so the modern leg never has to serve one. The SDK owns the
  // Content-Type gate (415), the Mcp-Method/Mcp-Name cross-checks (-32020 on
  // 400) and `server/discover`; nothing here re-implements them.
  // The factory runs once per request, inside the requestContext.run() below,
  // so the clone it builds can be stamped on the store: that clone — never the
  // template — is the instance this request is actually served from.
  const modernHandler = createMcpHandler((ctx) => {
    const requestServer = cloneServerForSession(server);
    setServingServer(requestServer, ctx?.era ?? 'modern');
    return requestServer;
  }, {
    legacy: 'reject',
    onerror: (err) => logger.warn('2026-era MCP request rejected', { error: err?.message })
  });
  const serveModern = toNodeHandler(modernHandler, {
    onerror: (err) => logger.error('2026-era MCP request failed', { error: err?.message })
  });

  const httpServer = createServer(async (req, res) => {
    // CORS — Smithery + browser-based MCP clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    // MCP-Protocol-Version / Mcp-Method / Mcp-Name are the 2026-07-28 era's
    // request headers; the session id headers are the 2025 era's.
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Authorization, X-API-Key, X-Internal-Secret');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health probe
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: SERVER_VERSION, mode, protocolVersions: PROTOCOL_VERSIONS }));
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
      // Per-request auth. Creator mode bypasses it, but only on a loopback bind
      // — never expose an unauthenticated MCP endpoint on a public interface.
      // `internal` marks a request from the website's REST proxy
      // (INTERNAL_PROXY_SECRET): it is billing-exempt in withAuth because the
      // website already charged the end user. `ownerToken` says which of the
      // website's customers it is being made for. Both are request-scoped only
      // — never persisted on the session.
      let internal = false;
      let ownerToken;
      if (!(authManager.isCreatorMode() && hostIsLoopback)) {
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
        internal = authResult.internal === true;
        ownerToken = authResult.ownerToken;
      }

      // Era routing. Only a POST can carry the 2026-07-28 per-request envelope;
      // body-less GET/DELETE are 2025 session operations by construction and
      // isLegacyRequest classifies them as such, so they skip this entirely and
      // keep their existing behaviour byte-for-byte.
      //
      // Reading the body here drains the Node stream, so the parsed value is
      // handed to whichever leg serves the request. A body that is not valid
      // JSON classifies legacy (the SDK's own rule), and the 2025 transport
      // still writes its own parse error — hence the undefined pass-through
      // rather than an answer invented here.
      let parsedBody;
      if (req.method === 'POST') {
        try {
          parsedBody = JSON.parse(await readRequestBody(req));
        } catch {
          parsedBody = undefined;
        }

        if (parsedBody !== undefined) {
          const probe = await toWebRequest(req, parsedBody);
          if (!(await isLegacyRequest(probe, parsedBody))) {
            await requestContext.run({ internal, ownerToken }, () => serveModern(req, res, parsedBody));
            return;
          }
        }
      }

      // 2025 era: route by Mcp-Session-Id. A request without the header must be
      // a fresh initialize, which gets its own transport + server pair
      // (independent of any prior session's lifecycle) so reconnects/re-inits
      // never hit a stuck 'already initialized' transport.
      const sessionIdHeader = req.headers['mcp-session-id'];
      const existing = sessionIdHeader ? sessions.get(String(sessionIdHeader)) : undefined;

      if (existing) {
        await requestContext.run(
          { internal, ownerToken, servingServer: existing.server, servingEra: 'legacy' },
          () => existing.transport.handleRequest(req, res, parsedBody)
        );
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
      const transport = new NodeStreamableHTTPServerTransport({
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
        await requestContext.run(
          { internal, ownerToken, servingServer: sessionServer, servingEra: 'legacy' },
          () => transport.handleRequest(req, res, parsedBody)
        );
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
      console.error(`MCP endpoint:   http://${host}:${actual}/mcp (protocol ${PROTOCOL_VERSIONS.join(', ')})`);
      console.error(`Health check:   http://${host}:${actual}/health`);
      if (metrics) console.error(`Metrics:        http://${host}:${actual}/metrics`);
      if (oauthProvider) console.error(`OAuth discovery: http://${host}:${actual}/.well-known/oauth-authorization-server`);
      resolve();
    });
  });

  return {
    httpServer,
    sessions,
    /**
     * Closes every live 2025-era session's transport + server and the modern
     * leg (aborting in-flight exchanges), then the HTTP server.
     */
    async close() {
      for (const { transport, server: sessionServer } of sessions.values()) {
        safeClose(transport);
        safeClose(sessionServer);
      }
      sessions.clear();
      await modernHandler.close().catch(() => {});
      await new Promise((resolve) => httpServer.close(() => resolve()));
    }
  };
}

/**
 * Hex, and bounded. The website emits 32 characters (mcpOwnerToken in
 * crawlforge-website src/lib/tools/mcp-proxy.ts); the range is wider so the two
 * repos can pick a different HMAC slice without a lockstep deploy, and narrow
 * enough that nothing unbounded, non-printable or structured can ever become
 * part of an owner id.
 */
const OWNER_TOKEN_RE = /^[0-9a-f]{16,64}$/;

/**
 * The owner token an internal request claims, or undefined.
 *
 * Undefined covers absent AND malformed alike, and the difference must not
 * matter: everything downstream treats "no owner" as "no session", so a value
 * that fails this check is simply not an owner rather than a strange one. Never
 * relax this into a coercion — the token becomes part of a tenant key.
 */
function readOwnerToken(req) {
  const value = (req.headers['x-crawlforge-owner'] || '').toString();
  return OWNER_TOKEN_RE.test(value) ? value : undefined;
}

/**
 * Validate a request's credentials.
 *
 * Accepts:
 *   - `X-Internal-Secret: <INTERNAL_PROXY_SECRET>` — server-to-server requests
 *     from the crawlforge-website REST proxy. Returns { ok, internal: true };
 *     internal requests are billing-exempt in withAuth (the website already
 *     charged the end user). Only active when the env var is set. Such a
 *     request may also carry `X-CrawlForge-Owner` — see readOwnerToken.
 *   - `Authorization: Bearer <crawlforge-api-key>` (legacy static key)
 *   - `X-API-Key: <crawlforge-api-key>` (legacy static key)
 *   - `Authorization: Bearer <oauth-access-token>` if OAuth is enabled —
 *     the OAuth provider validates the token and maps it to the API key.
 *
 * @returns {Promise<{ok: true, internal?: boolean, ownerToken?: string} | {ok: false, status: number, error: string, message: string, reason: string}>}
 */
async function authenticateRequest(req, authManager, oauthProvider) {
  // Internal proxy path first: presenting the header at all means the caller
  // claims to be the website proxy, so a mismatch is a hard 401 rather than a
  // fall-through to the key paths. Compare digests — timingSafeEqual on raw
  // strings throws on length mismatch, which would leak length via timing.
  const internalSecret = process.env.INTERNAL_PROXY_SECRET;
  const providedSecret = (req.headers['x-internal-secret'] || '').toString();
  if (providedSecret) {
    if (internalSecret) {
      const provided = createHash('sha256').update(providedSecret).digest();
      const expected = createHash('sha256').update(internalSecret).digest();
      if (timingSafeEqual(provided, expected)) {
        // Read ONLY here, on the branch that has just proved the secret. A
        // request that authenticated any other way — or none — never has its
        // owner header looked at, so claiming an owner requires already being
        // the proxy.
        return { ok: true, internal: true, ownerToken: readOwnerToken(req) };
      }
    }
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized',
      message: 'Invalid internal secret.',
      reason: 'invalid-internal-secret'
    };
  }

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

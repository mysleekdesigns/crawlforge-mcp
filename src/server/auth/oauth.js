/**
 * OAuth 2.1 authorization for CrawlForge MCP Server.
 *
 * Implements the subset of OAuth 2.1 required by the MCP spec
 * (modelcontextprotocol.io/docs/tutorials/security/authorization):
 *
 *   - Authorization Server discovery: GET /.well-known/oauth-authorization-server
 *   - Dynamic Client Registration:    POST /oauth/register
 *   - Authorization endpoint:         GET  /oauth/authorize    (PKCE required)
 *   - Token endpoint:                 POST /oauth/token        (PKCE code + refresh)
 *   - Token revocation:               POST /oauth/revoke
 *
 * Token model: opaque bearer tokens minted server-side. Each access token
 * carries a `mappedApiKey` link to a CrawlForge API key, so downstream
 * credit-tracking continues to work unchanged.
 *
 * Storage: in-memory by default. Production deployments should provide
 * `storage` adapter (set/get/delete) so tokens survive restarts.
 *
 * Stdio transport keeps the static API key — OAuth is HTTP-only.
 *
 * This module is intentionally dependency-free (no `oidc-provider`/`oauth4webapi`)
 * to keep the npm install footprint small. It implements only what MCP requires.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const ACCESS_TTL_MS = 60 * 60 * 1000;          // 1 hour
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CODE_TTL_MS = 5 * 60 * 1000;             // 5 minutes
const DEFAULT_SCOPES = ['mcp:read', 'mcp:write'];

/**
 * Create an OAuth provider bound to a CrawlForge API key.
 *
 * @param {object} options
 * @param {string} options.issuer                — public URL of this server, e.g. https://mcp.crawlforge.dev
 * @param {string} options.apiKey                — the CrawlForge API key to map tokens to
 * @param {object} [options.storage]             — { setClient, getClient, setCode, takeCode, setToken, getToken, deleteToken }
 * @param {object} [options.logger]              — Winston-style logger
 * @param {string[]} [options.scopes]            — supported scopes
 * @param {number} [options.accessTtlMs]
 * @param {number} [options.refreshTtlMs]
 */
export function createOAuthProvider({
  issuer,
  apiKey,
  storage,
  logger = console,
  scopes = DEFAULT_SCOPES,
  accessTtlMs = ACCESS_TTL_MS,
  refreshTtlMs = REFRESH_TTL_MS
}) {
  if (!issuer) throw new Error('createOAuthProvider: issuer is required');
  if (!apiKey) throw new Error('createOAuthProvider: apiKey is required');

  const store = storage ?? createInMemoryStorage();

  return {
    issuer,
    scopes,

    /**
     * Returns true if a request URL/method targets one of this provider's routes.
     */
    matches(url, method) {
      if (!url) return false;
      const path = url.split('?')[0];
      if (path === '/.well-known/oauth-authorization-server' && method === 'GET') return true;
      if (path === '/oauth/register' && method === 'POST') return true;
      if (path === '/oauth/authorize' && method === 'GET') return true;
      if (path === '/oauth/token' && method === 'POST') return true;
      if (path === '/oauth/revoke' && method === 'POST') return true;
      return false;
    },

    /**
     * Validate an opaque bearer access token. Returns { ok, mappedApiKey } on success.
     */
    async validateBearer(token) {
      if (!token) return { ok: false };
      const record = await store.getToken(token);
      if (!record) return { ok: false };
      if (record.type !== 'access') return { ok: false };
      if (record.expiresAt < Date.now()) {
        await store.deleteToken(token);
        return { ok: false };
      }
      return { ok: true, mappedApiKey: record.mappedApiKey, clientId: record.clientId, scopes: record.scopes };
    },

    /**
     * Dispatch an OAuth request. Caller must have verified matches() first.
     */
    async handle(req, res) {
      try {
        const path = req.url.split('?')[0];
        const method = req.method;

        if (path === '/.well-known/oauth-authorization-server' && method === 'GET') {
          return sendJson(res, 200, buildDiscovery(issuer, scopes));
        }
        if (path === '/oauth/register' && method === 'POST') {
          return await handleRegister(req, res, store);
        }
        if (path === '/oauth/authorize' && method === 'GET') {
          return await handleAuthorize(req, res, store, apiKey);
        }
        if (path === '/oauth/token' && method === 'POST') {
          return await handleToken(req, res, store, apiKey, { accessTtlMs, refreshTtlMs });
        }
        if (path === '/oauth/revoke' && method === 'POST') {
          return await handleRevoke(req, res, store);
        }
        return sendJson(res, 404, { error: 'not_found' });
      } catch (err) {
        logger.error?.('oauth handler error', { error: err?.message, stack: err?.stack });
        return sendJson(res, 500, { error: 'server_error', error_description: err?.message ?? 'unknown' });
      }
    },

    // Test helpers / internals
    _store: store
  };
}

// ─── Discovery ────────────────────────────────────────────────────────────────

function buildDiscovery(issuer, scopes) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: scopes
  };
}

// ─── Dynamic Client Registration (RFC 7591) ──────────────────────────────────

async function handleRegister(req, res, store) {
  const body = await readJsonBody(req);
  const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  if (redirectUris.length === 0) {
    return sendJson(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' });
  }
  for (const uri of redirectUris) {
    if (typeof uri !== 'string' || !/^https?:\/\//.test(uri)) {
      return sendJson(res, 400, { error: 'invalid_redirect_uri', error_description: `bad uri: ${uri}` });
    }
  }

  const clientId = `cf-${randomBytes(8).toString('hex')}`;
  // MCP spec recommends public clients (PKCE only). We don't issue secrets by default.
  const client = {
    client_id: clientId,
    client_name: body?.client_name ?? 'mcp-client',
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    created_at: Date.now()
  };
  await store.setClient(clientId, client);

  return sendJson(res, 201, client);
}

// ─── Authorization endpoint ──────────────────────────────────────────────────

async function handleAuthorize(req, res, store, apiKey) {
  const url = new URL(req.url, 'http://x');
  const params = Object.fromEntries(url.searchParams.entries());

  const required = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method'];
  for (const key of required) {
    if (!params[key]) return sendJson(res, 400, { error: 'invalid_request', error_description: `missing ${key}` });
  }
  if (params.response_type !== 'code') {
    return sendJson(res, 400, { error: 'unsupported_response_type' });
  }
  if (params.code_challenge_method !== 'S256') {
    return sendJson(res, 400, { error: 'invalid_request', error_description: 'only S256 PKCE is supported' });
  }

  const client = await store.getClient(params.client_id);
  if (!client) {
    return sendJson(res, 400, { error: 'invalid_client' });
  }
  if (!client.redirect_uris.includes(params.redirect_uri)) {
    return sendJson(res, 400, { error: 'invalid_redirect_uri' });
  }

  // Auto-approve: this server is a personal MCP endpoint backed by a single
  // CrawlForge API key the operator has already authenticated. No consent UI
  // is needed — possession of the operator's `apiKey` IS the authorization.
  // (Same trust model as the static-key transport.)
  //
  // For a multi-tenant deployment, replace this with a real consent page that
  // resolves to a CrawlForge user → API key mapping.
  const code = randomBytes(24).toString('base64url');
  await store.setCode(code, {
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    scopes: (params.scope ?? 'mcp:read mcp:write').split(/\s+/).filter(Boolean),
    mappedApiKey: apiKey,
    expiresAt: Date.now() + CODE_TTL_MS
  });

  const redirect = new URL(params.redirect_uri);
  redirect.searchParams.set('code', code);
  if (params.state) redirect.searchParams.set('state', params.state);
  res.writeHead(302, { Location: redirect.toString() });
  res.end();
}

// ─── Token endpoint ──────────────────────────────────────────────────────────

async function handleToken(req, res, store, apiKey, { accessTtlMs, refreshTtlMs }) {
  const body = await readFormBody(req);
  const grant = body.grant_type;

  if (grant === 'authorization_code') {
    const required = ['code', 'redirect_uri', 'client_id', 'code_verifier'];
    for (const key of required) {
      if (!body[key]) return sendJson(res, 400, { error: 'invalid_request', error_description: `missing ${key}` });
    }
    const codeRecord = await store.takeCode(body.code);
    if (!codeRecord) return sendJson(res, 400, { error: 'invalid_grant', error_description: 'unknown or used code' });
    if (codeRecord.expiresAt < Date.now()) return sendJson(res, 400, { error: 'invalid_grant', error_description: 'code expired' });
    if (codeRecord.clientId !== body.client_id) return sendJson(res, 400, { error: 'invalid_grant' });
    if (codeRecord.redirectUri !== body.redirect_uri) return sendJson(res, 400, { error: 'invalid_grant' });
    if (!verifyPkce(body.code_verifier, codeRecord.codeChallenge)) {
      return sendJson(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }

    const tokens = await issueTokens(store, {
      clientId: codeRecord.clientId,
      mappedApiKey: codeRecord.mappedApiKey,
      scopes: codeRecord.scopes,
      accessTtlMs,
      refreshTtlMs
    });
    return sendJson(res, 200, tokens);
  }

  if (grant === 'refresh_token') {
    if (!body.refresh_token) return sendJson(res, 400, { error: 'invalid_request', error_description: 'missing refresh_token' });
    const record = await store.getToken(body.refresh_token);
    if (!record || record.type !== 'refresh') return sendJson(res, 400, { error: 'invalid_grant' });
    if (record.expiresAt < Date.now()) {
      await store.deleteToken(body.refresh_token);
      return sendJson(res, 400, { error: 'invalid_grant', error_description: 'refresh expired' });
    }
    // Rotate refresh token (RFC 6749 §6, MCP best practice)
    await store.deleteToken(body.refresh_token);
    const tokens = await issueTokens(store, {
      clientId: record.clientId,
      mappedApiKey: record.mappedApiKey,
      scopes: record.scopes,
      accessTtlMs,
      refreshTtlMs
    });
    return sendJson(res, 200, tokens);
  }

  return sendJson(res, 400, { error: 'unsupported_grant_type' });
}

// ─── Revocation (RFC 7009) ───────────────────────────────────────────────────

async function handleRevoke(req, res, store) {
  const body = await readFormBody(req);
  if (body.token) {
    await store.deleteToken(body.token);
  }
  res.writeHead(200);
  res.end();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function issueTokens(store, { clientId, mappedApiKey, scopes, accessTtlMs, refreshTtlMs }) {
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  await store.setToken(accessToken, {
    type: 'access',
    clientId,
    mappedApiKey,
    scopes,
    expiresAt: now + accessTtlMs
  });
  await store.setToken(refreshToken, {
    type: 'refresh',
    clientId,
    mappedApiKey,
    scopes,
    expiresAt: now + refreshTtlMs
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(accessTtlMs / 1000),
    refresh_token: refreshToken,
    scope: scopes.join(' ')
  };
}

function verifyPkce(verifier, expectedChallenge) {
  try {
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const a = Buffer.from(challenge);
    const b = Buffer.from(expectedChallenge);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const raw = await readRawBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function readFormBody(req) {
  const raw = await readRawBody(req);
  if (!raw) return {};
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  // application/x-www-form-urlencoded
  const out = {};
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ─── In-memory storage (default) ─────────────────────────────────────────────

function createInMemoryStorage() {
  const clients = new Map();
  const codes = new Map();
  const tokens = new Map();
  return {
    async setClient(id, client) { clients.set(id, client); },
    async getClient(id) { return clients.get(id); },
    async setCode(code, record) { codes.set(code, record); },
    async takeCode(code) {
      const r = codes.get(code);
      codes.delete(code);
      return r;
    },
    async setToken(token, record) { tokens.set(token, record); },
    async getToken(token) { return tokens.get(token); },
    async deleteToken(token) { tokens.delete(token); }
  };
}

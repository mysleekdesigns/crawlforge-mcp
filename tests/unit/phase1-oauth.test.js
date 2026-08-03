/**
 * Unit tests for the Phase 1 OAuth authorize proof-of-key fix
 * (src/server/auth/oauth.js, handleAuthorize).
 *
 * Run: node --test tests/unit/phase1-oauth.test.js --test-force-exit
 *
 * Before the fix, GET /oauth/authorize auto-approved ANY registered client
 * with a valid PKCE challenge and no credential check at all, minting a code
 * mapped to the operator's CrawlForge API key. Since POST /oauth/register is
 * open/unauthenticated by design, this let any anonymous caller mint tokens
 * billed to the operator.
 *
 * These tests assert that /oauth/authorize now requires proof of possession
 * of the operator's API key (via `Authorization: Bearer <key>` header or an
 * `api_key` query parameter) before a code is issued:
 *   1. Anonymous authorize (no key proof) is rejected — no code issued.
 *   2. Authorize with a wrong api_key is rejected.
 *   3. Authorize with the correct key (header or query param) succeeds, and
 *      the resulting code still exchanges for tokens normally.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createOAuthProvider } from '../../src/server/auth/oauth.js';

const ISSUER = 'http://localhost:3000';
const API_KEY = 'cf-test-api-key-1234';
const REDIRECT_URI = 'http://localhost:9999/cb';

// ─── Test helpers (mirrors tests/unit/oauth.test.js) ─────────────────────────

class MockReq {
  constructor({ url, method, headers = {}, body = '' }) {
    this.url = url;
    this.method = method;
    this.headers = headers;
    this._body = Buffer.from(body, 'utf8');
    this._listeners = {};
  }
  on(event, fn) {
    this._listeners[event] = fn;
    if (event === 'end') {
      setImmediate(() => {
        if (this._listeners.data) this._listeners.data(this._body);
        if (this._listeners.end) this._listeners.end();
      });
    }
    return this;
  }
}

class MockRes {
  constructor() {
    this.statusCode = null;
    this.headers = {};
    this.body = '';
    this.ended = false;
  }
  writeHead(status, headers = {}) { this.statusCode = status; this.headers = { ...this.headers, ...headers }; }
  end(body = '') { this.body = body; this.ended = true; }
}

async function runHandle(provider, { url, method, body = '', headers = {} }) {
  const req = new MockReq({ url, method, headers, body });
  const res = new MockRes();
  await provider.handle(req, res);
  return res;
}

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function registerClient(p) {
  const res = await runHandle(p, {
    url: '/oauth/register',
    method: 'POST',
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
    headers: { 'content-type': 'application/json' }
  });
  assert.equal(res.statusCode, 201, 'client registration must succeed (it is intentionally open)');
  return JSON.parse(res.body).client_id;
}

function authorizeUrl(clientId, challenge, extraQuery = '') {
  return `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_challenge=${challenge}&code_challenge_method=S256${extraQuery}`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('authorize: anonymous request (no key proof) is rejected, no code issued', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  const clientId = await registerClient(p);
  const { challenge } = pkcePair();

  const res = await runHandle(p, { url: authorizeUrl(clientId, challenge), method: 'GET' });

  assert.equal(res.statusCode, 401);
  assert.equal(res.headers.Location, undefined, 'must not redirect with a code');
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'invalid_client');
});

test('authorize: wrong api_key query param is rejected', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  const clientId = await registerClient(p);
  const { challenge } = pkcePair();

  const res = await runHandle(p, {
    url: authorizeUrl(clientId, challenge, '&api_key=totally-wrong-key'),
    method: 'GET'
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.headers.Location, undefined);
});

test('authorize: wrong Authorization: Bearer header is rejected', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  const clientId = await registerClient(p);
  const { challenge } = pkcePair();

  const res = await runHandle(p, {
    url: authorizeUrl(clientId, challenge),
    method: 'GET',
    headers: { authorization: 'Bearer wrong-key-value' }
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.headers.Location, undefined);
});

test('authorize: correct api_key query param issues a code that exchanges for tokens', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  const clientId = await registerClient(p);
  const { verifier, challenge } = pkcePair();

  const authRes = await runHandle(p, {
    url: authorizeUrl(clientId, challenge, `&api_key=${encodeURIComponent(API_KEY)}&state=xyz`),
    method: 'GET'
  });
  assert.equal(authRes.statusCode, 302);
  const location = new URL(authRes.headers.Location);
  const code = location.searchParams.get('code');
  assert.ok(code, 'auth response must include ?code= when the key proof is correct');
  assert.equal(location.searchParams.get('state'), 'xyz');

  const tokenBody = `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_id=${clientId}&code_verifier=${verifier}`;
  const tokenRes = await runHandle(p, {
    url: '/oauth/token',
    method: 'POST',
    body: tokenBody,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(tokenRes.statusCode, 200);
  const tokens = JSON.parse(tokenRes.body);
  assert.equal(tokens.token_type, 'Bearer');
  assert.ok(tokens.access_token);

  const validation = await p.validateBearer(tokens.access_token);
  assert.equal(validation.ok, true);
  assert.equal(validation.mappedApiKey, API_KEY);
});

test('authorize: correct key via Authorization: Bearer header issues a code', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  const clientId = await registerClient(p);
  const { challenge } = pkcePair();

  const authRes = await runHandle(p, {
    url: authorizeUrl(clientId, challenge),
    method: 'GET',
    headers: { authorization: `Bearer ${API_KEY}` }
  });
  assert.equal(authRes.statusCode, 302);
  const code = new URL(authRes.headers.Location).searchParams.get('code');
  assert.ok(code);
});

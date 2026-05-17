/**
 * Unit tests for src/server/auth/oauth.js (v3.2.0, C2).
 *
 * Run: node --test tests/unit/oauth.test.js
 *
 * Validates:
 *   - Discovery endpoint shape
 *   - Dynamic Client Registration (RFC 7591)
 *   - PKCE authorization code flow (S256)
 *   - Refresh token rotation
 *   - Bearer validation maps tokens → CrawlForge API key
 *   - matches() routes correctly
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createOAuthProvider } from '../../src/server/auth/oauth.js';

const ISSUER = 'http://localhost:3000';
const API_KEY = 'cf-test-api-key-1234';

// ─── Test helpers ────────────────────────────────────────────────────────────

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
      // Synchronously fire data + end on next tick
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

// ─── Tests ───────────────────────────────────────────────────────────────────

test('matches: routes correctly for each OAuth endpoint', () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  assert.equal(p.matches('/.well-known/oauth-authorization-server', 'GET'), true);
  assert.equal(p.matches('/oauth/register', 'POST'), true);
  assert.equal(p.matches('/oauth/authorize?response_type=code', 'GET'), true);
  assert.equal(p.matches('/oauth/token', 'POST'), true);
  assert.equal(p.matches('/oauth/revoke', 'POST'), true);
  assert.equal(p.matches('/mcp', 'POST'), false);
  assert.equal(p.matches('/oauth/register', 'GET'), false);
});

test('discovery: returns required fields', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  const res = await runHandle(p, { url: '/.well-known/oauth-authorization-server', method: 'GET' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.issuer, ISSUER);
  assert.equal(body.authorization_endpoint, `${ISSUER}/oauth/authorize`);
  assert.equal(body.token_endpoint, `${ISSUER}/oauth/token`);
  assert.deepEqual(body.code_challenge_methods_supported, ['S256']);
  assert.ok(body.grant_types_supported.includes('authorization_code'));
  assert.ok(body.grant_types_supported.includes('refresh_token'));
});

test('register: creates a client with the provided redirect URIs', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  const body = JSON.stringify({
    client_name: 'test-client',
    redirect_uris: ['http://localhost:9999/callback']
  });
  const res = await runHandle(p, { url: '/oauth/register', method: 'POST', body, headers: { 'content-type': 'application/json' } });
  assert.equal(res.statusCode, 201);
  const client = JSON.parse(res.body);
  assert.ok(client.client_id.startsWith('cf-'));
  assert.deepEqual(client.redirect_uris, ['http://localhost:9999/callback']);
  assert.equal(client.token_endpoint_auth_method, 'none');
});

test('register: rejects missing redirect_uris', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  const res = await runHandle(p, {
    url: '/oauth/register',
    method: 'POST',
    body: JSON.stringify({ client_name: 'x' }),
    headers: { 'content-type': 'application/json' }
  });
  assert.equal(res.statusCode, 400);
});

test('register: rejects non-http redirect URIs', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  const res = await runHandle(p, {
    url: '/oauth/register',
    method: 'POST',
    body: JSON.stringify({ redirect_uris: ['javascript:alert(1)'] }),
    headers: { 'content-type': 'application/json' }
  });
  assert.equal(res.statusCode, 400);
});

test('full PKCE authorization_code flow: end-to-end', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });

  // 1. Register
  const regRes = await runHandle(p, {
    url: '/oauth/register',
    method: 'POST',
    body: JSON.stringify({ redirect_uris: ['http://localhost:9999/cb'] }),
    headers: { 'content-type': 'application/json' }
  });
  const { client_id } = JSON.parse(regRes.body);

  // 2. Authorize with PKCE
  const { verifier, challenge } = pkcePair();
  const authUrl = `/oauth/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent('http://localhost:9999/cb')}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`;
  const authRes = await runHandle(p, { url: authUrl, method: 'GET' });
  assert.equal(authRes.statusCode, 302);
  const location = new URL(authRes.headers.Location);
  const code = location.searchParams.get('code');
  assert.ok(code, 'auth response must include ?code=');
  assert.equal(location.searchParams.get('state'), 'xyz');

  // 3. Exchange code for tokens
  const tokenBody = `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent('http://localhost:9999/cb')}&client_id=${client_id}&code_verifier=${verifier}`;
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
  assert.ok(tokens.refresh_token);
  assert.ok(tokens.expires_in > 0);

  // 4. Validate the access token maps to the API key
  const validation = await p.validateBearer(tokens.access_token);
  assert.equal(validation.ok, true);
  assert.equal(validation.mappedApiKey, API_KEY);

  // 5. Refresh
  const refreshBody = `grant_type=refresh_token&refresh_token=${tokens.refresh_token}`;
  const refreshRes = await runHandle(p, {
    url: '/oauth/token',
    method: 'POST',
    body: refreshBody,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(refreshRes.statusCode, 200);
  const refreshed = JSON.parse(refreshRes.body);
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token, 'refresh token must rotate');

  // Old refresh token no longer valid
  const replay = await runHandle(p, {
    url: '/oauth/token',
    method: 'POST',
    body: refreshBody,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(replay.statusCode, 400);
});

test('PKCE: wrong verifier is rejected', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  const regRes = await runHandle(p, {
    url: '/oauth/register',
    method: 'POST',
    body: JSON.stringify({ redirect_uris: ['http://localhost:9999/cb'] }),
    headers: { 'content-type': 'application/json' }
  });
  const { client_id } = JSON.parse(regRes.body);

  const { challenge } = pkcePair();
  const authUrl = `/oauth/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent('http://localhost:9999/cb')}&code_challenge=${challenge}&code_challenge_method=S256`;
  const authRes = await runHandle(p, { url: authUrl, method: 'GET' });
  const code = new URL(authRes.headers.Location).searchParams.get('code');

  // Use a wrong verifier
  const tokenBody = `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent('http://localhost:9999/cb')}&client_id=${client_id}&code_verifier=WRONG`;
  const tokenRes = await runHandle(p, {
    url: '/oauth/token',
    method: 'POST',
    body: tokenBody,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(tokenRes.statusCode, 400);
  assert.equal(JSON.parse(tokenRes.body).error, 'invalid_grant');
});

test('authorize: rejects plain code_challenge_method', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  const reg = await runHandle(p, {
    url: '/oauth/register',
    method: 'POST',
    body: JSON.stringify({ redirect_uris: ['http://localhost:9999/cb'] }),
    headers: { 'content-type': 'application/json' }
  });
  const { client_id } = JSON.parse(reg.body);
  const res = await runHandle(p, {
    url: `/oauth/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent('http://localhost:9999/cb')}&code_challenge=abc&code_challenge_method=plain`,
    method: 'GET'
  });
  assert.equal(res.statusCode, 400);
});

test('validateBearer: unknown token rejected', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });
  assert.deepEqual(await p.validateBearer('does-not-exist'), { ok: false });
  assert.deepEqual(await p.validateBearer(''), { ok: false });
});

test('revoke: token no longer validates after revocation', async () => {
  const p = createOAuthProvider({ issuer: ISSUER, apiKey: API_KEY });

  // Register + auth + token (compact)
  const reg = await runHandle(p, {
    url: '/oauth/register',
    method: 'POST',
    body: JSON.stringify({ redirect_uris: ['http://localhost:9999/cb'] }),
    headers: { 'content-type': 'application/json' }
  });
  const { client_id } = JSON.parse(reg.body);
  const { verifier, challenge } = pkcePair();
  const authRes = await runHandle(p, {
    url: `/oauth/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent('http://localhost:9999/cb')}&code_challenge=${challenge}&code_challenge_method=S256`,
    method: 'GET'
  });
  const code = new URL(authRes.headers.Location).searchParams.get('code');
  const tokenRes = await runHandle(p, {
    url: '/oauth/token',
    method: 'POST',
    body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent('http://localhost:9999/cb')}&client_id=${client_id}&code_verifier=${verifier}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  const { access_token } = JSON.parse(tokenRes.body);

  // Sanity
  assert.equal((await p.validateBearer(access_token)).ok, true);

  // Revoke
  await runHandle(p, {
    url: '/oauth/revoke',
    method: 'POST',
    body: `token=${access_token}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal((await p.validateBearer(access_token)).ok, false);
});

test('constructor: requires issuer and apiKey', () => {
  assert.throws(() => createOAuthProvider({ apiKey: 'x' }), /issuer/);
  assert.throws(() => createOAuthProvider({ issuer: 'x' }), /apiKey/);
});

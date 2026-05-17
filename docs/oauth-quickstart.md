# OAuth 2.1 quickstart

CrawlForge MCP Server v3.2.0 ships an OAuth 2.1 authorization server for the
**Streamable HTTP transport** (remote MCP deployments). Stdio transport
continues to use the static `CRAWLFORGE_API_KEY` — no change.

Implements the subset of OAuth 2.1 mandated by the MCP authorization spec
(`modelcontextprotocol.io/docs/tutorials/security/authorization`):

- Discovery endpoint (`/.well-known/oauth-authorization-server`)
- Dynamic Client Registration (RFC 7591)
- Authorization Code + PKCE (S256 only — `plain` is rejected)
- Refresh token rotation
- Token revocation (RFC 7009)

Opaque bearer tokens are minted server-side and mapped to your existing
CrawlForge API key — credit tracking continues unchanged.

## Enabling OAuth

```bash
# Required
export CRAWLFORGE_OAUTH_ENABLED=true
export CRAWLFORGE_OAUTH_ISSUER=https://mcp.yourdomain.com   # public URL
export CRAWLFORGE_API_KEY=cf-...                            # the key to map tokens to

# Start the HTTP transport
npm run start:http
```

The server now exposes:

| Endpoint | Purpose |
|---|---|
| `GET  /.well-known/oauth-authorization-server` | Discovery |
| `POST /oauth/register`  | Dynamic client registration |
| `GET  /oauth/authorize` | Authorization endpoint (PKCE required) |
| `POST /oauth/token`     | Token + refresh endpoint |
| `POST /oauth/revoke`    | Token revocation |
| `POST /mcp`             | MCP Streamable HTTP transport (requires `Authorization: Bearer <access_token>`) |

## Sample client (Node, no dependencies)

```js
import { createHash, randomBytes } from 'node:crypto';

const ISSUER = 'http://localhost:3000';
const REDIRECT_URI = 'http://localhost:9999/callback';

// 1. Discover
const discovery = await (await fetch(`${ISSUER}/.well-known/oauth-authorization-server`)).json();

// 2. Register a client (one-time)
const reg = await (await fetch(discovery.registration_endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'my-mcp-client',
    redirect_uris: [REDIRECT_URI]
  })
})).json();
const { client_id } = reg;

// 3. Build PKCE pair
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

// 4. Send the user to the authorization endpoint
const authUrl = new URL(discovery.authorization_endpoint);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', client_id);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('code_challenge', challenge);
authUrl.searchParams.set('code_challenge_method', 'S256');
authUrl.searchParams.set('state', randomBytes(8).toString('hex'));
console.log('Open in browser:', authUrl.toString());

// 5. After the user is redirected back with ?code=..., exchange it
const code = '<copy from the redirect>';
const tokenRes = await fetch(discovery.token_endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id,
    code_verifier: verifier
  })
});
const tokens = await tokenRes.json();
// tokens.access_token / refresh_token / expires_in

// 6. Use the access token against /mcp
const mcpRes = await fetch(`${ISSUER}/mcp`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${tokens.access_token}`
  },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
});
console.log(await mcpRes.text());
```

## Refreshing tokens

```js
const refresh = await fetch(discovery.token_endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token
  })
});
const refreshed = await refresh.json();
// refreshed.refresh_token IS NEW — refresh tokens rotate on every use (RFC 6749 §6).
```

## Token lifetimes

| Token | Default TTL | Configurable |
|---|---|---|
| Authorization code | 5 minutes | no (single-use) |
| Access token       | 1 hour    | `accessTtlMs` |
| Refresh token      | 30 days   | `refreshTtlMs` (rotates on use) |

## Production notes

- **In-memory storage by default.** Tokens vanish on server restart. For
  multi-instance deployments, pass a `storage` adapter to
  `createOAuthProvider({ storage })` — see `src/server/auth/oauth.js` for
  the interface (`setClient`, `getClient`, `setCode`, `takeCode`, `setToken`,
  `getToken`, `deleteToken`).
- **Personal-scope authorization.** The current implementation auto-approves
  any registered client because the operator's CrawlForge API key IS the
  authorization. For multi-tenant deployments, swap the auto-approve logic
  in `handleAuthorize()` for a real consent screen.
- **PKCE is required.** `plain` is explicitly rejected; only `S256`.
- **No client secrets.** Public clients only — possession of the API key by
  the operator (server side) is the trust root.

## Disabling OAuth

```bash
unset CRAWLFORGE_OAUTH_ENABLED
npm run start:http
# Falls back to static-API-key auth on /mcp.
```

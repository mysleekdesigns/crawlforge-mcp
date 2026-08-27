#!/usr/bin/env node
/**
 * Verify Web Bot Auth end to end, against production.
 *
 * Answers the one question local tests cannot: does the *deployed* server sign
 * its outbound requests, and does that signature verify against the key the
 * *deployed* directory publishes?
 *
 * It asks the server to fetch a header-echo endpoint, reads back the headers it
 * actually sent, and checks the signature against the published JWKS.
 *
 *   CRAWLFORGE_API_KEY=<the key set on the SERVER> node scripts/verify-web-bot-auth.mjs
 *   INTERNAL_SECRET=<the deployment's INTERNAL_PROXY_SECRET> node scripts/verify-web-bot-auth.mjs
 *
 * The MCP endpoint is single-tenant: it authenticates against its own configured
 * key, not against customer API keys, so a valid dashboard key will not work.
 *
 * Optional:
 *   MCP_URL=https://crawlforge-mcp.onrender.com     (server under test)
 *   DIRECTORY=https://www.crawlforge.dev            (directory host)
 *   ECHO_URL=https://postman-echo.com/headers       (header echo service)
 *
 * Costs one credit (a single fetch_url call).
 */

import { createPublicKey, verify } from 'crypto';

const MCP_URL = process.env.MCP_URL || 'https://crawlforge-mcp.onrender.com';
const DIRECTORY = process.env.DIRECTORY || 'https://www.crawlforge.dev';
const ECHO_URL = process.env.ECHO_URL || 'https://postman-echo.com/headers';
const API_KEY = process.env.CRAWLFORGE_API_KEY;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

const results = [];
/** `detail` explains a failure, so it is only worth printing when one happens. */
const check = (ok, label, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};
const info = (text) => console.log(`        ${text}`);

async function getDirectory() {
  const url = `${DIRECTORY}/.well-known/http-message-signatures-directory`;
  const res = await fetch(url, { redirect: 'follow' });
  const contentType = res.headers.get('content-type') || '';
  console.log(`\nDirectory — ${url}`);
  check(res.status === 200, `HTTP 200`, `got ${res.status}`);
  check(
    contentType.startsWith('application/http-message-signatures-directory+json'),
    'media type is application/http-message-signatures-directory+json',
    `got "${contentType}"`
  );
  check(/max-age=\d+/.test(res.headers.get('cache-control') || ''), 'has a Cache-Control max-age');
  if (res.status !== 200) return null;
  const body = await res.json();
  check(Array.isArray(body.keys) && body.keys.length > 0, 'publishes at least one key');
  for (const k of body.keys || []) console.log(`        kid ${k.kid}`);
  return body.keys || [];
}

/** Minimal MCP streamable-HTTP client: initialize, then one tools/call. */
async function mcpCall(name, args) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
  // Two ways in, because this endpoint is single-tenant: its own static API key,
  // or the internal proxy secret the website uses to reach it.
  if (INTERNAL_SECRET) headers['X-Internal-Secret'] = INTERNAL_SECRET;
  else headers['X-API-Key'] = API_KEY;

  const init = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'verify-web-bot-auth', version: '1.0.0' }
      }
    })
  });
  if (init.status === 401) {
    throw new Error(
      `${MCP_URL} rejected the credential.\n` +
      `        This endpoint is single-tenant: it compares what you send against the\n` +
      `        CRAWLFORGE_API_KEY set in ITS OWN environment (Render), not against customer\n` +
      `        keys in the database. A perfectly valid dashboard key will be rejected here.\n` +
      `        Use the CRAWLFORGE_API_KEY value from the Render service's env vars, or set\n` +
      `        INTERNAL_SECRET to the deployment's INTERNAL_PROXY_SECRET instead.`
    );
  }
  if (!init.ok) throw new Error(`initialize failed: HTTP ${init.status} ${await init.text()}`);

  const session = init.headers.get('mcp-session-id');
  if (session) headers['Mcp-Session-Id'] = session;
  await init.text();

  await fetch(MCP_URL, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }).catch(() => {});

  const res = await fetch(MCP_URL, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`tools/call failed: HTTP ${res.status} ${text}`);

  // Streamable HTTP may answer as SSE; take the last data: line.
  const jsonText = text.includes('data:')
    ? text.split('\n').filter((l) => l.startsWith('data:')).pop().slice(5).trim()
    : text;
  const parsed = JSON.parse(jsonText);
  if (parsed.error) throw new Error(`tool error: ${JSON.stringify(parsed.error)}`);
  return parsed.result;
}

/**
 * Pull the headers the server sent out of whatever the echo service returned.
 *
 * The payload arrives doubly wrapped: an MCP tool result whose content is text,
 * whose text is the echo service's JSON, sometimes itself re-encoded. Regexing
 * the stringified blob does not work, because the inner quotes are escaped by
 * then — that produced a run where even "the server sent a User-Agent" failed,
 * which is impossible and was a parser bug reading as a signing failure. So
 * decode properly and search the structure.
 */
function echoedHeaders(result) {
  const seen = new Set();
  const found = {};
  const WANTED = ['signature-input', 'signature', 'signature-agent', 'user-agent'];

  const absorb = (obj) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase();
      if (WANTED.includes(key) && typeof v === 'string' && !found[key]) found[key] = v;
    }
  };

  const walk = (node, depth = 0) => {
    if (node === null || depth > 12) return;

    if (typeof node === 'string') {
      const t = node.trim();
      // A leading quote means a JSON-encoded string: parsing it yields another
      // string, which may itself be the JSON we are after. Bodies come back
      // double-encoded often enough that skipping this loses the headers.
      if (!/^[{["]/.test(t)) return;
      if (seen.has(t)) return;
      seen.add(t);
      try { walk(JSON.parse(t), depth + 1); } catch { /* not JSON, fine */ }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    if (typeof node === 'object') {
      absorb(node);
      for (const v of Object.values(node)) walk(v, depth + 1);
    }
  };

  walk(result);
  return found;
}

async function main() {
  console.log('Web Bot Auth — production verification');

  const keys = await getDirectory();

  if (!API_KEY && !INTERNAL_SECRET) {
    console.log('\nSigning — SKIPPED (set CRAWLFORGE_API_KEY or INTERNAL_SECRET to check the deployed signer)');
    process.exit(results.every(Boolean) ? 0 : 1);
  }

  // The documented invocation carries a placeholder, and a placeholder pasted
  // verbatim comes back as a bare 401 that reads like a real auth failure.
  if (API_KEY && /YOUR_KEY|YOUR_API_KEY|xxx+|\.\.\./i.test(API_KEY)) {
    console.error(
      `\nCRAWLFORGE_API_KEY is still the placeholder ("${API_KEY}").\n` +
      `Substitute your real key — Dashboard → Settings → API Keys.`
    );
    process.exit(1);
  }

  console.log(`\nSigning — asking ${MCP_URL} to fetch ${ECHO_URL}`);
  const result = await mcpCall('fetch_url', { url: ECHO_URL });
  const sent = echoedHeaders(result);

  if (Object.keys(sent).length === 0) {
    console.log('\n  Could not find any headers in the response. Raw result, truncated:');
    console.log(JSON.stringify(result).slice(0, 1200));
    console.log('\n  (If a User-Agent is visible above, this is a parsing bug in this script,');
    console.log('   not a signing failure — every request carries one.)');
  }

  check(Boolean(sent['user-agent']), 'the server sent a User-Agent',
    'not found in the response — likely a parsing problem here, since every request sends one');
  if (sent['user-agent']) info(sent['user-agent']);
  check(Boolean(sent['signature-input']), 'the server sent Signature-Input', sent['signature-input'] || 'absent — is the signing key set, and does this build carry the signing commit?');
  check(Boolean(sent['signature']), 'the server sent Signature');
  check(
    Boolean(sent['signature-agent']),
    'the server sent Signature-Agent',
    'absent — set WEB_BOT_AUTH_DIRECTORY, or a stranger cannot find the directory'
  );
  if (sent['signature-agent']) info(sent['signature-agent']);

  if (!sent['signature-input'] || !sent['signature'] || !keys?.length) {
    process.exit(1);
  }

  const keyid = /keyid="([^"]+)"/.exec(sent['signature-input'])?.[1];
  const published = keys.find((k) => k.kid === keyid);
  check(Boolean(published), 'the signed keyid resolves against the published directory', `signed keyid ${keyid} is not in the directory`);
  if (published) info(`keyid ${keyid}`);
  if (!published) process.exit(1);

  // Rebuild the signature base exactly as a verifier would, from the headers alone.
  const params = sent['signature-input'].replace(/^[^=]+=/, '');
  const covered = /^\(([^)]*)\)/.exec(params)?.[1] || '';
  const authority = new URL(ECHO_URL).host;
  const lines = [`"@authority": ${authority}`];
  if (covered.includes('"signature-agent"')) lines.push(`"signature-agent": ${sent['signature-agent']}`);
  lines.push(`"@signature-params": ${params}`);

  const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: published.x }, format: 'jwk' });
  const raw = Buffer.from(sent['signature'].replace(/^[^=]+=:/, '').replace(/:$/, ''), 'base64');
  check(
    verify(null, Buffer.from(lines.join('\n'), 'utf8'), pub, raw),
    'the signature verifies against the PUBLISHED key'
  );

  console.log(`\n${results.every(Boolean) ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
  process.exit(results.every(Boolean) ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nverification could not complete: ${err.message}`);
  process.exit(1);
});

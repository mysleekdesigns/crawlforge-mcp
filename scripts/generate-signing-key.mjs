#!/usr/bin/env node
/**
 * Generate a Web Bot Auth Ed25519 signing key pair.
 *
 * Prints the key material to STDOUT and writes nothing to disk, so a key can
 * never be left behind in the working tree or picked up by `git add -A`.
 * Copy the two values into your secret store and close the terminal.
 *
 *   node scripts/generate-signing-key.mjs
 *
 * See docs/policy/KEY_ROTATION.md for the rotation procedure.
 */

import { generateKeyPairSync, createHash } from 'crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

// Raw 32-byte key sits at the tail of the SPKI DER.
const der = publicKey.export({ type: 'spki', format: 'der' });
const x = Buffer.from(der.subarray(der.length - 32)).toString('base64url');

// RFC 8037 A.3 — member order is load-bearing.
const kid = createHash('sha256')
  .update(JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x }))
  .digest('base64url');

const b64 = Buffer.from(privatePem, 'utf8').toString('base64');

console.log(`
Web Bot Auth signing key — generated ${new Date().toISOString()}

  Key ID (public, this is the "kid" / "keyid"):
    ${kid}

────────────────────────────────────────────────────────────────────────
SECRET — set on the MCP server only (Render). Never commit this.

  CRAWLFORGE_SIGNING_KEY (base64 of the PEM, safe for single-line secret stores):

${b64}

────────────────────────────────────────────────────────────────────────
PUBLIC — set on the website (Vercel). This is what gets published.

  WEB_BOT_AUTH_PUBLIC_KEYS:

${publicPem.trim()}

────────────────────────────────────────────────────────────────────────
Next:
  1. Set both variables, website first, so the key is published before
     anything signs with it. A verifier that sees an unknown keyid may
     cache the failure.
  2. Confirm https://crawlforge.dev/.well-known/http-message-signatures-directory
     lists the key id above.
  3. Only then set CRAWLFORGE_SIGNING_KEY and redeploy the MCP server.
  4. Record the generation date in docs/policy/KEY_ROTATION.md.

This output is the only copy. It was not written to disk.
`);

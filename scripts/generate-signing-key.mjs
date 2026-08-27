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

════════════════════════════════════════════════════════════════════════
SAFE TO SHARE — this is public information.

  Key ID (the "kid" / "keyid"):
    ${kid}

  WEB_BOT_AUTH_PUBLIC_KEYS  → set on the website (Vercel):

${publicPem.trim()}

════════════════════════════════════════════════════════════════════════
Next:
  1. Set WEB_BOT_AUTH_PUBLIC_KEYS on Vercel and redeploy — website FIRST.
  2. Confirm the key id above appears at
     https://crawlforge.dev/.well-known/http-message-signatures-directory
     (signing before it is published risks a verifier caching the failure
     for the directory's 24h max-age).
  3. Only then set CRAWLFORGE_SIGNING_KEY below on Render and redeploy.
  4. Record the generation date in docs/policy/KEY_ROTATION.md.

════════════════════════════════════════════════════════════════════════
  ⚠  SECRET BELOW — everything past this line is the private key.

  Do NOT paste it into a chat, an issue, a PR, or any terminal that is
  being recorded. Copy it straight into Render's environment settings.
  Anything that sees it can sign requests as CrawlForge; if that happens,
  discard the pair and generate a new one.

  CRAWLFORGE_SIGNING_KEY (base64 PEM, for single-line secret stores):

${b64}

  ⚠  END SECRET. This output is the only copy — it was not written to disk.
════════════════════════════════════════════════════════════════════════
`);

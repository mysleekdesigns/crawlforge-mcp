/**
 * webBotAuth — signs outbound requests so a site owner can verify who we are.
 *
 * A User-Agent is a claim anyone can make. Web Bot Auth turns our identity into
 * something a site can check: an Ed25519 signature over the request, per
 * RFC 9421 (HTTP Message Signatures) with the `web-bot-auth` profile from
 * draft-meunier-web-bot-auth-architecture. The public key is published at
 * `/.well-known/http-message-signatures-directory` on crawlforge.dev.
 *
 * This is the mechanism behind ground rule G4. Honest identification only helps
 * a site owner if it cannot be spoofed by someone else claiming to be us.
 *
 * Signing is OPT-IN and absent by default: with no key configured every export
 * here is a no-op and requests go out exactly as before. Key material lives
 * only in the environment, never in the repo.
 *
 * Verified against the official test vectors (architecture draft Appendix A.2.1
 * with the RFC 9421 Appendix B.1.4 key) — see tests/unit/webBotAuth.test.js.
 */

import { createHash, createPrivateKey, createPublicKey, sign, randomBytes } from 'crypto';

/** The profile tag every web-bot-auth signature carries. */
const WEB_BOT_AUTH_TAG = 'web-bot-auth';

/** The draft RECOMMENDS an expiry no more than 24 hours; ours is far shorter. */
const DEFAULT_LIFETIME_SECONDS = 300;

let cachedKey; // undefined = not yet resolved, null = none configured

/**
 * The raw 32-byte Ed25519 public key as base64url, which is the JWK `x`.
 * @param {import('crypto').KeyObject} publicKey
 * @returns {string}
 */
function publicKeyX(publicKey) {
  // An Ed25519 SPKI DER is a 12-byte header followed by the 32-byte key.
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return Buffer.from(der.subarray(der.length - 32)).toString('base64url');
}

/**
 * RFC 8037 Appendix A.3 thumbprint: SHA-256 over the canonical JWK with its
 * member names in lexicographic order and no whitespace, base64url unpadded.
 * The member order is load-bearing — reordering it changes the key id.
 * @param {string} x base64url raw public key
 * @returns {string}
 */
export function jwkThumbprint(x) {
  const canonical = JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x });
  return createHash('sha256').update(canonical).digest('base64url');
}

/**
 * The public JWK for a key pair, in the shape the directory publishes.
 * @param {import('crypto').KeyObject} publicKey
 */
export function publicJwk(publicKey) {
  const x = publicKeyX(publicKey);
  return { kty: 'OKP', crv: 'Ed25519', kid: jwkThumbprint(x), x, use: 'sig', alg: 'ed25519' };
}

/**
 * Resolve the signing key from the environment, or null when none is set.
 *
 * `CRAWLFORGE_SIGNING_KEY` holds an Ed25519 private key as a PKCS#8 PEM —
 * either literally (with real newlines) or base64-encoded, since most secret
 * stores mangle multi-line values. A malformed key is a configuration error we
 * surface once and then ignore: it must not take every fetch down with it.
 *
 * @returns {{ privateKey: import('crypto').KeyObject, jwk: object } | null}
 */
export function getSigningKey() {
  if (cachedKey !== undefined) return cachedKey;

  const raw = process.env.CRAWLFORGE_SIGNING_KEY;
  if (!raw || !raw.trim()) {
    cachedKey = null;
    return cachedKey;
  }

  try {
    const pem = raw.includes('-----BEGIN')
      ? raw.replace(/\\n/g, '\n')
      : Buffer.from(raw.trim(), 'base64').toString('utf8');

    const privateKey = createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error(`expected an ed25519 key, got ${privateKey.asymmetricKeyType}`);
    }
    cachedKey = { privateKey, jwk: publicJwk(createPublicKey(privateKey)) };
  } catch (error) {
    console.error(
      `[web-bot-auth] CRAWLFORGE_SIGNING_KEY could not be loaded, so requests will go out unsigned: ${error.message}`
    );
    cachedKey = null;
  }

  return cachedKey;
}

/**
 * Serialise the @signature-params of a signature base.
 * Parameter order is part of the signed bytes, so it must match what the
 * verifier reconstructs — it is the draft's order, not an arbitrary one.
 */
function signatureParams(components, { created, expires, keyid, nonce }) {
  const covered = components.map((c) => `"${c}"`).join(' ');
  return (
    `(${covered})` +
    `;created=${created}` +
    `;keyid="${keyid}"` +
    `;alg="ed25519"` +
    `;expires=${expires}` +
    `;nonce="${nonce}"` +
    `;tag="${WEB_BOT_AUTH_TAG}"`
  );
}

/**
 * Build the RFC 9421 signature base for a request.
 *
 * Exported for the test vectors: the base is the exact byte string that gets
 * signed, so reproducing the published one is what proves the implementation
 * interoperates rather than merely agreeing with itself.
 *
 * @param {{ authority: string, signatureAgent?: string|null }} request
 * @param {{ created: number, expires: number, keyid: string, nonce: string }} params
 * @returns {{ base: string, components: string[], params: string }}
 */
export function buildSignatureBase(request, params) {
  const components = ['@authority'];
  const lines = [`"@authority": ${request.authority}`];

  // The draft requires Signature-Agent to be covered whenever it is sent.
  if (request.signatureAgent) {
    components.push('signature-agent');
    lines.push(`"signature-agent": "${request.signatureAgent}"`);
  }

  const serialised = signatureParams(components, params);
  lines.push(`"@signature-params": ${serialised}`);

  return { base: lines.join('\n'), components, params: serialised };
}

/**
 * Signature headers for an outbound request, or null when signing is off.
 *
 * @param {string} url the request target
 * @param {object} [options]
 * @param {string|null} [options.signatureAgent] directory URL to advertise
 * @param {number} [options.now] epoch seconds, for deterministic tests
 * @param {number} [options.expires] epoch seconds, for deterministic tests
 * @param {string} [options.nonce] base64 nonce, for deterministic tests
 * @returns {Record<string,string>|null}
 */
export function signRequestHeaders(url, options = {}) {
  const key = getSigningKey();
  if (!key) return null;

  let authority;
  try {
    authority = new URL(url).host;
  } catch {
    return null; // not our job to validate URLs; the fetch path already does
  }

  const created = options.now ?? Math.floor(Date.now() / 1000);
  const expires = options.expires ?? created + DEFAULT_LIFETIME_SECONDS;
  // The draft RECOMMENDS 64 random bytes, unique within the validity window.
  const nonce = options.nonce ?? randomBytes(64).toString('base64');
  const signatureAgent = options.signatureAgent ?? process.env.WEB_BOT_AUTH_DIRECTORY ?? null;

  const { base, params } = buildSignatureBase(
    { authority, signatureAgent },
    { created, expires, keyid: key.jwk.kid, nonce }
  );

  const signature = sign(null, Buffer.from(base, 'utf8'), key.privateKey).toString('base64');

  const headers = {
    'Signature-Input': `sig1=${params}`,
    'Signature': `sig1=:${signature}:`
  };
  if (signatureAgent) headers['Signature-Agent'] = `"${signatureAgent}"`;
  return headers;
}

/** Test hook: forget the resolved key so a changed env var is picked up. */
export function _resetSigningKey() {
  cachedKey = undefined;
}

/**
 * Web Bot Auth signing (src/utils/webBotAuth.js).
 *
 * The point of these tests is interoperability, not self-consistency: a signer
 * checked only against its own verifier can be confidently wrong. So the core
 * cases reproduce the OFFICIAL published vectors byte for byte —
 * draft-meunier-web-bot-auth-architecture-02 Appendix A.2, signed with the
 * Ed25519 key from RFC 9421 Appendix B.1.4. If our signature base or parameter
 * order drifts, these stop matching.
 *
 * Run: node --test tests/unit/webBotAuth.test.js --test-force-exit
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, createPrivateKey, generateKeyPairSync, verify } from 'node:crypto';

const {
  jwkThumbprint, publicJwk, buildSignatureBase, signRequestHeaders, getSigningKey, _resetSigningKey
} = await import('../../src/utils/webBotAuth.js');

/** RFC 9421 Appendix B.1.4 — test-key-ed25519. */
const TEST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIJ+DYvh6SEqVTm50DFtMDoQikTmiCqirVv9mWG9qfSnF
-----END PRIVATE KEY-----`;
const TEST_KEY_X = 'JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs';
const TEST_KEY_KID = 'poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U';

beforeEach(() => {
  delete process.env.CRAWLFORGE_SIGNING_KEY;
  delete process.env.WEB_BOT_AUTH_DIRECTORY;
  _resetSigningKey();
});

describe('key identity', () => {
  test('thumbprint matches the published keyid for the RFC 9421 test key', () => {
    assert.equal(jwkThumbprint(TEST_KEY_X), TEST_KEY_KID);
  });

  test('canonical member order is load-bearing', () => {
    // Same inputs, wrong member order — must not produce the published keyid.
    // This is the mistake that silently yields a directory nobody can match.
    const wrong = createHash('sha256')
      .update(JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: TEST_KEY_X }))
      .digest('base64url');
    assert.notEqual(wrong, TEST_KEY_KID);
  });

  test('publicJwk derives x and kid from the key itself', () => {
    const jwk = publicJwk(createPublicKey(createPrivateKey(TEST_KEY_PEM)));
    assert.equal(jwk.x, TEST_KEY_X);
    assert.equal(jwk.kid, TEST_KEY_KID);
    assert.equal(jwk.kty, 'OKP');
    assert.equal(jwk.crv, 'Ed25519');
  });
});

describe('official test vectors — architecture draft A.2', () => {
  test('A.2.1 — Signature-Agent absent', () => {
    const nonce = 'mYotfW3CUjI68sbGw6oKd7kyXqPjZEtU8xFPGWFrqOAf5qC6MDe3pys3SWWCudB0MvwslHy32WXUpkR7u0lt/w==';
    const { base } = buildSignatureBase(
      { authority: 'example.com', signatureAgent: null },
      { created: 1735689600, expires: 1735693200, keyid: TEST_KEY_KID, nonce }
    );

    assert.equal(
      base,
      '"@authority": example.com\n' +
      '"@signature-params": ("@authority")' +
      ';created=1735689600' +
      `;keyid="${TEST_KEY_KID}"` +
      ';alg="ed25519"' +
      ';expires=1735693200' +
      `;nonce="${nonce}"` +
      ';tag="web-bot-auth"'
    );

    process.env.CRAWLFORGE_SIGNING_KEY = TEST_KEY_PEM;
    _resetSigningKey();
    const headers = signRequestHeaders('https://example.com/anything', {
      now: 1735689600, expires: 1735693200, nonce, signatureAgent: null
    });

    assert.equal(
      headers.Signature,
      'sig1=:+NA/cssf4Y2bQTMTkyvTGRCaVzp9quyUevdwwMtMOWhhOOZ2T1subBj0BtvdnrpDEuwSAbiTeElXDzHL3WWKCw==:',
      'signature must match the published vector byte for byte'
    );
    assert.equal(headers['Signature-Agent'], undefined);
  });

  test('A.2.2 — Signature-Agent present and covered', () => {
    const nonce = 'e8N7S2MFd/qrd6T2R3tdfAuuANngKI7LFtKYI/vowzk4lAZYadIX6wW25MwG7DCT9RUKAJ0qVkU0mEeLElW1qg==';
    process.env.CRAWLFORGE_SIGNING_KEY = TEST_KEY_PEM;
    _resetSigningKey();

    const headers = signRequestHeaders('https://example.com/anything', {
      now: 1735689600, expires: 1735693200, nonce, signatureAgent: 'https://signature-agent.test'
    });

    assert.equal(
      headers.Signature,
      'sig1=:jdq0SqOwHdyHr9+r5jw3iYZH6aNGKijYp/EstF4RQTQdi5N5YYKrD+mCT1HA1nZDsi6nJKuHxUi/5Syp3rLWBA==:'
    );
    assert.equal(headers['Signature-Agent'], '"https://signature-agent.test"');
    assert.match(headers['Signature-Input'], /\("@authority" "signature-agent"\)/);
  });
});

describe('signing is opt-in and fails safe', () => {
  test('no key configured — nothing is signed', () => {
    assert.equal(getSigningKey(), null);
    assert.equal(signRequestHeaders('https://example.com/'), null);
  });

  test('a malformed key does not throw, it disables signing', () => {
    process.env.CRAWLFORGE_SIGNING_KEY = 'not-a-key';
    _resetSigningKey();
    assert.equal(signRequestHeaders('https://example.com/'), null);
  });

  test('a non-ed25519 key is rejected rather than used', () => {
    const { privateKey } = generateKeyPairSync('ed448');
    process.env.CRAWLFORGE_SIGNING_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
    _resetSigningKey();
    assert.equal(signRequestHeaders('https://example.com/'), null);
  });

  test('a base64-wrapped PEM is accepted (secret stores mangle newlines)', () => {
    process.env.CRAWLFORGE_SIGNING_KEY = Buffer.from(TEST_KEY_PEM, 'utf8').toString('base64');
    _resetSigningKey();
    const key = getSigningKey();
    assert.ok(key);
    assert.equal(key.jwk.kid, TEST_KEY_KID);
  });

  test('an unparseable URL signs nothing rather than throwing', () => {
    process.env.CRAWLFORGE_SIGNING_KEY = TEST_KEY_PEM;
    _resetSigningKey();
    assert.equal(signRequestHeaders('not a url'), null);
  });
});

describe('a freshly generated key verifies end to end', () => {
  test('signature validates against the published JWK', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    process.env.CRAWLFORGE_SIGNING_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
    _resetSigningKey();

    const nonce = 'dGVzdC1ub25jZQ==';
    const headers = signRequestHeaders('https://target.example/path', { now: 1800000000, nonce });

    // Reconstruct the base a verifier would build from the headers alone.
    const params = headers['Signature-Input'].replace(/^sig1=/, '');
    const base = `"@authority": target.example\n"@signature-params": ${params}`;
    const raw = Buffer.from(headers.Signature.replace(/^sig1=:|:$/g, ''), 'base64');

    assert.equal(verify(null, Buffer.from(base, 'utf8'), publicKey, raw), true);
    // And the keyid in the signature is the one the directory would publish.
    assert.match(headers['Signature-Input'], new RegExp(`keyid="${publicJwk(publicKey).kid}"`));
  });
});

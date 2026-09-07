/**
 * cli login — PKCE parameters, approval URL and the status poll.
 *
 * pollStatus takes an injected fetch and sleep, so nothing here touches the
 * network or waits for real. The website validates session_id against
 * /^[A-Za-z0-9_-]{16,128}$/, code_challenge against /^[A-Za-z0-9_-]{43}$/ and
 * code_verifier against /^[A-Za-z0-9_-]{43,128}$/; the shapes are pinned here.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { generateLoginParams, buildApprovalUrl, pollStatus } from '../../src/cli/commands/login.js';

const ENDPOINT = 'https://www.crawlforge.dev';
const PARAMS = { sessionId: 'a'.repeat(32), codeVerifier: 'v'.repeat(43), codeChallenge: 'c'.repeat(43) };

const res = (status, body) => ({ status, json: async () => body });
const pending = () => res(200, { status: 'pending' });
const complete = () => res(200, { status: 'complete', api_key: 'cf_live_x', key_id: 'k1', key_name: 'CLI on host', email: 'a@b.c' });

// Scripted fetch: hands out the responses in order (a function entry throws
// as a network error) and records every call.
function scriptedFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = script.shift();
    if (typeof next === 'function') throw next();
    return next;
  };
  impl.calls = calls;
  return impl;
}

// Fake clock: sleeping advances it, so timeouts are deterministic.
function fakeClock() {
  let t = 0;
  const sleeps = [];
  return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps };
}

describe('cli login — generateLoginParams', () => {
  test('session id is 32 hex chars, verifier and challenge are 43-char base64url', () => {
    const p = generateLoginParams();
    assert.match(p.sessionId, /^[0-9a-f]{32}$/);
    assert.match(p.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
    assert.match(p.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  });

  test('challenge is sha256(verifier) in base64url', () => {
    const p = generateLoginParams();
    assert.equal(p.codeChallenge, createHash('sha256').update(p.codeVerifier).digest('base64url'));
  });

  test('two calls differ', () => {
    assert.notEqual(generateLoginParams().sessionId, generateLoginParams().sessionId);
  });
});

describe('cli login — buildApprovalUrl', () => {
  test('carries the three params and the url-encoded name', () => {
    const url = buildApprovalUrl(ENDPOINT, PARAMS, 'CLI on my host');
    assert.ok(url.startsWith(ENDPOINT + '/cli-auth?'));
    assert.ok(url.includes('name=CLI%20on%20my%20host'));
    const q = new URL(url).searchParams;
    assert.equal(q.get('session_id'), PARAMS.sessionId);
    assert.equal(q.get('code_challenge'), PARAMS.codeChallenge);
    assert.equal(q.get('name'), 'CLI on my host');
    assert.ok(!url.includes(PARAMS.codeVerifier), 'the verifier never leaves the CLI');
  });
});

describe('cli login — pollStatus', () => {
  test('posts session_id + code_verifier and resolves with the complete payload after pending ticks', async () => {
    const fetchImpl = scriptedFetch([pending(), pending(), pending(), complete()]);
    const clock = fakeClock();
    const body = await pollStatus(fetchImpl, ENDPOINT, PARAMS, { sleep: clock.sleep, now: clock.now });
    assert.equal(body.status, 'complete');
    assert.equal(body.api_key, 'cf_live_x');
    assert.equal(fetchImpl.calls.length, 4);
    assert.deepEqual(clock.sleeps, [3000, 3000, 3000]);
    const { url, init } = fetchImpl.calls[0];
    assert.equal(url, ENDPOINT + '/api/auth/cli/status');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), { session_id: PARAMS.sessionId, code_verifier: PARAMS.codeVerifier });
  });

  test('403 verifier mismatch rejects with code CLI_AUTH_VERIFIER_MISMATCH', async () => {
    const fetchImpl = scriptedFetch([pending(), res(403, { error: { code: 'CLI_AUTH_VERIFIER_MISMATCH' } })]);
    const clock = fakeClock();
    await assert.rejects(
      pollStatus(fetchImpl, ENDPOINT, PARAMS, { sleep: clock.sleep, now: clock.now }),
      (err) => err.code === 'CLI_AUTH_VERIFIER_MISMATCH'
    );
    assert.equal(fetchImpl.calls.length, 2);
  });

  test('no approval before the deadline rejects with CLI_AUTH_TIMEOUT', async () => {
    const fetchImpl = scriptedFetch(Array.from({ length: 20 }, pending));
    const clock = fakeClock();
    await assert.rejects(
      pollStatus(fetchImpl, ENDPOINT, PARAMS, { timeoutMs: 10000, sleep: clock.sleep, now: clock.now }),
      (err) => err.code === 'CLI_AUTH_TIMEOUT'
    );
    assert.equal(fetchImpl.calls.length, 4); // polls at t=0, 3000, 6000, 9000; 12000 is past the deadline
  });

  test('429 doubles the interval up to 30 s and keeps polling', async () => {
    const fetchImpl = scriptedFetch([res(429, {}), res(429, {}), res(429, {}), res(429, {}), pending(), complete()]);
    const clock = fakeClock();
    const body = await pollStatus(fetchImpl, ENDPOINT, PARAMS, { sleep: clock.sleep, now: clock.now });
    assert.equal(body.status, 'complete');
    assert.deepEqual(clock.sleeps, [6000, 12000, 24000, 30000, 30000]);
  });

  test('network errors and 5xx retry, then abort after 10 in a row', async () => {
    const boom = () => new Error('ECONNREFUSED');
    const fetchImpl = scriptedFetch([boom, res(500, {}), boom, res(502, {}), boom, boom, boom, boom, boom, boom, complete()]);
    const clock = fakeClock();
    await assert.rejects(
      pollStatus(fetchImpl, ENDPOINT, PARAMS, { sleep: clock.sleep, now: clock.now }),
      (err) => err.code === 'CLI_AUTH_UNREACHABLE'
    );
    assert.equal(fetchImpl.calls.length, 10);
  });

  test('a pending response resets the consecutive-failure count', async () => {
    const boom = () => new Error('ECONNREFUSED');
    const script = [];
    for (let i = 0; i < 4; i++) script.push(boom, boom, boom, boom, boom, boom, pending());
    script.push(complete());
    const fetchImpl = scriptedFetch(script);
    const clock = fakeClock();
    const body = await pollStatus(fetchImpl, ENDPOINT, PARAMS, { sleep: clock.sleep, now: clock.now });
    assert.equal(body.status, 'complete');
    assert.equal(fetchImpl.calls.length, 29);
  });
});

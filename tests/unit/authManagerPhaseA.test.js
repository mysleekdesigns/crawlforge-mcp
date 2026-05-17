/**
 * Unit tests for Phase A (v3.0.19) reliability + audit-phase-5 fixes in
 * src/core/AuthManager.js.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test tests/unit/authManagerPhaseA.test.js
 *
 * The leading `CRAWLFORGE_CREATOR_SECRET=` unsets the creator-mode secret so
 * AuthManager doesn't short-circuit out of every code path. See the comment
 * block at the top of authManager.test.js for the full pattern.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

async function makeTempHome() {
  const dir = path.join(os.tmpdir(), `crawlforge-phaseA-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function removeTempHome(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

const mod = await import('../../src/core/AuthManager.js');
const authManager = mod.default;

function resetSingleton(tempHome, userId, apiKey = 'test-api-key') {
  authManager.creditCache.clear();
  authManager.lastSuccessfulCreditCheck.clear();
  authManager.lastCreditCheck = null;
  authManager.initialized = false;
  process.env.HOME = tempHome;
  authManager.configPath = path.join(tempHome, '.crawlforge', 'config.json');
  authManager.pendingUsagePath = path.join(tempHome, '.crawlforge', 'pending-usage.json');
  authManager.config = { apiKey, userId, email: 'test@example.com' };
}

const originalFetch = global.fetch;
const originalHome = process.env.HOME;
const originalSkip = process.env.CRAWLFORGE_SKIP_STARTUP_VALIDATION;

afterEach(() => {
  global.fetch = originalFetch;
  process.env.HOME = originalHome;
  if (originalSkip === undefined) {
    delete process.env.CRAWLFORGE_SKIP_STARTUP_VALIDATION;
  } else {
    process.env.CRAWLFORGE_SKIP_STARTUP_VALIDATION = originalSkip;
  }
});

function skipIfCreatorMode(t) {
  if (authManager.isCreatorMode()) {
    t.skip('Creator mode is active — run with CRAWLFORGE_CREATOR_SECRET= to disable');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Audit phase 5: startup API key re-validation
// ---------------------------------------------------------------------------

test('initialize: revoked API key -> throws and refuses to boot', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  const userId = 'phaseA-revoked';
  resetSingleton(tempHome, userId, 'revoked-key');

  // Persist a config file so loadConfig() succeeds, then make the backend
  // explicitly reject the key on the validate endpoint.
  await fs.mkdir(path.dirname(authManager.configPath), { recursive: true });
  await fs.writeFile(
    authManager.configPath,
    JSON.stringify({ apiKey: 'revoked-key', userId, email: 'x@y.z' }),
    { mode: 0o600 }
  );
  authManager.config = null; // force reload in initialize()
  authManager.initialized = false;

  global.fetch = async () => ({
    ok: false,
    json: async () => ({ message: 'API key has been revoked' })
  });

  try {
    await assert.rejects(
      () => authManager.initialize(),
      /rejected by backend/i,
      'initialize() must throw when backend reports the key as revoked'
    );
  } finally {
    await removeTempHome(tempHome);
  }
});

test('initialize: valid API key + reachable backend -> resolves', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  const userId = 'phaseA-valid';
  resetSingleton(tempHome, userId, 'good-key');

  await fs.mkdir(path.dirname(authManager.configPath), { recursive: true });
  await fs.writeFile(
    authManager.configPath,
    JSON.stringify({ apiKey: 'good-key', userId, email: 'x@y.z' }),
    { mode: 0o600 }
  );
  authManager.config = null;
  authManager.initialized = false;

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ userId, email: 'x@y.z', creditsRemaining: 100, planId: 'free' })
  });

  try {
    await authManager.initialize();
    assert.equal(authManager.initialized, true, 'initialize should succeed with a valid key');
  } finally {
    await removeTempHome(tempHome);
  }
});

test('initialize: backend unreachable (network error) -> tolerates and boots', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  const userId = 'phaseA-offline';
  resetSingleton(tempHome, userId, 'some-key');

  await fs.mkdir(path.dirname(authManager.configPath), { recursive: true });
  await fs.writeFile(
    authManager.configPath,
    JSON.stringify({ apiKey: 'some-key', userId, email: 'x@y.z' }),
    { mode: 0o600 }
  );
  authManager.config = null;
  authManager.initialized = false;

  global.fetch = async () => { throw new Error('ECONNREFUSED'); };

  try {
    await authManager.initialize();
    assert.equal(authManager.initialized, true,
      'a transient network failure must not block startup; runtime credit check handles revocation');
  } finally {
    await removeTempHome(tempHome);
  }
});

test('initialize: CRAWLFORGE_SKIP_STARTUP_VALIDATION=true bypasses revalidation', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  const userId = 'phaseA-skip';
  resetSingleton(tempHome, userId, 'any-key');

  await fs.mkdir(path.dirname(authManager.configPath), { recursive: true });
  await fs.writeFile(
    authManager.configPath,
    JSON.stringify({ apiKey: 'any-key', userId, email: 'x@y.z' }),
    { mode: 0o600 }
  );
  authManager.config = null;
  authManager.initialized = false;
  process.env.CRAWLFORGE_SKIP_STARTUP_VALIDATION = 'true';

  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return { ok: false, json: async () => ({ message: 'invalid' }) };
  };

  try {
    await authManager.initialize();
    assert.equal(fetchCalled, false,
      'skip env var must short-circuit before the validate fetch');
  } finally {
    await removeTempHome(tempHome);
  }
});

// ---------------------------------------------------------------------------
// A2 reliability: usage reports carry a requestId + idempotency key
// ---------------------------------------------------------------------------

test('reportUsage: success path sends Idempotency-Key header and requestId in body', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'phaseA-idem');

  let capturedHeaders = null;
  let capturedBody = null;
  global.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    capturedBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({}) };
  };

  try {
    await authManager.reportUsage('fetch_url', 1, { url: 'https://example.com' });
    assert.ok(capturedHeaders, 'fetch must have been called');
    assert.ok(capturedHeaders['Idempotency-Key'],
      'Idempotency-Key header must be set on usage reports');
    assert.ok(capturedBody.requestId, 'usage body must include requestId');
    assert.ok(capturedBody.idempotencyKey, 'usage body must include idempotencyKey');
    assert.equal(capturedBody.idempotencyKey, capturedHeaders['Idempotency-Key'],
      'header and body idempotency key must match');
  } finally {
    await removeTempHome(tempHome);
  }
});

test('reportUsage: failure path persists requestId + idempotencyKey in pending-usage.json', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'phaseA-pending');

  global.fetch = async () => { throw new Error('backend unreachable'); };

  try {
    await authManager.reportUsage('extract_text', 1, { url: 'https://example.com' });
    const raw = await fs.readFile(authManager.pendingUsagePath, 'utf8');
    const entries = JSON.parse(raw);
    assert.equal(entries.length, 1, 'one pending entry should be queued');
    const entry = entries[0];
    assert.ok(entry.requestId, 'pending entry must carry requestId');
    assert.ok(entry.idempotencyKey, 'pending entry must carry idempotencyKey');
    assert.equal(entry.toolName, 'extract_text');
    assert.equal(entry.creditsUsed, 1);
  } finally {
    await removeTempHome(tempHome);
  }
});

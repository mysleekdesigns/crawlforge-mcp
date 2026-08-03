/**
 * Unit tests for Phase 1 critical-security billing/telemetry fixes:
 *   - the /api/v1/usage telemetry payload masks secrets found in tool params
 *     (AuthManager.js, _reportUsageOnce)
 *   - a credit-check failure (before the handler ever runs) bills zero
 *     credits — no usage report, nothing queued (withAuth.js)
 *   - checkCredits distinguishes an invalid/revoked key (401/403) from a
 *     transient backend problem (5xx falls into the existing grace-window
 *     path, same as a network failure)
 *   - _reportUsageOnce / _flushPendingUsage retain/queue an entry on a
 *     non-2xx backend response instead of silently dropping it
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test tests/unit/phase1-billing.test.js --test-force-exit
 *
 * The leading `CRAWLFORGE_CREATOR_SECRET=` unsets the secret loaded from .env
 * so creator mode stays OFF — see the header comment in authManager.test.js
 * for the full rationale.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeWithAuth } from '../../src/server/withAuth.js';

async function makeTempHome() {
  const dir = path.join(os.tmpdir(), `crawlforge-phase1-${Math.random().toString(36).slice(2)}`);
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

function makeFakeLogger() {
  const calls = [];
  return {
    calls,
    info(message, context) { calls.push({ level: 'info', message, context }); },
    warn(message, context) { calls.push({ level: 'warn', message, context }); },
    error(message, error, context) { calls.push({ level: 'error', message, error, context }); },
    debug(message, context) { calls.push({ level: 'debug', message, context }); }
  };
}

async function pendingUsageExists() {
  try {
    await fs.readFile(authManager.pendingUsagePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}

const originalFetch = global.fetch;
const originalHome = process.env.HOME;

afterEach(() => {
  global.fetch = originalFetch;
  process.env.HOME = originalHome;
});

function skipIfCreatorMode(t) {
  if (authManager.isCreatorMode()) {
    t.skip('Creator mode is active — run with CRAWLFORGE_CREATOR_SECRET= to disable');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 1. Usage telemetry never carries plaintext secrets
// ---------------------------------------------------------------------------

test('reportUsage: telemetry payload masks llmConfig apiKey, headers.Authorization, webhook.signingSecret', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'phase1-mask-user');

  const openaiSecret = 'sk-SUPERSECRETOPENAIKEY123';
  const bearerSecret = 'BEARERSUPERSECRETTOKEN456';
  const webhookSecret = 'whsec_SUPERSECRETSIGNING789';

  let capturedBody = null;
  global.fetch = async (url, opts) => {
    if (opts?.body) capturedBody = opts.body;
    return { ok: true, json: async () => ({}) };
  };

  try {
    await authManager.reportUsage('extract_structured', 3, {
      llmConfig: { openai: { apiKey: openaiSecret } },
      headers: { Authorization: `Bearer ${bearerSecret}` },
      webhook: { signingSecret: webhookSecret }
    });

    assert.ok(capturedBody, 'usage POST body should have been captured');
    assert.ok(!capturedBody.includes(openaiSecret), 'openai apiKey must not appear in plaintext');
    assert.ok(!capturedBody.includes(bearerSecret), 'Authorization bearer token must not appear in plaintext');
    assert.ok(!capturedBody.includes(webhookSecret), 'webhook signingSecret must not appear in plaintext');

    const parsed = JSON.parse(capturedBody);
    assert.match(parsed.requestData.llmConfig.openai.apiKey, /REDACTED/, 'apiKey should be masked');
    assert.match(parsed.requestData.headers.Authorization, /REDACTED/, 'Authorization header should be masked');
    assert.match(parsed.requestData.webhook.signingSecret, /REDACTED/, 'signingSecret should be masked');
  } finally {
    await removeTempHome(tempHome);
  }
});

// ---------------------------------------------------------------------------
// 2. A credit-check failure bills zero credits (handler never ran)
// ---------------------------------------------------------------------------

test('withAuth: credit-check failure (backend down past grace window) bills zero credits', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'phase1-refused-user');

  let usageCallCount = 0;
  global.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('/api/v1/credits')) {
      throw new Error('ECONNREFUSED');
    }
    if (typeof url === 'string' && url.includes('/api/v1/usage')) {
      usageCallCount++;
    }
    return { ok: true, json: async () => ({}) };
  };

  const logger = makeFakeLogger();
  const withAuth = makeWithAuth({ authManager, logger });

  let handlerCalled = false;
  const handler = withAuth('fetch_url', async () => {
    handlerCalled = true;
    return { content: [{ type: 'text', text: 'ok' }] };
  });

  try {
    await assert.rejects(
      () => handler({ url: 'https://example.com' }),
      /Unable to verify credits/i,
      'credit check failure should propagate, refusing the call'
    );
    assert.equal(handlerCalled, false, 'handler must never run when the credit check itself throws');
    assert.equal(usageCallCount, 0, 'no usage report should be POSTed for a refused call');
    assert.equal(await pendingUsageExists(), false, 'nothing should be queued to pending-usage.json for a refused call');
  } finally {
    await removeTempHome(tempHome);
  }
});

// ---------------------------------------------------------------------------
// 3. checkCredits: 401/403 (invalid/revoked key) vs 5xx (grace-window path)
// ---------------------------------------------------------------------------

test('checkCredits: 401 response throws a descriptive invalid/revoked-key error, not "insufficient credits"', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'phase1-401-user');

  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ message: 'API key has been revoked' })
  });

  try {
    await assert.rejects(
      () => authManager.checkCredits(1),
      (err) => {
        assert.match(err.message, /revoked|invalid/i, 'error should describe an invalid/revoked key');
        assert.doesNotMatch(err.message, /insufficient/i, 'must not be conflated with insufficient credits');
        return true;
      }
    );
  } finally {
    await removeTempHome(tempHome);
  }
});

test('checkCredits: 403 response also throws a descriptive invalid/revoked-key error', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'phase1-403-user');

  global.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ message: 'forbidden' })
  });

  try {
    await assert.rejects(
      () => authManager.checkCredits(1),
      /rejected \(403\)/i
    );
  } finally {
    await removeTempHome(tempHome);
  }
});

test('checkCredits: 5xx response falls into the grace-window path (behaves like a network failure)', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  const userId = 'phase1-5xx-user';
  resetSingleton(tempHome, userId);
  authManager.creditCache.set(userId, 100);
  authManager.lastSuccessfulCreditCheck.set(userId, Date.now() - 5_000);

  global.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ message: 'backend overloaded' })
  });

  try {
    const result = await authManager.checkCredits(1);
    assert.equal(result, true, 'fresh cache within the grace window should be honored on a 5xx, same as a network failure');
  } finally {
    await removeTempHome(tempHome);
  }
});

test('checkCredits: 5xx response with no cache throws "Unable to verify credits" (generic path)', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'phase1-5xx-nocache-user');

  global.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ message: 'internal error' })
  });

  try {
    await assert.rejects(
      () => authManager.checkCredits(1),
      /Unable to verify credits/i
    );
  } finally {
    await removeTempHome(tempHome);
  }
});

// ---------------------------------------------------------------------------
// 4. Usage reporting checks response.ok — non-2xx is retained/queued, not dropped
// ---------------------------------------------------------------------------

test('reportUsage: a non-2xx backend response queues the entry to pending-usage.json instead of dropping it', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'phase1-usage-400-user');

  global.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: 'bad request' })
  });

  try {
    await authManager.reportUsage('fetch_url', 1, { url: 'https://example.com' });
    const raw = await fs.readFile(authManager.pendingUsagePath, 'utf8');
    const entries = JSON.parse(raw);
    assert.equal(entries.length, 1, 'a non-2xx usage report must be queued, not silently dropped');
    assert.equal(entries[0].toolName, 'fetch_url');
  } finally {
    await removeTempHome(tempHome);
  }
});

test('_flushPendingUsage: a non-2xx response on retry retains the entry (not counted as flushed)', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'phase1-flush-503-user');

  await authManager._appendPendingUsage({
    toolName: 'extract_text',
    creditsUsed: 1,
    userId: 'phase1-flush-503-user',
    timestamp: new Date().toISOString()
  });

  global.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: 'unavailable' })
  });

  try {
    await authManager._flushPendingUsage();
    const raw = await fs.readFile(authManager.pendingUsagePath, 'utf8');
    const entries = JSON.parse(raw);
    assert.equal(entries.length, 1, 'entry must be retained after a failed (non-2xx) flush attempt');
    assert.equal(entries[0].toolName, 'extract_text');
  } finally {
    await removeTempHome(tempHome);
  }
});

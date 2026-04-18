/**
 * Unit tests for src/core/AuthManager.js (singleton)
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test tests/unit/authManager.test.js
 *
 * The leading `CRAWLFORGE_CREATOR_SECRET=` unsets the secret loaded from .env
 * so creator mode stays OFF (dotenv does not override pre-set env vars).
 * Otherwise `checkCredits` / `reportUsage` short-circuit and these tests
 * become meaningless.
 *
 * Strategy:
 *   - Override HOME to a unique tmpdir per test so ~/.crawlforge/ never
 *     touches the real user config.
 *   - Patch global.fetch per test; restore after.
 *   - Reset singleton internal state (creditCache, lastSuccessfulCreditCheck,
 *     config) at the top of every test.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

async function makeTempHome() {
  const dir = path.join(os.tmpdir(), `crawlforge-test-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function removeTempHome(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

const mod = await import('../../src/core/AuthManager.js');
const authManager = mod.default;

function resetSingleton(tempHome, userId) {
  authManager.creditCache.clear();
  authManager.lastSuccessfulCreditCheck.clear();
  authManager.lastCreditCheck = null;
  process.env.HOME = tempHome;
  authManager.configPath = path.join(tempHome, '.crawlforge', 'config.json');
  authManager.pendingUsagePath = path.join(tempHome, '.crawlforge', 'pending-usage.json');
  authManager.config = { apiKey: 'test-api-key', userId, email: 'test@example.com' };
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
// checkCredits tests
// ---------------------------------------------------------------------------

test('checkCredits: no cache, fetch rejects -> throws "Unable to verify credits"', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'test-user-1');

  global.fetch = async () => { throw new Error('network failure'); };

  try {
    await assert.rejects(
      () => authManager.checkCredits(1),
      /Unable to verify credits/i,
      'should throw when no cache and fetch rejects'
    );
  } finally {
    await removeTempHome(tempHome);
  }
});

test('checkCredits: cache=100, lastSuccessfulCreditCheck 60s ago, fetch rejects -> throws', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  const userId = 'test-user-2';
  resetSingleton(tempHome, userId);
  authManager.creditCache.set(userId, 100);
  authManager.lastSuccessfulCreditCheck.set(userId, Date.now() - 60_000);

  global.fetch = async () => { throw new Error('network failure'); };

  try {
    await assert.rejects(
      () => authManager.checkCredits(1),
      /Unable to verify credits/i,
      'stale cache (>30 s) must not pass through; should throw'
    );
  } finally {
    await removeTempHome(tempHome);
  }
});

test('checkCredits: cache=100, lastSuccessfulCreditCheck 5s ago, fetch rejects, cost=1 -> returns true', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  const userId = 'test-user-3';
  resetSingleton(tempHome, userId);
  authManager.creditCache.set(userId, 100);
  authManager.lastSuccessfulCreditCheck.set(userId, Date.now() - 5_000);

  global.fetch = async () => { throw new Error('network failure'); };

  try {
    const result = await authManager.checkCredits(1);
    assert.equal(result, true, 'fresh cache (<30 s) with sufficient credits should return true despite network failure');
  } finally {
    await removeTempHome(tempHome);
  }
});

test('checkCredits: cache=0, lastSuccessfulCreditCheck fresh, fetch rejects, cost=1 -> throws (insufficient)', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  const userId = 'test-user-4';
  resetSingleton(tempHome, userId);
  authManager.creditCache.set(userId, 0);
  authManager.lastSuccessfulCreditCheck.set(userId, Date.now() - 1_000);

  global.fetch = async () => { throw new Error('network failure'); };

  try {
    await assert.rejects(
      () => authManager.checkCredits(1),
      /credits|insufficient|Unable/i,
      'zero cached credits must throw even within the grace window'
    );
  } finally {
    await removeTempHome(tempHome);
  }
});

// ---------------------------------------------------------------------------
// reportUsage tests
// ---------------------------------------------------------------------------

test('reportUsage: cache=100, fetch rejects -> cache decrements, pending-usage.json has one entry', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  const userId = 'test-user-5';
  resetSingleton(tempHome, userId);
  const creditsUsed = 1;
  authManager.creditCache.set(userId, 100);

  global.fetch = async () => { throw new Error('backend unavailable'); };

  try {
    await authManager.reportUsage('test_tool', creditsUsed);

    const remaining = authManager.creditCache.get(userId);
    assert.equal(remaining, 99, 'creditCache should decrement from 100 to 99');

    const pendingPath = authManager.pendingUsagePath;
    const raw = await fs.readFile(pendingPath, 'utf8');
    const entries = JSON.parse(raw);
    assert.ok(Array.isArray(entries), 'pending-usage.json should contain a JSON array');
    assert.equal(entries.length, 1, 'should have exactly one queued entry');
    assert.equal(entries[0].toolName, 'test_tool', 'entry toolName should match');
    assert.equal(entries[0].creditsUsed, creditsUsed, 'entry creditsUsed should match');
    assert.equal(entries[0].userId, userId, 'entry userId should match');
    assert.equal(typeof entries[0].timestamp, 'string', 'entry timestamp should be an ISO string');
  } finally {
    await removeTempHome(tempHome);
  }
});

test('reportUsage: queued entries flush on next successful reportUsage call', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  const userId = 'test-user-6';
  resetSingleton(tempHome, userId);
  authManager.creditCache.set(userId, 100);

  global.fetch = async () => { throw new Error('backend unavailable'); };
  await authManager.reportUsage('tool_a', 1);

  const pendingPath = authManager.pendingUsagePath;
  const beforeRaw = await fs.readFile(pendingPath, 'utf8');
  const beforeEntries = JSON.parse(beforeRaw);
  assert.equal(beforeEntries.length, 1, 'one entry should be queued after first failure');

  let fetchCallCount = 0;
  global.fetch = async () => {
    fetchCallCount++;
    return { ok: true, json: async () => ({ success: true }) };
  };

  await authManager.reportUsage('tool_b', 1);

  let afterEntries = [];
  try {
    const afterRaw = await fs.readFile(pendingPath, 'utf8');
    afterEntries = JSON.parse(afterRaw);
  } catch {
    afterEntries = [];
  }

  assert.equal(afterEntries.length, 0, 'pending-usage.json should be empty after successful flush');
  assert.ok(fetchCallCount >= 2, `fetch should be called at least twice (for replay + current), got ${fetchCallCount}`);

  await removeTempHome(tempHome);
});

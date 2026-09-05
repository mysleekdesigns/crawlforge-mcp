/**
 * Phase 0.4: every usage report carries the real package version. The
 * backend stores it per call, so a stale literal (it was '3.0.3' for eight
 * minor versions) makes the dashboard's client-version data useless.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test tests/unit/clientVersion.test.js
 *
 * Same setup as authManager.test.js: HOME is a tmpdir so ~/.crawlforge/ is
 * never touched, global.fetch is patched per test and restored after.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const mod = await import('../../src/core/AuthManager.js');
const authManager = mod.default;

async function makeTempHome() {
  const dir = path.join(os.tmpdir(), `crawlforge-test-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

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

/** Capture every usage POST body; respond as an accepting backend. */
function captureUsagePosts() {
  const bodies = [];
  global.fetch = async (url, init) => {
    if (String(url).endsWith('/api/v1/usage')) bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ success: true }) };
  };
  return bodies;
}

test('package.json has a real semver version to compare against', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
});

test('reportUsage: sends the package version, not a literal', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'version-user-1');
  const bodies = captureUsagePosts();

  try {
    await authManager.reportUsage('scrape', 2);

    const report = bodies.find(b => b.tool === 'scrape');
    assert.ok(report, 'one usage POST for the call');
    assert.equal(report.version, pkg.version);
    assert.notEqual(report.version, '3.0.3', 'the stale literal is gone');
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('pending-usage replay: a queued entry is re-sent with the package version too', async (t) => {
  if (skipIfCreatorMode(t)) return;
  const tempHome = await makeTempHome();
  resetSingleton(tempHome, 'version-user-2');

  try {
    // First call fails and is queued to pending-usage.json ...
    global.fetch = async () => { throw new Error('backend unavailable'); };
    await authManager.reportUsage('tool_queued', 1);

    // ... the next successful call replays it.
    const bodies = captureUsagePosts();
    await authManager.reportUsage('tool_live', 1);

    const replayed = bodies.find(b => b.tool === 'tool_queued');
    assert.ok(replayed, 'the queued entry was replayed');
    assert.equal(replayed.version, pkg.version);
    for (const body of bodies) {
      assert.equal(body.version, pkg.version, `every usage POST carries the package version (${body.tool})`);
    }
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

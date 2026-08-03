/**
 * Unit tests: LocalizationManager (src/core/LocalizationManager.js)
 *
 * The `localization` MCP tool has no dedicated tool class — server.js wires
 * a singleton LocalizationManager directly (see server.js "Tool: localization").
 * These tests exercise the real manager instead of a fictional tool wrapper.
 *
 * Run: node --test tests/unit/tools/localization/localization.test.js
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { LocalizationManager } from '../../../../src/core/LocalizationManager.js';

// Managers created per-test are cleaned up here so their (fixed) health-check
// intervals don't keep the test process alive.
const managers = [];

// The constructor kicks off initialize() (which calls setupHealthChecks())
// without awaiting it — wait for the 'initialized' event so tests observe
// the manager in its fully set-up state.
function makeManager(options) {
  const m = new LocalizationManager(options);
  managers.push(m);
  return new Promise((resolve) => {
    if (m.healthCheckIntervals) return resolve(m); // already initialized
    m.once('initialized', () => resolve(m));
  });
}
after(async () => {
  await Promise.all(managers.map((m) => m.cleanup()));
});

describe('LocalizationManager.configureCountry', () => {
  test('returns a full localization config for a supported country', async () => {
    const manager = await makeManager();
    const result = await manager.configureCountry('DE');
    assert.equal(result.countryCode, 'DE');
    assert.equal(result.language, 'de-DE');
    assert.equal(result.timezone, 'Europe/Berlin');
    assert.equal(result.currency, 'EUR');
    assert.ok(result.browserLocale, 'browserLocale should be generated');
    assert.equal(result.browserLocale.locale, 'de-DE');
  });

  test('lower-case country code is normalized to upper-case', async () => {
    const manager = await makeManager();
    const result = await manager.configureCountry('de');
    assert.equal(result.countryCode, 'DE');
  });

  test('custom language/timezone/currency override country defaults', async () => {
    const manager = await makeManager();
    const result = await manager.configureCountry('DE', { language: 'en-GB', currency: 'GBP' });
    assert.equal(result.language, 'en-GB');
    assert.equal(result.currency, 'GBP');
    // timezone wasn't overridden, so it still falls back to the country default
    assert.equal(result.timezone, 'Europe/Berlin');
  });

  test('unsupported country code throws', async () => {
    const manager = await makeManager();
    await assert.rejects(() => manager.configureCountry('ZZ'), /Unsupported country code/);
  });

  test('updates currentSettings and increments localizationApplied stat', async () => {
    const manager = await makeManager();
    const before = manager.stats.localizationApplied;
    await manager.configureCountry('FR');
    assert.equal(manager.currentSettings.countryCode, 'FR');
    assert.equal(manager.stats.localizationApplied, before + 1);
  });
});

describe('LocalizationManager.generateTimezoneSpoof', () => {
  test('injection script embeds the configured country timezone and locale', async () => {
    const manager = await makeManager();
    await manager.configureCountry('JP');
    const script = await manager.generateTimezoneSpoof('JP');
    assert.equal(typeof script, 'string');
    assert.ok(script.includes('Asia/Tokyo'), 'script should embed the target timezone');
    assert.ok(script.includes('ja-JP'), 'script should embed the target locale');
  });

  test('defaults to currentSettings.countryCode when no country is passed', async () => {
    const manager = await makeManager();
    await manager.configureCountry('GB');
    const script = await manager.generateTimezoneSpoof();
    assert.ok(script.includes('Europe/London'));
  });
});

describe('LocalizationManager health-check interval cleanup (setupHealthChecks leak fix)', () => {
  test('setupHealthChecks records interval handles', async () => {
    const manager = await makeManager();
    assert.ok(Array.isArray(manager.healthCheckIntervals), 'healthCheckIntervals should be recorded');
    assert.equal(manager.healthCheckIntervals.length, 2, 'proxy + translation health-check intervals');
  });

  test('cleanup() actually clears the health-check intervals (no leaked timers)', async () => {
    const originalClearInterval = global.clearInterval;
    const cleared = [];
    global.clearInterval = (handle) => {
      cleared.push(handle);
      return originalClearInterval(handle);
    };

    try {
      const manager = await new Promise((resolve) => {
        const m = new LocalizationManager();
        m.once('initialized', () => resolve(m));
      });
      const intervalsBeforeCleanup = manager.healthCheckIntervals;
      assert.equal(intervalsBeforeCleanup.length, 2);

      await manager.cleanup();

      // Every interval setupHealthChecks() created must have been passed to
      // clearInterval — before the fix, cleanup() referenced a property
      // (`this.healthCheckInterval`) that setupHealthChecks() never set, so
      // clearInterval was never called and both intervals kept firing.
      for (const handle of intervalsBeforeCleanup) {
        assert.ok(cleared.includes(handle), 'each health-check interval must be cleared on cleanup()');
      }
      assert.equal(manager.healthCheckIntervals, null, 'handles are dropped after cleanup');
    } finally {
      global.clearInterval = originalClearInterval;
    }
  });
});

describe('LocalizationManager.cleanup', () => {
  test('clears caches and resets stats', async () => {
    const manager = await makeManager();
    await manager.configureCountry('DE');
    assert.ok(manager.localeCache.size > 0, 'cache should be populated after configureCountry');

    await manager.cleanup();

    assert.equal(manager.localeCache.size, 0);
    assert.equal(manager.stats.localizationApplied, 0);
  });
});

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

  test('an explicit timezone wins over the configured country (R14: Asia/Tokyo asked, Berlin returned)', async () => {
    const manager = await makeManager();
    await manager.configureCountry('DE');
    const script = await manager.generateTimezoneSpoof(null, 'Asia/Tokyo');
    assert.ok(script.includes("targetTimezone = 'Asia/Tokyo'"), 'script must embed the requested timezone');
    assert.ok(!script.includes('Europe/Berlin'));
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

describe('LocalizationManager.getDateFormat (locale audit regression)', () => {
  // Regression: the mapping only covered US/GB/DE/JP and defaulted every
  // other country to the US-only MM/DD/YYYY — France (and most of the
  // world) got MM/DD/YYYY. Audited against CLDR short-date patterns /
  // Wikipedia "List of date formats by country".
  test('FR is day-first DD/MM/YYYY (was MM/DD/YYYY)', async () => {
    const manager = await makeManager();
    assert.equal(manager.getDateFormat('FR'), 'DD/MM/YYYY');
  });

  test('representative locales match their CLDR conventions', async () => {
    const manager = await makeManager();
    assert.equal(manager.getDateFormat('US'), 'MM/DD/YYYY');
    assert.equal(manager.getDateFormat('GB'), 'DD/MM/YYYY');
    assert.equal(manager.getDateFormat('DE'), 'DD.MM.YYYY');
    assert.equal(manager.getDateFormat('JP'), 'YYYY/MM/DD');
    assert.equal(manager.getDateFormat('CN'), 'YYYY/MM/DD');
    assert.equal(manager.getDateFormat('KR'), 'YYYY.MM.DD');
    assert.equal(manager.getDateFormat('CA'), 'YYYY-MM-DD');
    assert.equal(manager.getDateFormat('SE'), 'YYYY-MM-DD');
    assert.equal(manager.getDateFormat('NL'), 'DD-MM-YYYY');
    assert.equal(manager.getDateFormat('BR'), 'DD/MM/YYYY');
    assert.equal(manager.getDateFormat('IN'), 'DD/MM/YYYY');
    assert.equal(manager.getDateFormat('RU'), 'DD.MM.YYYY');
  });

  test('every supported country has an explicit, well-formed mapping', async () => {
    const manager = await makeManager();
    for (const code of manager.getSupportedCountries()) {
      const fmt = manager.getDateFormat(code);
      assert.match(fmt, /^(DD|MM|YYYY)([./-]| )?(DD|MM|YYYY)([./-]| )?(DD|MM|YYYY)$/,
        `${code} format "${fmt}" must contain DD, MM and YYYY components`);
      assert.ok(fmt.includes('DD') && fmt.includes('MM') && fmt.includes('YYYY'),
        `${code} format "${fmt}" must include all three components`);
    }
  });

  test('unknown country falls back to day-first DD/MM/YYYY (world majority)', async () => {
    const manager = await makeManager();
    assert.equal(manager.getDateFormat('XX'), 'DD/MM/YYYY');
  });

  test('configureCountry FR exposes the corrected browserLocale.dateFormat', async () => {
    const manager = await makeManager();
    const result = await manager.configureCountry('FR');
    assert.equal(result.browserLocale.dateFormat, 'DD/MM/YYYY');
  });
});

describe('LocalizationManager.autoDetectLocalization (content-only + confidence regression)', () => {
  const ENGLISH_TEXT = 'The quick brown fox jumps over the lazy dog. It was the best of times ' +
    'and it was the worst of times. You are reading a plainly English paragraph that is ' +
    'written for the purpose of language detection testing in this suite.';

  test('works with content only — url is optional metadata', async () => {
    const manager = await makeManager();
    const detection = await manager.autoDetectLocalization(ENGLISH_TEXT);
    assert.ok(detection, 'detection object returned without a url');
    assert.equal(detection.detectedLanguage, 'en');
  });

  test('plainly-English text detects "en" with reasonable confidence (was null / 0.07)', async () => {
    const manager = await makeManager();
    const detection = await manager.autoDetectLocalization(ENGLISH_TEXT);
    // Regression: text analysis pushed evidence but never set
    // detectedLanguage, and absolute-count scoring left confidence at ~0.07.
    assert.equal(detection.detectedLanguage, 'en');
    assert.ok(detection.confidence >= 0.3,
      `confidence ${detection.confidence} should be >= 0.3 for unambiguous English`);
    assert.ok(detection.evidence.some((e) => e.startsWith('Text analysis: en')),
      'text-analysis evidence recorded');
  });

  test('html lang attribute still wins and text analysis corroborates', async () => {
    const manager = await makeManager();
    const detection = await manager.autoDetectLocalization(
      `<html lang="fr"><body><p>Le chat est dans le jardin et il est pour ce une</p></body></html>`
    );
    assert.equal(detection.detectedLanguage, 'fr');
    assert.ok(detection.confidence >= 0.3, `confidence ${detection.confidence} should reflect lang attribute`);
  });

  test('url, when given, still contributes a TLD country hint', async () => {
    const manager = await makeManager();
    const detection = await manager.autoDetectLocalization(ENGLISH_TEXT, 'https://example.de/page');
    assert.equal(detection.detectedCountry, 'DE');
    assert.ok(detection.evidence.includes('TLD suggests country: DE'));
  });
});

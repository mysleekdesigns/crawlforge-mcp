/**
 * Live sweep 2026-10-20, Phase 6 minor polish: 6.7, 6.10, 6.12.
 *
 * Run: node --test --test-force-exit tests/unit/phase6LocaleCostTracking.test.js
 *
 *   6.7  configure_country returned locale "de" for DE (language:"de") but
 *        "ja-JP" for JP; geo-block advice for a .co.uk site suggested US first.
 *   6.10 _cost.projected was 0 in creator mode while projection_note said
 *        "This call bills 3".
 *   6.12 a compare whose granularity differed from the baseline's carried only
 *        a prose warning; it now has a structured ignoredOptions field too.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { LocalizationManager } from '../../src/core/LocalizationManager.js';
import { ChangeTracker } from '../../src/core/ChangeTracker.js';
import { TRACK_CHANGES_INPUT_SHAPE } from '../../src/tools/tracking/trackChanges/schema.js';

const { default: authManager } = await import('../../src/core/AuthManager.js');

const manager = new LocalizationManager();
after(async () => { await manager.cleanup?.(); });

// --- 6.7 ---------------------------------------------------------------

test('6.7 a bare language comes back as BCP 47 with the country as region', async () => {
  const de = await manager.configureCountry('DE', { language: 'de' });
  assert.equal(de.language, 'de-DE');
  assert.equal(de.browserLocale.locale, 'de-DE');
  assert.equal(de.acceptLanguage, 'de-DE,de;q=0.9,en;q=0.8');

  const jp = await manager.configureCountry('JP');
  assert.equal(jp.browserLocale.locale, 'ja-JP');

  assert.equal((await manager.configureCountry('DE', { language: 'de-CH' })).language, 'de-CH');
  assert.equal((await manager.configureCountry('DE', { language: 'EN-gb' })).language, 'en-GB');
  assert.equal((await manager.configureCountry('CN', { language: 'zh-Hans' })).language, 'zh-Hans-CN');
});

test('6.7 geo-block advice for a UK site suggests a UK exit first', async () => {
  const result = await manager.detectGeoBlocking('https://www.example.co.uk/page', { status: 451, body: '' });
  const country = result.bypassStrategies.find(s => s.type === 'country_change');
  assert.equal(country.suggestedCountries[0], 'GB');
});

// --- 6.10 --------------------------------------------------------------

test('6.10 in creator mode the projection note does not claim a bill', (t) => {
  const original = authManager.isCreatorMode;
  t.after(() => { authManager.isCreatorMode = original; });
  authManager.isCreatorMode = () => true;

  for (const [tool, params] of [
    ['browser_session', { operation: 'open', url: 'https://example.com/' }],
    ['scrape', { url: 'https://example.com/', escalate: true }],
    ['fetch_url', { url: 'https://example.com/' }]
  ]) {
    const { note } = authManager.projectCost(tool, params);
    assert.doesNotMatch(note, /This call bills/, tool);
    assert.match(note, /not billed/, tool);
  }
});

test('6.10 outside creator mode the browser_session note gives the list price', (t) => {
  const original = authManager.isCreatorMode;
  t.after(() => { authManager.isCreatorMode = original; });
  authManager.isCreatorMode = () => false;

  const { projected, note } = authManager.projectCost('browser_session', { operation: 'open', url: 'https://example.com/' });
  assert.equal(projected, 3);
  assert.match(note, /list price is 3/);
  assert.doesNotMatch(note, /not billed/);
});

// --- 6.12 --------------------------------------------------------------

const page = (price) => `<html><body><section><h2>Plan</h2><p>Price ${price}</p></section></body></html>`;

test('6.12 a compare at a different granularity reports it in a structured field', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/granularity';
  await tracker.createBaseline(url, page('$10'), { granularity: 'section' });

  const result = await tracker.compareWithBaseline(url, page('$12'), { granularity: 'text' });

  assert.deepEqual(result.ignoredOptions, [{ option: 'granularity', requested: 'text', applied: 'section' }]);
  assert.match(result.warnings[0], /granularity/);
  assert.match(result.warnings[0], /ignored/);
});

test('6.12 a compare at the baseline granularity has no ignoredOptions', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/granularity-same';
  await tracker.createBaseline(url, page('$10'), { granularity: 'section' });

  const result = await tracker.compareWithBaseline(url, page('$12'), { granularity: 'section' });
  assert.equal(result.ignoredOptions, undefined);
  assert.equal(result.warnings, undefined);
});

test('6.12 the granularity description documents the baseline rule', () => {
  // trackingOptions is prefault(optional(object)); unwrap to the object.
  let schema = TRACK_CHANGES_INPUT_SHAPE.trackingOptions;
  while (!schema.shape) schema = schema.def.innerType;
  const description = schema.shape.granularity.description;
  assert.match(description, /baseline's granularity/);
  assert.match(description, /ignoredOptions/);
});

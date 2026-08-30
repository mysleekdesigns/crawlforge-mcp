/**
 * Unit tests: src/utils/languageDetection.js — the server's single detector.
 *
 * Run: node --test tests/unit/languageDetectionShared.test.js
 *
 * Regression for the round-10 finding: LocalizationManager carried its own
 * stop-word regex stub covering five languages. It reported Japanese as null
 * (no pattern covers the script) and French as 'es' (the `fr` and `es` lists
 * both match "de", "la", "en", "un", "le", so whichever matched more won),
 * while analyze_content answered the same strings correctly through franc.
 *
 * The real defect was that two detectors existed at all — the 2026-08-26
 * franc + CJK fix reached one of them. These tests pin that both surfaces now
 * agree, so the next fix cannot land on only one.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { detectLanguage, toIso6391, isCjkText } from '../../src/utils/languageDetection.js';
import LocalizationManager from '../../src/core/LocalizationManager.js';
import { ContentAnalyzer } from '../../src/core/analysis/ContentAnalyzer.js';

const SAMPLES = {
  de: {
    iso3: 'deu',
    text: 'Die Bundesregierung hat am Donnerstag ein neues Gesetz zur Digitalisierung der Verwaltung beschlossen. Damit sollen Behoerdengaenge kuenftig weitgehend online moeglich sein und die Buergerinnen und Buerger entlastet werden.'
  },
  fr: {
    iso3: 'fra',
    text: 'Le gouvernement a adopte jeudi une nouvelle loi sur la numerisation de l administration. Les demarches administratives pourront desormais etre effectuees en ligne, ce qui allegera la charge des citoyens.'
  },
  ja: {
    iso3: 'jpn',
    text: '日本政府は木曜日、行政のデジタル化に関する新しい法律を可決しました。これにより、行政手続きの多くがオンラインで可能になり、国民の負担が軽減される見込みです。'
  },
  zh: {
    iso3: 'cmn',
    text: '中国政府周四通过了一项关于行政数字化的新法律。今后大多数行政手续都可以在线办理，从而减轻民众的负担。但批评人士指出，相关经费来源仍不明确。'
  },
  en: {
    iso3: 'eng',
    text: 'The government approved a new law on Thursday that digitises public administration. Most official procedures will be available online from next year, which is expected to reduce the burden on citizens.'
  }
};

describe('shared detector — ISO 639-3 codes', () => {
  for (const [iso1, { iso3, text }] of Object.entries(SAMPLES)) {
    test(`${iso1} detects as ${iso3}`, () => {
      const detected = detectLanguage(text);
      assert.ok(detected, 'must not be undetermined');
      assert.equal(detected.code, iso3);
    });
  }
});

describe('toIso6391', () => {
  test('maps the codes the localization surface reports', () => {
    assert.equal(toIso6391('deu'), 'de');
    assert.equal(toIso6391('fra'), 'fr');
    assert.equal(toIso6391('jpn'), 'ja');
    assert.equal(toIso6391('cmn'), 'zh');
    assert.equal(toIso6391('zsm'), 'ms');
  });

  test('a language with no 639-1 equivalent keeps its 639-3 code', () => {
    assert.equal(toIso6391('nonexistent'), 'nonexistent');
  });

  test('null in, null out', () => {
    assert.equal(toIso6391(null), null);
  });
});

describe('CJK script pre-check', () => {
  test('Japanese and Chinese are CJK', () => {
    assert.equal(isCjkText(SAMPLES.ja.text), true);
    assert.equal(isCjkText(SAMPLES.zh.text), true);
  });

  test('Latin-script prose is not', () => {
    assert.equal(isCjkText(SAMPLES.en.text), false);
    assert.equal(isCjkText(SAMPLES.fr.text), false);
  });

  test('kana decides Japanese over Chinese', () => {
    assert.equal(detectLanguage(SAMPLES.ja.text).code, 'jpn');
    assert.equal(detectLanguage(SAMPLES.zh.text).code, 'cmn');
  });
});

describe('localization surface reports ISO 639-1 and matches the shared detector', () => {
  const manager = new LocalizationManager();

  for (const [iso1, { text }] of Object.entries(SAMPLES)) {
    test(`analyzeTextLanguage returns "${iso1}"`, async () => {
      const result = await manager.analyzeTextLanguage(text);
      assert.ok(result, 'must not be null');
      assert.equal(result.language, iso1);
      assert.ok(result.confidence > 0, 'confidence must be reported');
    });
  }

  test('Japanese is no longer null (was the stub failure)', async () => {
    const result = await manager.analyzeTextLanguage(SAMPLES.ja.text);
    assert.notEqual(result, null);
    assert.equal(result.language, 'ja');
  });

  test('French is no longer reported as Spanish (was the stub failure)', async () => {
    const result = await manager.analyzeTextLanguage(SAMPLES.fr.text);
    assert.equal(result.language, 'fr');
    assert.notEqual(result.language, 'es');
  });
});

describe('the two surfaces cannot disagree', () => {
  const analyzer = new ContentAnalyzer();
  const manager = new LocalizationManager();

  for (const [iso1, { iso3, text }] of Object.entries(SAMPLES)) {
    test(`${iso1}: analyze_content and localization agree`, async () => {
      const analyzed = await analyzer.detectLanguage(text);
      const localized = await manager.analyzeTextLanguage(text);
      assert.equal(analyzed.code, iso3, 'analyze_content reports ISO 639-3');
      assert.equal(localized.language, toIso6391(analyzed.code), 'same language, different code system');
    });
  }
});

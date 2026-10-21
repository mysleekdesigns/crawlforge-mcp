/**
 * Unit tests: analyze_content on English, Spanish and German (live sweep 5.2).
 * Run: node --test --test-force-exit tests/unit/analyzeContentMultilingual.test.js
 *
 * The 2026-10-20 sweep found: a clearly negative Spanish complaint scored
 * -0.08 with the English lexicon; German capitalised nouns came back as
 * entities ("über" as an organisation, "Berlin den", "Präsidenten Emmanuel
 * Macron") while "Montag" was not a date; "weeks", "hour" and "year" were
 * English dates; Spanish and German got English Flesch scores; and English
 * topics were fragments such as "the switches feel crisp".
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AnalyzeContentTool } from '../../src/tools/extract/analyzeContent.js';

const ES = 'Estoy muy decepcionado con este pedido. El paquete llegó tarde, la caja estaba rota y el producto no funciona. El servicio de atención al cliente fue horrible y nadie me ha devuelto el dinero. Es la peor compra que he hecho y no lo recomiendo a nadie.';
const DE = 'Bundeskanzler Olaf Scholz hat am Montag in Berlin den französischen Präsidenten Emmanuel Macron empfangen. Die beiden Politiker sprachen über die Lage in der Ukraine und über die Zukunft der Europäischen Union. Das nächste Treffen ist für Donnerstag in Paris geplant.';
const EN = 'The new mechanical keyboard arrived on Monday. The switches feel crisp and the keycaps are thick. After two weeks of daily use, typing for an hour is comfortable. Battery life lasts about a year, according to the manufacturer Keychron.';
// Finnish has no stop-word list; a paragraph this long is still confidently non-English.
const FI = 'Helsinki on Suomen pääkaupunki ja maan suurin kaupunki. Kaupungissa asuu noin 680 000 ihmistä, ja se sijaitsee Suomenlahden rannalla. Helsinki on tunnettu merellisestä ilmapiiristään, arkkitehtuuristaan ja monipuolisesta kulttuurielämästään.';

const tool = new AnalyzeContentTool();
const analyze = (text) => tool.execute({ text });

describe('sentiment is English-only', () => {
  test('a negative Spanish complaint is not_applicable, not a lexicon score', async () => {
    const r = await analyze(ES);
    assert.equal(r.language.code, 'spa');
    assert.equal(r.sentiment.label, 'not_applicable');
    assert.equal(r.sentiment.notApplicable, 'sentiment-lexicon-is-english-only');
    assert.equal(r.sentiment.confidence, 0);
  });

  test('German is not_applicable', async () => {
    const r = await analyze(DE);
    assert.equal(r.sentiment.notApplicable, 'sentiment-lexicon-is-english-only');
  });

  test('a language without a stop-word list is not_applicable when the text is long enough', async () => {
    const r = await analyze(FI);
    assert.equal(r.language.code, 'fin');
    assert.equal(r.sentiment.notApplicable, 'sentiment-lexicon-is-english-only');
  });

  test('English is still scored', async () => {
    const r = await analyze('This product is terrible and broken. I hate it and want a refund. Awful service.');
    assert.equal(r.sentiment.label, 'negative');
    assert.equal(r.sentiment.notApplicable, undefined);
  });
});

describe('readability is English Flesch only', () => {
  for (const [name, text] of [['Spanish', ES], ['German', DE]]) {
    test(`${name} gets no score, a note, and its metrics`, async () => {
      const r = await analyze(text);
      assert.equal(r.readability.score, undefined);
      assert.equal(r.readability.level, undefined);
      assert.equal(r.readability.notApplicable, 'flesch-reading-ease-is-english-only');
      assert.ok(r.readability.metrics.words > 0);
    });
  }

  test('English keeps its Flesch score', async () => {
    const r = await analyze(EN);
    assert.equal(typeof r.readability.score, 'number');
    assert.equal(r.readability.notApplicable, undefined);
  });
});

describe('German entities', () => {
  test('function words and trailing articles are not entities', async () => {
    const { entities } = await analyze(DE);
    const all = [...entities.people, ...entities.places, ...entities.organizations, ...entities.other];
    for (const bad of ['über', 'ist', 'Berlin den']) assert.ok(!all.includes(bad), `${bad} in ${all}`);
    assert.ok(entities.places.includes('Berlin'), entities.places.join(','));
  });

  test('a leading title is stripped from a person', async () => {
    const { entities } = await analyze(DE);
    assert.ok(entities.people.includes('Emmanuel Macron'), entities.people.join(','));
    assert.ok(entities.people.includes('Olaf Scholz'), entities.people.join(','));
    assert.ok(!entities.people.some(p => p.startsWith('Präsidenten')), entities.people.join(','));
  });

  test('capitalised common nouns are not entities', async () => {
    const { entities } = await analyze(DE);
    for (const noun of ['Politiker', 'Lage', 'Zukunft', 'Treffen']) {
      assert.ok(!entities.other.includes(noun), `${noun} in ${entities.other}`);
    }
  });

  test('weekday names are dates', async () => {
    const { entities } = await analyze(DE);
    assert.ok(entities.dates.includes('Montag'), entities.dates.join(','));
    assert.ok(entities.dates.includes('Donnerstag'), entities.dates.join(','));
    assert.ok(!entities.other.includes('Montag'));
  });

  test('Spanish: "que" is not a place and "lunes" is a date', async () => {
    const { entities } = await analyze(ES + ' Lo pedí el lunes.');
    assert.ok(!entities.places.includes('que'), entities.places.join(','));
    assert.ok(entities.dates.includes('lunes'), entities.dates.join(','));
  });
});

describe('English dates and topics', () => {
  test('durations are not dates', async () => {
    const { entities } = await analyze(EN);
    assert.ok(entities.dates.includes('Monday'), entities.dates.join(','));
    for (const d of ['weeks', 'hour', 'year', 'two weeks', 'an hour', 'a year']) {
      assert.ok(!entities.dates.includes(d), `${d} in ${entities.dates}`);
    }
  });

  test('topics are noun-phrase heads, not clause fragments', async () => {
    const topics = (await analyze(EN)).topics.map(t => t.topic);
    for (const bad of ['the switches feel crisp', 'switches feel', 'the keycaps', 'two weeks', 'an hour', 'a year']) {
      assert.ok(!topics.includes(bad), `${bad} in ${topics}`);
    }
    for (const good of ['switches', 'keycaps', 'battery life']) {
      assert.ok(topics.includes(good), `${good} missing from ${topics}`);
    }
    assert.ok(!topics.some(t => /^(?:the|a|an)\s/.test(t)), topics.join(','));
  });
});

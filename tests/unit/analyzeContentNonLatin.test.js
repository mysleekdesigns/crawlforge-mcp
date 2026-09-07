/**
 * Unit tests: analyze_content on non-Latin script.
 * Run: node --test tests/unit/analyzeContentNonLatin.test.js
 *
 * R19 (2026-09-07): a Russian weather report was detected as Russian correctly
 * and then analysed with English-only machinery. compromise returned
 * "дождь и порывистый" ("rain and gusty") as an organization; countSyllables
 * knows only the Latin vowels, so all 21 Cyrillic words scored one syllable
 * each and Flesch put the text at 100, "Very Easy"; and "над" ("over") ranked
 * as a topic because the stop-word list was English-only. R17 had added a
 * Japanese list the same way.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import ContentAnalyzer from '../../src/core/analysis/ContentAnalyzer.js';

const RUSSIAN = 'Местами дождь и порывистый ветер над городом. Синоптики предупреждают о резком похолодании в выходные дни. Температура опустится ниже нуля градусов ночью.';
const ENGLISH = 'Apple chief executive Tim Cook visited California to open a new Microsoft partnership office. The agreement was signed on Tuesday.';

describe('isLatinScriptText', () => {
  const a = new ContentAnalyzer();

  test('Cyrillic prose is not Latin script', () => {
    assert.equal(a.isLatinScriptText(RUSSIAN), false);
  });

  test('English prose is', () => {
    assert.equal(a.isLatinScriptText(ENGLISH), true);
  });

  test('a Latin URL does not make a Cyrillic page Latin', () => {
    assert.equal(a.isLatinScriptText('Привет дождь ветер над городом https://example.com'), false);
  });

  test('text with no letters at all is left alone', () => {
    // Nothing to misread — fail open rather than mark digits not-applicable.
    assert.equal(a.isLatinScriptText('123 456 789'), true);
    assert.equal(a.isLatinScriptText(''), true);
  });
});

describe('Russian stop words', () => {
  const a = new ContentAnalyzer();

  test('a bare preposition is a stop word', () => {
    for (const word of ['над', 'для', 'если', 'что', 'или']) {
      assert.equal(a.isStopWord(word), true, word);
    }
  });

  test('a content word is not', () => {
    for (const word of ['дождь', 'ветер', 'синоптики']) {
      assert.equal(a.isStopWord(word), false, word);
    }
  });

  test('English stop words still work', () => {
    assert.equal(a.isStopWord('the'), true);
    assert.equal(a.isStopWord('scraping'), false);
  });
});

describe('non-Latin analysis reports not-applicable instead of inventing', () => {
  test('entities are empty and labelled, not fabricated', async () => {
    const entities = await new ContentAnalyzer().extractEntities(RUSSIAN);
    assert.equal(entities.notApplicable, 'entity-extraction-requires-latin-script');
    assert.deepEqual(entities.organizations, [], 'no invented organizations');
    assert.deepEqual(entities.people, []);
    assert.equal(entities.summary.totalEntities, 0);
  });

  test('readability reports metrics with a reason, not a score', async () => {
    const readability = await new ContentAnalyzer().calculateReadability(RUSSIAN);
    assert.equal(readability.notApplicable, 'flesch-requires-syllable-based-language');
    assert.equal(readability.score, undefined, 'no fabricated "Very Easy" score');
    assert.ok(readability.metrics.words > 0, 'the metrics that do not need syllables are still reported');
  });

  test('English is unaffected', async () => {
    const analyzer = new ContentAnalyzer();
    const entities = await analyzer.extractEntities(ENGLISH);
    assert.equal(entities.notApplicable, undefined);
    assert.ok(entities.people.includes('Tim Cook'), JSON.stringify(entities.people));

    const readability = await analyzer.calculateReadability(ENGLISH);
    assert.equal(readability.notApplicable, undefined);
    assert.equal(typeof readability.score, 'number');
  });
});

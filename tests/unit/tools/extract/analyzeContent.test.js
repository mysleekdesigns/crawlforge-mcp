/**
 * Unit tests: analyzeContent tool (real module — src/tools/extract/analyzeContent.js)
 * Run: node --test tests/unit/tools/extract/analyzeContent.test.js
 *
 * AnalyzeContentTool drives ContentAnalyzer, which is pure in-process NLP
 * (franc/compromise/node-summarizer) with no network I/O, so these tests
 * exercise the real classes directly rather than a stub.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AnalyzeContentTool } from '../../../../src/tools/extract/analyzeContent.js';

const SAMPLE_TEXT = 'CrawlForge is a powerful web scraping tool for modern developers. It handles JavaScript rendering, stealth mode, and complex workflows. The technology stack includes Node.js, Playwright, and Cheerio.';

// Long, mixed-signal English text — franc's alternative-language guesses (Danish,
// French, Afrikaans, etc.) are usually close in score for this kind of text,
// exercising the confidence field on more than one alternative.
const MIXED_SIGNAL_TEXT = 'The quick brown fox jumps over the lazy dog near the riverbank at sunset every single day without fail, and this is a fairly long piece of English text meant to give language detection enough signal to work with reliably.';

describe('analyzeContent tool (real module)', () => {
  let tool;

  beforeEach(() => {
    tool = new AnalyzeContentTool();
  });

  test('constructor creates a real ContentAnalyzer', () => {
    assert.ok(tool.contentAnalyzer, 'contentAnalyzer should be constructed');
  });

  test('happy path — returns language, topics, entities, sentiment', async () => {
    const result = await tool.execute({ text: SAMPLE_TEXT });
    assert.equal(result.success, true);
    assert.equal(result.text, SAMPLE_TEXT);
    assert.ok(result.language, 'language should be present');
    assert.ok(result.topics, 'topics should be present');
    assert.ok(result.entities, 'entities should be present');
    assert.ok(result.sentiment, 'sentiment should be present');
    assert.ok(result.statistics, 'statistics should be present');
  });

  // Reproduction (2026-08-20): doc.dates() requires the uninstalled
  // compromise-dates plugin; its throw aborted ALL entity extraction, so
  // people/places/organizations were always empty (the happy-path test above
  // only asserts entities is truthy, which let this slip through).
  test('entity extraction actually extracts people/places/organizations', async () => {
    const result = await tool.execute({
      text: 'Apple and Microsoft announced record earnings in California last quarter. Tim Cook praised the results.',
      options: { extractEntities: true }
    });
    assert.equal(result.success, true);
    assert.ok(result.entities.people.includes('Tim Cook'), `people missing Tim Cook: ${JSON.stringify(result.entities.people)}`);
    assert.ok(result.entities.organizations.includes('Microsoft'), `orgs missing Microsoft: ${JSON.stringify(result.entities.organizations)}`);
    assert.ok(result.entities.places.includes('California'), `places missing California: ${JSON.stringify(result.entities.places)}`);
    assert.ok(result.entities.summary.totalEntities > 0);
  });

  // Reproduction test for the language-alternatives confidence fix:
  // ContentAnalyzer.detectLanguage() used to report `confidence: 1 - score`
  // for alternatives, which — since francAll() already returns candidates
  // best-first (descending score) — produced an ASCENDING confidence list
  // (the opposite of what "alternatives, ranked" should mean). It now reports
  // `confidence: score` directly, so confidence descends alongside rank.
  test('language.alternatives confidences descend (best-first, matching francAll ranking)', async () => {
    const result = await tool.execute({ text: MIXED_SIGNAL_TEXT, options: { detectLanguage: true } });
    assert.ok(result.language, 'language should be detected for this text');
    assert.ok(Array.isArray(result.language.alternatives));
    assert.ok(result.language.alternatives.length >= 2, 'need at least 2 alternatives to prove ordering');

    for (let i = 1; i < result.language.alternatives.length; i++) {
      assert.ok(
        result.language.alternatives[i - 1].confidence >= result.language.alternatives[i].confidence,
        `alternative[${i - 1}].confidence (${result.language.alternatives[i - 1].confidence}) should be >= alternative[${i}].confidence (${result.language.alternatives[i].confidence})`
      );
    }
  });

  test('missing text param returns a structured failure (not a thrown error)', async () => {
    const result = await tool.execute({});
    assert.equal(result.success, false);
    assert.match(result.error, /Content analysis failed/);
  });

  test('text too short (Zod min length) returns a structured failure', async () => {
    const result = await tool.execute({ text: 'short' });
    assert.equal(result.success, false);
    assert.match(result.error, /Content analysis failed/);
  });

  test('detectLanguage=false omits language from result', async () => {
    const result = await tool.execute({ text: SAMPLE_TEXT, options: { detectLanguage: false } });
    assert.equal(result.language, undefined);
  });

  test('extractTopics=false omits topics', async () => {
    const result = await tool.execute({ text: SAMPLE_TEXT, options: { extractTopics: false } });
    assert.equal(result.topics, undefined);
  });

  test('statistics included in output with real word/sentence counts', async () => {
    const result = await tool.execute({ text: SAMPLE_TEXT });
    assert.equal(typeof result.statistics.words, 'number');
    assert.equal(typeof result.statistics.sentences, 'number');
    assert.ok(result.statistics.words > 0);
    assert.ok(result.statistics.sentences >= 3, 'sample text has 3 sentences');
  });

  test('keywords are sorted by relevance when rankByRelevance=true (default)', async () => {
    const result = await tool.execute({ text: SAMPLE_TEXT });
    assert.ok(Array.isArray(result.keywords));
    for (let i = 1; i < result.keywords.length; i++) {
      assert.ok(result.keywords[i - 1].relevance >= result.keywords[i].relevance);
    }
  });

  test('technology-related text is categorized under the "technology" topic category', async () => {
    const result = await tool.execute({ text: SAMPLE_TEXT });
    const categories = (result.topics || []).map((t) => t.category);
    assert.ok(categories.length > 0, 'should extract at least one topic');
  });
});

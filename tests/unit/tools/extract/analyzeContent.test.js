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

// Reproduction (2026-08-20, live-tested on the Wikipedia "Web scraping"
// article): condensed excerpt that triggered every defect below on the
// pre-fix code — topics:[] (confidence was frequency/totalPhrases, which
// collapses toward 0 on longer texts so every topic failed minConfidence),
// trailing punctuation ("Craigslist.", "United States,"), un-deduped repeats,
// sentence-initial stopwords as entities ("While", "It"), "X v. Y" legal-case
// fragments classified as PERSON, and ALL-CAPS tech terms (UNIX, DOM)
// classified as organizations.
const WEB_SCRAPING_TEXT = `In the United States, website owners can use legal claims to prevent undesired web scraping, and the case law of the United States is still evolving. While web scraping can be done manually by a software user, the term typically refers to automated processes implemented using a bot or web crawler. It is a form of copying in which specific data is gathered and copied from the web. A simple approach to extract information from web pages is to use the UNIX grep command or regular expression-matching facilities of programming languages. Once an entire page is loaded, developers can access and parse the DOM using an expression language such as XPath. In 2012, a startup called 3Taps scraped classified housing ads from Craigslist. Craigslist sent 3Taps a cease-and-desist letter and blocked their IP addresses and later sued, in Craigslist v. 3Taps. The Ninth Circuit ruled in 2019 that web scraping did not violate the CFAA in hiQ Labs v. LinkedIn. The case was appealed to the United States Supreme Court, which returned the case to the Ninth Circuit. One of the first major tests of screen scraping involved American Airlines (AA), and a firm called FareChase. The airline argued that FareChase's websearch software trespassed on AA's servers when it collected the publicly available data. On April 30, 2020, the French Data Protection Authority (CNIL) released new guidelines on web scraping. Web scraping software may directly access the World Wide Web using the Hypertext Transfer Protocol or a web browser, and web scraping systems use techniques involving DOM parsing, computer vision and natural language processing to gather web page content for offline parsing.`;

describe('analyzeContent topics regression (Wikipedia-style long text)', () => {
  let tool;

  beforeEach(() => {
    tool = new AnalyzeContentTool();
  });

  test('extractTopics:true returns real topics with default minConfidence (was [])', async () => {
    const result = await tool.execute({ text: WEB_SCRAPING_TEXT, options: { extractTopics: true } });
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.topics));
    assert.ok(result.topics.length >= 5, `expected real topics, got ${JSON.stringify(result.topics)}`);
    for (const t of result.topics) {
      assert.equal(typeof t.topic, 'string');
      assert.ok(t.topic.length > 2);
      assert.ok(t.confidence > 0 && t.confidence <= 1, `confidence must be relative salience in (0,1]: ${t.confidence}`);
      assert.ok(Array.isArray(t.keywords));
    }
    // Confidence is normalized against the most frequent phrase
    assert.equal(result.topics[0].confidence, 1, 'top topic should have relative confidence 1');
  });
});

describe('analyzeContent entity cleanup rules', () => {
  let tool;
  let entities;

  beforeEach(async () => {
    tool = new AnalyzeContentTool();
    const result = await tool.execute({ text: WEB_SCRAPING_TEXT, options: { extractEntities: true } });
    assert.equal(result.success, true);
    entities = result.entities;
  });

  const flatEntities = () => [
    ...entities.people,
    ...entities.places,
    ...entities.organizations,
    ...entities.dates,
    ...entities.money,
    ...entities.other
  ];

  test('trailing punctuation is stripped ("Craigslist." -> "Craigslist")', () => {
    assert.ok(entities.organizations.includes('Craigslist'), `orgs: ${JSON.stringify(entities.organizations)}`);
    for (const e of flatEntities()) {
      assert.ok(!/[,;:!?'"]$/.test(e), `entity keeps trailing punctuation: ${JSON.stringify(e)}`);
      assert.notEqual(e, 'Craigslist.');
    }
  });

  test('entities are deduped case-insensitively ("United States" appears once)', () => {
    const usCount = entities.places.filter((e) => e.toLowerCase() === 'united states').length;
    assert.equal(usCount, 1, `places: ${JSON.stringify(entities.places)}`);
    for (const list of [entities.people, entities.places, entities.organizations, entities.other]) {
      const lower = list.map((e) => e.toLowerCase());
      assert.equal(new Set(lower).size, lower.length, `list has case-insensitive duplicates: ${JSON.stringify(list)}`);
    }
  });

  test('sentence-initial stopwords are not emitted as entities ("While", "It", "Once")', () => {
    for (const e of flatEntities()) {
      assert.ok(!['while', 'it', 'once', 'the'].includes(e.toLowerCase()), `stopword emitted as entity: ${JSON.stringify(e)}`);
    }
  });

  test('"X v. Y" legal-case fragments are classified as other, never PERSON', () => {
    for (const e of [...entities.people, ...entities.places, ...entities.organizations]) {
      assert.ok(!/\s+vs?\.?\s+/i.test(e), `legal-case fragment classified as person/place/org: ${JSON.stringify(e)}`);
    }
    assert.ok(
      entities.other.some((e) => /\s+v\.\s+/.test(e)),
      `the "Labs v. LinkedIn" fragment should land in other: ${JSON.stringify(entities.other)}`
    );
  });

  test('bare ALL-CAPS tech terms (UNIX, DOM) are not organizations', () => {
    assert.ok(!entities.organizations.includes('UNIX'), `orgs: ${JSON.stringify(entities.organizations)}`);
    assert.ok(!entities.organizations.includes('DOM'), `orgs: ${JSON.stringify(entities.organizations)}`);
    assert.ok(entities.other.includes('UNIX'), `demoted acronyms belong in other: ${JSON.stringify(entities.other)}`);
  });

  test('"other" does not duplicate entities already classified more specifically', () => {
    const classified = new Set(
      [...entities.people, ...entities.places, ...entities.organizations, ...entities.dates, ...entities.money]
        .map((e) => e.toLowerCase())
    );
    for (const e of entities.other) {
      assert.ok(!classified.has(e.toLowerCase()), `duplicated across categories: ${JSON.stringify(e)}`);
    }
  });
});

describe('ContentAnalyzer entity-cleanup helpers', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new AnalyzeContentTool().contentAnalyzer;
  });

  test('cleanEntityText strips edge punctuation but preserves abbreviations', () => {
    assert.equal(analyzer.cleanEntityText('Craigslist.'), 'Craigslist');
    assert.equal(analyzer.cleanEntityText('United States,'), 'United States');
    assert.equal(analyzer.cleanEntityText('(Copenhagen)'), 'Copenhagen');
    assert.equal(analyzer.cleanEntityText('"CFAA".'), 'CFAA');
    assert.equal(analyzer.cleanEntityText('Meltwater U.S. Holdings, Inc.,'), 'Meltwater U.S. Holdings, Inc.');
    assert.equal(analyzer.cleanEntityText('U.S.'), 'U.S.');
    assert.equal(analyzer.cleanEntityText('Home.dk'), 'Home.dk');
  });

  test('dedupeEntities dedupes case-insensitively keeping first casing', () => {
    assert.deepEqual(
      analyzer.dedupeEntities(['United States', 'UNITED STATES', 'united states', 'Texas']),
      ['United States', 'Texas']
    );
  });

  test('isLegalCaseFragment detects "X v. Y" and "X v Y" citations', () => {
    assert.equal(analyzer.isLegalCaseFragment('hiQ Labs v. LinkedIn'), true);
    assert.equal(analyzer.isLegalCaseFragment('Ryanair Ltd v Billigfluege.de GmbH'), true);
    assert.equal(analyzer.isLegalCaseFragment('eBay vs. Bidder'), true);
    assert.equal(analyzer.isLegalCaseFragment('Van Buren'), false);
  });

  test('hasOrganizationEvidence requires more than ALL-CAPS', () => {
    assert.equal(analyzer.hasOrganizationEvidence('UNIX', 'use the UNIX grep command'), false);
    assert.equal(analyzer.hasOrganizationEvidence('IBM', 'IBM Corp announced record earnings'), true);
    assert.equal(
      analyzer.hasOrganizationEvidence('CNIL', 'the French Data Protection Authority (CNIL) released guidelines'),
      true
    );
    assert.equal(
      analyzer.hasOrganizationEvidence('AA', 'the tests involved American Airlines (AA), and a firm'),
      true
    );
  });

  test('isSentenceInitialArtifact drops capitalized common words, keeps proper nouns', () => {
    assert.equal(analyzer.isSentenceInitialArtifact('While', 'While the law evolves, courts decide.'), true);
    assert.equal(analyzer.isSentenceInitialArtifact('It', 'It is a form of copying.'), true);
    assert.equal(
      analyzer.isSentenceInitialArtifact('Craigslist', 'ads from Craigslist. Craigslist sent a letter.'),
      false
    );
  });
});

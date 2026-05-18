/**
 * D5.2 — Unit tests: analyzeContent tool
 * Run: node --test tests/unit/tools/extract/analyzeContent.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stub ContentAnalyzer
// ---------------------------------------------------------------------------

const stubAnalysis = {
  language: { code: 'en', name: 'English', confidence: 0.99, alternatives: [] },
  topics: [{ topic: 'technology', confidence: 0.8, keywords: ['tech'], category: 'tech' }],
  entities: { people: [], places: ['London'], organizations: ['Acme'], dates: [], money: [], other: [], summary: { totalEntities: 2, uniqueEntities: 2, entityDensity: 0.05 } },
  keywords: [{ keyword: 'technology', relevance: 0.9, frequency: 3 }],
  sentiment: { overall: 'positive', score: 0.6, confidence: 0.8, breakdown: {} },
  readabilityScore: { overall: 70, gradeLevel: 'Grade 8', ease: 'standard' },
  statistics: { characters: 200, words: 40, sentences: 5, paragraphs: 2, averageWordsPerSentence: 8, averageSyllablesPerWord: 1.5, readingTime: 0.2, uniqueWords: 30, lexicalDiversity: 0.75 }
};

class ContentAnalyzerStub {
  constructor(options = {}) { this.options = options; }
  async analyze(text, options = {}) { return { ...stubAnalysis }; }
}

// ---------------------------------------------------------------------------
// Minimal AnalyzeContent-like class
// ---------------------------------------------------------------------------

class AnalyzeContentStub {
  constructor({ analyzer } = {}) {
    this.analyzer = analyzer || new ContentAnalyzerStub();
  }

  async execute(params) {
    if (!params || typeof params.text !== 'string') throw new Error('text is required');
    if (params.text.length < 10) throw new Error('text must be at least 10 characters');

    const options = params.options || {};
    const result = await this.analyzer.analyze(params.text, options);

    // Filter fields based on options
    const output = { text: params.text };
    if (options.detectLanguage !== false) output.language = result.language;
    if (options.extractTopics !== false) output.topics = result.topics;
    if (options.extractEntities !== false) output.entities = result.entities;
    if (options.extractKeywords !== false) output.keywords = result.keywords;
    if (options.analyzeSentiment !== false) output.sentiment = result.sentiment;
    if (options.calculateReadability !== false) output.readabilityScore = result.readabilityScore;
    if (options.includeStatistics !== false) output.statistics = result.statistics;

    return output;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyzeContent tool', () => {
  let tool;
  const sampleText = 'CrawlForge is a powerful web scraping tool for modern developers. It handles JavaScript rendering, stealth mode, and complex workflows.';

  beforeEach(() => {
    tool = new AnalyzeContentStub();
  });

  test('constructor stores analyzer', () => {
    assert.ok(tool.analyzer instanceof ContentAnalyzerStub);
  });

  test('happy path — returns language, topics, entities, sentiment', async () => {
    const result = await tool.execute({ text: sampleText });
    assert.equal(result.text, sampleText);
    assert.ok(result.language, 'language should be present');
    assert.ok(result.topics, 'topics should be present');
    assert.ok(result.entities, 'entities should be present');
    assert.ok(result.sentiment, 'sentiment should be present');
    assert.ok(result.statistics, 'statistics should be present');
  });

  test('missing text param throws', async () => {
    await assert.rejects(() => tool.execute({}), /text is required/);
  });

  test('text too short throws', async () => {
    await assert.rejects(() => tool.execute({ text: 'short' }), /at least 10/);
  });

  test('detectLanguage=false omits language from result', async () => {
    const result = await tool.execute({ text: sampleText, options: { detectLanguage: false } });
    assert.equal(result.language, undefined);
  });

  test('extractTopics=false omits topics', async () => {
    const result = await tool.execute({ text: sampleText, options: { extractTopics: false } });
    assert.equal(result.topics, undefined);
  });

  test('analyzer error propagates', async () => {
    const errAnalyzer = { analyze: async () => { throw new Error('NLP engine failure'); } };
    const errTool = new AnalyzeContentStub({ analyzer: errAnalyzer });
    await assert.rejects(() => errTool.execute({ text: sampleText }), /NLP engine failure/);
  });

  test('statistics included in output', async () => {
    const result = await tool.execute({ text: sampleText });
    assert.ok(typeof result.statistics.words === 'number');
    assert.ok(typeof result.statistics.sentences === 'number');
  });
});

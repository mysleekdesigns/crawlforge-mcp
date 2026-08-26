/**
 * Unit tests: CJK word tokenization in ContentAnalyzer and leading-boilerplate
 * stripping in SummarizeContentTool.
 *
 * Run: node --test tests/unit/cjkTokenizationAndBoilerplate.test.js
 *
 * Regression (2026-08-26 live sweep):
 * 1. analyze_content on Chinese text detected the language (cmn) but the
 *    tokenizer only split on whitespace/latin boundaries, so topics/keywords
 *    returned multi-sentence runs as single "words" and statistics.words was
 *    the paragraph count (4 for 1036 chars). Words are now segmented with
 *    Intl.Segmenter (word granularity) when the text is substantially CJK.
 * 2. summarize_content fed extracted Wikipedia page text began its summary,
 *    sentences and key points with "Jump to content\n\nFrom Wikipedia, the
 *    free encyclopedia". Leading navigation-ish lines (short, few words, no
 *    sentence-ending punctuation) are now stripped before summarizing, with a
 *    size guard so real prose is never eaten.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ContentAnalyzer } from '../../src/core/analysis/ContentAnalyzer.js';
import { SummarizeContentTool } from '../../src/tools/extract/summarizeContent.js';

const CJK_RUN = /[一-鿿]{8,}/; // 8+ Han chars in one token = sentence run

const CHINESE_TEXT = [
  '北京市，通称北京，简称“京”，是中华人民共和国的首都及直辖市，中国的政治、文化、科技、教育中心，也是国际性大都市。北京位于华北平原北部，毗邻天津市和河北省。',
  '北京是全球拥有世界文化遗产最多的城市，拥有故宫、天坛、颐和园、长城等著名景点。北京历史悠久，是元、明、清三代的都城。',
  '北京的经济以服务业为主，金融业和科技产业发达。中关村被誉为中国的硅谷，聚集了大量高科技企业和研究机构。',
  '北京的交通网络发达，拥有庞大的地铁系统和两座国际机场。北京首都国际机场和北京大兴国际机场是重要的国际航空枢纽。'
].join('\n\n');

describe('ContentAnalyzer CJK tokenization', () => {
  const analyzer = new ContentAnalyzer();

  test('Chinese keywords are short word tokens, not sentence runs', async () => {
    const keywords = await analyzer.extractKeywords(CHINESE_TEXT, { maxKeywords: 15 });

    assert.ok(keywords.length > 0, 'expected keywords for Chinese text');
    for (const { keyword } of keywords) {
      assert.ok(!CJK_RUN.test(keyword), `keyword is a sentence run: ${keyword}`);
      assert.ok(keyword.length <= 10, `keyword too long to be a word: ${keyword}`);
    }
    assert.ok(
      keywords.some(k => k.keyword === '北京'),
      'expected 北京 among top keywords'
    );
  });

  test('Chinese topics are word tokens above minConfidence', async () => {
    const topics = await analyzer.extractTopics(CHINESE_TEXT, {
      minConfidence: 0.1,
      maxTopics: 10
    });

    assert.ok(topics.length > 0, 'expected topics for Chinese text');
    for (const { topic } of topics) {
      assert.ok(!CJK_RUN.test(topic), `topic is a sentence run: ${topic}`);
    }
    assert.equal(topics[0].topic, '北京');
  });

  test('Chinese word count is plausible, not the paragraph count', () => {
    const stats = analyzer.calculateStatistics(CHINESE_TEXT);

    // Chinese words average ~1.5-2 chars; anything near chars/2 is plausible,
    // whitespace splitting yields 4 (one "word" per paragraph).
    assert.ok(stats.words > 100, `words=${stats.words}, expected >100 for ${stats.characters} chars`);
    assert.ok(stats.words < stats.charactersNoSpaces, 'words must be fewer than characters');
  });

  test('single-character particles are not keywords', async () => {
    const keywords = await analyzer.extractKeywords(CHINESE_TEXT, { maxKeywords: 30 });
    const found = keywords.map(k => k.keyword);
    for (const particle of ['的', '是', '和', '了']) {
      assert.ok(!found.includes(particle), `particle leaked into keywords: ${particle}`);
    }
  });

  test('English tokenization is unchanged', async () => {
    const english =
      'Machine learning systems process data efficiently. Machine learning improves search quality. ' +
      'The framework handles large datasets without manual tuning.';

    const stats = analyzer.calculateStatistics(english);
    assert.equal(stats.words, english.split(/\s+/).filter(w => w.length > 0).length);

    const keywords = await analyzer.extractKeywords(english, { maxKeywords: 10 });
    assert.ok(keywords.length > 0);
    assert.ok(
      keywords.some(k => k.keyword.includes('machine learning')),
      'expected machine learning among English keywords'
    );
    // English path still tags parts of speech (CJK path uses type "word")
    assert.ok(keywords.every(k => k.type !== 'word'));
  });
});

describe('SummarizeContentTool leading boilerplate stripping', () => {
  const tool = new SummarizeContentTool();

  const PROSE =
    'Alan Mathison Turing was an English mathematician, computer scientist, logician, cryptanalyst, ' +
    'philosopher and theoretical biologist. He was highly influential in the development of theoretical ' +
    'computer science, providing a formalisation of the concepts of algorithm and computation with the ' +
    'Turing machine. Turing is widely considered to be the father of theoretical computer science. ' +
    'Born in London, Turing was raised in southern England. During World War II, Turing worked for the ' +
    'Government Code and Cypher School at Bletchley Park. He led Hut 8, the section responsible for ' +
    'German naval cryptanalysis.';

  test('summary of chrome-prefixed text contains no navigation chrome', async () => {
    const result = await tool.execute({
      text: `Jump to content\n\nFrom Wikipedia, the free encyclopedia\n\n${PROSE}`
    });

    assert.equal(result.success, true);
    assert.ok(!result.summary.text.includes('Jump to content'));
    assert.ok(!result.summary.text.includes('From Wikipedia'));
    for (const sentence of result.summary.sentences) {
      assert.ok(!sentence.includes('Jump to content'));
    }
    for (const point of result.keypoints || []) {
      assert.ok(!point.includes('Jump to content'));
      assert.ok(!point.includes('From Wikipedia'));
    }
  });

  test('prose starting mid-sentence is not stripped', () => {
    const mid =
      'and the committee, after long deliberation, voted to approve the merger despite objections ' +
      'from three members. The decision was announced the next morning.';
    assert.equal(tool.stripLeadingBoilerplate(mid), mid);
  });

  test('short text with a short first line is left untouched (size guard)', () => {
    const short = 'hello world\nThis is a test of the guard.';
    assert.equal(tool.stripLeadingBoilerplate(short), short);
  });

  test('a run of short lines exceeding the size cap strips nothing', () => {
    const poem = Array.from({ length: 30 }, (_, i) => `short line ${i}`).join('\n');
    assert.equal(tool.stripLeadingBoilerplate(poem), poem);
  });
});

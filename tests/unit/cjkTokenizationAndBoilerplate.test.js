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
 *
 * Regression (TOOL_QUALITY_PLAN item 5.2):
 * 3. analyze_content reported readability.metrics.words = 1 and
 *    avgCharsPerWord = 174 on the same Chinese paragraph statistics.words
 *    counted as 96 — calculateReadability split on whitespace while
 *    calculateStatistics segmented. Both now go through tokenizeWords.
 *    splitSentences also had no CJK terminators, so both blocks reported
 *    sentences: 1; 。．！？； now end a sentence, and Flesch (syllable-based,
 *    meaningless for CJK) is withheld instead of fabricated.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ContentAnalyzer } from '../../src/core/analysis/ContentAnalyzer.js';
import { splitSentences } from '../../src/core/analysis/sentenceUtils.js';
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

  test('the live extract_text chrome shape is stripped down to the article', () => {
    // The three lines extract_text actually emits above the article body on
    // en.wikipedia.org/wiki/Web_scraping (verified live 2026-08-27).
    const page =
      'Jump to content\n\nFrom Wikipedia, the free encyclopedia\n\n' +
      `Method of extracting data from websites\n\n${PROSE}`;
    assert.equal(tool.stripLeadingBoilerplate(page), PROSE);
  });

  test('a short opening sentence is kept, not mistaken for chrome', () => {
    // The reason the punctuation exception is a phrase list and not a rule:
    // "It was cold." and "Jump to content." match on every feature the function
    // can measure (<= 60 chars, <= 8 words, one terminator in final position),
    // so any general loosening of the terminator test admits both and the
    // summary loses its first real sentence.
    const prose =
      'It was cold.\nThe wind came off the estuary and rattled the shutters until dawn.';
    assert.equal(tool.stripLeadingBoilerplate(prose), prose);
  });

  test('a listed navigation phrase is stripped even when it carries a terminator', () => {
    const page = `Jump to content.\n\nFrom Wikipedia, the free encyclopedia.\n\n${PROSE}`;
    assert.equal(tool.stripLeadingBoilerplate(page), PROSE);
  });

  test('navigation phrases match case-insensitively and past repeated terminators', () => {
    assert.equal(tool.stripLeadingBoilerplate(`JUMP TO CONTENT!!\n\n${PROSE}`), PROSE);
    assert.equal(tool.stripLeadingBoilerplate(`  Skip to main content.  \n\n${PROSE}`), PROSE);
    assert.equal(tool.stripLeadingBoilerplate(`Ir al contenido.\n\n${PROSE}`), PROSE);
  });

  test('a listed phrase is not stripped when it appears after real prose', () => {
    const mid = `${PROSE}\n\nJump to content.\n\nMore text follows here.`;
    assert.equal(tool.stripLeadingBoilerplate(mid), mid);
  });

  test('a punctuated line that merely resembles a nav phrase is kept', () => {
    // Not on the list, so the punctuation test still protects it.
    const prose = 'Jump to it.\nShe had been waiting for that signal for most of the morning.';
    assert.equal(tool.stripLeadingBoilerplate(prose), prose);
  });
});

// A single Chinese paragraph: 5 sentences, 174 characters, 96 segmented words.
// The exact input reproduced item 5.2 over real MCP stdio (readability said
// words: 1 / avgCharsPerWord: 174 / sentences: 1 while statistics said 96 / 1).
const CHINESE_PARAGRAPH = [
  '北京市是中华人民共和国的首都，也是全国的政治、文化、教育与国际交往中心。',
  '这座城市位于华北平原的北部边缘，西面和北面环绕着连绵起伏的燕山山脉。',
  '故宫、天坛和颐和园等世界文化遗产每年吸引着数以千万计的国内外游客前来参观。',
  '中关村聚集了大量的高科技企业和研究机构，被人们称为中国的硅谷。',
  '密集的地铁网络与两座国际机场共同支撑着这座超大城市的日常通勤和对外联系。'
].join('');

describe('splitSentences CJK terminators', () => {
  test('。！？；．each end a sentence without needing whitespace', () => {
    assert.equal(splitSentences('第一句。第二句！第三句？第四句；第五句．').length, 5);
  });

  test('a CJK terminator is not swallowed by the ASCII internal-period check', () => {
    // "使用Node.js开发" has no whitespace, so lastWord is the whole chunk and
    // hasInternalPeriods matches "e.j" — the boundary must survive it anyway.
    const sentences = splitSentences('我们使用Node.js开发后端。前端由另一个团队负责。');
    assert.equal(sentences.length, 2);
    assert.ok(sentences[0].endsWith('。'));
  });

  test('CONTROL (passes pre-fix): English abbreviations and decimals still do not split', () => {
    assert.equal(
      splitSentences('Dr. Smith measured 3.14 units. The result held.').length,
      2
    );
  });
});

describe('analyze_content readability agrees with statistics', () => {
  const analyzer = new ContentAnalyzer();

  test('Chinese: both blocks report the same word and sentence counts', async () => {
    const readability = await analyzer.calculateReadability(CHINESE_PARAGRAPH);
    const stats = analyzer.calculateStatistics(CHINESE_PARAGRAPH);

    assert.equal(readability.metrics.words, stats.words);
    assert.equal(readability.metrics.sentences, stats.sentences);
    assert.equal(stats.sentences, 5, 'the paragraph has 5 。-terminated sentences');
    assert.ok(stats.words > 90, `words=${stats.words}, expected ~96 not the whitespace count`);
    // The bug's signature: one "word" the length of the whole paragraph.
    assert.ok(
      readability.metrics.avgCharsPerWord < 3,
      `avgCharsPerWord=${readability.metrics.avgCharsPerWord}, expected ~1.8`
    );
  });

  test('Chinese: Flesch is withheld with a reason, not fabricated', async () => {
    const readability = await analyzer.calculateReadability(CHINESE_PARAGRAPH);

    assert.equal(readability.score, undefined);
    assert.equal(readability.level, undefined);
    assert.equal(readability.notApplicable, 'flesch-requires-syllable-based-language');
    // "not applicable" must stay distinguishable from "failed" (a null return).
    assert.ok(readability.metrics, 'metrics are still reported for CJK');
  });

  test('English: score and level are still reported and the blocks agree', async () => {
    const english =
      'Machine learning systems process large volumes of data efficiently. ' +
      'Dr. Smith reported that accuracy improved by 3.14 percent after tuning. ' +
      'The framework, written in Node.js, handles datasets without manual work.';

    const readability = await analyzer.calculateReadability(english);
    const stats = analyzer.calculateStatistics(english);

    assert.equal(typeof readability.score, 'number');
    assert.equal(typeof readability.level, 'string');
    assert.equal(readability.notApplicable, undefined);
    assert.equal(readability.metrics.words, stats.words);
    assert.equal(readability.metrics.words, english.split(/\s+/).filter(w => w.length > 0).length);
    assert.equal(readability.metrics.sentences, stats.sentences);
    assert.equal(stats.sentences, 3, 'Dr. and 3.14 and Node.js must not split');
  });
});

describe('summarize_content ripple from the CJK terminators', () => {
  const tool = new SummarizeContentTool();

  test('a Chinese paragraph summarizes to a subset of its sentences', async () => {
    const result = await tool.execute({ text: CHINESE_PARAGRAPH });

    assert.equal(result.success, true);
    // Pre-fix the whole paragraph was one "sentence", so the summary was the
    // input verbatim at compressionRatio 1.
    assert.ok(
      result.summary.sentences.length >= 1 && result.summary.sentences.length < 5,
      `summary picked ${result.summary.sentences.length} of 5 sentences`
    );
    assert.ok(
      result.summary.compressionRatio < 1,
      `compressionRatio=${result.summary.compressionRatio}, expected < 1`
    );
    for (const sentence of result.summary.sentences) {
      assert.ok(sentence.endsWith('。'), `summary sentence is not one sentence: ${sentence}`);
    }
  });
});

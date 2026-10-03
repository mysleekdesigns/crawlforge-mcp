/**
 * Unit tests: summarize_content / analyze_content on non-English text (R24 3.8).
 * Run: node --test --test-force-exit tests/unit/r24p3-analysis-nonenglish.test.js
 *
 * The 2026-10-03 sweep found: Japanese summaries ended "…。." and counted a
 * paragraph as one word; a German abstractive summary came back in English;
 * German keywords were "die, ist, und, der"; and sentiment for German and
 * Japanese was "neutral" although the lexicon is English-only.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import ContentAnalyzer from '../../src/core/analysis/ContentAnalyzer.js';
import { SummarizeContentTool } from '../../src/tools/extract/summarizeContent.js';
import { AnalyzeContentTool } from '../../src/tools/extract/analyzeContent.js';

const JA = '東京は日本の首都であり、世界最大級の都市圏を形成している。人口は約1400万人で、政治や経済の中心地となっている。多くの企業が本社を置き、国際的な金融センターとしても知られている。また、伝統的な寺院や神社と近代的な高層ビルが共存している。毎年多くの観光客が訪れ、美しい桜の季節は特に人気がある。';
const DE = 'Die Stadt Berlin ist die Hauptstadt der Bundesrepublik Deutschland und hat etwa 3,8 Millionen Einwohner. Sie ist damit die bevölkerungsreichste Stadt in der Europäischen Union. Die Stadt ist ein bedeutendes Zentrum der Politik, Kultur, Medien und Wissenschaft. Berlin ist bekannt für seine Museen, die zahlreichen Theater und das lebendige Nachtleben. Die Mauer teilte die Stadt von 1961 bis 1989 in Ost und West. Heute ist die Stadt ein beliebtes Ziel für Touristen aus der ganzen Welt.';
const GERMAN_FUNCTION_WORDS = ['die', 'der', 'das', 'ist', 'und', 'ein', 'für', 'den', 'hat'];

describe('summary sentence joining', () => {
  const a = new ContentAnalyzer();

  test('a CJK-terminated sentence gets no "." appended and no space', () => {
    assert.equal(a.joinSentences(['一つ目。', '二つ目！']), '一つ目。二つ目！');
  });

  test('ASCII sentences are joined exactly as before', () => {
    assert.equal(a.joinSentences(['First one.', 'Second one!', 'Third']), 'First one. Second one. Third.');
  });

  test('a Japanese summary never contains "。."', async () => {
    const r = await new SummarizeContentTool().execute({ text: JA, options: { summaryLength: 'short' } });
    assert.equal(r.success, true);
    assert.ok(!r.summary.text.includes('。.'), r.summary.text);
    assert.ok(r.summary.text.endsWith('。'), r.summary.text);
  });
});

describe('summarize_content statistics on Japanese', () => {
  test('words are segmented, not whitespace-split', async () => {
    const r = await new SummarizeContentTool().execute({ text: JA });
    // Whitespace splitting returned 1 for the whole paragraph.
    assert.ok(r.statistics.original.words > 40, `words=${r.statistics.original.words}`);
    assert.equal(r.statistics.original.words, new ContentAnalyzer().tokenizeWords(JA).length);
  });
});

describe('German keywords', () => {
  test('summarize_content keywords exclude German function words', async () => {
    const r = await new SummarizeContentTool().execute({ text: DE });
    const words = r.keywords.map(k => k.keyword);
    for (const fw of GERMAN_FUNCTION_WORDS) assert.ok(!words.includes(fw), `${fw} in ${words}`);
    assert.ok(words.includes('berlin') && words.includes('stadt'), words.join(','));
  });

  test('analyze_content topics exclude German function words', async () => {
    const r = await new AnalyzeContentTool().execute({ text: DE });
    const topics = r.topics.map(t => t.topic);
    for (const fw of GERMAN_FUNCTION_WORDS) assert.ok(!topics.includes(fw), `${fw} in ${topics}`);
  });

  test('German stop words do not leak into English ("war" stays a keyword)', async () => {
    const english = 'The war lasted six years. The war changed Europe. Historians still study the war and its causes.';
    const r = await new AnalyzeContentTool().execute({ text: english });
    assert.ok(r.keywords.some(k => /\bwar\b/.test(k.keyword)), r.keywords.map(k => k.keyword).join(','));
    assert.equal(new ContentAnalyzer().isStopWord('war'), false);
  });
});

describe('sentiment on non-English text', () => {
  test('German with no lexicon hit is not_applicable, not neutral', async () => {
    const r = await new AnalyzeContentTool().execute({ text: DE });
    assert.equal(r.sentiment.label, 'not_applicable');
    assert.equal(r.sentiment.confidence, 0);
    assert.equal(r.sentiment.notApplicable, 'sentiment-lexicon-is-english-only');
  });

  test('Japanese is not_applicable', async () => {
    const r = await new AnalyzeContentTool().execute({ text: JA });
    assert.equal(r.sentiment.notApplicable, 'sentiment-lexicon-is-english-only');
  });

  test('short English that franc misplaces is still scored', async () => {
    // franc reports "I am so happy today" as Somali.
    const r = await new AnalyzeContentTool().execute({ text: 'I am so happy today' });
    assert.equal(r.sentiment.label, 'positive');
    assert.equal(r.sentiment.notApplicable, undefined);
  });

  test('neutral English stays neutral', async () => {
    const r = await new AnalyzeContentTool().execute({ text: 'The meeting starts at nine and the report is due on Friday for the team.' });
    assert.equal(r.sentiment.label, 'neutral');
    assert.equal(r.sentiment.notApplicable, undefined);
  });
});

describe('abstractive prompt names the language', () => {
  const tool = new SummarizeContentTool();

  test('the detected language is named in the instruction', () => {
    const prompt = tool.buildAbstractivePrompt(DE, 'short', 'German');
    assert.match(prompt, /Write the summary in German, the language of the text/);
    assert.match(prompt, /1-2 sentences/);
  });

  test('with no detected language it asks for the text\'s own language', () => {
    assert.match(tool.buildAbstractivePrompt(DE, 'medium'), /same language as the text/);
  });

  test('execute passes the detected language through to the sampler', async () => {
    let seen;
    const t = new SummarizeContentTool();
    t._abstractiveSummaryViaSampling = async (text, ex, len, languageName) => { seen = languageName; return null; };
    await t.execute({ text: DE, options: { summaryType: 'abstractive' } });
    assert.equal(seen, 'German');
  });
});

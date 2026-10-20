/**
 * R25 Phase 4 (output quality), part A.
 *
 * Run: node --test --test-force-exit tests/unit/r25-phase4-a.test.js
 *
 *   - localization: getFirstDayOfWeek used `|| 1`, so the US value 0 (Sunday)
 *     came back as Monday, and only four countries were listed.
 *   - extract_with_llm: an input cut set the top-level `truncated: true`, which
 *     elsewhere means "this result is a preview, use read_result".
 *   - extract_with_llm: the cost note said an external provider bills you even
 *     on the default local Ollama.
 *   - analyze_content: a 25-word list left clearly positive text "neutral" at
 *     0.5 confidence.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const savedBaseUrl = process.env.OLLAMA_BASE_URL;
const { LocalizationManager } = await import('../../src/core/LocalizationManager.js');
const { ExtractWithLlm } = await import('../../src/tools/extract/extractWithLlm.js');
const { AnalyzeContentTool } = await import('../../src/tools/extract/analyzeContent.js');
const authManager = (await import('../../src/core/AuthManager.js')).default;

describe('localization firstDayOfWeek (CLDR weekData)', () => {
  const manager = new LocalizationManager();

  // CLDR 48 supplemental weekData firstDay for every supported country.
  const CLDR_SUNDAY = ['US', 'JP', 'CA', 'BR', 'IN', 'KR', 'MX', 'SA', 'IL', 'TH', 'SG', 'ZA'];

  test('US and JP start the week on Sunday (0)', async () => {
    for (const code of ['US', 'JP']) {
      const config = await manager.configureCountry(code);
      const browser = await manager.generateBrowserLocale(config);
      assert.equal(browser.firstDayOfWeek, 0, code);
    }
  });

  test('every supported country matches CLDR', () => {
    for (const code of manager.getSupportedCountries()) {
      assert.equal(manager.getFirstDayOfWeek(code), CLDR_SUNDAY.includes(code) ? 0 : 1, code);
    }
  });

  test('an unlisted country falls back to Monday', () => {
    assert.equal(manager.getFirstDayOfWeek('XX'), 1);
  });
});

describe('extract_with_llm input cut', () => {
  let server;

  before(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'stub', message: { role: 'assistant', content: '{"title":"Widget"}' } }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (savedBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = savedBaseUrl;
  });

  test('a clipped input is reported as input_truncated, not truncated', async () => {
    const result = await new ExtractWithLlm().execute({
      content: 'Widget '.repeat(10_000),
      prompt: 'Extract the title',
      provider: 'ollama',
      model: 'stub-model'
    });
    assert.equal(result.success, true);
    assert.equal(result.input_truncated, true);
    assert.equal(result.original_length, 70_000);
    assert.equal('truncated' in result, false, 'top-level truncated is reserved for result previews');
  });
});

describe('extract_with_llm cost note', () => {
  const BILLED = /billed by your LLM provider/;

  test('shown for openai and anthropic', () => {
    for (const provider of ['openai', 'anthropic']) {
      assert.match(authManager.projectCost('extract_with_llm', { provider }).note, BILLED, provider);
    }
  });

  test('absent for ollama, auto and the default', () => {
    for (const params of [{ provider: 'ollama' }, { provider: 'auto' }, {}]) {
      assert.doesNotMatch(authManager.projectCost('extract_with_llm', params).note, BILLED, JSON.stringify(params));
    }
  });
});

describe('analyze_content sentiment (AFINN-165)', () => {
  const tool = new AnalyzeContentTool();
  const sentimentOf = async (text) => (await tool.execute({ text })).sentiment;

  test('clearly positive text is positive', async () => {
    const s = await sentimentOf('I absolutely loved this product. The quality is excellent, delivery was fast, and the support team was wonderful and helpful.');
    assert.equal(s.label, 'positive');
    assert.ok(s.polarity > 0 && s.confidence >= 0.5, JSON.stringify(s));
  });

  test('clearly negative text is negative', async () => {
    const s = await sentimentOf('This was the worst purchase I have ever made. The product broke after a day, support was rude and useless, and I want a refund.');
    assert.equal(s.label, 'negative');
    assert.ok(s.polarity < 0 && s.confidence >= 0.5, JSON.stringify(s));
  });

  test('negation flips the score', async () => {
    assert.equal((await sentimentOf('I am not happy with this.')).label, 'negative');
  });

  test('neutral text is neutral with no confidence', async () => {
    const s = await sentimentOf('The quarterly report lists revenue, headcount and office locations for each region.');
    assert.equal(s.label, 'neutral');
    assert.equal(s.confidence, 0);
  });

  test('German function words in the English lexicon are not scored', async () => {
    // "die" is -3 in AFINN; German text must stay not_applicable, not negative.
    const s = await sentimentOf('Die Stadt Berlin ist die Hauptstadt der Bundesrepublik Deutschland und hat etwa 3,8 Millionen Einwohner. Die Mauer teilte die Stadt von 1961 bis 1989 in Ost und West.');
    assert.equal(s.label, 'not_applicable');
  });
});

/**
 * summarize_content: page chrome stripped before summarising, and the
 * abstractive default for medium summaries (live sweep 2026-10-20, item 5.1).
 *
 * Fixtures (tests/fixtures/summarize/):
 * - bbc-news-home.txt: text of https://www.bbc.co.uk/news captured 2026-10-21
 *   with scrape (formats: text, onlyMainContent: false), condensed to fewer
 *   stories. The capture carried no consent banner, so the cookie banner, the
 *   "Register"/"Subscribe" lines and the pipe-joined menu were added in the
 *   shapes the sweep reported ("all cookies manage preferences", "register
 *   subscribe", "Home | News | Sport…").
 * - books-toscrape-listing.txt: extract_text of https://books.toscrape.com/,
 *   captured 2026-10-21, unedited.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SummarizeContentTool } from '../../src/tools/extract/summarizeContent.js';

const fixture = (name) =>
  readFileSync(new URL(`../fixtures/summarize/${name}`, import.meta.url), 'utf8');
const NEWS = fixture('bbc-news-home.txt');
const BOOKS = fixture('books-toscrape-listing.txt');

// Medium summaries now try an LLM first; point Ollama at a closed port so the
// suite never depends on a local model being up.
let savedOllama;
before(() => {
  savedOllama = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
});
after(() => {
  if (savedOllama === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = savedOllama;
});

const CHROME = /home \| news|\bsport\b.*\bearth\b|\bregister\b|\bsubscribe\b|cookies|manage preferences|accessibility help|search bbc/i;

describe('summarize_content strips page chrome', () => {
  test('the news fixture\'s keypoints contain no nav or cookie phrases', async () => {
    const r = await new SummarizeContentTool().execute({ text: NEWS });
    assert.equal(r.success, true);
    assert.ok(r.keypoints.length > 0);
    for (const point of r.keypoints) assert.doesNotMatch(point, CHROME);
    assert.ok(r.keypoints.some((p) => p.includes('Burnham defends Jackdaw decision')), 'the lead story is a key point');
  });

  test('the news summary and keywords carry no chrome either', async () => {
    const r = await new SummarizeContentTool().execute({ text: NEWS });
    assert.doesNotMatch(r.summary.text, CHROME);
    for (const { keyword } of r.keywords) {
      assert.doesNotMatch(keyword, /^(home|news|sport|cookies|register|subscribe|menu|culture|weather)$/i);
    }
  });

  test('each headline is its own sentence, not glued into a column', async () => {
    const r = await new SummarizeContentTool().execute({ text: NEWS, options: { summaryType: 'extractive' } });
    for (const s of r.summary.sentences) assert.ok(s.length < 300, `sentence too long: ${s.slice(0, 80)}…`);
  });

  test('a books listing summary keeps titles, not only prices', async () => {
    const r = await new SummarizeContentTool().execute({ text: BOOKS, options: { summaryType: 'extractive' } });
    assert.equal(r.success, true);
    assert.doesNotMatch(r.summary.text, /In stock|Add to basket/);
    const titled = r.summary.sentences.filter((s) => /[A-Za-z]{4,}/.test(s.replace(/In stock|Add to basket/g, '')));
    assert.ok(titled.length >= 2, `expected sentences with words, got ${JSON.stringify(r.summary.sentences)}`);
  });
});

describe('stripPageBoilerplate leaves content alone', () => {
  const tool = new SummarizeContentTool();

  test('prose paragraphs are returned unchanged', () => {
    const prose = 'The council met on Tuesday.\n\nIt approved the budget, which rises by 4%.\n\nResidents may comment until March.';
    assert.equal(tool.stripPageBoilerplate(prose), prose);
  });

  test('a recipe line about cookies is kept; a consent line is dropped', () => {
    const text = 'We use cookies to improve your experience. Accept or manage preferences.\n' +
      'Bake the cookies for twelve minutes until golden.\nLet them cool on a rack before serving.';
    const out = tool.stripPageBoilerplate(text);
    assert.match(out, /Bake the cookies/);
    assert.doesNotMatch(out, /We use cookies/);
  });

  test('short titles alternating with prices are not a nav run', () => {
    const text = 'Olio\n£23.88\nSet Me Free\n£17.46\nSoumission\n£50.10\nSharp Objects\n£47.82';
    assert.equal(tool.stripPageBoilerplate(text), text);
  });

  test('a run of short menu lines is dropped', () => {
    const text = 'Home\nNews\nSport\nWeather\nThe storm reached the coast overnight, closing several roads.';
    assert.equal(tool.stripPageBoilerplate(text), 'The storm reached the coast overnight, closing several roads.');
  });
});

describe('medium summaries default to abstractive when an LLM is available', () => {
  const ARTICLE = [
    'The city council approved a new transport plan on Tuesday after a long debate.',
    'The plan adds three bus routes and extends the tram line to the airport.',
    'Officials say the changes will cut journey times by a fifth within two years.',
    'Opponents argued that the cost had been underestimated by several million pounds.',
    'The first new route is expected to open next spring, subject to final funding.',
    'Residents can comment on the detailed timetable until the end of March.'
  ].join(' ');

  const stubbed = (returnValue) => {
    const tool = new SummarizeContentTool();
    tool.calls = 0;
    tool._abstractiveSummaryViaSampling = async () => { tool.calls++; return returnValue; };
    return tool;
  };
  const ABSTRACT = { text: 'The council approved a transport plan.', sentences: ['The council approved a transport plan.'], type: 'abstractive', length: 'medium', compressionRatio: 0.1 };

  test('omitted summaryType + medium uses the LLM summary when one comes back', async () => {
    const tool = stubbed(ABSTRACT);
    const r = await tool.execute({ text: ARTICLE });
    assert.equal(tool.calls, 1);
    assert.equal(r.summary.type, 'abstractive');
    assert.equal(r.metadata.processingMethod, 'abstractive');
    assert.equal(r.degraded, undefined);
  });

  test('with no LLM it falls back to extractive silently (no degradedReason)', async () => {
    const r = await new SummarizeContentTool().execute({ text: ARTICLE });
    assert.equal(r.success, true);
    assert.equal(r.summary.type, 'extractive');
    assert.equal(r.metadata.processingMethod, 'extractive');
    assert.equal(r.degraded, undefined);
    assert.equal(r.degradedReason, undefined);
  });

  test('an explicit extractive request never calls the LLM', async () => {
    const tool = stubbed(ABSTRACT);
    const r = await tool.execute({ text: ARTICLE, options: { summaryType: 'extractive' } });
    assert.equal(tool.calls, 0);
    assert.equal(r.summary.type, 'extractive');
  });

  test('short and long lengths keep the extractive default', async () => {
    for (const summaryLength of ['short', 'long']) {
      const tool = stubbed(ABSTRACT);
      const r = await tool.execute({ text: ARTICLE, options: { summaryLength } });
      assert.equal(tool.calls, 0, summaryLength);
      assert.equal(r.summary.type, 'extractive');
    }
  });
});

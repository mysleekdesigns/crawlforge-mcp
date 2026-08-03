/**
 * Unit tests: summarizeContent tool (real module — src/tools/extract/summarizeContent.js)
 * Run: node --test tests/unit/tools/extract/summarizeContent.test.js
 *
 * SummarizeContentTool has no injectable I/O dependency for the extractive
 * path (it drives ContentAnalyzer -> node-summarizer, all in-process, no
 * network) so these tests exercise the real classes directly.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SummarizeContentTool } from '../../../../src/tools/extract/summarizeContent.js';

// 15-sentence fixture — long enough to give node-summarizer real ranking work
// to do (summarizeText() only calls it once splitSentences finds >= 3 sentences).
const LONG_TEXT = [
  'CrawlForge is a professional web scraping and crawling toolkit.',
  'It provides twenty seven distinct tools for extracting content from the web.',
  'The tools cover basic fetching, structured extraction, and deep crawling.',
  'Developers can use it to build research agents and data pipelines.',
  'It supports stealth browsing to avoid detection on protected sites.',
  'The system integrates with large language models for structured extraction.',
  'Content can be exported as markdown, JSON, or plain text.',
  'A credit based billing system tracks usage across API calls.',
  'The server implements the Model Context Protocol for tool discovery.',
  'It can run locally via stdio or remotely via HTTP transport.',
  'Caching reduces redundant network requests for repeated crawls.',
  'Rate limiting protects both the target site and the local process.',
  'SSRF protections block requests to internal or metadata endpoints.',
  'The project ships with an extensive automated test suite.',
  'Continuous integration runs the tests on every pull request.'
].join(' ');

describe('summarizeContent tool (real module)', () => {
  let tool;

  beforeEach(() => {
    tool = new SummarizeContentTool();
  });

  test('constructor creates a real ContentAnalyzer', () => {
    assert.ok(tool.contentAnalyzer, 'contentAnalyzer should be constructed');
  });

  test('happy path extractive — returns a real extractive summary, not a fallback', async () => {
    const result = await tool.execute({ text: LONG_TEXT });
    assert.equal(result.success, true);
    assert.equal(result.summary.type, 'extractive');
    assert.ok(result.summary.text.length > 0, 'summary text should exist');
    assert.ok(result.summary.text.length < LONG_TEXT.length, 'summary should be shorter than original');
    assert.ok(typeof result.summary.compressionRatio === 'number');
  });

  // Reproduction test for the node-summarizer API fix (ContentAnalyzer used to
  // call the non-existent `summarizer.getSummaryByRanking(text, n)`; every
  // extractive summarization threw, was swallowed, and silently downgraded to
  // summary.type === 'fallback'. It now uses `new SummarizerManager(text, n).getSummaryByRank()`.)
  test('short vs long summaryLength produce genuinely different extractive summaries (not the "fallback" 2-sentence path)', async () => {
    const shortResult = await tool.execute({ text: LONG_TEXT, options: { summaryLength: 'short' } });
    const longResult = await tool.execute({ text: LONG_TEXT, options: { summaryLength: 'long' } });

    assert.equal(shortResult.summary.type, 'extractive', 'short summary must be real extractive output, not a fallback');
    assert.equal(longResult.summary.type, 'extractive', 'long summary must be real extractive output, not a fallback');

    // node-summarizer's short/long sentence counts must differ for a 15-sentence
    // input: short targets ceil(15*0.1)=2, long targets ceil(15*0.5)=8 (capped
    // to available sentences). A fallback path always returns exactly 2
    // sentences for every length, which this assertion would catch.
    assert.notEqual(
      shortResult.summary.sentences.length,
      longResult.summary.sentences.length,
      'short and long summaries should have different sentence counts'
    );
    assert.ok(longResult.summary.sentences.length > shortResult.summary.sentences.length);
  });

  test('short length returns shorter summary text than long', async () => {
    const shortResult = await tool.execute({ text: LONG_TEXT, options: { summaryLength: 'short' } });
    const longResult = await tool.execute({ text: LONG_TEXT, options: { summaryLength: 'long' } });
    assert.ok(shortResult.summary.text.length <= longResult.summary.text.length);
  });

  test('abstractive with no LLM/sampling backend falls back to extractive and flags degraded', async () => {
    // SamplingClient's fallback chain tries a local Ollama server (default
    // http://localhost:11434) before giving up — on a dev machine that
    // actually has Ollama running, abstractive summarization would genuinely
    // succeed, which isn't what this test is checking. Point OLLAMA_BASE_URL
    // at an unreachable address so the "no backend available" path is
    // exercised deterministically regardless of the host environment.
    const savedOllamaBaseUrl = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
    try {
      const result = await tool.execute({ text: LONG_TEXT, options: { summaryType: 'abstractive' } });
      assert.ok(result.summary.text, 'should still return a summary');
      assert.equal(result.summary.type, 'extractive', 'falls back to extractive type when no LLM backend is available');
      assert.equal(result.degraded, true);
      assert.match(result.degradedReason, /Abstractive summarization unavailable/);
    } finally {
      if (savedOllamaBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
      else process.env.OLLAMA_BASE_URL = savedOllamaBaseUrl;
    }
  });

  test('missing text param returns a structured failure (not a thrown error)', async () => {
    const result = await tool.execute({});
    assert.equal(result.success, false);
    assert.match(result.error, /Content summarization failed/);
  });

  test('text too short (Zod min length) returns a structured failure', async () => {
    const result = await tool.execute({ text: 'Hi' });
    assert.equal(result.success, false);
    assert.match(result.error, /Content summarization failed/);
  });

  test('statistics block has original and summary word counts', async () => {
    const result = await tool.execute({ text: LONG_TEXT });
    assert.ok(typeof result.statistics.original.words === 'number');
    assert.ok(typeof result.statistics.summary.words === 'number');
    assert.ok(result.statistics.summary.words < result.statistics.original.words);
  });

  test('keypoints are extracted from the original text when requested', async () => {
    const result = await tool.execute({ text: LONG_TEXT, options: { includeKeypoints: true } });
    assert.ok(Array.isArray(result.keypoints));
  });

  test('keywords are omitted when includeKeywords=false', async () => {
    const result = await tool.execute({ text: LONG_TEXT, options: { includeKeywords: false } });
    assert.equal(result.keywords, undefined);
  });

  test('short input (below the 3-sentence summarizer threshold) returns the whole text verbatim', async () => {
    const shortText = 'CrawlForge scrapes the web. It is fast and reliable.';
    const result = await tool.execute({ text: shortText });
    assert.equal(result.success, true);
    assert.equal(result.summary.compressionRatio, 1);
    assert.equal(result.summary.text, shortText.trim());
  });
});

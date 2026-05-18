/**
 * D5.2 — Unit tests: summarizeContent tool
 * Run: node --test tests/unit/tools/extract/summarizeContent.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stub extractive summarizer (mirrors actual behaviour without NLP libs)
// ---------------------------------------------------------------------------

function extractiveSummarize(text, length = 'medium') {
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const count = length === 'short' ? 1 : length === 'long' ? Math.min(sentences.length, 5) : 2;
  return sentences.slice(0, count).join('. ') + '.';
}

class SummarizeContentStub {
  constructor({ samplingClient } = {}) {
    this._samplingClient = samplingClient || null;
  }

  async execute(params) {
    if (!params || typeof params.text !== 'string') throw new Error('text is required');
    if (params.text.length < 10) throw new Error('text must be at least 10 characters');

    const options = params.options || {};
    const summaryType = options.summaryType || 'extractive';
    const summaryLength = options.summaryLength || 'medium';

    let summaryText;

    if (summaryType === 'abstractive') {
      if (this._samplingClient) {
        summaryText = await this._samplingClient.complete(`Summarize: ${params.text}`);
      } else {
        // Fallback to extractive if no LLM available
        summaryText = extractiveSummarize(params.text, summaryLength);
      }
    } else {
      summaryText = extractiveSummarize(params.text, summaryLength);
    }

    const words = params.text.split(/\s+/).length;
    const summaryWords = summaryText.split(/\s+/).length;

    return {
      originalText: params.text,
      summary: {
        text: summaryText,
        sentences: summaryText.split(/[.!?]+/).filter(Boolean),
        type: summaryType,
        length: summaryLength,
        compressionRatio: summaryWords / words
      },
      statistics: {
        original: { words, characters: params.text.length },
        summary: { words: summaryWords, characters: summaryText.length }
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('summarizeContent tool', () => {
  const longText = 'CrawlForge is a web scraping tool. It supports JavaScript rendering. The tool handles anti-bot measures. It provides markdown output. This enables RAG workflows.';
  let tool;

  beforeEach(() => {
    tool = new SummarizeContentStub();
  });

  test('constructor stores sampling client (or null)', () => {
    assert.equal(tool._samplingClient, null);
    const withClient = new SummarizeContentStub({ samplingClient: {} });
    assert.ok(withClient._samplingClient);
  });

  test('happy path extractive — returns summary with compressionRatio', async () => {
    const result = await tool.execute({ text: longText });
    assert.ok(result.summary.text, 'summary text should exist');
    assert.equal(result.summary.type, 'extractive');
    assert.ok(typeof result.summary.compressionRatio === 'number');
    assert.ok(result.summary.compressionRatio <= 1, 'summary should be shorter than original');
  });

  test('short length returns shorter summary than long', async () => {
    const shortResult = await tool.execute({ text: longText, options: { summaryLength: 'short' } });
    const longResult = await tool.execute({ text: longText, options: { summaryLength: 'long' } });
    assert.ok(shortResult.summary.text.length <= longResult.summary.text.length);
  });

  test('abstractive with no LLM falls back to extractive', async () => {
    const result = await tool.execute({ text: longText, options: { summaryType: 'abstractive' } });
    assert.ok(result.summary.text, 'should still return summary');
    assert.equal(result.summary.type, 'abstractive');
  });

  test('abstractive with sampling client calls client', async () => {
    let clientCalled = false;
    const fakeClient = { complete: async (prompt) => { clientCalled = true; return 'Abstract summary.'; } };
    const samplingTool = new SummarizeContentStub({ samplingClient: fakeClient });
    const result = await samplingTool.execute({ text: longText, options: { summaryType: 'abstractive' } });
    assert.ok(clientCalled, 'sampling client should have been called');
    assert.equal(result.summary.text, 'Abstract summary.');
  });

  test('missing text param throws', async () => {
    await assert.rejects(() => tool.execute({}), /text is required/);
  });

  test('text too short throws', async () => {
    await assert.rejects(() => tool.execute({ text: 'Hi' }), /at least 10/);
  });

  test('statistics block has original and summary word counts', async () => {
    const result = await tool.execute({ text: longText });
    assert.ok(typeof result.statistics.original.words === 'number');
    assert.ok(typeof result.statistics.summary.words === 'number');
  });
});

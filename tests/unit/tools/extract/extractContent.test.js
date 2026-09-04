/**
 * Unit tests: extractContent tool (real module — src/tools/extract/extractContent.js)
 * Run: node --test tests/unit/tools/extract/extractContent.test.js
 *
 * ExtractContentTool.execute() accepts a pre-rendered `html` param that skips
 * the network fetch entirely (added so callers like scrape_with_actions can
 * hand it an already-fetched page). All tests below use that seam to exercise
 * the real ContentProcessor / HTMLCleaner / ContentQualityAssessor pipeline
 * with no network I/O and no browser launch.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ExtractContentTool } from '../../../../src/tools/extract/extractContent.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Wikipedia's *List of S&P 500 companies*, condensed — the page whose payload
// Readability drops (see tests/unit/tools/scrape/mainContent.test.js).
const SP500_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const sp500Html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../scrape/fixtures/sp500-condensed.html'), 'utf8');

function articleHtml({ title = 'Test Article', paragraphs = 6 } = {}) {
  const body = 'This is a long paragraph of article content that should be picked up by Readability as the main content of the page. '.repeat(paragraphs);
  return `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p></article><nav>Home About Contact</nav></body></html>`;
}

describe('extractContent tool (real module)', () => {
  let tool;

  beforeEach(() => {
    tool = new ExtractContentTool();
  });

  test('constructor initialises real ContentProcessor and BrowserProcessor', () => {
    assert.ok(tool.contentProcessor);
    assert.ok(tool.browserProcessor);
  });

  test('happy path — providedHtml skips the network fetch and returns structured content', async () => {
    const result = await tool.execute({ url: 'https://example.com/article', html: articleHtml() });
    assert.equal(result.success, true);
    assert.equal(result.url, 'https://example.com/article');
    assert.equal(result.title, 'Test Article');
    assert.equal(result.extractionMethod, 'readability');
    assert.ok(result.content.text.includes('long paragraph of article content'));
    assert.ok(result.qualityAssessment, 'quality should be present by default');
  });

  test('markdown output format returns a markdown field', async () => {
    const result = await tool.execute({
      url: 'https://example.com/article',
      html: articleHtml(),
      options: { outputFormat: 'markdown' }
    });
    assert.equal(typeof result.content.markdown, 'string');
    assert.ok(result.content.markdown.length > 0);
  });

  test('invalid URL fails validation and returns a structured failure (not a thrown error)', async () => {
    const result = await tool.execute({ url: 'not-a-url' });
    assert.equal(result.success, false);
    assert.match(result.error, /Content extraction failed/);
  });

  test('missing url param returns a structured failure', async () => {
    const result = await tool.execute({});
    assert.equal(result.success, false);
    assert.match(result.error, /Content extraction failed/);
  });

  test('quality assessment skipped when assessContentQuality=false', async () => {
    const result = await tool.execute({
      url: 'https://example.com/article',
      html: articleHtml(),
      options: { assessContentQuality: false }
    });
    assert.equal(result.qualityAssessment, undefined);
  });

  test('minimal non-article HTML still succeeds and returns non-empty content', async () => {
    const html = '<html><head><title>Bare</title></head><body><div>hi</div></body></html>';
    const result = await tool.execute({ url: 'https://example.com/bare', html });
    assert.equal(result.success, true);
    assert.equal(result.content.text, 'hi');
    assert.ok(['readability', 'fallback_boilerplate_removal', 'raw_body_text'].includes(result.extractionMethod));
  });

  test('includeRawHTML=true includes the original html in content.html', async () => {
    const html = articleHtml();
    const result = await tool.execute({
      url: 'https://example.com/article',
      html,
      options: { includeRawHTML: true }
    });
    assert.equal(result.content.html, html);
  });

  test('processor error propagates as a structured failure', async () => {
    const errorProcessor = { processContent: async () => { throw new Error('processing exploded'); } };
    const errorTool = new ExtractContentTool();
    errorTool.contentProcessor = errorProcessor;
    const result = await errorTool.execute({ url: 'https://example.com/article', html: articleHtml() });
    assert.equal(result.success, false);
    assert.match(result.error, /processing exploded/);
  });

  test('shouldUseJavaScript ignores a bare document anchor but matches /app/ path segments', async () => {
    assert.equal(await tool.shouldUseJavaScript('https://example.com/docs#install'), false);
    assert.equal(await tool.shouldUseJavaScript('https://example.com/app/dashboard'), true);
    assert.equal(await tool.shouldUseJavaScript('https://example.com/apple-pie'), false);
  });
});

describe('extractContent — data tables Readability drops', () => {
  // scrape_with_actions on coinmarketcap.com/currencies/bitcoin/historical-data/
  // (2026-09-04): the wait on `table tbody tr` succeeded, then the markdown and
  // text formats came back as the page's FAQ copy with no table at all.
  // `scrape` had already been taught to re-attach dropped data tables
  // (_mainContent.js); this pipeline had not.
  test('markdown and text carry the table the article candidate left out', async () => {
    const tool = new ExtractContentTool();
    const result = await tool.execute({ url: SP500_URL, html: sp500Html, options: { outputFormat: 'markdown' } });
    assert.equal(result.success, true, result.error);
    assert.equal(result.extractionMethod, 'readability');
    assert.equal(result.readability.tablesRecovered, 1);
    assert.match(result.content.markdown, /^\|\s*\[MMM\]\([^)]+\)\s*\|/m, "3M's row renders as a pipe-table row");
    assert.match(result.content.markdown, /Abbott/, 'and so does a later row');
    assert.match(result.content.text, /MMM \| 3M/, 'text keeps the row with its cells delimited');
  });

  test('a normal article reports no recovered tables and is unchanged', async () => {
    const tool = new ExtractContentTool();
    const result = await tool.execute({ url: 'https://example.com/article', html: articleHtml(), options: { outputFormat: 'markdown' } });
    assert.equal(result.readability.tablesRecovered, 0);
    assert.doesNotMatch(result.content.markdown, /<table/);
  });
});

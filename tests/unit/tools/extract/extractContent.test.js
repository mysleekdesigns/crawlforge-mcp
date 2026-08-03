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

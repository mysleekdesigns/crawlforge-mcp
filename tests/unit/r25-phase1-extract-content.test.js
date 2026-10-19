/**
 * R25 Phase 1, item 1.7 — extract_content on Wikipedia and MDN.
 *
 * - Section headings were lost and "[edit]" was kept: MediaWiki wraps each
 *   heading in `<div class="mw-heading">` with an edit-link span, and
 *   Readability dropped the History and Techniques h2s of *Web scraping*.
 * - Navbox and sidebar templates came back as data tables on
 *   *List of HTTP status codes*, re-attached by recoverDroppedTables.
 * - The title kept HTML entities: MDN's <table> page read "&lt;table&gt;".
 *
 * The Wikipedia fixtures are condensed captures of the real pages (see the
 * note at the top of each .html). The first test of each group asserts the
 * unfixed behaviour, so a fixture that stops reproducing the bug fails loudly.
 *
 * Run: node --test --test-force-exit tests/unit/r25-phase1-extract-content.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

import { extractMainContent, recoverDroppedTables } from '../../src/tools/scrape/_mainContent.js';
import { ContentProcessor } from '../../src/core/processing/ContentProcessor.js';
import { ExtractContentTool } from '../../src/tools/extract/extractContent.js';
import { ProcessDocumentTool } from '../../src/tools/extract/processDocument.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/wikipedia/', import.meta.url));
const WEB_SCRAPING_URL = 'https://en.wikipedia.org/wiki/Web_scraping';
const HTTP_STATUS_URL = 'https://en.wikipedia.org/wiki/List_of_HTTP_status_codes';
const webScrapingHtml = readFileSync(`${FIXTURES}web-scraping-headings.html`, 'utf8');
const httpStatusHtml = readFileSync(`${FIXTURES}http-status-codes-navbox.html`, 'utf8');

const headings = (markdown) => markdown.split('\n').filter((line) => /^#{1,6} /.test(line));

describe('Wikipedia section headings (mw-heading wrapper)', () => {
  test('fixture still reproduces: plain Readability drops History and keeps [edit]', () => {
    const article = new Readability(new JSDOM(webScrapingHtml, { url: WEB_SCRAPING_URL }).window.document).parse();
    assert.ok(!/<h2[^>]*>\s*History\s*<\/h2>/.test(article.content), 'History h2 should be lost without the fix');
    assert.match(article.textContent, /\[\s*edit\s*\]/);
  });

  test('extract_content keeps History and Techniques, with no [edit] lines', async () => {
    const result = await new ExtractContentTool().execute({
      url: WEB_SCRAPING_URL,
      html: webScrapingHtml,
      options: { outputFormat: 'markdown' }
    });
    assert.equal(result.success, true);
    const found = headings(result.content.markdown);
    assert.ok(found.includes('## History'), found.join(' | '));
    assert.ok(found.includes('## Techniques'), found.join(' | '));
    assert.ok(found.includes('### Human copy-and-paste'), found.join(' | '));
    assert.doesNotMatch(result.content.markdown, /\[edit\]|action=edit/);
    assert.doesNotMatch(result.content.text, /\[\s*edit\s*\]/);
  });

  test('ContentProcessor (scrape_with_actions, process_document) gets the same headings', async () => {
    const result = await new ContentProcessor().processContent({ html: webScrapingHtml, url: WEB_SCRAPING_URL });
    assert.match(result.readability.content, /<h2[^>]*>History<\/h2>/);
    assert.match(result.readability.content, /<h2[^>]*>Techniques<\/h2>/);
    assert.doesNotMatch(result.readability.content, /mw-editsection/);
  });

  test("scrape's main-content path gets the same headings", () => {
    const { html } = extractMainContent(webScrapingHtml, WEB_SCRAPING_URL);
    assert.match(html, /<h2[^>]*>History<\/h2>/);
    assert.match(html, /<h2[^>]*>Techniques<\/h2>/);
    assert.doesNotMatch(html, /mw-editsection|action=edit/);
  });
});

describe('Navigation templates are not re-attached as data tables', () => {
  test('fixture still reproduces: plain Readability drops the sidebar and navbox tables', () => {
    const article = new Readability(new JSDOM(httpStatusHtml, { url: HTTP_STATUS_URL }).window.document).parse();
    const doc = new JSDOM(httpStatusHtml).window.document;
    assert.ok(doc.querySelector('table.sidebar[role="navigation"]'), 'sidebar table present');
    assert.ok(doc.querySelector('div.navbox[role="navigation"] table.navbox-inner'), 'footer navbox present');
    assert.ok(!article.textContent.includes('Request methods'), 'sidebar is outside the article');
  });

  test('recoverDroppedTables skips the sidebar and the navbox', () => {
    assert.deepEqual(recoverDroppedTables(httpStatusHtml, HTTP_STATUS_URL, ''), []);
  });

  test('recoverDroppedTables skips a headed table inside <nav>, and still recovers one outside it', () => {
    const table = (caption) => `<table><tr><th>${caption}</th><th>Value</th></tr><tr><td>a</td><td>1</td></tr><tr><td>b</td><td>2</td></tr></table>`;
    const html = `<html><body><nav>${table('Menu')}</nav><div>${table('Fees')}</div></body></html>`;
    const recovered = recoverDroppedTables(html, 'https://example.com/', '');
    assert.equal(recovered.length, 1);
    assert.match(recovered[0].text, /^Fees \| Value/);
  });

  test('extract_content returns no pipe tables and no re-attach warning', async () => {
    const result = await new ExtractContentTool().execute({
      url: HTTP_STATUS_URL,
      html: httpStatusHtml,
      options: { outputFormat: 'markdown' }
    });
    assert.equal(result.success, true);
    assert.equal(result.readability.tablesRecovered, 0);
    assert.equal(result.warnings, undefined);
    assert.doesNotMatch(result.content.markdown, /^\|/m);
    assert.ok(headings(result.content.markdown).includes('### 1xx informational response'));
  });

  test("scrape's main-content path re-attaches nothing", () => {
    assert.equal(extractMainContent(httpStatusHtml, HTTP_STATUS_URL).tablesRecovered, 0);
  });
});

describe('Title entities are decoded', () => {
  // Verbatim from the MDN <table> reference page's <head>, 2026-10-19.
  const MDN_HTML = '<html><head><title>&lt;table&gt; HTML table element - HTML | MDN</title></head><body><p>x</p></body></html>';

  test('extract_content', () => {
    assert.equal(new ExtractContentTool().extractTitleFromHTML(MDN_HTML), '<table> HTML table element - HTML | MDN');
  });

  test('process_document', () => {
    assert.equal(new ProcessDocumentTool().extractTitleFromHTML(MDN_HTML), '<table> HTML table element - HTML | MDN');
  });

  test('a title without entities is unchanged, and no title is null', () => {
    const tool = new ExtractContentTool();
    assert.equal(tool.extractTitleFromHTML('<title> Plain Title </title>'), 'Plain Title');
    assert.equal(tool.extractTitleFromHTML('<p>no title</p>'), null);
  });
});

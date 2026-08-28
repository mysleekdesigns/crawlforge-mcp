/**
 * Unit tests for src/tools/scrape/_mainContent.js
 *
 * Reproduction: Wikipedia's *List of S&P 500 companies* came back from `scrape`
 * with zero table rows at the default onlyMainContent:true — Readability picks
 * one article candidate and the constituents table is not in it. The fixture is
 * a condensed capture of that page (see the note at the top of the .html), and
 * the first test asserts the *unfixed* behaviour so a fixture that stopped
 * reproducing the bug fails loudly instead of passing vacuously.
 *
 * Run: node --test tests/unit/tools/scrape/mainContent.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

import { extractMainContent } from '../../../../src/tools/scrape/_mainContent.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SP500_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const sp500Html = readFileSync(join(FIXTURES, 'sp500-condensed.html'), 'utf8');

/** What unifiedScrape.getMainHtml() did before the fix. */
function plainReadability(html, url) {
  const article = new Readability(new JSDOM(html, { url }).window.document).parse();
  return article ? article.content : null;
}

const ARTICLE_HTML = `<html><head><title>A Normal Article</title></head><body>
  <nav><a href="/">Home</a></nav>
  <article>
    <h1>A Normal Article</h1>
    <p>${'Prose that is long enough for Readability to treat this as the article candidate. '.repeat(8)}</p>
    <p>${'A second paragraph, also comfortably past the character threshold Readability applies. '.repeat(8)}</p>
  </article>
</body></html>`;

/** Same article with a two-column layout table wrapping the prose. */
const LAYOUT_TABLE_HTML = `<html><head><title>Layout Table Article</title></head><body>
  <table><tbody><tr>
    <td><p>${'Prose that is long enough for Readability to treat this as the article candidate. '.repeat(8)}</p></td>
    <td><aside>Sidebar</aside></td>
  </tr></tbody></table>
</body></html>`;

describe('extractMainContent — data tables Readability drops', () => {
  test('the fixture still reproduces the defect: plain Readability keeps no table', () => {
    const content = plainReadability(sp500Html, SP500_URL);
    assert.ok(content, 'Readability should still find an article in the fixture');
    assert.equal((content.match(/<table/g) || []).length, 0, 'plain Readability must drop the table');
    assert.doesNotMatch(content, /\bMMM\b/, 'no constituent ticker survives plain Readability');
  });

  test('re-attaches the dropped constituents table and reports the count', () => {
    const result = extractMainContent(sp500Html, SP500_URL);
    assert.equal(result.tablesRecovered, 1);
    assert.equal((result.html.match(/<tr/g) || []).length, 16, 'header row + the fixture\'s 15 constituent rows');
    assert.match(result.html, /\bMMM\b/, '3M\'s ticker is back in the main content');
    assert.match(result.html, /Abbott/, 'and so is a later row');
  });

  test('returns the article title, which Readability strips out of the content', () => {
    const result = extractMainContent(sp500Html, SP500_URL);
    assert.equal(result.title, 'List of S&P 500 companies');
  });
});

describe('extractMainContent — pages with nothing to recover', () => {
  test('a normal article is byte-identical to plain Readability output', () => {
    const result = extractMainContent(ARTICLE_HTML, 'https://example.com/post');
    assert.equal(result.tablesRecovered, 0);
    assert.equal(result.html, plainReadability(ARTICLE_HTML, 'https://example.com/post'));
  });

  test('a layout table (few rows, few columns) is not re-attached', () => {
    const result = extractMainContent(LAYOUT_TABLE_HTML, 'https://example.com/layout');
    assert.equal(result.tablesRecovered, 0);
  });

  test('a data table Readability kept is not appended a second time', () => {
    const rows = Array.from({ length: 12 }, (_, i) => `<tr><td>Row ${i}</td><td>Value ${i}</td></tr>`).join('');
    const html = `<html><head><title>Kept Table</title></head><body><article>
      <p>${'Enough prose around the table for Readability to select this article. '.repeat(8)}</p>
      <table><tbody>${rows}</tbody></table>
    </article></body></html>`;

    const kept = plainReadability(html, 'https://example.com/kept');
    assert.equal((kept.match(/<table/g) || []).length, 1, 'precondition: Readability kept this table');

    const result = extractMainContent(html, 'https://example.com/kept');
    assert.equal(result.tablesRecovered, 0);
    assert.equal((result.html.match(/<table/g) || []).length, 1);
  });

  test('returns html:null when Readability finds no article, leaving the fallback to the caller', () => {
    const result = extractMainContent('<html><head><title>Empty</title></head><body></body></html>', 'https://example.com/empty');
    assert.equal(result.html, null);
    assert.equal(result.tablesRecovered, 0);
  });
});

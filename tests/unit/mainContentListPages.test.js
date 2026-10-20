/**
 * Live sweep 2026-10-20, Phase 2.1: Readability dropped text from list pages.
 *
 * On quotes.toscrape.com the first quote's author was lost ("…our thinking.”
 * by (about)") in crawl_deep, batch_scrape markdown and scrape_with_actions
 * text. Cause: Readability takes the first `small.author` (itemprop="author",
 * class matching its byline regex) as the article byline and deletes the node.
 * Block scoring keeps all 10 quotes on the saved page; the fallback for a
 * list page whose items were pruned is covered by the isThinMainContent tests.
 *
 * Fixture: tests/fixtures/quotes-toscrape.html, captured live 2026-10-20.
 *
 * Run: node --test --test-force-exit tests/unit/mainContentListPages.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { load } from 'cheerio';

import { extractMainContent, isThinMainContent, keepListItemBylines } from '../../src/tools/scrape/_mainContent.js';
import { BFSCrawler } from '../../src/core/crawlers/BFSCrawler.js';
import { generateFormats } from '../../src/tools/advanced/batchScrape/worker.js';
import { ScrapeWithActionsTool } from '../../src/tools/advanced/ScrapeWithActionsTool.js';

const URL_ = 'https://quotes.toscrape.com/';
const html = readFileSync(new URL('../fixtures/quotes-toscrape.html', import.meta.url), 'utf8');

const AUTHORS = ['Albert Einstein', 'J.K. Rowling', 'Jane Austen', 'Marilyn Monroe', 'André Gide',
  'Thomas A. Edison', 'Eleanor Roosevelt', 'Steve Martin'];

function count(text) {
  return {
    quotes: (text.match(/“/g) || []).length,
    authors: AUTHORS.reduce((n, name) => n + text.split(name).length - 1, 0)
  };
}

describe('quotes.toscrape.com: 10 quotes with 10 authors', () => {
  test('Readability alone still takes the first author as the byline (the protection is needed)', () => {
    const article = new Readability(new JSDOM(html, { url: URL_ }).window.document).parse();
    assert.equal(article.byline, 'Albert Einstein');
    assert.deepEqual(count(article.textContent), { quotes: 10, authors: 9 });
  });

  test('extractMainContent keeps every author', () => {
    const main = extractMainContent(html, URL_);
    assert.deepEqual(count(load(main.html).text()), { quotes: 10, authors: 10 });
    assert.match(load(main.html).text().replace(/\s+/g, ' '), /our thinking\.” by Albert Einstein \(about\)/);
  });

  test('crawl_deep page content', () => {
    const page = new BFSCrawler({}).parsePage(html, URL_);
    assert.deepEqual(count(page.content), { quotes: 10, authors: 10 });
  });

  test('batch_scrape markdown', () => {
    const content = generateFormats(load(html), html, ['markdown'], URL_);
    assert.deepEqual(count(content.markdown), { quotes: 10, authors: 10 });
  });

  test('scrape_with_actions text', async () => {
    const tool = new ScrapeWithActionsTool({ actionExecutor: {}, enableLogging: false });
    const result = await tool.extractFinalContent(
      { url: URL_, formats: ['text', 'markdown'] },
      { finalHtml: html, finalUrl: URL_ }
    );
    assert.deepEqual(count(result.content.text), { quotes: 10, authors: 10 });
    assert.deepEqual(count(result.content.markdown), { quotes: 10, authors: 10 });
  });
});

describe('scrape_with_actions text on a page whose article is not its main content', () => {
  test('is the whole page, as browser_session read returns it, not the <main>-only fallback', async () => {
    const cards = Array.from({ length: 6 }, (_, i) => `<div class="card"><h3>Product ${i}</h3><p>Card ${i} describes a product in a sentence of forty plus characters.</p></div>`).join('');
    const intro = `<p>${'Welcome to the shop, where the intro paragraph is long, dense and full of words, commas, and more words. '.repeat(4)}</p>`;
    const finalHtml = `<html><body><header><a href="/">Shop</a></header><main><h1>Shop</h1>${intro}</main><section>${cards}</section><footer>Footer text</footer></body></html>`;
    const tool = new ScrapeWithActionsTool({ actionExecutor: {}, enableLogging: false });
    const result = await tool.extractFinalContent(
      { url: 'https://example.com/shop', formats: ['text'] },
      { finalHtml, finalUrl: 'https://example.com/shop' }
    );
    assert.equal(result.extractionMethod, 'fallback_boilerplate_removal');
    assert.equal(result.content.textSource, 'body');
    for (let i = 0; i < 6; i++) assert.match(result.content.text, new RegExp(`Product ${i}`));
  });
});

describe('isThinMainContent on a list page', () => {
  test('an article that pruned 3 of 10 items is thin; the full list is not', () => {
    const $ = load(html);
    const $column = $('div.quote').first().parent();
    // What Readability keeps of the column (no tag lists), minus 3 quotes.
    $column.find('.tags').remove();
    $('div.quote').slice(7).remove();
    const pruned = $.html($column);
    const thin = isThinMainContent(pruned, html);
    assert.ok(thin, 'kept 7 of 10 quotes, so the whole page is used');
    // Above the landing-page bar: only the list rule catches it.
    assert.ok(thin.kept / thin.visible >= 0.35 && thin.kept / thin.visible < 0.6);
    assert.equal(isThinMainContent(extractMainContent(html, URL_).html, html), null);
  });

  test('the same share on an article page with a short-item menu is not thin', () => {
    const menu = Array.from({ length: 8 }, (_, i) => `<li class="menu-item"><a href="/${i}">Section ${i}</a></li>`).join('');
    const body = Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i} of an article with enough words to read as real prose for the reader here.</p>`).join('');
    const aside = Array.from({ length: 6 }, (_, i) => `<p>Related reading number ${i}, a teaser line that is long enough to count as text on this page.</p>`).join('');
    const page = `<html><body><ul>${menu}</ul><article>${body}</article><aside>${aside}</aside></body></html>`;
    // Above the landing-page bar (35%), under 60% of the page: thin only on a list page.
    const kept = `<div>${body}</div>`;
    assert.equal(isThinMainContent(kept, page), null);
  });
});

describe('keepListItemBylines', () => {
  test('a real article byline is left for Readability', () => {
    const page = `<html><body><article><h1>Title</h1><p class="byline">By Jane Writer</p>${'<p>Body text of the article, long enough to be scored as content by Readability. </p>'.repeat(10)}</article></body></html>`;
    const dom = new JSDOM(page, { url: 'https://example.com/a' });
    keepListItemBylines(dom.window.document);
    assert.equal(new Readability(dom.window.document).parse().byline, 'By Jane Writer');
  });

  test('author markup inside repeated items is stripped', () => {
    const dom = new JSDOM(html, { url: URL_ });
    keepListItemBylines(dom.window.document);
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('[itemprop="author"], .author').length, 0);
    assert.equal(doc.querySelectorAll('small').length, 10);
  });
});

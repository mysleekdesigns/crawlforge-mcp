/**
 * R24 Phase 3, 3.1 (LIVE_TEST_R24_FIX_PLAN.md): one text flattener.
 *
 * extract_content (content.text), batch_scrape (text and extractionSchema
 * values), crawl_deep (content) and scrape_with_actions (text) joined block
 * elements with no separator — extract_content on paulgraham.com/greatwork.html
 * returned "July 2023If you collected…". Each now reads text through
 * crawlforge-extractors' flattenText, one line per block element.
 *
 * Real modules; batch_scrape against a local HTTP server. ALLOWED_DOMAINS is
 * set before the first transitive import of src/constants/config.js.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/r24p3-text-flatten.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { ExtractContentTool } = await import('../../src/tools/extract/extractContent.js');
const { scrapeUrl } = await import('../../src/tools/advanced/batchScrape/worker.js');
const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');
const { ScrapeWithActionsTool } = await import('../../src/tools/advanced/ScrapeWithActionsTool.js');

const PROSE = 'Ordinary prose that a reader would see on the page. '.repeat(12);

// The shape of paulgraham.com/greatwork.html: a date, then paragraphs split by
// <br><br> inside one <font>, in a table cell.
const ESSAY = `<html><head><title>How to Do Great Work</title></head><body>
<table><tr><td><font size="2" face="verdana">July 2023<br><br>If you collected lists of techniques for doing great work. ${PROSE}<br><br>The following recipe assumes you're very ambitious. ${PROSE}</font></td></tr></table>
</body></html>`;

const ARTICLE = `<html><head><title>Blocks</title></head><body><article>
<h1>Heading one</h1><p>First paragraph. ${PROSE}</p><p>Second paragraph. ${PROSE}</p>
<ul><li>Item one</li><li>Item two</li></ul>
</article></body></html>`;

describe('extract_content content.text', () => {
  const tool = new ExtractContentTool();

  test('<br><br> paragraph breaks are line breaks (the greatwork.html repro)', async () => {
    const result = await tool.execute({ url: 'https://paulgraham.com/greatwork.html', html: ESSAY });
    assert.equal(result.success, true, result.error);
    assert.match(result.content.text, /on the page\.\nThe following recipe/);
  });

  // Readability turns "July 2023<br><br>If you…" into "July 2023<p>If you…</p>";
  // crawlforge-extractors' flattenText breaks the line BEFORE a block too (1.16.0).
  test('the date line is not welded to the first paragraph', async () => {
    const result = await tool.execute({ url: 'https://paulgraham.com/greatwork.html', html: ESSAY });
    assert.match(result.content.text, /^July 2023\nIf you collected/);
  });

  test('headings, paragraphs and list items are one line each', async () => {
    const result = await tool.execute({ url: 'https://example.com/blocks', html: ARTICLE });
    assert.equal(result.success, true, result.error);
    const lines = result.content.text.split('\n');
    assert.ok(lines.some((line) => line.startsWith('First paragraph.')), result.content.text.slice(0, 200));
    assert.ok(lines.some((line) => line.startsWith('Second paragraph.')));
    assert.ok(lines.includes('Item one') && lines.includes('Item two'));
    assert.doesNotMatch(result.content.text, /Item oneItem two/);
  });

  test('the boilerplate-removal fallback is flattened too', async () => {
    const html = '<html><head><title>Bare</title></head><body><main><h2>Title</h2><p>Body text</p></main></body></html>';
    const result = await tool.execute({ url: 'https://example.com/bare', html });
    assert.equal(result.success, true, result.error);
    assert.equal(result.content.text, 'Title\nBody text');
  });
});

const ROUTES = {
  '/page': `<html><head><title>A page</title></head><body>
<h1>Heading</h1><p>Para one</p><p>Para two</p>
<div class="card"><h2>Card title</h2><p>Card body</p></div>
<span class="price">$10</span>
</body></html>`
};

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const body = ROUTES[req.url.split('?')[0]];
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

describe('batch_scrape', () => {
  test('the text format is one line per block', async () => {
    const result = await scrapeUrl({ url: `${baseUrl}/page` }, { formats: ['text'] }, 5000);
    assert.equal(result.success, true, result.error);
    assert.equal(result.content.text, 'Heading\nPara one\nPara two\nCard title\nCard body\n$10');
  });

  test('extractionSchema values keep their block breaks; inline values are unchanged', async () => {
    const result = await scrapeUrl(
      { url: `${baseUrl}/page` },
      { formats: ['text'], extractionSchema: { card: '.card', price: '.price', paras: 'p' } },
      5000
    );
    assert.equal(result.success, true, result.error);
    assert.equal(result.extracted.card, 'Card title\nCard body');
    assert.equal(result.extracted.price, '$10');
    assert.deepEqual(result.extracted.paras, ['Para one', 'Para two', 'Card body']);
  });
});

describe('crawl_deep page content', () => {
  test('main content is one line per block', () => {
    const crawler = new BFSCrawler({ enableLinkAnalysis: false });
    const page = crawler.parsePage(ARTICLE, 'https://example.com/blocks');
    assert.match(page.content, /First paragraph\. [^\n]*\nSecond paragraph\./);
    assert.match(page.content, /\nItem one\nItem two/);
  });

  test('the body fallback is one line per block', () => {
    const crawler = new BFSCrawler({ enableLinkAnalysis: false });
    const page = crawler.parsePage('<html><body><div>Short</div><div>Page</div></body></html>', 'https://example.com/short');
    assert.equal(page.content, 'Short\nPage');
  });
});

describe('scrape_with_actions text', () => {
  const tool = new ScrapeWithActionsTool({ actionExecutor: {}, enableLogging: false });

  test('intermediate states are one line per block', async () => {
    const states = await tool.extractIntermediateStates(
      [{ afterActionIndex: 0, url: 'https://example.com/form', timestamp: 0, html: '<html><body><h2>Done</h2><p>Saved</p></body></html>' }],
      { formats: ['text'] }
    );
    assert.equal(states[0].content.text, 'Done\nSaved');
  });

  test('the body text that replaces a short readable result is one line per block', async () => {
    const finalHtml = '<html><head><title>Form</title></head><body><form><p>Name</p><div>Thanks, your form was sent</div></form><footer><p>Footer</p></footer></body></html>';
    const result = await tool.extractFinalContent(
      { url: 'https://example.com/form', formats: ['text'] },
      { finalHtml, finalUrl: 'https://example.com/form' }
    );
    assert.equal(result.content.textSource, 'body');
    assert.equal(result.content.text, 'Name\nThanks, your form was sent\nFooter');
  });
});

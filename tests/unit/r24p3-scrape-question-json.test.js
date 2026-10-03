/**
 * Live test R24, Phase 3, item 3.3: `scrape`'s question and json formats.
 *
 * - A value printed as a heading is evidence. The webscraper.io test shop
 *   shows a product's price and name as two adjacent <h4>s; neither is a
 *   sentence, so a question about the price came back empty, or with the
 *   "HDD:" and "14 reviews" lines under the name heading, as grounded:true.
 * - An empty answer is not grounded, nor is a model reply that the evidence
 *   does not answer the question.
 * - The json format waits a bounded time for its model and then fails with
 *   an error that says so (a 36,000-character page failed after ~80 s).
 *
 * No LLM runs here: Ollama points at a closed port, and the model-mode and
 * json tests stub the one call they need.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/r24p3-scrape-question-json.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');
const { headingUnits } = await import('../../src/tools/scrape/_highlights.js');
const { segmentUnits } = await import('crawlforge-extractors');

// Condensed from webscraper.io/test-sites/e-commerce/allinone/product/60.
const PRODUCT_PAGE = `<!doctype html><html><head><title>Web Scraper Test Sites</title></head><body>
<h1>Test Sites</h1>
<div class="caption">
<h4 class="price" itemprop="offers"><span itemprop="price">$295.99</span></h4>
<h4 class="title" itemprop="name">Asus VivoBook X441NA-GA190</h4>
<p class="description">Asus VivoBook X441NA-GA190 Chocolate Black, 14", Celeron N3450, 4GB, 128GB SSD, Endless OS, ENG kbd</p>
<p>HDD:</p>
<p>128 256 512 1024</p>
<p>14 reviews</p>
</div></body></html>`;

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PRODUCT_PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const scrape = (tool, formats) =>
  tool.execute({ url: `${baseUrl}/product/60`, formats, onlyMainContent: false, resolveHiddenContent: 'off' });

describe('question: headings are evidence (3.3)', () => {
  test('a price printed as a heading is in the evidence for a question naming the product', async () => {
    const { content } = await scrape(new UnifiedScrapeTool(), [
      'markdown',
      { type: 'question', question: 'What is the price of the Asus VivoBook X441NA-GA190?' }
    ]);
    const { markdown, answer } = content;
    assert.equal(answer.grounded, true);
    const price = answer.evidence.find((unit) => unit.text === '$295.99');
    assert.ok(price, `evidence: ${JSON.stringify(answer.evidence.map((u) => u.text))}`);
    assert.equal(price.kind, 'heading');
    assert.equal(answer.evidence[0].text, 'Asus VivoBook X441NA-GA190', 'the name heading ranks first');
    for (const unit of answer.evidence) {
      assert.equal(markdown.slice(unit.offset, unit.offset + unit.length), unit.text, 'offsets locate the text');
    }
  });

  test('an empty answer is not grounded', async () => {
    const { content, warnings } = await scrape(new UnifiedScrapeTool(), [
      { type: 'question', question: 'zebra giraffe' }
    ]);
    assert.deepEqual(content.answer, { text: '', grounded: false, evidence: [] });
    assert.ok(warnings.some((w) => w.startsWith('question: no sentence, table row or code block matched') && w.endsWith('grounded: false')));
  });

  test('model mode: a reply that the evidence does not answer is empty and not grounded', async () => {
    const tool = new UnifiedScrapeTool();
    tool._complete = async () => ({ text: '"NOT_IN_EVIDENCE."' });
    const { content, warnings } = await scrape(tool, [
      { type: 'question', question: 'What warranty does the Asus VivoBook X441NA-GA190 come with?', mode: 'model' }
    ]);
    assert.equal(content.answer.text, '');
    assert.equal(content.answer.grounded, false);
    assert.ok(content.answer.evidence.length > 0);
    assert.ok(warnings.includes('question: the model found no answer in the evidence; grounded: false'));
  });

  test('model mode: an answer taken from a heading is grounded', async () => {
    const tool = new UnifiedScrapeTool();
    tool._complete = async () => ({ text: '$295.99' });
    const { content } = await scrape(tool, [
      { type: 'question', question: 'What is the price of the Asus VivoBook X441NA-GA190?', mode: 'model' }
    ]);
    assert.deepEqual([content.answer.text, content.answer.grounded], ['$295.99', true]);
  });
});

describe('headingUnits (pure)', () => {
  test('adjacent headings label each other; a unit between headings ends the run', () => {
    const markdown = '# Shop\n\nWelcome.\n\n#### $295.99\n\n#### Asus VivoBook\n\nA laptop.';
    const units = headingUnits(markdown, segmentUnits(markdown));
    assert.deepEqual(units.map(({ text, kind, heading }) => ({ text, kind, heading })), [
      { text: 'Shop', kind: 'heading', heading: null },
      { text: '$295.99', kind: 'heading', heading: 'Asus VivoBook' },
      { text: 'Asus VivoBook', kind: 'heading', heading: '$295.99' }
    ]);
    for (const unit of units) assert.equal(markdown.slice(unit.offset, unit.offset + unit.length), unit.text);
  });

  test('a "#" line inside a fenced code block is not a heading', () => {
    const markdown = 'Run it:\n\n```bash\n# install the client\nnpm i acme\n```\n';
    assert.deepEqual(headingUnits(markdown, segmentUnits(markdown)), []);
  });
});

describe('json: a bounded wait (3.3)', () => {
  test('a model that does not answer in time is a clear json error, not a hung call', async () => {
    const tool = new UnifiedScrapeTool({ jsonTimeoutMs: 50 });
    tool._extractWithLlm = { execute: () => new Promise(() => {}) };
    const started = Date.now();
    const result = await scrape(tool, [{ type: 'json', prompt: 'price', schema: { price: 'string' } }]);
    assert.ok(Date.now() - started < 5000);
    assert.equal(result.success, true);
    assert.match(result.content.json.error, /^extraction did not finish within 0\.05 s on \d+ characters of page text/);
    assert.ok(result.warnings.some((w) => w.startsWith('json: extraction did not finish within')));
  });

  test('a model that answers in time is unaffected', async () => {
    const tool = new UnifiedScrapeTool({ jsonTimeoutMs: 5000 });
    tool._extractWithLlm = { execute: async () => ({ success: true, data: { price: '$295.99' } }) };
    const result = await scrape(tool, [{ type: 'json', prompt: 'price', schema: { price: 'string' } }]);
    assert.deepEqual(result.content.json, { price: '$295.99' });
  });
});

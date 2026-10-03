/**
 * Regressions from the R24 live sweep (LIVE_TEST_R24_FIX_PLAN.md, item 2.10):
 *
 *   batch_scrape     includeFailed:false reported failedUrls: 0 for a batch
 *                    with a failed URL. The flag hides the entries, not the count.
 *   analyze_content  options.includeSentiment — the name the tool description
 *                    uses — was dropped as an unknown key, so false did nothing.
 *   scrape_template  a template id with no url returned the template list.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/r24-dead-flags.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = 'localhost';
const { BatchScrapeTool } = await import('../../src/tools/advanced/batchScrape/index.js');
const { AnalyzeContentTool } = await import('../../src/tools/extract/analyzeContent.js');
const { ScrapeTemplateTool } = await import('../../src/tools/templates/ScrapeTemplateTool.js');

describe('batch_scrape includeFailed', () => {
  let server;
  let okUrl;
  let deadUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Ok</title></head><body><p>Ok page.</p></body></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    okUrl = `http://localhost:${server.address().port}/ok`;
    // A port nothing listens on: the fetch is refused.
    const closed = http.createServer();
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
    deadUrl = `http://localhost:${closed.address().port}/dead`;
    await new Promise((resolve) => closed.close(resolve));
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const run = (includeFailed) => new BatchScrapeTool({ enableJobPersistence: false, enableWebhookNotifications: false })
    .execute({ urls: [okUrl, deadUrl], formats: ['text'], maxRetries: 0, includeFailed });

  test('false hides the failed entry and still counts it', async () => {
    const result = await run(false);
    assert.equal(result.successfulUrls, 1);
    assert.equal(result.failedUrls, 1);
    assert.deepEqual(result.results.map((r) => r.url), [okUrl]);
    assert.equal(result.pagination.totalResults, 1);
  });

  test('true lists the failed entry', async () => {
    const result = await run(true);
    assert.equal(result.failedUrls, 1);
    assert.equal(result.results.length, 2);
  });
});

describe('analyze_content includeSentiment', () => {
  const text = 'CrawlForge is a wonderful web scraping tool for modern developers. It handles JavaScript rendering very well.';
  const tool = new AnalyzeContentTool();

  test('includeSentiment:false leaves sentiment out', async () => {
    const result = await tool.execute({ text, options: { includeSentiment: false } });
    assert.equal(result.success, true);
    assert.equal('sentiment' in result, false);
    assert.ok(result.readability, 'the other analyses still run');
  });

  test('includeSentiment:true and the default both return sentiment', async () => {
    assert.ok((await tool.execute({ text, options: { includeSentiment: true } })).sentiment);
    assert.ok((await tool.execute({ text })).sentiment);
  });

  test('analyzeSentiment wins when both names are passed', async () => {
    const result = await tool.execute({ text, options: { analyzeSentiment: true, includeSentiment: false } });
    assert.ok(result.sentiment);
  });
});

describe('scrape_template without a url', () => {
  const tool = new ScrapeTemplateTool();

  test('an entity template says url is required instead of listing', async () => {
    await assert.rejects(
      () => tool.execute({ template: 'github-repo' }),
      /url is required for template "github-repo"/
    );
  });

  test('a list connector with neither params nor url asks for params', async () => {
    await assert.rejects(() => tool.execute({ template: 'greenhouse-jobs' }), /needs params/);
  });

  test('an entity template given only params still says it is reached by url', async () => {
    await assert.rejects(
      () => tool.execute({ template: 'github-repo', params: { repo: 'a/b' } }),
      /reached by url, not params/
    );
  });

  test('an unknown template id with no url is named as unknown', async () => {
    await assert.rejects(() => tool.execute({ template: 'fakebook' }), /Unknown template "fakebook"/);
  });

  test('template:"list" still lists without a url', async () => {
    const result = await tool.execute({ template: 'list' });
    assert.equal(result.count, result.templates.length);
  });
});

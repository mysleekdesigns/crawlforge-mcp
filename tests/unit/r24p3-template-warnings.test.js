/**
 * R24 Phase 3 item 3.7 — scrape_template.
 *
 *   reddit-thread  a URL naming the wrong subreddit returned the post with
 *                  nothing said. crawlforge-extractors now has the template
 *                  report it through run()'s `warnings`; this tool used to
 *                  REPLACE result.warnings with the robots gate's, so a
 *                  template warning would have been dropped whenever the gate
 *                  had one of its own. Both are kept now.
 *   list           template:"list" showed no connector params. The registry
 *                  publishes them; this tool passes list() through unchanged.
 *
 * The merge test stubs registry.run; the other two read the real registry
 * (crawlforge-extractors 1.16.0 carries the template side of the fix).
 *
 * Run: node --test tests/unit/r24p3-template-warnings.test.js
 */

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
const { ScrapeTemplateTool } = await import('../../src/tools/templates/ScrapeTemplateTool.js');
const { TemplateRegistry } = await import('crawlforge-extractors');
const { _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  _resetRobotsGate();
  _resetHostRateLimiter();
});

// A stand-in template the local server can answer.
const FIXTURE = {
  id: 'fixture-thread',
  name: 'Fixture Thread',
  description: 'A template whose run() reports a warning.',
  targetPattern: /127\.0\.0\.1/,
  extractRaw: () => ({ id: 'abc', subreddit: 'node' })
};

describe('scrape_template keeps the template\'s warnings next to the gate\'s (R24 3.7)', () => {
  test('a template warning survives a robots-override warning', async () => {
    const tool = new ScrapeTemplateTool({ templates: [FIXTURE] });
    // The registry's run() as crawlforge-extractors > 1.15.0 returns it.
    const realRun = tool.registry.run.bind(tool.registry);
    tool.registry.run = async (...args) => ({
      ...(await realRun(...args)),
      warnings: ['The URL names r/python, but post abc is in r/node.']
    });

    const result = await tool.execute({ template: 'fixture-thread', url: `${baseUrl}/r/python/comments/abc`, respect_robots: false });

    assert.equal(result.warnings.length, 2);
    assert.match(result.warnings[0], /r\/python.*r\/node/);
    assert.match(result.warnings[1], /respect_robots was disabled/);
  });

  test('with neither, the result carries no warnings field', async () => {
    const tool = new ScrapeTemplateTool({ templates: [FIXTURE] });
    const result = await tool.execute({ template: 'fixture-thread', url: `${baseUrl}/x` });
    assert.equal('warnings' in result, false);
  });
});

const registry = new TemplateRegistry();

describe('the registry side (crawlforge-extractors 1.16.0)', () => {
  test('template:"list" shows each connector\'s params', async () => {
    const { templates } = await new ScrapeTemplateTool().execute({ template: 'list' });
    const greenhouse = templates.find(t => t.id === 'greenhouse-jobs');
    assert.deepEqual(greenhouse.params.find(p => p.name === 'company')?.required, true);
    assert.equal('params' in templates.find(t => t.id === 'github-repo'), false);
  });

  test('reddit-thread names a wrong subreddit in warnings', async () => {
    const body = JSON.stringify({ data: [{ id: '1w2lsvx', subreddit: 'node', title: 't', permalink: '/r/node/comments/1w2lsvx/t/' }] });
    const result = await registry.run('reddit-thread', body, 'https://www.reddit.com/r/python/comments/1w2lsvx/t/');
    assert.match(result.warnings[0], /r\/python.*r\/node/);
  });
});

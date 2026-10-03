/**
 * generate_llms_txt and robots.txt (R24 3.10).
 * Run: node --test --test-force-exit tests/unit/r24p3-llmstxt-robots.test.js
 *
 * The 2026-10-03 sweep found: lobste.rs, whose robots.txt refuses CrawlForge,
 * was reported as "No robots.txt found"; news.ycombinator.com's llms.txt
 * listed /login and /hide, which its robots.txt disallows; and docs.python.org
 * listed its C API page under Pages and again under APIs.
 *
 * Offline: robots.txt is served by a local server.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { LLMsTxtAnalyzer } = await import('../../src/core/LLMsTxtAnalyzer.js');
const { GenerateLLMsTxtTool } = await import('../../src/tools/llmstxt/generateLLMsTxt.js');

/** Start a server whose /robots.txt answers `robots` (null → 404). */
async function serve(robots) {
  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt' && robots !== null) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(robots);
      return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Home</title></head><body><a href="/docs">Docs</a><a href="/login">Log in</a></body></html>');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const servers = [];
after(() => { for (const s of servers) s.close(); });

describe('robots.txt status', () => {
  let refusing;
  let missing;
  let partial;
  before(async () => {
    refusing = await serve('User-agent: *\nDisallow: /\n');
    missing = await serve(null);
    partial = await serve('User-agent: *\nDisallow: /login\nDisallow: /hide\n');
    servers.push(refusing.server, missing.server, partial.server);
  });

  test('a robots.txt that refuses CrawlForge is "disallowed", not missing', async () => {
    const robots = await new LLMsTxtAnalyzer().fetchRobotsTxt(refusing.base);
    assert.equal(robots.status, 'disallowed');
  });

  test('a 404 robots.txt is "not_found"', async () => {
    const robots = await new LLMsTxtAnalyzer().fetchRobotsTxt(missing.base);
    assert.deepEqual(robots, { status: 'not_found', text: null });
  });

  test('a readable robots.txt is "found" with its text', async () => {
    const robots = await new LLMsTxtAnalyzer().fetchRobotsTxt(partial.base);
    assert.equal(robots.status, 'found');
    assert.match(robots.text, /Disallow: \/login/);
  });

  test('generate_llms_txt names the refusal instead of "No robots.txt found"', async () => {
    const result = await new GenerateLLMsTxtTool().execute({
      url: refusing.base,
      analysisOptions: { maxPages: 10, detectAPIs: false, analyzeContent: false },
      format: 'llms-txt'
    });
    const robotsWarnings = result.warnings.filter((w) => w.type === 'robots').map((w) => w.message);
    assert.equal(robotsWarnings.length, 1, JSON.stringify(robotsWarnings));
    assert.match(robotsWarnings[0], /disallows CrawlForge/);
    assert.ok(!robotsWarnings[0].includes('No robots.txt found'));
  });

  test('a missing robots.txt still reads "No robots.txt found"', () => {
    const warnings = new GenerateLLMsTxtTool().generateWarnings({
      metadata: { baseUrl: missing.base }, structure: {}, robots: { status: 'not_found', text: null }, errors: []
    });
    assert.deepEqual(warnings.map((w) => w.message), ['No robots.txt found. Extra caution recommended.']);
  });

  test('robots-disallowed paths are not listed, and the count is reported', async () => {
    const analyzer = new LLMsTxtAnalyzer({ maxPages: 10 });
    analyzer.analysis.metadata = { baseUrl: partial.base };
    const urls = ['/docs', '/login?goto=news', '/hide?id=1', '/about'].map((p) => partial.base + p);
    analyzer.mapSiteTool.execute = async () => ({ total_urls: urls.length, urls });
    analyzer.crawlDeepTool.execute = async () => ({ pages: [] });

    await analyzer.analyzeSiteStructure(partial.base);

    assert.equal(analyzer.analysis.robots.status, 'found');
    const listed = analyzer.analysis.structure.sitemap;
    assert.ok(listed.includes(`${partial.base}/docs`), listed.join(','));
    assert.ok(!listed.some((u) => u.includes('/login') || u.includes('/hide')), listed.join(','));
    assert.equal(analyzer.analysis.structure.robotsExcluded, 2);

    const warnings = new GenerateLLMsTxtTool().generateWarnings(analyzer.analysis).map((w) => w.message);
    assert.ok(warnings.some((m) => /2 discovered URL\(s\) were left out because robots.txt disallows them/.test(m)), warnings.join(' | '));
  });

  test('respectRobots:false keeps every URL', async () => {
    const analyzer = new LLMsTxtAnalyzer({ respectRobots: false });
    analyzer.analysis.robots = { status: 'found', text: '' };
    const urls = [`${partial.base}/login`, `${partial.base}/docs`];
    assert.deepEqual(await analyzer.filterRobotsAllowed(urls), urls);
  });
});

describe('each URL is listed once', () => {
  test('a page under Pages is not repeated under APIs', () => {
    const doc = 'https://docs.example.org/c-api/index.html';
    const text = new GenerateLLMsTxtTool().generateSpecLLMsTxt({
      metadata: { baseUrl: 'https://docs.example.org' },
      structure: { totalPages: 2, sections: { other: ['https://docs.example.org/', doc] } },
      apis: [{ url: doc, type: 'documentation' }, { url: 'https://docs.example.org/api.json', type: 'JSON API' }],
      contentTypes: {}
    }, {});
    const links = [...text.matchAll(/\]\((.*?)\)/g)].map((m) => m[1]);
    assert.equal(links.filter((l) => l === doc).length, 1, text);
    assert.ok(links.includes('https://docs.example.org/api.json'), text);
  });

  test('the same documentation link found twice on the homepage is listed once', () => {
    const doc = 'https://example.org/developers';
    const text = new GenerateLLMsTxtTool().generateSpecLLMsTxt({
      metadata: { baseUrl: 'https://example.org' },
      structure: { totalPages: 1, sections: { other: ['https://example.org/'] } },
      apis: [{ url: doc, type: 'documentation' }, { url: doc, type: 'documentation' }],
      contentTypes: {}
    }, {});
    assert.equal(text.split(doc).length - 1, 1, text);
  });
});

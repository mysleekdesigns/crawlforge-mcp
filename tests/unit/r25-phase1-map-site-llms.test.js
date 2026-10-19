/**
 * R25 Phase 1 regressions — map_site and generate_llms_txt (2026-10-19).
 * Run: node --test --test-force-exit tests/unit/r25-phase1-map-site-llms.test.js
 *
 * 1.2  map_site collected URLs from the sitemap and the page's links but never
 *      the page itself: example.com (one page, no sitemap, one off-site link)
 *      returned success with 0 URLs and no warning, and generate_llms_txt, which
 *      builds its page list from map_site, analysed 0 pages
 *      ("Analysis Coverage: N/A").
 * 1.8  generate_llms_txt probed and listed API paths as `${url}${path}` with the
 *      URL as typed, so https://httpbin.org/ produced https://httpbin.org//json.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// safeFetch blocks loopback unless ALLOWED_DOMAINS names it, and config.js
// reads it on first import — so it is set before the dynamic imports.
process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;
const { MapSiteTool } = await import('../../src/tools/crawl/mapSite.js');
const { LLMsTxtAnalyzer } = await import('../../src/core/LLMsTxtAnalyzer.js');

describe('R25 1.2 — a one-page site maps to its one page', () => {
  let server;
  let baseUrl;

  before(async () => {
    // example.com's shape: no robots.txt, no sitemap, one link that leaves the site.
    server = http.createServer((req, res) => {
      const path = req.url.split('?')[0];
      if (path === '/' || path === '/only') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Example</h1><a href="https://iana.org/domains/example">More information</a></body></html>');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('map_site returns the start page itself', async () => {
    const tool = new MapSiteTool({ cacheEnabled: false, timeout: 5000 });
    const result = await tool.execute({ url: `${baseUrl}/`, group_by_path: false });
    assert.deepEqual(result.urls, [`${baseUrl}/`]);
    assert.equal(result.total_urls, 1);
    assert.equal(result.warnings, undefined);
  });

  test('a start page below the root is listed too', async () => {
    const tool = new MapSiteTool({ cacheEnabled: false, timeout: 5000 });
    const result = await tool.execute({ url: `${baseUrl}/only`, group_by_path: false });
    assert.deepEqual(result.urls, [`${baseUrl}/only`]);
  });

  test('a map that is still empty says why', async () => {
    const tool = new MapSiteTool({ cacheEnabled: false, timeout: 5000 });
    const result = await tool.execute({
      url: `${baseUrl}/`,
      group_by_path: false,
      domain_filter: { exclude_patterns: ['.*'] }
    });
    assert.equal(result.total_urls, 0);
    assert.match(result.warnings?.[0] ?? '', /No URLs were found/);
  });

  test('generate_llms_txt analyses at least the one page', async () => {
    const analyzer = new LLMsTxtAnalyzer({ maxPages: 10, timeout: 5000 });
    analyzer.crawlDeepTool.execute = async () => ({ pages: [] });
    analyzer.fetchRobotsTxt = async () => ({ status: 'not_found', text: null });
    await analyzer.analyzeSiteStructure(`${baseUrl}/`);
    assert.deepEqual(analyzer.analysis.errors, []);
    assert.equal(analyzer.analysis.structure.totalPages, 1);
    assert.deepEqual(analyzer.analysis.structure.sitemap, [`${baseUrl}/`]);
  });
});

describe('R25 1.2 — prioritizeUrls leads with the site root even when nothing else was found', () => {
  test('an empty candidate list still yields the root', () => {
    const analyzer = new LLMsTxtAnalyzer();
    assert.deepEqual(analyzer.prioritizeUrls([], 'https://example.com', 10), ['https://example.com/']);
  });
});

describe('R25 1.8 — API links are resolved, not concatenated', () => {
  test('https://httpbin.org/ lists https://httpbin.org/json, not //json', async () => {
    const analyzer = new LLMsTxtAnalyzer();
    const requested = [];
    analyzer.fetchWithTimeout = async (url) => {
      requested.push(url);
      if (url === 'https://httpbin.org/json') {
        return { ok: true, status: 200, headers: { get: () => 'application/json' } };
      }
      return { ok: false, status: 404, headers: { get: () => null } };
    };
    await analyzer.detectAPIEndpoints('https://httpbin.org/');
    assert.deepEqual(analyzer.analysis.apis.map((a) => a.url), ['https://httpbin.org/json']);
    const doubled = requested.filter((u) => /^https?:\/\/[^/]+\/\//.test(u));
    assert.deepEqual(doubled, [], 'no probe may carry a double slash');
  });

  test('security probes resolve the same way', async () => {
    const analyzer = new LLMsTxtAnalyzer();
    const requested = [];
    analyzer.fetchWithTimeout = async (url) => {
      requested.push(url);
      return { ok: false, status: 404, headers: { get: () => null } };
    };
    await analyzer.analyzeSecurity('https://httpbin.org/');
    assert.ok(requested.includes('https://httpbin.org/admin'), JSON.stringify(requested));
    assert.deepEqual(requested.filter((u) => /^https?:\/\/[^/]+\/\//.test(u)), []);
  });
});

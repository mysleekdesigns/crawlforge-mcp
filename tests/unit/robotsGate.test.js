/**
 * Unit tests for the shared pre-fetch gate (src/utils/robotsGate.js) as it is
 * wired into the fetching tools.
 *
 * Before Phase 0, RobotsChecker was instantiated in exactly one place
 * (BFSCrawler), so only crawl_deep honoured robots.txt — scrape, batch_scrape,
 * map_site and the basic tools did no check at all. These tests hold every one
 * of those paths to the same rule (0.4), prove the robots.txt behind it is
 * fetched once per host (0.5), and prove that switching the check off is
 * possible, visible in the response and recorded against the API key (0.6).
 *
 * Exercises the REAL tools against a local HTTP server that serves a
 * robots.txt disallowing /private. The gate enforces SSRF protection (blocks
 * loopback by default), so ALLOWED_DOMAINS is set here BEFORE the first
 * transitive import of src/constants/config.js. `node --test` runs each test
 * file in its own subprocess, so this does not leak into sibling files.
 *
 * Run: node --test tests/unit/robotsGate.test.js --test-force-exit
 * (local server .listen() needs the sandbox disabled — see CLAUDE.md)
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');
const { _setBlockedHostsForTests } = await import('../../src/utils/hostBlocklist.js');
const { setComplianceAuditSink, _resetComplianceAudit, apiKeyId } =
  await import('../../src/utils/complianceAudit.js');

const { fetchWithTimeout } = await import('../../src/tools/basic/_fetch.js');
const { fetchAndParse } = await import('../../src/tools/extract/_fetchAndParse.js');
const { scrapeUrlsBatch } = await import('../../src/tools/advanced/batchScrape/queue.js');
const { MapSiteTool } = await import('../../src/tools/crawl/mapSite.js');
const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');
const { fetchUrlHandler } = await import('../../src/tools/basic/fetchUrl.js');
const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');

const ROBOTS_TXT = 'User-agent: *\nDisallow: /private\n';

const PAGES = {
  '/': '<html><head><title>Home</title></head><body><a href="/public">Public</a><a href="/private">Private</a></body></html>',
  '/public': '<html><head><title>Public</title></head><body><p>public page</p></body></html>',
  '/private': '<html><head><title>Private</title></head><body><p>private page</p></body></html>'
};

let server;
let baseUrl;
let robotsRequests = 0;
let seenUserAgents = [];
let auditRows = [];

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    seenUserAgents.push(req.headers['user-agent']);
    if (path === '/robots.txt') {
      robotsRequests++;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(ROBOTS_TXT);
      return;
    }
    const body = PAGES[path];
    if (body) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  setComplianceAuditSink((row) => { auditRows.push(row); });
});

beforeEach(() => {
  // The robots cache is module-level and keyed by origin, so a test that
  // served one set of rules would otherwise decide the next one's outcome.
  // Reset it here and these tests stay order-independent.
  _resetRobotsGate();
  _resetHostRateLimiter();
  seenUserAgents = [];
  auditRows = [];
});

after(async () => {
  _resetComplianceAudit();
  _setBlockedHostsForTests(null);
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// ── 0.4 every fetching path honours robots.txt ──────────────────────────────

describe('robots gate — every fetching tool refuses a disallowed path (0.4)', () => {
  test('basic tools (_fetch.js) refuse /private and allow /public', async () => {
    await assert.rejects(
      () => fetchWithTimeout(`${baseUrl}/private`, { tool: 'fetch_url' }),
      (err) => err.code === 'ROBOTS_DISALLOWED'
    );

    const allowed = await fetchWithTimeout(`${baseUrl}/public`, { tool: 'fetch_url' });
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed._warnings, [], 'an allowed fetch carries no warnings');

    // The gate fails open on a robots.txt it cannot read, so a suite where the
    // fixture never served one would pass while proving nothing. It served one.
    assert.ok(robotsRequests > 0, 'the fixture must actually have been asked for robots.txt');
  });

  test('extract tools (_fetchAndParse.js) refuse /private and allow /public', async () => {
    await assert.rejects(
      () => fetchAndParse(`${baseUrl}/private`, { tool: 'extract_content' }),
      (err) => err.code === 'ROBOTS_DISALLOWED'
    );

    const parsed = await fetchAndParse(`${baseUrl}/public`, { tool: 'extract_content' });
    assert.match(parsed.textContent, /public page/);
    assert.deepEqual(parsed.warnings, [], 'warnings is always present, empty when there are none');
  });

  test('scrape (unifiedScrape) refuses /private and allows /public', async () => {
    const tool = new UnifiedScrapeTool();
    await assert.rejects(
      () => tool.execute({ url: `${baseUrl}/private`, formats: ['text'] }),
      /robots\.txt/
    );

    const result = await tool.execute({ url: `${baseUrl}/public`, formats: ['text'] });
    assert.equal(result.success, true);
    assert.equal(result.warnings, undefined);
  });

  test('map_site refuses /private and allows /public', async () => {
    const tool = new MapSiteTool({ cacheEnabled: false });
    await assert.rejects(
      () => tool.fetchWithTimeout(`${baseUrl}/private`),
      (err) => err.code === 'ROBOTS_DISALLOWED'
    );
    // …and the refusal reaches the caller rather than thinning out the map.
    await assert.rejects(
      () => tool.execute({ url: `${baseUrl}/private`, include_sitemap: false }),
      /robots\.txt/
    );

    const response = await tool.fetchWithTimeout(`${baseUrl}/public`);
    assert.equal(response.status, 200);
  });

  test('batch_scrape fails only the refused URL, and finishes the rest of the batch', async () => {
    const results = await scrapeUrlsBatch(
      [{ url: `${baseUrl}/private`, headers: {} }, { url: `${baseUrl}/public`, headers: {} }],
      { formats: ['text'], maxConcurrency: 2, delayBetweenRequests: 0 },
      5000
    );

    assert.equal(results.length, 2);
    assert.equal(results[0].success, false, 'the disallowed URL fails');
    assert.match(results[0].error, /robots\.txt/);
    assert.equal(results[1].success, true, 'the allowed URL is still scraped');
    assert.match(results[1].content.text, /public page/);
  });

  test('crawl_deep (BFSCrawler) skips a disallowed URL without erroring the crawl', async () => {
    const crawler = new BFSCrawler({
      respectRobots: true,
      enableLinkAnalysis: false,
      concurrency: 1,
      maxDepth: 1,
      maxPages: 10,
      timeout: 5000
    });
    const result = await crawler.crawl(baseUrl);
    crawler.destroy();

    const paths = result.urls.map((u) => new URL(u).pathname).sort();
    assert.deepEqual(paths, ['/', '/public'], '/private must not be crawled');
    assert.equal(result.errors.length, 0);
  });

  test('crawl_deep (BFSCrawler) reports a robots-refused SEED in errors instead of an empty crawl', async () => {
    const crawler = new BFSCrawler({
      respectRobots: true,
      enableLinkAnalysis: false,
      concurrency: 1,
      maxDepth: 1,
      maxPages: 10,
      timeout: 5000
    });
    const result = await crawler.crawl(`${baseUrl}/private`);
    crawler.destroy();

    assert.equal(result.urls.length, 0, 'nothing is fetched');
    assert.equal(result.errors.length, 1, 'the refusal is reported once, for the seed');
    assert.equal(result.errors[0].code, 'ROBOTS_DISALLOWED');
    assert.match(result.errors[0].error, /robots\.txt on .* disallows this path for CrawlForge/);
    assert.equal(new URL(result.errors[0].url).pathname, '/private');
  });
});

// ── 0.5 one robots.txt fetch per host ───────────────────────────────────────

describe('robots gate — robots.txt is fetched once per host (0.5)', () => {
  test('concurrent and sequential requests to one host share a single robots.txt fetch', async () => {
    _resetRobotsGate();
    robotsRequests = 0;

    await Promise.all(
      Array.from({ length: 5 }, () => fetchWithTimeout(`${baseUrl}/public`, { tool: 'fetch_url' }))
    );
    await fetchWithTimeout(`${baseUrl}/public`, { tool: 'fetch_url' });
    await fetchAndParse(`${baseUrl}/public`, { tool: 'extract_content' });
    await new MapSiteTool({ cacheEnabled: false }).fetchWithTimeout(`${baseUrl}/public`);

    assert.equal(robotsRequests, 1, `expected exactly one robots.txt fetch, saw ${robotsRequests}`);
  });
});

// ── 0.6 the override is accepted, visible and recorded ──────────────────────

describe('robots gate — respect_robots:false is explicit, warned and audited (0.6)', () => {
  test('the fetch goes through, and the response carries the warning', async () => {
    const response = await fetchWithTimeout(`${baseUrl}/private`, {
      tool: 'fetch_url',
      respectRobots: false
    });

    assert.equal(response.status, 200);
    assert.equal(response._warnings.length, 1);
    assert.match(response._warnings[0], /respect_robots was disabled/);
  });

  test('scrape surfaces the warning in its own warnings[]', async () => {
    const result = await new UnifiedScrapeTool().execute({
      url: `${baseUrl}/private`,
      formats: ['text'],
      respect_robots: false
    });

    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.warnings));
    assert.ok(
      result.warnings.some((w) => /respect_robots was disabled/.test(w)),
      `expected the override warning in ${JSON.stringify(result.warnings)}`
    );
  });

  test('an audit row records the API key, URL and time of the override', async () => {
    const url = `${baseUrl}/private`;
    await fetchWithTimeout(url, { tool: 'fetch_url', respectRobots: false, apiKey: 'cf_live_test_key' });

    const row = auditRows.find((r) => r.event === 'robots_override' && r.url === url);
    assert.ok(row, `no audit row written; saw ${JSON.stringify(auditRows)}`);
    assert.equal(row.tool, 'fetch_url');
    assert.equal(row.apiKeyId, apiKeyId('cf_live_test_key'));
    assert.ok(!JSON.stringify(row).includes('cf_live_test_key'), 'the raw API key must never be stored');
    assert.ok(!Number.isNaN(Date.parse(row.timestamp)), 'row carries a parseable timestamp');
  });

  test('a blocked host is refused, and respect_robots:false cannot override it', async () => {
    _setBlockedHostsForTests(['127.0.0.1']);
    try {
      await assert.rejects(
        () => fetchWithTimeout(`${baseUrl}/public`, { tool: 'fetch_url' }),
        (err) => err.code === 'HOST_BLOCKED'
      );
      await assert.rejects(
        () => fetchWithTimeout(`${baseUrl}/public`, { tool: 'fetch_url', respectRobots: false }),
        (err) => err.code === 'HOST_BLOCKED'
      );
      await assert.rejects(
        () => fetchAndParse(`${baseUrl}/public`, { tool: 'extract_content', respectRobots: false }),
        (err) => err.code === 'HOST_BLOCKED'
      );
    } finally {
      _setBlockedHostsForTests(null);
    }
  });
});

// ── the tool-facing (snake_case) parameters reach the gate ──────────────────

describe('robots gate — snake_case tool params reach the internal options', () => {
  test('fetch_url: user_agent is what the target actually sees', async () => {
    const result = await fetchUrlHandler({
      url: `${baseUrl}/public`,
      user_agent: 'AcmeBot/9.9 (+https://acme.example)'
    });

    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    assert.ok(
      seenUserAgents.includes('AcmeBot/9.9 (+https://acme.example)'),
      `the override never reached the wire; saw ${JSON.stringify(seenUserAgents)}`
    );
  });

  test('scrape: user_agent and respect_robots are honoured together', async () => {
    const result = await new UnifiedScrapeTool().execute({
      url: `${baseUrl}/private`,
      formats: ['text'],
      user_agent: 'AcmeBot/9.9 (+https://acme.example)',
      respect_robots: false
    });

    assert.equal(result.success, true);
    assert.ok(seenUserAgents.includes('AcmeBot/9.9 (+https://acme.example)'));
    assert.ok(result.warnings.some((w) => /respect_robots was disabled/.test(w)));
  });

  test('map_site: respect_robots:false maps a URL it would otherwise refuse', async () => {
    const tool = new MapSiteTool({ cacheEnabled: false });
    const result = await tool.execute({
      url: `${baseUrl}/private`,
      include_sitemap: false,
      respect_robots: false
    });

    // The same call without the flag rejects (asserted above); this one runs.
    assert.equal(result.base_url, baseUrl);
  });
});

// ── a host that never finishes serving robots.txt ───────────────────────────

describe('robots gate — a trickling robots.txt is bounded, not a hang', () => {
  /**
   * RobotsChecker used to clear its abort timer when the robots.txt *headers*
   * arrived, before reading the body, so a host that wrote headers and then
   * dripped forever pinned every fetching tool aimed at it — indefinitely,
   * not slowly (reproduced at 12s and still going). The timer now stays armed
   * through the body read, so the gate fails open at its own 5s budget.
   */
  let trickleServer;
  let trickleUrl;

  before(async () => {
    trickleServer = http.createServer((req, res) => {
      if (req.url.split('?')[0] === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.write('User-agent: *\n');
        return; // never res.end() — the body just hangs
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><p>page behind a wedged robots.txt</p></body></html>');
    });
    await new Promise((resolve) => trickleServer.listen(0, '127.0.0.1', resolve));
    trickleUrl = `http://127.0.0.1:${trickleServer.address().port}`;
  });

  after(async () => {
    trickleServer.closeAllConnections?.();
    await new Promise((resolve) => trickleServer.close(resolve));
  });

  test('the fetch completes at the gate budget, and the host is not re-raced after', async () => {
    _resetRobotsGate();

    const firstStart = Date.now();
    const first = await fetchWithTimeout(`${trickleUrl}/page`, { tool: 'fetch_url' });
    const firstElapsed = Date.now() - firstStart;

    assert.equal(first.status, 200, 'an unreadable robots.txt fails open, it does not block the fetch');
    assert.ok(firstElapsed >= 4500, `expected the gate to spend its budget, took ${firstElapsed}ms`);
    assert.ok(firstElapsed < 9000, `expected the gate to be bounded, took ${firstElapsed}ms`);

    // The wedged host is cached as "no rules" for the TTL: the second request
    // must not pay the budget again (and must not leak an in-flight entry).
    const secondStart = Date.now();
    const second = await fetchWithTimeout(`${trickleUrl}/page`, { tool: 'fetch_url' });
    const secondElapsed = Date.now() - secondStart;

    assert.equal(second.status, 200);
    assert.ok(secondElapsed < 1000, `expected the second request to be served from cache, took ${secondElapsed}ms`);
  });
});

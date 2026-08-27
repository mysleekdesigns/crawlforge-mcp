/**
 * Unit tests for the Phase 1 stealth changes.
 *
 * Two things are held in place here:
 *
 * 1.3 — the browser paths go through the same robots gate as every HTTP fetch,
 *   and they match robots.txt as the canonical CrawlForge product token rather
 *   than the randomized UA the browser presents. A site that disallows
 *   CrawlForge but allows ordinary browsers must still be refused: matching on
 *   the disguise would let stealth traffic walk past our own robots rules.
 *
 * 1.7 — stealth_mode is priced per operation. The published flat price (5) is
 *   the ceiling: browser work costs 5, the bookkeeping operations that launch
 *   nothing cost 1, so create_context → create_page → cleanup is 11 rather than
 *   15 credits for one page.
 *
 * Like tests/unit/robotsGate.test.js this runs a real HTTP server on loopback,
 * which the SSRF guard blocks by default — ALLOWED_DOMAINS is set before the
 * first transitive import of src/constants/config.js. `node --test` gives each
 * file its own subprocess, so it does not leak into sibling tests.
 *
 * Run: node --test --test-force-exit tests/unit/stealthScrape.test.js
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { robotsPreflight, _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');
const { CRAWLFORGE_USER_AGENT } = await import('../../src/utils/fetchIdentity.js');
const { makeWithAuth } = await import('../../src/server/withAuth.js');
const authManager = (await import('../../src/core/AuthManager.js')).default;

// Allows every ordinary browser, singles out CrawlForge. Only a gate that
// matches as the product token sees the Disallow.
const ROBOTS_TXT = [
  'User-agent: CrawlForge',
  'Disallow: /',
  '',
  'User-agent: *',
  'Allow: /',
  ''
].join('\n');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

let server;
let baseUrl;
let robotsUserAgents = [];

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/robots.txt') {
      robotsUserAgents.push(req.headers['user-agent']);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(ROBOTS_TXT);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>page</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  _resetRobotsGate();
  _resetHostRateLimiter();
  robotsUserAgents = [];
});

describe('1.3 — the stealth browser paths honour robots.txt as CrawlForge', () => {
  test('a page disallowed for CrawlForge is refused, whatever the browser would present', async () => {
    const decision = await robotsPreflight(`${baseUrl}/anything`, { tool: 'stealth_mode' });

    assert.equal(decision.allowed, false, 'the gate must refuse a CrawlForge-disallowed path');
    assert.equal(decision.userAgent, CRAWLFORGE_USER_AGENT);
    assert.deepEqual(robotsUserAgents, [CRAWLFORGE_USER_AGENT], 'robots.txt fetched as the product token');
  });

  test('matching on the browser disguise instead would have let it through', async () => {
    // Not how the tool calls it — this is the hole the deliberate "no userAgent
    // override on the browser path" design closes.
    const asBrowser = await robotsPreflight(`${baseUrl}/anything`, {
      tool: 'stealth_mode',
      userAgent: CHROME_UA
    });

    assert.equal(asBrowser.allowed, true, 'a Chrome UA matches the permissive wildcard group');
  });

  test('the override is still available, explicit and warned about', async () => {
    const decision = await robotsPreflight(`${baseUrl}/anything`, {
      tool: 'stealth_mode',
      respectRobots: false
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.overridden, true);
    assert.equal(decision.warnings.length, 1);
    assert.match(decision.warnings[0], /recorded against your API key/);
  });
});

describe('1.7 — stealth_mode is priced per operation', () => {
  test('browser work costs 5, bookkeeping costs 1, unknown falls back to the published 5', () => {
    for (const operation of ['scrape', 'create_context', 'create_page']) {
      assert.equal(authManager.getToolCost('stealth_mode', { operation }), 5, `${operation} costs 5`);
    }
    for (const operation of ['configure', 'enable', 'disable', 'get_stats', 'cleanup']) {
      assert.equal(authManager.getToolCost('stealth_mode', { operation }), 1, `${operation} costs 1`);
    }
    // No operation, or one this table has never heard of, pays the published
    // flat price — never more.
    assert.equal(authManager.getToolCost('stealth_mode'), 5);
    assert.equal(authManager.getToolCost('stealth_mode', {}), 5);
    assert.equal(authManager.getToolCost('stealth_mode', { operation: 'something_new' }), 5);
  });

  test('a one-page stealth session costs 11 credits, not 15', () => {
    const session = ['create_context', 'create_page', 'cleanup']
      .reduce((total, operation) => total + authManager.getToolCost('stealth_mode', { operation }), 0);
    assert.equal(session, 11);
  });

  test('no other tool changed price', () => {
    assert.equal(authManager.getToolCost('scrape', { operation: 'cleanup' }), 2);
    assert.equal(authManager.getToolCost('scrape_with_actions', { operation: 'cleanup' }), 5);
    assert.equal(authManager.getToolCost('fetch_url', { operation: 'cleanup' }), 1);
    assert.equal(authManager.getToolCost('deep_research', { operation: 'cleanup' }), 10);
  });

  test('withAuth charges once, at the operation price', async () => {
    const logs = [];
    const reported = [];
    const fakeAuth = {
      isCreatorMode: () => false,
      getToolCost: (tool, params) => authManager.getToolCost(tool, params),
      projectCost: (tool, params) => ({ projected: authManager.getToolCost(tool, params), note: 'test' }),
      checkCredits: async () => true,
      creditCache: new Map(),
      reportUsage: async (...args) => { reported.push(args); }
    };
    const withAuth = makeWithAuth({
      authManager: fakeAuth,
      logger: { info: (m, c) => logs.push(c), warn() {}, error() {}, debug() {} }
    });
    const handler = withAuth('stealth_mode', async () => ({
      content: [{ type: 'text', text: '{"ok":true}' }]
    }));

    await handler({ operation: 'scrape', url: 'https://example.com' });
    assert.equal(reported.length, 1, 'one charge for one scrape');
    assert.equal(reported[0][1], 5, 'scrape charged 5 credits');
    assert.equal(logs[0].creditCost, 5);

    await handler({ operation: 'cleanup' });
    assert.equal(reported.length, 2);
    assert.equal(reported[1][1], 1, 'cleanup charged 1 credit');
    assert.equal(logs[1].creditCost, 1);
  });
});

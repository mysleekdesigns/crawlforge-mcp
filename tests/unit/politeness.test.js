/**
 * Unit tests for the politeness signals a host sends us (0.7).
 *
 * Two of them are the site telling us, in its own words, how fast it is
 * willing to be crawled: robots.txt `Crawl-delay`, and `Retry-After` on a 429
 * or 503. Before Phase 0 both were ignored — a 429 was retried straight back
 * into the wall, and Crawl-delay was parsed nowhere. These tests hold the
 * fetch helpers to both.
 *
 * Exercises the REAL helpers against local HTTP servers. The fetch path
 * enforces SSRF protection (blocks loopback by default), so ALLOWED_DOMAINS is
 * set BEFORE the first transitive import of src/constants/config.js.
 *
 * Note the per-host state is keyed by hostname, not host:port — every fixture
 * server here is 127.0.0.1, so each test resets the limiter rather than
 * inheriting the previous test's backoff.
 *
 * Run: node --test tests/unit/politeness.test.js --test-force-exit
 * (local server .listen() needs the sandbox disabled — see CLAUDE.md)
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { parseRetryAfter, getHostBackoffMs, throttleHost, _resetHostRateLimiter } =
  await import('../../src/utils/hostRateLimiter.js');
const { _resetRobotsGate, redirectGate } = await import('../../src/utils/robotsGate.js');
const { fetchWithTimeout } = await import('../../src/tools/basic/_fetch.js');
const { fetchUrl } = await import('../../src/tools/advanced/batchScrape/worker.js');

/** Serves 429/503 with a Retry-After, and a plain page. No robots.txt. */
let backoffServer;
let backoffUrl;

/** Serves a robots.txt asking for a 1s Crawl-delay, and two redirects. */
let delayServer;
let delayUrl;
/** When each page request reached delayServer, by path. */
let delayHits = {};

before(async () => {
  backoffServer = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/429') {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '2' });
      res.end('slow down');
      return;
    }
    if (path === '/503') {
      res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '1' });
      res.end('unavailable');
      return;
    }
    if (path === '/robots.txt') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><p>ok</p></body></html>');
  });
  await new Promise((resolve) => backoffServer.listen(0, '127.0.0.1', resolve));
  backoffUrl = `http://127.0.0.1:${backoffServer.address().port}`;

  delayServer = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nCrawl-delay: 1\n');
      return;
    }
    delayHits[path] = Date.now();
    if (path === '/moved' || path === '/moved-to-stalled') {
      res.writeHead(301, { Location: path === '/moved' ? '/landed' : '/stalled' });
      res.end();
      return;
    }
    if (path === '/stalled') return; // never answers
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><p>ok</p></body></html>');
  });
  await new Promise((resolve) => delayServer.listen(0, '127.0.0.1', resolve));
  delayUrl = `http://127.0.0.1:${delayServer.address().port}`;
});

beforeEach(() => {
  _resetHostRateLimiter();
  delayHits = {};
});

after(async () => {
  for (const server of [backoffServer, delayServer]) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

describe('parseRetryAfter', () => {
  test('delta-seconds become milliseconds', () => {
    assert.equal(parseRetryAfter('2'), 2000);
    assert.equal(parseRetryAfter('0'), 0);
  });

  test('an HTTP-date is parsed relative to now', () => {
    const now = Date.now();
    const ms = parseRetryAfter(new Date(now + 3000).toUTCString(), now);
    // toUTCString() truncates to whole seconds, so this lands in (2s, 3s].
    assert.ok(ms > 1900 && ms <= 3000, `expected ~3000ms, got ${ms}`);
  });

  test('a past HTTP-date, junk, or an absent header means no backoff', () => {
    const now = Date.now();
    assert.equal(parseRetryAfter(new Date(now - 5000).toUTCString(), now), 0);
    assert.equal(parseRetryAfter('soon'), 0);
    assert.equal(parseRetryAfter(''), 0);
    assert.equal(parseRetryAfter(null), 0);
    assert.equal(parseRetryAfter(undefined), 0);
  });
});

describe('Retry-After is recorded and honoured (0.7)', () => {
  test('_fetch.js: a 429 with Retry-After: 2 backs the host off for ~2s', async () => {
    const url = `${backoffUrl}/429`;
    const response = await fetchWithTimeout(url, { tool: 'fetch_url' });
    assert.equal(response.status, 429);

    const backoff = getHostBackoffMs(url);
    assert.ok(backoff > 1500 && backoff <= 2000, `expected a ~2000ms backoff, got ${backoff}`);

    // …and the next request to that host actually waits it out.
    const start = Date.now();
    await throttleHost(url);
    const waited = Date.now() - start;
    assert.ok(waited >= 1500, `expected the next request to wait out the backoff, waited ${waited}ms`);
  });

  test('batchScrape/worker.js: a 503 with Retry-After: 1 backs the host off too', async () => {
    const url = `${backoffUrl}/503`;
    const { response } = await fetchUrl(url, { timeout: 5000 });
    assert.equal(response.status, 503);

    const backoff = getHostBackoffMs(url);
    assert.ok(backoff > 500 && backoff <= 1000, `expected a ~1000ms backoff, got ${backoff}`);
  });
});

describe('robots.txt Crawl-delay is honoured (0.7)', () => {
  test('two sequential fetches to a Crawl-delay: 1 host are at least 1s apart', async () => {
    _resetRobotsGate(); // so the Crawl-delay is read from this fixture's robots.txt

    await fetchWithTimeout(`${delayUrl}/a`, { tool: 'fetch_url' });
    const afterFirst = Date.now();
    await fetchWithTimeout(`${delayUrl}/b`, { tool: 'fetch_url' });
    const gap = Date.now() - afterFirst;

    assert.ok(gap >= 950, `expected a >=1s gap between fetches, got ${gap}ms`);
  });
});

describe('concurrent requests to one Crawl-delay host queue, one delay apart', () => {
  test('three callers at once start a delay apart, not two of them together', async () => {
    // Each caller read lastRequestAt, slept, and only then recorded its own
    // request, so every caller that arrived during one wait woke together.
    _resetHostRateLimiter();
    const url = 'https://queue.example/page';
    await throttleHost(url, { crawlDelayMs: 300 }); // the host was just requested
    const started = [];
    await Promise.all([1, 2, 3].map(async () => {
      await throttleHost(url, { crawlDelayMs: 300 });
      started.push(Date.now());
    }));
    started.sort((a, b) => a - b);
    for (let i = 1; i < started.length; i++) {
      const gap = started[i] - started[i - 1];
      assert.ok(gap >= 280, `expected callers >=300ms apart, got ${gap}ms`);
    }
  });
});

describe('a redirect hop waits out Crawl-delay like any other request', () => {
  beforeEach(() => _resetRobotsGate());

  test('the hop is sent a delay after the request that redirected, and the wait is not charged to the timeout', async () => {
    // The wait alone is twice the timeout: charged to it, the fetch would fail.
    const response = await fetchWithTimeout(`${delayUrl}/moved`, { tool: 'fetch_url', timeout: 500 });

    assert.equal(response.status, 200);
    assert.equal(response.redirected, true);
    const gap = delayHits['/landed'] - delayHits['/moved'];
    assert.ok(gap >= 950, `expected the hop >=1s after the first request, got ${gap}ms`);
  });

  test('a hop that does not answer still times out, once the wait is over', async () => {
    const started = Date.now();

    await assert.rejects(
      () => fetchWithTimeout(`${delayUrl}/moved-to-stalled`, { tool: 'fetch_url', timeout: 500 }),
      /Request timeout after 500ms/
    );

    assert.ok(delayHits['/stalled'], 'the hop was sent');
    const took = Date.now() - started;
    assert.ok(took >= 1400 && took < 3000, `expected the delay plus the timeout, took ${took}ms`);
  });

  test('a hop a browser has already made is decided on but not slept for', async () => {
    const to = `${delayUrl}/landed`;
    await throttleHost(to, { crawlDelayMs: 1000 }); // the host was just requested

    const started = Date.now();
    await redirectGate(`${delayUrl}/moved`, { tool: 'stealth_mode' })(to, { alreadyRequested: true });

    const took = Date.now() - started;
    assert.ok(took < 500, `expected no Crawl-delay wait, took ${took}ms`);
  });
});

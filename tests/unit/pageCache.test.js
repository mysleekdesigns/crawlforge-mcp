/**
 * REPEAT_CALL_REDUCTION_PLAN Phase 1: the process page cache under the two
 * fetch seams (src/core/pageCache.js, fetchWithTimeout, fetchAndParse) and
 * what withAuth does with it.
 *
 *   1.2 key: other formats/strip tags hit; another header, user agent or
 *       respect_robots misses; a fetch_url copy of an HTML page serves scrape
 *   1.3 never cached: non-2xx, walls, no-store, credential headers; a hit
 *       still asks the blocklist
 *   1.4 five concurrent fetches make one request; a failed one stores nothing
 *   1.6 `cache` block, hit line, log field
 *   1.7 a hit costs 1 credit, a miss full price
 *   D2  maxAge 0 fetches fresh and stores; a copy older than maxAge misses
 *   D3  off in HTTP mode and for internal requests
 *   soak: 1,000 distinct 1 MB pages stay within the byte cap
 *
 * Pages are served over loopback, so ALLOWED_DOMAINS is set before the first
 * transitive import (same setup as robotsGate.test.js).
 *
 * Run: node --test --test-force-exit tests/unit/pageCache.test.js
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { fetchWithTimeout } = await import('../../src/tools/basic/_fetch.js');
const { fetchAndParse } = await import('../../src/tools/extract/_fetchAndParse.js');
const {
  _resetPageCache, pageCacheBytes, pageCacheKey, throughPageCache
} = await import('../../src/core/pageCache.js');
const { requestContext, pageCacheSummary } = await import('../../src/server/requestContext.js');
const { makeWithAuth } = await import('../../src/server/withAuth.js');
const { _setBlockedHostsForTests } = await import('../../src/utils/hostBlocklist.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');

const HTML = '<html><head><title>Page</title></head><body><h1>Hello</h1><p>Some real content here.</p></body></html>';
const WALL = '<html><head><title>Just a moment...</title></head><body><div id="cf-wrapper">Checking your browser before accessing. Enable JavaScript and cookies to continue.</div><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>';

let server;
let base;
const hits = new Map(); // path -> request count
let version = 0;

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path === '/robots.txt') return res.writeHead(404).end();
    if (path === '/slow') {
      return setTimeout(() => res.writeHead(200, { 'Content-Type': 'text/html' }).end(HTML), 100);
    }
    if (path === '/broken') return setTimeout(() => req.socket.destroy(), 50);
    if (path === '/missing') return res.writeHead(404, { 'Content-Type': 'text/html' }).end('<html><body>nope</body></html>');
    if (path === '/forbidden') return res.writeHead(403, { 'Content-Type': 'text/html' }).end('<html><body>Access denied</body></html>');
    if (path === '/wall') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(WALL);
    if (path === '/nostore') return res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(HTML);
    if (path === '/json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"a":1}');
    if (path === '/versioned') {
      version += 1;
      return res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<html><body><p>version ${version}</p></body></html>`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(HTML);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  _resetPageCache();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  _resetPageCache({ enabled: true });
  _resetHostRateLimiter();
  hits.clear();
  version = 0;
});

const count = (path) => hits.get(path) ?? 0;
/** Run fn in a fresh invocation store, as withAuth does; returns [result, summary]. */
async function inCall(fn) {
  return requestContext.run({ pageCache: null }, async () => {
    const result = await fn();
    return [result, pageCacheSummary()];
  });
}

// ─── 1.2 key ────────────────────────────────────────────────────────────────

test('key: fragment, host case and default port do not change the key', () => {
  const k = pageCacheKey('https://example.com/a?x=1', {}, 'plain');
  assert.equal(pageCacheKey('HTTPS://EXAMPLE.com:443/a?x=1#top', {}, 'plain'), k);
});

test('key: a header, user agent, respect_robots, API key or seam changes the key', () => {
  const url = 'https://example.com/a';
  const k = pageCacheKey(url, {}, 'plain');
  assert.notEqual(pageCacheKey(url, { headers: { 'X-Test': '1' } }, 'plain'), k);
  assert.notEqual(pageCacheKey(url, { userAgent: 'Other/1.0' }, 'plain'), k);
  assert.notEqual(pageCacheKey(url, { respectRobots: false }, 'plain'), k);
  assert.notEqual(pageCacheKey(url, { apiKey: 'cf_live_x' }, 'plain'), k);
  assert.notEqual(pageCacheKey(url, {}, 'html'), k);
  // Header names are case-insensitive; order does not matter.
  assert.equal(
    pageCacheKey(url, { headers: { 'X-A': '1', 'x-b': '2' } }, 'plain'),
    pageCacheKey(url, { headers: { 'X-B': '2', 'x-a': '1' } }, 'plain')
  );
});

test('key: options that only shape the output are not part of it', () => {
  const url = 'https://example.com/a';
  assert.equal(
    pageCacheKey(url, { formats: ['links'], path: 'a.b', selectors: { t: 'h1' }, max_inline_chars: 10, onlyMainContent: false, timeout: 1, tool: 'x', maxAge: 5 }, 'plain'),
    pageCacheKey(url, {}, 'plain')
  );
});

test('key: credential headers, non-GET and non-URLs are never cached', () => {
  assert.equal(pageCacheKey('https://example.com/', { headers: { Authorization: 'Bearer x' } }, 'plain'), null);
  assert.equal(pageCacheKey('https://example.com/', { headers: { cookie: 'a=b' } }, 'plain'), null);
  assert.equal(pageCacheKey('https://example.com/', { method: 'POST' }, 'plain'), null);
  assert.equal(pageCacheKey('not a url', {}, 'plain'), null);
});

test('hit: the same page asked again with other parse options is one request', async () => {
  const [, first] = await inCall(() => fetchAndParse(`${base}/page`, { stripTags: ['script'] }));
  const [parsed, second] = await inCall(() => fetchAndParse(`${base}/page#x`, { stripTags: [] }));
  assert.equal(count('/page'), 1);
  assert.equal(first.state, 'miss');
  assert.equal(second.state, 'hit');
  assert.equal(parsed.status, 200);
  assert.match(parsed.textContent, /Hello/);
  assert.equal(parsed.$('h1').text(), 'Hello');
});

test('hit: each call gets its own cheerio document', async () => {
  const a = await fetchAndParse(`${base}/page`);
  a.$('h1').remove();
  const b = await fetchAndParse(`${base}/page`);
  assert.equal(b.$('h1').text(), 'Hello');
  assert.equal(count('/page'), 1);
});

test('hit: fetchWithTimeout returns the same fields from a copy', async () => {
  const fresh = await fetchWithTimeout(`${base}/page`);
  const [copy, summary] = await inCall(() => fetchWithTimeout(`${base}/page`));
  assert.equal(count('/page'), 1);
  assert.equal(summary.state, 'hit');
  for (const field of ['ok', 'status', 'statusText', 'url', 'redirected', '_body', '_responseTime']) {
    assert.deepEqual(copy[field], fresh[field], field);
  }
  assert.equal(copy.headers.get('content-type'), 'text/html');
  assert.equal(await copy.text(), HTML);
  assert.deepEqual(copy._warnings, []);
});

test('miss: another user agent, header or respect_robots is a new request', async () => {
  await fetchWithTimeout(`${base}/page`);
  await fetchWithTimeout(`${base}/page`, { userAgent: 'Other/1.0' });
  await fetchWithTimeout(`${base}/page`, { headers: { 'X-Test': '1' } });
  await fetchWithTimeout(`${base}/page`, { respectRobots: false });
  assert.equal(count('/page'), 4);
});

test('cross-seam: a fetch_url copy of an HTML page serves fetchAndParse, not the reverse', async () => {
  await fetchWithTimeout(`${base}/page`);
  const [, summary] = await inCall(() => fetchAndParse(`${base}/page`));
  assert.equal(summary.state, 'hit');
  assert.equal(count('/page'), 1);

  await fetchAndParse(`${base}/other`);
  await fetchWithTimeout(`${base}/other`);
  assert.equal(count('/other'), 2);
});

test('cross-seam: a fetch_url copy of JSON does not serve fetchAndParse', async () => {
  await fetchWithTimeout(`${base}/json`);
  await fetchAndParse(`${base}/json`);
  assert.equal(count('/json'), 2);
});

// ─── 1.3 never cached ───────────────────────────────────────────────────────

test('never cached: non-2xx', async () => {
  await fetchWithTimeout(`${base}/missing`);
  const [res, summary] = await inCall(() => fetchWithTimeout(`${base}/missing`));
  assert.equal(res.status, 404);
  assert.equal(summary.state, 'miss');
  assert.equal(count('/missing'), 2);
});

test('never cached: an error document fetchAndParse returns', async () => {
  await fetchAndParse(`${base}/forbidden`, { errorDocuments: true });
  const again = await fetchAndParse(`${base}/forbidden`, { errorDocuments: true });
  assert.equal(again.status, 403);
  assert.equal(count('/forbidden'), 2);
});

test('never cached: a challenge page served as 200', async () => {
  await fetchWithTimeout(`${base}/wall`);
  await fetchWithTimeout(`${base}/wall`);
  assert.equal(count('/wall'), 2);
});

test('never cached: Cache-Control no-store', async () => {
  await fetchWithTimeout(`${base}/nostore`);
  await fetchWithTimeout(`${base}/nostore`);
  assert.equal(count('/nostore'), 2);
});

test('never cached: a request carrying Cookie or Authorization is a bypass', async () => {
  const [, summary] = await inCall(() => fetchWithTimeout(`${base}/page`, { headers: { Cookie: 'a=b' } }));
  await fetchWithTimeout(`${base}/page`, { headers: { Cookie: 'a=b' } });
  await fetchWithTimeout(`${base}/page`, { headers: { Authorization: 'Bearer t' } });
  assert.equal(summary.state, 'bypass');
  assert.equal(count('/page'), 3);
});

test('hit: the blocklist is asked again, and a refusal sends nothing', async () => {
  await fetchWithTimeout(`${base}/page`);
  _setBlockedHostsForTests(['127.0.0.1']);
  try {
    await assert.rejects(fetchWithTimeout(`${base}/page`), (e) => e.code === 'HOST_BLOCKED');
  } finally {
    _setBlockedHostsForTests(null);
  }
  assert.equal(count('/page'), 1);
});

// ─── 1.4 one fetch per key ──────────────────────────────────────────────────

test('concurrency: five concurrent fetches of one page are one request', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => fetchWithTimeout(`${base}/slow`)));
  assert.equal(count('/slow'), 1);
  for (const r of results) assert.equal(r._body, HTML);
});

test('concurrency: five concurrent fetchAndParse calls are one request, each with its own $', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => fetchAndParse(`${base}/slow`)));
  assert.equal(count('/slow'), 1);
  assert.equal(new Set(results.map((r) => r.$)).size, 5);
});

test('concurrency: a failed shared fetch rejects every waiter and stores nothing', async () => {
  const settled = await Promise.allSettled(Array.from({ length: 5 }, () => fetchWithTimeout(`${base}/broken`)));
  assert.equal(count('/broken'), 1);
  assert.ok(settled.every((s) => s.status === 'rejected'));
  await assert.rejects(fetchWithTimeout(`${base}/broken`));
  assert.equal(count('/broken'), 2);
});

// ─── D2 maxAge ──────────────────────────────────────────────────────────────

test('maxAge 0 fetches fresh, is a bypass, and stores the fresh copy', async () => {
  await fetchWithTimeout(`${base}/versioned`);
  const [fresh, summary] = await inCall(() => fetchWithTimeout(`${base}/versioned`, { maxAge: 0 }));
  assert.equal(summary.state, 'bypass');
  assert.match(fresh._body, /version 2/);
  const copy = await fetchWithTimeout(`${base}/versioned`);
  assert.match(copy._body, /version 2/);
  assert.equal(count('/versioned'), 2);
});

test('maxAge: a copy older than maxAge is a miss', async () => {
  await fetchWithTimeout(`${base}/versioned`);
  await new Promise((r) => setTimeout(r, 20));
  const [res, summary] = await inCall(() => fetchWithTimeout(`${base}/versioned`, { maxAge: 5 }));
  assert.equal(summary.state, 'miss');
  assert.match(res._body, /version 2/);
  assert.equal(count('/versioned'), 2);
});

test('noCache neither reads nor writes', async () => {
  await fetchWithTimeout(`${base}/page`, { noCache: true });
  await fetchWithTimeout(`${base}/page`);
  await fetchWithTimeout(`${base}/page`, { noCache: true });
  assert.equal(count('/page'), 3);
});

// ─── D3 deployment scope ────────────────────────────────────────────────────

test('D3: off in HTTP mode (MCP_HTTP=true or --http)', async () => {
  const saved = process.env.MCP_HTTP;
  process.env.MCP_HTTP = 'true';
  try {
    const [, summary] = await inCall(() => fetchWithTimeout(`${base}/page`));
    await fetchWithTimeout(`${base}/page`);
    assert.equal(summary, null);
  } finally {
    if (saved === undefined) delete process.env.MCP_HTTP; else process.env.MCP_HTTP = saved;
  }
  process.argv.push('--http');
  try {
    await fetchWithTimeout(`${base}/page`);
  } finally {
    process.argv.pop();
  }
  assert.equal(count('/page'), 3);
});

test('D3: off for internal (REST proxy) requests', async () => {
  await requestContext.run({ internal: true }, async () => {
    await fetchWithTimeout(`${base}/page`);
    await fetchWithTimeout(`${base}/page`);
  });
  assert.equal(count('/page'), 2);
});

test('off under node --test unless a test turns it on', async () => {
  _resetPageCache();
  await fetchWithTimeout(`${base}/page`);
  await fetchWithTimeout(`${base}/page`);
  assert.equal(count('/page'), 2);
});

// ─── byte cap ───────────────────────────────────────────────────────────────

test('soak: 1,000 distinct 1 MB pages stay within the byte cap', async () => {
  _resetPageCache({ enabled: true, maxBytes: 64 * 1024 * 1024 });
  const body = 'x'.repeat(1024 * 1024);
  const page = (i) => ({
    status: 200, statusText: 'OK', url: `https://example.com/p${i}`, redirected: false,
    headers: [['content-type', 'application/octet-stream']], body, fetchedAt: Date.now()
  });
  let peak = 0;
  for (let i = 0; i < 1000; i++) {
    await throughPageCache(`https://example.com/p${i}`, {}, 'plain', async () => ({ result: i, page: page(i) }), () => 'hit');
    peak = Math.max(peak, pageCacheBytes());
    assert.ok(pageCacheBytes() <= 64 * 1024 * 1024, `over the cap after ${i + 1} pages`);
  }
  assert.ok(peak > 60 * 1024 * 1024, 'the cache filled up to its cap');
  // The newest page is still held; the oldest was evicted. A hit runs the
  // compliance gate, which never sees example.com here because the fetch is faked.
  const fresh = async () => ({ result: 'fetched', page: page(0) });
  assert.equal(await throughPageCache('https://example.com/p0', {}, 'plain', fresh, () => 'hit'), 'fetched');
});

test('byte cap: a page larger than the cap is not stored', async () => {
  _resetPageCache({ enabled: true, maxBytes: 1024 });
  await fetchWithTimeout(`${base}/page?big`, {}); // ~100 bytes: fits
  assert.ok(pageCacheBytes() > 0);
  _resetPageCache({ enabled: true, maxBytes: 10 });
  await fetchWithTimeout(`${base}/page`);
  assert.equal(pageCacheBytes(), 0);
});

// ─── 1.6 / 1.7 withAuth ─────────────────────────────────────────────────────

function billedAuth() {
  const charges = [];
  return {
    charges,
    isCreatorMode: () => false,
    getToolCost: () => 2,
    checkCredits: async () => true,
    projectCost: () => ({ projected: 2, note: 'Fixed cost per invocation.' }),
    reportUsage: async (tool, charge) => { charges.push(charge); }
  };
}

function wrap(authManager, tool, handler) {
  const lines = [];
  const logger = { info: (message, context) => lines.push(context) };
  return { lines, call: (params) => makeWithAuth({ authManager, logger })(tool, handler)(params) };
}

const jsonHandler = async ({ url }) => {
  const res = await fetchWithTimeout(url);
  const body = { status: res.status, size: res._body.length };
  return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: { ...body } };
};

test('withAuth: a miss is full price with cache.state miss; a hit is 1 credit with the hit line', async () => {
  const auth = billedAuth();
  const { lines, call } = wrap(auth, 'scrape', jsonHandler);

  const miss = await call({ url: `${base}/page` });
  const missBody = JSON.parse(miss.content[0].text);
  assert.equal(missBody.cache.state, 'miss');
  assert.equal(missBody._cost.actual, 2);
  assert.equal(missBody.cache.note, undefined);

  const hit = await call({ url: `${base}/page` });
  const hitBody = JSON.parse(hit.content[0].text);
  assert.equal(hitBody.cache.state, 'hit');
  assert.equal(typeof hitBody.cache.fetchedAt, 'string');
  assert.ok(hitBody.cache.ageMs >= 0);
  assert.match(hitBody.cache.note, /^Served from a copy of this page fetched \d+ s ago in this session \(pass maxAge: 0 for a fresh fetch\)\.$/);
  assert.equal(hitBody._cost.actual, 1);
  assert.equal(hitBody._cost.projected, 2);
  assert.match(hitBody._cost.projection_note, /page cache: charged 1 instead of 2/);
  assert.deepEqual(hit.structuredContent.cache, hitBody.cache);
  assert.equal(hit.structuredContent._cost.actual, 1);

  assert.deepEqual(auth.charges, [2, 1]);
  assert.deepEqual(lines.map((l) => l.cache), ['miss', 'hit']);
  assert.equal(count('/page'), 1);
});

test('withAuth: a hit discounts only the base price; surcharges for work that still ran are charged', async () => {
  await fetchWithTimeout(`${base}/page`);
  // scrape with a model format: base 2 + model surcharge 3 = 5 projected.
  const auth = {
    ...billedAuth(),
    getToolCost: (tool, params) => 2 + (params?.formats ? 3 : 0),
    projectCost: () => ({ projected: 5, note: 'n' })
  };
  const { call } = wrap(auth, 'scrape', jsonHandler);
  const body = JSON.parse((await call({ url: `${base}/page`, formats: ['model'] })).content[0].text);
  assert.equal(body.cache.state, 'hit');
  assert.equal(body._cost.actual, 4);
  assert.deepEqual(auth.charges, [4]);
});

test('withAuth: no cache field and cache:null in the log when nothing went through a seam', async () => {
  const { lines, call } = wrap(billedAuth(), 'scrape', async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }));
  const result = await call({});
  assert.equal(JSON.parse(result.content[0].text).cache, undefined);
  assert.equal(lines[0].cache, null);
});

test('withAuth: one hit and one miss in one call is a miss at full price', async () => {
  await fetchWithTimeout(`${base}/page`);
  const auth = billedAuth();
  const { call } = wrap(auth, 'scrape', async () => {
    await fetchWithTimeout(`${base}/page`);
    await fetchWithTimeout(`${base}/other`);
    return { content: [{ type: 'text', text: '{}' }] };
  });
  const body = JSON.parse((await call({})).content[0].text);
  assert.equal(body.cache.state, 'miss');
  assert.deepEqual(auth.charges, [2]);
});

test('withAuth: maxAge 0 is a bypass at full price', async () => {
  await fetchWithTimeout(`${base}/page`);
  const auth = billedAuth();
  const { lines, call } = wrap(auth, 'scrape', async ({ url }) => {
    await fetchWithTimeout(url, { maxAge: 0 });
    return { content: [{ type: 'text', text: '{}' }] };
  });
  const body = JSON.parse((await call({ url: `${base}/page` })).content[0].text);
  assert.equal(body.cache.state, 'bypass');
  assert.deepEqual(auth.charges, [2]);
  assert.equal(lines[0].cache, 'bypass');
});

test('withAuth: a non-JSON hit gets the hit line appended to its text', async () => {
  await fetchWithTimeout(`${base}/page`);
  const { call } = wrap(billedAuth(), 'fetch_url', async ({ url }) => {
    await fetchWithTimeout(url);
    return { content: [{ type: 'text', text: 'plain text result' }] };
  });
  const result = await call({ url: `${base}/page` });
  assert.match(result.content[0].text, /^plain text result\nServed from a copy of this page fetched \d+ s ago/);
});

test('withAuth: a failed call stays free and gets no cache block', async () => {
  await fetchWithTimeout(`${base}/page`);
  const auth = billedAuth();
  const { call } = wrap(auth, 'scrape', async ({ url }) => {
    await fetchWithTimeout(url);
    return { content: [{ type: 'text', text: '{"success":false,"error":"no"}' }], isError: true };
  });
  const body = JSON.parse((await call({ url: `${base}/page` })).content[0].text);
  assert.equal(body.cache, undefined);
  assert.equal(body._cost.actual, 0);
  assert.deepEqual(auth.charges, []);
});

test('withAuth: agent is not discounted on a hit', async () => {
  await fetchWithTimeout(`${base}/page`);
  const auth = { ...billedAuth(), getToolCost: () => 8, projectCost: () => ({ projected: 8, note: 'n' }) };
  auth.charges = [];
  auth.reportUsage = async (tool, charge) => { auth.charges.push(charge); };
  const { call } = wrap(auth, 'agent', jsonHandler);
  const body = JSON.parse((await call({ url: `${base}/page` })).content[0].text);
  assert.equal(body.cache.state, 'hit');
  assert.deepEqual(auth.charges, [8]);
});

test('withAuth: creator mode stays at 0 on a hit', async () => {
  await fetchWithTimeout(`${base}/page`);
  const auth = { ...billedAuth(), isCreatorMode: () => true, getToolCost: () => 2 };
  const { call } = wrap(auth, 'scrape', jsonHandler);
  const body = JSON.parse((await call({ url: `${base}/page` })).content[0].text);
  assert.equal(body.cache.state, 'hit');
  assert.equal(body._cost.actual, 0);
});

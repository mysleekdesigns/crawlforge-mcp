/**
 * Unit tests: what crawl_deep's cacheEnabled actually switches off, and how a
 * caller can tell a replayed crawl from a fresh one.
 *
 * Run: node --test tests/unit/crawlDeepCacheScope.test.js
 *
 * Two defects found 2026-08-25 while root-causing the crawlDeep suite flake:
 *
 *  1. cacheEnabled:false disabled only the tool's result cache. BFSCrawler
 *     builds its own CacheManager and stores every fetched page body in it,
 *     with no way to turn that off — so a caller who explicitly asked for no
 *     caching was still served cached pages.
 *
 *  2. Both caches were described in the code as per-session / per-crawl, and
 *     both wrote to ./cache on disk. Page bodies outlived the crawler that
 *     fetched them and crossed process boundaries; a result was replayed for
 *     an hour with nothing in the response saying so.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Deliberately NOT setting CACHE_ENABLE_DISK=false here, unlike the other
// suites: these tests only mean anything if the disk cache is available and
// the two caches decline to use it. CACHE_DIR isolates whatever does get
// written so a stray entry cannot leak into ./cache or another run.
const tmpCacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'crawlforge-crawl-cache-'));
process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;
delete process.env.CACHE_ENABLE_DISK;
process.env.CACHE_DIR = tmpCacheDir;

const { CrawlDeepTool } = await import('../../src/tools/crawl/crawlDeep.js');
const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');
const { config } = await import('../../src/constants/config.js');

let server;
let baseUrl;
let requests = 0;

before(async () => {
  server = http.createServer((req, res) => {
    requests++;
    if (req.url === '/robots.txt') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>PAGE BODY</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(tmpCacheDir, { recursive: true, force: true });
});

const crawlArgs = {
  max_depth: 1,
  max_pages: 5,
  respect_robots: false,
  enable_link_analysis: false,
  extract_content: true
};

describe('cacheEnabled reaches every cache', () => {
  test('cacheEnabled:false refetches the page instead of reusing a cached body', async () => {
    // Same tool, two crawls: with caching off the second must hit the network.
    const tool = new CrawlDeepTool({ cacheEnabled: false, timeout: 5000 });

    await tool.execute({ url: baseUrl, ...crawlArgs });
    requests = 0;
    const second = await tool.execute({ url: baseUrl, ...crawlArgs });

    assert.ok(requests > 0, 'a caller who disabled the cache must get a real fetch');
    assert.ok(second.pages_crawled >= 1);
  });

  test('cacheEnabled:false builds no cache at all', () => {
    const tool = new CrawlDeepTool({ cacheEnabled: false });
    assert.equal(tool.cache, null, 'no result cache');
    assert.equal(new BFSCrawler({ cacheEnabled: false }).cache, null, 'no page cache');
  });

  test('caching stays on by default', async () => {
    const tool = new CrawlDeepTool({ cacheEnabled: true, timeout: 5000 });
    assert.ok(tool.cache, 'result cache present');
    assert.ok(new BFSCrawler({}).cache, 'page cache present by default');

    await tool.execute({ url: baseUrl, ...crawlArgs });
    requests = 0;
    await tool.execute({ url: baseUrl, ...crawlArgs });
    assert.equal(requests, 0, 'the second identical crawl is served from cache');
  });
});

describe('neither cache outlives its process', () => {
  test('the disk cache is switched on for this process', () => {
    // Guards the two assertions below from passing vacuously.
    assert.equal(config.performance.cacheEnableDisk, true);
  });

  test('the result cache is memory-only', () => {
    const tool = new CrawlDeepTool({ cacheEnabled: true });
    assert.equal(tool.cache.enableDiskCache, false);
  });

  test('the page cache is memory-only', () => {
    // BFSCrawler.destroy() is called after every crawl on the premise that the
    // cached bodies go with it; on disk they did not.
    assert.equal(new BFSCrawler({}).cache.enableDiskCache, false);
  });
});

describe('a replayed crawl says so', () => {
  test('a fresh crawl is marked uncached and stamped with its time', async () => {
    const tool = new CrawlDeepTool({ cacheEnabled: true, timeout: 5000 });
    const result = await tool.execute({ url: baseUrl, ...crawlArgs });

    assert.equal(result.cached, false);
    assert.ok(
      !Number.isNaN(Date.parse(result.crawled_at)),
      `crawled_at must be a timestamp, got ${result.crawled_at}`
    );
  });

  test('a cache hit is marked cached and keeps the original crawl time', async () => {
    const tool = new CrawlDeepTool({ cacheEnabled: true, timeout: 5000 });
    const fresh = await tool.execute({ url: baseUrl, ...crawlArgs });

    const replay = await tool.execute({ url: baseUrl, ...crawlArgs });

    assert.equal(replay.cached, true, 'the caller can tell no crawl happened');
    assert.equal(replay.crawled_at, fresh.crawled_at, 'the age of the data is knowable');
    assert.equal(replay.pages_crawled, fresh.pages_crawled);
  });

  test('the stored entry is not itself mutated by being served', async () => {
    const tool = new CrawlDeepTool({ cacheEnabled: true, timeout: 5000 });
    await tool.execute({ url: baseUrl, ...crawlArgs });

    const first = await tool.execute({ url: baseUrl, ...crawlArgs });
    const second = await tool.execute({ url: baseUrl, ...crawlArgs });

    assert.equal(first.cached, true);
    assert.equal(second.cached, true, 'a second replay must not have been poisoned by the first');
  });

  test('after all of the above, nothing was written to the cache directory', async () => {
    const written = await fsp.readdir(tmpCacheDir).catch(() => []);
    assert.deepEqual(written, [], `crawl caches must stay in memory, found ${JSON.stringify(written)}`);
  });
});

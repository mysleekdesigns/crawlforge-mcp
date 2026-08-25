/**
 * Unit tests: CacheManager's disk cache honours CACHE_DIR / CACHE_ENABLE_DISK.
 *
 * Run: CACHE_DIR=<tmp> node --test tests/unit/cacheManagerDiskConfig.test.js
 * (the file sets CACHE_DIR itself before importing config)
 *
 * Root cause of the crawlDeep parallel-run flake (found 2026-08-25):
 * constants/config.js has always exposed CACHE_DIR and CACHE_ENABLE_DISK, but
 * CacheManager read neither — the disk cache was hard-wired to ./cache and
 * always on. Every test run therefore wrote crawl results into one shared
 * directory that outlived the process (1,775 files had accumulated).
 *
 * crawl_deep keys its cache on the crawled URL. Test servers bind an ephemeral
 * port, the OS recycles those ports, and the cached value carries no record of
 * which server produced it — so a later run crawling the same port number was
 * served an unrelated site's pages. That is why the two failures took 13ms and
 * 5ms: no crawl happened at all, both were instant disk hits.
 *
 * The defaults are unchanged ('./cache', enabled). The env vars now work, and
 * the test scripts set CACHE_ENABLE_DISK=false so no suite touches the disk.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpCacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'crawlforge-cache-'));

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;
process.env.CACHE_DIR = tmpCacheDir;
delete process.env.CACHE_ENABLE_DISK; // exercise the enabled-by-default path

const { CacheManager } = await import('../../src/core/cache/CacheManager.js');
const { config } = await import('../../src/constants/config.js');
const { CrawlDeepTool } = await import('../../src/tools/crawl/crawlDeep.js');

after(async () => {
  await fsp.rm(tmpCacheDir, { recursive: true, force: true });
});

describe('CacheManager disk configuration', () => {
  test('the disk cache lands in CACHE_DIR, not a hard-coded ./cache', async () => {
    const cache = new CacheManager({ ttl: 60000 });
    const key = cache.generateKey('config-test', { n: 1 });
    await cache.set(key, { hello: 'world' });

    const written = await fsp.readFile(path.join(tmpCacheDir, `${key}.json`), 'utf8');
    assert.deepEqual(JSON.parse(written).value, { hello: 'world' });
  });

  test('CACHE_ENABLE_DISK is what decides whether the disk is used at all', async () => {
    const cache = new CacheManager({ ttl: 60000 });
    assert.equal(cache.enableDiskCache, config.performance.cacheEnableDisk);
    assert.equal(cache.diskCacheDir, config.performance.cacheDir);
  });

  test('an explicitly disabled disk cache writes nothing', async () => {
    const cache = new CacheManager({ ttl: 60000, enableDiskCache: false });
    const key = cache.generateKey('config-test', { n: 2 });
    await cache.set(key, { hello: 'memory' });

    await assert.rejects(
      () => fsp.readFile(path.join(tmpCacheDir, `${key}.json`), 'utf8'),
      /ENOENT/
    );
    assert.deepEqual(await cache.get(key), { hello: 'memory' }, 'memory cache still serves it');
  });
});

describe('crawl_deep and a recycled ephemeral port', () => {
  let server;
  let baseUrl;
  let requests = 0;

  before(async () => {
    server = http.createServer((req, res) => {
      requests++;
      if (req.url === '/robots.txt') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>THIS RUN’S REAL PAGE</body></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const crawlArgs = {
    max_depth: 1,
    max_pages: 5,
    respect_robots: false,
    enable_link_analysis: false,
    extract_content: true
  };

  test('a leftover disk entry for this URL is served instead of crawling', async () => {
    // Demonstrates the flake rather than asserting it is acceptable: an entry
    // written by an earlier process — here, a previous tenant of this port —
    // is indistinguishable from one this run produced. The key is taken from
    // the file the tool itself writes, so the test cannot drift from
    // _buildCacheKey.
    const first = new CrawlDeepTool({ cacheEnabled: true, timeout: 5000 });
    const real = await first.execute({ url: baseUrl, ...crawlArgs });
    assert.ok(real.pages_crawled >= 1, 'the first crawl must be real');

    const written = (await fsp.readdir(tmpCacheDir)).filter((f) => f.endsWith('.json'));
    const entries = await Promise.all(
      written.map(async (f) => ({ f, body: JSON.parse(await fsp.readFile(path.join(tmpCacheDir, f), 'utf8')) }))
    );
    const crawlEntry = entries.find((e) => e.body.value?.pages_crawled !== undefined);
    assert.ok(crawlEntry, 'the crawl result must have been persisted to disk');

    await fsp.writeFile(
      path.join(tmpCacheDir, crawlEntry.f),
      JSON.stringify({
        value: { pages_crawled: 999, results: [{ url: 'http://somewhere-else.example/', content: 'A DIFFERENT SITE' }] },
        expiry: Date.now() + 60000
      })
    );

    // A fresh instance: empty memory cache, same disk directory — exactly the
    // position a later test run is in when the OS hands it a recycled port.
    const later = new CrawlDeepTool({ cacheEnabled: true, timeout: 5000 });
    requests = 0;
    const result = await later.execute({ url: baseUrl, ...crawlArgs });

    assert.equal(result.pages_crawled, 999, 'the poisoned entry is returned verbatim');
    assert.equal(requests, 0, 'and the server was never contacted');
  });

  test('with the disk cache off the same crawl reads the live server', async () => {
    // What every test run now does, via CACHE_ENABLE_DISK=false in the test
    // scripts: the poisoned file is still on disk and is simply not consulted.
    //
    // Only the tool's result cache is switched off here. BFSCrawler builds its
    // own CacheManager for page bodies, also on disk by default, so the page
    // fetch may still be served from the earlier crawl in this file — the
    // assertion is therefore on the result, not on a request count. Setting
    // CACHE_ENABLE_DISK for the process, as the test scripts do, disables both.
    const tool = new CrawlDeepTool({ cacheEnabled: true, timeout: 5000 });
    tool.cache.enableDiskCache = false;

    const result = await tool.execute({ url: baseUrl, ...crawlArgs });

    assert.notEqual(result.pages_crawled, 999, 'must not be the poisoned entry');
    assert.ok(
      result.results.every((r) => r.url.startsWith(baseUrl)),
      `results must come from this run's server, got ${JSON.stringify(result.results.map((r) => r.url))}`
    );
  });
});

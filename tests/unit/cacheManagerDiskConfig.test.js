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
 *
 * crawl_deep has since been taken off the disk entirely (its result cache and
 * BFSCrawler's page cache are both memory-only), so the surviving-entry case
 * below is exercised through CacheManager directly — every other user of it
 * still defaults to disk.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpCacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'crawlforge-cache-'));

process.env.CACHE_DIR = tmpCacheDir;
delete process.env.CACHE_ENABLE_DISK; // exercise the enabled-by-default path

const { CacheManager } = await import('../../src/core/cache/CacheManager.js');
const { config } = await import('../../src/constants/config.js');

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

describe('a disk entry outlives the process that wrote it', () => {
  // The mechanism behind the crawlDeep suite flake, at the layer it lives in.
  // A cached value carries no record of which process, run or server produced
  // it, so a later CacheManager reading the same directory cannot tell a fresh
  // entry from one left by a previous tenant of a recycled ephemeral port.
  //
  // crawl_deep itself is no longer exposed to this — both its result cache and
  // BFSCrawler's page cache are memory-only now — but every other CacheManager
  // user still defaults to disk, which is why the test scripts set
  // CACHE_ENABLE_DISK=false.
  test('a fresh instance serves what an earlier instance left behind', async () => {
    const key = new CacheManager({ ttl: 60000 }).generateKey('crawl_deep', {
      url: 'http://127.0.0.1:54321/'
    });

    const earlierRun = new CacheManager({ ttl: 60000 });
    await earlierRun.set(key, { pages_crawled: 999, note: 'a different site entirely' });
    earlierRun.destroy();

    // Nothing is shared but the directory on disk.
    const laterRun = new CacheManager({ ttl: 60000 });
    assert.equal(laterRun.memoryCache.size, 0, 'the later instance starts empty');

    const served = await laterRun.get(key);
    assert.deepEqual(served, { pages_crawled: 999, note: 'a different site entirely' });
  });

  test('an expired entry is not served, and is cleaned up', async () => {
    const cache = new CacheManager({ ttl: 60000 });
    const key = cache.generateKey('expired', { n: 1 });
    await fsp.writeFile(
      path.join(tmpCacheDir, `${key}.json`),
      JSON.stringify({ value: { stale: true }, expiry: Date.now() - 1000 })
    );

    assert.equal(await cache.get(key), null, 'past its expiry it is a miss');
    await assert.rejects(() => fsp.readFile(path.join(tmpCacheDir, `${key}.json`), 'utf8'), /ENOENT/);
  });
});

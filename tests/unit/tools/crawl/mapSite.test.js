/**
 * D5.2 — Unit tests: mapSite tool
 * Run: node --test tests/unit/tools/crawl/mapSite.test.js
 */

import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// The real-module describe block below (Phase 2 fixes) needs safeFetch to
// reach a local server. safeFetch enforces SSRF protection (blocks loopback
// by default), so ALLOWED_DOMAINS must be set BEFORE the first transitive
// import of src/constants/config.js — hence the dynamic import here rather
// than a static one. `node --test` runs each file in its own subprocess, so
// this does not leak into sibling test files.
process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;
const { MapSiteTool } = await import('../../../../src/tools/crawl/mapSite.js');

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const stubSitemapUrls = [
  'https://example.com/',
  'https://example.com/about',
  'https://example.com/blog',
  'https://example.com/contact'
];

class CacheManagerStub {
  constructor() { this._store = new Map(); }
  generateKey(n, p) { return `${n}:${JSON.stringify(p)}`; }
  async get(k) { return this._store.get(k) || null; }
  async set(k, v) { this._store.set(k, v); }
}

// ---------------------------------------------------------------------------
// Minimal MapSite-like stub
// ---------------------------------------------------------------------------

class MapSiteStub {
  constructor({ fetchFn, cache } = {}) {
    this._fetch = fetchFn || null;
    this.cache = cache || new CacheManagerStub();
  }

  async _fetchSitemap(baseUrl) {
    const sitemapUrl = `${baseUrl}/sitemap.xml`;
    const resp = await this._fetch(sitemapUrl);
    if (!resp.ok) return [];
    const text = await resp.text();
    // Simple regex to extract <loc> URLs
    return [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  }

  async execute(params) {
    if (!params || !params.url) throw new Error('url is required');
    try { new URL(params.url); } catch { throw new Error('Invalid URL'); }

    const maxUrls = params.max_urls || 1000;
    const cacheKey = this.cache.generateKey('map_site', { url: params.url, maxUrls });
    const cached = await this.cache.get(cacheKey);
    if (cached) return { ...cached, cached: true };

    let urls = [];
    if (params.include_sitemap !== false && this._fetch) {
      urls = await this._fetchSitemap(new URL(params.url).origin);
    }

    // Deduplicate and cap
    const uniqueUrls = [...new Set(urls)].slice(0, maxUrls);

    const result = {
      url: params.url,
      totalUrls: uniqueUrls.length,
      urls: uniqueUrls,
      groups: params.group_by_path ? this._groupByPath(uniqueUrls) : null
    };

    await this.cache.set(cacheKey, result);
    return result;
  }

  _groupByPath(urls) {
    const groups = {};
    for (const url of urls) {
      const pathParts = new URL(url).pathname.split('/').filter(Boolean);
      const group = pathParts[0] || 'root';
      if (!groups[group]) groups[group] = [];
      groups[group].push(url);
    }
    return groups;
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeXmlFetch(urls) {
  const xml = urls.map(u => `<loc>${u}</loc>`).join('\n');
  return async (_url) => ({ ok: true, status: 200, text: async () => `<urlset>${xml}</urlset>` });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mapSite tool', () => {
  let tool;

  beforeEach(() => {
    tool = new MapSiteStub({ fetchFn: makeXmlFetch(stubSitemapUrls) });
  });

  test('constructor stores cache', () => {
    assert.ok(tool.cache instanceof CacheManagerStub);
  });

  test('happy path — returns URL list from sitemap', async () => {
    const result = await tool.execute({ url: 'https://example.com' });
    assert.equal(result.url, 'https://example.com');
    assert.ok(Array.isArray(result.urls));
    assert.equal(result.totalUrls, stubSitemapUrls.length);
  });

  test('cache hit on second call', async () => {
    await tool.execute({ url: 'https://example.com' });
    const second = await tool.execute({ url: 'https://example.com' });
    assert.equal(second.cached, true);
  });

  test('group_by_path=true returns groups object', async () => {
    const result = await tool.execute({ url: 'https://example.com', group_by_path: true });
    assert.ok(result.groups, 'groups should be present');
    assert.ok(typeof result.groups === 'object');
  });

  test('max_urls cap respected', async () => {
    const result = await tool.execute({ url: 'https://example.com', max_urls: 2 });
    assert.ok(result.totalUrls <= 2);
  });

  test('missing url throws', async () => {
    await assert.rejects(() => tool.execute({}), /url is required/);
  });

  test('invalid URL throws', async () => {
    await assert.rejects(() => tool.execute({ url: 'ftp-not-http' }), /Invalid URL/);
  });

  test('sitemap 404 returns empty URL list gracefully', async () => {
    const notFoundFetch = async () => ({ ok: false, status: 404, text: async () => '' });
    const noSitemapTool = new MapSiteStub({ fetchFn: notFoundFetch });
    const result = await noSitemapTool.execute({ url: 'https://example.com' });
    assert.equal(result.totalUrls, 0);
    assert.deepEqual(result.urls, []);
  });
});

// ---------------------------------------------------------------------------
// Real-module tests (Phase 2 fixes) — MapSiteTool against a local HTTP
// server, no stubs.
// ---------------------------------------------------------------------------

describe('mapSite tool — real module (Phase 2 fixes)', () => {
  describe('cache key includes `search`', () => {
    let server;
    let baseUrl;

    before(async () => {
      const pages = {
        '/': '<html><body><a href="/pricing">See our pricing plans</a><a href="/about">About</a><a href="/contact">Contact</a></body></html>'
      };
      server = http.createServer((req, res) => {
        const path = req.url.split('?')[0];
        if (path === '/robots.txt') { res.writeHead(404); res.end(); return; }
        const body = pages[path];
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
    });

    after(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    test('a plain call (no search) caches a result with no ranked_urls key', async () => {
      const realTool = new MapSiteTool({ cacheEnabled: true, timeout: 5000 });
      const result = await realTool.execute({ url: baseUrl, include_sitemap: false, group_by_path: false });
      assert.ok(!('ranked_urls' in result), 'plain call should not carry a ranked_urls key');
    });

    test('a call with search yields ranked_urls, independent of the plain call\'s cache entry', async () => {
      const realTool = new MapSiteTool({ cacheEnabled: true, timeout: 5000 });
      // Prime the plain-call cache entry first (same tool instance, same cache).
      await realTool.execute({ url: baseUrl, include_sitemap: false, group_by_path: false });

      const ranked = await realTool.execute({ url: baseUrl, include_sitemap: false, group_by_path: false, search: 'pricing' });
      assert.ok(Array.isArray(ranked.ranked_urls), 'search call must produce ranked_urls (not silently dropped by a cache hit)');
      assert.ok(ranked.ranked_urls.length > 0);
      assert.ok(
        ranked.ranked_urls.every(r => typeof r.url === 'string' && typeof r.score === 'number'),
        'each ranked_urls entry should have {url, score}'
      );
    });

    test('a subsequent plain call does not leak ranked_urls from the search call\'s cache entry', async () => {
      const realTool = new MapSiteTool({ cacheEnabled: true, timeout: 5000 });
      await realTool.execute({ url: baseUrl, include_sitemap: false, group_by_path: false, search: 'pricing' });

      const plainAfter = await realTool.execute({ url: baseUrl, include_sitemap: false, group_by_path: false });
      assert.ok(!('ranked_urls' in plainAfter), 'plain call after a search call must not inherit ranked_urls from a shared cache entry');
    });
  });

  describe('accumulates URLs across multiple sitemaps', () => {
    let server;
    let baseUrl;

    before(async () => {
      await new Promise((resolve) => {
        server = http.createServer((req, res) => {
          const path = req.url.split('?')[0];
          if (path === '/robots.txt') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(`Sitemap: ${baseUrl}/sitemap-a.xml\nSitemap: ${baseUrl}/sitemap-b.xml\n`);
            return;
          }
          if (path === '/sitemap-a.xml') {
            res.writeHead(200, { 'Content-Type': 'application/xml' });
            res.end(makeUrlset([`${baseUrl}/a1`, `${baseUrl}/a2`, `${baseUrl}/a3`]));
            return;
          }
          if (path === '/sitemap-b.xml') {
            res.writeHead(200, { 'Content-Type': 'application/xml' });
            res.end(makeUrlset([`${baseUrl}/b1`, `${baseUrl}/b2`, `${baseUrl}/b3`]));
            return;
          }
          if (path === '/') {
            // No links on the homepage itself — every discovered URL below
            // must come from sitemap accumulation, not page-link scraping.
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body>Home, no links.</body></html>');
            return;
          }
          res.writeHead(404);
          res.end();
        });
        server.listen(0, '127.0.0.1', () => {
          baseUrl = `http://127.0.0.1:${server.address().port}`;
          resolve();
        });
      });
    });

    after(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    function makeUrlset(urls) {
      const entries = urls.map(u => `<url><loc>${u}</loc></url>`).join('');
      return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
    }

    test('URLs from BOTH declared sitemaps are present (not just the first productive one)', async () => {
      const realTool = new MapSiteTool({ cacheEnabled: false, timeout: 5000 });
      const result = await realTool.execute({ url: baseUrl, include_sitemap: true, group_by_path: false });

      const paths = result.urls.map(u => new URL(u).pathname).sort();
      assert.deepEqual(paths, ['/a1', '/a2', '/a3', '/b1', '/b2', '/b3']);
      assert.equal(result.total_urls, 6);
    });
  });
});

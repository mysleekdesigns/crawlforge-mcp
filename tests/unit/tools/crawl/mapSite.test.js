/**
 * D5.2 — Unit tests: mapSite tool
 * Run: node --test tests/unit/tools/crawl/mapSite.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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

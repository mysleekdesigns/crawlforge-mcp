/**
 * Unit tests: web-discovery search adapter base URL (2026-08-26 regression)
 *
 * An unscoped reddit_search discovers posts through the CrawlForge search
 * adapter. The factory's fallback base URL was https://api.crawlforge.dev —
 * a host that does not resolve — so every unscoped search died with
 * "Network error connecting to CrawlForge API: fetch failed" while search_web
 * (which passes its own apiBaseUrl) kept working. RedditSearchTool also never
 * threaded a base URL through to the factory at all.
 *
 * Run: node --test tests/unit/webDiscoverySearchBaseUrl.test.js
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RedditSearchTool } from '../../src/tools/search/redditSearch.js';
import { SearchProviderFactory } from '../../src/tools/search/adapters/searchProviderFactory.js';

describe('web-discovery search adapter base URL', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  test('factory default points at the live www host, not the unresolvable api. host', () => {
    const adapter = SearchProviderFactory.createAdapter('cf_test_key');
    assert.equal(adapter.apiBaseUrl, 'https://www.crawlforge.dev');
  });

  test('RedditSearchTool threads searchApiBaseUrl through to the search adapter', async () => {
    const urls = [];
    global.fetch = async (url) => {
      urls.push(String(url));
      return {
        ok: true, status: 200, statusText: 'OK',
        headers: { get: () => null },
        json: async () => ({ items: [] }),
      };
    };

    const tool = new RedditSearchTool({
      searchApiKey: 'cf_test_key',
      searchApiBaseUrl: 'https://override.example',
    });
    // Empty discovery results end in a tool error — irrelevant here; the
    // assertion is about which host the discovery search contacted.
    await tool.execute({ query: 'anything', mode: 'posts', limit: 5 }).catch(() => {});

    assert.ok(urls.length >= 1, 'expected the discovery search to issue a fetch');
    assert.ok(
      urls[0].startsWith('https://override.example/api/v1/search'),
      `discovery search hit ${urls[0]} instead of the configured base URL`
    );
  });
});

/**
 * Unit tests: Brave Search adapter (Creator Mode's direct search backend).
 *
 * Takes the Custom Search parameters SearchWebTool sends and must return
 * Custom Search's shape. Runs against a stubbed global.fetch — no network.
 *
 * Run: node --test tests/unit/braveSearchAdapter.test.js
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BraveSearchAdapter, braveLanguage, plainText } from '../../src/tools/search/adapters/braveSearch.js';
import { SearchProviderFactory } from '../../src/tools/search/adapters/searchProviderFactory.js';

const realFetch = global.fetch;
const realEnv = { ...process.env };
let calls = [];

function stubFetch(...responses) {
  calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: new URL(url), opts });
    return responses.length > 1 ? responses.shift() : responses[0];
  };
}
const ok = (data) => ({ ok: true, status: 200, statusText: 'OK', json: async () => data });
const err = (status, detail) => ({ ok: false, status, statusText: 'x', json: async () => ({ error: { detail } }) });

/** Trimmed from a live Brave response, 2026-10-19. */
const BODY = {
  web: {
    results: [
      {
        title: 'CrawlForge MCP',
        url: 'https://www.crawlforge.dev/',
        description: 'CrawlForge is <strong>the forge</strong> &amp; more',
        page_age: '2026-10-01T00:00:00',
        meta_url: { hostname: 'www.crawlforge.dev' },
        thumbnail: { src: 'https://imgs.search.brave.com/t.jpg' },
      },
      { title: 'no url' },
    ],
  },
};

afterEach(() => { global.fetch = realFetch; process.env = { ...realEnv }; });

describe('BraveSearchAdapter', () => {
  test('maps the Custom Search parameters SearchWebTool sends', async () => {
    stubFetch(ok(BODY));
    await new BraveSearchAdapter('k').search({
      query: 'q', num: 10, start: 11, lr: 'lang_zh', safe: 'active', dateRestrict: 'w1', cr: 'countryTW',
    });
    assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), {
      q: 'q', count: '10', safesearch: 'strict', offset: '1', freshness: 'pw', search_lang: 'zh-hans', country: 'TW',
    });
    assert.equal(calls[0].opts.headers['X-Subscription-Token'], 'k');
  });

  test('returns Custom Search items and provider brave', async () => {
    stubFetch(ok(BODY));
    const out = await new BraveSearchAdapter('k').search({ query: 'q' });
    assert.deepEqual(out.items, [{
      title: 'CrawlForge MCP',
      link: 'https://www.crawlforge.dev/',
      snippet: 'CrawlForge is the forge & more',
      displayLink: 'www.crawlforge.dev',
      formattedUrl: 'https://www.crawlforge.dev/',
      htmlTitle: 'CrawlForge MCP',
      htmlSnippet: 'CrawlForge is <strong>the forge</strong> &amp; more',
      pagemap: {
        cse_thumbnail: [{ src: 'https://imgs.search.brave.com/t.jpg' }],
        metatags: [{ 'article:published_time': '2026-10-01T00:00:00' }],
      },
    }]);
    assert.equal(out.provider, 'brave');
    assert.equal(out.searchInformation.totalResults, null);
  });

  test('retries a refused locale once without it', async () => {
    stubFetch(err(422, 'Unable to validate request parameter(s)'), ok(BODY));
    const out = await new BraveSearchAdapter('k').search({ query: 'q', lr: 'lang_xx', cr: 'countrySG' });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url.searchParams.has('search_lang'), false);
    assert.equal(out.items.length, 1);
  });

  test('returns nothing without a request past the tenth page', async () => {
    stubFetch(ok(BODY));
    const out = await new BraveSearchAdapter('k').search({ query: 'q', num: 10, start: 101 });
    assert.deepEqual([out.items, calls.length], [[], 0]);
  });

  test('names a rejected key', async () => {
    stubFetch(err(401, 'The provided subscription token is invalid.'));
    await assert.rejects(new BraveSearchAdapter('k').search({ query: 'q' }), /Invalid Brave Search API key/);
  });

  test('normalises language codes and strips highlighting', () => {
    assert.deepEqual(
      ['lang_en', 'lang_zh-TW', 'pt', 'lang_de-AT', ''].map(braveLanguage),
      ['en', 'zh-hant', 'pt-br', 'de', undefined]
    );
    assert.equal(plainText('<b>A</b> &#x4E2D;&#99999999;'), 'A 中&#99999999;');
  });
});

describe('SearchProviderFactory in Creator Mode', () => {
  test('prefers Brave when BRAVE_SEARCH_API_KEY is set', () => {
    process.env.BRAVE_SEARCH_API_KEY = 'b';
    process.env.GOOGLE_API_KEY = 'g';
    process.env.GOOGLE_SEARCH_ENGINE_ID = 'cx';
    assert.ok(SearchProviderFactory.createAdapter(null, { creatorMode: true }) instanceof BraveSearchAdapter);
  });

  test('falls back to Google without a Brave key', () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    process.env.GOOGLE_API_KEY = 'g';
    process.env.GOOGLE_SEARCH_ENGINE_ID = 'cx';
    assert.equal(SearchProviderFactory.createAdapter(null, { creatorMode: true }).constructor.name, 'GoogleSearchAdapter');
  });

  test('a CrawlForge API key still wins outside Creator Mode', () => {
    process.env.BRAVE_SEARCH_API_KEY = 'b';
    assert.equal(SearchProviderFactory.createAdapter('cf_live_x', {}).constructor.name, 'CrawlForgeSearchAdapter');
  });
});

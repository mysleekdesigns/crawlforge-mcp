/**
 * reddit.com is never fetched: the pre-fetch gate refuses it before any
 * network work — robots.txt included — and names the reddit_search call that
 * reads the same data. Pure decision tests; no server is needed because the
 * refusal happens before the first request would go out.
 *
 * Run: node --test tests/unit/redditHosts.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { isRedditUrl, redditSearchCallFor, UseRedditSearchError } = await import('../../src/utils/redditHosts.js');
const { robotsPreflight, preflightFetch, browserPreflight, _robotsFetchCount } = await import('../../src/utils/robotsGate.js');
const { appendFallbackHint } = await import('../../src/server/fallbackHints.js');

describe('isRedditUrl', () => {
  for (const url of [
    'https://www.reddit.com/r/webscraping/',
    'https://reddit.com/',
    'https://old.reddit.com/r/webscraping/comments/abc123/title/',
    'https://np.reddit.com/user/someone',
    'https://REDDIT.COM/search?q=x',
    'https://redd.it/abc123',
  ]) {
    test(`matches ${url}`, () => assert.equal(isRedditUrl(url), true));
  }
  for (const url of [
    'https://i.redd.it/xyz.jpeg',
    'https://v.redd.it/abc',
    'https://preview.redd.it/abc.png',
    'https://notreddit.com/',
    'https://reddit.com.example.org/',
    'https://www.redditinc.com/',
    'not a url',
  ]) {
    test(`leaves ${url} alone`, () => assert.equal(isRedditUrl(url), false));
  }
});

describe('redditSearchCallFor', () => {
  const cases = [
    ['https://www.reddit.com/r/webscraping/comments/1016j3l/best_web_scraping_apis/', { mode: 'thread', link_id: '1016j3l' }],
    ['https://old.reddit.com/r/webscraping/comments/1016j3l/best/p2zcr74/', { mode: 'thread', link_id: '1016j3l' }],
    ['https://www.reddit.com/comments/1016j3l', { mode: 'thread', link_id: '1016j3l' }],
    ['https://www.reddit.com/gallery/1016j3l', { mode: 'thread', link_id: '1016j3l' }],
    ['https://redd.it/1016j3l', { mode: 'thread', link_id: '1016j3l' }],
    ['https://www.reddit.com/r/webscraping/search?q=scraping+api&restrict_sr=on', { subreddit: 'webscraping', query: 'scraping api' }],
    ['https://www.reddit.com/search?q=crawlforge', { query: 'crawlforge' }],
    ['https://www.reddit.com/search/?q=crawlforge&type=comment', { query: 'crawlforge', mode: 'comments' }],
    ['https://www.reddit.com/r/webscraping/new/', { subreddit: 'webscraping' }],
    ['https://www.reddit.com/user/someone', { author: 'someone' }],
    ['https://www.reddit.com/u/someone/comments/', { author: 'someone', mode: 'comments' }],
    ['https://www.reddit.com/', {}],
    ['https://redd.it/', {}],
  ];
  for (const [url, call] of cases) {
    test(`${url} → ${JSON.stringify(call)}`, () => assert.deepEqual(redditSearchCallFor(url), call));
  }
});

describe('UseRedditSearchError', () => {
  test('names the exact reddit_search call as the next step', () => {
    const error = new UseRedditSearchError('https://www.reddit.com/r/webscraping/comments/1016j3l/x/');
    assert.equal(error.code, 'USE_REDDIT_SEARCH');
    assert.match(error.message, /^www\.reddit\.com is not fetched/);
    assert.match(error.message, /reddit_search \(5 credits\)/);
    assert.match(error.message, /Next step: reddit_search\({"mode":"thread","link_id":"1016j3l"}\)$/);
    assert.deepEqual(error.redditSearchCall, { mode: 'thread', link_id: '1016j3l' });
  });

  test('describes the call in words when the URL names nothing to search', () => {
    const error = new UseRedditSearchError('https://www.reddit.com/');
    assert.match(error.message, /Next step: reddit_search with a query, subreddit or author/);
  });
});

describe('the pre-fetch gate', () => {
  test('robotsPreflight refuses reddit.com before fetching anything, robots.txt included', async () => {
    const before = _robotsFetchCount();
    await assert.rejects(
      () => robotsPreflight('https://www.reddit.com/r/webscraping/', { tool: 'fetch_url' }),
      (err) => err.code === 'USE_REDDIT_SEARCH'
    );
    assert.equal(_robotsFetchCount(), before, 'no robots.txt request was made');
  });

  test('preflightFetch and browserPreflight refuse it too, and respect_robots:false cannot override', async () => {
    await assert.rejects(
      () => preflightFetch('https://old.reddit.com/r/webscraping/', { tool: 'scrape', respectRobots: false }),
      (err) => err.code === 'USE_REDDIT_SEARCH'
    );
    await assert.rejects(
      () => browserPreflight('https://www.reddit.com/search?q=x', { tool: 'stealth_mode', respectRobots: false }),
      (err) => err.code === 'USE_REDDIT_SEARCH'
    );
  });
});

describe('fallback hints', () => {
  test('an error that already names its next step does not get the tool\'s generic hint appended', () => {
    const error = new UseRedditSearchError('https://www.reddit.com/r/webscraping/');
    const result = { isError: true, content: [{ type: 'text', text: `Failed to fetch URL: ${error.message}` }] };
    appendFallbackHint('fetch_url', result);
    assert.equal(result.content[0].text.match(/Next step:/g).length, 1);
    assert.doesNotMatch(result.content[0].text, /stealth_mode/);
  });

  test('an error without a next step still gets the tool hint', () => {
    const result = { isError: true, content: [{ type: 'text', text: 'Failed to fetch URL: HTTP 500' }] };
    appendFallbackHint('fetch_url', result);
    assert.match(result.content[0].text, /Next step: .*stealth_mode/);
  });
});

/**
 * Unit tests: reddit_search tool
 *
 * Exercises the REAL RedditSearchTool against a stubbed global.fetch — no live
 * network, so this runs under the default `npm run test:unit` gate.
 *
 * Run: node --test tests/unit/redditSearch.test.js
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RedditSearchTool } from '../../src/tools/search/redditSearch.js';

// ---------------------------------------------------------------------------
// Fixtures & fetch stub
// ---------------------------------------------------------------------------

const realFetch = global.fetch;
let requests = [];

/** Install a fake global.fetch. `impl(url)` returns a Response-like object. */
function stubFetch(impl) {
  requests = [];
  global.fetch = async (url, opts) => {
    requests.push({ url: new URL(url), opts });
    return impl(url, opts);
  };
}

const okResponse = (data) => ({
  ok: true, status: 200, statusText: 'OK',
  headers: { get: () => null },
  json: async () => data,
});
const errResponse = (status, statusText = '', headers = {}) => ({
  ok: false, status, statusText,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => ({}),
});

const RAW_POST = {
  id: '1twm1zh',
  title: 'Best-selling keyboard switches of May 2026',
  author: 'dovenyi',
  subreddit: 'MechanicalKeyboards',
  created_utc: 1780575000,
  score: 363,
  num_comments: 123,
  upvote_ratio: 0.98,
  link_flair_text: 'Photos',
  over_18: false,
  selftext: 'So, has anyone here been waiting for the May rankings?',
  url: 'https://i.redd.it/xyz.jpeg',
  permalink: '/r/MechanicalKeyboards/comments/1twm1zh/bestselling_keyboard_switches_of_may_2026/',
};

const RAW_COMMENT = {
  id: 'p2zcr74',
  author: 'bisousjay',
  subreddit: 'MechanicalKeyboards',
  created_utc: 1786425888,
  score: 5,
  body: 'Awesome! I have tried a couple other non-silent HMX tactiles recently.',
  link_id: 't3_1twm1zh',
  parent_id: 't1_p2x62mp',
  permalink: '/r/MechanicalKeyboards/comments/1twm1zh/x/p2zcr74/',
};

afterEach(() => { global.fetch = realFetch; requests = []; });

// ---------------------------------------------------------------------------
// Validation & routing
// ---------------------------------------------------------------------------

describe('RedditSearchTool — validation & routing', () => {
  test('posts mode requires query, subreddit, or author', async () => {
    const tool = new RedditSearchTool();
    await assert.rejects(() => tool.execute({}), /requires at least one of/);
  });

  test('thread mode requires link_id', async () => {
    const tool = new RedditSearchTool();
    await assert.rejects(() => tool.execute({ mode: 'thread' }), /requires link_id/);
  });

  test('comments mode accepts link_id alone as its scope', async () => {
    stubFetch(() => okResponse({ data: [RAW_COMMENT] }));
    const tool = new RedditSearchTool();
    const res = await tool.execute({ mode: 'comments', link_id: 't3_1twm1zh' });
    assert.equal(res.source, 'arctic_shift');
    assert.match(requests[0].url.pathname, /\/api\/comments\/search$/);
    assert.equal(requests[0].url.searchParams.get('link_id'), '1twm1zh'); // t3_ stripped
  });

  test('schema validation — rejects bad enums and out-of-range limit', async () => {
    const tool = new RedditSearchTool();
    const isZod = (err) => err?.name === 'ZodError';
    await assert.rejects(() => tool.execute({ query: 'x', mode: 'threads' }), isZod);
    await assert.rejects(() => tool.execute({ query: 'x', limit: 0 }), isZod);
    await assert.rejects(() => tool.execute({ query: 'x', limit: 101 }), isZod);
    await assert.rejects(() => tool.execute({ query: 'x', source: 'reddit' }), isZod);
  });

  // PullPush is no longer tried automatically (it refuses automated clients as
  // of August 2026), but source:"pullpush" still reaches it unchanged.
  test('an explicit PullPush search sends the documented query shape', async () => {
    stubFetch(() => okResponse({ data: [RAW_POST], error: null }));
    const tool = new RedditSearchTool();
    const res = await tool.execute({ query: 'mechanical keyboard', source: 'pullpush' });
    assert.equal(res.source, 'pullpush');
    assert.equal(requests.length, 1, 'no Arctic Shift attempt');
    assert.match(requests[0].url.pathname, /\/reddit\/search\/submission\/$/);
    assert.equal(requests[0].url.searchParams.get('q'), 'mechanical keyboard');
    assert.equal(requests[0].url.searchParams.get('size'), '25');           // default limit
    assert.equal(requests[0].url.searchParams.get('sort'), 'desc');         // default sort
    assert.equal(requests[0].url.searchParams.get('sort_type'), 'created_utc');
  });

  test('subreddit-scoped keyword search routes to Arctic Shift', async () => {
    stubFetch(() => okResponse({ data: [RAW_POST] }));
    const tool = new RedditSearchTool();
    const res = await tool.execute({ query: 'switches', subreddit: 'MechanicalKeyboards', limit: 10, sort: 'asc' });
    assert.equal(res.source, 'arctic_shift');
    assert.match(requests[0].url.pathname, /\/api\/posts\/search$/);
    assert.equal(requests[0].url.searchParams.get('query'), 'switches');
    assert.equal(requests[0].url.searchParams.get('subreddit'), 'MechanicalKeyboards');
    assert.equal(requests[0].url.searchParams.get('limit'), '10');
    assert.equal(requests[0].url.searchParams.get('sort'), 'asc');
  });

  test('r/ and u/ prefixes are stripped from subreddit and author', async () => {
    stubFetch(() => okResponse({ data: [] }));
    const tool = new RedditSearchTool();
    const res = await tool.execute({ subreddit: 'r/keyboards', author: 'u/dovenyi' });
    assert.equal(requests[0].url.searchParams.get('subreddit'), 'keyboards');
    assert.equal(requests[0].url.searchParams.get('author'), 'dovenyi');
    assert.equal(res.subreddit, 'keyboards');
  });

  // PullPush used to be the automatic fallback here. It now refuses automated
  // clients outright, so falling back to it only spent a request and buried the
  // real Arctic Shift error behind a second failure.
  test('Arctic Shift failure surfaces directly rather than falling back to PullPush', async () => {
    stubFetch((url) => String(url).includes('arctic-shift')
      ? errResponse(500, 'Internal Server Error')
      : okResponse({ data: [RAW_POST], error: null }));
    const tool = new RedditSearchTool();
    await assert.rejects(
      () => tool.execute({ query: 'switches', subreddit: 'MechanicalKeyboards' }),
      /arctic_shift: HTTP 500/,
    );
    assert.equal(requests.length, 1, 'no PullPush attempt');
  });

  test('a failing archive surfaces its own error', async () => {
    stubFetch(() => errResponse(503, 'Service Unavailable'));
    const tool = new RedditSearchTool();
    await assert.rejects(
      () => tool.execute({ query: 'x', subreddit: 'foo' }),
      /All Reddit sources failed.*arctic_shift.*503/s,
    );
  });

  test('source:"arctic_shift" forced with an unscoped keyword search throws (documented constraint)', async () => {
    const tool = new RedditSearchTool();
    await assert.rejects(
      () => tool.execute({ query: 'x', source: 'arctic_shift' }),
      /cannot keyword-search across all of Reddit/,
    );
  });

  test('source:"pullpush" refuses thread mode', async () => {
    const tool = new RedditSearchTool();
    await assert.rejects(
      () => tool.execute({ mode: 'thread', link_id: '1twm1zh', source: 'pullpush' }),
      /thread mode requires Arctic Shift/,
    );
  });

  test('forced source does not fall back', async () => {
    stubFetch(() => errResponse(500, 'Internal Server Error'));
    const tool = new RedditSearchTool();
    await assert.rejects(
      () => tool.execute({ query: 'x', subreddit: 'foo', source: 'arctic_shift' }),
      /All Reddit sources failed — arctic_shift: HTTP 500/,
    );
    assert.equal(requests.length, 1, 'no PullPush attempt when a source is forced');
  });
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

describe('RedditSearchTool — normalization', () => {
  test('posts are reduced to the stable shape with a full reddit.com permalink', async () => {
    stubFetch(() => okResponse({ data: [RAW_POST] }));
    const tool = new RedditSearchTool();
    const res = await tool.execute({ subreddit: 'MechanicalKeyboards' });
    assert.equal(res.count, 1);
    const p = res.results[0];
    assert.equal(p.id, '1twm1zh');
    assert.equal(p.title, RAW_POST.title);
    assert.equal(p.score, 363);
    assert.equal(p.num_comments, 123);
    assert.equal(p.flair, 'Photos');
    assert.equal(p.created_iso, new Date(1780575000 * 1000).toISOString());
    assert.equal(p.permalink, `https://www.reddit.com${RAW_POST.permalink}`);
    assert.equal(p.selftext_truncated, false);
    assert.ok(Array.isArray(res.notes) && res.notes.length > 0, 'carries provenance notes');
  });

  test('selftext longer than 2000 chars is truncated with a flag', async () => {
    stubFetch(() => okResponse({ data: [{ ...RAW_POST, selftext: 'x'.repeat(5000) }] }));
    const tool = new RedditSearchTool();
    const res = await tool.execute({ subreddit: 'foo' });
    assert.equal(res.results[0].selftext.length, 2000);
    assert.equal(res.results[0].selftext_truncated, true);
  });

  test('comments mode normalizes body, strips t3_ from link_id', async () => {
    stubFetch(() => okResponse({ data: [RAW_COMMENT] }));
    const tool = new RedditSearchTool();
    const res = await tool.execute({ mode: 'comments', query: 'HMX', subreddit: 'MechanicalKeyboards' });
    assert.equal(requests[0].url.searchParams.get('body'), 'HMX'); // comments keyword param is `body`
    const c = res.results[0];
    assert.equal(c.body, RAW_COMMENT.body);
    assert.equal(c.link_id, '1twm1zh');
    assert.equal(c.parent_id, 't1_p2x62mp');
    assert.equal(c.permalink, `https://www.reddit.com${RAW_COMMENT.permalink}`);
  });

  test('missing fields normalize to null, not undefined-crashes', async () => {
    stubFetch(() => okResponse({ data: [{ id: 'abc' }] }));
    const tool = new RedditSearchTool();
    const res = await tool.execute({ subreddit: 'foo' });
    const p = res.results[0];
    assert.equal(p.title, null);
    assert.equal(p.selftext, null);
    assert.equal(p.permalink, null);
    assert.equal(p.created_iso, null);
  });
});

// ---------------------------------------------------------------------------
// Thread mode
// ---------------------------------------------------------------------------

describe('RedditSearchTool — thread mode', () => {
  const TREE = {
    data: [
      {
        kind: 't1',
        data: {
          ...RAW_COMMENT,
          replies: {
            kind: 'Listing',
            data: {
              children: [
                { kind: 't1', data: { ...RAW_COMMENT, id: 'child1', body: 'nested reply', replies: '' } },
                { kind: 'more', data: { count: 5, children: ['aaa', 'bbb'] } },
              ],
            },
          },
        },
      },
    ],
  };

  test('fetches the post and the comment tree, nesting replies', async () => {
    stubFetch((url) => String(url).includes('/api/posts/ids')
      ? okResponse({ data: [RAW_POST] })
      : okResponse(TREE));
    const tool = new RedditSearchTool();
    const res = await tool.execute({ mode: 'thread', link_id: 't3_1twm1zh', limit: 50 });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url.searchParams.get('ids'), '1twm1zh');       // bare id
    assert.equal(requests[1].url.searchParams.get('link_id'), 't3_1twm1zh'); // tree wants t3_
    assert.equal(requests[1].url.searchParams.get('limit'), '50');

    assert.equal(res.mode, 'thread');
    assert.equal(res.post.title, RAW_POST.title);
    assert.equal(res.comment_count, 1);
    const top = res.comments[0];
    assert.equal(top.body, RAW_COMMENT.body);
    assert.equal(top.replies.length, 2);
    assert.equal(top.replies[0].body, 'nested reply');
    assert.deepEqual(top.replies[0].replies, []);                    // "" replies → empty array
    assert.deepEqual(top.replies[1], { more_count: 5, more_ids: ['aaa', 'bbb'] });
  });

  test('unknown post id yields post:null rather than a crash', async () => {
    stubFetch((url) => String(url).includes('/api/posts/ids')
      ? okResponse({ data: [] })
      : okResponse({ data: [] }));
    const tool = new RedditSearchTool();
    const res = await tool.execute({ mode: 'thread', link_id: 'zzzzzz' });
    assert.equal(res.post, null);
    assert.equal(res.comment_count, 0);
  });
});

// ---------------------------------------------------------------------------
// PullPush specifics & error handling
// ---------------------------------------------------------------------------

describe('RedditSearchTool — PullPush specifics & errors', () => {
  test('ISO after/before dates are converted to epoch seconds for PullPush', async () => {
    stubFetch(() => okResponse({ data: [], error: null }));
    const tool = new RedditSearchTool();
    await tool.execute({ query: 'x', after: '2026-01-01T00:00:00.000Z', before: '2026-06-01', source: 'pullpush' });
    const params = requests[0].url.searchParams;
    assert.equal(params.get('after'), String(Math.floor(Date.parse('2026-01-01T00:00:00.000Z') / 1000)));
    assert.equal(params.get('before'), String(Math.floor(Date.parse('2026-06-01') / 1000)));
  });

  test('epoch and offset date forms pass through untouched to PullPush', async () => {
    stubFetch(() => okResponse({ data: [], error: null }));
    const tool = new RedditSearchTool();
    await tool.execute({ query: 'x', after: '1780575000', before: '7d', source: 'pullpush' });
    assert.equal(requests[0].url.searchParams.get('after'), '1780575000');
    assert.equal(requests[0].url.searchParams.get('before'), '7d');
  });

  test('Arctic Shift receives after/before verbatim (it accepts ISO and offsets natively)', async () => {
    stubFetch(() => okResponse({ data: [] }));
    const tool = new RedditSearchTool();
    await tool.execute({ subreddit: 'foo', after: '2026-01-01', before: '7d' });
    assert.equal(requests[0].url.searchParams.get('after'), '2026-01-01');
    assert.equal(requests[0].url.searchParams.get('before'), '7d');
  });

  test('unparseable date on the PullPush path throws a clear error', async () => {
    stubFetch(() => okResponse({ data: [], error: null }));
    const tool = new RedditSearchTool();
    await assert.rejects(
      () => tool.execute({ query: 'x', after: 'not-a-date', source: 'pullpush' }),
      /Unparseable date "not-a-date"/,
    );
  });

  test('PullPush logical error field is surfaced', async () => {
    stubFetch(() => okResponse({ data: [], error: 'query too complex' }));
    const tool = new RedditSearchTool();
    await assert.rejects(
      () => tool.execute({ query: 'x', source: 'pullpush' }),
      /PullPush error: query too complex/,
    );
  });

  test('HTTP 429 surfaces a rate-limit message with the reset hint', async () => {
    stubFetch(() => errResponse(429, 'Too Many Requests', { 'x-ratelimit-reset': '16' }));
    const tool = new RedditSearchTool({ retryDelayMs: 0 });
    await assert.rejects(
      () => tool.execute({ subreddit: 'foo', source: 'arctic_shift' }),
      /rate limited \(429\), retry in 16s/,
    );
    assert.equal(requests.length, 2, 'one retry, then gives up');
  });

  test('every request identifies itself with a User-Agent (Arctic Shift throttles UA-less clients)', async () => {
    stubFetch(() => okResponse({ data: [] }));
    const tool = new RedditSearchTool();
    await tool.execute({ subreddit: 'foo' });
    assert.match(requests[0].opts.headers['User-Agent'], /^CrawlForge\//);
  });

  test('a 429 body message (e.g. PullPush policy text) is passed through verbatim', async () => {
    stubFetch(() => ({
      ok: false, status: 429, statusText: 'Too Many Requests',
      headers: { get: () => null },
      json: async () => ({ error: 'This website does not provide free scraping resources for agents.' }),
    }));
    const tool = new RedditSearchTool({ retryDelayMs: 0 });
    await assert.rejects(
      () => tool.execute({ query: 'x', source: 'pullpush' }),
      /rate limited \(429\) — This website does not provide free scraping resources/,
    );
  });

  test('transient 429 recovers on the single retry', async () => {
    let calls = 0;
    stubFetch(() => (++calls === 1 ? errResponse(429, 'Too Many Requests') : okResponse({ data: [RAW_POST] })));
    const tool = new RedditSearchTool({ retryDelayMs: 0 });
    const res = await tool.execute({ subreddit: 'foo', source: 'arctic_shift' });
    assert.equal(res.count, 1);
    assert.equal(requests.length, 2);
  });

  test('Arctic Shift 422 "Timeout. Maybe slow down a bit" is retried; error carries the body detail', async () => {
    const throttled = () => ({
      ok: false, status: 422, statusText: 'Unprocessable Entity',
      headers: { get: () => null },
      text: async () => JSON.stringify({ data: null, error: 'Timeout. Maybe slow down a bit' }),
      json: async () => ({}),
    });
    let calls = 0;
    stubFetch(() => (++calls === 1 ? throttled() : okResponse({ data: [] })));
    const tool = new RedditSearchTool({ retryDelayMs: 0 });
    await tool.execute({ subreddit: 'foo', source: 'arctic_shift' });
    assert.equal(requests.length, 2, 'throttle response was retried');

    stubFetch(throttled);
    await assert.rejects(
      () => tool.execute({ subreddit: 'foo', source: 'arctic_shift' }),
      /HTTP 422 Unprocessable Entity: Timeout\. Maybe slow down a bit/,
    );
  });

  test('a non-retryable HTTP error is not retried', async () => {
    stubFetch(() => ({
      ok: false, status: 400, statusText: 'Bad Request',
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: "'query' query parameter requires one of: author, subreddit" }),
      json: async () => ({}),
    }));
    const tool = new RedditSearchTool({ retryDelayMs: 0 });
    await assert.rejects(
      () => tool.execute({ subreddit: 'foo', source: 'arctic_shift' }),
      /HTTP 400 Bad Request: 'query' query parameter requires/,
    );
    assert.equal(requests.length, 1, 'no retry on a 400');
  });

  test('timeout produces a clear message naming the configured budget', async () => {
    stubFetch(() => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); });
    const tool = new RedditSearchTool({ timeoutMs: 1234 });
    await assert.rejects(
      () => tool.execute({ subreddit: 'foo', source: 'arctic_shift' }),
      /timed out after 1234ms/,
    );
  });

  test('REDDIT_SEARCH_TIMEOUT_MS overrides the default; options still win', () => {
    const saved = process.env.REDDIT_SEARCH_TIMEOUT_MS;
    process.env.REDDIT_SEARCH_TIMEOUT_MS = '9000';
    try {
      assert.equal(new RedditSearchTool().timeoutMs, 9000);
      assert.equal(new RedditSearchTool({ timeoutMs: 5000 }).timeoutMs, 5000);
      process.env.REDDIT_SEARCH_TIMEOUT_MS = 'not-a-number';
      assert.equal(new RedditSearchTool().timeoutMs, 30000);
    } finally {
      if (saved === undefined) delete process.env.REDDIT_SEARCH_TIMEOUT_MS;
      else process.env.REDDIT_SEARCH_TIMEOUT_MS = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// Official Reddit Data API path (opt-in via REDDIT_CLIENT_ID/SECRET)
// ---------------------------------------------------------------------------

describe('RedditSearchTool — official API path', () => {
  const CREDS = { redditClientId: 'id', redditClientSecret: 'secret' };

  const tokenResponse = () => okResponse({ access_token: 'tok', token_type: 'bearer', expires_in: 3600 });
  const isToken = (url) => String(url).includes('/api/v1/access_token');
  const isOauth = (url) => String(url).includes('oauth.reddit.com');

  // Reddit listing/thread envelopes (Listing → children → {kind,data}).
  const listing = (children, after = null) => okResponse({ data: { after, children } });
  const THREAD = [
    { data: { children: [{ kind: 't3', data: RAW_POST }] } },
    { data: { children: [
      { kind: 't1', data: { ...RAW_COMMENT, replies: { kind: 'Listing', data: { children: [
        { kind: 't1', data: { ...RAW_COMMENT, id: 'child1', body: 'nested', replies: '' } },
        { kind: 'more', data: { count: 3, children: ['aaa'] } },
      ] } } } },
    ] } },
  ];

  test('configured: thread mode uses the official API first (token + oauth.reddit.com)', async () => {
    stubFetch((url) => isToken(url) ? tokenResponse() : okResponse(THREAD));
    const tool = new RedditSearchTool(CREDS);
    const res = await tool.execute({ mode: 'thread', link_id: 't3_1twm1zh', limit: 20 });

    assert.equal(res.source, 'reddit_api');
    assert.ok(requests.some((r) => isToken(r.url) && r.opts.method === 'POST'), 'fetched an OAuth token');
    const call = requests.find((r) => isOauth(r.url));
    assert.match(call.url.pathname, /\/comments\/1twm1zh$/); // t3_ stripped
    assert.equal(res.post.title, RAW_POST.title);
    assert.equal(res.comment_count, 1);
    assert.equal(res.comments[0].replies[0].body, 'nested');
    assert.deepEqual(res.comments[0].replies[1], { more_count: 3, more_ids: ['aaa'] });
  });

  test('configured: subreddit-scoped post search uses the official /r/{sr}/search endpoint', async () => {
    stubFetch((url) => isToken(url) ? tokenResponse() : listing([{ kind: 't3', data: RAW_POST }], 't3_next'));
    const tool = new RedditSearchTool(CREDS);
    const res = await tool.execute({ query: 'switches', subreddit: 'MechanicalKeyboards', limit: 10 });

    assert.equal(res.source, 'reddit_api');
    const call = requests.find((r) => isOauth(r.url));
    assert.match(call.url.pathname, /\/r\/MechanicalKeyboards\/search$/);
    assert.equal(call.url.searchParams.get('q'), 'switches');
    assert.equal(call.url.searchParams.get('restrict_sr'), 'true');
    assert.equal(res.results[0].id, '1twm1zh');
    assert.equal(res.after_cursor, 't3_next');
  });

  test('configured: unconfigured-style bearer request carries the token + a descriptive UA', async () => {
    stubFetch((url) => isToken(url) ? tokenResponse() : listing([]));
    const tool = new RedditSearchTool(CREDS);
    await tool.execute({ subreddit: 'foo' });
    const call = requests.find((r) => isOauth(r.url));
    assert.equal(call.opts.headers.Authorization, 'Bearer tok');
    assert.match(call.opts.headers['User-Agent'], /^CrawlForge\/.*; reddit\)$/);
  });

  test('auto: official-API failure falls back to the archive with fallback_used set', async () => {
    stubFetch((url) => {
      if (isToken(url)) return tokenResponse();
      if (isOauth(url)) return errResponse(500, 'Internal Server Error');
      return okResponse({ data: [RAW_POST] }); // arctic shift
    });
    const tool = new RedditSearchTool(CREDS);
    const res = await tool.execute({ query: 'switches', subreddit: 'MechanicalKeyboards' });
    assert.equal(res.source, 'arctic_shift');
    assert.match(res.fallback_used, /reddit_api: .*HTTP 500/);
  });

  test('auto: a date-range filter skips the official API (which cannot honor it) and uses the archive', async () => {
    stubFetch((url) => {
      if (isToken(url)) return tokenResponse();
      if (isOauth(url)) throw new Error('official API should not be called for a dated query');
      return okResponse({ data: [RAW_POST] }); // arctic shift
    });
    const tool = new RedditSearchTool(CREDS);
    const res = await tool.execute({ query: 'switches', subreddit: 'MechanicalKeyboards', after: '2026-01-01' });
    assert.equal(res.source, 'arctic_shift');
    assert.match(res.fallback_used, /reddit_api: .*date range/);
    assert.ok(!requests.some((r) => isOauth(r.url)), 'never issued an official-API data call');
  });

  test('source:"reddit_api" refuses comments mode (no official comment search)', async () => {
    const tool = new RedditSearchTool(CREDS);
    await assert.rejects(
      () => tool.execute({ query: 'HMX', subreddit: 'foo', mode: 'comments', source: 'reddit_api' }),
      /no comment full-text search/,
    );
  });

  test('source:"reddit_api" without credentials throws a setup hint', async () => {
    const tool = new RedditSearchTool(); // no creds
    await assert.rejects(
      () => tool.execute({ subreddit: 'foo', source: 'reddit_api' }),
      /needs Reddit app credentials.*REDDIT_CLIENT_ID/s,
    );
  });

  test('unconfigured tool never touches the official API', async () => {
    stubFetch(() => okResponse({ data: [RAW_POST] }));
    const tool = new RedditSearchTool(); // no creds
    await tool.execute({ subreddit: 'foo' });
    assert.ok(!requests.some((r) => isToken(r.url) || isOauth(r.url)), 'no OAuth/official calls');
    assert.match(requests[0].url.hostname, /arctic-shift/);
  });

  test('the OAuth token is cached across calls (one token fetch, two data calls)', async () => {
    stubFetch((url) => isToken(url) ? tokenResponse() : listing([{ kind: 't3', data: RAW_POST }]));
    const tool = new RedditSearchTool(CREDS);
    await tool.execute({ subreddit: 'foo', source: 'reddit_api' });
    await tool.execute({ subreddit: 'bar', source: 'reddit_api' });
    const tokenCalls = requests.filter((r) => isToken(r.url)).length;
    const dataCalls = requests.filter((r) => isOauth(r.url)).length;
    assert.equal(tokenCalls, 1, 'token fetched once and reused');
    assert.equal(dataCalls, 2, 'one data call per execute');
  });
});

// ---------------------------------------------------------------------------
// Reddit-wide keyword search: web discovery + archive hydration
// ---------------------------------------------------------------------------

/** A stub search adapter standing in for the metered web-search provider. */
const stubSearchAdapter = (links) => ({
  calls: [],
  async search(params) {
    this.calls.push(params);
    return { items: links.map(link => ({ link })) };
  },
});

describe('reddit_search Reddit-wide keyword search', () => {
  // PullPush began refusing automated clients in August 2026 ("This website
  // does not provide free scraping resources for agents"), which left an
  // unscoped keyword search with no backend: Arctic Shift rejects a keyword
  // query naming no subreddit or author.
  test('discovers posts through a web search and reads them from the archive', async () => {
    const adapter = stubSearchAdapter([
      'https://www.reddit.com/r/MechanicalKeyboards/comments/1twm1zh/bestselling/',
      'https://www.reddit.com/r/MechanicalKeyboards/',   // no post id — ignored
    ]);
    stubFetch(() => okResponse({ data: [RAW_POST] }));
    const tool = new RedditSearchTool({ searchAdapter: adapter });

    const result = await tool.execute({ query: 'keyboard switches', mode: 'posts', limit: 10 });

    assert.equal(result.source, 'web_discovery');
    assert.equal(result.count, 1);
    assert.equal(result.results[0].id, '1twm1zh');
    assert.equal(result.results[0].score, 363, 'must be a real archive row, not a search snippet');
    assert.match(adapter.calls[0].query, /^site:reddit\.com /);
    // Hydration must hit the archive's by-ID endpoint.
    assert.match(requests[0].url.pathname, /\/api\/posts\/ids$/);
  });

  test('returns results in web-search relevance order, not the archive order', async () => {
    const adapter = stubSearchAdapter([
      'https://www.reddit.com/r/x/comments/aaa111/first/',
      'https://www.reddit.com/r/x/comments/bbb222/second/',
    ]);
    // Archive answers in its own order — second hit first.
    stubFetch(() => okResponse({
      data: [{ ...RAW_POST, id: 'bbb222' }, { ...RAW_POST, id: 'aaa111' }],
    }));
    const tool = new RedditSearchTool({ searchAdapter: adapter });

    const result = await tool.execute({ query: 'anything', mode: 'posts', limit: 10 });
    assert.deepEqual(result.results.map(r => r.id), ['aaa111', 'bbb222']);
  });

  test('a scoped search still goes straight to the archive', async () => {
    const adapter = stubSearchAdapter(['https://www.reddit.com/r/x/comments/aaa111/first/']);
    stubFetch(() => okResponse({ data: [RAW_POST] }));
    const tool = new RedditSearchTool({ searchAdapter: adapter });

    const result = await tool.execute({
      query: 'switches', subreddit: 'MechanicalKeyboards', mode: 'posts', limit: 10,
    });

    assert.equal(result.source, 'arctic_shift');
    assert.equal(adapter.calls.length, 0, 'a scoped search must not spend a web search');
  });

  test('an unscoped comment search asks for a scope instead of failing opaquely', async () => {
    const tool = new RedditSearchTool({ searchAdapter: stubSearchAdapter([]) });
    await assert.rejects(
      () => tool.execute({ query: 'switches', mode: 'comments', limit: 10 }),
      /no available backend.*subreddit or author/s
    );
  });

  test('reports zero results rather than erroring when discovery finds no posts', async () => {
    const adapter = stubSearchAdapter(['https://www.reddit.com/r/MechanicalKeyboards/']);
    stubFetch(() => okResponse({ data: [RAW_POST] }));
    const tool = new RedditSearchTool({ searchAdapter: adapter });

    const result = await tool.execute({ query: 'nothing matches', mode: 'posts', limit: 10 });
    assert.equal(result.count, 0);
    assert.equal(requests.length, 0, 'nothing to hydrate, so the archive is never called');
  });

  test('source:"web_discovery" is refused for a scoped search it cannot serve', async () => {
    const tool = new RedditSearchTool({ searchAdapter: stubSearchAdapter([]) });
    await assert.rejects(
      () => tool.execute({ query: 'x', subreddit: 'y', mode: 'posts', source: 'web_discovery', limit: 10 }),
      /only serves unscoped keyword searches/
    );
  });
});


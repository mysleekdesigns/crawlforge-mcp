/**
 * Unit tests: serp_rank tool + DataForSEO SERP adapter
 *
 * Exercises the REAL SerpRankTool and DataForSEOSearchAdapter against a stubbed
 * global.fetch — no live network, so this runs under the default `npm run
 * test:unit` gate (which globs only tests/unit/*.test.js).
 *
 * Run: node --test tests/unit/serpRank.test.js
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SerpRankTool, assessSerpRelevance } from '../../src/tools/search/serpRank.js';
import { DataForSEOSearchAdapter } from '../../src/tools/search/adapters/dataforseoSearch.js';

// ---------------------------------------------------------------------------
// Fixtures & fetch stub
// ---------------------------------------------------------------------------

const realFetch = global.fetch;
let lastRequest = null;

/** Install a fake global.fetch. `impl(url, opts)` returns a Response-like object. */
function stubFetch(impl) {
  global.fetch = async (url, opts) => {
    lastRequest = { url, opts, body: opts?.body ? JSON.parse(opts.body) : null };
    return impl(url, opts);
  };
}

const okResponse = (data) => ({ ok: true, status: 200, statusText: 'OK', json: async () => data });
const errResponse = (status, statusText = '') => ({ ok: false, status, statusText, json: async () => ({}) });

/** A valid DataForSEO "Live Advanced" success envelope wrapping `items`. */
function envelope(items, { cost = 0.002, seResultsCount = 12300000, checkUrl = 'https://www.google.com/search?q=kw' } = {}) {
  return {
    status_code: 20000,
    status_message: 'Ok.',
    cost,
    tasks: [{
      status_code: 20000,
      status_message: 'Ok.',
      cost,
      result: [{ keyword: 'kw', se_results_count: seResultsCount, check_url: checkUrl, items }],
    }],
  };
}

// competitor #1, a featured snippet (non-organic), target #2, a PAA block
// (non-organic), and a target SUBDOMAIN #3.
const SAMPLE_ITEMS = [
  { type: 'organic', rank_group: 1, rank_absolute: 1, domain: 'competitor.com', url: 'https://competitor.com/', title: 'Competitor', description: 'c' },
  { type: 'featured_snippet', rank_group: 1, rank_absolute: 2, domain: 'wikipedia.org' },
  { type: 'organic', rank_group: 2, rank_absolute: 3, domain: 'target.com', url: 'https://target.com/hosting', title: 'Target Hosting', description: 't' },
  { type: 'people_also_ask', rank_absolute: 4 },
  { type: 'organic', rank_group: 3, rank_absolute: 5, domain: 'blog.target.com', url: 'https://blog.target.com/guide', title: 'Target Blog', description: 'b' },
];

afterEach(() => { global.fetch = realFetch; lastRequest = null; });

// ---------------------------------------------------------------------------
// DataForSEOSearchAdapter
// ---------------------------------------------------------------------------

describe('DataForSEOSearchAdapter', () => {
  test('constructor requires credentials', () => {
    assert.throws(() => new DataForSEOSearchAdapter('', 'pw'), /credentials are required/);
    assert.throws(() => new DataForSEOSearchAdapter('login', ''), /credentials are required/);
  });

  test('constructor builds an HTTP Basic auth header', () => {
    const a = new DataForSEOSearchAdapter('user', 'pass');
    const expected = 'Basic ' + Buffer.from('user:pass').toString('base64');
    assert.equal(a.authHeader, expected);
    assert.equal(a.timeoutMs, 120000); // default
  });

  test('DATAFORSEO_TIMEOUT_MS overrides the default; options still win', () => {
    const saved = process.env.DATAFORSEO_TIMEOUT_MS;
    process.env.DATAFORSEO_TIMEOUT_MS = '90000';
    try {
      assert.equal(new DataForSEOSearchAdapter('u', 'p').timeoutMs, 90000);
      assert.equal(new DataForSEOSearchAdapter('u', 'p', { timeoutMs: 5000 }).timeoutMs, 5000);
      process.env.DATAFORSEO_TIMEOUT_MS = 'not-a-number';
      assert.equal(new DataForSEOSearchAdapter('u', 'p').timeoutMs, 120000); // falls back
    } finally {
      if (saved === undefined) delete process.env.DATAFORSEO_TIMEOUT_MS;
      else process.env.DATAFORSEO_TIMEOUT_MS = saved;
    }
  });

  test('search() requires a keyword', async () => {
    const a = new DataForSEOSearchAdapter('u', 'p');
    await assert.rejects(() => a.search({}), /keyword is required/);
  });

  test('happy path — posts [task] to the Live Advanced endpoint with Basic auth', async () => {
    stubFetch(() => okResponse(envelope(SAMPLE_ITEMS)));
    const a = new DataForSEOSearchAdapter('u', 'p');
    await a.search({ keyword: 'managed hosting' });

    assert.match(lastRequest.url, /\/v3\/serp\/google\/organic\/live\/advanced$/);
    assert.equal(lastRequest.opts.method, 'POST');
    assert.equal(lastRequest.opts.headers.Authorization, 'Basic ' + Buffer.from('u:p').toString('base64'));
    assert.ok(Array.isArray(lastRequest.body), 'body is an array of task objects');
    assert.equal(lastRequest.body[0].keyword, 'managed hosting');
    assert.equal(lastRequest.body[0].location_name, 'United States'); // default
    assert.equal(lastRequest.body[0].device, 'desktop');              // default
    assert.equal(lastRequest.body[0].depth, 30);                      // default
    assert.equal(lastRequest.body[0].language_code, 'en');            // default
  });

  test('normalizes only organic items and maps rank fields', async () => {
    stubFetch(() => okResponse(envelope(SAMPLE_ITEMS)));
    const a = new DataForSEOSearchAdapter('u', 'p');
    const { items, meta } = await a.search({ keyword: 'kw' });

    assert.equal(items.length, 3, 'drops featured_snippet + people_also_ask');
    assert.deepEqual(items.map((i) => i.domain), ['competitor.com', 'target.com', 'blog.target.com']);
    assert.equal(items[1].position, 2);        // rank_group
    assert.equal(items[1].rankAbsolute, 3);    // rank_absolute
    assert.equal(items[1].url, 'https://target.com/hosting');
    assert.equal(items[1].snippet, 't');       // description
    assert.equal(meta.organicCount, 3);
    assert.equal(meta.seResultsCount, 12300000);
    assert.equal(meta.checkUrl, 'https://www.google.com/search?q=kw');
    assert.equal(meta.cost, 0.002);
    assert.equal(meta.location, 'United States');
  });

  test('organic item without rank_group maps position to null; missing domain → empty string', async () => {
    const items = [
      { type: 'organic', rank_absolute: 4, domain: 'target.com', url: 'https://target.com/a', title: 'A' }, // no rank_group
      { type: 'organic', rank_group: 2, rank_absolute: 2, url: 'https://nodomain.example/x', title: 'B' },   // no domain
    ];
    stubFetch(() => okResponse(envelope(items)));
    const a = new DataForSEOSearchAdapter('u', 'p');
    const { items: out } = await a.search({ keyword: 'kw' });
    assert.equal(out[0].position, null);      // rank_group ?? null
    assert.equal(out[0].rankAbsolute, 4);
    assert.equal(out[1].domain, '');          // (it.domain || '')
  });

  test('location_code overrides location_name in the request body', async () => {
    stubFetch(() => okResponse(envelope([])));
    const a = new DataForSEOSearchAdapter('u', 'p');
    await a.search({ keyword: 'kw', locationCode: 2840, locationName: 'United States' });
    assert.equal(lastRequest.body[0].location_code, 2840);
    assert.equal(lastRequest.body[0].location_name, undefined);
  });

  test('empty / missing items yields an empty array (not a throw)', async () => {
    stubFetch(() => okResponse(envelope([])));
    const a = new DataForSEOSearchAdapter('u', 'p');
    const { items, meta } = await a.search({ keyword: 'kw' });
    assert.deepEqual(items, []);
    assert.equal(meta.organicCount, 0);
  });

  test('HTTP 401 → clear credentials error', async () => {
    stubFetch(() => errResponse(401, 'Unauthorized'));
    const a = new DataForSEOSearchAdapter('u', 'p');
    await assert.rejects(() => a.search({ keyword: 'kw' }), /Invalid DataForSEO credentials/);
  });

  test('HTTP 402 → insufficient funds error', async () => {
    stubFetch(() => errResponse(402, 'Payment Required'));
    const a = new DataForSEOSearchAdapter('u', 'p');
    await assert.rejects(() => a.search({ keyword: 'kw' }), /insufficient funds/);
  });

  test('HTTP 429 → rate limit error', async () => {
    stubFetch(() => errResponse(429, 'Too Many Requests'));
    const a = new DataForSEOSearchAdapter('u', 'p');
    await assert.rejects(() => a.search({ keyword: 'kw' }), /rate limit exceeded/);
  });

  test('other non-ok HTTP → surfaces status + statusText', async () => {
    stubFetch(() => errResponse(500, 'Internal Server Error'));
    const a = new DataForSEOSearchAdapter('u', 'p');
    await assert.rejects(() => a.search({ keyword: 'kw' }), /500 Internal Server Error/);
  });

  test('envelope status_code !== 20000 → logical error', async () => {
    stubFetch(() => okResponse({ status_code: 40200, status_message: 'Access denied.', tasks: [] }));
    const a = new DataForSEOSearchAdapter('u', 'p');
    await assert.rejects(() => a.search({ keyword: 'kw' }), /40200: Access denied/);
  });

  test('task status_code !== 20000 → task error', async () => {
    stubFetch(() => okResponse({
      status_code: 20000, status_message: 'Ok.',
      tasks: [{ status_code: 40501, status_message: 'Invalid Field.' }],
    }));
    const a = new DataForSEOSearchAdapter('u', 'p');
    await assert.rejects(() => a.search({ keyword: 'kw' }), /task error 40501: Invalid Field/);
  });

  test('network failure → wrapped network error', async () => {
    stubFetch(() => { throw new Error('ECONNREFUSED'); });
    const a = new DataForSEOSearchAdapter('u', 'p');
    await assert.rejects(() => a.search({ keyword: 'kw' }), /Network error connecting to DataForSEO: ECONNREFUSED/);
  });

  test('timeout (AbortSignal.timeout) → clear timeout error', async () => {
    stubFetch(() => { throw Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }); });
    const a = new DataForSEOSearchAdapter('u', 'p', { timeoutMs: 1234 });
    await assert.rejects(() => a.search({ keyword: 'kw' }), /timed out after 1234ms/);
  });

  test('AbortError is treated as a timeout too', async () => {
    stubFetch(() => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
    const a = new DataForSEOSearchAdapter('u', 'p', { timeoutMs: 555 });
    await assert.rejects(() => a.search({ keyword: 'kw' }), /timed out after 555ms/);
  });
});

// ---------------------------------------------------------------------------
// SerpRankTool
// ---------------------------------------------------------------------------

describe('SerpRankTool', () => {
  test('unconfigured → { configured:false }, normalized target, no network call', async () => {
    const savedLogin = process.env.DATAFORSEO_LOGIN;
    const savedPw = process.env.DATAFORSEO_PASSWORD;
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
    let called = false;
    stubFetch(() => { called = true; return okResponse(envelope([])); });
    try {
      const tool = new SerpRankTool();
      const res = await tool.execute({ keyword: 'x', target: 'https://www.Example.com/path?q=1' });
      assert.equal(res.configured, false);
      assert.equal(res.target, 'example.com'); // host-only, lowercased, www + scheme + path stripped
      assert.match(res.note, /DATAFORSEO_LOGIN/);
      assert.equal(called, false, 'must not hit the network when unconfigured');
    } finally {
      if (savedLogin !== undefined) process.env.DATAFORSEO_LOGIN = savedLogin;
      if (savedPw !== undefined) process.env.DATAFORSEO_PASSWORD = savedPw;
    }
  });

  test('configured — finds the target, best position first, includes subdomain hits', async () => {
    stubFetch(() => okResponse(envelope(SAMPLE_ITEMS)));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    const res = await tool.execute({ keyword: 'managed hosting', target: 'target.com' });

    assert.equal(res.configured, true);
    assert.equal(res.found, true);
    assert.equal(res.position, 2);                       // best organic rank
    assert.equal(res.rankAbsolute, 3);
    assert.equal(res.url, 'https://target.com/hosting');
    assert.equal(res.allPositions.length, 2, 'target.com (2) + blog.target.com (3, subdomain)');
    assert.deepEqual(res.allPositions.map((m) => m.position), [2, 3]); // sorted best-first
    assert.equal(res.cost, 0.002);
    assert.equal(res.organicResults, 3);
    assert.ok(res.checkedAt);
  });

  test('configured — returns the SERP listing (results[]) of top organic competitors, best-first', async () => {
    stubFetch(() => okResponse(envelope(SAMPLE_ITEMS)));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    const res = await tool.execute({ keyword: 'managed hosting', target: 'target.com' });

    // All three ORGANIC items (the featured_snippet + people_also_ask are dropped),
    // in rank order — the full first-page listing, not just the target.
    assert.equal(res.results.length, 3);
    assert.deepEqual(res.results.map((r) => r.domain), ['competitor.com', 'target.com', 'blog.target.com']);
    assert.deepEqual(res.results.map((r) => r.position), [1, 2, 3]);
    // Each result carries the display shape the dashboard needs.
    assert.deepEqual(res.results[0], {
      position: 1,
      rankAbsolute: 1,
      domain: 'competitor.com',
      url: 'https://competitor.com/',
      title: 'Competitor',
      snippet: 'c',
    });
  });

  test('configured — results[] is bounded to the top 10 organic hits', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      type: 'organic',
      rank_group: i + 1,
      rank_absolute: i + 1,
      domain: `site${i + 1}.com`,
      url: `https://site${i + 1}.com/`,
      title: `Site ${i + 1}`,
      description: `d${i + 1}`,
    }));
    stubFetch(() => okResponse(envelope(many)));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    const res = await tool.execute({ keyword: 'kw', target: 'absent.com', depth: 100 });
    assert.equal(res.results.length, 10, 'caps at the first page');
    assert.deepEqual(res.results.map((r) => r.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(res.organicResults, 15, 'organicResults still reflects the full count');
  });

  test('configured — target absent still returns the competitor listing', async () => {
    stubFetch(() => okResponse(envelope(SAMPLE_ITEMS)));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    const res = await tool.execute({ keyword: 'kw', target: 'absent.com' });
    assert.equal(res.found, false);
    assert.deepEqual(res.allPositions, []);
    assert.equal(res.results.length, 3, 'the SERP listing is independent of the target');
  });

  test('configured — allPositions is sorted best-first even when the SERP returns hits out of order', async () => {
    // target hits arrive DESCENDING (rank 5 before rank 2): a passing assertion
    // here requires serpRank.js's .sort() to actually run — not a pre-sorted fixture.
    const unordered = [
      { type: 'organic', rank_group: 5, rank_absolute: 8, domain: 'target.com', url: 'https://target.com/deep', title: 'Deep' },
      { type: 'organic', rank_group: 1, rank_absolute: 1, domain: 'competitor.com', url: 'https://competitor.com/', title: 'C' },
      { type: 'organic', rank_group: 2, rank_absolute: 3, domain: 'target.com', url: 'https://target.com/top', title: 'Top' },
    ];
    stubFetch(() => okResponse(envelope(unordered)));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    const res = await tool.execute({ keyword: 'kw', target: 'target.com' });
    assert.deepEqual(res.allPositions.map((m) => m.position), [2, 5]); // sorted, not [5, 2]
    assert.equal(res.position, 2);                                     // best = lowest rank
    assert.equal(res.url, 'https://target.com/top');                  // best hit's URL, not the rank-5 one
  });

  test('configured — a null-rank hit sorts to the end, numeric rank wins "best"', async () => {
    const withNull = [
      { type: 'organic', rank_absolute: 9, domain: 'target.com', url: 'https://target.com/norank', title: 'NoRank' }, // no rank_group
      { type: 'organic', rank_group: 4, rank_absolute: 6, domain: 'target.com', url: 'https://target.com/four', title: 'Four' },
    ];
    stubFetch(() => okResponse(envelope(withNull)));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    const res = await tool.execute({ keyword: 'kw', target: 'target.com' });
    assert.equal(res.position, 4);                                     // numeric beats null (Infinity)
    assert.deepEqual(res.allPositions.map((m) => m.position), [4, null]);
  });

  test('configured — target absent from SERP → found:false, position:null', async () => {
    stubFetch(() => okResponse(envelope(SAMPLE_ITEMS)));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    const res = await tool.execute({ keyword: 'kw', target: 'absent.com' });
    assert.equal(res.found, false);
    assert.equal(res.position, null);
    assert.equal(res.rankAbsolute, null);
    assert.deepEqual(res.allPositions, []);
  });

  test('target given as a full URL is normalized before matching', async () => {
    stubFetch(() => okResponse(envelope(SAMPLE_ITEMS)));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    const res = await tool.execute({ keyword: 'kw', target: 'https://www.Target.com/hosting' });
    assert.equal(res.target, 'target.com');
    assert.equal(res.found, true);
    assert.equal(res.position, 2);
  });

  test('passes location_code / device / depth through to the adapter request', async () => {
    stubFetch(() => okResponse(envelope([])));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    await tool.execute({ keyword: 'kw', target: 'target.com', location_code: 2826, device: 'mobile', depth: 200 });
    assert.equal(lastRequest.body[0].location_code, 2826);
    assert.equal(lastRequest.body[0].device, 'mobile');
    assert.equal(lastRequest.body[0].depth, 200);
  });

  test('bare "host?query" target (no path) is normalized — covers the split("?") branch', async () => {
    stubFetch(() => okResponse(envelope([])));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    const res = await tool.execute({ keyword: 'kw', target: 'https://Target.com?utm=x' });
    assert.equal(res.target, 'target.com'); // scheme + query stripped, lowercased
  });

  test('a URL target matches by host, not by exact URL — any page on the host counts', async () => {
    stubFetch(() => okResponse(envelope(SAMPLE_ITEMS)));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    // This exact page is nowhere on the SERP; target.com/hosting and blog.target.com still match.
    const res = await tool.execute({ keyword: 'kw', target: 'https://target.com/not-on-the-serp' });
    assert.equal(res.found, true);
    assert.equal(res.url, 'https://target.com/hosting');
    assert.deepEqual(res.allPositions.map((m) => m.url), ['https://target.com/hosting', 'https://blog.target.com/guide']);
  });

  test('a subdomain target narrows the match to that subdomain', async () => {
    stubFetch(() => okResponse(envelope(SAMPLE_ITEMS)));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    const res = await tool.execute({ keyword: 'kw', target: 'blog.target.com' });
    assert.deepEqual(res.allPositions.map((m) => m.position), [3]);
  });

  test('port, fragment and userinfo are dropped from the target, as the REST route does', async () => {
    stubFetch(() => okResponse(envelope(SAMPLE_ITEMS)));
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    for (const target of ['target.com:443', 'https://target.com:8443/x', 'https://target.com#top', 'http://user@www.target.com/x']) {
      const res = await tool.execute({ keyword: 'kw', target });
      assert.equal(res.target, 'target.com', target);
      assert.equal(res.found, true, target);
    }
  });

  test('schema validation — rejects with a ZodError on bad input', async () => {
    const tool = new SerpRankTool({ login: 'l', password: 'p' });
    const isZod = (err) => err?.name === 'ZodError';
    await assert.rejects(() => tool.execute({ target: 'x' }), isZod);              // no keyword
    await assert.rejects(() => tool.execute({ keyword: 'x' }), isZod);             // no target
    await assert.rejects(() => tool.execute({ keyword: 'k', target: 't', device: 'tablet' }), isZod); // bad enum
    await assert.rejects(() => tool.execute({ keyword: 'k', target: 't', depth: 5 }), isZod);         // below min 10
    await assert.rejects(() => tool.execute({ keyword: 'k', target: 't', depth: 201 }), isZod);       // above max 200
  });
});

// ---------------------------------------------------------------------------
// Decoy-SERP check
// ---------------------------------------------------------------------------

// The two serp_rank samples of 2026-10-19 for keyword "crawlforge", a minute
// apart. Search Console had crawlforge.dev at #1 for it all month.
const DECOY_SAMPLE = [
  { title: 'coleam00/mcp-crawl4ai-rag: Web Crawling and ...', url: 'https://github.com/coleam00/mcp-crawl4ai-rag', snippet: 'This MCP server provides tools that enable AI agents to crawl websites, store content in a vector database (Supabase), and perform RAG over the crawled content.' },
  { title: 'AI Skills, MCP Tools & Agent Capabilities - UtilityHub', url: 'https://utilityhub.site/skills', snippet: 'The official Model Context Protocol server for secure filesystem access.' },
  { title: 'Crawl4AI MCP Server', url: 'https://mcpservers.org/servers/walksoda/crawl-mcp', snippet: 'An MCP server for advanced web crawling, content extraction, and AI-powered analysis using the crawl4ai library.' },
  { title: 'Comment “scrape” I\'ll send it over Someone just open- ...', url: 'https://www.instagram.com/reel/DX5LNQ6AZ9Z/', snippet: 'One command to deploy. MIT licensed. 88K stars, 14K forks.' },
  { title: 'Free Developer Tools', url: 'https://textforge.net/tools', snippet: 'Free Developer Tools. Practical tools for developers working with MCP servers and AI agents.' },
  { title: '3 Web Scraping Tools for AI Agents', url: 'https://www.youtube.com/watch?v=DU4-1W2TjOk', snippet: null },
  { title: 'Crawl a documentation site - AI Agent Skill Task', url: 'https://www.openagentskill.com/tasks/crawl-documentation-site', snippet: 'Find skills for crawling docs, converting HTML to markdown, preserving links.' },
  { title: 'ClawForge: AI Agent Tool Orchestration & Workflow ...', url: 'https://mcpmarket.com/server/clawforge', snippet: 'ClawForge serves as an open-source, event-driven tool orchestration framework.' },
  { title: 'Crawler Access for AI SEO (GPTBot & ClaudeBot)', url: 'https://www.searchbloom.com/ai-seo/inclusion/crawler-access/', snippet: 'AI Search pulls content from owned pages through crawlers run by each major AI vendor.' },
  { title: 'Crawl4AI', url: 'https://mcpservers.org/servers/brettdavies/crawl4ai-skill', snippet: 'Web scraping skill for Claude AI.' },
];
const GOOD_SAMPLE = [
  { title: 'CrawlForge MCP', url: 'https://www.crawlforge.dev/', snippet: 'MCP server with 31 web scraping tools for AI agents.' },
  { title: 'CrawlForge — What changed on your sites since last week', url: 'https://crawlforge.org/', snippet: 'Technical auditing for people who run many sites.' },
  { title: 'Official AgentQL MCP Server', url: 'https://mcpservers.org/servers/tinyfish-io/agentql-mcp', snippet: 'Enable AI agents to get structured data from unstructured web with AgentQL.' },
  { title: 'CrawlForge MCP — Forge any website into clean data for AI agents', url: 'https://www.youtube.com/watch?v=x3Hz1Qq3JO4', snippet: 'CrawlForge MCP is an open-source MCP server.' },
  { title: 'The CrawlForge crawler', url: 'https://crawlforge.org/bot/', snippet: 'CrawlForge is not a service with a fleet of crawlers.' },
  { title: 'crawlforge agent fails', url: 'https://www.youtube.com/watch?v=f0j-wLVP4ZE', snippet: 'Here are three ways agents break on the web.' },
  { title: 'https://github.com/mysleekdesigns/crawlforge-mcp.git', url: 'https://github.com/mysleekdesigns/crawlforge-mcp.git', snippet: 'No information is available for this page.' },
  { title: 'Home - Crawl4AI Documentation (v0.9.x)', url: 'https://docs.crawl4ai.com/', snippet: 'Crawl4AI turns any website into clean, LLM-ready Markdown.' },
];

describe('assessSerpRelevance', () => {
  test('flags the 2026-10-19 decoy sample: none of the top 10 mention the keyword', () => {
    assert.deepEqual(assessSerpRelevance('crawlforge', DECOY_SAMPLE), { checked: 10, matching: 0, suspect: true });
  });

  test('passes the good sample from a minute later', () => {
    assert.deepEqual(assessSerpRelevance('crawlforge', GOOD_SAMPLE), { checked: 8, matching: 6, suspect: false });
  });

  test('ignores stopwords and short words, so "how to" cannot make a decoy pass', () => {
    const results = [1, 2, 3].map((n) => ({ title: `How to do thing ${n}`, url: `https://x${n}.example/`, snippet: '' }));
    assert.equal(assessSerpRelevance('how to bake sourdough', results).suspect, true);
  });

  test('matches keyword words in the URL, case-insensitively', () => {
    const results = [1, 2, 3].map((n) => ({ title: 'Home', url: `https://Sourdough${n}.example/`, snippet: '' }));
    assert.equal(assessSerpRelevance('Sourdough', results).suspect, false);
  });

  test('matches non-Latin keywords', () => {
    const results = [1, 2, 3].map((n) => ({ title: `网络爬虫 教程 ${n}`, url: `https://x${n}.example/`, snippet: '' }));
    assert.equal(assessSerpRelevance('网络爬虫', results).suspect, false);
  });

  test('does not judge a keyword with no usable word, or fewer than 3 results', () => {
    assert.equal(assessSerpRelevance('hp', DECOY_SAMPLE), null);
    assert.equal(assessSerpRelevance('crawlforge', DECOY_SAMPLE.slice(0, 2)), null);
  });
});

describe('SerpRankTool decoy flag', () => {
  const asItems = (sample) => sample.map((r, i) => ({
    type: 'organic', rank_group: i + 1, rank_absolute: i + 1,
    domain: new URL(r.url).hostname, url: r.url, title: r.title, description: r.snippet,
  }));

  test('a decoy SERP comes back suspect, with a warning', async () => {
    stubFetch(async () => okResponse(envelope(asItems(DECOY_SAMPLE))));
    const tool = new SerpRankTool({ login: 'u', password: 'p' });
    const out = await tool.execute({ keyword: 'crawlforge', target: 'crawlforge.dev' });
    assert.equal(out.suspect, true);
    assert.match(out.warnings[0], /0 of the top 10 mention it/);
  });

  test('a normal SERP is not suspect and carries no warnings', async () => {
    stubFetch(async () => okResponse(envelope(asItems(GOOD_SAMPLE))));
    const tool = new SerpRankTool({ login: 'u', password: 'p' });
    const out = await tool.execute({ keyword: 'crawlforge', target: 'crawlforge.dev' });
    assert.equal(out.suspect, false);
    assert.equal(out.warnings, undefined);
  });
});

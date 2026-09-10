/**
 * Round 20 regressions (2026-09-07, retail / travel / aviation sweep on
 * mcp-server 6.3.1 — 415 URLs pre-flighted, all 30 tools live).
 *
 * D1  SitemapParser threw on boeing.com's relative <loc> entries ("/",
 *     "/commercial") and discarded the whole 1,878-URL sitemap; map_site fell
 *     back to crawling links and returned 75.
 * D2  Main-content extraction dropped WestJet's checked-bag fee table: 6 rows
 *     × 3 columns inside a `com-tabs` component, too small for Readability's
 *     data-table test, so the page read "fees are as follows:" and stopped.
 * D3  scrape_with_actions on support.southwest.com's JS help centre returned
 *     body text with `html: ""` and the "Content not available in markdown
 *     format" placeholder, as success.
 * D4  agent planned only the bare entity query for "what does Southwest charge
 *     for a first checked bag" and answered that the fee is not stated.
 * G1  get_batch_results had no inline threshold (a 111 KB page came whole).
 * G2  extract_links counted a javascript: pseudo-link as an external link.
 * G3  crawl_deep content previews were the page chrome on every page.
 * G4  reddit_search's 422 with a caller-chosen window carried the generic
 *     "add subreddit or author" hint on an already-scoped search.
 * G5  A table whose first row opens with an empty corner <td> flattened to
 *     text lines instead of rendering as a pipe table.
 *
 * Run: node --test --test-force-exit tests/unit/round20-regressions.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { SitemapParser } = await import('../../src/utils/sitemapParser.js');
const { recoverDroppedTables, extractMainContent } = await import('../../src/tools/scrape/_mainContent.js');
const { htmlToMarkdown, promoteCornerHeaderCells } = await import('../../src/utils/htmlToMarkdown.js');
const { INLINE_THRESHOLD_TOOLS } = await import('../../src/server/inlineThreshold.js');
const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');
const { ScrapeWithActionsTool } = await import('../../src/tools/advanced/ScrapeWithActionsTool.js');
const { RedditSearchTool } = await import('../../src/tools/search/redditSearch.js');
const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');
const { extractLinksHandler } = await import('../../src/tools/basic/extractLinks.js');

// ── D1: relative <loc> in a sitemap ───────────────────────────────────────────

describe('D1: SitemapParser resolves relative <loc> entries against the sitemap URL', () => {
  const parser = new SitemapParser({ enableCaching: false });

  test('a urlset written with relative paths yields absolute URLs, and one bad entry does not sink the rest', async () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>/</loc></url>
      <url><loc>/commercial</loc></url>
      <url><loc>/commercial/737max</loc><lastmod>2026-08-01</lastmod></url>
      <url><loc>http://</loc></url>
      <url><loc>https://www.boeing.com/defense</loc></url>
    </urlset>`;
    const result = await parser._parseSitemapContent(xml, 'https://www.boeing.com/sitemap.xml', {});
    assert.deepEqual(result.urls.map((u) => u.loc), [
      'https://www.boeing.com/',
      'https://www.boeing.com/commercial',
      'https://www.boeing.com/commercial/737max',
      'https://www.boeing.com/defense'
    ]);
    assert.equal(result.urls[2].lastmod, '2026-08-01');
  });

  test('a sitemap index written with relative paths resolves too', async () => {
    const xml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>/content/us/en.sitemap.xml</loc></sitemap>
      <sitemap><loc></loc></sitemap>
    </sitemapindex>`;
    const result = await parser._parseSitemapContent(xml, 'https://www.boeing.com/sitemap-index.xml', {});
    assert.deepEqual(result.sitemaps, ['https://www.boeing.com/content/us/en.sitemap.xml']);
  });
});

// ── D2 / G5: small headed tables survive main-content extraction ─────────────

const WESTJET_FEES = `<div class="com-tabs"><div role="tabpanel" class="cmp-tabs__tabpanel cmp-tabs__tabpanel--active">
  <div class="com-component com-par"><div class="com-text">
    <table cellpadding="1" cellspacing="0" border="1"><tbody>
      <tr><td> </td><th scope="col">1<sup>st</sup> Bag</th><th scope="col">2<sup>nd</sup> Bag</th></tr>
      <tr><th scope="row">UltraBasic</th><td>$55-65</td><td>$70-83</td></tr>
      <tr><th scope="row">Econo or Member Exclusive</th><td>$45-53</td><td>$60-71</td></tr>
      <tr><th scope="row">Econoflex</th><td>$0</td><td>$60-71</td></tr>
      <tr><th scope="row">Premium or PremiumFlex</th><td>$0</td><td>$0</td></tr>
      <tr><th scope="row">Business or BusinessFlex</th><td>$0</td><td>$0</td></tr>
    </tbody></table>
  </div></div></div></div>`;

const ARTICLE = `<p>${'Prepay online up to 24 hours before your flight for the lowest price on your first or second checked bags. '.repeat(30)}</p>`;

describe('D2: a table with header cells is recovered whatever its size', () => {
  test('recoverDroppedTables returns a 6×3 <th> table Readability did not keep', () => {
    const html = `<html><body><main><h1>Baggage</h1>${ARTICLE}<p>Additional standard Checked Bag fees when you prepay are as follows:</p>${WESTJET_FEES}</main></body></html>`;
    const dropped = recoverDroppedTables(html, 'https://www.westjet.com/en-ca/baggage', 'Baggage prepay online');
    assert.equal(dropped.length, 1);
    assert.match(dropped[0].text, /UltraBasic \| \$55-65 \| \$70-83/);
  });

  test('a layout table with no <th> and under the size bar is still left alone', () => {
    const html = `<html><body>${ARTICLE}<table><tr><td>Home</td><td>About</td></tr><tr><td>Contact</td><td>Jobs</td></tr></table></body></html>`;
    assert.deepEqual(recoverDroppedTables(html, 'https://example.com/', 'Prepay online'), []);
  });

  test('extractMainContent re-attaches the fee table so the fees are in the main content', () => {
    const html = `<html><head><title>Baggage</title></head><body><nav><a href="/">Home</a></nav><main><h1>Baggage</h1>${ARTICLE}<p>Additional standard Checked Bag fees when you prepay are as follows:</p>${WESTJET_FEES}</main><footer>© WestJet</footer></body></html>`;
    const main = extractMainContent(html, 'https://www.westjet.com/en-ca/baggage');
    assert.ok(main.html, 'Readability found an article');
    assert.ok(main.html.includes('$55-65'), 'the fee table is in the main content');
  });
});

describe('G5: an empty corner <td> in an otherwise all-<th> first row renders as a pipe table', () => {
  test('promoteCornerHeaderCells turns the corner cell into <th>', () => {
    const out = promoteCornerHeaderCells(WESTJET_FEES);
    assert.match(out, /<tr><th> <\/th><th scope="col">1<sup>st<\/sup> Bag<\/th>/);
  });

  test('a first row with a non-empty <td> is not touched', () => {
    const html = '<table><tr><td>Name</td><th>Fee</th></tr><tr><td>Bag</td><td>$45</td></tr></table>';
    assert.equal(promoteCornerHeaderCells(html), html);
  });

  test('htmlToMarkdown renders the fee table with its columns', () => {
    const md = htmlToMarkdown(WESTJET_FEES);
    assert.match(md, /\| UltraBasic \| \$55-65 \| \$70-83 \|/);
    assert.match(md, /\| --- \| --- \| --- \|/);
  });
});

// ── D3: scrape_with_actions serves markdown and html from the post-action DOM ─

describe('D3: scrape_with_actions never returns the markdown placeholder for a page with a body', () => {
  const finalHtml = '<html><head><title>Baggage</title><script>var x=1</script></head><body><div id="app"><h2>Baggage</h2><ul><li>I want to know about the checked baggage policy</li><li>I want to track my bag</li></ul></div></body></html>';

  function tool(extractResult) {
    const executor = {
      executeActionChain: async (url, chainConfig) => ({
        success: true,
        results: chainConfig.actions.map((a, i) => ({ id: `action_${i}`, type: a.type, success: true, result: {}, executionTime: 1, timestamp: Date.now() })),
        screenshots: [],
        finalHtml,
        finalUrl: url,
        navigationStatus: 200,
        metadata: {}
      }),
      getStats: () => ({}),
      destroy: async () => {}
    };
    const extract = { execute: async () => extractResult };
    return new ScrapeWithActionsTool({ actionExecutor: executor, extractContentTool: extract, enableLogging: false });
  }

  test('text-only extraction (Readability found no article) still yields markdown and html', async () => {
    const result = await tool({ success: true, content: { text: 'I want to know about the checked baggage policy I want to track my bag' }, metadata: {} })
      .execute({ url: 'https://support.southwest.com/helpcenter/pathway/baggage', actions: [{ type: 'wait', duration: 1 }], formats: ['markdown', 'html', 'text'], captureScreenshots: false });
    assert.equal(result.success, true);
    assert.match(result.content.markdown, /## Baggage/);
    assert.match(result.content.markdown, /checked baggage policy/);
    assert.doesNotMatch(result.content.markdown, /Content not available/);
    assert.doesNotMatch(result.content.markdown, /var x=1/, 'scripts never reach the markdown');
    assert.equal(result.content.html, finalHtml);
    assert.match(result.content.text, /track my bag/);
  });

  test('markdown Readability produced is kept as is', async () => {
    const result = await tool({ success: true, content: { text: 'article text', markdown: '# From Readability', html: '<p>kept</p>' }, metadata: {} })
      .execute({ url: 'https://example.com/', actions: [{ type: 'wait', duration: 1 }], formats: ['markdown', 'html'], captureScreenshots: false });
    assert.equal(result.content.markdown, '# From Readability');
    assert.equal(result.content.html, '<p>kept</p>');
  });
});

// ── D4: agent adds a fact query beside the bare entity query ─────────────────

describe('D4: a current-state agent plan that stops at the entity name gets the task words as a second query', () => {
  const realFetch = globalThis.fetch;
  after(() => { globalThis.fetch = realFetch; });

  test('two queries run, the entity query first; only the entity query votes for the live root', async () => {
    const o = new AgentOrchestrator({});
    const seenPrompts = [];
    o._samplingClient = {
      complete: async (p) => {
        seenPrompts.push(p);
        return { text: seenPrompts.length === 1 ? 'Southwest Airlines' : 'mock answer', provider: 'mock' };
      }
    };
    const LIVE = 'https://southwest.example/';
    const FEES = 'https://guide.example/southwest-bag-fees';
    const queries = [];
    o._searchTool = {
      execute: async ({ query }) => {
        queries.push(query);
        return query === 'Southwest Airlines'
          ? { results: [
            { link: LIVE, title: 'Southwest Airlines', snippet: 'book a flight' },
            { link: 'https://southwest.example/booking', title: 'Book', snippet: 'fares' }
          ] }
          : { results: [
            { link: FEES, title: 'Southwest checked bag fees', snippet: 'first checked bag $35' },
            { link: 'https://guide.example/other', title: 'Other guide', snippet: 'checked bag' },
            { link: 'https://guide.example/third', title: 'Third guide', snippet: 'checked bag' }
          ] };
      }
    };
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      url,
      headers: { get: () => null },
      text: async () => url === LIVE
        ? '<html><body><p>Southwest Airlines. Book a flight. Low fares.</p></body></html>'
        : '<html><body><p>Southwest Airlines charges $35 for a first checked bag on a domestic flight.</p></body></html>'
    });

    const result = await o.run({
      prompt: 'What does Southwest Airlines currently charge for a first checked bag on a domestic flight?',
      maxSteps: 5,
      maxUrls: 6
    });

    assert.equal(result.success, true);
    assert.equal(queries[0], 'Southwest Airlines');
    assert.equal(queries.length, 2, 'a fact query was added');
    assert.match(queries[1], /checked bag/);
    assert.ok(result.evidence.some((e) => e.url === FEES), 'the fee page reached evidence');
    const synthesis = seenPrompts.find((p) => p.includes('--- Source:'));
    assert.ok(synthesis.indexOf(`--- Source: ${LIVE}`) < synthesis.indexOf(`--- Source: ${FEES}`),
      'the official live root still leads synthesis although guide.example won on raw result count');
    assert.match(synthesis, /if the FIRST source does not state the answer, take it from the next sources/);
  });

  test('a plan that already has several queries is left alone', async () => {
    const o = new AgentOrchestrator({});
    o._samplingClient = { complete: async () => ({ text: 'Southwest Airlines\nSouthwest bag fees', provider: 'mock' }) };
    const queries = [];
    o._searchTool = { execute: async ({ query }) => { queries.push(query); return { results: [] }; } };
    globalThis.fetch = async () => { throw new Error('offline'); };
    await o.run({ prompt: 'What does Southwest Airlines currently charge for a first checked bag?', maxSteps: 2, maxUrls: 2 });
    assert.deepEqual(queries, ['Southwest Airlines', 'Southwest bag fees']);
  });
});

// ── G1: get_batch_results is under the inline threshold ──────────────────────

test('G1: get_batch_results is shaped like batch_scrape', () => {
  assert.deepEqual(INLINE_THRESHOLD_TOOLS.get_batch_results, { textPaths: [], truncate: true });
});

// ── G2 / G3: local-server checks ─────────────────────────────────────────────

describe('G2/G3: extract_links and crawl_deep page content', () => {
  let server;
  let baseUrl;
  before(async () => {
    server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<html><head><title>Commercial</title></head><body>
        <header><nav><a href="/">Home</a> <a href="/commercial">Commercial</a> <a href="/defense">Defense</a></nav></header>
        <main><h1>Commercial Airplanes</h1><p>${'The 737 MAX family delivers the highest efficiency, reliability and passenger appeal. '.repeat(6)}</p>
          <a href="https://services.example/parts">Parts</a>
          <a href="javascript:void(0)">Cookie Settings</a>
          <a href="/commercial/737max">737 MAX</a></main>
        <footer>© Example Aircraft</footer></body></html>`);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('G2: a javascript: href is not a link, external or otherwise', async () => {
    const result = JSON.parse((await extractLinksHandler({ url: `${baseUrl}/commercial`, filter_external: true })).content[0].text);
    assert.deepEqual(result.links.map((l) => l.href), ['https://services.example/parts']);
    assert.equal(result.external_count, 1);
  });

  test('G3: BFSCrawler content is the main region, not the site chrome', () => {
    const page = BFSCrawler.prototype.parsePage.call({}, `<html><body>
      <header><nav>Explore Products Product Categories Business Jets Turboprops Piston</nav></header>
      <main><h1>Cessna Skyhawk</h1><p>${'The Cessna Skyhawk is the most popular single-engine aircraft ever built. '.repeat(5)}</p></main>
      <footer>Contact us</footer></body></html>`, 'https://cessna.example/en/piston/cessna-skyhawk');
    assert.match(page.content, /^Cessna Skyhawk\s*The Cessna Skyhawk is the most popular/);
    assert.doesNotMatch(page.content, /Explore Products/);
  });

  test('G3: without a main region the page copy is still there; a page that is only chrome falls back to the whole text', () => {
    const page = BFSCrawler.prototype.parsePage.call({}, '<html><body><nav>Menu</nav><div><p>Body copy here.</p></div><footer>Foot</footer></body></html>', 'https://x.example/');
    assert.match(page.content, /Body copy here\./);
    assert.doesNotMatch(page.content, /Foot/);
    const bare = BFSCrawler.prototype.parsePage.call({}, '<html><body><nav>Only a menu</nav></body></html>', 'https://x.example/');
    assert.equal(bare.content, 'Only a menu');
  });
});

// ── G4: reddit_search 422 inside a caller-chosen window ──────────────────────

test('G4: a throttled scoped search with a caller window names the window and how to narrow it', async () => {
  const throttled = () => ({
    ok: false, status: 422, statusText: 'Unprocessable Entity',
    headers: { get: () => null },
    text: async () => JSON.stringify({ data: null, error: 'Timeout. Maybe slow down a bit' }),
    json: async () => ({})
  });
  const realFetch = globalThis.fetch;
  // Arctic Shift requests only: PullPush is tried second once the ladder gives up.
  let calls = 0;
  globalThis.fetch = async (url) => { if (/arctic-shift/.test(String(url))) calls++; return throttled(); };
  try {
    const tool = new RedditSearchTool({ retryDelayMs: 0 });
    await assert.rejects(
      () => tool.execute({ query: '737 MAX', subreddit: 'aviation', mode: 'posts', after: '30d', limit: 5 }),
      (err) => /Timeout\. Maybe slow down a bit/.test(err.message) && /after=30d window/.test(err.message) && /narrower after \(7d, 3d, 1d\)/.test(err.message)
    );
    assert.equal(calls, 2, 'the caller\'s window is still respected: one attempt plus the throttle retry');
  } finally {
    globalThis.fetch = realFetch;
  }
});

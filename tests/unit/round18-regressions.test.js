/**
 * Round 18 regressions (2026-09-04, pricing sweep across travel, auto and
 * retail sites on mcp-server 5.6.8 + crawlforge-extractors 1.6.4).
 *
 * D1  stealth_mode reported HTTP error pages and soft blocks as success:true:
 *     Edmunds "403 - Access Denied", Lufthansa's 404 "Page not found", Home
 *     Depot's "Error Page", Hilton's "Something went wrong"; scrape_with_actions
 *     ran a full chain on tesla.com's Akamai denial and reported success.
 * D2  stealth_mode gave up on an empty document at 0 ms: booking.com's
 *     self-solving chal_t redirect and the carvana/chewy/tesla JS shells all
 *     came back "rendered no title and no text after 0ms" while a 6 s wait
 *     returned the full page.
 * D3  crawl_deep fetched the normalized URL, which drops the trailing slash:
 *     globalpetrolprices.com answers /gasoline_prices/ with 200 and
 *     /gasoline_prices with 404, so every child page was an error.
 * D4  deep_research sent a 45-word topic verbatim to the search backend and
 *     got one source; a seven-word restatement got eight.
 * D5  localization configure_country GB answered Accept-Language en-US.
 * G1  scrape_template shopify-product died on a 403 from /products/<handle>.json
 *     (gymshark) or a handle redirected to a collection (allbirds); the product
 *     page's own JSON-LD carries the price.
 * G2  reddit_search on Arctic Shift returned 0 for a long natural-language
 *     query with no hint that every word must match.
 *
 * Run: node --test --test-force-exit tests/unit/round18-regressions.test.js
 */

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { stealthDocumentVerdict, SOFT_ERROR_MAX_CHARS } = await import('../../src/utils/stealthVerdict.js');
const { StealthBrowserManager, EMPTY_DOCUMENT_GRACE_MS } = await import('../../src/core/StealthBrowserManager.js');
const { ActionExecutor } = await import('../../src/core/ActionExecutor.js');
const { ScrapeWithActionsTool } = await import('../../src/tools/advanced/ScrapeWithActionsTool.js');
const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');
const {
  ResearchOrchestrator, compactSearchTopic, clampSearchQuery, SEARCH_TOPIC_MAX_WORDS, SEARCH_QUERY_MAX_WORDS
} = await import('../../src/core/ResearchOrchestrator.js');
const { LocalizationManager } = await import('../../src/core/LocalizationManager.js');
const { shopifyProductFromJsonLd } = await import('crawlforge-extractors');
const { ScrapeTemplateTool } = await import('../../src/tools/templates/ScrapeTemplateTool.js');
const { RedditSearchTool } = await import('../../src/tools/search/redditSearch.js');
const { _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');

// ── One local server for every suite that fetches ────────────────────────────

const PRODUCT_LD = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Crest Hoodie',
  brand: { '@type': 'Brand', name: 'Gymshark' },
  sku: 'B1A2',
  description: '  A heavyweight\n hoodie. ',
  image: ['https://cdn.example/1.jpg', { '@type': 'ImageObject', url: 'https://cdn.example/2.jpg' }],
  offers: [
    { '@type': 'Offer', price: '50.00', priceCurrency: 'GBP', availability: 'https://schema.org/InStock', sku: 'B1A2-S', name: 'S' },
    { '@type': 'Offer', price: 55, priceCurrency: 'GBP', availability: 'https://schema.org/OutOfStock', sku: 'B1A2-M', name: 'M' }
  ]
};
const WEBPAGE_LD = { '@context': 'https://schema.org', '@type': 'WebPage', name: 'A page' };
const ldPage = (...blocks) => `<html><head><title>Store</title>${blocks
  .map((b) => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`)
  .join('')}</head><body><h1>Crest Hoodie</h1></body></html>`;

const CRAWL_PAGES = {
  // The site that wants its slashes: /a/ and /b/ exist, /a and /b do not; /c has no slash.
  '/a/': '<html><head><title>A</title></head><body><a href="/b/">B</a><a href="/b/#top">B again</a><a href="/c">C</a></body></html>',
  '/b/': '<html><head><title>B</title></head><body>Prices here.</body></html>',
  '/c': '<html><head><title>C</title></head><body>No slash.</body></html>'
};

let server;
let baseUrl;
let hits = {};

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    hits[path] = (hits[path] || 0) + 1;
    if (path === '/robots.txt') { res.writeHead(404); return res.end(); }
    if (CRAWL_PAGES[path]) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(CRAWL_PAGES[path]);
    }
    if (path === '/products/hoodie.json') { res.writeHead(403); return res.end('forbidden'); }
    if (path === '/products/hoodie') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(ldPage(WEBPAGE_LD, '{not json', PRODUCT_LD));
    }
    if (path === '/products/gone.json') { res.writeHead(404); return res.end(); }
    if (path === '/products/gone') { res.writeHead(302, { Location: '/collections/all' }); return res.end(); }
    if (path === '/collections/all') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(ldPage(WEBPAGE_LD));
    }
    if (path === '/products/broken.json') { res.writeHead(500); return res.end(); }
    if (path.startsWith('/a') || path.startsWith('/b') || path.startsWith('/c') || path.startsWith('/products/')) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>ok</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  _resetRobotsGate();
  _resetHostRateLimiter();
  hits = {};
});

// ── D1: what a stealth-rendered document is ──────────────────────────────────

const PROSE = 'The 2026 Toyota Camry starts at $29,600 before destination. '.repeat(50);

describe('D1: stealthDocumentVerdict names error pages and soft blocks', () => {
  test('an HTTP 403 document is a failure that keeps its status', () => {
    const v = stealthDocumentVerdict({ url: 'https://www.edmunds.com/toyota/camry/2026/', status: 403, title: '403 - Access Denied', text: 'Access Denied. Reference #18.4a' });
    assert.equal(v.success, false);
    assert.equal(v.status, 403);
    assert.match(v.error, /HTTP 403/);
    assert.match(v.error, /titled "403 - Access Denied"/);
    assert.match(v.error, /IP-reputation or WAF/);
    assert.equal(v.blocked, undefined);
  });

  test('a 404 says the URL does not exist', () => {
    const v = stealthDocumentVerdict({ url: 'https://www.lufthansa.com/us/en/baggage-fees', status: 404, title: 'Page not found', text: PROSE });
    assert.equal(v.success, false);
    assert.match(v.error, /HTTP 404/);
    assert.match(v.error, /does not exist/);
  });

  test('a short document with an error title is a soft block even on HTTP 200', () => {
    for (const title of ['Error Page', 'Something went wrong', 'Oops! We hit a snag', '404 – Page Not Found', 'Access Denied']) {
      const v = stealthDocumentVerdict({ url: 'https://www.homedepot.com/p/x', status: 200, title, text: 'Please try again later. Reference 12345.' });
      assert.equal(v.success, false, title);
      if (title === 'Access Denied') {
        // Akamai's title is a challenge vendor first.
        assert.equal(v.blocked?.vendor, 'akamai');
      } else {
        assert.match(v.error, new RegExp(`error page titled "${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), title);
        assert.equal(v.status, 200);
      }
    }
  });

  test('a long article whose title happens to be an error word is a page', () => {
    assert.ok(PROSE.length > SOFT_ERROR_MAX_CHARS);
    const v = stealthDocumentVerdict({ url: 'https://example.com/post', status: 200, title: 'Error', text: PROSE });
    assert.deepEqual(v, { success: true, status: 200 });
  });

  test('a challenge page is blocked, with the vendor and the status', () => {
    const v = stealthDocumentVerdict({ url: 'https://travel.state.gov/', status: 403, title: 'Just a moment...', text: 'Verifying you are human', html: '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>' });
    assert.equal(v.success, false);
    assert.equal(v.blocked?.vendor, 'cloudflare');
    assert.equal(v.status, 403);
    assert.match(v.error, /cloudflare served a challenge page/);
  });

  test('a real page is a success, with or without a status', () => {
    assert.deepEqual(stealthDocumentVerdict({ url: 'https://www.cars.com/', status: 200, title: '2026 Toyota Camry', text: PROSE }), { success: true, status: 200 });
    assert.deepEqual(stealthDocumentVerdict({ url: 'https://www.cars.com/', title: '2026 Toyota Camry', text: PROSE }), { success: true, status: null });
  });

  test('an empty document reports the wait it was given, unless the caller allows it', () => {
    const empty = { url: 'https://www.carvana.com/cars', status: 200, title: '', text: '', html: '<html><body></body></html>' };
    const v = stealthDocumentVerdict(empty, { waitedMs: 6000 });
    assert.equal(v.success, false);
    assert.match(v.error, /rendered no title and no text after 6000ms/);
    assert.deepEqual(stealthDocumentVerdict(empty, { allowEmpty: true }), { success: true, status: 200 });
  });
});

// ── D1 / D2: the stealth scrape carries the status and waits for an empty document ──

function fakeStealthPage({ status = 200, title = 'Page', text = 'Body text', emptyFirst = false, onWait = null } = {}) {
  const handlers = {};
  const calls = [];
  const state = { title, text, hasContent: !emptyFirst };
  const mainFrame = {};
  const navigationResponse = (code) => ({
    status: () => code,
    request: () => ({ isNavigationRequest: () => true, frame: () => mainFrame })
  });
  const page = {
    on: (event, fn) => { handlers[event] = fn; },
    mainFrame: () => mainFrame,
    url: () => 'http://127.0.0.1:1/x',
    goto: async (url) => {
      calls.push(['goto', url]);
      const response = navigationResponse(status);
      handlers.response?.(response);
      return response;
    },
    waitForTimeout: async (ms) => { calls.push(['waitForTimeout', ms]); },
    title: async () => state.title,
    content: async () => `<html><head><title>${state.title}</title></head><body>${state.text}</body></html>`,
    evaluate: async (fn) => (String(fn).includes('document.title') ? state.hasContent : state.text),
    waitForFunction: async (fn, arg, options) => {
      calls.push(['waitForFunction', options?.timeout]);
      state.hasContent = true;
      if (onWait) onWait(state, (code) => handlers.response?.(navigationResponse(code)));
    },
    waitForLoadState: async (s) => { calls.push(['waitForLoadState', s]); },
    isClosed: () => false,
    screenshot: async () => 'shot'
  };
  return { page, calls, state };
}

function stubbedManager(page) {
  const manager = new StealthBrowserManager();
  manager.createStealthContext = async () => ({ contextId: 'ctx-18' });
  manager.createStealthPage = async () => page;
  manager.closeContext = async () => {};
  return manager;
}

describe('D2: _waitOutEmptyDocument gives an empty document one bounded grace', () => {
  test('a document with content is not waited on', async () => {
    const { page, calls } = fakeStealthPage();
    const waited = await new StealthBrowserManager()._waitOutEmptyDocument(page);
    assert.equal(waited, 0);
    assert.deepEqual(calls, []);
  });

  test('an empty document waits for content, then domcontentloaded, then any challenge', async () => {
    const { page, calls } = fakeStealthPage({ emptyFirst: true });
    const waited = await new StealthBrowserManager()._waitOutEmptyDocument(page, { timeoutMs: 25 });
    assert.ok(waited >= 0);
    assert.deepEqual(calls, [['waitForFunction', 25], ['waitForLoadState', 'domcontentloaded']]);
  });

  test('the default grace is the exported constant', async () => {
    const { page, calls } = fakeStealthPage({ emptyFirst: true });
    await new StealthBrowserManager()._waitOutEmptyDocument(page);
    assert.equal(calls[0][1], EMPTY_DOCUMENT_GRACE_MS);
    assert.equal(EMPTY_DOCUMENT_GRACE_MS, 8000);
  });

  test('a page that cannot be evaluated is not waited on', async () => {
    const page = { evaluate: async () => { throw new Error('Target closed'); } };
    assert.equal(await new StealthBrowserManager()._waitOutEmptyDocument(page), 0);
  });
});

describe('D1 / D2: scrapeWithStealth returns the status of the document finally read', () => {
  test('an error page keeps its HTTP status; a filled document is not graced', async () => {
    const { page } = fakeStealthPage({ status: 403, title: '403 - Access Denied', text: 'Access Denied' });
    const scraped = await stubbedManager(page).scrapeWithStealth({ url: 'http://127.0.0.1:1/x' });
    assert.equal(scraped.status, 403);
    assert.equal(scraped.gracedMs, 0);
    assert.equal(scraped.title, '403 - Access Denied');
    assert.equal(stealthDocumentVerdict(scraped).success, false);
  });

  test('an empty document is graced and the wait is reported', async () => {
    const { page, calls, state } = fakeStealthPage({
      emptyFirst: true, title: '', text: '',
      onWait: (s) => { s.title = 'Carvana'; s.text = '2024 Toyota Camry $23,990'; }
    });
    const scraped = await stubbedManager(page).scrapeWithStealth({ url: 'http://127.0.0.1:1/x' });
    assert.ok(calls.some(([name]) => name === 'waitForFunction'), 'the empty document was waited on');
    assert.ok(scraped.gracedMs >= 0);
    assert.equal(scraped.title, 'Carvana');
    assert.equal(state.hasContent, true);
    assert.equal(stealthDocumentVerdict(scraped).success, true);
  });

  test('a challenge that navigates on leaves the status of the page it landed on', async () => {
    const { page } = fakeStealthPage({
      status: 403, title: 'Just a moment...', text: 'Verifying',
      onWait: (s, emit) => { s.title = 'Booking.com'; s.text = 'The Plaza $1,568'; emit(200); }
    });
    const scraped = await stubbedManager(page).scrapeWithStealth({ url: 'http://127.0.0.1:1/x' });
    assert.equal(scraped.status, 200);
    assert.equal(scraped.title, 'Booking.com');
    assert.equal(stealthDocumentVerdict(scraped).success, true);
  });
});

// ── D1: scrape_with_actions ──────────────────────────────────────────────────

function actionsTool({ navigationStatus = null, finalHtml = '<html><body>done</body></html>', title = 'Test Page', text = 'page text' } = {}) {
  const executor = {
    executeActionChain: async (url, chainConfig) => ({
      success: true,
      results: chainConfig.actions.map((a, i) => ({ id: `action_${i}`, type: a.type, success: true, result: {}, executionTime: 1, timestamp: Date.now() })),
      screenshots: [],
      finalHtml,
      finalUrl: url,
      navigationStatus,
      metadata: {}
    }),
    getStats: () => ({}),
    destroy: async () => {}
  };
  const extract = { execute: async () => ({ success: true, content: { text, html: finalHtml, markdown: text }, metadata: { title } }) };
  return new ScrapeWithActionsTool({ actionExecutor: executor, extractContentTool: extract, enableLogging: false });
}
const CLICK = [{ type: 'click', selector: '#go' }];

describe('D1: scrape_with_actions judges the document the chain ended on', () => {
  test('a completed chain on an HTTP 403 page is not a success', async () => {
    const result = await actionsTool({ navigationStatus: 403, title: '403 - Access Denied', text: 'Access Denied. Reference #18' }).execute({ url: 'https://www.edmunds.com/', actions: CLICK });
    assert.equal(result.success, false);
    assert.equal(result.httpStatus, 403);
    assert.match(result.error, /HTTP 403/);
    assert.equal(result.actionResults.length, 1, 'the actions that ran are still reported');
  });

  test('an Akamai denial is blocked with the vendor named', async () => {
    const result = await actionsTool({ title: 'Access Denied', text: "You don't have permission to access /model3 on this server." }).execute({ url: 'https://www.tesla.com/model3', actions: CLICK });
    assert.equal(result.success, false);
    assert.equal(result.blocked?.vendor, 'akamai');
    assert.equal(result.httpStatus, undefined, 'no status when the executor recorded none');
  });

  test('a real page keeps success and reports its status', async () => {
    const result = await actionsTool({ navigationStatus: 200 }).execute({ url: 'https://example.com/', actions: CLICK });
    assert.equal(result.success, true);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.error, undefined);
  });

  test('an empty document after a chain is allowed (the chain may have navigated away)', async () => {
    const result = await actionsTool({ navigationStatus: 200, title: '', text: '', finalHtml: '' }).execute({ url: 'https://example.com/', actions: CLICK });
    assert.equal(result.success, true);
  });
});

describe('D1: ActionExecutor records the status of the last navigation', () => {
  function fakePage(initialUrl, status) {
    let currentUrl = initialUrl;
    return {
      url: () => currentUrl,
      content: async () => '<html><body>ok</body></html>',
      waitForLoadState: async () => {},
      goto: async (url) => { currentUrl = url; return { status: () => status }; },
      close: async () => {},
      context: () => ({ close: async () => {} })
    };
  }
  function executorFor(page) {
    const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
    executor.initializePage = async (url, options) => { await executor.assertRobotsAllowed(url, options); return page; };
    return executor;
  }

  test('a navigate action leaves its status on the chain result', async () => {
    const result = await executorFor(fakePage(`${baseUrl}/start`, 403)).executeActionChain(`${baseUrl}/start`, {
      actions: [{ type: 'navigate', url: `${baseUrl}/denied` }]
    });
    assert.equal(result.success, true, result.error);
    assert.equal(result.navigationStatus, 403);
  });

  test('no navigation, no status', async () => {
    const result = await executorFor(fakePage(`${baseUrl}/start`, 200)).executeActionChain(`${baseUrl}/start`, {
      actions: [{ type: 'wait', timeout: 1 }]
    });
    assert.equal(result.navigationStatus, null);
  });
});

// ── D3: crawl_deep fetches the URL as the site wrote it ──────────────────────

describe('D3: BFSCrawler keeps the trailing slash on the wire', () => {
  test('/a/ and /b/ are fetched with their slashes; the normalized form is only the dedupe key', async () => {
    const crawler = new BFSCrawler({ respectRobots: false, enableLinkAnalysis: false, timeout: 5000, concurrency: 1, maxDepth: 1, maxPages: 10 });
    const result = await crawler.crawl(`${baseUrl}/a/`);
    const paths = result.urls.map((u) => new URL(u).pathname).sort();
    assert.deepEqual(paths, ['/a/', '/b/', '/c']);
    assert.deepEqual(result.errors, []);
    assert.equal(hits['/a/'], 1);
    assert.equal(hits['/b/'], 1, '/b/ and /b/#top are one page');
    assert.equal(hits['/a'], undefined, 'the slash-stripped form was never requested');
    assert.equal(hits['/b'], undefined);
  });

  test('a seed written without the slash is fetched without it', async () => {
    const crawler = new BFSCrawler({ respectRobots: false, enableLinkAnalysis: false, timeout: 5000, concurrency: 1, maxDepth: 0, maxPages: 2 });
    const result = await crawler.crawl(`${baseUrl}/c`);
    assert.deepEqual(result.urls.map((u) => new URL(u).pathname), ['/c']);
    assert.equal(hits['/c/'], undefined);
  });

  test('link analysis keys links by the normalized form', async () => {
    const crawler = new BFSCrawler({ respectRobots: false, enableLinkAnalysis: true, timeout: 5000, concurrency: 1, maxDepth: 1, maxPages: 10 });
    const result = await crawler.crawl(`${baseUrl}/a/`);
    assert.deepEqual(result.urls.map((u) => new URL(u).pathname).sort(), ['/a/', '/b/', '/c']);
    assert.deepEqual(result.errors, []);
  });
});

// ── D4: a long research topic reaches the search backend as keywords ─────────

const LONG_TOPIC = 'Why does a headless Chromium or Firefox stealth browser get stuck on the Cloudflare "Just a moment..." Turnstile challenge page on travel.state.gov in 2026, and what makes the challenge pass: TLS JA4 fingerprint, IP reputation, residential proxies and known working approaches?';

describe('D4: compactSearchTopic / clampSearchQuery', () => {
  test('a short topic is unchanged', () => {
    assert.equal(compactSearchTopic('  toyota camry   2026 price '), 'toyota camry 2026 price');
    const twelve = Array.from({ length: SEARCH_TOPIC_MAX_WORDS }, (_, i) => `w${i}`).join(' ');
    assert.equal(compactSearchTopic(twelve), twelve);
  });

  test('a paragraph becomes its first content words, without stopwords or punctuation', () => {
    assert.ok(LONG_TOPIC.split(/\s+/).length > SEARCH_TOPIC_MAX_WORDS);
    const compact = compactSearchTopic(LONG_TOPIC);
    const words = compact.split(' ');
    assert.ok(words.length <= SEARCH_TOPIC_MAX_WORDS, compact);
    assert.ok(words.includes('Cloudflare') && words.includes('Turnstile'), compact);
    for (const w of words) assert.doesNotMatch(w.toLowerCase(), /^(why|does|a|the|or|on|in|and|what|makes)$/, compact);
    assert.doesNotMatch(compact, /["?:,]/);
  });

  test('every query is clamped to what a search engine answers', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    assert.equal(clampSearchQuery(twenty).split(' ').length, SEARCH_QUERY_MAX_WORDS);
    assert.equal(clampSearchQuery('two words'), 'two words');
    assert.equal(clampSearchQuery(''), '');
  });

  test('expandResearchTopic never hands the paragraph to the backend', async () => {
    const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
    ro.enableLLMFeatures = false;
    ro.rankResearchQueriesWithSemantics = async (queries) => queries;
    const queries = await ro.expandResearchTopic(LONG_TOPIC);
    assert.ok(queries.length > 1);
    for (const q of queries) {
      assert.ok(q.split(' ').length <= SEARCH_QUERY_MAX_WORDS, q);
      assert.notEqual(q, LONG_TOPIC);
    }
  });
});

// ── D5: Accept-Language follows the configured country ───────────────────────

describe('D5: buildAcceptLanguageHeader', () => {
  const lm = new LocalizationManager();

  test('a region in the language wins; a bare language takes the country', () => {
    assert.equal(lm.buildAcceptLanguageHeader('en-GB'), 'en-GB,en;q=0.9');
    assert.equal(lm.buildAcceptLanguageHeader('en', 'GB'), 'en-GB,en;q=0.9');
    assert.equal(lm.buildAcceptLanguageHeader('en', 'gb'), 'en-GB,en;q=0.9');
    assert.equal(lm.buildAcceptLanguageHeader('de', 'DE'), 'de-DE,de;q=0.9,en;q=0.8');
    assert.equal(lm.buildAcceptLanguageHeader('en-US', 'GB'), 'en-US,en;q=0.9');
  });

  test('no country at all keeps the old mapping', () => {
    assert.equal(lm.buildAcceptLanguageHeader('en'), 'en-US,en;q=0.9');
  });

  test('configure_country GB answers en-GB', async () => {
    const config = await lm.configureCountry('GB');
    assert.equal(config.acceptLanguage, 'en-GB,en;q=0.9');
    const de = await lm.configureCountry('DE');
    assert.match(de.acceptLanguage, /^de-DE,de;q=0\.9/);
  });
});

// ── G1: the Shopify product from the page's JSON-LD ──────────────────────────

describe('G1: shopifyProductFromJsonLd', () => {
  test('a Product with offers, past a WebPage block and a malformed block', () => {
    const out = shopifyProductFromJsonLd(ldPage(WEBPAGE_LD, '{not json', PRODUCT_LD), 'https://store.example/products/crest-hoodie?variant=1');
    assert.equal(out.found, true);
    const d = out.data;
    assert.equal(d.title, 'Crest Hoodie');
    assert.equal(d.vendor, 'Gymshark');
    assert.equal(d.handle, 'crest-hoodie');
    assert.equal(d.product_id, 'B1A2');
    assert.equal(d.price, '50.00');
    assert.equal(d.price_min, '50.00');
    assert.equal(d.price_max, '55.00');
    assert.equal(d.currency, 'GBP');
    assert.equal(d.available, true);
    assert.equal(d.variants.length, 2);
    assert.deepEqual(d.variants.map((v) => v.available), [true, false]);
    assert.deepEqual(d.variants.map((v) => v.price), ['50.00', '55.00']);
    assert.deepEqual(d.images, ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg']);
    assert.equal(d.description, 'A heavyweight hoodie.');
    assert.equal(d.source, 'json-ld');
    assert.equal(d.compare_at_price, null);
  });

  test('an AggregateOffer inside @graph', () => {
    const graph = { '@context': 'https://schema.org', '@graph': [WEBPAGE_LD, {
      '@type': ['Product'], name: 'Watch', brand: 'Omega',
      offers: { '@type': 'AggregateOffer', lowPrice: '1,299.00', highPrice: '1,499.00', priceCurrency: 'USD', availability: 'InStock' }
    }] };
    const out = shopifyProductFromJsonLd(ldPage(graph), 'https://store.example/products/watch');
    assert.equal(out.found, true);
    assert.equal(out.data.vendor, 'Omega');
    assert.equal(out.data.price, '1299.00');
    assert.equal(out.data.price_max, '1499.00');
    assert.equal(out.data.available, true);
  });

  test('a ProductGroup prices each hasVariant Product, gymshark-style', () => {
    const group = {
      '@context': 'https://schema.org', '@type': 'ProductGroup', name: 'Arrival 5&quot; Shorts',
      brand: { '@type': 'Brand', name: 'Gymshark' }, productGroupID: '6804846346442', variesBy: ['https://schema.org/size'],
      hasVariant: [
        { '@type': 'Product', name: 'Arrival 5&quot; Shorts - S', size: 'S', sku: 'A2A1M-BBBB-S', offers: { '@type': 'Offer', price: '25.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } },
        { '@type': 'Product', name: 'Arrival 5&quot; Shorts - M', size: 'M', sku: 'A2A1M-BBBB-M', offers: { '@type': 'Offer', price: '22.00', priceCurrency: 'USD', availability: 'https://schema.org/OutOfStock' } }
      ]
    };
    const out = shopifyProductFromJsonLd(ldPage(group), 'https://www.gymshark.com/products/gymshark-arrival-5-shorts-black-ss22');
    assert.equal(out.found, true);
    const d = out.data;
    assert.equal(d.title, 'Arrival 5" Shorts');
    assert.equal(d.product_id, '6804846346442');
    assert.equal(d.handle, 'gymshark-arrival-5-shorts-black-ss22');
    assert.equal(d.price, '22.00');
    assert.equal(d.price_max, '25.00');
    assert.equal(d.currency, 'USD');
    assert.equal(d.available, true);
    assert.deepEqual(d.options, ['size']);
    assert.deepEqual(d.variants.map((v) => [v.title, v.price, v.available, v.options]), [
      ['Arrival 5" Shorts - S', '25.00', true, ['S']],
      ['Arrival 5" Shorts - M', '22.00', false, ['M']]
    ]);
  });

  test('a page without a Product says so, and names the collection redirect', () => {
    const collection = shopifyProductFromJsonLd(ldPage(WEBPAGE_LD), 'https://store.example/collections/all');
    assert.equal(collection.found, false);
    assert.match(collection.reason, /no schema\.org Product JSON-LD/);
    assert.match(collection.reason, /redirected to a collection page/);
    const plain = shopifyProductFromJsonLd('<html><body>nothing</body></html>', 'https://store.example/products/x');
    assert.equal(plain.found, false);
    assert.doesNotMatch(plain.reason, /collection/);
  });
});

describe('G1: scrape_template shopify-product falls back to the product page', () => {
  test('a 403 from the JSON endpoint reads the page JSON-LD and says so', async () => {
    const tool = new ScrapeTemplateTool();
    const result = await tool.execute({ template: 'shopify-product', url: `${baseUrl}/products/hoodie`, respect_robots: false });
    assert.equal(result.template, 'shopify-product');
    assert.equal(result.data.source, 'json-ld');
    assert.equal(result.data.price, '50.00');
    assert.equal(result.data.currency, 'GBP');
    assert.equal(result.url, `${baseUrl}/products/hoodie`);
    assert.match(result.warnings[0], /HTTP 403/);
    assert.match(result.warnings[0], /JSON-LD/);
    assert.equal(hits['/products/hoodie.json'], 1);
    assert.equal(hits['/products/hoodie'], 1);
  });

  test('a handle that redirected to a collection is named, not "HTTP 404"', async () => {
    const tool = new ScrapeTemplateTool();
    await assert.rejects(
      () => tool.execute({ template: 'shopify-product', url: `${baseUrl}/products/gone`, respect_robots: false }),
      /HTTP 404 from the products\.json endpoint, and .*collection/
    );
  });

  test('a status the fallback does not cover is still the plain error', async () => {
    const tool = new ScrapeTemplateTool();
    await assert.rejects(
      () => tool.execute({ template: 'shopify-product', url: `${baseUrl}/products/broken`, respect_robots: false }),
      /HTTP 500/
    );
    assert.equal(hits['/products/broken'], undefined, 'no page fetch for a 500');
  });
});

// ── G2: reddit_search explains a long Arctic Shift query ─────────────────────

describe('G2: reddit_search notes that Arctic Shift matches every word', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const empty = () => ({ ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => ({ data: [] }) });

  test('zero results for a long query carry the hint', async () => {
    global.fetch = async () => empty();
    const res = await new RedditSearchTool().execute({ query: 'Toyota Camry 2026 out the door price paid', subreddit: 'askcarsales', source: 'arctic_shift' });
    assert.equal(res.count, 0);
    assert.match(res.notes.join('\n'), /matches every word of the query.*\(8 words\)/);
    assert.match(res.notes.join('\n'), /two or three keywords/);
  });

  test('zero results for a short query do not', async () => {
    global.fetch = async () => empty();
    const res = await new RedditSearchTool().execute({ query: 'Camry OTD', subreddit: 'askcarsales', source: 'arctic_shift' });
    assert.equal(res.count, 0);
    assert.doesNotMatch(res.notes.join('\n'), /matches every word/);
  });
});

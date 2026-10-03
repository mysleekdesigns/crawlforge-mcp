/**
 * Live regression harness for scrape_with_actions and extract_embedded_state
 * (ACTIONS_EMBEDDED_STATE_FIX_PLAN.md, Phase 6): the 2026-09-29 review battery,
 * re-run against what Phases 0–5 fixed; plus extract_links and extract_text
 * (Part 2, Phase E5) against what Phases E1–E3 fixed.
 *
 * Run by hand, never in CI (it needs the network, Chromium and Camoufox):
 *
 *   CRAWLFORGE_LIVE=1 node --test --test-force-exit tests/live/actions-embedded-state.live.test.js
 *
 * Without CRAWLFORGE_LIVE=1 every case is skipped. CI runs only tests/unit, so
 * this file is never picked up there either way.
 *
 * Every call goes over real MCP stdio (SDK Client + StdioClientTransport
 * spawning this repo's server.js), not execute(): the screenshot strip and the
 * output-schema check live in server.js and only this path exercises them.
 * The server gets CACHE_ENABLE_DISK=false so a cached response cannot pass for
 * a live one, and the creator secret from the gitignored .env so the run
 * spends no credits.
 *
 * Each case asserts the success flag, an elapsed-time ceiling, that no
 * screenshot base64 came back inline, and for embedded state the `found`
 * names. A target that is down, slow to load, rate-limited or newly walled is
 * a SKIP, not a FAIL; only a violated assertion fails.
 *
 * The extract_links + extract_text cases (fix plan Phase E5) run each target
 * through both tools on both surfaces: MCP over the same stdio client, and
 * REST with POST ${CRAWLFORGE_REST_URL}/api/v1/tools/<tool> (default
 * https://www.crawlforge.dev) carrying CRAWLFORGE_API_KEY from .env as a
 * Bearer token. The REST cases spend real production credits (about 20 for
 * the set: 1 per page, 6 per ecosia escalation, 0 for a failure), one call
 * each and no retries, and skip when CRAWLFORGE_API_KEY is unset. Run only
 * them with:
 *
 *   CRAWLFORGE_LIVE=1 node --test --test-force-exit --test-name-pattern='extract_(links|text)' tests/live/actions-embedded-state.live.test.js
 *
 * Compliance: every call takes the default robots-respecting path (bing.com's
 * /search is disallowed for CrawlForge, so that case asserts the refusal), the
 * cases run one at a time, and the logins are the sites' published demo
 * credentials.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Client } from '@modelcontextprotocol/client';

const REPO = resolve(import.meta.dirname, '..', '..');
const LIVE = process.env.CRAWLFORGE_LIVE === '1';
const THE_INTERNET = 'https://the-internet.herokuapp.com';
// the-internet's Heroku host intermittently holds a request for 30 s (plain
// Playwright and curl hit it too, 2026-10-03), and a login is two page loads.
// The ceiling there allows two stalled loads; the timing regressions are
// asserted per action instead.
const SLOW_HOST = 75000;

/** Down, throttled, slow or walled targets: not a regression. */
const TRANSIENT =
  /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|\b(403|429|500|502|503|504)\b|too many requests|service unavailable|rate limit|bot wall/i;

/** A JPEG or PNG screenshot that escaped the resource strip (Phase 0.4). */
const INLINE_SCREENSHOT = /(\/9j\/|iVBORw0KGgo)[A-Za-z0-9+/=]{500,}/;

let client;

/**
 * One tools/call. Returns { r, text, ms, isError }; skips the test when the
 * target, not the tool, is what failed, unless `skipTargetFailures` is false
 * (the extract cases judge those themselves). Asserts the ceiling and the
 * absence of inline screenshot bytes on every call.
 */
async function call(t, name, args, ceilingMs, { skipTargetFailures = true } = {}) {
  const started = Date.now();
  let result;
  try {
    result = await client.callTool({ name, arguments: args }, { timeout: ceilingMs + 60000 });
  } catch (error) {
    if (TRANSIENT.test(error.message)) return t.skip(`target unavailable: ${error.message.slice(0, 160)}`);
    throw error;
  }
  const ms = Date.now() - started;
  const text = result.content?.[0]?.text ?? '';
  let r = result.structuredContent;
  if (!r) {
    try { r = JSON.parse(text); } catch { r = null; }
  }

  // A fetch the target refused, or a chain whose page never loaded, says
  // nothing about the tool. A chain's own action timeouts are not in this set:
  // they are what several cases assert.
  const fetchFailure = result.isError && !/robots\.txt/.test(text) && TRANSIENT.test(text);
  const pageFailure = r?.success === false &&
    (/page\.goto|net::ERR_/.test(r.error || '') || [429, 500, 502, 503, 504].includes(r.httpStatus));
  if (skipTargetFailures && (fetchFailure || pageFailure)) {
    return t.skip(`target unavailable: ${(r?.error || text).slice(0, 160)}`);
  }

  assert.ok(!INLINE_SCREENSHOT.test(text), 'screenshot base64 came back inline');
  assert.ok(ms <= ceilingMs, `took ${ms} ms, ceiling ${ceilingMs} ms`);
  return { r, text, ms, isError: !!result.isError };
}

const foundNames = (r) => (r?.found || []).map((f) => f.name);

/** The pre-fetch gate's refusals (the website's REFUSAL_CODES): compliance, not a regression. */
const REST_REFUSALS = new Set(['ROBOTS_DISALLOWED', 'CRAWL_DELAY', 'HOST_BLOCKED', 'HOST_BACKOFF']);

/** What a success carried, for the run's diagnostics. */
const extracted = (d) =>
  (d?.links ? `${d.links.length} links` : `${d?.text?.length ?? 0} chars`) +
  (d?.escalated !== undefined ? `, escalated=${d.escalated}${d.stealth ? ` via ${d.stealth.engine}` : ''}` : '');

/**
 * One call to an extract tool on one surface, as { ok, data, error, vendor,
 * refused, down } for the cases to judge: `vendor` names a wall, `refused` is
 * a robots or gate refusal, `down` a target that timed out, could not be
 * reached or answered 429/5xx. MCP goes over the stdio client (creator mode,
 * no credits); REST spends production credits, one call, no retry.
 */
async function extractCall(t, surface, tool, args, ceilingMs) {
  if (surface === 'MCP') {
    const res = await call(t, tool, args, ceilingMs, { skipTargetFailures: false });
    if (!res) return null;
    const firstLine = res.text.split('\n')[0];
    t.diagnostic(`MCP ${res.isError ? `error: ${firstLine.slice(0, 200)}` : `ok ${extracted(res.r)}`}, ${res.ms} ms`);
    return {
      ok: !res.isError,
      data: res.r,
      error: res.text,
      vendor: res.r?.blocked?.vendor ?? firstLine.match(/: ([\w-]+) served a challenge page/)?.[1],
      refused: /robots\.txt/.test(firstLine),
      down: res.isError && TRANSIENT.test(firstLine) && !/served a challenge page/.test(firstLine)
    };
  }

  if (!process.env.CRAWLFORGE_API_KEY) return t.skip('CRAWLFORGE_API_KEY not set: no REST call');
  const started = Date.now();
  let response;
  try {
    // Read here, not at load: `before` loads .env.
    const restUrl = process.env.CRAWLFORGE_REST_URL ?? 'https://www.crawlforge.dev';
    response = await fetch(`${restUrl}/api/v1/tools/${tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRAWLFORGE_API_KEY}` },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(ceilingMs + 60000)
    });
  } catch (error) {
    return t.skip(`REST unreachable: ${error.message.slice(0, 160)}`);
  }
  const body = await response.json().catch(() => ({}));
  const ms = Date.now() - started;
  const code = body.error?.code;
  t.diagnostic(
    `REST ${response.status}${code ? ` ${code}: ${body.error.message?.slice(0, 160)}` : ` ${extracted(body.data)}`}` +
    `${body.blocked ? ` blocked.vendor=${body.blocked.vendor}` : ''}, ${body.credits_used ?? 0} credits, ${ms} ms`
  );
  assert.ok(ms <= ceilingMs, `took ${ms} ms, ceiling ${ceilingMs} ms`);
  return {
    ok: response.status === 200 && body.success === true,
    data: body.data,
    error: `HTTP ${response.status} ${code}: ${body.error?.message}`,
    status: response.status,
    code,
    vendor: body.blocked?.vendor,
    refused: REST_REFUSALS.has(code),
    down: code === 'FETCH_FAILED' || code === 'FETCH_TIMEOUT' ||
      (code === 'UPSTREAM_HTTP' && [429, 500, 502, 503, 504].includes(response.status))
  };
}

/** A success holds what the tool extracts: at least `minLinks` links, or text. */
function assertExtracted(tool, data, minLinks = 1) {
  if (tool === 'extract_links') {
    assert.ok(Array.isArray(data?.links), 'no links array');
    assert.ok(data.links.length >= minLinks, `${data.links.length} links`);
  } else {
    assert.ok(data?.text?.trim().length > 0, 'no text');
  }
}

describe('scrape_with_actions + extract_embedded_state, live', { skip: LIVE ? false : 'set CRAWLFORGE_LIVE=1 to run' }, () => {
  before(async () => {
    dotenv.config({ path: resolve(REPO, '.env'), quiet: true });
    if (!process.env.CRAWLFORGE_CREATOR_SECRET) {
      throw new Error('CRAWLFORGE_CREATOR_SECRET missing from .env — the harness would spend credits');
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['server.js'],
      cwd: REPO,
      env: { ...process.env, CACHE_ENABLE_DISK: 'false' },
      stderr: 'pipe'
    });
    client = new Client({ name: 'actions-embedded-state-live', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
  });

  after(async () => {
    await client?.close();
  });

  describe('scrape_with_actions', () => {
    test('the-internet login', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: `${THE_INTERNET}/login`,
        formats: ['text'],
        actions: [
          { type: 'type', selector: '#username', text: 'tomsmith' },
          { type: 'type', selector: '#password', text: 'SuperSecretPassword!' },
          { type: 'click', selector: 'button[type="submit"]' },
          { type: 'wait', selector: '#flash' }
        ]
      }, SLOW_HOST);
      if (!res) return;
      assert.equal(res.r.success, true, res.r.error);
      assert.match(res.r.content.text, /You logged into a secure area/);
    });

    test('a click on a missing selector fails once, inside its timeout (0.1)', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: 'https://www.saucedemo.com/',
        formats: ['text'],
        actions: [{ type: 'click', selector: '#never-there', timeout: 4000 }]
      }, 30000);
      if (!res) return;
      assert.equal(res.r.success, false);
      assert.equal(res.r.attempts.length, 1, 'maxRetries defaults to 0');
      const click = res.r.actionResults.find((a) => a.type === 'click');
      assert.ok(click.executionTime < 6000, `click took ${click.executionTime} ms (20.8 s before Phase 0)`);
    });

    test('the-internet dynamic loading: click, then wait for the rendered element', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: `${THE_INTERNET}/dynamic_loading/2`,
        formats: ['text'],
        actions: [
          { type: 'click', selector: '#start button' },
          { type: 'wait', selector: '#finish', condition: 'visible' }
        ]
      }, SLOW_HOST);
      if (!res) return;
      assert.equal(res.r.success, true, res.r.error);
      assert.match(res.r.content.text, /Hello World!/);
    });

    test('the-internet hovers: the caption shows on hover', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: `${THE_INTERNET}/hovers`,
        formats: ['text'],
        actions: [
          { type: 'hover', selector: '.figure' },
          { type: 'wait', selector: '.figcaption', condition: 'visible' }
        ]
      }, SLOW_HOST);
      if (!res) return;
      assert.equal(res.r.success, true, res.r.error);
    });

    test('the-internet iframe: the snapshot lists the controls inside the frame (2.2)', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: `${THE_INTERNET}/iframe`,
        formats: ['text'],
        actions: [{ type: 'snapshot' }]
      }, SLOW_HOST);
      if (!res) return;
      assert.equal(res.r.success, true, res.r.error);
      const snap = res.r.actionResults[0].result;
      assert.equal(snap.source, 'aria');
      assert.match(snap.tree, /\[button\] "Bold"/);
    });

    test('the-internet shadowdom: snapshot runs and the slotted text is read', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: `${THE_INTERNET}/shadowdom`,
        formats: ['text'],
        actions: [{ type: 'snapshot', interactiveOnly: false }]
      }, SLOW_HOST);
      if (!res) return;
      assert.equal(res.r.success, true, res.r.error);
      assert.equal(res.r.actionResults[0].result.source, 'aria');
      assert.match(res.r.content.text, /In a list!/);
    });

    test('saucedemo login reaches the inventory; a jpeg screenshot is published as a resource', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: 'https://www.saucedemo.com/',
        formats: ['text'],
        actions: [
          { type: 'type', selector: '#user-name', text: 'standard_user' },
          { type: 'type', selector: '#password', text: 'secret_sauce' },
          { type: 'click', selector: '#login-button' },
          { type: 'wait', selector: '.inventory_list' },
          { type: 'screenshot', format: 'jpeg', quality: 50 }
        ]
      }, 30000);
      if (!res) return;
      assert.equal(res.r.success, true, res.r.error);
      assert.match(res.r.content.text, /Sauce Labs Backpack/);
      assert.match(res.r.screenshots?.[0]?.resourceUri ?? '', /^crawlforge:\/\/screenshot\//);
    });

    test('quotes.toscrape infinite scroll loads a second page', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: 'https://quotes.toscrape.com/scroll',
        formats: ['text'],
        actions: [
          { type: 'wait', selector: '.quote' },
          { type: 'scroll', direction: 'down', distance: 5000 },
          { type: 'wait', selector: '.quote:nth-of-type(11)', timeout: 10000 }
        ]
      }, 30000);
      if (!res) return;
      assert.equal(res.r.success, true, res.r.error);
    });

    test('scrapingcourse load-more button adds products', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: 'https://www.scrapingcourse.com/button-click',
        formats: ['text'],
        actions: [
          { type: 'click', selector: '#load-more-btn' },
          { type: 'wait', selector: '.product-item:nth-of-type(13)', timeout: 10000 }
        ]
      }, 30000);
      if (!res) return;
      assert.equal(res.r.success, true, res.r.error);
    });

    test('bing search: the move to /search is refused by robots.txt', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: 'https://www.bing.com/',
        formats: ['text'],
        actions: [
          { type: 'type', selector: '#sb_form_q', text: 'playwright aria snapshot' },
          { type: 'press', key: 'Enter' },
          { type: 'wait', selector: '#b_results' }
        ]
      }, 30000);
      if (!res) return;
      assert.equal(res.isError, true, 'a robots refusal is an error result (not charged)');
      assert.equal(res.r.success, false);
      assert.match(res.r.error, /robots\.txt on www\.bing\.com disallows/);
    });

    test('theguardian: a ref taken before a navigate is refused as stale', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: 'https://www.theguardian.com/international',
        formats: ['text'],
        actions: [
          { type: 'snapshot' },
          { type: 'navigate', url: 'https://www.theguardian.com/world' },
          { type: 'click', selector: '@e3' }
        ]
      }, 45000);
      if (!res) return;
      assert.equal(res.r.success, false);
      assert.match(res.r.error, /Stale element ref @e3/);
      // The page text takes the result over 40,000 chars, and the over-cap
      // shape keeps only scalars, so the counts stand in for actionResults.
      assert.equal(res.r.successfulActions, 2, 'snapshot and navigate succeeded');
    });

    test('ecosia on the stealth browser, consent rejected: passes or names the wall', async (t) => {
      const res = await call(t, 'scrape_with_actions', {
        url: 'https://www.ecosia.org/',
        formats: ['text'],
        browserOptions: { stealth: true, consent: 'reject' },
        actions: [{ type: 'snapshot' }]
      }, 60000);
      if (!res) return;
      if (res.r.blocked) {
        // Never success:true on a wall (Phase 5).
        assert.equal(res.r.success, false);
        assert.ok(res.r.blocked.vendor, 'a wall is reported with its vendor');
        return t.skip(`walled by ${res.r.blocked.vendor} on ${res.r.engine}`);
      }
      assert.equal(res.r.success, true, res.r.error);
      const tree = res.r.actionResults[0].result.tree;
      assert.match(tree, /\[textbox\] "Search the web/);
      assert.doesNotMatch(tree, /Accept all/, 'the consent banner was answered before the snapshot');
    });
  });

  describe('extract_embedded_state', () => {
    // keys_only keeps each response small; `found` is the assertion.
    const CASES = [
      ['ticketmaster', 'https://www.ticketmaster.com/discover/concerts', ['next_data']],
      ['nike', 'https://www.nike.com/w/mens-shoes-nik1zy7ok', ['next_data']],
      ['nextjs.org (RSC rows)', 'https://nextjs.org/', ['next_f', 'data_rows']],
      ['tiktok', 'https://www.tiktok.com/explore', ['json_scripts']],
      ['github', 'https://github.com/vercel/next.js', ['json_scripts']],
      ['remix', 'https://remix.run/', ['json_scripts']],
      ['angular', 'https://angular.dev/', ['json_scripts']],
      ['svelte.dev (SvelteKit)', 'https://svelte.dev/', ['sveltekit_data']]
    ];

    for (const [label, url, expected] of CASES) {
      test(`${label}: found ${expected.join(', ')}`, async (t) => {
        const res = await call(t, 'extract_embedded_state', { url, keys_only: true }, 30000);
        if (!res) return;
        assert.equal(res.isError, false, res.text.slice(0, 300));
        const names = foundNames(res.r);
        for (const name of expected) assert.ok(names.includes(name), `found: ${names.join(', ') || 'none'}`);
      });
    }

    test('coinmarketcap: path resolves to the live price', async (t) => {
      const res = await call(t, 'extract_embedded_state', {
        url: 'https://coinmarketcap.com/currencies/bitcoin/',
        path: 'next_data.props.pageProps.detailRes.detail.statistics.price'
      }, 30000);
      if (!res) return;
      assert.deepEqual(foundNames(res.r), ['next_data']);
      assert.equal(typeof res.r.data, 'number');
      assert.ok(res.r.data > 0);
    });

    test('nuxt.com: __NUXT_DATA__ decoded to objects (4.1)', async (t) => {
      const res = await call(t, 'extract_embedded_state', { url: 'https://nuxt.com/', path: 'nuxt_data.state' }, 30000);
      if (!res) return;
      assert.ok(foundNames(res.r).includes('nuxt_data'));
      assert.equal(typeof res.r.data, 'object');
      assert.ok(res.r.data && !Array.isArray(res.r.data), 'state is an object, not a devalue index array');
    });

    test('producthunt: an over-cap result is a preview within max_inline_chars (3.1)', async (t) => {
      const res = await call(t, 'extract_embedded_state', { url: 'https://www.producthunt.com/', max_inline_chars: 3000 }, 30000);
      if (!res) return;
      const names = foundNames(res.r);
      for (const name of ['next_f', 'apollo_ssr_transport']) assert.ok(names.includes(name), `found: ${names.join(', ')}`);
      assert.ok(res.r.result_handle, 'the full result is kept under a handle');
      // The limit is in characters of the result's compact JSON. The text on
      // the wire is pretty-printed, and _cost is added by the billing wrapper
      // after the result was shaped, so neither counts.
      const inline = JSON.stringify({ ...res.r, _cost: undefined }).length;
      assert.ok(inline <= 3000, `inline result is ${inline} chars`);
    });

    test('youtube watch page: ytInitialData and the player response, plain fetch (4.2)', async (t) => {
      const res = await call(t, 'extract_embedded_state', {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        path: 'yt_initial_player_response.videoDetails.title'
      }, 30000);
      if (!res) return;
      const names = foundNames(res.r);
      for (const name of ['yt_initial_data', 'yt_initial_player_response']) assert.ok(names.includes(name), `found: ${names.join(', ')}`);
      assert.match(res.r.data, /Never Gonna Give You Up/);
    });
  });

  describe('extract_links + extract_text, MCP and REST (Phase E5)', () => {
    // An httpstat.us instance (robots.txt 404) that holds the response for
    // `sleep` ms, up to 30 s. httpbin's /delay stops at 10 s, inside the 15 s
    // ladder timeout since Phase E2, so it no longer times out.
    const SLOW_URL = 'https://tools-httpstatus.pickup-services.com/200?sleep=25000';
    const PDF_URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

    /** A page the plain fetch reads: down, refused or newly walled is a skip. */
    const expectPage = (minLinks) => (tool) => (t, o) => {
      if (!o.ok && (o.refused || o.down || o.vendor)) return t.skip(`target unavailable: ${o.error.slice(0, 160)}`);
      assert.ok(o.ok, o.error);
      assertExtracted(tool, o.data, minLinks);
    };

    const CASES = [
      // example.com's page has had no <a> since 2026-10 at the latest: an
      // empty links array is the right answer there.
      ['example.com', { url: 'https://example.com/' }, 30000, expectPage(0)],
      ['wikipedia', { url: 'https://en.wikipedia.org/wiki/Web_scraping' }, 30000, expectPage(1)],
      ['bbc news', { url: 'https://www.bbc.com/news' }, 30000, expectPage(1)],
      // walmart answered this network a 444 F5 page before (E1) and a 200
      // since, so the block is never required: content, or a named wall.
      ['walmart: content or a named block', { url: 'https://www.walmart.com/' }, 30000, (tool) => (t, o) => {
        if (o.ok) return assertExtracted(tool, o.data);
        if (o.vendor) return t.diagnostic(`named block: ${o.vendor}`);
        if (o.refused || o.down) return t.skip(`target unavailable: ${o.error.slice(0, 160)}`);
        assert.fail(`neither content nor a named block: ${o.error.slice(0, 300)}`);
      }],
      ['ecosia escalate:true returns the page', { url: 'https://www.ecosia.org/', escalate: true }, 60000, (tool) => (t, o) => {
        if (!o.ok && (o.refused || o.down || o.vendor)) return t.skip(`still walled or down after escalation: ${o.error.slice(0, 160)}`);
        assert.ok(o.ok, o.error);
        assertExtracted(tool, o.data);
        assert.equal(typeof o.data.escalated, 'boolean', 'a caller who asked to escalate is told whether it ran');
      }],
      ['a PDF is UNSUPPORTED_CONTENT_TYPE', { url: PDF_URL }, 30000, () => (t, o, surface) => {
        if (o.refused || o.down) return t.skip(`target unavailable: ${o.error.slice(0, 160)}`);
        assert.equal(o.ok, false);
        assert.match(o.error, /UNSUPPORTED_CONTENT_TYPE/);
        if (surface === 'REST') assert.equal(o.status, 415);
      }],
      ['a slow host times out at 15 s', { url: SLOW_URL }, 40000, () => (t, o, surface) => {
        if (o.refused) return t.skip(o.error.slice(0, 160));
        assert.equal(o.ok, false, 'the host answered inside the 15 s timeout');
        if (surface === 'REST') {
          if (o.code !== 'FETCH_TIMEOUT' && o.down) return t.skip(`target unavailable: ${o.error.slice(0, 160)}`);
          assert.equal(o.status, 504, o.error);
          assert.equal(o.code, 'FETCH_TIMEOUT');
        } else {
          if (!/timeout/i.test(o.error) && o.down) return t.skip(`target unavailable: ${o.error.slice(0, 160)}`);
          assert.match(o.error, /Request timeout after 15000ms/);
        }
      }]
    ];

    for (const [label, args, ceilingMs, judge] of CASES) {
      for (const tool of ['extract_links', 'extract_text']) {
        for (const surface of ['MCP', 'REST']) {
          test(`${tool} ${label} (${surface})`, async (t) => {
            const o = await extractCall(t, surface, tool, args, ceilingMs);
            if (!o) return;
            judge(tool)(t, o, surface);
          });
        }
      }
    }
  });
});

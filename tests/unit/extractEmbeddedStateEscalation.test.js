/**
 * extract_embedded_state — plan Phase 3 (ACTIONS_EMBEDDED_STATE_FIX_PLAN):
 * keys_only (3.1) and escalate:true with window_state (3.2).
 *
 * The REAL handler and fetchAndParse run against a local HTTP server; the
 * stealth stage is a FAKE injected in place of server.js's stealthEscalation,
 * so no browser launches (the same seam scrapeEscalation.test.js uses).
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/extractEmbeddedStateEscalation.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { createExtractEmbeddedStateHandler, describeKeys, EMBEDDED_STATE_INPUT_SHAPE } =
  await import('../../src/tools/extract/extractEmbeddedState.js');
const { SCRAPE_ESCALATION_CREDITS } = await import('../../src/tools/scrape/escalation.js');
const { requestContext, reportedActualCost, markPreflightRefusal } = await import('../../src/server/requestContext.js');
const { makeWithAuth } = await import('../../src/server/withAuth.js');
const { SCRAPE_ESCALATED_HINT } = await import('../../src/server/fallbackHints.js');
const { default: authManager } = await import('../../src/core/AuthManager.js');

const BLOCKED = fileURLToPath(new URL('../fixtures/blocked/', import.meta.url));
const EMBEDDED = fileURLToPath(new URL('../fixtures/embedded-state/', import.meta.url));
const TICKETMASTER = readFileSync(`${EMBEDDED}ticketmaster-next-data.html`, 'utf8');
const YOUTUBE = readFileSync(`${EMBEDDED}youtube-watch.html`, 'utf8');
const NUXT3 = readFileSync(`${EMBEDDED}nuxt-com-home.html`, 'utf8');
const CLOUDFLARE = readFileSync(`${BLOCKED}cloudflare.html`, 'utf8');

// A client-rendered page: nothing a reader would see, but its state is here.
const SHELL_WITH_STATE = '<!doctype html><html><head><title>App</title></head><body><div id="__next"></div>' +
  '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"price":12.5}},"page":"/p"}</script></body></html>';
const ERROR_PAGE = (title) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'text/html' }); res.end(body); };
    if (path === '/robots.txt') return send(200, 'User-agent: *\nAllow: /\n');
    if (path === '/ticketmaster') return send(200, TICKETMASTER);
    if (path === '/cloudflare') return send(200, CLOUDFLARE); // walls come with 200, as served
    if (path === '/bare-403') return send(403, ERROR_PAGE('403 Forbidden'));
    if (path === '/rate-limited') return send(429, ERROR_PAGE('Too Many Requests'));
    if (path === '/missing') return send(404, ERROR_PAGE('Not Found'));
    if (path === '/broken') return send(503, ERROR_PAGE('Service Unavailable'));
    if (path === '/empty-shell') return send(200, readFileSync(`${BLOCKED}empty-shell.html`, 'utf8'));
    if (path === '/shell-with-state') return send(200, SHELL_WITH_STATE);
    return send(404, ERROR_PAGE('Not Found'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

/** A stealth stage that never launches a browser; `windowState` as scrapeWithStealth returns it. */
function fakeEscalator({ html = TICKETMASTER, status = 200, engine = 'chromium', windowState, throws = null } = {}) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    if (throws) throw throws;
    return {
      html,
      url: args.url,
      title: 'Rendered',
      text: 'The content the wall was hiding. '.repeat(20),
      status,
      engine,
      warnings: [],
      ...(windowState ? { windowState: structuredClone(windowState) } : {})
    };
  };
  fn.calls = calls;
  return fn;
}

/** Run the handler inside a request context so setActualCost has somewhere to write. */
async function run(handler, params) {
  let result;
  let reported;
  await requestContext.run({ preflightRefusal: null, actualCost: null }, async () => {
    result = await handler(params);
    reported = reportedActualCost();
  });
  const text = result.content[0].text;
  let body = null;
  try { body = JSON.parse(text); } catch { /* plain-text error */ }
  return { result, body, text, reported };
}

describe('3.1 keys_only: the first two levels of keys, no values', () => {
  test('describeKeys labels leaves and shows an array\'s length and first item', () => {
    const value = {
      a: { b: { c: 1 }, list: [1, 2], s: 'x', n: null, t: true },
      rows: [{ id: 1, name: 'x' }, { id: 2 }],
      empty: [],
      num: 4
    };
    // Two levels: the top keys, then their keys; an array on the last level is its label.
    assert.deepEqual(describeKeys(value, 2), {
      a: { b: 'object', list: 'array(2)', s: 'string', n: 'null', t: 'boolean' },
      rows: 'array(2)',
      empty: 'array(0)',
      num: 'number'
    });
    // An array with a level left shows its length and its first item.
    assert.deepEqual(describeKeys(value.rows, 2), { length: 2, first: { id: 'number', name: 'string' } });
    assert.deepEqual(describeKeys([], 2), { length: 0 });
    assert.deepEqual(describeKeys([[1, 2]], 2), { length: 1, first: 'array(2)' });
    assert.equal(describeKeys('s', 2), 'string');
  });

  test('on the whole result: payload names, then each payload\'s keys', async () => {
    const handler = createExtractEmbeddedStateHandler();
    const { body } = await run(handler, { url: `${baseUrl}/ticketmaster`, keys_only: true });
    assert.equal('data' in body, false);
    assert.deepEqual(Object.keys(body.keys), ['next_data']);
    assert.equal(body.keys.next_data.props, 'object');
    assert.equal(body.keys.next_data.buildId, 'string');
    assert.deepEqual(body.found.map((f) => f.name), ['next_data'], 'found is kept');
    assert.ok(body.bytes > 1000, 'bytes is still the selected data');
  });

  test('after a path: the keys of that subtree', async () => {
    const handler = createExtractEmbeddedStateHandler();
    const { body } = await run(handler, { url: `${baseUrl}/ticketmaster`, path: 'next_data.props.pageProps', keys_only: true });
    assert.equal(body.path, 'next_data.props.pageProps');
    assert.match(body.keys.eventsJsonLD, /^array\(\d+\)$/);
    const rows = await run(handler, { url: `${baseUrl}/ticketmaster`, path: 'next_data.props.pageProps.eventsJsonLD', keys_only: true });
    assert.ok(rows.body.keys.length > 0);
    assert.match(rows.body.keys.first, /^array\(\d+\)$/, 'a selected array: its length and its first item');
  });
});

describe('3.2 escalate:true — the plain fetch first, the stealth stage only on a wall', () => {
  test('a 200 Cloudflare wall escalates; the same parser reads the rendered document; charged 7', async () => {
    const escalator = fakeEscalator();
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: escalator });
    const { result, body, reported } = await run(handler, { url: `${baseUrl}/cloudflare`, escalate: true, wait_for: 1500 });

    assert.ok(!result.isError, JSON.stringify(body));
    assert.equal(body.escalated, true);
    assert.deepEqual(body.stealth, { engine: 'chromium', vendor_detected: 'cloudflare' });
    assert.deepEqual(body.found.map((f) => f.name), ['next_data']);
    assert.equal(body.data.next_data.buildId, 'KfC_3GF1zuM-t3vA0Rtwl');
    assert.equal(escalator.calls.length, 1);
    assert.deepEqual(escalator.calls[0], {
      url: `${baseUrl}/cloudflare`, engine: 'auto', respectRobots: undefined, waitFor: 1500, readWindowState: true
    });
    assert.equal(reported, 2 + SCRAPE_ESCALATION_CREDITS);
    assert.ok(body.warnings.some((w) => /blocked by cloudflare; the chromium stealth browser returned it/.test(w)));
  });

  for (const [path, status] of [['/bare-403', 403], ['/rate-limited', 429]]) {
    test(`a bare ${status} escalates with vendor_detected null`, async () => {
      const escalator = fakeEscalator();
      const handler = createExtractEmbeddedStateHandler({ escalateFetch: escalator });
      const { body, reported } = await run(handler, { url: `${baseUrl}${path}`, escalate: true });
      assert.equal(body.escalated, true);
      assert.equal(body.stealth.vendor_detected, null);
      assert.equal(escalator.calls.length, 1);
      assert.equal(reported, 7);
    });
  }

  for (const [path, status] of [['/missing', 404], ['/broken', 503]]) {
    test(`a ${status} does not escalate and fails as it does without escalate, charged at 2`, async () => {
      const escalator = fakeEscalator();
      const handler = createExtractEmbeddedStateHandler({ escalateFetch: escalator });
      const { result, text, reported } = await run(handler, { url: `${baseUrl}${path}`, escalate: true });
      assert.equal(result.isError, true);
      assert.match(text, new RegExp(`^Failed to extract embedded state: HTTP ${status}`));
      assert.equal(escalator.calls.length, 0, 'the browser cannot fix a missing page or a broken server');
      assert.equal(reported, 2);
    });
  }

  test('an empty shell with no state escalates', async () => {
    const escalator = fakeEscalator();
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: escalator });
    const { body } = await run(handler, { url: `${baseUrl}/empty-shell`, escalate: true });
    assert.equal(body.escalated, true);
    assert.equal(escalator.calls.length, 1);
    assert.ok(body.warnings.some((w) => /the plain fetch did not return the page/.test(w)));
  });

  test('a client-rendered shell that already carries its state does not escalate', async () => {
    const escalator = fakeEscalator();
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: escalator });
    const { body, reported } = await run(handler, { url: `${baseUrl}/shell-with-state`, escalate: true });
    assert.equal(body.escalated, false);
    assert.equal(body.data.next_data.props.pageProps.price, 12.5);
    assert.equal(escalator.calls.length, 0);
    assert.equal(reported, 2);
  });

  test('a normal page: escalated:false, charged 2; without escalate there is no escalated field', async () => {
    const escalator = fakeEscalator();
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: escalator });
    const escalated = await run(handler, { url: `${baseUrl}/ticketmaster`, escalate: true });
    assert.equal(escalated.body.escalated, false);
    assert.equal('stealth' in escalated.body, false);
    assert.equal(escalated.reported, 2);
    const plain = await run(handler, { url: `${baseUrl}/ticketmaster` });
    assert.equal('escalated' in plain.body, false);
    assert.equal(plain.reported, null, 'a call that never asked reports nothing and keeps the table price');
    assert.equal(escalator.calls.length, 0);
  });

  test('a wall that survives the stealth stage is an error that says the stage ran', async () => {
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator({ html: CLOUDFLARE }) });
    const { result, body, reported } = await run(handler, { url: `${baseUrl}/cloudflare`, escalate: true });
    assert.equal(result.isError, true);
    assert.equal(body.success, false);
    assert.equal(body.escalated, true);
    assert.equal(body.blocked.vendor, 'cloudflare');
    assert.equal('next_step' in body, false, 'withAuth adds the second-stage hint');
    assert.equal(reported, 7);
    assert.ok(body.warnings.some((w) => /did not get it either/.test(w)));
  });

  test('a stage that cannot run leaves the plain verdict, escalated:false, charged 2', async () => {
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator({ throws: new Error('browser crashed') }) });
    const { result, body, reported } = await run(handler, { url: `${baseUrl}/bare-403`, escalate: true });
    assert.equal(result.isError, true);
    assert.equal(body.escalated, false);
    assert.equal(body.status, 403);
    assert.match(body.next_step, /^The stealth stage did not run \(see warnings\) - retry once with escalate:true/);
    assert.ok(body.warnings.some((w) => /the stealth retry did not run — browser crashed/.test(w)));
    assert.equal(reported, 2);
  });

  test('no stage wired: said in warnings, nothing charged for it', async () => {
    const handler = createExtractEmbeddedStateHandler();
    const { body, reported } = await run(handler, { url: `${baseUrl}/bare-403`, escalate: true });
    assert.equal(body.escalated, false);
    assert.ok(body.warnings.some((w) => /no stealth stage is wired/.test(w)));
    assert.equal(reported, 2);
  });
});

// Without escalate the same gate decides, so a wall or an empty shell is an
// error that names the vendor and points at escalate:true (parity with the
// REST route, 2026-09-29).
describe('3.2 without escalate: a wall or an empty shell is an error pointing at escalate:true', () => {
  const handler = createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator() });

  test('a 200 Cloudflare wall names the vendor', async () => {
    const { result, text, reported } = await run(handler, { url: `${baseUrl}/cloudflare` });
    assert.equal(result.isError, true);
    assert.match(text, /^Failed to extract embedded state: cloudflare served a challenge page/);
    assert.match(text, /\nNext step: Call extract_embedded_state again with escalate:true/);
    assert.equal(reported, null, 'the table price; withAuth applies the error rate');
  });

  test('a 200 empty shell with no state', async () => {
    const { result, text } = await run(handler, { url: `${baseUrl}/empty-shell` });
    assert.equal(result.isError, true);
    assert.match(text, /no title and no text/);
    assert.match(text, /\nNext step: Call extract_embedded_state again with escalate:true/);
  });

  test('a client-rendered shell that carries its state is a success', async () => {
    const { result, body } = await run(handler, { url: `${baseUrl}/shell-with-state` });
    assert.ok(!result.isError);
    assert.equal(body.data.next_data.props.pageProps.price, 12.5);
  });

  test('a 503 keeps its HTTP error and does not suggest escalate', async () => {
    const { result, text } = await run(handler, { url: `${baseUrl}/broken` });
    assert.equal(result.isError, true);
    assert.match(text, /^Failed to extract embedded state: HTTP 503: Service Unavailable/);
    assert.ok(!/escalate:true/.test(text));
  });
});

describe('3.2 window_state: globals read after JavaScript ran', () => {
  const windowState = {
    ytInitialData: { contents: { twoColumn: { title: 'A video' } } },
    ytInitialPlayerResponse: { videoDetails: { videoId: 'abc' } },
    __NEXT_DATA__: { props: { duplicate: true } }
  };

  test('reported under window_state with a note; values under data.window_state; a global the HTML already had is not repeated', async () => {
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator({ windowState }) });
    const { body } = await run(handler, { url: `${baseUrl}/cloudflare`, escalate: true });
    assert.equal(body.window_state.note, 'read from window after JavaScript ran, not from the served HTML');
    assert.deepEqual(body.window_state.found.map((f) => f.name), ['ytInitialData', 'ytInitialPlayerResponse']);
    assert.equal(body.window_state.found[0].bytes, Buffer.byteLength(JSON.stringify(windowState.ytInitialData)));
    assert.deepEqual(body.data.window_state.ytInitialData, windowState.ytInitialData);
    assert.equal('__NEXT_DATA__' in body.data.window_state, false);
    assert.ok(body.warnings.some((w) => /__NEXT_DATA__ is not repeated/.test(w)));
    assert.deepEqual(body.found.map((f) => f.name), ['next_data'], 'found stays the served-HTML list');
  });

  test('a path into window_state is read as written, beside a single HTML payload (R21 rewrite untouched)', async () => {
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator({ windowState }) });
    const scoped = await run(handler, { url: `${baseUrl}/cloudflare`, escalate: true, path: 'window_state.ytInitialData.contents' });
    assert.equal(scoped.body.path, 'window_state.ytInitialData.contents');
    assert.deepEqual(scoped.body.data, windowState.ytInitialData.contents);
    assert.ok(!scoped.body.warnings.some((w) => /was read as/.test(w)));

    const bare = await run(handler, { url: `${baseUrl}/cloudflare`, escalate: true, path: 'props.pageProps' });
    assert.equal(bare.body.path, 'next_data.props.pageProps', 'a bare path still resolves inside the only HTML payload');
  });

  test('state only on window is a success, not "No embedded state found"', async () => {
    const rendered = '<!doctype html><html><head><title>Video</title></head><body><p>' + 'Words on a page. '.repeat(30) + '</p></body></html>';
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator({ html: rendered, windowState: { ytInitialData: { a: 1 } } }) });
    const { result, body } = await run(handler, { url: `${baseUrl}/bare-403`, escalate: true });
    assert.ok(!result.isError, JSON.stringify(body));
    assert.deepEqual(body.found, []);
    assert.deepEqual(body.data.window_state, { ytInitialData: { a: 1 } });
    assert.ok(!body.warnings.some((w) => /No embedded state found/.test(w)));
  });

  test('keys_only covers window_state too', async () => {
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator({ windowState }) });
    const { body } = await run(handler, { url: `${baseUrl}/cloudflare`, escalate: true, keys_only: true });
    assert.deepEqual(body.keys.window_state, { ytInitialData: 'object', ytInitialPlayerResponse: 'object' });
  });

  // Phase 4.2: the served HTML now parses these globals itself, so the
  // window copy must be dropped by the same `variable` match.
  test('ytInitialData, ytInitialPlayerResponse, __remixContext, __TGT_DATA__ and __PWS_DATA__ the HTML parsed are not repeated', async () => {
    const extra = '<script>window.__remixContext = {"url":"/r"}; window.__TGT_DATA__ = {"t":1}; window.__PWS_DATA__ = {"p":1};</script></body>';
    const rendered = YOUTUBE.replace('</body>', extra);
    const onWindow = {
      ytInitialData: { a: 1 },
      ytInitialPlayerResponse: { b: 1 },
      __remixContext: { c: 1 },
      __TGT_DATA__: { d: 1 },
      __PWS_DATA__: { e: 1 },
      __APOLLO_STATE__: { only: 'on window' }
    };
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator({ html: rendered, windowState: onWindow }) });
    const { body } = await run(handler, { url: `${baseUrl}/cloudflare`, escalate: true });
    assert.deepEqual(body.found.map((f) => f.variable), ['ytInitialData', 'ytInitialPlayerResponse', '__remixContext', '__TGT_DATA__', '__PWS_DATA__']);
    assert.deepEqual(body.window_state.found.map((f) => f.name), ['__APOLLO_STATE__']);
    assert.deepEqual(Object.keys(body.data.window_state), ['__APOLLO_STATE__']);
    for (const name of ['ytInitialData', 'ytInitialPlayerResponse', '__remixContext', '__TGT_DATA__', '__PWS_DATA__']) {
      assert.ok(body.warnings.some((w) => w.startsWith(`window_state: ${name} is not repeated`)), name);
    }
  });

  test('impit got the page: no browser ran, so the warnings say window_state was not read', async () => {
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator({ engine: 'impit' }) });
    const { body } = await run(handler, { url: `${baseUrl}/bare-403`, escalate: true });
    assert.equal(body.stealth.engine, 'impit');
    assert.equal('window_state' in body, false);
    assert.ok(body.warnings.some((w) => /no JavaScript ran and window_state was not read/.test(w)));
  });
});

// The billing half end to end: the real cost table and the real withAuth.
describe('raw reaches the escalated re-parse too', () => {
  test('a walled Nuxt 3 page re-read with raw:true keeps the undecoded array', async () => {
    const handler = createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator({ html: NUXT3 }) });
    const plain = await run(handler, { url: `${baseUrl}/cloudflare`, escalate: true });
    assert.deepEqual(plain.body.found.map((f) => f.name), ['nuxt_data', 'nuxt']);
    const raw = await run(handler, { url: `${baseUrl}/cloudflare`, escalate: true, raw: true });
    assert.equal(raw.body.escalated, true);
    assert.deepEqual(raw.body.found.map((f) => f.name), ['nuxt_data', 'nuxt', 'json_scripts']);
    assert.equal(raw.body.data.json_scripts[0].id, '__NUXT_DATA__');
  });
});

describe('_cost through withAuth: projected 7, actual 2 or 7', () => {
  const wrap = (handler) => {
    const reportCalls = [];
    const auth = {
      isCreatorMode: () => false,
      getToolCost: (name, params) => authManager.getToolCost(name, params),
      projectCost: (name, params) => authManager.projectCost(name, params),
      checkCredits: async () => true,
      reportUsage: async (...args) => { reportCalls.push(args); },
      creditCache: new Map()
    };
    const withAuth = makeWithAuth({ authManager: auth, logger: { info() {}, warn() {}, error() {}, debug() {} } });
    return { handler: withAuth('extract_embedded_state', handler), reportCalls };
  };
  const bodyOf = (result) => JSON.parse(result.content[0].text);

  test('the table: 2, or 7 projected with escalate:true', () => {
    assert.equal(authManager.getToolCost('extract_embedded_state', {}), 2);
    assert.equal(authManager.getToolCost('extract_embedded_state', { escalate: false }), 2);
    assert.equal(authManager.getToolCost('extract_embedded_state', { escalate: true }), 7);
    assert.equal(authManager.getToolCost('extract_embedded_state', { escalate: 'true' }), 2, 'only a real true prices the stage');
    assert.match(authManager.projectCost('extract_embedded_state', { escalate: true }).note, /drops back to 2/);
  });

  test('a page the plain fetch reads charges 2 against a projection of 7', async () => {
    const { handler, reportCalls } = wrap(createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator() }));
    const body = bodyOf(await handler({ url: `${baseUrl}/ticketmaster`, escalate: true }));
    assert.equal(body._cost.projected, 7);
    assert.equal(body._cost.actual, 2);
    assert.equal(reportCalls[0][1], 2);
  });

  test('a walled page that escalates charges 7', async () => {
    const { handler, reportCalls } = wrap(createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator() }));
    const body = bodyOf(await handler({ url: `${baseUrl}/cloudflare`, escalate: true }));
    assert.equal(body._cost.actual, 7);
    assert.equal(reportCalls[0][1], 7);
  });

  test('an escalated failure carries the second-stage hint, not stealth_mode', async () => {
    const { handler } = wrap(createExtractEmbeddedStateHandler({ escalateFetch: fakeEscalator({ html: CLOUDFLARE }) }));
    const result = await handler({ url: `${baseUrl}/cloudflare`, escalate: true });
    const body = bodyOf(result);
    assert.equal(result.isError, true);
    assert.equal(body.next_step, SCRAPE_ESCALATED_HINT);
    assert.equal(body._cost.actual, 3, 'the error rate: half of the 7 that ran');
  });

  test('find with keys_only is refused before any fetch and bills nothing', async () => {
    const escalator = fakeEscalator();
    const { handler, reportCalls } = wrap(createExtractEmbeddedStateHandler({ escalateFetch: escalator }));
    const result = await handler({ url: `${baseUrl}/cloudflare`, escalate: true, find: 'price', keys_only: true });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /find and keys_only cannot be combined/);
    assert.equal(escalator.calls.length, 0);
    assert.equal(reportCalls.length, 0);
  });

  test('a refused escalation bills nothing', async () => {
    const refusing = async () => {
      markPreflightRefusal('ROBOTS_DISALLOWED');
      throw new Error('robots.txt disallows this path for CrawlForge');
    };
    const { handler, reportCalls } = wrap(createExtractEmbeddedStateHandler({ escalateFetch: refusing }));
    const result = await handler({ url: `${baseUrl}/cloudflare`, escalate: true });
    assert.equal(result.isError, true);
    assert.equal(bodyOf(result)._cost.actual, 0);
    assert.equal(reportCalls.length, 0);
  });
});

describe('the input schema', () => {
  const schema = z.object(EMBEDDED_STATE_INPUT_SHAPE);

  test('the new params, their defaults and bounds', () => {
    const parsed = schema.parse({ url: 'https://example.com/' });
    assert.equal(parsed.keys_only, false);
    assert.equal(parsed.find, undefined);
    assert.equal(parsed.raw, false);
    assert.equal(schema.safeParse({ url: 'https://example.com/', find: '' }).success, false);
    assert.equal(schema.safeParse({ url: 'https://example.com/', find: 'x'.repeat(101) }).success, false);
    assert.equal(schema.safeParse({ url: 'https://example.com/', find: 'x'.repeat(100) }).success, true);
    assert.equal(parsed.escalate, false);
    assert.equal(parsed.escalate_engine, 'auto');
    assert.equal(parsed.wait_for, undefined);
    assert.equal(schema.safeParse({ url: 'https://example.com/', wait_for: 30001 }).success, false);
    assert.equal(schema.safeParse({ url: 'https://example.com/', escalate_engine: 'firefox' }).success, false);
    assert.deepEqual(Object.keys(EMBEDDED_STATE_INPUT_SHAPE), ['url', 'path', 'keys_only', 'find', 'raw', 'escalate', 'escalate_engine', 'wait_for']);
  });

  test('the escalate description states the price rule and the ordering', () => {
    const text = EMBEDDED_STATE_INPUT_SHAPE.escalate.description;
    assert.match(text, /Projected at 2\+5; the actual charge stays at 2/);
    assert.match(text, /404 or 5xx never escalates/);
    assert.match(text, /window_state/);
  });

  test('server.js describes escalate, keys_only, window_state and the preview, and no longer promises a whole result', () => {
    const source = readFileSync(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');
    const start = source.indexOf('registerToolIfEnabled("extract_embedded_state"');
    const block = source.slice(start, source.indexOf('registerToolIfEnabled(', start + 10));
    assert.match(block, /projected at 7, charged 2 when the plain fetch worked/);
    assert.match(block, /keys_only:true/);
    assert.match(block, /find:\\"<key>\\"/);
    assert.match(block, /window_state/);
    assert.match(block, /preview/);
    assert.match(block, /result_handle/);
    assert.match(block, /stealthEscalation\(\{ \.\.\.args, tool: 'extract_embedded_state' \}\)/);
    assert.ok(!/never truncat/i.test(block));
  });
});

/**
 * Unit tests for `scrape`'s opt-in auto-escalation (Phase 3).
 *
 * `escalate: true` runs the plain fetch first (G1 — never start with
 * stealth) and only retries a blocked verdict in the stealth browser. These
 * tests exercise the REAL UnifiedScrapeTool + fetchAndParse against a local
 * HTTP server, with a FAKE escalator injected in place of the browser stage:
 * a unit test must never launch Playwright, and the seam exists precisely so
 * the tool module carries no browser dependency.
 *
 * The fetch path enforces SSRF protection (blocks loopback by default), so
 * ALLOWED_DOMAINS is set BEFORE the first transitive import of
 * src/constants/config.js. The vendor fixtures are the same ones
 * tests/unit/scrapeBlockedVerdict.test.js serves.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/scrapeEscalation.test.js
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');
const { SCRAPE_ESCALATION_CREDITS, scrapeEscalationSurcharge, aBrowserMightPass } =
  await import('../../src/tools/scrape/escalation.js');
const { noteHostBlocked, getHostBlock, _resetHostRateLimiter } =
  await import('../../src/utils/hostRateLimiter.js');
const { requestContext, reportedActualCost, markPreflightRefusal, preflightRefusal } =
  await import('../../src/server/requestContext.js');
const { makeWithAuth } = await import('../../src/server/withAuth.js');
const { SCRAPE_ESCALATED_HINT } = await import('../../src/server/fallbackHints.js');
const { default: authManager } = await import('../../src/core/AuthManager.js');

const FIXTURES = fileURLToPath(new URL('../fixtures/blocked/', import.meta.url));

const NORMAL_PAGE = `<!doctype html><html><head><title>A real page</title></head>
<body><main><h1>A real page</h1><p>${'Ordinary prose that a reader would see. '.repeat(20)}</p></main></body></html>`;

const ERROR_PAGE = (title) =>
  `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>
<p>The server will not serve this resource.</p></body></html>`;

// What the fake stealth browser "renders" once it gets past the wall.
const RENDERED_PAGE = `<!doctype html><html><head><title>Behind the wall</title></head>
<body><main><h1>Behind the wall</h1><p>${'The content the wall was hiding. '.repeat(20)}</p>
<a href="/next">next</a></main></body></html>`;

let server;
let baseUrl;
let requests; // every path the local server was asked for

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    requests.push(path);
    if (path === '/robots.txt') {
      res.writeHead(404);
      res.end();
      return;
    }
    if (path === '/normal') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(NORMAL_PAGE);
      return;
    }
    // A wall that names no vendor: the bare 403 an IP-reputation or WAF block
    // sends, which is what travel.state.gov answers some networks with.
    if (path === '/bare-403') {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end(ERROR_PAGE('403 Forbidden'));
      return;
    }
    if (path === '/missing') {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(ERROR_PAGE('Not Found'));
      return;
    }
    if (path === '/broken') {
      res.writeHead(503, { 'Content-Type': 'text/html' });
      res.end(ERROR_PAGE('Service Unavailable'));
      return;
    }
    // Walls are served with 200, exactly as the vendors serve them.
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(`${FIXTURES}${path.slice(1)}.html`, 'utf8'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests = [];
  _resetHostRateLimiter();
});

/** A stealth stage that never touches a browser. */
function fakeEscalator({ html = RENDERED_PAGE, status = 200, throws = null } = {}) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    if (throws) throw throws;
    return {
      html,
      url: args.url,
      title: 'Behind the wall',
      text: 'The content the wall was hiding.',
      status,
      engine: args.engine,
      warnings: []
    };
  };
  fn.calls = calls;
  return fn;
}

/** Run a scrape inside a request context so setActualCost has somewhere to write. */
async function scrapeWithCost(tool, params) {
  let result;
  let reported;
  let refusal;
  await requestContext.run({ preflightRefusal: null, actualCost: null }, async () => {
    result = await tool.execute(params);
    reported = reportedActualCost();
    refusal = preflightRefusal();
  });
  return { result, reported, refusal };
}

describe('a blocked page with escalate:true runs the stealth stage and returns its content', () => {
  test('cloudflare wall → escalated markdown, one browser call, charged 7', async () => {
    const escalator = fakeEscalator();
    const tool = new UnifiedScrapeTool({ escalateScrape: escalator });

    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/cloudflare`,
      formats: ['markdown', 'links'],
      resolveHiddenContent: 'off',
      escalate: true
    });

    assert.equal(result.success, true);
    assert.equal(result.escalated, true);
    assert.deepEqual(result.stealth, { engine: 'playwright', vendor_detected: 'cloudflare' });
    assert.match(result.content.markdown, /The content the wall was hiding/);
    assert.equal(result.content.links.total_count, 1, 'every format is built from the escalated document');
    assert.equal(escalator.calls.length, 1);
    assert.equal(escalator.calls[0].url, `${baseUrl}/cloudflare`);
    assert.equal(escalator.calls[0].engine, 'playwright');
    assert.equal(reported, 2 + SCRAPE_ESCALATION_CREDITS, 'the escalation surcharge is charged only because it ran');
    assert.ok(result.warnings.some((w) => /blocked by cloudflare; the playwright stealth browser returned it/.test(w)));
  });

  // Escalation must fire on ANY failed verdict, not only a vendor-named
  // block: an empty shell and an error placeholder are precisely the cases a
  // browser fixes, and they carry no vendor at all.
  test('an empty shell escalates with vendor_detected null', async () => {
    const escalator = fakeEscalator();
    const tool = new UnifiedScrapeTool({ escalateScrape: escalator });

    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/empty-shell`,
      formats: ['markdown'],
      resolveHiddenContent: 'off',
      escalate: true
    });

    assert.equal(result.success, true);
    assert.equal(result.escalated, true);
    assert.deepEqual(result.stealth, { engine: 'playwright', vendor_detected: null });
    assert.match(result.content.markdown, /The content the wall was hiding/);
    assert.equal(escalator.calls.length, 1, 'a shell with no vendor still reaches the browser');
    assert.ok(result.warnings.some((w) => /the plain fetch did not return the page/.test(w)));
    assert.ok(result.warnings.every((w) => !/blocked by/.test(w)), 'an empty shell is not called a block');
    assert.equal(reported, 2 + SCRAPE_ESCALATION_CREDITS);
  });

  test('a soft-error placeholder escalates too', async () => {
    const escalator = fakeEscalator();
    const tool = new UnifiedScrapeTool({ escalateScrape: escalator });

    const { result } = await scrapeWithCost(tool, {
      url: `${baseUrl}/soft-error`,
      formats: ['markdown'],
      resolveHiddenContent: 'off',
      escalate: true
    });

    assert.equal(result.success, true);
    assert.equal(result.escalated, true);
    assert.equal(result.stealth.vendor_detected, null);
    assert.equal(escalator.calls.length, 1);
  });

  test('escalate_engine:"camoufox" reaches the stage', async () => {
    const escalator = fakeEscalator();
    const tool = new UnifiedScrapeTool({ escalateScrape: escalator });

    const { result } = await scrapeWithCost(tool, {
      url: `${baseUrl}/datadome`,
      formats: ['markdown'],
      resolveHiddenContent: 'off',
      escalate: true,
      escalate_engine: 'camoufox'
    });

    assert.equal(result.escalated, true);
    assert.equal(result.stealth.engine, 'camoufox');
    assert.equal(escalator.calls[0].engine, 'camoufox');
  });

  test('a query format still works on the escalated page, and both surcharges are charged', async () => {
    const tool = new UnifiedScrapeTool({ escalateScrape: fakeEscalator() });

    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/perimeterx`,
      formats: ['markdown', { type: 'highlights', query: 'content the wall was hiding' }],
      resolveHiddenContent: 'off',
      escalate: true
    });

    assert.equal(result.escalated, true);
    assert.ok(result.content.highlights.length > 0, 'highlights index the escalated markdown');
    assert.match(result.content.highlights[0].text, /wall was hiding/);
    assert.equal(reported, 2 + 1 + SCRAPE_ESCALATION_CREDITS);
  });
});

describe('a clean page never reaches the stealth stage', () => {
  test('escalate:true on a page that fetches fine reports escalated:false and the base price', async () => {
    const escalator = fakeEscalator();
    const tool = new UnifiedScrapeTool({ escalateScrape: escalator });

    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/normal`,
      formats: ['markdown'],
      resolveHiddenContent: 'off',
      escalate: true
    });

    assert.equal(result.success, true);
    assert.equal(result.escalated, false);
    assert.equal(result.stealth, undefined, 'no stealth block when nothing escalated');
    assert.match(result.content.markdown, /Ordinary prose that a reader would see/);
    assert.equal(escalator.calls.length, 0, 'the browser was never launched');
    assert.equal(reported, 2, 'projected 7, charged 2 — the projection is a ceiling');
  });

  test('without escalate the result shape is unchanged and the memory is never read', async () => {
    const escalator = fakeEscalator();
    const tool = new UnifiedScrapeTool({ escalateScrape: escalator });
    noteHostBlocked(`${baseUrl}/`, 'cloudflare');

    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/normal`,
      formats: ['markdown'],
      resolveHiddenContent: 'off'
    });

    assert.equal(result.success, true);
    assert.ok(!('escalated' in result), 'a call that never asked keeps today\'s result shape');
    assert.ok(!('stealth' in result));
    assert.equal(escalator.calls.length, 0);
    assert.ok(requests.includes('/normal'), 'the remembered block did not skip the plain fetch');
    assert.equal(reported, 2);
  });

  test('escalate:false is not escalate:true — no field, no surcharge', async () => {
    const escalator = fakeEscalator();
    const tool = new UnifiedScrapeTool({ escalateScrape: escalator });

    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/cloudflare`,
      formats: ['markdown'],
      resolveHiddenContent: 'off',
      escalate: false
    });

    assert.equal(result.success, false);
    assert.equal(result.blocked.vendor, 'cloudflare');
    assert.ok(!('escalated' in result));
    assert.equal(escalator.calls.length, 0);
    assert.equal(reported, 2, 'a blocked call that never asked to escalate bills the base, not 7');
  });
});

describe('the host memory (3.3) skips a doomed plain fetch', () => {
  test('a remembered block goes straight to the browser and says so', async () => {
    const escalator = fakeEscalator();
    const tool = new UnifiedScrapeTool({ escalateScrape: escalator });
    noteHostBlocked(`${baseUrl}/`, 'cloudflare');

    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/cloudflare`,
      formats: ['markdown'],
      resolveHiddenContent: 'off',
      escalate: true
    });

    assert.equal(result.success, true);
    assert.equal(result.escalated, true);
    assert.equal(result.stealth.vendor_detected, 'cloudflare');
    assert.equal(escalator.calls.length, 1);
    assert.deepEqual(requests, [], 'no plain fetch was made at all');
    assert.ok(result.warnings.some((w) => /walled this host within the last 24 hours/.test(w)));
    assert.equal(reported, 2 + SCRAPE_ESCALATION_CREDITS);
  });

  test('a stealth success does not clear the memory — only a clean plain fetch does', async () => {
    const tool = new UnifiedScrapeTool({ escalateScrape: fakeEscalator() });
    noteHostBlocked(`${baseUrl}/`, 'cloudflare');

    await scrapeWithCost(tool, {
      url: `${baseUrl}/cloudflare`, formats: ['markdown'], resolveHiddenContent: 'off', escalate: true
    });
    assert.equal(getHostBlock(`${baseUrl}/`).vendor, 'cloudflare', 'the host still walls a plain fetch');

    await scrapeWithCost(tool, {
      url: `${baseUrl}/normal`, formats: ['markdown'], resolveHiddenContent: 'off'
    });
    assert.equal(getHostBlock(`${baseUrl}/`), null);
  });
});

// Against a real Cloudflare wall this is the branch that usually fires: the
// browser is refused as well as the plain fetch (a TLS-level block needs
// residential proxies, which we do not offer). It must report the STEALTH
// verdict, keep escalated:true, and hand 3.4 the second-stage hint.
describe('the stealth render is judged too', () => {
  test('a wall that survives the browser fails with escalated:true and the stealth verdict', async () => {
    const wall = readFileSync(`${FIXTURES}cloudflare.html`, 'utf8');
    const tool = new UnifiedScrapeTool({ escalateScrape: fakeEscalator({ html: wall, status: 403 }) });

    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/cloudflare`,
      formats: ['markdown'],
      resolveHiddenContent: 'off',
      escalate: true
    });

    assert.equal(result.success, false);
    assert.equal(result.escalated, true);
    assert.deepEqual(result.stealth, { engine: 'playwright', vendor_detected: 'cloudflare' });
    assert.equal(result.blocked.vendor, 'cloudflare');
    assert.ok(result.blocked.evidence, 'the stealth verdict names its own evidence');
    assert.equal(result.status, 403, 'the status is the stealth navigation\'s, not the plain fetch\'s');
    assert.match(result.error, /the stealth browser did not pass it/);
    assert.doesNotMatch(result.error, /a plain fetch/, 'the plain verdict was replaced, not reported');
    assert.deepEqual(result.content, {}, 'a wall is never returned as content');
    assert.ok(result.warnings.some((w) => /the playwright stealth browser did not get it either/.test(w)));
    assert.equal(reported, 2 + SCRAPE_ESCALATION_CREDITS, 'the browser ran; withAuth halves it as an error result');
  });

  test('the vendor the browser hits is the one reported, even when it differs', async () => {
    const otherWall = readFileSync(`${FIXTURES}datadome.html`, 'utf8');
    const tool = new UnifiedScrapeTool({ escalateScrape: fakeEscalator({ html: otherWall }) });

    const { result } = await scrapeWithCost(tool, {
      url: `${baseUrl}/cloudflare`,
      formats: ['markdown'],
      resolveHiddenContent: 'off',
      escalate: true
    });

    assert.equal(result.blocked.vendor, 'datadome', 'blocked is the stealth verdict');
    assert.equal(result.stealth.vendor_detected, 'cloudflare', 'vendor_detected stays the plain fetch\'s, per the contract');
  });

  test('the host memory still records what the PLAIN fetch met', async () => {
    const wall = readFileSync(`${FIXTURES}cloudflare.html`, 'utf8');
    const tool = new UnifiedScrapeTool({ escalateScrape: fakeEscalator({ html: wall }) });

    await scrapeWithCost(tool, {
      url: `${baseUrl}/cloudflare`, formats: ['markdown'], resolveHiddenContent: 'off', escalate: true
    });

    assert.equal(getHostBlock(`${baseUrl}/`).vendor, 'cloudflare');
  });
});

describe('a refused escalation costs nothing and never launches a browser', () => {
  test('the gate refusal is caught, warned about, and the plain block is returned', async () => {
    const refusing = async () => {
      // What browserPreflight does: stamp the refusal, then throw.
      markPreflightRefusal('ROBOTS_DISALLOWED');
      throw new Error('robots.txt disallows https://example.com/ for CrawlForge');
    };
    const tool = new UnifiedScrapeTool({ escalateScrape: refusing });

    const { result, refusal } = await scrapeWithCost(tool, {
      url: `${baseUrl}/cloudflare`,
      formats: ['markdown'],
      resolveHiddenContent: 'off',
      escalate: true
    });

    assert.equal(result.success, false);
    assert.equal(result.escalated, false, 'nothing rendered, so nothing escalated');
    assert.equal(result.stealth, undefined);
    assert.equal(result.blocked.vendor, 'cloudflare', 'the plain fetch\'s verdict still stands');
    assert.ok(result.warnings.some((w) => /the stealth retry did not run/.test(w)));
    // The refusal flag is what makes withAuth bill the WHOLE call zero.
    assert.equal(refusal, 'ROBOTS_DISALLOWED');
  });

  test('a refusal after a skipped plain fetch reports the block it was skipped for', async () => {
    const refusing = async () => {
      markPreflightRefusal('ROBOTS_DISALLOWED');
      throw new Error('robots.txt disallows this path for CrawlForge');
    };
    const tool = new UnifiedScrapeTool({ escalateScrape: refusing });
    noteHostBlocked(`${baseUrl}/`, 'akamai');

    const { result, refusal } = await scrapeWithCost(tool, {
      url: `${baseUrl}/akamai`,
      formats: ['markdown'],
      resolveHiddenContent: 'off',
      escalate: true
    });

    assert.equal(result.success, false);
    assert.equal(result.escalated, false);
    assert.deepEqual(requests, [], 'no plain fetch, no browser');
    assert.match(result.error, /akamai walled this host within the last 24 hours/);
    assert.match(result.error, /robots\.txt disallows/);
    assert.equal(refusal, 'ROBOTS_DISALLOWED');
  });

  test('a server with no stealth stage wired says so instead of throwing', async () => {
    const tool = new UnifiedScrapeTool();

    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/vercel`,
      formats: ['markdown'],
      resolveHiddenContent: 'off',
      escalate: true
    });

    assert.equal(result.success, false);
    assert.equal(result.escalated, false);
    assert.equal(result.blocked.vendor, 'vercel');
    assert.ok(result.warnings.some((w) => /no stealth stage is wired/.test(w)));
    assert.equal(reported, 2, 'nothing escalated, so nothing is charged for it');
  });
});

// The phase gate's billing half, end to end: the real cost table, the real
// withAuth, the real tool. A live run cannot show this — creator mode is
// billing-exempt and zeroes every _cost — so it is pinned here instead.
describe('_cost through the real withAuth: projected 7, actual 2 or 7', () => {
  const wrap = (tool) => {
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
    const handler = withAuth('scrape', async (params) => {
      const result = await tool.execute(params);
      return result.success === false
        ? { content: [{ type: 'text', text: JSON.stringify(result) }], isError: true }
        : { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    return { handler, reportCalls };
  };
  const bodyOf = (result) => JSON.parse(result.content[0].text);

  test('a plain page charges 2 against a projection of 7', async () => {
    const escalator = fakeEscalator();
    const { handler, reportCalls } = wrap(new UnifiedScrapeTool({ escalateScrape: escalator }));

    const body = bodyOf(await handler({
      url: `${baseUrl}/normal`, formats: ['markdown'], resolveHiddenContent: 'off', escalate: true
    }));

    assert.equal(body.escalated, false);
    assert.equal(body._cost.projected, 7);
    assert.equal(body._cost.actual, 2);
    assert.equal(reportCalls[0][1], 2);
    assert.equal(escalator.calls.length, 0);
  });

  test('a walled page that escalates charges the full 7', async () => {
    const { handler, reportCalls } = wrap(new UnifiedScrapeTool({ escalateScrape: fakeEscalator() }));

    const body = bodyOf(await handler({
      url: `${baseUrl}/cloudflare`, formats: ['markdown'], resolveHiddenContent: 'off', escalate: true
    }));

    assert.equal(body.escalated, true);
    assert.equal(body._cost.projected, 7);
    assert.equal(body._cost.actual, 7);
    assert.equal(reportCalls[0][1], 7);
  });

  test('a refused escalation bills nothing at all', async () => {
    const refusing = async () => {
      markPreflightRefusal('ROBOTS_DISALLOWED');
      throw new Error('robots.txt disallows this path for CrawlForge');
    };
    const { handler, reportCalls } = wrap(new UnifiedScrapeTool({ escalateScrape: refusing }));

    const result = await handler({
      url: `${baseUrl}/cloudflare`, formats: ['markdown'], resolveHiddenContent: 'off', escalate: true
    });

    assert.equal(result.isError, true);
    assert.equal(bodyOf(result)._cost.actual, 0);
    assert.equal(reportCalls.length, 0, 'a refusal reports no usage at all');
  });

  test('an escalated failure carries the second-stage hint, not stealth_mode', async () => {
    const wall = readFileSync(`${FIXTURES}cloudflare.html`, 'utf8');
    const { handler } = wrap(new UnifiedScrapeTool({ escalateScrape: fakeEscalator({ html: wall }) }));

    const body = bodyOf(await handler({
      url: `${baseUrl}/cloudflare`, formats: ['markdown'], resolveHiddenContent: 'off', escalate: true
    }));

    assert.equal(body.escalated, true);
    assert.equal(body.next_step, SCRAPE_ESCALATED_HINT);
  });
});

test('the surcharge helper reads the raw param: only exactly true costs', () => {
  assert.equal(SCRAPE_ESCALATION_CREDITS, 5);
  assert.equal(scrapeEscalationSurcharge(true), 5);
  for (const notTrue of [false, undefined, null, 'true', 1, {}, []]) {
    assert.equal(scrapeEscalationSurcharge(notTrue), 0, `priced as 0: ${JSON.stringify(notTrue)}`);
  }
});

describe('only a failure a browser could change is escalated', () => {
  test('a bare 403 with no vendor named DOES escalate: a WAF or IP block often yields to a browser', async () => {
    const escalator = fakeEscalator();
    const tool = new UnifiedScrapeTool({ escalateScrape: escalator });
    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/bare-403`, formats: ['markdown'], resolveHiddenContent: 'off', escalate: true
    });
    assert.equal(escalator.calls.length, 1, 'the browser ran');
    assert.equal(result.success, true);
    assert.equal(result.escalated, true);
    assert.equal(result.stealth.vendor_detected, null, 'no vendor was named by the wall');
    assert.match(result.content.markdown, /The content the wall was hiding/);
    assert.equal(reported, 2 + SCRAPE_ESCALATION_CREDITS);
  });

  test('a 404 does NOT escalate: a missing page is not a wall, and the browser would cost 5 for nothing', async () => {
    const escalator = fakeEscalator();
    const tool = new UnifiedScrapeTool({ escalateScrape: escalator });
    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/missing`, formats: ['markdown'], resolveHiddenContent: 'off', escalate: true
    });
    assert.equal(escalator.calls.length, 0, 'no browser was launched');
    assert.equal(result.success, false);
    assert.equal(result.escalated, false);
    assert.equal(result.stealth, undefined);
    assert.equal(result.status, 404);
    assert.equal(reported, 2, 'charged the base, not the escalation ceiling');
  });

  test('a 5xx does NOT escalate: the server failed, not the wall', async () => {
    const escalator = fakeEscalator();
    const tool = new UnifiedScrapeTool({ escalateScrape: escalator });
    const { result, reported } = await scrapeWithCost(tool, {
      url: `${baseUrl}/broken`, formats: ['markdown'], resolveHiddenContent: 'off', escalate: true
    });
    assert.equal(escalator.calls.length, 0);
    assert.equal(result.escalated, false);
    assert.equal(reported, 2);
  });

  test('the rule itself: vendor or 403/429 or a 2xx failure, never a 404 or 5xx', () => {
    assert.equal(aBrowserMightPass({ blocked: { vendor: 'cloudflare' } }, 404), true, 'a named vendor wins whatever the status');
    assert.equal(aBrowserMightPass({}, 403), true);
    assert.equal(aBrowserMightPass({}, 429), true);
    assert.equal(aBrowserMightPass({}, 200), true, 'an empty shell is a 2xx failure a browser renders');
    assert.equal(aBrowserMightPass({}, null), true);
    assert.equal(aBrowserMightPass({}, 404), false);
    assert.equal(aBrowserMightPass({}, 410), false);
    assert.equal(aBrowserMightPass({}, 503), false);
  });
});

/**
 * Unit tests for the actions added in Phase 1 (select / hover / navigate) and
 * for the robots gate ActionExecutor now runs before a browser is launched.
 *
 * The browser is faked — these tests are about dispatch, schema acceptance and
 * gate ordering, none of which need a real Chromium. The robots.txt behind the
 * gate is real HTTP, served by a local server, so a disallow here is the same
 * disallow production sees.
 *
 * ALLOWED_DOMAINS is set before the first transitive import of
 * src/constants/config.js: the SSRF guard blocks loopback by default, and a
 * blocked robots.txt fetch reads as "unreadable", which RobotsChecker treats as
 * *allowed*. That would make every disallow test below pass for the wrong
 * reason, so each one also asserts the robots.txt was actually served.
 *
 * Run: node --test tests/unit/actionExecutorNewActions.test.js --test-force-exit
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { ActionExecutor } = await import('../../src/core/ActionExecutor.js');
const { _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');
const { CRAWLFORGE_USER_AGENT } = await import('../../src/utils/fetchIdentity.js');

const ROBOTS_TXT = 'User-agent: *\nDisallow: /private\n';

let server;
let baseUrl;
let robotsRequests = 0;
let robotsUserAgents = [];

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/robots.txt') {
      robotsRequests++;
      robotsUserAgents.push(req.headers['user-agent']);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(ROBOTS_TXT);
      return;
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

beforeEach(() => {
  // The robots cache is module-level and keyed by origin, so without this a
  // test that served one set of rules would decide the next one's outcome.
  _resetRobotsGate();
  _resetHostRateLimiter();
  robotsRequests = 0;
  robotsUserAgents = [];
});

// ── Fakes ───────────────────────────────────────────────────────────────────

function makeFakePage(initialUrl) {
  const calls = { selectOption: [], hover: [], goto: [], pageClosed: false, contextClosed: false };
  let currentUrl = initialUrl;

  const makeLocator = (selector) => {
    const locator = {
      first: () => locator,
      waitFor: async () => {},
      selectOption: async (values, options) => {
        calls.selectOption.push({ selector, values, options });
        return values;
      },
      hover: async (options) => {
        calls.hover.push({ selector, options });
      }
    };
    return locator;
  };

  const page = {
    locator: (selector) => makeLocator(selector),
    url: () => currentUrl,
    content: async () => '<html><body>ok</body></html>',
    waitForLoadState: async () => {},
    goto: async (url, options) => {
      calls.goto.push({ url, options });
      currentUrl = url;
    },
    close: async () => { calls.pageClosed = true; },
    context: () => ({ close: async () => { calls.contextClosed = true; } })
  };

  return { page, calls };
}

/** Executor whose page comes from a fake instead of a browser. */
function makeExecutor(page) {
  const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
  executor.initializePage = async (url, options) => {
    // Keep the gate the real initializePage runs, minus the browser.
    await executor.assertRobotsAllowed(url, options);
    return page;
  };
  return { executor };
}

// ── select ──────────────────────────────────────────────────────────────────

test('select: a single value reaches Playwright selectOption and is reported back', async () => {
  const { page, calls } = makeFakePage(`${baseUrl}/search`);
  const { executor } = makeExecutor(page);

  const result = await executor.executeActionChain(`${baseUrl}/search`, {
    actions: [{ type: 'select', selector: '#author', value: 'Albert Einstein' }]
  });

  assert.equal(result.success, true, result.error);
  assert.equal(calls.selectOption.length, 1);
  assert.equal(calls.selectOption[0].selector, '#author');
  assert.deepEqual(calls.selectOption[0].values, ['Albert Einstein']);
  assert.deepEqual(result.results[0].result.selected, ['Albert Einstein']);
});

test('select: a values array selects several options', async () => {
  const { page, calls } = makeFakePage(`${baseUrl}/search`);
  const { executor } = makeExecutor(page);

  const result = await executor.executeActionChain(`${baseUrl}/search`, {
    actions: [{ type: 'select', selector: '#tag', values: ['love', 'life'] }]
  });

  assert.equal(result.success, true, result.error);
  assert.deepEqual(calls.selectOption[0].values, ['love', 'life']);
});

test('select: neither value nor values is rejected by the schema', async () => {
  const { page } = makeFakePage(`${baseUrl}/search`);
  const { executor } = makeExecutor(page);

  const result = await executor.executeActionChain(`${baseUrl}/search`, {
    actions: [{ type: 'select', selector: '#author' }]
  });

  assert.equal(result.success, false);
});

// ── hover ───────────────────────────────────────────────────────────────────

test('hover: forwards force and position to Playwright hover', async () => {
  const { page, calls } = makeFakePage(`${baseUrl}/menu`);
  const { executor } = makeExecutor(page);

  const result = await executor.executeActionChain(`${baseUrl}/menu`, {
    actions: [{ type: 'hover', selector: '.menu', force: true, position: { x: 3, y: 4 } }]
  });

  assert.equal(result.success, true, result.error);
  assert.equal(calls.hover.length, 1);
  assert.equal(calls.hover[0].selector, '.menu');
  assert.equal(calls.hover[0].options.force, true);
  assert.deepEqual(calls.hover[0].options.position, { x: 3, y: 4 });
});

// ── navigate ────────────────────────────────────────────────────────────────

test('navigate: loads a new URL and honours waitUntil', async () => {
  const { page, calls } = makeFakePage(`${baseUrl}/`);
  const { executor } = makeExecutor(page);

  const result = await executor.executeActionChain(`${baseUrl}/`, {
    actions: [{ type: 'navigate', url: `${baseUrl}/page/2`, waitUntil: 'load' }]
  });

  assert.equal(result.success, true, result.error);
  assert.equal(calls.goto.length, 1);
  assert.equal(calls.goto[0].url, `${baseUrl}/page/2`);
  assert.equal(calls.goto[0].options.waitUntil, 'load');
  assert.equal(result.results[0].result.finalUrl, `${baseUrl}/page/2`);
});

test('navigate: a robots-disallowed URL is refused and the page never moves', async () => {
  const { page, calls } = makeFakePage(`${baseUrl}/`);
  const { executor } = makeExecutor(page);

  const result = await executor.executeActionChain(`${baseUrl}/`, {
    actions: [{ type: 'navigate', url: `${baseUrl}/private` }]
  });

  assert.equal(result.success, false);
  assert.match(result.error, /robots\.txt/);
  assert.equal(calls.goto.length, 0, 'navigate must not reach page.goto for a disallowed URL');
  assert.ok(robotsRequests > 0, 'robots.txt was never fetched — the disallow would be vacuous');
});

test('navigate: respect_robots=false lets the same URL through', async () => {
  const { page, calls } = makeFakePage(`${baseUrl}/`);
  const { executor } = makeExecutor(page);

  const result = await executor.executeActionChain(
    `${baseUrl}/`,
    { actions: [{ type: 'navigate', url: `${baseUrl}/private` }] },
    { respectRobots: false }
  );

  assert.equal(result.success, true, result.error);
  assert.equal(calls.goto[0].url, `${baseUrl}/private`);
});

// ── the gate in front of the browser ────────────────────────────────────────

test('initializePage: a robots-disallowed URL never launches a browser', async () => {
  const executor = new ActionExecutor({ enableLogging: false });
  let browserTouched = false;
  executor.browserProcessor.initializePage = async () => {
    browserTouched = true;
    throw new Error('should not be reached — browser was launched for a disallowed URL');
  };

  await assert.rejects(
    () => executor.initializePage(`${baseUrl}/private`, {}),
    (err) => err.code === 'ROBOTS_DISALLOWED'
  );
  assert.equal(browserTouched, false, 'browserProcessor.initializePage must not be called');
  assert.ok(robotsRequests > 0, 'robots.txt was never fetched — the disallow would be vacuous');
});

test('initializePage: robots is matched as CrawlForge even when the caller overrides the UA', async () => {
  const executor = new ActionExecutor({ enableLogging: false });
  executor.browserProcessor.initializePage = async () => {
    throw new Error('should not be reached — browser was launched for a disallowed URL');
  };

  await assert.rejects(
    () => executor.initializePage(`${baseUrl}/private`, { userAgent: 'Mozilla/5.0 (pretend browser)' }),
    (err) => err.code === 'ROBOTS_DISALLOWED',
    'a userAgent override must not let browser traffic slip our own robots rules'
  );
  assert.deepEqual(
    robotsUserAgents,
    [CRAWLFORGE_USER_AGENT],
    'the gate must identify as the canonical product token, not the override'
  );
});

test('initializePage: an allowed URL passes the gate and reaches the browser', async () => {
  const executor = new ActionExecutor({ enableLogging: false });
  const { page } = makeFakePage(`${baseUrl}/public`);
  let browserTouched = false;
  executor.browserProcessor.initializePage = async () => {
    browserTouched = true;
    return page;
  };

  const returned = await executor.initializePage(`${baseUrl}/public`, {});
  assert.equal(browserTouched, true);
  assert.equal(returned, page);
  assert.ok(robotsRequests > 0, 'robots.txt should have been consulted');
});

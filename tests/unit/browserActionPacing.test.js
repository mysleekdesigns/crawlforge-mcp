/**
 * A browser action that can send the page somewhere waits out Crawl-delay.
 *
 * A navigate action and the first load were already paced (browserPreflight).
 * A click that follows a link, a form submit, an Enter press, a select or
 * checkbox that triggers a load were not: the browser makes that request the
 * moment the action runs, and the gate only sees it afterwards, so a chain of
 * clicks on a site asking for 10 s between requests hit it back to back.
 * Such actions now wait their turn on the page's host before they run.
 *
 * Run: node --test tests/unit/browserActionPacing.test.js --test-force-exit
 * (local server .listen() needs the sandbox disabled — see CLAUDE.md)
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');
const { _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { ActionExecutor } = await import('../../src/core/ActionExecutor.js');

let server;
let origin;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nCrawl-delay: 1\n');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>ok</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  _resetHostRateLimiter();
  _resetRobotsGate();
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

/** An executor whose actions only record when they ran, on a page that never moves. */
function harness() {
  const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
  const ranAt = [];
  executor.executeActionInternal = async (_page, action) => {
    ranAt.push({ type: action.type, at: Date.now() });
    return { success: true, type: action.type };
  };
  const page = { url: () => `${origin}/form`, __crawlforgeGatedUrl: `${origin}/form` };
  const run = (action) => executor.executeGatedAction(page, action, { browserOptions: {} });
  return { ranAt, run };
}

for (const type of ['click', 'press', 'select', 'check']) {
  test(`two ${type} actions on a Crawl-delay: 1 host run at least 1 s apart`, async () => {
    const { ranAt, run } = harness();
    await run({ type, selector: '#go', key: 'Enter', value: 'a' });
    await run({ type, selector: '#go', key: 'Enter', value: 'a' });
    const gap = ranAt[1].at - ranAt[0].at;
    assert.ok(gap >= 950, `expected >=1s between ${type}s, got ${gap}ms`);
  });
}

test('an action that cannot send a request is not held up', async () => {
  const { ranAt, run } = harness();
  await run({ type: 'click', selector: '#go' });
  const t0 = Date.now();
  for (const type of ['scroll', 'hover', 'wait', 'type', 'screenshot']) {
    await run({ type, selector: '#go', text: 'x', duration: 0 });
  }
  assert.ok(Date.now() - t0 < 500, `non-request actions waited ${Date.now() - t0}ms`);
  assert.equal(ranAt.length, 6);
});

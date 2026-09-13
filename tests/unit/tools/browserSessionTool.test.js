/**
 * Unit tests: browser_session — the tool behind a page that outlives one call.
 * Run: node --test --test-force-exit tests/unit/tools/browserSessionTool.test.js
 *
 * Two halves, for two different reasons.
 *
 * The refusals — wrong owner, the hosted REST proxy, executeJavaScript served
 * to a network, a navigate robots.txt disallows — all happen BEFORE anything
 * touches a browser, so they are exercised against a stub page and a local
 * fixture server. That is not a shortcut: a refusal that needed a real browser
 * to prove would be a refusal arriving too late.
 *
 * Ref survival is the opposite. Refs are stamped into a real DOM and cleared by
 * a real navigation event, so only real Chromium can say whether a second `act`
 * call still resolves `@e1` — that one runs against a local fixture and skips
 * when the browser binary is missing, the same shape as
 * tests/unit/core/actionExecutorRefs.test.js.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

// Loopback is blocked by the SSRF guard unless it is allow-listed, and the
// guard reads this at import time — hence the dynamic imports below.
process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { BrowserSessionTool } = await import('../../../src/tools/advanced/BrowserSessionTool.js');
const { BrowserSessionStore } = await import('../../../src/core/browser/SessionStore.js');
const { isCreatorModeVerified } = await import('../../../src/core/creatorMode.js');
const { ActionExecutor } = await import('../../../src/core/ActionExecutor.js');
const { requestContext } = await import('../../../src/server/requestContext.js');
const ExtractContentTool = (await import('../../../src/tools/extract/extractContent.js')).default;

let browser = null;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
} catch {
  browser = null; // no browser binary available — the ref-survival suite skips
}

const PAGES = {
  // One interactive element, and a counter that proves a click landed on it —
  // twice, from two separate act calls.
  '/click': `<html><head><title>Counter</title></head><body style="margin:0">
<button id="inc" onclick="count.textContent = +count.textContent + 1">Increment</button>
<div id="count">0</div>
</body></html>`,
  '/private': '<html><body><h1>Disallowed by robots.txt</h1></body></html>'
};

const server = http.createServer((req, res) => {
  if (req.url === '/robots.txt') {
    res.setHeader('content-type', 'text/plain');
    res.end('User-agent: *\nDisallow: /private\n');
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.end(PAGES[req.url] || '<html><body>not a fixture</body></html>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

// One executor and one extractor for the whole file: both build a
// BrowserProcessor whose LocalizationManager leaves health-check timers behind
// (see tests/unit/phase3-leaks.test.js), so one of each is one set to clean up.
const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
const extractContentTool = new ExtractContentTool();
if (browser) {
  // The only seam replaced: where a page comes from. Everything in front of it
  // — SSRF guard, robots gate, navigation — still runs for real.
  executor.browserProcessor.initializePage = async () => browser.newPage();
}

after(async () => {
  if (browser) await browser.close();
  server.close();
  await executor.destroy().catch(() => {});
  await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
  await extractContentTool.browserProcessor?.localizationManager?.cleanup().catch(() => {});
});

function makeTool(store) {
  return new BrowserSessionTool({
    store,
    actionExecutor: executor,
    extractContentTool,
    enableLogging: false
  });
}

/** Enough page for the operations that refuse before they ever touch a browser. */
function stubPage(url) {
  let current = url;
  return {
    url: () => current,
    async goto(target) { current = target; return { status: () => 200 }; },
    async content() { return '<html><body></body></html>'; }
  };
}

/** Put a live session in the store directly, owned by whoever the test says. */
function seat(store, ownerId, { url = 'http://127.0.0.1/', onRelease = () => {} } = {}) {
  return store.create({
    ownerId,
    page: stubPage(url),
    releasePage: async () => onRelease(),
    url
  });
}

/** The error a call was expected to refuse with. */
async function refusal(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected the call to be refused');
}

describe('browser_session ownership', () => {
  test('another owner\'s session is refused exactly as an unknown id is', async () => {
    const store = new BrowserSessionStore();
    const tool = makeTool(store);
    let released = false;
    const theirs = seat(store, 'key:someone-else', { onRelease: () => { released = true; } });

    // Every operation, not just the one that happens to be easy to test: a gap
    // in any of them is a cross-tenant hole.
    const operations = [
      { operation: 'snapshot' },
      { operation: 'act', actions: [{ type: 'wait', duration: 1 }] },
      { operation: 'read' },
      { operation: 'screenshot' },
      { operation: 'close' }
    ];

    for (const op of operations) {
      const wrongOwner = await refusal(() => tool.execute({ ...op, session_id: theirs.id }));
      const unknownId = await refusal(() => tool.execute({ ...op, session_id: randomUUID() }));

      assert.equal(wrongOwner.code, 'SESSION_NOT_FOUND', `${op.operation}: ${wrongOwner.message}`);
      assert.equal(
        wrongOwner.message,
        unknownId.message,
        `${op.operation}: a wrong owner must be answered word for word as an unknown id`
      );
      // "Forbidden" would confirm the id exists, which is what makes ids
      // enumerable — the whole point of answering "not found" instead.
      assert.ok(
        !/forbid|denied|not allowed|permission|owner/i.test(wrongOwner.message),
        `${op.operation}: refusal must not admit the session exists: ${wrongOwner.message}`
      );
      // The id must not appear either: echoing it back confirms it too.
      assert.ok(!wrongOwner.message.includes(theirs.id), `${op.operation}: refusal echoed the id back`);
    }

    assert.equal(released, false, 'a refused close must not close the session');
    assert.equal(store.getStats().total, 1, 'the session still belongs to its owner');
    await store.destroy();
  });

  test('list shows only the caller\'s own sessions', async () => {
    const store = new BrowserSessionStore();
    const tool = makeTool(store);
    seat(store, 'key:someone-else');
    const mine = seat(store, tool.ownerId(), { url: `${BASE}/click` });

    const result = await tool.execute({ operation: 'list' });

    assert.equal(result.count, 1);
    assert.equal(result.sessions[0].sessionId, mine.id);
    await store.destroy();
  });
});

describe('browser_session transport gates', () => {
  test('the hosted REST proxy is refused by name, before anything is opened', async () => {
    const store = new BrowserSessionStore();
    const tool = makeTool(store);

    // The same call outside the internal context is ordinary and succeeds.
    assert.equal((await tool.execute({ operation: 'list' })).success, true);

    for (const params of [{ operation: 'list' }, { operation: 'open', url: `${BASE}/click` }]) {
      const error = await refusal(() => requestContext.run({ internal: true }, () => tool.execute(params)));
      assert.equal(error.code, 'SESSIONS_NOT_AVAILABLE_OVER_REST', error.message);
      assert.match(error.message, /REST API/);
      // An honest refusal names what to do instead, rather than just failing.
      assert.match(error.message, /scrape_with_actions/);
    }

    assert.equal(store.getStats().total, 0, 'a refused open must not have opened a session');
    await store.destroy();
  });

  test('executeJavaScript in act is refused when the transport is remote', async () => {
    const store = new BrowserSessionStore();
    const tool = makeTool(store);
    const session = seat(store, tool.ownerId());
    const act = {
      operation: 'act',
      session_id: session.id,
      actions: [{ type: 'executeJavaScript', script: 'return 1', continueOnError: true }]
    };

    const previous = { http: process.env.MCP_HTTP, host: process.env.MCP_HTTP_HOST };
    process.env.MCP_HTTP = 'true';
    process.env.MCP_HTTP_HOST = '0.0.0.0'; // served to a network, not to this machine
    try {
      // D6 exempts creator mode from this gate, and creator mode is decided at
      // module load from a secret this test cannot unset — so assert whichever
      // contract is actually in force rather than assuming the unit runner's.
      // run-unit-tests.sh blanks CRAWLFORGE_CREATOR_SECRET, so the gate below
      // is what CI and the npm script exercise; a maintainer running this file
      // directly with their secret in .env gets the exemption branch instead.
      // Without this split the file fails on the one machine that has the key.
      if (isCreatorModeVerified()) {
        const allowed = await tool.execute(act);
        assert.equal(allowed.actionResults[0].type, 'executeJavaScript',
          'creator mode must reach ActionExecutor rather than being refused here');
      } else {
        const error = await refusal(() => tool.execute(act));
        assert.equal(error.code, 'JS_EXECUTION_REFUSED_REMOTE', error.message);
      }
    } finally {
      if (previous.http === undefined) delete process.env.MCP_HTTP; else process.env.MCP_HTTP = previous.http;
      if (previous.host === undefined) delete process.env.MCP_HTTP_HOST; else process.env.MCP_HTTP_HOST = previous.host;
    }

    // On the local transport this tool refuses nothing: the action reaches
    // ActionExecutor, whose own ALLOW_JAVASCRIPT_EXECUTION flag (off by
    // default) is the control. The two gates answer different questions.
    const local = await tool.execute(act);
    assert.equal(local.actionResults[0].success, false);
    assert.match(local.actionResults[0].error, /JavaScript execution is disabled/);
    await store.destroy();
  });
});

describe('browser_session per-navigation gating', () => {
  test('a navigate inside act is refused when robots.txt disallows it', async () => {
    const store = new BrowserSessionStore();
    const tool = makeTool(store);
    const session = seat(store, tool.ownerId(), { url: `${BASE}/click` });

    const refused = await tool.execute({
      operation: 'act',
      session_id: session.id,
      actions: [{ type: 'navigate', url: `${BASE}/private` }]
    });

    assert.equal(refused.success, false);
    assert.equal(refused.actionResults[0].success, false);
    assert.match(refused.actionResults[0].error, /robots\.txt/i);
    // Refused before the page moved — the gate runs in front of the navigation,
    // not after it.
    assert.equal(refused.url, `${BASE}/click`);

    // Control: the gate is reading robots.txt, not refusing every navigate.
    const allowed = await tool.execute({
      operation: 'act',
      session_id: session.id,
      actions: [{ type: 'navigate', url: `${BASE}/click` }]
    });
    assert.equal(allowed.success, true, allowed.error);
    await store.destroy();
  });
});

describe('browser_session against a real page', { skip: !browser && 'Chromium not installed' }, () => {
  test('refs survive across two separate act calls on the same session', async () => {
    const store = new BrowserSessionStore();
    const tool = makeTool(store);

    const opened = await tool.execute({ operation: 'open', url: `${BASE}/click` });
    assert.equal(opened.success, true);
    assert.ok(opened.sessionId, 'open returns a session id');
    const session_id = opened.sessionId;

    try {
      const snapshot = await tool.execute({ operation: 'snapshot', session_id });
      assert.equal(snapshot.snapshot.refCount, 1, snapshot.snapshot.tree);
      assert.match(snapshot.snapshot.tree, /@e1 \[button\] "Increment"/);

      // Two separate tool calls, each naming the ref the FIRST call's snapshot
      // assigned. This is the thing a session buys over scrape_with_actions.
      const first = await tool.execute({ operation: 'act', session_id, actions: [{ type: 'click', selector: '@e1' }] });
      assert.equal(first.success, true, first.error);

      const second = await tool.execute({ operation: 'act', session_id, actions: [{ type: 'click', selector: '@e1' }] });
      assert.equal(second.success, true, second.error);

      const read = await tool.execute({ operation: 'read', session_id, formats: ['html', 'text'] });
      assert.match(
        read.content.html,
        /<div id="count">2<\/div>/,
        'both ref clicks landed on the element the first snapshot named'
      );
      assert.equal(read.title, 'Counter');
    } finally {
      const closed = await tool.execute({ operation: 'close', session_id });
      assert.equal(closed.closed, true);
    }

    assert.equal(store.getStats().total, 0, 'close releases the session');
    // Closed means closed: the id is refused afterwards like any other.
    const afterClose = await refusal(() => tool.execute({ operation: 'snapshot', session_id }));
    assert.equal(afterClose.code, 'SESSION_NOT_FOUND');
    await store.destroy();
  });

  test('cleanup closes every live session and leaves the tool usable', async () => {
    const store = new BrowserSessionStore();
    const tool = makeTool(store);

    const opened = await tool.execute({ operation: 'open', url: `${BASE}/click` });
    assert.equal(store.getStats().total, 1);

    await tool.cleanup();
    assert.equal(store.getStats().total, 0, 'the stealth-cleanup lever must close sessions');
    const gone = await refusal(() => tool.execute({ operation: 'snapshot', session_id: opened.sessionId }));
    assert.equal(gone.code, 'SESSION_NOT_FOUND');

    const reopened = await tool.execute({ operation: 'open', url: `${BASE}/click` });
    assert.equal(reopened.success, true, 'cleanup is not destroy — the tool still opens sessions');
    await tool.execute({ operation: 'close', session_id: reopened.sessionId });
    await tool.store.destroy();
  });
});

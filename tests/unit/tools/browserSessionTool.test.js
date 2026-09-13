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
const {
  BrowserSessionStore,
  SessionLimitError,
  DEFAULT_MAX_SESSIONS_PER_OWNER
} = await import('../../../src/core/browser/SessionStore.js');
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
  '/private': '<html><body><h1>Disallowed by robots.txt</h1></body></html>',
  // A DataDome wall: the vendor's captcha frame on a body with no text, which
  // is what g2.com actually served (2026-09-12) while `open` reported success.
  '/walled': `<html><head><title>example.com</title></head><body>
<iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=abc"></iframe>
</body></html>`,
  '/gone': '<html><head><title>Not Found</title></head><body><p>no such thing</p></body></html>'
};

const server = http.createServer((req, res) => {
  if (req.url === '/robots.txt') {
    res.setHeader('content-type', 'text/plain');
    res.end('User-agent: *\nDisallow: /private\n');
    return;
  }
  res.setHeader('content-type', 'text/html');
  // The wall answers 403 and the missing page 404, as the real ones do: the
  // verdict reads the navigation's status as well as the body.
  if (req.url === '/walled') res.statusCode = 403;
  if (req.url === '/gone') res.statusCode = 404;
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
    async content() { return '<html><body></body></html>'; },
    // What releaser() reaches for when a session is closed or refused.
    context: () => ({ close: async () => {} }),
    async close() {}
  };
}

/**
 * An executor that hands out stub pages. The tenancy rules — who owns a
 * session, and how many one owner may hold — are decided before a browser is
 * ever asked for, so proving them must not depend on Chromium being installed.
 */
function stubExecutor() {
  return {
    initializePage: async (url) => stubPage(url),
    browserProcessor: { releaseStealthPage: async () => {} }
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
  test('an internal request with no owner token is refused by name, before anything is opened', async () => {
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

    // The fail-closed half of the contract: an old server ignoring the new
    // header, and a new server meeting a website that sends none, both land
    // here. Neither may fall back to a default owner — that would put every
    // REST customer in one tenant, which is the hole the refusal exists for.
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

// The hosted REST path, once the proxy forwards a per-user owner token. The
// token is opaque here — the website derives it with an HMAC keyed on the
// shared internal secret — so all these tests need is that two customers get
// two different ones. The transport decides which values count as tokens at
// all (tests/unit/streamableHttp.test.js); by the time a value reaches the
// tool it is either a token or absent.
describe('browser_session over the hosted REST proxy', () => {
  const TOKEN_A = 'a'.repeat(32);
  const TOKEN_B = 'b'.repeat(32);

  /** A tool whose pages are stubs — tenancy is decided before a browser matters. */
  function makeRestTool(store) {
    return new BrowserSessionTool({
      store,
      actionExecutor: stubExecutor(),
      extractContentTool,
      enableLogging: false
    });
  }

  /** Run one call the way the transport runs it, on behalf of one REST customer. */
  function asRestCustomer(ownerToken, fn) {
    return requestContext.run({ internal: true, ownerToken }, fn);
  }

  test('the owner token is the tenant key, and two customers get two keys', async () => {
    const store = new BrowserSessionStore();
    const tool = makeRestTool(store);

    assert.equal(asRestCustomer(TOKEN_A, () => tool.ownerId()), `rest:${TOKEN_A}`);
    assert.notEqual(
      asRestCustomer(TOKEN_B, () => tool.ownerId()),
      asRestCustomer(TOKEN_A, () => tool.ownerId())
    );
    // Nothing changes off the internal path: stdio is still the API key digest.
    assert.match(tool.ownerId(), /^(key:[0-9a-f]{16}|local)$/);
    await store.destroy();
  });

  test('one REST customer cannot reach another\'s session', async () => {
    const store = new BrowserSessionStore();
    const tool = makeRestTool(store);

    const opened = await asRestCustomer(TOKEN_A, () =>
      tool.execute({ operation: 'open', url: `${BASE}/click` }));
    assert.ok(opened.sessionId, 'a customer with a token gets a session');

    for (const op of [{ operation: 'snapshot' }, { operation: 'read' }, { operation: 'close' }]) {
      const error = await refusal(() =>
        asRestCustomer(TOKEN_B, () => tool.execute({ ...op, session_id: opened.sessionId })));
      // "Session not found", not "forbidden": the same answer an id that never
      // existed gets, which is what stops ids being probed across tenants.
      assert.equal(error.code, 'SESSION_NOT_FOUND', `${op.operation}: ${error.message}`);
    }

    assert.equal((await asRestCustomer(TOKEN_B, () => tool.execute({ operation: 'list' }))).count, 0);
    assert.equal((await asRestCustomer(TOKEN_A, () => tool.execute({ operation: 'list' }))).count, 1);
    await store.destroy();
  });

  test('a REST customer holds one session at a time, and only their own slot', async () => {
    const store = new BrowserSessionStore();
    const tool = makeRestTool(store);
    const openOne = () => tool.execute({ operation: 'open', url: `${BASE}/click` });

    const mine = await asRestCustomer(TOKEN_A, openOne);
    const error = await refusal(() => asRestCustomer(TOKEN_A, openOne));
    assert.ok(error instanceof SessionLimitError, error.message);
    assert.equal(error.code, 'SESSION_LIMIT');

    // Why the cap is 1: the hosted box holds three sessions in total, so a
    // customer allowed three could lock every other customer out for the ten
    // minutes a session lives. A second customer must still be able to work.
    const theirs = await asRestCustomer(TOKEN_B, openOne);
    assert.ok(theirs.sessionId);
    assert.equal(store.getStats().total, 2);

    // And the slot comes back on close, rather than only on the TTL.
    await asRestCustomer(TOKEN_A, () =>
      tool.execute({ operation: 'close', session_id: mine.sessionId }));
    assert.ok((await asRestCustomer(TOKEN_A, openOne)).sessionId);
    await store.destroy();
  });

  test('the cap does not follow the tool home — stdio keeps the default', async () => {
    const store = new BrowserSessionStore({ maxTotal: DEFAULT_MAX_SESSIONS_PER_OWNER + 1 });
    const tool = makeRestTool(store);
    const openOne = () => tool.execute({ operation: 'open', url: `${BASE}/click` });

    for (let i = 0; i < DEFAULT_MAX_SESSIONS_PER_OWNER; i++) await openOne();
    assert.equal(store.getStats().byOwner[tool.ownerId()], DEFAULT_MAX_SESSIONS_PER_OWNER);

    const error = await refusal(openOne);
    assert.equal(error.code, 'SESSION_LIMIT');
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

describe('browser_session names what the document actually is', { skip: !browser && 'Chromium not installed' }, () => {
  // R18's lesson, applied to the one browser tool that never got it: a chain
  // that ran, or a session that opened, says nothing about whether the document
  // it landed on is the page. g2.com answered `open` with a DataDome 403 and
  // this tool reported success:true with no status, while `scrape` on the same
  // URL named the vendor and the code (2026-09-12).
  test('a bot wall is reported as blocked, with its vendor and status', async () => {
    const store = new BrowserSessionStore();
    const tool = makeTool(store);

    const opened = await tool.execute({ operation: 'open', url: `${BASE}/walled` });
    try {
      assert.equal(opened.success, false, 'a challenge page is not a successful open');
      assert.equal(opened.httpStatus, 403);
      assert.equal(opened.blocked?.vendor, 'datadome');
      // The session really is open behind the wall; the message has to say so
      // or a caller reading only `success` leaks it until the TTL expires.
      assert.match(opened.error, /The session is open as/);
      assert.ok(opened.sessionId, 'a blocked open still hands back the session it made');

      // read is where content is handed over, so it is the last place the wall
      // can be named before a caller treats it as the page.
      const read = await tool.execute({ operation: 'read', session_id: opened.sessionId });
      assert.equal(read.success, false);
      assert.equal(read.blocked?.vendor, 'datadome');
      assert.equal(read.httpStatus, 403);
    } finally {
      await store.destroy();
    }
  });

  test('an HTTP error page is reported with its status', async () => {
    const store = new BrowserSessionStore();
    const tool = makeTool(store);

    const opened = await tool.execute({ operation: 'open', url: `${BASE}/gone` });
    try {
      assert.equal(opened.success, false);
      assert.equal(opened.httpStatus, 404);
      assert.equal(opened.blocked, undefined, 'a 404 is an error page, not a wall');
    } finally {
      await store.destroy();
    }
  });

  test('an ordinary page still succeeds, and carries its 200', async () => {
    const store = new BrowserSessionStore();
    const tool = makeTool(store);

    const opened = await tool.execute({ operation: 'open', url: `${BASE}/click` });
    try {
      assert.equal(opened.success, true, opened.error);
      assert.equal(opened.httpStatus, 200);
      assert.equal(opened.blocked, undefined);

      const read = await tool.execute({ operation: 'read', session_id: opened.sessionId, formats: ['text'] });
      assert.equal(read.success, true, read.error);
      assert.equal(read.httpStatus, 200);
    } finally {
      await store.destroy();
    }
  });
});

describe('browser_session act result shape', { skip: !browser && 'Chromium not installed' }, () => {
  // ActionExecutor validates each action and then discards the parsed value, so
  // every default its own schemas declare is dead on arrival — including
  // `returnResult: true`, the flag executeJavaScript reads to decide whether the
  // script's return value survives. scrape_with_actions keeps its parsed value
  // and so returned the data; a session dropped it and reported success.
  test('executeJavaScript returns its value without being asked to', async () => {
    const store = new BrowserSessionStore();
    const tool = makeTool(store);
    const previous = process.env.ALLOW_JAVASCRIPT_EXECUTION;
    process.env.ALLOW_JAVASCRIPT_EXECUTION = 'true';

    const opened = await tool.execute({ operation: 'open', url: `${BASE}/click` });
    try {
      const acted = await tool.execute({
        operation: 'act',
        session_id: opened.sessionId,
        actions: [{ type: 'executeJavaScript', script: 'return 6 * 7' }]
      });

      assert.equal(acted.success, true, acted.error);
      const [result] = acted.actionResults;
      assert.equal(result.result.result, 42, 'the value must survive without returnResult');
      // The flat field scrape_with_actions publishes, so the same action reads
      // the same way whichever tool ran it.
      assert.equal(result.jsResult, 42);
    } finally {
      if (previous === undefined) delete process.env.ALLOW_JAVASCRIPT_EXECUTION;
      else process.env.ALLOW_JAVASCRIPT_EXECUTION = previous;
      await store.destroy();
    }
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

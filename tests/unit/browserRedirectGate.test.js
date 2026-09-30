/**
 * The gate on where a browser page ends up (src/utils/ssrfGuard.js
 * `assertNavigationAllowed`, fed by robotsGate.js `redirectGate` and
 * `pageMoveGate`).
 *
 * Every browser path gates the URL it is given. The browser then followed
 * redirects on its own, so a 301 into a path robots.txt disallows, or onto a
 * host on the platform blocklist, was rendered and returned because nobody
 * asked again; and a page that was kept (an action chain, a session) could be
 * taken anywhere by a click or a script and read there. A browser cannot be
 * refused a request before it makes it, so what these tests hold is what
 * comes after: the call fails, the page is left empty, and nothing of the
 * refused document comes back.
 *
 * Real Chromium against a local HTTP server, because a stub page can implement
 * whatever redirect API the code happens to call. Skips when Chromium is not
 * installed. ALLOWED_DOMAINS is set BEFORE the first transitive import of
 * config.js, as in robotsGate.test.js.
 *
 * Run: node --test --test-force-exit tests/unit/browserRedirectGate.test.js
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALLOWED_DOMAINS = '127.0.0.1,localhost';
delete process.env.SSRF_PROTECTION_ENABLED;

const { safeGoto, navigationHops } = await import('../../src/utils/ssrfGuard.js');
const { redirectGate, _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');
const { _setBlockedHostsForTests } = await import('../../src/utils/hostBlocklist.js');
const { setComplianceAuditSink, _resetComplianceAudit } = await import('../../src/utils/complianceAudit.js');
const { ActionExecutor } = await import('../../src/core/ActionExecutor.js');
const { StealthBrowserManager } = await import('../../src/core/StealthBrowserManager.js');
const { BrowserProcessor } = await import('../../src/core/processing/BrowserProcessor.js');
const { BrowserSessionTool } = await import('../../src/tools/advanced/BrowserSessionTool.js');
const { BrowserSessionStore } = await import('../../src/core/browser/SessionStore.js');
const ExtractContentTool = (await import('../../src/tools/extract/extractContent.js')).default;
const { ScrapeWithActionsTool } = await import('../../src/tools/advanced/ScrapeWithActionsTool.js');
const { requestContext, preflightRefusal } = await import('../../src/server/requestContext.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let chromium;
let browser = null;
try {
  ({ chromium } = await import('playwright'));
  browser = await chromium.launch();
} catch {
  browser = null; // no browser binary available — the browser suites skip
}

const page = (title, body) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const PRIVATE_TEXT = 'the private page';

const PAGES = {
  '/public': page('Public', `<p>${'the public page. '.repeat(30)}</p>`),
  '/private': page('Private', `<p>${`${PRIVATE_TEXT}. `.repeat(30)}</p>`),
  // Loads, then moves itself on: the redirect no HTTP status announces.
  '/js-moved': page('Moving', `<p>${'moving on. '.repeat(30)}</p><script>setTimeout(() => { location.href = '/private'; }, 100);</script>`),
  // The same, late enough that a session's `open` has already returned.
  '/late-moved': page('Moving later', `<p>${'moving on later. '.repeat(30)}</p><script>setTimeout(() => { location.href = '/private'; }, 700);</script>`),
  '/links': page('Links', `<p>${'a page of links. '.repeat(30)}</p>
    <a id="to-private" href="/private">private</a> <a id="to-public" href="/public">public</a>
    <button id="route" onclick="history.pushState({}, '', '/private/view')">a client-side route</button>`)
};

/** Path → where it redirects. `/to-blocked` is filled in once the port is known. */
const REDIRECTS = {
  '/moved': '/private',
  '/moved-twice': '/moved',
  '/to-public': '/public'
};

let server;
let baseUrl;
let auditRows = [];
/** Every path the server was asked for, in order. */
let seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    seen.push(pathname);
    if (pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('User-agent: *\nDisallow: /private\n');
    }
    if (REDIRECTS[pathname]) {
      res.writeHead(301, { Location: REDIRECTS[pathname] });
      return res.end();
    }
    if (!PAGES[pathname]) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGES[pathname]);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  // Same server, reached by another name, so it can be blocklisted on its own.
  REDIRECTS['/to-blocked'] = `http://localhost:${port}/public`;

  setComplianceAuditSink((row) => { auditRows.push(row); });
});

beforeEach(() => {
  _resetRobotsGate();
  _resetHostRateLimiter();
  auditRows = [];
  seen = [];
});

after(async () => {
  _resetComplianceAudit();
  _setBlockedHostsForTests(null);
  if (browser) await browser.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

/** The refusal for a page that went somewhere by itself or by a click. */
const movedRefusal = (from, to) => (err) => {
  assert.equal(err.code, 'ROBOTS_DISALLOWED');
  assert.ok(
    err.message.includes(`The page moved from ${baseUrl}${from} to ${baseUrl}${to}, and robots.txt`),
    err.message
  );
  return true;
};

const refusal = (from, to) => (err) => {
  assert.equal(err.code, 'ROBOTS_DISALLOWED');
  assert.ok(
    err.message.includes(`${baseUrl}${from} redirects to ${baseUrl}${to}, and robots.txt`),
    err.message
  );
  return true;
};

describe('navigationHops', () => {
  const request = (url, from = null) => ({ url: () => url, redirectedFrom: () => from });
  const response = (...urls) => ({ request: () => urls.reduce((from, url) => request(url, from), null) });

  test('is empty when the navigation stayed where it was sent', () => {
    assert.deepEqual(navigationHops('https://a.test/', 'https://a.test', response('https://a.test/')), []);
  });

  test('lists every HTTP redirect after the first request, in order', () => {
    assert.deepEqual(
      navigationHops('https://b.test/end', 'https://a.test/', response('https://a.test/', 'https://a.test/mid', 'https://b.test/end')),
      ['https://a.test/mid', 'https://b.test/end']
    );
  });

  test('adds where the page stands when a client-side redirect moved it on', () => {
    assert.deepEqual(
      navigationHops('https://a.test/later', 'https://a.test/', response('https://a.test/', 'https://a.test/mid')),
      ['https://a.test/mid', 'https://a.test/later']
    );
    // No response to read: the second check, made before a page is read.
    assert.deepEqual(navigationHops('https://a.test/later', 'https://a.test/landed', null), ['https://a.test/later']);
  });

  test('a fragment, or a page that left http(s), is not a hop', () => {
    assert.deepEqual(navigationHops('https://a.test/#top', 'https://a.test/', response('https://a.test/')), []);
    assert.deepEqual(navigationHops('about:blank', 'https://a.test/', null), []);
  });
});

describe('safeGoto puts every redirect hop to the gate', { skip: !browser && 'Chromium not installed' }, () => {
  const withPage = async (fn) => {
    const context = await browser.newContext();
    try {
      return await fn(await context.newPage());
    } finally {
      await context.close();
    }
  };
  const gate = (pathname, options = {}) => redirectGate(`${baseUrl}${pathname}`, { tool: 'stealth_mode', ...options });

  test('a redirect into a disallowed path is refused, and the page is left empty', async () => {
    await withPage(async (tab) => {
      await assert.rejects(
        () => safeGoto(tab, `${baseUrl}/moved`, { onRedirect: gate('/moved') }),
        refusal('/moved', '/private')
      );
      assert.equal(tab.url(), 'about:blank');
      assert.ok(!(await tab.content()).includes(PRIVATE_TEXT));
    });
  });

  test('a disallowed path two redirects away is refused too', async () => {
    await withPage(async (tab) => {
      await assert.rejects(
        () => safeGoto(tab, `${baseUrl}/moved-twice`, { onRedirect: gate('/moved-twice') }),
        refusal('/moved-twice', '/private')
      );
    });
  });

  test('a redirect to an allowed path is followed, and the options still reach page.goto', async () => {
    await withPage(async (tab) => {
      const response = await safeGoto(tab, `${baseUrl}/to-public`, { waitUntil: 'domcontentloaded', onRedirect: gate('/to-public') });
      assert.equal(response.status(), 200);
      assert.equal(new URL(tab.url()).pathname, '/public');
    });
  });

  test('without a gate the same redirect is followed: the gate is what refuses it', async () => {
    await withPage(async (tab) => {
      await safeGoto(tab, `${baseUrl}/moved`);
      assert.ok((await tab.content()).includes(PRIVATE_TEXT));
    });
  });

  test('respect_robots: false follows the redirect and records the hop', async () => {
    await withPage(async (tab) => {
      await safeGoto(tab, `${baseUrl}/moved`, { onRedirect: gate('/moved', { respectRobots: false }) });
      assert.equal(new URL(tab.url()).pathname, '/private');
    });
    const row = auditRows.find((r) => r.event === 'robots_override' && r.url === `${baseUrl}/private`);
    assert.ok(row, `no audit row for the hop; saw ${JSON.stringify(auditRows)}`);
    assert.equal(row.tool, 'stealth_mode');
  });

  test('a blocklisted host is refused on a hop, and no flag changes that', async () => {
    _setBlockedHostsForTests(['localhost']);
    try {
      await withPage(async (tab) => {
        await assert.rejects(
          () => safeGoto(tab, `${baseUrl}/to-blocked`, { onRedirect: gate('/to-blocked', { respectRobots: false }) }),
          (err) => err.code === 'HOST_BLOCKED'
        );
        assert.equal(tab.url(), 'about:blank');
      });
    } finally {
      _setBlockedHostsForTests(null);
    }
  });
});

describe('scrape_with_actions and browser_session (ActionExecutor)', { skip: !browser && 'Chromium not installed' }, () => {
  /** Real ActionExecutor with only the browser-launch seam replaced. */
  async function withExecutor(fn) {
    const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
    executor.browserProcessor.initializePage = async () => browser.newPage();
    try {
      return await fn(executor);
    } finally {
      await executor.destroy().catch(() => {});
      await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    }
  }

  test('a chain whose first load is redirected into a disallowed path fails with nothing captured', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(`${baseUrl}/moved`, {
        actions: [{ type: 'wait', duration: 50 }]
      });
      assert.equal(result.success, false);
      assert.match(result.error, /\/moved redirects to .*\/private, and robots\.txt/);
      assert.ok(!JSON.stringify(result).includes(PRIVATE_TEXT));
    });
  });

  test('respectRobots: false carries to the redirect', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(
        `${baseUrl}/moved`,
        { actions: [{ type: 'wait', duration: 50 }] },
        { respectRobots: false }
      );
      assert.equal(result.success, true, result.error);
      assert.equal(new URL(result.finalUrl).pathname, '/private');
    });
  });

  test('a navigate action on a page the caller keeps leaves that page empty when refused', async () => {
    await withExecutor(async (executor) => {
      const tab = await browser.newPage();
      try {
        await tab.goto(`${baseUrl}/public`);
        const result = await executor.executeActionsOnPage(
          tab,
          [{ type: 'navigate', url: `${baseUrl}/moved` }],
          { browserOptions: { tool: 'browser_session' } }
        );
        assert.equal(result.success, false);
        assert.match(result.error, /redirects to .*\/private/);
        // The session outlives the call; what it holds must not be the refused page.
        assert.equal(tab.url(), 'about:blank');
        assert.ok(!(await tab.content()).includes(PRIVATE_TEXT));
      } finally {
        await tab.close();
      }
    });
  });
});

describe('a page an action chain keeps is held to the gate wherever it goes', { skip: !browser && 'Chromium not installed' }, () => {
  async function withExecutor(fn) {
    const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
    executor.browserProcessor.initializePage = async () => browser.newPage();
    try {
      return await fn(executor);
    } finally {
      await executor.destroy().catch(() => {});
      await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    }
  }
  const chain = (executor, pathname, actions, browserOptions) =>
    executor.executeActionChain(`${baseUrl}${pathname}`, { actions }, browserOptions);

  test('a click that lands on a disallowed path fails the chain, with nothing captured', async () => {
    await withExecutor(async (executor) => {
      const result = await chain(executor, '/links', [{ type: 'click', selector: '#to-private', captureAfter: true }]);
      assert.equal(result.success, false);
      assert.match(result.error, /The page moved from .*\/links to .*\/private, and robots\.txt/);
      assert.ok(!JSON.stringify(result).includes(PRIVATE_TEXT));
    });
  });

  test('a click that lands on an allowed path is followed and read', async () => {
    await withExecutor(async (executor) => {
      const result = await chain(executor, '/links', [{ type: 'click', selector: '#to-public', captureAfter: true }]);
      assert.equal(result.success, true, result.error);
      assert.equal(new URL(result.finalUrl).pathname, '/public');
      assert.match(result.finalHtml, /the public page/);
      assert.equal(result.capturedStates.length, 1);
    });
  });

  test('respectRobots: false lets the click through and records where it led', async () => {
    await withExecutor(async (executor) => {
      const result = await chain(executor, '/links', [{ type: 'click', selector: '#to-private' }], { respectRobots: false });
      assert.equal(result.success, true, result.error);
      assert.ok(result.finalHtml.includes(PRIVATE_TEXT));
    });
    const row = auditRows.find((r) => r.event === 'robots_override' && r.url === `${baseUrl}/private`);
    assert.ok(row, `no audit row for the move; saw ${JSON.stringify(auditRows)}`);
    assert.equal(row.tool, 'scrape_with_actions');
  });

  test('a redirect the page makes while an action waits is refused', async () => {
    await withExecutor(async (executor) => {
      const result = await chain(executor, '/js-moved', [{ type: 'wait', duration: 600 }]);
      assert.equal(result.success, false);
      assert.match(result.error, /The page moved from .*\/js-moved to .*\/private/);
      assert.ok(!JSON.stringify(result).includes(PRIVATE_TEXT));
    });
  });

  test('a client-side route change is a move too', async () => {
    await withExecutor(async (executor) => {
      const result = await chain(executor, '/links', [{ type: 'click', selector: '#route' }]);
      assert.equal(result.success, false);
      assert.match(result.error, /The page moved from .*\/links to .*\/private\/view/);
    });
  });

  test('a refused move is not replayed: retryChain is for faults, and a refusal is an answer', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(`${baseUrl}/links`, {
        actions: [{ type: 'click', selector: '#to-private' }],
        retryChain: 2
      });
      assert.equal(result.success, false);
      assert.match(result.error, /The page moved from .*\/links to .*\/private/);
      assert.equal(result.attempts.length, 1);
      // Each replay reloads the start URL and clicks into the refused page again.
      assert.equal(seen.filter((p) => p === '/links').length, 1);
      assert.equal(seen.filter((p) => p === '/private').length, 1);
    });
  });

  test('nor is a navigate action the gate refuses', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(`${baseUrl}/links`, {
        actions: [{ type: 'navigate', url: `${baseUrl}/private` }],
        retryChain: 2
      });
      assert.equal(result.success, false);
      assert.match(result.error, /Action failed: robots\.txt on .* disallows this path/);
      assert.equal(result.attempts.length, 1);
      assert.equal(seen.filter((p) => p === '/links').length, 1);
      assert.equal(seen.includes('/private'), false);
    });
  });

  test('a chain that fails for any other reason is replayed as before', async () => {
    await withExecutor(async (executor) => {
      const result = await executor.executeActionChain(`${baseUrl}/links`, {
        actions: [{ type: 'click', selector: '#not-there', timeout: 300, retries: 0 }],
        retryChain: 1
      });
      assert.equal(result.success, false);
      assert.equal(result.attempts.length, 2);
      assert.equal(seen.filter((p) => p === '/links').length, 2);
    });
  });

  test('scrape_with_actions returns none of the refused page, and the call is marked as a refusal', async () => {
    await withExecutor(async (executor) => {
      const extractContentTool = new ExtractContentTool();
      const tool = new ScrapeWithActionsTool({ actionExecutor: executor, extractContentTool, enableLogging: false });
      try {
        // Inside a request context, as withAuth runs every tool call.
        await requestContext.run({ preflightRefusal: null }, async () => {
          const result = await tool.execute({
            url: `${baseUrl}/links`,
            actions: [{ type: 'click', selector: '#to-private' }],
            formats: ['html', 'text']
          });
          assert.equal(result.success, false);
          assert.match(result.error, /The page moved from .*\/links to .*\/private/);
          assert.ok(!JSON.stringify(result).includes(PRIVATE_TEXT));
          // With success:false, this stamp is what server.js turns into an
          // error result, and an error result a refusal sank is not charged.
          assert.equal(preflightRefusal(), 'ROBOTS_DISALLOWED');
        });
      } finally {
        await extractContentTool.browserProcessor?.cleanup?.().catch(() => {});
        await extractContentTool.browserProcessor?.localizationManager?.cleanup().catch(() => {});
      }
    });
  });

  test('a page that reached a private address is refused by the SSRF guard and emptied', async () => {
    const executor = new ActionExecutor({ enableLogging: false });
    const visited = [];
    const moved = {
      __crawlforgeGatedUrl: `${baseUrl}/links`,
      url: () => 'http://169.254.169.254/latest/meta-data/',
      goto: async (url) => { visited.push(url); }
    };
    try {
      await assert.rejects(() => executor.assertPageAllowed(moved), /SSRF Protection/);
      assert.deepEqual(visited, ['about:blank']);
    } finally {
      await executor.destroy().catch(() => {});
      await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    }
  });
});

describe('browser_session holds its page to the gate between calls', { skip: !browser && 'Chromium not installed' }, () => {
  let executor;
  let extractContentTool;
  let store;
  let tool;

  before(() => {
    executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
    executor.browserProcessor.initializePage = async () => browser.newPage();
    extractContentTool = new ExtractContentTool();
    store = new BrowserSessionStore();
    tool = new BrowserSessionTool({ store, actionExecutor: executor, extractContentTool, enableLogging: false });
  });
  after(async () => {
    await store.destroy();
    await executor.destroy().catch(() => {});
    await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    await extractContentTool.browserProcessor?.localizationManager?.cleanup().catch(() => {});
  });

  const open = async (pathname) => (await tool.execute({ operation: 'open', url: `${baseUrl}${pathname}` })).sessionId;
  const call = (operation, session_id, extra = {}) => tool.execute({ operation, session_id, ...extra });
  const click = (selector) => ({ actions: [{ type: 'click', selector }] });

  test('a read after the page redirected itself is refused, and the page is left empty', async () => {
    const id = await open('/late-moved');
    await new Promise((resolve) => setTimeout(resolve, 1200));

    await assert.rejects(() => call('read', id, { formats: ['html'] }), movedRefusal('/late-moved', '/private'));
    // What the session still holds is not the refused page.
    const after = await call('read', id, { formats: ['html'] });
    assert.ok(!JSON.stringify(after).includes(PRIVATE_TEXT));
    await call('close', id);
  });

  test('snapshot and screenshot are refused the same way', async () => {
    for (const operation of ['snapshot', 'screenshot']) {
      const id = await open('/late-moved');
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await assert.rejects(() => call(operation, id), movedRefusal('/late-moved', '/private'));
      await call('close', id);
    }
  });

  test('a click into a disallowed path fails the act, and no later call can read the page', async () => {
    const id = await open('/links');

    await assert.rejects(() => call('act', id, click('#to-private')), movedRefusal('/links', '/private'));
    const after = await call('read', id, { formats: ['html'] });
    assert.ok(!JSON.stringify(after).includes(PRIVATE_TEXT));
    await call('close', id);
  });

  test('respect_robots: false on the act lets the click through, and a URL that passed is not asked about again', async () => {
    const id = await open('/links');

    const acted = await call('act', id, { ...click('#to-private'), respect_robots: false });
    assert.equal(acted.success, true, acted.error);
    const row = auditRows.find((r) => r.event === 'robots_override' && r.url === `${baseUrl}/private`);
    assert.ok(row, `no audit row for the move; saw ${JSON.stringify(auditRows)}`);
    assert.equal(row.tool, 'browser_session');

    // No flag on this call: the page has not moved since the override.
    const read = await call('read', id, { formats: ['html'] });
    assert.ok(JSON.stringify(read).includes(PRIVATE_TEXT));
    await call('close', id);
  });

  test('a click to an allowed path works as before', async () => {
    const id = await open('/links');
    const acted = await call('act', id, click('#to-public'));
    assert.equal(acted.success, true, acted.error);
    assert.equal(new URL(acted.url).pathname, '/public');
    await call('close', id);
  });
});

describe('stealth_mode (StealthBrowserManager.scrapeWithStealth)', { skip: !browser && 'Chromium not installed' }, () => {
  let manager;
  before(() => { manager = new StealthBrowserManager({ clearanceJar: null }); });
  after(async () => { await manager.cleanup().catch(() => {}); });

  const scrape = (pathname, options = {}) => manager.scrapeWithStealth({
    url: `${baseUrl}${pathname}`,
    engine: 'chromium',
    onRedirect: redirectGate(`${baseUrl}${pathname}`, { tool: 'stealth_mode' }),
    ...options
  });

  test('an HTTP redirect into a disallowed path is refused', async () => {
    await assert.rejects(() => scrape('/moved'), refusal('/moved', '/private'));
  });

  test('so is a redirect the page makes itself after it has loaded', async () => {
    await assert.rejects(() => scrape('/js-moved', { wait_for: 1000 }), refusal('/js-moved', '/private'));
  });

  test('a redirect to an allowed path is scraped', async () => {
    const scraped = await scrape('/to-public');
    assert.match(scraped.text, /the public page/);
  });

  test('without the gate the redirected page is what comes back', async () => {
    const scraped = await scrape('/moved', { onRedirect: undefined });
    assert.ok(scraped.text.includes(PRIVATE_TEXT));
  });
});

describe('browser-rendered extract tools (BrowserProcessor.processURL)', { skip: !browser && 'Chromium not installed' }, () => {
  let processor;
  before(() => { processor = new BrowserProcessor(); });
  after(async () => {
    await processor.cleanup().catch(() => {});
    await processor.localizationManager?.cleanup().catch(() => {});
  });

  const render = (pathname, gate) => processor.processURL(
    { url: `${baseUrl}${pathname}`, options: { waitForTimeout: 1000, enableJavaScript: true } },
    gate
  );
  const gateFor = (pathname) => ({ onRedirect: redirectGate(`${baseUrl}${pathname}`, { tool: 'extract_content' }) });

  test('a redirect into a disallowed path fails the render and returns no content', async () => {
    const result = await render('/moved', gateFor('/moved'));
    assert.equal(result.success, false);
    assert.match(result.error, /redirects to .*\/private, and robots\.txt/);
    assert.ok(!JSON.stringify(result).includes(PRIVATE_TEXT));
  });

  test('so does one the page makes itself while the render waits', async () => {
    const result = await render('/js-moved', gateFor('/js-moved'));
    assert.equal(result.success, false);
    assert.ok(!JSON.stringify(result).includes(PRIVATE_TEXT));
  });

  test('a redirect to an allowed path renders', async () => {
    const result = await render('/to-public', gateFor('/to-public'));
    assert.equal(result.success, true, result.error);
    assert.match(result.text, /the public page/);
  });
});

describe('no browser navigation leaves its redirects ungated', () => {
  const sources = () => {
    const files = [path.join(ROOT, 'server.js')];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    walk(path.join(ROOT, 'src'));
    return files.map((file) => ({ file: path.relative(ROOT, file), source: fs.readFileSync(file, 'utf8') }));
  };
  /** Source with comments removed, so prose about page.goto() is not a call to it. */
  const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // The gate is handed to the navigation by each call site, so a new browser
  // path that navigates and forgets `onRedirect` reopens the hole silently.
  test('every file that calls safeGoto passes onRedirect', () => {
    const offenders = sources()
      .filter(({ file }) => file !== path.join('src', 'utils', 'ssrfGuard.js'))
      .filter(({ source }) => /\bsafeGoto\(/.test(code(source)) && !/\bonRedirect\b/.test(code(source)))
      .map(({ file }) => file);
    assert.deepEqual(offenders, []);
  });

  // scrape_with_actions and browser_session return a failed chain instead of
  // throwing, and withAuth waives a refusal's charge only on an error result.
  test('server.js reports a chain the gate refused as an error result', () => {
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.match(server, /const refusedByGate = \(result\) => result\?\.success === false && preflightRefusal\(\) !== null;/);
    for (const tool of ['scrape_with_actions', 'browser_session']) {
      const start = server.indexOf(`withAuth("${tool}"`);
      assert.ok(start >= 0, `${tool} handler exists`);
      const handler = server.slice(start, server.indexOf('\n}));', start));
      assert.match(handler, /\.\.\.\(refusedByGate\(result\) \? \{ isError: true \} : \{\}\)/, tool);
    }
  });

  test('page.goto is called only where the redirect check lives', () => {
    const callers = sources()
      .filter(({ source }) => /\.goto\(/.test(code(source)))
      .map(({ file }) => file)
      .sort();
    // ActionExecutor.navigateToUrl builds its own gate and calls
    // assertNavigationAllowed; everything else goes through safeGoto.
    assert.deepEqual(callers, [path.join('src', 'core', 'ActionExecutor.js'), path.join('src', 'utils', 'ssrfGuard.js')]);
    const executor = callers.length && fs.readFileSync(path.join(ROOT, 'src', 'core', 'ActionExecutor.js'), 'utf8');
    assert.match(executor, /assertNavigationAllowed\(page, url, response, redirectGate\(/);
  });
});

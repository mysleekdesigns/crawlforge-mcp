/**
 * Live test R24, Phase 2 (2.4, 2.5, 2.6): parameters and navigations that did
 * nothing or were invisible.
 * Run: node --test --test-force-exit tests/unit/tools/r24ActionNavigationAndRead.test.js
 *
 *   - 2.4 a click or a form submit that loads another page is reported: an
 *     entry in `navigations` with its own status and wall check, `finalUrl` at
 *     the top level, and the robots gate still refusing where it led.
 *   - 2.5 captureIntermediateStates captures after every action;
 *     captureScreenshots and formats:["screenshots"] are gone, and
 *     `screenshots` is always reported.
 *   - 2.6 browser_session `read` returns the whole page unless
 *     onlyMainContent:true asks for Readability's block.
 *
 * Real Chromium against a local fixture server (skips without the binary), the
 * same shape as tests/unit/tools/browserSessionTool.test.js.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { ScrapeWithActionsTool } = await import('../../../src/tools/advanced/ScrapeWithActionsTool.js');
const { BrowserSessionTool } = await import('../../../src/tools/advanced/BrowserSessionTool.js');
const { BrowserSessionStore } = await import('../../../src/core/browser/SessionStore.js');
const { ActionExecutor } = await import('../../../src/core/ActionExecutor.js');
const ExtractContentTool = (await import('../../../src/tools/extract/extractContent.js')).default;

let browser = null;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
} catch {
  browser = null;
}

const PAGES = {
  '/list': `<html><head><title>List</title></head><body>
<a id="next" href="/page2">Next</a>
<a id="anchor" href="#bottom">Jump</a>
<a id="private" href="/private">Private</a>
<a id="walled" href="/walled">Walled</a>
<form action="/submitted" method="post"><input name="q"><button id="go" type="submit">Go</button></form>
<p id="bottom">bottom</p>
</body></html>`,
  '/page2': '<html><head><title>Page 2</title></head><body><p>second page</p></body></html>',
  '/submitted': '<html><head><title>Submitted</title></head><body><p>thanks</p></body></html>',
  '/private': '<html><body><h1>Disallowed by robots.txt</h1></body></html>',
  '/walled': `<html><head><title>example.com</title></head><body>
<iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=abc"></iframe>
</body></html>`,
  '/quotes': `<html><head><title>Quotes</title></head><body>
<nav>Top navigation</nav>
<div class="quote"><span>First quote</span> <small>Jane Austen</small></div>
<div class="quote"><span>Second quote</span> <small>Steve Martin</small></div>
<footer>Footer line</footer>
</body></html>`
};

const server = http.createServer((req, res) => {
  if (req.url === '/robots.txt') {
    res.setHeader('content-type', 'text/plain');
    res.end('User-agent: *\nDisallow: /private\n');
    return;
  }
  res.setHeader('content-type', 'text/html');
  if (req.url === '/walled') res.statusCode = 403;
  res.end(PAGES[req.url] || '<html><body>not a fixture</body></html>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
const extractContentTool = new ExtractContentTool();
if (browser) {
  executor.browserProcessor.initializePage = async () => browser.newPage();
}

after(async () => {
  if (browser) await browser.close();
  server.close();
  await executor.destroy().catch(() => {});
  await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
  await extractContentTool.browserProcessor?.localizationManager?.cleanup().catch(() => {});
});

const click = (selector) => ({ type: 'click', selector, retries: 0 });

describe('2.4 — a click or submit that loads another page is a reported navigation', { skip: !browser && 'Chromium not installed' }, () => {
  test('a link click adds a navigations entry and moves finalUrl', async () => {
    const tool = new ScrapeWithActionsTool({ actionExecutor: executor, extractContentTool, enableLogging: false });
    const result = await tool.execute({ url: `${BASE}/list`, actions: [click('#next')], formats: ['text'] });

    assert.equal(result.success, true, result.error);
    assert.equal(result.url, `${BASE}/list`, 'url stays the one asked for');
    assert.equal(result.finalUrl, `${BASE}/page2`);
    assert.deepEqual(result.navigations, [
      { url: `${BASE}/list`, finalUrl: `${BASE}/list`, httpStatus: 200 },
      { url: `${BASE}/page2`, finalUrl: `${BASE}/page2`, httpStatus: 200, trigger: 'click' }
    ]);
  });

  test('a form submit is reported the same way', async () => {
    const result = await executor.executeActionChain(`${BASE}/list`, {
      actions: [{ type: 'type', selector: 'input[name=q]', text: 'x', retries: 0 }, click('#go')]
    });

    assert.equal(result.success, true, result.error);
    assert.equal(result.finalUrl, `${BASE}/submitted`);
    assert.equal(result.navigations.length, 2);
    assert.deepEqual(result.navigations[1], {
      url: `${BASE}/submitted`, finalUrl: `${BASE}/submitted`, httpStatus: 200, trigger: 'click'
    });
  });

  test('a click onto a wall carries that document\'s status and vendor', async () => {
    const result = await executor.executeActionChain(`${BASE}/list`, { actions: [click('#walled')] });

    assert.equal(result.success, true, 'the click happened; the wall is reported, not failed');
    assert.equal(result.navigations[1].trigger, 'click');
    assert.equal(result.navigations[1].httpStatus, 403);
    assert.equal(result.navigations[1].blocked?.vendor, 'datadome');
    assert.equal(result.navigationStatus, 403, 'the final verdict reads the status of the page the click loaded');
  });

  test('a click onto a path robots.txt disallows is refused by the gate', async () => {
    const result = await executor.executeActionChain(`${BASE}/list`, { actions: [click('#private')] });

    assert.equal(result.success, false);
    assert.match(result.error, /robots/i);
    assert.equal(result.navigations.length, 1, 'a refused move is not a navigation the chain made');
  });

  test('a fragment change is not a navigation', async () => {
    const result = await executor.executeActionChain(`${BASE}/list`, { actions: [click('#anchor')] });

    assert.equal(result.success, true, result.error);
    assert.equal(result.finalUrl, `${BASE}/list#bottom`);
    assert.equal(result.navigations.length, 1);
  });
});

describe('2.5 — capture flags do what the schema says', () => {
  const SHOT = { actionId: 'a1', data: 'AAAA', format: 'png', fullPage: false, timestamp: 1 };
  const makeTool = () => new ScrapeWithActionsTool({
    enableLogging: false,
    actionExecutor: {
      executeActionChain: async (url, chainConfig) => ({
        success: true,
        results: chainConfig.actions.map((a, i) => ({ id: `a${i}`, type: a.type, success: true, result: {} })),
        capturedStates: chainConfig.actions
          .map((a, i) => ({ afterActionIndex: i, url, html: `<html><head><title>S${i}</title></head><body>s${i}</body></html>`, timestamp: i, captureAfter: a.captureAfter }))
          .filter((s) => s.captureAfter),
        screenshots: [SHOT],
        finalHtml: '<html><head><title>Final</title></head><body><p>done</p></body></html>',
        finalUrl: url,
        navigations: []
      }),
      getStats: () => ({}),
      destroy: async () => {}
    },
    extractContentTool: { execute: async () => ({ success: true, content: { text: 'done' }, metadata: {} }) }
  });

  test('captureIntermediateStates captures after every action, not only click/type/press', async () => {
    const result = await makeTool().execute({
      url: 'https://example.com/',
      actions: [
        { type: 'click', selector: '#a' },
        { type: 'wait', duration: 1 },
        { type: 'scroll' },
        { type: 'hover', selector: '#a' },
        { type: 'press', key: 'Enter' }
      ],
      formats: ['text'],
      captureIntermediateStates: true
    });

    assert.deepEqual(result.intermediateStates.map((s) => s.capturePoint), [1, 2, 3, 4, 5]);
    assert.equal(result.totalActions, 5, 'no action is added to the chain to do it');
  });

  test('without the flag only an action\'s own captureAfter captures', async () => {
    const result = await makeTool().execute({
      url: 'https://example.com/',
      actions: [{ type: 'click', selector: '#a' }, { type: 'wait', duration: 1 }]
    });
    assert.equal(result.intermediateStates, undefined);
  });

  test('screenshots are reported with no flag to ask for them', async () => {
    const result = await makeTool().execute({ url: 'https://example.com/', actions: [{ type: 'screenshot' }] });
    assert.deepEqual(result.screenshots, [SHOT]);
    assert.equal(result.content.screenshots, undefined);
  });

  test('the removed "screenshots" format is refused, not silently empty', async () => {
    await assert.rejects(
      makeTool().execute({ url: 'https://example.com/', actions: [{ type: 'wait', duration: 1 }], formats: ['screenshots'] }),
      /formats/
    );
  });
});

describe('2.6 — browser_session read returns the whole page by default', { skip: !browser && 'Chromium not installed' }, () => {
  // Readability's answer is stubbed to the one block it kept, so the test says
  // which path produced the content rather than how Readability scores a fixture.
  const mainOnly = {
    execute: async () => ({
      title: 'Quotes',
      extractionMethod: 'readability',
      content: { text: 'First quote', markdown: 'First quote' },
      metadata: {}
    })
  };

  test('default: every quote and author; onlyMainContent:true: the main block', async () => {
    const store = new BrowserSessionStore();
    const tool = new BrowserSessionTool({ store, actionExecutor: executor, extractContentTool: mainOnly, enableLogging: false });

    const opened = await tool.execute({ operation: 'open', url: `${BASE}/quotes` });
    try {
      const full = await tool.execute({ operation: 'read', session_id: opened.sessionId, formats: ['markdown', 'text'] });
      assert.equal(full.success, true, full.error);
      assert.equal(full.extractionMethod, 'full_page');
      for (const piece of ['Top navigation', 'First quote', 'Jane Austen', 'Second quote', 'Steve Martin', 'Footer line']) {
        assert.ok(full.content.text.includes(piece), `text has "${piece}"`);
      }
      // htmlToMarkdown leaves out <nav>/<footer>/<aside> for every tool.
      for (const piece of ['First quote', 'Jane Austen', 'Second quote', 'Steve Martin']) {
        assert.ok(full.content.markdown.includes(piece), `markdown has "${piece}"`);
      }

      const main = await tool.execute({
        operation: 'read', session_id: opened.sessionId, formats: ['markdown', 'text'], onlyMainContent: true
      });
      assert.equal(main.extractionMethod, 'readability');
      assert.equal(main.content.text, 'First quote');
      assert.equal(main.content.markdown, 'First quote');
    } finally {
      await store.destroy();
    }
  });
});

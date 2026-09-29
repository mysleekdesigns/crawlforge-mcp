/**
 * Unit tests: handleConsent (browserOptions.consent) against a real Chromium page.
 * Run: node --test --test-force-exit tests/unit/core/browserConsent.test.js
 *
 * The fixture reproduces the OneTrust banner autoconsent's built-in "Onetrust"
 * rule detects (#onetrust-banner-sdk) and answers (#onetrust-reject-all-handler
 * to opt out, #onetrust-accept-btn-handler to opt in). Served from 127.0.0.1;
 * skips when Chromium isn't installed.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { handleConsent } = await import('../../../src/core/browser/consent.js');
const { ActionExecutor } = await import('../../../src/core/ActionExecutor.js');

let browser = null;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
} catch {
  browser = null;
}

const BANNER = `<html><body>
<h1>Article</h1>
<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;background:#fff">
  <p>We use cookies.</p>
  <button id="onetrust-reject-all-handler" onclick="document.body.dataset.choice='reject';this.parentNode.remove()">Reject All</button>
  <button id="onetrust-accept-btn-handler" onclick="document.body.dataset.choice='accept';this.parentNode.remove()">Accept All Cookies</button>
</div></div>
</body></html>`;

// Sourcepoint's layout: a container in the top frame, the choice buttons in an
// iframe that removes itself once a choice is made (so its own "done" message
// never arrives). autoconsent's sourcepoint-top rule hides the container;
// Sourcepoint-frame makes the choice in the iframe.
const SP_TOP = `<html><body><h1>Article</h1>
<div id="sp_message_container_1" style="position:fixed;inset:0">
  <iframe src="/index.html?message_id=1" style="width:100%;height:300px"></iframe>
</div></body></html>`;
const SP_FRAME = `<html><body>
<button class="sp_choice_type_11" onclick="parent.document.body.dataset.choice='accept';frameElement.remove()">Accept all</button>
<button class="sp_choice_type_13" onclick="parent.document.body.dataset.choice='reject';frameElement.remove()">Reject all</button>
</body></html>`;

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url === '/plain') return res.end('<html><body><h1>No banner here</h1></body></html>');
  if (req.url === '/sp') return res.end(SP_TOP);
  if (req.url.startsWith('/index.html')) return res.end(SP_FRAME);
  res.end(BANNER);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  if (browser) await browser.close();
  server.close();
});

async function withPage(path, fn) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(BASE + path);
    return await fn(page);
  } finally {
    await context.close();
  }
}

const choice = (page) => page.evaluate(() => document.body.dataset.choice || null);

describe('handleConsent', { skip: !browser && 'Chromium not installed' }, () => {
  test('reject clicks the reject button', async () => {
    await withPage('/', async (page) => {
      const r = await handleConsent(page, 'reject');
      assert.equal(r.cmp, 'Onetrust');
      assert.equal(r.action, 'optOut');
      assert.ok(r.ms <= 2300, `took ${r.ms}ms`);
      assert.equal(await choice(page), 'reject');
    });
  });

  test('accept clicks the accept button', async () => {
    await withPage('/', async (page) => {
      const r = await handleConsent(page, 'accept');
      assert.equal(r.cmp, 'Onetrust');
      assert.equal(r.action, 'optIn');
      assert.equal(await choice(page), 'accept');
    });
  });

  test('a CMP in an iframe is answered there, and its frame removing itself ends the wait', async () => {
    await withPage('/sp', async (page) => {
      const r = await handleConsent(page, 'reject');
      assert.equal(r.action, 'optOut');
      assert.equal(await choice(page), 'reject', 'the iframe rule made the choice, not just the top-frame hide');
      assert.ok(r.ms < 1900, `ended by the detach, not the cap (${r.ms}ms)`);
    });
  });

  test('no CMP: {cmp:null, action:"none"} within the cap', async () => {
    await withPage('/plain', async (page) => {
      const r = await handleConsent(page, 'reject', { timeout: 1000 });
      assert.equal(r.cmp, null);
      assert.equal(r.action, 'none');
      assert.ok(r.ms >= 1000 && r.ms <= 1300, `took ${r.ms}ms`);
    });
  });

  test('off does nothing', async () => {
    await withPage('/', async (page) => {
      assert.equal(await handleConsent(page, 'off'), null);
      assert.equal(await page.evaluate(() => 'autoconsentReceiveMessage' in window), false);
      assert.equal(await choice(page), null);
      assert.equal(await page.locator('#onetrust-banner-sdk').count(), 1);
    });
  });

  test('a closed page resolves, never throws', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.close();
    const r = await handleConsent(page, 'reject', { timeout: 300 });
    assert.equal(r.cmp, null);
    assert.ok(['none', 'error'].includes(r.action));
  });
});

describe('ActionExecutor consent wiring', { skip: !browser && 'Chromium not installed' }, () => {
  // Same seam as actionExecutorPlaywrightApi.test.js: only the browser launch
  // is replaced, with a genuine page.
  async function chain(browserOptions) {
    const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
    executor.browserProcessor.initializePage = async () => (await browser.newContext()).newPage();
    try {
      return await executor.executeActionChain(BASE + '/', {
        actions: [{ type: 'navigate', url: BASE + '/again' }]
      }, browserOptions);
    } finally {
      await executor.destroy().catch(() => {});
      await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    }
  }

  test('initial navigation and each navigate action report consent when on', async () => {
    const r = await chain({ consent: 'reject' });
    assert.equal(r.success, true, r.error);
    assert.deepEqual({ cmp: r.consent.cmp, action: r.consent.action }, { cmp: 'Onetrust', action: 'optOut' });
    assert.equal(r.results[0].result.consent.action, 'optOut');
  });

  test('consent off (the default) leaves the banner and reports nothing', async () => {
    const r = await chain({});
    assert.equal(r.success, true, r.error);
    assert.equal(r.consent, undefined);
    assert.equal('consent' in r.results[0].result, false);
    assert.match(r.finalHtml, /onetrust-banner-sdk/);
  });
});

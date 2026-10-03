/**
 * Phase 5 (5.2) of the actions + embedded-state plan: every navigation in a
 * scrape_with_actions chain is checked for a bot wall, not only the document
 * the chain ends on.
 *
 *   - stealthDocumentVerdict names AWS WAF's 202 challenge interstitial, from a
 *     condensed live capture (tests/fixtures/blocked/aws-waf-202.html), and
 *     leaves a real page answered 202 alone.
 *   - ActionExecutor reports `navigations` — [0] the initial load, then each
 *     navigate action — and a navigate action's result carries `httpStatus`
 *     and `blocked` while the action itself still succeeds.
 *   - A wall that replaces itself (AWS WAF reloads into the page) is re-read
 *     before it is reported.
 *   - ScrapeWithActionsTool passes `navigations` through, and the final
 *     document still decides top-level `blocked` and `success`.
 *
 * The browser is faked. The robots.txt behind the gate is real HTTP from a
 * local server, so ALLOWED_DOMAINS is set before the first import of config.
 *
 * Run: node --test --test-force-exit tests/unit/navigationWallVerdict.test.js
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { stealthDocumentVerdict } = await import('../../src/utils/stealthVerdict.js');
const { ActionExecutor } = await import('../../src/core/ActionExecutor.js');
const { ScrapeWithActionsTool } = await import('../../src/tools/advanced/ScrapeWithActionsTool.js');
const { _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');

const FIXTURES = fileURLToPath(new URL('../fixtures/blocked/', import.meta.url));
const AWS_WAF_202 = fs.readFileSync(`${FIXTURES}aws-waf-202.html`, 'utf8');
const CLOUDFLARE = fs.readFileSync(`${FIXTURES}cloudflare.html`, 'utf8');

const REAL_TEXT = 'Ordinary prose that a reader would see. '.repeat(120);
const realPage = (title) => ({
  title,
  html: `<html><head><title>${title}</title></head><body><p>${REAL_TEXT}</p></body></html>`,
  text: REAL_TEXT
});

// ── the verdict ─────────────────────────────────────────────────────────────

describe('stealthDocumentVerdict names the AWS WAF interstitial', () => {
  test('the 202 interstitial amazon.com served is a wall', () => {
    // As a browser reads it at domcontentloaded: no title, and the only text
    // is inside <noscript>, which innerText does not render.
    const verdict = stealthDocumentVerdict(
      { url: 'https://www.amazon.com/', title: '', text: '', html: AWS_WAF_202, status: 202 },
      { allowEmpty: true }
    );
    assert.equal(verdict.success, false);
    assert.equal(verdict.status, 202);
    assert.equal(verdict.blocked.vendor, 'aws-waf');
    assert.match(verdict.error, /aws-waf served a challenge page/);
  });

  test('a real page answered 202 is not flagged', () => {
    // The interstitial reloads into the homepage; the navigation's status
    // stays the 202 it was answered with (2026-09-29 review, 2026-10-03).
    const page = realPage('Amazon.com. Spend less. Smile more.');
    const verdict = stealthDocumentVerdict({ url: 'https://www.amazon.com/', ...page, status: 202 }, { allowEmpty: true });
    assert.equal(verdict.success, true);
    assert.equal(verdict.blocked, undefined);
  });

  test('a short page that loads the WAF SDK without the injected payload is not flagged', () => {
    const html = '<html><head><title>Checkout</title>' +
      '<script src="https://abc.us-east-1.token.awswaf.com/abc/def/challenge.js"></script></head>' +
      '<body><p>Your basket</p></body></html>';
    const verdict = stealthDocumentVerdict({ title: 'Checkout', text: 'Your basket', html, status: 200 }, { allowEmpty: true });
    assert.equal(verdict.success, true);
  });

  test('a long page is never judged by the marker', () => {
    const page = realPage('Article');
    const verdict = stealthDocumentVerdict(
      { ...page, html: page.html.replace('</head>', '<script>window.gokuProps = {};</script></head>'), status: 200 },
      { allowEmpty: true }
    );
    assert.equal(verdict.success, true);
  });
});

// ── the chain ───────────────────────────────────────────────────────────────

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nAllow: /\n');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  _resetRobotsGate();
  _resetHostRateLimiter();
});

/**
 * A page whose documents come from `docs`, keyed by path. A doc with `then`
 * is replaced by it once it has been read, the way AWS WAF's interstitial
 * reloads into the page.
 */
function makeFakePage(docs) {
  let current = 'about:blank';
  let doc = null;
  const page = {
    url: () => current,
    goto: async (url) => {
      current = url;
      doc = docs[new URL(url).pathname];
      return { status: () => doc.status, request: () => ({ url: () => url, redirectedFrom: () => null }) };
    },
    title: async () => doc.title,
    content: async () => doc.html,
    evaluate: async () => {
      const text = doc.text;
      if (doc.then) doc = doc.then;
      return text;
    },
    waitForLoadState: async () => {},
    close: async () => {},
    context: () => ({ close: async () => {} })
  };
  return page;
}

/** Executor whose page is a fake, with the real gate and navigateToUrl. */
function makeExecutor(page) {
  const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
  executor.initializePage = async (url, options) => {
    await executor.assertRobotsAllowed(url, options);
    await executor.navigateToUrl(page, url, { browserOptions: options });
    return page;
  };
  return executor;
}

describe('ActionExecutor checks every navigation', () => {
  test('a walled initial load and a walled navigate are both reported; the navigate still succeeds', async () => {
    const page = makeFakePage({
      '/': { status: 403, title: 'Just a moment...', html: CLOUDFLARE, text: 'Verifying you are human.' },
      '/next': { status: 202, title: '', html: AWS_WAF_202, text: '' }
    });
    const result = await makeExecutor(page).executeActionChain(`${baseUrl}/`, {
      actions: [{ type: 'navigate', url: `${baseUrl}/next` }]
    });

    assert.equal(result.success, true, result.error);
    assert.equal(result.navigations.length, 2);
    assert.deepEqual(result.navigations[0], {
      url: `${baseUrl}/`,
      finalUrl: `${baseUrl}/`,
      httpStatus: 403,
      blocked: result.navigations[0].blocked
    });
    assert.equal(result.navigations[0].blocked.vendor, 'cloudflare');
    assert.equal(result.navigations[1].httpStatus, 202);
    assert.equal(result.navigations[1].blocked.vendor, 'aws-waf');

    const navigate = result.results[0];
    assert.equal(navigate.success, true, 'the navigation happened; the wall is reported, not failed');
    assert.equal(navigate.result.httpStatus, 202);
    assert.equal(navigate.result.blocked.vendor, 'aws-waf');
  });

  test('a wall that replaces itself is re-read, and the page it became is reported', async () => {
    const page = makeFakePage({
      '/': { status: 202, title: '', html: AWS_WAF_202, text: '', then: { status: 202, ...realPage('Home') } }
    });
    const result = await makeExecutor(page).executeActionChain(`${baseUrl}/`, {
      actions: [{ type: 'wait', duration: 1 }]
    });

    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.navigations, [{ url: `${baseUrl}/`, finalUrl: `${baseUrl}/`, httpStatus: 202 }]);
  });

  test('a page that cannot be read is reported without a verdict, and without waiting', async () => {
    const page = makeFakePage({ '/': { status: 200 } });
    page.title = async () => { throw new Error('Target closed'); };
    const started = Date.now();
    const result = await makeExecutor(page).executeActionChain(`${baseUrl}/`, {
      actions: [{ type: 'wait', duration: 1 }]
    });

    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.navigations, [{ url: `${baseUrl}/`, finalUrl: `${baseUrl}/`, httpStatus: 200 }]);
    assert.ok(Date.now() - started < 2000, 'no wall-clearing wait for an unreadable page');
  });
});

// ── the tool ────────────────────────────────────────────────────────────────

describe('ScrapeWithActionsTool reports navigations and keeps the final verdict', () => {
  const NAVIGATIONS = [
    { url: 'https://example.com/', finalUrl: 'https://example.com/', httpStatus: 200 },
    { url: 'https://walled.example/', finalUrl: 'https://walled.example/', httpStatus: 403, blocked: { vendor: 'cloudflare', evidence: 'title "Just a moment..."' } }
  ];

  const makeTool = (finalHtml, title) => new ScrapeWithActionsTool({
    enableLogging: false,
    actionExecutor: {
      executeActionChain: async (url, chainConfig) => ({
        success: true,
        results: chainConfig.actions.map((a, i) => ({ id: `a${i}`, type: a.type, success: true, result: {} })),
        screenshots: [],
        finalHtml,
        finalUrl: 'https://walled.example/',
        navigationStatus: 403,
        navigations: NAVIGATIONS
      }),
      getStats: () => ({}),
      destroy: async () => {}
    },
    extractContentTool: {
      execute: async () => ({ success: true, content: { text: 'Verifying you are human.' }, metadata: { title } })
    }
  });

  test('navigations are passed through and a walled final page fails the chain', async () => {
    const result = await makeTool(CLOUDFLARE, 'Just a moment...').execute({
      url: 'https://example.com/',
      actions: [{ type: 'navigate', url: 'https://walled.example/' }],
      browserOptions: { stealth: true, engine: 'chromium' }
    });

    assert.deepEqual(result.navigations, NAVIGATIONS);
    assert.equal(result.success, false, 'never success:true on the wall');
    assert.equal(result.blocked.vendor, 'cloudflare');
    assert.equal(result.httpStatus, 403);
  });
});

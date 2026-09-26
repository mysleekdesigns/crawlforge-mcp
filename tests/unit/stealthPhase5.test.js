/**
 * Stealth review Phase 5 (2026-09-25): the Turnstile checkbox click, and the
 * nowsecure.nl false block.
 *
 * nowsecure.nl is not a Cloudflare wall. It answers 200 to the honest
 * CrawlForge UA with 43 visible characters and two Turnstile widgets on
 * Cloudflare's forced-interactive TEST sitekey, and every "Blocked" cell ever
 * recorded for it came from our own verdict. The fixture below is that shape.
 * Cloudflare serves its walls as 403, which is what separates the two.
 *
 * The click is a fixed offset into the challenges.cloudflare.com frame's box
 * through page.mouse — plain Playwright on Chromium, no patchright. The live
 * test drives it against a LOCAL page that loads Turnstile with the
 * forced-interactive test key: no click, no token; click, the dummy token.
 * That proves the mechanism only, not a bypass of any real site's challenge.
 * It needs challenges.cloudflare.com, so it skips when that is unreachable
 * (or no Chromium is installed); everything else here is pure.
 *
 * Run: node --test --test-force-exit tests/unit/stealthPhase5.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { detectChallengePage } from '../../src/utils/challengeDetection.js';
import { stealthDocumentVerdict } from '../../src/utils/stealthVerdict.js';
import {
  StealthBrowserManager,
  pickTurnstileBox,
  turnstileClickPoint,
  TURNSTILE_CHECKBOX_OFFSET_X
} from '../../src/core/StealthBrowserManager.js';

// Live suite gate: needs Chromium and challenges.cloudflare.com. Decided
// before any describe registers — a top-level await after the first suite lets
// --test-force-exit end the file before the late suite is ever registered.
let liveSkip = false;
try {
  const { chromium } = await import('playwright');
  const probe = await chromium.launch();
  await probe.close();
} catch {
  liveSkip = 'Chromium not installed';
}
if (!liveSkip) {
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/api.js', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) liveSkip = `challenges.cloudflare.com answered ${res.status}`;
  } catch {
    liveSkip = 'challenges.cloudflare.com unreachable (no live network)';
  }
}

const TEST_SITEKEY = '3x00000000000000000000FF'; // Cloudflare: forces an interactive challenge
const WIDGET =
  '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' +
  `<div class="cf-turnstile" data-sitekey="${TEST_SITEKEY}"></div>` +
  '<input type="hidden" name="cf-turnstile-response" id="cf-chl-widget-4rduo_response">';
const NOWSECURE_TEXT = 'NOWSECURE by nodriver NOWSECURE by nodriver';
const nowsecure = (status) => ({
  url: 'https://nowsecure.nl/',
  status,
  title: 'nowsecure.nl',
  text: NOWSECURE_TEXT,
  html: `<html><head><title>nowsecure.nl</title></head><body>${WIDGET}<h1>${NOWSECURE_TEXT}</h1>${WIDGET}</body></html>`
});

describe('Phase 5: a 200 page with only a Turnstile widget is not a wall', () => {
  test('the fixture is the measured shape: 43 characters, widget markers, no bootstrap', () => {
    assert.equal(NOWSECURE_TEXT.length, 43);
    assert.doesNotMatch(nowsecure(200).html, /_cf_chl_opt|window\._cf_chl|cf_chl_rc_/);
  });

  test('nowsecure.nl at 200 passes — detector and the printed verdict', () => {
    assert.equal(detectChallengePage(nowsecure(200)), null);
    const verdict = stealthDocumentVerdict(nowsecure(200));
    assert.equal(verdict.success, true, JSON.stringify(verdict));
    assert.equal(verdict.blocked, undefined);
  });

  test('the same widget-only document at 403 is still a Cloudflare wall', () => {
    assert.equal(detectChallengePage(nowsecure(403))?.vendor, 'cloudflare');
    const verdict = stealthDocumentVerdict(nowsecure(403));
    assert.equal(verdict.success, false);
    assert.equal(verdict.blocked?.vendor, 'cloudflare');
  });

  test('without a status the length floor still decides (unchanged behaviour)', () => {
    const { status, ...noStatus } = nowsecure(200);
    assert.equal(detectChallengePage(noStatus)?.vendor, 'cloudflare');
  });

  test('a 200 with the interstitial prose or the bootstrap is still a wall', () => {
    const prose = { ...nowsecure(200), text: 'Verifying you are human. This may take a few seconds.' };
    assert.equal(detectChallengePage(prose)?.vendor, 'cloudflare');
    const bootstrap = { ...nowsecure(200), html: `${nowsecure(200).html}<script>window._cf_chl_opt={cType:'managed'}</script>` };
    assert.equal(detectChallengePage(bootstrap)?.vendor, 'cloudflare');
  });
});

describe('Phase 5: where the checkbox click lands', () => {
  test('a fixed offset into the frame box, vertically centred', () => {
    assert.deepEqual(turnstileClickPoint({ x: 100, y: 200, width: 300, height: 65 }), {
      x: 100 + TURNSTILE_CHECKBOX_OFFSET_X,
      y: 232.5
    });
  });

  test('a box narrower than the offset is clicked inside itself', () => {
    const point = turnstileClickPoint({ x: 0, y: 0, width: 20, height: 20 });
    assert.deepEqual(point, { x: 10, y: 10 });
  });

  test('an off-screen or empty widget is skipped (nowsecure.nl mounts one at y=-147)', () => {
    const viewport = { width: 1280, height: 720 };
    const offscreen = { x: 506, y: -147, width: 500, height: 91 };
    const onscreen = { x: 489, y: 302, width: 535, height: 99 };
    assert.equal(pickTurnstileBox([null, { x: 0, y: 0, width: 0, height: 0 }, offscreen, onscreen], viewport), onscreen);
    assert.equal(pickTurnstileBox([offscreen], viewport), null);
    assert.equal(pickTurnstileBox([{ x: 1300, y: 10, width: 300, height: 65 }], viewport), null);
  });
});

/** A page with the given frames; records every mouse call. */
function fakePage({ frameUrls = [], box = { x: 100, y: 200, width: 300, height: 65 }, doc = nowsecure(403) } = {}) {
  const mouse = { calls: [] };
  for (const op of ['move', 'click']) mouse[op] = async (...args) => { mouse.calls.push([op, ...args]); };
  return {
    mouse,
    frames: () => frameUrls.map((url) => ({ url: () => url, frameElement: async () => ({ boundingBox: async () => box }) })),
    viewportSize: () => ({ width: 1280, height: 720 }),
    title: async () => doc.title,
    content: async () => doc.html,
    evaluate: async () => doc.text,
    waitForFunction: async () => {},
    waitForLoadState: async () => {}
  };
}

const CF_FRAME = 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/x/3x00000000000000000000FF/auto';

describe('Phase 5: the click, against a fake page', () => {
  const manager = new StealthBrowserManager({ clearanceJar: null });

  test('clicks the checkbox point of the Cloudflare frame', async () => {
    const page = fakePage({ frameUrls: ['about:blank', 'https://example.com/ad', CF_FRAME] });
    assert.equal(await manager._clickTurnstile(page), true);
    const click = page.mouse.calls.find(([op]) => op === 'click');
    assert.deepEqual(click.slice(1, 3), [100 + TURNSTILE_CHECKBOX_OFFSET_X, 232.5]);
  });

  test('no Cloudflare frame, no click', async () => {
    const page = fakePage({ frameUrls: ['about:blank', 'https://example.com/ad'] });
    assert.equal(await manager._clickTurnstile(page), false);
    assert.equal(page.mouse.calls.length, 0);
  });

  test('a 403 widget-only wall on Chromium is clicked', async () => {
    const page = fakePage({ frameUrls: [CF_FRAME], doc: nowsecure(403) });
    assert.equal(await manager._clickThroughChallenge(page, { status: 403, engine: 'chromium' }), true);
  });

  test('a 200 page that embeds a widget is never clicked', async () => {
    const page = fakePage({ frameUrls: [CF_FRAME], doc: nowsecure(200) });
    assert.equal(await manager._clickThroughChallenge(page, { status: 200, engine: 'chromium' }), false);
    assert.equal(page.mouse.calls.length, 0);
  });

  test('Camoufox is not clicked (Phase 5 scope is Chromium)', async () => {
    const page = fakePage({ frameUrls: [CF_FRAME], doc: nowsecure(403) });
    assert.equal(await manager._clickThroughChallenge(page, { status: 403, engine: 'camoufox' }), false);
    assert.equal(page.mouse.calls.length, 0);
  });
});

describe('Phase 5 live: the click earns the token on a local test-key page', { skip: liveSkip }, () => {
  const PAGE =
    '<!doctype html><html><head><title>turnstile test</title>' +
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></head>' +
    `<body><h1>test</h1><form><div class="cf-turnstile" data-sitekey="${TEST_SITEKEY}"></div></form></body></html>`;
  let server;
  let url;
  let manager;

  before(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
    manager = new StealthBrowserManager({ clearanceJar: null });
  });

  after(async () => {
    await manager.cleanup().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  });

  /** Open the page on stealth Chromium and wait for the widget's frame. */
  async function openWidget() {
    const { contextId } = await manager.createStealthContext({ engine: 'chromium' });
    const page = await manager.createStealthPage(contextId);
    // Direct goto, not safeGoto: the SSRF guard rightly refuses loopback.
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 15000;
    while (!page.frames().some((f) => f.url().startsWith('https://challenges.cloudflare.com/')) && Date.now() < deadline) {
      await page.waitForTimeout(250);
    }
    // Let the widget paint its checkbox before anything is clicked.
    await page.waitForTimeout(2500);
    return { contextId, page };
  }
  const token = (page) =>
    page.evaluate(() => document.querySelector('input[name="cf-turnstile-response"]')?.value ?? null);

  test('without the click the forced-interactive widget issues no token', async () => {
    const { contextId, page } = await openWidget();
    try {
      await page.waitForTimeout(4000);
      assert.equal(await token(page), '');
    } finally {
      await manager.closeContext(contextId);
    }
  });

  test('with the click it issues the dummy token', async () => {
    const { contextId, page } = await openWidget();
    try {
      assert.equal(await manager._clickTurnstile(page), true);
      assert.equal(await token(page), 'XXXX.DUMMY.TOKEN.XXXX');
    } finally {
      await manager.closeContext(contextId);
    }
  });
});

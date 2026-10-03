/**
 * bypassCloudflareChallenge recognises Cloudflare's current interstitial.
 *
 * The page Cloudflare serves today reads "Performing security verification"
 * under the title "Just a moment..." (doordash.com, 2026-10-03), and carries
 * none of the older phrases the wait looked for, so the wait ended at once and
 * the chain went on against the interstitial. These run the method against a
 * local copy of that page in Chromium; nothing is clicked, the page's own
 * script replaces itself the way Cloudflare's does when it clears.
 *
 * Run: node --test --test-force-exit tests/unit/cloudflareChallengeWait.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { StealthBrowserManager } from '../../src/core/StealthBrowserManager.js';

let skip = false;
let chromium;
try {
  ({ chromium } = await import('playwright'));
  const probe = await chromium.launch();
  await probe.close();
} catch {
  skip = 'Chromium not installed';
}

// The text and title as captured; the script stands in for Cloudflare's own,
// which swaps the document for the page once the check passes.
const interstitial = (clearAfterMs) =>
  '<html><head><title>Just a moment...</title></head><body>' +
  '<p>www.doordash.com</p><h2>Performing security verification</h2>' +
  '<p>This website uses a security service to protect against malicious bots.</p>' +
  '<p>Ray ID: a44d16448a90c288</p><p>Performance and Security by Cloudflare</p>' +
  `<script>setTimeout(() => { document.title = 'DoorDash'; document.body.innerHTML = '<h1>Everything you crave</h1>'; }, ${clearAfterMs});</script>` +
  '</body></html>';

describe('bypassCloudflareChallenge', { skip }, () => {
  let browser;
  let page;
  const manager = new StealthBrowserManager();
  manager.humanBehaviorSimulator = null; // the wait, not the mouse, is under test

  before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  after(async () => {
    await browser?.close();
  });

  test('waits on the "Performing security verification" page until it clears', async () => {
    // Cleared after the method's 2 s settle, so only the wait can see it go.
    await page.setContent(interstitial(4000));
    const started = Date.now();

    assert.equal(await manager.bypassCloudflareChallenge(page), true);
    assert.equal(await page.title(), 'DoorDash');
    assert.ok(Date.now() - started >= 3500, 'returned before the interstitial cleared');
  });

  test('gives up after 10 s on a challenge that never clears', async () => {
    // The timeout was once passed as the page function's argument, so the
    // wait ran Playwright's 30 s default whatever the code said.
    await page.setContent(interstitial(60000));
    const started = Date.now();

    assert.equal(await manager.bypassCloudflareChallenge(page), true);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 11000 && elapsed < 16000, `waited ${elapsed} ms (2 s settle + 10 s cap)`);
  });

  test('an ordinary page is not taken for a challenge', async () => {
    await page.setContent('<html><head><title>Home</title></head><body><h1>Welcome</h1></body></html>');
    assert.equal(await manager.bypassCloudflareChallenge(page), false);
  });
});

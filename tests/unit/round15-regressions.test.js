/**
 * Round 15 regressions (2026-09-04).
 *
 * 1. batch_scrape formats:["text"] returned inline <script> and <style> bodies
 *    as page text — the worker took $('body').text() with nothing removed
 *    (erlang.org/downloads shipped its theme-toggle script, opennet.ru its CSS).
 * 2. The stealth page router aborted every request whose URL contained
 *    "selenium", "webdriver" or "puppeteer" — the top-level navigation to
 *    www.selenium.dev included — and challenges.cloudflare.com, so a Cloudflare
 *    challenge could never complete. It also set bypassCSP, which rebrowser's
 *    bot detector flags as "invalid behavior for a normal browser".
 * 3. A Cloudflare "Just a moment..." interstitial came back as success:true.
 * 4. analyze_content counted a Thai paragraph as 4 words: only CJK scripts
 *    reached Intl.Segmenter, Thai got the whitespace split.
 *
 * Run: node --test tests/unit/round15-regressions.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { generateFormats } from '../../src/tools/advanced/batchScrape/worker.js';
import { StealthBrowserManager } from '../../src/core/StealthBrowserManager.js';
import { detectChallengePage } from '../../src/utils/challengeDetection.js';
import { needsWordSegmentation } from '../../src/utils/languageDetection.js';
import { ContentAnalyzer } from '../../src/core/analysis/ContentAnalyzer.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('R15.1 batch_scrape text excludes script and style bodies', () => {
  const html = `<html><head><title>Downloads</title>
    <style>.hdr_mobile { text-align: center; display: none; }</style></head>
    <body><h1>Download Erlang/OTP</h1><p>The latest version is 29.0.6.</p>
    <noscript>Enable JavaScript</noscript>
    <template><p>TEMPLATE_BODY</p></template>
    <script>// Theme toggle: cycles light -> dark -> system.
      (function () { var KEY = "ex_doc:settings"; })();</script></body></html>`;

  test('text carries the rendered copy only', () => {
    const { text } = generateFormats(load(html), html, ['text']);
    assert.match(text, /The latest version is 29\.0\.6/);
    assert.doesNotMatch(text, /Theme toggle|ex_doc:settings/);
    assert.doesNotMatch(text, /hdr_mobile|text-align/);
    assert.doesNotMatch(text, /Enable JavaScript|TEMPLATE_BODY/);
  });

  test('markdown is clean too, and the html format stays the raw document', () => {
    const { markdown, html: raw } = generateFormats(load(html), html, ['markdown', 'html']);
    assert.doesNotMatch(markdown, /Theme toggle|hdr_mobile/);
    assert.match(raw, /Theme toggle/);
  });
});

describe('R15.2 stealth request routing', () => {
  test('nothing is aborted by URL: the decision takes no URL at all', () => {
    assert.equal(StealthBrowserManager.shouldAbortRequest.length, 2);
    for (const level of ['basic', 'medium', 'advanced']) {
      assert.equal(StealthBrowserManager.shouldAbortRequest('document', level), false, `document at ${level}`);
      assert.equal(StealthBrowserManager.shouldAbortRequest('script', level), false, `script at ${level}`);
      assert.equal(StealthBrowserManager.shouldAbortRequest('xhr', level), false, `xhr at ${level}`);
    }
    assert.equal(StealthBrowserManager.shouldAbortRequest('image', 'medium'), false);
  });

  test('the URL blocklists and bypassCSP are gone from the manager', () => {
    const src = read('src/core/StealthBrowserManager.js');
    assert.doesNotMatch(src, /url\.includes\('selenium'\)/);
    assert.doesNotMatch(src, /'challenges\.cloudflare\.com',/);
    assert.doesNotMatch(src, /bypassCSP:\s*true/);
    // The plugin fallback pairs its plugins with navigator.mimeTypes now.
    assert.match(src, /defineProperty\(navigator, 'mimeTypes'/);
  });

  test('the user-agent pools track the bundled engines, not Chrome 119–121', () => {
    const manager = new StealthBrowserManager();
    const chrome = Object.values(manager.userAgentPools.chrome).flat();
    assert.ok(chrome.length > 0);
    // Bundled Chromium is 151; a pool within three majors of it is current.
    for (const ua of chrome) {
      const major = Number(ua.match(/Chrome\/(\d+)/)[1]);
      assert.ok(major >= 148, `stale Chrome UA: ${ua}`);
    }
    for (const ua of Object.values(manager.userAgentPools.firefox).flat()) {
      assert.ok(Number(ua.match(/Firefox\/(\d+)/)[1]) >= 135, `stale Firefox UA: ${ua}`);
    }
    assert.match(manager.generateSecChUaHeader('not a chrome ua'), /"Chromium";v="15\d"/);
  });
});

describe('R15.3 challenge interstitial detection', () => {
  const cloudflare = {
    title: 'Just a moment...',
    html: '<html><head><title>Just a moment...</title></head><body><script src="https://challenges.cloudflare.com/turnstile/v0/b/abc/api.js"></script></body></html>',
    text: 'www.producthunt.com Performing security verification This website uses a security service to protect against malicious bots.'
  };

  test('a Cloudflare "Just a moment..." page is a cloudflare block', () => {
    const hit = detectChallengePage(cloudflare);
    assert.equal(hit?.vendor, 'cloudflare');
    assert.match(hit.evidence, /Just a moment/);
  });

  test('the title alone is enough — create_page has no body text to offer', () => {
    assert.equal(detectChallengePage({ title: 'Just a moment...', html: '', text: '' })?.vendor, 'cloudflare');
  });

  test('an Amazon robot check is an amazon block whatever its length', () => {
    const html = '<form method="get" action="/errors/validateCaptcha"><input name="field-keywords"></form>' + '<p>x</p>'.repeat(2000);
    assert.equal(detectChallengePage({ title: 'Amazon.de', html, text: 'x '.repeat(3000) })?.vendor, 'amazon');
  });

  test('a real page that merely embeds a Turnstile widget is not a block', () => {
    const html = '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script><article>' + 'Lorem ipsum dolor sit amet. '.repeat(300) + '</article>';
    assert.equal(detectChallengePage({ title: 'Sign in — Example', html, text: 'Lorem ipsum dolor sit amet. '.repeat(300) }), null);
  });

  test('an ordinary page is null', () => {
    assert.equal(detectChallengePage({ title: 'Web form', html: '<h1>Web form</h1>', text: 'Web form Text input' }), null);
  });
});

describe('R15.4 word segmentation for unspaced scripts', () => {
  const thai = 'รัฐบาลประกาศมาตรการใหม่เพื่อแก้ไขปัญหาค่าครองชีพในวันนี้ นายกรัฐมนตรีกล่าวว่าราคาสินค้าจำเป็นจะลดลงตั้งแต่เดือนหน้า ขณะที่ฝ่ายค้านวิจารณ์ว่ามาตรการดังกล่าวยังไม่เพียงพอ';

  test('Thai text is routed to the segmenter, Latin text is not', () => {
    assert.equal(needsWordSegmentation(thai), true);
    assert.equal(needsWordSegmentation('The government announced new measures today.'), false);
    assert.equal(needsWordSegmentation('政府は本日、新たな対策を発表した。'), true);
  });

  test('a Thai paragraph counts as many words, not four', () => {
    const analyzer = new ContentAnalyzer();
    const words = analyzer.tokenizeWords(thai);
    assert.ok(words.length > 20, `expected dozens of words, got ${words.length}`);
    assert.equal(analyzer.tokenizeWords('four words right here').length, 4);
  });
});

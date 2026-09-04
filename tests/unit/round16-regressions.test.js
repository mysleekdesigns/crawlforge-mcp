/**
 * Round 16 regressions (2026-09-04, live sweep of all 29 tools on mcp-server
 * 5.6.2 + crawlforge-extractors 1.6.2).
 *
 * D3  analyze_content cut every non-ASCII letter out of entities and topics
 *     ("Universität" → "Universit", "Wisłą" → "Wis", "Środkowej" dropped).
 * D4  the stealth fingerprint drew its screen and its viewport from the pool
 *     independently (a 1536×864 window on a 1366×768 screen), used a random
 *     float scale factor (1.7 → 1408.0000305175781px), reported outer ==
 *     inner window size, spoofed a random US timezone beside a host in
 *     another one, and emulated mobile under a desktop user agent.
 * D5  stealth_mode scrape swallowed a crashed/closed page into
 *     success:true with an empty title and body.
 * G1  Readability's one dense block was reported as the main content of a
 *     landing page (gnome.org: ~150 of 1,666 visible characters).
 * G3  configure_country listed the language twice ("de", "de", "en").
 *
 * Run: node --test --test-force-exit tests/unit/round16-regressions.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContentAnalyzer } from '../../src/core/analysis/ContentAnalyzer.js';
import { StealthBrowserManager } from '../../src/core/StealthBrowserManager.js';
import { LocalizationManager } from '../../src/core/LocalizationManager.js';
import { isThinMainContent, THIN_MAIN_CONTENT } from '../../src/tools/scrape/_mainContent.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('D3: entity extraction keeps non-ASCII letters', () => {
  const analyzer = new ContentAnalyzer();

  test('Polish and German proper nouns come back whole', async () => {
    const pl = 'Warszawa jest stolicą Polski i leży nad Wisłą. Uniwersytet Warszawski oraz Politechnika Warszawska należą do największych uczelni Europy Środkowej.';
    const de = 'Die Universität Zürich und die ETH Zürich liegen in der Schweiz. Jürgen Müller leitet das Institut für Ökologie in München.';
    const flat = (e) => [...e.people, ...e.places, ...e.organizations, ...e.other];
    const polish = flat(await analyzer.extractEntities(pl));
    const german = flat(await analyzer.extractEntities(de));
    for (const want of ['Wisłą', 'Uniwersytet Warszawski', 'Europy Środkowej']) {
      assert.ok(polish.includes(want), `${want} missing from ${JSON.stringify(polish)}`);
    }
    for (const want of ['Ökologie', 'München']) {
      assert.ok(german.includes(want), `${want} missing from ${JSON.stringify(german)}`);
    }
    assert.ok(german.some((e) => e.includes('Universität Zürich')), JSON.stringify(german));
    for (const truncated of ['Wis', 'Universit', 'Universitat', 'Z', 'Europy']) {
      assert.ok(![...polish, ...german].includes(truncated), `truncated entity ${truncated}`);
    }
  });

  test('topic and keyword cleaning no longer strips a trailing ą or ł', async () => {
    const text = 'Stolicą Polski jest Warszawa. Stolicą Polski jest Warszawa. Do stolicy należą dzielnice.';
    const keywords = await analyzer.extractKeywords(text, {});
    const words = (keywords.keywords || keywords).map((k) => k.keyword.normalize('NFC'));
    assert.ok(words.some((w) => w.includes('stolicą'.normalize('NFC'))), JSON.stringify(words));
    assert.ok(!words.some((w) => /(?<!\p{L})stolic(?!\p{L})/u.test(w)), JSON.stringify(words));
  });

  test('no ASCII-only letter class is left in the analyzer', () => {
    const src = read('src/core/analysis/ContentAnalyzer.js');
    const offenders = src.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => !/^\s*(\/\/|\*)/.test(line) && /\[\^?a-z0-9\]|\[A-Z\]|\[a-zA-Z\.?\]|\[A-Za-z\]|\[\^a-zA-Z\]|\[\^A-Za-z\]/.test(line));
    assert.deepEqual(offenders, []);
  });
});

describe('D4: the stealth display is one coherent device', () => {
  let manager;
  before(() => { manager = new StealthBrowserManager(); });
  after(async () => { await manager.contexts.destroy?.(); });

  test('screen, viewport, window and scale factor agree over 200 fingerprints', () => {
    const chrome = { windows: 85, linux: 85, macos: 87 };
    const failures = [];
    for (let i = 0; i < 200; i++) {
      const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
      const os = /Macintosh/.test(fp.userAgent) ? 'macos' : (/X11|Linux/.test(fp.userAgent) ? 'linux' : 'windows');
      const { screen, viewport, window: win, deviceScaleFactor: dpr } = fp;
      if (viewport.width > screen.width || viewport.height > screen.availHeight) failures.push(`${i}: window ${viewport.width}×${viewport.height} larger than screen ${screen.width}×${screen.availHeight}`);
      if (screen.availHeight >= screen.height || screen.availWidth !== screen.width) failures.push(`${i}: avail ${screen.availWidth}×${screen.availHeight} vs ${screen.width}×${screen.height}`);
      if (win.outerWidth !== viewport.width || win.outerHeight !== viewport.height + chrome[os]) failures.push(`${i}: outer ${win.outerWidth}×${win.outerHeight} for inner ${viewport.width}×${viewport.height} on ${os}`);
      if (win.outerHeight > screen.availHeight) failures.push(`${i}: outer height ${win.outerHeight} exceeds available ${screen.availHeight}`);
      if (![1, 1.25, 1.5, 2].includes(dpr)) failures.push(`${i}: scale factor ${dpr}`);
      if (os === 'macos' && dpr !== 2 && screen.width !== 1920) failures.push(`${i}: mac at scale ${dpr}`);
      if (screen.width >= 3840) failures.push(`${i}: a ${screen.width}px-wide screen at scale ${dpr}`);
      if (fp.isMobile) failures.push(`${i}: mobile emulation under ${fp.userAgent}`);
      if (fp.hasTouch && os !== 'windows') failures.push(`${i}: touch on ${os}`);
    }
    assert.deepEqual(failures, []);
  });

  test('a custom viewport is placed on the smallest screen it fits', () => {
    const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true, customViewport: { width: 1200, height: 800 } });
    assert.deepEqual(fp.viewport, { width: 1200, height: 800 });
    assert.ok(fp.screen.width >= 1200 && fp.screen.availHeight >= fp.window.outerHeight, JSON.stringify(fp.screen));
    assert.equal(fp.window.outerWidth, 1200);
  });

  test('the timezone follows the host zone when the host has one', () => {
    const hostZone = manager.hostTimezone();
    const inTable = manager.localePersonas.some((p) => p.timezone === hostZone);
    for (let i = 0; i < 20; i++) {
      const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
      if (hostZone && inTable) {
        assert.equal(fp.timezone, hostZone);
        const persona = manager.localePersonas.find((p) => p.timezone === hostZone);
        assert.equal(fp.geolocation.latitude.toFixed(0), persona.latitude.toFixed(0));
      } else {
        assert.ok(manager.localePersonas.some((p) => p.timezone === fp.timezone), fp.timezone);
      }
    }
    // An explicit locale keeps its own persona; an explicit timezone wins outright.
    assert.equal(manager.generateAdvancedFingerprint({ locale: 'ja-JP', useRandomUserAgent: true }).timezone, 'Asia/Tokyo');
    assert.equal(manager.generateAdvancedFingerprint({ locale: 'en-US', timezone: 'Europe/Rome' }).timezone, 'Europe/Rome');
    assert.equal(manager.hostTimezone.call({ }), Intl.DateTimeFormat().resolvedOptions().timeZone === 'UTC' ? null : Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  test('the fingerprint still varies', () => {
    const screens = new Set();
    for (let i = 0; i < 300; i++) {
      const fp = manager.generateAdvancedFingerprint({ locale: 'en-US', useRandomUserAgent: true });
      screens.add(`${fp.screen.width}x${fp.screen.height}@${fp.deviceScaleFactor}`);
    }
    assert.ok(screens.size >= 5, `only ${screens.size} distinct displays over 300 fingerprints`);
  });

  test('the init scripts spoof the outer window size and webgl2 GPU strings', () => {
    const src = read('src/core/StealthBrowserManager.js');
    assert.match(src, /defineProperty\(window, 'outerHeight'/);
    assert.match(src, /window\.WebGL2RenderingContext/);
    assert.doesNotMatch(src, /generateAdvancedScreenProperties|randomFloat\(1, 2, 1\)/);
  });
});

describe('D5: a stealth page that cannot be read is an error, not a blank success', () => {
  test('the three document reads are no longer individually swallowed', () => {
    const src = read('src/core/StealthBrowserManager.js');
    const body = src.slice(src.indexOf('async scrapeWithStealth('), src.indexOf('static shouldAbortRequest('))
      .split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
    assert.doesNotMatch(body, /\.catch\(\(\) => ''\)/);
    assert.match(body, /page\.on\('crash'/);
    assert.match(body, /document\.body \? document\.body\.innerText : ''/);
    assert.doesNotMatch(body, /innerText\('body'\)/);
  });

  test('the tool names a document that rendered no title and no text', () => {
    const src = read('server.js');
    const scrape = src.slice(src.indexOf("case 'scrape': {"), src.indexOf("case 'create_context'"));
    assert.match(scrape, /rendered no title and no text/);
    assert.match(scrape, /result\.success = false/);
  });
});

describe('G1: a thin Readability article is not the main content', () => {
  const para = (n) => `<p>${'word '.repeat(n).trim()}</p>`;
  const page = (article, rest) => `<html><body><nav>menu</nav>${rest}<main>${article}</main><footer>foot</footer></body></html>`;

  test('a short block on a page with far more visible text is thin', () => {
    const article = para(20);                       // ~100 characters
    const html = page(article, para(200) + para(200) + para(200));
    const thin = isThinMainContent(article, html);
    assert.ok(thin, 'expected a thin verdict');
    assert.ok(thin.kept < THIN_MAIN_CONTENT.maxChars && thin.kept / thin.visible < THIN_MAIN_CONTENT.maxShare);
  });

  test('an article that IS most of the page, or a long one, is not thin', () => {
    const article = para(40);                       // ~200 characters, most of the page
    assert.equal(isThinMainContent(article, page(article, para(10))), null);
    const long = para(400);                         // ~2,000 characters on a huge page
    assert.equal(isThinMainContent(long, page(long, para(4000))), null);
  });

  test('scripts and styles do not count as visible text', () => {
    const article = para(20);
    const html = page(article, `<script>${'x'.repeat(5000)}</script><style>${'y'.repeat(5000)}</style>`);
    assert.equal(isThinMainContent(article, html), null);
  });

  test('scrape and extract_content both consult the check', () => {
    assert.match(read('src/tools/scrape/unifiedScrape.js'), /isThinMainContent\(main\.html, html\)/);
    assert.match(read('src/tools/extract/extractContent.js'), /isThinMainContent\(processingResult\.readability\.content, html\)/);
  });
});

describe('G3: browser locale languages are not repeated', () => {
  test('createBrowserLocale lists each language once', () => {
    const manager = new LocalizationManager();
    const de = manager.createBrowserLocale('DE');
    assert.deepEqual(de.languages, [...new Set(de.languages)]);
    assert.ok(de.languages.includes('en'));
    const src = read('src/core/LocalizationManager.js');
    assert.doesNotMatch(src, /languages: \[(?!\.\.\.new Set)/);
  });
});

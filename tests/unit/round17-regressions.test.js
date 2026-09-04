/**
 * Round 17 regressions (2026-09-04, live sweep of all 29 tools on mcp-server
 * 5.6.7 + crawlforge-extractors 1.6.3, every site new to the runbook).
 *
 * D1  scrape, extract_structured, extract_content, extract_with_llm and agent
 *     decoded every body as UTF-8: Shift_JIS pages (kakaku.com, vector.co.jp)
 *     came back as mojibake while batch_scrape, already on readBody, read them.
 * D2  agent synthesis invented versions and dates found on no fetched page
 *     ("commander 8.6.2 published January 18, 2024").
 * D3  a Vercel Security Checkpoint (HTTP 429 interstitial) passed as a
 *     successful stealth scrape carrying the checkpoint's own title.
 * D4  switching stealth engines closed the running browser and every live
 *     context in it; a create_context id from before a camoufox scrape
 *     pointed at a closed browser.
 * D5  generate_timezone_spoof computed the offset against the host zone
 *     (America/Sao_Paulo → -420 from a UTC-4 host).
 * D6  twelve $('title') sites welded inline <svg><title> text into the page
 *     title (roc-lang.org: "Roc — a fast, friendly, functional languageGitHub…").
 * D7  the hardware spoof never reached Web Workers or service workers, so a
 *     worker's navigator contradicted the main thread's.
 * G1  extract_structured dropped the page head (nav "Install (6.3.3)") when
 *     the main content filled the budget; the model answered with the
 *     previous release listed in the article.
 * G2  analyze_content ran the English noun-phrase matcher on Hindi and
 *     Finnish, returning whole clauses as keywords; the Devanagari danda
 *     never ended a sentence; Japanese particles led kakaku.com's keywords.
 * G3  auto_detect labelled Japanese text "chinese" (ideographs tested first).
 *
 * Run: node --test --test-force-exit tests/unit/round17-regressions.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { load } from 'cheerio';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { detectChallengePage } = await import('../../src/utils/challengeDetection.js');
const { fetchAndParse } = await import('../../src/tools/extract/_fetchAndParse.js');
const { ExtractContentTool } = await import('../../src/tools/extract/extractContent.js');
const { shownText } = await import('../../src/tools/extract/extractStructured.js');
const { splitSentences } = await import('../../src/core/analysis/sentenceUtils.js');
const { ContentAnalyzer } = await import('../../src/core/analysis/ContentAnalyzer.js');
const { LocalizationManager } = await import('../../src/core/LocalizationManager.js');
const { unverifiedValues } = await import('../../src/core/AgentOrchestrator.js');
const { pageTitle } = await import('../../src/utils/pageTitle.js');
const { StealthBrowserManager } = await import('../../src/core/StealthBrowserManager.js');

// ── D1: charset-aware decoding on the shared fetch path ──────────────────────

// "価格比較" and "ソフト" as Shift_JIS bytes; ASCII markup is identical in both.
const SJIS_TITLE = Buffer.from('89bf8a6994e48a72', 'hex');
const SJIS_WORD = Buffer.from('835c83748367', 'hex');
const sjisPage = (head) => Buffer.concat([
  Buffer.from(`<html><head>${head}<title>`), SJIS_TITLE,
  Buffer.from('</title></head><body><main><h1>'), SJIS_TITLE,
  Buffer.from('</h1><p>'), SJIS_WORD,
  Buffer.from(' 2026 '.repeat(40)), Buffer.from('</p></main></body></html>')
]);

describe('D1: Shift_JIS bodies are decoded by charset, not as UTF-8', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/header') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=shift_jis' });
        return res.end(sjisPage(''));
      }
      if (req.url === '/meta') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(sjisPage('<meta charset="shift_jis">'));
      }
      res.writeHead(404); res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('fetchAndParse honours the Content-Type charset', async () => {
    const { $, textContent } = await fetchAndParse(`${baseUrl}/header`, { tool: 'scrape' });
    assert.equal($('title').text(), '価格比較');
    assert.match(textContent, /ソフト/);
    assert.doesNotMatch(textContent, /�/, 'no replacement characters');
  });

  test('fetchAndParse honours a <meta charset> when the header has none', async () => {
    const { $ } = await fetchAndParse(`${baseUrl}/meta`, { tool: 'scrape' });
    assert.equal($('title').text(), '価格比較');
  });

  test('extract_content reads the same body correctly', async () => {
    const result = await new ExtractContentTool().execute({ url: `${baseUrl}/header` });
    assert.equal(result.success, true, JSON.stringify(result).slice(0, 300));
    assert.equal(result.title, '価格比較');
  });
});

// ── D2: literal provenance guard on agent answers ────────────────────────────

describe('D2: unverifiedValues names versions, dates and counts the sources never state', () => {
  const source = 'commander 14.0.2 was released. Downloads last week: 1 234 567. Docs updated 2026-08-30.';

  test('values present in the source pass, including across separators and case', () => {
    assert.deepEqual(unverifiedValues('Version 14.0.2 has 1,234,567 downloads (2026-08-30).', source), []);
  });

  test('invented versions, dates and counts are reported once each', () => {
    const answer = 'commander 8.6.2 was published January 18, 2024 and again 18 January 2024; 9,876 users. commander 8.6.2.';
    assert.deepEqual(unverifiedValues(answer, source), ['8.6.2', 'January 18, 2024', '18 January 2024', '9,876']);
  });

  test('URLs in the answer are citations, not claims', () => {
    assert.deepEqual(unverifiedValues('See https://example.com/v/9.9.9/2024-01-18', source), []);
  });

  test('a bare year is not reported beside the date that contains it', () => {
    const missing = unverifiedValues('Released March 3, 2019.', source);
    assert.deepEqual(missing, ['March 3, 2019']);
  });

  test('an empty answer has nothing to verify', () => {
    assert.deepEqual(unverifiedValues('', source), []);
    assert.deepEqual(unverifiedValues(null, source), []);
  });
});

describe('D2: a search snippet stands in for a page that cannot be fetched', () => {
  const origFetch = globalThis.fetch;
  after(() => { globalThis.fetch = origFetch; });

  test('the snippet is evidence, labelled, and the answer it grounds carries no warning', async () => {
    const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');
    const o = new AgentOrchestrator({});
    const seenPrompts = [];
    o._samplingClient = {
      complete: async (p) => {
        seenPrompts.push(p);
        if (p.includes('--- Source:')) return { text: 'The latest version of commander is 15.0.0.', provider: 'mock' };
        return { text: 'npm commander', provider: 'mock' };
      }
    };
    const PKG = 'https://www.npmjs.com/package/commander';
    // The snippet says nothing useful; the page's meta description (which the
    // engine also returns) carries the version. Both make up the excerpt.
    o._searchTool = {
      execute: async () => ({
        results: [{
          link: PKG, title: 'commander - npm',
          snippet: 'May 29, 2026 ... You write code to describe your command line interface. Commander looks after parsing the arguments.',
          pagemap: { metatags: { description: 'the complete solution for node.js command-line programs. Latest version: 15.0.0, last published: 3 months ago.' } }
        }]
      })
    };
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/robots.txt')) return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => '' };
      return { ok: false, status: 403, statusText: 'Forbidden', url, headers: { get: () => null }, text: async () => 'challenge' };
    };

    // The only prompt term the excerpt shares is the quoted, punctuated one.
    const result = await o.run({ prompt: 'Newest release of "commander"?', maxSteps: 3, maxUrls: 3 });
    assert.equal(result.degraded, false, JSON.stringify(result).slice(0, 300));
    assert.deepEqual(result.evidence, [{ url: PKG, snippet: true }]);
    const synthesis = seenPrompts.find((p) => p.includes('--- Source:'));
    assert.match(synthesis, /search-result snippet; the page itself could not be fetched/);
    assert.match(result.answer, /15\.0\.0/);
    assert.doesNotMatch(result.answer, /Provenance warning/);
    assert.deepEqual(result.provenance, { checked: true, unverified: [] });
  });
});

// ── D3: Vercel Security Checkpoint ───────────────────────────────────────────

describe('D3: a Vercel Security Checkpoint is a blocked result', () => {
  test('the checkpoint title names the vendor', () => {
    const hit = detectChallengePage({ title: 'Vercel Security Checkpoint' });
    assert.equal(hit?.vendor, 'vercel');
  });

  test('the challenge script on a short page names the vendor', () => {
    const hit = detectChallengePage({
      title: 'lesswrong.com',
      html: '<html><body><script src="/_vercel/challenge/v1.js"></script><p>Verifying your browser</p></body></html>',
      text: 'Verifying your browser'
    });
    assert.equal(hit?.vendor, 'vercel');
  });

  test('a real page about Vercel is not a challenge', () => {
    assert.equal(detectChallengePage({ title: 'Vercel Documentation', html: '<p>Deploy in seconds</p>', text: 'Deploy in seconds. '.repeat(100) }), null);
  });

  test('_waitOutChallenge waits only while the page is the interstitial', async () => {
    const manager = new StealthBrowserManager();
    const calls = [];
    const page = (title) => ({
      title: async () => title,
      waitForFunction: async (...args) => { calls.push(['waitForFunction', args[1]]); },
      waitForLoadState: async (state) => { calls.push(['waitForLoadState', state]); }
    });
    await manager._waitOutChallenge(page('Vercel Security Checkpoint'), { timeoutMs: 10 });
    assert.deepEqual(calls, [['waitForFunction', 'Vercel Security Checkpoint'], ['waitForLoadState', 'domcontentloaded']]);
    calls.length = 0;
    await manager._waitOutChallenge(page('LessWrong'), { timeoutMs: 10 });
    assert.deepEqual(calls, [], 'a real page is not waited on');
  });
});

// ── D4 / D7: stealth browsers are parked per engine; workers are spoofed ────

const fakeBrowser = (engine) => {
  const browser = {
    engine,
    closed: false,
    newContextOptions: [],
    isConnected: () => !browser.closed,
    close: async () => { browser.closed = true; },
    process: () => null,
    newContext: async (options) => {
      browser.newContextOptions.push(options);
      return fakeContext();
    }
  };
  return browser;
};

function fakeContext() {
  const initScripts = [];
  const target = { initScripts };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'then') return undefined;
      if (prop === 'addInitScript') return async (fn, arg) => { initScripts.push({ fn, arg }); };
      return async () => [];
    }
  });
}

function stubLaunch(manager) {
  manager._doLaunchStealthBrowser = async (config) => {
    const browser = fakeBrowser(config.engine);
    manager.browser = browser;
    manager._launchedEngine = config.engine;
    return browser;
  };
  return manager;
}

describe('D4: an engine switch parks the running browser instead of closing it', () => {
  test('each engine keeps its own browser; cleanup closes both', async () => {
    const manager = stubLaunch(new StealthBrowserManager());
    const chromiumBrowser = await manager.launchStealthBrowser({ engine: 'chromium' });
    const camoufoxBrowser = await manager.launchStealthBrowser({ engine: 'camoufox' });
    assert.notEqual(camoufoxBrowser, chromiumBrowser);
    assert.equal(chromiumBrowser.closed, false, 'chromium stays alive for its contexts');

    const again = await manager.launchStealthBrowser({ engine: 'chromium' });
    assert.equal(again, chromiumBrowser, 'switching back reuses the parked browser');
    assert.equal(camoufoxBrowser.closed, false, 'camoufox is parked in turn');

    await manager.cleanup();
    assert.ok(chromiumBrowser.closed && camoufoxBrowser.closed, 'cleanup closes every parked browser');
    assert.equal(manager._launchedEngine, null);
  });

  test('a parked browser that died is relaunched, not handed back', async () => {
    const manager = stubLaunch(new StealthBrowserManager());
    const chromiumBrowser = await manager.launchStealthBrowser({ engine: 'chromium' });
    await manager.launchStealthBrowser({ engine: 'camoufox' });
    chromiumBrowser.closed = true;
    const fresh = await manager.launchStealthBrowser({ engine: 'chromium' });
    assert.notEqual(fresh, chromiumBrowser);
    assert.equal(fresh.engine, 'chromium');
    await manager.cleanup();
  });
});

describe('D7: the worker vantage point is covered', () => {
  test('chromium contexts block service workers and wrap Worker at the advanced level', async () => {
    const manager = stubLaunch(new StealthBrowserManager());
    const { context } = await manager.createStealthContext({ engine: 'chromium', level: 'advanced' });
    assert.equal(manager.browser.newContextOptions[0].serviceWorkers, 'block');
    const wrapper = context.initScripts.find((s) => typeof s.fn === 'function' && s.fn.toString().includes('NativeWorker'));
    assert.ok(wrapper, 'a Worker-wrapping init script is installed');
    assert.equal(wrapper.arg.hardware.hardwareConcurrency > 0, true, 'the wrapper receives the spoofed hardware');
    await manager.cleanup();
  });

  test('the medium level leaves Worker alone', async () => {
    const manager = stubLaunch(new StealthBrowserManager());
    const { context } = await manager.createStealthContext({ engine: 'chromium', level: 'medium' });
    assert.ok(!context.initScripts.some((s) => s.fn.toString().includes('NativeWorker')));
    await manager.cleanup();
  });

  test('camoufox contexts get neither option: Firefox rejects them and spoofs workers itself', async () => {
    const manager = stubLaunch(new StealthBrowserManager());
    const { context } = await manager.createStealthContext({ engine: 'camoufox', level: 'advanced' });
    assert.ok(!('serviceWorkers' in manager.browser.newContextOptions[0]));
    assert.ok(!context.initScripts.some((s) => s.fn.toString().includes('NativeWorker')));
    await manager.cleanup();
  });
});

// ── D5: timezone offset is measured against UTC ──────────────────────────────

describe('D5: getTimezoneOffset is the zone\'s own offset, whatever the host zone', () => {
  const manager = new LocalizationManager();
  test('Sao Paulo, Tokyo, Kolkata and UTC', () => {
    assert.equal(manager.getTimezoneOffset('America/Sao_Paulo'), -180);
    assert.equal(manager.getTimezoneOffset('Asia/Tokyo'), 540);
    assert.equal(manager.getTimezoneOffset('Asia/Kolkata'), 330);
    assert.equal(manager.getTimezoneOffset('UTC'), 0);
  });
});

// ── D6: page titles never include inline SVG titles ──────────────────────────

describe('D6: pageTitle reads the head title only', () => {
  test('inline <svg><title> elements in the body are ignored', () => {
    const $ = load('<html><head><title> Roc — a fast, friendly, functional language </title></head><body><a><svg><title>GitHub</title></svg></a><svg><title>YouTube</title></svg></body></html>');
    assert.equal(pageTitle($), 'Roc — a fast, friendly, functional language');
  });

  test('a fragment without a head falls back to its first <title>', () => {
    const $ = load('<div><title>Only title</title><svg><title>Icon</title></svg></div>', null, false);
    assert.equal(pageTitle($), 'Only title');
  });

  test('no title at all is an empty string', () => {
    assert.equal(pageTitle(load('<html><body><p>x</p></body></html>')), '');
  });
});

// ── G1: extract_structured keeps the page head beside a long article ─────────

describe('G1: shownText keeps the page head when the main content fills the budget', () => {
  const sentence = 'Swift is a general-purpose programming language built using a modern approach to safety, performance, and software design patterns. ';
  const html = `<html><head><title>Swift.org - Welcome to Swift.org</title></head><body>
    <nav><a href="/install/">Install (6.3.3)</a><a href="/docs/">Documentation</a></nav>
    <main><article><h1>Swift 6.3.2 Released</h1><p>${sentence.repeat(220)}</p></article></main>
    <footer>Privacy Policy</footer></body></html>`;

  test('the article leads and the head of the whole page follows, within budget', () => {
    const $ = load(html);
    const textContent = $('body').text().replace(/\s+/g, ' ').trim();
    const shown = shownText($, html, 'https://swift.org/', textContent);
    assert.ok(shown.length <= 24000, `budget kept, got ${shown.length}`);
    assert.match(shown, /Install \(6\.3\.3\)/, 'the nav release is in view');
    assert.ok(shown.indexOf('Install (6.3.3)') > shown.indexOf('Swift 6.3.2 Released'), 'main content first');
  });

  test('a page that fits is shown whole, main content first', () => {
    const short = html.replace(sentence.repeat(220), sentence.repeat(10));
    const $ = load(short);
    const textContent = $('body').text().replace(/\s+/g, ' ').trim();
    const shown = shownText($, short, 'https://swift.org/', textContent);
    assert.ok(shown.endsWith(textContent), 'the whole page text follows');
    assert.match(shown, /Privacy Policy/);
  });
});

// ── G2 / G3: non-English analysis ────────────────────────────────────────────

describe('G2: sentence splitting and keywords outside English', () => {
  const analyzer = new ContentAnalyzer();
  const hindi = 'भारत एक विशाल देश है। भारत की राजधानी नई दिल्ली है। दिल्ली में लाल किला है॥ भारत में अनेक भाषाएँ बोली जाती हैं। भारत का इतिहास प्राचीन है।';
  const finnish = 'Helsinki on Suomen pääkaupunki. Helsinki sijaitsee Suomenlahden rannalla. Suomen suurin kaupunki on Helsinki. Helsingin yliopisto on Suomen vanhin yliopisto.';
  const japanese = '価格.comは、様々な製品の価格を比較できます。価格を比較して、製品を選びます。製品の価格です。価格の比較をします。';

  test('the Devanagari danda ends a sentence', () => {
    assert.equal(splitSentences(hindi).length, 5);
  });

  test('needsSegmentedTerms is decided by language, then by script', () => {
    assert.equal(analyzer.needsSegmentedTerms(hindi, { detectedLanguage: 'hin' }), true);
    assert.equal(analyzer.needsSegmentedTerms(hindi, {}), true, 'Devanagari without a language code');
    assert.equal(analyzer.needsSegmentedTerms(finnish, { detectedLanguage: 'fin' }), true);
    assert.equal(analyzer.needsSegmentedTerms(finnish, {}), false, 'Latin script with no language code stays on the English matcher');
    assert.equal(analyzer.needsSegmentedTerms('The quick brown fox jumps over the lazy dog.', { detectedLanguage: 'eng' }), false);
  });

  test('Hindi and Finnish keywords are single words, not clauses', async () => {
    for (const [text, lang, want] of [[hindi, 'hin', 'भारत'], [finnish, 'fin', 'helsinki']]) {
      const keywords = await analyzer.extractKeywords(text, { detectedLanguage: lang, maxKeywords: 10 });
      const words = keywords.map((k) => k.keyword);
      assert.ok(words.length > 0, `${lang}: no keywords`);
      assert.ok(words.every((w) => !/\s/.test(w)), `${lang}: clause returned as a keyword: ${JSON.stringify(words)}`);
      assert.equal(words[0], want, `${lang}: ${JSON.stringify(words)}`);
    }
  });

  test('Japanese particles and auxiliaries are not keywords', async () => {
    const keywords = await analyzer.extractKeywords(japanese, { maxKeywords: 10 });
    const words = keywords.map((k) => k.keyword);
    assert.equal(words[0], '価格', JSON.stringify(words));
    for (const particle of ['ます', 'です', 'して', 'こと']) {
      assert.ok(!words.includes(particle), `${particle} in ${JSON.stringify(words)}`);
    }
  });
});

describe('G3: CJK script detection tests kana and hangul before ideographs', () => {
  const manager = new LocalizationManager();
  const detect = async (content) => {
    const detection = { detectedScript: null, isRTL: false, confidence: 0, evidence: [] };
    await manager.performScriptDetection(content, detection);
    return detection.detectedScript;
  };

  test('Japanese, Korean and Chinese samples', async () => {
    assert.equal(await detect('東京の天気は晴れです。価格を比較します。'), 'japanese');
    assert.equal(await detect('서울의 날씨는 맑습니다. 漢字도 있습니다.'), 'korean');
    assert.equal(await detect('北京的天气很好。价格比较。'), 'chinese');
  });
});

/**
 * Regressions from the R24 live sweep (LIVE_TEST_R24_FIX_PLAN.md, Phase 2):
 *
 *   2.1  localization configure_country and stealth_mode configure read as if
 *        they set something for later calls. Neither does; the descriptions,
 *        results and hints now say the values are returned for the caller to
 *        pass on, and name the parameters that take them.
 *   2.2  fetch_url and scrape sent an empty `Accept-Language:` line. The
 *        guarded dispatcher now leaves the header out.
 *   2.3  camoufox dropped stealthConfig.customUserAgent, and a locale that
 *        differed from the launched one, without a word.
 *   2.9  localization: DST ignored, a 2021 Chrome UA in place of the caller's,
 *        0,0 coordinates, language "klingon" accepted, lower-case country
 *        codes and CH refused, an error naming a non-existent operation.
 *   2.10 stealth_mode enable/disable changed hidden defaults for every later
 *        caller and get_stats carried counters nothing incremented.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/r24-localization-stealth.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { fetchUrlHandler } = await import('../../src/tools/basic/fetchUrl.js');
const { fetchAndParse } = await import('../../src/tools/extract/_fetchAndParse.js');
const { dropEmptyAcceptLanguage } = await import('../../src/utils/ssrfGuard.js');
const { LocalizationManager } = await import('../../src/core/LocalizationManager.js');
const { StealthBrowserManager, camoufoxConfigWarnings } = await import('../../src/core/StealthBrowserManager.js');

const serverSource = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');

// ── 2.2: no empty Accept-Language on the wire ────────────────────────────────

describe('2.2 — the Accept-Language header a page fetch sends', () => {
  let server;
  let baseUrl;
  const seen = [];

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url !== '/robots.txt') seen.push(req.rawHeaders);
      res.writeHead(req.url === '/robots.txt' ? 404 : 200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>t</title></head><body><p>hello</p></body></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  const names = (rawHeaders) => rawHeaders.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase());
  const valueOf = (rawHeaders, name) => rawHeaders[rawHeaders.findIndex((n, i) => i % 2 === 0 && n.toLowerCase() === name) + 1];

  test('fetch_url sends no Accept-Language header by default', async () => {
    seen.length = 0;
    const result = await fetchUrlHandler({ url: `${baseUrl}/a` });
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.equal(seen.length, 1);
    assert.ok(!names(seen[0]).includes('accept-language'), `sent: ${JSON.stringify(seen[0])}`);
    assert.ok(names(seen[0]).includes('user-agent'));
  });

  test('scrape\'s fetch (fetchAndParse) sends none either', async () => {
    seen.length = 0;
    await fetchAndParse(`${baseUrl}/b`, { tool: 'scrape' });
    assert.equal(seen.length, 1);
    assert.ok(!names(seen[0]).includes('accept-language'), `sent: ${JSON.stringify(seen[0])}`);
  });

  test('a caller\'s Accept-Language in fetch_url headers is sent as given', async () => {
    seen.length = 0;
    await fetchUrlHandler({ url: `${baseUrl}/c`, headers: { 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8' } });
    assert.equal(valueOf(seen[0], 'accept-language'), 'ja-JP,ja;q=0.9,en;q=0.8');
  });

  test('the interceptor drops only an EMPTY Accept-Language', () => {
    const sent = [];
    const dispatch = dropEmptyAcceptLanguage((opts) => { sent.push(opts.headers); return true; });
    dispatch({ headers: { 'Accept-Language': '', 'User-Agent': 'x' } }, null);
    dispatch({ headers: { 'accept-language': 'de-DE', 'User-Agent': 'x' } }, null);
    assert.deepEqual(sent[0], { 'User-Agent': 'x' });
    assert.deepEqual(sent[1], { 'accept-language': 'de-DE', 'User-Agent': 'x' });
  });
});

// ── 2.9: localization leftovers ──────────────────────────────────────────────

describe('2.9 — LocalizationManager', () => {
  const manager = new LocalizationManager();
  after(() => manager.cleanup());

  test('the timezone offset follows daylight time', () => {
    assert.equal(manager.getTimezoneOffset('America/New_York', new Date('2026-10-03T12:00:00Z')), -240);
    assert.equal(manager.getTimezoneOffset('America/New_York', new Date('2026-01-15T12:00:00Z')), -300);
    assert.equal(manager.getTimezoneOffset('Europe/Berlin', new Date('2026-07-01T12:00:00Z')), 120);
    assert.equal(manager.getTimezoneOffset('Asia/Tokyo', new Date('2026-07-01T12:00:00Z')), 540);
  });

  test('generate_timezone_spoof embeds the offset in force today, not a fixed winter one', async () => {
    const script = await manager.generateTimezoneSpoof('US');
    const expected = manager.getTimezoneOffset('America/New_York');
    assert.match(script, new RegExp(`const timezoneOffset = ${expected};`));
  });

  test('localize_browser keeps the caller\'s user agent and invents none', async () => {
    const kept = await manager.localizeBrowserContext({ userAgent: 'MyUA/1.0' }, 'JP');
    assert.equal(kept.userAgent, 'MyUA/1.0');
    const none = await manager.localizeBrowserContext({}, 'JP');
    assert.equal('userAgent' in none, false);
    assert.doesNotMatch(JSON.stringify(none), /Chrome\/91/);
  });

  test('localize_browser has real coordinates for every supported country', async () => {
    for (const code of manager.getSupportedCountries()) {
      const { geolocation } = await manager.localizeBrowserContext({}, code);
      assert.ok(geolocation, `no coordinates for ${code}`);
      assert.ok(geolocation.latitude !== 0 || geolocation.longitude !== 0, `${code} is at 0,0`);
    }
  });

  test('localize_browser headers never make a cross-origin request preflighted', async () => {
    // extraHTTPHeaders go on every request. A forced Cache-Control turned each
    // CORS fetch into a preflighted one, which a server answering no OPTIONS
    // (challenges.cloudflare.com) refuses — the stealth headers' R24 bug.
    // Forbidden names (Fetch standard) are never counted; Accept-Language is
    // safelisted when its value is.
    const FORBIDDEN = new Set(['accept-encoding', 'dnt']);
    const LANGUAGE_VALUE = /^[0-9A-Za-z *,\-.;=]*$/;
    for (const code of manager.getSupportedCountries()) {
      const { extraHTTPHeaders } = await manager.localizeBrowserContext({}, code);
      for (const [name, value] of Object.entries(extraHTTPHeaders)) {
        const key = name.toLowerCase();
        const safe = FORBIDDEN.has(key) ||
          (key === 'accept-language' && value.length <= 128 && LANGUAGE_VALUE.test(value));
        assert.ok(safe, `${code}: ${name}: ${value} would preflight every cross-origin CORS fetch`);
      }
    }
    assert.equal('Cache-Control' in manager.generateLocalizedHeaders('JP'), false);
  });

  test('configure_country refuses a language that is not a language code', async () => {
    await assert.rejects(() => manager.configureCountry('DE', { language: 'klingon' }), /Unsupported language: klingon/);
    for (const language of ['de', 'de-CH', 'zh-Hans-CN', 'EN-gb']) {
      await assert.doesNotReject(() => manager.configureCountry('DE', { language }), language);
    }
  });

  test('a lower-case country code is accepted, as the tool passes it', async () => {
    // server.js hands its whole params object over as options, countryCode included.
    const result = await manager.configureCountry('jp', { countryCode: 'jp' });
    assert.equal(result.countryCode, 'JP');
    assert.equal(result.acceptLanguage, 'ja-JP,ja;q=0.9,en;q=0.8');
    const browser = await manager.localizeBrowserContext({}, 'jp');
    assert.equal(browser.locale, 'ja-JP');
    assert.ok(browser.geolocation.latitude > 30);
  });

  test('CH is supported', async () => {
    const result = await manager.configureCountry('CH');
    assert.equal(result.timezone, 'Europe/Zurich');
    assert.equal(result.currency, 'CHF');
    assert.equal(result.language, 'de-CH');
    assert.equal(result.browserLocale.dateFormat, 'DD.MM.YYYY');
    assert.ok(manager.getSupportedCountries().includes('CH'));
  });

  test('a supplied acceptLanguage is the one returned', async () => {
    const result = await manager.configureCountry('DE', { acceptLanguage: 'en-GB,en;q=0.7' });
    assert.equal(result.acceptLanguage, 'en-GB,en;q=0.7');
  });

  test('the handle_geo_blocking error names handle_geo_blocking', () => {
    assert.match(serverSource, /url and response are required for handle_geo_blocking operation/);
    assert.doesNotMatch(serverSource, /detect_geo_blocking/);
  });
});

// ── 2.1: values-only, said in the text a model reads ─────────────────────────

describe('2.1 — localization and stealth configure promise no persistence', () => {
  const block = (name) => {
    const start = serverSource.indexOf(`registerToolIfEnabled("${name}"`);
    return serverSource.slice(start, serverSource.indexOf('registerToolIfEnabled(', start + 1));
  };

  test('the localization description says it applies nothing and names the parameters', () => {
    const text = block('localization');
    assert.doesNotMatch(text, /set country context/);
    assert.match(text, /returns values and applies none/);
    assert.match(text, /fetch_url headers:\{\\"Accept-Language\\": acceptLanguage\}/);
    assert.match(text, /stealth_mode stealthConfig:\{locale: language, timezone: timezone\}/);
    // The configure_country result carries the same instruction.
    assert.match(text, /note: 'These values are returned, not applied/);
  });

  test('stealth configure says it stores nothing', () => {
    const text = block('stealth_mode');
    assert.match(text, /it stores nothing/);
    assert.match(text, /note: 'Validated only - nothing is stored/);
  });
});

// ── 2.3: camoufox says what it did not apply ─────────────────────────────────

describe('2.3 — camoufoxConfigWarnings', () => {
  test('nothing to say for a default call on the launched locale', () => {
    assert.deepEqual(camoufoxConfigWarnings({ locale: 'en-US' }, { launchedLocale: 'en-US', proxied: false }), []);
  });

  test('customUserAgent and customViewport are named', () => {
    const warnings = camoufoxConfigWarnings(
      { locale: 'en-US', customUserAgent: 'X/1', customViewport: { width: 1000, height: 700 } },
      { launchedLocale: 'en-US', proxied: false }
    );
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /customUserAgent is not applied on camoufox/);
    assert.match(warnings[1], /customViewport is not applied on camoufox/);
  });

  test('a locale other than the launched one is named, with the way out', () => {
    const [warning, ...rest] = camoufoxConfigWarnings({ locale: 'de-DE', timezone: 'Europe/Berlin' }, { launchedLocale: 'ja-JP', proxied: false });
    assert.match(warning, /locale "de-DE" is not applied/);
    assert.match(warning, /launched with "ja-JP"/);
    assert.match(warning, /operation:"cleanup"/);
    // Without a proxy the timezone IS applied, per context.
    assert.equal(rest.length, 0);
  });

  test('behind a proxy the exit IP decides locale and timezone', () => {
    const warnings = camoufoxConfigWarnings({ locale: 'de-DE', timezone: 'Europe/Berlin' }, { launchedLocale: null, proxied: true });
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /locale "de-DE" is not applied on camoufox behind a proxy/);
    assert.match(warnings[1], /timezone "Europe\/Berlin" is not applied on camoufox behind a proxy/);
    // The schema's default locale is not a request.
    assert.deepEqual(camoufoxConfigWarnings({ locale: 'en-US' }, { launchedLocale: null, proxied: true }), []);
  });
});

// ── 2.10: no hidden switches, no dead counters ───────────────────────────────

describe('2.10 — stealth_mode enable/disable and get_stats', () => {
  test('enable and disable are gone from the tool and the manager', () => {
    const start = serverSource.indexOf('registerToolIfEnabled("stealth_mode"');
    const text = serverSource.slice(start, serverSource.indexOf('registerToolIfEnabled("localization"'));
    assert.match(text, /z\.enum\(\['scrape', 'configure', 'create_context', 'create_page', 'get_stats', 'cleanup'\]\)/);
    assert.doesNotMatch(text, /case 'enable'|case 'disable'/);
    const manager = new StealthBrowserManager();
    assert.equal(typeof manager.enableStealthMode, 'undefined');
    assert.equal(typeof manager.disableStealthMode, 'undefined');
  });

  test('get_stats reports live state only', () => {
    const stats = new StealthBrowserManager().getStats();
    assert.deepEqual(Object.keys(stats).sort(), ['activeContexts', 'browserRunning', 'humanBehaviorActive', 'proxyStatus', 'totalFingerprintsSaved']);
  });
});

/**
 * Phase 1 verdict regressions (2026-09-21).
 *
 * The 2026-09 stealth benchmark (docs/STEALTH_REVIEW_2026-09.md, finding 6)
 * measured a false block: quora.com rendered its real login page on both
 * engines — correct title, 397 visible characters — and the verdict layer
 * reported it Blocked, because that login wall legitimately embeds a
 * Cloudflare Turnstile widget and upstream treats a vendor marker on a page
 * under 4000 characters as definitive. The R15 regression only covers the
 * *long* real page, which the 4000-character rule already handles.
 *
 * So: a widget embed is not an interstitial, and the difference is in the
 * document — a wall carries Cloudflare's challenge bootstrap or its prose.
 * These cases pin the distinction, that it reaches stealthDocumentVerdict (the
 * verdict the tools and the benchmark print), and that every true positive the
 * review named survives it.
 *
 * The fixture below is the REAL document, re-measured against the live page on
 * 2026-09-21: a 397-character body and three Turnstile tokens, one of which —
 * the hidden input "cf-chl-widget-gaztz_response" — is why a bare cf-chl- test
 * cannot be used to recognise an interstitial.
 *
 * Run: node --test --test-force-exit tests/unit/challengeVerdictPhase1.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectChallengePage, looksLikeInterstitial } from '../../src/utils/challengeDetection.js';
import { stealthDocumentVerdict } from '../../src/utils/stealthVerdict.js';

// The shape quora.com came back as: a real title, a real (short) login page,
// and the three tokens a Turnstile widget puts in the page it is embedded in.
const QUORA_TITLE = 'Quora - A place to share knowledge and better understand the world';
const QUORA_TEXT =
  'Quora is a place to gain and share knowledge. It is a platform to ask questions and connect with people ' +
  'who contribute unique insights and quality answers. Continue with Google. Continue with Facebook. ' +
  'Sign up with email. By continuing you indicate that you agree to the Quora Terms of Service and Privacy ' +
  'Policy. Already have an account? Login. About Careers Privacy Terms Contact Languages 2026.';
// The widget's own markup, verbatim: script host, container class, and the
// hidden response input whose id starts with cf-chl-widget-.
const TURNSTILE_WIDGET_MARKUP =
  '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' +
  '<div class="cf-turnstile" data-sitekey="0x4AAAAAAADnPIDROrmt1Wwj"></div>' +
  '<input type="hidden" name="cf-turnstile-response" id="cf-chl-widget-gaztz_response">';
const QUORA = {
  url: 'https://www.quora.com/',
  status: 200,
  title: QUORA_TITLE,
  text: QUORA_TEXT,
  html:
    `<html><head><title>${QUORA_TITLE}</title></head>` +
    `<body><form class="signup">${TURNSTILE_WIDGET_MARKUP}<p>${QUORA_TEXT}</p></form></body></html>`
};

// A real Cloudflare interstitial: the bootstrap, the prose, a body of 43
// characters, and — on nowsecure.nl — a title that is not a known challenge
// title at all. A managed challenge embeds a Turnstile widget of its own, so
// the same three widget tokens are on this document too.
const NOWSECURE_TEXT = 'Verifying you are human. Please wait a bit.';
const NOWSECURE = {
  url: 'https://nowsecure.nl/',
  status: 200,
  title: 'nowsecure.nl',
  text: NOWSECURE_TEXT,
  html:
    `<html><head><title>nowsecure.nl</title></head><body>${TURNSTILE_WIDGET_MARKUP}` +
    `<p>${NOWSECURE_TEXT}</p>` +
    '<script>window._cf_chl_opt={cvId:"3",cType:"managed",cRay:"8d1"};</script></body></html>'
};

describe('Phase 1: a widget embed is not an interstitial', () => {
  test('the fixture is the document that was measured: 397 characters, three widget tokens', () => {
    assert.equal(QUORA.text.length, 397);
    assert.ok(QUORA.text.length < 4000, 'the case must exercise the short-page rule');
    assert.match(QUORA.html, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
    assert.match(QUORA.html, /class="cf-turnstile"/);
    assert.match(QUORA.html, /id="cf-chl-widget-gaztz_response"/);
    // The collision that made the first fix miss: this is the page's only
    // cf-chl- token, and the widget put it there.
    assert.deepEqual(QUORA.html.match(/cf-chl-[a-z0-9_-]*/gi), ['cf-chl-widget-gaztz_response']);
    assert.doesNotMatch(QUORA.html, /_cf_chl_opt|window\._cf_chl|cf_chl_rc_/);
  });

  test('a real page whose only evidence is the Turnstile widget is not a block', () => {
    assert.equal(detectChallengePage(QUORA), null);
  });

  test('a short page carrying the challenge bootstrap is a block, widget and all', () => {
    assert.equal(NOWSECURE.text.length, 43);
    const hit = detectChallengePage(NOWSECURE);
    assert.equal(hit?.vendor, 'cloudflare');
  });

  test('the same widget markup on a 43-character body is a block with no bootstrap at all', () => {
    const wall = {
      url: 'https://nowsecure.nl/',
      status: 200,
      title: 'nowsecure.nl',
      text: NOWSECURE_TEXT,
      html: `<html><head><title>nowsecure.nl</title></head><body>${TURNSTILE_WIDGET_MARKUP}<p>${NOWSECURE_TEXT}</p></body></html>`
    };
    assert.doesNotMatch(wall.html, /_cf_chl_opt|window\._cf_chl|cf_chl_rc_/);
    assert.equal(looksLikeInterstitial(wall), null, 'nothing but widget tokens to go on');
    // The short body carries it: 43 characters is not a page.
    assert.equal(detectChallengePage(wall)?.vendor, 'cloudflare');
    assert.equal(stealthDocumentVerdict(wall).success, false);
  });

  test('"Just a moment..." is a block whatever else is on the page', () => {
    assert.equal(detectChallengePage({ title: 'Just a moment...', html: '', text: '' })?.vendor, 'cloudflare');
    const withBody = detectChallengePage({
      title: 'Just a moment...',
      html: '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>',
      text: QUORA_TEXT
    });
    assert.equal(withBody?.vendor, 'cloudflare');
  });

  test('the interstitial prose is a block even with a real title and a long-enough body', () => {
    const prose =
      'www.example.com needs to review the security of your connection before proceeding. ' +
      'Ray ID: 8d1f0c2ab. Performance & security by Cloudflare. '.repeat(3);
    const hit = detectChallengePage({
      title: 'Example Shop — Home',
      html: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script><p>${prose}</p>`,
      text: prose
    });
    assert.equal(hit?.vendor, 'cloudflare');
  });

  test('a widget on a page with no body text is still a block', () => {
    const hit = detectChallengePage({
      title: 'Sign in',
      html: '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>',
      text: ''
    });
    assert.equal(hit?.vendor, 'cloudflare');
  });

  test('the other vendors are untouched: Amazon, DataDome, Vercel, Akamai', () => {
    const amazon = '<form method="get" action="/errors/validateCaptcha"></form>' + '<p>x</p>'.repeat(2000);
    assert.equal(detectChallengePage({ title: 'Amazon.de', html: amazon, text: 'x '.repeat(3000) })?.vendor, 'amazon');
    assert.equal(
      detectChallengePage({ title: 'g2.com', html: '<iframe src="https://geo.captcha-delivery.com/captcha/"></iframe>', text: '' })?.vendor,
      'datadome'
    );
    assert.equal(detectChallengePage({ title: 'Vercel Security Checkpoint' })?.vendor, 'vercel');
    assert.equal(
      detectChallengePage({ title: 'lesswrong.com', html: '<script src="/_vercel/challenge/v1.js"></script>', text: 'Verifying your browser' })?.vendor,
      'vercel'
    );
    assert.equal(detectChallengePage({ title: 'Access Denied', html: '', text: '' })?.vendor, 'akamai');
  });
});

describe('Phase 1: looksLikeInterstitial ignores the title and the length', () => {
  test('a custom-titled page carrying the bootstrap is an interstitial', () => {
    const hit = looksLikeInterstitial(NOWSECURE);
    assert.equal(hit?.vendor, 'cloudflare');
    assert.match(hit.evidence, /bootstrap/);
  });

  test('a known challenge title alone is an interstitial', () => {
    assert.equal(looksLikeInterstitial({ title: 'Just a moment...' })?.vendor, 'cloudflare');
    assert.equal(looksLikeInterstitial({ title: 'Vercel Security Checkpoint' })?.vendor, 'vercel');
  });

  test('the bootstrap counts on a long page too — length is not the test', () => {
    const hit = looksLikeInterstitial({
      title: 'shop.example.com',
      html: '<script>window._cf_chl_opt={cvId:"3"};</script>' + '<p>filler</p>'.repeat(2000),
      text: 'filler '.repeat(2000)
    });
    assert.equal(hit?.vendor, 'cloudflare');
  });

  test('cf-chl-widget- is the widget\'s own id, not a bootstrap marker', () => {
    assert.equal(looksLikeInterstitial({ title: 'Sign in', html: '<input id="cf-chl-widget-gaztz_response">' }), null);
    // Any other cf-chl- id still is one: only the widget's is excluded.
    assert.equal(looksLikeInterstitial({ title: 'Sign in', html: '<div id="cf-chl-container"></div>' })?.vendor, 'cloudflare');
  });

  test('an ordinary page, and a page that only embeds the widget, are not interstitials', () => {
    assert.equal(looksLikeInterstitial({ title: 'Web form', html: '<h1>Web form</h1>', text: 'Web form Text input' }), null);
    assert.equal(looksLikeInterstitial(QUORA), null);
  });

  test('it takes a page object and tolerates an empty one', () => {
    assert.equal(looksLikeInterstitial(), null);
    assert.equal(looksLikeInterstitial({}), null);
  });
});

describe('Phase 1: the refinement reaches stealthDocumentVerdict', () => {
  test('the Quora shape is a success, not a block', () => {
    const v = stealthDocumentVerdict(QUORA, { fetcher: 'the stealth browser' });
    assert.deepEqual(v, { success: true, status: 200 });
  });

  test('the plain-fetch call signature reaches the same verdict', () => {
    const v = stealthDocumentVerdict(QUORA, { fetcher: 'a plain fetch', rendered: false, contentReturned: false });
    assert.equal(v.success, true);
    assert.equal(v.blocked, undefined);
  });

  test('a real interstitial is still a block, with the vendor', () => {
    const v = stealthDocumentVerdict(NOWSECURE);
    assert.equal(v.success, false);
    assert.equal(v.blocked?.vendor, 'cloudflare');
    assert.match(v.error, /cloudflare served a challenge page/);
  });

  test('an HTTP error page that embeds the widget is still a failure, named as HTTP', () => {
    const v = stealthDocumentVerdict({ ...QUORA, status: 403, title: 'Forbidden', text: QUORA_TEXT });
    assert.equal(v.success, false);
    assert.equal(v.status, 403);
    assert.match(v.error, /HTTP 403/);
    assert.equal(v.blocked, undefined);
  });

  test('an empty shell is still a failure, with or without the widget', () => {
    const shell = stealthDocumentVerdict(
      { url: 'https://www.carvana.com/cars', status: 200, title: '', text: '', html: '<html><body></body></html>' },
      { waitedMs: 6000 }
    );
    assert.equal(shell.success, false);
    assert.match(shell.error, /no title and no text/);
    // A document with no title and no body is not a real page, so the widget
    // marker is not refined away: an empty shell carrying a challenge script
    // is a wall, and is still named as one.
    const withWidget = stealthDocumentVerdict(
      { url: 'https://www.quora.com/', status: 200, title: '', text: '', html: '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>' },
      { waitedMs: 6000 }
    );
    assert.equal(withWidget.success, false);
    assert.equal(withWidget.blocked?.vendor, 'cloudflare');
  });

  test('a short error-titled placeholder that embeds the widget is still a soft block', () => {
    const v = stealthDocumentVerdict({
      url: 'https://www.quora.com/',
      status: 200,
      title: 'Something went wrong',
      text: 'Please try again later. '.repeat(12),
      html: TURNSTILE_WIDGET_MARKUP
    });
    assert.equal(v.success, false);
    assert.match(v.error, /error page titled "Something went wrong"/);
  });
});

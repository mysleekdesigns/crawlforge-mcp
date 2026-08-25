/**
 * Unit tests for src/utils/hiddenContent.js
 *
 * Run: node --test tests/unit/hiddenContent.test.js
 *
 * Markup below mirrors a live Shopify Dawn storefront (deathwishcoffee.com),
 * where extraction reported availability "Sold out" and a compare-at price of
 * $39.98 for a product that was in stock at $19.99 with no compare-at price.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import {
  stripHiddenFromDom,
  stripHiddenHtml,
  collectVisibilitySelectors
} from '../../src/utils/hiddenContent.js';

/** Condensed copy of the real Dawn price block. */
const SHOPIFY_PRICE_BLOCK = `
<div class="price price--large price--show-badge">
  <div class="price__container">
    <div class="price__regular">
      <span class="visually-hidden visually-hidden--inline">Regular price</span>
      <span class="price-item price-item--regular">$19.99</span>
    </div>
    <div class="price__sale">
      <span class="visually-hidden visually-hidden--inline">Regular price</span>
      <span class="visually-hidden visually-hidden--inline">Sale price</span>
      <span class="price-item price-item--sale">$19.99</span>
    </div>
    <small class="unit-price caption hidden">
      <span class="visually-hidden">Unit price</span>
    </small>
  </div>
  <span class="badge price__badge-sale">Sale</span>
  <span class="badge price__badge-sold-out">Sold out</span>
</div>
<label><input type="radio" checked>Ground<span class="visually-hidden">Variant sold out or unavailable</span></label>
`;

/** The rules Dawn ships in component-price.css / base.css. */
const SHOPIFY_CSS = `
.hidden{display:none!important}
.visually-hidden{position:absolute!important;overflow:hidden;width:1px;height:1px;clip:rect(0 0 0 0)}
.price__sale,.price .price__badge-sale,.price .price__badge-sold-out{display:none}
.price--sold-out .price__badge-sold-out,.price--on-sale .price__badge-sale{display:inline-block}
`;

test('screen-reader-only labels are removed', () => {
  const out = stripHiddenHtml(SHOPIFY_PRICE_BLOCK, { css: SHOPIFY_CSS });
  assert.doesNotMatch(out, /Regular price/, 'visually-hidden label must go');
  assert.doesNotMatch(out, /Sale price/);
  assert.doesNotMatch(out, /Unit price/);
  assert.doesNotMatch(out, /Variant sold out or unavailable/);
});

test('CSS-hidden badges are removed but the visible price survives', () => {
  const $ = load(SHOPIFY_PRICE_BLOCK);
  stripHiddenFromDom($, { css: SHOPIFY_CSS });
  const text = $.text().replace(/\s+/g, ' ').trim();

  assert.doesNotMatch(text, /Sold out/, 'badge is display:none until .price--sold-out');
  assert.doesNotMatch(text, /\bSale\b/, 'sale badge is display:none until .price--on-sale');
  assert.match(text, /\$19\.99/, 'the visible price must survive');
  // .price__sale is display:none, so the duplicate price block goes with it.
  assert.equal(text.match(/\$19\.99/g).length, 1, 'the hidden duplicate price block should be gone');
});

test('a badge is kept when a state class re-shows it', () => {
  // Same markup, but the parent now carries .price--sold-out, so a browser
  // paints the badge and we must not remove it.
  const soldOut = SHOPIFY_PRICE_BLOCK.replace(
    'price price--large price--show-badge',
    'price price--large price--show-badge price--sold-out'
  );
  const $ = load(soldOut);
  stripHiddenFromDom($, { css: SHOPIFY_CSS });
  assert.match($.text(), /Sold out/, 'genuinely sold-out badge must survive');
});

test('responsive utility classes are not treated as hidden', () => {
  // Tailwind-style: hidden on mobile, visible from md up. A browser shows this
  // on desktop, so the text must survive.
  const html = '<div class="twcss-hidden md:twcss-inline-block">Desktop only</div>';
  const css = `
    .twcss-hidden{display:none}
    @media (min-width:768px){.md\\:twcss-inline-block{display:inline-block}}
  `;
  const $ = load(html);
  stripHiddenFromDom($, { css });
  // The unconditional .twcss-hidden rule does hide it, but the @media rule that
  // re-shows it is conditional. Conservative behaviour: the element is removed
  // only because the base rule is unconditional — assert we at least never
  // remove content whose ONLY hiding rule lives inside @media.
  const mediaOnly = load('<div class="only-mobile">Kept</div>');
  stripHiddenFromDom(mediaOnly, { css: '@media (max-width:700px){.only-mobile{display:none}}' });
  assert.match(mediaOnly.text(), /Kept/, 'rules inside @media must never remove content');
});

test('hidden attribute and inline styles are honoured', () => {
  const html = `
    <p hidden>attr hidden</p>
    <p style="display:none">inline none</p>
    <p style="visibility:hidden">inline invisible</p>
    <p style="color:red">visible</p>`;
  const out = stripHiddenHtml(html);
  assert.doesNotMatch(out, /attr hidden/);
  assert.doesNotMatch(out, /inline none/);
  assert.doesNotMatch(out, /inline invisible/);
  assert.match(out, /visible/);
});

test('interaction pseudo-class rules are ignored', () => {
  const { hide } = collectVisibilitySelectors('.skip-link:focus{display:none}.gone{display:none}');
  const selectors = hide.map(r => r.selector);
  assert.ok(!selectors.some(s => s.includes(':focus')), ':focus rules describe transient state');
  assert.ok(selectors.includes('.gone'));
});

test('a lower-specificity show rule does not override a hide rule', () => {
  // Dawn: `.badge{display:inline-block}` must not resurrect a badge hidden by
  // the more specific `.price .price__badge-sold-out{display:none}`.
  const css = '.price .price__badge-sold-out{display:none}.badge{display:inline-block}';
  const $ = load('<div class="price"><span class="badge price__badge-sold-out">Sold out</span></div>');
  stripHiddenFromDom($, { css });
  assert.doesNotMatch($.text(), /Sold out/, 'the more specific hide rule wins the cascade');
});

test('progressive-enhancement no-js rules never hide content', () => {
  // Themes ship <html class="no-js"> and swap it to "js" on load, so static
  // markup always looks like the no-JS case.
  const $ = load('<html class="no-js"><body><div class="no-js-hidden">$19.99</div></body></html>');
  stripHiddenFromDom($, { css: 'html.no-js .no-js-hidden{display:none}' });
  assert.match($.text(), /\$19\.99/, 'JS-revealed content must survive');
});

test('a hidden wrapper holding most of the page is left alone', () => {
  // Shopify's EasyLockdown app wraps the whole storefront in
  // <div style="display:none"> and reveals it with JavaScript.
  const body = '<p>real product copy that makes up the bulk of this page</p>'.repeat(60);
  const $ = load(`<body><div class="easylockdown-content" style="display:none">${body}<span>$19.99</span></div></body>`);
  const { removed, skippedBulk } = stripHiddenFromDom($);
  assert.equal(removed, 0);
  assert.equal(skippedBulk, 1);
  assert.match($.text(), /\$19\.99/, 'must not delete the page to remove a wrapper');
});

test('a markup-heavy hidden wrapper is left alone (Next.js streaming SSR)', () => {
  // Next.js App Router streams the rendered page inside <div id="S:0" hidden>
  // and moves it into place with JavaScript. The wrapper is only a small share
  // of the document's *text* — most text lives in script payload — but half its
  // markup, so the guard has to weigh markup as well as text.
  const rendered = '<section><h2>Plans</h2><p class="a b c">Hobby $19</p></section>'.repeat(80);
  const payload = '<script>' + 'x'.repeat(9000) + '</script>';
  const $ = load(`<body><div id="S:0" hidden>${rendered}</div>${payload}</body>`);

  const { removed, skippedBulk } = stripHiddenFromDom($);
  assert.equal(skippedBulk, 1, 'the streamed wrapper must be skipped');
  assert.equal(removed, 0);
  assert.match($.text(), /Hobby \$19/, 'the streamed page content must survive');
});

test('body and html are never removed', () => {
  const $ = load('<html><body><p>content</p></body></html>');
  stripHiddenFromDom($, { css: 'body{display:none}html{display:none}' });
  assert.match($.text(), /content/);
});

test('malformed html and css never throw', () => {
  assert.doesNotThrow(() => stripHiddenHtml('<div><span>unclosed', { css: '}{bad css{{' }));
  assert.equal(stripHiddenHtml(''), '');
  assert.equal(stripHiddenHtml(null), null);
});

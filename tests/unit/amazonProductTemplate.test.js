/**
 * Unit tests: the amazon-product template.
 *
 * Run: node --test tests/unit/amazonProductTemplate.test.js
 *
 * Regression (2026-08-25): against three live product pages the template
 * returned null for currency, rating, images and breadcrumbs, and returned
 * "Brand: Amazon" / "(198,594)" verbatim. The selectors it used — a
 * priceCurrency meta tag, #acrPopover .a-size-base, img.a-thumbnail-image —
 * do not exist on any current Amazon page; the fixtures had been written to
 * match the selectors rather than the site.
 *
 * Markup below is condensed from live captures (a first-party device, a
 * branded storefront and a book), which between them cover the three shapes
 * Amazon's byline, description and breadcrumb slots take.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TemplateRegistry } from '../../src/tools/templates/TemplateRegistry.js';

const registry = new TemplateRegistry();

const run = async (html) =>
  (await registry.run('amazon-product', `<html><body>${html}</body></html>`, 'https://www.amazon.com/dp/B000000000')).data;

describe('amazon-product byline', () => {
  test('a first-party device drops the "Brand:" label', async () => {
    assert.equal((await run('<a id="bylineInfo">Brand: Amazon</a>')).brand, 'Amazon');
  });

  test('a branded storefront drops the "Visit the ... Store" wrapper', async () => {
    assert.equal((await run('<a id="bylineInfo">Visit the Apple Store</a>')).brand, 'Apple');
  });

  test('a book byline yields the author, not the surrounding chrome', async () => {
    const html = `<div id="bylineInfo">by
        <span class="author"><a class="contributorNameID">Jonathan Haidt</a></span>
        (Author) Format: Hardcover</div>`;
    assert.equal((await run(html)).brand, 'Jonathan Haidt');
  });

  test('a book byline with no contributor link still loses the chrome', async () => {
    assert.equal((await run('<div id="bylineInfo">by Ursula K. Le Guin (Author)</div>')).brand, 'Ursula K. Le Guin');
  });

  test('an unrecognised byline is passed through rather than dropped', async () => {
    assert.equal((await run('<a id="bylineInfo">Acme Industries</a>')).brand, 'Acme Industries');
  });

  test('no byline is null', async () => {
    assert.equal((await run('<span id="productTitle">Thing</span>')).brand, null);
  });
});

describe('amazon-product rating and review count', () => {
  test('the rating comes off the popover title as a number', async () => {
    assert.equal((await run('<span id="acrPopover" title="4.7 out of 5 stars"></span>')).rating, 4.7);
  });

  test('the star icon is the fallback when the popover carries no title', async () => {
    const html = '<div id="averageCustomerReviews"><span class="a-icon-alt">4.6 out of 5 stars</span></div>';
    assert.equal((await run(html)).rating, 4.6);
  });

  test('a parenthesised review count becomes a number', async () => {
    // Live pages render "(198,594)" — previously returned verbatim.
    assert.equal((await run('<span id="acrCustomerReviewText">(198,594)</span>')).review_count, 198594);
  });

  test('the "N global ratings" wording parses to the same number', async () => {
    const html = '<span data-hook="total-review-count">198,594 global ratings</span>';
    assert.equal((await run(html)).review_count, 198594);
  });

  test('an unrated product reports null, not zero', async () => {
    const data = await run('<span id="productTitle">Thing</span>');
    assert.equal(data.rating, null);
    assert.equal(data.review_count, null);
  });
});

describe('amazon-product currency', () => {
  test('the ISO code comes off the add-to-cart form', async () => {
    // Amazon ships no priceCurrency meta tag on any current page.
    const html = '<input type="hidden" name="items[0.base][customerVisiblePrice][currencyCode]" value="USD">';
    assert.equal((await run(html)).currency, 'USD');
  });

  test('a schema.org meta tag is still honoured where present', async () => {
    assert.equal((await run('<meta itemprop="priceCurrency" content="GBP">')).currency, 'GBP');
  });
});

describe('amazon-product images', () => {
  const MAIN = 'https://m.media-amazon.com/images/I/61J2sQtBYDL._AC_SY300_SX300_QL70_.jpg';
  const THUMB = 'https://m.media-amazon.com/images/I/31vkCUuIWCL._AC_SR40,60_.jpg';
  const PIXEL = 'https://images-na.ssl-images-amazon.com/images/G/01/x-locale/common/transparent-pixel._V192234675_.gif';

  test('thumbnails are upsized to the original by dropping the size token', async () => {
    // Verified live 2026-08-25: the tokened URL is a 1KB thumbnail, the same
    // URL without it is the 16KB original.
    const data = await run(`<img id="landingImage" src="${MAIN}"><div id="altImages"><img src="${THUMB}"></div>`);
    assert.deepEqual(data.images, [
      'https://m.media-amazon.com/images/I/61J2sQtBYDL.jpg',
      'https://m.media-amazon.com/images/I/31vkCUuIWCL.jpg'
    ]);
  });

  test('the spacer gif padding the thumbnail strip is not an image', async () => {
    const data = await run(`<div id="altImages"><img src="${THUMB}"><img src="${PIXEL}"></div>`);
    assert.equal(data.images.length, 1);
  });

  test('the main image is not repeated when it also appears as a thumbnail', async () => {
    const data = await run(`<img id="landingImage" src="${MAIN}"><div id="altImages"><img src="${MAIN}"></div>`);
    assert.deepEqual(data.images, ['https://m.media-amazon.com/images/I/61J2sQtBYDL.jpg']);
  });

  test('a product with no gallery reports an empty list', async () => {
    assert.deepEqual((await run('<span id="productTitle">Thing</span>')).images, []);
  });
});

describe('amazon-product description', () => {
  test('feature bullets are joined without the surrounding markup chrome', async () => {
    const html = `<div id="feature-bullets"><ul>
      <li><span class="a-list-item">First   point.</span></li>
      <li><span class="a-list-item">Second point.</span></li>
    </ul><a href="#">› See more product details</a></div>`;
    assert.equal((await run(html)).description, 'First point. Second point.');
  });

  test('a book falls back to its own description container', async () => {
    // Books have neither #productDescription nor feature bullets.
    const html = '<div id="bookDescription_feature_div"><div class="a-expander-content"><p>A book\nabout books.</p></div></div>';
    assert.equal((await run(html)).description, 'A book about books.');
  });

  test('an explicit product description wins over the bullets', async () => {
    const html = `<div id="productDescription"><p>The full write-up.</p></div>
      <div id="feature-bullets"><ul><li><span class="a-list-item">A bullet.</span></li></ul></div>`;
    assert.equal((await run(html)).description, 'The full write-up.');
  });
});

describe('amazon-product page facts', () => {
  test('whitespace Amazon leaves in the title is collapsed', async () => {
    const data = await run('<span id="productTitle">\n   Echo Dot   (newest\n model)\n  </span>');
    assert.equal(data.title, 'Echo Dot (newest model)');
  });

  test('the availability blurb is not polluted by the JSON blob beside it', async () => {
    // #availability also contains an inline script on live pages.
    const html = '<div id="availability"><span>In Stock</span><script>{"asin":"B09B8V1LZ3"}</script></div>';
    assert.equal((await run(html)).availability, 'In Stock');
  });

  test('breadcrumbs are read where the page has them', async () => {
    const html = '<div id="wayfinding-breadcrumbs_feature_div"><a>Books</a><a>Parenting</a></div>';
    assert.deepEqual((await run(html)).category_breadcrumb, ['Books', 'Parenting']);
  });

  test('a device page with no breadcrumbs reports an empty list', async () => {
    // Not a defect: device pages genuinely ship no breadcrumb trail.
    assert.deepEqual((await run('<span id="productTitle">Echo Dot</span>')).category_breadcrumb, []);
  });
});

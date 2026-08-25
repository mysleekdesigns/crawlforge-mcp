/**
 * Unit tests: the shopify-product template.
 *
 * Run: node --test tests/unit/shopifyProductTemplate.test.js
 *
 * The template reads a store's own /products/<handle>.json rather than the
 * rendered page. Scraping the DOM for this data went wrong repeatedly:
 * Shopify's Dawn theme ships every price badge unconditionally and hides them
 * in CSS, so extraction reported "Sold out" for a product with stock, and an
 * LLM asked for a compare-at price invented one for a product that has none.
 *
 * Payload shapes below are condensed from live responses captured 2026-08-25
 * (deathwishcoffee.com and allbirds.com), including the two ways stores write
 * an absent compare-at price and the two ways they write tags.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TemplateRegistry } from '../../src/tools/templates/TemplateRegistry.js';

const registry = new TemplateRegistry();
const template = registry.get('shopify-product');

const variant = (over = {}) => ({
  id: 1,
  title: 'Default Title',
  price: '11.99',
  compare_at_price: '',
  sku: 'SKU-1',
  option1: 'Default Title',
  inventory_management: 'shopify',
  inventory_policy: 'deny',
  inventory_quantity: 35,
  price_currency: 'USD',
  ...over
});

const payload = (over = {}, variants = [variant()]) =>
  JSON.stringify({
    product: {
      id: 999,
      title: 'Light Roast Coffee (10oz Ground)',
      vendor: 'Death Wish Coffee',
      product_type: 'Coffee',
      handle: 'light-roast-10oz',
      body_html: '<p>Smooth <strong>light</strong> roast.</p>',
      tags: ['coffee', 'light'],
      options: [{ name: 'Title' }],
      images: [{ src: 'https://cdn.example/1.jpg' }],
      published_at: '2024-01-01T00:00:00-05:00',
      updated_at: '2026-08-01T00:00:00-04:00',
      variants,
      ...over
    }
  });

const run = (body, url = 'https://shop.example.com/products/light-roast-10oz') =>
  template.extractRaw(body, url);

describe('shopify-product URL resolution', () => {
  test('a product page URL becomes the JSON endpoint', () => {
    assert.equal(
      template.resolveUrl('https://shop.example.com/products/light-roast-10oz'),
      'https://shop.example.com/products/light-roast-10oz.json'
    );
  });

  test('a variant query string and trailing slash are dropped', () => {
    assert.equal(
      template.resolveUrl('https://shop.example.com/products/tee?variant=42284735168567'),
      'https://shop.example.com/products/tee.json'
    );
    assert.equal(
      template.resolveUrl('https://shop.example.com/products/tee/'),
      'https://shop.example.com/products/tee.json'
    );
  });

  test('a locale-prefixed path still resolves', () => {
    assert.equal(
      template.resolveUrl('https://shop.example.com/en-ca/products/tee'),
      'https://shop.example.com/en-ca/products/tee.json'
    );
  });

  test('an already-.json URL is not doubled', () => {
    assert.equal(
      template.resolveUrl('https://shop.example.com/products/tee.json'),
      'https://shop.example.com/products/tee.json'
    );
  });
});

describe('shopify-product extraction', () => {
  test('price and compare-at come straight from the store', () => {
    const data = run(payload({}, [variant({ price: '75.00', compare_at_price: '112.00' })]));
    assert.equal(data.price, '75.00');
    assert.equal(data.compare_at_price, '112.00');
    assert.equal(data.on_sale, true);
    assert.equal(data.currency, 'USD');
  });

  test('an absent compare-at price is null, not a fabricated number', () => {
    // The failure this template exists to prevent: an LLM asked for a
    // compare-at price on this product returned "27.99".
    const data = run(payload());
    assert.equal(data.compare_at_price, null);
    assert.equal(data.on_sale, false);
  });

  test('a zero compare-at price reads as unset', () => {
    // Allbirds writes "0.00" where Death Wish writes "" — both render no badge.
    const data = run(payload({}, [variant({ price: '110.00', compare_at_price: '0.00' })]));
    assert.equal(data.compare_at_price, null);
    assert.equal(data.on_sale, false);
  });

  test('a free product keeps its zero price', () => {
    const data = run(payload({}, [variant({ price: '0.00' })]));
    assert.equal(data.price, '0.00', 'zero-normalising applies to compare-at prices only');
  });

  test('stock is derived from inventory, not from a badge in the markup', () => {
    assert.equal(run(payload()).available, true);
    assert.equal(run(payload({}, [variant({ inventory_quantity: 0 })])).available, false);
  });

  test('an untracked variant is available regardless of quantity', () => {
    const data = run(payload({}, [variant({ inventory_management: null, inventory_quantity: 0 })]));
    assert.equal(data.available, true);
  });

  test('a variant that allows overselling is available at zero stock', () => {
    const data = run(payload({}, [variant({ inventory_policy: 'continue', inventory_quantity: 0 })]));
    assert.equal(data.available, true);
  });

  test('unknowable stock reports null rather than guessing "in stock"', () => {
    const data = run(payload({}, [variant({ inventory_quantity: undefined })]));
    assert.equal(data.variants[0].available, null);
    assert.equal(data.available, null);
  });

  test('a partly sold-out product is available', () => {
    const data = run(payload({}, [
      variant({ id: 1, title: '5', inventory_quantity: 0 }),
      variant({ id: 2, title: '6', inventory_quantity: 4 })
    ]));
    assert.equal(data.available, true);
    assert.deepEqual(data.variants.map(v => v.available), [false, true]);
  });

  test('multi-variant pricing reports a range', () => {
    const data = run(payload({}, [
      variant({ id: 1, price: '140.00' }),
      variant({ id: 2, price: '95.50' }),
      variant({ id: 3, price: '180.00' })
    ]));
    assert.equal(data.price_min, '95.50');
    assert.equal(data.price_max, '180.00');
    assert.equal(data.variants.length, 3);
  });

  test('tags are normalised from either shape', () => {
    assert.deepEqual(run(payload({ tags: ['a', 'b'] })).tags, ['a', 'b']);
    assert.deepEqual(run(payload({ tags: 'a, b, c' })).tags, ['a', 'b', 'c']);
    assert.deepEqual(run(payload({ tags: null })).tags, []);
  });

  test('the description is copy, not markup', () => {
    const data = run(payload());
    assert.equal(data.description, 'Smooth light roast.');
  });

  test('a non-Shopify response fails clearly instead of returning empty fields', () => {
    assert.throws(() => run('<html><body>not json</body></html>'), /Not a Shopify product endpoint/);
    assert.throws(() => run(JSON.stringify({ items: [] })), /Not a Shopify product endpoint/);
  });
});

describe('shopify-product registration', () => {
  test('the template is listed and matches product URLs', () => {
    const listed = registry.list().find(t => t.id === 'shopify-product');
    assert.ok(listed, 'template must be discoverable via list()');
    assert.match('https://any-store.com/products/some-handle', template.targetPattern);
  });

  test('run() dispatches to extractRaw and reports the fetched URL', async () => {
    const result = await registry.run(
      'shopify-product',
      payload(),
      'https://shop.example.com/products/light-roast-10oz',
      'https://shop.example.com/products/light-roast-10oz.json'
    );
    assert.equal(result.data.title, 'Light Roast Coffee (10oz Ground)');
    assert.equal(result.fetchedUrl, 'https://shop.example.com/products/light-roast-10oz.json');
  });

  test('HTML templates still run through cheerio', async () => {
    const result = await registry.run(
      'github-repo',
      '<html><body><h1 class="repository-content">owner/repo</h1></body></html>',
      'https://github.com/owner/repo'
    );
    assert.ok(result.data, 'existing templates must be unaffected');
    assert.ok(!('fetchedUrl' in result), 'no rewrite means no fetchedUrl field');
  });
});

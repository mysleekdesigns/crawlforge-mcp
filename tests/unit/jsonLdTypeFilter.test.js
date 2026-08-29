/**
 * JSON-LD type filtering (src/utils/jsonLd.js) and its extract_metadata path.
 *
 * Run: node --test tests/unit/jsonLdTypeFilter.test.js
 *
 * The fixtures under tests/fixtures/json-ld/ are condensed from live captures
 * taken on 2026-08-29; each file's own comment records its source URL, the curl
 * that fetched it and what was trimmed.
 *
 * The case that motivates subtype resolution: Ticketmaster publishes MusicEvent
 * and never Event, Apple publishes AggregateOffer and BreadcrumbList and never
 * Offer or ItemList. An exact-string @type match returns nothing on the very
 * pages a caller filters for.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { filterJsonLdByType, JSON_LD_SUBTYPES } from '../../src/utils/jsonLd.js';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { extractMetadataHandler } = await import('../../src/tools/basic/extractMetadata.js');

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/json-ld');
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');

const PAGES = {
  '/ticketmaster': fixture('ticketmaster-concerts.html'),
  '/apple': fixture('apple-macbook-air.html'),
  '/propertyfinder': fixture('propertyfinder-buy.html'),
  '/malformed': fixture('malformed-block.html')
};

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nAllow: /\n');
      return;
    }
    const body = PAGES[req.url];
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function extract(path, json_ld_types) {
  const result = await extractMetadataHandler({ url: `${baseUrl}${path}`, json_ld_types });
  assert.ok(!result.isError, result.content[0].text);
  return JSON.parse(result.content[0].text);
}

const types = (nodes) => nodes.map((n) => n['@type']);

describe('filterJsonLdByType — matching rules', () => {
  test('a subtype matches its parent filter (MusicEvent → Event)', () => {
    const blocks = [[{ '@type': 'MusicEvent', name: 'a' }, { '@type': 'SportsEvent', name: 'b' }]];
    const { items, counts } = filterJsonLdByType(blocks, ['Event']);
    assert.deepEqual(types(items), ['MusicEvent', 'SportsEvent']);
    assert.deepEqual(counts, { Event: 2 });
  });

  test('an unrelated type does not match', () => {
    const blocks = [[
      { '@type': 'Organization', name: 'a' },
      { '@type': 'MedicalWebPage', name: 'b' },
      { '@type': 'EventVenue', name: 'c' }
    ]];
    const { items, counts } = filterJsonLdByType(blocks, ['Event']);
    assert.deepEqual(items, []);
    assert.deepEqual(counts, { Event: 0 });
  });

  test('a type outside the subtype table is matched exactly', () => {
    const blocks = [[{ '@type': 'MedicalWebPage' }, { '@type': 'WebPage' }]];
    const { items } = filterJsonLdByType(blocks, ['MedicalWebPage']);
    assert.deepEqual(types(items), ['MedicalWebPage']);
  });

  test('@type given as an array matches on any of its entries', () => {
    const blocks = [{ '@type': ['RealEstateListing', 'House'], name: 'a' }];
    const { counts } = filterJsonLdByType(blocks, ['RealEstateListing', 'House', 'Event']);
    assert.deepEqual(counts, { RealEstateListing: 1, House: 1, Event: 0 });
  });

  test('a node matching two requested types is returned once', () => {
    const blocks = [{ '@type': ['RealEstateListing', 'House'] }];
    const { items } = filterJsonLdByType(blocks, ['RealEstateListing', 'House']);
    assert.equal(items.length, 1);
  });

  test('@graph wrappers, top-level arrays and nested nodes are all reachable', () => {
    const blocks = [
      { '@context': 'https://schema.org', '@graph': [{ '@type': 'Product', name: 'in-graph' }] },
      [{ '@type': 'MusicEvent', name: 'in-array', offers: { '@type': 'Offer', price: '12' } }]
    ];
    const { items, counts } = filterJsonLdByType(blocks, ['Product', 'Event', 'Offer']);
    assert.deepEqual(counts, { Product: 1, Event: 1, Offer: 1 });
    assert.deepEqual(items.map((n) => n.name ?? n.price), ['in-graph', 'in-array', '12']);
  });

  test('@type written as a full schema.org IRI still matches', () => {
    const blocks = [{ '@type': 'https://schema.org/Product', name: 'a' }];
    const { counts } = filterJsonLdByType(blocks, ['Product']);
    assert.deepEqual(counts, { Product: 1 });
  });

  test('the six documented filter types are all in the subtype table', () => {
    assert.deepEqual(Object.keys(JSON_LD_SUBTYPES), [
      'ItemList', 'Product', 'Offer', 'Event', 'JobPosting', 'RealEstateListing'
    ]);
  });
});

describe('extract_metadata json_ld_types', () => {
  test('without the parameter json_ld stays the raw dump and no counts appear', async () => {
    const data = await extract('/ticketmaster');
    assert.equal(data.json_ld.length, 2); // the page's two <script> blocks, unfiltered
    assert.ok(Array.isArray(data.json_ld[0]));
    assert.equal('json_ld_type_counts' in data, false);
  });

  test('Ticketmaster: an Event filter returns its MusicEvents (subtype resolution)', async () => {
    const data = await extract('/ticketmaster', ['Event']);
    assert.deepEqual(data.json_ld_type_counts, { Event: 2 });
    assert.deepEqual(types(data.json_ld), ['MusicEvent', 'MusicEvent']);
  });

  test('Ticketmaster: an Offer filter reaches the offers nested in each event', async () => {
    const data = await extract('/ticketmaster', ['Offer']);
    assert.deepEqual(data.json_ld_type_counts, { Offer: 2 });
    assert.deepEqual(types(data.json_ld), ['Offer', 'Offer']);
  });

  test('Ticketmaster: an ItemList filter returns the BreadcrumbList (subtype resolution)', async () => {
    const data = await extract('/ticketmaster', ['ItemList']);
    assert.deepEqual(data.json_ld_type_counts, { ItemList: 1 });
    assert.deepEqual(types(data.json_ld), ['BreadcrumbList']);
  });

  test('Ticketmaster: a type the page does not publish returns nothing', async () => {
    const data = await extract('/ticketmaster', ['JobPosting']);
    assert.deepEqual(data.json_ld, []);
    assert.deepEqual(data.json_ld_type_counts, { JobPosting: 0 });
  });

  test('Apple: Product carries its prices, and Offer matches the AggregateOffer', async () => {
    const data = await extract('/apple', ['Product', 'Offer']);
    assert.deepEqual(data.json_ld_type_counts, { Product: 1, Offer: 1 });
    const [product, offer] = data.json_ld;
    assert.equal(product['@type'], 'Product');
    assert.equal(product.offers[0].lowPrice, 1299);
    assert.equal(offer['@type'], 'AggregateOffer');
    assert.equal(offer.priceCurrency, 'USD');
  });

  test('propertyfinder.ae: RealEstateListing nodes come back with offers.price', async () => {
    const data = await extract('/propertyfinder', ['RealEstateListing']);
    assert.deepEqual(data.json_ld_type_counts, { RealEstateListing: 3 });
    for (const listing of data.json_ld) {
      assert.ok(listing['@type'].includes('RealEstateListing'));
      assert.equal(typeof listing.offers.price, 'number');
      assert.equal(listing.offers.priceCurrency, 'AED');
    }
    assert.equal(data.json_ld[0].offers.price, 33999999);
  });

  test('a malformed block does not lose the good blocks around it', async () => {
    const raw = await extract('/malformed');
    assert.deepEqual(types(raw.json_ld), ['BreadcrumbList', 'Product']);

    const filtered = await extract('/malformed', ['Product']);
    assert.deepEqual(filtered.json_ld_type_counts, { Product: 1 });
  });
});

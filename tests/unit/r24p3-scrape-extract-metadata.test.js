/**
 * Live test R24, Phase 3, item 3.9: extract_metadata.
 *
 * - With json_ld_types, a match nested inside another returned node is not
 *   repeated on its own: ["Product","Offer"] on apple.com/shop/buy-mac/macbook-air
 *   returned the AggregateOffer inside its Product and again after it. The
 *   counts still include the nested match, and an Offer-only filter still
 *   reaches offers nested in their parents.
 * - A redirect is flagged: `redirected` is always present, and
 *   `requested_url` names what was asked for when the fetch ended elsewhere.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/r24p3-scrape-extract-metadata.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { extractMetadataHandler } = await import('../../src/tools/basic/extractMetadata.js');

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/json-ld');
const APPLE = readFileSync(join(FIXTURES, 'apple-macbook-air.html'), 'utf8');
const TICKETMASTER = readFileSync(join(FIXTURES, 'ticketmaster-concerts.html'), 'utf8');

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(404).end();
      return;
    }
    if (req.url === '/old-page') {
      res.writeHead(301, { Location: '/apple' }).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url === '/ticketmaster' ? TICKETMASTER : APPLE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

async function extract(path, json_ld_types) {
  const result = await extractMetadataHandler({ url: `${baseUrl}${path}`, json_ld_types });
  assert.ok(!result.isError, result.content[0].text);
  return JSON.parse(result.content[0].text);
}

describe('extract_metadata json_ld_types: no nested duplicates (3.9)', () => {
  test('["Product","Offer"]: the AggregateOffer comes back inside its Product only', async () => {
    const data = await extract('/apple', ['Product', 'Offer']);
    assert.deepEqual(data.json_ld.map((n) => n['@type']), ['Product']);
    assert.equal(data.json_ld[0].offers[0]['@type'], 'AggregateOffer');
    assert.deepEqual(data.json_ld_type_counts, { Product: 1, Offer: 1 }, 'counts include the nested match');
  });

  test('an Offer-only filter still returns offers nested in their events', async () => {
    const data = await extract('/ticketmaster', ['Offer']);
    assert.deepEqual(data.json_ld.map((n) => n['@type']), ['Offer', 'Offer']);
  });
});

describe('extract_metadata flags a redirect (3.9)', () => {
  test('a redirect to another page: redirected:true, requested_url, url = the final page', async () => {
    const data = await extract('/old-page');
    assert.equal(data.redirected, true);
    assert.equal(data.requested_url, `${baseUrl}/old-page`);
    assert.equal(data.url, `${baseUrl}/apple`);
  });

  test('no redirect: redirected:false and no requested_url', async () => {
    const data = await extract('/apple');
    assert.equal(data.redirected, false);
    assert.equal('requested_url' in data, false);
    assert.equal(data.url, `${baseUrl}/apple`);
  });
});

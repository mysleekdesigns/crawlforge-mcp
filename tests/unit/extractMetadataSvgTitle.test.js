/**
 * Regression tests for extract_metadata (src/tools/basic/extractMetadata.js).
 *
 * Run: node --test tests/unit/extractMetadataSvgTitle.test.js
 *
 * Two defects found in the 2026-08-26 live all-tools sweep, on
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript:
 *
 *  1. Title pollution: the fallback chain used $('title'), which also matches
 *     inline <svg><title> elements in the body — MDN's three logo titles plus
 *     the Mozilla logo produced "JavaScript | MDNMDNMDNMozilla". The selector
 *     must read only the document head title.
 *
 *  2. og_tags came back {}: MDN emits its Open Graph tags as
 *     <meta name="og:..."> instead of the standard property= attribute, and
 *     the collector only matched property^="og:". Both spellings must be read.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { extractMetadataHandler } = await import('../../src/tools/basic/extractMetadata.js');

// MDN-shaped fixture: real head title, body full of inline SVG <title>s,
// OG tags spelled with name= instead of property=.
const MDN_LIKE_HTML = `<!doctype html><html><head>
  <title>JavaScript | MDN</title>
  <meta name="og:title" content="JavaScript | MDN" />
  <meta name="og:description" content="JS docs" />
  <meta name="og:site_name" content="MDN Web Docs" />
</head><body>
  <svg role="img"><title>MDN</title><path d="M0 0"/></svg>
  <svg role="img"><title>MDN</title><path d="M0 0"/></svg>
  <svg role="img"><title>MDN</title><path d="M0 0"/></svg>
  <svg role="img"><title>Mozilla</title><path d="M0 0"/></svg>
  <h1>JavaScript</h1>
</body></html>`;

// Standard-shaped fixture: OG tags with the spec's property= attribute.
const STANDARD_HTML = `<!doctype html><html><head>
  <title>Express - Node.js framework</title>
  <meta property="og:title" content="Express" />
  <meta property="og:image" content="https://example.test/og.png" />
</head><body><svg><title>Ignored logo</title></svg></body></html>`;

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url === '/standard' ? STANDARD_HTML : MDN_LIKE_HTML);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function extract(path) {
  const result = await extractMetadataHandler({ url: `${baseUrl}${path}` });
  assert.ok(!result.isError, result.content[0].text);
  return JSON.parse(result.content[0].text);
}

describe('extract_metadata title selection', () => {
  test('inline <svg><title> elements do not pollute the document title', async () => {
    const data = await extract('/mdn');
    // The old $('title') selector produced "JavaScript | MDNMDNMDNMozilla".
    assert.equal(data.title, 'JavaScript | MDN');
  });
});

describe('extract_metadata og_tags collection', () => {
  test('OG tags spelled with name= (MDN style) are collected', async () => {
    const data = await extract('/mdn');
    assert.deepEqual(data.og_tags, {
      title: 'JavaScript | MDN',
      description: 'JS docs',
      site_name: 'MDN Web Docs'
    });
  });

  test('standard property= OG tags still work, and head title stays correct', async () => {
    const data = await extract('/standard');
    assert.equal(data.title, 'Express');
    assert.deepEqual(data.og_tags, {
      title: 'Express',
      image: 'https://example.test/og.png'
    });
  });
});

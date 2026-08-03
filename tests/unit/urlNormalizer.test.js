/**
 * Unit tests for src/utils/urlNormalizer.js
 *
 * Reproduction test for the Phase 2 fix: the query-param sort used to
 * iterate `[...params.keys()]`, which yields one key per occurrence
 * (including duplicates), and re-read `params.get(key)` — always the FIRST
 * value — for every occurrence. `?tag=a&tag=b` was corrupted into
 * `?tag=a&tag=a`, silently fabricating a URL the site never linked and
 * breaking dedup for genuinely distinct multi-value query strings.
 *
 * Run: node --test tests/unit/urlNormalizer.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrl,
  isValidUrl,
  isSameDomain,
  isSubdomain,
  extractDomain,
  extractLinks,
  getUrlDepth,
  isFileUrl,
  removeQueryParameters,
  getBaseUrl
} from '../../src/utils/urlNormalizer.js';

describe('normalizeUrl — repeated query parameters', () => {
  test('preserves both values of a repeated query parameter (not collapsed to the first)', () => {
    const result = normalizeUrl('https://example.com/p?tag=a&tag=b');
    assert.equal(result, 'https://example.com/p?tag=a&tag=b');
  });

  test('preserves 3+ repeated values in original relative order', () => {
    const result = normalizeUrl('https://example.com/p?tag=z&tag=a&tag=m');
    // Sort is by key only (stable), so same-key entries keep their relative order.
    assert.equal(result, 'https://example.com/p?tag=z&tag=a&tag=m');
  });

  test('repeated params interleaved with other keys: keys sorted, duplicate values preserved', () => {
    const result = normalizeUrl('https://example.com/p?z=1&tag=a&tag=b&a=2');
    // Keys sorted alphabetically: a, tag, tag, z — duplicate tag values both survive.
    assert.equal(result, 'https://example.com/p?a=2&tag=a&tag=b&z=1');
  });

  test('two distinct multi-value URLs stay distinct after normalization (no over-dedup)', () => {
    const url1 = normalizeUrl('https://example.com/p?tag=a&tag=b');
    const url2 = normalizeUrl('https://example.com/p?tag=a&tag=c');
    assert.notEqual(url1, url2);
  });
});

describe('normalizeUrl — baseline behaviour', () => {
  test('lowercases hostname', () => {
    assert.equal(normalizeUrl('https://EXAMPLE.com/path'), 'https://example.com/path');
  });

  test('removes default https port 443', () => {
    assert.equal(normalizeUrl('https://example.com:443/path'), 'https://example.com/path');
  });

  test('removes default http port 80', () => {
    assert.equal(normalizeUrl('http://example.com:80/path'), 'http://example.com/path');
  });

  test('keeps non-default port', () => {
    assert.equal(normalizeUrl('https://example.com:8443/path'), 'https://example.com:8443/path');
  });

  test('strips trailing slash from a non-root path', () => {
    assert.equal(normalizeUrl('https://example.com/path/'), 'https://example.com/path');
  });

  test('keeps root path slash', () => {
    assert.equal(normalizeUrl('https://example.com/'), 'https://example.com/');
  });

  test('sorts single-value query parameters alphabetically', () => {
    assert.equal(normalizeUrl('https://example.com/p?b=2&a=1'), 'https://example.com/p?a=1&b=2');
  });

  test('removes the fragment', () => {
    assert.equal(normalizeUrl('https://example.com/path#section'), 'https://example.com/path');
  });

  test('throws a descriptive error for an invalid URL', () => {
    assert.throws(() => normalizeUrl('not-a-url'), /Invalid URL/);
  });
});

describe('isValidUrl', () => {
  test('true for a well-formed URL', () => {
    assert.equal(isValidUrl('https://example.com'), true);
  });

  test('false for a malformed string', () => {
    assert.equal(isValidUrl('not-a-url'), false);
  });
});

describe('isSameDomain / isSubdomain', () => {
  test('isSameDomain true for identical hostnames', () => {
    assert.equal(isSameDomain('https://example.com/a', 'https://example.com/b'), true);
  });

  test('isSameDomain false for different hostnames', () => {
    assert.equal(isSameDomain('https://example.com/a', 'https://other.com/b'), false);
  });

  test('isSubdomain true for a subdomain of the base', () => {
    assert.equal(isSubdomain('https://blog.example.com/', 'https://example.com/'), true);
  });

  test('isSubdomain false for an unrelated domain', () => {
    assert.equal(isSubdomain('https://blog.other.com/', 'https://example.com/'), false);
  });
});

describe('extractDomain', () => {
  test('returns the hostname', () => {
    assert.equal(extractDomain('https://example.com/path?x=1'), 'example.com');
  });

  test('returns null for an invalid URL', () => {
    assert.equal(extractDomain('not-a-url'), null);
  });
});

describe('extractLinks', () => {
  test('extracts and absolutizes href values, skipping # and javascript:', () => {
    const html = `
      <a href="/about">About</a>
      <a href="https://other.com/x">Other</a>
      <a href="#top">Top</a>
      <a href="javascript:void(0)">JS</a>
    `;
    const links = extractLinks(html, 'https://example.com/docs/page.html');
    assert.deepEqual(
      links.sort(),
      ['https://example.com/about', 'https://other.com/x'].sort()
    );
  });

  test('deduplicates identical resolved links', () => {
    const html = `<a href="/a">1</a><a href="/a">2</a>`;
    const links = extractLinks(html, 'https://example.com/');
    assert.equal(links.length, 1);
  });
});

describe('getUrlDepth', () => {
  test('counts non-empty path segments', () => {
    assert.equal(getUrlDepth('https://example.com/a/b/c'), 3);
    assert.equal(getUrlDepth('https://example.com/'), 0);
  });
});

describe('isFileUrl', () => {
  test('true for a known binary/document extension', () => {
    assert.equal(isFileUrl('https://example.com/report.pdf'), true);
  });

  test('false for an ordinary page URL', () => {
    assert.equal(isFileUrl('https://example.com/page'), false);
  });
});

describe('removeQueryParameters / getBaseUrl', () => {
  test('removeQueryParameters strips the query string', () => {
    assert.equal(removeQueryParameters('https://example.com/p?a=1&b=2'), 'https://example.com/p');
  });

  test('getBaseUrl returns protocol + host with no path', () => {
    assert.equal(getBaseUrl('https://example.com:8080/a/b?x=1'), 'https://example.com:8080');
  });
});

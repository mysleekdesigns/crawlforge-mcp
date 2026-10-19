/**
 * R25 Phase 1.3 — search_web's ResultDeduplicator merged different pages.
 * Run: node --test --test-force-exit tests/unit/r25-phase1-search-dedup.test.js
 *
 * Repro (R25 sweep): search_web {query:'array methods', site:'developer.mozilla.org'}
 * dropped ~70% of results. Three causes in ResultDeduplicator.js:
 *   - a URL edit-distance similarity >= 0.95 counted as a duplicate on its own,
 *     so `.../Array/at` matched `.../Array`;
 *   - the combined score passed on sibling URLs plus a shared title template;
 *   - findDuplicateGroups compared each result only with the group's first
 *     member, so the `Array` hub page absorbed all of its children.
 * And `duplicateUrls` was all nulls (read `d.originalUrl`, which never exists).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ResultDeduplicator } from '../../src/tools/search/ranking/ResultDeduplicator.js';

const MDN = 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array';

// Sibling MDN pages: shared URL prefix and the shared " - JavaScript | MDN" title template.
const mdnResults = () => [
  { title: 'Array - JavaScript | MDN', link: MDN, displayLink: 'developer.mozilla.org',
    snippet: 'The Array object, as with arrays in other programming languages, enables storing a collection of multiple items under a single variable name.' },
  { title: 'Array.prototype.at() - JavaScript | MDN', link: `${MDN}/at`, displayLink: 'developer.mozilla.org',
    snippet: 'The at() method of Array instances takes an integer value and returns the item at that index, allowing for positive and negative integers.' },
  { title: 'Array.prototype.map() - JavaScript | MDN', link: `${MDN}/map`, displayLink: 'developer.mozilla.org',
    snippet: 'The map() method of Array instances creates a new array populated with the results of calling a provided function on every element.' },
  { title: 'Array.prototype.flat() - JavaScript | MDN', link: `${MDN}/flat`, displayLink: 'developer.mozilla.org',
    snippet: 'The flat() method of Array instances creates a new array with all sub-array elements concatenated into it recursively up to the specified depth.' },
  { title: 'Array.prototype.filter() - JavaScript | MDN', link: `${MDN}/filter`, displayLink: 'developer.mozilla.org',
    snippet: 'The filter() method of Array instances creates a shallow copy of a portion of a given array, filtered down to just the elements that pass the test.' },
  { title: 'Array.from() - JavaScript | MDN', link: `${MDN}/from`, displayLink: 'developer.mozilla.org',
    snippet: 'The Array.from() static method creates a new, shallow-copied Array instance from an iterable or array-like object.' }
];

describe('R25 1.3 sibling pages stay separate', () => {
  test('MDN Array and its child pages (Array/at, map, flat, ...) are all kept', async () => {
    const dedup = new ResultDeduplicator({ cacheEnabled: false });
    const out = await dedup.deduplicateResults(mdnResults());
    assert.equal(out.length, 6);
    assert.ok(out.some(r => r.link === `${MDN}/at`), 'Array/at must be its own result');
    assert.ok(out.some(r => r.link === MDN), 'Array must be its own result');
  });

  test('a one-path-segment URL difference is not a duplicate on its own', () => {
    const dedup = new ResultDeduplicator({ cacheEnabled: false });
    const opts = { ...dedup.options };
    const [a, b] = mdnResults().slice(0, 2).map(r => ({
      ...r,
      normalizedUrl: dedup.normalizeUrl(r.link, opts.urlNormalization),
      titleTokens: dedup.tokenizeTitle(r.title)
    }));
    assert.ok(dedup.computeUrlSimilarity(a, b) >= 0.95, 'repro precondition: edit-distance similarity is >= 0.95');
    assert.equal(dedup.areDuplicates(a, b, opts), false);
  });

  test('live Brave pair: Array/at and Array/values (same title template) stay separate', async () => {
    // Merged in the first live verify run, when content similarity was a
    // SimHash over title + domain + snippet (0.86 against the 0.85 threshold).
    const dedup = new ResultDeduplicator({ cacheEnabled: false });
    const out = await dedup.deduplicateResults([
      { title: 'Array.prototype.at() - JavaScript - MDN Web Docs', link: `${MDN}/at`, displayLink: 'developer.mozilla.org',
        snippet: 'The at() method of Array instances takes an integer value and returns the item at that index, allowing for positive and negative integers. Negative integers count back from the last item in the array.' },
      { title: 'Array.prototype.values() - JavaScript - MDN Web Docs', link: `${MDN}/values`, displayLink: 'developer.mozilla.org',
        snippet: 'The values() method of Array instances returns a new array iterator object that iterates the value of each item in the array.' }
    ]);
    assert.equal(out.length, 2);
  });
});

describe('R25 1.3 the same content on different URLs still merges', () => {
  test('a syndicated copy (same title and snippet, another domain) merges', async () => {
    const dedup = new ResultDeduplicator({ cacheEnabled: false });
    const snippet = 'A complete guide covering everything about node.js streams and how they work in practice with real examples';
    const out = await dedup.deduplicateResults([
      { title: 'Complete Guide to Node.js Streams', link: 'https://blog.example.com/node-streams', snippet },
      { title: 'Complete Guide to Node.js Streams', link: 'https://dev.to/someone/node-streams-guide-4kd2', snippet }
    ]);
    assert.equal(out.length, 1);
  });
});

describe('R25 1.3 the same page written differently still merges', () => {
  const variants = [
    'https://example.com/guide',
    'http://example.com/guide',
    'https://www.example.com/guide',
    'https://example.com/guide/',
    'https://example.com/guide/index.html',
    'https://example.com/guide?utm_source=news&utm_medium=email',
    'https://example.com/guide?fbclid=abc123',
    'https://example.com/guide#section-2'
  ];

  for (const variant of variants.slice(1)) {
    test(`${variant} merges with ${variants[0]}`, async () => {
      const dedup = new ResultDeduplicator({ cacheEnabled: false });
      const out = await dedup.deduplicateResults([
        { title: 'The Guide', link: variants[0], snippet: 'First snippet about the guide page and its content.' },
        { title: 'Guide (mirror listing)', link: variant, snippet: 'A completely different snippet wording for this result.' }
      ]);
      assert.equal(out.length, 1);
    });
  }

  test('a meaningful query parameter keeps pages separate', async () => {
    const dedup = new ResultDeduplicator({ cacheEnabled: false });
    const out = await dedup.deduplicateResults([
      { title: 'Products', link: 'https://example.com/products?page=1', snippet: 'Page one of the product listing with shoes.' },
      { title: 'Products', link: 'https://example.com/products?page=2', snippet: 'Page two of the product listing with hats and coats.' }
    ]);
    assert.equal(out.length, 2);
  });
});

describe('R25 1.3 duplicateUrls', () => {
  test('lists the merged URLs, not nulls', async () => {
    const dedup = new ResultDeduplicator({ cacheEnabled: false });
    const out = await dedup.deduplicateResults([
      { title: 'The Guide', link: 'https://example.com/guide', snippet: 'Guide snippet text here.' },
      { title: 'The Guide', link: 'http://www.example.com/guide/', snippet: 'Guide snippet text here.' },
      { title: 'Other', link: 'https://example.com/other', snippet: 'Something else entirely about other things.' }
    ]);
    assert.equal(out.length, 2);
    const merged = out.find(r => r.deduplicationInfo.merged);
    assert.deepEqual(merged.deduplicationInfo.duplicateUrls, ['http://www.example.com/guide/']);
  });
});

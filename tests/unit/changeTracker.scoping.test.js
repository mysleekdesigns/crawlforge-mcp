/**
 * Unit tests for ChangeTracker selector scoping and diff payload bounds.
 *
 * Run: node --test tests/unit/changeTracker.scoping.test.js
 *
 * Regressions covered:
 *   - customSelectors must actually scope tracking: noise outside the selector
 *     must not register as a change (Amazon session tokens produced 456
 *     "modified" elements and significance "moderate" on an unchanged page).
 *   - customSelectors must still catch real changes inside the selector.
 *   - line_diff must not degenerate into "remove whole doc, add whole doc".
 *     With ignoreWhitespace (default) the document collapses to a single line,
 *     so a 1-char change produced a payload of 2x the page size — 4MB on an
 *     Amazon product page, overflowing the MCP token limit on every compare.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeTracker } from '../../src/core/ChangeTracker.js';

/** Page with a stable price block and a volatile session-token block. */
function page({ price = '$19.99', token = 'tok_AAA' } = {}) {
  return `<html><body>
    <div id="price-block"><span class="a-price">${price}</span></div>
    <div id="telemetry"><span>${token}</span></div>
    ${'<div class="filler"><p>lorem ipsum dolor sit amet</p></div>'.repeat(300)}
  </body></html>`;
}

const SCOPED = {
  granularity: 'element',
  customSelectors: ['#price-block'],
  trackText: true,
  trackStructure: false,
  trackLinks: false
};

test('customSelectors: noise outside the selector is not reported as a change', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/scoping-noise';

  await tracker.createBaseline(url, page({ token: 'tok_AAA' }), SCOPED);
  const result = await tracker.compareWithBaseline(url, page({ token: 'tok_BBB' }), SCOPED);

  assert.equal(result.hasChanges, false, 'token churn outside #price-block must not be a change');
  assert.equal(result.significance, 'none');
  assert.equal(result.details.modifiedElements.length, 0);
});

test('customSelectors: a real change inside the selector is still detected', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/scoping-real';

  await tracker.createBaseline(url, page({ price: '$19.99' }), SCOPED);
  const result = await tracker.compareWithBaseline(url, page({ price: '$29.99' }), SCOPED);

  assert.equal(result.hasChanges, true, 'price change inside #price-block must be detected');

  const words = result.details.textChanges
    .filter(c => c.type === 'word_diff')
    .flatMap(c => c.changes)
    .map(c => c.value)
    .join(' ');
  // diffWords splits on word boundaries, so "$19.99" -> "$29.99" surfaces as 19 -> 29.
  assert.match(words, /\b29\b/, 'word_diff should name the changed price digits');
});

test('customSelectors: a selector that matches nothing falls back and warns', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/scoping-nomatch';
  const opts = { ...SCOPED, customSelectors: ['#does-not-exist'] };

  const baseline = await tracker.createBaseline(url, page(), opts);
  assert.ok(
    Array.isArray(baseline.warnings) && baseline.warnings.length > 0,
    'a non-matching selector must warn rather than silently track nothing'
  );

  // Falls back to the whole document, so the change is still visible in the diff.
  const result = await tracker.compareWithBaseline(url, page({ price: '$29.99' }), opts);
  const words = result.details.textChanges
    .filter(c => c.type === 'word_diff')
    .flatMap(c => c.changes)
    .map(c => c.value)
    .join(' ');
  assert.match(words, /\b29\b/, 'fallback must still diff the full document');
});

test('line_diff payload stays bounded on single-line content', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/payload';
  const opts = { granularity: 'element', trackText: true, trackStructure: false, trackLinks: false };

  const before = page({ price: '$19.99' });
  const after = page({ price: '$29.99' });

  await tracker.createBaseline(url, before, opts);
  const result = await tracker.compareWithBaseline(url, after, opts);

  const payload = JSON.stringify(result.details.textChanges).length;
  assert.ok(
    payload < before.length,
    `textChanges payload (${payload}) must be smaller than the page itself (${before.length}); ` +
    'line_diff was embedding the full before+after document'
  );

  // word_diff must still pinpoint the change precisely.
  const words = result.details.textChanges
    .filter(c => c.type === 'word_diff')
    .flatMap(c => c.changes)
    .map(c => c.value)
    .join(' ');
  assert.match(words, /\b29\b/);
});

test('line_diff is still produced for genuinely multi-line content', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/multiline';
  // ignoreWhitespace:false preserves newlines, so line structure is real.
  const opts = { granularity: 'page', trackText: true, ignoreWhitespace: false, trackStructure: false, trackLinks: false };

  const before = '<pre>alpha\nbravo\ncharlie\n</pre>';
  const after = '<pre>alpha\nDELTA\ncharlie\n</pre>';

  await tracker.createBaseline(url, before, opts);
  const result = await tracker.compareWithBaseline(url, after, opts);

  const kinds = result.details.textChanges.map(c => c.type);
  assert.ok(kinds.includes('line_diff'), 'multi-line content should still get a line_diff');
});

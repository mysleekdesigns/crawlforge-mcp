/**
 * Unit tests: monetary change significance in ChangeTracker.
 *
 * Run: node --test tests/unit/changeTracker.significance.test.js
 *
 * Regression (2026-08-25): significance was purely volumetric — it scored how
 * much of the document changed and never what changed — so a price was rated by
 * how many characters it occupies:
 *
 *   scoped to the price block, $19.99 -> $29.99   "minor"   (default
 *   scoped to the price block, $19.99 -> $99.99   "minor"    threshold is
 *   unscoped,                  $19.99 -> $29.99   hasChanges:false
 *
 * The default notificationThreshold is "moderate", so a monitor set up the
 * obvious way never fired on a price change, and on a full page the change did
 * not register at all.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeTracker } from '../../src/core/ChangeTracker.js';

/** A page whose price is a tiny fraction of the total content. */
const page = (price, filler = 'lorem ipsum dolor sit amet consectetur') =>
  `<html><body>
    <div id="price-block"><span class="a-price">${price}</span></div>
    ${`<div class="filler"><p>${filler}</p></div>`.repeat(300)}
  </body></html>`;

const SCOPED = {
  granularity: 'element',
  customSelectors: ['#price-block'],
  trackText: true,
  trackStructure: false,
  trackLinks: false
};
const UNSCOPED = { granularity: 'element', trackText: true, trackStructure: false, trackLinks: false };

let seq = 0;
async function compare(before, after, options) {
  const tracker = new ChangeTracker();
  const url = `https://example.com/significance-${seq++}`;
  await tracker.createBaseline(url, before, options);
  return tracker.compareWithBaseline(url, after, options);
}

describe('price changes are scored by magnitude, not by page share', () => {
  test('a scoped price rise clears the default "moderate" notification threshold', async () => {
    const result = await compare(page('$19.99'), page('$29.99'), SCOPED);
    assert.equal(result.hasChanges, true);
    assert.equal(result.significance, 'major', '+50% is well past the major threshold');
  });

  test('an unscoped price change is no longer diluted into invisibility', async () => {
    const result = await compare(page('$19.99'), page('$29.99'), UNSCOPED);
    assert.equal(result.hasChanges, true, 'one changed price among 300 filler blocks must still register');
    assert.equal(result.significance, 'major');
  });

  test('a small price change is still reported, at moderate', async () => {
    // 1% — below the major cutoff but a real price move, and "moderate" is
    // exactly the default notification threshold.
    const result = await compare(page('$100.00'), page('$101.00'), SCOPED);
    assert.equal(result.significance, 'moderate');
  });

  test('magnitude is graded, not flattened', async () => {
    const small = await compare(page('$100.00'), page('$101.00'), SCOPED);
    const large = await compare(page('$100.00'), page('$400.00'), SCOPED);
    assert.equal(small.significance, 'moderate');
    assert.equal(large.significance, 'major', '+300% must outrank +1%');
  });

  test('the change is reported with both amounts so a caller can see why it fired', async () => {
    const result = await compare(page('$19.99'), page('$29.99'), SCOPED);
    const valueChanges = result.details.valueChanges;
    assert.ok(valueChanges, 'valueChanges must be surfaced in details');
    assert.equal(valueChanges.changes[0].before, '$19.99');
    assert.equal(valueChanges.changes[0].after, '$29.99');
    assert.equal(valueChanges.changes[0].relativeChange, 0.5);
  });

  test('a price that disappears is a change even though no pair can be measured', async () => {
    const result = await compare(page('$19.99'), page('Out of stock'), SCOPED);
    assert.equal(result.hasChanges, true);
    assert.equal(result.details.valueChanges.countChanged, true);
  });

  test('non-currency numbers are left to the volumetric score', async () => {
    // A view counter ticking up must not be scored like a price move, or every
    // check on a busy page fires.
    const before = page('$19.99', 'Viewed 1200 times today');
    const after = page('$19.99', 'Viewed 1274 times today');
    const result = await compare(before, after, UNSCOPED);
    assert.equal(result.details.valueChanges, null, 'bare numbers are not monetary values');
    assert.notEqual(result.significance, 'major');
  });

  test('an unchanged page is still unchanged', async () => {
    const result = await compare(page('$19.99'), page('$19.99'), SCOPED);
    assert.equal(result.hasChanges, false);
    assert.equal(result.significance, 'none');
  });

  test('a cosmetic edit near the price does not inherit price significance', async () => {
    const result = await compare(
      page('$19.99'),
      page('$19.99').replace('lorem ipsum', 'LOREM IPSUM'),
      SCOPED
    );
    assert.equal(result.significance, 'none', 'text outside the tracked selector is not a change');
  });

  test('non-dollar currencies are recognised', async () => {
    for (const [before, after] of [['£53.74', '£63.74'], ['€19,99', '€29,99'], ['1299.00 USD', '1499.00 USD']]) {
      const result = await compare(page(before), page(after), SCOPED);
      assert.equal(result.hasChanges, true, `${before} -> ${after} must register`);
      assert.ok(
        ['moderate', 'major'].includes(result.significance),
        `${before} -> ${after} scored ${result.significance}`
      );
    }
  });

  test('thousands separators do not inflate the magnitude', async () => {
    // "$1,299.00" must parse as 1299, not 1.299 — otherwise a trivial move
    // reads as a huge one.
    const result = await compare(page('$1,299.00'), page('$1,399.00'), SCOPED);
    assert.equal(result.details.valueChanges.changes[0].relativeChange, 0.077);
    assert.equal(result.significance, 'moderate', '+7.7% is not a major move');
  });
});

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

// R21 (2026-09-09): the text-change term read `change.added.length` off a diff
// GROUP ({type:'word_diff', changes:[...]}) and was therefore always 0. A JSON
// feed that grew by a whole record scored on similarity alone (84%) and
// compare answered hasChanges:false, "No significant changes detected".
describe('a text-only document that grows by a record registers as a change', () => {
  const FEED = { granularity: 'text', trackText: true, trackStructure: false, trackLinks: false, ignoreWhitespace: true };
  const event = (id, place) =>
    `{"type":"Feature","properties":{"mag":1.2,"place":"${place}","time":1788983931030,"url":"https://example.com/eventpage/${id}","status":"automatic","tsunami":0,"sig":16,"net":"nc","code":"${id}","ids":",${id},","sources":",nc,","types":",nearby-cities,origin,phase-data,"},"geometry":{"type":"Point","coordinates":[-122.8,38.8,2.1]},"id":"${id}"}`;
  const feed = (generated, events) => `{"type":"FeatureCollection","metadata":{"generated":${generated},"count":${events.length}},"features":[${events.join(',')}]}`;
  const base = Array.from({ length: 14 }, (_, i) => event(`nc${i}`, `${i} km NW of The Geysers, CA`));

  test('a new record in the feed is a change', async () => {
    const before = feed(1788984014000, base);
    const after = feed(1788984134000, [...base, event('nc75432747', '11 km NW of The Geysers, CA'), event('nc75432748', '4 km E of Anza, CA')]);
    const result = await compare(before, after, FEED);
    assert.equal(result.hasChanges, true, 'two new records must register');
    assert.notEqual(result.significance, 'none');
    assert.ok(result.summary.totalChanges > 0);
  });

  test('a rotated timestamp alone is not', async () => {
    const result = await compare(feed(1788984014000, base), feed(1788984134000, base), FEED);
    assert.equal(result.significance, 'none', 'a 13-digit timestamp is not a material change');
    assert.equal(result.hasChanges, false);
  });
});

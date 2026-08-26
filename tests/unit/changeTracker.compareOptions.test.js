/**
 * Unit tests for three defects found live on 2026-08-26 (Zillow / Newegg).
 *
 * Run: node --test tests/unit/changeTracker.compareOptions.test.js
 *
 * Regressions covered:
 *   - customSelectors supplied only at compare time were silently ignored, so a
 *     scoped compare returned results byte-identical to an unscoped one with
 *     nothing indicating the scoping never ran.
 *   - element-level indexing used a fixed tag allowlist (h1-h6, p, div, span,
 *     a), so scoping to any other tag indexed 0 elements and no element change
 *     could ever be reported. Zillow: customSelectors ['address'] -> elements 0,
 *     while the same selector matched 41 nodes via scrape_structured.
 *   - an unchanged compare reported changeDescription "Text content changed"
 *     alongside hasChanges:false and totalChanges:0, because sub-threshold
 *     token noise still populates textChanges.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeTracker } from '../../src/core/ChangeTracker.js';

/** Listing page whose prices sit in <address> tags, with volatile page chrome. */
function listings({ price = '$689,000', token = 'req_AAA' } = {}) {
  return `<html><body>
    <div id="chrome"><span>${token}</span></div>
    <address>4907 Watusi Bnd — ${price}</address>
    <address>6113 Perlita Dr — $360,000</address>
    ${'<div class="filler"><p>lorem ipsum dolor sit amet</p></div>'.repeat(50)}
  </body></html>`;
}

const ADDRESS_SCOPED = {
  granularity: 'element',
  customSelectors: ['address'],
  trackText: true,
  trackStructure: false,
  trackLinks: false
};

test('non-div selectors are indexed instead of silently matching zero elements', async () => {
  const tracker = new ChangeTracker();
  const baseline = await tracker.createBaseline(
    'https://example.com/addr-index', listings(), ADDRESS_SCOPED
  );

  assert.equal(baseline.elements, 2, 'both <address> elements should be indexed');
  assert.ok(!baseline.warnings, 'selector matched, so no fallback warning');
});

test('a real change inside a non-div scoped selector is detected', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/addr-change';
  await tracker.createBaseline(url, listings(), ADDRESS_SCOPED);

  const result = await tracker.compareWithBaseline(
    url, listings({ price: '$725,000' }), ADDRESS_SCOPED
  );

  assert.equal(result.hasChanges, true);
  assert.ok(result.metrics.modifiedElements > 0, 'the changed <address> must register');
  assert.equal(result.details.valueChanges?.changes?.[0]?.before, '$689,000');
  assert.equal(result.details.valueChanges?.changes?.[0]?.after, '$725,000');
});

test('noise outside a non-div scoped selector is not a change', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/addr-noise';
  await tracker.createBaseline(url, listings(), ADDRESS_SCOPED);

  const result = await tracker.compareWithBaseline(
    url, listings({ token: 'req_ZZZ' }), ADDRESS_SCOPED
  );

  assert.equal(result.hasChanges, false);
  assert.equal(result.metrics.modifiedElements, 0);
});

test('compare-time options that differ from the baseline are reported, not silently dropped', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/ignored-opts';
  await tracker.createBaseline(url, listings(), { granularity: 'element', trackText: true });

  const result = await tracker.compareWithBaseline(url, listings(), {
    granularity: 'element',
    customSelectors: ['address'],
    trackText: true
  });

  assert.ok(result.warnings?.length, 'compare-time customSelectors must be reported as ignored');
  assert.match(result.warnings[0], /customSelectors/);
  assert.match(result.warnings[0], /ignored/);
});

test('matching compare-time options produce no warning', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/matching-opts';
  await tracker.createBaseline(url, listings(), ADDRESS_SCOPED);

  const result = await tracker.compareWithBaseline(url, listings(), ADDRESS_SCOPED);

  assert.ok(!result.warnings, 'identical options are applied, so nothing was ignored');
});

test('an unchanged compare does not claim text content changed', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/desc-consistency';
  await tracker.createBaseline(url, listings(), { granularity: 'element', trackText: true });

  // Token-only churn: below the change threshold, but it still populates
  // textChanges, which is what used to leak into the description.
  const result = await tracker.compareWithBaseline(url, listings({ token: 'req_ZZZ' }), {
    granularity: 'element',
    trackText: true
  });

  // totalChanges can be non-zero here: the token churn does modify elements,
  // but stays under the significance threshold. The description has to agree
  // with the verdict the caller acts on (hasChanges), not with the raw counts.
  assert.equal(result.hasChanges, false);
  assert.equal(result.significance, 'none');
  assert.equal(result.summary.changeDescription, 'No significant changes detected');
});

test('a real change still describes what changed', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/desc-real';
  await tracker.createBaseline(url, listings(), ADDRESS_SCOPED);

  const result = await tracker.compareWithBaseline(
    url, listings({ price: '$725,000' }), ADDRESS_SCOPED
  );

  assert.equal(result.hasChanges, true);
  assert.match(result.summary.changeDescription, /modified|changed/i);
  assert.notEqual(result.summary.changeDescription, 'No significant changes detected');
});

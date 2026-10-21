/**
 * Live sweep 4.1: textChanges diffed the raw HTML, so a class rename or icon
 * markup showed up as a text change. textChanges now diffs the visible text;
 * the raw markup diff is returned as markupChanges only on request.
 *
 * Run: node --test tests/unit/trackChangesTextDiff.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeTracker } from '../../src/core/ChangeTracker.js';

const page = (cls, price) => `<html><body><div class="${cls}"><h1>Widget</h1>` +
  `<p><i class="icon-ok"></i> Price: <b>${price}</b></p></div></body></html>`;

async function compare(before, after, options = {}, compareOptions = {}) {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/product';
  await tracker.createBaseline(url, before, options);
  return tracker.compareWithBaseline(url, after, compareOptions);
}

describe('track_changes text diff (live sweep 4.1)', () => {
  test('changing a class attribute alone gives no textChanges', async () => {
    const result = await compare(page('col-sm-6', '$19.99'), page('col-md-4', '$19.99'));
    assert.deepEqual(result.details.textChanges, []);
    assert.equal(result.details.markupChanges, undefined);
  });

  test('changing a price gives textChanges with no markup in them', async () => {
    const result = await compare(page('col-sm-6', '$19.99'), page('col-sm-6', '$24.99'));
    const changes = result.details.textChanges.flatMap(group => group.changes);
    const values = changes.map(c => c.value || '');
    assert.ok(changes.some(c => c.added && c.value.includes('24')));
    assert.doesNotMatch(values.join(' '), /<|class=/);
  });

  test('markupChanges is returned when includeMarkupChanges is requested', async () => {
    const atCompare = await compare(page('col-sm-6', '$19.99'), page('col-md-4', '$19.99'), {}, { includeMarkupChanges: true });
    assert.deepEqual(atCompare.details.textChanges, []);
    const markup = atCompare.details.markupChanges.flatMap(group => group.changes.map(c => c.value || '')).join(' ');
    assert.match(markup, /md/);

    const atBaseline = await compare(page('col-sm-6', '$19.99'), page('col-md-4', '$19.99'), { includeMarkupChanges: true });
    assert.ok(atBaseline.details.markupChanges.length > 0);
  });
});

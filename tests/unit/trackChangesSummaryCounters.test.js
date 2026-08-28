/**
 * Unit tests for the track_changes summary counters.
 *
 * Run: node --test tests/unit/trackChangesSummaryCounters.test.js
 *
 * Regression covered:
 *   - generateChangeSummary built totalChanges from the three element counters
 *     only, so a compare whose entire diff was textual (httpbin.org/uuid: the
 *     old UUID removed, the new one added) returned hasChanges:true with a
 *     ten-segment details.textChanges next to totalChanges/added/removed/
 *     modified all 0. Anything alerting on the summary counters never fired.
 *
 * All four counters are raw: they report what the diff holds, exactly as the
 * three element counters already did below the significance threshold, and
 * hasChanges alone reports whether the change cleared it. Zeroing textChanges
 * on a 'none' verdict would put the same contradiction back at a smaller scale.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeTracker } from '../../src/core/ChangeTracker.js';

/** What httpbin.org/uuid returns — a document that is nothing but one token. */
const uuidPage = (uuid) => `{\n  "uuid": "${uuid}"\n}`;

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

/** A long stable page carrying one volatile token, as page chrome does. */
const noisyPage = (token) =>
  `<html><body><p>Session ${token}</p>` +
  '<p>Stable paragraph of documentation copy that never changes between checks.</p>'.repeat(300) +
  '</body></html>';

const STATIC_PAGE =
  '<html><body><h1>Example Domain</h1>' +
  '<p>This domain is for use in illustrative examples.</p></body></html>';

test('a text-only change is counted in totalChanges instead of reporting zero', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://httpbin.org/uuid';
  await tracker.createBaseline(url, uuidPage(UUID_A));

  const result = await tracker.compareWithBaseline(url, uuidPage(UUID_B));

  const wordDiff = result.details.textChanges.find(c => c.type === 'word_diff');
  assert.ok(wordDiff && wordDiff.changes.length > 0, 'fixture must produce a word-level diff');

  assert.equal(result.hasChanges, true);
  assert.equal(result.summary.added, 0, 'no elements were added');
  assert.equal(result.summary.removed, 0, 'no elements were removed');
  assert.equal(result.summary.modified, 0, 'no elements were modified');
  assert.equal(
    result.summary.textChanges,
    wordDiff.changes.length,
    'textChanges must match the diff the caller is shown'
  );
  assert.ok(
    result.summary.totalChanges > 0,
    `summary must not report zero changes beside a populated diff, got ${result.summary.totalChanges}`
  );
});

test('totalChanges is the sum of the element counters and textChanges', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/summary-sum';
  const options = {
    granularity: 'element',
    customSelectors: ['address'],
    trackText: true,
    trackStructure: false,
    trackLinks: false
  };
  const listing = (price) =>
    `<html><body><address>4907 Watusi Bnd — ${price}</address>` +
    '<div class="filler"><p>lorem ipsum dolor sit amet</p></div>'.repeat(50) +
    '</body></html>';

  await tracker.createBaseline(url, listing('$689,000'), options);
  const result = await tracker.compareWithBaseline(url, listing('$725,000'), options);

  const { totalChanges, added, removed, modified, textChanges } = result.summary;
  assert.equal(result.hasChanges, true);
  assert.ok(modified > 0, 'fixture must modify an element');
  assert.ok(textChanges > 0, 'fixture must also change text');
  assert.equal(totalChanges, added + removed + modified + textChanges);
});

test('an unchanged page still reports hasChanges:false with zero counters', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/static';
  await tracker.createBaseline(url, STATIC_PAGE);

  const result = await tracker.compareWithBaseline(url, STATIC_PAGE);

  assert.equal(result.hasChanges, false);
  assert.equal(result.significance, 'none');
  assert.deepEqual(
    {
      totalChanges: result.summary.totalChanges,
      added: result.summary.added,
      removed: result.summary.removed,
      modified: result.summary.modified,
      textChanges: result.summary.textChanges
    },
    { totalChanges: 0, added: 0, removed: 0, modified: 0, textChanges: 0 }
  );
});

test('sub-threshold text noise is counted raw, with the verdict left to hasChanges', async () => {
  const tracker = new ChangeTracker();
  const url = 'https://example.com/token-noise';
  await tracker.createBaseline(url, noisyPage('req_AAA'));

  const result = await tracker.compareWithBaseline(url, noisyPage('req_ZZZ'));

  // The counters report what the diff holds — suppressing them here would put
  // back the contradiction this file exists to prevent, just at a smaller
  // scale. Only changeDescription defers to the verdict, matching how the
  // element counters already behave below the significance threshold.
  const wordDiff = result.details.textChanges.find(c => c.type === 'word_diff');
  assert.ok(wordDiff && wordDiff.changes.length > 0, 'fixture must produce a raw text diff');

  assert.equal(result.hasChanges, false);
  assert.equal(result.significance, 'none');
  assert.equal(result.summary.textChanges, wordDiff.changes.length);
  assert.equal(result.summary.totalChanges, wordDiff.changes.length);
  assert.equal(result.summary.changeDescription, 'No significant changes detected');
});

test('countTextChanges counts capped-away entries instead of reporting the cap', () => {
  const tracker = new ChangeTracker();

  const count = tracker.countTextChanges([
    {
      type: 'word_diff',
      changes: [
        { added: true, value: 'new' },
        { removed: true, value: 'old' },
        { omittedEntries: 148, note: '148 further changes omitted' }
      ]
    }
  ]);

  assert.equal(count, 150);
});

test('countTextChanges takes the word diff, not word plus line', () => {
  const tracker = new ChangeTracker();

  const count = tracker.countTextChanges([
    { type: 'word_diff', changes: [{ added: true, value: 'new' }, { removed: true, value: 'old' }] },
    { type: 'line_diff', changes: [{ added: true, value: 'new line' }, { removed: true, value: 'old line' }] }
  ]);

  assert.equal(count, 2, 'the two diffs describe the same edit at two granularities');
});

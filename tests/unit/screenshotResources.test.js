/**
 * Unit tests for src/server/screenshotResources.js (Phase 0, 0.4): every
 * copy of a screenshot's base64 leaves the scrape_with_actions result and
 * the bytes are published once per actionId.
 *
 * Run: node --test tests/unit/screenshotResources.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripScreenshotData } from '../../src/server/screenshotResources.js';

const B64 = Buffer.from('not really a jpeg but long enough to be unmistakable').toString('base64');

function fakeResult() {
  const shot = { actionId: 'act_1', data: B64, format: 'jpeg', fullPage: false, timestamp: 1 };
  const errorShot = { actionId: 'act_err', data: B64, format: 'png', error: true };
  const screenshots = [shot, errorShot];
  const actionResult = { id: 'act_1', type: 'screenshot', success: true, result: { data: B64, format: 'jpeg', fullPage: false } };
  return {
    success: false,
    screenshots,
    actionResults: [actionResult, { id: 'act_2', type: 'click', success: false, result: { data: 'clicked' } }],
    attempts: [{ attempt: 1, success: false, results: [actionResult] }],
    content: { json: {}, screenshots },
    metadata: { screenshotsCount: 2 }
  };
}

test('data is gone from every copy and each copy carries the resource URI', () => {
  const stored = [];
  const result = stripScreenshotData(fakeResult(), (id, data) => stored.push({ id, data }));

  assert.ok(!JSON.stringify(result).includes(B64), 'no base64 anywhere in the result');
  for (const shot of [result.screenshots[0], result.actionResults[0].result, result.content.screenshots[0], result.attempts[0].results[0].result]) {
    assert.equal(shot.data, undefined);
    assert.equal(shot.resourceUri, 'crawlforge://screenshot/act_1');
  }
  assert.equal(result.screenshots[1].resourceUri, 'crawlforge://screenshot/act_err', 'the error screenshot is published too');
  assert.equal(result.screenshots[1].error, true);
  assert.equal(result.actionResults[0].result.format, 'jpeg', 'the other fields survive');
});

test('each actionId is published exactly once, with its bytes', () => {
  const stored = [];
  stripScreenshotData(fakeResult(), (id, data) => stored.push({ id, data }));
  assert.deepEqual(stored.map((s) => s.id), ['act_1', 'act_err']);
  assert.equal(stored[0].data, B64);
});

test('non-screenshot action results and results without screenshots are untouched', () => {
  const stored = [];
  const result = stripScreenshotData(fakeResult(), (id, data) => stored.push(id));
  assert.equal(result.actionResults[1].result.data, 'clicked', 'a click result keeps its data');

  const bare = stripScreenshotData({ success: true, actionResults: [], content: { json: {} } }, () => { throw new Error('must not publish'); });
  assert.deepEqual(bare, { success: true, actionResults: [], content: { json: {} } });
});

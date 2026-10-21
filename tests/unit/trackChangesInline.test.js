/**
 * Live sweep 2026-10-20, 4.2: track_changes compare ignored max_inline_chars.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test --test-force-exit tests/unit/trackChangesInline.test.js
 *
 * A Hacker News compare with max_inline_chars:4000 came back as about 15 KB
 * inline: the track_changes rule shaped list operations only. No network:
 * the handler is stubbed, the store is a temp-dir ResultStore.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResultStore, setResultStoreForTests } from '../../src/core/ResultStore.js';
import { readResultHandler } from '../../src/tools/result/readResult.js';
import { makeWithAuth } from '../../src/server/withAuth.js';
import authManager from '../../src/core/AuthManager.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawlforge-track-inline-'));
const store = new ResultStore({ baseDir: dir });
before(() => setResultStoreForTests(store));
after(() => {
  setResultStoreForTests(null);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const withAuth = makeWithAuth({
  authManager: {
    isCreatorMode: () => false,
    getToolCost: (name, params) => authManager.getToolCost(name, params),
    projectCost: (name, params) => authManager.projectCost(name, params),
    checkCredits: async () => true,
    reportUsage: async () => {},
    creditCache: new Map([['key', 1_000_000]])
  },
  logger: { info() {}, warn() {}, error() {}, debug() {} }
});

// The shape compareWithBaseline returns, with a large diff under details.
const compare = {
  success: true, operation: 'compare', url: 'https://news.ycombinator.com/',
  hasChanges: true, significance: 'major', changeType: 'content',
  summary: { totalChanges: 300, added: 150, removed: 150 },
  details: { textChanges: Array.from({ length: 300 }, (_, i) => ({ type: i % 2 ? 'added' : 'removed', text: `Story ${i} `.repeat(4) })) },
  metrics: { changePercentage: 42 },
  recommendations: [],
  snapshot: null, timestamp: 1760000000000
};

for (const operation of ['compare', undefined]) {
  test(`a large compare (operation ${operation ?? 'defaulted'}) is truncated with a working handle`, async () => {
    const params = { url: compare.url, max_inline_chars: 4000, ...(operation ? { operation } : {}) };
    const handler = withAuth('track_changes', async () => ({ content: [{ type: 'text', text: JSON.stringify(compare, null, 2) }] }));
    const sent = await handler(params);
    const body = JSON.parse(sent.content[0].text);

    assert.equal(body.truncated, true);
    assert.match(body.result_handle, /^res_/);
    assert.equal(body.hasChanges, true);
    assert.equal(body.significance, 'major');
    assert.deepEqual(body.summary, compare.summary);
    assert.deepEqual(body.metrics, compare.metrics);
    assert.equal('details' in body, false);
    assert.ok(body.preview.length <= 4000);

    const out = await readResultHandler({ handle: body.result_handle, operation: 'json_path', path: 'details.textChanges[299].text' });
    assert.notEqual(out.isError, true, out.content[0].text);
    assert.equal(JSON.parse(out.content[0].text).value, compare.details.textChanges[299].text);
  });
}

test('a create_baseline result stays whole', async () => {
  const baseline = { success: true, operation: 'create_baseline', url: compare.url, note: 'x'.repeat(6000) };
  const handler = withAuth('track_changes', async () => ({ content: [{ type: 'text', text: JSON.stringify(baseline) }] }));
  const body = JSON.parse((await handler({ url: compare.url, operation: 'create_baseline', max_inline_chars: 4000 })).content[0].text);
  assert.equal(body.truncated, undefined);
  assert.equal(body.note, baseline.note);
});

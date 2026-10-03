/**
 * Live test R24 (2026-10-03), plan items 2.7 and 2.8 — track_changes
 * parameters and operations that did nothing:
 *   2.7 create_alert_rule accepted any string, and `significance >= minor`
 *       (unquoted) never fired; templateId kept the schema's default
 *       trackingOptions instead of the template's.
 *   2.8 get_stats counted every compare as a change; get_history hung every
 *       snapshot id on the newest entry; the text diff ran over <script> and
 *       <style>.
 *
 * Run: node --test tests/unit/trackChangesR24.test.js
 * Everything runs on supplied html/content; no network.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { TrackChangesTool } from '../../src/tools/tracking/trackChanges/index.js';
import { TrackChangesSchema } from '../../src/tools/tracking/trackChanges/schema.js';
import { mergeHistoryData } from '../../src/tools/tracking/trackChanges/differ.js';
import { ChangeTracker, MONITORING_TEMPLATES } from '../../src/core/ChangeTracker.js';

const tmp = (label) => path.join(os.tmpdir(), `tc-r24-${label}-${Math.random().toString(36).slice(2)}`);
const page = (css, js, body) =>
  `<html><head><style>${css}</style><script>${js}</script></head><body><main><p>${body}</p></main></body></html>`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let tool;
before(() => {
  tool = new TrackChangesTool({
    snapshotStorageDir: tmp('snap'), monitorStorageDir: tmp('mon'),
    resolveHostedCredentials: async () => { throw new Error('offline: no hosted credentials'); }
  });
});
after(async () => {
  if (tool) await tool.shutdown().catch(() => {});
});

// The MCP layer parses arguments with the registered schema before the tool
// sees them, so every call here goes through the same parse first.
const call = (params) => tool.execute(TrackChangesSchema.parse(params));
const ok = (r, what) => assert.equal(r.success, true, `${what} failed: ${r.error}`);

describe('2.7 alert rule conditions are validated at creation', () => {
  const URL = 'https://example.com/r24/alerts';

  test('the unquoted form is accepted and fires', async () => {
    ok(await call({ url: URL, operation: 'create_baseline', content: 'Plan A costs $10 per month.' }), 'baseline');
    const rule = await call({
      url: URL, operation: 'create_alert_rule',
      alertRuleOptions: { ruleId: 'unquoted', condition: 'significance >= minor', throttle: 0 }
    });
    ok(rule, 'create_alert_rule');
    assert.equal(rule.rule.condition, 'significance >= minor');
    const changed = await call({ url: URL, operation: 'compare', content: 'Plan A costs $25 per month. Plan B is new.' });
    assert.equal(changed.hasChanges, true);
    assert.deepEqual(changed.alerts?.map((a) => a.ruleId), ['unquoted']);
  });

  test('a condition outside the grammar is refused and names the grammar', async () => {
    for (const condition of ['bananas are yellow', 'significance >= "huge"', 'similarity < 0.5', 'significance >= "minor" && true', 'significance >= toString']) {
      const r = await call({ url: URL, operation: 'create_alert_rule', alertRuleOptions: { ruleId: 'bad', condition } });
      assert.equal(r.success, false, `"${condition}" was accepted`);
      assert.match(r.error, /Invalid alert condition/);
      assert.match(r.error, /significance <operator> <level>/);
      assert.match(r.error, /none, minor, moderate, major, critical/);
    }
    assert.equal(tool.changeTracker.alertRules.has('bad'), false);
  });

  test('an omitted condition still defaults to significance === "major"', async () => {
    const r = await call({ url: URL, operation: 'create_alert_rule', alertRuleOptions: { ruleId: 'defaulted' } });
    ok(r, 'create_alert_rule');
    assert.equal(r.rule.condition, 'significance === "major"');
  });

  test('parseAlertCondition treats quoted and bare levels alike', () => {
    for (const text of ['significance >= "moderate"', "significance >= 'moderate'", 'significance >= moderate', '  significance>=moderate ']) {
      const matches = ChangeTracker.parseAlertCondition(text);
      assert.equal(matches({ significance: 'major' }), true, text);
      assert.equal(matches({ significance: 'minor' }), false, text);
    }
    assert.throws(() => ChangeTracker.parseAlertCondition('significance >= "moderate\''), /Invalid alert condition/);
  });
});

describe('2.7 a template beats schema defaults, an explicit value beats the template', () => {
  const URL = 'https://example.com/r24/template';

  test('price-watch keeps its own trackingOptions', async () => {
    const r = await call({ url: URL, operation: 'create_scheduled_monitor', scheduledMonitorOptions: { templateId: 'price-watch' } });
    ok(r, 'create_scheduled_monitor');
    const preset = MONITORING_TEMPLATES['price-watch'].options;
    for (const key of ['granularity', 'trackText', 'trackStructure', 'trackLinks', 'ignoreWhitespace']) {
      assert.equal(r.monitor.trackingOptions[key], preset[key], key);
    }
    assert.deepEqual(r.monitor.trackingOptions.significanceThresholds, preset.significanceThresholds);
    ok(await call({ operation: 'stop_scheduled_monitor', url: URL }), 'stop');
  });

  test('explicit trackingOptions win, including one equal to the schema default', async () => {
    const r = await call({
      url: URL, operation: 'create_scheduled_monitor',
      scheduledMonitorOptions: { templateId: 'price-watch' },
      trackingOptions: { granularity: 'section', trackLinks: true }
    });
    ok(r, 'create_scheduled_monitor');
    assert.equal(r.monitor.trackingOptions.granularity, 'section');
    assert.equal(r.monitor.trackingOptions.trackLinks, true);
    assert.equal(r.monitor.trackingOptions.trackStructure, false, 'untouched options stay the template\'s');
    ok(await call({ operation: 'stop_scheduled_monitor', url: URL }), 'stop');
  });

  test('without a template the documented defaults still apply to the baseline', async () => {
    const r = await call({ url: 'https://example.com/r24/defaults', operation: 'create_baseline', content: '<main><p>Hello</p></main>' });
    ok(r, 'create_baseline');
    assert.equal(r.baseline.options.granularity, 'section');
    assert.equal(r.baseline.options.trackText, true);
    assert.equal(r.baseline.options.trackStructure, true);
    assert.equal(r.baseline.options.trackLinks, true);
    assert.equal(r.baseline.options.ignoreWhitespace, true);
    assert.equal(r.baseline.options.ignoreCase, false);
    assert.ok(r.baseline.options.excludeSelectors.includes('#comments'));
  });
});

describe('2.8 stats, history and the text diff', () => {
  const URL = 'https://example.com/r24/stats';
  let changedOnce, changedTwice;

  test('a change only inside <script>/<style> is not a change', async () => {
    ok(await call({ url: URL, operation: 'create_baseline', html: page('.a{color:red}', 'var token=1;', 'Widget costs $10 today') }), 'baseline');
    const noise = await call({ url: URL, operation: 'compare', html: page('.a{color:blue}', 'var token=2;', 'Widget costs $10 today') });
    ok(noise, 'compare');
    assert.equal(noise.hasChanges, false, JSON.stringify(noise.details.textChanges));
    assert.deepEqual(noise.details.textChanges, []);
  });

  test('a real change is diffed without the script and style text', async () => {
    await sleep(5);
    changedOnce = await call({ url: URL, operation: 'compare', html: page('.a{color:green}', 'var token=3;', 'Widget costs $30 today and ships free') });
    ok(changedOnce, 'compare');
    assert.equal(changedOnce.hasChanges, true);
    const diffed = JSON.stringify(changedOnce.details.textChanges);
    assert.match(diffed, /30/);
    assert.doesNotMatch(diffed, /green|token|color/);
    await sleep(5);
    changedTwice = await call({ url: URL, operation: 'compare', content: page('.a{color:green}', 'var token=4;', 'Sold out') });
    assert.equal(changedTwice.hasChanges, true);
  });

  test('a fragment with a script diffs the same as one without', async () => {
    const url = 'https://example.com/r24/fragment';
    ok(await call({ url, operation: 'create_baseline', content: '<p>Same text here</p>' }), 'baseline');
    const r = await call({ url, operation: 'compare', content: '<p>Same text here</p><script>var t=9;</script>' });
    assert.equal(r.hasChanges, false, JSON.stringify(r.details.textChanges));
    assert.deepEqual(r.details.textChanges, []);
  });

  test('get_stats counts compares and changes separately', async () => {
    const r = await call({ url: URL, operation: 'get_stats' });
    ok(r, 'get_stats');
    assert.ok(r.stats.changeTracking.changesDetected < r.stats.changeTracking.comparisons);
    assert.equal(r.stats.urlSpecific.totalCompares, 3);
    assert.equal(r.stats.urlSpecific.totalChanges, 2);
    assert.equal(r.stats.urlSpecific.significanceDistribution.none, 1);
    assert.ok(r.stats.urlSpecific.lastChange >= changedTwice.timestamp - 1000);
  });

  test('a fresh tracker reports changesDetected 0 after an unchanged compare', async () => {
    const tracker = new ChangeTracker();
    await tracker.createBaseline(URL, 'unchanged text');
    await tracker.compareWithBaseline(URL, 'unchanged text');
    assert.equal(tracker.getStats().comparisons, 1);
    assert.equal(tracker.getStats().changesDetected, 0);
    assert.equal(tracker.getStats().contentChanges, 0);
    await tracker.compareWithBaseline(URL, 'entirely different words now appear in this document');
    assert.equal(tracker.getStats().comparisons, 2);
    assert.equal(tracker.getStats().changesDetected, 1);
  });

  test('get_history puts each snapshot id on the compare that stored it', async () => {
    const r = await call({ url: URL, operation: 'get_history' });
    ok(r, 'get_history');
    assert.equal(r.history.length, 3);
    const [newest, middle, oldest] = r.history;
    assert.equal(newest.snapshotId, changedTwice.snapshot.snapshotId);
    assert.equal(middle.snapshotId, changedOnce.snapshot.snapshotId);
    assert.equal(oldest.significance, 'none');
    assert.equal(oldest.hasSnapshot, false);
    assert.equal(oldest.snapshotId, undefined);
  });

  test('mergeHistoryData: one snapshot per changed compare, never an unchanged one', () => {
    const t = 1_000_000;
    const changes = [
      { timestamp: t + 300, significance: 'major' },
      { timestamp: t + 200, significance: 'none' },
      { timestamp: t + 100, significance: 'minor' }
    ];
    const snapshots = [
      { timestamp: t + 310, snapshotId: 'snap-major' },
      { timestamp: t + 190, snapshotId: 'snap-minor' },
      { timestamp: t - 500_000, snapshotId: 'snap-old' }
    ];
    const merged = mergeHistoryData(changes, snapshots);
    assert.deepEqual(
      merged.map((e) => [e.significance ?? e.source, e.snapshotId ?? null]),
      [['major', 'snap-major'], ['none', null], ['minor', 'snap-minor'], ['snapshot', 'snap-old']]
    );
  });
});

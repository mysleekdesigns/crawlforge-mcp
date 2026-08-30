/**
 * Regression tests: the five track_changes operations that had no backing
 * implementation — get_dashboard, export_history, create_alert_rule,
 * generate_trend_report and get_monitoring_templates — plus the templateId
 * preset on create_scheduled_monitor and the alerts a compare fires.
 *
 * Run: node --test tests/unit/trackChangesOperations.test.js
 *
 * Found by the 2026-08-30 live matrix: every one of them returned
 * `success:false` with "this.changeTracker.<method> is not a function" /
 * "Cannot read properties of undefined (reading 'set'|'entries')" — the tool
 * had called ChangeTracker methods that were never written (since v3.1.0).
 * Everything here runs on content-based baselines; no network.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { TrackChangesTool } from '../../src/tools/tracking/trackChanges/index.js';
import { ChangeTracker, MONITORING_TEMPLATES } from '../../src/core/ChangeTracker.js';

const tmp = (label) => path.join(os.tmpdir(), `tc-ops-${label}-${Math.random().toString(36).slice(2)}`);
const URL_A = 'https://example.com/ops/pricing';
const URL_B = 'https://example.com/ops/docs';

let tool;
before(() => {
  tool = new TrackChangesTool({ snapshotStorageDir: tmp('snap'), monitorStorageDir: tmp('mon') });
});
after(async () => {
  if (tool) await tool.shutdown().catch(() => {});
});

const ok = (r, what) => assert.equal(r.success, true, `${what} failed: ${r.error}`);

describe('track_changes — alert rules fire from compare', () => {
  test('create_alert_rule registers the rule and a matching compare returns alerts', async () => {
    ok(await tool.execute({ url: URL_A, operation: 'create_baseline', content: 'Plan A costs $10 per month. Plan B costs $20 per month.' }), 'baseline');
    const rule = await tool.execute({
      url: URL_A, operation: 'create_alert_rule',
      alertRuleOptions: { ruleId: 'any-change', condition: 'significance >= "minor"', actions: ['webhook'], throttle: 0, priority: 'high' }
    });
    ok(rule, 'create_alert_rule');
    assert.equal(rule.ruleId, 'any-change');
    assert.equal(rule.rule.condition, 'significance >= "minor"');
    assert.equal(rule.rule.url, URL_A);

    const changed = await tool.execute({ url: URL_A, operation: 'compare', content: 'Plan A costs $15 per month. Plan B costs $20 per month. New plan C is $99.' });
    ok(changed, 'compare');
    assert.equal(changed.hasChanges, true);
    assert.ok(Array.isArray(changed.alerts) && changed.alerts.length === 1, `expected one alert, got ${JSON.stringify(changed.alerts)}`);
    assert.equal(changed.alerts[0].ruleId, 'any-change');
    assert.equal(changed.alerts[0].priority, 'high');
  });

  test('an unchanged compare fires nothing, and a url-scoped rule ignores other pages', async () => {
    // In-process, every compare diffs against the baseline (the snapshot only
    // rolls it forward for a later process), so "unchanged" = the baseline text.
    const same = await tool.execute({ url: URL_A, operation: 'compare', content: 'Plan A costs $10 per month. Plan B costs $20 per month.' });
    ok(same, 'compare');
    assert.equal(same.hasChanges, false);
    assert.equal(same.alerts, undefined);

    ok(await tool.execute({ url: URL_B, operation: 'create_baseline', content: 'GET /v1/items returns a list.' }), 'baseline B');
    const other = await tool.execute({ url: URL_B, operation: 'compare', content: 'GET /v2/items returns a paginated list with cursors.' });
    ok(other, 'compare B');
    assert.equal(other.hasChanges, true);
    assert.equal(other.alerts, undefined, 'rule scoped to URL_A must not fire for URL_B');
  });

  test('throttle suppresses a second firing inside the window', async () => {
    ok(await tool.execute({ url: URL_B, operation: 'create_alert_rule', alertRuleOptions: { ruleId: 'docs-throttled', condition: 'significance !== "none"', throttle: 60000 } }), 'rule');
    const first = await tool.execute({ url: URL_B, operation: 'compare', content: 'GET /v3/items — everything changed again, entirely new text here.' });
    assert.equal(first.alerts?.length, 1);
    const second = await tool.execute({ url: URL_B, operation: 'compare', content: 'GET /v4/items — and changed once more, different words this time.' });
    assert.equal(second.hasChanges, true);
    assert.equal(second.alerts, undefined, 'throttled rule must not fire twice within 60s');
  });
});

describe('track_changes — dashboard, export, trend report', () => {
  test('get_dashboard aggregates tracked pages, rules, alerts and monitors', async () => {
    const r = await tool.execute({ operation: 'get_dashboard', dashboardOptions: { includeRecentAlerts: true, includeTrends: true, includeMonitorStatus: true } });
    ok(r, 'get_dashboard');
    const d = r.dashboard;
    assert.equal(d.summary.trackedUrls, 2);
    assert.equal(d.summary.alertRules, 2);
    assert.ok(d.summary.alertsFired >= 2);
    assert.ok(d.tracked.some(t => t.url === URL_A && t.changes >= 1));
    assert.ok(Array.isArray(d.recentAlerts) && d.recentAlerts.length >= 2);
    assert.ok(Array.isArray(d.trends) && d.trends.length === 2);
    assert.ok(Array.isArray(d.monitors));
  });

  test('dashboardOptions:false flags drop the optional sections', async () => {
    const r = await tool.execute({ operation: 'get_dashboard', dashboardOptions: { includeRecentAlerts: false, includeTrends: false, includeMonitorStatus: false } });
    ok(r, 'get_dashboard');
    assert.equal(r.dashboard.recentAlerts, undefined);
    assert.equal(r.dashboard.trends, undefined);
  });

  test('export_history returns records as json and as csv', async () => {
    const json = await tool.execute({ url: URL_A, operation: 'export_history', exportOptions: { format: 'json', includeSnapshots: true } });
    ok(json, 'export json');
    assert.equal(json.export.format, 'json');
    assert.ok(json.export.recordCount >= 2);
    assert.ok(json.export.records.every(rec => rec.url === URL_A && typeof rec.iso === 'string'));
    assert.ok(json.export.snapshots.length >= 1);

    const csv = await tool.execute({ operation: 'export_history', exportOptions: { format: 'csv' } });
    ok(csv, 'export csv');
    assert.equal(csv.export.scope, 'global');
    const lines = csv.export.csv.split('\n');
    assert.equal(lines[0].split(',')[0], 'url');
    assert.equal(lines.length, csv.export.recordCount + 1);
    assert.equal(csv.export.records, undefined, 'csv export carries no duplicate json rows');
  });

  test('export_history honours a time range', async () => {
    const future = await tool.execute({ operation: 'export_history', exportOptions: { format: 'json', startTime: Date.now() + 60000 } });
    ok(future, 'export');
    assert.equal(future.export.recordCount, 0);
  });

  test('generate_trend_report summarises one url or all of them', async () => {
    const one = await tool.execute({ url: URL_A, operation: 'generate_trend_report' });
    ok(one, 'trend');
    assert.equal(one.report.scope, URL_A);
    assert.equal(one.report.trends.length, 1);
    const t = one.report.trends[0];
    assert.ok(t.compares >= 2 && t.changes >= 1);
    assert.ok(t.significanceDistribution.none >= 1);
    assert.ok(Array.isArray(one.report.recommendations));

    const all = await tool.execute({ operation: 'generate_trend_report' });
    ok(all, 'trend global');
    assert.equal(all.report.urlCount, 2);

    const unknown = await tool.execute({ url: 'https://example.com/never-tracked', operation: 'generate_trend_report' });
    assert.equal(unknown.success, false);
    assert.match(unknown.error, /No tracking history/);
  });
});

describe('track_changes — monitoring templates', () => {
  test('get_monitoring_templates lists every built-in preset', async () => {
    const r = await tool.execute({ operation: 'get_monitoring_templates' });
    ok(r, 'get_monitoring_templates');
    assert.equal(r.count, Object.keys(MONITORING_TEMPLATES).length);
    for (const [id, preset] of Object.entries(MONITORING_TEMPLATES)) {
      assert.equal(r.templates[id].name, preset.name);
      assert.equal(r.templates[id].frequency, preset.frequency);
      assert.ok(r.templates[id].goal, `${id} carries a goal`);
    }
  });

  test('create_scheduled_monitor applies a templateId and lets explicit values win', async () => {
    const r = await tool.execute({
      url: 'https://example.com/ops/careers', operation: 'create_scheduled_monitor',
      scheduledMonitorOptions: { templateId: 'job-board', notificationThreshold: 'minor' }
    });
    ok(r, 'create_scheduled_monitor');
    assert.equal(r.templateId, 'job-board');
    assert.equal(r.monitor.interval, MONITORING_TEMPLATES['job-board'].frequency);
    assert.equal(r.monitor.goal, MONITORING_TEMPLATES['job-board'].goal);
    assert.equal(r.monitor.notificationThreshold, 'minor');
    ok(await tool.execute({ operation: 'stop_scheduled_monitor', url: 'https://example.com/ops/careers' }), 'stop');
  });

  test('an unknown templateId names the available presets', async () => {
    const r = await tool.execute({ url: 'https://example.com/x', operation: 'create_scheduled_monitor', scheduledMonitorOptions: { templateId: 'nope' } });
    assert.equal(r.success, false);
    assert.match(r.error, /Unknown monitoring template "nope"/);
    assert.match(r.error, /price-watch/);
  });
});

describe('ChangeTracker.parseAlertCondition', () => {
  const rec = (significance) => ({ significance });
  test('supports equality and the ordered comparisons on the significance ladder', () => {
    assert.equal(ChangeTracker.parseAlertCondition('significance === "major"')(rec('major')), true);
    assert.equal(ChangeTracker.parseAlertCondition('significance === "major"')(rec('minor')), false);
    assert.equal(ChangeTracker.parseAlertCondition('significance >= "moderate"')(rec('major')), true);
    assert.equal(ChangeTracker.parseAlertCondition('significance >= "moderate"')(rec('minor')), false);
    assert.equal(ChangeTracker.parseAlertCondition('significance < "moderate"')(rec('minor')), true);
    assert.equal(ChangeTracker.parseAlertCondition('significance != "none"')(rec('none')), false);
  });
  test('an unparseable condition never matches instead of throwing', () => {
    assert.equal(ChangeTracker.parseAlertCondition('not a condition at all')(rec('critical')), false);
    assert.equal(ChangeTracker.parseAlertCondition('significance === "huge"')(rec('critical')), false);
  });
});

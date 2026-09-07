/**
 * Hosted scheduled monitors (Phase 6.1) and the honest email notifier (6.2).
 * Run: node --test tests/unit/trackChangesHosted.test.js
 *
 * The website is stood in for by a recorded global.fetch, and credentials are
 * injected through the tool's `resolveHostedCredentials` option, so nothing
 * here reads ~/.crawlforge or reaches the network. The local path is covered
 * too: a local create must never call the website.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { TrackChangesTool, TRACK_CHANGES_INPUT_SHAPE } from '../../src/tools/tracking/trackChanges/index.js';
import { TrackChangesSchema } from '../../src/tools/tracking/trackChanges/schema.js';
import { intervalToCron, NO_KEY_MESSAGE } from '../../src/tools/tracking/trackChanges/hosted.js';
import { sendEmailNotification } from '../../src/tools/tracking/trackChanges/notifier.js';
import { requestContext, reportedActualCost } from '../../src/server/requestContext.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const ENDPOINT = 'https://www.crawlforge.dev';
const CREDS = { endpoint: ENDPOINT, apiKey: 'cf_test_key' };
const URL_A = 'https://example.com/pricing';
const URL_B = 'https://example.com/docs';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

const record = (over = {}) => ({
  id: 'mon_1', name: 'example.com', targets: [{ url: URL_A }], schedule_cron: '0 * * * *', timezone: 'UTC',
  notify_emails: [], webhook_url: null, webhook_secret: 'whsec_generated', status: 'active',
  next_run_at: '2026-09-07T13:00:00.000Z', last_check_at: null, retention_days: 30,
  estimated_credits_per_month: 2160, created_at: '2026-09-07T12:00:00.000Z', updated_at: '2026-09-07T12:00:00.000Z',
  ...over
});

const jsonResponse = (status, body) => ({ ok: status < 400, status, statusText: '', json: async () => body });

/**
 * A fake /api/v1/monitors. Records every call as { method, url, apiKey, body }
 * in `calls`; `down` throws on every call, `reject` answers the next POST with
 * the given error envelope.
 */
function installWebsite({ down = false, monitors = [], reject = null } = {}) {
  const calls = [];
  const store = new Map(monitors.map((m) => [m.id, m]));
  global.fetch = async (url, init = {}) => {
    const call = {
      method: init.method || 'GET', url: String(url),
      apiKey: init.headers?.['X-API-Key'],
      body: init.body ? JSON.parse(init.body) : undefined
    };
    calls.push(call);
    if (down) throw new Error('ECONNREFUSED');
    const pathname = new URL(call.url).pathname;
    if (call.method === 'POST' && pathname === '/api/v1/monitors') {
      if (reject) return jsonResponse(reject.status, reject.body);
      const rec = record({
        id: `mon_${store.size + 1}`, name: call.body.name, targets: call.body.targets,
        schedule_cron: call.body.schedule_cron ?? '0 * * * *',
        notify_emails: call.body.notify_emails ?? [], webhook_url: call.body.webhook_url ?? null,
        webhook_secret: call.body.webhook_secret ?? 'whsec_generated'
      });
      store.set(rec.id, rec);
      return jsonResponse(201, { success: true, data: rec });
    }
    if (call.method === 'GET' && pathname === '/api/v1/monitors') {
      const data = [...store.values()].map((m) => ({ ...m, webhook_secret: null, last_check: null }));
      return jsonResponse(200, { success: true, data, next_cursor: null });
    }
    const one = pathname.match(/^\/api\/v1\/monitors\/([^/]+)$/);
    if (call.method === 'DELETE' && one) {
      if (!store.has(one[1])) return jsonResponse(404, { error: { code: 'MONITOR_NOT_FOUND', message: 'Monitor not found' } });
      store.delete(one[1]);
      return jsonResponse(200, { success: true, data: { id: one[1], deleted: true } });
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route ${call.method} ${pathname}` } });
  };
  return { calls, store };
}

const noKey = async () => { throw new Error(NO_KEY_MESSAGE); };

function makeTool(resolveHostedCredentials = async () => CREDS) {
  const dir = mkdtempSync(join(tmpdir(), 'tc-hosted-'));
  return new TrackChangesTool({ snapshotStorageDir: join(dir, 'snap'), monitorStorageDir: join(dir, 'mon'), resolveHostedCredentials });
}

async function withTool(resolve, fn) {
  const tool = makeTool(resolve);
  try {
    await fn(tool);
  } finally {
    await tool.shutdown().catch(() => {});
  }
}

describe('intervalToCron', () => {
  for (const [ms, cron, adjusted, label] of [
    [5 * MIN, '*/5 * * * *', false, '5 min'],
    [15 * MIN, '*/15 * * * *', false, '15 min'],
    [7 * MIN, '*/6 * * * *', true, '7 min rounds to 6 (*/7 has a 4-minute gap at the hour)'],
    [HOUR, '0 * * * *', false, '1 h'],
    [6 * HOUR, '0 */6 * * *', false, '6 h'],
    [24 * HOUR, '0 0 * * *', false, '24 h'],
    [90 * MIN, '0 */2 * * *', true, '90 min ties to the longer 2 h'],
    [MIN, '*/5 * * * *', true, '1 min is below the 5-minute floor']
  ]) {
    test(label, () => {
      const r = intervalToCron(ms);
      assert.equal(r.cron, cron);
      assert.equal(r.adjusted, adjusted);
      if (!adjusted) assert.equal(r.effectiveIntervalMs, ms);
    });
  }
});

describe('create_scheduled_monitor with hosted: true', () => {
  test('POSTs the website body, creates nothing locally, and returns the hosted id', async () => {
    const { calls } = installWebsite();
    await withTool(undefined, async (tool) => {
      const r = await tool.execute({
        url: URL_A, operation: 'create_scheduled_monitor',
        trackingOptions: { customSelectors: ['.price', '#plans'] },
        notificationOptions: {
          email: { enabled: true, recipients: ['a@example.com'] },
          webhook: { enabled: true, url: 'https://hooks.example.com/x', signingSecret: 'sixteen-characters-long-secret' }
        },
        scheduledMonitorOptions: { hosted: true, interval: 7 * MIN, goal: 'a price changed', notificationThreshold: 'major', name: 'Pricing watch' }
      });
      assert.equal(r.success, true, r.error);
      assert.equal(r.hosted, true);

      assert.equal(calls.length, 1, 'exactly one call: the website, never the page');
      const [call] = calls;
      assert.equal(call.method, 'POST');
      assert.equal(call.url, `${ENDPOINT}/api/v1/monitors`);
      assert.equal(call.apiKey, 'cf_test_key');
      assert.deepEqual(call.body, {
        name: 'Pricing watch',
        targets: [{ url: URL_A, selector: '.price' }, { url: URL_A, selector: '#plans' }],
        schedule_cron: '*/6 * * * *',
        timezone: 'UTC',
        notify_emails: ['a@example.com'],
        webhook_url: 'https://hooks.example.com/x',
        webhook_secret: 'sixteen-characters-long-secret',
        status: 'active'
      });

      assert.equal(r.monitor.id, 'mon_1');
      assert.equal(r.monitor.hosted, true);
      assert.equal(r.monitor.name, 'Pricing watch');
      assert.equal(r.monitor.schedule, '*/6 * * * *');
      assert.equal(r.monitor.timezone, 'UTC');
      assert.deepEqual(r.monitor.notifyEmails, ['a@example.com']);
      assert.equal(r.monitor.webhookUrl, 'https://hooks.example.com/x');
      assert.equal(r.monitor.webhookSecret, 'sixteen-characters-long-secret');
      assert.equal(r.monitor.status, 'active');
      assert.equal(r.monitor.nextRunAt, Date.parse('2026-09-07T13:00:00.000Z'));
      assert.equal(r.monitor.estimatedCreditsPerMonth, 2160);
      assert.equal(r.monitor.dashboardUrl, `${ENDPOINT}/dashboard/monitors/mon_1`);
      assert.match(r.firingGuarantee, /whether or not this process is alive/);
      assert.match(r.firingGuarantee, /3 credits per compared target/);

      assert.equal(r.warnings.length, 3, JSON.stringify(r.warnings));
      assert.match(r.warnings[0], /7 min .* 6 min \(\*\/6 \* \* \* \*\)/);
      assert.match(r.warnings[1], /goal .* not applied to a hosted monitor/);
      assert.match(r.warnings[2], /notificationThreshold has no effect/);

      assert.equal(tool.monitorStore.list().length, 0, 'no local monitor');
    });
  });

  test('defaults: name is the URL host, one bare target, no schedule or notifications, short secret omitted', async () => {
    const { calls } = installWebsite();
    await withTool(undefined, async (tool) => {
      const r = await tool.execute({
        url: URL_A, operation: 'create_scheduled_monitor',
        notificationOptions: { webhook: { enabled: true, url: 'https://hooks.example.com/x', signingSecret: 'short' } },
        scheduledMonitorOptions: { hosted: true }
      });
      assert.equal(r.success, true, r.error);
      assert.deepEqual(calls[0].body, {
        name: 'example.com', targets: [{ url: URL_A }], timezone: 'UTC',
        webhook_url: 'https://hooks.example.com/x', status: 'active'
      });
      assert.equal(r.warnings, undefined);
      assert.equal(r.monitor.schedule, '0 * * * *', 'the website default');
    });
  });

  test('an explicit schedule cron is passed through verbatim and wins over interval', async () => {
    const { calls } = installWebsite();
    await withTool(undefined, async (tool) => {
      const r = await tool.execute({
        url: URL_A, operation: 'create_scheduled_monitor',
        scheduledMonitorOptions: { hosted: true, schedule: '30 9 * * 1-5', interval: 7 * MIN }
      });
      assert.equal(r.success, true, r.error);
      assert.equal(calls[0].body.schedule_cron, '30 9 * * 1-5');
      assert.equal(r.warnings, undefined);
    });
  });

  test('a templateId fills the schedule from the preset frequency', async () => {
    const { calls } = installWebsite();
    await withTool(undefined, async (tool) => {
      const r = await tool.execute({
        url: URL_A, operation: 'create_scheduled_monitor',
        scheduledMonitorOptions: { hosted: true, templateId: 'price-watch' }
      });
      assert.equal(r.success, true, r.error);
      assert.equal(r.templateId, 'price-watch');
      assert.equal(calls[0].body.schedule_cron, '0 * * * *');
      assert.ok(r.warnings.some((w) => /goal/.test(w)), 'the preset goal is local-only');
    });
  });

  test('reports an actual cost of 0 (the projection is 3)', async () => {
    installWebsite();
    await withTool(undefined, async (tool) => {
      const reported = await requestContext.run({ actualCost: null }, async () => {
        const r = await tool.execute({ url: URL_A, operation: 'create_scheduled_monitor', scheduledMonitorOptions: { hosted: true } });
        assert.equal(r.success, true, r.error);
        return reportedActualCost();
      });
      assert.equal(reported, 0);
    });
  });

  test('without a key it fails with the actionable message and never calls the website', async () => {
    const { calls } = installWebsite();
    await withTool(noKey, async (tool) => {
      const r = await tool.execute({ url: URL_A, operation: 'create_scheduled_monitor', scheduledMonitorOptions: { hosted: true } });
      assert.equal(r.success, false);
      assert.match(r.error, /crawlforge login/);
      assert.equal(calls.length, 0);
      assert.equal(tool.monitorStore.list().length, 0);
    });
  });

  test("a website refusal surfaces the website's code, message and details", async () => {
    installWebsite({ reject: { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'targets must be public http(s) URLs', details: { field: 'targets' } } } } });
    await withTool(undefined, async (tool) => {
      const r = await tool.execute({ url: URL_A, operation: 'create_scheduled_monitor', scheduledMonitorOptions: { hosted: true } });
      assert.equal(r.success, false);
      assert.match(r.error, /VALIDATION_ERROR: targets must be public http\(s\) URLs \{"field":"targets"\}/);
    });
  });

  test('a local create (hosted unset) never calls the website and still bills as before', async () => {
    const { calls } = installWebsite();
    await withTool(undefined, async (tool) => {
      const reported = await requestContext.run({ actualCost: null }, async () => {
        const r = await tool.execute({ url: URL_A, operation: 'create_scheduled_monitor', scheduledMonitorOptions: { interval: 60_000 } });
        assert.equal(r.success, true, r.error);
        assert.equal(r.hosted, undefined);
        assert.match(r.firingGuarantee, /In-process scheduling/);
        assert.ok(tool.monitorStore.get(r.monitor.id), 'stored locally');
        return reportedActualCost();
      });
      assert.equal(reported, null, 'no lower cost reported on the local path');
      assert.equal(calls.length, 0);
    });
  });
});

describe('endpoint with a trailing slash', () => {
  // resolveApiEndpoint keeps the slash; the live gate produced
  // https://www.crawlforge.dev//dashboard/monitors/<id> and a //api call.
  test('joins the API path and the dashboard link with a single slash', async () => {
    const { calls } = installWebsite();
    await withTool(async () => ({ ...CREDS, endpoint: `${ENDPOINT}/` }), async (tool) => {
      const r = await tool.execute({ url: URL_A, operation: 'create_scheduled_monitor', scheduledMonitorOptions: { hosted: true } });
      assert.equal(r.success, true, r.error);
      assert.equal(calls[0].url, `${ENDPOINT}/api/v1/monitors`);
      assert.equal(r.monitor.dashboardUrl, `${ENDPOINT}/dashboard/monitors/mon_1`);
      const list = await tool.execute({ operation: 'list_scheduled_monitors' });
      assert.equal(list.monitors[0].dashboardUrl, `${ENDPOINT}/dashboard/monitors/mon_1`);
    });
  });
});

describe('list_scheduled_monitors', () => {
  test('merges local and hosted entries with hosted flags and counts', async () => {
    installWebsite({ monitors: [record({ id: 'mon_h', name: 'Hosted one', next_run_at: '2026-09-07T13:00:00.000Z', last_check_at: '2026-09-07T12:00:00.000Z' })] });
    await withTool(undefined, async (tool) => {
      const created = await tool.execute({ url: URL_B, operation: 'create_scheduled_monitor', scheduledMonitorOptions: { interval: 60_000 } });
      assert.equal(created.success, true, created.error);

      const r = await tool.execute({ operation: 'list_scheduled_monitors' });
      assert.equal(r.success, true, r.error);
      assert.equal(r.count, 2);
      assert.equal(r.localCount, 1);
      assert.equal(r.hostedCount, 1);
      assert.equal(r.hostedError, undefined);

      const [local, hosted] = r.monitors;
      assert.equal(local.hosted, false);
      assert.equal(local.id, created.monitor.id);
      assert.equal(local.url, URL_B);

      assert.equal(hosted.hosted, true);
      assert.equal(hosted.id, 'mon_h');
      assert.equal(hosted.url, URL_A);
      assert.deepEqual(hosted.targets, [{ url: URL_A }]);
      assert.equal(hosted.name, 'Hosted one');
      assert.equal(hosted.schedule, '0 * * * *');
      assert.equal(hosted.timezone, 'UTC');
      assert.equal(hosted.enabled, true);
      assert.equal(hosted.scheduled, true);
      assert.equal(hosted.nextDueAt, Date.parse('2026-09-07T13:00:00.000Z'));
      assert.equal(hosted.lastCheckAt, Date.parse('2026-09-07T12:00:00.000Z'));
      assert.equal(hosted.lastCheck, null);
      assert.equal(hosted.estimatedCreditsPerMonth, 2160);
      assert.equal(hosted.dashboardUrl, `${ENDPOINT}/dashboard/monitors/mon_h`);
    });
  });

  test('with the website down the local list still succeeds and carries hostedError', async () => {
    installWebsite({ down: true });
    await withTool(undefined, async (tool) => {
      await tool.execute({ url: URL_B, operation: 'create_scheduled_monitor', scheduledMonitorOptions: { interval: 60_000 } });
      const r = await tool.execute({ operation: 'list_scheduled_monitors' });
      assert.equal(r.success, true);
      assert.equal(r.count, 1);
      assert.equal(r.localCount, 1);
      assert.equal(r.hostedCount, 0);
      assert.match(r.hostedError, /ECONNREFUSED/);
    });
  });

  test('without a key the local list still succeeds and names the fix', async () => {
    const { calls } = installWebsite();
    await withTool(noKey, async (tool) => {
      const r = await tool.execute({ operation: 'list_scheduled_monitors' });
      assert.equal(r.success, true);
      assert.equal(r.count, 0);
      assert.match(r.hostedError, /crawlforge login/);
      assert.equal(calls.length, 0);
    });
  });
});

describe('stop_scheduled_monitor', () => {
  test('a hosted id is DELETEd on the website and reported hosted', async () => {
    const { calls, store } = installWebsite({ monitors: [record({ id: 'mon_h' })] });
    await withTool(undefined, async (tool) => {
      const reported = await requestContext.run({ actualCost: null }, async () => {
        const r = await tool.execute({ operation: 'stop_scheduled_monitor', scheduledMonitorOptions: { monitorId: 'mon_h' } });
        assert.deepEqual(
          { success: r.success, operation: r.operation, monitorId: r.monitorId, stopped: r.stopped, hosted: r.hosted },
          { success: true, operation: 'stop_scheduled_monitor', monitorId: 'mon_h', stopped: true, hosted: true }
        );
        return reportedActualCost();
      });
      assert.equal(reported, 0);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, 'DELETE');
      assert.equal(calls[0].url, `${ENDPOINT}/api/v1/monitors/mon_h`);
      assert.equal(store.size, 0);
    });
  });

  test('a local id is stopped locally without calling the website', async () => {
    const { calls } = installWebsite();
    await withTool(undefined, async (tool) => {
      const created = await tool.execute({ url: URL_B, operation: 'create_scheduled_monitor', scheduledMonitorOptions: { interval: 60_000 } });
      const r = await tool.execute({ operation: 'stop_scheduled_monitor', scheduledMonitorOptions: { monitorId: created.monitor.id } });
      assert.equal(r.success, true);
      assert.equal(r.stopped, true);
      assert.equal(r.hosted, undefined);
      assert.equal(calls.length, 0);
    });
  });

  test('an id known nowhere reports not found (hosted 404)', async () => {
    const { calls } = installWebsite();
    await withTool(undefined, async (tool) => {
      const r = await tool.execute({ operation: 'stop_scheduled_monitor', scheduledMonitorOptions: { monitorId: 'nope' } });
      assert.equal(r.success, false);
      assert.equal(r.stopped, false);
      assert.equal(r.error, 'No scheduled monitor found with id nope');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, 'DELETE');
    });
  });

  test('an unknown id with no key reports not found and why the hosted side could not be checked', async () => {
    await withTool(noKey, async (tool) => {
      const r = await tool.execute({ operation: 'stop_scheduled_monitor', scheduledMonitorOptions: { monitorId: 'nope' } });
      assert.equal(r.success, false);
      assert.equal(r.stopped, false);
      assert.match(r.error, /^No scheduled monitor found with id nope \(hosted lookup failed: .*crawlforge login/);
    });
  });

  test('by url: stops local monitors and deletes only hosted monitors whose every target is that url', async () => {
    const { calls, store } = installWebsite({
      monitors: [
        record({ id: 'mon_all', targets: [{ url: URL_A, selector: '.a' }, { url: URL_A, selector: '.b' }] }),
        record({ id: 'mon_mixed', targets: [{ url: URL_A }, { url: URL_B }] }),
        record({ id: 'mon_other', targets: [{ url: URL_B }] })
      ]
    });
    await withTool(undefined, async (tool) => {
      await tool.execute({ url: URL_A, operation: 'create_scheduled_monitor', scheduledMonitorOptions: { interval: 60_000 } });
      const r = await tool.execute({ url: URL_A, operation: 'stop_scheduled_monitor' });
      assert.equal(r.success, true);
      assert.equal(r.stoppedMonitors, 1);
      assert.equal(r.stoppedHosted, 1);
      assert.equal(r.hostedError, undefined);
      assert.deepEqual([...store.keys()], ['mon_mixed', 'mon_other']);
      assert.deepEqual(calls.filter((c) => c.method === 'DELETE').map((c) => c.url), [`${ENDPOINT}/api/v1/monitors/mon_all`]);
      assert.equal(tool.monitorStore.list().length, 0);
    });
  });

  test('by url with the website down: the local stop succeeds and hostedError says why', async () => {
    installWebsite({ down: true });
    await withTool(undefined, async (tool) => {
      await tool.execute({ url: URL_A, operation: 'create_scheduled_monitor', scheduledMonitorOptions: { interval: 60_000 } });
      const r = await tool.execute({ url: URL_A, operation: 'stop_scheduled_monitor' });
      assert.equal(r.success, true);
      assert.equal(r.stoppedMonitors, 1);
      assert.equal(r.stoppedHosted, 0);
      assert.match(r.hostedError, /ECONNREFUSED/);
    });
  });
});

describe('email notifier (6.2)', () => {
  test('a local email notification is an error, not a fake success', async () => {
    const emitter = new EventEmitter();
    const sent = [];
    const errors = [];
    emitter.on('notificationSent', (e) => sent.push(e));
    emitter.on('notificationError', (e) => errors.push(e));
    await sendEmailNotification(URL_A, { significance: 'major' }, { enabled: true, recipients: ['a@example.com'] }, emitter);
    assert.equal(sent.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].type, 'email');
    assert.equal(errors[0].url, URL_A);
    assert.match(errors[0].error, /Local monitors do not send email/);
    assert.match(errors[0].error, /scheduledMonitorOptions\.hosted: true/);
  });
});

describe('one input shape (G5)', () => {
  test('the tool schema accepts hosted and name, and leaves an omitted block as before', () => {
    const parsed = TrackChangesSchema.parse({ scheduledMonitorOptions: { hosted: true, name: 'Watch' } });
    assert.equal(parsed.scheduledMonitorOptions.hosted, true);
    assert.equal(parsed.scheduledMonitorOptions.name, 'Watch');
    assert.equal(parsed.scheduledMonitorOptions.enabled, true);
    const bare = TrackChangesSchema.parse({});
    assert.equal(bare.scheduledMonitorOptions, undefined);
    assert.equal(bare.operation, 'compare');
    assert.deepEqual(bare.trackingOptions.excludeSelectors, ['script', 'style', 'noscript', '.advertisement', '.ad', '#comments']);
    assert.equal(bare.monitoringOptions.interval, 300000);
    assert.throws(() => TrackChangesSchema.parse({ scheduledMonitorOptions: { name: '' } }));
  });

  test('the shape server.js registers renders hosted, name, email and the defaults through the SDK', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    server.registerTool('track_changes', { description: 'x', inputSchema: { ...TRACK_CHANGES_INPUT_SHAPE } }, async () => ({ content: [] }));
    const json = server.toolInputSchemaJson('track_changes');
    const sched = json.properties.scheduledMonitorOptions.properties;
    assert.equal(sched.hosted.type, 'boolean');
    assert.equal(sched.hosted.default, false);
    assert.match(sched.hosted.description, /CrawlForge's servers/);
    assert.equal(sched.name.maxLength, 80);
    assert.ok(json.properties.notificationOptions.properties.email, 'email block reaches tools/list');
    assert.deepEqual(json.properties.trackingOptions.properties.excludeSelectors.default, ['script', 'style', 'noscript', '.advertisement', '.ad', '#comments']);
    assert.equal(json.properties.url.description, 'The URL to track changes for (optional for list_scheduled_monitors)');
  });
});

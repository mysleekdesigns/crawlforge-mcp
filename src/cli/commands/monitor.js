/**
 * monitor command — continuously monitor a URL for changes (scheduled mode).
 */
import { TrackChangesTool } from '../../tools/tracking/trackChanges/index.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('monitor <url>')
    .description('Continuously monitor a URL for content changes')
    .option('--interval <seconds>', 'Check interval in seconds', '300')
    .option('--selector <css>', 'CSS selector to scope monitoring')
    .option('--webhook <url>', 'Webhook URL to notify on changes')
    .option('--threshold <pct>', 'Change threshold percentage (0-100)', '5')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const tool = new TrackChangesTool(getToolConfig('track_changes'));

      // TrackChangesSchema shape: operation 'monitor' (setInterval poller);
      // interval is ms (min 60s); selector → trackingOptions.customSelectors;
      // threshold (%) → significanceThresholds; webhook → notificationOptions.webhook.
      const t = Math.min(Math.max(parseFloat(opts.threshold) / 100, 0), 1);
      const params = {
        url,
        trackingOptions: {
          ...(opts.selector ? { customSelectors: [opts.selector] } : {}),
          significanceThresholds: { minor: t, moderate: Math.max(0.3, t), major: Math.max(0.7, t) }
        },
        monitoringOptions: {
          enabled: true,
          interval: Math.max(parseInt(opts.interval, 10), 60) * 1000
        },
        ...(opts.webhook ? { notificationOptions: { webhook: { enabled: true, url: opts.webhook } } } : {})
      };

      // setupMonitoring polls compareWithBaseline, which needs a baseline; create
      // one from the current page first so the monitor watches for changes from now.
      const wrapperTool = {
        execute: async (p) => {
          await tool.execute({ ...p, operation: 'create_baseline' });
          return await tool.execute({ ...p, operation: 'monitor' });
        }
      };
      // monitor runs continuously — do not auto-exit after the first result.
      await runTool(wrapperTool, params, cliFlags, { exitOnSuccess: false });
    });

  // ── Scheduled monitors (persisted; fire in-process while the server runs, or
  //    via `monitor:run-due` from system cron for guaranteed firing) ──────────

  const emit = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

  program
    .command('monitor:create <url>')
    .description('Create a persisted scheduled monitor (optionally with a plain-English alert goal)')
    .option('--every <seconds>', 'Polling interval in seconds', '3600')
    .option('--goal <text>', 'Plain-English alert goal (LLM-judged; degrades to threshold if no LLM)')
    .option('--webhook <url>', 'Webhook URL to notify on meaningful changes')
    .option('--threshold <level>', 'Notification threshold: minor|moderate|major|critical', 'moderate')
    .option('--cron <expr>', 'Optional cron expression (advanced)')
    .option('--selector <css>', 'CSS selector to scope monitoring')
    .action(async (url, opts) => {
      const tool = new TrackChangesTool(getToolConfig('track_changes'));
      try {
        const res = await tool.execute({
          url,
          operation: 'create_scheduled_monitor',
          ...(opts.selector ? { trackingOptions: { customSelectors: [opts.selector] } } : {}),
          ...(opts.webhook ? { notificationOptions: { webhook: { enabled: true, url: opts.webhook } } } : {}),
          scheduledMonitorOptions: {
            interval: Math.max(parseInt(opts.every, 10), 60) * 1000,
            ...(opts.goal ? { goal: opts.goal } : {}),
            ...(opts.cron ? { schedule: opts.cron } : {}),
            notificationThreshold: opts.threshold
          }
        });
        emit(res);
        process.exit(res.success ? 0 : 1);
      } catch (err) {
        process.stderr.write('Error: ' + err.message + '\n');
        process.exit(1);
      }
    });

  program
    .command('monitor:list')
    .description('List persisted scheduled monitors')
    .action(async () => {
      const tool = new TrackChangesTool(getToolConfig('track_changes'));
      try {
        emit(await tool.execute({ operation: 'list_scheduled_monitors' }));
        process.exit(0);
      } catch (err) {
        process.stderr.write('Error: ' + err.message + '\n');
        process.exit(1);
      }
    });

  program
    .command('monitor:stop <id>')
    .description('Stop and remove a scheduled monitor by id')
    .action(async (id) => {
      const tool = new TrackChangesTool(getToolConfig('track_changes'));
      try {
        const res = await tool.execute({ operation: 'stop_scheduled_monitor', scheduledMonitorOptions: { monitorId: id } });
        emit(res);
        process.exit(res.success ? 0 : 1);
      } catch (err) {
        process.stderr.write('Error: ' + err.message + '\n');
        process.exit(1);
      }
    });

  program
    .command('monitor:run-due')
    .description('Fire every due scheduled monitor once and exit (wire into system cron for guaranteed firing)')
    .action(async () => {
      const tool = new TrackChangesTool(getToolConfig('track_changes'));
      try {
        const res = await tool.runDueOnce();
        emit({ success: true, ...res });
        process.exit(0);
      } catch (err) {
        process.stderr.write('Error: ' + err.message + '\n');
        process.exit(1);
      }
    });
}

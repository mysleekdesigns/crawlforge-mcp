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
}

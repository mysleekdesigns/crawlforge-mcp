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
      // monitor runs continuously — do not auto-exit after the first result.
      await runTool(tool, {
        url,
        scheduled: true,
        interval_seconds: parseInt(opts.interval, 10),
        selector: opts.selector,
        webhook_url: opts.webhook,
        change_threshold: parseFloat(opts.threshold)
      }, cliFlags, { exitOnSuccess: false });
    });
}

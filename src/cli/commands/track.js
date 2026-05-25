/**
 * track command — track content changes on a URL.
 */
import { TrackChangesTool } from '../../tools/tracking/trackChanges/index.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('track <url>')
    .description('Track content changes on a URL')
    .option('--selector <css>', 'CSS selector to scope tracking')
    .option('--threshold <pct>', 'Change threshold percentage (0-100)', '5')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const tool = new TrackChangesTool(getToolConfig('track_changes'));

      // TrackChangesSchema shape: selector → trackingOptions.customSelectors,
      // threshold (%) → trackingOptions.significanceThresholds (0-1, ordered).
      const t = Math.min(Math.max(parseFloat(opts.threshold) / 100, 0), 1);
      const trackingOptions = {
        ...(opts.selector ? { customSelectors: [opts.selector] } : {}),
        significanceThresholds: { minor: t, moderate: Math.max(0.3, t), major: Math.max(0.7, t) }
      };

      // `compare` throws "No baseline found" on first run — bootstrap one, then
      // the next invocation reports actual changes against it.
      const params = { url, trackingOptions };
      const wrapperTool = {
        execute: async (p) => {
          const res = await tool.execute({ ...p, operation: 'compare' });
          if (res && res.success === false && /No baseline/i.test(res.error || '')) {
            return await tool.execute({ ...p, operation: 'create_baseline' });
          }
          return res;
        }
      };
      await runTool(wrapperTool, params, cliFlags);
    });
}

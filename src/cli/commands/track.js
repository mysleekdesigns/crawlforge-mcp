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
      await runTool(tool, {
        url,
        selector: opts.selector,
        change_threshold: parseFloat(opts.threshold)
      }, cliFlags);
    });
}

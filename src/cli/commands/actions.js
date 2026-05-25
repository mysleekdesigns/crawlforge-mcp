/**
 * actions command — run browser automation actions from a script file.
 */
import { ScrapeWithActionsTool } from '../../tools/advanced/ScrapeWithActionsTool.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';
import { readFileSync } from 'node:fs';

export function register(program) {
  program
    .command('actions <url>')
    .description('Run browser automation actions against a URL')
    .requiredOption('--script <file>', 'JSON file containing action script')
    .option('--screenshot', 'Capture screenshots during action execution')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };

      let actions;
      try {
        actions = JSON.parse(readFileSync(opts.script, 'utf8'));
      } catch (e) {
        process.stderr.write(`Error reading script file: ${e.message}\n`);
        process.exit(1);
      }

      const tool = new ScrapeWithActionsTool(getToolConfig('scrape_with_actions'));
      // ScrapeWithActionsSchema uses captureScreenshots (no between-action wait
      // field — insert {type:'wait'} actions in the script for that).
      await runTool(tool, {
        url,
        actions,
        captureScreenshots: !!opts.screenshot
      }, cliFlags);
    });
}

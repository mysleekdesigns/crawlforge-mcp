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
    .option('--screenshot', 'Capture screenshot after actions')
    .option('--wait <ms>', 'Wait time between actions in milliseconds', '500')
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
      await runTool(tool, {
        url,
        actions,
        screenshot: !!opts.screenshot,
        wait_between_actions: parseInt(opts.wait, 10)
      }, cliFlags);
    });
}

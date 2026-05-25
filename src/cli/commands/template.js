/**
 * template command — scrape a target URL using a pre-built site template.
 */
import { ScrapeTemplateTool } from '../../tools/templates/ScrapeTemplateTool.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('template [id] [target]')
    .description('Scrape using a pre-built site template (e.g. amazon-product, github-repo)')
    .option('--list', 'List all available templates')
    .action(async (id, target, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const tool = new ScrapeTemplateTool(getToolConfig('scrape_template'));

      if (opts.list) {
        const wrapperTool = { execute: () => tool.execute({ template: 'list' }) };
        await runTool(wrapperTool, {}, cliFlags);
        return;
      }

      if (!id || !target) {
        process.stderr.write('Error: template requires <id> and <target>, or use --list\n');
        process.exit(1);
      }

      await runTool(tool, { template: id, url: target }, cliFlags);
    });
}

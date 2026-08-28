/**
 * template command — scrape a target URL using a pre-built site template.
 */
import { ScrapeTemplateTool } from '../../tools/templates/ScrapeTemplateTool.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('template [id] [target]')
    .description('Scrape using a pre-built site template (e.g. amazon-product, github-repo, or auto to detect one from the URL)')
    .option('--list', 'List all available templates')
    .option('--params <json>', 'JSON parameters for a list connector, e.g. \'{"company":"stripe"}\'')
    .action(async (id, target, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const tool = new ScrapeTemplateTool(getToolConfig('scrape_template'));

      if (opts.list) {
        const wrapperTool = { execute: () => tool.execute({ template: 'list' }) };
        await runTool(wrapperTool, {}, cliFlags);
        return;
      }

      let params;
      if (opts.params) {
        try {
          params = JSON.parse(opts.params);
        } catch (e) {
          process.stderr.write(`Error parsing --params JSON: ${e.message}\n`);
          process.exit(1);
        }
      }

      if (!id || (!target && !params)) {
        process.stderr.write('Error: template requires <id> and <target>, or <id> with --params, or use --list\n');
        process.exit(1);
      }

      await runTool(tool, { template: id, url: target, params }, cliFlags);
    });
}

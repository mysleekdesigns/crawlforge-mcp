/**
 * map command — generate a sitemap using map_site tool.
 */
import { MapSiteTool } from '../../tools/crawl/mapSite.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('map <url>')
    .description('Generate a sitemap for a website')
    .option('--depth <n>', 'Maximum crawl depth', '3')
    .option('--max-pages <n>', 'Maximum pages to include', '500')
    .option('--format <fmt>', 'Output format: json or xml', 'json')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const tool = new MapSiteTool(getToolConfig('map_site'));
      await runTool(tool, {
        url,
        max_depth: parseInt(opts.depth, 10),
        max_pages: parseInt(opts.maxPages, 10),
        output_format: opts.format
      }, cliFlags);
    });
}

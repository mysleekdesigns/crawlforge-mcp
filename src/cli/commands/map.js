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
    .option('--max-pages <n>', 'Maximum URLs to discover', '500')
    .option('--no-sitemap', 'Skip parsing sitemap.xml')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const tool = new MapSiteTool(getToolConfig('map_site'));
      // MapSiteSchema expects: url, max_urls, include_sitemap.
      // (map_site has no crawl-depth or xml/json output toggle.)
      await runTool(tool, {
        url,
        max_urls: parseInt(opts.maxPages, 10),
        include_sitemap: opts.sitemap
      }, cliFlags);
    });
}

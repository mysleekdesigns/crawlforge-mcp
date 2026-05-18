/**
 * search command — searches the web using search_web tool.
 */
import { SearchWebTool } from '../../tools/search/searchWeb.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('search <query>')
    .description('Search the web')
    .option('--limit <n>', 'Number of results', '10')
    .option('--lang <lang>', 'Language code (e.g. en, fr)', 'en')
    .option('--provider <p>', 'Search provider: crawlforge or searxng', 'crawlforge')
    .option('--no-safe-search', 'Disable safe search')
    .action(async (query, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const tool = new SearchWebTool(getToolConfig('search_web'));
      await runTool(tool, {
        query,
        limit: parseInt(opts.limit, 10),
        lang: opts.lang,
        provider: opts.provider,
        safe_search: opts.safeSearch !== false
      }, cliFlags);
    });
}

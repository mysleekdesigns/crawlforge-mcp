/**
 * crawl command — deep crawl a website using crawl_deep tool.
 */
import { CrawlDeepTool } from '../../tools/crawl/crawlDeep.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('crawl <url>')
    .description('Deep crawl a website and extract its content')
    .option('--depth <n>', 'Maximum crawl depth (1-5)', '3')
    .option('--max-pages <n>', 'Maximum pages to crawl', '100')
    .option('--no-robots', 'Ignore robots.txt')
    .option('--follow-external', 'Follow external links')
    .option('--concurrency <n>', 'Concurrent requests (1-20)', '10')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const tool = new CrawlDeepTool(getToolConfig('crawl_deep'));
      await runTool(tool, {
        url,
        max_depth: parseInt(opts.depth, 10),
        max_pages: parseInt(opts.maxPages, 10),
        respect_robots: opts.robots !== false,
        follow_external: !!opts.followExternal,
        concurrency: parseInt(opts.concurrency, 10)
      }, cliFlags);
    });
}

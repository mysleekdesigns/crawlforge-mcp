/**
 * scrape command — fetches a URL and returns its content.
 * Without --extract: uses fetch_url (raw HTML + headers).
 * With --extract: uses extract_content (cleaned text/markdown).
 */
import { fetchUrlHandler } from '../../tools/basic/fetchUrl.js';
import { ExtractContentTool } from '../../tools/extract/extractContent.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('scrape <url>')
    .description('Fetch a URL and return its content')
    .option('--extract', 'Use extract_content for cleaned text/markdown output')
    .option('--format <format>', 'Output format: text, markdown, html (default: text)', 'text')
    .option('--timeout <ms>', 'Request timeout in milliseconds', '10000')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const apiKey = globals.apiKey || process.env.CRAWLFORGE_API_KEY;
      const timeout = parseInt(opts.timeout, 10);

      if (opts.extract) {
        const tool = new ExtractContentTool(getToolConfig('extract_content'));
        const wrapperTool = {
          execute: (p) => tool.execute(p)
        };
        await runTool(wrapperTool, { url, output_format: opts.format, timeout }, cliFlags);
      } else {
        const wrapperTool = {
          execute: (p) => fetchUrlHandler(p)
        };
        await runTool(wrapperTool, { url, timeout }, cliFlags);
      }
    });
}

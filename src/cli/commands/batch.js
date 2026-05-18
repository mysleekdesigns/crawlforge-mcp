/**
 * batch command — scrape multiple URLs from a file.
 * Reads newline-delimited URLs from the specified file.
 */
import { BatchScrapeTool } from '../../tools/advanced/BatchScrapeTool.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';
import { readFileSync } from 'node:fs';

export function register(program) {
  program
    .command('batch <urls-file>')
    .description('Scrape multiple URLs from a newline-delimited file')
    .option('--format <fmt>', 'Output format: text, markdown, html', 'markdown')
    .option('--concurrency <n>', 'Concurrent requests', '5')
    .option('--max-retries <n>', 'Maximum retries per URL', '2')
    .action(async (urlsFile, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };

      let urls;
      try {
        urls = readFileSync(urlsFile, 'utf8')
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'));
      } catch (e) {
        process.stderr.write(`Error reading URLs file: ${e.message}\n`);
        process.exit(1);
      }

      if (urls.length === 0) {
        process.stderr.write('Error: No URLs found in file\n');
        process.exit(1);
      }

      const tool = new BatchScrapeTool(getToolConfig('batch_scrape'));
      await runTool(tool, {
        urls,
        output_format: opts.format,
        concurrency: parseInt(opts.concurrency, 10),
        max_retries: parseInt(opts.maxRetries, 10)
      }, cliFlags);
    });
}

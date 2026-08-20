/**
 * llmstxt command — generate llms.txt for a website.
 */
import { GenerateLLMsTxtTool } from '../../tools/llmstxt/generateLLMsTxt.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('llmstxt <url>')
    .description('Generate llms.txt for a website (AI compliance file)')
    .option('--include-full', 'Also generate llms-full.txt')
    .option('--max-pages <n>', 'Maximum pages to analyze, 10-500', '50')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      // GenerateLLMsTxtSchema requires analysisOptions.maxPages between 10 and 500 —
      // validate here so users get a clear message instead of a raw zod error.
      const maxPages = parseInt(opts.maxPages, 10);
      if (!Number.isInteger(maxPages) || maxPages < 10 || maxPages > 500) {
        process.stderr.write('Error: --max-pages must be between 10 and 500\n');
        process.exit(1);
      }
      const tool = new GenerateLLMsTxtTool(getToolConfig('generate_llms_txt'));
      // GenerateLLMsTxtSchema expects: url, format ('both'|'llms-txt'|'llms-full-txt'),
      // analysisOptions.maxPages.
      await runTool(tool, {
        url,
        format: opts.includeFull ? 'both' : 'llms-txt',
        analysisOptions: { maxPages }
      }, cliFlags);
    });
}

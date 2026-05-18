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
    .option('--max-pages <n>', 'Maximum pages to analyze', '50')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const tool = new GenerateLLMsTxtTool(getToolConfig('generate_llms_txt'));
      await runTool(tool, {
        url,
        include_full_txt: !!opts.includeFull,
        max_pages: parseInt(opts.maxPages, 10)
      }, cliFlags);
    });
}

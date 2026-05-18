/**
 * research command — deep research on a topic.
 */
import { DeepResearchTool } from '../../tools/research/deepResearch.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('research <topic>')
    .description('Conduct deep research on a topic')
    .option('--depth <level>', 'Research depth: basic, standard, or deep', 'standard')
    .option('--max-urls <n>', 'Maximum URLs to analyze', '20')
    .option('--output-format <fmt>', 'Output format: summary or detailed', 'summary')
    .action(async (topic, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const tool = new DeepResearchTool(getToolConfig('deep_research'));
      await runTool(tool, {
        query: topic,
        depth: opts.depth,
        max_urls: parseInt(opts.maxUrls, 10),
        output_format: opts.outputFormat
      }, cliFlags);
    });
}

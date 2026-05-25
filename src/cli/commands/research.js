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
      // DeepResearchSchema expects: topic, maxDepth (1-10), maxUrls, outputFormat.
      const depthMap = { basic: 2, standard: 5, deep: 8 };
      const formatMap = { summary: 'summary', detailed: 'comprehensive' };
      await runTool(tool, {
        topic,
        maxDepth: depthMap[opts.depth] ?? 5,
        maxUrls: parseInt(opts.maxUrls, 10),
        outputFormat: formatMap[opts.outputFormat] ?? 'summary'
      }, cliFlags);
    });
}

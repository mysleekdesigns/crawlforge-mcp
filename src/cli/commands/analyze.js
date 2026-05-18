/**
 * analyze command — analyze content of a URL.
 */
import { AnalyzeContentTool } from '../../tools/extract/analyzeContent.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';

export function register(program) {
  program
    .command('analyze <url>')
    .description('Analyze content of a URL (sentiment, entities, readability)')
    .option('--depth <level>', 'Analysis depth: basic or full', 'basic')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };
      const tool = new AnalyzeContentTool(getToolConfig('analyze_content'));
      await runTool(tool, { url, analysis_depth: opts.depth }, cliFlags);
    });
}

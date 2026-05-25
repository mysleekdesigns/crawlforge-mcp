/**
 * analyze command — analyze content of a URL.
 * Fetches and cleans the page content first (extract_content), then runs
 * NLP analysis (analyze_content) on the extracted text.
 */
import { ExtractContentTool } from '../../tools/extract/extractContent.js';
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

      // analyze_content operates on text, so fetch & clean the page first.
      const extractor = new ExtractContentTool(getToolConfig('extract_content'));
      let text;
      try {
        const extracted = await extractor.execute({ url });
        text = extracted?.content?.text;
      } catch (e) {
        process.stderr.write(`Error fetching content from ${url}: ${e.message}\n`);
        process.exit(1);
      }

      if (!text || text.trim().length < 10) {
        process.stderr.write(`Error: could not extract enough text from ${url} to analyze\n`);
        process.exit(1);
      }

      const tool = new AnalyzeContentTool(getToolConfig('analyze_content'));
      // All analyses (language, topics, entities, sentiment, readability) default to true;
      // --depth full additionally enables advanced metrics.
      await runTool(tool, {
        text,
        options: { includeAdvancedMetrics: opts.depth === 'full' }
      }, cliFlags);
    });
}

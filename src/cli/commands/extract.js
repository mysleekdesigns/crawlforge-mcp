/**
 * extract command — extract structured data or LLM-guided extraction.
 * With --schema: uses extract_structured (JSON schema-based).
 * With --prompt: uses extract_with_llm (natural language).
 */
import { ExtractStructuredTool } from '../../tools/extract/extractStructured.js';
import { ExtractWithLlm } from '../../tools/extract/extractWithLlm.js';
import { getToolConfig } from '../../constants/config.js';
import { runTool } from '../lib/runTool.js';
import { readFileSync } from 'node:fs';

export function register(program) {
  program
    .command('extract <url>')
    .description('Extract structured data from a URL')
    .option('--schema <file>', 'JSON schema file for structured extraction')
    .option('--prompt <text>', 'Natural language prompt for LLM-guided extraction')
    .option('--model <model>', 'LLM model to use (ollama model name or openai/anthropic)')
    .action(async (url, opts, cmd) => {
      const globals = cmd.parent.opts();
      const cliFlags = { json: globals.json, pretty: globals.pretty, quiet: globals.quiet };

      if (opts.schema) {
        let schema;
        try {
          schema = JSON.parse(readFileSync(opts.schema, 'utf8'));
        } catch (e) {
          process.stderr.write(`Error reading schema file: ${e.message}\n`);
          process.exit(1);
        }
        const tool = new ExtractStructuredTool(getToolConfig('extract_structured'));
        await runTool(tool, { url, schema }, cliFlags);
      } else if (opts.prompt) {
        const tool = new ExtractWithLlm(getToolConfig('extract_with_llm'));
        await runTool(tool, {
          url,
          prompt: opts.prompt,
          model: opts.model
        }, cliFlags);
      } else {
        process.stderr.write('Error: extract requires --schema <file> or --prompt <text>\n');
        process.exit(1);
      }
    });
}

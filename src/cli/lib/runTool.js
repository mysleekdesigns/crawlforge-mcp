/**
 * runTool.js — Thin wrapper that invokes a tool's execute() method directly
 * and formats the output according to global CLI flags.
 *
 * This intentionally does NOT replicate withAuth credit logic — CLI invocations
 * go through the same AuthManager path as MCP calls when a real API key is set.
 * In creator mode (CRAWLFORGE_CREATOR_SECRET set) credits are skipped automatically.
 */

import { formatResult, formatError } from '../formatter.js';

/**
 * Run a tool and print formatted output.
 * @param {object} tool         — tool instance with execute(params) method
 * @param {object} params       — tool parameters
 * @param {object} cliFlags     — { json, pretty, quiet }
 * @param {object} [options]
 * @param {boolean} [options.exitOnError=true]
 */
export async function runTool(tool, params, cliFlags, options = {}) {
  const { exitOnError = true } = options;

  try {
    const result = await tool.execute(params);

    // Check for MCP-style error response
    if (result && result.isError) {
      const errText = result.content?.[0]?.text ?? 'Tool returned an error';
      process.stderr.write(formatError(errText, cliFlags) + '\n');
      if (exitOnError) process.exit(1);
      return;
    }

    const output = formatResult(result, cliFlags);
    if (output) process.stdout.write(output + '\n');
  } catch (error) {
    process.stderr.write(formatError(error, cliFlags) + '\n');
    if (exitOnError) process.exit(1);
  }
}

/**
 * formatter.js — CLI output formatter shared across all CLI commands.
 * Respects global flags: --json, --pretty, --quiet.
 * No logic duplication with MCP tools — formats the same tool execute() output.
 */

/**
 * Format a tool result for CLI output.
 * @param {object} result  — raw object from tool.execute() or MCP handler
 * @param {{ json?: boolean, pretty?: boolean, quiet?: boolean }} flags
 * @returns {string}
 */
export function formatResult(result, flags = {}) {
  const { json = false, pretty = false, quiet = false } = flags;

  if (quiet) return '';

  // If result has MCP content array, extract the text
  if (result && Array.isArray(result.content)) {
    const texts = result.content
      .filter(c => c.type === 'text')
      .map(c => c.text);

    if (json || pretty) {
      // Try to parse each text as JSON and re-serialize
      const parsed = texts.map(t => {
        try { return JSON.parse(t); } catch { return t; }
      });
      const output = parsed.length === 1 ? parsed[0] : parsed;
      return pretty
        ? JSON.stringify(output, null, 2)
        : JSON.stringify(output);
    }

    // Plain text: return text blocks joined
    return texts.join('\n');
  }

  // Plain object
  if (json) return JSON.stringify(result);
  if (pretty) return JSON.stringify(result, null, 2);
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

/**
 * Format an error for CLI output.
 * @param {Error|string} error
 * @param {{ json?: boolean }} flags
 * @returns {string}
 */
export function formatError(error, flags = {}) {
  const message = error instanceof Error ? error.message : String(error);
  if (flags.json) {
    return JSON.stringify({ error: message });
  }
  return `Error: ${message}`;
}

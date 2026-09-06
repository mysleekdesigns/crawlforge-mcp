/**
 * read_result — read a stored result by its handle (Phase 2).
 *
 * A tool whose result passed max_inline_chars returned a preview and a
 * result_handle; the whole result is in the ResultStore for an hour. This
 * tool slices, searches, paginates by line or reads a JSON path out of it,
 * so the caller never has to fetch the page again. Extractive only: every
 * operation returns verbatim text with offsets into the same view the
 * preview was cut from (G3).
 */

import { z } from 'zod';
import { selectJsonPath } from 'crawlforge-extractors';
import { getResultStore, RESULT_HANDLE_PATTERN } from '../../core/ResultStore.js';
import { MAX_INLINE_CHARS_PARAM, resolveMaxInlineChars, resultTextView } from '../../server/inlineThreshold.js';
import { dualOutput } from '../../server/registerTool.js';

const CONTEXT_CHARS = 200;
const DEFAULT_SLICE_LENGTH = 10000;
const DEFAULT_LINE_COUNT = 200;
const MAX_LINE_COUNT = 5000;

export const READ_RESULT_INPUT_SHAPE = {
  handle: z.string().regex(RESULT_HANDLE_PATTERN).describe("The result_handle a truncated result returned (res_… or a batch id)"),
  operation: z.enum(['slice', 'search', 'lines', 'json_path']).describe("slice: characters from offset; search: case-insensitive literal query with context and offsets; lines: a page of lines; json_path: one subtree of a JSON result"),
  offset: z.number().int().min(0).optional().describe("slice: first character (default 0); lines: first line index (default 0)"),
  length: z.number().int().min(1).max(200000).optional().describe("slice: characters to return (default 10,000); lines: lines to return (default 200, max 5,000)"),
  query: z.string().min(1).max(500).optional().describe("search: the text to find, matched literally, case-insensitive"),
  max_matches: z.number().int().min(1).max(100).optional().default(20).describe("search: matches to return (default 20)"),
  path: z.string().optional().describe("json_path: dotted keys and array indexes, e.g. \"results[3].content\" — not JSONPath"),
  ...MAX_INLINE_CHARS_PARAM
};

const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });
// read_result declares an outputSchema, so a success carries structuredContent too.
const ok = (object) => dualOutput(object);

/**
 * @param {{ handle: string, operation: string, offset?: number, length?: number, query?: string, max_matches?: number, path?: string, max_inline_chars?: number }} params
 */
export async function readResultHandler(params) {
  const { handle, operation } = params;
  const entry = getResultStore().get(handle);
  if (!entry) return fail('Unknown or expired result handle (results are kept 1 hour)');

  const maxChars = resolveMaxInlineChars(params);
  const { view, view_path, text } = resultTextView(entry.payload, entry.meta?.view_path ? [entry.meta.view_path] : []);
  const base = {
    handle,
    tool: entry.toolName,
    operation,
    view,
    view_path,
    total_chars: text.length,
    expires_at: new Date(entry.expiresAt).toISOString()
  };

  switch (operation) {
    case 'slice': {
      const offset = params.offset ?? 0;
      const length = Math.min(params.length ?? DEFAULT_SLICE_LENGTH, maxChars);
      const slice = text.slice(offset, offset + length);
      return ok({ ...base, offset, length: slice.length, text: slice, has_more: offset + slice.length < text.length });
    }

    case 'search': {
      const { query } = params;
      if (!query) return fail('query is required for operation "search"');
      const maxMatches = params.max_matches ?? 20;
      // A literal (escaped) case-insensitive regex over the ORIGINAL text:
      // offsets must index the verbatim string, and lowercasing a copy can
      // change its length (Turkish İ lowercases to two code units).
      const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = [];
      let total = 0;
      let budget = maxChars;
      for (let m = literal.exec(text); m !== null; m = literal.exec(text)) {
        if (m[0].length === 0) literal.lastIndex++;
        total++;
        if (matches.length >= maxMatches) continue;
        const contextOffset = Math.max(0, m.index - CONTEXT_CHARS);
        const context = text.slice(contextOffset, m.index + m[0].length + CONTEXT_CHARS);
        if (context.length > budget) continue;
        budget -= context.length;
        matches.push({ offset: m.index, length: m[0].length, context_offset: contextOffset, context });
      }
      return ok({ ...base, query, matches, total_matches: total, truncated: total > matches.length });
    }

    case 'lines': {
      const all = text.split('\n');
      const first = params.offset ?? 0;
      const count = Math.min(params.length ?? DEFAULT_LINE_COUNT, MAX_LINE_COUNT);
      let charOffset = 0;
      for (let i = 0; i < Math.min(first, all.length); i++) charOffset += all[i].length + 1;
      const lines = [];
      let chars = 0;
      for (const line of all.slice(first, first + count)) {
        if (chars + line.length + 1 > maxChars && lines.length > 0) break;
        lines.push(line);
        chars += line.length + 1;
      }
      return ok({
        ...base,
        first_line: first,
        line_count: lines.length,
        total_lines: all.length,
        char_offset: charOffset,
        lines,
        has_more: first + lines.length < all.length
      });
    }

    case 'json_path': {
      const { path } = params;
      if (!path) return fail('path is required for operation "json_path"');
      // A text view whose text is itself JSON (a fetch_url body) is read as
      // that JSON; otherwise the stored result object is the subject.
      let subject = entry.payload;
      if (view === 'text') {
        try { subject = JSON.parse(text); } catch { /* not JSON: address the result object */ }
      }
      let value;
      try {
        value = selectJsonPath(subject, path);
      } catch (error) {
        return fail(error.message);
      }
      const valueJson = JSON.stringify(value) ?? 'null';
      if (valueJson.length > maxChars) {
        return ok({
          ...base,
          path,
          value: null,
          value_chars: valueJson.length,
          preview: JSON.stringify(value, null, 2).slice(0, maxChars),
          truncated: true,
          warnings: [`Value at "${path}" is ${valueJson.length} chars, over max_inline_chars ${maxChars}; narrow the path to a smaller subtree.`]
        });
      }
      return ok({ ...base, path, value, value_chars: valueJson.length });
    }

    default:
      return fail(`Unknown operation "${operation}"`);
  }
}

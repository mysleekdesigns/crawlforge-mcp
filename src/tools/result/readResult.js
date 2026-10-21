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
  path: z.string().optional().describe("json_path: dotted keys and array indexes from the root of the stored result, e.g. \"results[3].content\"; a key holding a \".\" in brackets, e.g. files[\"llms.txt\"]; a JSON string field is read into, e.g. \"body.items[0]\" for a fetch_url JSON body — not JSONPath"),
  ...MAX_INLINE_CHARS_PARAM
};

const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });

const duration = (ms) => (ms % 3600000 === 0 ? `${ms / 3600000} hour${ms === 3600000 ? '' : 's'}`
  : ms % 60000 === 0 ? `${ms / 60000} minutes` : `${ms / 1000} seconds`);
const megabytes = (bytes) => (bytes >= 1048576 ? `${Math.round(bytes / 1048576)} MB` : `${bytes} bytes`);

/** Why a handle the store does not have is gone, from the store's tombstone. */
export function goneMessage(store, handle) {
  const gone = store.tombstone(handle);
  if (!gone) {
    return 'Unknown result handle: this server process never issued it. Handles are per process - a handle '
      + 'from before a server restart, or issued by a different server process, cannot be read here.';
  }
  const at = new Date(gone.at).toISOString();
  switch (gone.reason) {
    case 'expired':
      return `Result handle expired: results are kept ${duration(store.ttlMs)} (found expired at ${at}).`;
    case 'evicted':
      return `Result handle evicted at ${at}: the result store keeps at most ${megabytes(store.maxBytes)} per `
        + 'server process and drops the least recently read results first.';
    case 'unreadable':
      return `Result handle unreadable: its stored file could not be read (${gone.detail}) and the entry was dropped at ${at}.`;
    default:
      return `Result handle deleted by the server at ${at}.`;
  }
}
/**
 * Split a json_path into keys: dotted keys, [0] indexes, [key] and the
 * bracket-quoted ["a.b"] / ['a.b'], whose key may hold a ".".
 */
export function parseResultPath(path) {
  const segments = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === '.') { i++; continue; }
    if (path[i] === '[') {
      const quote = path[i + 1];
      if (quote === '"' || quote === "'") {
        const close = path.indexOf(`${quote}]`, i + 2);
        if (close === -1) throw new Error(`Path "${path}" has an unclosed ${quote} key: write it as [${quote}key${quote}]`);
        segments.push(path.slice(i + 2, close));
        i = close + 2;
      } else {
        const close = path.indexOf(']', i);
        const end = close === -1 ? path.length : close;
        segments.push(path.slice(i + 1, end));
        i = end + 1;
      }
      continue;
    }
    let end = i;
    while (end < path.length && path[end] !== '.' && path[end] !== '[') end++;
    segments.push(path.slice(i, end));
    i = end;
  }
  return segments.filter((segment) => segment !== '');
}

function describeKeys(value) {
  if (Array.isArray(value)) return `array of length ${value.length}`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    return `available keys: ${keys.slice(0, 25).join(', ')}${keys.length > 25 ? `, … (${keys.length} total)` : ''}`;
  }
  return `a ${value === null ? 'null' : typeof value} value, which has no keys`;
}

/**
 * Resolve a json_path from the root of the stored result. A string holding
 * JSON (a fetch_url body) is parsed when the path goes on into it.
 * @throws {Error} "path not found", naming the keys where it stopped and the
 *   result's top-level keys
 */
export function selectResultPath(root, path) {
  const segments = parseResultPath(path);
  if (segments.length === 0) throw new Error(`Path "${path}" is empty`);
  let current = root;
  const walked = [];
  for (const segment of segments) {
    if (typeof current === 'string' && /^\s*[[{]/.test(current)) {
      try { current = JSON.parse(current); } catch { /* not JSON: a string has no keys */ }
    }
    const container = current !== null && typeof current === 'object';
    const key = Array.isArray(current) ? Number(segment) : segment;
    if (!container || !Object.hasOwn(current, key)) {
      const at = walked.length === 0 ? 'the result' : `"${walked.join('.')}"`;
      const top = walked.length === 0 ? '' : `; the stored result's top-level keys: ${Object.keys(root).join(', ')}`;
      throw new Error(`Path "${path}" not found: ${at} has no "${segment}" (${describeKeys(current)})${top}`);
    }
    current = current[key];
    walked.push(segment);
  }
  return current;
}

// A bad path on a live handle names its own next step, so withAuth does not
// append read_result's hint for a handle that is gone.
const PATH_NEXT_STEP = 'Next step: the handle is still valid - call read_result operation "json_path" again with a path '
  + 'from the keys above. Paths start at the stored result (a fetch_url body is under "body."), and a key holding '
  + 'a "." goes in brackets, e.g. files["llms.txt"].';

// read_result declares an outputSchema, so a success carries structuredContent too.
const ok = (object) => dualOutput(object);

/**
 * @param {{ handle: string, operation: string, offset?: number, length?: number, query?: string, max_matches?: number, path?: string, max_inline_chars?: number }} params
 */
export async function readResultHandler(params) {
  const { handle, operation } = params;
  const store = getResultStore();
  const entry = store.get(handle);
  if (!entry) return fail(goneMessage(store, handle));

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
      // One root for every tool: the whole stored result (live sweep 4.3).
      let value;
      try {
        value = selectResultPath(entry.payload, path);
      } catch (error) {
        return fail(`${error.message}\n${PATH_NEXT_STEP}`);
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

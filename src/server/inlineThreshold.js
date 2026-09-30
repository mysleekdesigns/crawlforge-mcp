/**
 * inlineThreshold — the one declaration (G5) of `max_inline_chars` and of
 * the rule that turns an oversized tool result into a preview plus a
 * result_handle for read_result (Phase 2).
 *
 * Applied by withAuth after a successful handler run and before `_cost`
 * injection, for the tools listed in INLINE_THRESHOLD_TOOLS only. Internal
 * (website REST proxy) requests are never shaped here — the website applies
 * its own threshold with its own store.
 */

import { z } from 'zod';

export const DEFAULT_MAX_INLINE_CHARS = 40000;

export const MAX_INLINE_CHARS_PARAM = {
  max_inline_chars: z.number().int().min(1000).max(10_000_000).optional().describe("Largest result to return inline, in characters of its JSON. Over it, the call returns a preview plus a result_handle for read_result instead of the whole result (default 40,000; env CRAWLFORGE_MAX_INLINE_CHARS)")
};

/**
 * Per-tool rule. `textPaths` are dotted paths tried in order; the first one
 * holding a string becomes the text view the preview and read_result work
 * on. An empty list means the pretty-printed JSON is the view. `when` gates
 * on params. extract_embedded_state has a shape of its own (shapeEmbeddedState
 * below).
 */
/** The browser_session operations that hand back content worth shaping. */
const BROWSER_SESSION_CONTENT_OPERATIONS = new Set(['snapshot', 'act', 'read']);

export const INLINE_THRESHOLD_TOOLS = Object.freeze({
  scrape: { textPaths: ['content.markdown', 'content.text', 'content.html', 'content.rawHtml'], truncate: true },
  fetch_url: { textPaths: ['body'], truncate: true },
  extract_content: { textPaths: ['content.markdown', 'content.text', 'content.html', 'content.cleanedHTML'], truncate: true },
  crawl_deep: { textPaths: [], truncate: true },
  batch_scrape: { textPaths: [], truncate: true },
  // A page of 25 markdown results is the same payload batch_scrape shapes;
  // an async job's page came back as 111 KB whole (R20, 2026-09-07).
  get_batch_results: { textPaths: [], truncate: true },
  stealth_mode: { textPaths: ['content.markdown', 'content.text', 'content.html'], truncate: true, when: (params) => params?.operation === 'scrape' },
  scrape_with_actions: { textPaths: ['content.markdown', 'content.text', 'content.html'], truncate: true },
  // `read` hands back the same content shape scrape_with_actions does, and was
  // the one content-returning tool with no cap: a read of the World War II
  // article returned 541,308 characters inline where scrape returned 42,259
  // (2026-09-12). The operations, the paths and their order are the REST
  // route's (src/app/api/v1/tools/browser_session/route.ts, CONTENT_OPERATIONS)
  // so the same call is shaped the same way whichever surface serves it; the
  // other four return a session id and an expiry and must not be shaped.
  browser_session: {
    textPaths: ['content.markdown', 'content.text', 'content.html', 'snapshot.tree'],
    truncate: true,
    when: (params) => BROWSER_SESSION_CONTENT_OPERATIONS.has(params?.operation)
  },
  process_document: { textPaths: ['content.text'], truncate: true },
  deep_research: { textPaths: [], truncate: true },
  // Truncated since plan Phase 3.1: returned whole, producthunt.com and
  // zappos.com overflowed the client. Shaped by shapeEmbeddedState, which never
  // cuts inside a JSON value.
  extract_embedded_state: { textPaths: [], truncate: true }
});

/** param -> env (an int of at least 1,000) -> default. */
export function resolveMaxInlineChars(params, env = process.env) {
  const fromParam = params?.max_inline_chars;
  if (Number.isInteger(fromParam) && fromParam >= 1000) return fromParam;
  const fromEnv = Number.parseInt(env?.CRAWLFORGE_MAX_INLINE_CHARS ?? '', 10);
  if (Number.isInteger(fromEnv) && fromEnv >= 1000) return fromEnv;
  return DEFAULT_MAX_INLINE_CHARS;
}

/** Read a dotted path ("content.markdown") off an object; undefined when absent. */
export function readDottedPath(object, dotted) {
  let current = object;
  for (const key of dotted.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

/**
 * The text a preview and read_result operate on: the first configured path
 * holding a string, else the pretty-printed JSON of the whole result.
 * @returns {{ view: 'text'|'json', view_path: string|null, text: string }}
 */
export function resultTextView(resultObject, textPaths = []) {
  for (const path of textPaths) {
    const value = readDottedPath(resultObject, path);
    if (typeof value === 'string') return { view: 'text', view_path: path, text: value };
  }
  return { view: 'json', view_path: null, text: JSON.stringify(resultObject, null, 2) };
}

/**
 * The non-text fields of `content` small enough to stay inline: everything
 * except the text views (markdown, text, html, …) up to a quarter of the
 * inline budget each. Null when there is nothing to keep.
 */
export function keepSmallContentFields(content, textPaths = [], maxInline = DEFAULT_MAX_INLINE_CHARS) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const textLeaves = new Set(
    textPaths.filter((p) => p.startsWith('content.')).map((p) => p.slice('content.'.length))
  );
  const cap = Math.max(1000, Math.floor(maxInline / 4));
  const kept = {};
  for (const [key, value] of Object.entries(content)) {
    if (textLeaves.has(key) || value === undefined) continue;
    if (typeof value === 'string' && value.length > cap) continue;
    if (typeof value === 'object' && value !== null && JSON.stringify(value).length > cap) continue;
    kept[key] = value;
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

function warningsOf(resultObject) {
  return Array.isArray(resultObject.warnings) ? resultObject.warnings.filter((w) => typeof w === 'string') : [];
}

/**
 * @param {string} toolName
 * @param {object} resultObject — the parsed JSON result
 * @param {object} params — the tool params (max_inline_chars, url, operation)
 * @param {{ store: import('../core/ResultStore.js').ResultStore, env?: object }} deps
 * @returns {{ result: object, stored: boolean }}
 */
export function applyInlineThreshold(toolName, resultObject, params, { store, env = process.env }) {
  const unchanged = { result: resultObject, stored: false };
  const config = INLINE_THRESHOLD_TOOLS[toolName];
  if (!config || (config.when && !config.when(params))) return unchanged;
  if (!resultObject || typeof resultObject !== 'object' || Array.isArray(resultObject)) return unchanged;

  const maxInline = resolveMaxInlineChars(params, env);
  const json = JSON.stringify(resultObject);
  if (json.length <= maxInline) return unchanged;

  const { view, view_path, text } = resultTextView(resultObject, config.textPaths);

  let handle;
  try {
    handle = store.put(toolName, resultObject, {
      meta: { view, view_path, url: resultObject.url ?? params?.url ?? null }
    });
  } catch {
    return {
      result: { ...resultObject, warnings: [...warningsOf(resultObject), 'result could not be stored; returned inline'] },
      stored: false
    };
  }

  const expires_at = new Date(Date.now() + store.ttlMs).toISOString();
  const viewDesc = view === 'text' ? `the ${view_path} text` : 'the pretty-printed JSON';
  const readWith = 'read it with read_result (1 credit) - operation "search" (query), "slice" (offset, length), "lines" or "json_path" (path) - and do not fetch the page again';

  if (toolName === 'extract_embedded_state') {
    return { result: shapeEmbeddedState(resultObject, { json, text, maxInline, handle, expires_at, readWith }), stored: true };
  }

  const preview = text.slice(0, maxInline);
  const keptFields = keepSmallContentFields(resultObject.content, config.textPaths, maxInline);
  const keptDesc = keptFields ? `; content.${Object.keys(keptFields).join(', content.')} kept inline` : '';
  const hint = `Result is ${json.length} chars as JSON, over the inline limit of ${maxInline}; preview holds the first ${preview.length} chars of ${viewDesc} (${text.length} chars in total)${keptDesc} and the full result is kept for 1 hour under result_handle ${handle}: ${readWith}.`;

  const shaped = {};
  for (const [key, value] of Object.entries(resultObject)) {
    if (key === 'warnings') continue;
    if (value === null || typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 200)) {
      shaped[key] = value;
    }
  }
  // redact_pii's report is an object, so the scalar filter above drops it —
  // and the caller was charged for it. Carry it through like warnings.
  if (resultObject.redaction && typeof resultObject.redaction === 'object') {
    shaped.redaction = resultObject.redaction;
  }
  // The query-scoped formats live beside the page text under `content`
  // (highlights, answer, json, metadata, links). They are the small, exact
  // answer the caller paid for, and truncating the markdown must not drop
  // them: an nhs.uk scrape with highlights and a question came back as a
  // markdown preview and nothing else (R21, 2026-09-09). Keep every
  // non-text `content` field that fits a quarter of the inline budget.
  if (keptFields) shaped.content = keptFields;
  Object.assign(shaped, {
    preview,
    result_handle: handle,
    total_chars: text.length,
    view,
    view_path,
    truncated: true,
    expires_at,
    warnings: [...warningsOf(resultObject), hint]
  });
  return { result: shaped, stored: true };
}

/** Object.keys(data) for a plain object, "array(<n>)" for an array, null otherwise. */
export function embeddedDataKeys(data) {
  if (Array.isArray(data)) return `array(${data.length})`;
  if (data !== null && typeof data === 'object') return Object.keys(data);
  return null;
}

/**
 * The longest run of whole lines from the start of `text` whose JSON-string
 * form fits in `budget` characters. A line that does not fit ends the preview,
 * so it never stops inside a value; with a budget too small for the first
 * line it is empty.
 */
export function wholeLinePreview(text, budget) {
  const room = budget - 2; // the string's own quotes
  let used = 0;
  let end = 0;
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const stop = newline === -1 ? text.length : newline;
    // A line's escaped length, plus the escaped newline that joins it to the last.
    const cost = JSON.stringify(text.slice(start, stop)).length - 2 + (end > 0 ? 2 : 0);
    if (used + cost > room) break;
    used += cost;
    end = stop;
    start = stop + 1;
  }
  return text.slice(0, end);
}

/**
 * extract_embedded_state over the limit (plan Phase 3.1). What stays inline is
 * everything that says what the page carries — url, path, bytes, the whole
 * `found` list, data_keys, the escalation report and window_state's list —
 * then a preview of the pretty-printed JSON cut at a line boundary. The
 * preview gets whatever max_inline_chars leaves after the rest, measured as
 * compact JSON, so the whole inline result stays within the limit whenever
 * the rest fits. The full result is under the handle for read_result
 * json_path. The REST route shapes it the same way; keep the two in step.
 */
function shapeEmbeddedState(resultObject, { json, text, maxInline, handle, expires_at, readWith }) {
  const dataKeys = embeddedDataKeys(resultObject.data);
  const firstKey = Array.isArray(dataKeys) && dataKeys.length > 0 ? dataKeys[0] : null;
  const example = firstKey && /^[A-Za-z_$][\w$]*$/.test(firstKey) ? ` Read one payload with operation "json_path", path "data.${firstKey}".` : '';
  const hint = `Result is ${json.length} chars as JSON, over the inline limit of ${maxInline}; preview holds the pretty-printed JSON up to the last whole line that fits (${text.length} chars in total), data_keys lists the top-level keys of data, and the full result is kept for 1 hour under result_handle ${handle}: ${readWith}.${example} Or re-run with path, or keys_only:true, to ask for less.`;

  const shaped = {};
  for (const key of ['url', 'path', 'bytes', 'found']) {
    if (key in resultObject) shaped[key] = resultObject[key];
  }
  shaped.data_keys = dataKeys;
  if ('escalated' in resultObject) shaped.escalated = resultObject.escalated;
  if (resultObject.stealth) shaped.stealth = resultObject.stealth;
  if (resultObject.window_state && typeof resultObject.window_state === 'object') {
    shaped.window_state = { note: resultObject.window_state.note, found: resultObject.window_state.found };
  }
  const tail = {
    result_handle: handle,
    total_chars: text.length,
    view: 'json',
    view_path: null,
    truncated: true,
    expires_at,
    warnings: [...warningsOf(resultObject), hint]
  };
  // `"preview":"",` is what the key itself adds once the value is in.
  const envelope = JSON.stringify({ ...shaped, preview: '', ...tail }).length;
  const preview = wholeLinePreview(text, Math.max(0, maxInline - envelope + 2));
  return { ...shaped, preview, ...tail };
}

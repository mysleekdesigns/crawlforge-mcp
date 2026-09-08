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
 * on. An empty list means the pretty-printed JSON is the view. `truncate:
 * false` keeps the whole result inline and only adds the handle
 * (extract_embedded_state's never-truncate rule). `when` gates on params.
 */
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
  process_document: { textPaths: ['content.text'], truncate: true },
  deep_research: { textPaths: [], truncate: true },
  extract_embedded_state: { textPaths: [], truncate: false }
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

  if (!config.truncate) {
    const hint = `Result is ${json.length} chars as JSON, over the inline limit of ${maxInline}; it is returned whole (this tool never truncates) and is also kept for 1 hour under result_handle ${handle}: ${readWith}.`;
    return {
      result: {
        ...resultObject,
        result_handle: handle,
        total_chars: text.length,
        view,
        view_path,
        truncated: false,
        expires_at,
        warnings: [...warningsOf(resultObject), hint]
      },
      stored: true
    };
  }

  const preview = text.slice(0, maxInline);
  const hint = `Result is ${json.length} chars as JSON, over the inline limit of ${maxInline}; preview holds the first ${preview.length} chars of ${viewDesc} (${text.length} chars in total) and the full result is kept for 1 hour under result_handle ${handle}: ${readWith}.`;

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

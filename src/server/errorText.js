/**
 * errorText — strips the formatting that leaks into error messages before they
 * reach the model (R24 4.5).
 *
 * Playwright errors carry ANSI colour codes and a multi-line "Call log:", Node
 * errors carry stack frames, and a tool that rethrows with a prefix inside a
 * handler that adds the same prefix produces "Search failed: Search failed:".
 * None of it helps the model choose its next call. Applied by withAuth to
 * error results only, so page content is never touched.
 */

const ANSI = /[\u001b\u009b]\[[0-9;]*[A-Za-z]/g;
// "Call log:" and the indented "  - ..." lines Playwright lists under it.
const CALL_LOG = /\n?Call log:[^\n]*(?:\n[ \t]+[^\n]*)*/g;
// "    at fn (file.js:1:2)", "    at file.js:1:2", "    at <anonymous>"
const STACK_FRAME = /\n[ \t]+at (?:[^\n]*:\d+:\d+\)?|<anonymous>|native)[ \t]*(?=\n|$)/g;
// "Search failed: Search failed: x" -> "Search failed: x"
const REPEATED_PREFIX = /\b([A-Za-z][\w ]{0,80}? failed: )\1+/g;

/** @param {string} text */
export function cleanErrorText(text) {
  return text
    .replace(ANSI, '')
    .replace(CALL_LOG, '')
    .replace(STACK_FRAME, '')
    .replace(REPEATED_PREFIX, '$1')
    .trimEnd();
}

const ERROR_KEYS = new Set(['error', 'message', 'details', 'errors']);

/** Clean, in place, every string under an error-ish key, at any depth. */
function cleanFields(value, underErrorKey = false) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] === 'string') {
        if (underErrorKey) value[i] = cleanErrorText(value[i]);
      } else {
        cleanFields(value[i], underErrorKey);
      }
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    const errorKey = underErrorKey || ERROR_KEYS.has(key);
    if (typeof v === 'string') {
      if (errorKey) value[key] = cleanErrorText(v);
    } else {
      cleanFields(v, errorKey);
    }
  }
}

/**
 * `{ parsed }` for a failed result — its top-level JSON object, or null when
 * the text is not JSON — and null when the result is not a failure. A failure
 * is `isError: true`, or a JSON body that says `success: false`: several tools
 * return the latter without the flag.
 */
export function failure(result) {
  const first = Array.isArray(result?.content) ? result.content[0] : null;
  if (first?.type !== 'text' || typeof first.text !== 'string') return null;
  const isError = result.isError === true;
  // Cheap pre-check, so a large success result is not parsed again.
  if (!isError && !/"success":\s*false/.test(first.text)) return null;
  let parsed = null;
  try {
    const candidate = JSON.parse(first.text);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) parsed = candidate;
  } catch {
    // plain text
  }
  return isError || parsed?.success === false ? { parsed } : null;
}

/** Clean the error text of a failed result in place. No-op for anything else. */
export function normalizeErrorResult(result) {
  const failed = failure(result);
  if (!failed) return result;
  const first = result.content[0];
  if (!failed.parsed) {
    first.text = cleanErrorText(first.text);
    return result;
  }
  cleanFields(failed.parsed);
  first.text = JSON.stringify(failed.parsed, null, 2);
  if (result.structuredContent && typeof result.structuredContent === 'object') cleanFields(result.structuredContent);
  return result;
}

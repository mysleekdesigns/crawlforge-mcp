/**
 * secretMask -- redact sensitive values from objects/strings before they reach logs.
 *
 * Masks by key name (SECRET_KEYS_RE) and, structurally, the text a
 * scrape_with_actions type/fill/press step sends to the page.
 *
 * Usage:
 *   import { maskSecrets, maskString } from './secretMask.js';
 *   logger.error('fetch failed', maskSecrets({ apiKey, url, error }));
 */

import { redactPii } from 'crawlforge-extractors';

const SECRET_KEYS_RE = /api[_-]?key|apikey|x-api-key|password|passwd|secret|token|authorization|auth|credential|login|formautofill|private[_-]?key|access[_-]?key|proxy_url|proxyurl|^proxies$|cookie/i;

const MASK = '[REDACTED]';
const PARTIAL_MASK_LEN = 4; // show last N chars of long secrets

// scrape_with_actions: these action types send the text/value they carry to the page.
const TYPED_ACTION_TYPES = new Set(['type', 'fill', 'press']);
const TYPED_ACTION_FIELDS = ['text', 'value'];

/**
 * Mask a single string value.
 * Shows last 4 chars if string is long enough to give context, else full mask.
 * @param {string} value
 * @returns {string}
 */
export function maskString(value) {
  if (typeof value !== 'string' || value.length === 0) return MASK;
  if (value.length <= PARTIAL_MASK_LEN) return MASK;
  return `${MASK}...${value.slice(-PARTIAL_MASK_LEN)}`;
}

/**
 * Typed text hides under neutral keys (actions[].text), so key matching misses it.
 * Fully masked: the last-4 tail that tells API keys apart would only leak a password.
 * Selectors and key names stay. Returns a copy; never mutates.
 * @param {*} action
 * @returns {*}
 */
function maskTypedAction(action) {
  if (action === null || typeof action !== 'object' || Array.isArray(action)) return action;
  if (typeof action.type !== 'string' || !TYPED_ACTION_TYPES.has(action.type.toLowerCase())) return action;
  const result = { ...action };
  for (const field of TYPED_ACTION_FIELDS) {
    if (field in result) result[field] = MASK;
  }
  return result;
}

/**
 * Deep-clone obj and redact any key whose name matches SECRET_KEYS_RE.
 * Handles plain objects, arrays, and primitive values.
 * Does NOT mutate the original.
 * @param {*} obj
 * @param {number} depth - internal recursion guard
 * @returns {*}
 */
export function maskSecrets(obj, depth = 0) {
  if (depth > 10) return obj; // guard against circular-ish structures

  if (Array.isArray(obj)) {
    return obj.map(item => maskSecrets(item, depth + 1));
  }

  if (obj !== null && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SECRET_KEYS_RE.test(key)) {
        result[key] = typeof value === 'string' ? maskString(value) : MASK;
      } else if (key === 'actions' && Array.isArray(value)) {
        result[key] = value.map(item => maskSecrets(maskTypedAction(item), depth + 1));
      } else {
        result[key] = maskSecrets(value, depth + 1);
      }
    }
    return result;
  }

  return obj;
}

// A string that names a place on the customer's disk: home-relative, a file
// URL, a Windows drive or UNC share, or an absolute POSIX path under a root
// that holds user files. A bare "/" or a URL path like "/pricing" is not one.
const LOCAL_PATH_RE = /^(?:~[\\/]|file:\/\/|[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|tmp|private|var|mnt|Volumes|media|opt|srv)\/)/;
// process_document reads `source` from disk for these, relative paths included.
const LOCAL_SOURCE_TYPES = new Set(['file', 'pdf_file']);

/** "[local file]" plus the extension, so usage stays countable by file type. */
function maskPath(value) {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(value.split(/[\\/]/).pop() || '');
  return ext ? `[local file].${ext[1].toLowerCase()}` : '[local file]';
}

/**
 * Deep-clone obj with every local file path reduced to its extension. For the
 * usage report, which leaves the machine: a path names the customer's clients
 * and folders, and maskSecrets matches key names, so it never saw one. Local
 * logs keep the path. Does NOT mutate the original.
 * @param {*} obj
 * @param {number} depth - internal recursion guard
 * @returns {*}
 */
export function maskLocalPaths(obj, depth = 0) {
  if (depth > 10) return obj;
  if (typeof obj === 'string') return LOCAL_PATH_RE.test(obj) ? maskPath(obj) : obj;
  if (Array.isArray(obj)) return obj.map(item => maskLocalPaths(item, depth + 1));
  if (obj !== null && typeof obj === 'object') {
    const localSource = LOCAL_SOURCE_TYPES.has(obj.sourceType) && typeof obj.source === 'string';
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = key === 'source' && localSource ? maskPath(value) : maskLocalPaths(value, depth + 1);
    }
    return result;
  }
  return obj;
}

/**
 * Redact secrets from an Error's message and stack.
 * Returns a new plain-object representation safe for logging.
 * @param {Error} error
 * @returns {{ name: string, message: string, stack: string|undefined, code: string|undefined }}
 */
export function maskError(error) {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: redactSecretsFromString(error.message),
    stack: error.stack ? redactSecretsFromString(error.stack) : undefined,
    code: error.code
  };
}

/**
 * Heuristic: redact strings that look like API keys / tokens embedded in text.
 *
 * The patterns moved to crawlforge-extractors' `redactPii` (Phase 5, 5.3), so
 * the two surfaces run one implementation and page text gets the same
 * treatment log lines already got. The SECRET class there is this heuristic,
 * ported verbatim and asserted byte-for-byte against it upstream: the label
 * survives and only the value is replaced, which is what keeps an error
 * message saying WHICH credential the request carried.
 *
 * @param {string} str
 * @returns {string}
 */
function redactSecretsFromString(str) {
  if (typeof str !== 'string') return str;
  return redactPii(str, { entities: ['SECRET'], replaceStyle: 'mask' }).text;
}

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

const SECRET_KEYS_RE = /api[_-]?key|apikey|x-api-key|password|passwd|secret|token|authorization|auth|credential|login|formautofill|private[_-]?key|access[_-]?key|proxy_url|proxyurl|cookie/i;

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
 * @param {string} str
 * @returns {string}
 */
function redactSecretsFromString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/(Bearer\s+)\S+/gi, `$1${MASK}`)
    .replace(/(api[_-]?key\s*[:=]\s*)\S+/gi, `$1${MASK}`)
    .replace(/(x-api-key\s*[:=]\s*)\S+/gi, `$1${MASK}`)
    .replace(/(password\s*[:=]\s*)\S+/gi, `$1${MASK}`)
    .replace(/(secret\s*[:=]\s*)\S+/gi, `$1${MASK}`)
    .replace(/(token\s*[:=]\s*)\S+/gi, `$1${MASK}`);
}

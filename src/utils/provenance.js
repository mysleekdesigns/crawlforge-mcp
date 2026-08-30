/**
 * provenance -- numeric provenance guard for LLM-extracted data.
 *
 * A model handed page text that does not contain the number it was asked for
 * does not say so: it writes a plausible one. On
 * https://www.apple.com/shop/buy-mac/macbook-air every MacBook Air price lives
 * only inside the page's embedded PRODUCT_SELECTION_BOOTSTRAP JSON — the
 * rendered text carries no price at all — and extraction came back with 20
 * confident, fabricated prices.
 *
 * The guard is the cheapest possible test of the only thing that matters: a
 * number the model returned has to be *on the page*. Anything that is not is
 * replaced with null and reported with a reason, so a caller can tell "the page
 * does not say" apart from "the model said".
 *
 * Two rules make it safe to run by default:
 *
 * 1. It is checked against the FULL fetched source (raw html + flattened text),
 *    never the trimmed main content the model was fed. Readability keeps the
 *    FAQ block on that Apple page and drops every price; checking against what
 *    the model saw would null 100% of correct prices — a false null destroys a
 *    good extraction and is far more expensive than a false pass.
 *
 * 2. Matching is normalised on both sides, so 1299 is found in "$1,299.00",
 *    "1.299,00", "1 299", "1299.00" and in a value split across markup. Every
 *    ambiguous reading of a source number is admitted, because an extra reading
 *    can only make the guard more permissive, never null a real value.
 */

/** Spaces (incl. NBSP / narrow NBSP) and the Swiss apostrophe group digits. */
const GROUPING_CHARS = /[\s\u00a0\u202f\u2009']/g;

/** A number as it appears in text: digits plus grouping/decimal punctuation. */
const GROUPED_TOKEN = /\d[\d.,\u00a0\u202f\u2009' ]*\d|\d/g;

/** Bare digit runs — recovers "1", "2", "3" from a "1, 2, 3" grouped token. */
const DIGIT_RUN = /\d+/g;

/** Currency symbols ($ £ € ¥ …) are stripped before a value is read. */
const CURRENCY_SYMBOLS = /\p{Sc}/gu;

/**
 * A string that is a single formatted number and nothing else. Anything with a
 * word in it ("From $999", "13-inch") is text, not a numeric field, and is left
 * alone — the guard deliberately under-reaches rather than risk a false null.
 */
const NUMERIC_STRING = /^[+-]?\d+(?:[.,]\d{3})*(?:[.,]\d+)?$/;

/** Chained markup between digits (`<span>1</span><span>299</span>`) is welded. */
const MARKUP_BETWEEN_DIGITS = /(\d)(?:(?:\s*<[^>]{0,120}>)+\s*)([\d.,])/g;
const MAX_WELD_PASSES = 3;

/**
 * Every numeric reading of one token, canonicalised.
 *
 * "1,299.00" -> 1299 | "1.299,00" -> 1299 | "1 299" -> 1299 | "1.299" -> both
 * 1299 (de-DE grouping) and 1.299 (en-US decimal), since the token alone cannot
 * settle which the page meant.
 *
 * @param {string} token
 * @returns {string[]} canonical numeric strings
 */
function readings(token) {
  const t = token.replace(GROUPING_CHARS, '');
  const hasDot = t.includes('.');
  const hasComma = t.includes(',');
  const raw = [];

  if (hasDot && hasComma) {
    // The rightmost of the two is the decimal separator; the other groups.
    const decimal = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    const grouping = decimal === '.' ? ',' : '.';
    raw.push(t.split(grouping).join('').replace(decimal, '.'));
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    raw.push(t.split(sep).join(''));                                  // grouping reading
    if (t.split(sep).length === 2) raw.push(t.replace(sep, '.'));     // decimal reading
  } else {
    raw.push(t);
  }

  const out = [];
  for (const candidate of raw) {
    const num = Number(candidate);
    if (Number.isFinite(num)) out.push(String(num));
  }
  return out;
}

/**
 * Every number present in the source, canonicalised into a lookup set.
 *
 * The source is scanned twice: as given, and with markup between digits welded
 * shut, so a price the page splits across two spans is still a number.
 *
 * @param {string} source - raw html and/or page text
 * @returns {Set<string>}
 */
function numbersInSource(source) {
  const variants = [source];
  if (source.includes('<')) {
    let welded = source;
    for (let pass = 0; pass < MAX_WELD_PASSES; pass++) {
      const next = welded.replace(MARKUP_BETWEEN_DIGITS, '$1$2');
      if (next === welded) break;
      welded = next;
    }
    if (welded !== source) variants.push(welded);
  }

  const found = new Set();
  for (const variant of variants) {
    for (const [token] of variant.matchAll(GROUPED_TOKEN)) {
      for (const reading of readings(token)) found.add(reading);
    }
    for (const [run] of variant.matchAll(DIGIT_RUN)) {
      for (const reading of readings(run)) found.add(reading);
    }
  }
  return found;
}

/**
 * The numeric readings of an extracted value, or null when the value is not a
 * numeric field at all.
 *
 * A numeric field is identified by the SHAPE of the value, not the name of the
 * field: a JS number anywhere in the result, or a string that is entirely a
 * formatted number once currency symbols and spaces are removed. Field names
 * are no help in either direction — a price can arrive under `mainOffer`, and a
 * field called `price` can legitimately hold "Contact us".
 *
 * @param {*} value
 * @returns {string[]|null}
 */
function valueReadings(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [String(value)] : null;
  }
  if (typeof value !== 'string') return null;
  const stripped = value.replace(CURRENCY_SYMBOLS, '').replace(GROUPING_CHARS, '');
  if (!NUMERIC_STRING.test(stripped)) return null;
  return readings(stripped.replace(/^\+/, ''));
}

/**
 * Replace every numeric value that is not present in the source with null.
 *
 * Derived numbers — a count, a sum, a total the caller asked the model to
 * compute — are not on the page and will not verify. They are nulled like any
 * other absent number, but the value that was removed is returned in
 * `unverified`, so nothing disappears silently: a caller that genuinely wanted
 * a computed number can read it there, or re-run with the guard off.
 *
 * @param {*} data - parsed LLM output (object, array or scalar)
 * @param {string} source - FULL fetched source, not trimmed main content
 * @returns {{ data: *, verified: number, nulled: number,
 *             unverified: Array<{path: string, value: *, reason: string}>,
 *             skipped?: string }}
 */
export function verifyNumericProvenance(data, source) {
  if (typeof source !== 'string' || source.trim() === '') {
    // No source to check against. Nulling everything here would be a guess, not
    // a finding.
    return { data, verified: 0, nulled: 0, unverified: [], skipped: 'empty_source' };
  }

  const found = numbersInSource(source);
  const unverified = [];
  let verified = 0;

  const walk = (node, path) => {
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, `${path}[${i}]`));
    }
    if (node && typeof node === 'object') {
      const out = {};
      for (const [key, value] of Object.entries(node)) {
        out[key] = walk(value, path ? `${path}.${key}` : key);
      }
      return out;
    }

    const candidates = valueReadings(node);
    if (candidates === null) return node;
    if (candidates.some((c) => found.has(c))) {
      verified++;
      return node;
    }
    unverified.push({ path: path || '(root)', value: node, reason: 'not_found_in_source' });
    return null;
  };

  return { data: walk(data, ''), verified, nulled: unverified.length, unverified };
}

export default verifyNumericProvenance;

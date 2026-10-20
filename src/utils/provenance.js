/**
 * provenance -- provenance guard for LLM-extracted data.
 *
 * A model handed page text that does not contain the value it was asked for
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
 *
 * Two kinds of value are checked, both of which have one correct spelling:
 *
 * - numbers, matched on normalised numeric readings (see `valueReadings`);
 * - digit-bearing literals — versions, dates, ISBNs, SKUs, model numbers —
 *   matched by literal substring (see `literalReadings`).
 *
 * The literal class was added after `extract_structured` returned SQLite
 * "3.34.0" on sqlite.org for three runs running. Readability drops the
 * "Version 3.53.4" line, so the model saw no version and answered from memory
 * with a real-but-wrong release; the guard reported `verified: 0` because a
 * three-segment dotted string is not a number and nothing else looked at it.
 *
 * Prose is never checked. A value containing whitespace, or no digit at all,
 * is left alone: a model may legitimately re-word a description, and nulling
 * good text is the one failure this guard must not introduce.
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

/**
 * A digit-bearing literal that is not a plain number: a version ("3.53.4"), a
 * date ("2026-07-24"), an ISBN, a SKU, a model number ("A2338"), an id.
 *
 * These are the other thing a model fabricates, and NUMERIC_STRING cannot see
 * them — "3.34.0" has three dotted segments, so it fails that pattern, and
 * `valueReadings` returned null, and the walker skipped the field. On
 * sqlite.org that is exactly what happened: Readability drops the "Version
 * 3.53.4" line, so the model was shown no version at all and answered "3.34.0"
 * from memory — a real SQLite release, absent from the page, reported as
 * verified because the guard never looked at it.
 *
 * The shape is deliberately tight, and the rule is "no whitespace": a value
 * with a space in it is prose, which a model may legitimately re-word, and
 * comparing it literally would null good extractions. What is left is only
 * tokens that have one correct spelling, so a literal lookup is a fair test.
 */
const LITERAL_SEPARATED = /^[A-Za-z0-9]+(?:[.\-_/:+][A-Za-z0-9]+)+$/;

/** A mixed alphanumeric run with no separator: "A2338", "RTX4090". */
const LITERAL_ALNUM = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]+$/;

/** A leading "v" is a way of writing a version, not part of it. */
const VERSION_PREFIX = /^v(?=\d)/i;

/** Chained markup between digits (`<span>1</span><span>299</span>`) is welded. */
const MARKUP_BETWEEN_DIGITS = /(\d)(?:(?:\s*<[^>]{0,120}>)+\s*)([\d.,])/g;
const MAX_WELD_PASSES = 3;

/**
 * Whether `sep` can be a digit-grouping separator in `t`: Western 3-digit
 * groups ("1,234,567") or Indian lakh grouping ("12,34,567").
 *
 * @param {string} t
 * @param {string} sep - "." or ","
 * @returns {boolean}
 */
function isGrouped(t, sep) {
  const s = sep === '.' ? '\\.' : sep;
  return new RegExp(`^-?\\d{1,3}(?:${s}\\d{3})+$`).test(t)
    || new RegExp(`^-?\\d{1,2}(?:${s}\\d{2})*${s}\\d{3}$`).test(t);
}

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
    // A grouping reading only when the groups are real thousands groups, so
    // "12.34" is never read as 1234 (nor 1234 found in a page's "12.34").
    if (isGrouped(t, sep)) raw.push(t.split(sep).join(''));           // grouping reading
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
function sourceVariants(source) {
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
  return variants;
}

function numbersInSource(source) {
  const found = new Set();
  for (const variant of sourceVariants(source)) {
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
 * Lowercased source variants for literal lookup. A literal is checked by
 * substring, so "3.53.4" is found inside "Version 3.53.4 (2026-07-24)" and
 * inside "v3.53.4", and the welded variant covers a token the page splits
 * across markup.
 *
 * @param {string} source
 * @returns {string[]}
 */
function literalHaystacks(source) {
  return sourceVariants(source).map((variant) => variant.toLowerCase());
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
 * The literal spellings of a digit-bearing identifier, or null when the value
 * is not one. Checked only after `valueReadings` declines, so a plain number
 * never reaches here.
 *
 * Two shapes qualify, both of which have exactly one correct spelling:
 * separated ("3.53.4", "2026-07-24", "978-0-596-51774-8") and mixed
 * alphanumeric ("A2338"). Everything else — anything with whitespace, and any
 * string with no digit in it — is prose and is left alone, because a model may
 * legitimately re-word prose and a literal comparison would null good data.
 *
 * @param {*} value
 * @returns {string[]|null} lowercased spellings to look for
 */
function literalReadings(value) {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  if (!token || /\s/.test(token)) return null;
  if (!/\d/.test(token)) return null;
  if (!LITERAL_SEPARATED.test(token) && !LITERAL_ALNUM.test(token)) return null;

  const lower = token.toLowerCase();
  const spellings = new Set([lower]);
  // "v3.53.4" on a page that writes "3.53.4", and the reverse.
  spellings.add(lower.replace(VERSION_PREFIX, ''));
  return [...spellings];
}

/** A version with two or more dot-separated numeric segments, inside prose. */
const EMBEDDED_VERSION = /(?<![\w.])v?\d+(?:\.\d+){2,}(?![\w.])/gi;

/**
 * The spellings of every version-shaped token inside a prose string, or null
 * when the value is not prose or carries none. "Racket 5.1.0" on a page that
 * says 9.3 is the case that found this: the whole value is prose, so
 * `literalReadings` left it alone, and the fabricated version rode through.
 *
 * @param {*} value
 * @returns {string[][]|null} one spelling list per token
 */
function embeddedVersionReadings(value) {
  if (typeof value !== 'string' || !/\s/.test(value.trim())) return null;
  const tokens = value.match(EMBEDDED_VERSION);
  if (!tokens) return null;
  return tokens.map((token) => {
    const lower = token.toLowerCase();
    return [...new Set([lower, lower.replace(VERSION_PREFIX, '')])];
  });
}

/** An ISO calendar date, the form a model is asked to convert dates into. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Lowercase, strip accents and fold NBSPs, so "Mär" and "mar" compare equal. */
const foldText = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Month name -> month number (1-12), long and short forms, from Intl for the
 * languages a page is most often written in. A name two languages assign to
 * different months would be ambiguous and is dropped.
 */
const MONTHS = (() => {
  const map = new Map();
  const clash = new Set();
  for (const locale of ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl']) {
    for (const month of ['long', 'short']) {
      const fmt = new Intl.DateTimeFormat(locale, { month, timeZone: 'UTC' });
      for (let m = 1; m <= 12; m++) {
        const name = foldText(fmt.format(new Date(Date.UTC(2026, m - 1, 15)))).replace(/\.$/, '');
        if (map.has(name) && map.get(name) !== m) clash.add(name);
        map.set(name, m);
      }
    }
  }
  map.set('sept', 9); // "Sept 14" in English
  for (const name of clash) map.delete(name);
  return map;
})();

/** "2026-10-14" when y/m/d is a real calendar date, else null. */
function isoDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "14 octobre 2026", "14. März 2026", "1er octobre 2026", "14 de octubre de 2026". */
const DAY_MONTH_YEAR = /(?<![\p{L}\d])(\d{1,2})(?:er|st|nd|rd|th|\.)?\s*(?:de\s+)?(\p{L}{3,})\.?,?\s+(?:de\s+)?(\d{4})(?!\d)/gu;
/** "October 14, 2026", "Oct 14th 2026". */
const MONTH_DAY_YEAR = /(?<![\p{L}\d])(\p{L}{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)/gu;
/** "14.10.2026", "14/10/2026", "10/14/2026" — day/month order read both ways. */
const NUMERIC_DATE = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)/g;

/**
 * Every calendar date the source writes in words or as d/m/y digits, as ISO
 * strings. Only real dates are admitted, and day, month and year must come
 * from one expression, so a date is never assembled from scattered numbers.
 *
 * @param {string} source
 * @returns {Set<string>}
 */
function datesInSource(source) {
  const found = new Set();
  const add = (y, m, d) => {
    const iso = isoDate(Number(y), Number(m), Number(d));
    if (iso) found.add(iso);
  };
  for (const variant of sourceVariants(source)) {
    const text = foldText(variant);
    for (const [, d, name, y] of text.matchAll(DAY_MONTH_YEAR)) {
      if (MONTHS.has(name)) add(y, MONTHS.get(name), d);
    }
    for (const [, name, d, y] of text.matchAll(MONTH_DAY_YEAR)) {
      if (MONTHS.has(name)) add(y, MONTHS.get(name), d);
    }
    for (const [, a, b, y] of text.matchAll(NUMERIC_DATE)) {
      add(y, b, a);
      add(y, a, b);
    }
  }
  return found;
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
  // Built lazily: most extractions are all numbers and never need it, and
  // lowercasing a multi-megabyte page is not free.
  let haystacks = null;
  let dates = null;
  const inSource = (spellings) => {
    if (haystacks === null) haystacks = literalHaystacks(source);
    return spellings.some((s) => haystacks.some((h) => h.includes(s)));
  };

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
    if (candidates !== null) {
      if (candidates.some((c) => found.has(c))) {
        verified++;
        return node;
      }
      unverified.push({ path: path || '(root)', value: node, reason: 'not_found_in_source' });
      return null;
    }

    // Not a number, but possibly a version/date/SKU-shaped literal, which is
    // the other thing a model invents when the page does not say.
    const literals = literalReadings(node);
    if (literals !== null) {
      if (inSource(literals)) {
        verified++;
        return node;
      }
      // An ISO date the model converted from "14 octobre 2026" is not on the
      // page literally; it is when the page's own dates are read. A date that
      // cannot exist ("2027-03-00") never matches.
      const iso = typeof node === 'string' && node.trim().match(ISO_DATE);
      if (iso) {
        if (dates === null) dates = datesInSource(source);
        if (dates.has(isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3])))) {
          verified++;
          return node;
        }
      }
      unverified.push({ path: path || '(root)', value: node, reason: 'not_found_in_source' });
      return null;
    }

    // Prose that carries a version-shaped token ("Racket 5.1.0"): the words
    // may be the model's own re-wording, but the token has exactly one
    // spelling and is checked like a bare one. Decimals ("1.5 million") and
    // bare integers stay prose — a model may legitimately re-word those.
    const embedded = embeddedVersionReadings(node);
    if (embedded === null) return node;
    if (embedded.every((spellings) => inSource(spellings))) {
      verified++;
      return node;
    }
    unverified.push({ path: path || '(root)', value: node, reason: 'not_found_in_source' });
    return null;
  };

  return { data: walk(data, ''), verified, nulled: unverified.length, unverified };
}

export default verifyNumericProvenance;

/**
 * Sentence splitting utility that handles abbreviations, decimal numbers,
 * domain names, and other common patterns that contain periods.
 */

// CJK / fullwidth sentence terminators, plus the Devanagari danda (।) and
// double danda (॥) that end Hindi, Marathi, Nepali and Sanskrit sentences —
// a Hindi paragraph of five sentences counted as one (R17, 2026-09-04).
// Unlike the ASCII '.' these are unambiguous — no abbreviation, decimal or
// initial uses them — and CJK text puts no whitespace after them, so they
// split on a zero-width boundary.
const CJK_TERMINATORS = '。．！？；।॥';

// Common abbreviations that should not trigger sentence splits
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'ave', 'blvd',
  'vs', 'etc', 'inc', 'ltd', 'corp', 'dept', 'univ', 'assn',
  'approx', 'appt', 'apt', 'dept', 'est', 'min', 'max',
  'govt', 'lib', 'misc', 'natl', 'intl',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'fig', 'eq', 'ref', 'vol', 'no', 'pp', 'ed', 'rev',
  'e', 'i',  // for e.g. and i.e.
]);

/**
 * Split text into sentences, handling abbreviations and technical terms.
 * @param {string} text - Text to split
 * @returns {string[]} - Array of sentence strings
 */
export function splitSentences(text) {
  if (!text || typeof text !== 'string') return [];

  const sentences = [];
  let current = '';

  // Split by potential sentence boundaries: . ! ? and the CJK terminators
  // But be smart about abbreviations, numbers, and domain-like patterns
  const tokens = text.split(/(?<=[.!?])\s+|(?<=[。．！？；।॥])\s*/);

  for (const token of tokens) {
    const combined = current ? current + ' ' + token : token;

    // Check if the current chunk ends with something that looks like a sentence end
    const endMatch = combined.match(/([.!?。．！？；।॥])\s*$/);
    if (endMatch) {
      // Check if the period is likely NOT a sentence boundary
      const beforePeriod = combined.replace(/[.!?。．！？；।॥]\s*$/, '');
      const lastWord = beforePeriod.split(/\s+/).pop() || '';
      const lastWordLower = lastWord.toLowerCase().replace(/[^a-z]/g, '');

      const isAbbreviation = ABBREVIATIONS.has(lastWordLower);
      // e.g., i.e., U.S., Node.js - words with internal periods
      const hasInternalPeriods = /\w\.\w/.test(lastWord);
      // Numbers like 3.14, v2.0
      const isDecimal = /\d\.\d/.test(lastWord);
      // Single letter followed by period (initials like "A. Smith")
      const isInitial = /^[A-Z]\.$/.test(lastWord);

      // Those four checks are ASCII-oriented (they strip anything outside
      // [a-z]), so a CJK terminator must never be judged by them — otherwise
      // "使用Node.js开发。" is swallowed by hasInternalPeriods.
      const isAmbiguous = !CJK_TERMINATORS.includes(endMatch[1]);

      if (isAmbiguous && (isAbbreviation || hasInternalPeriods || isDecimal || isInitial)) {
        // Not a real sentence boundary — accumulate
        current = combined;
      } else {
        // Real sentence boundary
        const trimmed = combined.trim();
        if (trimmed.length > 0) {
          sentences.push(trimmed);
        }
        current = '';
      }
    } else {
      current = combined;
    }
  }

  // Don't forget the last chunk
  if (current.trim().length > 0) {
    sentences.push(current.trim());
  }

  return sentences.length > 0 ? sentences : [text.trim()];
}

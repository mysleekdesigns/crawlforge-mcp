/**
 * _highlights.js — the pure pieces of `scrape`'s query-scoped formats
 * (Phase 1): the public unit shape, the parser for a model's excerpt
 * choice, and the grounding check a model-mode answer must pass.
 *
 * Nothing here touches the network or a model, so every rule is testable
 * without one.
 */

/**
 * The unit shape a caller sees. `heading` is a ranking input
 * (crawlforge-extractors counts its terms at half weight), not an output.
 * @param {{ text: string, kind: string, offset: number, length: number, score: number }} unit
 */
export function toPublicUnit({ text, kind, offset, length, score }) {
  return { text, kind, offset, length, score };
}

/**
 * The candidate indexes a model chose, from a reply such as "3, 0, 7" or
 * "[3] and [7]". Out-of-range and repeated numbers are dropped; at most
 * `limit` survive, in the model's order. Empty when nothing parses, so the
 * caller can fall back to the extractive order.
 *
 * @param {string} reply
 * @param {number} count how many candidates were offered (indexes 0..count-1)
 * @param {number} limit
 * @returns {number[]}
 */
export function parseChosenIndexes(reply, count, limit) {
  const chosen = [];
  for (const match of String(reply ?? '').matchAll(/\d+/g)) {
    const index = Number(match[0]);
    if (index < count && !chosen.includes(index)) chosen.push(index);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

const NUMBER = /\d[\d.,:%]*/g;
// A capitalised word of two or more letters. Letters only: "Node.js" is
// "Node" (checked) and "js" (not capitalised).
const WORD = /\p{L}{2,}/gu;
// What precedes the first word of a sentence: nothing, or a terminator.
const SENTENCE_START = /(?:^|[.!?]|\n)[\s"'“‘(\[*_]*$/;

/**
 * Whether a model-written answer stays inside its evidence. Every number
 * and every proper noun in `answer` — a capitalised word of at least two
 * letters that is not the first word of a sentence — must appear,
 * case-insensitively, in the evidence or in the question. A price the page
 * never states or a vendor it never names is what "grounded: false" is for.
 *
 * @param {string} answer
 * @param {string} evidence the evidence units' text
 * @param {string} question
 * @returns {{ grounded: boolean, unbacked: string[] }}
 */
export function groundingCheck(answer, evidence, question) {
  const text = String(answer ?? '');
  const haystack = `${evidence ?? ''}\n${question ?? ''}`.toLowerCase();
  const unbacked = [];
  const check = (token) => {
    if (!haystack.includes(token.toLowerCase()) && !unbacked.includes(token)) unbacked.push(token);
  };

  for (const match of text.matchAll(NUMBER)) {
    // "$49." at the end of a sentence is the number 49.
    check(match[0].replace(/[.,:]+$/, ''));
  }
  for (const match of text.matchAll(WORD)) {
    const word = match[0];
    if (word[0] !== word[0].toUpperCase() || word[0] === word[0].toLowerCase()) continue;
    if (SENTENCE_START.test(text.slice(0, match.index))) continue;
    check(word);
  }

  return { grounded: unbacked.length === 0, unbacked };
}

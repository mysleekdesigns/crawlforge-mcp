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

const HEADING_LINE = /^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/gm;

/**
 * The markdown's headings as candidate units for the question format. A
 * value that sits in a heading is in no sentence: the webscraper.io test
 * shop prints a product's price and name as two adjacent <h4>s, so a
 * question about either matched nothing and came back empty (R24). A
 * heading unit carries the other headings of its run — headings with no
 * unit between them — as its `heading` context, which is how the price
 * heading answers a question naming the product, the way a price row under
 * a plan-name heading already does.
 *
 * @param {string} markdown
 * @param {Array<{ kind: string, offset: number, length: number }>} units the
 *   segmentUnits() result for the same markdown; a "#" line inside one of its
 *   code blocks is not a heading
 * @returns {Array<{ text: string, kind: 'heading', offset: number, length: number, heading: string | null }>}
 */
export function headingUnits(markdown, units) {
  const code = units.filter((u) => u.kind === 'code_block');
  const found = [];
  for (const match of String(markdown ?? '').matchAll(HEADING_LINE)) {
    const text = match[1];
    if (!text || text.replace(/\s/g, '').length < 2) continue;
    const offset = match.index + match[0].indexOf(text);
    if (code.some((u) => offset >= u.offset && offset < u.offset + u.length)) continue;
    found.push({ text, kind: 'heading', offset, length: text.length });
  }
  // Group into runs: a run ends where any unit sits between two headings.
  const runs = [];
  for (const unit of found) {
    const last = runs.at(-1)?.at(-1);
    const between = last && units.some((u) => u.offset > last.offset && u.offset < unit.offset);
    if (!last || between) runs.push([unit]);
    else runs.at(-1).push(unit);
  }
  return runs.flatMap((run) => run.map((unit) => ({
    ...unit,
    heading: run.filter((other) => other !== unit).map((other) => other.text).join(' ') || null
  })));
}

// What the model is told to reply when the evidence does not answer the
// question; such a reply is an empty, ungrounded answer, not a paraphrase.
export const NOT_IN_EVIDENCE = 'NOT_IN_EVIDENCE';

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

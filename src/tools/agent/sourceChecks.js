/**
 * sourceChecks.js — deterministic checks on which sources the `agent` trusts
 * and which dates it reports (live sweep 2026-10-20, item 2.5).
 *
 * "Latest stable Rust version and its release date" was first searched as the
 * bare word "Rust": the game's site (rust.facepunch.com, a root titled "Rust")
 * passed as the entity's official site, was promoted to the live page, and the
 * run came back degraded:true blaming it. The answer gave 1.99.1 "as of 16
 * October 2026": endoflife.date's "Last updated on" date, not the 15 October
 * release date in its table.
 *
 * Imports nothing, so AgentOrchestrator can read it without a cycle.
 */

/** The registrable label of a hostname: "python" for www.python.org, "bbc" for bbc.co.uk. */
export function siteLabel(hostname) {
  const labels = hostname.toLowerCase().split('.');
  const ccSecondLevel = labels.length >= 3 && labels.at(-1).length === 2 && labels.at(-2).length <= 3;
  return labels[Math.max(labels.length - (ccSecondLevel ? 3 : 2), 0)];
}

function labelOf(url) {
  try { return siteLabel(new URL(url).hostname); } catch { return null; }
}

/**
 * The origins a search for the whole question also returns (same site label,
 * any subdomain). A bare entity name is ambiguous — "Rust" is a language, a
 * game and a film — and the site that owns the bare name need not be the one
 * the question is about. A site the question's own search does not surface is
 * not promoted as its live page. When that search returned nothing there is
 * nothing to check against, and every origin passes.
 *
 * @param {Iterable<string>} origins candidate origins from the entity query
 * @param {string[]} questionUrls result URLs of the other queries
 * @returns {Set<string>}
 */
export function corroboratedOrigins(origins, questionUrls) {
  const all = new Set(origins);
  const labels = new Set((questionUrls || []).map(labelOf).filter(Boolean));
  if (labels.size === 0) return all;
  return new Set([...all].filter(origin => labels.has(labelOf(origin))));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const DATE_RE = new RegExp(
  `\\b(\\d{4})-(\\d{2})-(\\d{2})\\b` +
  `|\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b` +
  `|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\s+(\\d{4})\\b`,
  'gi'
);

/** Every date in a text, written any of three ways, keyed as YYYY-MM-DD. */
function datesIn(text) {
  const found = [];
  for (const m of String(text || '').matchAll(DATE_RE)) {
    let y, mo, d;
    if (m[1]) [y, mo, d] = [m[1], Number(m[2]), Number(m[3])];
    else if (m[4]) [y, mo, d] = [m[6], MONTHS.indexOf(m[4].toLowerCase()) + 1, Number(m[5])];
    else [y, mo, d] = [m[9], MONTHS.indexOf(m[8].toLowerCase()) + 1, Number(m[7])];
    found.push({ raw: m[0], key: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, index: m.index });
  }
  return found;
}

/** A date written right after one of these is when a page changed, not when the thing happened. */
const UPDATE_LABEL = /\b(?:updated|modified|edited|revised|retrieved|accessed|crawled)\b[^\d\n]{0,20}$/i;

/** A task that asks when something was updated wants exactly those dates. */
const ASKS_FOR_UPDATES = /\b(?:updated?|modified|last (?:changed|edited))\b/i;

/**
 * Dates the answer states that its sources give only as a page's
 * "last updated" / "modified" date, never as anything else. Each comes with
 * the first source that labels it so, so a warning names a page the run used.
 *
 * @param {string} answer
 * @param {{url: string, text?: string}[]} evidence
 * @param {string} prompt
 * @returns {{date: string, url: string}[]}
 */
export function updateLabelledDates(answer, evidence, prompt) {
  if (!answer || ASKS_FOR_UPDATES.test(prompt || '')) return [];
  const byKey = new Map();
  for (const e of evidence || []) {
    const text = e.text || '';
    for (const { key, index } of datesIn(text)) {
      const lineStart = text.lastIndexOf('\n', index - 1) + 1;
      const updated = UPDATE_LABEL.test(text.slice(Math.max(lineStart, index - 40), index));
      const seen = byKey.get(key) || { other: false, url: null };
      if (updated) seen.url = seen.url || e.url;
      else seen.other = true;
      byKey.set(key, seen);
    }
  }
  const flagged = [];
  for (const { raw, key } of datesIn(answer.replace(/https?:\/\/\S+/g, ' '))) {
    const seen = byKey.get(key);
    if (seen?.url && !seen.other && !flagged.some(f => f.key === key)) flagged.push({ key, date: raw, url: seen.url });
  }
  return flagged.map(({ date, url }) => ({ date, url }));
}

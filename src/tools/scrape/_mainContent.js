/**
 * _mainContent.js — Readability main-content extraction, plus recovery of the
 * content Readability drops.
 *
 * Two independent losses are repaired here.
 *
 * 1. Readability keeps one article candidate and discards everything outside
 *    it. On a table-led page that silently loses the payload: Wikipedia's
 *    *List of S&P 500 companies* came back with zero table rows at scrape's
 *    default onlyMainContent:true, and 505 pipe-table lines with it off. No
 *    Readability option recovers them (charThreshold:100 and nbTopCandidates:20
 *    were both probed) — the tables are simply not in the candidate — so they
 *    are re-attached afterwards.
 *
 * 2. Readability's class regexes are unanchored, so they fire on words their
 *    author never meant. Two collisions between them deleted every code
 *    example on next-intl.dev/docs/routing/setup:
 *
 *      - `unlikelyCandidates` contains `extra`, which matches inside `nextra-*`
 *        — the class prefix on every element Nextra emits, and Nextra builds a
 *        large share of the JS ecosystem's documentation. None of those classes
 *        match `okMaybeItsACandidate`, so the elements are deleted before
 *        scoring runs: all 96 inline `<code>` spans and the "setRequestLocale
 *        is legacy" callout went with them.
 *      - `negative` contains `hidden`, which matches Tailwind's
 *        `overflow-hidden`. That is only -25 class weight, but it is enough for
 *        `_cleanConditionally` to drop the wrapper around all 12 `<pre>` blocks.
 *
 *    Both losses were silent, and the second is the dangerous one: the prose
 *    survived, so the page read as complete while every code example and the
 *    warning callout were gone, and sentences came back with holes where their
 *    inline code had been ("In order to use unique pathnames …, can be used to
 *    handle"). `sanitizeAccidentalClasses` strips just those class tokens
 *    before Readability sees the document, restoring 11 of the 12 blocks — the
 *    12th sits inside a collapsed `<details>`, which Readability drops whole
 *    and which this deliberately does not try to rescue.
 *
 * Shared by unifiedScrape (wants HTML) and extractStructured (wants text).
 */

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

// How much of a table's text is compared against the article to decide whether
// Readability already kept it. Long enough to be unique to that table.
const SIGNATURE_LENGTH = 120;

// Copied verbatim from @mozilla/readability's REGEXPS. Two of them delete
// content, and both are unanchored: `unlikelyCandidates` removes an element
// outright, `negative` docks 25 from its class weight, which is enough for
// `_cleanConditionally` to drop it. The unit test asserts the real library
// still behaves this way, so a Readability upgrade that fixes it upstream
// fails loudly here rather than leaving a no-op pass behind.
const UNLIKELY_SOURCE =
  '-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote';
const NEGATIVE_SOURCE =
  '-ad-|hidden|^hid$| hid$| hid |^hidden|banner|combx|comment|com-|contact|footer|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget';
const REMOVAL_SOURCES = [UNLIKELY_SOURCE, NEGATIVE_SOURCE];
// Readability's `positive` regex. A token matching it carries a signal worth
// keeping, so it is never stripped even if it also matches mid-word.
const POSITIVE_SIGNAL =
  /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i;

// Utility classes that collide with the `negative` regex on a whole word while
// meaning something else entirely. Tailwind's `overflow-hidden` clips overflow;
// it does not mark the element hidden. The mid-word rule below cannot catch
// these — `hidden` really is a whole segment of `overflow-hidden` — and the
// cost is real: -25 class weight is enough for `_cleanConditionally` to delete
// the element, which is what removed every code block on next-intl.dev after
// the `nextra-` collision had already been handled. Listed explicitly rather
// than inferred, because `page-footer` and `main-sidebar` are the same shape
// and *are* genuine.
const UTILITY_FALSE_POSITIVES = new Set([
  'overflow-hidden',
  'overflow-x-hidden',
  'overflow-y-hidden',
  'overflow-scroll',
  'overflow-x-scroll',
  'overflow-y-scroll',
  'scroll-smooth',
  'scroll-auto'
]);

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * True when `token` only ever trips Readability's removal regexes inside a
 * longer word — `extra` within `nextra`, `hidden` within Tailwind's
 * `overflow-hidden`.
 *
 * Only a *preceding* letter or digit counts as mid-word. A trailing one does
 * not, because that is how English suffixes attach: rescuing `comments`,
 * `banners` or `footers` would defeat the regexes on exactly the clutter they
 * were written to catch, whereas a letter run in front of the match means a
 * different word entirely.
 *
 * @param {string} token - one class name
 * @returns {boolean}
 */
function isAccidentalToken(token) {
  if (UTILITY_FALSE_POSITIVES.has(token.toLowerCase())) return true;
  if (POSITIVE_SIGNAL.test(token)) return false;
  let sawMatch = false;
  for (const source of REMOVAL_SOURCES) {
    const scan = new RegExp(source, 'gi');
    let match;
    while ((match = scan.exec(token)) !== null) {
      if (match[0].length === 0) {
        scan.lastIndex += 1;
        continue;
      }
      sawMatch = true;
      const before = token[match.index - 1];
      if (before === undefined || !/[a-z0-9]/i.test(before)) return false;
    }
  }
  return sawMatch;
}

/**
 * Strip the class tokens that would make Readability discard an element over a
 * word the class does not actually contain.
 *
 * Only whole tokens that are accidental on every match are removed, so a class
 * carrying a real signal survives: an element still genuinely marked `sidebar`
 * or `hidden` is still dropped, as it should be. Ids are left alone — they
 * anchor in-page links, and the class attribute is what these frameworks put
 * their names on.
 *
 * @param {Document} document - mutated in place
 * @returns {number} how many elements were sanitized
 */
export function sanitizeAccidentalClasses(document) {
  let sanitized = 0;
  for (const el of Array.from(document.querySelectorAll('[class]'))) {
    const className = el.getAttribute('class') || '';
    const tokens = className.split(/\s+/).filter(Boolean);
    const kept = tokens.filter((token) => !isAccidentalToken(token));
    if (kept.length === tokens.length) continue;

    if (kept.length > 0) el.setAttribute('class', kept.join(' '));
    else el.removeAttribute('class');
    sanitized += 1;
  }
  return sanitized;
}

/**
 * Readability's own data-table test (`_markDataTables`): 10+ rows or more than
 * 4 columns means the table carries data rather than layout, counting
 * rowspan/colspan the way Readability does.
 * @param {HTMLTableElement} table
 * @returns {boolean}
 */
function isDataTable(table) {
  let rows = 0;
  let columns = 0;
  for (const row of Array.from(table.rows)) {
    rows += parseInt(row.getAttribute('rowspan') || '1', 10) || 1;
    let columnsInRow = 0;
    for (const cell of Array.from(row.cells)) {
      columnsInRow += parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
    }
    columns = Math.max(columns, columnsInRow);
  }
  return rows >= 10 || columns > 4;
}

/**
 * Extract a page's main content, re-attaching data tables Readability dropped.
 *
 * `title` is Readability's article title, which it strips out of `html` — a
 * caller feeding this to an LLM has to put it back or the headline is simply
 * not in the text (the IANA page's main content never says "Example Domains").
 *
 * @param {string} html - the page's HTML
 * @param {string} [url] - document URL, used as the base for relative links
 * @returns {{ html: string|null, title: string, tablesRecovered: number }} `html`
 *   is null when Readability found no article; callers decide what to fall back to.
 */
export function extractMainContent(html, url) {
  let article;
  try {
    const dom = new JSDOM(html, { url });
    sanitizeAccidentalClasses(dom.window.document);
    article = new Readability(dom.window.document).parse();
  } catch {
    return { html: null, title: '', tablesRecovered: 0 };
  }
  if (!article || !article.content) return { html: null, title: '', tablesRecovered: 0 };

  const title = article.title || '';

  // Nothing to recover, and no reason to pay for a second parse.
  if (!/<table[\s>]/i.test(html)) {
    return { html: article.content, title, tablesRecovered: 0 };
  }

  // Readability mutates the document it is handed — the dropped tables are
  // already gone from `dom` by the time parse() returns — so recovery has to
  // parse the original HTML again.
  let recovered;
  try {
    const fresh = new JSDOM(html, { url });
    const kept = normalizeWhitespace(article.textContent || '');
    recovered = Array.from(fresh.window.document.querySelectorAll('table'))
      // A nested table travels with its parent; re-attaching it separately
      // would duplicate it.
      .filter((table) => !table.parentElement?.closest('table'))
      .filter(isDataTable)
      .filter((table) => {
        const signature = normalizeWhitespace(table.textContent || '').slice(0, SIGNATURE_LENGTH);
        return signature.length > 0 && !kept.includes(signature);
      })
      .map((table) => table.outerHTML);
  } catch {
    return { html: article.content, title, tablesRecovered: 0 };
  }

  return {
    html: recovered.length > 0 ? `${article.content}\n${recovered.join('\n')}` : article.content,
    title,
    tablesRecovered: recovered.length
  };
}

export default extractMainContent;

/**
 * _mainContent.js — Readability main-content extraction, plus recovery of the
 * data tables Readability drops.
 *
 * Readability keeps one article candidate and discards everything outside it.
 * On a table-led page that silently loses the payload: Wikipedia's *List of
 * S&P 500 companies* came back with zero table rows at scrape's default
 * onlyMainContent:true, and 505 pipe-table lines with it off. No Readability
 * option recovers them (charThreshold:100 and nbTopCandidates:20 were both
 * probed) — the tables are simply not in the candidate — so they are
 * re-attached afterwards.
 *
 * Shared by unifiedScrape (wants HTML) and extractStructured (wants text).
 */

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

// How much of a table's text is compared against the article to decide whether
// Readability already kept it. Long enough to be unique to that table.
const SIGNATURE_LENGTH = 120;

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
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

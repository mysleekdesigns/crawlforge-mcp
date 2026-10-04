/**
 * elementText — the text of a cheerio-matched element with table structure kept.
 *
 * cheerio's .text() runs every descendant's text together. For a table that
 * is one string per row with no cell boundaries: scrape_with_actions'
 * extractionOptions.selectors returned CoinMarketCap's historical-data table
 * as "DateOpen*HighLowClose**VolumeMarket CapSep 03, 2026$77,300.17…"
 * (2026-09-04). Here a table, a row group or a row renders one line per row
 * with cells joined by " | " (the convention _mainContent.js uses for the text
 * of a recovered table), an element that wraps a table renders each table that
 * way in place, and anything else is read one line per block element through
 * crawlforge-extractors' flattenText, where .text() welded
 * "<h2>Title</h2><p>Body</p>" into "TitleBody" (R24 3.1). A cell's blocks are
 * joined by a space, so a row stays on one line.
 *
 * batch_scrape's selector extraction (batchScrape/worker.js) and
 * scrape_structured read matched elements through this helper too (5.6.6).
 */

import { flattenText } from 'crawlforge-extractors';

const ROW_GROUPS = new Set(['table', 'thead', 'tbody', 'tfoot']);

function tagOf(el) {
  return String(el?.name || el?.tagName || '').toLowerCase();
}

function cellText($, cell) {
  return flattenText($, $(cell)).replace(/\s+/g, ' ');
}

function rowText($, row) {
  return $(row).children('td, th').map((_, cell) => cellText($, cell)).get().join(' | ');
}

/**
 * One line per row, cells joined by " | ". `el` is a table or one of its row
 * groups; rows of a table nested inside a cell belong to that table, not to
 * this one, so they are skipped here (their cell already carries their text).
 */
function tableText($, el) {
  const table = tagOf(el) === 'table' ? el : $(el).closest('table').get(0);
  return $(el).find('tr')
    .filter((_, row) => $(row).closest('table').get(0) === table)
    .map((_, row) => rowText($, row)).get()
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {object} el - a cheerio/domhandler element
 * @returns {string}
 */
export function elementText($, el) {
  const tag = tagOf(el);
  if (tag === 'tr') return rowText($, el);
  if (ROW_GROUPS.has(tag)) return tableText($, el);

  const $el = $(el);
  if ($el.find('table').length === 0) return flattenText($, $el);

  // A wrapper around one or more tables: swap each outermost table for one
  // block per row line (set as text, so cell content is never re-parsed as
  // markup), then read the wrapper one line per block.
  const $clone = $el.clone();
  $clone.find('table')
    .filter((_, table) => $(table).parents('table').length === 0)
    .each((_, table) => {
      const $rows = $('<div></div>');
      for (const line of tableText($, table).split('\n')) $rows.append($('<div></div>').text(line));
      $(table).replaceWith($rows);
    });
  return flattenText($, $clone);
}

export default elementText;

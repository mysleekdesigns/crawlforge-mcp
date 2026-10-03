/**
 * extract_text — Extract clean text content from HTML.
 * Extracted from server.js inline handler.
 * D3.1: Added output_format:"markdown" option backed by Turndown.
 * B1: Preserve block structure for text mode; use Readability + GFM for markdown mode.
 * E3: Text mode reads through crawlforge-extractors' flattenText, as the REST
 * route does; `selector` and `max_length` take the REST route's meaning.
 */

import { load } from 'cheerio';
import { flattenText } from 'crawlforge-extractors';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { fetchLadder, ladderErrorResult, isJsonType } from '../../utils/fetchLadder.js';
import { htmlToMarkdown } from '../../utils/htmlToMarkdown.js';

// Block-level elements whose boundaries should become paragraph breaks
const BLOCK_ELEMENTS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'pre', 'td', 'th', 'dt', 'dd',
  'article', 'section', 'figure', 'figcaption', 'aside',
  'header', 'footer', 'main', 'nav', 'form', 'fieldset',
  'table', 'tr', 'caption'
]);

/**
 * Extract plain text from a cheerio root preserving block-element paragraph breaks.
 * @param {import('cheerio').CheerioAPI} $ - loaded cheerio instance
 * @returns {string}
 */
export function extractBlockText($) {
  const parts = [];

  function walk(node) {
    if (node.type === 'text') {
      const t = node.data.replace(/[ \t\r\n]+/g, ' ');
      if (t.trim()) parts.push(t);
      return;
    }
    if (node.type !== 'tag') return;
    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    const isBlock = BLOCK_ELEMENTS.has(tag);
    if (isBlock) parts.push('\n\n');
    for (const child of (node.children || [])) {
      walk(child);
    }
    if (isBlock) parts.push('\n\n');
  }

  const body = $('body').get(0);
  if (body) {
    for (const child of (body.children || [])) walk(child);
  }

  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Convert raw HTML to GFM markdown using Readability + Turndown.
 * Accepts the original HTML string and the final URL (needed for Readability).
 * Returns the markdown string.
 * @param {string} html - raw HTML
 * @param {string} pageUrl - URL of the page (used by Readability)
 * @returns {string}
 */
export function readabilityToMarkdown(html, pageUrl) {
  let articleHtml;
  try {
    const dom = new JSDOM(html, { url: pageUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    articleHtml = article ? article.content : html;
  } catch {
    articleHtml = html;
  }
  const $ = load(articleHtml);
  absoluteUrls($, pageUrl);
  gridTables($);
  return htmlToMarkdown($.html());
}

/**
 * Resolve image and link URLs against the page, as Readability does for the
 * article it keeps. A selector's matches skip Readability, so Wikipedia's
 * "//upload.wikimedia.org/..." images stayed protocol-relative (R24 3.12).
 * In-page "#anchor" links stay as written.
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} pageUrl
 */
export function absoluteUrls($, pageUrl) {
  let base = pageUrl;
  try { base = new URL($('base[href]').attr('href') ?? '', pageUrl).href; } catch { /* page URL */ }
  $('img[src], a[href]').each((_, el) => {
    const attr = el.name === 'img' ? 'src' : 'href';
    const value = $(el).attr(attr);
    if (value.startsWith('#')) return;
    try { $(el).attr(attr, new URL(value, base).href); } catch { /* left as written */ }
  });
}

/** The cell's span, a whole number from 1 to max. */
function span(cell, attr, max) {
  const n = parseInt(cell.attribs?.[attr], 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : 1;
}

// Block elements inside a cell; each line break they make splits a markdown table row.
const CELL_BLOCKS = 'p, div, ul, ol, li, dl, dt, dd, h1, h2, h3, h4, h5, h6, blockquote, pre, figure, figcaption, center';

/** A cell's content on one line: <br> and block elements become spaces and spans. */
function inlineCellHtml($, cell) {
  const $cell = $(cell).clone();
  $cell.find('br').replaceWith(' ');
  $cell.find(CELL_BLOCKS).each((_, el) => {
    el.name = 'span';
    $(el).after(' ');
  });
  return $cell.html().trim();
}

/**
 * Rewrite each data table (one with a header row) as a plain grid: one header
 * row, every row as wide as the widest, each cell on one line. A two-level
 * header (Wikipedia's "Height" over "m" and "ft") gave a 10-column header over
 * 11-column rows, a rowspan left later rows a cell short, and a <div> in a
 * cell broke its row in two (R24 3.12). Stacked header cells over a column
 * are joined by a space ("Height m"); a rowspan cell repeats on each row it
 * covers, a colspan cell fills its first column and leaves the rest empty.
 * Tables with no header row (layout tables) and nested tables are left as
 * they are.
 * @param {import('cheerio').CheerioAPI} $
 */
export function gridTables($) {
  $('table').each((_, table) => {
    const $table = $(table);
    if ($table.find('table').length > 0 || $table.parents('table').length > 0) return;
    const rows = $table.find('tr').toArray();
    if (rows.length === 0) return;

    // grid[r][c] = { cell, copy: 'row' | 'col' | undefined }
    const grid = rows.map(() => []);
    rows.forEach((row, r) => {
      let c = 0;
      for (const cell of $(row).children('th, td').toArray()) {
        while (grid[r][c]) c++;
        const colspan = span(cell, 'colspan', 1000);
        const rowspan = span(cell, 'rowspan', rows.length - r);
        for (let i = 0; i < rowspan; i++) {
          for (let j = 0; j < colspan; j++) {
            grid[r + i][c + j] = { cell, copy: j > 0 ? 'col' : i > 0 ? 'row' : undefined };
          }
        }
        c += colspan;
      }
    });

    const width = Math.max(...grid.map((row) => row.length));
    const isHeaderRow = (row) => row.length > 0 && row.some((slot) => slot?.cell.name === 'th') &&
      row.every((slot) => !slot || slot.cell.name === 'th' || $(slot.cell).text().trim() === '');
    let headerRows = 0;
    while (headerRows < grid.length - 1 && isHeaderRow(grid[headerRows])) headerRows++;
    if (headerRows === 0) return;

    const header = [];
    for (let c = 0; c < width; c++) {
      const cells = [...new Set(grid.slice(0, headerRows).map((row) => row[c]?.cell).filter(Boolean))];
      header.push(`<th>${cells.map((cell) => inlineCellHtml($, cell)).filter(Boolean).join(' ')}</th>`);
    }
    const body = grid.slice(headerRows).map((row) => {
      const cells = [];
      for (let c = 0; c < width; c++) {
        const slot = row[c];
        cells.push(`<td>${slot && slot.copy !== 'col' ? inlineCellHtml($, slot.cell) : ''}</td>`);
      }
      return `<tr>${cells.join('')}</tr>`;
    });
    const caption = $table.children('caption').first();
    $table.replaceWith(
      `<table>${caption.length ? $.html(caption) : ''}<thead><tr>${header.join('')}</tr></thead>` +
      `<tbody>${body.join('')}</tbody></table>`
    );
  });
}

/**
 * Cut text to max_length characters and mark the cut with '...' (the REST rule).
 * @param {string} text
 * @param {number} [maxLength]
 * @returns {string}
 */
function truncate(text, maxLength) {
  return isCut(text, maxLength) ? text.substring(0, maxLength) + '...' : text;
}

/** Whether max_length cuts the text; the result says so as `truncated` (R24 3.12). */
function isCut(text, maxLength) {
  return Boolean(maxLength) && text.length > maxLength;
}

/**
 * @param {{ url: string, remove_scripts?: boolean, remove_styles?: boolean,
 *   output_format?: "text"|"markdown", selector?: string, max_length?: number,
 *   user_agent?: string, respect_robots?: boolean,
 *   escalate?: boolean, escalate_engine?: string }} params
 * @param {Function} [escalateFetch] the stealth escalation stage
 */
async function extractText({ url, remove_scripts, remove_styles, output_format, selector, max_length, user_agent, respect_robots, escalate, escalate_engine }, escalateFetch) {
  try {
    const ladder = await fetchLadder(url, {
      tool: 'extract_text',
      userAgent: user_agent,
      respectRobots: respect_robots,
      escalate: escalate === true,
      escalateEngine: escalate_engine,
      escalateFetch
    });
    if (ladder.html === undefined) return ladderErrorResult('extract_text', 'Failed to extract text: ', ladder);

    const extras = {
      ...ladder.fields,
      ...(ladder.warnings.length > 0 ? { warnings: ladder.warnings } : {})
    };

    // A JSON body has no markup to strip: it is returned as it came.
    if (isJsonType(ladder.type)) {
      const body = truncate(ladder.html, max_length);
      const format = output_format === 'markdown' ? 'markdown' : 'text';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            url: ladder.url,
            [format]: body,
            output_format: format,
            word_count: body.split(/\s+/).filter(w => w.length > 0).length,
            char_count: body.length,
            truncated: isCut(ladder.html, max_length),
            ...ladder.fields,
            warnings: [...ladder.warnings, 'the target returned application/json; its body is returned as text']
          }, null, 2)
        }]
      };
    }

    const html = ladder.html;
    const $ = load(html);

    if (remove_scripts !== false) $('script').remove();
    if (remove_styles !== false) $('style').remove();

    // <noscript> contents are parsed as raw TEXT when scripting is enabled
    // (cheerio/parse5 default, per the HTML spec), so leaving them in leaks
    // literal markup into the extracted text — e.g. Wikipedia's
    // Special:CentralAutoLogin 1x1 <img> tracking pixel. Browsers with JS
    // enabled never render noscript content, so always strip it.
    $('noscript').remove();

    // A selector names the content, so the boilerplate strip is skipped.
    let $target;
    if (selector) {
      $target = $(selector);
      if ($target.length === 0) throw new Error(`No elements found for selector: ${selector}`);
    } else {
      $('nav, header, footer, aside, .advertisement, .ad, .sidebar').remove();
    }

    const result = {
      url: ladder.url
    };

    if (output_format === 'markdown') {
      // Run Readability first to get main content, then convert to GFM markdown;
      // a selector's matches are converted as they are.
      let markdown;
      if ($target) {
        absoluteUrls($, ladder.url);
        const $matches = load($target.toArray().map(el => $.html(el)).join('\n'));
        gridTables($matches);
        markdown = htmlToMarkdown($matches('body').html());
      } else {
        markdown = readabilityToMarkdown(html, ladder.url);
      }
      result.markdown = truncate(markdown, max_length);
      result.truncated = isCut(markdown, max_length);
      result.output_format = 'markdown';
      const plainText = result.markdown.replace(/[#*`_\[\]]/g, '').replace(/\s+/g, ' ').trim();
      result.word_count = plainText.split(/\s+/).filter(w => w.length > 0).length;
      result.char_count = plainText.length;
    } else {
      const fullText = flattenText($, $target);
      const text = truncate(fullText, max_length);
      result.text = text;
      result.truncated = isCut(fullText, max_length);
      result.output_format = 'text';
      result.word_count = text.split(/\s+/).filter(w => w.length > 0).length;
      result.char_count = text.length;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ ...result, ...extras }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to extract text: ${error.message}` }],
      isError: true
    };
  }
}

/**
 * @param {{ escalateFetch?: (args: { url: string, engine: string, respectRobots?: boolean }) => Promise<object> }} [deps]
 *   the stealth escalation stage (server.js `stealthEscalation`); without it
 *   an escalation that would run is reported as unavailable
 */
export function createExtractTextHandler({ escalateFetch } = {}) {
  return (params) => extractText(params, escalateFetch);
}

/** The handler with no escalation stage wired (tests; server.js wires its own). */
export const extractTextHandler = createExtractTextHandler();

/**
 * htmlToMarkdown -- thin wrapper around the Turndown HTML-to-Markdown library.
 *
 * Usage:
 *   import { htmlToMarkdown } from '../../utils/htmlToMarkdown.js';
 *   const md = htmlToMarkdown(rawHtml);
 *
 * Design notes:
 * - Turndown is the most widely-used, battle-tested HTML->Markdown converter.
 * - We configure it with sensible defaults for RAG workflows:
 *     headingStyle: 'atx'       -> # H1 / ## H2 instead of underline style
 *     codeBlockStyle: 'fenced'  -> triple-backtick fences
 *     bulletListMarker: '-'
 * - GFM plugin enabled for table support (turndown-plugin-gfm).
 */

import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

let _td = null;

function getTurndown() {
  if (_td === null) {
    _td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '_',
      strongDelimiter: '**',
      hr: '---',
      linkStyle: 'inlined'
    });

    // Enable GFM extensions (tables, strikethrough, task lists)
    _td.use(gfm);

    // Remove boilerplate elements before converting
    _td.remove(['script', 'style', 'nav', 'footer', 'aside', 'noscript']);
  }
  return _td;
}

/**
 * Convert an HTML string to Markdown.
 * Returns an empty string if html is falsy.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToMarkdown(html) {
  if (!html) return '';
  try {
    return getTurndown().turndown(html).trim();
  } catch {
    // Fallback: strip tags, return plain text
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

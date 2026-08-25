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
import { stripHiddenHtml } from './hiddenContent.js';

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
 * @param {Object} [options]
 * @param {string} [options.css] - Extra stylesheet text used to resolve visibility
 * @param {boolean} [options.keepHiddenContent] - Skip the hidden-content strip
 * @returns {string}
 */
export function htmlToMarkdown(html, options = {}) {
  if (!html) return '';
  try {
    // Drop content a browser would not paint before converting. Turndown keeps
    // the text of screen-reader-only labels and state-gated badges, which then
    // reads as live page content once the CSS is gone.
    const visible = options.keepHiddenContent
      ? html
      : stripHiddenHtml(html, { css: options.css });
    return getTurndown().turndown(visible).trim();
  } catch {
    // Fallback: strip tags, return plain text
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

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

// Mirrors turndown-plugin-gfm's own heading-row test, which is what decides
// whether it converts a table or keeps it as raw HTML.
function isHeadingRow(tr) {
  const parent = tr.parentNode;
  if (!parent) return false;
  if (parent.nodeName === 'THEAD') return true;
  const firstTbody =
    parent.nodeName === 'TBODY' &&
    (!parent.previousSibling ||
      (parent.previousSibling.nodeName === 'THEAD' &&
        /^\s*$/.test(parent.previousSibling.textContent)));
  return (
    parent.firstChild === tr &&
    (parent.nodeName === 'TABLE' || firstTbody) &&
    Array.prototype.every.call(tr.childNodes, n => n.nodeName === 'TH')
  );
}

function isLayoutTable(node) {
  return (
    node.nodeName === 'TABLE' &&
    !(node.rows && node.rows[0] && isHeadingRow(node.rows[0]))
  );
}

function isInLayoutTable(node) {
  for (let p = node.parentNode; p; p = p.parentNode) {
    if (p.nodeName === 'TABLE') return isLayoutTable(p);
  }
  return false;
}

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

    // turndown-plugin-gfm only converts a table whose first row is all <th>;
    // every other table is passed through its `keep` filter as raw HTML. Pages
    // we scrape are full of layout tables (Hacker News, older sites), so that
    // leaks <table> markup into a field the caller asked for as markdown.
    // Rules added here are matched before keep filters, so these reclaim the
    // tables the plugin skipped and flatten them to their cell content, while
    // real data tables still reach the plugin and render as pipe tables.
    _td.addRule('layoutTable', {
      filter: isLayoutTable,
      replacement: content => '\n\n' + content.replace(/\n{3,}/g, '\n\n').trim() + '\n\n'
    });
    _td.addRule('layoutTableCell', {
      filter: node => (node.nodeName === 'TH' || node.nodeName === 'TD') && isInLayoutTable(node),
      replacement: content => (content.trim() ? content.trim() + '  ' : '')
    });
    _td.addRule('layoutTableRow', {
      filter: node => node.nodeName === 'TR' && isInLayoutTable(node),
      replacement: content => (content.trim() ? content.trim() + '\n' : '')
    });

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

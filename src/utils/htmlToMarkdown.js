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
import { load } from 'cheerio';
import { stripHiddenHtml } from './hiddenContent.js';

let _td = null;

/**
 * turndown-plugin-gfm renders a table as a pipe table only when its first row
 * is entirely <th>. A corner cell written as an empty <td> — WestJet's fee
 * table opens `<td> </td><th>1st Bag</th><th>2nd Bag</th>` — fails that test,
 * so the whole table fell to the layout-table rule and flattened to text
 * lines with the columns lost (R20, 2026-09-07). Promote empty corner cells
 * in an otherwise all-<th> first row so the table renders as a table.
 * @param {string} html
 * @returns {string}
 */
export function promoteCornerHeaderCells(html) {
  if (!/<th[\s>]/i.test(html)) return html;
  try {
    const $ = load(html);
    let changed = false;
    $('table').each((_, table) => {
      const firstRow = $(table).find('tr').first();
      if (!firstRow.length || firstRow.closest('table')[0] !== table) return;
      const cells = firstRow.children('th, td');
      const tds = cells.filter('td');
      if (cells.filter('th').length === 0 || tds.length === 0) return;
      if (tds.toArray().some((td) => $(td).text().trim() !== '')) return;
      tds.each((__, td) => { td.name = 'th'; });
      changed = true;
    });
    return changed ? $.html() : html;
  } catch {
    return html;
  }
}

const SKIP_LANGUAGES = new Set(['default', 'none']);

/**
 * Find a code block's language in the markup that names it: `data-language`,
 * a `language-x`/`lang-x` class, MDN's `brush: x` class, a Sphinx
 * `highlight-x` wrapper, or MDN's `.example-header .language-name` label.
 * @param {import('cheerio').Cheerio<any>} pre
 * @returns {string}
 */
function codeLanguage(pre) {
  const code = pre.children('code').first();
  const fromData = pre.attr('data-language') || code.attr('data-language');
  if (fromData) return fromData;
  for (const cls of [code.attr('class'), pre.attr('class')]) {
    const m = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(cls || '') || /brush:\s*([\w+#.-]+)/.exec(cls || '');
    if (m) return m[1];
  }
  const wrapper = pre.closest('[class*="highlight-"]');
  const m = /(?:^|\s)highlight-([\w+#.-]+)/.exec(wrapper.attr('class') || '');
  if (m && !SKIP_LANGUAGES.has(m[1])) return m[1];
  return pre.closest('.code-example').find('.example-header .language-name').first().text().trim();
}

/**
 * Sphinx (docs.python.org) highlights code as `<pre>` full of `<span>`s with
 * no `<code>`, so Turndown treated it as prose and escaped it (`\# comment`,
 * `spam \= 1`); MDN puts a "js" language label and copy button in a header
 * before each `<pre>`, which came out as a stray `js` line (live sweep
 * 2026-10-20, 2.2). Rewrite every `<pre>` as `<pre><code>` holding its plain
 * text with the language in `data-language` (Readability strips classes but
 * keeps data attributes), and drop MDN's example headers. Run it before
 * Readability as well as here, while the classes that name the language exist.
 * @param {string} html
 * @returns {string}
 */
export function normalizeCodeBlocks(html) {
  if (!/<pre[\s>]/i.test(html)) return html;
  try {
    const $ = load(html);
    $('pre').each((_, el) => {
      const pre = $(el);
      const language = codeLanguage(pre);
      pre.find('br').replaceWith('\n');
      const code = $('<code></code>').text(pre.text());
      if (language) {
        pre.attr('data-language', language);
        code.attr('data-language', language);
      }
      pre.empty().append(code);
    });
    $('.code-example > .example-header').remove();
    return $.html();
  } catch {
    return html;
  }
}

const ROW_CONTAINER = /^(table|thead|tbody|tfoot)$/;

/**
 * Readability serializes a layout table it half-kept as `<tbody>`/`<tr>` with
 * no `<table>` around them. An HTML parser drops row and cell tags outside a
 * table, so on Hacker News every story's cells ran together into one line
 * ("…(github.com/x)62 points by … 39 comments2.") and the layout-table rules
 * never saw a row (R25, 2026-10-19). htmlparser2 keeps the orphans, so they
 * are found there and each run of adjacent ones is wrapped in a `<table>`.
 * @param {string} html
 * @returns {string}
 */
export function wrapOrphanRows(html) {
  if (!/<(tr|tbody|thead|tfoot)[\s>]/i.test(html)) return html;
  try {
    const $ = load(html, { xml: { xmlMode: false, decodeEntities: false } }, false);
    const created = new Set();
    $('thead, tbody, tfoot, tr').each((_, el) => {
      if (el.parent && ROW_CONTAINER.test(el.parent.name)) return;
      const prev = $(el).prev();
      if (prev.length && created.has(prev[0])) {
        prev.append(el);
      } else {
        $(el).wrap('<table></table>');
        created.add(el.parent);
      }
    });
    return created.size > 0 ? $.html() : html;
  } catch {
    return html;
  }
}

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

    // Every <pre> is a fenced block of its plain text, never escaped prose;
    // the language comes from normalizeCodeBlocks' data-language.
    _td.addRule('codeBlock', {
      filter: 'pre',
      replacement: (_content, node) => {
        const text = node.textContent.replace(/\n$/, '');
        if (!text.trim()) return '';
        const code = node.firstChild && node.firstChild.nodeName === 'CODE' ? node.firstChild : null;
        const language =
          node.getAttribute('data-language') ||
          (code && (code.getAttribute('data-language') ||
            (/(?:^|\s)language-(\S+)/.exec(code.getAttribute('class') || '') || [])[1])) ||
          '';
        const longestRun = Math.max(0, ...(text.match(/`+/g) || []).map(r => r.length));
        const fence = '`'.repeat(Math.max(3, longestRun + 1));
        return '\n\n' + fence + language + '\n' + text + '\n' + fence + '\n\n';
      }
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
    const rows = wrapOrphanRows(html);
    const visible = options.keepHiddenContent
      ? rows
      : stripHiddenHtml(rows, { css: options.css });
    return getTurndown().turndown(promoteCornerHeaderCells(normalizeCodeBlocks(visible))).trim();
  } catch {
    // Fallback: strip tags, return plain text
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

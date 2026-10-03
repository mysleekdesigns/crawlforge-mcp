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
  return htmlToMarkdown(articleHtml);
}

/**
 * Cut text to max_length characters and mark the cut with '...' (the REST rule).
 * @param {string} text
 * @param {number} [maxLength]
 * @returns {string}
 */
function truncate(text, maxLength) {
  return maxLength && text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
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
      const markdown = $target
        ? htmlToMarkdown($target.toArray().map(el => $.html(el)).join('\n'))
        : readabilityToMarkdown(html, ladder.url);
      result.markdown = truncate(markdown, max_length);
      result.output_format = 'markdown';
      const plainText = result.markdown.replace(/[#*`_\[\]]/g, '').replace(/\s+/g, ' ').trim();
      result.word_count = plainText.split(/\s+/).filter(w => w.length > 0).length;
      result.char_count = plainText.length;
    } else {
      const text = truncate(flattenText($, $target), max_length);
      result.text = text;
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

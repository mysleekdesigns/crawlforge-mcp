/**
 * extract_text — Extract clean text content from HTML.
 * Extracted from server.js inline handler.
 * D3.1: Added output_format:"markdown" option backed by Turndown.
 * B1: Preserve block structure for text mode; use Readability + GFM for markdown mode.
 */

import { load } from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { fetchWithTimeout } from './_fetch.js';
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
function extractBlockText($) {
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
 * @param {{ url: string, remove_scripts?: boolean, remove_styles?: boolean, output_format?: "text"|"markdown" }} params
 */
export async function extractTextHandler({ url, remove_scripts, remove_styles, output_format }) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = load(html);

    if (remove_scripts !== false) $('script').remove();
    if (remove_styles !== false) $('style').remove();

    $('nav, header, footer, aside, .advertisement, .ad, .sidebar').remove();

    const result = {
      url: response.url
    };

    if (output_format === 'markdown') {
      // Run Readability first to get main content, then convert to GFM markdown
      let articleHtml;
      try {
        const dom = new JSDOM(html, { url: response.url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        articleHtml = article ? article.content : $.html('body');
      } catch {
        articleHtml = $.html('body');
      }
      result.markdown = htmlToMarkdown(articleHtml);
      result.output_format = 'markdown';
      const plainText = result.markdown.replace(/[#*`_\[\]]/g, '').replace(/\s+/g, ' ').trim();
      result.word_count = plainText.split(/\s+/).filter(w => w.length > 0).length;
      result.char_count = plainText.length;
    } else {
      const text = extractBlockText($);
      result.text = text;
      result.output_format = 'text';
      result.word_count = text.split(/\s+/).filter(w => w.length > 0).length;
      result.char_count = text.length;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to extract text: ${error.message}` }],
      isError: true
    };
  }
}

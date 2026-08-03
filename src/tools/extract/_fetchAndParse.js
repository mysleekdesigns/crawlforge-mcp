/**
 * _fetchAndParse.js — shared fetch + HTML parse helper for extract tools.
 *
 * Used by:
 *   extractStructured.js
 *   extractContent.js      (uses native fetch directly but can adopt this)
 *   processDocument.js     (URL sources)
 *
 * Returns { html, $, textContent, finalUrl } so callers don't repeat
 * the same fetch/cheerio/cleanup boilerplate.
 */

import { load } from 'cheerio';
import { safeFetch } from '../../utils/ssrfGuard.js';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; CrawlForge-MCP/3.0)';
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Classify a Content-Type header for the purposes of HTML parsing.
 * Missing header is treated as 'html' (permissive default — many servers,
 * and most test doubles, omit it for what is genuinely HTML).
 * @param {string|null} contentType
 * @returns {'html'|'text'|'binary'}
 */
function classifyContentType(contentType) {
  if (!contentType) return 'html';
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (
    type === 'text/html' ||
    type === 'application/xhtml+xml' ||
    type === 'application/xml' ||
    type === 'text/xml' ||
    type.endsWith('+xml') ||
    type.startsWith('text/')
  ) {
    return type === 'text/plain' ? 'text' : 'html';
  }
  if (type === 'application/json') return 'text';
  return 'binary';
}

/**
 * Fetch a URL and return parsed HTML via Cheerio.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {string}   [options.userAgent]
 * @param {number}   [options.timeoutMs]
 * @param {string[]} [options.stripTags]   — additional tags to strip (default: script, style, noscript, iframe, svg)
 * @returns {Promise<{ html: string, $: import('cheerio').CheerioAPI, textContent: string, finalUrl: string }>}
 */
export async function fetchAndParse(url, options = {}) {
  const {
    userAgent = DEFAULT_USER_AGENT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    stripTags = ['script', 'style', 'noscript', 'iframe', 'svg']
  } = options;

  const response = await safeFetch(url, {
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers?.get?.('content-type') || null;
  const classification = classifyContentType(contentType);

  if (classification === 'binary') {
    throw new Error(
      `Unsupported content type "${contentType}" — this looks like binary content, not HTML/text. Use process_document for PDFs/documents/binary files.`
    );
  }

  const html = await response.text();

  // text/plain and application/json aren't markup: running them through the
  // HTML parser risks misinterpreting substrings (e.g. a "<script>" value
  // inside a JSON string) as real tags and stripping/mangling content.
  if (classification === 'text') {
    return { html, $: load(''), textContent: html.trim(), finalUrl: response.url };
  }

  const $ = load(html);

  if (stripTags.length > 0) {
    $(stripTags.join(', ')).remove();
  }

  const textContent = $('body').text().replace(/\s+/g, ' ').trim();

  return { html, $, textContent, finalUrl: response.url };
}

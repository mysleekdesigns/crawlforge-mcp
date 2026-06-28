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

  const html = await response.text();
  const $ = load(html);

  if (stripTags.length > 0) {
    $(stripTags.join(', ')).remove();
  }

  const textContent = $('body').text().replace(/\s+/g, ' ').trim();

  return { html, $, textContent, finalUrl: response.url };
}

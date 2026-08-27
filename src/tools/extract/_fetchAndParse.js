/**
 * _fetchAndParse.js — shared fetch + HTML parse helper for extract tools.
 *
 * Used by:
 *   extractStructured.js
 *   extractContent.js      (uses native fetch directly but can adopt this)
 *   processDocument.js     (URL sources)
 *
 * Returns { html, $, textContent, finalUrl, warnings } so callers don't repeat
 * the same fetch/cheerio/cleanup boilerplate.
 */

import { load } from 'cheerio';
import { safeFetch } from '../../utils/ssrfGuard.js';
import { config } from '../../constants/config.js';
import { noteRetryAfter } from '../../utils/hostRateLimiter.js';
import { preflightFetch } from '../../utils/robotsGate.js';

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Read a response body as text while enforcing config.fetch.maxBodySize —
 * the same cap _fetch.js applies to basic tools, so a large/hostile response
 * (multi-hundred-MB file, endpoint streaming zeros) can't be buffered whole
 * into a JS string and handed to cheerio/JSDOM/Turndown downstream.
 * Content-Length is checked up front; actual bytes read are counted as a
 * backstop for servers that omit or lie about it.
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function readTextWithSizeCap(response) {
  const maxBodySize = config.fetch.maxBodySize;

  const contentLengthHeader = response.headers?.get?.('content-length') ?? null;
  if (contentLengthHeader !== null) {
    const declared = parseInt(contentLengthHeader, 10);
    if (!isNaN(declared) && declared > maxBodySize) {
      throw new Error(
        `Response body too large: Content-Length ${declared} exceeds limit of ${maxBodySize} bytes`
      );
    }
  }

  // Responses without a ReadableStream body (test mocks, already-buffered
  // responses) fall back to the native .text() with no additional guard.
  if (!response.body || typeof response.body.getReader !== 'function') {
    return response.text();
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBodySize) {
      reader.cancel();
      throw new Error(
        `Response body too large: exceeded limit of ${maxBodySize} bytes`
      );
    }
    chunks.push(value);
  }

  const mergedBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    mergedBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(mergedBytes);
}

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
 * Flatten a parsed document's <body> to text while preserving line structure.
 *
 * Cheerio's .text() joins adjacent elements with no separator, which welds
 * table rows / list items together ("1.Story title329 points") and starves
 * downstream LLM extraction (AgentOrchestrator, extractStructured,
 * extractWithLlm) of any structure to parse. Works on a detached clone so the
 * caller's $ tree is untouched — unifiedScrape reuses $ for other formats.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {string}
 */
export function flattenBodyText($) {
  // Block boundaries are marked with a U+E000 private-use sentinel so the
  // HTML source's own insignificant newlines can be collapsed to spaces
  // first, and only the sentinels become line breaks. (NUL won't survive:
  // .after()/.replaceWith() parse their argument as HTML and the parser
  // strips NUL; U+E000 passes through and never occurs in real page text.)
  const $body = $('body').clone();
  $body.find('br').replaceWith('\uE000');
  $body.find('td, th').after(' ');
  $body
    .find('p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, table, ul, ol, dl, section, article, header, footer')
    .after('\uE000');
  return $body
    .text()
    .replace(/\s+/g, ' ')
    .replace(/ ?(?:\uE000 ?)+/g, '\n')
    .trim();
}

/**
 * Fetch a URL and return parsed HTML via Cheerio.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {string}   [options.userAgent]      — per-request identity override
 * @param {boolean}  [options.respectRobots]  — false = explicit, audited override
 * @param {string}   [options.tool]           — tool name, for the audit row
 * @param {string}   [options.apiKey]         — hashed into the audit row
 * @param {number}   [options.timeoutMs]
 * @param {string[]} [options.stripTags]   — additional tags to strip (default: script, style, noscript, iframe, svg)
 * @returns {Promise<{ html: string, $: import('cheerio').CheerioAPI, textContent: string, finalUrl: string, warnings: string[] }>}
 */
export async function fetchAndParse(url, options = {}) {
  const {
    userAgent,
    respectRobots,
    tool,
    apiKey,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    stripTags = ['script', 'style', 'noscript', 'iframe', 'svg']
  } = options;

  // robots.txt / blocklist gate + per-host throttle. Throws if it refuses.
  const gate = await preflightFetch(url, { userAgent, respectRobots, tool, apiKey });
  const warnings = gate.warnings;

  const response = await safeFetch(url, {
    headers: {
      ...gate.headers,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    // Honour a back-off the host asked for before giving up on this request.
    if (response.status === 429 || response.status === 503) {
      noteRetryAfter(url, response.headers?.get?.('retry-after'));
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers?.get?.('content-type') || null;
  const classification = classifyContentType(contentType);

  if (classification === 'binary') {
    throw new Error(
      `Unsupported content type "${contentType}" — this looks like binary content, not HTML/text. Use process_document for PDFs/documents/binary files.`
    );
  }

  const html = await readTextWithSizeCap(response);

  // text/plain and application/json aren't markup: running them through the
  // HTML parser risks misinterpreting substrings (e.g. a "<script>" value
  // inside a JSON string) as real tags and stripping/mangling content.
  if (classification === 'text') {
    return { html, $: load(''), textContent: html.trim(), finalUrl: response.url, warnings };
  }

  const $ = load(html);

  if (stripTags.length > 0) {
    $(stripTags.join(', ')).remove();
  }

  const textContent = flattenBodyText($);

  return { html, $, textContent, finalUrl: response.url, warnings };
}

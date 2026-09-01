/**
 * batchScrape — worker module.
 * URL fetching, content extraction, format generation.
 * Used by queue.js (the Semaphore-based batch runner).
 */

import { load } from 'cheerio';
import { readBody } from 'crawlforge-extractors';
import { config as appConfig } from '../../../constants/config.js';
import { ssrfGuard, isSsrfError } from '../../../utils/ssrfGuard.js';
import { noteRetryAfter } from '../../../utils/hostRateLimiter.js';
import { preflightFetch } from '../../../utils/robotsGate.js';
import { htmlToMarkdown } from '../../../utils/htmlToMarkdown.js';

/**
 * Fetch a URL with AbortController timeout (SSRF-guarded + per-host throttled).
 * The timeout stays live through the body read (not just until headers
 * arrive), and the body is size-capped, so a server that sends headers then
 * drips the body can't hold a semaphore slot indefinitely or exhaust memory.
 * Returns { response, html, warnings } rather than the raw Response.
 */
export async function fetchUrl(url, options = {}) {
  const { timeout = 15000, headers = {}, userAgent, respectRobots, apiKey } = options;
  const maxBodySize = appConfig.fetch.maxBodySize;
  const guard = ssrfGuard(url); // SSRF pre-flight (throws before connecting)
  // robots.txt / blocklist gate + per-host throttle. Throws if it refuses,
  // which scrapeUrl turns into a failure for this URL alone.
  const gate = await preflightFetch(url, { userAgent, respectRobots, apiKey, tool: 'batch_scrape' });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { ...gate.headers, ...headers },
      ...guard
    });
    if (response.status === 429 || response.status === 503) {
      noteRetryAfter(url, response.headers?.get?.('retry-after'));
    }
    // crawlforge-extractors' readBody: same size cap, but decoded with the
    // body's real charset — the local reader this replaces decoded everything
    // as UTF-8, which turned lua.org's ISO-8859-1 "português" into "portugu�s".
    const html = await readBody(response, { maxBytes: maxBodySize });
    return { response, html, warnings: gate.warnings };
  } catch (error) {
    if (isSsrfError(error)) throw new Error(error.cause?.message || error.message);
    if (error.name === 'AbortError') throw new Error(`Request timeout after ${timeout}ms`);
    throw error;
  } finally {
    // Cleared only after the body read finishes (or the fetch itself fails),
    // so the abort timer keeps protecting against a trickling body, not just
    // the initial headers.
    clearTimeout(timeoutId);
  }
}

/**
 * Scrape a single URL and return a result object.
 */
export async function scrapeUrl(config, options, defaultTimeout) {
  const startTime = Date.now();
  try {
    const { response, html, warnings } = await fetchUrl(config.url, {
      headers: config.headers,
      timeout: config.timeout || defaultTimeout,
      userAgent: options.user_agent,
      respectRobots: options.respect_robots,
      apiKey: options.apiKey
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const $ = load(html);

    const result = {
      success: true,
      url: config.url,
      timestamp: Date.now(),
      executionTime: Date.now() - startTime,
      metadata: {
        status: response.status,
        contentType: response.headers.get('content-type'),
        contentLength: html.length,
        ...(config.metadata || {})
      }
    };

    if (warnings.length > 0) result.warnings = warnings;

    if (options.extractionSchema || config.selectors) {
      result.extracted = extractStructuredData($, { ...config.selectors, ...options.extractionSchema });
    }

    result.content = generateFormats($, html, options.formats);
    return result;
  } catch (error) {
    return {
      success: false,
      url: config.url,
      error: error.message,
      timestamp: Date.now(),
      executionTime: Date.now() - startTime,
      metadata: config.metadata || {}
    };
  }
}

function extractStructuredData($, selectors) {
  const extracted = {};
  for (const [key, selector] of Object.entries(selectors)) {
    try {
      const elements = $(selector);
      if (elements.length === 0) extracted[key] = null;
      else if (elements.length === 1) extracted[key] = elements.text().trim();
      else extracted[key] = elements.map((_, el) => $(el).text().trim()).get();
    } catch {
      extracted[key] = { error: `Invalid selector: ${selector}` };
    }
  }
  return extracted;
}

function generateFormats($, html, formats) {
  const content = {};
  if (formats.includes('html')) content.html = html;
  if (formats.includes('text')) content.text = $('body').text().replace(/\s+/g, ' ').trim();
  if (formats.includes('markdown')) content.markdown = buildMarkdown($);
  if (formats.includes('json')) {
    content.json = {
      title: $('title').text().trim(),
      headings: extractHeadings($),
      links: extractLinks($),
      images: extractImages($),
      metadata: extractMetadata($)
    };
  }
  return content;
}

function buildMarkdown($) {
  const title = $('title').text().trim();

  const selectors = ['article', 'main', '.content', '#content', '.post-content', '.entry-content'];
  let $body = null;
  for (const sel of selectors) {
    $body = $(sel);
    if ($body.length > 0) break;
  }
  if (!$body || $body.length === 0) $body = $('body');

  // Full-fidelity conversion via the shared Turndown helper (same converter
  // the unified `scrape` tool uses). The previous hand-rolled h1–h3/p/li walk
  // silently dropped any text living outside those tags (e.g. quotes in
  // <span>/<small> on quotes.toscrape.com).
  let md = htmlToMarkdown($.html($body));

  // C3: de-dup title — only emit the <title> heading if the page has no <h1>
  // or if the first <h1> text differs from the <title> text (case-insensitive).
  const firstH1 = $body.find('h1').first().text().trim();
  const titleDuplicated = firstH1 && firstH1.toLowerCase() === title.toLowerCase();
  if (title && !titleDuplicated) md = `# ${title}\n\n${md}`;

  return md.trim();
}

function extractHeadings($) {
  const headings = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    headings.push({ level: parseInt(el.name.substring(1)), text: $(el).text().trim(), id: $(el).attr('id') || null });
  });
  return headings;
}

function extractLinks($) {
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (href && text) links.push({ href, text, title: $(el).attr('title') || null });
  });
  return links;
}

function extractImages($) {
  const images = [];
  $('img[src]').each((_, el) => {
    images.push({
      src: $(el).attr('src'),
      alt: $(el).attr('alt') || null,
      title: $(el).attr('title') || null,
      width: $(el).attr('width') || null,
      height: $(el).attr('height') || null
    });
  });
  return images;
}

function extractMetadata($) {
  const m = {};
  m.title = $('title').text().trim();
  m.description = $('meta[name="description"]').attr('content') || '';
  m.og = {};
  $('meta[property^="og:"]').each((_, el) => {
    m.og[$(el).attr('property').replace('og:', '')] = $(el).attr('content');
  });
  m.twitter = {};
  $('meta[name^="twitter:"]').each((_, el) => {
    m.twitter[$(el).attr('name').replace('twitter:', '')] = $(el).attr('content');
  });
  return m;
}

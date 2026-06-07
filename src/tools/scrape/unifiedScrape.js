/**
 * unifiedScrape — single-fetch, multi-format scraping tool.
 *
 * One call, one fetch.  formats[] drives what is returned.
 * Mirrors the output shape of ScrapeWithActionsTool.generateFormats():
 *   content.html, content.rawHtml, content.text, content.markdown,
 *   content.links, content.metadata, content.screenshots, content.json
 *
 * onlyMainContent maps to Readability boilerplate removal (same as extractContent).
 * Partial success: per-format warnings[] never fail the whole call.
 */

import { z } from 'zod';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { fetchAndParse } from '../extract/_fetchAndParse.js';
import { htmlToMarkdown } from '../../utils/htmlToMarkdown.js';
import { extractBlockText, readabilityToMarkdown } from '../basic/extractText.js';

// ── Schema ────────────────────────────────────────────────────────────────────

const JsonFormatSchema = z.object({
  type: z.literal('json'),
  schema: z.record(z.any()).optional(),
  prompt: z.string().optional()
});

const FormatSchema = z.union([
  z.enum(['markdown', 'html', 'rawHtml', 'text', 'links', 'metadata', 'screenshot']),
  JsonFormatSchema
]);

export const UnifiedScrapeSchema = z.object({
  url: z.string().url(),
  formats: z.array(FormatSchema).min(1).default(['markdown']),
  onlyMainContent: z.boolean().optional().default(true),
  // Pass-through to fetchAndParse
  timeoutMs: z.number().min(1000).max(60000).optional().default(15000)
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract links from a loaded cheerio $ and the page URL.
 */
function extractLinksFromDom($, pageUrl) {
  const links = [];
  const seen = new Set();
  let pageOrigin = '';
  try { pageOrigin = new URL(pageUrl).origin; } catch { /* ignore */ }

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href) return;
    try {
      let absoluteUrl;
      let isExternal = false;
      if (href.startsWith('http://') || href.startsWith('https://')) {
        absoluteUrl = href;
        isExternal = new URL(href).origin !== pageOrigin;
      } else if (href.startsWith('#') || href.startsWith('javascript:')) {
        return;
      } else {
        absoluteUrl = new URL(href, pageUrl).toString();
        isExternal = false;
      }
      if (!seen.has(absoluteUrl)) {
        seen.add(absoluteUrl);
        links.push({ href: absoluteUrl, text, is_external: isExternal, original_href: href });
      }
    } catch { /* skip invalid */ }
  });

  return {
    links,
    total_count: links.length,
    internal_count: links.filter(l => !l.is_external).length,
    external_count: links.filter(l => l.is_external).length
  };
}

/**
 * Extract metadata from a loaded cheerio $.
 */
function extractMetadataFromDom($, pageUrl) {
  // JSON-LD
  const jsonLd = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try { const raw = $(el).html(); if (raw) jsonLd.push(JSON.parse(raw)); } catch { /* skip */ }
  });

  // Microdata
  const microdata = [];
  $('[itemscope]').each((_, el) => {
    const $el = $(el);
    const item = { type: $el.attr('itemtype') || null, properties: {} };
    $el.find('[itemprop]').each((_, prop) => {
      const $prop = $(prop);
      const name = $prop.attr('itemprop');
      if (!name) return;
      const tag = ($prop.get(0).tagName || '').toLowerCase();
      let value;
      if (tag === 'meta') value = $prop.attr('content');
      else if (tag === 'a' || tag === 'link') value = $prop.attr('href');
      else if (tag === 'img') value = $prop.attr('src');
      else if (tag === 'time') value = $prop.attr('datetime') || $prop.text().trim();
      else value = $prop.text().trim();
      if (value) {
        if (!item.properties[name]) item.properties[name] = [];
        item.properties[name].push(value);
      }
    });
    microdata.push(item);
  });

  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim() ||
    $('h1').first().text().trim() || '';

  const ogTags = {};
  $('meta[property^="og:"]').each((_, el) => {
    const property = $(el).attr('property');
    const content = $(el).attr('content');
    if (property && content) ogTags[property.replace('og:', '')] = content;
  });

  const twitterTags = {};
  $('meta[name^="twitter:"]').each((_, el) => {
    const name = $(el).attr('name');
    const content = $(el).attr('content');
    if (name && content) twitterTags[name.replace('twitter:', '')] = content;
  });

  return {
    title,
    description: $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '',
    keywords: ($('meta[name="keywords"]').attr('content') || '').split(',').map(k => k.trim()).filter(Boolean),
    canonical_url: $('link[rel="canonical"]').attr('href') || '',
    author: $('meta[name="author"]').attr('content') || '',
    robots: $('meta[name="robots"]').attr('content') || '',
    viewport: $('meta[name="viewport"]').attr('content') || '',
    og_tags: ogTags,
    twitter_tags: twitterTags,
    json_ld: jsonLd,
    microdata,
    url: pageUrl
  };
}

// ── Tool class ────────────────────────────────────────────────────────────────

export class UnifiedScrapeTool {
  constructor(options = {}) {
    this._extractWithLlm = null;
    this._extractWithLlmConfig = options.llmConfig || {};
  }

  /** Lazy-load ExtractWithLlm to avoid pulling in heavy deps unless needed. */
  async _getExtractWithLlm() {
    if (!this._extractWithLlm) {
      const { ExtractWithLlm } = await import('../extract/extractWithLlm.js');
      this._extractWithLlm = new ExtractWithLlm(this._extractWithLlmConfig);
    }
    return this._extractWithLlm;
  }

  /**
   * Execute a unified scrape.
   * @param {object} params - UnifiedScrapeSchema-compatible input
   * @returns {Promise<object>}
   */
  async execute(params) {
    const validated = UnifiedScrapeSchema.parse(params);
    const { url, formats, onlyMainContent, timeoutMs } = validated;

    // Single fetch
    let html, $, finalUrl;
    try {
      ({ html, $, finalUrl } = await fetchAndParse(url, {
        timeoutMs,
        stripTags: [] // we handle boilerplate ourselves
      }));
    } catch (err) {
      throw new Error(`scrape: fetch failed for ${url}: ${err.message}`);
    }

    // For onlyMainContent: extract main-content html via Readability once
    let mainHtml = null;
    function getMainHtml() {
      if (mainHtml !== null) return mainHtml;
      try {
        const dom = new JSDOM(html, { url: finalUrl });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        mainHtml = article ? article.content : html;
      } catch {
        mainHtml = html;
      }
      return mainHtml;
    }

    const content = {};
    const warnings = [];

    for (const fmt of formats) {
      // JSON format object
      if (fmt && typeof fmt === 'object' && fmt.type === 'json') {
        try {
          const extractWithLlm = await this._getExtractWithLlm();
          const text = onlyMainContent
            ? htmlToMarkdown(getMainHtml())
            : $('body').text().replace(/\s+/g, ' ').trim();
          const result = await extractWithLlm.execute({
            content: text,
            prompt: fmt.prompt || 'Extract structured data from this page content.',
            schema: fmt.schema,
            provider: 'auto'
          });
          content.json = result.success ? result.data : { error: result.error };
          if (!result.success) {
            warnings.push(`json: extraction failed — ${result.error}`);
          }
        } catch (err) {
          content.json = { error: err.message };
          warnings.push(`json: ${err.message}`);
        }
        continue;
      }

      // String formats
      switch (fmt) {
        case 'markdown':
          try {
            content.markdown = onlyMainContent
              ? readabilityToMarkdown(html, finalUrl)
              : htmlToMarkdown($.html('body') || html);
          } catch (err) {
            content.markdown = '';
            warnings.push(`markdown: ${err.message}`);
          }
          break;

        case 'html':
          try {
            content.html = onlyMainContent ? getMainHtml() : $.html('body') || html;
          } catch (err) {
            content.html = '';
            warnings.push(`html: ${err.message}`);
          }
          break;

        case 'rawHtml':
          content.rawHtml = html;
          break;

        case 'text':
          try {
            if (onlyMainContent) {
              // Plain text from Readability main content via cheerio
              const { load } = await import('cheerio');
              const $main = load(getMainHtml());
              $main('script, style').remove();
              content.text = extractBlockText($main);
            } else {
              $('script, style').remove();
              content.text = extractBlockText($);
            }
          } catch (err) {
            content.text = '';
            warnings.push(`text: ${err.message}`);
          }
          break;

        case 'links':
          try {
            content.links = extractLinksFromDom($, finalUrl);
          } catch (err) {
            content.links = { links: [], total_count: 0, internal_count: 0, external_count: 0 };
            warnings.push(`links: ${err.message}`);
          }
          break;

        case 'metadata':
          try {
            content.metadata = extractMetadataFromDom($, finalUrl);
          } catch (err) {
            content.metadata = {};
            warnings.push(`metadata: ${err.message}`);
          }
          break;

        case 'screenshot':
          // Screenshot requires a browser; not available in the basic scrape path.
          content.screenshots = [];
          warnings.push('screenshot: browser screenshots are not available in the scrape tool; use scrape_with_actions for screenshots');
          break;

        default:
          warnings.push(`unknown format: ${String(fmt)}`);
      }
    }

    return {
      success: true,
      url: finalUrl,
      content,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
}

export default UnifiedScrapeTool;

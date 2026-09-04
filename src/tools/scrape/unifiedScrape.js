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
import { fetchAndParse } from '../extract/_fetchAndParse.js';
import { extractMainContent, isThinMainContent } from './_mainContent.js';
import { htmlToMarkdown } from '../../utils/htmlToMarkdown.js';
import { stripHiddenFromDom } from '../../utils/hiddenContent.js';
import { extractBlockText } from '../basic/extractText.js';
import { pageTitle } from '../../utils/pageTitle.js';

// ── Schema ────────────────────────────────────────────────────────────────────

const JsonFormatSchema = z.object({
  type: z.literal('json'),
  schema: z.record(z.any()).optional(),
  prompt: z.string().optional()
});

const FormatSchema = z.union([
  z.enum(['markdown', 'html', 'rawHtml', 'text', 'links', 'metadata', 'screenshot', 'branding']),
  JsonFormatSchema
]);

export const UnifiedScrapeSchema = z.object({
  url: z.string().url(),
  formats: z.array(FormatSchema).min(1).default(['markdown']),
  onlyMainContent: z.boolean().optional().default(true),
  // Remove content a browser would not paint (screen-reader-only labels,
  // state-gated theme badges) before deriving any format. "linked" also fetches
  // the page's stylesheets, which is what resolves class-driven display:none;
  // "inline" uses only the document's own <style> blocks and costs no requests.
  resolveHiddenContent: z.enum(['linked', 'inline', 'off']).optional().default('linked'),
  // Pass-through to fetchAndParse
  timeoutMs: z.number().min(1000).max(60000).optional().default(15000),
  // Compliance overrides, per request: identify as yourself for a target you
  // have your own agreement with, and take responsibility for ignoring robots.
  user_agent: z.string().optional(),
  respect_robots: z.boolean().optional(),
  // Optional, additive: only consulted when 'branding' / 'screenshot' is requested.
  brandingOptions: z.object({
    fetchLinkedCss: z.boolean().optional().default(true),
    maxStylesheets: z.number().min(0).max(20).optional().default(10)
  }).optional(),
  screenshotOptions: z.object({
    fullPage: z.boolean().optional().default(false),
    format: z.enum(['png', 'jpeg']).optional().default('png'),
    quality: z.number().min(0).max(100).optional()
  }).optional()
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract links from a loaded cheerio $ and the page URL.
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} pageUrl - final URL of the fetched page (used for origin comparison)
 * @param {string} [docBaseUrl] - resolution base for relative hrefs; defaults to pageUrl.
 *   Pass the resolved <base href> here when the document declares one.
 */
function extractLinksFromDom($, pageUrl, docBaseUrl) {
  const links = [];
  const seen = new Set();
  let pageOrigin = '';
  try { pageOrigin = new URL(pageUrl).origin; } catch { /* ignore */ }
  const resolveBase = docBaseUrl || pageUrl;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href) return;
    if (href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      const absoluteUrl = new URL(href, resolveBase).toString();
      const isExternal = new URL(absoluteUrl).origin !== pageOrigin;
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
    pageTitle($) ||
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
    // Optional shared ActionExecutor (injected from server.js so we reuse the
    // existing browser pool rather than spinning up a second one).
    this._actionExecutor = options.actionExecutor || null;
  }

  /** Lazy-load ExtractWithLlm to avoid pulling in heavy deps unless needed. */
  async _getExtractWithLlm() {
    if (!this._extractWithLlm) {
      const { ExtractWithLlm } = await import('../extract/extractWithLlm.js');
      this._extractWithLlm = new ExtractWithLlm(this._extractWithLlmConfig);
    }
    return this._extractWithLlm;
  }

  /** Lazy-load an ActionExecutor only when a screenshot is actually requested. */
  async _getActionExecutor() {
    if (!this._actionExecutor) {
      const { default: ActionExecutor } = await import('../../core/ActionExecutor.js');
      this._actionExecutor = new ActionExecutor({ enableLogging: false });
    }
    return this._actionExecutor;
  }

  /**
   * Execute a unified scrape.
   * @param {object} params - UnifiedScrapeSchema-compatible input
   * @returns {Promise<object>}
   */
  async execute(params) {
    const validated = UnifiedScrapeSchema.parse(params);
    const { url, formats, onlyMainContent, timeoutMs, brandingOptions, screenshotOptions, resolveHiddenContent } = validated;

    // Single fetch
    let html, $, finalUrl, fetchWarnings;
    try {
      ({ html, $, finalUrl, warnings: fetchWarnings } = await fetchAndParse(url, {
        timeoutMs,
        userAgent: validated.user_agent,
        respectRobots: validated.respect_robots,
        tool: 'scrape',
        stripTags: [] // we handle boilerplate ourselves
      }));
    } catch (err) {
      throw new Error(`scrape: fetch failed for ${url}: ${err.message}`);
    }

    // Resolve <base href> once per document (if present) so link resolution
    // matches how a browser would navigate, instead of always using finalUrl.
    let docBaseUrl = finalUrl;
    try {
      const baseHref = $('base[href]').first().attr('href');
      if (baseHref) docBaseUrl = new URL(baseHref, finalUrl).toString();
    } catch { /* ignore invalid <base href>, fall back to finalUrl */ }

    // For onlyMainContent: extract main-content html via Readability once
    let mainHtml = null;
    function getMainHtml() {
      if (mainHtml !== null) return mainHtml;
      const main = extractMainContent(html, finalUrl);
      mainHtml = main.html ?? html;
      if (main.tablesRecovered > 0) {
        warnings.push(
          `mainContent: re-attached ${main.tablesRecovered} data table(s) that main-content extraction had dropped`
        );
      }
      // A thin article on a landing page is not the main content (gnome.org
      // came back as ~150 of 1,666 visible characters, R16): use the page.
      const thin = main.html ? isThinMainContent(main.html, html) : null;
      if (thin) {
        mainHtml = html;
        warnings.push(
          `mainContent: main-content extraction kept ${thin.kept} of ${thin.visible} visible characters; the whole page is used instead`
        );
      }
      return mainHtml;
    }

    const content = {};
    // The gate's warnings (e.g. a respect_robots override) travel with the
    // per-format ones, so the caller sees the decision in the response.
    const warnings = [...fetchWarnings];

    // Kept for the rawHtml format, which must survive the strip below.
    const pristineHtml = html;

    // Remove content a browser would not paint, before any format is derived.
    // Every format reads from $ or html — and the json path takes
    // $('body').text() directly — so stripping once here is what keeps
    // screen-reader-only labels and state-gated theme badges out of
    // extraction. A Shopify Dawn storefront ships "Sale"/"Sold out" badges
    // unconditionally and hides them in component CSS; left in, they made
    // extraction report "Sold out" for a product with 100 units in stock.
    if (resolveHiddenContent !== 'off') {
      try {
        let css = '';
        if (resolveHiddenContent === 'linked') {
          const { collectCssSources } = await import('./_brandingExtractor.js');
          const collected = await collectCssSources($, docBaseUrl, {
            fetchLinkedCss: true,
            // Themes split visibility rules across many component sheets — the
            // rule hiding Shopify's sold-out badge sits at index 12 of 38 on a
            // stock Dawn storefront, so a cap of 10 silently misses it.
            maxStylesheets: 20
          });
          css = collected.cssText || '';
        }
        const { removed } = stripHiddenFromDom($, { css });
        // Formats that read the raw string need the cleaned markup too.
        if (removed > 0) html = $.html();
      } catch (err) {
        warnings.push(`hiddenContent: ${err.message}`);
      }
    }

    for (const fmt of formats) {
      // JSON format object
      if (fmt && typeof fmt === 'object' && fmt.type === 'json') {
        try {
          const extractWithLlm = await this._getExtractWithLlm();
          // Script and template bodies are never rendered, but $('body').text()
          // includes them — on a Shopify storefront that was 179KB of
          // JavaScript, more than the page's real text, and it carried the
          // very "Sold out" strings the strip had just removed from the DOM.
          const { load } = await import('cheerio');
          const $visible = load(html);
          $visible('script, style, noscript, template').remove();
          const pageText = $visible('body').text().replace(/\s+/g, ' ').trim();
          // Main content first, then the whole page: Readability drops the page
          // chrome, and racket-lang.org states its version there — shown the
          // main content alone, the model answered "Racket" for a version the
          // page gives as 9.3 (R14). The article still leads.
          const text = onlyMainContent
            ? `${htmlToMarkdown(getMainHtml())}\n\n${pageText}`
            : pageText;
          const result = await extractWithLlm.execute({
            content: text,
            prompt: fmt.prompt || 'Extract structured data from this page content.',
            schema: fmt.schema,
            provider: 'auto'
          });
          content.json = result.success ? result.data : { error: result.error };
          if (!result.success) {
            warnings.push(`json: extraction failed — ${result.error}`);
          } else {
            // extract_with_llm reports these but does not fail on them, and
            // dropping them here is what let schema-violating output — and
            // silently clipped input on long pages — reach callers looking
            // like a clean extraction.
            if (result.valid === false) {
              warnings.push(
                `json: output did not match the requested schema — ${(result.validationErrors || []).join('; ')}`
              );
            }
            if (result.truncated) {
              warnings.push(
                `json: page text was truncated from ${result.original_length} chars before extraction; ` +
                'fields appearing late in the page may be missing'
              );
            }
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
              ? htmlToMarkdown(getMainHtml())
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
          // Deliberately the untouched response body: "raw" must not reflect
          // the hidden-content strip that rewrites `html` for other formats.
          content.rawHtml = pristineHtml;
          break;

        case 'text':
          try {
            const { load } = await import('cheerio');
            if (onlyMainContent) {
              // Plain text from Readability main content via cheerio
              const $main = load(getMainHtml());
              $main('script, style').remove();
              content.text = extractBlockText($main);
            } else {
              // Strip script/style on a clone, not the shared $, so other
              // formats reading $ later aren't affected by format ordering.
              const $clone = load($.html());
              $clone('script, style').remove();
              content.text = extractBlockText($clone);
            }
          } catch (err) {
            content.text = '';
            warnings.push(`text: ${err.message}`);
          }
          break;

        case 'links':
          try {
            content.links = extractLinksFromDom($, finalUrl, docBaseUrl);
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

        case 'branding':
          try {
            const { extractBranding } = await import('./_brandingExtractor.js');
            const branding = await extractBranding($, finalUrl, {
              fetchLinkedCss: brandingOptions?.fetchLinkedCss ?? true,
              maxStylesheets: brandingOptions?.maxStylesheets ?? 10
            });
            if (Array.isArray(branding.warnings)) {
              warnings.push(...branding.warnings);
              delete branding.warnings;
            }
            content.branding = branding;
          } catch (err) {
            content.branding = {};
            warnings.push(`branding: ${err.message}`);
          }
          break;

        case 'screenshot':
          // Opt-in browser path: only launched when 'screenshot' is requested.
          try {
            const exec = await this._getActionExecutor();
            const r = await exec.executeActionChain(
              finalUrl,
              {
                actions: [{
                  type: 'screenshot',
                  fullPage: screenshotOptions?.fullPage ?? false,
                  format: screenshotOptions?.format ?? 'png',
                  ...(screenshotOptions?.quality != null ? { quality: screenshotOptions.quality } : {})
                }]
              },
              { headless: true, timeout: 30000 }
            );
            content.screenshots = Array.isArray(r?.screenshots) ? r.screenshots : [];
            if (r?.success === false) {
              warnings.push(`screenshot: ${r.error || 'capture failed'}`);
            } else if (content.screenshots.length === 0) {
              warnings.push('screenshot: capture produced no image');
            }
          } catch (err) {
            content.screenshots = [];
            warnings.push(`screenshot: ${err.message}`);
          }
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

/**
 * unifiedScrape — single-fetch, multi-format scraping tool.
 *
 * One call, one fetch.  formats[] drives what is returned.
 * Mirrors the output shape of ScrapeWithActionsTool.generateFormats():
 *   content.html, content.rawHtml, content.text, content.markdown,
 *   content.links, content.metadata, content.screenshots, content.json
 * plus the query-scoped formats (Phase 1): content.highlights for
 * {type:"highlights"} and content.answer for {type:"question"}, both built
 * from the markdown this same call produces, verbatim with offsets into it.
 *
 * onlyMainContent maps to Readability boilerplate removal (same as extractContent).
 * Partial success: per-format warnings[] never fail the whole call.
 */

import { z } from 'zod';
import { load } from 'cheerio';
import { documentVerdict, segmentUnits, rankUnits } from 'crawlforge-extractors';
import {
  SCRAPE_STRING_FORMATS, JsonFormatSchema, HighlightsFormatSchema, QuestionFormatSchema, FormatSchema,
  scrapeFormatSurcharge
} from './formats.js';
import { toPublicUnit, parseChosenIndexes, groundingCheck } from './_highlights.js';
import { setActualCost } from '../../server/requestContext.js';
import { fenceUntrusted } from '../../utils/untrustedContent.js';
import { fetchAndParse } from '../extract/_fetchAndParse.js';
import { extractMainContent, isThinMainContent } from './_mainContent.js';
import { htmlToMarkdown } from '../../utils/htmlToMarkdown.js';
import { stripHiddenFromDom } from '../../utils/hiddenContent.js';
import { extractBlockText } from '../basic/extractText.js';
import { pageTitle } from '../../utils/pageTitle.js';
import { noteHostBlocked, clearHostBlocked } from '../../utils/hostRateLimiter.js';

// ── Schema ────────────────────────────────────────────────────────────────────

export { SCRAPE_STRING_FORMATS, JsonFormatSchema, HighlightsFormatSchema, QuestionFormatSchema, FormatSchema };

// Above this, a markdown result is the whole page in the context window;
// the warning names the format that returns only the matching units (1.4).
const OVERSIZED_MARKDOWN_CHARS = 40000;
// How many extractive units a question's answer rests on.
const QUESTION_EVIDENCE_UNITS = 5;

const isQueryFormat = (fmt) => Boolean(fmt) && typeof fmt === 'object' && (fmt.type === 'highlights' || fmt.type === 'question');

// The six public fields in tools/list order, each carrying the description
// the client sees. server.js spreads this with COMPLIANCE_PARAMS instead of
// keeping its own copy (Phase 0, 0.3).
export const SCRAPE_INPUT_SHAPE = {
  url: z.string().url().describe('The URL to scrape'),
  formats: z.array(FormatSchema).min(1).optional().default(['markdown']).describe('Formats to return (default: ["markdown"])'),
  onlyMainContent: z.boolean().optional().default(true).describe('Strip boilerplate via Readability (default: true)'),
  // Pass-through to fetchAndParse
  timeoutMs: z.number().min(1000).max(60000).optional().default(15000).describe('Fetch timeout in ms'),
  // Optional, additive: only consulted when 'branding' / 'screenshot' is requested.
  brandingOptions: z.object({
    fetchLinkedCss: z.boolean().optional().default(true).describe('Fetch linked stylesheets for richer color/font extraction'),
    maxStylesheets: z.number().min(0).max(20).optional().default(10).describe('Max linked stylesheets to fetch')
  }).optional().describe('Options for the "branding" format'),
  screenshotOptions: z.object({
    fullPage: z.boolean().optional().default(false).describe('Capture the full scrollable page'),
    format: z.enum(['png', 'jpeg']).optional().default('png'),
    quality: z.number().min(0).max(100).optional().describe('JPEG quality (jpeg only)')
  }).optional().describe('Options for the "screenshot" format')
};

export const UnifiedScrapeSchema = z.object({
  ...SCRAPE_INPUT_SHAPE,
  // Remove content a browser would not paint (screen-reader-only labels,
  // state-gated theme badges) before deriving any format. "linked" also fetches
  // the page's stylesheets, which is what resolves class-driven display:none;
  // "inline" uses only the document's own <style> blocks and costs no requests.
  resolveHiddenContent: z.enum(['linked', 'inline', 'off']).optional().default('linked'),
  // Compliance overrides, per request: identify as yourself for a target you
  // have your own agreement with, and take responsibility for ignoring robots.
  user_agent: z.string().optional(),
  respect_robots: z.boolean().optional()
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
    this._mcpServer = null;
  }

  /** Wire the MCP server so the mode:"model" step can fall back to client sampling. */
  setMcpServer(mcpServer) {
    this._mcpServer = mcpServer;
  }

  /**
   * One completion through the SamplingClient chain (Ollama → server keys →
   * MCP sampling); throws when no route exists. Page text must already be
   * fenced by the caller.
   */
  async _complete(prompt, options) {
    const { SamplingClient } = await import('../../core/SamplingClient.js');
    return new SamplingClient({ mcpServer: this._mcpServer }).complete(prompt, options);
  }

  /**
   * mode:"model" for highlights: the model picks which of the extractive
   * candidates to keep; it never writes text. Returns the chosen units in
   * extractive order, or the extractive top `limit` when the reply does not
   * name any candidate.
   */
  async _chooseHighlights(candidates, query, limit, warnings) {
    const listing = candidates.map((unit, index) => `[${index}] ${unit.text}`).join('\n');
    const { text } = await this._complete(
      `${fenceUntrusted(listing, 'numbered page excerpts')}\nQuery: ${query}\n` +
      `Reply with the numbers of the ${limit} excerpts most relevant to the query.`,
      {
        maxTokens: Math.max(64, limit * 4),
        systemPrompt: 'You choose which numbered excerpts from a web page answer a query. ' +
          'Reply with the numbers only, comma-separated, most relevant first. Do not write anything else.'
      }
    );
    const chosen = parseChosenIndexes(text, candidates.length, limit);
    if (chosen.length === 0) {
      warnings.push('highlights: the model named no candidate; the extractive order is returned');
      return candidates.slice(0, limit);
    }
    return chosen.sort((a, b) => a - b).map((index) => candidates[index]);
  }

  /** mode:"model" for question: an answer written from the fenced evidence alone. */
  async _answerQuestion(evidence, question) {
    const { text } = await this._complete(
      `${fenceUntrusted(evidence.map((unit) => unit.text).join('\n'), 'page evidence')}\nQuestion: ${question}\n` +
      'Answer from the evidence only; if the evidence does not say, say so. Reply with the answer only.',
      {
        maxTokens: 256,
        systemPrompt: 'You answer a question from evidence quoted from a web page. Use only the evidence. ' +
          'If the evidence does not contain the answer, say that it does not. Reply with the answer only, no preamble.'
      }
    );
    return text.trim();
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
    let html, $, finalUrl, fetchWarnings, status;
    try {
      ({ html, $, finalUrl, warnings: fetchWarnings, status } = await fetchAndParse(url, {
        timeoutMs,
        userAgent: validated.user_agent,
        respectRobots: validated.respect_robots,
        tool: 'scrape',
        stripTags: [], // we handle boilerplate ourselves
        // A real wall reaches a plain fetch as a 403 with the challenge in
        // the body; the verdict below needs that body and the status.
        errorDocuments: true
      }));
    } catch (err) {
      throw new Error(`scrape: fetch failed for ${url}: ${err.message}`);
    }

    // A bot wall, an HTTP error page, an empty shell or an error placeholder
    // arrives with a title and prose of its own; reported as a successful
    // scrape it hid the block for three rounds (producthunt.com, R10 Q1 →
    // R15). The stealth path has named these since 5.6.2; this path never
    // looked, and threw away every non-2xx body before it could (Phase 0,
    // 0.1). Scripts stay in $ for the rawHtml and metadata formats,
    // so the text is measured on a copy without them — the vendor tables
    // count the characters a reader would see, as the browser path does.
    // Nothing below runs on a failed verdict: a screenshot would launch a
    // browser on the wall and branding would fetch its stylesheets.
    const title = pageTitle($);
    const $visible = load(html);
    $visible('script, style, noscript, template').remove();
    const verdict = documentVerdict(
      { url: finalUrl, title, text: $visible('body').text(), html, status },
      { fetcher: 'a plain fetch', rendered: false, contentReturned: false }
    );
    // Host memory (0.6): remember the vendor that walled this host, keyed by
    // the URL the caller passed as well as the final one when a redirect
    // moved hosts, since a later call looks it up by what it was given.
    const hosts = [finalUrl, url];
    if (verdict.blocked) {
      for (const h of hosts) noteHostBlocked(h, verdict.blocked.vendor);
    } else if (verdict.success) {
      for (const h of hosts) clearHostBlocked(h);
    }
    if (!verdict.success) {
      return {
        success: false,
        url: finalUrl,
        status,
        title,
        error: verdict.error,
        ...(verdict.blocked ? { blocked: verdict.blocked } : {}),
        content: {},
        warnings: fetchWarnings.length > 0 ? fetchWarnings : undefined
      };
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

    // The markdown format and the query-scoped formats read the same string,
    // produced once, so a highlight's offset always indexes what `markdown`
    // returned at this call's onlyMainContent.
    let markdown = null;
    function getMarkdown() {
      if (markdown === null) {
        markdown = onlyMainContent ? htmlToMarkdown(getMainHtml()) : htmlToMarkdown($.html('body') || html);
      }
      return markdown;
    }
    let units = null;
    function getUnits() {
      if (units === null) units = segmentUnits(getMarkdown());
      return units;
    }
    // Whether a model completed for a mode:"model" format; the model
    // surcharge is charged only then.
    let modelUsed = false;

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

      // Query-scoped formats (Phase 1): verbatim units of this call's
      // markdown, ranked against the query. mode:"model" lets a model choose
      // among (highlights) or answer from (question) those units; when no
      // LLM route exists the extractive result stands and the model
      // surcharge is dropped below. An empty match is a warning, not an error.
      if (isQueryFormat(fmt)) {
        const modelUnavailable = (label) =>
          warnings.push(`${label}: mode "model" was unavailable (no Ollama, API key or client sampling); the extractive result is returned at the extractive price`);
        try {
          if (fmt.type === 'highlights') {
            let chosen = rankUnits(getUnits(), fmt.query, { maxUnits: fmt.max_highlights });
            if (fmt.mode === 'model' && chosen.length > 0) {
              const candidates = rankUnits(getUnits(), fmt.query, { maxUnits: fmt.max_highlights * 3 });
              if (candidates.length > fmt.max_highlights) {
                try {
                  chosen = await this._chooseHighlights(candidates, fmt.query, fmt.max_highlights, warnings);
                  modelUsed = true;
                } catch {
                  modelUnavailable('highlights');
                }
              } else {
                warnings.push('highlights: no more candidates than max_highlights, so the model had nothing to choose; charged at the extractive price');
              }
            }
            content.highlights = chosen.map(toPublicUnit);
            if (chosen.length === 0) warnings.push(`highlights: no sentence, table row or code block matched "${fmt.query}"`);
          } else {
            const evidence = rankUnits(getUnits(), fmt.question, { maxUnits: QUESTION_EVIDENCE_UNITS });
            const evidenceText = evidence.map((unit) => unit.text).join('\n');
            let text = evidenceText;
            let grounded = true;
            if (fmt.mode === 'model' && evidence.length > 0) {
              try {
                text = await this._answerQuestion(evidence, fmt.question);
                modelUsed = true;
                const check = groundingCheck(text, evidenceText, fmt.question);
                grounded = check.grounded;
                if (!grounded) {
                  warnings.push(`question: the model's answer has ${check.unbacked.length} token(s) not found in the evidence or the question (${check.unbacked.join(', ')}); grounded: false`);
                }
              } catch {
                modelUnavailable('question');
              }
            }
            content.answer = { text, grounded, evidence: evidence.map(toPublicUnit) };
            if (evidence.length === 0) warnings.push(`question: no sentence, table row or code block matched "${fmt.question}"`);
          }
        } catch (err) {
          if (fmt.type === 'highlights') content.highlights = [];
          else content.answer = { text: '', grounded: true, evidence: [] };
          warnings.push(`${fmt.type}: ${err.message}`);
        }
        continue;
      }

      // String formats
      switch (fmt) {
        case 'markdown':
          try {
            content.markdown = getMarkdown();
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

    const queryScoped = formats.some(isQueryFormat);
    if (queryScoped && !formats.includes('markdown')) {
      warnings.push('offsets index the "markdown" format of this call (same onlyMainContent); add "markdown" to formats to quote with a locator');
    }
    if (!queryScoped && typeof content.markdown === 'string' && content.markdown.length > OVERSIZED_MARKDOWN_CHARS) {
      warnings.push(`markdown: ${content.markdown.length} characters; ask for {type:"highlights", query} (1 extra credit, no model) to get only the matching sentences, table rows and code blocks`);
    }
    // The projection charged the model step; nothing ran, so the charge
    // drops to the extractive price (2 is scrape's base in AuthManager;
    // withAuth clamps to the projection either way).
    const surcharge = scrapeFormatSurcharge(formats);
    if (surcharge.model > 0 && !modelUsed) setActualCost(2 + surcharge.query);

    return {
      success: true,
      url: finalUrl,
      content,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
}

export default UnifiedScrapeTool;

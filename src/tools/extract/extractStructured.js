/**
 * Extract Structured Data MCP Tool
 * LLM-powered structured extraction with JSON Schema validation
 * Falls back to CSS selector extraction when no LLM provider is configured
 */

import { z } from 'zod';
import { ElicitationHelper } from '../../core/ElicitationHelper.js'; // D1.4
import { load } from 'cheerio';
import { LLMManager } from '../../core/llm/LLMManager.js';
import { CRAWLFORGE_USER_AGENT } from '../../utils/fetchIdentity.js';
import { fetchAndParse, flattenBodyText } from './_fetchAndParse.js';
import { extractMainContent } from '../scrape/_mainContent.js';
import { verifyNumericProvenance } from '../../utils/provenance.js';

// Semantic element selectors for well-known field names, tried as a last
// resort in the CSS fallback so common fields (e.g. "title") still resolve when
// no LLM provider and no selectorHints are available. Element/text selectors
// only — meta tags are already handled separately above.
const SEMANTIC_FIELD_SELECTORS = {
  title: ['h1', 'title'],
  name: ['h1', 'title'],
  heading: ['h1', 'h2'],
  headline: ['h1', 'h2'],
  description: ['article p', 'main p', '.description', 'p'],
  summary: ['article p', 'main p', 'p'],
  author: ['[rel="author"]', '.author', '.byline'],
  date: ['time', '.date'],
  published: ['time', '.published', '.date'],
  price: ['[itemprop="price"]', '[class*="price"]']
};

/**
 * Main-content text for the LLM, or '' when there is none to fall back from.
 *
 * Whole-body text hands the model the page chrome, and it answers from the
 * first heading-shaped string it sees: the Cloudflare blog post returned
 * headline "Skip to content". This is the same Readability pass `scrape` runs.
 *
 * @param {import('cheerio').CheerioAPI} $ - parsed document from fetchAndParse
 * @param {string} html
 * @param {string} url
 * @returns {string}
 */
function mainContentText($, html, url) {
  // fetchAndParse returns an empty $ for text/plain and JSON bodies. Those are
  // not markup and must not go through Readability.
  if ($('body').children().length === 0) return '';
  const { html: mainHtml, title } = extractMainContent(html, url);
  if (!mainHtml) return '';
  // Readability strips the article's own heading out of the content it
  // returns, so the title has to be put back: without it the IANA page's main
  // text never says "Example Domains" and the model answers from the body.
  return [title, flattenBodyText(load(mainHtml))].filter(Boolean).join('\n');
}

/**
 * Missing, null, blank string or empty array — what "the extraction did not
 * fill this field in" looks like across every extraction method.
 */
function isEmptyValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

const ExtractStructuredSchema = z.object({
  url: z.string().url(),
  schema: z.object({
    type: z.string().optional(),
    properties: z.record(z.any()),
    required: z.array(z.string()).optional()
  }),
  prompt: z.string().optional(),
  llmConfig: z.object({
    provider: z.string().optional(),
    apiKey: z.string().optional()
  }).optional(),
  fallbackToSelectors: z.boolean().optional().default(true),
  selectorHints: z.record(z.string()).optional(),
  respect_robots: z.boolean().optional(),
  user_agent: z.string().optional(),
  verify_numbers: z.boolean().optional().default(true)
});

export class ExtractStructuredTool {
  constructor(options = {}) {
    this.llmManager = null;
    this.llmConfig = options.llmConfig || {};
    this.userAgent = CRAWLFORGE_USER_AGENT;
    // D1.4: Elicitation helper
    this._elicitation = new ElicitationHelper({});
  }

  /** D1.4: Wire MCP server for elicitation. */
  setMcpServer(mcpServer) {
    this._elicitation = new ElicitationHelper({ mcpServer });
  }

  /**
   * Lazily initialize LLMManager (avoids errors when no LLM keys are set)
   */
  _ensureLLMManager(llmConfig = {}) {
    const config = { ...this.llmConfig, ...llmConfig };
    // Build provider options from llmConfig
    const providerOptions = {};
    if (config.provider === 'openai' && config.apiKey) {
      providerOptions.openai = { apiKey: config.apiKey };
    } else if (config.provider === 'anthropic' && config.apiKey) {
      providerOptions.anthropic = { apiKey: config.apiKey };
    }
    if (config.provider) {
      providerOptions.defaultProvider = config.provider;
    }
    this.llmManager = new LLMManager(providerOptions);
    return this.llmManager;
  }

  /**
   * Get tool definition for MCP server
   */
  getDefinition() {
    return {
      name: 'extract_structured',
      description: 'Extract structured data from a webpage using LLM-powered analysis and a JSON Schema. Falls back to CSS selector extraction when no LLM provider is configured.',
      inputSchema: ExtractStructuredSchema
    };
  }

  /**
   * Execute structured extraction
   * @param {Object} params - Extraction parameters
   * @returns {Promise<Object>} Extraction result
   */
  async execute(params) {
    const startTime = Date.now();

    try {
      const validated = ExtractStructuredSchema.parse(params);
      const { url, schema, prompt, llmConfig, fallbackToSelectors, selectorHints, respect_robots, user_agent, verify_numbers } = validated;

      // Step 1: Fetch and parse — shared helper strips scripts/styles/iframes/svgs
      const { html, $, textContent, warnings } = await fetchAndParse(url, {
        userAgent: user_agent || this.userAgent,
        respectRobots: respect_robots,
        tool: 'extract_structured'
      });

      // Step 3: Try LLM extraction first
      let extractionResult = null;
      let extractionMethod = 'llm';
      let llmErrorMessage = null;
      let llmAvailable = false;

      try {
        const llm = this._ensureLLMManager(llmConfig || {});
        // ready() probes Ollama, which has no API key to gate on. isAvailable()
        // alone reported false on any machine without a cloud key, so a running
        // local Ollama was never used.
        llmAvailable = await llm.ready();
        if (llmAvailable) {
          const result = await llm.extractStructured(mainContentText($, html, url) || textContent, schema, {
            prompt: prompt || '',
            maxContentLength: 6000
          });
          // extractStructured swallows LLM failures and returns its keyword
          // fallback. Only accept the result as an LLM extraction when it
          // actually is one; otherwise fall through to the CSS pass, which is
          // higher fidelity than keyword matching.
          if (result?.method === 'llm') {
            extractionResult = result;
            extractionMethod = 'llm';
          } else {
            llmErrorMessage = result?.error || 'LLM did not return usable JSON';
          }
        }
      } catch (llmError) {
        // LLM failed — will fall through to CSS fallback. Keep the message so
        // callers can tell "LLM broken" apart from "no LLM configured".
        extractionResult = null;
        llmErrorMessage = llmError.message;
      }

      // Step 3b (3.4): numeric provenance. Only the LLM path invents numbers —
      // the CSS and keyword fallbacks can only return text they read off the
      // page — so the guard is scoped to it.
      //
      // It is checked against the FULL source, never `mainContentText()`: on
      // the Apple MacBook Air page Readability keeps the FAQ block and every
      // price is left behind in an embedded JSON blob, so checking against what
      // the model was shown would null every correct price.
      const fullSource = `${html}\n${textContent}`;

      /** Run the guard over one extraction and describe what it did. */
      const applyGuard = (result) => {
        const checked = verifyNumericProvenance(result.data || {}, fullSource);
        // The model's own `valid` flag described the data before the guard ran.
        // A required field the guard nulled is not filled in any more, so that
        // flag cannot stand or the response reports a fabrication as valid.
        const nulledRequired = checked.unverified
          .map((entry) => entry.path)
          .filter((path) => (schema.required || []).includes(path));
        return {
          checked,
          nulledRequired,
          result: {
            ...result,
            data: checked.data,
            ...(nulledRequired.length > 0 ? {
              valid: false,
              validationErrors: [
                ...(result.validationErrors || []),
                ...nulledRequired.map((field) => `Field "${field}" was not found in the page source`)
              ]
            } : {})
          }
        };
      };

      let provenance = { enabled: false };
      if (extractionResult && extractionMethod === 'llm' && verify_numbers) {
        let guarded = applyGuard(extractionResult);

        // Step 3c: the model is shown main content, but the guard checks the
        // FULL source — so a value can be nulled for being absent from what the
        // model saw while sitting in the page all along. sqlite.org is the case
        // that found this: Readability drops the "Version 3.53.4" line, the
        // model was handed no version at all and answered "3.34.0" from memory,
        // and the guard correctly nulled it — leaving a caller with nothing on a
        // page that plainly states the answer.
        //
        // So when a REQUIRED field is nulled, retry once on the full page text,
        // which is exactly what the guard will accept. Only a strictly better
        // result is kept, so a retry can never make the answer worse.
        const shownText = mainContentText($, html, url) || textContent;
        if (guarded.nulledRequired.length > 0 && shownText !== textContent && textContent) {
          try {
            const llm = this._ensureLLMManager(llmConfig || {});
            const retry = await llm.extractStructured(textContent, schema, {
              prompt: prompt || '',
              maxContentLength: 6000
            });
            if (retry?.method === 'llm') {
              const retryGuarded = applyGuard(retry);
              if (retryGuarded.nulledRequired.length < guarded.nulledRequired.length) {
                guarded = retryGuarded;
              }
            }
          } catch {
            // The first answer already stands; a failed retry changes nothing.
          }
        }

        extractionResult = guarded.result;
        provenance = {
          enabled: true,
          verified: guarded.checked.verified,
          nulled: guarded.checked.nulled,
          unverified: guarded.checked.unverified
        };
        if (guarded.checked.skipped) provenance.skipped = guarded.checked.skipped;
      }

      // Step 4: CSS selector fallback if LLM unavailable or failed
      if (!extractionResult && fallbackToSelectors !== false) {
        // D1.4: no LLM configured and the schema demands more than 3 required
        // fields — confirm before running the lower-fidelity CSS fallback.
        const requiredCount = (schema.required || []).length;
        if (!llmAvailable && requiredCount > 3) {
          const proceed = await this._elicitation.confirm(
            `No LLM provider is configured and the requested schema has ${requiredCount} required fields. ` +
            `extract_structured will fall back to lower-fidelity CSS selector extraction, which may miss required fields.`,
            { url, required_fields: requiredCount }
          );
          if (!proceed) {
            return {
              success: false,
              url,
              data: {},
              extraction_method: 'none',
              confidence: 0,
              schema_used: schema,
              processingTime: Date.now() - startTime,
              error: 'Extraction cancelled by user (elicitation declined).',
              validation: { valid: false, errors: ['Extraction cancelled by user (elicitation declined).'] }
            };
          }
        }
        extractionResult = this._cssExtraction($, schema, selectorHints || {});
        extractionMethod = 'css_fallback';
      }

      // Step 5: If still no result, use keyword fallback from LLMManager
      if (!extractionResult) {
        const llm = this._ensureLLMManager(llmConfig || {});
        extractionResult = llm.fallbackStructuredExtraction(textContent, schema);
        extractionMethod = 'keyword_fallback';
      }

      // Step 6: Calculate confidence
      const confidence = this._calculateConfidence(extractionResult, extractionMethod);

      const extractionNotes = extractionResult.extractionNotes || [];
      if (llmErrorMessage) {
        extractionNotes.push(`LLM extraction failed: ${llmErrorMessage}`);
      }
      if (provenance.nulled > 0) {
        extractionNotes.push(
          `Numeric provenance: ${provenance.nulled} value(s) the model returned are not in the page source and were replaced with null: ` +
          provenance.unverified.map((u) => `${u.path}=${JSON.stringify(u.value)}`).join(', ')
        );
      }

      // A required field that came back missing or empty is a failed
      // extraction, not a successful one carrying a note: surface it at the
      // top level so a caller checking `success` sees it without reaching
      // into `validation`.
      const missingRequired = (schema.required || []).filter(
        (field) => isEmptyValue((extractionResult.data || {})[field])
      );
      const failedRequired = extractionResult.valid !== true && missingRequired.length > 0;

      return {
        success: !failedRequired,
        url,
        data: extractionResult.data || {},
        extraction_method: extractionMethod,
        confidence,
        schema_used: schema,
        processingTime: Date.now() - startTime,
        ...(failedRequired
          ? { error: `Required field(s) missing or empty: ${missingRequired.join(', ')}` }
          : {}),
        validation: {
          valid: extractionResult.valid || false,
          errors: extractionResult.validationErrors || []
        },
        extractionNotes,
        provenance,
        ...(warnings?.length ? { warnings } : {})
      };

    } catch (error) {
      return {
        success: false,
        url: params.url || 'unknown',
        data: {},
        extraction_method: 'none',
        confidence: 0,
        schema_used: params.schema || {},
        processingTime: Date.now() - startTime,
        error: `Structured extraction failed: ${error.message}`,
        validation: { valid: false, errors: [error.message] }
      };
    }
  }

  /**
   * CSS selector-based extraction fallback
   * Uses selectorHints to map schema fields to CSS selectors
   */
  _cssExtraction($, schema, selectorHints) {
    const properties = schema.properties || {};
    const extracted = {};
    let fieldsFound = 0;

    for (const [key, fieldSchema] of Object.entries(properties)) {
      // Schema keys become CSS selector fragments below (class/id/data-attr).
      // A key with spaces/parens/quotes produces an invalid selector that
      // throws ("Attribute selector didn't terminate") — catch that per-field
      // so one bad key can't discard extraction results for every other field.
      try {
        const isArrayField = fieldSchema.type === 'array';

        // Use explicit selector hint if provided
        const selector = selectorHints[key];
        if (selector) {
          const els = $(selector);
          if (els.length > 0) {
            if (isArrayField || els.length > 1) {
              const values = els.map((_, el) => $(el).text().trim()).get().filter(Boolean);
              if (values.length > 0) {
                extracted[key] = values;
                fieldsFound++;
                continue;
              }
            } else {
              const rawValue = els.first().text().trim();
              if (rawValue) {
                extracted[key] = this._coerceValue(rawValue, fieldSchema);
                fieldsFound++;
                continue;
              }
            }
          }
        }

        // For array fields: detect ul/ol > li patterns before meta/common selectors
        if (isArrayField) {
          const listSelectors = [
            `ul.${key} > li`, `ol.${key} > li`,
            `#${key} > li`, `[data-${key}] > li`,
            `ul[class*="${key}"] > li`, `ol[class*="${key}"] > li`
          ];
          let listValues = null;
          for (const lsel of listSelectors) {
            const items = $(lsel);
            if (items.length > 0) {
              listValues = items.map((_, el) => $(el).text().trim()).get().filter(Boolean);
              break;
            }
          }
          if (listValues && listValues.length > 0) {
            extracted[key] = listValues;
            fieldsFound++;
            continue;
          }
        }

        // Try common patterns: meta tags, headings, semantic elements
        const metaContent = $(`meta[name="${key}"], meta[property="${key}"], meta[property="og:${key}"]`).attr('content');
        if (metaContent) {
          extracted[key] = this._coerceValue(metaContent, fieldSchema);
          fieldsFound++;
          continue;
        }

        // Try matching by common selectors based on field name
        const commonSelectors = [
          `[itemprop="${key}"]`,
          `[data-${key}]`,
          `.${key}`,
          `#${key}`
        ];

        for (const sel of commonSelectors) {
          const el = $(sel);
          if (el.length > 0) {
            if (isArrayField && el.length > 1) {
              const values = el.map((_, item) => $(item).text().trim()).get().filter(Boolean);
              if (values.length > 0) {
                extracted[key] = values;
                fieldsFound++;
                break;
              }
            } else {
              const rawValue = el.first().text().trim();
              if (rawValue) {
                extracted[key] = this._coerceValue(rawValue, fieldSchema);
                fieldsFound++;
                break;
              }
            }
          }
        }

        // Last resort: semantic element selectors for well-known field names
        // (e.g. title -> <h1>/<title>) so common fields resolve without hints.
        if (!(key in extracted)) {
          const semanticSelectors = SEMANTIC_FIELD_SELECTORS[key.toLowerCase()];
          if (semanticSelectors) {
            for (const sel of semanticSelectors) {
              const el = $(sel);
              if (el.length === 0) continue;
              if (isArrayField && el.length > 1) {
                const values = el.map((_, item) => $(item).text().trim()).get().filter(Boolean);
                if (values.length > 0) {
                  extracted[key] = values;
                  fieldsFound++;
                  break;
                }
              } else {
                const rawValue = el.first().text().trim();
                if (rawValue) {
                  extracted[key] = this._coerceValue(rawValue, fieldSchema);
                  fieldsFound++;
                  break;
                }
              }
            }
          }
        }
      } catch (_fieldError) {
        // Invalid selector for this key — skip the field, keep going.
        continue;
      }
    }

    if (fieldsFound === 0) {
      return null; // No fields found via CSS, let keyword fallback handle it
    }

    // Validate required fields
    const errors = [];
    const required = schema.required || [];
    for (const field of required) {
      if (!(field in extracted)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    return {
      data: extracted,
      valid: errors.length === 0,
      validationErrors: errors,
      extractionNotes: ['Used CSS selector fallback extraction']
    };
  }

  /**
   * Coerce a string value to the expected type
   */
  _coerceValue(rawValue, fieldSchema) {
    const type = fieldSchema.type;
    if (type === 'number') {
      const num = parseFloat(rawValue.replace(/[^0-9.-]/g, ''));
      return isNaN(num) ? rawValue : num;
    }
    if (type === 'boolean') {
      return /true|yes|1/i.test(rawValue);
    }
    if (type === 'array') {
      // Try splitting by common delimiters
      return rawValue.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    }
    return rawValue;
  }

  /**
   * Calculate confidence score based on extraction method and validation
   */
  _calculateConfidence(result, method) {
    if (!result || !result.data) return 0;

    const dataKeys = Object.keys(result.data).length;
    if (dataKeys === 0) return 0;

    let base;
    if (method === 'llm') {
      base = result.valid ? 0.9 : 0.7;
    } else {
      base = result.valid ? 0.6 : 0.4;
    }

    // Penalize only for actual validation errors (not extractionNotes)
    const errorCount = (result.validationErrors || []).length;
    const penalty = Math.min(0.3, errorCount * 0.1);

    return Math.max(0, Math.round((base - penalty) * 100) / 100);
  }

  /**
   * Clean up resources
   */
  async destroy() {
    this.llmManager = null;
  }
}

export default ExtractStructuredTool;

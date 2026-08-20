/**
 * Extract Structured Data MCP Tool
 * LLM-powered structured extraction with JSON Schema validation
 * Falls back to CSS selector extraction when no LLM provider is configured
 */

import { z } from 'zod';
import { ElicitationHelper } from '../../core/ElicitationHelper.js'; // D1.4
import { load } from 'cheerio';
import { LLMManager } from '../../core/llm/LLMManager.js';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const _pkg = _require('../../../package.json');
const CRAWLFORGE_UA = `CrawlForge/${_pkg.version} (+https://crawlforge.dev)`;
import { fetchAndParse } from './_fetchAndParse.js';

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
  selectorHints: z.record(z.string()).optional()
});

export class ExtractStructuredTool {
  constructor(options = {}) {
    this.llmManager = null;
    this.llmConfig = options.llmConfig || {};
    this.userAgent = CRAWLFORGE_UA;
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
      const { url, schema, prompt, llmConfig, fallbackToSelectors, selectorHints } = validated;

      // Step 1: Fetch and parse — shared helper strips scripts/styles/iframes/svgs
      const { html, $, textContent } = await fetchAndParse(url, { userAgent: this.userAgent });

      // Step 3: Try LLM extraction first
      let extractionResult = null;
      let extractionMethod = 'llm';
      let llmErrorMessage = null;
      let llmAvailable = false;

      try {
        const llm = this._ensureLLMManager(llmConfig || {});
        llmAvailable = llm.isAvailable();
        if (llmAvailable) {
          extractionResult = await llm.extractStructured(textContent, schema, {
            prompt: prompt || '',
            maxContentLength: 6000
          });
          extractionMethod = 'llm';
        }
      } catch (llmError) {
        // LLM failed — will fall through to CSS fallback. Keep the message so
        // callers can tell "LLM broken" apart from "no LLM configured".
        extractionResult = null;
        llmErrorMessage = llmError.message;
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
        extractionMethod = 'css_fallback';
      }

      // Step 6: Calculate confidence
      const confidence = this._calculateConfidence(extractionResult, extractionMethod);

      const extractionNotes = extractionResult.extractionNotes || [];
      if (llmErrorMessage) {
        extractionNotes.push(`LLM extraction failed: ${llmErrorMessage}`);
      }

      return {
        url,
        data: extractionResult.data || {},
        extraction_method: extractionMethod,
        confidence,
        schema_used: schema,
        processingTime: Date.now() - startTime,
        validation: {
          valid: extractionResult.valid || false,
          errors: extractionResult.validationErrors || []
        },
        extractionNotes
      };

    } catch (error) {
      return {
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

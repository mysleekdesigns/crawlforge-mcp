/**
 * Extract Structured Data MCP Tool
 * LLM-powered structured extraction with JSON Schema validation
 * Falls back to CSS selector extraction when no LLM provider is configured
 */

import { z } from 'zod';
import { load } from 'cheerio';
import { LLMManager } from '../../core/llm/LLMManager.js';

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
    this.userAgent = 'Mozilla/5.0 (compatible; CrawlForge-MCP/3.0; ExtractStructured)';
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

      // Step 1: Fetch URL
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      // Step 2: Parse HTML with Cheerio, strip scripts/styles
      const $ = load(html);
      $('script, style, noscript, iframe, svg').remove();
      const textContent = $('body').text().replace(/\s+/g, ' ').trim();

      // Step 3: Try LLM extraction first
      let extractionResult = null;
      let extractionMethod = 'llm';

      try {
        const llm = this._ensureLLMManager(llmConfig || {});
        if (llm.isAvailable()) {
          extractionResult = await llm.extractStructured(textContent, schema, {
            prompt: prompt || '',
            maxContentLength: 6000
          });
          extractionMethod = 'llm';
        }
      } catch (llmError) {
        // LLM failed — will fall through to CSS fallback
        extractionResult = null;
      }

      // Step 4: CSS selector fallback if LLM unavailable or failed
      if (!extractionResult && fallbackToSelectors !== false) {
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
        }
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
      // Use explicit selector hint if provided
      const selector = selectorHints[key];
      if (selector) {
        const el = $(selector);
        if (el.length > 0) {
          const rawValue = el.first().text().trim();
          if (rawValue) {
            extracted[key] = this._coerceValue(rawValue, fieldSchema);
            fieldsFound++;
            continue;
          }
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
          const rawValue = el.first().text().trim();
          if (rawValue) {
            extracted[key] = this._coerceValue(rawValue, fieldSchema);
            fieldsFound++;
            break;
          }
        }
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
      validationErrors: errors.length > 0 ? errors : ['Used CSS selector fallback extraction']
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

    // Penalize for validation errors
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

/**
 * Process Document MCP Tool
 * Multi-format document processing for PDFs, web pages, and other content types
 */

import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { PDFProcessor } from '../../core/processing/PDFProcessor.js';
import { ContentProcessor } from '../../core/processing/ContentProcessor.js';
import { BrowserProcessor } from '../../core/processing/BrowserProcessor.js';
import { HTMLCleaner, ContentQualityAssessor } from '../../utils/contentUtils.js';
import { htmlToMarkdown } from '../../utils/htmlToMarkdown.js'; // D3.1
import { safeFetch } from '../../utils/ssrfGuard.js';
import { preflightFetch } from '../../utils/robotsGate.js';
import { noteRetryAfter } from '../../utils/hostRateLimiter.js';

const ProcessDocumentSchema = z.object({
  source: z.string().min(1),
  sourceType: z.enum(['url', 'pdf_url', 'file', 'pdf_file']).default('url'),
  respect_robots: z.boolean().optional(),
  user_agent: z.string().optional(),
  options: z.object({
    // PDF processing options
    extractText: z.boolean().default(true),
    extractMetadata: z.boolean().default(true),
    // Detect grid tables in PDFs from the text layer; the result then always
    // carries a top-level `tables` array (empty when none are found).
    extractTables: z.boolean().default(false),
    maxPages: z.number().min(1).max(500).default(100),
    // C3: extract a specific 1-based, inclusive page range from a PDF
    pageRange: z.object({
      start: z.number().min(1).default(1),
      end: z.number().min(1).optional()
    }).optional(),

    // Web content options
    useReadability: z.boolean().default(true),
    extractStructuredData: z.boolean().default(true),
    requiresJavaScript: z.boolean().optional(),
    waitForTimeout: z.number().min(0).max(30000).default(5000),
    
    // Processing options
    assessContentQuality: z.boolean().default(true),
    includeStatistics: z.boolean().default(true),
    outputFormat: z.enum(['text', 'structured', 'full', 'markdown']).default('structured'),
    
    // Content filtering
    minContentLength: z.number().min(0).default(50),
    removeBoilerplate: z.boolean().default(true)
  }).optional().default({})
});

const ProcessDocumentResult = z.object({
  source: z.string(),
  sourceType: z.string(),
  documentType: z.string(),
  title: z.string().nullable(),
  content: z.object({
    text: z.string(),
    html: z.string().optional(),
    extractedContent: z.string().optional()
  }),
  tables: z.array(z.object({
    page: z.number(),
    rows: z.array(z.array(z.string()))
  })).optional(),
  metadata: z.object({
    // Common metadata
    title: z.string().nullable(),
    author: z.string().nullable(),
    description: z.string().nullable(),
    language: z.string().nullable(),
    
    // PDF-specific metadata
    creator: z.string().nullable().optional(),
    producer: z.string().nullable().optional(),
    creationDate: z.string().nullable().optional(),
    modificationDate: z.string().nullable().optional(),
    format: z.string().nullable().optional(),
    pages: z.number().nullable().optional(),
    encrypted: z.boolean().nullable().optional(),
    
    // Web-specific metadata
    canonical: z.string().nullable().optional(),
    openGraph: z.record(z.string()).optional(),
    twitterCard: z.record(z.string()).optional()
  }).optional(),
  statistics: z.object({
    characters: z.number(),
    charactersNoSpaces: z.number(),
    words: z.number(),
    sentences: z.number(),
    paragraphs: z.number(),
    readingTime: z.number(),
    pages: z.number().optional()
  }).optional(),
  qualityAssessment: z.object({
    isValid: z.boolean(),
    score: z.number(),
    reasons: z.array(z.string()),
    metrics: z.record(z.any())
  }).optional(),
  readabilityScore: z.object({
    score: z.number(),
    level: z.string(),
    metrics: z.record(z.any())
  }).optional(),
  structuredData: z.object({
    jsonLd: z.array(z.any()),
    microdata: z.array(z.any()),
    schemaOrg: z.array(z.any())
  }).optional(),
  processedAt: z.string(),
  processingTime: z.number(),
  success: z.boolean(),
  error: z.string().optional()
});

export class ProcessDocumentTool {
  constructor() {
    this.pdfProcessor = new PDFProcessor();
    this.contentProcessor = new ContentProcessor();
    this.browserProcessor = new BrowserProcessor();
  }

  /**
   * Get tool definition for MCP server
   * @returns {Object} Tool definition
   */
  getDefinition() {
    return {
      name: 'process_document',
      description: 'Process documents from multiple sources and formats including PDFs, web pages, and local files with comprehensive content extraction and analysis.',
      inputSchema: ProcessDocumentSchema
    };
  }

  /**
   * Execute document processing
   * @param {Object} params - Processing parameters
   * @returns {Promise<Object>} Processing result
   */
  async execute(params) {
    const startTime = Date.now();
    
    try {
      const validated = ProcessDocumentSchema.parse(params);
      const { source, sourceType, options, respect_robots, user_agent } = validated;

      const result = {
        source,
        sourceType,
        processedAt: new Date().toISOString(),
        success: false,
        processingTime: 0
      };

      // Determine document type and processing method
      if (sourceType.includes('pdf')) {
        result.documentType = 'pdf';
        await this.processPDFDocument(result, source, sourceType, options, { respect_robots, user_agent });
      } else if (sourceType === 'file') {
        result.documentType = 'file';
        await this.processLocalFileDocument(result, source, options);
      } else {
        result.documentType = 'web';
        await this.processWebDocument(result, source, options, { respect_robots, user_agent });
      }

      // Add statistics if requested
      if (options.includeStatistics && result.content?.text) {
        result.statistics = this.calculateStatistics(result.content.text);
      }

      // Assess content quality if requested
      if (options.assessContentQuality && result.content?.text) {
        result.qualityAssessment = ContentQualityAssessor.assessContentQuality(
          result.content.text,
          { minLength: options.minContentLength }
        );
      }

      // Readability is populated once, here, for every source type, from the
      // same Flesch implementation that backs
      // qualityAssessment.metrics.readability — so the two fields on a
      // response can never contradict each other.
      if (result.content?.text) {
        const { score, level, ...metrics } = ContentQualityAssessor.calculateSimpleReadability(result.content.text);
        result.readabilityScore = { score, level, metrics };
      }

      result.processingTime = Date.now() - startTime;
      result.success = true;

      return result;

    } catch (error) {
      return {
        source: params.source || 'unknown',
        sourceType: params.sourceType || 'unknown',
        documentType: 'unknown',
        processedAt: new Date().toISOString(),
        success: false,
        error: `Document processing failed: ${error.message}`,
        processingTime: Date.now() - startTime,
        content: { text: '' }
      };
    }
  }

  /**
   * Process PDF document
   * @param {Object} result - Result object to populate
   * @param {string} source - PDF source
   * @param {string} sourceType - Source type
   * @param {Object} options - Processing options
   * @returns {Promise<void>}
   */
  async processPDFDocument(result, source, sourceType, options, identity = {}) {
    // A remote PDF is a fetch of the target like any other; a local file is not.
    if (sourceType === 'pdf_url') {
      const gate = await preflightFetch(source, {
        respectRobots: identity.respect_robots,
        userAgent: identity.user_agent,
        tool: 'process_document'
      });
      if (gate.warnings.length > 0) result.warnings = gate.warnings;
    }

    const pdfResult = await this.pdfProcessor.processPDF({
      source,
      sourceType: sourceType.replace('pdf_', ''),
      options: {
        extractText: options.extractText,
        extractMetadata: options.extractMetadata,
        extractTables: options.extractTables,
        maxPages: options.maxPages,
        ...(options.pageRange ? { pageRange: options.pageRange } : {})
      }
    });

    if (!pdfResult.success) {
      throw new Error(pdfResult.error || 'PDF processing failed');
    }

    // Set content
    result.content = {
      text: pdfResult.text || ''
    };

    // When table extraction was requested, always answer with a tables array —
    // honestly empty when the detector found none.
    if (options.extractTables) {
      result.tables = pdfResult.tables || [];
    }

    // Set title
    result.title = pdfResult.metadata?.title || null;

    // Set metadata
    if (pdfResult.metadata) {
      result.metadata = {
        title: pdfResult.metadata.title,
        author: pdfResult.metadata.author,
        description: null, // PDFs don't typically have descriptions
        language: null,
        creator: pdfResult.metadata.creator,
        producer: pdfResult.metadata.producer,
        creationDate: pdfResult.metadata.creationDate,
        modificationDate: pdfResult.metadata.modificationDate,
        format: pdfResult.metadata.format,
        pages: pdfResult.metadata.pages,
        encrypted: pdfResult.metadata.encrypted
      };
    }
  }

  /**
   * Process web document
   * @param {Object} result - Result object to populate
   * @param {string} source - Web source URL
   * @param {Object} options - Processing options
   * @returns {Promise<void>}
   */
  async processWebDocument(result, source, options, identity = {}) {
    // Step 1: Fetch content (with or without JavaScript rendering).
    // Robots gate before either path — the browser render is a request too.
    let html, pageTitle;
    const gate = await preflightFetch(source, {
      respectRobots: identity.respect_robots,
      userAgent: identity.user_agent,
      tool: 'process_document'
    });
    if (gate.warnings.length > 0) result.warnings = gate.warnings;
    const shouldUseJavaScript = options.requiresJavaScript || await this.shouldUseJavaScript(source);

    if (shouldUseJavaScript) {
      console.error('Using browser rendering for JavaScript content...');
      const browserResult = await this.browserProcessor.processURL({
        url: source,
        options: {
          waitForTimeout: options.waitForTimeout,
          enableJavaScript: true,
          enableImages: false,
          captureScreenshot: false
        }
      });

      if (!browserResult.success) {
        throw new Error(`Browser processing failed: ${browserResult.error}`);
      }

      html = browserResult.html;
      pageTitle = browserResult.title;
    } else {
      // Simple HTTP fetch
      const response = await safeFetch(source, {
        headers: { ...gate.headers },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        if (response.status === 429 || response.status === 503) {
          noteRetryAfter(source, response.headers.get('retry-after'));
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      html = await response.text();
      pageTitle = this.extractTitleFromHTML(html);
    }

    result.title = pageTitle;

    await this.processFetchedHtml(result, html, source, options);
  }

  /**
   * Process a local non-PDF file (sourceType 'file'): read it from disk and
   * run it through the same content-processing pipeline used for web pages.
   * @param {Object} result - Result object to populate
   * @param {string} source - Local file path
   * @param {Object} options - Processing options
   * @returns {Promise<void>}
   */
  async processLocalFileDocument(result, source, options) {
    const resolvedPath = path.resolve(source);
    let content;
    try {
      content = await fs.readFile(resolvedPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read local file: ${error.message}`);
    }

    const isHtml = /\.html?$/i.test(resolvedPath) || /<html[\s>]/i.test(content.slice(0, 1000));
    const html = isHtml
      ? content
      : `<html><body><pre>${content.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre></body></html>`;

    result.title = isHtml ? this.extractTitleFromHTML(content) : null;

    // No `url` to pass here — ContentProcessor's url field is a validated
    // absolute URL, and a filesystem path doesn't qualify.
    await this.processFetchedHtml(result, html, undefined, options);
  }

  /**
   * Run the shared content-processing pipeline (Readability/boilerplate
   * fallback, metadata, structured data) over already-fetched HTML.
   * @param {Object} result - Result object to populate
   * @param {string} html - HTML content
   * @param {string|undefined} url - Source URL (omitted for local files)
   * @param {Object} options - Processing options
   * @returns {Promise<void>}
   */
  async processFetchedHtml(result, html, url, options) {
    // Step 2: Process content with ContentProcessor
    const processingResult = await this.contentProcessor.processContent({
      html,
      url,
      options: {
        extractStructuredData: options.extractStructuredData,
        // execute() computes readability once for every source type; asking
        // ContentProcessor for its own score here would only duplicate it.
        calculateReadabilityScore: false,
        removeBoilerplate: options.useReadability,
        preserveImageInfo: false,
        extractMetadata: true
      }
    });

    // Step 3: Extract and format content
    let mainText = '';
    let extractedContent = '';

    if (processingResult.readability) {
      mainText = processingResult.readability.textContent || processingResult.readability.content;
      extractedContent = processingResult.readability.content;
    } else if (processingResult.fallback_content) {
      mainText = processingResult.fallback_content.content;
    } else {
      // Last resort: extract text from HTML
      mainText = HTMLCleaner.extractTextWithFormatting(html, {
        preserveLineBreaks: true,
        preserveParagraphs: true,
        includeLinks: false,
        includeImageAlt: false
      });
    }

    // Set content based on output format
    result.content = { text: mainText };
    
    if (options.outputFormat === 'structured' || options.outputFormat === 'full') {
      if (extractedContent) result.content.extractedContent = extractedContent;
    }
    
    if (options.outputFormat === 'full') {
      result.content.html = html;
    }

    // D3.1: Markdown output mode — convert extracted HTML to markdown via Turndown
    if (options.outputFormat === 'markdown') {
      result.content.markdown = htmlToMarkdown(extractedContent || html);
    }

    // Step 4: Set metadata
    if (processingResult.metadata) {
      result.metadata = {
        title: processingResult.metadata.title,
        author: processingResult.metadata.author,
        description: processingResult.metadata.description,
        language: processingResult.metadata.language,
        canonical: processingResult.metadata.canonical,
        openGraph: processingResult.metadata.openGraph,
        twitterCard: processingResult.metadata.twitterCard
      };
    }

    // Step 5: Add structured data
    if (options.extractStructuredData && processingResult.structured_data) {
      result.structuredData = processingResult.structured_data;
    }
  }

  /**
   * Calculate text statistics
   * @param {string} text - Text to analyze
   * @returns {Object} - Text statistics
   */
  calculateStatistics(text) {
    const characters = text.length;
    const charactersNoSpaces = text.replace(/\s/g, '').length;
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    // Estimate reading time (average 200 words per minute)
    const readingTime = Math.ceil(words.length / 200);

    return {
      characters,
      charactersNoSpaces,
      words: words.length,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      readingTime
    };
  }

  /**
   * Determine if JavaScript rendering is needed
   * @param {string} url - URL to analyze
   * @returns {Promise<boolean>} - Whether JavaScript is needed
   */
  async shouldUseJavaScript(url) {
    // Strip the fragment first: an ordinary document anchor (e.g. #install)
    // isn't a signal for client-side routing, and anchoring the path pattern
    // to full segments avoids false positives like "/apple" or "/spaces".
    const urlWithoutFragment = url.split('#')[0];
    const jsIndicators = [
      /\/(app|spa|dashboard|admin)(\/|$)/,
      /\.(js|jsx|ts|tsx)$/
    ];

    return jsIndicators.some(pattern => pattern.test(urlWithoutFragment));
  }

  /**
   * Extract title from HTML using simple parsing
   * @param {string} html - HTML content
   * @returns {string|null} - Extracted title
   */
  extractTitleFromHTML(html) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return titleMatch ? titleMatch[1].trim() : null;
  }

  /**
   * Process multiple documents concurrently
   * @param {Array} sources - Array of document sources
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} - Array of processing results
   */
  async processMultipleDocuments(sources, options = {}) {
    const concurrency = options.concurrency || 3;
    const results = [];

    for (let i = 0; i < sources.length; i += concurrency) {
      const batch = sources.slice(i, i + concurrency);
      const batchPromises = batch.map(source => {
        const params = typeof source === 'string' 
          ? { source, options }
          : { ...source, options: { ...options, ...source.options } };
        
        return this.execute(params).catch(error => ({
          source: params.source,
          success: false,
          error: error.message,
          processedAt: new Date().toISOString(),
          processingTime: 0,
          content: { text: '' }
        }));
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Clean up resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.browserProcessor) {
      await this.browserProcessor.cleanup();
    }
  }
}

export default ProcessDocumentTool;

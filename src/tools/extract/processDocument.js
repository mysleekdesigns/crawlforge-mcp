/**
 * Process Document MCP Tool
 * Multi-format document processing for PDFs, web pages, and other content types
 */

import { z } from 'zod';
import { PDFProcessor } from '../../core/processing/PDFProcessor.js';
import { ContentProcessor } from '../../core/processing/ContentProcessor.js';
import { BrowserProcessor } from '../../core/processing/BrowserProcessor.js';
import { HTMLCleaner, ContentQualityAssessor } from '../../utils/contentUtils.js';

const ProcessDocumentSchema = z.object({
  source: z.string().min(1),
  sourceType: z.enum(['url', 'pdf_url', 'file', 'pdf_file']).default('url'),
  options: z.object({
    // PDF processing options
    extractText: z.boolean().default(true),
    extractMetadata: z.boolean().default(true),
    password: z.string().optional(),
    maxPages: z.number().min(1).max(500).default(100),
    
    // Web content options
    useReadability: z.boolean().default(true),
    extractStructuredData: z.boolean().default(true),
    requiresJavaScript: z.boolean().optional(),
    waitForTimeout: z.number().min(0).max(30000).default(5000),
    
    // Processing options
    assessContentQuality: z.boolean().default(true),
    includeStatistics: z.boolean().default(true),
    outputFormat: z.enum(['text', 'structured', 'full']).default('structured'),
    
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
      const { source, sourceType, options } = validated;

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
        await this.processPDFDocument(result, source, sourceType, options);
      } else {
        result.documentType = 'web';
        await this.processWebDocument(result, source, options);
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
  async processPDFDocument(result, source, sourceType, options) {
    const pdfResult = await this.pdfProcessor.processPDF({
      source,
      sourceType: sourceType.replace('pdf_', ''),
      options: {
        extractText: options.extractText,
        extractMetadata: options.extractMetadata,
        password: options.password,
        maxPages: options.maxPages
      }
    });

    if (!pdfResult.success) {
      throw new Error(pdfResult.error || 'PDF processing failed');
    }

    // Set content
    result.content = {
      text: pdfResult.text || ''
    };

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

    // Calculate readability score for text content
    if (options.assessContentQuality && result.content.text) {
      const readabilityScore = this.calculateReadabilityScore(result.content.text);
      if (readabilityScore) {
        result.readabilityScore = readabilityScore;
      }
    }
  }

  /**
   * Process web document
   * @param {Object} result - Result object to populate
   * @param {string} source - Web source URL
   * @param {Object} options - Processing options
   * @returns {Promise<void>}
   */
  async processWebDocument(result, source, options) {
    // Step 1: Fetch content (with or without JavaScript rendering)
    let html, pageTitle;
    const shouldUseJavaScript = options.requiresJavaScript || await this.shouldUseJavaScript(source);
    
    if (shouldUseJavaScript) {
      console.log('Using browser rendering for JavaScript content...');
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
      const response = await fetch(source, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MCP-WebScraper/3.0; Document-Processor)'
        },
        timeout: 15000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      html = await response.text();
      pageTitle = this.extractTitleFromHTML(html);
    }

    result.title = pageTitle;

    // Step 2: Process content with ContentProcessor
    const processingResult = await this.contentProcessor.processContent({
      html,
      url: source,
      options: {
        extractStructuredData: options.extractStructuredData,
        calculateReadabilityScore: true,
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

    // Step 5: Add readability score
    if (processingResult.readability_score) {
      result.readabilityScore = processingResult.readability_score;
    }

    // Step 6: Add structured data
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
   * Calculate readability score
   * @param {string} text - Text to analyze
   * @returns {Object|null} - Readability score
   */
  calculateReadabilityScore(text) {
    try {
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const words = text.split(/\s+/).filter(w => w.length > 0);
      
      if (sentences.length === 0 || words.length === 0) {
        return null;
      }

      const avgWordsPerSentence = words.length / sentences.length;
      const avgCharsPerWord = text.replace(/\s/g, '').length / words.length;
      
      // Flesch Reading Ease Score approximation
      const score = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * (avgCharsPerWord / 4.7));
      const clampedScore = Math.max(0, Math.min(100, score));

      return {
        score: Math.round(clampedScore * 100) / 100,
        level: this.getReadabilityLevel(clampedScore),
        metrics: {
          sentences: sentences.length,
          words: words.length,
          avgWordsPerSentence: Math.round(avgWordsPerSentence * 100) / 100,
          avgCharsPerWord: Math.round(avgCharsPerWord * 100) / 100
        }
      };

    } catch (error) {
      console.warn('Readability calculation failed:', error.message);
      return null;
    }
  }

  /**
   * Get readability level from score
   * @param {number} score - Readability score
   * @returns {string} - Readability level
   */
  getReadabilityLevel(score) {
    if (score >= 90) return 'Very Easy';
    if (score >= 80) return 'Easy';
    if (score >= 70) return 'Fairly Easy';
    if (score >= 60) return 'Standard';
    if (score >= 50) return 'Fairly Difficult';
    if (score >= 30) return 'Difficult';
    return 'Very Difficult';
  }

  /**
   * Determine if JavaScript rendering is needed
   * @param {string} url - URL to analyze
   * @returns {Promise<boolean>} - Whether JavaScript is needed
   */
  async shouldUseJavaScript(url) {
    const jsIndicators = [
      /\/(app|spa|dashboard|admin)/,
      /#/,
      /\.(js|jsx|ts|tsx)$/
    ];

    return jsIndicators.some(pattern => pattern.test(url));
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
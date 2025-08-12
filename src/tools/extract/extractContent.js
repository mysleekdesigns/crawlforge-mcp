/**
 * Extract Content MCP Tool
 * Enhanced content extraction with main content detection and readability features
 */

import { z } from 'zod';
import { ContentProcessor } from '../../core/processing/ContentProcessor.js';
import { BrowserProcessor } from '../../core/processing/BrowserProcessor.js';
import { HTMLCleaner, ContentQualityAssessor } from '../../utils/contentUtils.js';

const ExtractContentSchema = z.object({
  url: z.string().url(),
  options: z.object({
    // Content extraction options
    useReadability: z.boolean().default(true),
    extractStructuredData: z.boolean().default(true),
    calculateReadabilityScore: z.boolean().default(true),
    preserveImageInfo: z.boolean().default(true),
    extractMetadata: z.boolean().default(true),
    
    // Browser rendering options
    requiresJavaScript: z.boolean().optional(),
    waitForSelector: z.string().optional(),
    waitForTimeout: z.number().min(0).max(30000).default(5000),
    
    // Quality assessment options
    assessContentQuality: z.boolean().default(true),
    minContentLength: z.number().min(0).default(100),
    
    // Output options
    includeRawHTML: z.boolean().default(false),
    includeCleanedHTML: z.boolean().default(false),
    outputFormat: z.enum(['text', 'markdown', 'structured']).default('structured')
  }).optional().default({})
});

const ExtractContentResult = z.object({
  url: z.string(),
  title: z.string().nullable(),
  content: z.object({
    text: z.string(),
    html: z.string().optional(),
    markdown: z.string().optional()
  }),
  metadata: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
    author: z.string().nullable(),
    published: z.string().nullable(),
    language: z.string().nullable(),
    canonical: z.string().nullable(),
    openGraph: z.record(z.string()).optional(),
    twitterCard: z.record(z.string()).optional()
  }).optional(),
  readability: z.object({
    title: z.string().nullable(),
    content: z.string(),
    textContent: z.string(),
    length: z.number(),
    excerpt: z.string().nullable(),
    byline: z.string().nullable(),
    siteName: z.string().nullable(),
    lang: z.string().nullable()
  }).optional(),
  readabilityScore: z.object({
    score: z.number(),
    level: z.string(),
    sentences: z.number(),
    words: z.number(),
    characters: z.number(),
    avgWordsPerSentence: z.number(),
    avgCharsPerWord: z.number()
  }).optional(),
  structuredData: z.object({
    jsonLd: z.array(z.any()),
    microdata: z.array(z.any()),
    schemaOrg: z.array(z.any())
  }).optional(),
  images: z.array(z.object({
    src: z.string(),
    alt: z.string().nullable(),
    title: z.string().nullable(),
    width: z.string().nullable(),
    height: z.string().nullable()
  })).optional(),
  qualityAssessment: z.object({
    isValid: z.boolean(),
    score: z.number(),
    reasons: z.array(z.string()),
    metrics: z.record(z.any())
  }).optional(),
  extractedAt: z.string(),
  processingTime: z.number(),
  success: z.boolean(),
  error: z.string().optional()
});

export class ExtractContentTool {
  constructor() {
    this.contentProcessor = new ContentProcessor();
    this.browserProcessor = new BrowserProcessor();
  }

  /**
   * Get tool definition for MCP server
   * @returns {Object} Tool definition
   */
  getDefinition() {
    return {
      name: 'extract_content',
      description: 'Extract and analyze main content from web pages with enhanced readability detection, structured data extraction, and content quality assessment.',
      inputSchema: ExtractContentSchema
    };
  }

  /**
   * Execute content extraction
   * @param {Object} params - Extraction parameters
   * @returns {Promise<Object>} Extraction result
   */
  async execute(params) {
    const startTime = Date.now();
    
    try {
      const validated = ExtractContentSchema.parse(params);
      const { url, options } = validated;

      const result = {
        url,
        extractedAt: new Date().toISOString(),
        success: false,
        processingTime: 0
      };

      // Step 1: Fetch content (with or without JavaScript rendering)
      let html, pageTitle;
      const shouldUseJavaScript = options.requiresJavaScript || await this.shouldUseJavaScript(url);
      
      if (shouldUseJavaScript) {
        console.log('Using browser rendering for JavaScript content...');
        const browserResult = await this.browserProcessor.processURL({
          url,
          options: {
            waitForSelector: options.waitForSelector,
            waitForTimeout: options.waitForTimeout,
            enableJavaScript: true,
            enableImages: options.preserveImageInfo,
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
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MCP-WebScraper/3.0; Enhanced-Content-Extractor)'
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
        url,
        options: {
          extractStructuredData: options.extractStructuredData,
          calculateReadabilityScore: options.calculateReadabilityScore,
          removeBoilerplate: options.useReadability,
          preserveImageInfo: options.preserveImageInfo,
          extractMetadata: options.extractMetadata
        }
      });

      // Step 3: Extract and format content
      if (processingResult.readability) {
        result.readability = processingResult.readability;
        result.content = {
          text: processingResult.readability.textContent || processingResult.readability.content,
        };

        // Convert to markdown if requested
        if (options.outputFormat === 'markdown') {
          result.content.markdown = this.convertToMarkdown(processingResult.readability.content);
        }
      } else if (processingResult.fallback_content) {
        result.content = {
          text: processingResult.fallback_content.content
        };
      } else {
        // Last resort: extract text from HTML
        result.content = {
          text: HTMLCleaner.extractTextWithFormatting(html, {
            preserveLineBreaks: true,
            preserveParagraphs: true,
            includeLinks: false,
            includeImageAlt: true
          })
        };
      }

      // Include HTML if requested
      if (options.includeRawHTML) {
        result.content.html = html;
      }
      if (options.includeCleanedHTML && processingResult.readability) {
        result.content.cleanedHTML = processingResult.readability.content;
      }

      // Step 4: Add readability score
      if (processingResult.readability_score) {
        result.readabilityScore = processingResult.readability_score;
      }

      // Step 5: Add metadata
      if (processingResult.metadata) {
        result.metadata = processingResult.metadata;
      }

      // Step 6: Add structured data
      if (processingResult.structured_data) {
        result.structuredData = processingResult.structured_data;
      }

      // Step 7: Add image information
      if (processingResult.images) {
        result.images = processingResult.images;
      }

      // Step 8: Assess content quality
      if (options.assessContentQuality) {
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
        url: params.url || 'unknown',
        extractedAt: new Date().toISOString(),
        success: false,
        error: `Content extraction failed: ${error.message}`,
        processingTime: Date.now() - startTime,
        content: { text: '' }
      };
    }
  }

  /**
   * Determine if JavaScript rendering is needed
   * @param {string} url - URL to analyze
   * @returns {Promise<boolean>} - Whether JavaScript is needed
   */
  async shouldUseJavaScript(url) {
    // Simple heuristics for determining if JavaScript is needed
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
   * Convert HTML content to Markdown
   * @param {string} html - HTML content
   * @returns {string} - Markdown content
   */
  convertToMarkdown(html) {
    // Simple HTML to Markdown conversion
    return html
      .replace(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi, (match, level, text) => {
        const hashes = '#'.repeat(parseInt(level));
        return `\n${hashes} ${text}\n`;
      })
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
      .replace(/<br[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '') // Remove remaining HTML tags
      .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
      .trim();
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

export default ExtractContentTool;
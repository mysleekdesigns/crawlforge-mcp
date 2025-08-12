/**
 * Summarize Content MCP Tool
 * Content summarization with configurable length and type options
 */

import { z } from 'zod';
import { ContentAnalyzer } from '../../core/analysis/ContentAnalyzer.js';

const SummarizeContentSchema = z.object({
  text: z.string().min(10),
  options: z.object({
    summaryLength: z.enum(['short', 'medium', 'long']).default('medium'),
    summaryType: z.enum(['extractive', 'abstractive']).default('extractive'),
    includeKeypoints: z.boolean().default(true),
    includeKeywords: z.boolean().default(true),
    includeStatistics: z.boolean().default(true),
    maxKeywords: z.number().min(1).max(20).default(10),
    preserveStructure: z.boolean().default(false),
    language: z.string().optional()
  }).optional().default({})
});

const SummarizeContentResult = z.object({
  originalText: z.string(),
  summary: z.object({
    text: z.string(),
    sentences: z.array(z.string()),
    type: z.string(),
    length: z.string(),
    compressionRatio: z.number()
  }),
  keypoints: z.array(z.string()).optional(),
  keywords: z.array(z.object({
    keyword: z.string(),
    relevance: z.number(),
    frequency: z.number()
  })).optional(),
  statistics: z.object({
    original: z.object({
      characters: z.number(),
      words: z.number(),
      sentences: z.number(),
      paragraphs: z.number(),
      readingTime: z.number()
    }),
    summary: z.object({
      characters: z.number(),
      words: z.number(),
      sentences: z.number(),
      readingTime: z.number()
    })
  }).optional(),
  metadata: z.object({
    language: z.string().optional(),
    processingMethod: z.string(),
    confidenceScore: z.number()
  }),
  summarizedAt: z.string(),
  processingTime: z.number(),
  success: z.boolean(),
  error: z.string().optional()
});

export class SummarizeContentTool {
  constructor() {
    this.contentAnalyzer = new ContentAnalyzer();
  }

  /**
   * Get tool definition for MCP server
   * @returns {Object} Tool definition
   */
  getDefinition() {
    return {
      name: 'summarize_content',
      description: 'Generate intelligent summaries of text content with configurable length, type, and additional analysis including key points and keywords.',
      inputSchema: SummarizeContentSchema
    };
  }

  /**
   * Execute content summarization
   * @param {Object} params - Summarization parameters
   * @returns {Promise<Object>} Summarization result
   */
  async execute(params) {
    const startTime = Date.now();
    
    try {
      const validated = SummarizeContentSchema.parse(params);
      const { text, options } = validated;

      const result = {
        originalText: text.substring(0, 500) + (text.length > 500 ? '...' : ''),
        summarizedAt: new Date().toISOString(),
        success: false,
        processingTime: 0
      };

      // Step 1: Generate summary using ContentAnalyzer
      const analysisResult = await this.contentAnalyzer.analyzeContent({
        text,
        options: {
          summarize: true,
          extractKeywords: options.includeKeywords,
          detectLanguage: true,
          summaryLength: options.summaryLength,
          summaryType: options.summaryType,
          maxKeywords: options.maxKeywords,
          extractTopics: false,
          extractEntities: false,
          includeReadabilityMetrics: false,
          includeSentiment: false
        }
      });

      if (!analysisResult.summary) {
        throw new Error('Summary generation failed');
      }

      // Step 2: Set summary result
      result.summary = analysisResult.summary;

      // Step 3: Extract key points if requested
      if (options.includeKeypoints) {
        result.keypoints = await this.extractKeyPoints(text, analysisResult.summary);
      }

      // Step 4: Add keywords if requested
      if (options.includeKeywords && analysisResult.keywords) {
        result.keywords = analysisResult.keywords;
      }

      // Step 5: Calculate statistics if requested
      if (options.includeStatistics) {
        result.statistics = {
          original: this.calculateTextStatistics(text),
          summary: this.calculateTextStatistics(result.summary.text)
        };
      }

      // Step 6: Set metadata
      result.metadata = {
        language: analysisResult.language?.code || options.language || 'unknown',
        processingMethod: options.summaryType,
        confidenceScore: this.calculateConfidenceScore(text, result.summary.text)
      };

      result.processingTime = Date.now() - startTime;
      result.success = true;

      return result;

    } catch (error) {
      return {
        originalText: params.text?.substring(0, 100) || 'unknown',
        summarizedAt: new Date().toISOString(),
        success: false,
        error: `Content summarization failed: ${error.message}`,
        processingTime: Date.now() - startTime,
        summary: {
          text: '',
          sentences: [],
          type: 'failed',
          length: 'none',
          compressionRatio: 0
        },
        metadata: {
          processingMethod: 'failed',
          confidenceScore: 0
        }
      };
    }
  }

  /**
   * Extract key points from original text and summary
   * @param {string} originalText - Original text
   * @param {Object} summary - Summary object
   * @returns {Promise<Array>} - Array of key points
   */
  async extractKeyPoints(originalText, summary) {
    try {
      // Simple key point extraction based on important sentences
      const sentences = originalText.split(/[.!?]+/).filter(s => s.trim().length > 0);
      
      // Score sentences based on various factors
      const scoredSentences = sentences.map(sentence => {
        const words = sentence.toLowerCase().split(/\s+/);
        
        // Factors that increase sentence importance
        let score = 0;
        
        // Length factor (medium-length sentences preferred)
        const wordCount = words.length;
        if (wordCount >= 10 && wordCount <= 25) {
          score += 2;
        } else if (wordCount >= 6 && wordCount <= 30) {
          score += 1;
        }

        // Keyword density (words that appear in summary)
        const summaryWords = summary.text.toLowerCase().split(/\s+/);
        const commonWords = words.filter(word => summaryWords.includes(word));
        score += commonWords.length * 0.5;

        // Position factor (sentences at beginning and end are often important)
        const position = sentences.indexOf(sentence);
        const totalSentences = sentences.length;
        if (position < totalSentences * 0.2 || position > totalSentences * 0.8) {
          score += 1;
        }

        // Numeric data or specific terms
        if (/\d+/.test(sentence)) score += 0.5;
        if (/\b(important|significant|key|main|primary|essential|critical)\b/i.test(sentence)) {
          score += 1;
        }

        return {
          sentence: sentence.trim(),
          score,
          position
        };
      });

      // Select top key points
      const topSentences = scoredSentences
        .filter(item => item.score > 1) // Minimum threshold
        .sort((a, b) => b.score - a.score)
        .slice(0, 5) // Top 5 key points
        .sort((a, b) => a.position - b.position) // Restore original order
        .map(item => item.sentence);

      return topSentences;

    } catch (error) {
      console.warn('Key point extraction failed:', error.message);
      return [];
    }
  }

  /**
   * Calculate text statistics
   * @param {string} text - Text to analyze
   * @returns {Object} - Text statistics
   */
  calculateTextStatistics(text) {
    const characters = text.length;
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    // Estimate reading time (average 200 words per minute)
    const readingTime = Math.ceil(words.length / 200);

    return {
      characters,
      words: words.length,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      readingTime
    };
  }

  /**
   * Calculate confidence score for summary quality
   * @param {string} originalText - Original text
   * @param {string} summaryText - Summary text
   * @returns {number} - Confidence score (0-1)
   */
  calculateConfidenceScore(originalText, summaryText) {
    try {
      if (!summaryText || summaryText.length === 0) {
        return 0;
      }

      const originalWords = originalText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const summaryWords = summaryText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      
      if (originalWords.length === 0 || summaryWords.length === 0) {
        return 0;
      }

      // Calculate word overlap
      const uniqueOriginalWords = new Set(originalWords);
      const uniqueSummaryWords = new Set(summaryWords);
      const intersection = new Set([...uniqueOriginalWords].filter(word => uniqueSummaryWords.has(word)));
      
      const overlapRatio = intersection.size / Math.min(uniqueOriginalWords.size, uniqueSummaryWords.size);
      
      // Calculate compression ratio factor
      const compressionRatio = summaryText.length / originalText.length;
      const compressionScore = compressionRatio > 0.1 && compressionRatio < 0.8 ? 1 : 0.5;
      
      // Calculate length appropriateness
      const summaryWordCount = summaryWords.length;
      const lengthScore = summaryWordCount >= 10 && summaryWordCount <= 200 ? 1 : 0.7;
      
      // Combine factors
      const confidence = (overlapRatio * 0.5 + compressionScore * 0.3 + lengthScore * 0.2);
      
      return Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100;

    } catch (error) {
      console.warn('Confidence score calculation failed:', error.message);
      return 0.5; // Default neutral confidence
    }
  }

  /**
   * Summarize multiple texts
   * @param {Array} texts - Array of texts to summarize
   * @param {Object} options - Summarization options
   * @returns {Promise<Array>} - Array of summarization results
   */
  async summarizeMultiple(texts, options = {}) {
    const concurrency = options.concurrency || 3;
    const results = [];

    for (let i = 0; i < texts.length; i += concurrency) {
      const batch = texts.slice(i, i + concurrency);
      const batchPromises = batch.map(text => {
        const params = typeof text === 'string' 
          ? { text, options }
          : { ...text, options: { ...options, ...text.options } };
        
        return this.execute(params).catch(error => ({
          originalText: params.text?.substring(0, 100) || 'unknown',
          success: false,
          error: error.message,
          summarizedAt: new Date().toISOString(),
          processingTime: 0,
          summary: {
            text: '',
            sentences: [],
            type: 'failed',
            length: 'none',
            compressionRatio: 0
          }
        }));
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Generate summary with custom length
   * @param {string} text - Text to summarize
   * @param {number} targetWords - Target word count for summary
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Custom summary result
   */
  async generateCustomLengthSummary(text, targetWords, options = {}) {
    // Determine length category based on target words
    let summaryLength;
    if (targetWords <= 50) summaryLength = 'short';
    else if (targetWords <= 150) summaryLength = 'medium';
    else summaryLength = 'long';

    return await this.execute({
      text,
      options: {
        ...options,
        summaryLength,
        targetWords
      }
    });
  }
}

export default SummarizeContentTool;
/**
 * PDFProcessor - PDF document processing with text and metadata extraction
 * Handles PDF files from URLs or local paths with comprehensive error handling
 */

import pdfParse from 'pdf-parse';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

const PDFProcessorSchema = z.object({
  source: z.string().min(1),
  sourceType: z.enum(['url', 'file', 'buffer']).default('url'),
  options: z.object({
    extractMetadata: z.boolean().default(true),
    extractText: z.boolean().default(true),
    password: z.string().optional(),
    maxPages: z.number().min(1).max(1000).default(100),
    parseOptions: z.object({
      normalizeWhitespace: z.boolean().default(true),
      disableCombineTextItems: z.boolean().default(false)
    }).optional().default({})
  }).optional().default({})
});

const PDFResult = z.object({
  source: z.string(),
  sourceType: z.string(),
  text: z.string().optional(),
  metadata: z.object({
    title: z.string().nullable(),
    author: z.string().nullable(),
    subject: z.string().nullable(),
    creator: z.string().nullable(),
    producer: z.string().nullable(),
    creationDate: z.string().nullable(),
    modificationDate: z.string().nullable(),
    format: z.string().nullable(),
    pages: z.number().nullable(),
    encrypted: z.boolean().nullable(),
    linearized: z.boolean().nullable(),
    pdfVersion: z.string().nullable()
  }).optional(),
  pageCount: z.number(),
  extractedAt: z.string(),
  processingTime: z.number(),
  success: z.boolean(),
  error: z.string().optional()
});

export class PDFProcessor {
  constructor() {
    this.defaultOptions = {
      extractMetadata: true,
      extractText: true,
      maxPages: 100,
      parseOptions: {
        normalizeWhitespace: true,
        disableCombineTextItems: false
      }
    };
  }

  /**
   * Process PDF document from various sources
   * @param {Object} params - Processing parameters
   * @param {string} params.source - PDF source (URL, file path, or buffer)
   * @param {string} params.sourceType - Type of source ('url', 'file', 'buffer')
   * @param {Object} params.options - Processing options
   * @returns {Promise<Object>} - Processing result with text and metadata
   */
  async processPDF(params) {
    const startTime = Date.now();
    
    try {
      const validated = PDFProcessorSchema.parse(params);
      const { source, sourceType, options } = validated;
      const processingOptions = { ...this.defaultOptions, ...options };

      const result = {
        source,
        sourceType,
        extractedAt: new Date().toISOString(),
        success: false,
        processingTime: 0
      };

      // Get PDF buffer based on source type
      let pdfBuffer;
      try {
        pdfBuffer = await this.getPDFBuffer(source, sourceType);
      } catch (error) {
        result.error = `Failed to load PDF: ${error.message}`;
        result.processingTime = Date.now() - startTime;
        return result;
      }

      // Parse PDF with options
      const parseOptions = {
        ...processingOptions.parseOptions,
        max: processingOptions.maxPages
      };

      if (processingOptions.password) {
        parseOptions.password = processingOptions.password;
      }

      let pdfData;
      try {
        pdfData = await pdfParse(pdfBuffer, parseOptions);
      } catch (error) {
        result.error = `PDF parsing failed: ${error.message}`;
        result.processingTime = Date.now() - startTime;
        return result;
      }

      // Extract text content
      if (processingOptions.extractText) {
        result.text = this.cleanPDFText(pdfData.text);
      }

      // Extract metadata
      if (processingOptions.extractMetadata) {
        result.metadata = this.extractPDFMetadata(pdfData);
      }

      // Set page count
      result.pageCount = pdfData.numpages || 0;

      // Calculate processing time
      result.processingTime = Date.now() - startTime;
      result.success = true;

      return result;

    } catch (error) {
      return {
        source: params.source || 'unknown',
        sourceType: params.sourceType || 'unknown',
        extractedAt: new Date().toISOString(),
        success: false,
        error: `PDF processing failed: ${error.message}`,
        processingTime: Date.now() - startTime,
        pageCount: 0
      };
    }
  }

  /**
   * Get PDF buffer from various sources
   * @param {string} source - PDF source
   * @param {string} sourceType - Source type
   * @returns {Promise<Buffer>} - PDF buffer
   */
  async getPDFBuffer(source, sourceType) {
    switch (sourceType) {
      case 'url':
        return await this.downloadPDFFromURL(source);
      case 'file':
        return await this.readPDFFromFile(source);
      case 'buffer':
        return Buffer.isBuffer(source) ? source : Buffer.from(source);
      default:
        throw new Error(`Unsupported source type: ${sourceType}`);
    }
  }

  /**
   * Download PDF from URL
   * @param {string} url - PDF URL
   * @returns {Promise<Buffer>} - PDF buffer
   */
  async downloadPDFFromURL(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MCP-WebScraper/2.0; PDF-Processor)'
        },
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('pdf')) {
        console.warn(`Warning: Content-Type is ${contentType}, expected PDF`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);

    } catch (error) {
      throw new Error(`Failed to download PDF from URL: ${error.message}`);
    }
  }

  /**
   * Read PDF from local file
   * @param {string} filePath - Local file path
   * @returns {Promise<Buffer>} - PDF buffer
   */
  async readPDFFromFile(filePath) {
    try {
      // Validate file path
      const resolvedPath = path.resolve(filePath);
      const stats = await fs.stat(resolvedPath);
      
      if (!stats.isFile()) {
        throw new Error('Path is not a file');
      }

      // Check file extension
      const ext = path.extname(resolvedPath).toLowerCase();
      if (ext !== '.pdf') {
        console.warn(`Warning: File extension is ${ext}, expected .pdf`);
      }

      // Read file
      return await fs.readFile(resolvedPath);

    } catch (error) {
      throw new Error(`Failed to read PDF file: ${error.message}`);
    }
  }

  /**
   * Extract and format PDF metadata
   * @param {Object} pdfData - Parsed PDF data from pdf-parse
   * @returns {Object} - Formatted metadata
   */
  extractPDFMetadata(pdfData) {
    const info = pdfData.info || {};
    const metadata = pdfData.metadata || {};

    return {
      title: this.cleanMetadataValue(info.Title || metadata.title),
      author: this.cleanMetadataValue(info.Author || metadata.author),
      subject: this.cleanMetadataValue(info.Subject || metadata.subject),
      creator: this.cleanMetadataValue(info.Creator || metadata.creator),
      producer: this.cleanMetadataValue(info.Producer || metadata.producer),
      creationDate: this.formatPDFDate(info.CreationDate || metadata.creationDate),
      modificationDate: this.formatPDFDate(info.ModDate || metadata.modificationDate),
      format: this.cleanMetadataValue(info.Format || metadata.format),
      pages: pdfData.numpages || null,
      encrypted: info.IsEncrypted || false,
      linearized: info.IsLinearized || false,
      pdfVersion: this.cleanMetadataValue(info.PDFFormatVersion || metadata.pdfVersion)
    };
  }

  /**
   * Clean metadata value
   * @param {any} value - Raw metadata value
   * @returns {string|null} - Cleaned value
   */
  cleanMetadataValue(value) {
    if (value === undefined || value === null) {
      return null;
    }

    const stringValue = String(value).trim();
    return stringValue.length > 0 ? stringValue : null;
  }

  /**
   * Format PDF date string
   * @param {string} dateString - Raw PDF date
   * @returns {string|null} - Formatted date
   */
  formatPDFDate(dateString) {
    if (!dateString) return null;

    try {
      // PDF dates are often in format: D:YYYYMMDDHHmmSSOHH'mm'
      let cleanDate = dateString.toString().trim();
      
      // Remove D: prefix if present
      if (cleanDate.startsWith('D:')) {
        cleanDate = cleanDate.substring(2);
      }

      // Extract YYYYMMDDHHMMSS part
      const match = cleanDate.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
      if (match) {
        const [, year, month, day, hour, minute, second] = match;
        const date = new Date(
          parseInt(year),
          parseInt(month) - 1, // Month is 0-indexed
          parseInt(day),
          parseInt(hour),
          parseInt(minute),
          parseInt(second)
        );
        
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }

      // Try to parse as regular date
      const date = new Date(cleanDate);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }

      return cleanDate; // Return as-is if can't parse

    } catch (error) {
      return dateString; // Return original if parsing fails
    }
  }

  /**
   * Clean and normalize PDF text content
   * @param {string} text - Raw PDF text
   * @returns {string} - Cleaned text
   */
  cleanPDFText(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text
      // Normalize line breaks
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Remove excessive whitespace
      .replace(/[ \t]+/g, ' ')
      // Remove excessive line breaks (more than 2)
      .replace(/\n{3,}/g, '\n\n')
      // Remove leading/trailing whitespace from lines
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      // Remove leading/trailing whitespace from entire text
      .trim();
  }

  /**
   * Process multiple PDFs concurrently
   * @param {Array} sources - Array of PDF sources
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} - Array of processing results
   */
  async processMultiplePDFs(sources, options = {}) {
    const concurrency = options.concurrency || 3;
    const results = [];

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < sources.length; i += concurrency) {
      const batch = sources.slice(i, i + concurrency);
      const batchPromises = batch.map(source => {
        const params = typeof source === 'string' 
          ? { source, sourceType: 'url', options }
          : { ...source, options: { ...options, ...source.options } };
        
        return this.processPDF(params).catch(error => ({
          source: params.source,
          success: false,
          error: error.message,
          extractedAt: new Date().toISOString(),
          processingTime: 0,
          pageCount: 0
        }));
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Get text statistics from extracted content
   * @param {string} text - Extracted text
   * @returns {Object} - Text statistics
   */
  getTextStatistics(text) {
    if (!text || typeof text !== 'string') {
      return {
        characters: 0,
        charactersNoSpaces: 0,
        words: 0,
        sentences: 0,
        paragraphs: 0,
        lines: 0,
        averageWordsPerSentence: 0,
        averageCharactersPerWord: 0
      };
    }

    const characters = text.length;
    const charactersNoSpaces = text.replace(/\s/g, '').length;
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const sentences = text.split(/[.!?]+/).filter(sentence => sentence.trim().length > 0);
    const paragraphs = text.split(/\n\s*\n/).filter(paragraph => paragraph.trim().length > 0);
    const lines = text.split('\n').length;

    return {
      characters,
      charactersNoSpaces,
      words: words.length,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      lines,
      averageWordsPerSentence: sentences.length > 0 ? Math.round((words.length / sentences.length) * 100) / 100 : 0,
      averageCharactersPerWord: words.length > 0 ? Math.round((charactersNoSpaces / words.length) * 100) / 100 : 0
    };
  }

  /**
   * Extract specific pages from PDF
   * @param {Object} params - Processing parameters with page range
   * @returns {Promise<Object>} - Processing result for specified pages
   */
  async extractPDFPages(params) {
    const { startPage = 1, endPage, ...processingParams } = params;
    
    // Override parse options to limit page range
    const options = {
      ...processingParams.options,
      parseOptions: {
        ...processingParams.options?.parseOptions,
        max: endPage || processingParams.options?.maxPages || 100
      }
    };

    const result = await this.processPDF({
      ...processingParams,
      options
    });

    if (result.success && result.text && startPage > 1) {
      // This is a simplified approach - pdf-parse doesn't provide per-page text
      // For proper page-by-page extraction, consider using pdf2pic or pdf-poppler
      console.warn('Page-specific extraction is limited with current PDF parser');
    }

    return result;
  }
}

export default PDFProcessor;
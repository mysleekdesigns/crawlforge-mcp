/**
 * PDFProcessor - PDF document processing with text and metadata extraction
 * Handles PDF files from URLs or local paths with comprehensive error handling
 */

// Use dynamic import for pdf-parse to avoid initialization issues
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { safeFetch } from '../../utils/ssrfGuard.js';
import { config } from '../../constants/config.js';
import { identityHeaders } from '../../utils/fetchIdentity.js';

const PDFProcessorSchema = z.object({
  source: z.string().min(1),
  sourceType: z.enum(['url', 'file', 'buffer']).default('url'),
  options: z.object({
    extractMetadata: z.boolean().default(true),
    extractText: z.boolean().default(true),
    // Detect grid tables from the text layer (positioned text items).
    extractTables: z.boolean().default(false),
    maxPages: z.number().min(1).max(1000).default(100),
    // For decrypting password-protected PDFs (pdf-parse 2.x / pdfjs-dist honors this).
    password: z.string().optional(),
    // C3: true page-range extraction (1-based, inclusive). When set, only the
    // text from pages [start..end] is returned.
    pageRange: z.object({
      start: z.number().min(1).default(1),
      end: z.number().min(1).optional()
    }).optional(),
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
  tables: z.array(z.object({
    page: z.number(),
    rows: z.array(z.array(z.string()))
  })).optional(),
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

      // C3: page-range extraction (1-based, inclusive) — pdf-parse 2.x's
      // getText({ partial: [...] }) parses and returns exactly the requested
      // pages, so no manual per-page capture is needed here anymore.
      const pageRange = processingOptions.pageRange;

      // Dynamic import to avoid initialization issues
      const { PDFParse, PasswordException } = await import('pdf-parse');
      const parser = new PDFParse({
        data: pdfBuffer,
        ...(processingOptions.password ? { password: processingOptions.password } : {})
      });

      try {
        let info;
        try {
          info = await parser.getInfo();
        } catch (error) {
          if (error instanceof PasswordException) {
            result.error = `PDF parsing failed: password required or incorrect (${error.message})`;
          } else {
            result.error = `PDF parsing failed: ${error.message}`;
          }
          result.processingTime = Date.now() - startTime;
          return result;
        }

        const totalPages = info.total || 0;
        // pdf-parse 2.x has no equivalent of v1's disableCombineTextItems; only
        // normalizeWhitespace maps onto a v2 ParseParameters field (inverted).
        const disableNormalization = !processingOptions.parseOptions?.normalizeWhitespace;

        // Extract text content
        if (processingOptions.extractText) {
          if (pageRange) {
            const start = pageRange.start || 1;
            // C3: a start past the last page means the requested range
            // doesn't exist in this PDF — report that explicitly instead of
            // silently returning success:true with empty text.
            if (start > totalPages) {
              result.error = `Requested page range starts at page ${start}, but the PDF only has ${totalPages} page(s).`;
              result.processingTime = Date.now() - startTime;
              return result;
            }
            const end = Math.min(pageRange.end || processingOptions.maxPages, totalPages);
            const pageNumbers = [];
            for (let n = start; n <= end; n++) pageNumbers.push(n);

            const textResult = await parser.getText({ partial: pageNumbers, disableNormalization });
            const slice = textResult.pages.map(p => p.text);
            result.text = this.cleanPDFText(slice.join('\n\n'));
            result.extractedPages = { start, end, count: slice.length };
          } else {
            const textResult = await parser.getText({ first: processingOptions.maxPages, disableNormalization });
            result.text = this.cleanPDFText(textResult.pages.map(p => p.text).join('\n\n'));
          }
        }

        // Extract tables from the text layer. getInfo() above already loaded
        // the document, so pdf-parse's parser.doc (a plain property in the
        // compiled build) holds the pdfjs PDFDocumentProxy — reuse it instead
        // of parsing the buffer a second time.
        if (processingOptions.extractTables) {
          const tableStart = pageRange?.start || 1;
          const tableEnd = Math.min(pageRange?.end || processingOptions.maxPages, totalPages);
          result.tables = await this.extractTablesFromDocument(parser.doc, tableStart, tableEnd);
        }

        // Extract metadata
        if (processingOptions.extractMetadata) {
          result.metadata = this.extractPDFMetadata(info);
        }

        // Set page count
        result.pageCount = totalPages;

        // Calculate processing time
        result.processingTime = Date.now() - startTime;
        result.success = true;

        return result;
      } finally {
        await parser.destroy().catch(() => {});
      }

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
      // `timeout` is not a fetch init option — undici/Node fetch silently
      // ignores unknown properties, so only `signal` actually enforces a
      // deadline here.
      const response = await safeFetch(url, {
        headers: identityHeaders(),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('pdf')) {
        console.warn(`Warning: Content-Type is ${contentType}, expected PDF`);
      }

      return await this.readBodyWithSizeCap(response);

    } catch (error) {
      // AbortSignal.timeout() aborts with a TimeoutError-named DOMException
      // (not AbortError — that name is only used for a plain controller.abort()).
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new Error('Failed to download PDF from URL: request timeout after 30000ms');
      }
      throw new Error(`Failed to download PDF from URL: ${error.message}`);
    }
  }

  /**
   * Read a response body into a Buffer while enforcing config.fetch.maxBodySize
   * (Content-Length pre-check, then a streaming byte-count backstop for
   * servers that omit or lie about it), so a stalling or multi-GB response
   * can't hang the request indefinitely or OOM the process before pdf-parse's
   * own maxPages cap ever applies.
   * @param {Response} response
   * @returns {Promise<Buffer>}
   */
  async readBodyWithSizeCap(response) {
    const maxBodySize = config.fetch.maxBodySize;

    const contentLengthHeader = response.headers?.get?.('content-length') ?? null;
    if (contentLengthHeader !== null) {
      const declared = parseInt(contentLengthHeader, 10);
      if (!isNaN(declared) && declared > maxBodySize) {
        throw new Error(`PDF too large: Content-Length ${declared} exceeds limit of ${maxBodySize} bytes`);
      }
    }

    if (!response.body || typeof response.body.getReader !== 'function') {
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBodySize) {
        reader.cancel();
        throw new Error(`PDF too large: exceeded limit of ${maxBodySize} bytes`);
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks, totalBytes);
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
   * @param {Object} infoResult - InfoResult from pdf-parse's PDFParse#getInfo()
   * @returns {Object} - Formatted metadata
   */
  extractPDFMetadata(infoResult) {
    const info = infoResult.info || {};
    const metadata = infoResult.metadata || {};

    return {
      title: this.cleanMetadataValue(info.Title || metadata.title),
      author: this.cleanMetadataValue(info.Author || metadata.author),
      subject: this.cleanMetadataValue(info.Subject || metadata.subject),
      creator: this.cleanMetadataValue(info.Creator || metadata.creator),
      producer: this.cleanMetadataValue(info.Producer || metadata.producer),
      creationDate: this.formatPDFDate(info.CreationDate || metadata.creationDate),
      modificationDate: this.formatPDFDate(info.ModDate || metadata.modificationDate),
      format: this.cleanMetadataValue(info.Format || metadata.format),
      pages: infoResult.total || null,
      // pdfjs-dist's Info dictionary has no `IsEncrypted` flag; it reports the
      // security filter name (e.g. "Standard") when the doc is encrypted, null otherwise.
      encrypted: !!info.EncryptFilterName,
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
   * Extract tables from a loaded pdfjs document's text layer.
   * Walks the requested pages (1-based, inclusive), reads positioned text
   * items via getTextContent(), and runs layout-based table detection on each.
   * @param {Object} doc - pdfjs PDFDocumentProxy (pdf-parse's parser.doc)
   * @param {number} startPage - First page to scan
   * @param {number} endPage - Last page to scan
   * @returns {Promise<Array>} - Detected tables as {page, rows: [[cell, ...], ...]}
   */
  async extractTablesFromDocument(doc, startPage, endPage) {
    const tables = [];
    const last = Math.min(endPage, doc.numPages);
    for (let pageNum = Math.max(1, startPage); pageNum <= last; pageNum++) {
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();
      tables.push(...this.detectTablesFromTextItems(textContent.items, pageNum));
    }
    return tables;
  }

  /**
   * Detect grid tables in one page's positioned text items (pdfjs
   * getTextContent() shape: {str, transform, width, height}; transform[4]/[5]
   * carry x/y). Pure layout analysis:
   *   1. cluster items into rows by y proximity (sub/superscripts sit ~0.35em
   *      off the baseline, so they fold into their base row),
   *   2. split each row into cell segments wherever the x-gap exceeds a
   *      threshold well above word spacing,
   *   3. take runs of >= 3 consecutive multi-cell rows and derive column
   *      boundaries from x-regions that almost no row's text crosses.
   * Ordinary paragraphs yield single-segment rows (word gaps stay under the
   * threshold), so they never form a run; coincidental misaligned gaps leave
   * no shared low-coverage x-region, so no columns emerge.
   * @param {Array} items - pdfjs text items for one page
   * @param {number} pageNumber - 1-based page number for the emitted tables
   * @returns {Array} - Tables as {page, rows: [[cell, ...], ...]}
   */
  detectTablesFromTextItems(items, pageNumber) {
    const texts = (items || [])
      .filter(item => item.str && item.str.trim().length > 0 && Array.isArray(item.transform))
      .map(item => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width || 0,
        height: item.height || 10
      }));
    if (texts.length === 0) {
      return [];
    }

    const heights = texts.map(t => t.height).sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || 10;
    const yTolerance = Math.max(2, medianHeight * 0.4);
    const gapThreshold = Math.max(3, medianHeight * 0.5);

    // 1. Cluster items into rows, top to bottom.
    texts.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    let currentRow = null;
    let previousY;
    for (const t of texts) {
      if (currentRow && previousY - t.y <= yTolerance) {
        currentRow.items.push(t);
      } else {
        currentRow = { y: t.y, items: [t] };
        rows.push(currentRow);
      }
      previousY = t.y;
    }

    // 2. Split each row into cell segments on x-gaps. PDF text items are often
    // fragments ("1", ".", "4", "·", "10"), so fragments closer than the gap
    // threshold join one segment, with a space when they don't visually touch.
    const spaceGap = medianHeight * 0.12;
    const segmentedRows = rows.map(row => {
      const sorted = [...row.items].sort((a, b) => a.x - b.x);
      const segments = [];
      let segment = null;
      for (const t of sorted) {
        if (segment && t.x - segment.xEnd < gapThreshold) {
          if (t.x - segment.xEnd > spaceGap) {
            segment.text += ' ';
          }
          segment.text += t.str;
          segment.xEnd = Math.max(segment.xEnd, t.x + t.width);
        } else {
          segment = { xStart: t.x, xEnd: t.x + t.width, text: t.str };
          segments.push(segment);
        }
      }
      return { y: row.y, segments };
    });

    // 3. Collect runs of consecutive multi-cell rows with table-like spacing.
    const maxRowGap = medianHeight * 2.5;
    const runs = [];
    let run = null;
    for (const row of segmentedRows) {
      if (row.segments.length >= 2) {
        const previous = run && run[run.length - 1];
        if (previous && previous.y - row.y <= maxRowGap) {
          run.push(row);
        } else {
          run = [row];
          runs.push(run);
        }
      } else {
        run = null;
      }
    }

    const tables = [];
    for (const runRows of runs) {
      if (runRows.length < 3) {
        continue;
      }
      const tableRows = this.buildTableFromRun(runRows, gapThreshold);
      if (tableRows) {
        tables.push({ page: pageNumber, rows: tableRows });
      }
    }
    return tables;
  }

  /**
   * Turn a run of multi-cell rows into a rows-of-cells grid, or null when the
   * rows don't align into at least two shared columns.
   * Column separators are x-regions at least gapThreshold wide that at most
   * ~20% of the rows' text crosses — a lone spanning header can't merge two
   * otherwise-separate columns, while misaligned prose yields no separator at
   * all (the genuine-alignment requirement).
   * @param {Array} runRows - Rows of {y, segments: [{xStart, xEnd, text}]}
   * @param {number} gapThreshold - Minimum column-separator width
   * @returns {Array|null} - Rows as arrays of cell strings, or null
   */
  buildTableFromRun(runRows, gapThreshold) {
    // Sweep segment x-extents to find low-coverage separator regions.
    const events = [];
    for (const row of runRows) {
      for (const segment of row.segments) {
        events.push({ x: segment.xStart, delta: 1 });
        events.push({ x: segment.xEnd, delta: -1 });
      }
    }
    events.sort((a, b) => a.x - b.x);

    const maxBridgingRows = Math.floor(runRows.length * 0.2);
    const separators = [];
    let coverage = 0;
    let openStart = null;
    let i = 0;
    while (i < events.length) {
      const x = events[i].x;
      while (i < events.length && events[i].x === x) {
        coverage += events[i].delta;
        i++;
      }
      if (coverage <= maxBridgingRows) {
        if (openStart === null) {
          openStart = x;
        }
      } else {
        if (openStart !== null && x - openStart >= gapThreshold) {
          separators.push((openStart + x) / 2);
        }
        openStart = null;
      }
    }
    // A trailing open region past the last segment lies outside the table.

    if (separators.length === 0) {
      return null;
    }

    return runRows.map(row => {
      const cells = new Array(separators.length + 1).fill('');
      for (const segment of row.segments) {
        const center = (segment.xStart + segment.xEnd) / 2;
        let col = 0;
        while (col < separators.length && center > separators[col]) {
          col++;
        }
        cells[col] = cells[col] ? `${cells[col]} ${segment.text}` : segment.text;
      }
      return cells.map(cell => cell.trim());
    });
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
   * Render a single PDF page to text and record it.
   * Mirrors pdf-parse's default render (newline on Y-position change) but
   * accumulates per-page text so callers can slice a true page range.
   * Note: like pdf-parse, this does not reconstruct multi-column / table
   * layout — column order follows the PDF's text-item stream.
   * @param {Object} pageData - pdf.js page proxy from pdf-parse
   * @param {string[]} sink - array that receives this page's text
   * @returns {Promise<string>}
   */
  async _renderPage(pageData, sink) {
    const textContent = await pageData.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false
    });
    let lastY;
    let text = '';
    for (const item of textContent.items) {
      if (lastY === item.transform[5] || lastY === undefined) {
        text += item.str;
      } else {
        text += '\n' + item.str;
      }
      lastY = item.transform[5];
    }
    sink.push(text);
    // pdf-parse joins page renders with '\n\n' for pdfData.text
    return text;
  }

  /**
   * Extract a specific page range from a PDF (1-based, inclusive).
   * @param {Object} params - Processing parameters
   * @param {number} [params.startPage=1] - First page to include
   * @param {number} [params.endPage] - Last page to include (defaults to end)
   * @returns {Promise<Object>} - Processing result for the requested pages
   */
  async extractPDFPages(params) {
    const { startPage = 1, endPage, ...processingParams } = params;

    return this.processPDF({
      ...processingParams,
      options: {
        ...processingParams.options,
        pageRange: { start: startPage, ...(endPage ? { end: endPage } : {}) }
      }
    });
  }
}

export default PDFProcessor;
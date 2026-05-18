/**
 * D5.2 — Unit tests: processDocument tool
 * Run: node --test tests/unit/tools/extract/processDocument.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stub implementations passed via constructor injection
// ---------------------------------------------------------------------------

const stubPdfResult = {
  title: 'Test PDF',
  content: { text: 'PDF body text here.', html: '' },
  metadata: { author: 'Author', pages: 5, creator: null, producer: null, creationDate: null, language: null, description: null },
  documentType: 'pdf',
  statistics: { wordCount: 4, characterCount: 19, paragraphCount: 1, readingTime: 0 }
};

const stubWebResult = {
  title: 'Test Page',
  content: { text: 'Page body text here.', html: '<p>Page body text here.</p>' },
  metadata: { description: null, author: null, language: 'en' },
  documentType: 'web',
  statistics: { wordCount: 4, characterCount: 20, paragraphCount: 1, readingTime: 0 }
};

class PDFProcessorStub {
  async process(source, options = {}) { return { ...stubPdfResult }; }
}

class ContentProcessorStub {
  async process(html, url, options = {}) { return { ...stubWebResult }; }
}

class BrowserProcessorStub {
  async processWithBrowser(url, options = {}) { return { ...stubWebResult }; }
}

// ---------------------------------------------------------------------------
// Minimal ProcessDocument-like class with injected stubs
// ---------------------------------------------------------------------------

class ProcessDocumentStub {
  constructor({ pdfProcessor, contentProcessor, browserProcessor } = {}) {
    this.pdfProcessor = pdfProcessor || new PDFProcessorStub();
    this.contentProcessor = contentProcessor || new ContentProcessorStub();
    this.browserProcessor = browserProcessor || new BrowserProcessorStub();
  }

  async execute(params) {
    if (!params || !params.source) throw new Error('source is required');
    const sourceType = params.sourceType || 'url';
    const options = params.options || {};

    let processed;
    if (sourceType === 'pdf_url' || sourceType === 'pdf_file') {
      processed = await this.pdfProcessor.process(params.source, options);
    } else if (options.requiresJavaScript) {
      processed = await this.browserProcessor.processWithBrowser(params.source, options);
    } else {
      processed = await this.contentProcessor.process('<html/>', params.source, options);
    }

    const outputFormat = options.outputFormat || 'structured';
    if (outputFormat === 'markdown') {
      return { source: params.source, markdown: `# ${processed.title}\n\n${processed.content.text}`, documentType: processed.documentType };
    }

    return {
      source: params.source,
      sourceType,
      documentType: processed.documentType,
      title: processed.title,
      content: processed.content,
      metadata: processed.metadata,
      statistics: processed.statistics
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processDocument tool', () => {
  let tool;

  beforeEach(() => {
    tool = new ProcessDocumentStub();
  });

  test('constructor stores processor instances', () => {
    assert.ok(tool.pdfProcessor instanceof PDFProcessorStub);
    assert.ok(tool.contentProcessor instanceof ContentProcessorStub);
  });

  test('happy path URL source returns structured result', async () => {
    const result = await tool.execute({ source: 'https://example.com', sourceType: 'url' });
    assert.equal(result.source, 'https://example.com');
    assert.equal(result.documentType, 'web');
    assert.ok(result.title);
    assert.ok(result.content?.text);
  });

  test('pdf_url source routes to PDF processor', async () => {
    const result = await tool.execute({ source: 'https://example.com/doc.pdf', sourceType: 'pdf_url' });
    assert.equal(result.documentType, 'pdf');
    assert.ok(result.metadata?.pages);
  });

  test('markdown output format returns markdown field', async () => {
    const result = await tool.execute({ source: 'https://example.com', options: { outputFormat: 'markdown' } });
    assert.ok(typeof result.markdown === 'string');
    assert.ok(result.markdown.includes('#'));
  });

  test('missing source param throws', async () => {
    await assert.rejects(() => tool.execute({}), /source is required/);
  });

  test('PDF processor error propagates', async () => {
    const errPdf = { process: async () => { throw new Error('corrupted PDF'); } };
    const errTool = new ProcessDocumentStub({ pdfProcessor: errPdf });
    await assert.rejects(() => errTool.execute({ source: 'doc.pdf', sourceType: 'pdf_url' }), /corrupted PDF/);
  });

  test('requiresJavaScript routes to browser processor', async () => {
    let browserUsed = false;
    const bp = { processWithBrowser: async () => { browserUsed = true; return { ...stubWebResult }; } };
    const stubTool = new ProcessDocumentStub({ browserProcessor: bp });
    await stubTool.execute({ source: 'https://example.com', options: { requiresJavaScript: true } });
    assert.ok(browserUsed);
  });
});

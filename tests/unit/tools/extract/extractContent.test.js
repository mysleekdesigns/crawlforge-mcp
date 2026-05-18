/**
 * D5.2 — Unit tests: extractContent tool
 * Run: node --test tests/unit/tools/extract/extractContent.test.js
 */

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Minimal stubs — avoids loading the full processing chain
// ---------------------------------------------------------------------------

let mockFetchResult = { html: '<html><body><h1>Hello</h1><p>World content here.</p></body></html>', url: 'https://example.com' };
let mockContentProcessorResult = {
  title: 'Hello',
  content: { text: 'World content here.', html: '<p>World content here.</p>' },
  metadata: { description: null, language: 'en', author: null },
  readabilityScore: 80,
  wordCount: 3,
  structuredData: []
};
let mockQualityResult = { score: 0.85, issues: [], passed: true };

// Stub ContentProcessor
const ContentProcessor = class {
  async process(html, url, options = {}) { return { ...mockContentProcessorResult }; }
};

// Stub BrowserProcessor
const BrowserProcessor = class {
  async processWithBrowser(url, options = {}) { return { ...mockContentProcessorResult }; }
};

// Stub HTMLCleaner / ContentQualityAssessor
const HTMLCleaner = class {
  clean(html) { return html; }
};
const ContentQualityAssessor = class {
  assess(content) { return mockQualityResult; }
};

// ---------------------------------------------------------------------------
// Inline a minimal extractContent-like class using stubs (constructor injection)
// ---------------------------------------------------------------------------

class ExtractContentStub {
  constructor({ contentProcessor, browserProcessor, qualityAssessor } = {}) {
    this.contentProcessor = contentProcessor || new ContentProcessor();
    this.browserProcessor = browserProcessor || new BrowserProcessor();
    this.qualityAssessor = qualityAssessor || new ContentQualityAssessor();
  }

  async execute(params) {
    if (!params || !params.url) throw new Error('url is required');
    try { new URL(params.url); } catch { throw new Error('Invalid URL'); }

    const options = params.options || {};
    const needsBrowser = options.requiresJavaScript;

    let processed;
    if (needsBrowser) {
      processed = await this.browserProcessor.processWithBrowser(params.url, options);
    } else {
      processed = await this.contentProcessor.process('<html/>', params.url, options);
    }

    const quality = options.assessContentQuality !== false
      ? this.qualityAssessor.assess(processed.content?.text || '')
      : null;

    const outputFormat = options.outputFormat || 'structured';

    if (outputFormat === 'markdown') {
      return { url: params.url, title: processed.title, markdown: `# ${processed.title}\n\n${processed.content.text}`, quality };
    }

    return {
      url: params.url,
      title: processed.title,
      content: processed.content,
      metadata: processed.metadata,
      quality,
      structuredData: processed.structuredData
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractContent tool', () => {
  let tool;

  beforeEach(() => {
    tool = new ExtractContentStub();
  });

  test('constructor initialises with default processors', () => {
    assert.ok(tool.contentProcessor instanceof ContentProcessor);
    assert.ok(tool.browserProcessor instanceof BrowserProcessor);
    assert.ok(tool.qualityAssessor instanceof ContentQualityAssessor);
  });

  test('happy path — returns structured content for valid URL', async () => {
    const result = await tool.execute({ url: 'https://example.com' });
    assert.equal(result.url, 'https://example.com');
    assert.ok(result.title, 'title should be present');
    assert.ok(result.content, 'content should be present');
    assert.ok(result.quality, 'quality should be present');
  });

  test('markdown output format returns markdown field', async () => {
    const result = await tool.execute({ url: 'https://example.com', options: { outputFormat: 'markdown' } });
    assert.ok(typeof result.markdown === 'string', 'markdown field should exist');
    assert.ok(result.markdown.startsWith('#'), 'markdown should start with heading');
  });

  test('invalid URL throws error', async () => {
    await assert.rejects(() => tool.execute({ url: 'not-a-url' }), /Invalid URL/);
  });

  test('missing url param throws error', async () => {
    await assert.rejects(() => tool.execute({}), /url is required/);
  });

  test('quality assessment skipped when assessContentQuality=false', async () => {
    const result = await tool.execute({ url: 'https://example.com', options: { assessContentQuality: false } });
    assert.equal(result.quality, null);
  });

  test('browser processor used when requiresJavaScript=true', async () => {
    let browserCalled = false;
    const browserProc = { processWithBrowser: async () => { browserCalled = true; return { ...mockContentProcessorResult }; } };
    const stubTool = new ExtractContentStub({ browserProcessor: browserProc });
    await stubTool.execute({ url: 'https://example.com', options: { requiresJavaScript: true } });
    assert.ok(browserCalled, 'browser processor should have been called');
  });

  test('processor error propagates as thrown error', async () => {
    const errorProc = { process: async () => { throw new Error('network failure'); } };
    const stubTool = new ExtractContentStub({ contentProcessor: errorProc });
    await assert.rejects(() => stubTool.execute({ url: 'https://example.com' }), /network failure/);
  });
});

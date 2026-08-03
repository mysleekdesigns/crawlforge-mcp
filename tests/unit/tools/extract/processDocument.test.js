/**
 * Unit tests: processDocument tool (real module — src/tools/extract/processDocument.js)
 * Run: node --test tests/unit/tools/extract/processDocument.test.js
 *
 * Coverage strategy (no live network, no real PDF fixture parsing):
 *  - sourceType 'url'  -> local HTTP server on 127.0.0.1, allowlisted via
 *    ALLOWED_DOMAINS (set before the SSRF-guarded modules are first imported,
 *    since config.js reads it once at import time).
 *  - sourceType 'file' -> real fs.readFile against temp files in $TMPDIR.
 *  - sourceType 'pdf_file' -> PDFProcessor dynamically `import()`s the
 *    'pdf-parse' package at call time; that CJS module is swapped for a fake
 *    in Node's require cache before the dynamic import runs. This exercises
 *    100% real ProcessDocumentTool/PDFProcessor logic (fs read, Zod
 *    validation, page-range slicing, error construction) — only pdf-parse's
 *    own byte-level PDF-format parsing (unrelated to the bug under test) is
 *    replaced, since pdf-parse's bundled legacy pdf.js requires byte-exact
 *    xref tables that aren't worth hand-rolling for a unit test.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

process.env.ALLOWED_DOMAINS = 'localhost';
const { ProcessDocumentTool } = await import('../../../../src/tools/extract/processDocument.js');

// ---------------------------------------------------------------------------
// Local fixture server for sourceType 'url'
// ---------------------------------------------------------------------------

const PAGES = {
  '/article': '<html><head><title>Server Article</title></head><body><article><h1>Server Article</h1><p>' +
    'Content served from a local fixture server, exercised through the real fetch + ContentProcessor pipeline. '.repeat(6) +
    '</p></article></body></html>'
};

let server;
let baseUrl;
let tmpDir;

before(async () => {
  server = http.createServer((req, res) => {
    const html = PAGES[req.url.split('?')[0]];
    if (!html) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://localhost:${server.address().port}`;

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-processDocument-'));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('processDocument tool (real module) — sourceType url', () => {
  test('happy path — fetches and processes a real HTML page via safeFetch', async () => {
    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: `${baseUrl}/article` });
    assert.equal(result.success, true);
    assert.equal(result.documentType, 'web');
    assert.equal(result.title, 'Server Article');
    assert.ok(result.content.text.includes('Content served from a local fixture server'));
  });

  test('markdown output format returns a markdown field', async () => {
    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: `${baseUrl}/article`, options: { outputFormat: 'markdown' } });
    assert.equal(result.success, true);
    assert.equal(typeof result.content.markdown, 'string');
  });

  test('404 response returns a structured failure', async () => {
    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: `${baseUrl}/missing` });
    assert.equal(result.success, false);
    assert.match(result.error, /404/);
  });

  test('missing source param returns a structured failure (not a thrown error)', async () => {
    const tool = new ProcessDocumentTool();
    const result = await tool.execute({});
    assert.equal(result.success, false);
    assert.match(result.error, /Document processing failed/);
  });

  // Reproduction test for the shouldUseJavaScript fix: a bare document anchor
  // (e.g. "#install" on a plain docs page) used to unconditionally trigger
  // browser rendering. It's now stripped before matching, and the app/spa/
  // dashboard/admin indicators are anchored to full path segments.
  test('shouldUseJavaScript ignores a bare document anchor but matches /app/ path segments', async () => {
    const tool = new ProcessDocumentTool();
    assert.equal(await tool.shouldUseJavaScript(`${baseUrl}/docs#install`), false);
    assert.equal(await tool.shouldUseJavaScript(`${baseUrl}/app/dashboard`), true);
    assert.equal(await tool.shouldUseJavaScript(`${baseUrl}/apple-page`), false);
  });
});

describe('processDocument tool (real module) — sourceType file (local disk, no network)', () => {
  test('reads a local plain-text file and returns its content', async () => {
    const filePath = path.join(tmpDir, 'sample.txt');
    await fs.writeFile(filePath, 'Hello from a local text file.\nSecond line of content here.\n');

    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: filePath, sourceType: 'file' });

    assert.equal(result.success, true);
    assert.equal(result.documentType, 'file');
    assert.ok(result.content.text.includes('Hello from a local text file.'));
  });

  test('reads a local HTML file and extracts its <title>', async () => {
    const filePath = path.join(tmpDir, 'sample.html');
    await fs.writeFile(filePath, '<html><head><title>Local HTML Title</title></head><body><p>Local body text.</p></body></html>');

    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: filePath, sourceType: 'file' });

    assert.equal(result.success, true);
    assert.equal(result.title, 'Local HTML Title');
    assert.ok(result.content.text.includes('Local body text.'));
  });

  test('nonexistent local file returns a structured failure', async () => {
    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: path.join(tmpDir, 'does-not-exist.txt'), sourceType: 'file' });
    assert.equal(result.success, false);
    assert.match(result.error, /Failed to read local file/);
  });
});

describe('processDocument tool (real module) — sourceType pdf_file (fake pdf-parse output)', () => {
  let pdfPath;
  const require = createRequire(import.meta.url);
  const pdfParseResolved = require.resolve('pdf-parse');
  const originalCacheEntry = require.cache[pdfParseResolved];

  // A dynamic `import('pdf-parse')` is only resolved through Node's ESM/CJS
  // interop once per process — the resulting synthetic module (and its
  // `default` binding) is then cached for the specifier regardless of later
  // require.cache reassignments. So the fake export installed below must be
  // a single stable function whose *behavior* tests reconfigure via a
  // closure variable, not a function tests replace outright.
  let currentFixture = { pageTexts: [], info: {}, metadata: {} };
  function stubPdfParse(pageTexts, { info = {}, metadata = {} } = {}) {
    currentFixture = { pageTexts, info, metadata };
  }

  before(async () => {
    const fakeFn = async (_buffer, options) => {
      const { pageTexts, info, metadata } = currentFixture;
      if (typeof options?.pagerender === 'function') {
        for (const text of pageTexts) {
          await options.pagerender({
            getTextContent: async () => ({ items: [{ str: text, transform: [1, 0, 0, 1, 0, 700] }] })
          });
        }
      }
      return { text: pageTexts.join('\n\n'), numpages: pageTexts.length, info, metadata };
    };
    require.cache[pdfParseResolved] = { id: pdfParseResolved, filename: pdfParseResolved, loaded: true, exports: fakeFn };
    // Prime the dynamic-import cache with this fake before any test runs.
    await import('pdf-parse');

    pdfPath = path.join(tmpDir, 'fake.pdf');
    await fs.writeFile(pdfPath, Buffer.from('%PDF-1.4 placeholder — content is irrelevant, pdf-parse is stubbed'));
  });

  after(() => {
    if (originalCacheEntry) require.cache[pdfParseResolved] = originalCacheEntry;
    else delete require.cache[pdfParseResolved];
  });

  // Reproduction test for the C3 page-range fix: requesting a pageRange.start
  // beyond the PDF's actual page count used to silently return success:true
  // with empty text (start > capturedPages.length was never checked). It now
  // reports an explicit, actionable error.
  test('PDF pageRange.start past the last page reports an explicit error (not silent success)', async () => {
    stubPdfParse(['Page one text content.', 'Page two text content.']);
    const tool = new ProcessDocumentTool();
    const result = await tool.execute({
      source: pdfPath,
      sourceType: 'pdf_file',
      options: { pageRange: { start: 5 } }
    });

    assert.equal(result.success, false);
    assert.match(result.error, /Requested page range starts at page 5, but the PDF only has 2 page\(s\)/);
  });

  test('PDF pageRange within bounds returns only the requested pages', async () => {
    stubPdfParse(['Page one.', 'Page two.', 'Page three.', 'Page four.']);
    const tool = new ProcessDocumentTool();
    const result = await tool.execute({
      source: pdfPath,
      sourceType: 'pdf_file',
      options: { pageRange: { start: 2, end: 3 } }
    });

    assert.equal(result.success, true);
    assert.equal(result.documentType, 'pdf');
    assert.ok(result.content.text.includes('Page two.'));
    assert.ok(result.content.text.includes('Page three.'));
    assert.ok(!result.content.text.includes('Page one.'));
    assert.ok(!result.content.text.includes('Page four.'));
  });

  test('PDF metadata (title, page count) is surfaced on the result', async () => {
    stubPdfParse(['Solo page.'], { info: { Title: 'My Fake PDF', Author: 'Test Author' } });
    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: pdfPath, sourceType: 'pdf_file' });

    assert.equal(result.success, true);
    assert.equal(result.title, 'My Fake PDF');
    assert.equal(result.metadata.author, 'Test Author');
    assert.equal(result.metadata.pages, 1);
  });
});

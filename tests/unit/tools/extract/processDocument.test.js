/**
 * Unit tests: processDocument tool (real module — src/tools/extract/processDocument.js)
 * Run: node --test tests/unit/tools/extract/processDocument.test.js
 *
 * Coverage strategy (no live network):
 *  - sourceType 'url'  -> local HTTP server on 127.0.0.1, allowlisted via
 *    ALLOWED_DOMAINS (set before the SSRF-guarded modules are first imported,
 *    since config.js reads it once at import time).
 *  - sourceType 'file' -> real fs.readFile against temp files in $TMPDIR.
 *  - sourceType 'pdf_file' -> pdf-parse 2.x (PDFParse class, backed by
 *    pdfjs-dist) is a true ESM package, so the old v1-era trick of swapping
 *    a fake function into Node's CJS require.cache no longer intercepts the
 *    dynamic `import('pdf-parse')` in PDFProcessor.js. Real, byte-valid PDF
 *    fixtures are hand-built instead (tests/fixtures/pdfBuilder.js) and
 *    parsed by the real library end-to-end — this exercises genuine
 *    pdf-parse behavior (including password decryption) rather than a stub.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildPdf, buildEncryptedPdf } from '../../../fixtures/pdfBuilder.js';

process.env.ALLOWED_DOMAINS = 'localhost';
const { ProcessDocumentTool } = await import('../../../../src/tools/extract/processDocument.js');

// ---------------------------------------------------------------------------
// Local fixture server for sourceType 'url'
// ---------------------------------------------------------------------------

const PAGES = {
  '/article': '<html><head><title>Server Article</title></head><body><article><h1>Server Article</h1><p>' +
    'Content served from a local fixture server, exercised through the real fetch + ContentProcessor pipeline. '.repeat(6) +
    '</p></article></body></html>',
  '/prose': '<html><head><title>Prose</title></head><body><article><h1>Prose</h1><p>' +
    'Comprehensive documentation facilitates extraordinary collaboration between independent engineering organizations. '.repeat(5) +
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

describe('processDocument tool (real module) — sourceType pdf_file (real PDF fixtures)', () => {
  // Reproduction test for the C3 page-range fix: requesting a pageRange.start
  // beyond the PDF's actual page count used to silently return success:true
  // with empty text (start > capturedPages.length was never checked). It now
  // reports an explicit, actionable error.
  test('PDF pageRange.start past the last page reports an explicit error (not silent success)', async () => {
    const pdfPath = path.join(tmpDir, 'two-page.pdf');
    await fs.writeFile(pdfPath, buildPdf({ pages: ['Page one text content.', 'Page two text content.'] }));

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
    const pdfPath = path.join(tmpDir, 'four-page.pdf');
    await fs.writeFile(pdfPath, buildPdf({ pages: ['Page one.', 'Page two.', 'Page three.', 'Page four.'] }));

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
    const pdfPath = path.join(tmpDir, 'solo-page.pdf');
    await fs.writeFile(pdfPath, buildPdf({ pages: ['Solo page.'], info: { Title: 'My Fake PDF', Author: 'Test Author' } }));

    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: pdfPath, sourceType: 'pdf_file' });

    assert.equal(result.success, true);
    assert.equal(result.title, 'My Fake PDF');
    assert.equal(result.metadata.author, 'Test Author');
    assert.equal(result.metadata.pages, 1);
  });

  // Phase 5 port note: pdf-parse 2.x actually honors a `password` option now
  // (v1 never read it — see plan/phase-2-correctness.md, which dropped the
  // option as a no-op). PDFProcessor.processPDF() supports it directly (see
  // tests/unit/core/processing/PDFProcessor.test.js for decryption coverage);
  // ProcessDocumentSchema/processPDFDocument() do not forward a `password`
  // option to PDFProcessor at all, so process_document has no way to supply
  // one yet — only the no-password failure path is testable at this level.
  test('encrypted PDF without a password reports a structured failure (not a thrown error)', async () => {
    const pdfPath = path.join(tmpDir, 'encrypted-no-pw.pdf');
    await fs.writeFile(pdfPath, buildEncryptedPdf({ pages: ['Secret content.'], userPassword: 'hunter2' }));

    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: pdfPath, sourceType: 'pdf_file' });

    assert.equal(result.success, false);
    assert.match(result.error, /password/i);
  });
});

// ---------------------------------------------------------------------------
// Phase 5.1 — one readability score per response.
//
// A response used to carry two contradictory Flesch scores: `readabilityScore`
// came from a per-path implementation (a char-count syllable proxy clamped to
// [0,100] on the PDF path, ContentProcessor's own copy on the web/file path)
// while `qualityAssessment.metrics.readability` came from
// ContentQualityAssessor. The live W-9 read 100 "Very Easy" against 54.75
// "Fairly Difficult". Both fields now come from the same implementation.
// ---------------------------------------------------------------------------

describe('processDocument tool (real module) — readability is reported once', () => {
  // Prose with polysyllabic words, so a syllable-based Flesch score and the
  // old character-proxy score cannot coincide by accident.
  const PROSE = 'Comprehensive documentation facilitates extraordinary collaboration between ' +
    'independent engineering organizations. Sophisticated infrastructure necessitates continuous ' +
    'verification. Readability approximations occasionally disagree with each other.';

  function assertAgrees(result) {
    const rs = result.readabilityScore;
    const qa = result.qualityAssessment?.metrics?.readability;
    assert.ok(rs, 'readabilityScore must be present');
    assert.ok(qa, 'qualityAssessment.metrics.readability must be present');
    assert.equal(rs.score, qa.score, `readabilityScore.score (${rs.score}) must equal qualityAssessment score (${qa.score})`);
    assert.equal(rs.level, qa.level, `readabilityScore.level (${rs.level}) must equal qualityAssessment level (${qa.level})`);
  }

  // Conforms to the declared ProcessDocumentResult shape:
  // { score: number, level: string, metrics: record }.
  function assertDeclaredShape(result) {
    const rs = result.readabilityScore;
    assert.equal(typeof rs.score, 'number', 'readabilityScore.score must be a number');
    assert.equal(typeof rs.level, 'string', 'readabilityScore.level must be a string');
    assert.ok(rs.metrics && typeof rs.metrics === 'object', 'readabilityScore.metrics must be an object');
  }

  test('web path (sourceType url) reports one score in the declared shape', async () => {
    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: `${baseUrl}/prose` });
    assert.equal(result.success, true);
    assertDeclaredShape(result);
    assertAgrees(result);
  });

  test('local file path (sourceType file) reports one score in the declared shape', async () => {
    const filePath = path.join(tmpDir, 'prose.txt');
    await fs.writeFile(filePath, PROSE);

    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: filePath, sourceType: 'file' });
    assert.equal(result.success, true);
    assertDeclaredShape(result);
    assertAgrees(result);
  });

  test('PDF path (sourceType pdf_file) reports one score in the declared shape', async () => {
    const pdfPath = path.join(tmpDir, 'prose.pdf');
    await fs.writeFile(pdfPath, buildPdf({ pages: [PROSE] }));

    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: pdfPath, sourceType: 'pdf_file' });
    assert.equal(result.success, true);
    assertDeclaredShape(result);
    assertAgrees(result);
  });

  // Flesch is unbounded and the surviving implementation deliberately does not
  // clamp: the old PDF-path implementation clamped to [0,100], which is what
  // pinned the W-9 at exactly 100 "Very Easy" while the other field read 54.75.
  test('score is not clamped to 100 for very simple text', async () => {
    const filePath = path.join(tmpDir, 'simple.txt');
    await fs.writeFile(filePath, 'The cat sat. The dog ran. I ate a pie. The sun is hot. We go now.');

    const tool = new ProcessDocumentTool();
    const result = await tool.execute({ source: filePath, sourceType: 'file' });

    assert.equal(result.success, true);
    assert.ok(result.readabilityScore.score > 100, `expected an unclamped score above 100, got ${result.readabilityScore.score}`);
    assertAgrees(result);
  });
});

/**
 * Unit tests: PDFProcessor (real module — src/core/processing/PDFProcessor.js)
 * Run: node --test tests/unit/core/processing/PDFProcessor.test.js
 *
 * Phase 5 dependency port: pdf-parse 1.1.x (callback API) -> 2.4.5
 * (class-based PDFParse API). Real, byte-valid PDF fixtures are hand-built
 * (tests/fixtures/pdfBuilder.js) and parsed by the real library end-to-end —
 * no stubbing — since pdf-parse 2.x is a true ESM package and a CJS
 * require.cache swap (the old v1-era trick) no longer intercepts the dynamic
 * `import('pdf-parse')` in PDFProcessor.js.
 *
 * Covers the two behaviors the port is responsible for preserving/fixing:
 *  - C3 true page-range extraction (start/end, open-ended, out-of-range error)
 *  - the `password` option, previously a no-op dropped in Phase 2
 *    (plan/phase-2-correctness.md) because pdf-parse 1.1.4 never read it —
 *    pdf-parse 2.x's PDFParse class genuinely supports decryption.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PDFProcessor } from '../../../../src/core/processing/PDFProcessor.js';
import { buildPdf, buildEncryptedPdf } from '../../../fixtures/pdfBuilder.js';

let tmpDir;
let processor;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-pdfprocessor-'));
  processor = new PDFProcessor();
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('PDFProcessor — multi-page text + metadata extraction', () => {
  test('extracts text from every page and reports correct metadata', async () => {
    const pdfPath = path.join(tmpDir, 'multi.pdf');
    await fs.writeFile(pdfPath, buildPdf({
      pages: ['Page one text content.', 'Page two text content.', 'Page three text content.', 'Page four text content.', 'Page five text content.'],
      info: { Title: 'Multi Page PDF', Author: 'Fixture Author' }
    }));

    const result = await processor.processPDF({ source: pdfPath, sourceType: 'file' });

    assert.equal(result.success, true);
    assert.equal(result.pageCount, 5);
    assert.equal(result.metadata.title, 'Multi Page PDF');
    assert.equal(result.metadata.author, 'Fixture Author');
    assert.equal(result.metadata.encrypted, false);
    for (const word of ['one', 'two', 'three', 'four', 'five']) {
      assert.ok(result.text.includes(word), `expected text to include page "${word}"`);
    }
  });
});

describe('PDFProcessor — C3 true page-range extraction', () => {
  let pdfPath;

  before(async () => {
    pdfPath = path.join(tmpDir, 'range.pdf');
    await fs.writeFile(pdfPath, buildPdf({
      pages: ['Page one.', 'Page two.', 'Page three.', 'Page four.', 'Page five.']
    }));
  });

  test('returns exactly the requested [start, end] pages', async () => {
    const result = await processor.processPDF({ source: pdfPath, sourceType: 'file', options: { pageRange: { start: 2, end: 4 } } });

    assert.equal(result.success, true);
    assert.deepEqual(result.extractedPages, { start: 2, end: 4, count: 3 });
    assert.ok(result.text.includes('Page two.'));
    assert.ok(result.text.includes('Page three.'));
    assert.ok(result.text.includes('Page four.'));
    assert.ok(!result.text.includes('Page one.'));
    assert.ok(!result.text.includes('Page five.'));
  });

  test('open-ended range (no end) extracts from start through the last page', async () => {
    const result = await processor.processPDF({ source: pdfPath, sourceType: 'file', options: { pageRange: { start: 3 } } });

    assert.equal(result.success, true);
    assert.deepEqual(result.extractedPages, { start: 3, end: 5, count: 3 });
    assert.ok(result.text.includes('Page three.'));
    assert.ok(result.text.includes('Page five.'));
    assert.ok(!result.text.includes('Page one.'));
  });

  test('a start page past the last page reports an explicit error (not silent success)', async () => {
    const result = await processor.processPDF({ source: pdfPath, sourceType: 'file', options: { pageRange: { start: 99 } } });

    assert.equal(result.success, false);
    assert.match(result.error, /Requested page range starts at page 99, but the PDF only has 5 page\(s\)/);
  });

  test('extractPDFPages() convenience wrapper forwards startPage/endPage as a pageRange', async () => {
    const result = await processor.extractPDFPages({ source: pdfPath, sourceType: 'file', startPage: 2, endPage: 3 });

    assert.equal(result.success, true);
    assert.deepEqual(result.extractedPages, { start: 2, end: 3, count: 2 });
    assert.ok(result.text.includes('Page two.'));
    assert.ok(result.text.includes('Page three.'));
  });
});

describe('PDFProcessor — password-protected PDFs (pdf-parse 2.x decryption)', () => {
  let encPath;

  before(async () => {
    encPath = path.join(tmpDir, 'encrypted.pdf');
    await fs.writeFile(encPath, buildEncryptedPdf({
      pages: ['Secret page one.', 'Secret page two.', 'Secret page three.'],
      info: { Title: 'Encrypted Fixture', Author: 'Secret Author' },
      userPassword: 'hunter2'
    }));
  });

  test('without a password, reports a structured password-related failure', async () => {
    const result = await processor.processPDF({ source: encPath, sourceType: 'file' });

    assert.equal(result.success, false);
    assert.match(result.error, /password/i);
  });

  test('with the wrong password, reports a structured password-related failure', async () => {
    const result = await processor.processPDF({ source: encPath, sourceType: 'file', options: { password: 'wrongpass' } });

    assert.equal(result.success, false);
    assert.match(result.error, /password/i);
  });

  test('with the correct password, decrypts and returns text + metadata', async () => {
    const result = await processor.processPDF({ source: encPath, sourceType: 'file', options: { password: 'hunter2' } });

    assert.equal(result.success, true);
    assert.equal(result.pageCount, 3);
    assert.equal(result.metadata.title, 'Encrypted Fixture');
    assert.equal(result.metadata.author, 'Secret Author');
    assert.equal(result.metadata.encrypted, true);
    assert.ok(result.text.includes('Secret page one.'));
    assert.ok(result.text.includes('Secret page two.'));
    assert.ok(result.text.includes('Secret page three.'));
  });

  test('a page-range extraction also works against a decrypted PDF', async () => {
    const result = await processor.extractPDFPages({
      source: encPath,
      sourceType: 'file',
      startPage: 2,
      endPage: 3,
      options: { password: 'hunter2' }
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.extractedPages, { start: 2, end: 3, count: 2 });
    assert.ok(result.text.includes('Secret page two.'));
    assert.ok(result.text.includes('Secret page three.'));
    assert.ok(!result.text.includes('Secret page one.'));
  });
});

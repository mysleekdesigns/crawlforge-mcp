/**
 * process_document: two-column PDFs, the pages read, and HTML text (R24 3.13, 3.1).
 * Run: node --test --test-force-exit tests/unit/r24p3-document-pages-columns.test.js
 *
 * The 2026-10-03 sweep found: extractTables on a two-column paper (BERT,
 * aclanthology.org/N19-1423.pdf) returned every body line as a two-cell table
 * row — left column beside right column — and fused figure labels with the
 * prose next to them; with maxPages or pageRange nothing said which pages were
 * read; and on HTML input block elements were welded together.
 *
 * Offline: synthetic pdfjs text items, a generated PDF and a local server.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { PDFProcessor } = await import('../../src/core/processing/PDFProcessor.js');
const { ProcessDocumentTool } = await import('../../src/tools/extract/processDocument.js');
const { buildPdf } = await import('../fixtures/pdfBuilder.js');

/** A pdfjs-style positioned text item. */
function item(str, x, y, width, height = 10) {
  return { str, transform: [1, 0, 0, 1, x, y], width, height };
}

// An ACL-style page: left column x 72–290, right column x 306–526.
const LEFT = 72;
const RIGHT = 306;
const COLUMN = 218;

/** n lines of prose in both columns from y downwards, 12 units apart. */
function proseRows(y, n) {
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push(item(`left column line ${i} of running prose text`, LEFT, y - i * 12, COLUMN));
    items.push(item(`right column line ${i} of running prose text`, RIGHT, y - i * 12, COLUMN - 4));
  }
  return items;
}

describe('table detection on a two-column page', () => {
  const processor = new PDFProcessor();

  test('two columns of prose are not a table', () => {
    assert.deepEqual(processor.detectTablesFromTextItems(proseRows(700, 12), 1), []);
  });

  test('a figure\'s labels in the left column are not fused with the right column\'s prose', () => {
    const items = proseRows(700, 8);
    // Figure 1 under the left column's prose: three rows of labels, each beside
    // a line of right-column prose.
    for (let i = 0; i < 4; i++) {
      const y = 580 - i * 12;
      items.push(item('E[CLS]', 80, y, 30), item('E1', 150, y, 12), item('EN', 220, y, 14));
      items.push(item(`right column prose beside the figure, line ${i}`, RIGHT, y, COLUMN - 2));
    }
    const tables = processor.detectTablesFromTextItems(items, 3);
    for (const table of tables) {
      for (const row of table.rows) {
        assert.ok(!row.some((cell) => cell.includes('right column')), JSON.stringify(row));
      }
    }
    // The labels themselves still form their own three-column grid.
    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0].rows[0], ['E[CLS]', 'E1', 'EN']);
  });

  test('a table spanning both columns stays one table', () => {
    const items = proseRows(700, 8);
    const xs = [75, 176, 237, 272, 309, 346, 385, 424, 460, 499];
    const rows = [
      ['System', 'MNLI', 'QQP', 'QNLI', 'SST-2', 'CoLA', 'STS-B', 'MRPC', 'RTE', 'Average'],
      ['GPT', '82.1', '70.3', '87.4', '91.3', '45.4', '80.0', '82.3', '56.0', '75.1'],
      ['BERTBASE', '84.6', '71.2', '90.5', '93.5', '52.1', '85.8', '88.9', '66.4', '79.6'],
      ['BERTLARGE', '86.7', '72.1', '92.7', '94.9', '60.5', '86.5', '89.3', '70.1', '82.1']
    ];
    rows.forEach((cells, r) => cells.forEach((cell, c) => items.push(item(cell, xs[c], 560 - r * 12, 22))));
    const tables = processor.detectTablesFromTextItems(items, 6);
    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0].rows, rows);
  });
});

describe('pagesRead says which pages were read', () => {
  let file;
  before(async () => {
    file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'r24p3-')), 'five.pdf');
    await fs.writeFile(file, buildPdf({ pages: ['Page one.', 'Page two.', 'Page three.', 'Page four.', 'Page five.'] }));
  });

  const read = (options) => new ProcessDocumentTool().execute({
    source: file, sourceType: 'pdf_file', options: { assessContentQuality: false, ...options }
  });

  test('maxPages', async () => {
    const result = await read({ maxPages: 2 });
    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.pagesRead, { start: 1, end: 2, count: 2, totalPages: 5 });
  });

  test('pageRange', async () => {
    const result = await read({ pageRange: { start: 3, end: 4 } });
    assert.deepEqual(result.pagesRead, { start: 3, end: 4, count: 2, totalPages: 5 });
    assert.match(result.content.text, /Page three/);
    assert.doesNotMatch(result.content.text, /Page five/);
  });

  test('the whole document, end clamped to the last page', async () => {
    const result = await read({ pageRange: { start: 2, end: 99 }, extractTables: true });
    assert.deepEqual(result.pagesRead, { start: 2, end: 5, count: 4, totalPages: 5 });
  });
});

describe('HTML text keeps its block boundaries', () => {
  let server;
  let base;
  const paragraph = (n) => `<p>Paragraph ${n} carries enough words about the subject to look like an article body to the extractor, which wants several hundred characters of prose.</p>`;
  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('User-agent: *\nAllow: /\n'); return; }
      if (req.url === '/article') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><head><title>Essay</title></head><body><article><h2>Section heading</h2>${[1, 2, 3, 4, 5].map(paragraph).join('')}<ul><li>First item</li><li>Second item</li></ul></article></body></html>`);
        return;
      }
      if (req.url === '/short') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Short</title></head><body><main><h2>Heading</h2><p>One short line.</p><div>Another block</div></main></body></html>');
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('an article read by Readability has one line per block', async () => {
    const result = await new ProcessDocumentTool().execute({ source: `${base}/article`, sourceType: 'url' });
    assert.equal(result.success, true, result.error);
    const text = result.content.text;
    assert.match(text, /Section heading\nParagraph 1/);
    assert.match(text, /prose\.\nParagraph 2/);
    assert.match(text, /First item\nSecond item/);
  });

  test('a page Readability passes over keeps its blocks apart in the fallback too', async () => {
    const result = await new ProcessDocumentTool().execute({ source: `${base}/short`, sourceType: 'url' });
    assert.equal(result.success, true, result.error);
    assert.match(result.content.text, /Heading\nOne short line\.\nAnother block/);
  });
});

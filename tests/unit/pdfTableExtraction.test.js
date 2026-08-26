/**
 * Regression tests for PDF table extraction (process_document extractTables).
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test tests/unit/pdfTableExtraction.test.js
 *
 * Defect (2026-08-26 live all-tools sweep): process_document ignored table
 * extraction entirely — extractTables was silently stripped by the options
 * schema, no detector existed, and the response carried no tables field at
 * all (not even an empty array). PDFProcessor now detects grid tables from
 * the text layer (positioned text items clustered into rows by y, cells by
 * x-gaps, columns from low-coverage x-regions across a run of rows), and the
 * tool always answers with a tables array when extraction is requested.
 *
 * All fixtures are synthetic pdfjs-style text items ({str, transform, width,
 * height}) — no network, no real PDFs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PDFProcessor } from '../../src/core/processing/PDFProcessor.js';
import { ProcessDocumentTool } from '../../src/tools/extract/processDocument.js';

/** Build a pdfjs-style positioned text item. */
function item(str, x, y, width, height = 10) {
  return { str, transform: [1, 0, 0, 1, x, y], width, height };
}

test('a genuine grid table (4 aligned rows x 3 columns) is detected with its cells', () => {
  const processor = new PDFProcessor();
  const items = [
    // Header row
    item('Name', 50, 700, 25), item('Qty', 150, 700, 18), item('Price', 250, 700, 25),
    // Body rows, 12 units apart, columns left-aligned at x = 50 / 150 / 250
    item('Widget', 50, 688, 32), item('4', 150, 688, 5), item('9.50', 250, 688, 20),
    item('Gadget', 50, 676, 33), item('12', 150, 676, 10), item('3.25', 250, 676, 20),
    item('Doodad', 50, 664, 34), item('7', 150, 664, 5), item('1.10', 250, 664, 20)
  ];

  const tables = processor.detectTablesFromTextItems(items, 3);

  assert.equal(tables.length, 1);
  assert.equal(tables[0].page, 3);
  assert.deepEqual(tables[0].rows, [
    ['Name', 'Qty', 'Price'],
    ['Widget', '4', '9.50'],
    ['Gadget', '12', '3.25'],
    ['Doodad', '7', '1.10']
  ]);
});

test('plain paragraph lines (word-sized gaps only) yield no tables', () => {
  const processor = new PDFProcessor();
  const items = [];
  // 5 lines of 6 words each; word gaps of 2.5 units stay under the cell-gap
  // threshold, so every line is a single segment and no run can form.
  for (let line = 0; line < 5; line++) {
    const y = 700 - line * 12;
    let x = 50;
    for (let w = 0; w < 6; w++) {
      items.push(item(`word${line}${w}`, x, y, 30));
      x += 30 + 2.5;
    }
  }

  assert.deepEqual(processor.detectTablesFromTextItems(items, 1), []);
});

test('two-segment prose lines with misaligned gaps do not form a table', () => {
  const processor = new PDFProcessor();
  // Each line has one wide gap, but at a different x per line — there is no
  // shared low-coverage x-region, so no column boundary and no table.
  const items = [
    item('alpha beta gamma', 50, 700, 100), item('delta epsilon', 160, 700, 140),
    item('zeta', 50, 688, 50), item('eta theta iota kappa', 110, 688, 190),
    item('lambda mu nu xi', 50, 676, 150), item('omicron pi', 210, 676, 90)
  ];

  assert.deepEqual(processor.detectTablesFromTextItems(items, 1), []);
});

test('fragmented cells and superscripts fold into their row and cell', () => {
  const processor = new PDFProcessor();
  // Mirrors real pdfjs output for "1.4·10^20"-style values: the number is
  // split into tiny touching fragments and the exponent sits on a baseline
  // ~3.6 units above the row with a smaller height.
  const items = [
    item('Model', 50, 700, 28), item('Cost', 200, 700, 22),
    item('GNMT', 50, 688, 30),
    item('1', 200, 688, 5), item('.', 205, 688, 2.8), item('4', 207.8, 688, 5),
    item('·', 215, 688, 2.8), item('10', 220, 688, 10),
    item('20', 230, 691.6, 7.9, 7),
    item('ConvS2S', 50, 676, 40), item('9.6', 200, 676, 15),
    item('MoE', 50, 664, 25), item('2.0', 200, 664, 15)
  ];

  const tables = processor.detectTablesFromTextItems(items, 2);

  assert.equal(tables.length, 1);
  assert.equal(tables[0].rows.length, 4);
  // The fragments join into one cell in the same row, with spaces only at
  // visible gaps; the superscript lands in that cell too.
  assert.deepEqual(tables[0].rows[1], ['GNMT', '1.4 · 1020']);
});

test('process_document always answers with a tables array when extraction is requested', async () => {
  const tool = new ProcessDocumentTool();
  // Stub the PDF layer: a successful parse that found no tables.
  tool.pdfProcessor = {
    processPDF: async (params) => {
      assert.equal(params.options.extractTables, true);
      return {
        success: true,
        text: 'plain prose, no tables here',
        metadata: null,
        pageCount: 1
      };
    }
  };

  const result = await tool.execute({
    source: '/tmp/fake.pdf',
    sourceType: 'pdf_file',
    options: { extractTables: true, assessContentQuality: false, includeStatistics: false }
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.tables, []);
});

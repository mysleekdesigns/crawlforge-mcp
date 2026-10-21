/**
 * Live sweep 2026-10-20, Phase 7 item 7.3: process_document titled the arXiv
 * PDF https://arxiv.org/pdf/1706.03762 with the first line of its permission
 * notice. The PDF has no /Title and its text layer opens with that notice
 * paragraph, so titleFromText now skips lines of a prose paragraph.
 *
 * Run: node --test --test-force-exit tests/unit/processDocumentPdfTitle.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { titleFromText } = await import('../../src/tools/extract/processDocument.js');

// The first lines pdf-parse extracted from the live PDF on 2026-10-21.
const ARXIV_1706_03762_PAGE_1 = [
  'Provided proper attribution is provided, Google hereby grants permission to',
  'reproduce the tables and figures in this paper solely for use in journalistic or',
  'scholarly works.',
  'Attention Is All You Need',
  'Ashish Vaswani∗',
  'Google Brain',
  'avaswani@google.com',
  'Noam Shazeer∗',
  'Google Brain',
  'noam@google.com'
].join('\n');

test('titleFromText skips a notice paragraph above the title', () => {
  assert.equal(titleFromText(ARXIV_1706_03762_PAGE_1), 'Attention Is All You Need');
});

test('titleFromText still takes a short first line that no prose continues', () => {
  assert.equal(titleFromText('Quarterly Report\nRevenue rose 4%.'), 'Quarterly Report');
});

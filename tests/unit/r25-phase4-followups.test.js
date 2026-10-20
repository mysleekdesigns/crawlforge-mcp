/**
 * R25 Phase 4 follow-ups (2026-10-19).
 *
 * 1. deep_research's top-level sources[].relevance was always undefined:
 *    deepResearch.js reads `relevance` from supportingEvidence, which
 *    compileSupportingEvidence never set.
 * 2. A page with more elements than Readability should be given skips the
 *    main-content pass: docs.python.org's changelog (114k elements) blocked the
 *    event loop for ~9 s in Readability alone, in scrape, crawl_deep and (since
 *    Phase 4) batch_scrape.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ResearchOrchestrator } from '../../src/core/ResearchOrchestrator.js';
import {
  extractMainContent, tooLargeForReadability, MAX_READABILITY_ELEMENTS
} from '../../src/tools/scrape/_mainContent.js';
import { readabilityToMarkdown } from '../../src/tools/basic/extractText.js';

/** A page of `n` paragraphs inside an article: n + 6 elements. */
function page(n) {
  const body = Array.from({ length: n }, (_, i) => `<p>Paragraph ${i} of the changelog, with enough words to count as prose.</p>`).join('');
  return `<!doctype html><html><head><title>Big</title></head><body><article><h1>Big</h1>${body}</article></body></html>`;
}

describe('deep_research supportingEvidence carries relevance', () => {
  test('relevance comes from the score recorded during exploration', () => {
    const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
    const [scored, unscored] = ro.compileSupportingEvidence([
      { title: 'A', link: 'https://a.example/', overallCredibility: 0.8, relevanceScore: 0.72, extractedContent: 'text' },
      { title: 'B', link: 'https://b.example/', overallCredibility: 0.8, extractedContent: 'text' }
    ]);
    assert.equal(scored.relevance, 0.72);
    // No score computed: omitted from the JSON rather than invented.
    assert.equal(unscored.relevance, undefined);
  });
});

describe('main content skips Readability on a page with too many elements', () => {
  test('tooLargeForReadability counts opening tags against the cap', () => {
    assert.equal(tooLargeForReadability(page(1000)), false);
    assert.equal(tooLargeForReadability(page(MAX_READABILITY_ELEMENTS)), true);
  });

  test('extractMainContent returns tooLarge at once, and still extracts a normal page', () => {
    const t = performance.now();
    const big = extractMainContent(page(MAX_READABILITY_ELEMENTS), 'https://example.com/');
    assert.deepEqual(big, { html: null, title: '', tablesRecovered: 0, tooLarge: true });
    assert.ok(performance.now() - t < 500, 'the skip builds no DOM');

    const small = extractMainContent(page(50), 'https://example.com/');
    assert.ok(small.html.includes('Paragraph 49'));
    assert.equal(small.tooLarge, undefined);
  });

  test('extract_text markdown converts a too-large page whole', () => {
    // Empty padding elements: 50k near-identical paragraphs are a worst case
    // for turndown itself, which a real page is not (the 7.3 MB changelog
    // converts whole in about 2 s).
    const padding = '<b></b>'.repeat(MAX_READABILITY_ELEMENTS);
    const html = `<html><body><h1>Big</h1><p>The only paragraph.</p>${padding}</body></html>`;
    const md = readabilityToMarkdown(html, 'https://example.com/');
    // Readability would have turned the H1 into the article title and dropped it.
    assert.ok(md.startsWith('# Big'), md.slice(0, 40));
    assert.ok(md.includes('The only paragraph.'));
  });
});

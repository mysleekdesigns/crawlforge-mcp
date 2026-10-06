/**
 * scrape takes at most one `highlights` and one `question` format per call.
 * The result has one slot of each, so a second entry overwrote the first
 * while the +1 add-on was still charged. The schema now refuses it.
 *
 * Run: node --test tests/unit/scrapeQueryFormatOnce.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

const { UnifiedScrapeSchema, SCRAPE_INPUT_SHAPE } = await import('../../src/tools/scrape/unifiedScrape.js');

const url = 'https://example.com/';
const question = (q) => ({ type: 'question', question: q });
const highlights = (q) => ({ type: 'highlights', query: q });

for (const [label, formats] of [
  ['two question formats', ['markdown', question('How much?'), question('Is there a free tier?')]],
  ['two highlights formats', [highlights('price'), highlights('free tier')]],
]) {
  test(`${label} are refused with a message naming the limit`, () => {
    // The tool's own parse and the tools/list shape the SDK validates against.
    for (const schema of [UnifiedScrapeSchema, z.object(SCRAPE_INPUT_SHAPE)]) {
      const parsed = schema.safeParse({ url, formats });
      assert.equal(parsed.success, false);
      assert.match(JSON.stringify(parsed.error.issues), /At most one 'highlights' and one 'question' format per call/);
    }
  });
}

test('one highlights and one question together still pass', () => {
  const parsed = UnifiedScrapeSchema.safeParse({ url, formats: ['markdown', highlights('price'), question('How much?')] });
  assert.equal(parsed.success, true);
});

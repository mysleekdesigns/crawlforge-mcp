/**
 * Live sweep re-check 2026-10-21, item 7.2: crawl_deep over max_inline_chars
 * failed the client's output validation, because the inline layer adds
 * `warnings` and crawlDeepShape did not declare it. Every tool with an output
 * schema and an inline threshold must declare every key the layer adds.
 * Run: node --test tests/unit/inlineOutputSchemaKeys.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { OUTPUT_SCHEMAS } from '../../src/schemas/toolOutputSchemas.js';
import { applyInlineThreshold, INLINE_THRESHOLD_TOOLS } from '../../src/server/inlineThreshold.js';

const store = { put: () => 'h_test', ttlMs: 60_000 };

for (const name of Object.keys(OUTPUT_SCHEMAS).filter((n) => INLINE_THRESHOLD_TOOLS[n])) {
  test(`${name}: every key the inline layer adds is in its output schema`, () => {
    const big = { content: { markdown: 'x'.repeat(5000), text: 'x'.repeat(5000) }, results: [{ content: 'x'.repeat(5000) }] };
    const { result, stored } = applyInlineThreshold(name, big, { max_inline_chars: 1000 }, { store, env: {} });
    assert.equal(stored, true);
    const added = Object.keys(result).filter((key) => !(key in big));
    const undeclared = added.filter((key) => !(key in OUTPUT_SCHEMAS[name]));
    assert.deepEqual(undeclared, []);
    const declared = Object.fromEntries(added.map((key) => [key, result[key]]));
    const parsed = z.object(OUTPUT_SCHEMAS[name]).safeParse(declared);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  });
}

/**
 * Unit tests: ResultDeduplicator (real module, no mocks)
 * Run: node --test tests/unit/tools/search/resultDeduplicator.test.js
 *
 * Regression coverage for the Phase 2 fix in
 * src/tools/search/ranking/ResultDeduplicator.js: deduplicateResults()
 * deep-merges a caller-supplied partial `thresholds` object into the
 * defaults instead of replacing the whole `thresholds` object. Before the
 * fix, passing e.g. {thresholds:{url:0.8}} left title/content/combined
 * thresholds `undefined`, silently disabling title/content-based duplicate
 * detection (every `similarity >= undefined` comparison is false).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ResultDeduplicator } from '../../../../src/tools/search/ranking/ResultDeduplicator.js';

describe('ResultDeduplicator — partial thresholds deep-merge', () => {
  test('a partial {thresholds:{url:0.8}} override still catches title+content duplicates via the surviving defaults', async () => {
    const dedup = new ResultDeduplicator({ cacheEnabled: false });

    // Identical title + identical (long) snippet, but on different domains
    // with unrelated paths — URL similarity stays low, so only the
    // title/content default thresholds (0.85 each) can flag this pair as a
    // duplicate. If the merge bug regresses, those thresholds are undefined
    // and this pair survives deduplication as 2 separate results.
    const longSnippet = 'A complete guide covering everything about node.js streams and how they work in practice with real examples';
    const results = [
      { title: 'Complete Guide to Node.js Streams', link: 'https://example.com/a', snippet: longSnippet },
      { title: 'Complete Guide to Node.js Streams', link: 'https://totally-different-domain.net/unrelated/path', snippet: longSnippet }
    ];

    const deduped = await dedup.deduplicateResults(results, { thresholds: { url: 0.8 } });
    assert.equal(deduped.length, 1, 'title+content duplicate must still be merged when only the url threshold was overridden');
  });

  test('the url override itself is applied (lowering it flips a pair from distinct to duplicate)', async () => {
    // Same title (title similarity 1.0, matches the preserved default 0.85),
    // moderately different URLs (measured url similarity ~0.51 — below both
    // the default 0.9 threshold and the >=0.95 always-duplicate shortcut),
    // and distinct snippets so content similarity does not itself trigger a
    // match. Under the default url threshold this is 1 signal (title only)
    // — not enough (areDuplicates requires >=2 signals) — so both survive.
    // Lowering the url threshold to 0.5 makes url count as a second signal,
    // and the pair is merged.
    const results = () => [
      { title: 'Guide to Node Streams', link: 'https://example.com/blog/2024/guide-to-node-streams-in-practice', snippet: 'Learn how backpressure and piping work in Node streams.' },
      { title: 'Guide to Node Streams', link: 'https://example.com/resources/node-streams-explained-fully', snippet: 'A different explanation of stream internals and buffering behavior.' }
    ];

    const withDefaults = new ResultDeduplicator({ cacheEnabled: false });
    const defaultResult = await withDefaults.deduplicateResults(results(), {});
    assert.equal(defaultResult.length, 2, 'default url threshold (0.9) must not merge this pair');

    const withOverride = new ResultDeduplicator({ cacheEnabled: false });
    const overrideResult = await withOverride.deduplicateResults(results(), { thresholds: { url: 0.5 } });
    assert.equal(overrideResult.length, 1, 'the overridden url threshold (0.5) must be applied and merge this pair');
  });

  test('no options — default thresholds still dedupe near-identical results', async () => {
    const dedup = new ResultDeduplicator({ cacheEnabled: false });
    const results = [
      { title: 'Same Page', link: 'https://example.com/page', snippet: 'identical content body for this page here' },
      { title: 'Same Page', link: 'https://example.com/page/', snippet: 'identical content body for this page here' }
    ];

    const deduped = await dedup.deduplicateResults(results, {});
    assert.equal(deduped.length, 1, 'trailing-slash URL variant of an identical page should be deduplicated by default');
  });
});

/**
 * Query expansion keeps search operators whole.
 *
 * Run: node --test tests/unit/queryExpanderOperators.test.js
 *
 * The expander tokenises on punctuation, so "pricing site:prospectapis.com"
 * became "pric site prospectapi com": the site restriction was gone and the
 * zero-result fallback in search_web returned other vendors' pages. Operators
 * (`site:`, `-site:`, `filetype:`, `inurl:` ...) are now carried through
 * verbatim and only the free text is expanded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { QueryExpander } from '../../src/tools/search/queryExpander.js';

test('every expansion of a site: query keeps the operator verbatim', async () => {
  const expansions = await new QueryExpander().expandQuery('pricing site:prospectapis.com');

  assert.equal(expansions[0], 'pricing site:prospectapis.com');
  assert.ok(expansions.length > 1, 'the free text is still expanded');
  for (const expansion of expansions) {
    assert.ok(expansion.includes('site:prospectapis.com'), `operator lost in "${expansion}"`);
  }
});

test('the original query stays first when the operator leads', async () => {
  const expansions = await new QueryExpander().expandQuery('site:example.com -site:docs.example.com web scraping');

  assert.equal(expansions[0], 'site:example.com -site:docs.example.com web scraping');
  for (const expansion of expansions) {
    assert.ok(expansion.includes('site:example.com'), `site: lost in "${expansion}"`);
    assert.ok(expansion.includes('-site:docs.example.com'), `-site: lost in "${expansion}"`);
  }
});

test('a query that is only operators has no expansion', async () => {
  const expansions = await new QueryExpander().expandQuery('site:example.com filetype:pdf');

  assert.deepEqual(expansions, ['site:example.com filetype:pdf']);
});

test('a query without operators expands as before', async () => {
  const expansions = await new QueryExpander().expandQuery('pricing plans');

  assert.equal(expansions[0], 'pricing plans');
  assert.ok(expansions.includes('pric plan'));
});

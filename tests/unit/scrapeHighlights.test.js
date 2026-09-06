/**
 * Unit tests for `scrape`'s query-scoped formats (Phase 1): `highlights`
 * and `question`, the offsets they carry into the `markdown` of the same
 * call, the oversized-markdown hint (1.4), the no-LLM-route fallback of
 * mode:"model", and the pure helpers in src/tools/scrape/_highlights.js.
 *
 * Exercises the REAL UnifiedScrapeTool + fetchAndParse against a local HTTP
 * server serving a pricing-style page (prose, a table with a price row, a
 * code block). The fetch path enforces SSRF protection (blocks loopback by
 * default), so ALLOWED_DOMAINS is set BEFORE the first transitive import of
 * src/constants/config.js. Model mode is tested only for the path where no
 * LLM route exists: Ollama is pointed at a closed port and the API keys are
 * unset, so the chain throws and the extractive result must stand.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/scrapeHighlights.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;
// No LLM route: a closed port for Ollama, no server-side keys, no MCP server.
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');
const { requestContext, reportedActualCost } = await import('../../src/server/requestContext.js');
const { groundingCheck, parseChosenIndexes } = await import('../../src/tools/scrape/_highlights.js');

const PRICING_PAGE = `<!doctype html><html><head><title>Acme Pricing</title></head><body>
<main>
<h1>Acme Pricing</h1>
<p>Acme offers three plans for teams of every size. Every plan includes unlimited projects and email support. Annual billing saves two months.</p>
<h2>Plans</h2>
<table>
<thead><tr><th>Plan</th><th>Price</th><th>Credits</th></tr></thead>
<tbody>
<tr><td>Starter</td><td>$19 per month</td><td>5,000</td></tr>
<tr><td>Professional</td><td>$49 per month</td><td>25,000</td></tr>
<tr><td>Enterprise</td><td>Contact sales</td><td>Custom</td></tr>
</tbody></table>
<h2>Install the client</h2>
<p>Install the client with npm and set your key.</p>
<pre><code>npm install acme-client
export ACME_API_KEY=your_key</code></pre>
<h2>FAQ</h2>
<p>Can I cancel at any time? Yes, cancellation takes effect at the end of the billing period. Refunds are not offered for partial months.</p>
</main></body></html>`;

// Enough prose to put the markdown well past the 40,000-character hint.
const LONG_PAGE = `<!doctype html><html><head><title>A long page</title></head><body><main><h1>A long page</h1>
${'<p>Paragraph after paragraph of ordinary prose that a reader would see on a very long documentation page.</p>\n'.repeat(500)}
</main></body></html>`;

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/robots.txt') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(path === '/long' ? LONG_PAGE : PRICING_PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const tool = new UnifiedScrapeTool();
const scrape = (formats, extra = {}) =>
  tool.execute({ url: `${baseUrl}/pricing`, formats, resolveHiddenContent: 'off', ...extra });

const assertSliceInvariant = (markdown, units) => {
  assert.ok(units.length > 0, 'at least one unit');
  for (const unit of units) {
    assert.equal(markdown.slice(unit.offset, unit.offset + unit.length), unit.text, `offset ${unit.offset} locates the unit`);
    assert.deepEqual(Object.keys(unit).sort(), ['kind', 'length', 'offset', 'score', 'text'], 'public unit shape only');
  }
};

describe('highlights: verbatim units with offsets into the markdown of the same call', () => {
  test('a price query returns the price row first, and every offset locates its text', async () => {
    const result = await scrape(['markdown', { type: 'highlights', query: 'Professional plan price per month' }]);
    assert.equal(result.success, true);
    const { markdown, highlights } = result.content;
    assertSliceInvariant(markdown, highlights);
    assert.equal(highlights[0].kind, 'table_row');
    assert.match(highlights[0].text, /Professional.*\$49 per month/);
    assert.ok(highlights.every((u, i) => i === 0 || highlights[i - 1].score >= u.score), 'best first');
    assert.equal(result.warnings, undefined, 'markdown was requested, so no offsets warning');
  });

  test('a code query returns the fenced block as a code_block', async () => {
    const result = await scrape(['markdown', { type: 'highlights', query: 'npm install' }]);
    const { markdown, highlights } = result.content;
    assertSliceInvariant(markdown, highlights);
    assert.equal(highlights[0].kind, 'code_block');
    assert.match(highlights[0].text, /npm install acme-client/);
  });

  test('without markdown in formats, one warning says where the offsets point', async () => {
    const result = await scrape([{ type: 'highlights', query: 'per month' }]);
    assert.equal(result.content.markdown, undefined);
    assert.ok(result.content.highlights.length > 0);
    const offsetWarnings = result.warnings.filter((w) => w.includes('offsets index the "markdown" format'));
    assert.equal(offsetWarnings.length, 1);
  });

  test('max_highlights caps the result', async () => {
    const result = await scrape(['markdown', { type: 'highlights', query: 'per month', max_highlights: 2 }]);
    assert.equal(result.content.highlights.length, 2);
    assertSliceInvariant(result.content.markdown, result.content.highlights);
  });

  test('a query nothing matches is an empty list and a warning, not an error', async () => {
    const result = await scrape(['markdown', { type: 'highlights', query: 'zebra giraffe' }]);
    assert.equal(result.success, true);
    assert.deepEqual(result.content.highlights, []);
    assert.ok(result.warnings.some((w) => w.startsWith('highlights: no sentence, table row or code block matched')));
  });
});

describe('question: extractive mode is the evidence itself', () => {
  test('grounded: true, evidence with offsets, text = the evidence joined', async () => {
    const result = await scrape(['markdown', { type: 'question', question: 'How much does the Professional plan cost per month?' }]);
    const { markdown, answer } = result.content;
    assert.equal(answer.grounded, true);
    assert.ok(answer.evidence.length > 0);
    assert.ok(answer.evidence.length <= 5);
    assertSliceInvariant(markdown, answer.evidence);
    assert.equal(answer.text, answer.evidence.map((u) => u.text).join('\n'));
    assert.match(answer.text, /\$49 per month/);
  });

  test('no match: empty text, empty evidence, a warning', async () => {
    const result = await scrape(['markdown', { type: 'question', question: 'zebra giraffe' }]);
    assert.deepEqual(result.content.answer, { text: '', grounded: true, evidence: [] });
    assert.ok(result.warnings.some((w) => w.startsWith('question: no sentence, table row or code block matched')));
  });
});

describe('oversized markdown hint (1.4)', () => {
  test('markdown over 40,000 characters carries the hint', async () => {
    const result = await tool.execute({ url: `${baseUrl}/long`, formats: ['markdown'], resolveHiddenContent: 'off' });
    assert.ok(result.content.markdown.length > 40000, `served ${result.content.markdown.length} characters`);
    const hint = result.warnings.find((w) => w.startsWith('markdown: ') && w.includes('characters; ask for {type:"highlights", query}'));
    assert.ok(hint, `expected the hint, got ${JSON.stringify(result.warnings)}`);
    assert.match(hint, new RegExp(`^markdown: ${result.content.markdown.length} characters;`));
  });

  test('the hint is absent when a highlights format is present', async () => {
    const result = await tool.execute({
      url: `${baseUrl}/long`,
      formats: ['markdown', { type: 'highlights', query: 'ordinary prose' }],
      resolveHiddenContent: 'off'
    });
    assert.ok(result.content.markdown.length > 40000);
    assert.ok(result.content.highlights.length > 0);
    assert.ok(!(result.warnings ?? []).some((w) => w.includes('ask for {type:"highlights", query}')));
  });
});

describe('mode:"model" with no LLM route', () => {
  test('highlights: the extractive result, a warning, and the charge drops to the extractive price', async () => {
    await requestContext.run({}, async () => {
      // max_highlights 2: the page has more candidates than that, so the model is asked.
      const result = await scrape(['markdown', { type: 'highlights', query: 'Professional plan price per month', mode: 'model', max_highlights: 2 }]);
      assert.equal(result.success, true);
      assertSliceInvariant(result.content.markdown, result.content.highlights);
      assert.equal(result.content.highlights.length, 2);
      assert.match(result.content.highlights[0].text, /\$49 per month/);
      assert.ok(result.warnings.some((w) => w.startsWith('highlights: mode "model" was unavailable') && w.includes('extractive price')));
      assert.equal(reportedActualCost(), 3, '2 base + 1 query, the 3 for the model dropped');
    });
  });

  test('highlights: with no more candidates than max_highlights the model step is skipped and not charged', async () => {
    await requestContext.run({}, async () => {
      const result = await scrape(['markdown', { type: 'highlights', query: 'Professional plan price per month', mode: 'model' }]);
      assert.ok(result.content.highlights.length > 0);
      assert.ok(result.warnings.some((w) => w.includes('the model had nothing to choose')));
      assert.equal(reportedActualCost(), 3);
    });
  });

  test('question: the extractive answer stays grounded: true, and the charge drops', async () => {
    await requestContext.run({}, async () => {
      const result = await scrape([{ type: 'question', question: 'How much does the Professional plan cost per month?', mode: 'model' }]);
      const { answer } = result.content;
      assert.equal(answer.grounded, true);
      assert.equal(answer.text, answer.evidence.map((u) => u.text).join('\n'));
      assert.ok(result.warnings.some((w) => w.startsWith('question: mode "model" was unavailable')));
      assert.equal(reportedActualCost(), 3);
    });
  });

  // Phase 3 folded the narrow model-only report into one computation made on
  // every return path, so an extractive call now reports its spend explicitly.
  // The value is still the projection, so the charge is unchanged.
  test('extractive mode reports the projection itself: 2 base + 1 query', async () => {
    await requestContext.run({}, async () => {
      await scrape(['markdown', { type: 'highlights', query: 'per month' }]);
      assert.equal(reportedActualCost(), 3);
    });
  });

  test('a plain string-format call reports the bare base', async () => {
    await requestContext.run({}, async () => {
      await scrape(['markdown']);
      assert.equal(reportedActualCost(), 2);
    });
  });
});

describe('groundingCheck (pure)', () => {
  const evidence = '| Professional | $49 per month | 25,000 |\nAcme offers three plans for teams of every size.';
  const question = 'How much does the Professional plan cost per month?';

  test('an answer whose numbers and names are all in the evidence is grounded', () => {
    assert.deepEqual(
      groundingCheck('The Professional plan costs $49 per month.', evidence, question),
      { grounded: true, unbacked: [] }
    );
  });

  test('an invented number is named', () => {
    const check = groundingCheck('The Professional plan costs $59 per month.', evidence, question);
    assert.equal(check.grounded, false);
    assert.deepEqual(check.unbacked, ['59']);
  });

  test('an invented proper noun is named; a proper noun in the evidence is not', () => {
    const check = groundingCheck('According to Gartner, Acme charges $49 per month.', evidence, question);
    assert.equal(check.grounded, false);
    assert.deepEqual(check.unbacked, ['Gartner']);
  });

  test('a proper noun that appears only in the question is accepted', () => {
    const check = groundingCheck('It charges $49 per month for CrawlForge.', '$49 per month.', 'What does CrawlForge charge?');
    assert.deepEqual(check, { grounded: true, unbacked: [] });
  });

  test('the first word of each sentence is not a proper noun', () => {
    const check = groundingCheck('It costs $49. Billing is monthly.\nRefunds are not offered.', '$49 per month', 'cost?');
    assert.deepEqual(check, { grounded: true, unbacked: [] });
  });

  test('numbers are matched case-insensitively with their punctuation, and de-duplicated', () => {
    const check = groundingCheck('25,000 credits and 25,000 more, at 3.5% fee', evidence, question);
    assert.deepEqual(check.unbacked, ['3.5%']);
  });
});

describe('parseChosenIndexes (pure)', () => {
  test('numbers in the reply order, capped, in range, de-duplicated', () => {
    assert.deepEqual(parseChosenIndexes('3, 0, 7', 10, 2), [3, 0]);
    assert.deepEqual(parseChosenIndexes('[9] and [12] then [1]', 10, 5), [9, 1]);
    assert.deepEqual(parseChosenIndexes('1, 1, 2', 10, 5), [1, 2]);
    assert.deepEqual(parseChosenIndexes('none of them', 10, 5), []);
    assert.deepEqual(parseChosenIndexes(undefined, 10, 5), []);
  });
});

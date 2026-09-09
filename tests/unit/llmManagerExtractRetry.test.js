/**
 * Unit tests: LLMManager.extractStructured output budget and retry.
 *
 * Run: node --test tests/unit/llmManagerExtractRetry.test.js
 *
 * R19 (2026-09-07): extract_structured on a 250-row table fell back to CSS
 * selectors with no explanation. The cause was the output budget — an
 * array-valued property counted as one field, so a table got the same
 * 1000-token floor as a single string, and the response stopped mid-object.
 * The parse threw, the generic catch swallowed it, and the caller got three
 * stray lines of page text at confidence 0.6.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LLMManager, salvageTruncatedJson } from '../../src/core/llm/LLMManager.js';

const rowSchema = {
  type: 'object',
  properties: {
    countries: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, capital: { type: 'string' } } }
    }
  },
  required: ['countries']
};

const scalarSchema = {
  type: 'object',
  properties: { headline: { type: 'string' }, author: { type: 'string' } },
  required: ['headline']
};

/** Drive extractStructured with scripted completions; records the budgets asked for. */
function stubCompletions(responses) {
  const manager = new LLMManager({});
  const budgets = [];
  manager.generateCompletion = async (_prompt, options) => {
    budgets.push(options.maxTokens);
    const next = responses[budgets.length - 1];
    if (next instanceof Error) throw next;
    return next;
  };
  manager.fallbackStructuredExtraction = () => ({
    data: {}, method: 'css_fallback', valid: false, validationErrors: []
  });
  return { manager, budgets };
}

const validRows = JSON.stringify({ countries: [{ name: 'Andorra', capital: 'Andorra la Vella' }] });
// A response that stopped mid-object, exactly as the live model produced.
const truncatedRows = '{\n  "countries": [\n    {\n      "name": "Andorra",\n      "capital": "Andorra la Vella"\n    },\n    {';

describe('extractStructured — output budget accounts for arrays', () => {
  test('a schema asking for rows gets more room than its key count implies', async () => {
    const { manager, budgets } = stubCompletions([validRows]);
    await manager.extractStructured('content', rowSchema);
    assert.equal(budgets.length, 1);
    assert.ok(budgets[0] > 1000, `an array field must beat the 1000-token floor, got ${budgets[0]}`);
  });

  test('a schema of scalars is unchanged', async () => {
    const { manager, budgets } = stubCompletions([JSON.stringify({ headline: 'x', author: 'y' })]);
    await manager.extractStructured('content', scalarSchema);
    assert.equal(budgets[0], 1000, 'two scalar fields still land on the floor');
  });
});

describe('extractStructured — retry on a truncated response', () => {
  test('a response cut off mid-object is retried with twice the budget', async () => {
    const { manager, budgets } = stubCompletions([truncatedRows, validRows]);
    const result = await manager.extractStructured('content', rowSchema);

    assert.equal(budgets.length, 2, 'the truncated attempt must be retried');
    assert.equal(budgets[1], budgets[0] * 2, 'the retry doubles the budget');
    assert.equal(result.method, 'llm', 'the second attempt succeeded');
    assert.deepEqual(result.data.countries, [{ name: 'Andorra', capital: 'Andorra la Vella' }]);
    assert.equal(result.valid, true);
  });

  // R21 (2026-09-09): the ECB key-rates table was cut off at 1,800 and again
  // at 3,600 tokens and the whole extraction failed, although dozens of rows
  // were complete. The retry's complete rows are now kept, with a warning that
  // names the limit; only a response with no complete row still falls back.
  test('a second truncated response keeps its complete rows and names the token limit', async () => {
    const { manager } = stubCompletions([truncatedRows, truncatedRows]);
    const result = await manager.extractStructured('content', rowSchema);

    assert.equal(result.method, 'llm');
    assert.equal(result.partial, true);
    assert.deepEqual(result.data.countries, [{ name: 'Andorra', capital: 'Andorra la Vella' }]);
    assert.match(result.warning, /cut off at the \d+-token output limit/);
    assert.match(result.warning, /kept the 1 complete row/);
    assert.doesNotMatch(result.warning, /position \d+/, 'a JSON offset is not an actionable message');
  });

  test('two truncated responses with no complete row fall back, naming the token limit', async () => {
    const noRow = '{\n  "countries": [\n    {\n      "name": "Ando';
    const { manager } = stubCompletions([noRow, noRow]);
    const result = await manager.extractStructured('content', rowSchema);

    assert.equal(result.method, 'css_fallback');
    assert.match(result.error, /cut off at the \d+-token output limit/);
    assert.doesNotMatch(result.error, /position \d+/, 'a JSON offset is not an actionable message');
  });

  test('the first truncated response is still retried, not salvaged', async () => {
    const { manager, budgets } = stubCompletions([truncatedRows, validRows]);
    const result = await manager.extractStructured('content', rowSchema);
    assert.equal(budgets.length, 2);
    assert.equal(result.partial, undefined);
  });

  test('malformed-from-the-start output keeps its own parse error', async () => {
    const { manager } = stubCompletions(['Sure! Here is the data you asked for.', 'still not json']);
    const result = await manager.extractStructured('content', rowSchema);

    assert.equal(result.method, 'css_fallback');
    assert.doesNotMatch(result.error, /cut off at/, 'prose is not truncation');
  });

  test('a provider error is retried once, then reported', async () => {
    const { manager, budgets } = stubCompletions([new Error('ECONNREFUSED'), new Error('ECONNREFUSED')]);
    const result = await manager.extractStructured('content', rowSchema);

    assert.equal(budgets.length, 2);
    assert.equal(result.method, 'css_fallback');
    assert.match(result.error, /ECONNREFUSED/);
  });
});

describe('salvageTruncatedJson', () => {
  test('keeps the complete objects of a cut-off array and closes the document', () => {
    const cut = '{"rates":[{"date":"17 Jun.","deposit":2.25},{"date":"11 Jun.","deposit":2.00},{"date":"23 Apr.","dep';
    const out = salvageTruncatedJson(cut);
    assert.deepEqual(out.data, { rates: [{ date: '17 Jun.', deposit: 2.25 }, { date: '11 Jun.', deposit: 2.0 }] });
    assert.equal(out.rows, 2);
  });

  test('handles nested arrays, strings with brackets, and a cut inside a string', () => {
    const cut = '{"a":[{"tags":["x]","y{"],"n":1},{"tags":["z"],"n":2}],"b":[{"name":"unfinis';
    const out = salvageTruncatedJson(cut);
    // The cut sits after the last complete element, so the unfinished "b"
    // array (no complete row yet) is not in the salvage at all.
    assert.deepEqual(out.data, { a: [{ tags: ['x]', 'y{'], n: 1 }, { tags: ['z'], n: 2 }] });
    assert.equal(out.rows, 5, 'two rows of a plus their three tags');
  });

  test('an array of strings is cut after the last complete string', () => {
    assert.deepEqual(salvageTruncatedJson('{"side_effects":["nausea","diarrhoea","tum').data, { side_effects: ['nausea', 'diarrhoea'] });
  });

  test('nothing complete means null', () => {
    assert.equal(salvageTruncatedJson('{"countries":[{"name":"Ando'), null);
    assert.equal(salvageTruncatedJson('Sure! Here is'), null);
  });
});

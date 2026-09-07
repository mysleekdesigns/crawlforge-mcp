/**
 * Unit tests: LLMManager.validateAgainstSchema and null fields.
 *
 * Run: node --test tests/unit/llmManagerNullFields.test.js
 *
 * R14 (2026-09-03): the decoder format makes every field nullable and the
 * prompt tells the model to answer null for a field the content never
 * states. The validator then reported that null as `expected number, got
 * object` (typeof null) on an optional field, and let a null required field
 * through as filled in.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LLMManager } from '../../src/core/llm/LLMManager.js';

const schema = {
  type: 'object',
  properties: { headline: { type: 'string' }, step_count: { type: 'number' } },
  required: ['headline']
};

describe('validateAgainstSchema — null fields', () => {
  test('null in a field the schema does not require is valid', () => {
    const { valid, errors } = new LLMManager({}).validateAgainstSchema({ headline: 'x', step_count: null }, schema);
    assert.equal(valid, true, errors.join('; '));
  });

  test('null in a required field is reported as missing, once', () => {
    const { valid, errors } = new LLMManager({}).validateAgainstSchema({ headline: null }, schema);
    assert.equal(valid, false);
    assert.deepEqual(errors, ['Missing required field: headline']);
  });

  test('a wrong type is still reported', () => {
    const { errors } = new LLMManager({}).validateAgainstSchema({ headline: 'x', step_count: 'twelve' }, schema);
    assert.deepEqual(errors, ['Field "step_count": expected number, got string']);
  });
});

/**
 * R19 (2026-09-07): the validator only ever looked one level deep, so an array
 * of the wrong thing passed as long as the top-level value was an array. A
 * live extract_structured run returned three stray lines of page text as the
 * `countries` array and reported valid: true.
 */
const rowsSchema = {
  type: 'object',
  properties: {
    countries: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, capital: { type: 'string' } } }
    }
  },
  required: ['countries']
};

describe('validateAgainstSchema — nested shapes', () => {
  test('an array of the wrong item type is reported, per item', () => {
    const junk = { countries: ['Countries of the World: A Simple Example', 'build a simple web scraper'] };
    const { valid, errors } = new LLMManager({}).validateAgainstSchema(junk, rowsSchema);
    assert.equal(valid, false, 'an array of strings is not an array of objects');
    assert.deepEqual(errors, [
      'Field "countries.0": expected object, got string',
      'Field "countries.1": expected object, got string'
    ]);
  });

  test('a correctly shaped array is valid', () => {
    const good = { countries: [{ name: 'Andorra', capital: 'Andorra la Vella' }] };
    const { valid, errors } = new LLMManager({}).validateAgainstSchema(good, rowsSchema);
    assert.equal(valid, true, errors.join('; '));
  });

  test('a wrong type inside an array element is reported with its path', () => {
    const bad = { countries: [{ name: 'Andorra', capital: 12 }] };
    const { errors } = new LLMManager({}).validateAgainstSchema(bad, rowsSchema);
    assert.deepEqual(errors, ['Field "countries.0.capital": expected string, got number']);
  });

  test('enum violations survive the move to the shared validator', () => {
    const enumSchema = { type: 'object', properties: { status: { type: 'string', enum: ['open', 'closed'] } } };
    const { valid, errors } = new LLMManager({}).validateAgainstSchema({ status: 'ajar' }, enumSchema);
    assert.equal(valid, false);
    assert.deepEqual(errors, ['Field "status": value "ajar" not in enum ["open","closed"]']);
  });

  test('a malformed array reports at most ten errors plus a count', () => {
    const numbers = { type: 'object', properties: { xs: { type: 'array', items: { type: 'number' } } } };
    const { valid, errors } = new LLMManager({}).validateAgainstSchema({ xs: Array(30).fill('nope') }, numbers);
    assert.equal(valid, false);
    assert.equal(errors.length, 11, 'ten errors plus the overflow line');
    assert.equal(errors.at(-1), '…and 20 more validation errors');
  });
});

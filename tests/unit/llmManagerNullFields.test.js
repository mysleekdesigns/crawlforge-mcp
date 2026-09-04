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

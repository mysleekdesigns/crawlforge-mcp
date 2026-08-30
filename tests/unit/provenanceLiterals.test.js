/**
 * Unit tests: the provenance guard's LITERAL class — versions, dates, SKUs.
 *
 * Run: node --test tests/unit/provenanceLiterals.test.js
 *
 * Regression for the round-10 finding: extract_structured returned SQLite
 * "3.34.0" on sqlite.org three runs running with verify_numbers on. The page
 * says "Version 3.53.4"; "3.34.0" appears nowhere in it. The guard reported
 * verified: 0 / nulled: 0 — it had looked at nothing, because a three-segment
 * dotted string is not matched by NUMERIC_STRING, so valueReadings() returned
 * null and the walker skipped the field.
 *
 * As with the numeric class, the expensive direction is a FALSE NULL, so most
 * of what follows pins values that must SURVIVE, not fabrications.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { verifyNumericProvenance } from '../../src/utils/provenance.js';

const SOURCE = [
  'SQLite <b>Version 3.53.4</b> (2026-07-24).',
  'Ruby 4.0.6 released. Download v2.7.1 here.',
  'Model A2338, GPU RTX4090.',
  'ISBN 978-0-596-51774-8. Price $1,299.00.'
].join(' ');

const first = (data, source = SOURCE) => {
  const out = verifyNumericProvenance(data, source);
  return { value: Object.values(out.data)[0], ...out };
};

describe('provenance literals — a fabricated identifier is nulled', () => {
  const fabrications = {
    'version absent from the page': '3.34.0',
    'another real-but-absent release': '3.39.0',
    'absent date': '2020-01-01',
    'absent model number': 'A9999',
    'absent ISBN': '978-0-000-00000-0'
  };

  for (const [name, value] of Object.entries(fabrications)) {
    test(name, () => {
      const r = first({ field: value });
      assert.equal(r.value, null, `${value} is not in the source and must be nulled`);
      assert.equal(r.nulled, 1);
      assert.equal(r.unverified[0].reason, 'not_found_in_source');
    });
  }
});

describe('provenance literals — an identifier that IS on the page survives', () => {
  const present = {
    'version as written': '3.53.4',
    'version the page writes bare, value carries a v': 'v3.53.4',
    'version the page writes with v, value is bare': '2.7.1',
    'second version elsewhere on the page': '4.0.6',
    'date': '2026-07-24',
    'model number': 'A2338',
    'mixed alphanumeric': 'RTX4090',
    'hyphenated ISBN': '978-0-596-51774-8'
  };

  for (const [name, value] of Object.entries(present)) {
    test(name, () => {
      const r = first({ field: value });
      assert.equal(r.value, value, `${value} is on the page and must survive`);
      assert.equal(r.nulled, 0);
    });
  }
});

describe('provenance literals — prose is never touched', () => {
  // A model may legitimately re-word prose. Comparing it literally would null
  // good extractions, which is the one failure this guard must not introduce.
  const prose = [
    'Small. Fast. Reliable.',
    'Released 9 times in 2026',
    'beta-release',
    'Attention Is All You Need',
    'A modern runtime for JavaScript and TypeScript.',
    ''
  ];

  for (const value of prose) {
    test(`left alone: ${JSON.stringify(value)}`, () => {
      const r = first({ field: value });
      assert.equal(r.value, value);
      assert.equal(r.nulled, 0, 'prose must never be nulled');
    });
  }
});

describe('provenance literals — the numeric class still behaves', () => {
  test('a price on the page survives', () => {
    assert.equal(first({ price: 1299 }).value, 1299);
  });

  test('a fabricated price is still nulled', () => {
    assert.equal(first({ price: 999 }).value, null);
  });

  test('a plain number is read numerically, not literally', () => {
    // "1.299" is the European spelling of 1299 and must match on the numeric
    // path even though it never appears literally in the source.
    assert.equal(first({ price: '1.299' }).value, '1.299');
  });
});

describe('provenance literals — the sqlite.org regression', () => {
  test('the exact round-10 failure is caught', () => {
    const page = 'SQLite is a C-language library. Version 3.53.4 (2026-07-24).';
    const r = verifyNumericProvenance({ version: '3.34.0' }, page);
    assert.equal(r.data.version, null);
    assert.equal(r.verified, 0);
    assert.equal(r.nulled, 1, 'the guard must actually look at the field');
  });

  test('the correct answer from the same page verifies', () => {
    const page = 'SQLite is a C-language library. Version 3.53.4 (2026-07-24).';
    const r = verifyNumericProvenance({ version: '3.53.4' }, page);
    assert.equal(r.data.version, '3.53.4');
    assert.equal(r.verified, 1);
    assert.equal(r.nulled, 0);
  });
});

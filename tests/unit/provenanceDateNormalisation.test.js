/**
 * Live sweep 2026-10-20, item 2.4: verify_numbers nulled correctly converted
 * values. extract_with_llm, asked for ISO dates, returned 2026-10-14 from
 * "14 octobre 2026" and the guard flagged it not_found_in_source. A date the
 * page writes in words must match its ISO form; a date that cannot exist, or
 * one the page does not carry, must still be flagged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyNumericProvenance } from '../../src/utils/provenance.js';

const kept = (value, source) => {
  const r = verifyNumericProvenance({ v: value }, source);
  return r.data.v === value && r.nulled === 0;
};

test('French dates match their ISO form', () => {
  assert.ok(kept('2026-10-14', '<p>Publié le 14 octobre 2026</p>'));
  assert.ok(kept('2026-10-01', 'Mis à jour le 1er octobre 2026.'));
  assert.ok(kept('2026-02-03', 'le 3 févr. 2026'));
  assert.ok(kept('2026-08-15', 'Fête du 15 août 2026'));
});

test('German dates match their ISO form', () => {
  assert.ok(kept('2026-03-14', 'Stand: 14. März 2026'));
  assert.ok(kept('2026-10-14', 'am 14. Okt. 2026'));
  assert.ok(kept('2026-10-14', 'Datum 14.10.2026'));
});

test('English and Spanish dates match their ISO form', () => {
  assert.ok(kept('2026-10-14', 'Released October 14, 2026'));
  assert.ok(kept('2026-10-14', 'Released Oct 14th 2026'));
  assert.ok(kept('2026-10-14', 'Released 14 October 2026'));
  assert.ok(kept('2026-10-14', 'Publicado el 14 de octubre de 2026'));
  assert.ok(kept('2026-10-14', 'Posted 10/14/2026'));
});

test('a date that cannot exist is flagged', () => {
  for (const bad of ['2027-03-00', '2026-02-30', '2026-13-01']) {
    const r = verifyNumericProvenance({ v: bad }, 'Effective 1 March 2027, revised 28 February 2026.');
    assert.equal(r.data.v, null, bad);
    assert.equal(r.unverified[0].reason, 'not_found_in_source');
  }
});

test('a real date the page does not carry is flagged', () => {
  const src = 'Publié le 14 octobre 2026';
  for (const wrong of ['2026-10-15', '2025-10-14', '2026-11-14']) {
    assert.equal(verifyNumericProvenance({ v: wrong }, src).data.v, null, wrong);
  }
  // Day and month must come from the same date expression.
  assert.equal(verifyNumericProvenance({ v: '2026-10-03' }, 'octobre 2026, page 3').data.v, null);
});

test('numbers: grouping and decimal comma match, a moved decimal point does not', () => {
  assert.ok(kept('1,234', 'Total 1234'));
  assert.ok(kept(1234, 'Total 1.234 €'));
  assert.ok(kept('1234.5', 'Total 1.234,5'));
  assert.ok(kept(12.5, 'Prix 12,50 €'));
  assert.equal(verifyNumericProvenance({ v: '12.34' }, 'Total 1234').data.v, null);
  assert.equal(verifyNumericProvenance({ v: 12.34 }, 'Total 1234').data.v, null);
  assert.equal(verifyNumericProvenance({ v: 1234 }, 'Total 12.34').data.v, null);
});

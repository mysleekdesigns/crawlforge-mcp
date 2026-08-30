/**
 * Unit tests: src/utils/provenance.js — the numeric provenance guard.
 *
 * Run: node --test tests/unit/provenance.test.js
 *
 * The expensive direction of failure is a FALSE NULL: nulling a number that is
 * genuinely on the page destroys a correct extraction. Most of what follows
 * pins the formatting variants that must still match, not the fabrications.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { verifyNumericProvenance } from '../../src/utils/provenance.js';

describe('provenance — a number formatted differently is still the same number', () => {
  const variants = {
    'US grouping + cents': 'Buy it for $1,299.00 today',
    'European grouping': 'Preis: 1.299,00 EUR',
    'space grouping': 'Prix : 1 299 euros',
    'NBSP grouping': 'Prix : 1\u00a0299 euros',
    'Swiss apostrophe': "CHF 1'299",
    'trailing zero cents': 'Total 1299.00',
    'bare digits': 'costs 1299 dollars',
    'split across markup': '<span>1</span><span>,299</span><span>.00</span>'
  };

  for (const [label, source] of Object.entries(variants)) {
    test(`1299 is found in a source written as ${label}`, () => {
      const result = verifyNumericProvenance({ price: 1299 }, source);
      assert.equal(result.data.price, 1299, `nulled a real value: ${JSON.stringify(result.unverified)}`);
      assert.equal(result.nulled, 0);
      assert.equal(result.verified, 1);
    });
  }

  test('the value may be formatted too — "$1,299.00" matches a bare 1299 in the source', () => {
    const result = verifyNumericProvenance({ price: '$1,299.00' }, '<div class="price">1299</div>');
    assert.equal(result.data.price, '$1,299.00');
    assert.equal(result.nulled, 0);
  });

  test('a comma-separated list is read as separate numbers, not one welded number', () => {
    // The greedy token in "1, 2, 3" reads as 123; the digit-run pass has to
    // recover 1, 2 and 3 or three correct values would be nulled.
    const result = verifyNumericProvenance({ items: [1, 2, 3] }, 'items: 1, 2, 3');
    assert.deepEqual(result.data.items, [1, 2, 3]);
    assert.equal(result.nulled, 0);
  });

  test('an ambiguous "1.299" in the source admits both readings', () => {
    assert.equal(verifyNumericProvenance({ n: 1299 }, 'Menge: 1.299').nulled, 0);
    assert.equal(verifyNumericProvenance({ n: 1.299 }, 'Ratio: 1.299').nulled, 0);
  });
});

describe('provenance — a number that is not in the source comes back null with a reason', () => {
  test('a fabricated price is nulled and reported', () => {
    const result = verifyNumericProvenance(
      { price: 1849, name: 'MacBook Air' },
      'MacBook Air. Buy it for $1,299.00 today'
    );
    assert.equal(result.data.price, null);
    assert.equal(result.data.name, 'MacBook Air', 'text fields are untouched');
    assert.deepEqual(result.unverified, [
      { path: 'price', value: 1849, reason: 'not_found_in_source' }
    ]);
  });

  test('paths through objects and arrays are reported so the caller can locate the field', () => {
    const result = verifyNumericProvenance(
      { product: { offers: [{ price: 1299 }, { price: 1849 }] } },
      'only $1,299.00 appears here'
    );
    assert.equal(result.data.product.offers[0].price, 1299);
    assert.equal(result.data.product.offers[1].price, null);
    assert.equal(result.unverified[0].path, 'product.offers[1].price');
  });

  test('a derived number is nulled like any other absent number, but its value is reported', () => {
    // Policy: the guard cannot tell a fabricated total from a computed one, so
    // it nulls both — and hands the removed value back, so a caller that asked
    // for a sum is never silently robbed of it.
    const result = verifyNumericProvenance(
      { line_items: [10, 25], total: 35 },
      'Two items: 10 and 25'
    );
    assert.deepEqual(result.data.line_items, [10, 25]);
    assert.equal(result.data.total, null);
    assert.deepEqual(result.unverified, [
      { path: 'total', value: 35, reason: 'not_found_in_source' }
    ]);
  });
});

describe('provenance — what counts as a numeric field', () => {
  const source = 'Nothing numeric on this page at all.';

  test('strings carrying words are text, not guarded fields, and are left alone', () => {
    // Whitespace is the line: a model may legitimately re-word prose, so
    // comparing it against the page would null good extractions.
    const data = {
      headline: 'From $999 — MacBook Air 13-inch',
      released: 'September 2026'
    };
    const result = verifyNumericProvenance(data, source);
    assert.deepEqual(result.data, data);
    assert.equal(result.nulled, 0);
  });

  test('a version or SKU absent from the page IS nulled — the literal class', () => {
    // Widened after round 10: these used to pass through untouched, which is
    // how extract_structured reported SQLite "3.34.0" as valid on a page that
    // says 3.53.4. A dotted version or a SKU has one correct spelling, so
    // "not on the page" means the model wrote it.
    const result = verifyNumericProvenance(
      { version: '3.14.7', sku: 'MBA-13-M5' },
      source
    );
    assert.deepEqual(result.data, { version: null, sku: null });
    assert.equal(result.nulled, 2);
  });

  test('the same version survives when the page does carry it', () => {
    const result = verifyNumericProvenance(
      { version: '3.14.7' },
      'Python 3.14.7 is the current release.'
    );
    assert.equal(result.data.version, '3.14.7');
    assert.equal(result.nulled, 0);
  });

  test('booleans, nulls and empty values are not numbers', () => {
    const data = { found: false, missing: null, note: '', tags: [] };
    const result = verifyNumericProvenance(data, source);
    assert.deepEqual(result.data, data);
    assert.equal(result.nulled, 0);
  });

  test('a number under any field name is guarded — the field name is not consulted', () => {
    const result = verifyNumericProvenance({ mainOffer: 1849, price: 'Contact us' }, source);
    assert.equal(result.data.mainOffer, null, 'a price under a non-price name is still guarded');
    assert.equal(result.data.price, 'Contact us', 'a non-number under a price name is still text');
  });
});

describe('provenance — the guard refuses to guess', () => {
  test('an empty source nulls nothing and says why', () => {
    const result = verifyNumericProvenance({ price: 1849 }, '');
    assert.equal(result.data.price, 1849);
    assert.equal(result.nulled, 0);
    assert.equal(result.skipped, 'empty_source');
  });

  test('the input object is not mutated', () => {
    const data = { price: 1849 };
    verifyNumericProvenance(data, 'no numbers here');
    assert.equal(data.price, 1849);
  });
});

describe('provenance — the markup-weld pass must not backtrack catastrophically', () => {
  // Regression: MARKUP_BETWEEN_DIGITS was /(\d)(?:\s*<[^>]{0,120}>\s*)+([\d.,])/g.
  // The \s* on BOTH sides of a +-quantified group let a whitespace run be split
  // between one iteration's trailing \s* and the next one's leading \s*, so a
  // digit followed by whitespace-separated tags and NO closing digit explored
  // 2^n paths. Real pages hit this constantly: at n=18 a single replace took 5s,
  // and on live html it never returned — pinning the whole MCP server's event
  // loop at 100% CPU, which hangs every other tool, not just this one.
  test('a digit followed by many whitespace-separated tags and no closing digit returns fast', () => {
    const pathological = `<p>1${' <b> '.repeat(40)}x</p>`;
    const started = Date.now();
    verifyNumericProvenance({ value: '999' }, pathological);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `weld pass took ${elapsed}ms — the regex is backtracking again`);
  });

  test('welding still joins a number the markup splits across tags', () => {
    const split = '<span>1</span><span>299</span>';
    const { data } = verifyNumericProvenance({ price: '1299' }, split);
    assert.equal(data.price, '1299', 'a number only readable across tag boundaries must survive');
  });

  test('welding still joins across tags separated by whitespace — the ReDoS shape', () => {
    const spaced = '<b>4</b> <b>2</b>';
    const { data } = verifyNumericProvenance({ answer: '42' }, spaced);
    assert.equal(data.answer, '42', 'whitespace between tags must not stop the weld');
  });
});

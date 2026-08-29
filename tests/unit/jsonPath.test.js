/**
 * The subtree selector behind extract_embedded_state's `path` parameter
 * (src/utils/jsonPath.js).
 *
 * Run: node --test tests/unit/jsonPath.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseJsonPath, selectJsonPath } from '../../src/utils/jsonPath.js';

describe('parseJsonPath', () => {
  test('splits dotted keys', () => {
    assert.deepEqual(parseJsonPath('next_data.props.pageProps'), ['next_data', 'props', 'pageProps']);
  });

  test('treats bracket indexes and dotted indexes alike', () => {
    assert.deepEqual(parseJsonPath('a[0].b'), ['a', '0', 'b']);
    assert.deepEqual(parseJsonPath('a.0.b'), ['a', '0', 'b']);
    assert.deepEqual(parseJsonPath('a[0][1]'), ['a', '0', '1']);
  });

  test('strips quotes inside brackets', () => {
    assert.deepEqual(parseJsonPath("apollo_state['ROOT_QUERY']"), ['apollo_state', 'ROOT_QUERY']);
  });

  test('ignores empty segments from stray dots', () => {
    assert.deepEqual(parseJsonPath('a..b.'), ['a', 'b']);
  });
});

describe('selectJsonPath', () => {
  const root = {
    next_data: { props: { pageProps: { events: [{ name: 'first' }, { name: 'second' }] } } },
    json_scripts: [{ id: '__NUXT_DATA__', data: { ok: true } }]
  };

  test('resolves an object path', () => {
    assert.deepEqual(selectJsonPath(root, 'next_data.props.pageProps.events.1'), { name: 'second' });
  });

  test('resolves an array index through brackets', () => {
    assert.equal(selectJsonPath(root, 'json_scripts[0].id'), '__NUXT_DATA__');
  });

  test('a falsy leaf still resolves rather than reading as "not found"', () => {
    assert.equal(selectJsonPath({ a: { b: false } }, 'a.b'), false);
    assert.equal(selectJsonPath({ a: { b: null } }, 'a.b'), null);
    assert.equal(selectJsonPath({ a: { b: 0 } }, 'a.b'), 0);
  });

  test('a missing key names where it stopped and what was available', () => {
    assert.throws(
      () => selectJsonPath(root, 'next_data.props.pagePropz'),
      (error) => {
        assert.match(error.message, /"next_data\.props" has no "pagePropz"/);
        assert.match(error.message, /available keys: pageProps/);
        return true;
      }
    );
  });

  test('an out-of-range index reports the array length', () => {
    assert.throws(
      () => selectJsonPath(root, 'json_scripts.7'),
      /array of length 1/
    );
  });

  test('descending into a scalar says so', () => {
    assert.throws(
      () => selectJsonPath({ a: 'text' }, 'a.b'),
      /a string value, which has no keys/
    );
  });

  test('an empty path is rejected rather than returning everything', () => {
    assert.throws(() => selectJsonPath(root, ''), /is empty/);
  });

  test('a key that is not a number does not resolve against an array', () => {
    assert.throws(() => selectJsonPath(root, 'json_scripts.length'), /array of length 1/);
  });
});

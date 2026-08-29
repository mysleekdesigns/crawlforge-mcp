/**
 * The embedded-state reader (src/utils/embeddedState.js).
 *
 * Run: node --test tests/unit/embeddedState.test.js
 *
 * The fixtures under tests/fixtures/embedded-state/ are condensed from live
 * captures taken on 2026-08-29; each file's own comment records its source URL,
 * the curl that fetched it and exactly what was trimmed.
 *
 * The three sources with a verified live target are covered by those fixtures.
 * __APOLLO_STATE__, __INITIAL_STATE__ and __PRELOADED_STATE__ share one
 * assignment reader with __NUXT__ (proven on the elk.zone capture); the
 * assertions below are name-table checks on that shared reader, not claims
 * about any particular site.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { extractEmbeddedState } from '../../src/utils/embeddedState.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/embedded-state');
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');

const byName = (found, name) => found.find((entry) => entry.name === name);

describe('__NEXT_DATA__ (Ticketmaster)', () => {
  const { data, found, warnings } = extractEmbeddedState(fixture('ticketmaster-next-data.html'));

  test('returns a parsed object, not a string', () => {
    assert.equal(typeof data.next_data, 'object');
    assert.equal(data.next_data.buildId, 'KfC_3GF1zuM-t3vA0Rtwl');
    assert.equal(data.next_data.page, '/major-category');
  });

  test('the event data survives with its exact values', () => {
    const [event] = data.next_data.props.pageProps.eventsJsonLD[0];
    assert.equal(event['@type'], 'MusicEvent');
    assert.equal(event.name, 'Remember When - The Ultimate Tribute to Alan Jackson');
  });

  test('reports the source under its raw variable name and its size', () => {
    assert.deepEqual(byName(found, 'next_data'), {
      name: 'next_data',
      variable: '__NEXT_DATA__',
      bytes: Buffer.byteLength(JSON.stringify(data.next_data))
    });
    assert.deepEqual(warnings, []);
  });

  test('is not also reported as a json_scripts block — that would double it', () => {
    assert.equal(data.json_scripts, undefined);
    assert.equal(found.length, 1);
  });
});

describe('RSC flight stream (Healthgrades)', () => {
  const { data, found, warnings } = extractEmbeddedState(fixture('healthgrades-rsc.html'));
  const rows = data.next_f;

  test('38 push chunks become one stream of 71 parsed rows', () => {
    assert.equal(Object.keys(rows).length, 71);
    assert.match(byName(found, 'next_f').note, /38 RSC flight chunks .* 71 rows/);
    assert.equal(byName(found, 'next_f').variable, 'self.__next_f');
    assert.deepEqual(warnings, []);
  });

  test('a JSON row is an object with the page\'s own values', () => {
    assert.equal(rows['0'].b, 'ZSUDKJ6Jvldk6iBn3J7Fo');
    assert.equal(rows['0'].p, '/hg-provider-search-app');
    assert.deepEqual(rows['0'].c, ['', 'cardiology-directory']);
  });

  test('the metadata row carries the real title and canonical URL', () => {
    const flat = JSON.stringify(rows['9'].metadata);
    assert.match(flat, /20 Best Cardiologists Near Me \| Healthgrades/);
    assert.match(flat, /https:\/\/www\.healthgrades\.com\/cardiology-directory/);
  });

  test('a T row is consumed by byte length across chunk boundaries', () => {
    // Row 19 is declared "19:T7ad," (1,965 bytes) in one chunk and finishes two
    // chunks later. A short read would truncate it; a long read would swallow
    // the row after it.
    assert.equal(typeof rows['19'], 'string');
    assert.equal(Buffer.byteLength(rows['19']), 1965);
  });

  test('the row after a T blob keeps its full id', () => {
    // The blob's declared length includes the row's terminating newline.
    // Skipping one more character reads "14" as "4" and overwrites row 4 —
    // which is a module reference, so the corruption is silent.
    assert.ok('14' in rows, 'row 14 must survive the T blob that precedes it');
    assert.equal(rows['14'][1], 'div');
    assert.match(rows['4'], /^I\[/);
  });

  test('module references are kept as raw strings, not dropped', () => {
    assert.equal(rows['3'], 'I[85341,[],""]');
  });
});

describe('Nuxt (elk.zone)', () => {
  const { data, found, warnings } = extractEmbeddedState(fixture('elk-zone-nuxt.html'));

  test('window.__NUXT__ is reported, and the empty assignment is called out', () => {
    assert.deepEqual(data.nuxt, {});
    assert.equal(byName(found, 'nuxt').variable, '__NUXT__');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /__NUXT__ is present but assigned an empty object/);
  });

  test('the real payload comes back as a json_scripts block, with its id', () => {
    assert.equal(data.json_scripts.length, 1);
    assert.equal(data.json_scripts[0].id, '__NUXT_DATA__');
    assert.equal(data.json_scripts[0].data[0][0], 'ShallowReactive');
  });
});

describe('the shared assignment reader', () => {
  const wrap = (script) => `<html><body><script>${script}</script></body></html>`;

  for (const [variable, name] of [
    ['__APOLLO_STATE__', 'apollo_state'],
    ['__INITIAL_STATE__', 'initial_state'],
    ['__PRELOADED_STATE__', 'preloaded_state']
  ]) {
    test(`${variable} is read into "${name}"`, () => {
      const { data, found } = extractEmbeddedState(wrap(`window.${variable} = {"a":{"b":1}};`));
      assert.deepEqual(data[name], { a: { b: 1 } });
      assert.equal(byName(found, name).variable, variable);
    });
  }

  test('a self. or bare prefix is read the same way', () => {
    assert.deepEqual(extractEmbeddedState(wrap('self.__INITIAL_STATE__={"a":1}')).data.initial_state, { a: 1 });
    assert.deepEqual(extractEmbeddedState(wrap('var __INITIAL_STATE__ = {"a":2}')).data.initial_state, { a: 2 });
  });

  test('a value that is not JSON is reported as unparsed, never guessed at', () => {
    const { data, found, warnings } = extractEmbeddedState(
      wrap('window.__NUXT__=(function(a){return {x:a}}(1))')
    );
    assert.equal(data.nuxt, undefined);
    assert.equal(found.length, 0);
    assert.match(warnings[0], /not a JSON literal/);
  });

  test('braces inside strings do not end the payload early', () => {
    const { data } = extractEmbeddedState(wrap('window.__APOLLO_STATE__={"a":"}}}","b":2}'));
    assert.deepEqual(data.apollo_state, { a: '}}}', b: 2 });
  });

  test('a longer identifier ending in the same name is not matched', () => {
    const { found } = extractEmbeddedState(wrap('window.MY__INITIAL_STATE__={"a":1}'));
    assert.equal(found.length, 0);
  });
});

describe('json script blocks', () => {
  test('an unparseable block is skipped with a warning, not silently', () => {
    const { data, warnings } = extractEmbeddedState(
      '<script type="application/json" id="broken">{oops</script>'
    );
    assert.equal(data.json_scripts, undefined);
    assert.match(warnings[0], /id="broken".*not valid JSON/);
  });

  test('ld+json is left to extract_metadata', () => {
    const { found } = extractEmbeddedState(
      '<script type="application/ld+json">{"@type":"Product"}</script>'
    );
    assert.equal(found.length, 0);
  });

  test('a commented-out script neither counts nor hides the real one', () => {
    const { data, found, warnings } = extractEmbeddedState(
      '<!-- <script type="application/json">not json</script> -->' +
      '<script type="application/json" id="real">{"ok":true}</script>'
    );
    assert.deepEqual(warnings, []);
    assert.equal(found.length, 1);
    assert.deepEqual(data.json_scripts, [{ id: 'real', data: { ok: true } }]);
  });
});

describe('a page with no embedded state', () => {
  test('returns nothing found rather than an empty-looking success', () => {
    const { data, found, warnings } = extractEmbeddedState('<html><body><h1>hi</h1></body></html>');
    assert.deepEqual(data, {});
    assert.deepEqual(found, []);
    assert.deepEqual(warnings, []);
  });
});

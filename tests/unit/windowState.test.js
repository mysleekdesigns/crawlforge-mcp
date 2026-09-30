/**
 * src/core/browser/windowState.js — the window_state read for
 * extract_embedded_state's escalated path (plan Phase 3.2).
 *
 * No browser: the in-page function runs here against a stand-in `window`, and
 * the page is a stub whose evaluate calls it the way Playwright would.
 *
 * Run: node --test --test-force-exit tests/unit/windowState.test.js
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW_STATE_GLOBALS, serialiseWindowGlobals, readWindowState } from '../../src/core/browser/windowState.js';

const stubPage = (win) => ({
  async evaluate(fn, arg) {
    globalThis.window = win;
    try { return fn(arg); } finally { delete globalThis.window; }
  }
});

afterEach(() => { delete globalThis.window; });

test('the globals the plan names, in order', () => {
  assert.deepEqual([...WINDOW_STATE_GLOBALS], [
    '__NEXT_DATA__', '__NUXT__', '__remixContext', 'ytInitialData', 'ytInitialPlayerResponse',
    '__INITIAL_STATE__', '__PRELOADED_STATE__', '__APOLLO_STATE__', '__TGT_DATA__', '__PWS_DATA__'
  ]);
});

test('present globals come back parsed; absent and null ones are left out', async () => {
  const { state, warnings } = await readWindowState(stubPage({
    ytInitialData: { contents: { a: [1, 2] } },
    __NUXT__: { data: [{ price: 3 }] },
    __INITIAL_STATE__: null
  }));
  assert.deepEqual(state, { __NUXT__: { data: [{ price: 3 }] }, ytInitialData: { contents: { a: [1, 2] } } });
  assert.deepEqual(warnings, []);
});

test('a cyclic or JSON-less global is skipped with a warning; the others still come back', async () => {
  const cyclic = { name: 'loop' };
  cyclic.self = cyclic;
  const { state, warnings } = await readWindowState(stubPage({
    __NEXT_DATA__: cyclic,
    __remixContext: () => 1,
    __APOLLO_STATE__: { ROOT_QUERY: { ok: true } }
  }));
  assert.deepEqual(state, { __APOLLO_STATE__: { ROOT_QUERY: { ok: true } } });
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /^window_state: __NEXT_DATA__ skipped - not serialisable \(.*circular/i);
  assert.match(warnings[1], /^window_state: __remixContext skipped - not serialisable \(it has no JSON form\)/);
});

test('camoufox: the page\'s own window is reached through wrappedJSObject', () => {
  globalThis.window = { wrappedJSObject: { ytInitialData: { from: 'page' } }, ytInitialData: undefined };
  assert.deepEqual(serialiseWindowGlobals(['ytInitialData']), { ytInitialData: { json: '{"from":"page"}' } });
});

test('a page that cannot be evaluated is a warning, not a failure', async () => {
  const { state, warnings } = await readWindowState({ evaluate: async () => { throw new Error('Target closed\nstack'); } });
  assert.deepEqual(state, {});
  assert.deepEqual(warnings, ['window_state could not be read: Target closed']);
});

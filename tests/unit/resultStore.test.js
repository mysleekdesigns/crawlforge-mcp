/**
 * Unit tests for src/core/ResultStore.js (Phase 2, result handles).
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test tests/unit/resultStore.test.js
 *
 * Every store gets its own temp baseDir so the real ~/.crawlforge is never
 * touched. No network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResultStore, RESULT_HANDLE_PATTERN, getResultStore, setResultStoreForTests } from '../../src/core/ResultStore.js';

const dirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawlforge-result-store-'));
  dirs.push(dir);
  return dir;
}
const stores = [];
function makeStore(options = {}) {
  const store = new ResultStore({ baseDir: tempDir(), ...options });
  stores.push(store);
  return store;
}

after(() => {
  for (const store of stores) store.close();
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('put/get round trip: handle shape, payload, metadata and the file on disk', () => {
  const store = makeStore();
  const payload = { url: 'https://example.com/', content: { markdown: '# Hi' }, n: 1 };
  const handle = store.put('scrape', payload, { meta: { view: 'text', view_path: 'content.markdown' } });

  assert.match(handle, /^res_[0-9a-f-]{36}$/);
  assert.match(handle, RESULT_HANDLE_PATTERN);
  assert.ok(fs.existsSync(path.join(store.baseDir, `${handle}.json`)), 'result written under baseDir');

  const entry = store.get(handle);
  assert.deepEqual(entry.payload, payload);
  assert.equal(entry.toolName, 'scrape');
  assert.equal(entry.bytes, Buffer.byteLength(JSON.stringify(payload)));
  assert.deepEqual(entry.meta, { view: 'text', view_path: 'content.markdown' });
  assert.equal(entry.expiresAt - entry.createdAt, 60 * 60 * 1000, 'default TTL is one hour');
  assert.equal(store.has(handle), true);
  assert.equal(store.list().length, 1);
  assert.equal('payload' in store.list()[0], false, 'list() carries no payloads');
});

test('LRU eviction by bytes: the oldest untouched entry goes first, a read refreshes recency', () => {
  const store = makeStore({ maxBytes: 3500 });
  const big = 'x'.repeat(1000);
  const a = store.put('scrape', { big }); // ~1010 bytes each
  const b = store.put('scrape', { big });
  const c = store.put('scrape', { big });
  assert.equal(store.list().length, 3);

  store.get(a); // a is now the most recently used
  const d = store.put('scrape', { big }); // pushes the total over 3500

  assert.equal(store.has(b), false, 'b was least recently used and is evicted');
  assert.equal(store.has(a), true, 'a survived because it was read');
  assert.equal(store.has(c), true);
  assert.equal(store.has(d), true, 'the entry just inserted is never evicted by its own insert');
  assert.ok(store.totalBytes <= 3500);
  assert.equal(fs.existsSync(path.join(store.baseDir, `${b}.json`)), false, 'the evicted file is removed');
});

test('an entry larger than the whole budget is still stored (never evicted by its own insert)', () => {
  const store = makeStore({ maxBytes: 100 });
  const handle = store.put('scrape', { big: 'x'.repeat(500) });
  assert.equal(store.has(handle), true);
});

test('TTL expiry: get and has return null/false after the TTL, and sweep removes the file', async () => {
  const store = makeStore({ ttlMs: 30, sweepIntervalMs: 60 * 60 * 1000 });
  const handle = store.put('fetch_url', { body: 'hello' });
  assert.ok(store.get(handle));

  await new Promise((r) => setTimeout(r, 60));

  const stillThere = store.put('fetch_url', { body: 'fresh' });
  assert.equal(store.has(handle), false, 'expired entry is not live');
  assert.equal(store.get(handle), null, 'expired entry reads as null');
  assert.equal(fs.existsSync(path.join(store.baseDir, `${handle}.json`)), false, 'expiry deletes the file');
  assert.equal(store.has(stillThere), true, 'a fresh entry is unaffected');

  await new Promise((r) => setTimeout(r, 60));
  store.sweep();
  assert.equal(store.list().length, 0, 'sweep drops the now-expired entry');
  assert.equal(fs.readdirSync(store.baseDir).length, 0);
});

test('a corrupt file reads as null and the entry is dropped, never thrown', () => {
  const store = makeStore();
  const handle = store.put('scrape', { ok: true });
  fs.writeFileSync(path.join(store.baseDir, `${handle}.json`), '{not json');

  assert.equal(store.get(handle), null);
  assert.equal(store.has(handle), false, 'the entry is removed');
  assert.equal(fs.existsSync(path.join(store.baseDir, `${handle}.json`)), false, 'and so is the file');
});

test('a missing file reads as null and the entry is dropped', () => {
  const store = makeStore();
  const handle = store.put('scrape', { ok: true });
  fs.unlinkSync(path.join(store.baseDir, `${handle}.json`));
  assert.equal(store.get(handle), null);
  assert.equal(store.list().length, 0);
});

test('a handle that fails the pattern is rejected before any filesystem access', () => {
  const store = makeStore();
  fs.rmSync(store.baseDir, { recursive: true, force: true }); // any disk touch would now throw
  for (const bad of ['../../etc/passwd', 'res_../x', 'res_', 'nope', 'res_' + 'a'.repeat(81), '', 42, null, undefined]) {
    assert.equal(store.get(bad), null, `get(${JSON.stringify(bad)})`);
    assert.equal(store.has(bad), false, `has(${JSON.stringify(bad)})`);
    assert.equal(store.delete(bad), false, `delete(${JSON.stringify(bad)})`);
  }
});

test('a caller-supplied key becomes the handle (batch ids) and is validated', () => {
  const store = makeStore();
  const key = 'batch_1700000000000_abc123def';
  assert.equal(store.put('batch_scrape', { results: [1, 2], mode: 'sync' }, { key }), key);
  assert.deepEqual(store.get(key).payload, { results: [1, 2], mode: 'sync' });

  // Re-put under the same key replaces the entry.
  store.put('batch_scrape', { results: [3], mode: 'async' }, { key });
  assert.deepEqual(store.get(key).payload.results, [3]);
  assert.equal(store.list().length, 1);

  assert.throws(() => store.put('batch_scrape', {}, { key: 'a b' }), /invalid key/);
  assert.throws(() => store.put('batch_scrape', {}, { key: 'abc' }), /invalid key/, 'shorter than 4');
  assert.throws(() => store.put('batch_scrape', {}, { key: 'phase3_x' }), /res_ or batch_/, 'a key that could never be read back');
});

test('disk failure falls back to memory: put still returns a readable handle', () => {
  const file = path.join(tempDir(), 'not-a-directory');
  fs.writeFileSync(file, 'occupied');
  const warnings = [];
  const store = new ResultStore({ baseDir: file, logger: { warn: (m) => warnings.push(m) } });
  stores.push(store);

  const handle = store.put('scrape', { hello: 'world' });
  assert.deepEqual(store.get(handle).payload, { hello: 'world' });
  assert.equal(store.list()[0].inMemory, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /keeping it in memory/);
  assert.equal(store.delete(handle), true);
  assert.equal(store.get(handle), null);
});

test('delete removes the entry and its file; deleting twice is false', () => {
  const store = makeStore();
  const handle = store.put('scrape', { a: 1 });
  assert.equal(store.delete(handle), true);
  assert.equal(store.delete(handle), false);
  assert.equal(fs.existsSync(path.join(store.baseDir, `${handle}.json`)), false);
  assert.equal(store.totalBytes, 0);
});

test('constructor removes stale files older than the TTL but leaves young ones from other processes', () => {
  const dir = tempDir();
  const stale = path.join(dir, 'res_stale.json');
  const young = path.join(dir, 'res_young.json');
  const foreign = path.join(dir, 'notes.txt');
  for (const f of [stale, young, foreign]) fs.writeFileSync(f, '{}');
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(stale, old, old);
  fs.utimesSync(foreign, old, old);

  const store = new ResultStore({ baseDir: dir });
  stores.push(store);
  assert.equal(fs.existsSync(stale), false, 'stale result file removed');
  assert.equal(fs.existsSync(young), true, 'young file left alone');
  assert.equal(fs.existsSync(foreign), true, 'non-result file left alone');
});

test('getResultStore is a lazy singleton honouring CRAWLFORGE_RESULTS_DIR, and the test seam replaces it', () => {
  const dir = tempDir();
  const previous = process.env.CRAWLFORGE_RESULTS_DIR;
  process.env.CRAWLFORGE_RESULTS_DIR = dir;
  setResultStoreForTests(null);
  try {
    const store = getResultStore();
    stores.push(store);
    assert.equal(store.baseDir, dir);
    assert.equal(getResultStore(), store, 'same instance on the second call');

    const injected = makeStore();
    setResultStoreForTests(injected);
    assert.equal(getResultStore(), injected);
  } finally {
    setResultStoreForTests(null);
    if (previous === undefined) delete process.env.CRAWLFORGE_RESULTS_DIR;
    else process.env.CRAWLFORGE_RESULTS_DIR = previous;
  }
});

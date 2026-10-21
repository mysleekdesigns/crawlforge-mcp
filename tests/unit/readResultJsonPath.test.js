/**
 * Live sweep 2026-10-20, 4.3: read_result json_path.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test --test-force-exit tests/unit/readResultJsonPath.test.js
 *
 * - files["llms.txt"] could not be named: the key holds a ".".
 * - a fetch_url handle was rooted at the parsed body, so view_path "body" did
 *   not resolve; every tool's root is now the whole stored result.
 * - a bad path got the gone-handle "Next step" from withAuth.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResultStore, setResultStoreForTests } from '../../src/core/ResultStore.js';
import { readResultHandler, parseResultPath } from '../../src/tools/result/readResult.js';
import { makeWithAuth } from '../../src/server/withAuth.js';
import { FALLBACK_HINTS } from '../../src/server/fallbackHints.js';
import authManager from '../../src/core/AuthManager.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawlforge-read-result-path-'));
const store = new ResultStore({ baseDir: dir });
const llms = { url: 'https://a.example/', files: { 'llms.txt': '# A\n> short', 'llms-full.txt': 'long '.repeat(5000) }, analysisStats: { pages: 3 } };
const fetched = { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ id: 1 }, { id: 2 }] }) };
let llmsHandle;
let fetchHandle;

before(() => {
  setResultStoreForTests(store);
  llmsHandle = store.put('generate_llms_txt', llms, { meta: { view: 'text', view_path: 'files.llms-full.txt' } });
  fetchHandle = store.put('fetch_url', fetched, { meta: { view: 'text', view_path: 'body' } });
});
after(() => {
  setResultStoreForTests(null);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = async (handle, p) => {
  const out = await readResultHandler({ handle, operation: 'json_path', path: p });
  assert.notEqual(out.isError, true, out.content[0].text);
  return JSON.parse(out.content[0].text).value;
};

test('parseResultPath: dotted keys, indexes and bracket-quoted keys', () => {
  assert.deepEqual(parseResultPath('a.b[0].c'), ['a', 'b', '0', 'c']);
  assert.deepEqual(parseResultPath('files["llms.txt"]'), ['files', 'llms.txt']);
  assert.deepEqual(parseResultPath("files['llms-full.txt'].x"), ['files', 'llms-full.txt', 'x']);
  assert.deepEqual(parseResultPath('next_f[1a]'), ['next_f', '1a']);
});

test('a generate_llms_txt handle reads files["llms.txt"] and files[\'llms.txt\']', async () => {
  assert.equal(await read(llmsHandle, 'files["llms.txt"]'), llms.files['llms.txt']);
  assert.equal(await read(llmsHandle, "files['llms.txt']"), llms.files['llms.txt']);
  assert.deepEqual(await read(llmsHandle, 'analysisStats'), { pages: 3 });
});

test('a fetch_url handle reads body (its view_path) from the stored result, and into a JSON body', async () => {
  assert.equal(await read(fetchHandle, 'body'), fetched.body);
  assert.equal(await read(fetchHandle, 'status'), 200);
  assert.equal(await read(fetchHandle, 'body.items[1].id'), 2);
});

test('a bad path says path not found with the top-level keys, not the gone-handle hint', async () => {
  const withAuth = makeWithAuth({
    authManager: {
      isCreatorMode: () => false,
      getToolCost: (name, params) => authManager.getToolCost(name, params),
      projectCost: (name, params) => authManager.projectCost(name, params),
      checkCredits: async () => true,
      reportUsage: async () => {},
      creditCache: new Map([['key', 1_000_000]])
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  });
  const handler = withAuth('read_result', readResultHandler);

  const top = await handler({ handle: fetchHandle, operation: 'json_path', path: 'items[0]' });
  assert.equal(top.isError, true);
  const topText = top.content[0].text;
  assert.match(topText, /Path "items\[0\]" not found/);
  assert.match(topText, /available keys: status, headers, body/);
  assert.match(topText, /Next step: the handle is still valid/);
  assert.equal(topText.includes(FALLBACK_HINTS.read_result), false);

  const deep = await handler({ handle: llmsHandle, operation: 'json_path', path: 'files.llms' });
  const deepText = deep.content[0].text;
  assert.match(deepText, /"files" has no "llms" \(available keys: llms\.txt, llms-full\.txt\)/);
  assert.match(deepText, /top-level keys: url, files, analysisStats/);
  assert.equal(deepText.includes(FALLBACK_HINTS.read_result), false);
});

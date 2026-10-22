/**
 * Repeat-call reduction plan, Phase 1 (1.5): the `maxAge` input.
 *
 *   - tools/list: the nine page-reading tools declare maxAge (optional
 *     integer >= 0, one shared description); batch_scrape and agent do not.
 *   - validation: 0 and a positive integer pass; negative, fractional and
 *     string values are rejected; scrape's own schema keeps the value.
 *   - pass-through: each tool hands maxAge to its page-cache seam
 *     (fetchWithTimeout or fetchAndParse) — checked in a child process
 *     (tests/fixtures/maxAgeProbe.mjs) because module mocks need a flag.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/maxAgeParam.test.js
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { MAX_AGE_PARAM } from '../../src/utils/maxAgeParam.js';
import { UnifiedScrapeSchema } from '../../src/tools/scrape/unifiedScrape.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TOOLS = [
  'fetch_url', 'scrape', 'extract_metadata', 'extract_text', 'extract_links',
  'scrape_structured', 'extract_embedded_state', 'extract_structured', 'extract_with_llm'
];

let tempHome;
let child;
let tools;

function childEnv() {
  const env = { ...process.env, HOME: tempHome };
  delete env.CRAWLFORGE_API_KEY;
  env.CRAWLFORGE_CREATOR_SECRET = ''; // beat dotenv (it won't override pre-set vars)
  env.CACHE_ENABLE_DISK = 'false';
  return env;
}

before(async () => {
  tempHome = mkdtempSync(join(tmpdir(), 'crawlforge-maxage-'));
  child = spawn('node', ['server.js'], { cwd: REPO_ROOT, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {});
  const replies = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      try { const msg = JSON.parse(line); replies.get(msg.id)?.(msg); } catch { /* not JSON-RPC */ }
    }
  });
  const rpc = (id, method, params) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 60000);
    replies.set(id, (msg) => { clearTimeout(t); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  await rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'maxage-test', version: '1.0.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await rpc(2, 'tools/list', {});
  tools = new Map((list.result?.tools ?? []).map((t) => [t.name, t]));
});

after(() => {
  child?.kill('SIGTERM');
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

test('tools/list: every page-reading tool declares the same optional maxAge', () => {
  const description = MAX_AGE_PARAM.maxAge.description;
  for (const name of TOOLS) {
    const schema = tools.get(name)?.inputSchema;
    assert.ok(schema, `${name} is listed`);
    const prop = schema.properties.maxAge;
    assert.ok(prop, `${name} declares maxAge`);
    assert.equal(prop.type, 'integer', name);
    assert.equal(prop.minimum, 0, name);
    assert.equal(prop.default, undefined, `${name}: no schema default`);
    assert.equal(prop.description, description, name);
    assert.ok(!(schema.required ?? []).includes('maxAge'), `${name}: optional`);
  }
});

test('tools/list: batch_scrape and agent do not declare maxAge', () => {
  for (const name of ['batch_scrape', 'agent']) {
    assert.equal(tools.get(name)?.inputSchema.properties.maxAge, undefined, name);
  }
});

test('maxAge accepts 0, a positive integer or nothing, and rejects the rest', () => {
  const schema = z.object(MAX_AGE_PARAM);
  for (const ok of [{}, { maxAge: 0 }, { maxAge: 600000 }]) assert.ok(schema.safeParse(ok).success, JSON.stringify(ok));
  for (const bad of [-1, 1.5, '600000']) assert.ok(!schema.safeParse({ maxAge: bad }).success, String(bad));
});

test("scrape's own schema keeps maxAge, and leaves it undefined when absent", () => {
  assert.equal(UnifiedScrapeSchema.parse({ url: 'https://example.com', maxAge: 0 }).maxAge, 0);
  assert.equal(UnifiedScrapeSchema.parse({ url: 'https://example.com' }).maxAge, undefined);
});

test('each tool passes maxAge to its page-cache seam', () => {
  const out = execFileSync(process.execPath, ['--experimental-test-module-mocks', 'tests/fixtures/maxAgeProbe.mjs'], {
    cwd: REPO_ROOT, env: childEnv(), stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000
  });
  const calls = JSON.parse(out.toString());
  for (const name of TOOLS) {
    assert.equal(calls[name]?.maxAge, 1234, `${name} passed maxAge to its seam`);
  }
});

test('PAGE_CACHE_SENTENCE is set only where the page cache is on (3.1)', () => {
  const sentence = (extra, args = []) => {
    const env = { ...childEnv(), ...extra };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_ENV;
    const script = "import('./src/utils/maxAgeParam.js').then((m) => process.stdout.write(JSON.stringify(m.PAGE_CACHE_SENTENCE)))";
    return JSON.parse(execFileSync(process.execPath, ['-e', script, ...args], { cwd: REPO_ROOT, env, timeout: 30000 }).toString());
  };
  assert.match(sentence({}), /reuses this session's copy for 10 minutes at 1 credit; pass maxAge: 0/);
  assert.equal(sentence({ MCP_HTTP: 'true' }), '');
  assert.equal(sentence({ CRAWLFORGE_PAGE_CACHE_MB: '0' }), '');
});

test('tools/list: no cache sentence when the cache is off (this child runs under test)', () => {
  for (const name of TOOLS) {
    assert.doesNotMatch(tools.get(name).description, /session's copy/, name);
    assert.match(tools.get(name).description, /\. Cost: /, `${name}: description still joins cleanly`);
  }
});

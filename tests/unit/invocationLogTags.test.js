/**
 * REPEAT_CALL_REDUCTION_PLAN 0.1: the `tool invocation` log line carries
 * runId, client, source and urlKey, so the log can tell client sessions from
 * test and harness runs, and same-URL calls can be grouped without logging
 * the URL itself.
 *
 * Run: node --test --test-force-exit tests/unit/invocationLogTags.test.js
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalUrl } from '../../src/utils/canonicalUrl.js';
import { makeWithAuth, urlKey } from '../../src/server/withAuth.js';
import { requestContext } from '../../src/server/requestContext.js';

const ENV_KEYS = ['NODE_ENV', 'CRAWLFORGE_LOG_SOURCE', 'CRAWLFORGE_RUN_ID'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

const fakeAuth = {
  isCreatorMode: () => true,
  getToolCost: () => 0,
  checkCredits: async () => true,
  projectCost: () => ({ projected: 0, note: 'test' }),
  reportUsage: async () => {}
};

const fakeServer = (name, version) => ({ server: { getClientVersion: () => ({ name, version }) } });

async function logLine(params, { mcpServer = null, store } = {}) {
  const lines = [];
  const logger = { info: (message, context) => lines.push({ message, context }) };
  const withAuth = makeWithAuth({ authManager: fakeAuth, logger, mcpServer });
  const call = () => withAuth('fetch_url', async () => ({ content: [{ type: 'text', text: '{}' }] }))(params);
  await (store ? requestContext.run(store, call) : call());
  assert.equal(lines.length, 1);
  assert.equal(lines[0].message, 'tool invocation');
  return lines[0].context;
}

// ─── canonicalUrl ────────────────────────────────────────────────────────────

test('canonicalUrl: lowercases scheme and host, keeps path case', () => {
  assert.equal(canonicalUrl('HTTPS://Example.COM/Path/A'), 'https://example.com/Path/A');
});

test('canonicalUrl: drops the default port only', () => {
  assert.equal(canonicalUrl('https://example.com:443/a'), 'https://example.com/a');
  assert.equal(canonicalUrl('http://example.com:80/a'), 'http://example.com/a');
  assert.equal(canonicalUrl('http://example.com:443/a'), 'http://example.com:443/a');
  assert.equal(canonicalUrl('https://example.com:8443/a'), 'https://example.com:8443/a');
});

test('canonicalUrl: drops the fragment', () => {
  assert.equal(canonicalUrl('https://example.com/a#section-2'), 'https://example.com/a');
});

test('canonicalUrl: keeps path and query exactly as written', () => {
  assert.equal(canonicalUrl('https://example.com/a/../b?z=1&a=2'), 'https://example.com/a/../b?z=1&a=2');
  assert.equal(canonicalUrl('https://example.com/a%20b?q=x%2Fy'), 'https://example.com/a%20b?q=x%2Fy');
  assert.equal(canonicalUrl('https://example.com?q=1'), 'https://example.com/?q=1');
  assert.equal(canonicalUrl('https://example.com'), 'https://example.com/');
});

test('canonicalUrl: invalid input returns null', () => {
  assert.equal(canonicalUrl('not a url'), null);
  assert.equal(canonicalUrl(''), null);
  assert.equal(canonicalUrl(undefined), null);
  assert.equal(canonicalUrl(['https://example.com']), null);
});

// ─── withAuth log tags ───────────────────────────────────────────────────────

test('log line: urlKey is sha256(canonical URL)[:12] and the URL is never logged', async () => {
  clearEnv();
  const url = 'HTTPS://Example.com:443/secret-path?token=abc#frag';
  const ctx = await logLine({ url });
  const expected = createHash('sha256').update('https://example.com/secret-path?token=abc').digest('hex').slice(0, 12);
  assert.equal(ctx.urlKey, expected);
  assert.equal(ctx.urlKey, urlKey('https://example.com/secret-path?token=abc#other'));
  const serialized = JSON.stringify(ctx).toLowerCase();
  assert.ok(!serialized.includes('example.com'), 'host not logged');
  assert.ok(!serialized.includes('secret-path'), 'path not logged');
});

test('log line: urlKey is null without a single string URL', async () => {
  clearEnv();
  assert.equal((await logLine({ urls: ['https://example.com'] })).urlKey, null);
  assert.equal((await logLine({ query: 'x' })).urlKey, null);
  assert.equal((await logLine({ url: 'not a url' })).urlKey, null);
  assert.equal((await logLine(undefined)).urlKey, null);
});

test('log line: runId is stable per process; CRAWLFORGE_RUN_ID overrides it', async () => {
  clearEnv();
  const a = (await logLine({})).runId;
  const b = (await logLine({})).runId;
  assert.equal(typeof a, 'string');
  assert.ok(a.length > 0);
  assert.equal(a, b);
  process.env.CRAWLFORGE_RUN_ID = 'eval-run-42';
  assert.equal((await logLine({})).runId, 'eval-run-42');
});

test('log line: source is test / harness / eval / client', async () => {
  clearEnv();
  assert.equal((await logLine({})).source, 'client');
  process.env.CRAWLFORGE_LOG_SOURCE = 'harness';
  assert.equal((await logLine({})).source, 'harness');
  process.env.CRAWLFORGE_LOG_SOURCE = 'eval';
  assert.equal((await logLine({})).source, 'eval');
  process.env.CRAWLFORGE_LOG_SOURCE = 'something-else';
  assert.equal((await logLine({})).source, 'client');
  process.env.NODE_ENV = 'test';
  process.env.CRAWLFORGE_LOG_SOURCE = 'harness';
  assert.equal((await logLine({})).source, 'test');
});

test('log line: client is name/version from initialize, null when unknown', async () => {
  clearEnv();
  assert.equal((await logLine({})).client, null);
  assert.equal((await logLine({}, { mcpServer: { server: { getClientVersion: () => undefined } } })).client, null);
  assert.equal((await logLine({}, { mcpServer: fakeServer('claude-code', '2.1.0') })).client, 'claude-code/2.1.0');
});

test('log line: an HTTP request reads the client from its own serving server', async () => {
  clearEnv();
  const ctx = await logLine({}, {
    mcpServer: fakeServer('template', '0'),
    store: { servingServer: fakeServer('cursor', '1.7') }
  });
  assert.equal(ctx.client, 'cursor/1.7');
});

/**
 * Snapshot test for the `scrape` entry in tools/list (Phase 0, 0.3).
 *
 * `scrape`'s input schema used to be declared three times — server.js, the
 * tool module and toolOutputSchemas.js — and the copies had already drifted
 * (`.optional().default()` in one, `.default()` in another). 0.3 makes the
 * tool module the single source and server.js an importer. The gate is that
 * the wire output does not move: tests/fixtures/scrape-tools-list.json is the
 * `scrape` entry captured over stdio BEFORE the consolidation and is never
 * regenerated — a difference here means the consolidation is wrong, not the
 * fixture.
 *
 * Two comparisons, because 0.1 lands in the same phase:
 *   - everything except `outputSchema` (name, description, inputSchema,
 *     annotations, execution, _meta, icons) must be byte-identical — the
 *     inputSchema is compared as serialized JSON so key order counts too;
 *   - `outputSchema` must equal the fixture PLUS exactly the four optional
 *     properties 0.1 adds for a failed verdict (`status`, `title`, `error`,
 *     `blocked`). The test deletes those from the live schema and then
 *     deep-equals the rest, so any other change to the output schema still
 *     fails.
 *
 * The server is spawned with HOME pointed at a temp dir and an empty creator
 * secret so the real ~/.crawlforge is never read or written.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test tests/unit/scrapeSchemaSnapshot.test.js
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/scrape-tools-list.json'), 'utf8'));
const VERDICT_PROPERTIES = ['status', 'title', 'error', 'blocked'];

let tempHome;
let server;
let live;

function startServer() {
  const env = { ...process.env, HOME: tempHome };
  delete env.CRAWLFORGE_API_KEY;
  env.CRAWLFORGE_CREATOR_SECRET = ''; // beat dotenv (it won't override pre-set vars)

  const child = spawn('node', ['server.js'], { cwd: REPO_ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch { /* a non-JSON stdout line is itself a bug, surfaced as an rpc timeout */ }
    }
  });
  child.stderr.on('data', () => {});

  let nextId = 1;
  const rpc = (method, params, timeoutMs = 60000) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }, timeoutMs);
      pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  };
  const notify = (method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  };
  return { child, rpc, notify };
}

before(async () => {
  tempHome = mkdtempSync(join(tmpdir(), 'crawlforge-scrape-snapshot-'));
  server = startServer();
  const init = await server.rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'scrape-schema-snapshot', version: '1.0.0' }
  });
  assert.ok(init.result?.serverInfo, 'server answered initialize');
  server.notify('notifications/initialized');
  const list = await server.rpc('tools/list', {});
  live = (list.result?.tools ?? []).find((t) => t.name === 'scrape');
  assert.ok(live, 'tools/list carries a scrape entry');
});

after(() => {
  server?.child.kill('SIGTERM');
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

test('scrape tools/list entry is byte-identical to the fixture outside outputSchema', () => {
  const { outputSchema: _liveOut, ...liveRest } = live;
  const { outputSchema: _fixOut, ...fixtureRest } = FIXTURE;
  assert.equal(JSON.stringify(liveRest.inputSchema), JSON.stringify(fixtureRest.inputSchema));
  assert.deepEqual(liveRest, fixtureRest);
});

test('scrape outputSchema is the fixture plus only the four optional verdict properties', () => {
  const liveOut = structuredClone(live.outputSchema);
  for (const key of VERDICT_PROPERTIES) {
    assert.ok(liveOut.properties[key], `outputSchema declares ${key}`);
    assert.ok(!(liveOut.required ?? []).includes(key), `${key} is optional`);
    delete liveOut.properties[key];
  }
  assert.deepEqual(liveOut, FIXTURE.outputSchema);
});

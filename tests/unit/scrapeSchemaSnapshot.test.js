/**
 * Snapshot test for the `scrape` entry in tools/list.
 *
 * `scrape`'s input schema used to be declared three times — server.js, the
 * tool module and toolOutputSchemas.js — and the copies had already drifted.
 * Phase 0 (0.3, shipped in 5.6.11) made the tool module the single source,
 * and this test's gate for it was a fixture captured BEFORE the
 * consolidation that the wire output had to match byte for byte. That gate
 * passed.
 *
 * From 5.7.0 on, tests/fixtures/scrape-tools-list.json is the CURRENT wire
 * shape of the entry, compared whole: name, description, inputSchema (as
 * serialized JSON, so key order counts), outputSchema, annotations,
 * execution, _meta, icons. It is regenerated on each INTENTIONAL schema
 * change — capture the `scrape` entry from a real stdio tools/list, spawned
 * the way this file spawns the server — and guards against accidental drift
 * in between. Regenerated 2026-09-06 for Phase 4.1's MCP SDK v1 -> v2 and
 * zod 3 -> zod 4 move, which changes how the schema is SERIALIZED without
 * changing what it accepts: the SDK's own converter no longer emits
 * `additionalProperties: false` on nested objects, inlines what used to be a
 * `$ref` back-reference, and orders keys differently. Runtime validation is
 * unchanged — zod still strips unknown keys — so the wire schema is merely
 * more permissive than the validator, not the other way round.
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

test('scrape tools/list entry is byte-identical to the fixture', () => {
  assert.equal(JSON.stringify(live.inputSchema), JSON.stringify(FIXTURE.inputSchema));
  assert.deepEqual(live, FIXTURE);
});

test('the formats union carries the highlights and question object schemas, and the output schema their results', () => {
  const members = live.inputSchema.properties.formats.items.anyOf;
  const objectTypes = members
    .filter((m) => m.type === 'object')
    .map((m) => m.properties.type.const ?? m.properties.type.enum?.[0]);
  assert.ok(objectTypes.includes('highlights'), `formats.items union has highlights: ${objectTypes}`);
  assert.ok(objectTypes.includes('question'), `formats.items union has question: ${objectTypes}`);

  const content = live.outputSchema.properties.content.properties;
  assert.equal(content.highlights.type, 'array');
  assert.equal(content.answer.type, 'object');
  assert.deepEqual(Object.keys(content.answer.properties).sort(), ['evidence', 'grounded', 'text']);
});

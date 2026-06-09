/**
 * Open-core Phase 2 smoke test: with NO API key configured the server must
 * start (no exit 0), serve Tier-0 tools for free (_cost.actual === 0), and
 * reject Tier-1 tools with a "not configured" error.
 *
 * Usage: node scripts/smoke-free-tier.mjs
 * (Runs the local server.js with HOME pointed at a temp dir so the real
 * ~/.crawlforge config is never touched.)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempHome = mkdtempSync(join(tmpdir(), 'crawlforge-free-tier-'));

const env = { ...process.env, HOME: tempHome };
delete env.CRAWLFORGE_API_KEY;
delete env.CRAWLFORGE_CREATOR_SECRET;
env.CRAWLFORGE_CREATOR_SECRET = ''; // beat dotenv (it won't override pre-set vars)

const server = spawn('node', ['server.js'], { env, stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
const pending = new Map();
server.stdout.on('data', (d) => {
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
    } catch { /* non-JSON noise on stdout would itself be a bug, surfaced by parse failures below */ }
  }
});
const stderrLines = [];
server.stderr.on('data', (d) => stderrLines.push(d.toString()));

let nextId = 1;
function rpc(method, params, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'free-tier-smoke', version: '1.0.0' }
  });
  check('server starts and answers initialize with no API key', !!init.result?.serverInfo);
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // Tier-0 tool: must succeed, free
  const free = await rpc('tools/call', {
    name: 'fetch_url',
    arguments: { url: 'https://example.com' }
  }, 60000);
  const freeText = free.result?.content?.[0]?.text ?? '';
  let cost = null;
  try { cost = JSON.parse(freeText)._cost; } catch { /* not JSON */ }
  check('fetch_url (Tier 0) succeeds without a key', !free.result?.isError && !free.error, free.error?.message ?? '');
  check('fetch_url _cost.actual === 0', cost?.actual === 0, `got ${JSON.stringify(cost)}`);

  // Tier-1 tool: must demand a key
  const paid = await rpc('tools/call', {
    name: 'search_web',
    arguments: { query: 'test' }
  }, 60000);
  const paidText = JSON.stringify(paid.result ?? paid.error ?? {});
  const demandsKey = /not configured|run setup/i.test(paidText);
  check('search_web (Tier 1) still demands a key', demandsKey, paidText.slice(0, 160));

  check('server still alive (no exit 0 on missing key)', server.exitCode === null);
  const banner = stderrLines.join('');
  check('free-tier notice printed to stderr', /free-tier mode/i.test(banner));
} catch (err) {
  check('smoke test ran to completion', false, err.message);
} finally {
  server.kill('SIGTERM');
  rmSync(tempHome, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);

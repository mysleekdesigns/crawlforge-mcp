/**
 * Smoke test: with NO API key configured the server must still start (so the
 * MCP client can list tools), but EVERY tool — including the formerly-free
 * ones — must demand a key. There is no free tier.
 *
 * Usage: node scripts/smoke-require-key.mjs
 * (Runs the local server.js with HOME pointed at a temp dir so the real
 * ~/.crawlforge config is never touched.)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempHome = mkdtempSync(join(tmpdir(), 'crawlforge-require-key-'));

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

function demandsKey(result) {
  const text = JSON.stringify(result?.result ?? result?.error ?? {});
  return /not configured|run setup|api key (is )?required/i.test(text);
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'require-key-smoke', version: '1.0.0' }
  });
  check('server starts and answers initialize with no API key', !!init.result?.serverInfo);
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // Formerly-free tool: must now demand a key
  const basic = await rpc('tools/call', {
    name: 'fetch_url',
    arguments: { url: 'https://example.com' }
  }, 60000);
  check('fetch_url demands a key (no free tier)', demandsKey(basic), JSON.stringify(basic.result ?? basic.error ?? {}).slice(0, 160));

  // Premium tool: must demand a key
  const premium = await rpc('tools/call', {
    name: 'search_web',
    arguments: { query: 'test' }
  }, 60000);
  check('search_web demands a key', demandsKey(premium), JSON.stringify(premium.result ?? premium.error ?? {}).slice(0, 160));

  check('server still alive (lists tools without a key)', server.exitCode === null);
  const banner = stderrLines.join('');
  check('"all tools require a key" notice printed to stderr', /all tools require a key/i.test(banner));
} catch (err) {
  check('smoke test ran to completion', false, err.message);
} finally {
  server.kill('SIGTERM');
  rmSync(tempHome, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);

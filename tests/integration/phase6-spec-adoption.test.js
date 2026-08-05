/**
 * Phase 6 — MCP-Spec Adoption integration test
 *
 * Spawns the REAL server (`node server.js`) and drives it over the actual
 * stdio JSON-RPC transport (no mocking), the way an MCP host would. Verifies
 * the Phase 6 contract:
 *   - initialize: serverInfo present, capabilities.tasks declared, protocol
 *     handshake still valid
 *   - tools/list: sorted ascending by name; every inputSchema carries the
 *     2020-12 $schema; every tool has an icons array; the 6 named tools carry
 *     an outputSchema; the 4 long-running tools have execution.taskSupport
 *     === 'optional'
 *   - tools/call fetch_url with an invalid URL resolves as a JSON-RPC result
 *     with isError:true (SEP-1303), not a thrown protocol error, over the
 *     real server (not just the in-process SDK, see
 *     tests/unit/phase6-sep1303-validation.test.js for that)
 *   - CRAWLFORGE_TOOLS / CRAWLFORGE_TOOL_GROUPS env filtering narrows
 *     tools/list to exactly the expected set
 *
 * NOTE ON TEST RUNNERS: `npm run test:integration` globs only
 * `tests/integration/tools/*.test.js`, and `npm run test:unit` globs only
 * `tests/unit/**\/*.test.js` — this file is outside both, by design (it needs
 * to spawn the real server, unlike the sibling suites). Run it standalone:
 *
 *   node --test --test-force-exit tests/integration/phase6-spec-adoption.test.js
 *
 * No live network calls are made: the one tools/call exercised
 * (fetch_url with an invalid URL) fails Zod validation before any fetch is
 * attempted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '..', '..', 'server.js');

const STARTUP_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 8000;

const READY_BANNER = /CrawlForge MCP Server v[\d.]+ running on stdio/;

/**
 * Minimal JSON-RPC-over-stdio client for the real server process. Mirrors
 * the spawn/line-buffering style of tests/integration/mcp-protocol-compliance.test.js
 * (not imported from it — kept self-contained per this file's ownership).
 */
class McpStdioClient {
  constructor(env = {}) {
    this.requestId = 0;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.child = null;
    this.extraEnv = env;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.child = spawn(process.execPath, [SERVER_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test', ...this.extraEnv }
      });

      let settled = false;
      const settleReject = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        reject(err);
      };

      const startupTimer = setTimeout(() => {
        settleReject(new Error(
          `server.js did not print the stdio ready banner within ${STARTUP_TIMEOUT_MS}ms.\n` +
          `--- stderr so far ---\n${this.stderrBuffer}`
        ));
      }, STARTUP_TIMEOUT_MS);

      this.child.on('error', (err) => {
        settleReject(new Error(`Failed to spawn server.js: ${err.message}`));
      });

      this.child.on('exit', (code, signal) => {
        // Reject anything still pending — the process is gone.
        for (const { reject: rejectPending } of this.pending.values()) {
          rejectPending(new Error(`server.js exited (code=${code}, signal=${signal}) before responding`));
        }
        this.pending.clear();

        settleReject(new Error(
          `server.js exited before printing the stdio ready banner (code=${code}, signal=${signal}). ` +
          `This is expected if a Phase 6 module server.js imports (e.g. src/server/taskSupport.js, ` +
          `src/server/toolFilter.js, src/server/specHygiene.js) has not landed yet — ` +
          `treat as PENDING IMPLEMENTATION rather than a regression.\n` +
          `--- stderr ---\n${this.stderrBuffer}`
        ));
      });

      this.child.stderr.on('data', (chunk) => {
        this.stderrBuffer += chunk.toString();
        if (!settled && READY_BANNER.test(this.stderrBuffer)) {
          settled = true;
          clearTimeout(startupTimer);
          resolve();
        }
      });

      this.child.stdout.on('data', (chunk) => {
        this.stdoutBuffer += chunk.toString();
        let idx;
        while ((idx = this.stdoutBuffer.indexOf('\n')) >= 0) {
          const line = this.stdoutBuffer.slice(0, idx).trim();
          this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue; // not a complete/valid JSON line yet
          }
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve: resolvePending } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            resolvePending(msg);
          }
        }
      });
    });
  }

  request(method, params) {
    const id = ++this.requestId;
    const payload = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request "${method}" (id=${id}) timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject
      });
      this.child.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  notify(method, params) {
    const payload = { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
    this.child.stdin.write(JSON.stringify(payload) + '\n');
  }

  async stop() {
    if (!this.child || this.child.killed) return;
    this.child.kill('SIGTERM');
    await new Promise((resolve) => {
      const forceKillTimer = setTimeout(() => {
        try { this.child.kill('SIGKILL'); } catch { /* already gone */ }
        resolve();
      }, 3000);
      this.child.once('exit', () => { clearTimeout(forceKillTimer); resolve(); });
    });
  }
}

async function initializeHandshake(client) {
  const initResponse = await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'phase6-spec-adoption-test', version: '1.0.0' }
  });
  client.notify('notifications/initialized');
  return initResponse;
}

test('Phase 6 (live server): initialize + tools/list spec adoption + tools/call SEP-1303', async () => {
  const client = new McpStdioClient();

  try {
    await client.start();
  } catch (err) {
    assert.fail(`PENDING IMPLEMENTATION — server.js failed to start: ${err.message}`);
    return;
  }

  try {
    // ── initialize ──────────────────────────────────────────────────────────
    const initResponse = await initializeHandshake(client);
    assert.ok(!initResponse.error, `initialize should not error; got ${JSON.stringify(initResponse.error)}`);
    assert.ok(initResponse.result, 'initialize should return a result');
    assert.equal(initResponse.result.protocolVersion, '2024-11-05', 'protocol handshake should still validate');
    assert.ok(initResponse.result.serverInfo, 'initialize result should include serverInfo');
    assert.equal(initResponse.result.serverInfo.name, 'crawlforge', 'serverInfo.name should be "crawlforge"');
    assert.ok(
      initResponse.result.capabilities && Object.prototype.hasOwnProperty.call(initResponse.result.capabilities, 'tasks'),
      `expected capabilities.tasks to be declared (Phase 6 tasks capability); got capabilities=${JSON.stringify(initResponse.result.capabilities)}`
    );

    // ── tools/list ───────────────────────────────────────────────────────────
    const listResponse = await client.request('tools/list');
    assert.ok(!listResponse.error, `tools/list should not error; got ${JSON.stringify(listResponse.error)}`);
    assert.ok(Array.isArray(listResponse.result?.tools), 'tools/list should return a tools array');
    const tools = listResponse.result.tools;
    assert.ok(tools.length > 0, 'expected at least one tool to be registered');

    // sorted ascending by tool name
    const names = tools.map((t) => t.name);
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(names, sortedNames, `expected tools/list sorted ascending by name; got order: ${JSON.stringify(names)}`);

    // every inputSchema carries the 2020-12 $schema
    const missing2020_12 = tools.filter((t) => t.inputSchema?.$schema !== 'https://json-schema.org/draft/2020-12/schema').map((t) => t.name);
    assert.deepEqual(missing2020_12, [], `every tool inputSchema should carry the 2020-12 $schema; missing on: ${JSON.stringify(missing2020_12)}`);

    // every tool has a non-empty icons array
    const missingIcons = tools.filter((t) => !Array.isArray(t.icons) || t.icons.length === 0).map((t) => t.name);
    assert.deepEqual(missingIcons, [], `every tool should have a non-empty icons array; missing on: ${JSON.stringify(missingIcons)}`);

    // outputSchema on the 6 named tools
    const expectOutputSchema = ['scrape', 'map_site', 'serp_rank', 'search_web', 'extract_structured', 'crawl_deep'];
    for (const name of expectOutputSchema) {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool, `expected tool "${name}" to be present in tools/list`);
      assert.ok(tool.outputSchema && typeof tool.outputSchema === 'object', `expected tool "${name}" to declare an outputSchema`);
    }

    // execution.taskSupport === 'optional' on the 4 long-running tools
    const expectTaskSupport = ['crawl_deep', 'batch_scrape', 'deep_research', 'agent'];
    for (const name of expectTaskSupport) {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool, `expected tool "${name}" to be present in tools/list`);
      assert.equal(tool.execution?.taskSupport, 'optional', `expected tool "${name}".execution.taskSupport === 'optional'; got ${JSON.stringify(tool.execution)}`);
    }

    // ── tools/call fetch_url with an invalid URL → SEP-1303 over the real server ──
    // No live network: this fails Zod validation before any fetch is attempted.
    const callResponse = await client.request('tools/call', {
      name: 'fetch_url',
      arguments: { url: 'not-a-valid-url' }
    });
    assert.ok(!callResponse.error, `expected no top-level JSON-RPC protocol error for invalid input (SEP-1303); got ${JSON.stringify(callResponse.error)}`);
    assert.ok(callResponse.result, 'tools/call should resolve to a JSON-RPC result');
    assert.equal(callResponse.result.isError, true, 'expected result.isError to be true for invalid fetch_url input');
  } finally {
    await client.stop();
  }
});

test('Phase 6 (live server): CRAWLFORGE_TOOLS="fetch_url" narrows tools/list to exactly fetch_url', async () => {
  const client = new McpStdioClient({ CRAWLFORGE_TOOLS: 'fetch_url' });

  try {
    await client.start();
  } catch (err) {
    assert.fail(`PENDING IMPLEMENTATION — server.js failed to start with CRAWLFORGE_TOOLS filter: ${err.message}`);
    return;
  }

  try {
    await initializeHandshake(client);
    const listResponse = await client.request('tools/list');
    assert.ok(!listResponse.error, `tools/list should not error; got ${JSON.stringify(listResponse.error)}`);
    const names = (listResponse.result?.tools || []).map((t) => t.name);
    assert.deepEqual(names, ['fetch_url'], `expected tools/list to contain exactly ['fetch_url']; got ${JSON.stringify(names)}`);
  } finally {
    await client.stop();
  }
});

test('Phase 6 (live server): CRAWLFORGE_TOOL_GROUPS="basic" narrows tools/list to exactly the 5 basic tools', async () => {
  const client = new McpStdioClient({ CRAWLFORGE_TOOL_GROUPS: 'basic' });

  try {
    await client.start();
  } catch (err) {
    assert.fail(`PENDING IMPLEMENTATION — server.js failed to start with CRAWLFORGE_TOOL_GROUPS filter: ${err.message}`);
    return;
  }

  try {
    await initializeHandshake(client);
    const listResponse = await client.request('tools/list');
    assert.ok(!listResponse.error, `tools/list should not error; got ${JSON.stringify(listResponse.error)}`);
    const names = (listResponse.result?.tools || []).map((t) => t.name).sort();
    const expected = ['extract_links', 'extract_metadata', 'extract_text', 'fetch_url', 'scrape_structured'].sort();
    assert.deepEqual(names, expected, `expected tools/list to contain exactly the 5 basic tools; got ${JSON.stringify(names)}`);
  } finally {
    await client.stop();
  }
});

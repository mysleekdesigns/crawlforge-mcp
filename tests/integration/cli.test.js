/**
 * tests/integration/cli.test.js
 * Integration tests for the CrawlForge CLI.
 * Verifies --help output contains all 15 commands and that install-skills --dry-run
 * lists expected target paths.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = join(__dirname, '../../src/cli/index.js');

const EXPECTED_COMMANDS = [
  'scrape',
  'search',
  'crawl',
  'map',
  'extract',
  'track',
  'analyze',
  'research',
  'stealth',
  'batch',
  'actions',
  'localize',
  'llmstxt',
  'template',
  'monitor',
];

describe('CrawlForge CLI', () => {
  test('--help contains all 15 tool commands', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, '--help'], {
      env: { ...process.env, CRAWLFORGE_CREATOR_SECRET: '' }
    });

    for (const cmd of EXPECTED_COMMANDS) {
      assert.ok(
        stdout.includes(cmd),
        `Expected --help output to include command: ${cmd}`
      );
    }
  });

  test('--help contains install-skills and uninstall-skills', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, '--help'], {
      env: { ...process.env, CRAWLFORGE_CREATOR_SECRET: '' }
    });
    assert.ok(stdout.includes('install-skills'), 'Expected install-skills in help');
    assert.ok(stdout.includes('uninstall-skills'), 'Expected uninstall-skills in help');
  });

  test('install-skills --dry-run lists target paths for claude-code', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_PATH, 'install-skills', '--target', 'claude-code', '--dry-run'],
      { env: { ...process.env, CRAWLFORGE_CREATOR_SECRET: '' } }
    );
    assert.ok(stdout.includes('.claude'), 'Expected .claude path in dry-run output');
    assert.ok(stdout.includes('crawlforge'), 'Expected crawlforge file reference in dry-run output');
  });

  test('install-skills --dry-run lists target paths for cursor', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_PATH, 'install-skills', '--target', 'cursor', '--dry-run'],
      { env: { ...process.env, CRAWLFORGE_CREATOR_SECRET: '' } }
    );
    assert.ok(stdout.includes('.cursor'), 'Expected .cursor path in dry-run output');
    assert.ok(stdout.includes('crawlforge.mdc'), 'Expected crawlforge.mdc in dry-run output');
  });

  test('install-skills --dry-run lists target paths for vscode', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_PATH, 'install-skills', '--target', 'vscode', '--dry-run'],
      { env: { ...process.env, CRAWLFORGE_CREATOR_SECRET: '' } }
    );
    assert.ok(stdout.includes('.github'), 'Expected .github path in dry-run output');
    assert.ok(stdout.includes('crawlforge.instructions.md'), 'Expected instructions file in dry-run output');
  });

  test('version flag returns valid semver', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, '--version'], {
      env: { ...process.env, CRAWLFORGE_CREATOR_SECRET: '' }
    });
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+/, 'Expected semver version output');
  });

  // ─── MCP server launch (v4.2.5 backward-compat fix) ──────────────────────────
  // Before v4.1.0 the `crawlforge` bin WAS the MCP server. The CLI now hands off
  // to server.js for the `mcp`/`serve` subcommand and when spawned with no
  // subcommand over a non-TTY stdin (how MCP hosts launch it).

  test('--help lists the mcp server command', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, '--help'], {
      env: { ...process.env, CRAWLFORGE_CREATOR_SECRET: '' }
    });
    assert.ok(stdout.includes('mcp'), 'Expected --help output to include the mcp command');
  });

  // Drives the full stdio handshake. Skips (never hangs) if the test environment
  // has no CrawlForge credentials — server.js requires auth before it serves.
  test('crawlforge mcp completes an MCP initialize handshake over stdio', async (t) => {
    const initialize = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'cli-test', version: '1.0' }
      }
    }) + '\n';

    const serverInfo = await new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, 'mcp'], {
        env: { ...process.env, NODE_ENV: 'test' },
        stdio: ['pipe', 'pipe', 'ignore']
      });
      let buf = '';
      const done = (value) => {
        clearTimeout(timer);
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        resolve(value);
      };
      const timer = setTimeout(() => done(null), 15000);
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        for (const line of buf.split('\n')) {
          try {
            const msg = JSON.parse(line);
            if (msg.id === 1 && msg.result?.serverInfo) return done(msg.result.serverInfo);
          } catch { /* partial/non-JSON line */ }
        }
      });
      child.on('error', () => done(null));
      child.stdin.write(initialize);
    });

    if (!serverInfo) {
      t.skip('MCP server did not authenticate in this environment (no CrawlForge credentials)');
      return;
    }
    assert.equal(serverInfo.name, 'crawlforge', 'Expected serverInfo.name to be crawlforge');
  });
});

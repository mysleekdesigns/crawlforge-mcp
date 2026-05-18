/**
 * tests/integration/cli.test.js
 * Integration tests for the CrawlForge CLI.
 * Verifies --help output contains all 15 commands and that install-skills --dry-run
 * lists expected target paths.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
});

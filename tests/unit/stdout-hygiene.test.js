/**
 * Regression test for v4.2.10 — stdout hygiene.
 *
 * Run: node --test tests/unit/stdout-hygiene.test.js
 *
 * stdout is reserved for the MCP JSON-RPC stream and the CLI's `--json` output.
 * Any `console.log(...)` in a tool/crawler execution path lands on stdout and
 * corrupts `--json` (v4.2.10 fixed 11 such leaks — most visibly the
 * `ScrapeWithActionsTool` "Starting scrape session …" banner that prefixed a
 * non-JSON line to `crawlforge actions --json`).
 *
 * This guard is a static source scan (no module imports, so no Playwright
 * handle is left open and the run exits cleanly): it fails if any
 * `console.log(` reappears in the execution-path sources. Diagnostics must use
 * `console.error` (stderr) or the Winston logger.
 *
 * Deliberately NOT scanned (stdout there is intentional / never hit during a
 * one-shot CLI tool run): src/cli/** (prints results), AuthManager interactive
 * setup, src/security/** standalone scripts, and graceful-shutdown logs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONSOLE_LOG = /\bconsole\.log\s*\(/;

/** Collect all .js files under a directory, recursively. */
function jsFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f));
}

/** Return files (relative to ROOT) under `targets` that contain console.log(. */
function offenders(targets) {
  const files = targets.flatMap((t) => {
    const abs = path.join(ROOT, t);
    return fs.statSync(abs).isDirectory() ? jsFiles(abs) : [abs];
  });
  return files
    .filter((abs) => CONSOLE_LOG.test(fs.readFileSync(abs, 'utf8')))
    .map((abs) => path.relative(ROOT, abs));
}

test('no console.log() in tool execution paths (would corrupt CLI --json)', () => {
  const found = offenders(['src/tools']);
  assert.deepEqual(
    found,
    [],
    `console.log() found in tool sources — use console.error (stderr). Offenders:\n  ${found.join('\n  ')}`
  );
});

test('no console.log() in browser/crawl/webhook core execution paths', () => {
  const found = offenders([
    'src/core/crawlers/BFSCrawler.js',
    'src/core/WebhookDispatcher.js',
    'src/core/StealthBrowserManager.js',
  ]);
  assert.deepEqual(
    found,
    [],
    `console.log() found in core execution paths — use console.error (stderr). Offenders:\n  ${found.join('\n  ')}`
  );
});

test('actions CLI fixture is a valid action script', () => {
  const fixture = path.join(ROOT, 'tests/fixtures/cli/actions-wait-screenshot.json');
  const actions = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const allowed = new Set(['wait', 'click', 'type', 'press', 'scroll', 'screenshot', 'executeJavaScript']);

  assert.ok(Array.isArray(actions) && actions.length > 0, 'fixture must be a non-empty array');
  for (const a of actions) {
    assert.ok(allowed.has(a.type), `unknown action type: ${a.type}`);
  }
});

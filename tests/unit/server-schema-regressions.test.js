/**
 * Source-level regression tests for server.js tool schemas (Phase 2 fixes).
 * Run: node --test tests/unit/server-schema-regressions.test.js
 *
 * server.js is not owned by this test area and must not be edited here; it
 * also starts an MCP stdio server as an import side effect, so these tests
 * read it as plain text (readFileSync) and assert on the schema source
 * rather than importing the module.
 *
 * Regressions covered:
 * C3 extract_content / summarize_content / analyze_content `options` schemas
 *    were `z.object({})` (strips unknown keys — silently dropping every
 *    caller-supplied option). Fixed to `.passthrough()`.
 * C1 generate_llms_txt `analysisOptions.checkSecurity` defaulted to `true`
 *    (probed /admin, /login, etc. on every generation run unless the caller
 *    explicitly opted out). Fixed to default `false`, opt-in.
 *    `probeRateLimit` (opt-in intrusive probing) was added alongside it.
 * `outputOptions.robotsStyle` was added so callers can request the legacy
 *    robots.txt-style output instead of the spec-compliant llms.txt.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverJsPath = join(__dirname, '..', '..', 'server.js');
const src = readFileSync(serverJsPath, 'utf8');

/**
 * Extract the source slice for a single server.registerTool("<name>", ...)
 * call, from its start marker up to the next registerTool call (or EOF).
 */
function extractToolBlock(toolName) {
  const startMarker = `server.registerTool("${toolName}"`;
  const startIdx = src.indexOf(startMarker);
  assert.ok(startIdx !== -1, `server.registerTool("${toolName}", ...) not found in server.js`);
  const nextIdx = src.indexOf('server.registerTool(', startIdx + startMarker.length);
  return src.slice(startIdx, nextIdx === -1 ? src.length : nextIdx);
}

describe('server.js — options schemas use .passthrough() (C3)', () => {
  for (const toolName of ['extract_content', 'summarize_content', 'analyze_content']) {
    test(`${toolName} options schema is z.object({}).passthrough()`, () => {
      const block = extractToolBlock(toolName);
      assert.match(
        block,
        /options:\s*z\.object\(\{\}\)\.passthrough\(\)\.optional\(\)/,
        `${toolName}'s options schema must use .passthrough() so extra option keys survive validation`
      );
    });
  }
});

describe('server.js — generate_llms_txt schema (C1)', () => {
  test('analysisOptions.checkSecurity defaults to false', () => {
    const block = extractToolBlock('generate_llms_txt');
    assert.match(
      block,
      /checkSecurity:\s*z\.boolean\(\)\.optional\(\)\.default\(false\)/,
      'checkSecurity must default to false (opt-in intrusive probing)'
    );
  });

  test('analysisOptions.probeRateLimit is exposed and defaults to false', () => {
    const block = extractToolBlock('generate_llms_txt');
    assert.match(
      block,
      /probeRateLimit:\s*z\.boolean\(\)\.optional\(\)\.default\(false\)/,
      'probeRateLimit must be present in the schema, defaulting to false'
    );
  });

  test('outputOptions.robotsStyle is exposed and defaults to false', () => {
    const block = extractToolBlock('generate_llms_txt');
    assert.match(
      block,
      /robotsStyle:\s*z\.boolean\(\)\.optional\(\)\.default\(false\)/,
      'outputOptions.robotsStyle must be present in the schema, defaulting to false'
    );
  });
});

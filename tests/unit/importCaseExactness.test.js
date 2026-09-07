/**
 * Every relative import must match the tracked filename EXACTLY, including case.
 *
 * Run: node --test tests/unit/importCaseExactness.test.js
 *
 * Defect (2026-09-07, found by CI): `src/cli/commands/login.js` imported
 * `../../core/authManager.js` while the tracked file is `AuthManager.js`.
 * macOS and Windows resolve that; Linux and Docker do not, so `crawlforge
 * login` died with ERR_MODULE_NOT_FOUND for every Linux user from 6.1.0 until
 * 6.3.1 — and because the whole test file failed at import, CI reported it as
 * one failing test with no assertion message, which is easy to read past.
 *
 * A developer on a case-insensitive filesystem cannot hit this at runtime, so
 * the check compares specifiers against `git ls-files` rather than the disk.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

const tracked = new Set(
  execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
);

// lowercase path -> the real tracked path, to tell "wrong case" from "absent".
const byLowerCase = new Map();
for (const file of tracked) {
  if (!byLowerCase.has(file.toLowerCase())) byLowerCase.set(file.toLowerCase(), file);
}

const SPECIFIER = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;

/** Tracked .js/.mjs sources that ship or run — tests included, they import src too. */
const sources = [...tracked].filter(
  file => /\.(js|mjs)$/.test(file) && !file.startsWith('node_modules/')
);

describe('relative imports resolve case-exactly (Linux and Docker are case-sensitive)', () => {
  test('every relative specifier matches a tracked file exactly', () => {
    const wrongCase = [];

    for (const file of sources) {
      const text = readFileSync(path.join(repoRoot, file), 'utf8');
      for (const match of text.matchAll(SPECIFIER)) {
        const specifier = match[1];
        const target = path.normalize(path.join(path.dirname(file), specifier));
        if (tracked.has(target)) continue;

        const real = byLowerCase.get(target.toLowerCase());
        // Only a case difference is a defect here. A specifier that matches
        // nothing at all is an extensionless or directory import, which Node
        // resolves by its own rules — not this test's business.
        if (real) {
          const line = text.slice(0, match.index).split('\n').length;
          wrongCase.push(`${file}:${line} imports "${specifier}" but the file is "${real}"`);
        }
      }
    }

    assert.deepEqual(wrongCase, [], `case-mismatched imports break on Linux:\n${wrongCase.join('\n')}`);
  });

  test('the sweep actually looked at something', () => {
    // A guard that silently scans zero files passes forever.
    assert.ok(sources.length > 300, `expected the repo's sources, scanned ${sources.length}`);
  });
});

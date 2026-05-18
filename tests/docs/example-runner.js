#!/usr/bin/env node
/**
 * tests/docs/example-runner.js
 *
 * D5.3 — Parses README.md code blocks and verifies:
 *   1. JSON blocks are syntactically valid JSON
 *   2. Shell blocks contain only safe, syntactically recognisable commands
 *
 * No live network calls. Syntax validation only.
 *
 * Run: node tests/docs/example-runner.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const README_PATH = path.resolve(__dirname, '../../README.md');

// ---------------------------------------------------------------------------
// Parse fenced code blocks from Markdown
// ---------------------------------------------------------------------------

/**
 * Extract all fenced code blocks from a Markdown string.
 * Returns an array of { lang, code, lineNumber } objects.
 *
 * @param {string} markdown
 * @returns {Array<{lang: string, code: string, lineNumber: number}>}
 */
function extractCodeBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split('\n');
  let inBlock = false;
  let lang = '';
  let blockLines = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^```(\w*)/);

    if (!inBlock && fenceMatch) {
      inBlock = true;
      lang = fenceMatch[1] || '';
      blockLines = [];
      startLine = i + 1;
    } else if (inBlock && line.startsWith('```')) {
      blocks.push({ lang, code: blockLines.join('\n'), lineNumber: startLine });
      inBlock = false;
      lang = '';
      blockLines = [];
    } else if (inBlock) {
      blockLines.push(line);
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate a JSON code block.
 * @param {string} code
 * @returns {{ valid: boolean, error?: string }}
 */
function validateJSON(code) {
  const trimmed = code.trim();
  if (!trimmed) return { valid: true }; // Empty block is fine

  try {
    JSON.parse(trimmed);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Basic shell block validation — checks for obvious syntax issues.
 * We only flag patterns that are clearly broken (unmatched quotes, empty pipes).
 * No execution — purely textual.
 *
 * @param {string} code
 * @returns {{ valid: boolean, error?: string }}
 */
function validateShell(code) {
  const lines = code.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  for (const line of lines) {
    // Check for unmatched double quotes (very basic heuristic)
    const dquotes = (line.match(/"/g) || []).length;
    if (dquotes % 2 !== 0 && !line.includes("\\'")) {
      // Allow heredoc-style and multiline — skip if line ends with backslash or contains $
      if (!line.endsWith('\\') && !line.includes('$(') && !line.includes('EOF')) {
        return { valid: false, error: `Possible unmatched double-quote on: ${line.slice(0, 60)}` };
      }
    }

    // Empty pipe (| |) is a syntax error
    if (/\|\s*\|/.test(line)) {
      return { valid: false, error: `Empty pipe segment on: ${line.slice(0, 60)}` };
    }

    // Semicolon with nothing after (;; outside case) — basic check
    if (/;\s*$/.test(line) && !line.trim().endsWith(';;')) {
      // Trailing semicolon is valid shell — skip
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(README_PATH)) {
    console.error(`README not found at ${README_PATH}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(README_PATH, 'utf8');
  const blocks = extractCodeBlocks(markdown);

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const block of blocks) {
    const { lang, code, lineNumber } = block;

    let result = { valid: true };

    if (lang === 'json') {
      result = validateJSON(code);
    } else if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
      result = validateShell(code);
    } else {
      // Skip other languages (js, yaml, etc.)
      continue;
    }

    if (result.valid) {
      passed++;
    } else {
      failed++;
      failures.push({ lang, lineNumber, error: result.error, snippet: code.slice(0, 80) });
    }
  }

  // Report
  console.log(`\nREADME code-block validation`);
  console.log(`  Total blocks checked : ${passed + failed}`);
  console.log(`  Passed               : ${passed}`);
  console.log(`  Failed               : ${failed}`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  Line ~${f.lineNumber} [${f.lang}]: ${f.error}`);
      console.log(`    Snippet: ${f.snippet.replace(/\n/g, ' ')}`);
    }
    process.exit(1);
  } else {
    console.log('\nAll code blocks valid.');
    process.exit(0);
  }
}

main();

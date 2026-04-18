/**
 * Unit tests for src/core/endpointGuard.js
 *
 * Run: node --test tests/unit/endpointGuard.test.js
 *
 * Agent A owns the implementation; these tests define the contract.
 * Tests will fail until Agent A's implementation is merged.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Dynamic import so we can run this file even before Agent A's file exists
// (it will just fail with a module-not-found error instead of a syntax error)
let resolveApiEndpoint;
let ALLOWED_HOSTS;

try {
  const mod = await import('../../src/core/endpointGuard.js');
  resolveApiEndpoint = mod.resolveApiEndpoint;
  ALLOWED_HOSTS = mod.ALLOWED_HOSTS;
} catch (err) {
  // Module not yet written by Agent A — all tests will fail with a clear message.
  resolveApiEndpoint = () => { throw new Error('endpointGuard.js not yet implemented'); };
  ALLOWED_HOSTS = [];
}

// ---------------------------------------------------------------------------
// 1. ALLOWED_HOSTS export shape
// ---------------------------------------------------------------------------

test('ALLOWED_HOSTS contains exactly the three expected hosts', () => {
  const expected = ['www.crawlforge.dev', 'crawlforge.dev', 'api.crawlforge.dev'];
  assert.deepEqual(
    [...ALLOWED_HOSTS].sort(),
    [...expected].sort(),
    'ALLOWED_HOSTS must contain www.crawlforge.dev, crawlforge.dev, and api.crawlforge.dev'
  );
});

// ---------------------------------------------------------------------------
// 2. Passing cases — allowed hosts over HTTPS
// ---------------------------------------------------------------------------

test('resolveApiEndpoint accepts https://www.crawlforge.dev', () => {
  const result = resolveApiEndpoint('https://www.crawlforge.dev');
  assert.equal(typeof result, 'string', 'should return a string');
  assert.ok(result.length > 0, 'returned string must not be empty');
});

test('resolveApiEndpoint accepts https://crawlforge.dev', () => {
  const result = resolveApiEndpoint('https://crawlforge.dev');
  assert.equal(typeof result, 'string', 'should return a string');
});

test('resolveApiEndpoint accepts https://api.crawlforge.dev', () => {
  const result = resolveApiEndpoint('https://api.crawlforge.dev');
  assert.equal(typeof result, 'string', 'should return a string');
});

// ---------------------------------------------------------------------------
// 3. Rejecting cases
// ---------------------------------------------------------------------------

test('resolveApiEndpoint throws for http:// variant of an allowed host (non-https)', () => {
  assert.throws(
    () => resolveApiEndpoint('http://www.crawlforge.dev'),
    /allow-list|not in allow|refused|https/i,
    'should throw when protocol is http instead of https'
  );
});

test('resolveApiEndpoint throws for a host not in the allow-list', () => {
  assert.throws(
    () => resolveApiEndpoint('https://evil.example.com'),
    /allow-list|not in allow|refused/i,
    'should throw for a host outside the allow-list'
  );
});

test('resolveApiEndpoint throws for an unparseable string', () => {
  assert.throws(
    () => resolveApiEndpoint('not-a-url'),
    Error,
    'should throw when the input cannot be parsed as a URL'
  );
});

test('resolveApiEndpoint throws for http://localhost:8888 when creator mode is OFF', () => {
  // Ensure no creator-mode env var is set so isCreatorModeVerified() returns false.
  // Store and strip the variable if it happens to be set in the test environment.
  const savedSecret = process.env.CRAWLFORGE_CREATOR_SECRET;
  delete process.env.CRAWLFORGE_CREATOR_SECRET;

  try {
    assert.throws(
      () => resolveApiEndpoint('http://localhost:8888'),
      /allow-list|not in allow|refused/i,
      'localhost must be rejected when creator mode is not active'
    );
  } finally {
    if (savedSecret !== undefined) {
      process.env.CRAWLFORGE_CREATOR_SECRET = savedSecret;
    }
  }
});

// TODO: verify with creator secret
// test('resolveApiEndpoint allows http://localhost when creator mode is ON', () => {
//   // Cannot cleanly stub isCreatorModeVerified() without dependency injection
//   // because it reads a hashed env var synchronously.  Add once Agent A exposes
//   // a test seam (e.g. an exported setter or a second parameter to resolveApiEndpoint).
// });

/**
 * Unit tests for src/utils/fetchIdentity.js
 *
 * Phase 0 (0.1–0.3): nine tools used to hardcode nine different User-Agents,
 * so nine tools saw nine different versions of the same page. There is now one
 * canonical identity, and a per-request override for callers who have their
 * own agreement with a target.
 *
 * Run: node --test tests/unit/fetchIdentity.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  CRAWLFORGE_USER_AGENT,
  serviceUserAgent,
  resolveUserAgent,
  identityHeaders
} from '../../src/utils/fetchIdentity.js';

const pkg = createRequire(import.meta.url)('../../package.json');

describe('fetchIdentity — the canonical identity', () => {
  test('is the product name, the released version and a contact URL', () => {
    assert.equal(CRAWLFORGE_USER_AGENT, `CrawlForge/${pkg.version} (+https://crawlforge.dev)`);
    assert.match(CRAWLFORGE_USER_AGENT, /^CrawlForge\/\d+\.\d+\.\d+ \(\+https:\/\/crawlforge\.dev\)$/);
  });

  test('a service role is appended without losing the name or contact URL', () => {
    assert.equal(serviceUserAgent('webhook'), `CrawlForge/${pkg.version} (+https://crawlforge.dev; webhook)`);
    assert.equal(serviceUserAgent(''), CRAWLFORGE_USER_AGENT);
    assert.equal(serviceUserAgent(), CRAWLFORGE_USER_AGENT);
  });
});

describe('fetchIdentity — per-request override (0.3)', () => {
  test('a caller-supplied User-Agent wins', () => {
    assert.equal(resolveUserAgent('AcmeBot/2.0 (+https://acme.example)'), 'AcmeBot/2.0 (+https://acme.example)');
  });

  test('the override wins over a role as well', () => {
    assert.equal(resolveUserAgent('AcmeBot/2.0', 'webhook'), 'AcmeBot/2.0');
  });

  test('no override applies the canonical identity', () => {
    assert.equal(resolveUserAgent(), CRAWLFORGE_USER_AGENT);
    assert.equal(resolveUserAgent(undefined), CRAWLFORGE_USER_AGENT);
  });

  test('a blank or whitespace-only override falls back to the canonical identity', () => {
    assert.equal(resolveUserAgent(''), CRAWLFORGE_USER_AGENT);
    assert.equal(resolveUserAgent('   '), CRAWLFORGE_USER_AGENT);
    assert.equal(resolveUserAgent('\t\n'), CRAWLFORGE_USER_AGENT);
  });

  test('a non-string override is ignored rather than stringified', () => {
    assert.equal(resolveUserAgent(null), CRAWLFORGE_USER_AGENT);
    assert.equal(resolveUserAgent(42), CRAWLFORGE_USER_AGENT);
  });
});

describe('fetchIdentity — identityHeaders', () => {
  test('returns the header, so no call site spells "User-Agent" itself', () => {
    assert.deepEqual(identityHeaders(), { 'User-Agent': CRAWLFORGE_USER_AGENT });
    assert.deepEqual(identityHeaders({}), { 'User-Agent': CRAWLFORGE_USER_AGENT });
  });

  test('carries the override and the role through', () => {
    assert.deepEqual(identityHeaders({ userAgent: 'AcmeBot/2.0' }), { 'User-Agent': 'AcmeBot/2.0' });
    assert.deepEqual(identityHeaders({ role: 'webhook' }), { 'User-Agent': serviceUserAgent('webhook') });
  });
});

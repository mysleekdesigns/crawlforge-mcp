/**
 * Unit tests for the host memory in src/utils/hostRateLimiter.js (Phase 0, 0.6).
 *
 * The per-host state now remembers the bot-defence vendor that last walled a
 * host, with a TTL, and the map is bounded so a long-running server that has
 * touched every host on the web does not grow without limit. The scrape
 * verdict writes it (tests/unit/scrapeBlockedVerdict.test.js); Phase 3 reads
 * it. Time is passed in so nothing here waits.
 *
 * Run: node --test tests/unit/hostMemory.test.js
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  HOST_STATE_MAX,
  noteHostBlocked,
  clearHostBlocked,
  getHostBlock,
  getHostBackoffMs,
  noteRetryAfter,
  _resetHostRateLimiter
} from '../../src/utils/hostRateLimiter.js';

const NOW = 1_700_000_000_000;

beforeEach(() => {
  _resetHostRateLimiter();
});

test('a noted block is readable by host with its vendor and expiry', () => {
  noteHostBlocked('https://www.example.com/a', 'cloudflare', { now: NOW });
  const block = getHostBlock('https://www.example.com/other-path', NOW + 1);
  assert.deepEqual(block, { vendor: 'cloudflare', blockedUntil: NOW + 24 * 60 * 60 * 1000 });
  assert.equal(getHostBlock('https://other.example.com/', NOW + 1), null);
});

test('the block expires at ttlMs and an unknown URL is null', () => {
  noteHostBlocked('https://www.example.com/', 'datadome', { ttlMs: 1000, now: NOW });
  assert.equal(getHostBlock('https://www.example.com/', NOW + 999).vendor, 'datadome');
  assert.equal(getHostBlock('https://www.example.com/', NOW + 1000), null);
  assert.equal(getHostBlock('not a url', NOW), null);
});

test('a later note overwrites the vendor; clear forgets it', () => {
  noteHostBlocked('https://www.example.com/', 'akamai', { now: NOW });
  noteHostBlocked('https://www.example.com/', 'perimeterx', { now: NOW });
  assert.equal(getHostBlock('https://www.example.com/', NOW).vendor, 'perimeterx');
  clearHostBlocked('https://www.example.com/');
  assert.equal(getHostBlock('https://www.example.com/', NOW), null);
  clearHostBlocked('https://never-seen.example.com/'); // no-op, must not throw
});

test('the block lives beside the Retry-After backoff without disturbing it', () => {
  noteRetryAfter('https://www.example.com/', '60');
  noteHostBlocked('https://www.example.com/', 'vercel', { now: NOW });
  assert.ok(getHostBackoffMs('https://www.example.com/') > 0);
  clearHostBlocked('https://www.example.com/');
  assert.ok(getHostBackoffMs('https://www.example.com/') > 0);
});

test('the map is bounded: the least recently touched host is dropped past the cap', () => {
  assert.equal(HOST_STATE_MAX, 1000);
  for (let i = 0; i < HOST_STATE_MAX; i++) {
    noteHostBlocked(`https://h${i}.example/`, 'cloudflare', { now: NOW });
  }
  assert.equal(getHostBlock('https://h0.example/', NOW).vendor, 'cloudflare');

  // Touching h0 moves it to the fresh end, so the next insert evicts h1.
  noteHostBlocked('https://h0.example/', 'cloudflare', { now: NOW });
  noteHostBlocked('https://overflow.example/', 'amazon', { now: NOW });
  assert.equal(getHostBlock('https://h0.example/', NOW).vendor, 'cloudflare');
  assert.equal(getHostBlock('https://h1.example/', NOW), null);
  assert.equal(getHostBlock('https://h2.example/', NOW).vendor, 'cloudflare');
  assert.equal(getHostBlock('https://overflow.example/', NOW).vendor, 'amazon');
});

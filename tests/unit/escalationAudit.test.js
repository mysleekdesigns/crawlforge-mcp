/**
 * Stealth review Phase 7, owner decision D: every path that presents a browser
 * identity writes a compliance audit row, the way `respect_robots: false`
 * already does. The three paths are `scrape` escalate:true and the agent's
 * automatic stealth retry (both the stealthEscalation stage in server.js) and
 * `stealth_mode` (operation scrape, and create_page with urlToTest).
 *
 * The helper is exercised directly; the server.js wiring is checked by source
 * inspection (importing server.js starts a server), the same way
 * scrapeEscalation.test.js holds the gate-before-render order.
 *
 * Run: node --test --test-force-exit tests/unit/escalationAudit.test.js
 */

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  recordStealthEscalation,
  setComplianceAuditSink,
  _resetComplianceAudit,
  getComplianceAuditRows,
  apiKeyId
} from '../../src/utils/complianceAudit.js';

const KEY = 'cf_live_supersecretkey_0123456789';
const OWNER = 'owner-token-for-website-customer-42';

describe('recordStealthEscalation', () => {
  let sunk;
  beforeEach(() => {
    _resetComplianceAudit();
    sunk = [];
    setComplianceAuditSink((row) => { sunk.push(row); });
  });
  after(() => _resetComplianceAudit());

  test('writes a stealth_escalation row naming url, tool, engine and a key digest', async () => {
    const row = recordStealthEscalation({
      url: 'https://example.com/a', tool: 'scrape', engine: 'camoufox', apiKey: KEY
    });
    assert.equal(row.event, 'stealth_escalation');
    assert.equal(row.url, 'https://example.com/a');
    assert.equal(row.tool, 'scrape');
    assert.equal(row.engine, 'camoufox');
    assert.equal(row.apiKeyId, apiKeyId(KEY));
    assert.ok(row.timestamp);
    assert.equal('ownerId' in row, false, 'no owner token, no ownerId');
    assert.deepEqual(getComplianceAuditRows().at(-1), row);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(sunk, [row], 'and it reaches the sink');
  });

  test('an owner token adds ownerId as a digest; neither raw secret is in the row', () => {
    const row = recordStealthEscalation({
      url: 'https://example.com/b', tool: 'agent', engine: 'chromium', apiKey: KEY, ownerToken: OWNER
    });
    assert.equal(row.ownerId, apiKeyId(OWNER));
    assert.notEqual(row.ownerId, row.apiKeyId);
    const text = JSON.stringify(row);
    assert.equal(text.includes(KEY), false, 'raw API key is never stored');
    assert.equal(text.includes(OWNER), false, 'raw owner token is never stored');
  });

  test('no key records anonymous; a missing engine records null', () => {
    const row = recordStealthEscalation({ url: 'https://example.com/c', tool: 'stealth_mode' });
    assert.equal(row.apiKeyId, 'anonymous');
    assert.equal(row.engine, null);
    assert.equal('ownerId' in row, false);
  });

  test('a throwing sink does not make the helper throw', async () => {
    setComplianceAuditSink(() => { throw new Error('disk full'); });
    assert.doesNotThrow(() => recordStealthEscalation({
      url: 'https://example.com/d', tool: 'scrape', engine: 'chromium', apiKey: KEY
    }));
    setComplianceAuditSink(async () => { throw new Error('async disk full'); });
    assert.doesNotThrow(() => recordStealthEscalation({
      url: 'https://example.com/e', tool: 'scrape', engine: 'chromium', apiKey: KEY
    }));
    await new Promise((r) => setImmediate(r)); // an unhandled rejection would fail the run
  });
});

describe('server.js records the row on exactly the owner-named paths', () => {
  const src = readFileSync(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');
  const RECORD = 'recordStealthEscalation(';

  const ordered = (slice, before, marker, afterMarkers) => {
    const at = slice.indexOf(marker);
    assert.ok(at > 0, `${marker} is present`);
    for (const b of afterMarkers) {
      const bAt = slice.indexOf(b);
      assert.ok(bAt >= 0 && bAt < at, `${marker} comes after ${b}`);
    }
    const beforeAt = slice.indexOf(before);
    assert.ok(beforeAt > at, `${marker} comes before ${before}`);
  };

  test('stealthEscalation: gate, then an impit row before the impit try, then resolver, row, render', () => {
    const start = src.indexOf('const stealthEscalation = async');
    assert.ok(start > 0);
    const stage = src.slice(start, src.indexOf('\n};', start));
    // Phase 7: the impit try presents a Chrome TLS handshake, so it gets its
    // own row, after the gate and before the request goes out.
    ordered(stage, 'impitFetchPage(', RECORD, ['stealthComplianceGate(']);
    assert.match(stage.slice(stage.indexOf(RECORD)), /^recordStealthEscalation\(\{[^}]*engine:\s*IMPIT_ENGINE/, 'the impit row names impit');
    // The browser row: after the resolver, before the render.
    const browser = stage.slice(stage.indexOf('resolveStealthEngine('));
    ordered(browser, 'scrapeWithStealth(', RECORD, ['resolveStealthEngine(']);
    assert.match(browser.slice(browser.indexOf(RECORD)), /engine:\s*resolved\.engine/, 'the resolved engine');
  });

  test('the injections name the real tool', () => {
    assert.match(src, /escalateScrape:\s*\(args\)\s*=>\s*stealthEscalation\(\{\s*\.\.\.args,\s*tool:\s*'scrape'\s*\}\)/);
    assert.match(src, /escalateFetch:\s*\(args\)\s*=>\s*stealthEscalation\(\{\s*\.\.\.args,\s*tool:\s*'agent'\s*\}\)/);
  });

  test('stealth_mode scrape and create_page record after the gate, before the browser acts', () => {
    const handler = src.slice(src.indexOf('withAuth("stealth_mode"'));
    const caseBody = (name) => {
      const start = handler.indexOf(`case '${name}':`);
      assert.ok(start >= 0, `case '${name}' exists`);
      return handler.slice(start, handler.indexOf('\n      case ', start + 1));
    };
    ordered(caseBody('scrape'), 'scrapeWithStealth(', RECORD, ['stealthComplianceGate(', 'resolveStealthEngine(']);

    const pageCase = caseBody('create_page');
    ordered(pageCase, 'safeGoto(', RECORD, ['stealthComplianceGate(']);
  });

  test('no other path in server.js writes the row', () => {
    const calls = src.split(RECORD).length - 1;
    assert.equal(calls, 4, 'stealthEscalation (impit try and browser), stealth_mode scrape, stealth_mode create_page');
  });
});

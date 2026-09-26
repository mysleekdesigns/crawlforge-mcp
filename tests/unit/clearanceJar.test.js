/**
 * Phase 4 of docs/STEALTH_REVIEW_2026-09.md: a challenge solved once is not
 * solved again for its lifetime. The jar's rules (only clearance cookies, keyed
 * on engine + User-Agent + proxy exit, bounded, persisted 0600) and its wiring
 * into StealthBrowserManager (replay on create, harvest on close, discard on a
 * render that still met the wall). Nothing here launches a browser.
 *
 * Run: node --test --test-force-exit tests/unit/clearanceJar.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

import {
  ClearanceJar,
  sharedClearanceJar,
  MAX_TTL_MS,
  SESSION_TTL_MS,
  MAX_KEYS
} from '../../src/core/ClearanceJar.js';
import { StealthBrowserManager } from '../../src/core/StealthBrowserManager.js';

const NOW = 1_800_000_000_000; // fixed clock, ms
const nowS = NOW / 1000;
const clock = () => NOW;

const cookie = (name, extra = {}) => ({
  name,
  value: `${name}-value`,
  domain: '.example.com',
  path: '/',
  expires: nowS + 3600,
  httpOnly: true,
  secure: true,
  sameSite: 'None',
  ...extra
});

const KEY = ClearanceJar.keyFor({ engine: 'chromium', userAgent: 'UA/1', proxy: null });

const tmpFile = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clearance-jar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'nested', 'stealth-clearance.json');
};

describe('what the jar keeps', () => {
  test('only the vendors\' clearance cookies — never a login, cart or preference cookie', () => {
    const jar = new ClearanceJar({ file: null, now: clock });
    const kept = jar.store(KEY, [
      cookie('cf_clearance'), cookie('__cf_bm'), cookie('datadome'),
      cookie('session_id'), cookie('logged_in'), cookie('cf_clearance_x')
    ]);
    assert.equal(kept, 3);
    assert.deepEqual(jar.cookiesFor(KEY).map((c) => c.name).sort(), ['__cf_bm', 'cf_clearance', 'datadome']);
  });

  test('expiry is the vendor\'s, capped at MAX_TTL_MS; a session cookie gets SESSION_TTL_MS', () => {
    const jar = new ClearanceJar({ file: null, now: clock });
    jar.store(KEY, [
      cookie('cf_clearance', { expires: nowS + 365 * 86400 }),
      cookie('__cf_bm', { expires: -1 }),
      cookie('datadome', { expires: nowS - 1 })
    ]);
    const byName = Object.fromEntries(jar.cookiesFor(KEY).map((c) => [c.name, c]));
    assert.equal(byName.cf_clearance.expires, Math.floor((NOW + MAX_TTL_MS) / 1000));
    assert.equal(byName.__cf_bm.expires, Math.floor((NOW + SESSION_TTL_MS) / 1000));
    assert.equal(byName.datadome, undefined, 'an already-expired cookie is not kept');
  });

  test('a cookie that expires is no longer handed out', () => {
    let now = NOW;
    const jar = new ClearanceJar({ file: null, now: () => now });
    jar.store(KEY, [cookie('cf_clearance', { expires: nowS + 60 })]);
    assert.equal(jar.cookiesFor(KEY).length, 1);
    now += 61_000;
    assert.equal(jar.cookiesFor(KEY).length, 0);
  });

  test('discard drops the host and its subdomains, and nothing else', () => {
    const jar = new ClearanceJar({ file: null, now: clock });
    jar.store(KEY, [
      cookie('cf_clearance'),
      cookie('cf_clearance', { domain: 'other.org' })
    ]);
    assert.equal(jar.discard(KEY, 'www.example.com'), 1);
    assert.deepEqual(jar.cookiesFor(KEY).map((c) => c.domain), ['other.org']);
    assert.equal(jar.discard(KEY, 'notexample.com'), 0, 'a suffix that is not a subdomain does not match');
  });
});

describe('the key a clearance is bound to', () => {
  test('differs by engine, User-Agent and proxy exit', () => {
    const base = { engine: 'chromium', userAgent: 'UA/1', proxy: { server: 'http://p:1', username: 'a' } };
    const k = ClearanceJar.keyFor(base);
    assert.notEqual(k, ClearanceJar.keyFor({ ...base, engine: 'camoufox' }));
    assert.notEqual(k, ClearanceJar.keyFor({ ...base, userAgent: 'UA/2' }));
    assert.notEqual(k, ClearanceJar.keyFor({ ...base, proxy: { server: 'http://p:2', username: 'a' } }));
    assert.notEqual(k, ClearanceJar.keyFor({ ...base, proxy: { server: 'http://p:1', username: 'b' } }));
    assert.notEqual(k, ClearanceJar.keyFor({ ...base, proxy: null }), 'a proxied clearance is never replayed direct');
  });

  test('ignores the proxy password, and names nothing in clear', () => {
    const a = ClearanceJar.keyFor({ engine: 'chromium', userAgent: 'UA/1', proxy: { server: 'http://p:1', username: 'u', password: 'x' } });
    const b = ClearanceJar.keyFor({ engine: 'chromium', userAgent: 'UA/1', proxy: { server: 'http://p:1', username: 'u', password: 'y' } });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  test('is null — nothing stored or replayed — when the User-Agent is unknown', () => {
    assert.equal(ClearanceJar.keyFor({ engine: 'camoufox', userAgent: null }), null);
    const jar = new ClearanceJar({ file: null, now: clock });
    assert.equal(jar.store(null, [cookie('cf_clearance')]), 0);
    assert.deepEqual(jar.cookiesFor(null), []);
  });
});

describe('persistence and bounds', () => {
  test('round-trips through the file, written 0600', (t) => {
    const file = tmpFile(t);
    new ClearanceJar({ file, now: clock }).store(KEY, [cookie('cf_clearance')]);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
    const reloaded = new ClearanceJar({ file, now: clock });
    assert.equal(reloaded.cookiesFor(KEY)[0].value, 'cf_clearance-value');
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /UA\/1/, 'the persona is not written in clear');
  });

  test('writes nothing when there is nothing to keep, and ignores a corrupt file', (t) => {
    const file = tmpFile(t);
    const jar = new ClearanceJar({ file, now: clock });
    jar.store(KEY, [cookie('session_id')]);
    assert.equal(fs.existsSync(file), false);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not json');
    assert.deepEqual(new ClearanceJar({ file, now: clock }).cookiesFor(KEY), []);
  });

  test('holds at most MAX_KEYS identities, evicting the oldest', () => {
    const jar = new ClearanceJar({ file: null, now: clock });
    const keys = [];
    for (let i = 0; i <= MAX_KEYS; i++) {
      const key = ClearanceJar.keyFor({ engine: 'chromium', userAgent: `UA/${i}` });
      keys.push(key);
      jar.store(key, [cookie('cf_clearance')]);
    }
    assert.equal(jar.cookiesFor(keys[0]).length, 0, 'the oldest identity was evicted');
    assert.equal(jar.cookiesFor(keys[MAX_KEYS]).length, 1);
  });

  test('CRAWLFORGE_CLEARANCE_JAR=off turns the shared jar off', (t) => {
    const old = process.env.CRAWLFORGE_CLEARANCE_JAR;
    t.after(() => {
      if (old === undefined) delete process.env.CRAWLFORGE_CLEARANCE_JAR;
      else process.env.CRAWLFORGE_CLEARANCE_JAR = old;
    });
    process.env.CRAWLFORGE_CLEARANCE_JAR = 'off';
    assert.equal(sharedClearanceJar(), null);
    assert.equal(new StealthBrowserManager().clearanceJar, null);
  });
});

// ── wiring into StealthBrowserManager ──────────────────────────────────────

/** A context that records addCookies and answers cookies() with `jarCookies`. */
const fakeContext = (jarCookies) => {
  const target = { added: [], closed: false, initScripts: [] };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'then') return undefined;
      if (prop === 'addCookies') return async (cookies) => { t.added.push(...cookies); };
      if (prop === 'cookies') return async () => (typeof jarCookies === 'function' ? jarCookies() : jarCookies);
      if (prop === 'close') return async () => { t.closed = true; };
      if (prop === 'addInitScript') return async (fn, arg) => { t.initScripts.push({ fn, arg }); };
      return async () => [];
    }
  });
};

const stubChromium = (t, contextCookies) => {
  const real = chromium.launch;
  const contexts = [];
  chromium.launch = async () => ({
    version: () => '151.0.7922.34',
    on: () => {},
    isConnected: () => true,
    close: async () => {},
    process: () => null,
    newContext: async () => {
      const context = fakeContext(contextCookies());
      contexts.push(context);
      return context;
    }
  });
  t.after(() => { chromium.launch = real; });
  return contexts;
};

describe('StealthBrowserManager replays and harvests clearances', () => {
  test('a closed context\'s clearances are replayed into the next context with the same identity', async (t) => {
    const jar = new ClearanceJar({ file: null, now: Date.now });
    const earned = [cookie('cf_clearance', { expires: Date.now() / 1000 + 3600 }), cookie('session_id')];
    const contexts = stubChromium(t, () => earned);
    const manager = new StealthBrowserManager({ clearanceJar: jar });
    t.after(() => manager.cleanup());

    const first = await manager.createStealthContext({ engine: 'chromium' });
    assert.equal(contexts[0].added.length, 0, 'the first context starts cold');
    await manager.closeContext(first.contextId);

    await manager.createStealthContext({ engine: 'chromium' });
    assert.deepEqual(contexts[1].added.map((c) => c.name), ['cf_clearance'],
      'only the clearance cookie is replayed; the site\'s session cookie is not');
  });

  test('a host the render was still blocked on is discarded, not kept', async (t) => {
    const jar = new ClearanceJar({ file: null, now: Date.now });
    stubChromium(t, () => [cookie('cf_clearance', { expires: Date.now() / 1000 + 3600 })]);
    const manager = new StealthBrowserManager({ clearanceJar: jar });
    t.after(() => manager.cleanup());

    const { contextId } = await manager.createStealthContext({ engine: 'chromium' });
    const key = manager.contexts.get(contextId).jarKey;
    manager._markBlocked(contextId, ['https://www.example.com/page']);
    await manager.closeContext(contextId);
    assert.deepEqual(jar.cookiesFor(key), []);
  });

  test('with the jar off, nothing is replayed or read', async (t) => {
    let reads = 0;
    const contexts = stubChromium(t, () => () => { reads++; return []; });
    const manager = new StealthBrowserManager({ clearanceJar: null });
    t.after(() => manager.cleanup());
    const { contextId } = await manager.createStealthContext({ engine: 'chromium' });
    await manager.closeContext(contextId);
    assert.equal(contexts[0].added.length, 0);
    assert.equal(reads, 0, 'cookies() is never read with the jar off');
  });
});

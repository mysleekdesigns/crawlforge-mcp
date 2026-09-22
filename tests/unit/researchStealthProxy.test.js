/**
 * Regression tests: the proxy deep_research's stealth fallback launches behind.
 *
 * Run: node --test --test-force-exit tests/unit/researchStealthProxy.test.js
 *
 * _getStealthBrowser() launches Camoufox directly, bypassing
 * StealthBrowserManager, so it does NOT inherit that manager's proxy fallback:
 * without the wiring below the fallback ran proxyless while the caller believed
 * their traffic was proxied. These pin the resolution only — no browser is
 * launched — and the credential-leak guard, which is why the resolver validates
 * the entry itself instead of letting camoufox's `new URL()` quote it.
 *
 * P1 no proxy configured anywhere -> null
 * P2 server-level CRAWLFORGE_STEALTH_PROXIES reaches the fallback
 * P3 a caller-supplied list wins over the server-level one
 * P4 the resolved URL keeps its credentials; the loggable form drops them
 * P5 a bare host:port entry is given the scheme every proxy list assumes
 * P6 a malformed entry throws without echoing the password
 * P7 one browser, one proxy: the first entry, never rotated underneath
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Set before the import so the assertion holds whether the shared
// serverStealthProxies() reads the environment at call time or at module load.
const SERVER_PROXY = 'http://srv-user:srv-pass@proxy.server.example:8080';
process.env.CRAWLFORGE_STEALTH_PROXIES = SERVER_PROXY;

const { ResearchOrchestrator } = await import('../../src/core/ResearchOrchestrator.js');

describe('P1 no proxy configured', () => {
  test('resolves to null', () => {
    const orch = new ResearchOrchestrator({ stealthProxies: [] });
    assert.equal(orch._resolveStealthProxy(), null);
  });
});

describe('P2 server-level proxy', () => {
  test('CRAWLFORGE_STEALTH_PROXIES is the default when the caller passes none', () => {
    const orch = new ResearchOrchestrator({});
    assert.deepEqual(orch.stealthProxies, [SERVER_PROXY]);
    assert.equal(orch._resolveStealthProxy().url, SERVER_PROXY);
  });
});

describe('P3 caller wins', () => {
  test('a caller-supplied list overrides the server-level one', () => {
    const caller = 'http://caller:secret@proxy.caller.example:3128';
    const orch = new ResearchOrchestrator({ stealthProxies: [caller] });
    assert.equal(orch._resolveStealthProxy().url, caller);
  });
});

describe('P4 credentials', () => {
  test('the launched URL keeps them, the logged form does not', () => {
    const orch = new ResearchOrchestrator({});
    const proxy = orch._resolveStealthProxy();
    assert.match(proxy.url, /srv-pass/, 'camoufox needs the credentials to authenticate');
    assert.equal(proxy.redacted, 'http://proxy.server.example:8080');
    assert.doesNotMatch(proxy.redacted, /srv-user|srv-pass/);
  });
});

describe('P5 bare host:port', () => {
  test('gets http://', () => {
    const orch = new ResearchOrchestrator({ stealthProxies: ['proxy.example.com:3128'] });
    const proxy = orch._resolveStealthProxy();
    assert.equal(proxy.url, 'http://proxy.example.com:3128');
    assert.equal(proxy.redacted, 'http://proxy.example.com:3128');
  });

  test('socks5 is accepted as-is', () => {
    const orch = new ResearchOrchestrator({ stealthProxies: ['socks5://u:p@10.0.0.9:1080'] });
    assert.equal(orch._resolveStealthProxy().redacted, 'socks5://10.0.0.9:1080');
  });
});

describe('P6 malformed entries', () => {
  test('an unparseable entry throws without quoting the password', () => {
    const orch = new ResearchOrchestrator({ stealthProxies: ['http://user:hunter2@:'] });
    assert.throws(() => orch._resolveStealthProxy(), (err) => {
      assert.doesNotMatch(err.message, /hunter2/, 'the error must not carry the password');
      assert.match(err.message, /Invalid stealth proxy/);
      return true;
    });
  });

  test('an unsupported scheme is rejected', () => {
    const orch = new ResearchOrchestrator({ stealthProxies: ['ftp://user:hunter2@proxy.example.com:21'] });
    assert.throws(() => orch._resolveStealthProxy(), (err) => {
      assert.doesNotMatch(err.message, /hunter2/);
      assert.match(err.message, /scheme "ftp"/);
      return true;
    });
  });
});

describe('P7 one browser, one proxy', () => {
  test('always the first entry — camoufox fixes its persona at launch', () => {
    const orch = new ResearchOrchestrator({
      stealthProxies: ['http://a.example:8080', 'http://b.example:8080']
    });
    assert.equal(orch._resolveStealthProxy().url, 'http://a.example:8080');
    assert.equal(orch._resolveStealthProxy().url, 'http://a.example:8080');
  });
});

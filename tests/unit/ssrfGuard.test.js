/**
 * SSRF guard (v4.8) — wires SSRF protection into the live fetch path.
 * Run: node --test tests/unit/ssrfGuard.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ssrfGuard,
  safeFetch,
  safeGoto,
  ipBlocked,
  isSsrfError,
  assertUrlAllowed,
  __ssrfInternals,
} from '../../src/utils/ssrfGuard.js';

const ssrfGuardUrl = new URL('../../src/utils/ssrfGuard.js', import.meta.url).href;

describe('ssrfGuard.ipBlocked (stage 1, default)', () => {
  test('blocks loopback / link-local / metadata / 0.0.0.0', () => {
    assert.equal(ipBlocked('127.0.0.1'), true);
    assert.equal(ipBlocked('127.5.5.5'), true);
    assert.equal(ipBlocked('169.254.169.254'), true); // cloud metadata
    assert.equal(ipBlocked('0.0.0.0'), true);
    assert.equal(ipBlocked('::1'), true);
  });
  test('allows public addresses', () => {
    assert.equal(ipBlocked('8.8.8.8'), false);
    assert.equal(ipBlocked('1.1.1.1'), false);
  });
  test('stage 1 lets private RFC1918 through (only strict mode blocks them)', () => {
    assert.equal(ipBlocked('10.0.0.5'), false);
    assert.equal(ipBlocked('192.168.1.10'), false);
  });
  test('blocks IPv4-mapped/compatible IPv6 loopback and metadata addresses', () => {
    assert.equal(ipBlocked('::ffff:127.0.0.1'), true);
    assert.equal(ipBlocked('::ffff:169.254.169.254'), true);
    assert.equal(ipBlocked('0:0:0:0:0:ffff:7f00:1'), true); // fully-expanded 127.0.0.1
  });
  test('does not false-positive on a mapped public address', () => {
    assert.equal(ipBlocked('::ffff:8.8.8.8'), false);
  });
});

describe('ssrfGuard.ipBlocked (strict mode)', () => {
  test('SSRF_STRICT=true blocks all private ranges', () => {
    const prev = process.env.SSRF_STRICT;
    process.env.SSRF_STRICT = 'true';
    try {
      assert.equal(ipBlocked('10.0.0.5'), true);
      assert.equal(ipBlocked('192.168.1.10'), true);
      assert.equal(ipBlocked('8.8.8.8'), false);
    } finally {
      if (prev === undefined) delete process.env.SSRF_STRICT;
      else process.env.SSRF_STRICT = prev;
    }
  });
  test('SSRF_STRICT=true also blocks IPv4-mapped IPv6 loopback/metadata', () => {
    const prev = process.env.SSRF_STRICT;
    process.env.SSRF_STRICT = 'true';
    try {
      assert.equal(ipBlocked('::ffff:127.0.0.1'), true);
      assert.equal(ipBlocked('::ffff:169.254.169.254'), true);
      assert.equal(ipBlocked('0:0:0:0:0:ffff:7f00:1'), true);
    } finally {
      if (prev === undefined) delete process.env.SSRF_STRICT;
      else process.env.SSRF_STRICT = prev;
    }
  });
});

describe('ssrfGuard pre-flight', () => {
  test('public https URL returns a dispatcher', () => {
    const g = ssrfGuard('https://example.com/page');
    assert.ok(g.dispatcher, 'expected a guarded dispatcher');
  });
  test('blocks non-http(s) protocols', () => {
    assert.throws(() => ssrfGuard('ftp://example.com/'), /SSRF Protection/);
    assert.throws(() => ssrfGuard('file:///etc/passwd'), /SSRF Protection/);
  });
  test('blocks literal cloud-metadata hosts before DNS', () => {
    assert.throws(() => ssrfGuard('http://metadata.google.internal/'), /SSRF Protection/);
  });

  test('blocks IP-literal loopback/metadata URLs (dotted-quad, decimal, hex)', () => {
    assert.throws(() => ssrfGuard('http://127.0.0.1/'), /SSRF Protection/);
    assert.throws(() => ssrfGuard('http://[::1]/'), /SSRF Protection/);
    assert.throws(() => ssrfGuard('http://2130706433/'), /SSRF Protection/); // decimal 127.0.0.1
    assert.throws(() => ssrfGuard('http://0x7f000001/'), /SSRF Protection/); // hex 127.0.0.1
    assert.throws(() => ssrfGuard('http://169.254.169.254/'), /SSRF Protection/);
  });

  test('blocks IPv4-mapped IPv6 literal URLs', () => {
    assert.throws(() => ssrfGuard('http://[::ffff:127.0.0.1]/'), /SSRF Protection/);
    assert.throws(() => ssrfGuard('http://[::ffff:169.254.169.254]/'), /SSRF Protection/);
  });

  test('blocks a userinfo-obfuscated IP-literal URL', () => {
    assert.throws(() => ssrfGuard('http://safe.example.com@127.0.0.1/'), /SSRF Protection/);
  });

  test('BLOCKED_DOMAINS hostname is blocked at pre-flight (default list includes localhost)', () => {
    assert.throws(() => ssrfGuard('http://localhost/'), /SSRF Protection/);
  });

  test('ALLOWED_DOMAINS bypasses the guard, returning a dispatcher (not {})', () => {
    // Exercised indirectly via __ssrfInternals.isAllowlisted (the real allowlist
    // check config.security.ssrfProtection.allowedDomains is fed at import
    // time from ALLOWED_DOMAINS; see the subprocess redirect-hop test below
    // for an end-to-end exercise with a freshly-loaded config).
    assert.equal(__ssrfInternals.isAllowlisted('localhost', ['localhost']), true);
    assert.equal(__ssrfInternals.isAllowlisted('api.internal.corp', ['corp']), true);
    assert.equal(__ssrfInternals.isAllowlisted('example.com', ['other.com']), false);
  });

  test('real kill switch (SSRF_PROTECTION_ENABLED=false): fresh process, ssrfGuard returns {}', () => {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `
        import { ssrfGuard } from '${ssrfGuardUrl}';
        const g = ssrfGuard('http://127.0.0.1/');
        process.stdout.write(JSON.stringify({ keys: Object.keys(g), hasDispatcher: !!g.dispatcher }));
      `],
      { env: { ...process.env, SSRF_PROTECTION_ENABLED: 'false' }, encoding: 'utf8' }
    );
    assert.equal(result.status, 0, `subprocess failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.keys, []);
    assert.equal(parsed.hasDispatcher, false);
  });
});

describe('assertUrlAllowed', () => {
  test('resolves for a public https URL', async () => {
    await assert.doesNotReject(() => assertUrlAllowed('https://example.com/page'));
  });
  test('throws SSRF_BLOCKED for IP-literal loopback', async () => {
    await assert.rejects(() => assertUrlAllowed('http://127.0.0.1/'), (err) => {
      assert.equal(err.code, 'SSRF_BLOCKED');
      assert.match(err.message, /^SSRF Protection:/);
      return true;
    });
  });
  test('throws for IPv4-mapped IPv6 loopback', async () => {
    await assert.rejects(() => assertUrlAllowed('http://[::ffff:127.0.0.1]/'), /SSRF Protection/);
  });
  test('throws for a hostname that resolves to a blocked address when resolveDns:true', async () => {
    await assert.rejects(
      () => assertUrlAllowed('http://localhost/', { resolveDns: true }),
      /SSRF Protection/
    );
  });
});

describe('safeGoto (browser navigation guard)', () => {
  // Duck-typed page: the guard only needs goto() and url(), so no real browser.
  const fakePage = (landed, onGoto) => ({
    goto: async (...args) => { onGoto?.(...args); return { status: () => 200 }; },
    url: () => landed,
  });

  test('refuses a metadata/loopback IP-literal before calling page.goto', async () => {
    let navigated = false;
    const page = fakePage('http://169.254.169.254/', () => { navigated = true; });
    await assert.rejects(
      () => safeGoto(page, 'http://169.254.169.254/latest/meta-data/'),
      /SSRF Protection/
    );
    assert.equal(navigated, false, 'must throw before the navigation happens');
  });

  test('re-checks the landed URL: a redirect into a blocked range is refused after goto', async () => {
    // Original URL is a public IP literal (passes pre-flight); the page then
    // reports having landed on a loopback address, as a redirect would.
    const page = fakePage('http://127.0.0.1/');
    await assert.rejects(
      () => safeGoto(page, 'http://8.8.8.8/'),
      /SSRF Protection/
    );
  });

  test('passes an allowed URL through and returns the response', async () => {
    let seenOpts;
    const page = fakePage('http://8.8.8.8/', (_url, opts) => { seenOpts = opts; });
    const resp = await safeGoto(page, 'http://8.8.8.8/', { waitUntil: 'domcontentloaded' });
    assert.equal(resp.status(), 200);
    assert.deepEqual(seenOpts, { waitUntil: 'domcontentloaded' }, 'options pass through unchanged');
  });
});

describe('isSsrfError', () => {
  test('detects SSRF errors directly and via fetch cause', () => {
    assert.equal(isSsrfError({ code: 'SSRF_BLOCKED' }), true);
    assert.equal(isSsrfError({ cause: { code: 'SSRF_BLOCKED' } }), true);
    assert.equal(isSsrfError(new Error('network')), false);
  });
});

describe('redirect-hop protection (end-to-end, subprocess for a fresh ALLOWED_DOMAINS)', () => {
  test('safeFetch blocks a redirect from an allowlisted hostname to an IP-literal hop', () => {
    const script = `
      import http from 'node:http';
      import { safeFetch, isSsrfError } from '${ssrfGuardUrl}';

      let secretHit = false;
      const server = http.createServer((req, res) => {
        if (req.url === '/redirect') {
          res.writeHead(302, { Location: 'http://127.0.0.1:' + server.address().port + '/secret' });
          res.end();
        } else if (req.url === '/secret') {
          secretHit = true;
          res.writeHead(200);
          res.end('secret');
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        let blocked = false;
        let message = '';
        try {
          await safeFetch('http://localhost:' + port + '/redirect');
        } catch (err) {
          blocked = isSsrfError(err) || /SSRF/.test(err.message);
          message = err.message;
        }
        process.stdout.write(JSON.stringify({ blocked, secretHit, message }));
        server.close(() => process.exit(0));
      });
    `;

    const env = { ...process.env, ALLOWED_DOMAINS: 'localhost' };
    delete env.SSRF_PROTECTION_ENABLED;
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      { env, encoding: 'utf8', timeout: 10000 }
    );

    assert.equal(result.status, 0, `subprocess failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.blocked, true, `expected redirect to be blocked, got: ${parsed.message}`);
    assert.equal(parsed.secretHit, false, '/secret must never be reached');
  });
});

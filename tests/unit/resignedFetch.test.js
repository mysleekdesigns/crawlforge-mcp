/**
 * A Web Bot Auth signature, and the caller's gate, across redirects
 * (src/utils/resignedFetch.js).
 *
 * Run: node --test tests/unit/resignedFetch.test.js
 *
 * fetch forwards request headers unchanged on every redirect hop. The gate
 * signs once, so a same-host redirect replayed the nonce and a cross-host
 * redirect carried a signature over the previous host's authority. These tests
 * run against real local servers and verify each hop the way a site would:
 * from the headers that arrived, against the Host they arrived at.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPairSync, verify } from 'node:crypto';

const { fetchResigned } = await import('../../src/utils/resignedFetch.js');
const { signRequestHeaders, _resetSigningKey } = await import('../../src/utils/webBotAuth.js');

let publicKey;
let servers;
/** Every request either server received, in order. */
let seen;

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
        handler(req, res);
      });
    }).listen(0, '127.0.0.1', () => {
      servers.push(server);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

/** Does this received request verify for the authority it arrived at? */
function verifies(request) {
  const params = request.headers['signature-input'].replace(/^sig1=/, '');
  const lines = [`"@authority": ${request.headers.host}`];
  if (params.includes('"signature-agent"')) {
    lines.push(`"signature-agent": ${request.headers['signature-agent']}`);
  }
  lines.push(`"@signature-params": ${params}`);
  const raw = Buffer.from(request.headers.signature.replace(/^sig1=:|:$/g, ''), 'base64');
  return verify(null, Buffer.from(lines.join('\n'), 'utf8'), publicKey, raw);
}

const nonceOf = (request) => /nonce="([^"]+)"/.exec(request.headers['signature-input'])[1];

beforeEach(() => {
  const pair = generateKeyPairSync('ed25519');
  publicKey = pair.publicKey;
  process.env.CRAWLFORGE_SIGNING_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.WEB_BOT_AUTH_DIRECTORY = 'https://www.crawlforge.dev';
  _resetSigningKey();
  servers = [];
  seen = [];
});

afterEach(async () => {
  delete process.env.CRAWLFORGE_SIGNING_KEY;
  delete process.env.WEB_BOT_AUTH_DIRECTORY;
  _resetSigningKey();
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
});

describe('signed requests are re-signed on every redirect hop', () => {
  test('a same-host redirect gets a fresh nonce, and both hops verify', async () => {
    const origin = await listen((req, res) => {
      if (req.url === '/old') return res.writeHead(301, { location: '/new' }).end();
      res.end('ok');
    });

    const url = `${origin}/old`;
    const response = await fetchResigned(url, { headers: { ...signRequestHeaders(url) } });

    assert.equal(await response.text(), 'ok');
    assert.equal(response.url, `${origin}/new`);
    assert.equal(response.redirected, true);
    assert.equal(seen.length, 2);
    assert.ok(verifies(seen[0]));
    assert.ok(verifies(seen[1]));
    assert.notEqual(nonceOf(seen[0]), nonceOf(seen[1]));
  });

  test('a cross-host redirect is signed for the host it lands on', async () => {
    const target = await listen((req, res) => res.end('landed'));
    const origin = await listen((req, res) => res.writeHead(302, { location: `${target}/page` }).end());

    const url = `${origin}/start`;
    const response = await fetchResigned(url, {
      headers: { ...signRequestHeaders(url), 'Accept-Language': '', Cookie: 'session=1', Authorization: 'Bearer x' },
    });

    assert.equal(await response.text(), 'landed');
    assert.notEqual(seen[0].headers.host, seen[1].headers.host);
    assert.ok(verifies(seen[0]));
    assert.ok(verifies(seen[1]));
    // Credentials for the first origin do not follow the request off it.
    assert.equal(seen[0].headers.cookie, 'session=1');
    assert.equal(seen[1].headers.cookie, undefined);
    assert.equal(seen[1].headers.authorization, undefined);
    // Still present and empty on the second hop, or fetch fills in `*`.
    assert.equal(seen[1].headers['accept-language'], '');
  });

  test('a response that was not redirected is returned as fetch returned it', async () => {
    const origin = await listen((req, res) => res.end('ok'));
    const url = `${origin}/`;
    const response = await fetchResigned(url, { headers: { ...signRequestHeaders(url) } });

    assert.equal(response.redirected, false);
    assert.equal(seen.length, 1);
    assert.ok(verifies(seen[0]));
  });

  test('POST follows fetch: 302 becomes a bodiless GET, 307 repeats the POST', async () => {
    const origin = await listen((req, res) => {
      if (req.url === '/login') return res.writeHead(302, { location: '/home' }).end();
      if (req.url === '/submit') return res.writeHead(307, { location: '/submitted' }).end();
      res.end('ok');
    });
    const post = (path) => fetchResigned(`${origin}${path}`, {
      method: 'POST',
      body: 'a=1',
      headers: { ...signRequestHeaders(`${origin}${path}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    await post('/login');
    assert.deepEqual([seen[1].method, seen[1].body, seen[1].headers['content-type']], ['GET', '', undefined]);
    await post('/submit');
    assert.deepEqual([seen[3].method, seen[3].body], ['POST', 'a=1']);
    assert.ok(seen.every(verifies));
  });

  test('a redirect loop ends at fetch\'s own limit', async () => {
    const origin = await listen((req, res) => res.writeHead(302, { location: '/again' }).end());
    const url = `${origin}/again`;
    await assert.rejects(fetchResigned(url, { headers: { ...signRequestHeaders(url) } }), /redirect count exceeded/);
    assert.equal(seen.length, 21);
  });

  test('a redirect off http(s) is refused', async () => {
    const origin = await listen((req, res) => res.writeHead(302, { location: 'data:text/plain,hi' }).end());
    const url = `${origin}/`;
    await assert.rejects(fetchResigned(url, { headers: { ...signRequestHeaders(url) } }), /not http\(s\)/);
  });
});

describe('onRedirect gates each hop before it is requested', () => {
  const redirecting = () => listen((req, res) => {
    if (req.url === '/old') return res.writeHead(301, { location: '/new' }).end();
    res.end('ok');
  });

  test('it is given the target, and a throw stops the hop from being sent', async () => {
    const origin = await redirecting();
    const asked = [];

    await assert.rejects(
      fetchResigned(`${origin}/old`, {
        onRedirect: async (to) => { asked.push(to); throw new Error('refused'); }
      }),
      /refused/
    );

    assert.deepEqual(asked, [`${origin}/new`]);
    assert.deepEqual(seen.map((r) => r.url), ['/old']);
  });

  test('an unsigned request is gated too, and gains no signature', async () => {
    const origin = await redirecting();
    const asked = [];

    const response = await fetchResigned(`${origin}/old`, { onRedirect: async (to) => { asked.push(to); } });

    assert.equal(await response.text(), 'ok');
    assert.equal(response.redirected, true);
    assert.deepEqual(asked, [`${origin}/new`]);
    assert.equal(seen[1].headers['signature-input'], undefined);
  });

  test('a Location sent as raw UTF-8 resolves the way fetch resolves it', async () => {
    const origin = await listen((req, res) => {
      if (req.url === '/old') {
        res.setHeader('location', Buffer.from('/caf\u00e9', 'utf8').toString('latin1'));
        return res.writeHead(301).end();
      }
      res.end('ok');
    });
    const asked = [];

    await fetchResigned(`${origin}/old`, { onRedirect: async (to) => { asked.push(to); } });

    assert.deepEqual(asked, [`${origin}/caf%C3%A9`]);
    assert.equal(seen[1].url, '/caf%C3%A9');
  });
});

describe('everything else is left to fetch', () => {
  test('an unsigned request follows redirects without gaining a signature', async () => {
    const origin = await listen((req, res) => {
      if (req.url === '/old') return res.writeHead(301, { location: '/new' }).end();
      res.end('ok');
    });

    const response = await fetchResigned(`${origin}/old`, { headers: { 'X-Test': '1' } });

    assert.equal(await response.text(), 'ok');
    assert.equal(seen.length, 2);
    assert.equal(seen[1].headers['signature-input'], undefined);
  });

  test('redirect: manual still returns the redirect itself', async () => {
    const origin = await listen((req, res) => res.writeHead(301, { location: '/new' }).end());
    const url = `${origin}/old`;
    const response = await fetchResigned(url, { headers: { ...signRequestHeaders(url) }, redirect: 'manual' });

    assert.equal(response.status, 301);
    assert.equal(seen.length, 1);
  });
});

/**
 * The browser path reaches nothing the fetch path would refuse
 * (src/core/browser/guardedProxy.js, live sweep 2026-10-20 items 1.1 and 1.2).
 *
 * A browser follows redirects and loads iframes and WebSockets itself, and
 * resolves hosts itself, so a check before and after a navigation came too
 * late: the request had already been made. These tests count what actually
 * arrives at a listener on 127.0.0.1 — the count, not the tool's result, is
 * the evidence.
 *
 * The page under test is served as `localhost` (allowlisted below, standing in
 * for a public site); the listener is `127.0.0.1`, which is not, so every hop
 * to it must be refused. Real Chromium (and camoufox when installed), because
 * route() and a stub page both miss what the browser's network stack does on
 * its own. ALLOWED_DOMAINS is set BEFORE the first transitive import of
 * config.js.
 *
 * Run: node --test --test-force-exit tests/unit/browserSsrfProxy.test.js
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import net from 'node:net';

process.env.ALLOWED_DOMAINS = 'localhost';
delete process.env.SSRF_PROTECTION_ENABLED;
delete process.env.SSRF_STRICT;
delete process.env.CRAWLFORGE_STEALTH_PROXIES;

const { guardedProxyFor } = await import('../../src/core/browser/guardedProxy.js');
const { config } = await import('../../src/constants/config.js');
const { ActionExecutor } = await import('../../src/core/ActionExecutor.js');
const { StealthBrowserManager, CamoufoxAdapter } = await import('../../src/core/StealthBrowserManager.js');
const { BrowserSessionTool } = await import('../../src/tools/advanced/BrowserSessionTool.js');
const { BrowserSessionStore } = await import('../../src/core/browser/SessionStore.js');
const ExtractContentTool = (await import('../../src/tools/extract/extractContent.js')).default;
const { ScrapeWithActionsTool } = await import('../../src/tools/advanced/ScrapeWithActionsTool.js');
const { requestContext } = await import('../../src/server/requestContext.js');
const { _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');

let hasChromium = false;
try {
  const { chromium } = await import('playwright');
  await (await chromium.launch()).close();
  hasChromium = true;
} catch { /* no browser binary — the browser suites skip */ }
// isAvailable() only proves the npm package loads; the Firefox binary comes
// from a separate `camoufox fetch` (absent on CI). A launch proves both, as the
// Chromium probe above does.
let hasCamoufox = false;
if (hasChromium) {
  try {
    await (await new CamoufoxAdapter().launch({ headless: true })).close();
    hasCamoufox = true;
  } catch { /* package or binary missing — the camoufox suite skips */ }
}

const SECRET = 'the loopback secret';

/** The listener nothing may reach: counts every request and WebSocket. */
let hits = [];
let listener;
let L;
/** The "public" site, reached as localhost. */
let site;
let S;
let base;

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => { server.closeAllConnections?.(); return new Promise((resolve) => server.close(resolve)); };

before(async () => {
  listener = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<p>${SECRET}</p>`);
  });
  listener.on('upgrade', (req, socket) => { hits.push(`ws ${req.url}`); socket.destroy(); });
  L = await listen(listener);

  site = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    if (pathname === '/redirect') {
      res.writeHead(302, { Location: `http://127.0.0.1:${L}/hop` });
      return res.end();
    }
    if (pathname === '/framed') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<html><head><title>Framed</title></head><body><p>${'the public page. '.repeat(20)}</p>
        <iframe src="http://127.0.0.1:${L}/iframe"></iframe>
        <img src="http://127.0.0.1:${L}/img">
        <script>
          fetch('http://127.0.0.1:${L}/fetch').catch(() => {});
          const ws = new WebSocket('ws://127.0.0.1:${L}/ws'); ws.onerror = () => {};
        </script></body></html>`);
    }
    if (pathname === '/robots.txt') {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><head><title>Public</title></head><body><p>${'the public page. '.repeat(20)}</p></body></html>`);
  });
  S = await listen(site);
  base = `http://localhost:${S}`;
});

beforeEach(() => {
  hits = [];
  _resetRobotsGate();
  _resetHostRateLimiter();
});

after(async () => {
  await close(listener);
  await close(site);
});

/** Lets a page's late subresources and WebSocket go out before counting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 800));

describe('scrape_with_actions', { skip: !hasChromium && 'Chromium not installed' }, () => {
  let executor;
  let extractContentTool;
  let tool;
  before(() => {
    executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
    extractContentTool = new ExtractContentTool();
    tool = new ScrapeWithActionsTool({ actionExecutor: executor, extractContentTool, enableLogging: false });
  });
  after(async () => {
    await executor.destroy().catch(() => {});
    await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    await extractContentTool.browserProcessor?.cleanup?.().catch(() => {});
    await extractContentTool.browserProcessor?.localizationManager?.cleanup().catch(() => {});
  });

  const run = (pathname) => requestContext.run({ preflightRefusal: null }, () => tool.execute({
    url: `${base}${pathname}`,
    actions: [{ type: 'wait', duration: 500 }],
    formats: ['html', 'text']
  }));

  test('a 302 to 127.0.0.1 is never requested', async () => {
    const result = await run('/redirect');
    await settle();
    assert.deepEqual(hits, []);
    assert.ok(!JSON.stringify(result).includes(SECRET));
  });

  test('an iframe, image, fetch and WebSocket to 127.0.0.1 are never requested', async () => {
    const result = await run('/framed');
    await settle();
    assert.deepEqual(hits, []);
    assert.ok(!JSON.stringify(result).includes(SECRET));
  });
});

for (const engine of ['chromium', 'camoufox']) {
  const skip = engine === 'chromium'
    ? (!hasChromium && 'Chromium not installed')
    : (!hasCamoufox && 'camoufox not installed');
  describe(`stealth_mode scrape (${engine})`, { skip }, () => {
    let manager;
    before(() => { manager = new StealthBrowserManager({ clearanceJar: null }); });
    after(async () => { await manager.cleanup().catch(() => {}); });

    test('a 302 to 127.0.0.1 is never requested', async () => {
      const scraped = await manager.scrapeWithStealth({ url: `${base}/redirect`, engine }).catch((err) => err);
      await settle();
      assert.deepEqual(hits, []);
      assert.ok(!JSON.stringify(scraped?.text ?? '').includes(SECRET));
    });

    test('an iframe and a WebSocket to 127.0.0.1 are never requested; the public page still loads', async () => {
      const scraped = await manager.scrapeWithStealth({ url: `${base}/framed`, engine, wait_for: 500 });
      await settle();
      assert.deepEqual(hits, []);
      assert.match(scraped.text, /the public page/);
      assert.ok(!scraped.html.includes(SECRET));
    });
  });
}

describe('browser_session', { skip: !hasChromium && 'Chromium not installed' }, () => {
  let executor;
  let extractContentTool;
  let store;
  let tool;
  before(() => {
    executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
    extractContentTool = new ExtractContentTool();
    store = new BrowserSessionStore();
    tool = new BrowserSessionTool({ store, actionExecutor: executor, extractContentTool, enableLogging: false });
  });
  after(async () => {
    await store.destroy();
    await executor.destroy().catch(() => {});
    await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
    await extractContentTool.browserProcessor?.localizationManager?.cleanup().catch(() => {});
  });

  const call = (operation, extra = {}) => tool.execute({ operation, ...extra });

  test('open on a 302 to 127.0.0.1 never requests it', async () => {
    const opened = await call('open', { url: `${base}/redirect` }).catch((err) => err);
    await settle();
    assert.deepEqual(hits, []);
    if (opened?.sessionId) await call('close', { session_id: opened.sessionId });
  });

  test('navigate to a 302 to 127.0.0.1 never requests it', async () => {
    const { sessionId } = await call('open', { url: `${base}/public` });
    try {
      await call('act', { session_id: sessionId, actions: [{ type: 'navigate', url: `${base}/redirect` }] }).catch(() => {});
      await settle();
      assert.deepEqual(hits, []);
    } finally {
      await call('close', { session_id: sessionId });
    }
  });

  test('an iframe to 127.0.0.1 is never requested, and neither snapshot nor read carries its content', async () => {
    const { sessionId } = await call('open', { url: `${base}/framed` });
    try {
      await settle();
      const snapshot = await call('snapshot', { session_id: sessionId });
      const read = await call('read', { session_id: sessionId, formats: ['html', 'text'] });
      assert.deepEqual(hits, []);
      assert.ok(!JSON.stringify(snapshot).includes(SECRET));
      assert.ok(!JSON.stringify(read).includes(SECRET));
    } finally {
      await call('close', { session_id: sessionId });
    }
  });
});

describe('DNS rebinding', { skip: !hasChromium && 'Chromium not installed' }, () => {
  // `*.localhost` is loopback to Chromium without any DNS query, so a browser
  // resolving the name itself goes to 127.0.0.1 whatever our check was told.
  // The stub answers the first lookup with a public address and every later
  // one with 127.0.0.1: the rebinding attack, from the checker's side.
  const HOST = 'rebind.localhost';
  const realLookup = dns.lookup;
  const realPromiseLookup = dns.promises.lookup;
  let answers = 0;
  const answer = () => (answers++ === 0 ? '93.184.216.34' : '127.0.0.1');

  // `localhost` is both allowlisted here and on the default BLOCKED_DOMAINS,
  // and either list would decide for the name before any lookup. Both are
  // emptied for this suite, so `rebind.localhost` stands for any public name
  // and the browser's own loopback answer for it stands for the rebound one.
  const sec = config.security.ssrfProtection;
  let lists;

  before(() => {
    lists = { allowedDomains: sec.allowedDomains, blockedDomains: sec.blockedDomains };
    sec.allowedDomains = [];
    sec.blockedDomains = [];
    dns.lookup = function lookup(hostname, options, callback) {
      if (hostname !== HOST) return realLookup.call(dns, hostname, options, callback);
      const cb = typeof options === 'function' ? options : callback;
      const address = answer();
      if (options?.all) return cb(null, [{ address, family: 4 }]);
      return cb(null, address, 4);
    };
    dns.promises.lookup = async function lookup(hostname, options) {
      if (hostname !== HOST) return realPromiseLookup.call(dns.promises, hostname, options);
      const address = answer();
      return options?.all ? [{ address, family: 4 }] : { address, family: 4 };
    };
  });
  after(() => {
    Object.assign(sec, lists);
    dns.lookup = realLookup;
    dns.promises.lookup = realPromiseLookup;
  });

  // stealth_mode, because its navigation is checked exactly once before the
  // browser connects; an action chain checks it again on its own, and that
  // later lookup would already see 127.0.0.1.
  test('a name that answers public, then 127.0.0.1, never gets a loopback connection', async () => {
    answers = 0;
    const manager = new StealthBrowserManager({ clearanceJar: null });
    try {
      const result = await manager.scrapeWithStealth({ url: `http://${HOST}:${L}/rebound`, engine: 'chromium' })
        .catch((err) => err);
      await settle();
      assert.ok(answers >= 2, `the connection was never looked up here (${answers} answers)`);
      assert.deepEqual(hits, []);
      assert.ok(!JSON.stringify(result?.text ?? '').includes(SECRET));
    } finally {
      await manager.cleanup().catch(() => {});
    }
  });
});

describe('the guarded proxy chained to an upstream', () => {
  /** A CONNECT-only HTTP proxy that records what it was asked for. */
  let upstreamSeen;
  let httpUpstream;
  /** A no-auth SOCKS5 proxy that records what it was asked for. */
  let socksUpstream;

  before(async () => {
    httpUpstream = http.createServer((req, res) => {
      upstreamSeen.push(`${req.method} ${req.url} ${req.headers['proxy-authorization'] || ''}`.trim());
      res.writeHead(200);
      res.end('via upstream');
    });
    httpUpstream.on('connect', (req, client) => {
      upstreamSeen.push(`CONNECT ${req.url} ${req.headers['proxy-authorization'] || ''}`.trim());
      const [host, port] = req.url.split(':');
      const remote = net.connect(Number(port), host === 'localhost' ? '127.0.0.1' : host, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        remote.pipe(client);
        client.pipe(remote);
      });
      remote.on('error', () => client.destroy());
    });
    socksUpstream = net.createServer((client) => {
      client.once('data', () => {
        client.write(Buffer.from([5, 0]));
        client.once('data', (req) => {
          const len = req[4];
          const host = req.subarray(5, 5 + len).toString();
          const port = req.readUInt16BE(5 + len);
          upstreamSeen.push(`SOCKS ${host}:${port}`);
          const remote = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
            client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
            remote.pipe(client);
            client.pipe(remote);
          });
          remote.on('error', () => client.destroy());
        });
      });
    });
    await listen(httpUpstream);
    await listen(socksUpstream);
  });
  beforeEach(() => { upstreamSeen = []; });
  after(async () => {
    await close(httpUpstream);
    await new Promise((resolve) => socksUpstream.close(resolve));
  });

  /** CONNECT through the guarded proxy, then a GET over the tunnel. */
  async function tunnelGet(proxy, authority) {
    const { port } = new URL(proxy.server);
    const res = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: authority });
      req.once('connect', (response, socket) => resolve({ status: response.statusCode, socket }));
      req.once('error', reject);
      req.end();
    });
    if (res.status !== 200) return { status: res.status };
    return new Promise((resolve, reject) => {
      const req = http.request({ createConnection: () => res.socket, path: '/', headers: { Host: authority } }, (response) => {
        let body = '';
        response.on('data', (c) => { body += c; });
        response.on('end', () => resolve({ status: 200, body }));
      });
      req.once('error', reject);
      req.end();
    });
  }

  for (const kind of ['http', 'socks5']) {
    test(`${kind}: an allowed target goes through the upstream, with its credentials kept off the browser`, async () => {
      const upstream = kind === 'http'
        ? { server: `http://127.0.0.1:${httpUpstream.address().port}`, username: 'u', password: 'p' }
        : { server: `socks5://127.0.0.1:${socksUpstream.address().port}` };
      const proxy = await guardedProxyFor(upstream);
      assert.deepEqual(Object.keys(proxy), ['server', 'bypass']);
      assert.equal(proxy.bypass, '<-loopback>');
      const res = await tunnelGet(proxy, `localhost:${S}`);
      assert.equal(res.status, 200);
      assert.match(res.body, /the public page/);
      const expected = kind === 'http'
        ? `CONNECT localhost:${S} Basic ${Buffer.from('u:p').toString('base64')}`
        : `SOCKS localhost:${S}`;
      assert.deepEqual(upstreamSeen, [expected]);
    });

    test(`${kind}: a refused target is refused here and never reaches the upstream`, async () => {
      const upstream = kind === 'http'
        ? { server: `http://127.0.0.1:${httpUpstream.address().port}` }
        : { server: `socks5://127.0.0.1:${socksUpstream.address().port}` };
      const res = await tunnelGet(await guardedProxyFor(upstream), `127.0.0.1:${L}`);
      assert.equal(res.status, 403);
      assert.deepEqual(upstreamSeen, []);
      assert.deepEqual(hits, []);
    });
  }
});

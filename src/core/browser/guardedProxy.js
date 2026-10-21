/**
 * A local forward proxy that every browser context goes out through, so the
 * SSRF policy of the fetch path (src/utils/ssrfGuard.js) holds for a browser
 * at connect time, on every connection a page opens.
 *
 * A browser follows redirects inside its own network stack, and Playwright's
 * route() is called neither for a redirect hop nor for a WebSocket (measured
 * 2026-10-20 on Chromium and camoufox: a 302 to http://127.0.0.1 and a
 * `new WebSocket('ws://127.0.0.1')` both reached the listener with a
 * `context.route('**\/*')` handler installed). The browser also resolves the
 * host itself, after safeGoto's own check, which is the DNS-rebinding window.
 * A proxy closes all of it: the browser resolves nothing and connects nowhere
 * but here, and each CONNECT tunnel or plain-HTTP request is checked with the
 * same pre-flight (assertUrlAllowed) and the same connect-time lookup
 * (ssrfLookup) as a fetch, then connected to the address that was checked.
 * Redirect hops, iframes, subresources, fetch/XHR and WebSockets are all just
 * connections here.
 *
 * Both engines send loopback through a context proxy: Playwright gives
 * Chromium `<-loopback>`, and camoufox's Firefox hijacks localhost (measured).
 *
 * An upstream proxy (a caller's proxyRotation, CRAWLFORGE_STEALTH_PROXIES, a
 * localization proxy) is chained: the browser talks to this proxy, which keeps
 * the upstream's credentials and opens the tunnel through it (http, https,
 * socks4, socks5). The target is still checked here first, but by hostname:
 * the upstream resolves it in its own network, so the exit's geo-DNS answer is
 * kept, and a rebinding answer there reaches the upstream's network, not this
 * one. An upstream's `bypass` list is not honoured; nothing may bypass the
 * check.
 *
 * Listens on 127.0.0.1 only, one server per distinct upstream, for the life of
 * the process (unref'd).
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { config } from '../../constants/config.js';
import { assertUrlAllowed, isSsrfError, ssrfLookup } from '../../utils/ssrfGuard.js';

/** upstream key → Promise<{ server: string, bypass: string }> */
const servers = new Map();

const hostForUrl = (host) => (net.isIPv6(host) ? `[${host}]` : host);

/** `host:port` (CONNECT authority, brackets allowed) → { host, port } */
function splitAuthority(authority) {
  const url = new URL(`http://${authority}`);
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) || 80 };
}

/**
 * The fetch path's pre-flight on a target (protocol aside: no scheme reaches a
 * proxy). With an upstream, also what the name resolves to here, since the
 * connection itself is made by the upstream.
 */
function checkTarget(host, port, upstream) {
  return assertUrlAllowed(`http://${hostForUrl(host)}:${port}/`, { resolveDns: !!upstream });
}

/**
 * A direct connection, resolved through the fetch path's connect-time lookup:
 * ssrfLookup refuses a blocked answer and hands back only what it checked, so
 * nothing resolves the name a second time. IP literals never reach a lookup;
 * checkTarget has already held them to the same rules.
 */
function directConnect(host, port) {
  const sec = config.security?.ssrfProtection;
  const lookup = sec && sec.enabled !== false ? { lookup: ssrfLookup } : {};
  return connected(net.connect({ host, port, autoSelectFamily: true, ...lookup }));
}

function onceReadable(socket, bytes) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < bytes) return;
      cleanup();
      if (buf.length > bytes) socket.unshift(buf.subarray(bytes));
      resolve(buf.subarray(0, bytes));
    };
    const onError = (err) => { cleanup(); reject(err); };
    const onEnd = () => { cleanup(); reject(new Error('upstream proxy closed the connection')); };
    // Paused between reads, so nothing that arrives in between is dropped.
    const cleanup = () => {
      socket.pause();
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
    };
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('end', onEnd);
    socket.resume();
  });
}

function connected(socket, event = 'connect') {
  return new Promise((resolve, reject) => {
    socket.once(event, () => { socket.off('error', reject); resolve(socket); });
    socket.once('error', reject);
  });
}

/** A SOCKS5 (RFC 1928/1929) or SOCKS4a CONNECT through `upstream`. */
async function socksTunnel(upstream, host, port) {
  const socket = await connected(net.connect(upstream.port, upstream.host));
  const portBytes = [port >> 8, port & 0xff];
  if (upstream.protocol === 'socks4:') {
    const user = Buffer.from(upstream.username || '');
    socket.write(Buffer.concat([
      Buffer.from([4, 1, ...portBytes, 0, 0, 0, 1]), user, Buffer.from([0]), Buffer.from(host), Buffer.from([0])
    ]));
    const reply = await onceReadable(socket, 8);
    if (reply[1] !== 0x5a) throw new Error(`socks4 upstream refused the connection (${reply[1]})`);
    return socket;
  }
  const auth = upstream.username ? 2 : 0;
  socket.write(Buffer.from([5, 1, auth]));
  const method = await onceReadable(socket, 2);
  if (method[1] !== auth) throw new Error('socks5 upstream refused the authentication method');
  if (auth) {
    const user = Buffer.from(upstream.username);
    const pass = Buffer.from(upstream.password || '');
    socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
    const ok = await onceReadable(socket, 2);
    if (ok[1] !== 0) throw new Error('socks5 upstream refused the credentials');
  }
  const name = Buffer.from(host);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from(portBytes)]));
  const head = await onceReadable(socket, 5);
  if (head[1] !== 0) throw new Error(`socks5 upstream refused the connection (${head[1]})`);
  // The bound address that follows: IPv4, a name of head[4] bytes, or IPv6; then the port.
  const rest = head[3] === 1 ? 5 : head[3] === 4 ? 17 : head[4] + 2;
  await onceReadable(socket, rest);
  return socket;
}

function proxyAuthorization(upstream) {
  if (!upstream.username) return {};
  const pair = `${upstream.username}:${upstream.password || ''}`;
  return { 'Proxy-Authorization': `Basic ${Buffer.from(pair).toString('base64')}` };
}

/** A checked raw TCP stream to host:port, through the upstream when there is one. */
async function openTunnel(upstream, host, port) {
  await checkTarget(host, port, upstream);
  if (!upstream) return directConnect(host, port);
  if (upstream.protocol.startsWith('socks')) return socksTunnel(upstream, host, port);
  const authority = `${hostForUrl(host)}:${port}`;
  const request = (upstream.protocol === 'https:' ? https : http).request({
    host: upstream.host,
    port: upstream.port,
    method: 'CONNECT',
    path: authority,
    headers: { Host: authority, ...proxyAuthorization(upstream) }
  });
  request.end();
  return new Promise((resolve, reject) => {
    request.once('error', reject);
    request.once('connect', (res, socket, head) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`upstream proxy answered CONNECT with ${res.statusCode}`));
      }
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
  });
}

function refusalText(err) {
  return isSsrfError(err) ? (err.cause?.message || err.message) : 'Bad Gateway';
}

function handleConnect(upstream) {
  return async (req, client, head) => {
    client.on('error', () => {});
    let remote;
    try {
      const { host, port } = splitAuthority(req.url);
      remote = await openTunnel(upstream, host, port);
    } catch (err) {
      const status = isSsrfError(err) ? '403 Forbidden' : '502 Bad Gateway';
      client.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${refusalText(err)}`);
      return;
    }
    remote.on('error', () => client.destroy());
    client.on('close', () => remote.destroy());
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) remote.write(head);
    remote.pipe(client);
    client.pipe(remote);
  };
}

function handleRequest(upstream) {
  return async (req, res) => {
    const fail = (status, text) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(status, { 'Content-Type': 'text/plain', Connection: 'close' });
      res.end(text);
    };
    let target;
    let options;
    try {
      target = new URL(req.url);
      if (target.protocol !== 'http:') throw new Error(`protocol ${target.protocol} is not proxied`);
      const port = Number(target.port) || 80;
      const host = target.hostname.replace(/^\[|\]$/g, '');
      const headers = { ...req.headers };
      delete headers['proxy-connection'];
      delete headers['proxy-authorization'];
      options = { method: req.method, headers, path: `${target.pathname}${target.search}` };
      if (upstream && !upstream.protocol.startsWith('socks')) {
        // An HTTP proxy takes the absolute URI and resolves it itself.
        await checkTarget(host, port, upstream);
        Object.assign(options, {
          host: upstream.host,
          port: upstream.port,
          path: target.href,
          headers: { ...headers, ...proxyAuthorization(upstream) }
        });
        options.agent = false;
      } else {
        const socket = await openTunnel(upstream, host, port);
        options.createConnection = () => socket;
      }
    } catch (err) {
      return fail(isSsrfError(err) ? 403 : 502, refusalText(err));
    }
    const lib = upstream?.protocol === 'https:' ? https : http;
    const out = lib.request(options, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.statusMessage, upstreamRes.rawHeaders);
      upstreamRes.pipe(res);
    });
    out.on('error', () => fail(502, 'Bad Gateway'));
    req.pipe(out);
  };
}

/** A Playwright proxy option ({server, username?, password?}) → the upstream, or null. */
function upstreamUrl(proxy) {
  if (!proxy?.server) return null;
  const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(proxy.server) ? proxy.server : `http://${proxy.server}`;
  const url = new URL(raw);
  return {
    protocol: url.protocol,
    host: url.hostname.replace(/^\[|\]$/g, ''),
    // URL drops a scheme's default port; SOCKS has none of its own there.
    port: Number(url.port) || { 'http:': 80, 'https:': 443 }[url.protocol] || 1080,
    // Credentials ride beside the server in Playwright's shape, or in the URL.
    username: proxy.username ?? (decodeURIComponent(url.username) || undefined),
    password: proxy.password ?? (decodeURIComponent(url.password) || undefined)
  };
}

/**
 * The proxy option a browser context is created with: the local guarded
 * proxy, chained to `upstream` when one is given.
 * @param {{ server: string, username?: string, password?: string }|null} [upstream]
 *   the proxy the context would otherwise have used, in Playwright's shape
 * @returns {Promise<{ server: string, bypass: string }>} `bypass` is Chromium's
 *   `<-loopback>` (send loopback through the proxy), stated here rather than
 *   left to Playwright: Playwright adds it only while
 *   PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK is unset, and with that
 *   set every Chromium request to 127.0.0.1 skipped this proxy (measured
 *   2026-10-21). Named in the list, it is applied whatever the env says.
 */
export function guardedProxyFor(upstream = null) {
  const up = upstreamUrl(upstream);
  const key = up ? JSON.stringify(up) : 'direct';
  if (!servers.has(key)) {
    const started = new Promise((resolve, reject) => {
      const server = http.createServer(handleRequest(up));
      server.on('connect', handleConnect(up));
      server.on('clientError', (_err, socket) => socket.destroy());
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.unref();
        resolve({ server: `http://127.0.0.1:${server.address().port}`, bypass: '<-loopback>' });
      });
    });
    started.catch(() => servers.delete(key));
    servers.set(key, started);
  }
  return servers.get(key);
}

export default guardedProxyFor;

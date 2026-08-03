/**
 * Unit tests for src/utils/sitemapParser.js
 *
 * Reproduction tests for the Phase 2 fix: _fetchSitemapContent used to decide
 * whether to gunzip based on the `Content-Encoding` response header, but
 * undici's fetch transparently decompresses a gzip-encoded body while leaving
 * that header intact — so a real (already-decompressed) XML body with
 * `Content-Encoding: gzip` was double-gunzipped, threw, and was swallowed by
 * an outer catch, silently returning `success:true, urls:0`. The fix sniffs
 * the actual bytes (0x1f 0x8b magic) instead of trusting the header.
 *
 * Exercises the REAL SitemapParser + safeFetch against a local HTTP server.
 * safeFetch enforces SSRF protection (blocks loopback by default), so
 * ALLOWED_DOMAINS is set here BEFORE the first transitive import of
 * src/constants/config.js via a dynamic import. `node --test` runs each test
 * file in its own subprocess, so this does not leak into sibling files.
 *
 * Run: node --test tests/unit/sitemapParser.test.js --test-force-exit
 * (local server .listen() needs the sandbox disabled — see CLAUDE.md)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { SitemapParser } = await import('../../src/utils/sitemapParser.js');

function makeUrlset(urls) {
  const entries = urls.map(u => `<url><loc>${u}</loc></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
}

let server;
let baseUrl;
let routes;

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const route = routes[path];
    if (!route) {
      res.writeHead(404);
      res.end();
      return;
    }
    route(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('SitemapParser — gzip Content-Encoding handling', () => {
  test('honest Content-Encoding:gzip (undici auto-decompresses on the wire) is not double-gunzipped', async () => {
    // This is the actual repro shape: the server gzips the wire bytes and
    // declares it honestly. undici's fetch transparently decompresses the
    // body for us before _fetchSitemapContent ever sees it, but the
    // Content-Encoding header — which the old code trusted to decide whether
    // to gunzip — is still exposed as "gzip". The old code gunzipped this
    // already-plain buffer again, threw 'incorrect header check', and that
    // throw was swallowed into a false success:true/urls:0.
    const urls = [`${baseUrl}/a`, `${baseUrl}/b`, `${baseUrl}/c`];
    const xml = makeUrlset(urls);
    const compressed = zlib.gzipSync(xml);

    routes = {
      '/sitemap.xml': (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/xml', 'Content-Encoding': 'gzip' });
        res.end(compressed);
      }
    };

    const parser = new SitemapParser({ enableCaching: false });
    const result = await parser.parseSitemap(`${baseUrl}/sitemap.xml`);

    assert.equal(result.success, true, `expected success, got error: ${result.error}`);
    assert.equal(result.urls.length, 3, 'expected all 3 urls to be parsed');
    assert.deepEqual(result.urls.map(u => u.loc).sort(), urls.sort());
  });

  test('raw gzip bytes with NO Content-Encoding header parse via byte-sniffing (not header-trusted)', async () => {
    const urls = [`${baseUrl}/z`];
    const compressed = zlib.gzipSync(makeUrlset(urls));

    routes = {
      '/sitemap.xml': (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(compressed);
      }
    };

    const parser = new SitemapParser({ enableCaching: false });
    const result = await parser.parseSitemap(`${baseUrl}/sitemap.xml`);

    assert.equal(result.success, true);
    assert.equal(result.urls.length, 1);
    assert.equal(result.urls[0].loc, urls[0]);
  });
});

describe('SitemapParser — plain (non-gzip) sitemap baseline', () => {
  test('plain XML with no Content-Encoding header parses successfully', async () => {
    const urls = [`${baseUrl}/p1`, `${baseUrl}/p2`];
    routes = {
      '/sitemap.xml': (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(makeUrlset(urls));
      }
    };

    const parser = new SitemapParser({ enableCaching: false });
    const result = await parser.parseSitemap(`${baseUrl}/sitemap.xml`);

    assert.equal(result.success, true);
    assert.equal(result.urls.length, 2);
  });
});

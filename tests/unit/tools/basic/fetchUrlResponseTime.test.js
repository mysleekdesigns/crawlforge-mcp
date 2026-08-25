/**
 * Unit tests: fetch_url reports how long the target took.
 *
 * Run: node --test tests/unit/tools/basic/fetchUrlResponseTime.test.js
 *
 * Gap (2026-08-25): fetch_url returned status, headers, body, size and
 * contentType but no timing, so it could answer "is this URL up?" and not
 * "how slow is it?" — the tool has no other output a latency check could use.
 *
 * The figure deliberately excludes the per-host politeness throttle inside
 * fetchWithTimeout. A monitor polling one host on a loop hits that throttle on
 * every call after the first, and would otherwise read our own wait as the
 * site being slow.
 *
 * fetchWithTimeout blocks loopback by default, so ALLOWED_DOMAINS is set here
 * BEFORE the first transitive import of src/constants/config.js, matching the
 * sibling basic-tool suites. node --test runs each file in its own subprocess.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { fetchUrlHandler } = await import('../../../../src/tools/basic/fetchUrl.js');

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const delay = Number(new URL(req.url, 'http://x').searchParams.get('delay') || 0);
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('hello');
    }, delay);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const fetchJson = async (path) => {
  const result = await fetchUrlHandler({ url: `${baseUrl}${path}`, timeout: 10000 });
  assert.ok(!result.isError, `fetch failed: ${result.content[0].text}`);
  return JSON.parse(result.content[0].text);
};

describe('fetch_url responseTime', () => {
  test('a successful fetch reports a response time in milliseconds', async () => {
    const data = await fetchJson('/');
    assert.equal(typeof data.responseTime, 'number', 'responseTime must be present and numeric');
    assert.ok(data.responseTime >= 0);
    assert.equal(data.body, 'hello', 'the existing fields are unchanged');
    assert.equal(data.status, 200);
  });

  test('a slow target reports a proportionally larger number', async () => {
    const quick = await fetchJson('/');
    const slow = await fetchJson('/?delay=300');
    assert.ok(
      slow.responseTime >= 250,
      `a 300ms server delay must show up in responseTime, got ${slow.responseTime}`
    );
    assert.ok(
      slow.responseTime > quick.responseTime,
      `slow (${slow.responseTime}ms) must exceed quick (${quick.responseTime}ms)`
    );
  });

  test('the time covers the body, not just the headers', async () => {
    // The measurement closes after the body is fully read, so a server that
    // sends headers immediately and trickles the body is still reported slow.
    const trickler = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('start');
      setTimeout(() => res.end('end'), 300);
    });
    await new Promise((resolve) => trickler.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${trickler.address().port}/`;
      const result = await fetchUrlHandler({ url, timeout: 10000 });
      const data = JSON.parse(result.content[0].text);
      assert.ok(
        data.responseTime >= 250,
        `body delay must be counted, got ${data.responseTime}`
      );
    } finally {
      await new Promise((resolve) => trickler.close(resolve));
    }
  });
});

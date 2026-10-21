/**
 * Regression lock: stealth_mode's wait_for is applied and reported.
 *
 * The live sweep (2026-10-20) saw wait_for:5000 come back as
 * waited_for_render_ms:4. The wait did run; server.js reported only the render
 * grace the browser adds after it (scraped.gracedMs), so the requested wait
 * looked unapplied. The two are now separate fields: waited_ms (the requested
 * wait) and render_grace_ms (the grace).
 *
 * Loopback needs ALLOWED_DOMAINS before the first transitive import of
 * src/constants/config.js, as in tests/unit/stealthSettle.test.js. Importing
 * server.js starts a server, so its wiring is checked by source inspection.
 *
 * Run: node --test --test-force-exit tests/unit/stealthWaitFor.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { StealthBrowserManager } = await import('../../src/core/StealthBrowserManager.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WAIT_MS = 2000;

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nAllow: /\n');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><head><title>Static</title></head><body><p>A static page with prose.</p></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('stealth wait_for', () => {
  test('wait_for:2000 makes the scrape take at least 2 s and reports 2000', async (t) => {
    const manager = new StealthBrowserManager();
    t.after(async () => { await manager.cleanup().catch(() => {}); });

    const started = Date.now();
    const scraped = await manager.scrapeWithStealth({ url: `${baseUrl}/page`, engine: 'chromium', wait_for: WAIT_MS });
    const elapsed = Date.now() - started;

    assert.equal(scraped.success, true);
    assert.ok(elapsed >= WAIT_MS, `the call took ${elapsed} ms, less than the requested wait`);
    assert.equal(scraped.waitedMs, WAIT_MS);
    assert.ok(scraped.gracedMs < WAIT_MS, `render grace is separate from the wait (gracedMs was ${scraped.gracedMs})`);
  });

  test('no wait_for reports a zero wait', async (t) => {
    const manager = new StealthBrowserManager();
    t.after(async () => { await manager.cleanup().catch(() => {}); });

    const scraped = await manager.scrapeWithStealth({ url: `${baseUrl}/page`, engine: 'chromium' });
    assert.equal(scraped.waitedMs, 0);
  });

  test('server.js reports the wait and the render grace as separate fields', () => {
    const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.match(source, /result\.waited_ms = scraped\.waitedMs/);
    assert.match(source, /result\.render_grace_ms = scraped\.gracedMs/);
    assert.doesNotMatch(source, /waited_for_render_ms/);
  });
});

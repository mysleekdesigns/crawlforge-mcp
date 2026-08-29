/**
 * The extract_embedded_state tool handler
 * (src/tools/extract/extractEmbeddedState.js).
 *
 * Run: node --test tests/unit/extractEmbeddedState.test.js --test-force-exit
 *
 * Fixtures are served over loopback, so ALLOWED_DOMAINS is set before the first
 * transitive import (same setup as robotsGate.test.js).
 *
 * Item 3.2's threshold is asserted here against the Healthgrades fixture, whose
 * 71 verbatim rows parse to 83,795 bytes. The live page it was condensed from
 * measures larger still: 2,467,703 bytes of HTML, 1,412,665 bytes of state
 * across 205 rows, scoped by
 *   path:"next_f.5.0.0.3.children.3.pageData.directoryLinks"
 * to 4,510 bytes — the directory's own state names, provider counts and paths.
 * That row is one of the multi-hundred-KB chunks the fixture drops, so the
 * fixture scopes to next_f.0 instead; the mechanism under test is identical.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { extractEmbeddedStateHandler } = await import('../../src/tools/extract/extractEmbeddedState.js');

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/embedded-state');
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');

const PAGES = {
  '/ticketmaster': fixture('ticketmaster-next-data.html'),
  '/healthgrades': fixture('healthgrades-rsc.html'),
  '/private/healthgrades': fixture('healthgrades-rsc.html'),
  '/plain': '<html><body><h1>no state here</h1></body></html>'
};

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /private\n');
      return;
    }
    const body = PAGES[req.url];
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function extract(path, jsonPath) {
  const result = await extractEmbeddedStateHandler({ url: `${baseUrl}${path}`, path: jsonPath });
  assert.ok(!result.isError, result.content[0].text);
  return JSON.parse(result.content[0].text);
}

describe('3.1 — parsed objects from the page\'s own state', () => {
  test('Ticketmaster: __NEXT_DATA__ comes back parsed', async () => {
    const payload = await extract('/ticketmaster');
    assert.deepEqual(payload.found.map((f) => f.variable), ['__NEXT_DATA__']);
    assert.equal(payload.path, null);
    assert.equal(payload.data.next_data.buildId, 'KfC_3GF1zuM-t3vA0Rtwl');
    assert.equal(
      payload.data.next_data.props.pageProps.eventsJsonLD[0][0].name,
      'Remember When - The Ultimate Tribute to Alan Jackson'
    );
  });

  test('Healthgrades: the RSC chunks come back as parsed rows', async () => {
    const payload = await extract('/healthgrades');
    assert.deepEqual(payload.found.map((f) => f.variable), ['self.__next_f']);
    assert.equal(Object.keys(payload.data.next_f).length, 71);
    assert.equal(payload.data.next_f['0'].p, '/hg-provider-search-app');
  });

  test('the response reports where it ended up, not where it was asked to go', async () => {
    const payload = await extract('/ticketmaster');
    assert.equal(payload.url, `${baseUrl}/ticketmaster`);
  });

  test('a page with no embedded state says so instead of failing', async () => {
    const payload = await extract('/plain');
    assert.deepEqual(payload.found, []);
    assert.deepEqual(payload.data, {});
    assert.match(payload.warnings[0], /No embedded state found/);
  });
});

describe('3.2 — a path scopes the result instead of returning the blob', () => {
  test('the unscoped Healthgrades result is the problem being solved', async () => {
    const payload = await extract('/healthgrades');
    // 83,795 bytes of state, plus the 11-byte {"next_f": … } envelope.
    assert.equal(payload.found[0].bytes, 83795);
    assert.equal(payload.bytes, 83806);
    assert.ok(payload.bytes > 50_000, 'the whole state is over the 50 KB the plan targets');
  });

  test('a scoped result is under 50 KB and is the exact subtree', async () => {
    const whole = await extract('/healthgrades');
    const scoped = await extract('/healthgrades', 'next_f.0');

    assert.equal(scoped.path, 'next_f.0');
    assert.ok(scoped.bytes < 50_000, `scoped result was ${scoped.bytes} bytes`);
    assert.equal(scoped.bytes, 4007);
    assert.deepEqual(scoped.data, whole.data.next_f['0']);
    assert.equal(Buffer.byteLength(JSON.stringify(scoped.data)), scoped.bytes);
  });

  test('`found` still lists every source, so scoping does not hide what else is there', async () => {
    const scoped = await extract('/healthgrades', 'next_f.0');
    assert.deepEqual(scoped.found.map((f) => f.name), ['next_f']);
    assert.equal(scoped.found[0].bytes, 83795);
  });

  test('a path can reach a single leaf value', async () => {
    const scoped = await extract('/ticketmaster', 'next_data.props.pageProps.eventsJsonLD.0.0.startDate');
    assert.equal(typeof scoped.data, 'string');
    assert.match(scoped.data, /^\d{4}-\d{2}-\d{2}/);
  });

  test('a path that does not resolve is an error naming the available keys', async () => {
    const result = await extractEmbeddedStateHandler({
      url: `${baseUrl}/ticketmaster`,
      path: 'next_data.props.pagePropz'
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Failed to extract embedded state/);
    assert.match(result.content[0].text, /available keys: pageProps/);
  });
});

describe('compliance', () => {
  test('a robots.txt disallow refuses the fetch', async () => {
    const result = await extractEmbeddedStateHandler({ url: `${baseUrl}/private/healthgrades` });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /robots/i);
  });

  test('an explicit override is honoured and warned about', async () => {
    const result = await extractEmbeddedStateHandler({
      url: `${baseUrl}/private/healthgrades`,
      respect_robots: false
    });
    assert.ok(!result.isError, result.content[0].text);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(Object.keys(payload.data.next_f).length, 71);
    assert.ok(
      payload.warnings.some((w) => /robots/i.test(w)),
      `expected a robots override warning, got ${JSON.stringify(payload.warnings)}`
    );
  });
});

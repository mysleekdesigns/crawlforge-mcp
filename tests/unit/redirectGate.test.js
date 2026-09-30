/**
 * The gate on redirect hops (src/utils/robotsGate.js `redirectGate`), and the
 * signature on the three fetch paths that used to go out without one.
 *
 * The pre-fetch gate decides about the URL the caller asked for. fetch then
 * followed redirects on its own, so a 301 into a path robots.txt disallows, or
 * onto a host on the platform blocklist, was fetched because nobody asked
 * again. These tests hold every fetching path to the same rule on the hop as
 * on the first request, and prove the refused page was never requested.
 *
 * Exercises the REAL tools against a local HTTP server, like robotsGate.test.js:
 * ALLOWED_DOMAINS is set BEFORE the first transitive import of config.js.
 *
 * Run: node --test tests/unit/redirectGate.test.js --test-force-exit
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, verify } from 'node:crypto';

process.env.ALLOWED_DOMAINS = '127.0.0.1,localhost';
delete process.env.SSRF_PROTECTION_ENABLED;

const pair = generateKeyPairSync('ed25519');
process.env.CRAWLFORGE_SIGNING_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.WEB_BOT_AUTH_DIRECTORY = 'https://www.crawlforge.dev';

const { preflightFetch, _resetRobotsGate } = await import('../../src/utils/robotsGate.js');
const { _resetHostRateLimiter } = await import('../../src/utils/hostRateLimiter.js');
const { _setBlockedHostsForTests } = await import('../../src/utils/hostBlocklist.js');
const { setComplianceAuditSink, _resetComplianceAudit } = await import('../../src/utils/complianceAudit.js');

const { fetchWithTimeout } = await import('../../src/tools/basic/_fetch.js');
const { fetchAndParse } = await import('../../src/tools/extract/_fetchAndParse.js');
const { fetchUrl } = await import('../../src/tools/advanced/batchScrape/worker.js');
const { fetchContent } = await import('../../src/tools/tracking/trackChanges/differ.js');
const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');
const { PDFProcessor } = await import('../../src/core/processing/PDFProcessor.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ROBOTS_TXT = 'User-agent: *\nDisallow: /private\n';
const html = (title, body = '') => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

const PAGES = {
  '/': html('Home', '<a href="/public">Public</a><a href="/moved">Moved</a>'),
  '/public': html('Public', '<p>public page</p>'),
  '/private': html('Private', '<p>private page</p>'),
  '/private/doc.pdf': '%PDF-1.4'
};

/** Path → where it redirects. `/to-blocked` is filled in once the port is known. */
const REDIRECTS = {
  '/moved': '/private',
  '/to-public': '/public',
  '/doc.pdf': '/private/doc.pdf'
};

let server;
let baseUrl;
/** Every request the server received, in order. */
let seen = [];
let auditRows = [];

const requested = (pathname) => seen.some((r) => r.path === pathname);

/** Does this received request verify for the authority it arrived at? */
function verifies(request) {
  const input = request.headers['signature-input'];
  if (!input) return false;
  const params = input.replace(/^sig1=/, '');
  const base = [
    `"@authority": ${request.headers.host}`,
    `"signature-agent": ${request.headers['signature-agent']}`,
    `"@signature-params": ${params}`
  ].join('\n');
  const raw = Buffer.from(request.headers.signature.replace(/^sig1=:|:$/g, ''), 'base64');
  return verify(null, Buffer.from(base, 'utf8'), pair.publicKey, raw);
}

before(async () => {
  server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    seen.push({ path: pathname, headers: req.headers });
    if (pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(ROBOTS_TXT);
    }
    if (REDIRECTS[pathname]) {
      res.writeHead(301, { Location: REDIRECTS[pathname] });
      return res.end();
    }
    const body = PAGES[pathname];
    if (!body) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': pathname.endsWith('.pdf') ? 'application/pdf' : 'text/html' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  // Same server, reached by another name, so it can be blocklisted on its own.
  REDIRECTS['/to-blocked'] = `http://localhost:${port}/public`;

  setComplianceAuditSink((row) => { auditRows.push(row); });
});

beforeEach(() => {
  _resetRobotsGate();
  _resetHostRateLimiter();
  seen = [];
  auditRows = [];
});

after(async () => {
  _resetComplianceAudit();
  _setBlockedHostsForTests(null);
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

describe('a redirect into a path robots.txt disallows is refused', () => {
  const refusal = (err) => {
    assert.equal(err.code, 'ROBOTS_DISALLOWED');
    assert.match(err.message, /\/moved redirects to .*\/private, and robots\.txt on .* disallows that path/);
    return true;
  };

  test('basic tools (_fetch.js)', async () => {
    await assert.rejects(() => fetchWithTimeout(`${baseUrl}/moved`, { tool: 'fetch_url' }), refusal);
    assert.equal(requested('/private'), false, 'the disallowed page must never be requested');
  });

  test('extract tools (_fetchAndParse.js)', async () => {
    await assert.rejects(() => fetchAndParse(`${baseUrl}/moved`, { tool: 'extract_content' }), refusal);
    assert.equal(requested('/private'), false);
  });

  test('batch_scrape (worker.js)', async () => {
    await assert.rejects(() => fetchUrl(`${baseUrl}/moved`), refusal);
    assert.equal(requested('/private'), false);
  });

  test('track_changes (differ.js)', async () => {
    await assert.rejects(() => fetchContent(`${baseUrl}/moved`, {}), /disallows that path/);
    assert.equal(requested('/private'), false);
  });

  test('crawl_deep (BFSCrawler) reports the hop and carries on', async () => {
    const crawler = new BFSCrawler({
      respectRobots: true,
      enableLinkAnalysis: false,
      concurrency: 1,
      maxDepth: 1,
      maxPages: 10,
      timeout: 5000
    });
    const result = await crawler.crawl(baseUrl);
    crawler.destroy();

    assert.equal(requested('/private'), false);
    assert.equal(requested('/public'), true, 'the rest of the crawl still runs');
    assert.equal(result.errors.length, 1);
    assert.equal(new URL(result.errors[0].url).pathname, '/moved');
    assert.match(result.errors[0].error, /redirects to .*\/private/);
  });

  test('process_document PDF download', async () => {
    const url = `${baseUrl}/doc.pdf`;
    const gate = await preflightFetch(url, { tool: 'process_document' });
    await assert.rejects(() => new PDFProcessor().downloadPDFFromURL(url, gate), /disallows that path/);
    assert.equal(requested('/private/doc.pdf'), false);
  });

  test('a redirect to an allowed path is followed', async () => {
    const response = await fetchWithTimeout(`${baseUrl}/to-public`, { tool: 'fetch_url' });
    assert.equal(response.status, 200);
    assert.equal(new URL(response.url).pathname, '/public');
  });
});

describe('the caller\'s own decisions carry to the hop', () => {
  test('respect_robots: false follows the redirect and records the hop', async () => {
    const response = await fetchWithTimeout(`${baseUrl}/moved`, { tool: 'fetch_url', respectRobots: false });

    assert.equal(response.status, 200);
    assert.equal(new URL(response.url).pathname, '/private');
    const row = auditRows.find((r) => r.event === 'robots_override' && r.url === `${baseUrl}/private`);
    assert.ok(row, `no audit row for the hop; saw ${JSON.stringify(auditRows)}`);
    assert.equal(row.robotsAllowed, false);
  });

  test('a blocklisted host is refused on a hop, and no flag changes that', async () => {
    _setBlockedHostsForTests(['localhost']);
    try {
      await assert.rejects(
        () => fetchWithTimeout(`${baseUrl}/to-blocked`, { tool: 'fetch_url', respectRobots: false }),
        (err) => err.code === 'HOST_BLOCKED'
      );
      assert.equal(requested('/public'), false, 'a blocked host never gets a request');
    } finally {
      _setBlockedHostsForTests(null);
    }
  });
});

describe('every fetch that reaches a target is signed', () => {
  test('robots.txt', async () => {
    await fetchWithTimeout(`${baseUrl}/public`, { tool: 'fetch_url' });
    assert.ok(verifies(seen.find((r) => r.path === '/robots.txt')));
  });

  test('crawl_deep pages', async () => {
    const crawler = new BFSCrawler({ enableLinkAnalysis: false, concurrency: 1, maxDepth: 0, maxPages: 1, timeout: 5000 });
    await crawler.crawl(`${baseUrl}/public`);
    crawler.destroy();
    assert.ok(verifies(seen.find((r) => r.path === '/public')));
  });

  test('PDF downloads, with and without a gate', async () => {
    const url = `${baseUrl}/private/doc.pdf`;
    const gate = await preflightFetch(url, { tool: 'process_document', respectRobots: false });
    await new PDFProcessor().downloadPDFFromURL(url, gate);
    await new PDFProcessor().downloadPDFFromURL(url);

    const downloads = seen.filter((r) => r.path === '/private/doc.pdf');
    assert.equal(downloads.length, 2);
    assert.ok(downloads.every(verifies));
  });
});

describe('no fetching tool leaves its redirects ungated', () => {
  // The hop gate is handed to the fetch by each call site, so a new tool that
  // calls preflightFetch and forgets `onRedirect` reopens the hole silently.
  test('every file that calls preflightFetch passes onRedirect', () => {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    walk(path.join(ROOT, 'src'));

    const offenders = files
      .filter((file) => !file.endsWith(path.join('utils', 'robotsGate.js')))
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8');
        return /\bpreflightFetch\(/.test(source) && !/\bonRedirect\b/.test(source);
      })
      .map((file) => path.relative(ROOT, file));

    assert.deepEqual(offenders, []);
  });
});

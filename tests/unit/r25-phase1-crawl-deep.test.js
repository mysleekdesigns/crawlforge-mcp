/**
 * R25 Phase 1, item 1.1: crawl_deep resolved a page's links against the URL
 * it asked for instead of the URL the redirects ended on. docs.python.org
 * answers /3/tutorial with a redirect to /3/tutorial/, so appetite.html
 * resolved to /3/appetite.html (a 404) and ../bugs.html to /bugs.html.
 *
 * Real BFSCrawler + safeFetch against local HTTP servers, as in
 * bfsCrawler.test.js: ALLOWED_DOMAINS must be set before the first
 * (transitive) import of src/constants/config.js.
 *
 * Run: node --test --test-force-exit tests/unit/r25-phase1-crawl-deep.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { BFSCrawler } = await import('../../src/core/crawlers/BFSCrawler.js');

const page = (title, links = []) =>
  `<html><head><title>${title}</title></head><body><p>${title}</p>${links.map(h => `<a href="${h}">${h}</a>`).join('')}</body></html>`;

// path -> { redirect } | html; every request is counted in `hits`.
function startServer(routes) {
  const hits = {};
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    hits[path] = (hits[path] || 0) + 1;
    const route = routes[path];
    if (route?.redirect) {
      res.writeHead(301, { Location: typeof route.redirect === 'function' ? route.redirect() : route.redirect });
      res.end();
    } else if (typeof route === 'string') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(route);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ server, hits, origin: `http://127.0.0.1:${server.address().port}` });
  }));
}

function makeCrawler(overrides = {}) {
  return new BFSCrawler({
    respectRobots: true, // robots.txt is a 404 here: allow all
    enableLinkAnalysis: false,
    cacheEnabled: false,
    timeout: 5000,
    ...overrides
  });
}

const servers = [];
async function site(routes) {
  const s = await startServer(routes);
  servers.push(s.server);
  return s;
}
after(async () => {
  await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))));
});

describe('crawl_deep resolves links against the post-redirect URL (R25 1.1)', () => {
  let docs;
  before(async () => {
    docs = await site({
      '/3/tutorial': { redirect: '/3/tutorial/' },
      '/3/tutorial/': page('The Python Tutorial', ['appetite.html', 'interpreter.html', '../bugs.html']),
      '/3/tutorial/appetite.html': page('Whetting Your Appetite'),
      '/3/tutorial/interpreter.html': page('Using the Python Interpreter'),
      '/3/bugs.html': page('Dealing with Bugs')
    });
  });

  test('a seed that redirects to a trailing slash crawls its chapters, with no 404s', async () => {
    const result = await makeCrawler({ maxDepth: 2, maxPages: 5 }).crawl(`${docs.origin}/3/tutorial`);

    assert.deepEqual(result.errors, []);
    const paths = result.results.map(r => new URL(r.url).pathname).sort();
    assert.deepEqual(paths, ['/3/bugs.html', '/3/tutorial', '/3/tutorial/appetite.html', '/3/tutorial/interpreter.html']);
    assert.equal(docs.hits['/3/appetite.html'], undefined, 'resolved against /3/tutorial (no slash)');
    assert.equal(docs.hits['/bugs.html'], undefined, 'resolved against /3/tutorial (no slash)');
  });
});

describe('the page a redirect lands on is not crawled twice (R25 1.1)', () => {
  let s;
  before(async () => {
    s = await site({
      '/': page('Home', ['/old', '/new']),
      '/old': { redirect: '/new' },
      '/new': page('New', ['/child']),
      '/child': page('Child')
    });
  });

  test('concurrency 1: /new is fetched once and reported once', async () => {
    for (const k of Object.keys(s.hits)) delete s.hits[k];
    const result = await makeCrawler({ concurrency: 1, maxDepth: 3, maxPages: 10 }).crawl(`${s.origin}/`);

    assert.deepEqual(result.errors, []);
    assert.equal(result.results.filter(r => r.title === 'New').length, 1);
    assert.equal(result.results.filter(r => r.title === 'Child').length, 1);
    assert.equal(s.hits['/new'], 1);
    assert.equal(s.hits['/child'], 1);
  });

  test('concurrent fetches of /old and /new still report the page once', async () => {
    const result = await makeCrawler({ concurrency: 5, maxDepth: 3, maxPages: 10 }).crawl(`${s.origin}/`);

    assert.deepEqual(result.errors, []);
    assert.equal(result.results.filter(r => r.title === 'New').length, 1);
    assert.equal(result.results.filter(r => r.title === 'Child').length, 1);
  });
});

describe('a seed that redirects to another origin moves the crawl with it (R25 1.1)', () => {
  test('http -> https / apex -> www style: the landed origin\'s links are internal', async () => {
    const target = await site({
      '/docs/': page('Docs', ['page.html']),
      '/docs/page.html': page('Page')
    });
    const entry = await site({ '/start': { redirect: () => `${target.origin}/docs/` } });

    const result = await makeCrawler({ maxDepth: 2, maxPages: 5 }).crawl(`${entry.origin}/start`);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.results.map(r => r.title).sort(), ['Docs', 'Page']);
    assert.equal(target.hits['/docs/page.html'], 1);
    assert.equal(entry.hits['/page.html'], undefined);
  });
});

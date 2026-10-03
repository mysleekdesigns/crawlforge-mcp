/**
 * Live test R24, Phase 3, item 3.2: `scrape` metadata title and the H1 in
 * main content.
 *
 * - metadata.title is the document <title>. Caddy's docs carry a site-wide
 *   og:title ahead of the page's own, and taking the first og:title made every
 *   page "Caddy - The Ultimate Server with Automatic HTTPS". og:title stays
 *   under og_tags.title.
 * - Main-content markdown keeps the page's H1. Readability moves a headline
 *   that repeats the title out of the article (Caddy) and keeps one block that
 *   starts below the H1 (gov.uk/browse/driving).
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= node --test --test-force-exit tests/unit/r24p3-scrape-metadata.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { load } from 'cheerio';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');
const { keepPageHeading } = await import('../../src/tools/scrape/_mainContent.js');

const PROSE = Array.from({ length: 12 }, (_, i) =>
  `<p>Step ${i + 1}: this paragraph explains how a reverse proxy forwards requests to a backend, which headers it sets and how health checks decide where traffic goes next.</p>`
).join('\n');

// Shaped like caddyserver.com/docs/quick-starts/reverse-proxy: two og:title
// tags, the site-wide one first, and an H1 that repeats the <title>.
const CADDY_LIKE = `<!doctype html><html><head>
<title>Reverse proxy quick-start &mdash; Caddy Documentation</title>
<meta property="og:title" content="Caddy - The Ultimate Server with Automatic HTTPS">
<meta property="og:title" content="Reverse proxy quick-start - Caddy Documentation">
</head><body>
<nav><a href="/">Home</a> <a href="/docs">Docs</a></nav>
<main><article>
<h1 id="reverse-proxy-quick-start">Reverse proxy quick-start</h1>
${PROSE}
</article></main></body></html>`;

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(CADDY_LIKE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const scrape = (formats, extra = {}) =>
  new UnifiedScrapeTool().execute({ url: `${baseUrl}/docs`, formats, resolveHiddenContent: 'off', ...extra });

describe('scrape metadata.title (3.2)', () => {
  test('the document <title> wins over a site-wide og:title; og:title stays in og_tags', async () => {
    const { content } = await scrape(['metadata']);
    assert.equal(content.metadata.title, 'Reverse proxy quick-start — Caddy Documentation');
    assert.equal(content.metadata.og_tags.title, 'Reverse proxy quick-start - Caddy Documentation');
  });
});

describe('scrape main content keeps the H1 (3.2)', () => {
  test('markdown at onlyMainContent:true starts with the H1 Readability removed', async () => {
    const { content, warnings } = await scrape(['markdown']);
    assert.ok(content.markdown.startsWith('# Reverse proxy quick-start\n'), content.markdown.slice(0, 120));
    assert.equal((content.markdown.match(/Reverse proxy quick-start/g) || []).length, 1, 'the heading appears once');
    assert.ok(!(warnings ?? []).some((w) => w.includes('whole page is used instead')), 'Readability article, not the fallback');
  });

  test('the html format carries the same H1', async () => {
    const { content } = await scrape(['html']);
    assert.match(content.html, /^<h1>Reverse proxy quick-start<\/h1>/);
  });
});

describe('keepPageHeading (pure)', () => {
  test('prepends the H1 when no heading in the article says it, escaping its text', () => {
    const $ = load('<header><h1>Logo</h1></header><main><h1>Fish &amp; <b>Chips</b></h1></main>');
    assert.equal(keepPageHeading('<p>Body</p>', $), '<h1>Fish &amp; Chips</h1>\n<p>Body</p>');
  });

  test('leaves the article alone when a heading already carries the H1 text', () => {
    const $ = load('<main><h1>Driving and transport</h1></main>');
    const article = '<h2> Driving  and transport </h2><p>Body</p>';
    assert.equal(keepPageHeading(article, $), article);
  });

  test('a page without an H1 changes nothing', () => {
    assert.equal(keepPageHeading('<p>Body</p>', load('<p>none</p>')), '<p>Body</p>');
  });
});

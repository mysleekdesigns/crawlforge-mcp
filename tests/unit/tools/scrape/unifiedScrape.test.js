/**
 * Unit tests for src/tools/scrape/unifiedScrape.js (UnifiedScrapeTool)
 *
 * Reproduction test for the Phase 2 fix: with onlyMainContent:false, the
 * 'text' format branch ran `$('script, style').remove()` directly on the
 * single shared cheerio document, which every other format in the same call
 * also reads from. So `formats:['html','text']` and `formats:['text','html']`
 * against the identical page produced DIFFERENT content.html — non-
 * deterministic output purely from array ordering (the 'text' branch, if it
 * ran first, silently stripped the script/style tags out of the shared doc
 * before the 'html' branch read it). Fixed to strip script/style on a cloned
 * document, leaving the shared `$` untouched for other formats.
 *
 * Exercises the REAL UnifiedScrapeTool + fetchAndParse against a local HTTP
 * server. fetchAndParse enforces SSRF protection (blocks loopback by
 * default), so ALLOWED_DOMAINS is set here BEFORE the first transitive
 * import of src/constants/config.js via a dynamic import. `node --test` runs
 * each test file in its own subprocess, so this does not leak into sibling
 * files.
 *
 * Run: node --test tests/unit/tools/scrape/unifiedScrape.test.js --test-force-exit
 * (local server .listen() needs the sandbox disabled — see CLAUDE.md)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { UnifiedScrapeTool } = await import('../../../../src/tools/scrape/unifiedScrape.js');

let server;
let baseUrl;

before(async () => {
  const page = `<html><body><script>var a=1;</script><style>.x{color:red}</style><p>Body text</p></body></html>`;
  const sp500 = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sp500-condensed.html'),
    'utf8'
  );
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/page' || path === '/sp500') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(path === '/page' ? page : sp500);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('UnifiedScrapeTool — format-order independence', () => {
  test('formats:["html","text"] and formats:["text","html"] return identical content.html', async () => {
    const tool = new UnifiedScrapeTool();

    const htmlFirst = await tool.execute({ url: `${baseUrl}/page`, formats: ['html', 'text'], onlyMainContent: false });
    const textFirst = await tool.execute({ url: `${baseUrl}/page`, formats: ['text', 'html'], onlyMainContent: false });

    assert.equal(htmlFirst.content.html, textFirst.content.html, 'content.html must not depend on formats[] ordering');
    assert.match(htmlFirst.content.html, /<script>/, 'html format should retain the script tag regardless of ordering');
    assert.match(htmlFirst.content.html, /<style>/, 'html format should retain the style tag regardless of ordering');
  });

  test('the "text" format still strips script/style from its own output, in either order', async () => {
    const tool = new UnifiedScrapeTool();

    const htmlFirst = await tool.execute({ url: `${baseUrl}/page`, formats: ['html', 'text'], onlyMainContent: false });
    const textFirst = await tool.execute({ url: `${baseUrl}/page`, formats: ['text', 'html'], onlyMainContent: false });

    for (const result of [htmlFirst, textFirst]) {
      assert.doesNotMatch(result.content.text, /var a=1/);
      assert.doesNotMatch(result.content.text, /color:red/);
      assert.match(result.content.text, /Body text/);
    }
    assert.equal(htmlFirst.content.text, textFirst.content.text);
  });
});

// Reproduction test: Wikipedia's *List of S&P 500 companies* returned zero
// table rows at the default onlyMainContent:true and 505 pipe-table lines with
// it off — Readability's article candidate excludes the constituents table, so
// the page's entire payload was silently discarded. getMainHtml() now goes
// through _mainContent.js, which re-attaches the data tables Readability drops.
describe('UnifiedScrapeTool — data tables at the default onlyMainContent', () => {
  test('markdown keeps the constituents table, and a warning names the recovery', async () => {
    const tool = new UnifiedScrapeTool();
    const result = await tool.execute({ url: `${baseUrl}/sp500`, formats: ['markdown'] });

    const rows = result.content.markdown
      .split('\n')
      .filter((line) => line.trim().startsWith('|'));
    assert.equal(rows.length, 17, 'header, separator and the fixture\'s 15 constituent rows');
    assert.match(result.content.markdown, /\bMMM\b/);
    assert.ok(
      result.warnings?.some((w) => w.includes('re-attached 1 data table')),
      `expected a re-attachment warning, got: ${JSON.stringify(result.warnings)}`
    );
  });

  test('a page with no table to recover emits no warning', async () => {
    const tool = new UnifiedScrapeTool();
    const result = await tool.execute({ url: `${baseUrl}/page`, formats: ['markdown'] });
    assert.equal(result.warnings, undefined);
  });
});

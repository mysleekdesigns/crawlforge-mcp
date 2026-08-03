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

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { UnifiedScrapeTool } = await import('../../../../src/tools/scrape/unifiedScrape.js');

let server;
let baseUrl;

before(async () => {
  const page = `<html><body><script>var a=1;</script><style>.x{color:red}</style><p>Body text</p></body></html>`;
  server = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page);
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

/**
 * Unit tests for src/tools/basic/scrapeStructured.js (scrapeStructuredHandler)
 *
 * Reproduction tests for the Phase 2 fixes:
 *  - Multi-match fields used `elements.map((_, el) => extract(el)).get()`;
 *    cheerio's map() drops null/undefined results, so an element missing the
 *    requested attribute silently vanished from the array instead of leaving
 *    a placeholder — desynchronizing the array from elements_found and from
 *    parallel fields (index-aligned rows in a table/list scrape). Fixed to
 *    build the array from `elements.toArray().map(extract)` so length always
 *    equals elements_found.
 *  - parseSelectorSpec split on the LAST "@" whenever present, so a selector
 *    like `a[href*="@"]` (find mailto/contact links) was misparsed as
 *    selector `a[href*="` + attribute `"]`, throwing "Attribute value didn't
 *    end". Fixed to only treat a trailing "@attr" as an attribute suffix
 *    when it looks like a real attribute name outside brackets/quotes.
 *
 * Exercises the REAL scrapeStructuredHandler + fetchWithTimeout against a
 * local HTTP server. fetchWithTimeout enforces SSRF protection (blocks
 * loopback by default), so ALLOWED_DOMAINS is set here BEFORE the first
 * transitive import of src/constants/config.js via a dynamic import.
 * `node --test` runs each test file in its own subprocess, so this does not
 * leak into sibling files.
 *
 * Run: node --test tests/unit/tools/basic/scrapeStructured.test.js --test-force-exit
 * (local server .listen() needs the sandbox disabled — see CLAUDE.md)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { scrapeStructuredHandler } = await import('../../../../src/tools/basic/scrapeStructured.js');

let server;
let baseUrl;

before(async () => {
  const pages = {
    '/gallery': `<html><body>
      <img src="a.png">
      <img>
      <img src="c.png">
    </body></html>`,
    '/contact': `<html><body>
      <a href="mailto:sales@example.com">Sales</a>
      <a href="mailto:support@example.com">Support</a>
      <a href="/about">About (no @)</a>
    </body></html>`,
    // coinmarketcap.com/currencies/bitcoin/historical-data/ shape (2026-09-04):
    // a selector that matches a table must not run every cell together.
    '/history': `<html><body><nav>Menu</nav><div id="wrap"><h2>Bitcoin Price History</h2>
<table><thead><tr><th>Date</th><th>Open*</th><th>High</th></tr></thead>
<tbody><tr><td>Sep 03, 2026</td><td>$77,300.17</td><td>$82,262.21</td></tr>
<tr><td>Sep 02, 2026</td><td>$77,402.14</td><td>$77,737.55</td></tr></tbody></table>
<p>* Earliest data in range</p></div></body></html>`
  };
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const body = pages[path];
    if (body) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(body);
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

function parseResult(result) {
  assert.equal(result.isError, undefined, `handler returned an error: ${result.content?.[0]?.text}`);
  return JSON.parse(result.content[0].text);
}

describe('scrapeStructuredHandler', () => {
  test('an element missing the requested attribute produces a null placeholder, not a dropped index', async () => {
    const result = await scrapeStructuredHandler({
      url: `${baseUrl}/gallery`,
      selectors: { imgs: 'img@src' }
    });
    const data = parseResult(result);

    assert.equal(data.elements_found.imgs, 3, 'DOM has 3 <img> elements');
    assert.deepEqual(data.data.imgs, ['a.png', null, 'c.png'], 'array length must equal elements_found, with null for the missing attribute');
  });

  test('selector a[href*="@"] is not misparsed as attribute syntax', async () => {
    const result = await scrapeStructuredHandler({
      url: `${baseUrl}/contact`,
      selectors: { mailtoLinks: 'a[href*="@"]' }
    });
    const data = parseResult(result);

    assert.equal(data.elements_found.mailtoLinks, 2, 'expected the two mailto: links to match, not an "Invalid selector" error');
    assert.deepEqual(data.data.mailtoLinks, ['Sales', 'Support']);
  });

  test('a genuinely invalid selector still reports a per-field error without crashing the whole call', async () => {
    const result = await scrapeStructuredHandler({
      url: `${baseUrl}/contact`,
      selectors: { broken: ':::not-a-selector', ok: 'a' }
    });
    const data = parseResult(result);

    assert.ok(data.data.broken?.error, 'expected the broken selector to report a field-level error');
    assert.ok(Array.isArray(data.data.ok) || typeof data.data.ok === 'string', 'the other field must still resolve normally');
  });
});

describe('scrapeStructuredHandler — selectors keep table structure', () => {
  // Same gap scrape_with_actions closed in 5.6.5: cheerio's .text() has no
  // cell boundaries, so a `table` selector came back as
  // "DateOpen*HighLowClose**…Sep 03, 2026$77,300.17…". A table, a row group
  // or a row now renders one line per row with cells joined by " | ", an
  // element wrapping a table renders it that way in place, and every other
  // selector is unchanged (src/utils/elementText.js).
  const ROWS = 'Sep 03, 2026 | $77,300.17 | $82,262.21\nSep 02, 2026 | $77,402.14 | $77,737.55';

  test('a table, a row, and an element wrapping a table are delimited; other selectors are unchanged', async () => {
    const result = await scrapeStructuredHandler({
      url: `${baseUrl}/history`,
      selectors: { table: 'table', body: 'tbody', firstRow: 'tbody tr:first-child', wrapper: '#wrap', dates: 'tbody td:first-child', heading: 'h2' }
    });
    const data = parseResult(result);

    assert.equal(data.data.table, `Date | Open* | High\n${ROWS}`);
    assert.equal(data.data.body, ROWS, 'a row group renders only its own rows');
    assert.equal(data.data.firstRow, 'Sep 03, 2026 | $77,300.17 | $82,262.21');
    assert.equal(data.data.wrapper, `Bitcoin Price History\nDate | Open* | High\n${ROWS}\n* Earliest data in range`);
    assert.deepEqual(data.data.dates, ['Sep 03, 2026', 'Sep 02, 2026'], 'a multi-match selector still returns an array of cell strings');
    assert.equal(data.data.heading, 'Bitcoin Price History');
    assert.equal(data.elements_found.table, 1);
  });

  test('row mode: a field that names the row itself renders the row with cell delimiters', async () => {
    const result = await scrapeStructuredHandler({
      url: `${baseUrl}/history`,
      row_selector: 'tbody tr',
      selectors: { row: 'tr', date: 'td:first-child' }
    });
    const data = parseResult(result);

    assert.equal(data.rows_found, 2);
    assert.deepEqual(data.data, [
      { row: 'Sep 03, 2026 | $77,300.17 | $82,262.21', date: 'Sep 03, 2026' },
      { row: 'Sep 02, 2026 | $77,402.14 | $77,737.55', date: 'Sep 02, 2026' }
    ]);
  });
});

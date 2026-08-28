/**
 * Regression tests for scrape_structured row alignment
 * (src/tools/basic/scrapeStructured.js).
 *
 * Run: node --test tests/unit/scrapeStructuredRowSelector.test.js
 *
 * Defect 3.2: every field was matched independently across the whole document,
 * so the parallel arrays in `data` were not row-aligned:
 *
 *  - Hacker News: 30 titles but 29 scores, because the job post has no score.
 *    From that row on, every title was paired with the next row's score.
 *  - python.org downloads: the date selector also matched the table header, so
 *    release_date[0] was the literal string "Release date" and every version
 *    was paired with the previous release's date.
 *
 * The fix adds an optional row_selector: fields are matched inside each row and
 * the result is an array of aligned records, null for a field a row lacks.
 * Without row_selector the output is unchanged.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { scrapeStructuredHandler } = await import('../../src/tools/basic/scrapeStructured.js');

// Hacker-News-shaped: four submissions, the third a job post with no score.
// (Real HN keeps the score in a sibling <tr>; this fixture is the shape the
// tool can align — one container per row.)
const HN_LIKE_HTML = `<!doctype html><html><body><table><tbody>
  <tr class="athing" id="41000001">
    <td class="title"><span class="titleline"><a href="https://a.example/one">First story</a></span></td>
    <td class="subtext"><span class="score">311 points</span></td>
  </tr>
  <tr class="athing" id="41000002">
    <td class="title"><span class="titleline"><a href="https://b.example/two">Second story</a></span></td>
    <td class="subtext"><span class="score">208 points</span></td>
  </tr>
  <tr class="athing" id="41000003">
    <td class="title"><span class="titleline"><a href="https://c.example/jobs">Acme (YC S24) is hiring</a></span></td>
    <td class="subtext"></td>
  </tr>
  <tr class="athing" id="41000004">
    <td class="title"><span class="titleline"><a href="https://d.example/four">Fourth story</a></span></td>
    <td class="subtext"><span class="score">142 points</span></td>
  </tr>
</tbody></table></body></html>`;

// python.org-downloads-shaped: the date selector also matches the header cell,
// the version selector does not.
const PYTHON_LIKE_HTML = `<!doctype html><html><body>
<table class="download-list-widget"><thead><tr>
  <th class="release-number">Release version</th><th class="release-date">Release date</th>
</tr></thead><tbody>
  <tr class="release-row">
    <td class="release-number"><a href="/downloads/release/python-3137/">Python 3.13.7</a></td>
    <td class="release-date">Aug. 14, 2025</td>
  </tr>
  <tr class="release-row">
    <td class="release-number"><a href="/downloads/release/python-3125/">Python 3.12.5</a></td>
    <td class="release-date">Aug. 6, 2024</td>
  </tr>
  <tr class="release-row">
    <td class="release-number"><a href="/downloads/release/python-31110/">Python 3.11.10</a></td>
    <td class="release-date">Sept. 7, 2024</td>
  </tr>
</tbody></table></body></html>`;

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url.startsWith('/python') ? PYTHON_LIKE_HTML : HN_LIKE_HTML);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function scrape(path, params) {
  const result = await scrapeStructuredHandler({ url: `${baseUrl}${path}`, ...params });
  assert.ok(!result.isError, result.content[0].text);
  return JSON.parse(result.content[0].text);
}

describe('scrape_structured row_selector alignment', () => {
  test('a row missing a field yields null, not the next row\'s value', async () => {
    const out = await scrape('/hn', {
      row_selector: '.athing',
      selectors: { title: '.titleline a', score: '.score' }
    });

    assert.deepEqual(out.data, [
      { title: 'First story', score: '311 points' },
      { title: 'Second story', score: '208 points' },
      { title: 'Acme (YC S24) is hiring', score: null },
      { title: 'Fourth story', score: '142 points' }
    ]);
    assert.equal(out.rows_found, 4);
    // elements_found counts the rows a field's selector matched in.
    assert.deepEqual(out.elements_found, { title: 4, score: 3 });
  });

  test('the same page without row_selector produces the misaligned arrays', async () => {
    const out = await scrape('/hn', {
      selectors: { title: '.titleline a', score: '.score' }
    });

    // 4 titles, 3 scores: index 2 onwards is off by one row.
    assert.equal(out.data.title.length, 4);
    assert.equal(out.data.score.length, 3);
    assert.equal(out.data.title[2], 'Acme (YC S24) is hiring');
    assert.equal(out.data.score[2], '142 points'); // belongs to "Fourth story"
  });

  test('a header row matched by one selector does not shift the pairs', async () => {
    const out = await scrape('/python', {
      row_selector: 'tbody tr',
      selectors: { version: '.release-number a', date: '.release-date' }
    });

    assert.deepEqual(out.data, [
      { version: 'Python 3.13.7', date: 'Aug. 14, 2025' },
      { version: 'Python 3.12.5', date: 'Aug. 6, 2024' },
      { version: 'Python 3.11.10', date: 'Sept. 7, 2024' }
    ]);
  });

  test('without row_selector the header cell becomes date[0]', async () => {
    const out = await scrape('/python', {
      selectors: { version: '.release-number a', date: '.release-date' }
    });

    assert.equal(out.data.version[0], 'Python 3.13.7');
    assert.equal(out.data.date[0], 'Release date');
  });

  test('selector@attr is applied inside each row, including the row itself', async () => {
    const out = await scrape('/hn', {
      row_selector: '.athing',
      max_results: 2,
      selectors: { id: 'tr@id', href: '.titleline a@href' }
    });

    assert.deepEqual(out.data, [
      { id: '41000001', href: 'https://a.example/one' },
      { id: '41000002', href: 'https://b.example/two' }
    ]);
    // max_results caps rows; rows_found still reports every row on the page.
    assert.equal(out.rows_found, 4);
  });

  test('a row_selector that matches nothing returns an empty record list', async () => {
    const out = await scrape('/hn', {
      row_selector: '.no-such-row',
      selectors: { title: '.titleline a' }
    });

    assert.deepEqual(out.data, []);
    assert.equal(out.rows_found, 0);
    assert.deepEqual(out.elements_found, { title: 0 });
  });
});

describe('scrape_structured default output is unchanged', () => {
  test('no row_selector: same keys, same shape, no row-mode fields', async () => {
    const out = await scrape('/hn', {
      selectors: { title: '.titleline a', score: '.score', missing: '.nope' }
    });

    assert.deepEqual(Object.keys(out), ['data', 'selectors_used', 'elements_found', 'url']);
    assert.deepEqual(out.data, {
      title: ['First story', 'Second story', 'Acme (YC S24) is hiring', 'Fourth story'],
      score: ['311 points', '208 points', '142 points'],
      missing: null
    });
    assert.deepEqual(out.elements_found, { title: 4, score: 3, missing: 0 });
  });
});

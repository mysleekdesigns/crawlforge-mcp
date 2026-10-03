/**
 * R24 Phase 3, 3.12 (LIVE_TEST_R24_FIX_PLAN.md): extract_text tables.
 *
 * On https://en.wikipedia.org/wiki/List_of_tallest_buildings with
 * output_format:"markdown" and selector:"table.wikitable", the two-level
 * header ("Height" over "m" and "ft") gave a 10-column header row over
 * 11-column data rows, with "m | ft" as a stray 2-cell row; a <div> inside a
 * cell broke its row in two; images stayed protocol-relative
 * ("//thumb.wikimedia.org/..."); and a max_length cut said so only with a
 * trailing "...". Now every row of a table is as wide as its one header row,
 * image and link URLs are absolute, and the result carries `truncated`.
 *
 * Same globalThis.fetch mock as tests/unit/tools/basic/extractText.test.js.
 *
 * Run: node --test --test-force-exit tests/unit/r24p3-text-tables.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { extractTextHandler } = await import('../../src/tools/basic/extractText.js');

const URL_ = 'https://en.wikipedia.org/wiki/List_of_tallest_buildings';

// The structure of the page's main table (2026-10-03), cut to three rows.
const PAGE = `<html><head><title>List of tallest buildings</title></head><body>
<h1>List of tallest buildings</h1>
<p>Buildings ranked by architectural height. ${'Prose about tall buildings. '.repeat(30)}</p>
<table class="wikitable sortable"><tbody>
<tr><th rowspan="2"></th><th rowspan="2">Name</th><th colspan="2">Height</th><th rowspan="2">Floors</th><th rowspan="2">Image</th><th rowspan="2">Country</th></tr>
<tr><th>m</th><th>ft</th></tr>
<tr><td>1</td><td><b><a href="/wiki/Burj_Khalifa">Burj Khalifa</a></b></td><td>828</td><td>2,717</td><td><div class="center">163<br>(+ 2 below ground)</div></td>
<td><a href="/wiki/File:Burj_Khalifa.jpg"><img src="//upload.wikimedia.org/wikipedia/en/thumb/9/93/Burj_Khalifa.jpg/120px-Burj_Khalifa.jpg" alt=""></a></td><td rowspan="2">United Arab Emirates</td></tr>
<tr><td>2</td><td>Marina 101</td><td>425</td><td>1,394</td><td>101</td><td></td></tr>
<tr><td colspan="7">Under construction</td></tr>
</tbody></table>
<p>${'More prose after the table. '.repeat(30)}</p>
</body></html>`;

function mockFetch(html) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    url: URL_,
    headers: new Headers({ 'content-type': 'text/html' }),
    text: async () => html
  });
  return () => { globalThis.fetch = orig; };
}

async function run(args, html = PAGE) {
  const restore = mockFetch(html);
  try {
    const res = await extractTextHandler({ url: URL_, ...args });
    assert.ok(!res.isError, res.content[0]?.text);
    return JSON.parse(res.content[0].text);
  } finally {
    restore();
  }
}

/** Rows of the first pipe table, each as its cells. */
function tableRows(markdown) {
  return markdown.split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.replace(/\[[^\]]*\]\([^)]*\)/g, 'X').slice(1, -1).split('|').map((cell) => cell.trim()));
}

describe('extract_text markdown tables', () => {
  for (const [label, args] of [['selector', { selector: 'table.wikitable' }], ['whole page', {}]]) {
    test(`${label}: header and every row have the same number of columns`, async () => {
      const d = await run({ output_format: 'markdown', ...args });
      const rows = tableRows(d.markdown);
      assert.ok(rows.length >= 5, d.markdown);
      const widths = new Set(rows.map((row) => row.length));
      assert.deepEqual([...widths], [7], `column counts: ${rows.map((row) => row.length).join(',')}\n${d.markdown}`);
      assert.deepEqual(rows[0], ['', 'Name', 'Height m', 'Height ft', 'Floors', 'Image', 'Country']);
      assert.ok(!rows.some((row) => row.join('|') === 'm|ft'), 'the sub-header is not a row of its own');
    });

    test(`${label}: a cell's line breaks stay inside the cell; a rowspan repeats on the rows it covers`, async () => {
      const rows = tableRows((await run({ output_format: 'markdown', ...args })).markdown);
      const burj = rows.find((row) => row[0] === '1');
      assert.equal(burj[4], '163 (+ 2 below ground)');
      const marina = rows.find((row) => row[0] === '2');
      assert.equal(marina[6], 'United Arab Emirates');
      assert.deepEqual(rows.find((row) => row[0] === 'Under construction'), ['Under construction', '', '', '', '', '', '']);
    });

    test(`${label}: image and link URLs are absolute`, async () => {
      const d = await run({ output_format: 'markdown', ...args });
      assert.match(d.markdown, /!\[\]\(https:\/\/upload\.wikimedia\.org\/wikipedia\/en\/thumb\/9\/93\/Burj_Khalifa\.jpg\/120px-Burj_Khalifa\.jpg\)/);
      assert.doesNotMatch(d.markdown, /\]\(\/\//);
      assert.match(d.markdown, /\(https:\/\/en\.wikipedia\.org\/wiki\/Burj_Khalifa\)/);
    });
  }

  test('a table with no header row is left to the layout-table rule', async () => {
    const html = '<html><body><table class="t"><tr><td>a</td><td colspan="2">b</td></tr><tr><td>c</td><td>d</td><td>e</td></tr></table></body></html>';
    const d = await run({ output_format: 'markdown', selector: 'table.t' }, html);
    assert.doesNotMatch(d.markdown, /\|/);
    assert.match(d.markdown, /a\s+b/);
  });
});

describe('extract_text truncated flag', () => {
  test('markdown cut by max_length says truncated:true', async () => {
    const d = await run({ output_format: 'markdown', max_length: 100 });
    assert.equal(d.truncated, true);
    assert.ok(d.markdown.endsWith('...'));
  });

  test('text cut by max_length says truncated:true; a text under it says false', async () => {
    const cut = await run({ output_format: 'text', max_length: 100 });
    assert.equal(cut.truncated, true);
    assert.equal(cut.text.length, 103);
    const whole = await run({ output_format: 'text', max_length: 1000000 });
    assert.equal(whole.truncated, false);
    const none = await run({ output_format: 'text' });
    assert.equal(none.truncated, false);
  });
});

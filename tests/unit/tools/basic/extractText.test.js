/**
 * Unit tests for src/tools/basic/extractText.js (extractTextHandler)
 *
 * Regression: the "plain text" output leaked literal HTML markup from
 * <noscript> blocks. Cheerio/parse5 parse with scriptingEnabled by default
 * (per the HTML spec), so <noscript> CONTENTS are a raw text node — e.g.
 * Wikipedia's Special:CentralAutoLogin 1x1 <img> tracking pixel appeared
 * verbatim in extract_text output. Fixed by always stripping <noscript>
 * before extraction (browsers with JS enabled never render it either).
 *
 * Uses the same globalThis.fetch mock pattern as phaseB-regressions.test.js —
 * no live network, sandbox-safe.
 *
 * Run: node --test --test-force-exit tests/unit/tools/basic/extractText.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { extractTextHandler } = await import('../../../../src/tools/basic/extractText.js');

// Mirrors the exact noscript pixel Wikipedia serves (captured live from
// https://en.wikipedia.org/wiki/Web_scraping on 2026-08-20).
const WIKI_STYLE_HTML = `<html><head>
<title>Web scraping - Wikipedia</title>
<style>.mw-body { margin: 0; }</style>
<script>document.documentElement.className = "client-js";</script>
</head><body>
<noscript><img src="https://en.wikipedia.org/wiki/Special:CentralAutoLogin/start?useformat=desktop&amp;type=1x1&amp;usesul3=1" alt="" width="1" height="1" style="border: none; position: absolute;"></noscript>
<article>
<h1>Web scraping</h1>
<p>Web scraping is data scraping used for extracting data from websites.</p>
<p>Web scraping software may directly access the World Wide Web.</p>
</article>
</body></html>`;

function mockFetch(html, url = 'https://en.wikipedia.org/wiki/Web_scraping') {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    url,
    text: async () => html
  });
  return () => { globalThis.fetch = orig; };
}

describe('extractText noscript stripping (tag-leak regression)', () => {
  test('text mode: noscript tracking-pixel markup never leaks into output', async () => {
    const restore = mockFetch(WIKI_STYLE_HTML);
    try {
      const res = await extractTextHandler({ url: 'https://en.wikipedia.org/wiki/Web_scraping', output_format: 'text' });
      assert.ok(!res.isError, `unexpected error: ${res.content[0]?.text}`);
      const payload = JSON.parse(res.content[0].text);
      const leakedTags = payload.text.match(/<[a-zA-Z][^>]*>/g) || [];
      assert.deepEqual(leakedTags, [], `plain-text output must contain no HTML tag sequences, found: ${leakedTags.join(', ')}`);
      assert.ok(!payload.text.includes('CentralAutoLogin'), 'noscript pixel URL must not leak into text');
      assert.ok(payload.text.includes('Web scraping is data scraping'), 'real article text must survive');
    } finally {
      restore();
    }
  });

  test('text mode: script and style contents are stripped by default', async () => {
    const restore = mockFetch(WIKI_STYLE_HTML);
    try {
      const res = await extractTextHandler({ url: 'https://en.wikipedia.org/wiki/Web_scraping', output_format: 'text' });
      const payload = JSON.parse(res.content[0].text);
      assert.ok(!payload.text.includes('client-js'), 'script contents must be stripped');
      assert.ok(!payload.text.includes('mw-body'), 'style contents must be stripped');
    } finally {
      restore();
    }
  });

  test('text mode: noscript is stripped even when remove_scripts is false', async () => {
    const restore = mockFetch(WIKI_STYLE_HTML);
    try {
      const res = await extractTextHandler({
        url: 'https://en.wikipedia.org/wiki/Web_scraping',
        remove_scripts: false,
        output_format: 'text'
      });
      const payload = JSON.parse(res.content[0].text);
      assert.ok(!payload.text.includes('CentralAutoLogin'), 'noscript markup must be stripped regardless of remove_scripts');
    } finally {
      restore();
    }
  });
});

// ── E3: the shared flattener, selector and max_length ───────────────────────

async function extract(html, params = {}) {
  const restore = mockFetch(html, 'https://example.com/page');
  try {
    return await extractTextHandler({ url: 'https://example.com/page', ...params });
  } finally {
    restore();
  }
}

const parse = (res) => {
  assert.ok(!res.isError, `unexpected error: ${res.content[0]?.text}`);
  return JSON.parse(res.content[0].text);
};

const CHROME_HTML = `<html><body>
<nav>Menu</nav>
<article><h2>Title</h2><p>First paragraph.</p></article>
<div class="note"><p>Aside note.</p></div>
<footer>Footer text</footer>
</body></html>`;

describe('extractText E3 (flattenText, selector, max_length)', () => {
  test('adjacent blocks are one line each: <h1>Hi</h1><p>there</p> reads "Hi\\nthere"', async () => {
    const payload = parse(await extract('<html><body><h1>Hi</h1><p>there</p></body></html>'));
    assert.equal(payload.text, 'Hi\nthere');
    assert.equal(payload.word_count, 2);
    assert.equal(payload.char_count, 8);
  });

  test('selector reads only the matched elements and keeps chrome inside them', async () => {
    const payload = parse(await extract(CHROME_HTML, { selector: 'article, footer' }));
    assert.equal(payload.text, 'Title\nFirst paragraph.\nFooter text');
  });

  test('selector with markdown converts the matched elements, not the Readability article', async () => {
    const payload = parse(await extract(CHROME_HTML, { selector: '.note', output_format: 'markdown' }));
    assert.equal(payload.markdown.trim(), 'Aside note.');
  });

  test('a selector that matches nothing is an error naming it', async () => {
    const res = await extract(CHROME_HTML, { selector: '.missing' });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /No elements found for selector: \.missing/);
  });

  test('without a selector, nav and footer are still stripped', async () => {
    const payload = parse(await extract(CHROME_HTML));
    assert.equal(payload.text, 'Title\nFirst paragraph.\nAside note.');
  });

  test('max_length cuts the text, appends "..." and counts after the cut', async () => {
    const payload = parse(await extract('<html><body><p>abcdefghij klmnop</p></body></html>', { max_length: 5 }));
    assert.equal(payload.text, 'abcde...');
    assert.equal(payload.char_count, 8);
    assert.equal(payload.word_count, 1);
  });

  test('max_length cuts markdown too', async () => {
    const payload = parse(await extract(CHROME_HTML, { selector: 'article', output_format: 'markdown', max_length: 4 }));
    assert.equal(payload.markdown, '## T...');
  });

  test('max_length cuts a JSON body too', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200, statusText: 'OK', url: 'https://example.com/api',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{"items":[1,2,3]}'
    });
    try {
      const payload = parse(await extractTextHandler({ url: 'https://example.com/api', max_length: 9 }));
      assert.equal(payload.text, '{"items":...');
      assert.equal(payload.char_count, 12);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test('max_length longer than the text leaves it whole', async () => {
    const payload = parse(await extract('<html><body><p>short</p></body></html>', { max_length: 100 }));
    assert.equal(payload.text, 'short');
  });
});

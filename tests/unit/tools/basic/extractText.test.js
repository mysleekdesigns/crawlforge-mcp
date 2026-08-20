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

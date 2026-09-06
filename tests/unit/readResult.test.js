/**
 * Unit tests for src/tools/result/readResult.js (Phase 2, read_result).
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test tests/unit/readResult.test.js
 *
 * The store singleton is swapped for a temp-dir ResultStore via the test
 * seam, so the real ~/.crawlforge is never touched. No network.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ResultStore, setResultStoreForTests } from '../../src/core/ResultStore.js';
import { READ_RESULT_INPUT_SHAPE, readResultHandler } from '../../src/tools/result/readResult.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawlforge-read-result-'));
const store = new ResultStore({ baseDir: dir });
const schema = z.object(READ_RESULT_INPUT_SHAPE);

const markdown = [
  '# Getting started',
  '',
  'Install the package, then run it.',
  '',
  '## Pricing',
  '',
  'The Pricing page lists every plan. PRICING is reviewed yearly.',
  '',
  '## FAQ',
  'Nothing here yet.'
].join('\n');

let textHandle;
let jsonHandle;
let bodyHandle;

before(() => {
  setResultStoreForTests(store);
  textHandle = store.put('scrape', { success: true, url: 'https://docs.example.com/', content: { markdown } }, { meta: { view: 'text', view_path: 'content.markdown' } });
  jsonHandle = store.put('crawl_deep', {
    success: true,
    pages_crawled: 2,
    results: [
      { url: 'https://docs.example.com/a', title: 'A', content: 'alpha '.repeat(200) },
      { url: 'https://docs.example.com/b', title: 'B', content: 'beta '.repeat(200) }
    ]
  }, { meta: { view: 'json', view_path: null } });
  bodyHandle = store.put('fetch_url', { status: 200, body: JSON.stringify({ items: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }] }) }, { meta: { view: 'text', view_path: 'body' } });
});

after(() => {
  setResultStoreForTests(null);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = async (params) => {
  const result = await readResultHandler(schema.parse(params));
  return { result, body: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
};

test('input schema: handle must match the pattern, operation is an enum, max_matches defaults to 20', () => {
  assert.equal(schema.safeParse({ handle: '../etc', operation: 'slice' }).success, false);
  assert.equal(schema.safeParse({ handle: 'res_abc', operation: 'grep' }).success, false);
  assert.equal(schema.parse({ handle: 'res_abc', operation: 'search', query: 'x' }).max_matches, 20);
  assert.equal(schema.safeParse({ handle: 'batch_1700000000000_abc123def', operation: 'json_path', path: 'results' }).success, true);
});

test('unknown, expired or malformed handle is an error result with the documented text', async () => {
  const { result } = await call({ handle: 'res_does-not-exist', operation: 'slice' });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'Unknown or expired result handle (results are kept 1 hour)');
});

test('common fields on every success, and a structuredContent copy for the output schema', async () => {
  const { result, body } = await call({ handle: textHandle, operation: 'slice' });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, body);
  assert.equal(body.handle, textHandle);
  assert.equal(body.tool, 'scrape');
  assert.equal(body.operation, 'slice');
  assert.equal(body.view, 'text');
  assert.equal(body.view_path, 'content.markdown');
  assert.equal(body.total_chars, markdown.length);
  assert.match(body.expires_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('slice: offset/length window over the text view with has_more', async () => {
  const { body } = await call({ handle: textHandle, operation: 'slice', offset: 2, length: 7 });
  assert.equal(body.offset, 2);
  assert.equal(body.length, 7);
  assert.equal(body.text, 'Getting');
  assert.equal(body.has_more, true);

  const tail = (await call({ handle: textHandle, operation: 'slice', offset: markdown.length - 4 })).body;
  assert.equal(tail.text, 'yet.');
  assert.equal(tail.length, 4);
  assert.equal(tail.has_more, false);

  const whole = (await call({ handle: textHandle, operation: 'slice' })).body;
  assert.equal(whole.text, markdown, 'default length 10,000 covers the whole view');
  assert.equal(whole.has_more, false);
});

test('slice: the returned text is capped at max_inline_chars', async () => {
  const { body } = await call({ handle: textHandle, operation: 'slice', length: 50000, max_inline_chars: 1000 });
  assert.equal(body.text.length, Math.min(1000, markdown.length));
});

test('search: case-insensitive literal matches with offsets and context; slice at the offset returns the section', async () => {
  const { body } = await call({ handle: textHandle, operation: 'search', query: 'pricing' });
  assert.equal(body.query, 'pricing');
  assert.equal(body.total_matches, 3);
  assert.equal(body.matches.length, 3);
  assert.equal(body.truncated, false);
  for (const m of body.matches) {
    assert.equal(markdown.slice(m.offset, m.offset + m.length).toLowerCase(), 'pricing', 'offset indexes the view');
    assert.equal(markdown.slice(m.context_offset, m.context_offset + m.context.length), m.context, 'context is verbatim');
    assert.ok(m.context_offset <= m.offset && m.offset - m.context_offset <= 200);
  }
  const heading = body.matches[0];
  assert.equal(markdown.slice(heading.offset - 3, heading.offset + 7), '## Pricing');
  const section = (await call({ handle: textHandle, operation: 'slice', offset: heading.offset - 3, length: 10 })).body;
  assert.equal(section.text, '## Pricing');
});

test('search: a regex in the query is matched literally, max_matches limits and reports truncation, query is required', async () => {
  const none = (await call({ handle: textHandle, operation: 'search', query: 'p.icing' })).body;
  assert.equal(none.total_matches, 0, 'dot is not a wildcard');
  assert.deepEqual(none.matches, []);

  const limited = (await call({ handle: textHandle, operation: 'search', query: 'pricing', max_matches: 2 })).body;
  assert.equal(limited.matches.length, 2);
  assert.equal(limited.total_matches, 3);
  assert.equal(limited.truncated, true);

  const { result } = await call({ handle: textHandle, operation: 'search' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /query is required/);
});

test('search: offsets index the verbatim text, even after a character whose lowercase form is longer', async () => {
  // 'İ'.toLowerCase() is two code units, so indexing a lowercased copy would
  // put every later offset one character off.
  const text = 'Prefix İstanbul then Pricing here, and PRICING again (regex chars: a+b?).';
  assert.equal('İ'.toLowerCase().length, 2, 'the premise of this test');
  const handle = store.put('scrape', { content: { markdown: text } }, { meta: { view: 'text', view_path: 'content.markdown' } });

  const { body } = await call({ handle, operation: 'search', query: 'pRiCiNg' });
  assert.equal(body.total_matches, 2);
  assert.deepEqual(body.matches.map((m) => text.slice(m.offset, m.offset + m.length)), ['Pricing', 'PRICING'], 'slice at offset returns the matched text verbatim');
  assert.equal(body.matches[0].offset, text.indexOf('Pricing'));
  for (const m of body.matches) {
    assert.equal(text.slice(m.context_offset, m.context_offset + m.context.length), m.context);
  }

  const escaped = (await call({ handle, operation: 'search', query: 'a+b?' })).body;
  assert.equal(escaped.total_matches, 1, 'regex metacharacters in the query are literal');
  assert.equal(text.slice(escaped.matches[0].offset, escaped.matches[0].offset + escaped.matches[0].length), 'a+b?');
});

test('search: total context is capped at max_inline_chars', async () => {
  const many = 'needle '.repeat(300); // 300 matches, each with up to 407 chars of context
  const handle = store.put('scrape', { content: { markdown: many } }, { meta: { view: 'text', view_path: 'content.markdown' } });
  const { body } = await call({ handle, operation: 'search', query: 'needle', max_matches: 100, max_inline_chars: 1000 });
  assert.equal(body.total_matches, 300);
  const chars = body.matches.reduce((n, m) => n + m.context.length, 0);
  assert.ok(chars <= 1000, `context chars ${chars} within the cap`);
  assert.ok(body.matches.length >= 1);
  assert.equal(body.truncated, true);
});

test('lines: pages of lines with char_offset into the view', async () => {
  const { body } = await call({ handle: textHandle, operation: 'lines', offset: 4, length: 3 });
  assert.equal(body.first_line, 4);
  assert.equal(body.line_count, 3);
  assert.equal(body.total_lines, 10);
  assert.deepEqual(body.lines, ['## Pricing', '', 'The Pricing page lists every plan. PRICING is reviewed yearly.']);
  assert.equal(markdown.slice(body.char_offset, body.char_offset + 10), '## Pricing', 'char_offset points at the first returned line');
  assert.equal(body.has_more, true);

  const all = (await call({ handle: textHandle, operation: 'lines' })).body;
  assert.equal(all.line_count, 10, 'default 200 lines covers the view');
  assert.equal(all.char_offset, 0);
  assert.equal(all.has_more, false);
});

test('lines: capped at max_inline_chars, never returning zero lines when one exists', async () => {
  const { body } = await call({ handle: textHandle, operation: 'lines', max_inline_chars: 1000 });
  assert.ok(body.line_count >= 1);
  assert.ok(body.lines.join('\n').length <= 1000);
});

test('json_path: reads a subtree of a JSON result, error names the available keys, path is required', async () => {
  const { body } = await call({ handle: jsonHandle, operation: 'json_path', path: 'results[1].title' });
  assert.equal(body.path, 'results[1].title');
  assert.equal(body.value, 'B');
  assert.equal(body.value_chars, 3);
  assert.equal(body.view, 'json');

  const { result: missing } = await call({ handle: jsonHandle, operation: 'json_path', path: 'results[1].nope' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /not found/);
  assert.match(missing.content[0].text, /available keys: url, title, content/);

  const { result: noPath } = await call({ handle: jsonHandle, operation: 'json_path' });
  assert.equal(noPath.isError, true);
  assert.match(noPath.content[0].text, /path is required/);
});

test('json_path: a text view whose text is JSON (fetch_url body) is addressed as that JSON', async () => {
  const { body } = await call({ handle: bodyHandle, operation: 'json_path', path: 'items[1].name' });
  assert.equal(body.value, 'two');

  // A non-JSON text view falls back to the stored result object.
  const { body: fromObject } = await call({ handle: textHandle, operation: 'json_path', path: 'url' });
  assert.equal(fromObject.value, 'https://docs.example.com/');
});

test('json_path: a value over max_inline_chars is replaced by a preview and a warning', async () => {
  const { body } = await call({ handle: jsonHandle, operation: 'json_path', path: 'results', max_inline_chars: 1000 });
  assert.equal(body.value, null);
  assert.equal(body.truncated, true);
  assert.equal(body.preview.length, 1000);
  assert.ok(body.value_chars > 1000);
  assert.match(body.warnings[0], /narrow the path/);
});

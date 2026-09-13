/**
 * Unit tests for src/server/inlineThreshold.js (Phase 2, result handles).
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test tests/unit/inlineThreshold.test.js
 *
 * No network; the store is a real ResultStore on a temp dir.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ResultStore } from '../../src/core/ResultStore.js';
import {
  DEFAULT_MAX_INLINE_CHARS,
  MAX_INLINE_CHARS_PARAM,
  INLINE_THRESHOLD_TOOLS,
  resolveMaxInlineChars,
  readDottedPath,
  resultTextView,
  applyInlineThreshold
} from '../../src/server/inlineThreshold.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawlforge-inline-threshold-'));
const store = new ResultStore({ baseDir: dir });
after(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const env = {}; // no CRAWLFORGE_MAX_INLINE_CHARS
const bigMarkdown = '# Title\n\n' + 'lorem ipsum dolor sit amet. '.repeat(400); // ~11k chars

test('resolveMaxInlineChars: param, then env, then default; small values ignored', () => {
  assert.equal(resolveMaxInlineChars({}, env), DEFAULT_MAX_INLINE_CHARS);
  assert.equal(resolveMaxInlineChars({ max_inline_chars: 5000 }, env), 5000);
  assert.equal(resolveMaxInlineChars({ max_inline_chars: 5000 }, { CRAWLFORGE_MAX_INLINE_CHARS: '9000' }), 5000, 'param beats env');
  assert.equal(resolveMaxInlineChars({}, { CRAWLFORGE_MAX_INLINE_CHARS: '9000' }), 9000);
  assert.equal(resolveMaxInlineChars({}, { CRAWLFORGE_MAX_INLINE_CHARS: '12' }), DEFAULT_MAX_INLINE_CHARS, 'env under 1000 ignored');
  assert.equal(resolveMaxInlineChars({}, { CRAWLFORGE_MAX_INLINE_CHARS: 'lots' }), DEFAULT_MAX_INLINE_CHARS);
  assert.equal(resolveMaxInlineChars({ max_inline_chars: 10 }, env), DEFAULT_MAX_INLINE_CHARS, 'param under 1000 ignored');
});

test('MAX_INLINE_CHARS_PARAM is one optional int in [1000, 10,000,000]', () => {
  const schema = z.object(MAX_INLINE_CHARS_PARAM);
  assert.equal(schema.parse({}).max_inline_chars, undefined);
  assert.equal(schema.parse({ max_inline_chars: 1000 }).max_inline_chars, 1000);
  assert.equal(schema.safeParse({ max_inline_chars: 999 }).success, false);
  assert.equal(schema.safeParse({ max_inline_chars: 1.5 }).success, false);
  assert.equal(schema.safeParse({ max_inline_chars: 10_000_001 }).success, false);
});

test('the twelve large-output tools are configured; extract_embedded_state never truncates', () => {
  assert.deepEqual(Object.keys(INLINE_THRESHOLD_TOOLS).sort(), [
    'batch_scrape', 'browser_session', 'crawl_deep', 'deep_research', 'extract_content',
    'extract_embedded_state', 'fetch_url', 'get_batch_results', 'process_document', 'scrape',
    'scrape_with_actions', 'stealth_mode'
  ]);
  assert.equal(INLINE_THRESHOLD_TOOLS.extract_embedded_state.truncate, false);
  for (const [name, cfg] of Object.entries(INLINE_THRESHOLD_TOOLS)) {
    if (name !== 'extract_embedded_state') assert.equal(cfg.truncate, true, name);
  }
});

test('browser_session is shaped on read only', () => {
  const rule = INLINE_THRESHOLD_TOOLS.browser_session;
  // read hands back the same content shape scrape_with_actions does and was
  // uncapped: 541,308 characters for one Wikipedia article (2026-09-12).
  // The same three the REST route shapes (CONTENT_OPERATIONS), so one call is
  // shaped identically whichever surface serves it.
  for (const operation of ['read', 'snapshot', 'act']) {
    assert.equal(rule.when({ operation }), true, operation);
  }
  // The other four return a session id and an expiry; shaping those would
  // replace them with a preview and a handle.
  for (const operation of ['open', 'screenshot', 'close', 'list']) {
    assert.equal(rule.when({ operation }), false, operation);
  }
  assert.ok(rule.textPaths.includes('snapshot.tree'), 'a 1,000-node tree is shapeable too');
});

test('readDottedPath and resultTextView: first present string wins, else pretty JSON', () => {
  const obj = { content: { text: 'plain', markdown: '# md' }, n: 1 };
  assert.equal(readDottedPath(obj, 'content.markdown'), '# md');
  assert.equal(readDottedPath(obj, 'content.missing'), undefined);
  assert.equal(readDottedPath(obj, 'n.deeper'), undefined);
  assert.deepEqual(resultTextView(obj, ['content.markdown', 'content.text']), { view: 'text', view_path: 'content.markdown', text: '# md' });
  assert.deepEqual(resultTextView(obj, ['content.html', 'content.text']), { view: 'text', view_path: 'content.text', text: 'plain' });
  assert.deepEqual(resultTextView(obj, []), { view: 'json', view_path: null, text: JSON.stringify(obj, null, 2) });
});

test('under the threshold the result is returned unchanged and nothing is stored', () => {
  const result = { success: true, url: 'https://example.com/', content: { markdown: '# small' } };
  const out = applyInlineThreshold('scrape', result, { url: 'https://example.com/' }, { store, env });
  assert.equal(out.stored, false);
  assert.equal(out.result, result, 'same object, not a copy');
  assert.equal(store.list().length, 0);
});

test('a tool outside the config is never shaped', () => {
  const result = { rows: 'x'.repeat(50_000) };
  const out = applyInlineThreshold('search_web', result, {}, { store, env });
  assert.equal(out.stored, false);
  assert.equal(out.result, result);
});

test('over the threshold, scrape returns a preview + handle and the store holds the full object', () => {
  const result = {
    success: true,
    url: 'https://example.com/long',
    status: 200,
    title: 'Long page',
    content: { markdown: bigMarkdown, links: { links: [], total_count: 0 } },
    warnings: ['links: none found'],
    metadata: { nested: true }
  };
  const out = applyInlineThreshold('scrape', result, { url: 'https://example.com/long', max_inline_chars: 2000 }, { store, env });
  assert.equal(out.stored, true);
  const shaped = out.result;

  assert.equal(shaped.truncated, true);
  assert.equal(shaped.view, 'text');
  assert.equal(shaped.view_path, 'content.markdown');
  assert.equal(shaped.preview, bigMarkdown.slice(0, 2000));
  assert.equal(shaped.total_chars, bigMarkdown.length);
  assert.match(shaped.result_handle, /^res_/);
  assert.match(shaped.expires_at, /^\d{4}-\d{2}-\d{2}T/);

  // Scalars and short strings are kept; large/nested values are not — except
  // the small non-text fields under `content`, which are the exact answers a
  // caller asked for beside the page text (R21, 2026-09-09).
  assert.equal(shaped.success, true);
  assert.equal(shaped.url, 'https://example.com/long');
  assert.equal(shaped.status, 200);
  assert.equal(shaped.title, 'Long page');
  assert.deepEqual(shaped.content, { links: { links: [], total_count: 0 } });
  assert.equal('metadata' in shaped, false);

  // Original warnings survive, the hint is appended last and names the facts.
  assert.equal(shaped.warnings[0], 'links: none found');
  const hint = shaped.warnings[1];
  assert.match(hint, /over the inline limit of 2000/);
  assert.match(hint, /first 2000 chars of the content\.markdown text/);
  assert.match(hint, new RegExp(`${bigMarkdown.length} chars in total`));
  assert.match(hint, /kept for 1 hour under result_handle res_/);
  assert.match(hint, /read_result \(1 credit\)/);
  assert.match(hint, /"search" \(query\), "slice" \(offset, length\), "lines" or "json_path" \(path\)/);
  assert.match(hint, /do not fetch the page again/);

  const stored = store.get(shaped.result_handle);
  assert.deepEqual(stored.payload, result, 'the store holds the whole original result');
  assert.equal(stored.toolName, 'scrape');
  assert.deepEqual(stored.meta, { view: 'text', view_path: 'content.markdown', url: 'https://example.com/long' });
});

test('crawl_deep has no text path, so the view is the pretty-printed JSON', () => {
  const result = { success: true, url: 'https://docs.example.com/', pages_crawled: 3, results: Array.from({ length: 30 }, (_, i) => ({ url: `https://docs.example.com/p${i}`, content: 'c'.repeat(300) })) };
  const out = applyInlineThreshold('crawl_deep', result, { url: 'https://docs.example.com/', max_inline_chars: 1500 }, { store, env });
  assert.equal(out.stored, true);
  assert.equal(out.result.view, 'json');
  assert.equal(out.result.view_path, null);
  assert.equal(out.result.preview, JSON.stringify(result, null, 2).slice(0, 1500));
  assert.equal(out.result.total_chars, JSON.stringify(result, null, 2).length);
  assert.equal(out.result.pages_crawled, 3);
  assert.equal('results' in out.result, false);
  assert.match(out.result.warnings[0], /first 1500 chars of the pretty-printed JSON/);
});

test('extract_embedded_state is never truncated but still gets a handle', () => {
  const result = { url: 'https://shop.example.com/', found: [{ name: 'next_data' }], path: null, bytes: 5000, data: { props: { items: 'i'.repeat(5000) } }, warnings: ['big'] };
  const out = applyInlineThreshold('extract_embedded_state', result, { url: 'https://shop.example.com/', max_inline_chars: 1000 }, { store, env });
  assert.equal(out.stored, true);
  assert.equal(out.result.truncated, false);
  assert.deepEqual(out.result.data, result.data, 'the whole payload stays inline');
  assert.match(out.result.result_handle, /^res_/);
  assert.equal(out.result.view, 'json');
  assert.equal(out.result.warnings[0], 'big');
  assert.match(out.result.warnings[1], /returned whole \(this tool never truncates\)/);
  assert.match(out.result.warnings[1], /read_result \(1 credit\)/);
  assert.match(out.result.warnings[1], /do not fetch the page again/);
  assert.ok(store.get(out.result.result_handle));
});

test('max_inline_chars param and the env var both move the threshold', () => {
  const result = { success: true, url: 'https://example.com/', content: { markdown: 'm'.repeat(3000) } };
  assert.equal(applyInlineThreshold('scrape', result, {}, { store, env }).stored, false, 'under the 40k default');
  assert.equal(applyInlineThreshold('scrape', result, { max_inline_chars: 1000 }, { store, env }).stored, true, 'param lowers it');
  assert.equal(applyInlineThreshold('scrape', result, {}, { store, env: { CRAWLFORGE_MAX_INLINE_CHARS: '1000' } }).stored, true, 'env lowers it');
  assert.equal(applyInlineThreshold('scrape', result, { max_inline_chars: 100000 }, { store, env: { CRAWLFORGE_MAX_INLINE_CHARS: '1000' } }).stored, false, 'param beats env');
});

test('a store failure keeps the result inline with a warning', () => {
  const broken = { put() { throw new Error('disk on fire'); }, ttlMs: 1 };
  const result = { success: true, url: 'https://example.com/', content: { markdown: bigMarkdown }, warnings: ['w'] };
  const out = applyInlineThreshold('scrape', result, { max_inline_chars: 1000 }, { store: broken, env });
  assert.equal(out.stored, false);
  assert.equal(out.result.content.markdown, bigMarkdown, 'whole result returned');
  assert.deepEqual(out.result.warnings, ['w', 'result could not be stored; returned inline']);
  assert.equal('result_handle' in out.result, false);
});

test('stealth_mode is shaped only for operation:"scrape"', () => {
  const result = { success: true, url: 'https://example.com/', content: { markdown: bigMarkdown } };
  assert.equal(applyInlineThreshold('stealth_mode', result, { operation: 'get_stats', max_inline_chars: 1000 }, { store, env }).stored, false);
  assert.equal(applyInlineThreshold('stealth_mode', result, { operation: 'scrape', max_inline_chars: 1000 }, { store, env }).stored, true);
});

test('fetch_url uses the body as the text view', () => {
  const body = JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item ${i}` })) });
  const result = { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body, contentType: 'application/json', size: body.length, url: 'https://api.example.com/items' };
  const out = applyInlineThreshold('fetch_url', result, { url: 'https://api.example.com/items', max_inline_chars: 1000 }, { store, env });
  assert.equal(out.stored, true);
  assert.equal(out.result.view_path, 'body');
  assert.equal(out.result.preview, body.slice(0, 1000));
  assert.equal(out.result.status, 200);
  assert.equal('headers' in out.result, false, 'nested objects are dropped from the inline copy');
});

test('highlights, a question answer and json survive markdown truncation', () => {
  const highlights = [{ text: 'Common side effects of metformin include:', offset: 3114, length: 41, score: 7.0 }];
  const answer = { text: 'Metformin usually comes as tablets.', grounded: true, evidence: [{ offset: 26, length: 37 }] };
  const result = {
    success: true,
    url: 'https://example.com/nhs',
    content: { markdown: bigMarkdown, highlights, answer, json: { name: 'x', price: 1 } }
  };
  const out = applyInlineThreshold('scrape', result, { url: 'https://example.com/nhs', max_inline_chars: 3000 }, { store, env });
  const shaped = out.result;
  assert.equal(shaped.truncated, true);
  assert.equal(shaped.preview, bigMarkdown.slice(0, 3000));
  assert.deepEqual(shaped.content, { highlights, answer, json: { name: 'x', price: 1 } });
  assert.equal('markdown' in shaped.content, false, 'the text view is previewed, not duplicated');
  assert.match(shaped.warnings.at(-1), /content\.highlights, content\.answer, content\.json kept inline/);
});

test('a content field bigger than a quarter of the budget is left to read_result', () => {
  const result = { success: true, url: 'https://example.com/big', content: { markdown: bigMarkdown, links: { links: Array.from({ length: 200 }, (_, i) => ({ href: `https://example.com/${i}`, text: `link ${i}` })) } } };
  const out = applyInlineThreshold('scrape', result, { url: 'https://example.com/big', max_inline_chars: 2000 }, { store, env });
  assert.equal('content' in out.result, false);
});

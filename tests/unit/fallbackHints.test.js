/**
 * Unit tests for src/server/fallbackHints.js and its withAuth wiring.
 *
 * Run: node --test tests/unit/fallbackHints.test.js
 *
 * Contract: every error result carries a "Next step:" hint naming the tool
 * to try next; success results are untouched; every billed tool has a hint.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_HINTS, appendFallbackHint } from '../../src/server/fallbackHints.js';
import { makeWithAuth } from '../../src/server/withAuth.js';

process.env.DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN || 'test';
process.env.DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD || 'test';
const { default: AuthManager } = await import('../../src/core/AuthManager.js');

const TOOLS = [
  'fetch_url', 'extract_text', 'extract_links', 'extract_metadata', 'extract_embedded_state',
  'scrape_structured', 'search_web', 'serp_rank', 'reddit_search', 'crawl_deep', 'map_site',
  'extract_content', 'process_document', 'summarize_content', 'analyze_content',
  'extract_structured', 'extract_with_llm', 'list_ollama_models', 'batch_scrape',
  'get_batch_results', 'scrape_with_actions', 'deep_research', 'scrape', 'agent',
  'track_changes', 'generate_llms_txt', 'stealth_mode', 'localization', 'scrape_template'
];

test('every registered tool has a fallback hint, and no hint is orphaned', () => {
  for (const t of TOOLS) assert.ok(FALLBACK_HINTS[t], `missing hint for ${t}`);
  for (const t of Object.keys(FALLBACK_HINTS)) assert.ok(TOOLS.includes(t), `hint for unknown tool ${t}`);
  assert.equal(Object.keys(FALLBACK_HINTS).length, 29);
});

const PARAM_TOKENS = new Set(['link_id', 'web_discovery', 'create_baseline', 'pdf_url', 'configure_country']);

test('every hint names a real tool or parameter change (no dead references)', () => {
  const named = new Set(TOOLS);
  for (const [tool, hint] of Object.entries(FALLBACK_HINTS)) {
    const refs = hint.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
    for (const ref of refs) {
      if (PARAM_TOKENS.has(ref)) continue;
      assert.ok(named.has(ref), `${tool} hint references unknown tool "${ref}"`);
    }
  }
});

test('plain-text error gets a trailing Next step line', () => {
  const r = { content: [{ type: 'text', text: 'Scrape failed: 403' }], isError: true };
  appendFallbackHint('scrape', r);
  assert.match(r.content[0].text, /^Scrape failed: 403\nNext step: After a 403/);
});

test('JSON error gets a next_step field and stays valid JSON', () => {
  const r = { content: [{ type: 'text', text: JSON.stringify({ error: 'x' }) }], isError: true };
  appendFallbackHint('fetch_url', r);
  const parsed = JSON.parse(r.content[0].text);
  assert.equal(parsed.error, 'x');
  assert.equal(parsed.next_step, FALLBACK_HINTS.fetch_url);
});

test('success results, unknown tools and non-text content are untouched', () => {
  const ok = { content: [{ type: 'text', text: 'fine' }] };
  appendFallbackHint('scrape', ok);
  assert.equal(ok.content[0].text, 'fine');

  const unknown = { content: [{ type: 'text', text: 'boom' }], isError: true };
  appendFallbackHint('not_a_tool', unknown);
  assert.equal(unknown.content[0].text, 'boom');

  const image = { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }], isError: true };
  appendFallbackHint('scrape', image);
  assert.equal(image.content[0].type, 'image');
});

test('appending twice does not duplicate the hint', () => {
  const r = { content: [{ type: 'text', text: 'boom' }], isError: true };
  appendFallbackHint('map_site', r);
  appendFallbackHint('map_site', r);
  assert.equal(r.content[0].text.split('Next step:').length, 2);
});

test('withAuth appends the hint to a handler error result, not to success', async () => {
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const auth = {
    isCreatorMode: () => true,
    getToolCost: () => 0,
    checkCredits: async () => true,
    projectCost: () => ({ projected: 0, note: 'test' }),
    reportUsage: async () => {}
  };
  const withAuth = makeWithAuth({ authManager: auth, logger });

  const failing = withAuth('reddit_search', async () => ({
    content: [{ type: 'text', text: 'Reddit search failed: timeout' }], isError: true
  }));
  const failed = await failing({ query: 'x' });
  assert.match(failed.content[0].text, /Next step: Add subreddit or author/);

  const passing = withAuth('reddit_search', async () => ({
    content: [{ type: 'text', text: 'rows' }]
  }));
  const passed = await passing({ query: 'x' });
  assert.equal(passed.content[0].text, 'rows');
});

test('cost table and hint table cover the same tools', () => {
  for (const t of TOOLS) assert.ok(AuthManager.getToolCost(t) >= 1, `${t} has no cost`);
});

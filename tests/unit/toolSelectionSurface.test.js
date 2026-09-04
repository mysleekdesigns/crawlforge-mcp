/**
 * Guards for the tool-selection surface in server.js — what an MCP client's
 * model reads before choosing a tool.
 *
 * Run: node --test tests/unit/toolSelectionSurface.test.js
 *
 * Why these limits: Claude Code truncates server `instructions` and each tool
 * description at 2,048 chars; every description states its cost so the
 * number must match the biller (AuthManager.getToolCost); scrape and
 * search_web are flagged alwaysLoad so the first call needs no tool search;
 * and no description may teach a fetch-then-extract chain again (the 2026-09
 * log review traced 21% duplicate calls to exactly those sentences).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN || 'test';
process.env.DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD || 'test';
const { default: AuthManager } = await import('../../src/core/AuthManager.js');

const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
const LIMIT = 2048;

function registrations() {
  const re = /(registerToolIfEnabled|registerToolTask)\("([a-z_]+)", \{\n\s*description: ("(?:[^"\\]|\\.)*")/g;
  const out = {};
  for (const m of src.matchAll(re)) out[m[2]] = JSON.parse(m[3]);
  return out;
}

test('instructions block fits the 2,048-char client cap and carries the routing rules', () => {
  const m = src.match(/instructions: \[([\s\S]*?)\]\.join\("\\n"\)/);
  assert.ok(m, 'instructions block not found');
  const lines = m[1].match(/"(?:[^"\\]|\\.)*"/g).map((s) => JSON.parse(s));
  const text = lines.join('\n');
  assert.ok(text.length <= LIMIT, `instructions ${text.length} chars > ${LIMIT}`);
  assert.match(text, /never fetch a URL whose content is already in this conversation/);
  assert.match(text, /scrape \(2\)/);
  assert.match(text, /batch_scrape \(5\)/);
  assert.match(text, /Next step:/);
});

test('all 29 tools are registered with a description under the cap', () => {
  const regs = registrations();
  assert.equal(Object.keys(regs).length, 29, `found ${Object.keys(regs).join(', ')}`);
  for (const [name, desc] of Object.entries(regs)) {
    assert.ok(desc.length <= LIMIT, `${name} description ${desc.length} chars > ${LIMIT}`);
  }
});

test('every description states a cost that matches the biller', () => {
  for (const [name, desc] of Object.entries(registrations())) {
    const m = desc.match(/Cost: (\d+) credits?/);
    assert.ok(m, `${name} description has no "Cost: N credits"`);
    assert.equal(Number(m[1]), AuthManager.getToolCost(name), `${name} description cost drifted from getToolCost`);
  }
});

test('every description names a case it is not for', () => {
  for (const [name, desc] of Object.entries(registrations())) {
    assert.match(desc, /(^|[.;-] )Not [a-z]/, `${name} description has no when-not-to-use sentence`);
  }
});

test('no description or prompt teaches a fetch-then-extract chain', () => {
  const regs = registrations();
  assert.doesNotMatch(regs.fetch_url, /first step before/);
  assert.doesNotMatch(regs.fetch_url, /uptime or latency/);
  assert.doesNotMatch(regs.search_web, /Start research workflows here/);
  assert.doesNotMatch(regs.extract_with_llm, /list_ollama_models first/);
  assert.doesNotMatch(src, /Workflow: search_web -> fetch_url/);
});

test('scrape, search_web and deep_research ship their definitions at session start (alwaysLoad)', () => {
  for (const name of ['scrape', 'search_web']) {
    const re = new RegExp(`registerToolIfEnabled\\("${name}", \\{[\\s\\S]*?_meta: \\{ "anthropic/alwaysLoad": true \\}[\\s\\S]*?\\}, withAuth\\("${name}"`);
    assert.match(src, re, `${name} lacks _meta anthropic/alwaysLoad`);
  }
  assert.match(src, /registerToolTask\("deep_research", \{[\s\S]*?_meta: \{ "anthropic\/alwaysLoad": true \}/, 'deep_research lacks _meta anthropic/alwaysLoad');
  assert.equal((src.match(/"anthropic\/alwaysLoad": true/g) ?? []).length, 3, 'alwaysLoad must stay rare: it costs context in every session');
});

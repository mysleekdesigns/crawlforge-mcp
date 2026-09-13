/**
 * Phase 6 — client-side tool selection regression tests for
 * src/server/toolFilter.js
 *
 * Run: node --test tests/unit/phase6-tool-filter.test.js
 *
 * No network, no process.env mutation — env is always injected explicitly.
 *
 * TOOL_GROUPS covers every one of the 31 tools server.js registers. Phase 2
 * added read_result to `basic`; reddit_search (search) and
 * extract_embedded_state (extract) had been missing from the groups since
 * they were added, so neither could be selected by name in CRAWLFORGE_TOOLS.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_GROUPS, createToolFilter } from '../../src/server/toolFilter.js';

const ALL_TOOL_NAMES = Object.values(TOOL_GROUPS).flat();

describe('TOOL_GROUPS', () => {
  test('every tool name is unique across all groups', () => {
    const seen = new Set();
    const dupes = [];
    for (const name of ALL_TOOL_NAMES) {
      if (seen.has(name)) dupes.push(name);
      seen.add(name);
    }
    assert.deepEqual(dupes, []);
  });

  test('flattened union covers all 31 registered tool names', () => {
    assert.equal(ALL_TOOL_NAMES.length, 31);
  });

  test('reddit_search and extract_embedded_state are selectable by name', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOLS: 'reddit_search, extract_embedded_state' });
    assert.equal(filter.isEnabled('reddit_search'), true);
    assert.equal(filter.isEnabled('extract_embedded_state'), true);
    assert.deepEqual(filter.summary().unknown, []);
  });
});

describe('createToolFilter — mode selection', () => {
  test('mode "all" when neither env var is set', () => {
    const filter = createToolFilter({});
    assert.equal(filter.summary().mode, 'all');
    assert.equal(filter.isEnabled('fetch_url'), true);
    assert.equal(filter.isEnabled('agent'), true);
    assert.equal(filter.isEnabled('totally_unknown_tool'), true);
  });

  test('mode "all" when both env vars are empty/whitespace', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOLS: '   ', CRAWLFORGE_TOOL_GROUPS: '' });
    assert.equal(filter.summary().mode, 'all');
  });

  test('summary().enabled lists every registered tool in "all" mode', () => {
    const filter = createToolFilter({});
    assert.deepEqual(filter.summary().enabled.slice().sort(), ALL_TOOL_NAMES.slice().sort());
  });
});

describe('createToolFilter — CRAWLFORGE_TOOLS', () => {
  test('enables exactly the named tools', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOLS: 'fetch_url, scrape' });
    assert.equal(filter.summary().mode, 'filtered');
    assert.equal(filter.isEnabled('fetch_url'), true);
    assert.equal(filter.isEnabled('scrape'), true);
    assert.equal(filter.isEnabled('extract_text'), false);
    assert.equal(filter.isEnabled('agent'), false);
    // read_result rides along: both named tools can hand back a result_handle.
    assert.deepEqual(filter.summary().enabled.slice().sort(), ['fetch_url', 'read_result', 'scrape']);
  });

  test('trims whitespace and matches case-insensitively', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOLS: '  Fetch_URL ,SCRAPE  ' });
    assert.equal(filter.isEnabled('fetch_url'), true);
    assert.equal(filter.isEnabled('scrape'), true);
  });

  test('ignores empty entries from trailing/double commas', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOLS: 'fetch_url,,scrape,' });
    assert.deepEqual(filter.summary().enabled.slice().sort(), ['fetch_url', 'read_result', 'scrape']);
  });

  test('unknown tool names are collected in summary().unknown, never thrown', () => {
    assert.doesNotThrow(() => {
      const filter = createToolFilter({ CRAWLFORGE_TOOLS: 'fetch_url, not_a_real_tool' });
      assert.equal(filter.isEnabled('fetch_url'), true);
      assert.deepEqual(filter.summary().unknown, ['not_a_real_tool']);
    });
  });
});

describe('createToolFilter — CRAWLFORGE_TOOL_GROUPS', () => {
  test('enables every tool in the named group', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOL_GROUPS: 'basic' });
    assert.equal(filter.summary().mode, 'filtered');
    assert.deepEqual(
      filter.summary().enabled.slice().sort(),
      ['extract_links', 'extract_metadata', 'extract_text', 'fetch_url', 'scrape_structured', 'read_result'].sort()
    );
  });

  test('is case-insensitive and whitespace-tolerant', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOL_GROUPS: '  BASIC  ' });
    assert.equal(filter.isEnabled('fetch_url'), true);
  });

  test('unknown group names are collected in summary().unknown, never thrown', () => {
    assert.doesNotThrow(() => {
      const filter = createToolFilter({ CRAWLFORGE_TOOL_GROUPS: 'basic, not_a_real_group' });
      assert.deepEqual(filter.summary().unknown, ['not_a_real_group']);
    });
  });
});

describe('createToolFilter — union + dependency rule', () => {
  test('CRAWLFORGE_TOOLS and CRAWLFORGE_TOOL_GROUPS combine as a union', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOLS: 'agent', CRAWLFORGE_TOOL_GROUPS: 'basic' });
    assert.equal(filter.isEnabled('agent'), true);
    assert.equal(filter.isEnabled('fetch_url'), true);
    assert.equal(filter.isEnabled('extract_text'), true);
    assert.equal(filter.isEnabled('scrape'), false);
  });

  test('enabling batch_scrape force-enables get_batch_results', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOLS: 'batch_scrape' });
    assert.equal(filter.isEnabled('batch_scrape'), true);
    assert.equal(filter.isEnabled('get_batch_results'), true);
  });

  test('get_batch_results is not force-enabled when batch_scrape is absent', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOLS: 'scrape_with_actions' });
    assert.equal(filter.isEnabled('batch_scrape'), false);
    assert.equal(filter.isEnabled('get_batch_results'), false);
  });

  test('selecting the "batch" group already includes get_batch_results directly', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOL_GROUPS: 'batch' });
    assert.equal(filter.isEnabled('batch_scrape'), true);
    assert.equal(filter.isEnabled('get_batch_results'), true);
    assert.equal(filter.isEnabled('scrape_with_actions'), true);
  });

  // Phase 2: a tool whose large results come back as a result_handle names
  // read_result in its hint, so that tool must be registered alongside it.
  test('enabling any inline-threshold tool force-enables read_result', () => {
    // extract_embedded_state never truncates but still returns a handle, so
    // it brings read_result too.
    for (const tool of ['scrape', 'fetch_url', 'crawl_deep', 'batch_scrape', 'stealth_mode', 'deep_research', 'extract_content', 'process_document', 'scrape_with_actions', 'extract_embedded_state']) {
      const filter = createToolFilter({ CRAWLFORGE_TOOLS: tool });
      assert.equal(filter.isEnabled(tool), true);
      assert.equal(filter.isEnabled('read_result'), true, `${tool} alone must bring read_result`);
    }
    const group = createToolFilter({ CRAWLFORGE_TOOL_GROUPS: 'scrape' });
    assert.equal(group.isEnabled('read_result'), true);
  });

  test('read_result is not force-enabled by a tool that never truncates', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOLS: 'search_web, serp_rank' });
    assert.equal(filter.isEnabled('search_web'), true);
    assert.equal(filter.isEnabled('read_result'), false);
  });
});

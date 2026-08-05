/**
 * Phase 6 — client-side tool selection regression tests for
 * src/server/toolFilter.js
 *
 * Run: node --test tests/unit/phase6-tool-filter.test.js
 *
 * No network, no process.env mutation — env is always injected explicitly.
 *
 * Note: TOOL_GROUPS as specified sums to 27 unique tool names, matching the
 * 27 tools server.js actually registers (see tests/unit/phaseD-regressions.test.js
 * D4.2 "tool count banner says 27"), not 28.
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

  test('flattened union covers the 27 registered tool names', () => {
    assert.equal(ALL_TOOL_NAMES.length, 27);
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
    assert.deepEqual(filter.summary().enabled.slice().sort(), ['fetch_url', 'scrape']);
  });

  test('trims whitespace and matches case-insensitively', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOLS: '  Fetch_URL ,SCRAPE  ' });
    assert.equal(filter.isEnabled('fetch_url'), true);
    assert.equal(filter.isEnabled('scrape'), true);
  });

  test('ignores empty entries from trailing/double commas', () => {
    const filter = createToolFilter({ CRAWLFORGE_TOOLS: 'fetch_url,,scrape,' });
    assert.deepEqual(filter.summary().enabled.slice().sort(), ['fetch_url', 'scrape']);
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
      ['extract_links', 'extract_metadata', 'extract_text', 'fetch_url', 'scrape_structured'].sort()
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
});

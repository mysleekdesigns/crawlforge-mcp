/**
 * Live sweep 2026-10-20, item 2.5: `agent` answers with the wrong date and
 * searches badly.
 *
 * Run: node --test --test-force-exit tests/unit/agentRustRelease.test.js
 *
 * "Latest stable Rust version and its release date" gave 1.99.1 (correct)
 * "as of 16 October 2026": endoflife.date's "Last updated on" date; its table
 * gives 15 Oct 2026 for 1.99.1. The first search was the bare word "Rust"
 * (the game, the film), and degraded:true blamed rust.facepunch.com.
 * Search results and pages: tests/fixtures/agent-rust-release.json.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AgentOrchestrator } from '../../src/core/AgentOrchestrator.js';
import { corroboratedOrigins, updateLabelledDates } from '../../src/tools/agent/sourceChecks.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/agent-rust-release.json', import.meta.url), 'utf8'));

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

function stubFetch(pages, fetched) {
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    const body = pages[url];
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      url,
      headers: { get: () => null },
      text: async () => body ?? '<html><body>Not Found</body></html>'
    };
  };
}

const LIVE_ANSWER = 'The latest stable Rust version is 1.99.1, as of 16 October 2026 (https://endoflife.date/rust).';
const RELEASE_ANSWER = 'The latest stable Rust version is 1.99.1, released 15 Oct 2026. Source row: "1.99 … 1.99.1 (15 Oct 2026)" (https://endoflife.date/rust).';

/** PLAN answers the bare entity, as the live run's planner did; synthesis gives the live answer until told about the update date. */
function rustAgent() {
  const o = new AgentOrchestrator({});
  const prompts = [];
  const queries = [];
  o._samplingClient = {
    complete: async (p) => {
      prompts.push(p);
      if (prompts.length === 1) return { text: 'Rust', provider: 'mock' };
      return { text: /last updated or modified/.test(p) ? RELEASE_ANSWER : LIVE_ANSWER, provider: 'mock' };
    }
  };
  o._searchTool = {
    execute: async ({ query }) => {
      queries.push(query);
      const results = query === 'Rust' ? fixture.entityResults : fixture.questionResults;
      return { results: results.map(r => ({ ...r })) };
    }
  };
  return { o, prompts, queries };
}

describe('agent: Rust release question (recorded results)', () => {
  test('first query keeps the question; the answer has the release date and no game-site source', async () => {
    const fetched = [];
    stubFetch(fixture.pages, fetched);
    const { o, prompts, queries } = rustAgent();

    const result = await o.run({ prompt: fixture.prompt });

    // Query planning: the full question first, not the bare word.
    assert.notEqual(queries[0].toLowerCase(), 'rust');
    assert.match(queries[0], /Latest stable Rust version/);

    // No namesake is fetched, promoted, used or blamed.
    const gameOrFilm = /facepunch|steampowered|imdb/;
    assert.ok(!fetched.some(u => gameOrFilm.test(u)), `fetched: ${fetched.join(', ')}`);
    assert.ok(!result.evidence.some(e => gameOrFilm.test(e.url)));
    assert.ok(!gameOrFilm.test(result.reason || ''));

    // Answer step: the release date, not the page's update date.
    const synthesis = prompts.find(p => p.includes('--- Source:'));
    assert.match(synthesis, /never a page's "last updated" or "modified" date, and quote the sentence or table row/);
    assert.match(result.answer, /1\.99\.1/);
    assert.match(result.answer, /15 Oct 2026/);
    assert.doesNotMatch(result.answer, /16 October 2026/);
    assert.equal(result.degraded, false);
  });

  test('an update date that survives the rewrite is flagged, naming the page that labels it', async () => {
    stubFetch(fixture.pages, []);
    const { o } = rustAgent();
    o._samplingClient.complete = async (p) => ({ text: p.includes('--- Source:') ? LIVE_ANSWER : 'Rust', provider: 'mock' });

    const result = await o.run({ prompt: fixture.prompt });

    assert.equal(result.degraded, true);
    assert.match(result.reason, /"16 October 2026" is labelled as an update date on https:\/\/endoflife\.date\/rust/);
    assert.match(result.answer, /Date warning: "16 October 2026"/);
    assert.deepEqual(result.provenance.update_dates, [{ date: '16 October 2026', url: 'https://endoflife.date/rust' }]);
  });
});

describe('sourceChecks', () => {
  test('corroboratedOrigins keeps origins whose site the question search also returns', () => {
    const origins = ['https://rust.facepunch.com', 'https://www.rust-lang.org', 'https://www.imdb.com'];
    const kept = corroboratedOrigins(origins, fixture.questionResults.map(r => r.link));
    assert.deepEqual([...kept], ['https://www.rust-lang.org']);
    assert.deepEqual([...corroboratedOrigins(origins, [])], origins, 'nothing to check against: all pass');
  });

  test('updateLabelledDates flags a date given only as "last updated", in any spelling', () => {
    const evidence = [{ url: 'https://endoflife.date/rust', text: 'Last updated on 16 October 2026\n1.99.1 (15 Oct 2026)' }];
    assert.deepEqual(updateLabelledDates('as of 16 Oct 2026', evidence, fixture.prompt),
      [{ date: '16 Oct 2026', url: 'https://endoflife.date/rust' }]);
    assert.deepEqual(updateLabelledDates('released 15 October 2026', evidence, fixture.prompt), []);
    assert.deepEqual(updateLabelledDates('as of 2026-10-16', evidence, 'When was the Rust page last updated?'), [],
      'a task asking for the update date wants it');
  });

  test('a date also given unlabelled is not flagged', () => {
    const evidence = [{ url: 'https://a.example/', text: 'Modified: 3 March 2026\nReleased 3 March 2026' }];
    assert.deepEqual(updateLabelledDates('3 March 2026', evidence, 'When was X released?'), []);
  });
});

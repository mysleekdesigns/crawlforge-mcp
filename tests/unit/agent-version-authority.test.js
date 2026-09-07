/**
 * Unit tests: agent version-claim authority gate.
 * Run: node --test tests/unit/agent-version-authority.test.js
 *
 * Defect (R19, 2026-09-07): asked for the latest stable Caddy release, the
 * agent answered "2.4.3, September 2026" from a caddy.community thread about
 * CaddyUI — a different project — while caddyserver.com and the GitHub repo,
 * both fetched, stated no version at all. The literal provenance check passed
 * it, because the string really was on a fetched page: provenance asks whether
 * a value appears in the sources, not whether the source is the project.
 *
 * Ground truth at the time: Caddy v2.11.4, 2026-06-03, Apache-2.0 — a version
 * that appears in none of the fetched pages, so the honest answer is that the
 * sources do not state it.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDiscussionSource,
  isVersionQuestion,
  unsupportedVersionClaims
} from '../../src/core/AgentOrchestrator.js';

describe('isDiscussionSource', () => {
  test('names the hosted-forum conventions, not just the big aggregators', () => {
    for (const url of [
      'https://news.ycombinator.com/item?id=39165265',
      'https://www.reddit.com/r/discgolf/comments/wyp0eb/',
      'https://caddy.community/t/caddyui-v243-dashboard-polish',
      'https://community.acme.io/t/1',
      'https://forum.example.org/thread/2',
      'https://unix.stackexchange.com/questions/1'
    ]) {
      assert.equal(isDiscussionSource(url), true, url);
    }
  });

  test('a project site or repo is not a discussion source', () => {
    for (const url of ['https://caddyserver.com/', 'https://github.com/caddyserver/caddy', 'https://sqlite.org/']) {
      assert.equal(isDiscussionSource(url), false, url);
    }
  });

  test('an unparsable url is not treated as a discussion source', () => {
    assert.equal(isDiscussionSource('not a url'), false);
  });
});

describe('isVersionQuestion', () => {
  test('fires for a version or release question', () => {
    assert.equal(isVersionQuestion('What is the latest stable version of Caddy, and when was it released?'), true);
    assert.equal(isVersionQuestion('latest SQLite release'), true);
  });

  test('does not fire for a current-state question that is not about a version', () => {
    // The gate must not touch the pinned "#1 story on Hacker News" case, whose
    // authoritative source IS a discussion site.
    assert.equal(isVersionQuestion('What is the #1 story on Hacker News right now?'), false);
  });
});

describe('unsupportedVersionClaims', () => {
  const forum = { url: 'https://caddy.community/t/caddyui-v243', text: 'CaddyUI v2.4.3 — dashboard polish, released September 2026' };
  const site = { url: 'https://caddyserver.com/', text: 'Caddy automatically obtains and renews TLS certificates.' };
  const repo = { url: 'https://github.com/caddyserver/caddy', text: 'Caddy is a web server. Go 1.25.0 required.' };

  test('a version only a forum states is flagged', () => {
    const answer = 'The latest stable version of the Caddy web server is 2.4.3.';
    assert.deepEqual(unsupportedVersionClaims(answer, [forum, site, repo]), ['2.4.3']);
  });

  test('a version the project states is not flagged', () => {
    const sqlite = { url: 'https://sqlite.org/', text: 'Version 3.53.4 of SQLite was released on 2026-07-24.' };
    const answer = 'The latest stable version of SQLite is 3.53.4, released on 2026-07-24.';
    assert.deepEqual(unsupportedVersionClaims(answer, [sqlite]), []);
  });

  test('a version in a cited URL is a citation, not a claim', () => {
    const answer = 'See https://caddy.community/t/caddyui-v2.4.3 for discussion.';
    assert.deepEqual(unsupportedVersionClaims(answer, [forum, site]), []);
  });

  test('nothing is flagged when only discussion pages were fetched', () => {
    // There was no better source to have preferred; the provenance check still
    // applies to the value itself.
    const answer = 'The version is 2.4.3.';
    assert.deepEqual(unsupportedVersionClaims(answer, [forum]), []);
  });

  test('an answer with no version is not flagged', () => {
    const answer = 'The sources do not state a current version.';
    assert.deepEqual(unsupportedVersionClaims(answer, [forum, site]), []);
  });
});

describe('the gate in the orchestrator', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; });

  test('a forum-only version is rewritten, and flagged if it survives', async () => {
    const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');
    const o = new AgentOrchestrator({});

    const prompts = [];
    // A stubborn model: it answers with the forum version both times, so the
    // flag path is exercised rather than the rewrite path.
    o._samplingClient = {
      complete: async (p) => {
        prompts.push(p);
        return { text: 'The latest stable version of Caddy is 2.4.3.', provider: 'mock' };
      }
    };
    o._searchTool = {
      execute: async () => ({
        results: [
          { link: 'https://caddy.community/t/caddyui-v243', title: 'CaddyUI v2.4.3', snippet: 'caddy release' },
          { link: 'https://caddyserver.com/', title: 'Caddy', snippet: 'caddy web server' }
        ]
      })
    };
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      url,
      headers: { get: () => null },
      text: async () => url.includes('community')
        ? '<html><body><p>CaddyUI v2.4.3 released, caddy web server version dashboard</p></body></html>'
        : '<html><body><p>Caddy is a web server with automatic HTTPS. No version or release stated here.</p></body></html>'
    });

    const result = await o.run({
      prompt: 'What is the latest stable version of the Caddy web server and when was it released?',
      maxSteps: 5,
      maxUrls: 5
    });

    assert.ok(
      prompts.some(p => /only in forum or discussion pages/.test(p)),
      'a corrective rewrite naming the forum-only version must be requested'
    );
    assert.deepEqual(result.provenance.unsupported_versions, ['2.4.3']);
    assert.equal(result.degraded, true, 'an unsupported version claim degrades the run');
    assert.match(result.reason, /only in discussion pages/);
    assert.match(result.answer, /Source warning/);
    assert.equal(result.provenance.checked, true, 'provenance was checked; the run degraded for another reason');
  });
});

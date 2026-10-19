/**
 * R25 Phase 1.6 regressions: agent answers current-state questions from the
 * wrong source.
 *
 * Run: node --test --test-force-exit tests/unit/r25-phase1-agent-current-state.test.js
 *
 * Live repros (2026-10-19, search on Brave, which returns each origin about once):
 *   - "What is the latest stable Python release version?" — every origin of the
 *     entity query "Python" tied at one vote, so the top-ranked one,
 *     en.wikipedia.org, was promoted and its root (the Wikipedia Main Page)
 *     led synthesis. python.org was fetched, but its "Latest: Python 3.15.0"
 *     sits ~3 500 characters in, under the navigation menus, past the
 *     2 400-character per-source share. Answer: "not stated", degraded:false.
 *   - "What is the #1 story on Hacker News right now?" — thehackernews.com
 *     appeared twice for "Hacker News" and outvoted news.ycombinator.com; the
 *     answer was a cybersecurity article, degraded:false.
 * The search result lists below are the ones Brave returned in those runs.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentOrchestrator,
  isCurrentStateTask,
  isOfficialResult,
  sliceForSynthesis
} from '../../src/core/AgentOrchestrator.js';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

const PY_PROMPT = 'What is the latest stable Python release version?';
const HN_PROMPT = 'What is the #1 story on Hacker News right now? Report its exact title and points.';

const PY_ENTITY_RESULTS = [
  { link: 'https://en.wikipedia.org/wiki/Python_(programming_language)', title: 'Python (programming language) - Wikipedia' },
  { link: 'https://www.python.org/', title: 'Welcome to Python.org' },
  { link: 'https://www.online-python.com/', title: 'Online Python - IDE, Editor, Compiler, Interpreter' },
  { link: 'https://marketplace.visualstudio.com/items?itemName=ms-python.python', title: 'Python - Visual Studio Marketplace' },
  { link: 'https://www.w3schools.com/python/', title: 'Python Tutorial' }
];
const PY_FACT_RESULTS = [
  { link: 'https://www.liquidweb.com/blog/latest-python-version/', title: "Latest Python Version (2025) – What's New in Python 3.14?" },
  { link: 'https://devguide.python.org/versions/', title: 'Status of Python versions' }
];
const HN_ENTITY_RESULTS = [
  { link: 'https://thehackernews.com/search/label/Hacker%20News', title: 'Hacker News — Latest News, Reports & Analysis | The Hacker News' },
  { link: 'https://thehackernews.com/', title: 'The Hacker News | #1 Trusted Source for Cybersecurity News' },
  { link: 'https://en.wikipedia.org/wiki/Hacker_News', title: 'Hacker News - Wikipedia' },
  { link: 'https://hn.algolia.com/', title: 'Search Hacker News - Algolia' },
  { link: 'https://news.ycombinator.com/', title: 'Hacker News' }
];

/** python.org's shape: ~3 000 characters of menu links before the answer. */
const NAV = Array.from({ length: 300 }, (_, i) => `Menu link ${i}`).join('\n');
const PYTHON_ORG_TEXT = `${NAV}\nDownload\nPython source code and installers are available for download for all versions!\nLatest: Python 3.15.0\nDocs`;

/** One <p> per line, so the fetched text keeps the line breaks a real page's blocks give it. */
const page = text => `<html><head><title>t</title></head><body>${text.split('\n').map(l => `<p>${l}</p>`).join('')}</body></html>`;

function stubFetch(pages) {
  globalThis.fetch = async (url) => {
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

/**
 * An orchestrator with search and LLM stubbed. PLAN answers `entity`; the
 * synthesis call is answered by `answer(synthesisPrompt)`.
 */
function agent({ entity, entityResults, factResults = [], answer }) {
  const o = new AgentOrchestrator({});
  const prompts = [];
  o._samplingClient = {
    complete: async (p) => {
      prompts.push(p);
      return { text: prompts.length === 1 ? entity : answer(p), provider: 'mock' };
    }
  };
  o._searchTool = {
    execute: async ({ query }) => ({
      results: (query === entity ? entityResults : factResults).map(r => ({ ...r, snippet: '' }))
    })
  };
  return { o, prompts, synthesis: () => prompts.find(p => p.includes('--- Source:')) };
}

/** The first "--- Source: <url>" block of a synthesis prompt. */
function firstSource(synthesis) {
  return synthesis.match(/--- Source: (\S+)/)?.[1];
}

describe('CURRENT_STATE_RE', () => {
  test('plain "current" marks a current-state task', () => {
    assert.equal(isCurrentStateTask('What is the current stable version of Python?'), true);
    assert.equal(isCurrentStateTask('Report the title of the current #1 story.'), true);
    // Still not a recency marker inside another word.
    assert.equal(isCurrentStateTask('How do ocean currents form?'), false);
  });
});

describe('isOfficialResult', () => {
  test('the domain named after the entity is official; a look-alike is not', () => {
    assert.equal(isOfficialResult('Python', 'https://www.python.org/', 'Welcome to Python.org'), true);
    assert.equal(isOfficialResult('Python', 'https://www.python.org/downloads/', 'Download Python'), true);
    assert.equal(isOfficialResult('Python', 'https://www.online-python.com/', 'Online Python'), false);
    assert.equal(isOfficialResult('Python', 'https://en.wikipedia.org/wiki/Python_(programming_language)', 'Python (programming language) - Wikipedia'), false);
  });

  test('a site root titled exactly the entity is official; thehackernews.com is not', () => {
    assert.equal(isOfficialResult('Hacker News', 'https://news.ycombinator.com/', 'Hacker News'), true);
    assert.equal(isOfficialResult('Hacker News', 'https://thehackernews.com/', 'The Hacker News | #1 Trusted Source for Cybersecurity News'), false);
    assert.equal(isOfficialResult('Hacker News', 'https://thehackernews.com/search/label/Hacker%20News', 'Hacker News — Latest News, Reports & Analysis | The Hacker News'), false);
    // An article titled after the entity is about it, not its site.
    assert.equal(isOfficialResult('Hacker News', 'https://en.wikipedia.org/wiki/Hacker_News', 'Hacker News - Wikipedia'), false);
    assert.equal(isOfficialResult('Hacker News', 'https://hn.algolia.com/', 'Search Hacker News - Algolia'), false);
  });

  test('a two-part country suffix is skipped', () => {
    assert.equal(isOfficialResult('BBC', 'https://www.bbc.co.uk/news', 'BBC News'), true);
  });
});

describe('sliceForSynthesis', () => {
  const terms = ['latest', 'stable', 'python', 'release', 'version'];

  test('an answer below the navigation menus survives the per-source cut', () => {
    assert.ok(PYTHON_ORG_TEXT.indexOf('Latest: Python 3.15.0') > 2400);
    const slice = sliceForSynthesis(PYTHON_ORG_TEXT, 2400, terms);
    assert.ok(slice.includes('Latest: Python 3.15.0'));
    assert.ok(slice.startsWith('Menu link 0'), 'the head of the page is still kept');
    assert.ok(slice.length <= 2400 + 40);
  });

  test('a page that matches as well above the cut is cut from the top as before', () => {
    const text = `Latest Python release\n${NAV}\nPython release notes`;
    assert.equal(sliceForSynthesis(text, 2400, terms), `${text.slice(0, 2400)}\n[...truncated]`);
  });

  test('short text is returned whole', () => {
    assert.equal(sliceForSynthesis('Latest: Python 3.15.0', 2400, terms), 'Latest: Python 3.15.0');
  });
});

describe('agent current-state source choice', () => {
  test('Python repro: python.org leads synthesis with its "Latest:" line, not the Wikipedia Main Page', async () => {
    const fetched = [];
    const pages = {
      'https://www.python.org/': page(PYTHON_ORG_TEXT),
      'https://en.wikipedia.org/': page('Wikipedia Main Page. Latest featured article. Python stable release version news.'),
      'https://en.wikipedia.org/wiki/Python_(programming_language)': page('Python stable release 3.12 latest version, what release version Python'),
      'https://www.online-python.com/': page('Online Python latest stable release version editor'),
      'https://marketplace.visualstudio.com/items?itemName=ms-python.python': page('Python extension latest release version'),
      'https://www.w3schools.com/python/': page('Python tutorial latest version')
    };
    stubFetch(pages);
    const wrapped = globalThis.fetch;
    globalThis.fetch = async (url, ...rest) => { fetched.push(String(url)); return wrapped(url, ...rest); };

    const { o, synthesis } = agent({
      entity: 'Python',
      entityResults: PY_ENTITY_RESULTS,
      factResults: PY_FACT_RESULTS,
      answer: p => (firstSource(p) === 'https://www.python.org/' && p.includes('Latest: Python 3.15.0')
        ? 'The latest stable Python release is Python 3.15.0 (https://www.python.org/).'
        : 'The latest stable Python release version is not stated in the provided sources.')
    });

    const result = await o.run({ prompt: PY_PROMPT });

    assert.ok(!fetched.includes('https://en.wikipedia.org/'), 'the Wikipedia Main Page must not be promoted');
    assert.equal(firstSource(synthesis()), 'https://www.python.org/');
    assert.ok(synthesis().includes('Latest: Python 3.15.0'), 'the per-source share must keep the answer line');
    assert.match(result.answer, /3\.15\.0/);
    assert.equal(result.degraded, false);
  });

  test('HN repro: news.ycombinator.com is promoted although thehackernews.com has more votes', async () => {
    stubFetch({
      'https://news.ycombinator.com/': page('Hacker News new | past | comments\n1. Putting Linux on my RTX spark laptop (josie.lol)\n73 points by pfeifferj'),
      'https://thehackernews.com/': page('The Hacker News #1 story right now: exact title report points Hacker News cybersecurity'),
      'https://thehackernews.com/search/label/Hacker%20News': page('Hacker News story title points report right now'),
      'https://en.wikipedia.org/wiki/Hacker_News': page('Hacker News is a social news website story points'),
      'https://hn.algolia.com/': page('Search Hacker News story points')
    });

    const { o, synthesis } = agent({
      entity: 'Hacker News',
      entityResults: HN_ENTITY_RESULTS,
      answer: () => 'The #1 story is "Putting Linux on my RTX spark laptop" with 73 points (https://news.ycombinator.com/).'
    });

    const result = await o.run({ prompt: HN_PROMPT });

    assert.equal(firstSource(synthesis()), 'https://news.ycombinator.com/');
    assert.ok(synthesis().includes('Answer from the FIRST source below (the live page)'));
    assert.equal(result.degraded, false);
  });

  test('an answer taken from another source than the promoted live page is degraded', async () => {
    stubFetch({
      'https://news.ycombinator.com/': page('Hacker News new | past | comments\n1. Putting Linux on my RTX spark laptop (josie.lol)\n73 points by pfeifferj'),
      'https://thehackernews.com/': page('The Hacker News #1 story right now: Hackers Exploit Plex2Shell Flaws, 69 points')
    });

    const { o } = agent({
      entity: 'Hacker News',
      entityResults: HN_ENTITY_RESULTS,
      answer: () => 'The #1 story is "Hackers Exploit Plex2Shell Flaws" (https://thehackernews.com/).'
    });

    const result = await o.run({ prompt: HN_PROMPT });

    assert.equal(result.degraded, true);
    assert.match(result.reason, /does not come from the live page https:\/\/news\.ycombinator\.com\//);
  });

  test('a "not stated" answer over a promoted live page is degraded', async () => {
    stubFetch({ 'https://www.python.org/': page(PYTHON_ORG_TEXT) });

    const { o } = agent({
      entity: 'Python',
      entityResults: PY_ENTITY_RESULTS,
      answer: () => 'The latest stable Python release version is not stated in the provided sources.'
    });

    const result = await o.run({ prompt: PY_PROMPT });

    assert.equal(result.degraded, true);
    assert.match(result.reason, /live page https:\/\/www\.python\.org\//);
  });

  test('an answer stating a value shown on the live page is not degraded even without a citation', async () => {
    stubFetch({ 'https://www.python.org/': page(PYTHON_ORG_TEXT) });

    const { o } = agent({
      entity: 'Python',
      entityResults: PY_ENTITY_RESULTS,
      answer: () => 'The latest stable release is Python 3.15.0.'
    });

    const result = await o.run({ prompt: PY_PROMPT });

    assert.equal(result.degraded, false);
  });

  test('a tied vote with no official site promotes no origin', async () => {
    const fetched = [];
    const results = [
      { link: 'https://en.wikipedia.org/wiki/Widget', title: 'Widget - Wikipedia' },
      { link: 'https://blog.example/widgets', title: 'All about widgets' },
      { link: 'https://shop.example/widget', title: 'Buy a widget' }
    ];
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => page('Widget latest price today') };
    };

    const { o, synthesis } = agent({ entity: 'Widget', entityResults: results, answer: () => 'mock answer' });

    const result = await o.run({ prompt: 'What is the latest Widget price today?' });

    assert.ok(!fetched.includes('https://en.wikipedia.org/'), 'no site root is promoted on a tie');
    assert.ok(!synthesis().includes('(the live page)'), 'no source is called the live page when none was promoted');
    assert.ok(synthesis().includes("Prefer the subject's own official site"));
    assert.equal(result.degraded, false);
  });
});

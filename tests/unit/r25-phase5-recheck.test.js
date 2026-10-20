/**
 * R25 live MCP stdio re-check regressions (2026-10-19, after 6.22.0).
 *
 * Run: node --test --test-force-exit tests/unit/r25-phase5-recheck.test.js
 *
 * 1. agent: asked "What is the current top story on Hacker News?", the answer
 *    had the right title ("France's supermarket fridges were vulnerable online
 *    for months (ipinfo.io)", topstories id 50159616) and cited
 *    https://news.ycombinator.com/item?id=26057100, a 2021 story in none of the
 *    fetched sources. provenance said {checked:true, unverified:[]}: the value
 *    check skips URLs.
 * 2. deep_research: "What anti-bot systems do major websites use in 2026"
 *    reported scrappey.com's table of contents, welded into one line, and a
 *    table row as findings.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AgentOrchestrator, unverifiedUrls, urlsIn } from '../../src/core/AgentOrchestrator.js';
import { claimStatements } from '../../src/core/ResearchOrchestrator.js';

const HN_PROMPT = 'What is the current top story on Hacker News?';
const TITLE = "France's supermarket fridges were vulnerable online for months (ipinfo.io)";
const INVENTED = 'https://news.ycombinator.com/item?id=26057100';
const REAL = 'https://news.ycombinator.com/item?id=50159616';

describe('urlsIn', () => {
  test('trailing punctuation and a markdown link\'s closing parenthesis are not part of the URL', () => {
    assert.deepEqual(
      urlsIn(`See [the story](${REAL}). Also ${INVENTED}, and https://en.wikipedia.org/wiki/Foo_(bar).`),
      [REAL, INVENTED, 'https://en.wikipedia.org/wiki/Foo_(bar)']
    );
  });
});

describe('unverifiedUrls', () => {
  const citable = ['https://news.ycombinator.com/', 'https://news.ycombinator.com/news', REAL];

  test('the R25 repro: an item link no fetched page contains is flagged', () => {
    const answer = `The current top story is "${TITLE}" (${INVENTED}).`;
    assert.deepEqual(unverifiedUrls(answer, citable, 'Hacker News\n1. ' + TITLE), [INVENTED]);
  });

  test('a fetched page or a link on it is not flagged, whatever its scheme, www, fragment or trailing slash', () => {
    const answer =
      `Source: http://news.ycombinator.com/item?id=50159616#comments, https://www.news.ycombinator.com, ` +
      'https://news.ycombinator.com/news/.';
    assert.deepEqual(unverifiedUrls(answer, citable), []);
  });

  test('a URL written in the source text is not flagged', () => {
    const answer = 'Details at https://ipinfo.io/blog/fridges.';
    assert.deepEqual(unverifiedUrls(answer, citable, 'Read more: https://ipinfo.io/blog/fridges'), []);
  });

  test('the same link is named once; an answer with no URL has nothing to flag', () => {
    assert.deepEqual(unverifiedUrls(`${INVENTED} and ${INVENTED}#top`, citable), [INVENTED]);
    assert.deepEqual(unverifiedUrls(`The top story is "${TITLE}".`, citable), []);
  });
});

describe('agent: a cited URL is checked against the fetched pages and their links', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; });

  const HN_FRONT_PAGE =
    '<html><head><title>Hacker News</title></head><body><table>' +
    `<tr><td>1.</td><td><a href="https://ipinfo.io/blog/fridges">${TITLE}</a></td></tr>` +
    '<tr><td>412 points by someone | <a href="item?id=50159616">97 comments</a></td></tr>' +
    '</table><p>Hacker News top story current front page</p></body></html>';

  function agent(answer) {
    globalThis.fetch = async (url) => ({
      ok: url === 'https://news.ycombinator.com/',
      status: url === 'https://news.ycombinator.com/' ? 200 : 404,
      url,
      headers: { get: () => null },
      text: async () => (url === 'https://news.ycombinator.com/' ? HN_FRONT_PAGE : '<html><body>Not Found</body></html>')
    });
    const o = new AgentOrchestrator({});
    const prompts = [];
    o._samplingClient = {
      complete: async (p) => {
        prompts.push(p);
        return { text: prompts.length === 1 ? 'Hacker News' : answer(p), provider: 'mock' };
      }
    };
    o._searchTool = {
      execute: async () => ({ results: [{ link: 'https://news.ycombinator.com/', title: 'Hacker News', snippet: '' }] })
    };
    return { o, prompts };
  }

  test('an invented link triggers the corrective rewrite; the real item link passes', async () => {
    const { o, prompts } = agent(p => (p.includes('It cites URLs')
      ? `The current top story is "${TITLE}" (${REAL}).`
      : `The current top story is "${TITLE}" (${INVENTED}).`));

    const result = await o.run({ prompt: HN_PROMPT, maxSteps: 3, maxUrls: 3 });

    assert.ok(prompts.some(p => p.includes(`It cites URLs that are not among the sources or the links on them: ${INVENTED}`)));
    assert.equal(result.answer, `The current top story is "${TITLE}" (${REAL}).`);
    assert.deepEqual(result.provenance, { checked: true, unverified: [] }, 'unverified_urls is present only when a URL is flagged');
  });

  test('an invented link that survives the rewrite is flagged in the answer and in provenance', async () => {
    const { o } = agent(() => `The current top story is "${TITLE}" (${INVENTED}).`);

    const result = await o.run({ prompt: HN_PROMPT, maxSteps: 3, maxUrls: 3 });

    assert.deepEqual(result.provenance.unverified_urls, [INVENTED]);
    assert.deepEqual(result.provenance.unverified, []);
    assert.match(result.answer, /Provenance warning: https:\/\/news\.ycombinator\.com\/item\?id=26057100 is not among the fetched pages/);
  });
});

describe('deep_research claims: table rows and welded headings are not statements', () => {
  test('the welded table of contents from scrappey.com is dropped', () => {
    assert.deepEqual(
      claimStatements('The six vendors at a glanceWhat the independent benchmarks showWhy your approach has to change per vendor'),
      []
    );
    assert.deepEqual(
      claimStatements('The cheatsheetIdentification workflow on a single responseCookie state machines that matterHow the vendors differ architecturally'),
      []
    );
  });

  test('a table row is dropped and the sentence after it kept', () => {
    assert.deepEqual(
      claimStatements(
        'Cloudflare | CDN with an optional web application firewall (WAF), Bot Management and Turnstile layers | High | ~20% of all websites; large e-commerce and jobs marketplaces (e.g. StockX, Indeed)\n' +
        'Cloudflare protects roughly a fifth of all websites.'
      ),
      ['Cloudflare protects roughly a fifth of all websites.']
    );
    assert.deepEqual(claimStatements('| Vendor | Strength |\n|---|---|'), []);
    // A two-cell row has one separator (stdio re-check of this fix, 2026-10-19).
    assert.deepEqual(
      claimStatements('Data source | Independent 2026 benchmarking (Scrapeway) - 11 targets, 1,000+ requests/service, twice monthly'),
      []
    );
  });

  test('a lowercase line after a dropped row starts its own statement', () => {
    assert.deepEqual(
      claimStatements('Kasada uses client-side code interrogation.\nDataDome | EU | High\nper-site ML scoring is common.'),
      ['Kasada uses client-side code interrogation.', 'per-site ML scoring is common.']
    );
  });

  test('camelCase product names and code identifiers in a sentence are kept', () => {
    for (const claim of [
      'PerimeterX and DataDome rely on JavaScript challenges',
      'DataDome, PerimeterX, JavaScript and TypeScript SDKs are common.',
      'Kasada inspects client code with Function.prototype.toString(), which is why runtime JavaScript patching behaves differently.',
      'DOMRect fingerprinting measures sub-pixel geometry, usually through getBoundingClientRect().',
      'Media devices fingerprinting reads navigator.mediaDevices.enumerateDevices().'
    ]) {
      assert.deepEqual(claimStatements(claim), [claim], claim);
    }
  });
});

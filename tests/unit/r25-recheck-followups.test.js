/**
 * R25 re-check follow-ups (2026-10-20, after 6.22.2).
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test --test-force-exit tests/unit/r25-recheck-followups.test.js
 *
 * 1. agent: the synthesis prompt carried page text only, never a link target,
 *    so the answer could name the current HN top story but not link it, and
 *    cited an item URL from memory. Each source now lists the links whose
 *    anchor text the model reads.
 * 2. agent: the live-page check accepted any answer containing the live host,
 *    an invented URL on that host included.
 * 3. deep_research ("What anti-bot systems do major websites use in 2026")
 *    reported a rubric weight, an opening hook, an FAQ heading and a finding
 *    cut off mid-word ("…can range from no bot pro") as key findings.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AgentOrchestrator, linksForSynthesis } from '../../src/core/AgentOrchestrator.js';
import { ResearchOrchestrator, cutAtSentence } from '../../src/core/ResearchOrchestrator.js';
import { isAdmissibleClaim } from '../../src/core/research/claimFilters.js';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

const TITLE = "France's supermarket fridges were vulnerable online for months";
const STORY = 'https://ipinfo.io/blog/fridges';
const INVENTED = 'https://news.ycombinator.com/item?id=26057100';

describe('linksForSynthesis', () => {
  const PAGE = 'https://news.ycombinator.com/';
  const excerpt = `1. ${TITLE}\n412 points | 97 comments\n2. Show HN: A tiny static site generator\nAbout the guidelines page`;

  test('only links whose anchor text is in the excerpt and names something; none to the page itself', () => {
    const links = [
      { url: STORY, text: TITLE },
      { url: 'https://news.ycombinator.com/item?id=50159616', text: '97 comments' },
      { url: 'https://example.com/never-shown', text: 'A story past the excerpt cut' },
      { url: 'https://news.ycombinator.com/#top', text: 'Show HN: A tiny static site generator' },
      { url: `${STORY}#comments`, text: TITLE }
    ];
    assert.deepEqual(linksForSynthesis(links, excerpt, PAGE, []), [{ url: STORY, text: TITLE }]);
  });

  test('links naming a task term come first, then page order; at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ url: `https://example.com/${i}`, text: `Story number ${i} here` }));
    const text = many.map(l => l.text).join('\n') + `\n${TITLE}`;
    const links = [...many, { url: STORY, text: TITLE }];
    const listed = linksForSynthesis(links, text, PAGE, ['fridges']);
    assert.equal(listed.length, 8);
    assert.deepEqual(listed[0], { url: STORY, text: TITLE });
    assert.equal(listed[1].url, 'https://example.com/0');
  });
});

describe('agent: link targets reach the synthesis prompt', () => {
  const HN_FRONT_PAGE =
    '<html><head><title>Hacker News</title></head><body><table>' +
    `<tr><td>1.</td><td><a href="${STORY}">${TITLE}</a></td></tr>` +
    '<tr><td>412 points by someone | <a href="item?id=50159616">97 comments</a></td></tr>' +
    '</table><p>Hacker News top story current front page</p></body></html>';

  test('the story title is listed with its URL under its source', async () => {
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
        return { text: prompts.length === 1 ? 'Hacker News' : `The top story is "${TITLE}" (${STORY}).`, provider: 'mock' };
      }
    };
    o._searchTool = {
      execute: async () => ({ results: [{ link: 'https://news.ycombinator.com/', title: 'Hacker News', snippet: '' }] })
    };

    const result = await o.run({ prompt: 'What is the current top story on Hacker News?', maxSteps: 3, maxUrls: 3 });

    const synthesis = prompts.find(p => p.includes('--- Source:'));
    assert.ok(synthesis.includes(`Links on this page:\n- ${TITLE}: ${STORY}`), 'the title link is listed');
    assert.ok(!synthesis.includes('- 97 comments:'), 'a two-word link names nothing');
    assert.ok(synthesis.includes('the URL an item has under "Links on this page"'));
    assert.equal(result.answer, `The top story is "${TITLE}" (${STORY}).`);
    assert.deepEqual(result.provenance, { checked: true, unverified: [] });
  });
});

describe('agent: an invented URL on the live host does not count as citing the live page', () => {
  const HN_ENTITY_RESULTS = [
    { link: 'https://thehackernews.com/', title: 'The Hacker News | #1 Trusted Source for Cybersecurity News' },
    { link: 'https://news.ycombinator.com/', title: 'Hacker News' }
  ];
  const page = text => `<html><head><title>t</title></head><body>${text.split('\n').map(l => `<p>${l}</p>`).join('')}</body></html>`;

  function run(answer) {
    const pages = {
      'https://news.ycombinator.com/': page('Hacker News new | past | comments\n1. Putting Linux on my RTX spark laptop (josie.lol)\n73 points by pfeifferj')
        .replace('</body>', '<p><a href="https://github.com/deepseek-ai/DeepInfer">DeepSeek just open-sourced its inference engine</a></p></body>'),
      'https://thehackernews.com/': page('The Hacker News #1 story right now: Hackers Exploit Plex2Shell Flaws')
    };
    globalThis.fetch = async (url) => ({
      ok: pages[url] !== undefined,
      status: pages[url] !== undefined ? 200 : 404,
      url,
      headers: { get: () => null },
      text: async () => pages[url] ?? '<html><body>Not Found</body></html>'
    });
    const o = new AgentOrchestrator({});
    let calls = 0;
    o._samplingClient = { complete: async () => ({ text: calls++ === 0 ? 'Hacker News' : answer, provider: 'mock' }) };
    o._searchTool = {
      execute: async ({ query }) => ({ results: query === 'Hacker News' ? HN_ENTITY_RESULTS.map(r => ({ ...r, snippet: '' })) : [] })
    };
    return o.run({ prompt: 'What is the #1 story on Hacker News right now? Report its exact title.' });
  }

  test('a third-party answer with an invented news.ycombinator.com link is degraded', async () => {
    const result = await run(`The #1 story is "Hackers Exploit Plex2Shell Flaws" (${INVENTED}).`);
    assert.deepEqual(result.provenance.unverified_urls, [INVENTED]);
    assert.equal(result.degraded, true);
    assert.match(result.reason, /does not come from the live page https:\/\/news\.ycombinator\.com\//);
  });

  test('an answer naming an item the live page links counts, with no URL or value', async () => {
    const result = await run('The current top story is "DeepSeek just open-sourced its inference engine" (github.com/deepseek-ai).');
    assert.equal(result.degraded, false);
  });

  test('citing the fetched live page itself still counts', async () => {
    const result = await run('The #1 story is "Putting Linux on my RTX spark laptop" (https://news.ycombinator.com/).');
    assert.equal(result.degraded, false);
  });
});

describe('deep_research: lines that are not statements are not findings', () => {
  test('the R25 re-check lines are rejected', () => {
    for (const text of [
      'Detection technology (signatures, ML, rules, session/event models): 25%',
      'Client market and case maturity (industries, scales, public cases): 10%',
      'If you’ve ever rage-clicked on a "select all images with a traffic light" puzzle, you already understand the problem with CAPTCHAs.',
      'What makes a good anti-bot solution?',
      'Have you ever wondered why a site keeps asking whether you are human?',
      'What you are experiencing is the cat-and-mouse game between bots and the websites trying to stop them.',
      "Here's how Cloudflare, Akamai, Kasada, and PerimeterX each weigh those layers differently, and what actually holds up against each."
    ]) {
      assert.equal(isAdmissibleClaim(text), false, `should reject: ${text}`);
    }
  });

  test('statements carrying percentages, a colon or "you" are kept', () => {
    for (const text of [
      'Cloudflare defends 73.3% of the 3,859 domains and recorded a 6.7% block rate.',
      'Imperva block rate: the measured share was 46.6%.',
      'If a request lacks the cf_clearance cookie, Cloudflare serves a challenge page.',
      "Your scripts run perfectly in testing, then production hits and you're dealing with CAPTCHA challenges and 2FA login flows."
    ]) {
      assert.equal(isAdmissibleClaim(text), true, `should admit: ${text}`);
    }
  });
});

describe('deep_research: page text is cut at a sentence end', () => {
  const LEAD = 'Anti-bot vendors differ in where they run. '.repeat(3);
  const CUT_SENTENCE = 'Cloudflare runs at the CDN edge; the same hostname can range from no bot protection to full Bot Management.';

  test('cutAtSentence ends at the last sentence or line end inside the limit', () => {
    const text = LEAD + CUT_SENTENCE;
    const cut = cutAtSentence(text, LEAD.length + 60);
    assert.equal(cut, LEAD.trimEnd());
    assert.equal(cutAtSentence('Short text.', 100), 'Short text.');
    assert.equal(cutAtSentence('A heading line here\nA line with no full stop that runs on', 25), 'A heading line here');
  });

  test('with no end in the second half it is a plain cut', () => {
    assert.equal(cutAtSentence(`One. ${'x'.repeat(100)}`, 50), `One. ${'x'.repeat(45)}`);
  });

  test('extractKeyClaims hands the summarizer whole sentences only', async () => {
    const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
    ro.llmManager.scoreClaimRelevance = async () => [];
    ro.llmManager.groupClaimsBySimilarity = async () => [];
    let seen;
    ro.summarizeTool = { execute: async ({ text }) => { seen = text; return { keypoints: [] }; } };
    const content = `${'Bot detection is layered across many signals. '.repeat(107)}${CUT_SENTENCE}`;
    assert.ok(content.length > 5000);

    await ro.extractKeyClaims([{ link: 'https://example.com/a', title: 'A', extractedContent: content, overallCredibility: 0.7 }]);

    assert.ok(seen.length <= 5000);
    assert.ok(seen.endsWith('signals.'), `cut mid-sentence: …${seen.slice(-30)}`);
  });
});

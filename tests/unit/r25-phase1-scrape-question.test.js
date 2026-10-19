/**
 * Live test R25, Phase 1, item 1.4: scrape's question format grounded an
 * answer on reference-list noise.
 *
 * On https://en.wikipedia.org/wiki/Python_(programming_language) the question
 * "Who created Python and when was it first released?" returned, as
 * grounded:true, a top five led by the "Why was Python created in the first
 * place?" citation and its "Archived … from the original" line: the ranker
 * scored link URLs, whose slugs repeat the question's words. The ranking
 * fix is in crawlforge-extractors 1.18.0; this file covers the server's
 * half, which holds with any extractors version: an answer is grounded only
 * when some evidence unit outside a reference list shows a content term of
 * the question in its visible text.
 *
 * Every fixture is verbatim from the live page as captured 2026-10-19: the
 * evidence units of the bad answer, and (attributes stripped) the History
 * paragraph and two reference-list entries.
 *
 * No LLM runs here: Ollama points at a closed port.
 *
 * Run: node --test --test-force-exit tests/unit/r25-phase1-scrape-question.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { UnifiedScrapeTool, evidenceSupport } = await import('../../src/tools/scrape/unifiedScrape.js');

const QUESTION = 'Who created Python and when was it first released?';

// The five evidence units the live call returned, best first.
const LIVE_EVIDENCE = [
  "[](#cite_ref-faq-created_20-0)[](#cite_ref-faq-created_20-1)[\"Why was Python created in the first place?\"](https://docs.python.org/faq/general.html#why-was-python-created-in-the-first-place). _General Python FAQ_.",
  "[Archived](https://web.archive.org/web/20121024164224/http://docs.python.org/faq/general.html#why-was-python-created-in-the-first-place) from the original on 24 October 2012.",
  "The C3 method itself has nothing to do with Python, since it was invented by people working on Dylan and it is described in a paper intended for lispers",
  "Python 3.0 was released on 3 December 2008, and was a major revision and not completely [backward-compatible](https://en.wikipedia.org/wiki/Backward-compatible \"Backward-compatible\") with earlier versions, with some new semantics and changed syntax.",
  "A function is defined similarly to how it is called, by first providing the function name and then the required parameters."
].map((text) => ({ text, heading: null }));

// The History section's first paragraph.
const HISTORY = "<p>Python was conceived in the late 1980s<sup class=\"mw-ref reference\"><a href=\"#cite_note-venners-interview-pt-1-13\"><span class=\"mw-reflink-text\"><span class=\"cite-bracket\">[</span>11<span class=\"cite-bracket\">]</span></span></a></sup> by <a href=\"https://en.wikipedia.org/wiki/Guido_van_Rossum\">Guido van Rossum</a> at <a href=\"https://en.wikipedia.org/wiki/Centrum_Wiskunde_&amp;_Informatica\">Centrum Wiskunde &amp; Informatica</a> (CWI) in the <a href=\"https://en.wikipedia.org/wiki/Netherlands\">Netherlands</a>.<sup class=\"mw-ref reference\"><a href=\"#cite_note-timeline-of-python-44\"><span class=\"mw-reflink-text\"><span class=\"cite-bracket\">[</span>42<span class=\"cite-bracket\">]</span></span></a></sup> It was designed as a successor to the <a href=\"https://en.wikipedia.org/wiki/ABC_(programming_language)\">ABC</a> programming language, which was inspired by <a href=\"https://en.wikipedia.org/wiki/SETL\">SETL</a>,<sup class=\"mw-ref reference\"><a href=\"#cite_note-AutoNT-12-45\"><span class=\"mw-reflink-text\"><span class=\"cite-bracket\">[</span>43<span class=\"cite-bracket\">]</span></span></a></sup> capable of <a href=\"https://en.wikipedia.org/wiki/Exception_handling\">exception handling</a> and interfacing with the <a href=\"https://en.wikipedia.org/wiki/Amoeba_(operating_system)\">Amoeba</a> operating system.<sup class=\"mw-ref reference\"><a href=\"#cite_note-faq-created-20\"><span class=\"mw-reflink-text\"><span class=\"cite-bracket\">[</span>18<span class=\"cite-bracket\">]</span></span></a></sup> Python implementation began in December 1989.<sup class=\"mw-ref reference\"><a href=\"#cite_note-timeline-of-python-44\"><span class=\"mw-reflink-text\"><span class=\"cite-bracket\">[</span>42<span class=\"cite-bracket\">]</span></span></a></sup> Van Rossum first released it in 1991 as Python 0.9.0.<sup class=\"mw-ref reference\"><a href=\"#cite_note-timeline-of-python-44\"><span class=\"mw-reflink-text\"><span class=\"cite-bracket\">[</span>42<span class=\"cite-bracket\">]</span></span></a></sup> Van Rossum assumed sole responsibility for the project, as the lead developer, until 12 July 2018, when he announced his \"permanent vacation\" from responsibilities as Python's \"<a href=\"https://en.wikipedia.org/wiki/Benevolent_dictator_for_life\">benevolent dictator for life</a>\" (BDFL); this title was bestowed on him by the Python community to reflect his long-term commitment as the project's chief decision-maker.<sup class=\"mw-ref reference\"><a href=\"#cite_note-lj-bdfl-resignation-46\"><span class=\"mw-reflink-text\"><span class=\"cite-bracket\">[</span>44<span class=\"cite-bracket\">]</span></span></a></sup><sup class=\"mw-ref reference\"><a href=\"#cite_note-47\" data-mw-group=\"lower-alpha\"><span class=\"mw-reflink-text\"><span class=\"cite-bracket\">[</span>c<span class=\"cite-bracket\">]</span></span></a></sup> In January 2019, active Python core developers elected a five-member Steering Council to lead the project.<sup class=\"mw-ref reference\"><a href=\"#cite_note-48\"><span class=\"mw-reflink-text\"><span class=\"cite-bracket\">[</span>45<span class=\"cite-bracket\">]</span></span></a></sup><sup class=\"mw-ref reference\"><a href=\"#cite_note-49\"><span class=\"mw-reflink-text\"><span class=\"cite-bracket\">[</span>46<span class=\"cite-bracket\">]</span></span></a></sup></p>";

// Two entries of the References list, back-links included.
const REFERENCES = "<li about=\"#cite_note-faq-created-20\" id=\"cite_note-faq-created-20\" data-mw-footnote-number=\"18\"><span rel=\"mw:referencedBy\" class=\"mw-cite-backlink\"><a href=\"#cite_ref-faq-created_20-0\"><span class=\"mw-linkback-text\">1</span></a> <a href=\"#cite_ref-faq-created_20-1\"><span class=\"mw-linkback-text\">2</span></a></span> <span class=\"mw-reference-text reference-text\"><cite class=\"citation web cs1\"><a rel=\"mw:ExtLink nofollow\" href=\"https://docs.python.org/faq/general.html#why-was-python-created-in-the-first-place\" class=\"external text\">\"Why was Python created in the first place?\"</a>. <i>General Python FAQ</i>. Python Software Foundation. <a rel=\"mw:ExtLink nofollow\" href=\"https://web.archive.org/web/20121024164224/http://docs.python.org/faq/general.html#why-was-python-created-in-the-first-place\" class=\"external text\">Archived</a> from the original on 24 October 2012<span class=\"reference-accessdate\">. Retrieved <span class=\"nowrap\">22 March</span> 2007</span>. <q>I had extensive experience with implementing an interpreted language in the ABC group at CWI, and from working with this group I had learned a lot about language design. This is the origin of many Python features, including the use of indentation for statement grouping and the inclusion of very high-level data types (although the details are all different in Python).</q></cite></span></li>\n<li about=\"#cite_note-1\" id=\"cite_note-1\" data-mw-footnote-number=\"1\"><span class=\"mw-cite-backlink\"><a href=\"#cite_ref-1\" rel=\"mw:referencedBy\"><span class=\"mw-linkback-text\">↑</span></a></span> <span class=\"mw-reference-text reference-text\"><cite class=\"citation web cs1\"><a rel=\"mw:ExtLink nofollow\" href=\"https://docs.python.org/3/faq/general.html#what-is-python\" class=\"external text\">\"General Python FAQ – Python 3 documentation\"</a>. <i>docs.python.org</i><span class=\"reference-accessdate\">. Retrieved <span class=\"nowrap\">7 July</span> 2024</span>.</cite></span></li>";

const page = (body) => `<!doctype html><html><head><title>Python (programming language) - Wikipedia</title></head><body>${body}</body></html>`;
const PAGES = {
  '/references-only': page(`<div class="mw-heading mw-heading2"><h2 id="References">References</h2></div><ol class="references">${REFERENCES}</ol>`),
  '/article': page(`<div class="mw-heading mw-heading2"><h2 id="History">History</h2></div>${HISTORY}<div class="mw-heading mw-heading2"><h2 id="References">References</h2></div><ol class="references">${REFERENCES}</ol>`)
};

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const body = PAGES[req.url];
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const ask = (path) => new UnifiedScrapeTool().execute({
  url: `${baseUrl}${path}`,
  formats: [{ type: 'question', question: QUESTION }],
  onlyMainContent: false,
  resolveHiddenContent: 'off'
});

describe('evidenceSupport (R25 1.4)', () => {
  test('the live top two — a #cite_ref entry and its "Archived" line — ground nothing', () => {
    const result = evidenceSupport(LIVE_EVIDENCE.slice(0, 2), QUESTION);
    assert.equal(result.supported, false);
    assert.match(result.reason, /visible text/);
  });

  test('a sentence of the article among the live five does ground the answer', () => {
    assert.equal(evidenceSupport(LIVE_EVIDENCE, QUESTION).supported, true);
  });

  test('evidence made only of reference-list entries is never grounded', () => {
    const result = evidenceSupport(LIVE_EVIDENCE.slice(0, 1), QUESTION);
    assert.equal(result.supported, false);
    assert.match(result.reason, /reference-list entry/);
    const underHeading = [{ text: 'This is the origin of many Python features.', heading: 'References' }];
    assert.equal(evidenceSupport(underHeading, QUESTION).supported, false);
    for (const heading of ['Notes', 'Citations', 'Sources', 'Notes and references']) {
      assert.equal(evidenceSupport([{ text: 'Python was first released in 1991.', heading }], QUESTION).supported, false, heading);
    }
  });

  test('a term found only in a link URL does not count; its label does', () => {
    const url = [{ text: '[Archived](https://example.org/why-was-python-created) from the original.', heading: null }];
    assert.equal(evidenceSupport(url, QUESTION).supported, false);
    const label = [{ text: '[Python](https://en.wikipedia.org/wiki/Python) is a language.', heading: null }];
    assert.equal(evidenceSupport(label, QUESTION).supported, true);
  });

  test('inflections match ("released" → "release"), stopwords do not, CJK matches by bigram', () => {
    assert.equal(evidenceSupport([{ text: 'The first release came in 1991.' }], QUESTION).supported, true);
    assert.equal(evidenceSupport([{ text: 'It was when it was.' }], QUESTION).supported, false);
    assert.equal(evidenceSupport([{ text: 'Python 由 Guido 创建。' }], 'Python是谁创建的？').supported, true);
  });

  test('no evidence is not support', () => {
    assert.equal(evidenceSupport([], QUESTION).supported, false);
  });
});

describe('scrape question format grounding (R25 1.4)', () => {
  test('a page of reference-list entries alone answers with grounded:false and says why', async () => {
    const { content, warnings } = await ask('/references-only');
    assert.ok(content.answer.evidence.length > 0, 'the ranker still returns its matches');
    assert.equal(content.answer.grounded, false);
    assert.ok(warnings.some((w) => /^question: .*grounded: false$/.test(w)), JSON.stringify(warnings));
  });

  test('with the History paragraph present, the answer is grounded and names Van Rossum', async () => {
    const { content } = await ask('/article');
    assert.equal(content.answer.grounded, true);
    assert.ok(
      content.answer.evidence.some((unit) => /Van Rossum/.test(unit.text)),
      JSON.stringify(content.answer.evidence.map((unit) => unit.text))
    );
  });
});

/**
 * Unit tests for src/server/fallbackHints.js and its withAuth wiring.
 *
 * Run: node --test tests/unit/fallbackHints.test.js
 *
 * Contract: every error result carries a "Next step:" hint naming the tool
 * to try next; success results are untouched; every billed tool has a hint.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CLASS_HINTS, FALLBACK_HINTS, SCRAPE_ESCALATED_HINT, appendFallbackHint, classifyError } from '../../src/server/fallbackHints.js';
import { makeWithAuth } from '../../src/server/withAuth.js';
import { markPreflightRefusal, requestContext } from '../../src/server/requestContext.js';

process.env.DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN || 'test';
process.env.DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD || 'test';
const { default: AuthManager } = await import('../../src/core/AuthManager.js');

const TOOLS = [
  'fetch_url', 'extract_text', 'extract_links', 'extract_metadata', 'extract_embedded_state',
  'scrape_structured', 'search_web', 'serp_rank', 'reddit_search', 'crawl_deep', 'map_site',
  'extract_content', 'process_document', 'summarize_content', 'analyze_content',
  'extract_structured', 'extract_with_llm', 'list_ollama_models', 'batch_scrape',
  'get_batch_results', 'read_result', 'scrape_with_actions', 'browser_session', 'deep_research',
  'scrape', 'agent', 'track_changes', 'generate_llms_txt', 'stealth_mode', 'localization',
  'scrape_template'
];

test('every registered tool has a fallback hint, and no hint is orphaned', () => {
  for (const t of TOOLS) assert.ok(FALLBACK_HINTS[t], `missing hint for ${t}`);
  for (const t of Object.keys(FALLBACK_HINTS)) assert.ok(TOOLS.includes(t), `hint for unknown tool ${t}`);
  assert.equal(Object.keys(FALLBACK_HINTS).length, 31);
});

const PARAM_TOKENS = new Set(['link_id', 'web_discovery', 'create_baseline', 'pdf_url', 'get_supported_countries']);

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

// R24 2.1: localization applies nothing to later calls, so its hint names the
// parameters that carry the values instead of "after configure_country".
test('the localization hint names real parameters and promises no persistence', () => {
  assert.match(FALLBACK_HINTS.localization, /applies none/);
  assert.match(FALLBACK_HINTS.localization, /fetch_url headers/);
  assert.match(FALLBACK_HINTS.localization, /stealthConfig:\{locale, timezone\}/);
  assert.doesNotMatch(FALLBACK_HINTS.localization, /after configure_country/);
  assert.doesNotMatch(SCRAPE_ESCALATED_HINT, /set a country/);
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
    // Not "timeout": that is a classified error with its own hint (R24 4.1).
    content: [{ type: 'text', text: 'Reddit search failed: HTTP 502' }], isError: true
  }));
  const failed = await failing({ query: 'x' });
  assert.match(failed.content[0].text, /Next step: Add subreddit or author/);

  const passing = withAuth('reddit_search', async () => ({
    content: [{ type: 'text', text: 'rows' }]
  }));
  const passed = await passing({ query: 'x' });
  assert.equal(passed.content[0].text, 'rows');
});

// Phase 3 (3.4): a scrape that already escalated must not be told to try the
// tool that has just failed.
test('an escalated scrape failure gets the second-stage hint, not stealth_mode', () => {
  const r = {
    content: [{ type: 'text', text: JSON.stringify({ success: false, escalated: true, error: 'blocked' }) }],
    isError: true
  };
  appendFallbackHint('scrape', r);
  const parsed = JSON.parse(r.content[0].text);
  assert.equal(parsed.next_step, SCRAPE_ESCALATED_HINT);
  // localization returns values only (R24 2.1): the hint must not send the
  // model there to "set a country".
  assert.match(parsed.next_step, /localization does not change/);
  assert.match(parsed.next_step, /residential proxies, which CrawlForge does not offer/);
  assert.doesNotMatch(parsed.next_step, /use stealth_mode/);
});

test('escalated:false and an un-escalated scrape still get the ordinary hint', () => {
  for (const body of [{ escalated: false, error: 'blocked' }, { error: 'blocked' }]) {
    const r = { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
    appendFallbackHint('scrape', r);
    assert.equal(JSON.parse(r.content[0].text).next_step, FALLBACK_HINTS.scrape);
  }
});

test('escalated:true on another tool changes nothing', () => {
  const r = { content: [{ type: 'text', text: JSON.stringify({ escalated: true }) }], isError: true };
  appendFallbackHint('map_site', r);
  assert.equal(JSON.parse(r.content[0].text).next_step, FALLBACK_HINTS.map_site);
});

test('cost table and hint table cover the same tools', () => {
  for (const t of TOOLS) assert.ok(AuthManager.getToolCost(t) >= 1, `${t} has no cost`);
});

// R24 4.1: an error every tool would hit the same way gets its class's hint,
// not the tool's generic one (which named a tool that fails the same way).
// The texts are the ones the live stdio repro returned.
describe('error-class hints', () => {
  const ROBOTS = 'robots.txt on www.google.com disallows this path for CrawlForge. Pass respect_robots: false to fetch it anyway — that override is recorded against your API key and is your decision to make.';
  const textError = (text) => ({ content: [{ type: 'text', text }], isError: true });
  const hintOf = (tool, result) => {
    appendFallbackHint(tool, result);
    const text = result.content[0].text;
    try { return JSON.parse(text).next_step; } catch { return text.split('\nNext step: ')[1]; }
  };

  test('a robots refusal is told no tool will fetch it, not to try stealth_mode', () => {
    for (const [tool, text] of [
      ['scrape', `Scrape failed: scrape: fetch failed for https://www.google.com/search?q=x: ${ROBOTS}`],
      ['stealth_mode', `Stealth mode operation failed: ${ROBOTS}`],
      ['fetch_url', `Failed to fetch URL: ${ROBOTS}`]
    ]) {
      const hint = hintOf(tool, textError(text));
      assert.equal(hint, CLASS_HINTS.robots(tool));
      assert.match(hint, /no CrawlForge tool will fetch it/);
      assert.match(hint, /do not retry with another tool/);
      assert.match(hint, /explicit decision, recorded against their API key, so do not set it on your own/);
      assert.doesNotMatch(hint, /use stealth_mode|try stealth_mode/);
    }
  });

  test('a robots refusal on a tool without respect_robots offers no override', () => {
    const hint = hintOf('generate_llms_txt', textError('robots.txt on a.com disallows CrawlForge for the whole site'));
    assert.match(hint, /This tool has no override/);
    assert.doesNotMatch(hint, /respect_robots/);
  });

  test('the robots class comes from the compliance gate flag too', () => {
    requestContext.run({ preflightRefusal: 'ROBOTS_DISALLOWED' }, () => {
      assert.equal(classifyError(null, 'Crawl failed').cls, 'robots');
    });
    assert.equal(classifyError({ code: 'ROBOTS_DISALLOWED', error: 'refused' }, '').cls, 'robots');
    assert.equal(classifyError({ code: 'HOST_BLOCKED', error: 'refused' }, '').cls, 'host_blocked');
  });

  test('an SSRF block is told every tool refuses it, not to use stealth', () => {
    for (const [tool, text] of [
      ['fetch_url', "Failed to fetch URL: SSRF Protection: blocked hostname '127.0.0.1'"],
      ['scrape', "Scrape failed: scrape: fetch failed for http://127.0.0.1/: SSRF Protection: blocked hostname '127.0.0.1'"]
    ]) {
      const hint = hintOf(tool, textError(text));
      assert.equal(hint, CLASS_HINTS.ssrf());
      assert.match(hint, /every CrawlForge tool refuses/);
      assert.doesNotMatch(hint, /stealth_mode/);
    }
    assert.equal(classifyError({ code: 'SSRF_BLOCKED', error: 'x' }, '').cls, 'ssrf');
  });

  test('a 404 is told the URL does not exist and to find the right one', () => {
    const body = { success: false, status: 404, error: 'answered with an error page' };
    assert.equal(hintOf('scrape', textError(JSON.stringify(body))), CLASS_HINTS.not_found());
    assert.equal(hintOf('extract_text', textError('Failed to extract text: Target answered HTTP 404')), CLASS_HINTS.not_found());
    assert.equal(classifyError(null, 'getaddrinfo ENOTFOUND nope.invalid').cls, 'not_found');
    assert.equal(classifyError(null, 'getaddrinfo EAI_AGAIN a.com'), null, 'a transient DNS failure is not a 404');
    assert.match(CLASS_HINTS.not_found(), /map_site .* search_web/);
  });

  test('a timeout is told to retry once with a longer timeout', () => {
    assert.equal(hintOf('fetch_url', textError('Failed to fetch URL: Request timeout after 1500ms')), CLASS_HINTS.timeout());
    assert.equal(classifyError(null, 'page.goto: Timeout 30000ms exceeded.').cls, 'timeout');
    // A selector that never appeared is a selector problem: the tool hint stands.
    assert.equal(classifyError({ error: 'Action failed: locator.waitFor: Timeout 1500ms exceeded.' }, ''), null);
  });

  test('a validation error names the parameter and says not to switch tools', () => {
    const zod = 'Content analysis failed: [\n  {\n    "expected": "number",\n    "code": "invalid_type",\n    "path": [\n      "options",\n      "maxTopics"\n    ],\n    "message": "Invalid input: expected number, received string"\n  }\n]';
    const hint = hintOf('analyze_content', { content: [{ type: 'text', text: JSON.stringify({ success: false, error: zod }) }] });
    assert.equal(hint, 'The input was rejected: fix options.maxTopics as the error describes and call analyze_content again. Do not switch tools for this.');
    assert.equal(hintOf('process_document', textError('Source parameter is required')), CLASS_HINTS.validation('process_document', []));
    // A refine()'s "custom" issue (scrape_with_actions, a wait action with nothing to wait for).
    const custom = '[\n  {\n    "code": "custom",\n    "path": [\n      "actions",\n      0\n    ],\n    "message": "Wait action requires duration/milliseconds/timeout, selector, or text"\n  }\n]';
    assert.deepEqual(classifyError({ success: false, error: custom }, ''), { cls: 'validation', params: ['actions.0'] });
  });

  test('an unclassified error still gets the tool hint; a named next step and the escalated hint still win', () => {
    assert.equal(hintOf('fetch_url', textError('Failed to fetch URL: HTTP 500')), FALLBACK_HINTS.fetch_url);
    const own = textError(`Failed: ${ROBOTS}\nNext step: use reddit_search`);
    appendFallbackHint('fetch_url', own);
    assert.equal(own.content[0].text.match(/Next step:/g).length, 1);
    const escalated = textError(JSON.stringify({ success: false, escalated: true, error: 'Request timeout' }));
    assert.equal(hintOf('scrape', escalated), SCRAPE_ESCALATED_HINT);
  });

  test('every class hint names only real tools or parameters', () => {
    const named = new Set([...TOOLS, 'respect_robots']);
    for (const make of Object.values(CLASS_HINTS)) {
      for (const tool of ['scrape', 'search_web']) {
        for (const ref of make(tool, []).match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) {
          assert.ok(named.has(ref), `class hint references unknown "${ref}"`);
        }
      }
    }
  });
});

// R24 4.1: these six returned success:false with no isError, so withAuth never
// appended a hint. The bodies are the live stdio repro's.
describe('success:false bodies without isError get a hint, billed as before', () => {
  const SSRF = "SSRF Protection: blocked hostname '127.0.0.1'";
  const BODIES = {
    extract_structured: { success: false, url: 'http://127.0.0.1/', data: {}, error: `Structured extraction failed: ${SSRF}`, validation: { valid: false, errors: [SSRF] } },
    extract_with_llm: { success: false, error: `Failed to fetch content: ${SSRF}` },
    process_document: { success: false, error: `Document processing failed: Failed to load PDF: Failed to download PDF from URL: ${SSRF}` },
    analyze_content: { success: false, error: 'Content analysis failed: [{"code": "invalid_type", "path": ["options", "maxTopics"], "message": "Invalid input: expected number, received string"}]' },
    summarize_content: { success: false, error: 'Content summarization failed: [{"code": "invalid_value", "path": ["options", "summaryLength"], "message": "Invalid option"}]' },
    track_changes: { success: false, error: 'Failed to fetch content: HTTP 404: Not Found' }
  };

  function billingAuth(toolCost) {
    const reportCalls = [];
    return {
      reportCalls,
      isCreatorMode: () => false,
      getToolCost: () => toolCost,
      checkCredits: async () => true,
      projectCost: () => ({ projected: toolCost, note: 'test' }),
      reportUsage: async (...args) => { reportCalls.push(args); }
    };
  }
  const logger = { info() {}, warn() {}, error() {}, debug() {} };

  for (const [tool, body] of Object.entries(BODIES)) {
    test(`${tool}: a hint lands and the charge is the full success charge it always was`, async () => {
      const auth = billingAuth(4);
      const withAuth = makeWithAuth({ authManager: auth, logger });
      const handler = withAuth(tool, async () => ({ content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] }));
      const result = await handler({});
      assert.equal(result.isError, undefined, 'isError is not added');
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(typeof parsed.next_step, 'string');
      assert.ok(parsed.next_step.length > 20);
      assert.equal(parsed._cost.actual, 4);
      assert.deepEqual(auth.reportCalls.map((c) => [c[1], c[3]]), [[4, 200]]);
    });
  }

  test('a success:true body and a nested success:false are untouched', async () => {
    const withAuth = makeWithAuth({ authManager: billingAuth(2), logger });
    for (const body of [{ success: true, data: 1 }, { success: true, results: [{ success: false, error: 'x' }] }]) {
      const result = await withAuth('batch_scrape', async () => ({ content: [{ type: 'text', text: JSON.stringify(body) }] }))({});
      assert.equal('next_step' in JSON.parse(result.content[0].text), false);
    }
  });

  test('an isError result is still billed half, and a robots refusal nothing', async () => {
    const auth = billingAuth(4);
    const withAuth = makeWithAuth({ authManager: auth, logger });
    await withAuth('fetch_url', async () => ({ content: [{ type: 'text', text: 'Failed to fetch URL: Request timeout after 1500ms' }], isError: true }))({});
    const refused = await withAuth('fetch_url', async () => {
      markPreflightRefusal('ROBOTS_DISALLOWED');
      return { content: [{ type: 'text', text: 'Failed to fetch URL: robots.txt on a.com disallows this path for CrawlForge.' }], isError: true };
    })({});
    assert.deepEqual(auth.reportCalls.map((c) => c[1]), [2]);
    assert.match(refused.content[0].text, /Next step: robots\.txt on this site disallows/);
  });
});

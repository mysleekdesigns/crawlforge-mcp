/**
 * R25 Phase 3 (3.2, 3.3 subset): error classes and action errors.
 *
 * Run: node --test --test-force-exit tests/unit/r25-phase3-hints.test.js
 *
 * - A selector that matched nothing was reported as a timeout ("the site is
 *   too slow") because the Playwright call log naming the wait is stripped
 *   before the error is classified; extract_text's selector miss was sent to
 *   stealth. Both now get the selector hint, and the action error names the
 *   selector.
 * - stealth_mode's "url is required" is a validation error and "Context not
 *   found" points at create_context, instead of one hint for every error.
 * - A wait action with `duration` and `selector` waits for the selector too.
 *
 * The error texts are the ones the live stdio repros returned (2026-10-19).
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { CLASS_HINTS, FALLBACK_HINTS, classifyError } from '../../src/server/fallbackHints.js';
import { makeWithAuth } from '../../src/server/withAuth.js';

const { ActionExecutor } = await import('../../src/core/ActionExecutor.js');

const auth = {
  isCreatorMode: () => true,
  getToolCost: () => 0,
  checkCredits: async () => true,
  projectCost: () => ({ projected: 0, note: 'test' }),
  reportUsage: async () => {}
};
const withAuth = makeWithAuth({ authManager: auth, logger: { info() {} } });

/** The hint withAuth puts on a handler's result: next_step, or the "Next step:" line. */
async function hintFor(tool, result) {
  const out = await withAuth(tool, async () => result)({});
  const text = out.content[0].text;
  try { return JSON.parse(text).next_step; } catch { return text.split('\nNext step: ')[1]; }
}
const textError = (text) => ({ content: [{ type: 'text', text }], isError: true });

// The raw executor message before the call-log strip, as Playwright formats it.
const CLICK_RAW = 'click on selector "#no-such-element-abc": locator.click: Timeout 4000ms exceeded.\n' +
  "Call log:\n\u001b[2m  - waiting for locator('#no-such-element-abc').first()\u001b[22m\n";

describe('3.2: a selector that matched nothing gets the selector hint, not the timeout hint', () => {
  test('scrape_with_actions click repro: the hint points at the selector, the error names it', async () => {
    const body = {
      success: false,
      error: `Action failed: ${CLICK_RAW}`,
      actionResults: [{ type: 'click', success: false, error: CLICK_RAW }]
    };
    const out = await withAuth('scrape_with_actions', async () => ({
      content: [{ type: 'text', text: JSON.stringify(body) }], isError: true
    }))({});
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.error, 'Action failed: click on selector "#no-such-element-abc": locator.click: Timeout 4000ms exceeded.');
    assert.equal(parsed.next_step, CLASS_HINTS.selector('scrape_with_actions'));
    assert.match(parsed.next_step, /selector problem, not a slow site/);
    assert.match(parsed.next_step, /scrape formats:\["html"\]/);
    assert.doesNotMatch(parsed.next_step, /too slow from here/);
  });

  test('classified the same before and after the call log is stripped', () => {
    assert.equal(classifyError({ error: CLICK_RAW }, '').cls, 'selector');
    for (const msg of [
      'Action failed: click on selector "#x": locator.click: Timeout 4000ms exceeded.',
      'Action failed: locator.waitFor: Timeout 1500ms exceeded.',
      'elementHandle.waitForElementState: Timeout 5000ms exceeded.',
      'Action failed: No element matched selector: #x'
    ]) assert.equal(classifyError({ error: msg }, '').cls, 'selector', msg);
  });

  test('browser_session keeps its snapshot advice under the selector class', () => {
    assert.match(CLASS_HINTS.selector('browser_session'), /Take another snapshot/);
  });

  test('extract_text selector miss repro gets the selector hint, not escalate/stealth', async () => {
    const hint = await hintFor('extract_text', textError('Failed to extract text: No elements found for selector: div.no-such-element'));
    assert.equal(hint, CLASS_HINTS.selector('extract_text'));
    assert.match(hint, /Check the selectors against scrape formats:\["html"\] output, or use extract_structured when the markup varies\./);
    assert.notEqual(hint, FALLBACK_HINTS.extract_text);
    assert.doesNotMatch(hint, /escalate|stealth_mode/);
  });

  test('real timeouts and the other classes are not swallowed by the selector class', () => {
    assert.equal(classifyError(null, 'page.goto: Timeout 30000ms exceeded.').cls, 'timeout');
    assert.equal(classifyError(null, 'Failed to fetch URL: Request timeout after 1500ms').cls, 'timeout');
    assert.equal(classifyError(null, 'Action backstop timeout: click (#x) did not settle within 6000ms').cls, 'timeout');
    assert.equal(classifyError(null, 'Failed to extract text: getaddrinfo ENOTFOUND nope.invalid').cls, 'not_found');
    assert.equal(classifyError(null, "Failed: SSRF Protection: blocked hostname '127.0.0.1'").cls, 'ssrf');
    assert.equal(classifyError(null, 'robots.txt on a.com disallows this path for CrawlForge').cls, 'robots');
    // A text wait (page.waitForFunction) is not a selector miss: the tool hint stands, as before.
    assert.equal(classifyError(null, 'Action failed: page.waitForFunction: Timeout 3000ms exceeded.'), null);
  });
});

describe('3.3: stealth_mode errors get their own hints', () => {
  test('"url is required" is a validation error naming url', async () => {
    const hint = await hintFor('stealth_mode', textError('Stealth mode operation failed: url is required for scrape operation'));
    assert.equal(hint, CLASS_HINTS.validation('stealth_mode', ['url']));
    assert.deepEqual(
      classifyError(null, 'Stealth mode operation failed: contextId is required for create_page operation'),
      { cls: 'validation', params: ['contextId'] }
    );
    // An API key that is required is not a parameter to fix.
    assert.equal(classifyError(null, 'CrawlForge API key is required for search functionality'), null);
  });

  test('"Context not found" says to run create_context first', async () => {
    const hint = await hintFor('stealth_mode', textError('Stealth mode operation failed: Context not found'));
    assert.equal(hint, CLASS_HINTS.unknown_context());
    assert.match(hint, /stealth_mode operation:"create_context" first/);
    assert.notEqual(hint, FALLBACK_HINTS.stealth_mode);
  });
});

describe('ActionExecutor: the action error names its selector; a wait honours duration and selector', () => {
  const executor = new ActionExecutor({ enableLogging: false, enableScreenshotOnError: false });
  after(async () => {
    await executor.destroy().catch(() => {});
    await executor.browserProcessor.localizationManager?.cleanup().catch(() => {});
  });

  /** A page whose single locator records waits and fails a click the way Playwright does. */
  function fakePage({ present }) {
    const calls = [];
    const locator = {
      click: async () => { throw new Error(CLICK_RAW.replace(/^click on selector "[^"]*": /, '')); },
      waitFor: async (opts) => {
        calls.push(['waitFor', opts.state]);
        if (!present) throw new Error(`locator.waitFor: Timeout ${opts.timeout}ms exceeded.`);
      }
    };
    return { calls, url: () => 'https://example.com/', locator: () => ({ first: () => locator }) };
  }

  test('a failed click names the selector in its error', async () => {
    const result = await executor.executeActionInternal(
      fakePage({ present: false }), { type: 'click', selector: '#no-such-element-abc', timeout: 50 }, { id: 'c' }
    );
    assert.equal(result.success, false);
    assert.match(result.error, /^click on selector "#no-such-element-abc": locator\.click: Timeout 4000ms exceeded\./);
    assert.equal(classifyError({ error: result.error }, '').cls, 'selector');
  });

  test('an error that already names the selector is not prefixed again', async () => {
    const page = fakePage({ present: false });
    page.locator = () => ({ first: () => ({ click: async () => { throw new Error('No element matched selector: #x'); } }) });
    const result = await executor.executeActionInternal(page, { type: 'click', selector: '#x', timeout: 50 }, { id: 'c' });
    assert.equal(result.error, 'No element matched selector: #x');
  });

  test('wait with duration and selector waits for the selector after the pause', async () => {
    const page = fakePage({ present: true });
    const started = Date.now();
    const result = await executor.executeActionInternal(
      page, { type: 'wait', duration: 120, selector: 'form', condition: 'visible' }, { id: 'w' }
    );
    assert.equal(result.success, true);
    assert.ok(Date.now() - started >= 110, 'the pause still runs');
    assert.deepEqual(page.calls, [['waitFor', 'visible']], 'the selector is waited for, not ignored');
    assert.deepEqual(result.result, { waited: 120, selector: 'form', condition: 'visible' });
  });

  test('wait with duration and a missing selector fails instead of reporting success', async () => {
    const result = await executor.executeActionInternal(
      fakePage({ present: false }), { type: 'wait', duration: 20, selector: '#gone', timeout: 50 }, { id: 'w' }
    );
    assert.equal(result.success, false);
    assert.match(result.error, /^wait on selector "#gone": locator\.waitFor: Timeout 50ms exceeded\./);
  });

  test('a pause on its own is unchanged', async () => {
    const page = fakePage({ present: false });
    const result = await executor.executeActionInternal(page, { type: 'wait', duration: 10 }, { id: 'w' });
    assert.deepEqual(result.result, { waited: 10 });
    assert.deepEqual(page.calls, []);
  });
});

// Stream A appends the undici cause to a connection failure; a refused
// connection used to get the tool's generic hint, which suggests stealth_mode.
describe('ECONNREFUSED gets its own hint', () => {
  test('a refused connection is told the host is not listening, not to try stealth_mode', async () => {
    const msg = 'Scrape failed: Could not reach https://example.com:9/ (connect ECONNREFUSED 93.184.215.14:9)';
    assert.deepEqual(classifyError(null, msg), { cls: 'refused' });
    const hint = await hintFor('scrape', textError(msg));
    assert.equal(hint, CLASS_HINTS.refused());
    assert.match(hint, /refused the connection/);
    assert.notEqual(hint, FALLBACK_HINTS.scrape);
    // A JSON body (batch_scrape's per-URL shape) classifies the same way.
    assert.equal(classifyError({ success: false, error: msg }, '').cls, 'refused');
  });

  test('an SSRF refusal that mentions ECONNREFUSED stays ssrf; ENOTFOUND stays not_found', () => {
    assert.equal(classifyError(null, "SSRF Protection: blocked hostname '127.0.0.1' (connect ECONNREFUSED 127.0.0.1:9)").cls, 'ssrf');
    assert.equal(classifyError(null, 'Could not reach https://nope.invalid/ (getaddrinfo ENOTFOUND nope.invalid)').cls, 'not_found');
  });
});

// Stream C: a named model that is not installed got "If Ollama is unreachable...".
describe('a missing Ollama model gets its own hint', () => {
  test('extract_with_llm: pull the model, or drop `model`, not switch provider', async () => {
    const msg = 'LLM extraction failed: Ollama model "llama3.3:70b" is not pulled. Run: "ollama pull llama3.3:70b"';
    assert.deepEqual(classifyError(null, msg), { cls: 'model_not_pulled' });
    const hint = await hintFor('extract_with_llm', textError(msg));
    assert.equal(hint, CLASS_HINTS.model_not_pulled());
    assert.match(hint, /not installed: pull it/);
    assert.match(hint, /list_ollama_models/);
    assert.notEqual(hint, FALLBACK_HINTS.extract_with_llm);
    // Ollama being down still gets the tool's own hint.
    assert.equal(classifyError(null, 'Ollama is not reachable at http://localhost:11434'), null);
  });
});

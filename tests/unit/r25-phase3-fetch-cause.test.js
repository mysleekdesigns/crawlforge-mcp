/**
 * R25 Phase 3, 3.1: a host that does not resolve failed with a bare "fetch
 * failed" in scrape, extract_metadata, extract_structured and batch_scrape.
 * undici keeps the reason (ENOTFOUND, ECONNREFUSED) in `err.cause`, which
 * these tools dropped, so the not_found hint never matched and the tool's
 * generic hint sent the caller to stealth_mode instead.
 *
 * The repro URL is the sweep's own. DNS is faked for that one host (the
 * guarded dispatcher resolves through dns.lookup), so no network is needed.
 *
 * Run: node --test --test-force-exit tests/unit/r25-phase3-fetch-cause.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';

delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
process.env.DISABLE_OLLAMA = 'true';

const { fetchErrorMessage } = await import('../../src/utils/fetchError.js');
const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');
const { extractMetadataHandler } = await import('../../src/tools/basic/extractMetadata.js');
const { ExtractStructuredTool } = await import('../../src/tools/extract/extractStructured.js');
const { scrapeUrl, failedEntryHint } = await import('../../src/tools/advanced/batchScrape/worker.js');
const { requestContext } = await import('../../src/server/requestContext.js');
const { FALLBACK_HINTS } = await import('../../src/server/fallbackHints.js');
const { classifyError, CLASS_HINTS, appendFallbackHint } = await import('../../src/server/fallbackHints.js');

const HOST = 'nonexistent-host-crawlforge-test.invalid';
const URL_ = `https://${HOST}/`;

function enotfound(hostname) {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
    code: 'ENOTFOUND', errno: -3008, syscall: 'getaddrinfo', hostname
  });
}

const realLookup = dns.lookup;
const realPromisesLookup = dns.promises.lookup;

before(() => {
  dns.lookup = function lookup(hostname, options, callback) {
    if (hostname !== HOST) return realLookup.apply(this, arguments);
    const cb = typeof options === 'function' ? options : callback;
    process.nextTick(cb, enotfound(hostname));
  };
  dns.promises.lookup = function lookup(hostname, ...rest) {
    if (hostname !== HOST) return realPromisesLookup.call(this, hostname, ...rest);
    return Promise.reject(enotfound(hostname));
  };
});

after(() => {
  dns.lookup = realLookup;
  dns.promises.lookup = realPromisesLookup;
});

/** The hint the caller would get for this failure. */
function assertNotFound(parsed, text) {
  assert.match(text, /ENOTFOUND/);
  assert.deepEqual(classifyError(parsed, text), { cls: 'not_found' });
}

describe('fetchErrorMessage', () => {
  test("undici's bare fetch failed gets the URL and the cause's message", () => {
    const err = new TypeError('fetch failed', { cause: enotfound(HOST) });
    assert.equal(fetchErrorMessage(err, URL_), `Could not reach ${URL_} (getaddrinfo ENOTFOUND ${HOST})`);
  });

  test('a cause with no message (AggregateError, both families refused) gives its code', () => {
    const cause = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });
    const err = new TypeError('fetch failed', { cause });
    assert.equal(fetchErrorMessage(err, URL_), `Could not reach ${URL_} (ECONNREFUSED)`);
  });

  test('any other error keeps its own message', () => {
    assert.equal(fetchErrorMessage(new Error('HTTP 404: Not Found'), URL_), 'HTTP 404: Not Found');
    assert.equal(fetchErrorMessage(new TypeError('fetch failed: redirect count exceeded'), URL_), 'fetch failed: redirect count exceeded');
  });
});

describe(`the four tools on ${URL_} name ENOTFOUND and get the not_found hint`, () => {
  test('scrape', async () => {
    await assert.rejects(
      () => new UnifiedScrapeTool().execute({ url: URL_, formats: ['markdown'] }),
      (err) => {
        assert.equal(err.message, `scrape: fetch failed for ${URL_}: Could not reach ${URL_} (getaddrinfo ENOTFOUND ${HOST})`);
        // server.js wraps the throw as "Scrape failed: <message>", isError.
        const result = { content: [{ type: 'text', text: `Scrape failed: ${err.message}` }], isError: true };
        assertNotFound(null, result.content[0].text);
        appendFallbackHint('scrape', result);
        assert.ok(result.content[0].text.endsWith(`Next step: ${CLASS_HINTS.not_found()}`));
        return true;
      }
    );
  });

  test('extract_metadata', async () => {
    const result = await extractMetadataHandler({ url: URL_ });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, `Failed to extract metadata: Could not reach ${URL_} (getaddrinfo ENOTFOUND ${HOST})`);
    assertNotFound(null, result.content[0].text);
  });

  test('extract_structured', async () => {
    const result = await new ExtractStructuredTool().execute({
      url: URL_, schema: { type: 'object', properties: { title: { type: 'string' } } }
    });
    assert.equal(result.success, false);
    assert.equal(result.error, `Structured extraction failed: Could not reach ${URL_} (getaddrinfo ENOTFOUND ${HOST})`);
    assert.deepEqual(result.validation.errors, [`Could not reach ${URL_} (getaddrinfo ENOTFOUND ${HOST})`]);
    assertNotFound(result, JSON.stringify(result));
  });

  test('batch_scrape', async () => {
    const result = await scrapeUrl({ url: URL_ }, { formats: ['markdown'] }, 5000);
    assert.equal(result.success, false);
    assert.equal(result.error, `Could not reach ${URL_} (getaddrinfo ENOTFOUND ${HOST})`);
    assertNotFound(result, JSON.stringify(result));
    // The batch itself succeeds, so withAuth adds no hint: the entry carries its own.
    assert.equal(result.next_step, CLASS_HINTS.not_found());
  });
});

describe('failedEntryHint (a failed batch_scrape entry\'s next_step)', () => {
  test('an error with no class gets scrape\'s hint', () => {
    assert.equal(failedEntryHint('HTTP 403: Forbidden'), FALLBACK_HINTS.scrape);
  });

  test('one URL\'s preflight refusal does not relabel another URL\'s error', () => {
    const hint = requestContext.run({ preflightRefusal: 'ROBOTS_DISALLOWED' },
      () => failedEntryHint(`Could not reach ${URL_} (getaddrinfo ENOTFOUND ${HOST})`));
    assert.equal(hint, CLASS_HINTS.not_found());
  });
});

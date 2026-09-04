/**
 * Unit tests: batchScrape tool (real modules — src/tools/advanced/batchScrape/*)
 * Run: node --test tests/unit/tools/advanced/batchScrape.test.js
 *
 * BatchScrapeTool's worker fetches through safeFetch (SSRF-guarded), so these
 * tests run a local HTTP server on 127.0.0.1, allowlisted via ALLOWED_DOMAINS
 * (set before the guarded modules are first imported — config.js reads it
 * once at import time). Job persistence is disabled so JobManager stays
 * in-memory only.
 *
 * "Gated" endpoints let tests deterministically control request timing
 * (to observe an in-progress async batch, or to cancel mid-flight) without
 * relying on real sleeps/races.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BatchScrapeSchema } from '../../../../src/tools/advanced/batchScrape/schema.js';

process.env.ALLOWED_DOMAINS = 'localhost';
const { BatchScrapeTool } = await import('../../../../src/tools/advanced/batchScrape/index.js');

// ---------------------------------------------------------------------------
// Local fixture server with per-path "gates": a gated request blocks until
// the test explicitly releases it, giving deterministic control over when a
// batch job is mid-flight.
// ---------------------------------------------------------------------------

let server;
let baseUrl;
const gates = new Map(); // path -> resolve fn
const hits = new Map(); // path -> request count

server = http.createServer(async (req, res) => {
  const p = req.url;
  hits.set(p, (hits.get(p) || 0) + 1);
  if (p.startsWith('/gate/')) {
    await new Promise((resolve) => gates.set(p, resolve));
  }
  if (p === '/latin1') {
    // lua.org regression: an ISO-8859-1 page whose accented characters only
    // decode correctly when the declared charset is honoured.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=iso-8859-1' });
    res.end(Buffer.from(
      '<html><head><title>Programação em Lua</title></head><body><h1>Programação</h1><p>versão em português</p></body></html>',
      'latin1'
    ));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<html><head><title>Page ${p}</title></head><body><h1>Page ${p}</h1></body></html>`);
});

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function waitForGate(path, timeoutMs = 3000) {
  const start = Date.now();
  while (!gates.has(path)) {
    if (Date.now() - start > timeoutMs) throw new Error(`gate ${path} was never hit within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
function releaseGate(path) {
  const resolve = gates.get(path);
  if (resolve) {
    resolve();
    gates.delete(path);
  }
}
async function waitForJobStatus(jobManager, jobId, statuses, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    const job = jobManager.getJob(jobId);
    if (job && statuses.includes(job.status)) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`job ${jobId} never reached [${statuses}] (last: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function makeTool(overrides = {}) {
  return new BatchScrapeTool({ enableJobPersistence: false, enableWebhookNotifications: false, enableLogging: false, ...overrides });
}

describe('BatchScrapeSchema (real Zod schema)', () => {
  // 4.2.1 — Pin BatchScrapeSchema default to match server.js MCP-facing default.
  // Guards against re-introducing the v4.0.0 internal/external mismatch where the
  // internal schema defaulted to ['markdown'] while the MCP tool registration
  // defaulted to ['json'], silently breaking direct programmatic callers.
  test('default formats is ["json"] (matches MCP registration)', () => {
    const parsed = BatchScrapeSchema.parse({ urls: ['https://example.com'] });
    assert.deepEqual(parsed.formats, ['json']);
  });

  test('preserves explicit formats: ["markdown"]', () => {
    const parsed = BatchScrapeSchema.parse({ urls: ['https://example.com'], formats: ['markdown'] });
    assert.deepEqual(parsed.formats, ['markdown']);
  });

  // Contract test: the CLI `batch` command (src/cli/commands/batch.js) must map
  // user-facing flags (--format / --concurrency / --max-retries) to the schema's
  // actual keys (formats / maxConcurrency / jobOptions.maxRetries). A prior bug
  // passed output_format / concurrency / max_retries, which Zod silently stripped.
  test('CLI batch command param shape parses cleanly with all flags applied', () => {
    const parsed = BatchScrapeSchema.parse({
      urls: ['https://example.com'],
      formats: ['markdown'],
      maxConcurrency: 5,
      jobOptions: { maxRetries: 2 }
    });
    assert.deepEqual(parsed.formats, ['markdown']);
    assert.equal(parsed.maxConcurrency, 5);
    assert.equal(parsed.jobOptions.maxRetries, 2);
  });
});

describe('BatchScrapeTool (real module) — sync mode', () => {
  test('happy path — scrapes real URLs through a local fixture server', async () => {
    const tool = makeTool();
    const result = await tool.execute({
      urls: [`${baseUrl}/plain/a`, `${baseUrl}/plain/b`],
      mode: 'sync',
      delayBetweenRequests: 0
    });
    assert.equal(result.success, true);
    assert.equal(result.totalUrls, 2);
    assert.equal(result.successfulUrls, 2);
    assert.equal(result.results.length, 2);
  });

  test('an ISO-8859-1 page decodes with its declared charset (lua.org regression)', async () => {
    const tool = makeTool();
    const result = await tool.execute({
      urls: [`${baseUrl}/latin1`],
      mode: 'sync',
      formats: ['text'],
      delayBetweenRequests: 0
    });
    assert.equal(result.successfulUrls, 1);
    const text = result.results[0].content.text;
    assert.match(text, /versão em português/, 'accented characters must survive decoding');
    assert.doesNotMatch(text, /�/, 'no replacement characters');
  });

  test('a failing URL (connection refused) is reported without failing the whole batch', async () => {
    const tool = makeTool();
    const result = await tool.execute({
      urls: [`${baseUrl}/plain/ok`, 'http://localhost:1/unreachable'],
      mode: 'sync',
      delayBetweenRequests: 0
    });
    assert.equal(result.successfulUrls, 1);
    assert.equal(result.failedUrls, 1);
  });
});

describe('BatchScrapeTool (real module) — async mode: in-progress status + cancellation', () => {
  let tool;
  beforeEach(() => {
    tool = makeTool();
  });

  // Reproduction test: get_batch_results for an async batch that is still
  // running must report live progress from the JobManager job (not "not
  // found" — async batches are never added to `activeBatches`, only sync
  // batches are, so getBatchResults has to fall through to the
  // getJobsByTag(batchId) branch).
  test('getBatchResults reports live status for an in-progress async batch', async () => {
    const urls = [`${baseUrl}/gate/a1`, `${baseUrl}/gate/a2`];
    const queued = await tool.execute({ urls, mode: 'async', maxConcurrency: 1, delayBetweenRequests: 0 });
    assert.equal(queued.mode, 'async');
    assert.ok(queued.jobId);

    await waitForJobStatus(tool.jobManager, queued.jobId, ['running']);
    await waitForGate('/gate/a1'); // first URL's fetch is now blocked

    const status = await tool.getBatchResults(queued.batchId);
    assert.notEqual(status.status, undefined, 'must report a live status, not throw "not found"');
    assert.equal(status.mode, 'async');
    assert.equal(status.jobId, queued.jobId);
    assert.ok(['pending', 'running'].includes(status.status));

    // Let the batch finish so the job doesn't leak into other tests.
    releaseGate('/gate/a1');
    await waitForGate('/gate/a2');
    releaseGate('/gate/a2');
    const finished = await waitForJobStatus(tool.jobManager, queued.jobId, ['completed']);
    assert.equal(finished.result.successfulUrls, 2);

    // Once complete, the same poll must still carry status/mode — the
    // completed branches (cache and job) used to drop both, so a poller keyed
    // on `status` saw `undefined` the moment the job finished.
    const done = await tool.getBatchResults(queued.batchId);
    assert.equal(done.status, 'completed');
    assert.equal(done.mode, 'async');
    assert.equal(done.results.length, 2);
  });

  // Reproduction test for the cancelBatch fix: cancelling an async batch used
  // to only forget about it in bookkeeping — the scrape loop kept running to
  // completion regardless. The executor now polls job.status between chunks
  // and stops, and JobManager.executeJob no longer clobbers a CANCELLED
  // status back to COMPLETED once the in-flight executor call resolves.
  test('cancelBatch actually stops the batch instead of letting it run to completion', async () => {
    const urls = [`${baseUrl}/gate/b1`, `${baseUrl}/gate/b2`, `${baseUrl}/gate/b3`];
    const queued = await tool.execute({ urls, mode: 'async', maxConcurrency: 1, delayBetweenRequests: 0 });

    await waitForJobStatus(tool.jobManager, queued.jobId, ['running']);
    await waitForGate('/gate/b1'); // stuck fetching the first URL

    const cancelResult = await tool.cancelBatch(queued.batchId);
    assert.equal(cancelResult.success, true);
    // cancelJob() flips job.status to 'cancelled' synchronously — that alone
    // doesn't prove the *executor loop* honored it, since it can only notice
    // between chunks. Unblock the in-flight fetch and then check with a
    // grace period whether the loop actually stopped dispatching more work
    // (rather than polling job.status, which would already read 'cancelled'
    // even under the old, unfixed loop that ignored it and kept running).
    releaseGate('/gate/b1');
    await new Promise((r) => setTimeout(r, 250)); // generous for same-process loopback I/O

    // The second and third URLs must never have been requested — proof the
    // executor loop itself stopped rather than continuing in the background.
    assert.equal(hits.get('/gate/b2'), undefined, 'second URL must never be fetched after cancellation');
    assert.equal(hits.get('/gate/b3'), undefined, 'third URL must never be fetched after cancellation');

    assert.equal(tool.jobManager.getJob(queued.jobId).status, 'cancelled');
  });
});

describe('batchScrape worker — markdown format keeps non-p/li content (quotes.toscrape regression)', () => {
  // Regression (v5.0.2 live test): markdown for quotes.toscrape.com came back
  // as page skeleton only — buildMarkdown was a hand-rolled h1–h3/p/li walk,
  // so text living in other elements (the site keeps quotes in
  // <span class="text"> and authors in <small class="author">) was silently
  // dropped. buildMarkdown now converts via the shared Turndown helper
  // (src/utils/htmlToMarkdown.js), same as the unified `scrape` tool.
  // These tests stub globalThis.fetch, so no server / network is involved.
  const quotesHtml = `<!DOCTYPE html><html><head><title>Quotes to Scrape</title></head><body>
    <div class="container">
      <h1><a href="/">Quotes to Scrape</a></h1>
      <div class="quote"><span class="text">“The world as we have created it is a process of our thinking. It cannot be changed without changing our thinking.”</span>
        <span>by <small class="author">Albert Einstein</small> <a href="/author/Albert-Einstein">(about)</a></span>
        <div class="tags">Tags: <a class="tag" href="/tag/change/page/1/">change</a></div>
      </div>
      <div class="quote"><span class="text">“It is our choices, Harry, that show what we truly are, far more than our abilities.”</span>
        <span>by <small class="author">J.K. Rowling</small> <a href="/author/J-K-Rowling">(about)</a></span>
      </div>
      <nav><ul class="pager"><li class="next"><a href="/page/2/">Next →</a></li></ul></nav>
    </div>
  </body></html>`;

  async function markdownFor(html) {
    const { scrapeUrl } = await import('../../../../src/tools/advanced/batchScrape/worker.js');
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    try {
      const result = await scrapeUrl({ url: 'https://quotes.toscrape.com/' }, { formats: ['markdown'] }, 5000);
      assert.equal(result.success, true, `scrapeUrl failed: ${result.error}`);
      return result.content.markdown;
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  test('quote text in <span> and authors in <small> survive markdown conversion', async () => {
    const md = await markdownFor(quotesHtml);
    assert.ok(
      md.includes('The world as we have created it is a process of our thinking'),
      'quote text (in <span class="text">) must not be dropped'
    );
    assert.ok(md.includes('Albert Einstein'), 'author (in <small class="author">) must not be dropped');
    assert.ok(md.includes('J.K. Rowling'), 'second author must not be dropped');
    // C3 title de-dup must still hold: <title> equals the <h1> text, so the
    // page name appears exactly once (as the h1 heading, not prepended again).
    assert.equal((md.match(/Quotes to Scrape/g) || []).length, 1, '<title> must not be duplicated above a matching <h1>');
  });

  test('simple example.com-style page still converts cleanly', async () => {
    const md = await markdownFor(
      '<html><head><title>Example Domain</title></head><body><div><h1>Example Domain</h1>' +
      '<p>This domain is for use in illustrative examples in documents.</p>' +
      '<p><a href="https://www.iana.org/domains/example">More information...</a></p></div></body></html>'
    );
    assert.equal((md.match(/# Example Domain/g) || []).length, 1, 'exactly one h1 heading');
    assert.ok(md.includes('illustrative examples'), 'paragraph text present');
    assert.ok(md.includes('[More information...](https://www.iana.org/domains/example)'), 'links preserved');
  });

  test('page without an <h1> still gets the <title> prepended as heading (C3)', async () => {
    const md = await markdownFor('<html><head><title>My Page</title></head><body><p>Hello world.</p></body></html>');
    assert.ok(md.startsWith('# My Page'), 'title heading prepended when the page has no h1');
    assert.ok(md.includes('Hello world.'));
  });
});

describe('BatchScrapeTool (real module) — batchResults cache TTL eviction', () => {
  // Complements the "expired entries are deleted on read" case already
  // covered in tests/unit/phase3-leaks.test.js by exercising it against a
  // real (short) resultCacheTtl instead of a synthetically pre-expired entry
  // poked directly into the Map, and by also asserting the pre-expiry
  // cache-hit shape so both sides of the TTL boundary are covered here.
  test('a cached result is served while fresh, then evicted (falls through to not-found) once its TTL elapses', async () => {
    const tool = makeTool();
    try {
      const batchId = 'ttl_evict_test';
      tool.resultCacheTtl = 30; // ms — short-lived so the test runs fast
      tool._cacheBatchResult(batchId, [{ url: `${baseUrl}/plain/x`, success: true }]);

      const fresh = await tool.getBatchResults(batchId);
      assert.equal(fresh.cached, true, 'a not-yet-expired entry must be served from cache');
      assert.equal(fresh.status, 'completed', 'the cached branch reports the lifecycle status too');
      assert.equal(fresh.results.length, 1);

      await new Promise((r) => setTimeout(r, 60));

      await assert.rejects(() => tool.getBatchResults(batchId), /not found/i);
      assert.equal(
        tool.batchResults.has(batchId),
        false,
        'an expired batch entry must be evicted from the cache on read, not merely fall through to "not found" while still occupying memory'
      );
    } finally {
      await tool.destroy();
    }
  });
});

describe('batchScrape worker — selectors keep table structure', () => {
  // extractStructuredData was a copy of the pre-5.6.5 scrape_with_actions
  // code: cheerio's .text() ran every cell of a matched table together
  // ("DateOpen*HighLowClose**…Sep 03, 2026$77,300.17…", CoinMarketCap
  // historical data, 2026-09-04). It now reads elements through
  // src/utils/elementText.js like scrape_with_actions and scrape_structured.
  // fetch is stubbed, so no server / network is involved.
  const HISTORY_HTML = `<html><body><nav>Menu</nav><div id="wrap"><h2>Bitcoin Price History</h2>
<table><thead><tr><th>Date</th><th>Open*</th><th>High</th></tr></thead>
<tbody><tr><td>Sep 03, 2026</td><td>$77,300.17</td><td>$82,262.21</td></tr>
<tr><td>Sep 02, 2026</td><td>$77,402.14</td><td>$77,737.55</td></tr></tbody></table>
<p>* Earliest data in range</p></div></body></html>`;
  const ROWS = 'Sep 03, 2026 | $77,300.17 | $82,262.21\nSep 02, 2026 | $77,402.14 | $77,737.55';

  test('a table, a row, and an element wrapping a table are delimited; other selectors are unchanged', async () => {
    const { scrapeUrl } = await import('../../../../src/tools/advanced/batchScrape/worker.js');
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(HISTORY_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } });
    let result;
    try {
      result = await scrapeUrl(
        { url: 'https://example.com/history', selectors: { table: 'table', body: 'tbody', firstRow: 'tbody tr:first-child', wrapper: '#wrap', dates: 'tbody td:first-child', heading: 'h2' } },
        { formats: ['markdown'] },
        5000
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(result.success, true, `scrapeUrl failed: ${result.error}`);
    const x = result.extracted;
    assert.equal(x.table, `Date | Open* | High\n${ROWS}`);
    assert.equal(x.body, ROWS, 'a row group renders only its own rows');
    assert.equal(x.firstRow, 'Sep 03, 2026 | $77,300.17 | $82,262.21');
    assert.equal(x.wrapper, `Bitcoin Price History\nDate | Open* | High\n${ROWS}\n* Earliest data in range`);
    assert.deepEqual(x.dates, ['Sep 03, 2026', 'Sep 02, 2026'], 'a multi-match selector still returns an array of cell strings');
    assert.equal(x.heading, 'Bitcoin Price History');
  });
});

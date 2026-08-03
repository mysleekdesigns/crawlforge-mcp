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

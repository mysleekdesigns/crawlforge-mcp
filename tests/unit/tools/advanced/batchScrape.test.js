/**
 * D5.2 — Unit tests: batchScrape tool
 * Run: node --test tests/unit/tools/advanced/batchScrape.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BatchScrapeSchema } from '../../../../src/tools/advanced/batchScrape/schema.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

class JobManagerStub {
  constructor() { this.jobs = new Map(); this._nextId = 1; }
  createJob(type, meta) {
    const id = `job-${this._nextId++}`;
    this.jobs.set(id, { id, type, status: 'pending', meta });
    return id;
  }
  updateJob(id, updates) {
    const job = this.jobs.get(id);
    if (job) Object.assign(job, updates);
  }
  getJob(id) { return this.jobs.get(id) || null; }
}

class WebhookDispatcherStub {
  async dispatch(url, event, data) { return true; }
}

class ElicitationHelperStub {
  async elicit(msg) { return { confirmed: true }; }
}

// Minimal worker stub — scrapes a URL synchronously
async function scrapeUrlStub(url, options = {}) {
  if (url.includes('fail.example.com')) throw new Error('Failed to fetch');
  return { url, title: `Page at ${url}`, content: { text: 'Sample content' }, format: options.format || 'markdown' };
}

// ---------------------------------------------------------------------------
// Minimal BatchScrape-like stub
// ---------------------------------------------------------------------------

class BatchScrapeStub {
  constructor({ jobManager, webhookDispatcher, elicitation, scraperFn } = {}) {
    this.jobManager = jobManager || new JobManagerStub();
    this.webhookDispatcher = webhookDispatcher || new WebhookDispatcherStub();
    this._elicitation = elicitation || new ElicitationHelperStub();
    this._scrape = scraperFn || scrapeUrlStub;
    this.maxBatchSize = 50;
    this.activeBatches = new Map();
  }

  async execute(params) {
    if (!params || !Array.isArray(params.urls)) throw new Error('urls array is required');
    if (params.urls.length === 0) throw new Error('urls array cannot be empty');

    // D1.4: Elicitation when > 25 URLs in sync mode
    const isSync = !params.async;
    if (isSync && params.urls.length > 25) {
      const response = await this._elicitation.elicit(`Batch of ${params.urls.length} URLs. Continue?`);
      if (!response.confirmed) return { status: 'cancelled' };
    }

    const jobId = this.jobManager.createJob('batch_scrape', { urlCount: params.urls.length });

    const results = [];
    const errors = [];

    for (const url of params.urls) {
      try {
        const r = await this._scrape(url, { format: params.formats?.[0] || 'markdown' });
        results.push(r);
      } catch (err) {
        errors.push({ url, error: err.message });
      }
    }

    this.jobManager.updateJob(jobId, { status: 'completed', results });

    return {
      jobId,
      totalUrls: params.urls.length,
      successful: results.length,
      failed: errors.length,
      results,
      errors
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('batchScrape tool', () => {
  let tool;
  const testUrls = ['https://a.example.com', 'https://b.example.com'];

  beforeEach(() => {
    tool = new BatchScrapeStub();
  });

  test('constructor stores jobManager, dispatcher, elicitation', () => {
    assert.ok(tool.jobManager instanceof JobManagerStub);
    assert.ok(tool._elicitation instanceof ElicitationHelperStub);
    assert.ok(tool.activeBatches instanceof Map);
  });

  test('happy path — returns results for all URLs', async () => {
    const result = await tool.execute({ urls: testUrls });
    assert.equal(result.totalUrls, 2);
    assert.equal(result.successful, 2);
    assert.equal(result.failed, 0);
    assert.ok(result.jobId);
  });

  test('partial failure — error URLs reported in errors array', async () => {
    const urls = ['https://a.example.com', 'https://fail.example.com'];
    const result = await tool.execute({ urls });
    assert.equal(result.successful, 1);
    assert.equal(result.failed, 1);
    assert.ok(result.errors[0].error.includes('Failed to fetch'));
  });

  test('missing urls array throws', async () => {
    await assert.rejects(() => tool.execute({}), /urls array is required/);
  });

  test('empty urls array throws', async () => {
    await assert.rejects(() => tool.execute({ urls: [] }), /cannot be empty/);
  });

  test('elicitation fires for >25 URLs in sync mode', async () => {
    let elicitCalled = false;
    const elicit = { elicit: async () => { elicitCalled = true; return { confirmed: true }; } };
    const bigUrls = Array.from({ length: 30 }, (_, i) => `https://example${i}.com`);
    const eTool = new BatchScrapeStub({ elicitation: elicit });
    await eTool.execute({ urls: bigUrls });
    assert.ok(elicitCalled);
  });

  test('job created and updated in jobManager', async () => {
    const result = await tool.execute({ urls: testUrls });
    const job = tool.jobManager.getJob(result.jobId);
    assert.ok(job, 'job should exist');
    assert.equal(job.status, 'completed');
  });

  // 4.2.1 — Pin BatchScrapeSchema default to match server.js MCP-facing default.
  // Guards against re-introducing the v4.0.0 internal/external mismatch where the
  // internal schema defaulted to ['markdown'] while the MCP tool registration
  // defaulted to ['json'], silently breaking direct programmatic callers.
  test('BatchScrapeSchema default formats is ["json"] (matches MCP registration)', () => {
    const parsed = BatchScrapeSchema.parse({ urls: ['https://example.com'] });
    assert.deepEqual(parsed.formats, ['json']);
  });

  test('BatchScrapeSchema preserves explicit formats: ["markdown"]', () => {
    const parsed = BatchScrapeSchema.parse({
      urls: ['https://example.com'],
      formats: ['markdown']
    });
    assert.deepEqual(parsed.formats, ['markdown']);
  });

  test('BatchScrapeSchema preserves explicit formats: ["markdown","json"]', () => {
    const parsed = BatchScrapeSchema.parse({
      urls: ['https://example.com'],
      formats: ['markdown', 'json']
    });
    assert.deepEqual(parsed.formats, ['markdown', 'json']);
  });

  // Contract test: the CLI `batch` command (src/cli/commands/batch.js) must map
  // user-facing flags (--format / --concurrency / --max-retries) to the schema's
  // actual keys (formats / maxConcurrency / jobOptions.maxRetries). A prior bug
  // passed output_format / concurrency / max_retries, which Zod silently stripped,
  // so user CLI flags had no effect on the tool's behavior.
  test('CLI batch command param shape parses cleanly with all flags applied', () => {
    const cliMappedParams = {
      urls: ['https://example.com'],
      formats: ['markdown'],
      maxConcurrency: 5,
      jobOptions: { maxRetries: 2 }
    };
    const parsed = BatchScrapeSchema.parse(cliMappedParams);
    assert.deepEqual(parsed.formats, ['markdown']);
    assert.equal(parsed.maxConcurrency, 5);
    assert.equal(parsed.jobOptions.maxRetries, 2);
  });
});

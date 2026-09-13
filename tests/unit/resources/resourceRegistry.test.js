/**
 * Unit tests for ResourceRegistry (D1.1)
 */

import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import {
  ResourceRegistry,
  parseResourceUri,
  hashUrl,
  MAX_RESOURCE_BLOB_BYTES
} from '../../../src/resources/ResourceRegistry.js';

describe('parseResourceUri', () => {
  it('parses valid research URI', () => {
    const result = parseResourceUri('crawlforge://research/abc123');
    assert.deepEqual(result, { type: 'research', parts: ['abc123'] });
  });

  it('parses valid job URI', () => {
    const result = parseResourceUri('crawlforge://job/job-456');
    assert.deepEqual(result, { type: 'job', parts: ['job-456'] });
  });

  it('parses valid crawl sitemap URI', () => {
    const result = parseResourceUri('crawlforge://crawl/session-1/sitemap');
    assert.deepEqual(result, { type: 'crawl', parts: ['session-1', 'sitemap'] });
  });

  it('parses valid screenshot URI', () => {
    const result = parseResourceUri('crawlforge://screenshot/action-789');
    assert.deepEqual(result, { type: 'screenshot', parts: ['action-789'] });
  });

  it('returns null for unknown URI scheme', () => {
    assert.equal(parseResourceUri('https://example.com'), null);
  });

  it('returns null for null input', () => {
    assert.equal(parseResourceUri(null), null);
  });

  it('returns null for unknown type', () => {
    assert.equal(parseResourceUri('crawlforge://unknown/id'), null);
  });
});

describe('hashUrl', () => {
  it('produces a 16-char hex string', () => {
    const h = hashUrl('https://example.com');
    assert.equal(typeof h, 'string');
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]{16}$/);
  });

  it('is deterministic', () => {
    assert.equal(hashUrl('https://example.com'), hashUrl('https://example.com'));
  });

  it('differs for different URLs', () => {
    assert.notEqual(hashUrl('https://a.com'), hashUrl('https://b.com'));
  });
});

describe('ResourceRegistry', () => {
  let registry;

  before(() => {
    // Minimal mocks
    registry = new ResourceRegistry({
      researchOrchestrator: null,
      snapshotManager: null,
      jobManager: null,
      mapSiteTool: null,
      scrapeWithActionsTool: null,
    });
  });

  it('lists empty resources by default', () => {
    const list = registry.listResources();
    assert.ok(Array.isArray(list));
  });

  it('stores and lists crawl sitemaps', () => {
    registry.storeCrawlSitemap('sess-001', { pages: ['https://a.com'], total: 1 });
    const list = registry.listResources();
    const sitemap = list.find(r => r.uri === 'crawlforge://crawl/sess-001/sitemap');
    assert.ok(sitemap, 'Sitemap resource should be listed');
    assert.equal(sitemap.mimeType, 'application/json');
  });

  it('reads a stored crawl sitemap', async () => {
    registry.storeCrawlSitemap('sess-002', { pages: ['https://b.com'] });
    const result = await registry.readResource('crawlforge://crawl/sess-002/sitemap');
    assert.ok(result.contents);
    assert.equal(result.contents[0].uri, 'crawlforge://crawl/sess-002/sitemap');
    const data = JSON.parse(result.contents[0].text);
    assert.deepEqual(data.pages, ['https://b.com']);
  });

  it('throws when crawl sitemap not found', async () => {
    await assert.rejects(
      () => registry.readResource('crawlforge://crawl/nonexistent/sitemap'),
      /not found or expired/
    );
  });

  it('stores and retrieves screenshots', async () => {
    const pngData = Buffer.from([137, 80, 78, 71]); // PNG magic bytes
    registry.storeScreenshot('act-001', pngData);
    const list = registry.listResources();
    const screenshot = list.find(r => r.uri === 'crawlforge://screenshot/act-001');
    assert.ok(screenshot, 'Screenshot should be listed');
    assert.equal(screenshot.mimeType, 'image/png');

    const result = await registry.readResource('crawlforge://screenshot/act-001');
    assert.ok(result.contents[0].blob);
    assert.equal(result.contents[0].mimeType, 'image/png');
  });

  it('stores screenshot as base64 string', async () => {
    const b64 = Buffer.from('fake-png').toString('base64');
    registry.storeScreenshot('act-002', b64);
    const result = await registry.readResource('crawlforge://screenshot/act-002');
    assert.ok(result.contents[0].blob);
  });

  it('throws for unknown resource URI', async () => {
    await assert.rejects(
      () => registry.readResource('crawlforge://research/missing-session'),
      /not found/
    );
  });

  it('reads job from jobManager', async () => {
    const mockJobManager = {
      jobs: new Map([
        ['job-001', { status: 'completed', result: { pages: 5 } }]
      ])
    };
    const r = new ResourceRegistry({ jobManager: mockJobManager });
    const result = await r.readResource('crawlforge://job/job-001');
    assert.equal(result.contents[0].uri, 'crawlforge://job/job-001');
    const data = JSON.parse(result.contents[0].text);
    assert.equal(data.status, 'completed');
  });

  it('lists jobs from jobManager', () => {
    const mockJobManager = {
      jobs: new Map([
        ['job-c', { status: 'completed' }],
        ['job-r', { status: 'running' }],
        ['job-f', { status: 'failed' }],
      ])
    };
    const r = new ResourceRegistry({ jobManager: mockJobManager });
    const list = r.listResources();
    const uris = list.map(x => x.uri);
    assert.ok(uris.includes('crawlforge://job/job-c'), 'Completed job listed');
    assert.ok(uris.includes('crawlforge://job/job-f'), 'Failed job listed');
    assert.ok(!uris.includes('crawlforge://job/job-r'), 'Running job not listed');
  });

  it('reads research from orchestrator', async () => {
    const mockOrchestrator = {
      activeSessions: new Map([
        ['sess-r1', { topic: 'AI', status: 'completed', findings: [] }]
      ])
    };
    const r = new ResourceRegistry({ researchOrchestrator: mockOrchestrator });
    const result = await r.readResource('crawlforge://research/sess-r1');
    assert.equal(result.contents[0].uri, 'crawlforge://research/sess-r1');
    const data = JSON.parse(result.contents[0].text);
    assert.equal(data.topic, 'AI');
  });
});

/**
 * R23, 2026-09-13: a full-page screenshot of a long article is 17.4 MB, and
 * emitting it closed the stdio transport — the whole MCP session, every tool
 * with it, because the SDK's ReadBuffer treats an oversized message as fatal
 * rather than as a failed call. A refusal here costs the caller one read.
 */
describe('screenshot blob budget (stdio message ceiling)', () => {
  it('keeps the budget under the 10 MB stdio ceiling once base64 is paid for', () => {
    const encoded = Math.ceil(MAX_RESOURCE_BLOB_BYTES / 3) * 4;
    assert.ok(
      encoded < 10 * 1024 * 1024,
      `base64 of the budget is ${encoded} bytes, which the transport would refuse`
    );
  });

  it('reports the size and the verdict when a screenshot is stored', () => {
    const registry = new ResourceRegistry();
    const small = registry.storeScreenshot('act-small', Buffer.alloc(64));
    assert.deepEqual(small, { bytes: 64, withinInlineBudget: true });

    const huge = registry.storeScreenshot('act-huge', Buffer.alloc(MAX_RESOURCE_BLOB_BYTES + 1));
    assert.equal(huge.bytes, MAX_RESOURCE_BLOB_BYTES + 1);
    assert.equal(huge.withinInlineBudget, false);
  });

  it('refuses to read an oversized screenshot, naming the size and the limit', async () => {
    const registry = new ResourceRegistry();
    const oversized = MAX_RESOURCE_BLOB_BYTES + 1;
    registry.storeScreenshot('act-oversized', Buffer.alloc(oversized));

    await assert.rejects(
      () => registry.readResource('crawlforge://screenshot/act-oversized'),
      (error) => {
        assert.match(error.message, new RegExp(String(oversized)));
        assert.match(error.message, new RegExp(String(MAX_RESOURCE_BLOB_BYTES)));
        // The remedy travels with the refusal: the caller has to know what to
        // take instead, not merely that this failed.
        assert.match(error.message, /full_page/);
        return true;
      }
    );
  });

  it('still reads a screenshot that sits exactly on the budget', async () => {
    const registry = new ResourceRegistry();
    registry.storeScreenshot('act-atlimit', Buffer.alloc(MAX_RESOURCE_BLOB_BYTES));
    const result = await registry.readResource('crawlforge://screenshot/act-atlimit');
    assert.ok(result.contents[0].blob);
  });
});

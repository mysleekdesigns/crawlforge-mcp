/**
 * Unit tests for ResourceRegistry (D1.1)
 */

import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { ResourceRegistry, parseResourceUri, hashUrl } from '../../../src/resources/ResourceRegistry.js';

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

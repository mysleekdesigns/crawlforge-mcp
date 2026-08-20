/**
 * Phase 6 — output-schema regression tests for src/schemas/toolOutputSchemas.js
 *
 * Run: node --test tests/unit/phase6-output-schemas.test.js
 *
 * No network. Verifies each of the 6 documented shapes:
 *   - compiles as z.object(shape)
 *   - parses a realistic sample result drawn from the tool's actual source
 *   - parses {} (every top-level field must be optional)
 *   - never throws on unknown extra keys (safeParse only, no exceptions)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { OUTPUT_SCHEMAS } from '../../src/schemas/toolOutputSchemas.js';

const TOOL_NAMES = ['scrape', 'map_site', 'serp_rank', 'search_web', 'extract_structured', 'crawl_deep'];

describe('OUTPUT_SCHEMAS — shape', () => {
  test('exports exactly the 6 frozen-contract keys', () => {
    assert.deepEqual(Object.keys(OUTPUT_SCHEMAS).sort(), TOOL_NAMES.slice().sort());
  });

  for (const name of TOOL_NAMES) {
    test(`${name}: shape is a plain object (raw shape, not z.object())`, () => {
      const shape = OUTPUT_SCHEMAS[name];
      assert.equal(typeof shape, 'object');
      assert.ok(!(shape instanceof z.ZodType), 'must be a raw shape, not already wrapped in z.object()');
    });

    test(`${name}: z.object(shape) compiles`, () => {
      const schema = z.object(OUTPUT_SCHEMAS[name]);
      assert.ok(schema instanceof z.ZodObject);
    });

    test(`${name}: {} parses successfully (all-optional invariant)`, () => {
      const schema = z.object(OUTPUT_SCHEMAS[name]);
      const result = schema.safeParse({});
      assert.equal(result.success, true, JSON.stringify(result.error?.issues));
    });

    test(`${name}: extra unknown top-level keys never throw`, () => {
      const schema = z.object(OUTPUT_SCHEMAS[name]);
      assert.doesNotThrow(() => {
        schema.safeParse({ __definitely_not_a_real_field__: 'x', nested: { a: 1 } });
      });
    });
  }
});

describe('OUTPUT_SCHEMAS — realistic samples parse', () => {
  test('scrape: multi-format success result', () => {
    const schema = z.object(OUTPUT_SCHEMAS.scrape);
    const sample = {
      success: true,
      url: 'https://example.com/',
      content: {
        markdown: '# Example\n\nHello world.',
        links: {
          links: [{ href: 'https://example.com/about', text: 'About', is_external: false, original_href: '/about' }],
          total_count: 1,
          internal_count: 1,
          external_count: 0
        },
        metadata: {
          title: 'Example Domain',
          description: '',
          keywords: [],
          canonical_url: '',
          author: '',
          robots: '',
          viewport: '',
          og_tags: {},
          twitter_tags: {},
          json_ld: [],
          microdata: [],
          url: 'https://example.com/'
        },
        screenshots: [{ actionId: 'abc123', resourceUri: 'crawlforge://screenshot/abc123' }]
      },
      warnings: ['branding: no linked stylesheets found']
    };
    const result = schema.safeParse(sample);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test('scrape: partial-success with warnings and no content keys populated', () => {
    const schema = z.object(OUTPUT_SCHEMAS.scrape);
    const result = schema.safeParse({ success: true, url: 'https://example.com/', content: {}, warnings: undefined });
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test('map_site: default (grouped by path) success result', () => {
    const schema = z.object(OUTPUT_SCHEMAS.map_site);
    const sample = {
      base_url: 'https://example.com',
      total_urls: 2,
      urls: { '/': ['https://example.com/'], '/about': ['https://example.com/about'] },
      metadata: {},
      site_map: { root: [], sections: {}, depth_levels: {} },
      statistics: {
        total_urls: 2,
        unique_paths: 2,
        file_extensions: {},
        query_parameters: 0,
        secure_urls: 2,
        max_depth: 1,
        average_depth: 0.5,
        url_lengths: { min: 20, max: 30, average: 25 }
      },
      domain_filter_config: null,
      filter_stats: null
    };
    const result = schema.safeParse(sample);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test('map_site: search= result includes ranked_urls', () => {
    const schema = z.object(OUTPUT_SCHEMAS.map_site);
    const sample = {
      base_url: 'https://example.com',
      total_urls: 1,
      urls: ['https://example.com/pricing'],
      ranked_urls: [{ url: 'https://example.com/pricing', score: 0.87 }]
    };
    const result = schema.safeParse(sample);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test('serp_rank: unconfigured shape ({configured:false})', () => {
    const schema = z.object(OUTPUT_SCHEMAS.serp_rank);
    const sample = {
      configured: false,
      keyword: 'managed wordpress hosting',
      target: 'dashboardhosting.com',
      note: 'SERP rank tracking is not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to enable real Google organic rank lookups.'
    };
    const result = schema.safeParse(sample);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test('serp_rank: configured success shape', () => {
    const schema = z.object(OUTPUT_SCHEMAS.serp_rank);
    const sample = {
      configured: true,
      keyword: 'managed wordpress hosting',
      target: 'dashboardhosting.com',
      found: true,
      position: 4,
      rankAbsolute: 4,
      url: 'https://dashboardhosting.com/wordpress',
      title: 'Managed WordPress Hosting | DashboardHosting',
      allPositions: [{ position: 4, rankAbsolute: 4, url: 'https://dashboardhosting.com/wordpress', title: 'Managed WordPress Hosting' }],
      results: [
        { position: 1, rankAbsolute: 1, domain: 'competitor.com', url: 'https://competitor.com/', title: 'Competitor', snippet: '...' },
        // DataForSEO emits snippet:null for organic items with no description
        { position: 2, rankAbsolute: 2, domain: 'nodesc.com', url: 'https://nodesc.com/', title: 'No Description', snippet: null }
      ],
      location: 'United States',
      device: 'desktop',
      depthScanned: 100,
      organicResults: 87,
      seResultsCount: 100,
      checkUrl: 'https://app.dataforseo.com/...',
      cost: 0.002,
      checkedAt: new Date().toISOString()
    };
    const result = schema.safeParse(sample);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test('search_web: standard success result', () => {
    const schema = z.object(OUTPUT_SCHEMAS.search_web);
    const sample = {
      query: 'best MCP servers 2025',
      results: [{
        title: 'Best MCP Servers',
        link: 'https://example.com/mcp',
        snippet: '...',
        displayLink: 'example.com',
        formattedUrl: 'example.com/mcp',
        htmlSnippet: '...',
        pagemap: {},
        metadata: { mime: undefined, fileFormat: undefined, cacheId: undefined }
      }],
      total_results: '123',
      search_time: 0.21,
      offset: 0,
      limit: 10,
      cached: false,
      provider: { name: 'crawlforge', backend: 'Google Search', capabilities: {} },
      localization: null,
      processing: { ranking: null, deduplication: null, query_expansion: null, localization_applied: false }
    };
    const result = schema.safeParse(sample);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test('extract_structured: llm-extracted success result', () => {
    const schema = z.object(OUTPUT_SCHEMAS.extract_structured);
    const sample = {
      url: 'https://jobs.example.com/post/123',
      data: { title: 'Senior Engineer', salary: '$150k' },
      extraction_method: 'llm',
      confidence: 0.9,
      schema_used: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      processingTime: 842,
      validation: { valid: true, errors: [] },
      extractionNotes: []
    };
    const result = schema.safeParse(sample);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test('extract_structured: error/cancelled result', () => {
    const schema = z.object(OUTPUT_SCHEMAS.extract_structured);
    const sample = {
      url: 'https://example.com',
      data: {},
      extraction_method: 'none',
      confidence: 0,
      schema_used: {},
      processingTime: 5,
      error: 'Extraction cancelled by user (elicitation declined).',
      validation: { valid: false, errors: ['Extraction cancelled by user (elicitation declined).'] }
    };
    const result = schema.safeParse(sample);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test('crawl_deep: standard success result', () => {
    const schema = z.object(OUTPUT_SCHEMAS.crawl_deep);
    const sample = {
      url: 'https://docs.example.com',
      crawl_depth: 3,
      pages_crawled: 42,
      pages_found: 42,
      error_count: 0,
      duration_ms: 5000,
      pages_per_second: 8.4,
      results: [{
        url: 'https://docs.example.com/intro',
        depth: 1,
        title: 'Intro',
        links_count: 12,
        content_length: 2048,
        timestamp: Date.now(),
        content: 'Welcome...',
        truncated: false,
        metadata: { author: 'someone' }
      }],
      errors: [],
      stats: { queued: 0 },
      site_structure: { total_pages: 42, depth_distribution: { 1: 10 }, path_patterns: { docs: 42 }, file_types: {}, subdomains: ['docs.example.com'] },
      domain_filter_config: null,
      link_analysis: null,
      session: { enabled: false }
    };
    const result = schema.safeParse(sample);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test('crawl_deep: elicitation-cancelled result', () => {
    const schema = z.object(OUTPUT_SCHEMAS.crawl_deep);
    const sample = {
      success: false,
      error: 'Crawl cancelled by user (elicitation declined).',
      url: 'https://docs.example.com'
    };
    const result = schema.safeParse(sample);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test('_cost metadata (D3.5) parses on every tool when present', () => {
    const costSample = { projected: 2, actual: 2, remaining_credits: 998, projection_note: 'flat rate' };
    for (const name of TOOL_NAMES) {
      const schema = z.object(OUTPUT_SCHEMAS[name]);
      const result = schema.safeParse({ _cost: costSample });
      assert.equal(result.success, true, `${name}: ${JSON.stringify(result.error?.issues)}`);
    }
  });
});

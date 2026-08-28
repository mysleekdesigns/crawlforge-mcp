/**
 * Regression tests: generate_llms_txt keeps the pages that describe the site,
 * not the first ones the sitemap happens to list.
 * Run: node --test tests/unit/llmsTxtImportanceOrdering.test.js
 *
 * Bug (2026-08-28, modelcontextprotocol.io maxPages 15): analyzeSiteStructure
 * asked map_site for exactly maxPages URLs, and map_site truncates in sitemap
 * document order. The result was the 15 alphabetically-first /community/*
 * pages — no homepage, no docs, no specification. The generator then made it
 * worse: it listed uncategorized URLs only when no named section matched at
 * all, so a site with both /docs and /specification lost the whole
 * specification section (and its homepage) from the output.
 *
 * These tests stay offline: map_site / crawl_deep / robots.txt are stubbed,
 * and the map_site stub truncates to the max_urls it is handed exactly as the
 * real tool does, so a run that asks for too small a pool reproduces the bug.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LLMsTxtAnalyzer } from '../../src/core/LLMsTxtAnalyzer.js';
import { GenerateLLMsTxtTool } from '../../src/tools/llmstxt/generateLLMsTxt.js';

const BASE = 'https://mcp.example.com';

// Sitemap document order, community first — the shape that caused the bug.
const SITEMAP = [
  ...Array.from({ length: 30 }, (_, i) => `${BASE}/community/wg-${String(i).padStart(2, '0')}`),
  `${BASE}/development/roadmap`,
  `${BASE}/docs/2025-06-18/sdk`,
  `${BASE}/docs/2025-06-18/getting-started/intro`,
  `${BASE}/specification/2025-06-18`,
  `${BASE}/specification/2025-06-18/architecture`,
  `${BASE}/examples`
];

function stubbedAnalyzer(maxPages) {
  const analyzer = new LLMsTxtAnalyzer({ maxPages });
  const requested = {};
  analyzer.mapSiteTool.execute = async (params) => {
    requested.maxUrls = params.max_urls;
    // Real map_site behaviour: sitemap order, cut at max_urls, grouped by path.
    const urls = SITEMAP.slice(0, params.max_urls);
    const grouped = {};
    for (const url of urls) {
      const section = '/' + new URL(url).pathname.split('/').filter(Boolean)[0];
      (grouped[section] ||= []).push(url);
    }
    return { site_map: {}, total_urls: urls.length, urls: grouped, metadata: {} };
  };
  analyzer.crawlDeepTool.execute = async () => ({ pages: [] });
  analyzer.fetchRobotsTxt = async () => null;
  return { analyzer, requested };
}

describe('generate_llms_txt — page budget spent by importance, not crawl order', () => {
  test('the site root, the docs and the specification entry points survive maxPages 15', async () => {
    const { analyzer, requested } = stubbedAnalyzer(15);
    await analyzer.analyzeSiteStructure(`${BASE}/`);

    assert.deepEqual(analyzer.analysis.errors, [], 'structure analysis must not error');
    const pages = analyzer.analysis.structure.sitemap;
    assert.equal(pages.length, 15, `expected 15 pages, got ${pages.length}`);
    assert.equal(new Set(pages).size, pages.length, 'pages must be unique');
    assert.ok(pages.includes(`${BASE}/`), `site root missing from:\n${pages.join('\n')}`);
    assert.ok(pages.some((u) => u.startsWith(`${BASE}/docs/`)), `no docs page in:\n${pages.join('\n')}`);
    assert.ok(
      pages.some((u) => u.startsWith(`${BASE}/specification/`)),
      `no specification page in:\n${pages.join('\n')}`
    );
    // The pool handed to map_site has to be wider than the budget, or the
    // sections below the cut are never candidates in the first place.
    assert.ok(requested.maxUrls > 15, `map_site was asked for only ${requested.maxUrls} URLs`);
  });

  test('no section is starved while another takes a second helping', async () => {
    const { analyzer } = stubbedAnalyzer(15);
    await analyzer.analyzeSiteStructure(`${BASE}/`);

    const pages = analyzer.analysis.structure.sitemap;
    const sectionOf = (u) => new URL(u).pathname.split('/').filter(Boolean)[0] ?? '';
    const tally = (list) => list.reduce((acc, u) => {
      const name = sectionOf(u);
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {});
    const kept = tally(pages);
    const available = tally(SITEMAP);
    const most = Math.max(...Object.values(kept));

    for (const [name, count] of Object.entries(kept)) {
      if (name === '') continue; // the root, which is always a single page
      assert.ok(
        count === available[name] || count >= most - 1,
        `${name} kept ${count} of its ${available[name]} pages while another section kept ${most}`
      );
    }
  });

  test('every declared section is represented before any section gets a second page', async () => {
    const { analyzer } = stubbedAnalyzer(15);
    await analyzer.analyzeSiteStructure(`${BASE}/`);

    const pages = analyzer.analysis.structure.sitemap;
    const sections = ['community', 'development', 'docs', 'examples', 'specification'];
    const firstSix = pages.slice(0, 1 + sections.length);
    assert.equal(firstSix[0], `${BASE}/`, 'the root leads');
    for (const section of sections) {
      assert.ok(
        firstSix.some((u) => u.startsWith(`${BASE}/${section}`)),
        `${section} missing from the opening entries:\n${firstSix.join('\n')}`
      );
    }
  });
});

describe('LLMsTxtAnalyzer.prioritizeUrls', () => {
  test('adds the site root when the sitemap never declares it', () => {
    const analyzer = new LLMsTxtAnalyzer();
    const ordered = analyzer.prioritizeUrls([`${BASE}/docs/intro`], BASE, 10);
    assert.deepEqual(ordered, [`${BASE}/`, `${BASE}/docs/intro`]);
  });

  test('the root is recognised with or without its trailing slash and is never duplicated', () => {
    const analyzer = new LLMsTxtAnalyzer();
    for (const root of [BASE, `${BASE}/`]) {
      const ordered = analyzer.prioritizeUrls([root, `${BASE}/docs/intro`], BASE, 10);
      assert.deepEqual(ordered, [`${BASE}/`, `${BASE}/docs/intro`], `root form "${root}" mishandled`);
    }
  });

  test('the same URLs in any order produce the same list', () => {
    const analyzer = new LLMsTxtAnalyzer();
    const forwards = analyzer.prioritizeUrls(SITEMAP, BASE, 15);
    const backwards = analyzer.prioritizeUrls([...SITEMAP].reverse(), BASE, 15);
    assert.deepEqual(backwards, forwards);
    assert.deepEqual(analyzer.prioritizeUrls(SITEMAP, BASE, 15), forwards);
  });

  test('a section is entered at its shallowest path', () => {
    const analyzer = new LLMsTxtAnalyzer();
    const ordered = analyzer.prioritizeUrls(
      [`${BASE}/docs/a/b/c`, `${BASE}/docs/intro`, `${BASE}/docs/a/b`],
      BASE,
      10
    );
    assert.deepEqual(ordered, [`${BASE}/`, `${BASE}/docs/intro`, `${BASE}/docs/a/b`, `${BASE}/docs/a/b/c`]);
  });

  test('nothing discovered means nothing invented', () => {
    const analyzer = new LLMsTxtAnalyzer();
    assert.deepEqual(analyzer.prioritizeUrls([], BASE, 10), []);
    assert.deepEqual(analyzer.prioritizeUrls(['not a url'], BASE, 10), []);
  });
});

describe('GenerateLLMsTxtTool — uncategorized pages still reach llms.txt', () => {
  test('a site with a named section keeps its homepage and its unrecognised sections', () => {
    const tool = new GenerateLLMsTxtTool();
    const pages = [
      `${BASE}/`,
      `${BASE}/docs/2025-06-18/sdk`,
      `${BASE}/specification/2025-06-18`,
      `${BASE}/community/wg-00`
    ];
    const out = tool.generateSpecLLMsTxt({
      metadata: { baseUrl: BASE, analyzedAt: new Date().toISOString() },
      structure: {
        totalPages: pages.length,
        sitemap: pages,
        sections: {
          content: [],
          navigation: [],
          media: [],
          tools: [],
          documentation: [`${BASE}/docs/2025-06-18/sdk`],
          other: [`${BASE}/`, `${BASE}/specification/2025-06-18`, `${BASE}/community/wg-00`]
        },
        navigation: {},
        hierarchy: {},
        robotsTxt: null
      },
      contentTypes: {},
      apis: [],
      securityAreas: [],
      errors: []
    }, {});

    for (const page of pages) {
      assert.ok(out.includes(`](${page})`), `${page} missing from generated llms.txt:\n${out}`);
    }
    assert.equal(out.match(/^## Pages$/gm)?.length, 1, `expected exactly one Pages section:\n${out}`);
  });
});

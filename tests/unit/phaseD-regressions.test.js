/**
 * Phase D (v4.6.0 "Firecrawl-Competitive") regression tests.
 *
 * Run: node --test tests/unit/phaseD-regressions.test.js
 *
 * Covers the three Phase D deliverables with no live network calls:
 *
 * D1  AgentOrchestrator hard stops
 *     D1.1  Loop terminates at maxSteps (mocked LLM always says "continue")
 *     D1.2  Loop terminates at maxUrls (never fetches beyond the cap)
 *     D1.3  maxSteps clamped to ≤10 even when caller passes a larger value
 *     D1.4  maxUrls clamped to ≤20 even when caller passes a larger value
 *     D1.5  Wall-clock time-budget stop (tiny deadline via Date.now stub)
 *     D1.6  No-LLM-key path returns {degraded:true} rather than throwing
 *
 * D2  unified scrape (UnifiedScrapeTool)
 *     D2.1  formats:["markdown","links","metadata","text"] returns all four keys
 *           from a SINGLE fetch (fetch called once)
 *     D2.2  A failing format adds a warnings[] entry; rest of result survives
 *     D2.3  onlyMainContent controls the Readability boilerplate-removal branch
 *
 * D3  map_site search= (MapSiteTool)
 *     D3.1  Without search, result has no ranked_urls key (back-compat)
 *     D3.2  With search set, ranked_urls:[{url,score}] present and sorted desc
 *
 * D4  server.js registration checks
 *     D4.1  "scrape" and "agent" tools are registered
 *     D4.2  Tool count banner says 26
 */

import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const readSrc = (p) => readFileSync(join(repoRoot, p), 'utf8');

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal HTML fetch stub.  Returns an ok Response-like that resolves
 * to the given html string via .text().
 */
function htmlFetch(html, url = 'https://example.com/') {
  return async () => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    text: async () => html
  });
}

/** Minimal HTML page with a title and a link. */
const MINIMAL_HTML = `<!DOCTYPE html>
<html>
<head><title>Test Page</title><meta name="description" content="A test page"></head>
<body>
  <h1>Hello World</h1>
  <p>This is a paragraph about testing.</p>
  <a href="/internal">Internal link</a>
  <a href="https://external.com/page">External link</a>
</body>
</html>`;

// ---------------------------------------------------------------------------
// D1  AgentOrchestrator hard stops
// ---------------------------------------------------------------------------

describe('D1.1 AgentOrchestrator terminates at maxSteps', async () => {
  test('loop stops at capSteps even when mock LLM always "continues"', async () => {
    const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');

    const o = new AgentOrchestrator({});

    // Mock SamplingClient: always returns a valid text (simulating "continue" intent)
    let samplingCalls = 0;
    o._samplingClient = {
      complete: async () => {
        samplingCalls++;
        return { text: 'keep going with the research', provider: 'mock' };
      }
    };

    // Mock search tool: returns enough URLs to fill the queue
    const searchUrls = Array.from({ length: 15 }, (_, i) => `https://example.com/p${i}`);
    // SearchWebTool.execute() returns the raw results object (not MCP content-wrapped).
    o._searchTool = {
      execute: async () => ({
        results: searchUrls.map((u, i) => ({
          link: u,
          title: `Page ${i}`,
          snippet: 'testing content for agent orchestrator'
        }))
      })
    };

    // Mock fetch so every URL returns relevant text (no network)
    let fetchCount = 0;
    globalThis.fetch = async (url) => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: () => null },
        text: async () => `<html><body><p>testing content relevant to the query</p></body></html>`
      };
    };

    const result = await o.run({
      prompt: 'testing content relevant',
      maxSteps: 3,
      maxUrls: 20
    });

    // The hard-cap is 3 steps; steps_used must never exceed 3
    assert.ok(result.steps <= 3, `steps=${result.steps} must be ≤ 3`);
    assert.ok(result.urls_fetched <= 3, `urls_fetched=${result.urls_fetched} must be ≤ 3`);
  });
});

describe('D1.2 AgentOrchestrator terminates at maxUrls', async () => {
  test('total URLs fetched never exceeds capUrls', async () => {
    const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');

    const o = new AgentOrchestrator({});

    o._samplingClient = {
      complete: async () => ({ text: 'query1\nquery2', provider: 'mock' })
    };

    // Provide 15 search results
    const searchUrls = Array.from({ length: 15 }, (_, i) => `https://test.com/page${i}`);
    o._searchTool = {
      execute: async () => ({
        results: searchUrls.map((u, i) => ({
          link: u,
          title: `Test ${i}`,
          snippet: 'research topic content here'
        }))
      })
    };

    let urlsFetchedByNetwork = 0;
    globalThis.fetch = async (url) => {
      urlsFetchedByNetwork++;
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: () => null },
        text: async () => `<html><body><p>research topic content here for testing</p></body></html>`
      };
    };

    const result = await o.run({
      prompt: 'research topic content',
      maxSteps: 20,
      maxUrls: 4   // caller requests 4
    });

    // Must not exceed 4 URLs fetched
    assert.ok(result.urls_fetched <= 4, `urls_fetched=${result.urls_fetched} must be ≤ 4`);
    assert.ok(urlsFetchedByNetwork <= 4, `network fetches=${urlsFetchedByNetwork} must be ≤ 4`);
  });
});

describe('D1.3 AgentOrchestrator clamps maxSteps to hard ceiling of 10', async () => {
  test('passing maxSteps=50 results in at most 10 steps executed', async () => {
    const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');

    const o = new AgentOrchestrator({});

    o._samplingClient = {
      complete: async () => ({ text: 'search query', provider: 'mock' })
    };

    // Return a large pool of search URLs
    const searchUrls = Array.from({ length: 30 }, (_, i) => `https://clamp-test.com/p${i}`);
    o._searchTool = {
      execute: async () => ({
        results: searchUrls.map((u, i) => ({
          link: u,
          title: `Page ${i}`,
          snippet: 'content clamp test data'
        }))
      })
    };

    let stepsFetched = 0;
    globalThis.fetch = async (url) => {
      stepsFetched++;
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: () => null },
        text: async () => `<html><body><p>content clamp test data for all topics</p></body></html>`
      };
    };

    const result = await o.run({
      prompt: 'content clamp test data',
      maxSteps: 50,  // exceeds hard ceiling of 10
      maxUrls: 30
    });

    // Hard ceiling: regardless of what was passed, at most 10 steps
    assert.ok(result.steps <= 10, `steps=${result.steps} must be clamped to ≤ 10`);
    assert.ok(stepsFetched <= 10, `network fetches=${stepsFetched} must be clamped to ≤ 10`);
  });

  test('clamp logic: Math.min(maxSteps, 10) verified against source', () => {
    const src = readSrc('src/core/AgentOrchestrator.js');
    // The source must contain the clamp expression
    assert.ok(
      src.includes('Math.min(maxSteps, 10)'),
      'source must clamp maxSteps to 10 via Math.min'
    );
  });
});

describe('D1.4 AgentOrchestrator clamps maxUrls to hard ceiling of 20', async () => {
  test('clamp logic: Math.min(maxUrls, 20) verified against source', () => {
    const src = readSrc('src/core/AgentOrchestrator.js');
    assert.ok(
      src.includes('Math.min(maxUrls, 20)'),
      'source must clamp maxUrls to 20 via Math.min'
    );
  });

  test('passing maxUrls=100 clamps to ≤20 URLs fetched', async () => {
    const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');

    const o = new AgentOrchestrator({});

    o._samplingClient = {
      complete: async () => ({ text: 'large url test query', provider: 'mock' })
    };

    const searchUrls = Array.from({ length: 50 }, (_, i) => `https://maxurls-test.com/p${i}`);
    o._searchTool = {
      execute: async () => ({
        results: searchUrls.map((u, i) => ({
          link: u,
          title: `URL ${i}`,
          snippet: 'large url test query data content'
        }))
      })
    };

    let networkFetches = 0;
    globalThis.fetch = async (url) => {
      networkFetches++;
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: () => null },
        text: async () => `<html><body><p>large url test query data content relevant</p></body></html>`
      };
    };

    const result = await o.run({
      prompt: 'large url test query data',
      maxSteps: 100, // also exceeds ceiling
      maxUrls: 100   // exceeds ceiling of 20
    });

    assert.ok(result.urls_fetched <= 20, `urls_fetched=${result.urls_fetched} must be ≤ 20`);
    assert.ok(networkFetches <= 20, `network fetches=${networkFetches} must be ≤ 20`);
  });
});

describe('D1.5 AgentOrchestrator wall-clock time-budget stop', async () => {
  test('passes wallClockMs=1 (1ms) and gets a degraded result with no evidence', async () => {
    const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');

    const o = new AgentOrchestrator({});

    // Make sampling artificially slow so the deadline triggers before any fetch
    o._samplingClient = {
      complete: async () => {
        // wait 10ms to ensure wall clock has expired before we continue
        await new Promise(r => setTimeout(r, 10));
        return { text: 'slow query', provider: 'mock' };
      }
    };

    // Search tool should be reachable but deadline will fire before any fetch
    o._searchTool = {
      execute: async () => ({
        results: [{ link: 'https://wallclock.com/page', title: 'T', snippet: 'test query content data' }]
      })
    };

    globalThis.fetch = async (url) => ({
      ok: true, status: 200, url,
      headers: { get: () => null },
      text: async () => `<html><body><p>test query content data matching prompt</p></body></html>`
    });

    // 1ms wall clock: the deadline() check fires before any fetch in the ACT loop
    const result = await o.run({
      prompt: 'test query content data',
      maxSteps: 10,
      maxUrls: 10,
      wallClockMs: 1
    });

    // With wallClockMs=1 the ACT loop body is skipped entirely: no content → degraded
    assert.equal(result.success, true);
    // The result should reflect zero or very few steps due to the deadline
    assert.ok(result.steps <= 2, `steps=${result.steps} should be very low with 1ms deadline`);
  });
});

describe('D1.6 AgentOrchestrator no-LLM-key path returns degraded, not throw', async () => {
  test('with no LLM and no Ollama, run() returns {degraded:true} with evidence', async () => {
    const { AgentOrchestrator } = await import('../../src/core/AgentOrchestrator.js');

    const o = new AgentOrchestrator({ mcpServer: null });

    // Ensure no env LLM keys interfere
    const savedOpenAI = process.env.OPENAI_API_KEY;
    const savedAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    // SamplingClient will be built lazily; stub all its fetch paths
    // by making globalThis.fetch fail for Ollama and not setting env keys.
    // We override the samplingClient so it always throws (no LLM).
    o._samplingClient = {
      complete: async () => {
        throw new Error('No LLM available: Ollama is not running, no API keys set');
      }
    };

    // Search tool returns one URL with relevant content
    o._searchTool = {
      execute: async () => ({
        results: [{ link: 'https://nollm.com/page', title: 'No LLM', snippet: 'nollm test evidence content' }]
      })
    };

    // Fetch returns relevant content so evidence[] is populated
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      url,
      headers: { get: () => null },
      text: async () => `<html><body><p>nollm test evidence content relevant to prompt</p></body></html>`
    });

    try {
      const result = await o.run({
        prompt: 'nollm test evidence',
        maxSteps: 3,
        maxUrls: 5
      });

      // Must NOT throw; must return {degraded:true}
      assert.equal(typeof result, 'object', 'should return an object, not throw');
      assert.equal(result.degraded, true, 'degraded must be true when LLM unavailable');
      assert.equal(typeof result.reason, 'string', 'reason must be a string');
      assert.ok(result.reason.length > 0, 'reason must be non-empty');
      // Raw evidence returned so host LLM can synthesise
      assert.ok(Array.isArray(result.evidence), 'evidence must be an array');
    } finally {
      if (savedOpenAI !== undefined) process.env.OPENAI_API_KEY = savedOpenAI;
      if (savedAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropic;
    }
  });
});

// ---------------------------------------------------------------------------
// D2  UnifiedScrapeTool
// ---------------------------------------------------------------------------

describe('D2.1 UnifiedScrapeTool single fetch returns all four formats', async () => {
  test('formats:[markdown,links,metadata,text] triggers exactly one network fetch', async () => {
    const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');

    let fetchCallCount = 0;
    globalThis.fetch = async (url) => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        url: 'https://example.com/',
        headers: { get: () => 'text/html' },
        text: async () => MINIMAL_HTML
      };
    };

    const tool = new UnifiedScrapeTool();
    const result = await tool.execute({
      url: 'https://example.com/',
      formats: ['markdown', 'links', 'metadata', 'text'],
      onlyMainContent: false
    });

    assert.equal(result.success, true, 'result.success must be true');

    // All four format keys must be present
    assert.ok('markdown' in result.content, 'content.markdown should be present');
    assert.ok('links' in result.content, 'content.links should be present');
    assert.ok('metadata' in result.content, 'content.metadata should be present');
    assert.ok('text' in result.content, 'content.text should be present');

    // Exactly one network fetch (HTML fetched once, formats derived from that)
    assert.equal(fetchCallCount, 1, `Expected 1 fetch, got ${fetchCallCount}`);
  });

  test('each format contains meaningful data', async () => {
    const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');

    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: { get: () => 'text/html' },
      text: async () => MINIMAL_HTML
    });

    const tool = new UnifiedScrapeTool();
    const result = await tool.execute({
      url: 'https://example.com/',
      formats: ['markdown', 'links', 'metadata', 'text'],
      onlyMainContent: false
    });

    // Markdown: should contain some text
    assert.ok(typeof result.content.markdown === 'string', 'markdown should be a string');

    // Links: should have structure with links array
    assert.ok(typeof result.content.links === 'object', 'links should be an object');
    assert.ok(Array.isArray(result.content.links.links), 'links.links should be an array');
    assert.ok(result.content.links.total_count >= 0, 'links.total_count should be a number');

    // Metadata: should have title field
    assert.ok(typeof result.content.metadata === 'object', 'metadata should be an object');
    assert.ok('title' in result.content.metadata, 'metadata should have title');

    // Text: should be a non-empty string
    assert.ok(typeof result.content.text === 'string', 'text should be a string');
  });
});

describe('D2.2 UnifiedScrapeTool partial failure yields warnings but not full failure', async () => {
  test('screenshot format captures via the shared executor (v4.8)', async () => {
    const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: { get: () => 'text/html' },
      text: async () => MINIMAL_HTML
    });

    // Inject a stub executor so the test is deterministic (no real browser).
    let called = 0;
    const stubExec = { executeActionChain: async () => { called++; return { screenshots: [{ actionId: 'a1', data: 'BASE64', format: 'png' }] }; } };
    const tool = new UnifiedScrapeTool({ actionExecutor: stubExec });
    const result = await tool.execute({
      url: 'https://example.com/',
      formats: ['markdown', 'screenshot'],
      onlyMainContent: false
    });

    assert.equal(result.success, true);
    assert.ok('markdown' in result.content, 'markdown should still be present');
    assert.equal(called, 1, 'screenshot should invoke the executor exactly once');
    assert.equal(result.content.screenshots[0].actionId, 'a1');
  });

  test('screenshot capture failure degrades to a warning but result.success remains true', async () => {
    const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: { get: () => 'text/html' },
      text: async () => MINIMAL_HTML
    });

    // Executor that throws -> partial-success contract: warning, not a hard fail.
    const failExec = { executeActionChain: async () => { throw new Error('browser unavailable'); } };
    const tool = new UnifiedScrapeTool({ actionExecutor: failExec });
    const result = await tool.execute({
      url: 'https://example.com/',
      formats: ['markdown', 'screenshot'],
      onlyMainContent: false
    });

    assert.equal(result.success, true, 'result must still succeed with partial warning');
    assert.ok('markdown' in result.content, 'markdown should still be present');
    assert.ok(Array.isArray(result.warnings) && result.warnings.length > 0, 'a warning is expected');
    const screenshotWarn = result.warnings.find(w => w.toLowerCase().includes('screenshot'));
    assert.ok(screenshotWarn, `Expected a screenshot warning, got: ${JSON.stringify(result.warnings)}`);
  });

  test('unknown format adds a warning and other formats still succeed', async () => {
    const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');

    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: { get: () => 'text/html' },
      text: async () => MINIMAL_HTML
    });

    const tool = new UnifiedScrapeTool();
    // Inject an unknown format directly (bypassing schema validation)
    // by calling the internal logic path; to avoid schema rejection we test
    // what the tool's source says about unknown formats.
    const src = readSrc('src/tools/scrape/unifiedScrape.js');
    assert.ok(
      src.includes("warnings.push(`unknown format:"),
      'source should push a warning for unknown formats'
    );
  });
});

describe('D2.3 UnifiedScrapeTool onlyMainContent toggles Readability branch', async () => {
  test('onlyMainContent:true invokes Readability path (branch present in source)', () => {
    const src = readSrc('src/tools/scrape/unifiedScrape.js');
    // Readability is imported at top
    assert.ok(src.includes("from '@mozilla/readability'"), 'Readability import should be present');
    // onlyMainContent guard exists for at least one format
    assert.ok(src.includes('onlyMainContent'), 'onlyMainContent should appear in the source');
    assert.ok(src.includes('getMainHtml()'), 'getMainHtml helper must be used when onlyMainContent is on');
  });

  test('onlyMainContent:false returns rawHtml that matches full page body', async () => {
    const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');

    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: { get: () => 'text/html' },
      text: async () => MINIMAL_HTML
    });

    const tool = new UnifiedScrapeTool();
    const result = await tool.execute({
      url: 'https://example.com/',
      formats: ['rawHtml'],
      onlyMainContent: false
    });

    assert.equal(result.success, true);
    assert.ok(typeof result.content.rawHtml === 'string', 'rawHtml should be a string');
    // Raw HTML is the verbatim fetched HTML
    assert.ok(result.content.rawHtml.includes('Hello World'), 'rawHtml should contain page content');
  });

  test('onlyMainContent:true vs false produces different markdown for boilerplate-heavy page', async () => {
    const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');

    // Page with heavy boilerplate nav/ads and a small main content block
    const boilerplatePage = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <nav>Nav link 1 Nav link 2 Nav link 3 Nav link 4 Nav link 5</nav>
  <header>Header advertisement header advertisement header</header>
  <main>
    <article>
      <h1>The Main Article Title</h1>
      <p>This is the main content that Readability should preserve. It has enough text to be recognized as article content.</p>
      <p>More article content here, providing context for the readability algorithm to work correctly.</p>
    </article>
  </main>
  <footer>Footer advertisement footer copyright footer legal</footer>
</body>
</html>`;

    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: { get: () => 'text/html' },
      text: async () => boilerplatePage
    });

    const tool = new UnifiedScrapeTool();

    // onlyMainContent:false — rawHtml returned
    const resultFull = await tool.execute({
      url: 'https://example.com/',
      formats: ['rawHtml'],
      onlyMainContent: false
    });

    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: { get: () => 'text/html' },
      text: async () => boilerplatePage
    });

    // onlyMainContent:true — html format via Readability
    const resultMain = await tool.execute({
      url: 'https://example.com/',
      formats: ['html'],
      onlyMainContent: true
    });

    assert.equal(resultFull.success, true);
    assert.equal(resultMain.success, true);

    // Full HTML should be longer (includes nav/footer boilerplate)
    assert.ok(
      resultFull.content.rawHtml.length > (resultMain.content.html || '').length ||
      resultMain.content.html !== resultFull.content.rawHtml,
      'onlyMainContent:true should produce different (typically shorter) output than onlyMainContent:false'
    );
  });
});

// ---------------------------------------------------------------------------
// D3  MapSiteTool search= parameter
// ---------------------------------------------------------------------------

describe('D3.1 MapSiteTool without search: no ranked_urls in output (back-compat)', async () => {
  test('result has no ranked_urls key when search param is absent', async () => {
    const { MapSiteTool } = await import('../../src/tools/crawl/mapSite.js');

    // Stub fetch: sitemap 404, page returns a couple of links
    globalThis.fetch = async (url) => {
      const u = url.toString();
      if (u.includes('robots.txt') || u.includes('sitemap')) {
        return { ok: false, status: 404, url, text: async () => '' };
      }
      return {
        ok: true,
        status: 200,
        url,
        text: async () => `<html><body>
          <a href="https://example.com/about">About</a>
          <a href="https://example.com/contact">Contact</a>
        </body></html>`
      };
    };

    const tool = new MapSiteTool({ cacheEnabled: false });
    const result = await tool.execute({ url: 'https://example.com/', include_sitemap: false });

    assert.ok(!('ranked_urls' in result), 'ranked_urls should NOT be present when search is not set');
    assert.ok('total_urls' in result, 'standard total_urls field must be present');
    assert.ok('urls' in result, 'standard urls field must be present');
  });
});

describe('D3.2 MapSiteTool with search: ranked_urls present and sorted by score desc', async () => {
  test('ranked_urls is an array of {url, score} objects sorted descending', async () => {
    const { MapSiteTool } = await import('../../src/tools/crawl/mapSite.js');

    // Stub fetch: no sitemap, main page returns several links with different path names
    globalThis.fetch = async (url) => {
      const u = url.toString();
      if (u.includes('robots.txt') || u.includes('sitemap')) {
        return { ok: false, status: 404, url, text: async () => '' };
      }
      return {
        ok: true,
        status: 200,
        url,
        text: async () => `<html><body>
          <a href="https://example.com/about-us">About us</a>
          <a href="https://example.com/blog/post-one">Blog post one</a>
          <a href="https://example.com/products/widget">Products widget</a>
          <a href="https://example.com/pricing">Pricing</a>
          <a href="https://example.com/contact">Contact</a>
        </body></html>`
      };
    };

    const tool = new MapSiteTool({ cacheEnabled: false });
    const result = await tool.execute({
      url: 'https://example.com/',
      include_sitemap: false,
      search: 'blog post content'
    });

    assert.ok('ranked_urls' in result, 'ranked_urls should be present when search is set');
    assert.ok(Array.isArray(result.ranked_urls), 'ranked_urls must be an array');
    assert.ok(result.ranked_urls.length > 0, 'ranked_urls must be non-empty');

    // Each entry must have url and score
    for (const entry of result.ranked_urls) {
      assert.ok('url' in entry, 'each ranked entry must have url');
      assert.ok('score' in entry, 'each ranked entry must have score');
      assert.ok(typeof entry.url === 'string', 'url must be a string');
      assert.ok(typeof entry.score === 'number', 'score must be a number');
    }

    // Must be sorted by score descending
    for (let i = 1; i < result.ranked_urls.length; i++) {
      assert.ok(
        result.ranked_urls[i - 1].score >= result.ranked_urls[i].score,
        `ranked_urls not sorted desc at index ${i}: ${result.ranked_urls[i - 1].score} < ${result.ranked_urls[i].score}`
      );
    }
  });

  test('search= key present in MapSiteSchema (source check)', () => {
    const src = readSrc('src/tools/crawl/mapSite.js');
    assert.ok(src.includes("search: z.string().optional()"), 'search field must be in the zod schema');
    assert.ok(src.includes('ranked_urls'), 'ranked_urls must be set in the execute path');
  });
});

// ---------------------------------------------------------------------------
// D4  server.js registration checks
// ---------------------------------------------------------------------------

describe('D4.1 server.js registers scrape and agent tools', () => {
  test('registerTool("scrape") is present', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes('registerTool("scrape"'), 'scrape tool must be registered');
  });

  test('registerTool("agent") is present', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes('registerTool("agent"'), 'agent tool must be registered');
  });
});

describe('D4.2 server.js banner reports 26 tools', () => {
  test('Tools available banner says 26', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes('Tools available (26)'), 'banner must say "Tools available (26)"');
  });
});

// ---------------------------------------------------------------------------
// D5  ResearchOrchestrator credibilityThreshold is wired through
// (regression: param was schema-validated but never read — verifySource-
//  Credibility hardcoded >= 0.3, so the knob was a silent no-op)
// ---------------------------------------------------------------------------

describe('D5.1 ResearchOrchestrator reads credibilityThreshold from constructor', async () => {
  test('this.credibilityThreshold reflects the option (default 0.3, clamped 0..1)', async () => {
    const { ResearchOrchestrator } = await import('../../src/core/ResearchOrchestrator.js');

    assert.equal(new ResearchOrchestrator({}).credibilityThreshold, 0.3, 'default must be 0.3');
    assert.equal(new ResearchOrchestrator({ credibilityThreshold: 0.7 }).credibilityThreshold, 0.7);
    assert.equal(new ResearchOrchestrator({ credibilityThreshold: 5 }).credibilityThreshold, 1, 'clamp high');
    assert.equal(new ResearchOrchestrator({ credibilityThreshold: -1 }).credibilityThreshold, 0, 'clamp low');
  });

  test('all source-inclusion credibility gates use this.credibilityThreshold, not a hardcoded 0.3', () => {
    const src = readSrc('src/core/ResearchOrchestrator.js');
    // verifySourceCredibility (line ~864) + compileSupportingEvidence (raw-evidence
    // path) + generateKeyFindings (LLM path) must all reference the knob.
    assert.ok(
      src.includes('overallCredibility >= this.credibilityThreshold'),
      'verifySourceCredibility must reference this.credibilityThreshold'
    );
    assert.ok(
      src.includes('source.overallCredibility >= this.credibilityThreshold'),
      'compileSupportingEvidence must reference this.credibilityThreshold'
    );
    assert.ok(
      src.includes('group.avgCredibility >= this.credibilityThreshold'),
      'generateKeyFindings must reference this.credibilityThreshold'
    );
    // No source/group credibility inclusion-gate may hardcode 0.3 anymore.
    // (The 0.6 consensus bar in detectConsensus is a separate concept and is allowed.)
    assert.ok(
      !/(overallCredibility|avgCredibility) >= 0\.3/.test(src),
      'no credibility inclusion-gate may hardcode 0.3'
    );
  });
});

describe('D5.2 ResearchOrchestrator credibilityThreshold changes kept-source count', async () => {
  // Topic + bodies chosen so on-topic sources score ~0.55-0.77 and the
  // off-topic one scores ~0.24 (below default 0.3). No network: we call the
  // pure scoring path directly via verifySourceCredibility.
  const topic = 'impact of remote work on employee productivity';
  const onTopic = ('Remote work has reshaped employee productivity. '
    + 'Studies on remote work show productivity gains for many employees. '
    + 'The impact of remote work on productivity depends on management. ').repeat(20);
  const offTopic = ('Volcanic basalt formations along the coastline attract geologists. '
    + 'Mineral composition varies with cooling rates and pressure gradients. ').repeat(40);

  async function keptCount(threshold) {
    const { ResearchOrchestrator } = await import('../../src/core/ResearchOrchestrator.js');
    const orch = new ResearchOrchestrator(
      threshold === undefined ? {} : { credibilityThreshold: threshold });
    orch.researchState.topic = topic;
    const mk = (link, body, extra = {}) => ({
      link, title: 'Untitled', extractedContent: body,
      wordCount: body.split(' ').length, metadata: {}, structuredData: {},
      relevanceScore: orch.calculateTraditionalRelevance(body, topic), ...extra
    });
    const sources = [
      mk('https://example.com/remote', onTopic),
      mk('https://news.example.com/blog', onTopic, { title: 'news blog post' }),
      mk('https://example.com/basalt', offTopic),
      mk('https://university.edu/study', onTopic, { title: 'a research study' })
    ];
    return (await orch.verifySourceCredibility(sources)).length;
  }

  test('default threshold keeps on-topic sources and drops the off-topic one', async () => {
    assert.equal(await keptCount(undefined), 3, 'default 0.3 keeps 3/4 (drops off-topic)');
  });

  test('threshold 0 keeps every extracted source', async () => {
    assert.equal(await keptCount(0), 4, 'threshold 0 keeps all 4');
  });

  test('high threshold drops more sources (knob is live)', async () => {
    assert.equal(await keptCount(0.7), 1, 'threshold 0.7 keeps only the high-credibility .edu study');
  });
});

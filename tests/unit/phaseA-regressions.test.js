/**
 * Phase A (v4.3.0) regression tests — reproduce-then-pass for each Phase-A fix.
 *
 * Run: node --test tests/unit/phaseA-regressions.test.js
 *
 * These exercise the real source modules with no live network:
 *  A1.1 extract_links  — filter_external:true returns ONLY external links
 *  A1.2 analyze_content — francAll import works (language detection no longer throws)
 *  A1.3 summarize_content — abstractive w/o backend returns extractive + degraded flag
 *  A1.4 extract_with_llm — no undefined callViaSampling (sampling fallback wired)
 *  A1.5 deep_research   — empty {text:""} extractions are not counted/surfaced
 *  A1.6 track_changes   — no-baseline returns a clean error (no unhandled 'error' event)
 *  A1.7 scrape_template — HN selectors populate score/author/comments
 *  A1.8 generate_llms_txt — spec-compliant markdown (# / > / ## / [name](url))
 *  A2   server.js MCP schemas — advanced params are forwarded (presence in source)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

// ── A1.1 extract_links: filter_external inversion ───────────────────────────
describe('A1.1 extract_links filter_external', () => {
  test('filter_external:true returns only external links', async () => {
    const { extractLinksHandler } = await import('../../src/tools/basic/extractLinks.js');

    const html = `<html><body>
      <a href="/internal">Internal Relative</a>
      <a href="https://example.com/page2">Internal Absolute</a>
      <a href="https://other.com/x">External</a>
      <a href="https://another.org/y">External 2</a>
    </body></html>`;

    // Stub fetchWithTimeout via a fake fetch is awkward; instead drive cheerio path
    // through the handler using a data: response mock.
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200, statusText: 'OK', text: async () => html
    });
    try {
      const res = await extractLinksHandler({ url: 'https://example.com/', filter_external: true });
      const payload = JSON.parse(res.content[0].text);
      assert.ok(Array.isArray(payload.links));
      assert.ok(payload.links.length > 0, 'should return external links');
      for (const l of payload.links) {
        assert.equal(l.is_external, true, `expected external link, got ${l.href}`);
      }
      const hosts = payload.links.map(l => new URL(l.href).host);
      assert.ok(hosts.includes('other.com'));
      assert.ok(!hosts.includes('example.com'), 'internal links must be excluded');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ── A1.2 analyze_content: francAll import ───────────────────────────────────
describe('A1.2 analyze_content language detection', () => {
  test('detectLanguage does not throw and returns a language for English text', async () => {
    const { ContentAnalyzer } = await import('../../src/core/analysis/ContentAnalyzer.js');
    const analyzer = new ContentAnalyzer();
    const text = 'The quick brown fox jumps over the lazy dog. This is a clear English sentence with common words for detection.';
    const result = await analyzer.detectLanguage(text);
    assert.ok(result, 'language detection should not return null for clear English');
    assert.equal(typeof result.code, 'string');
    assert.ok(Array.isArray(result.alternative), 'alternatives (francAll) must not throw');
  });
});

// ── A1.3 summarize_content: degraded abstractive fallback ───────────────────
describe('A1.3 summarize_content abstractive degraded flag', () => {
  test('abstractive request without LLM backend degrades to extractive with reason', async () => {
    const { SummarizeContentTool } = await import('../../src/tools/extract/summarizeContent.js');
    const tool = new SummarizeContentTool();
    // Force the sampling path to fail by ensuring no backend (method returns null).
    tool._abstractiveSummaryViaSampling = async () => null;
    const text = 'Renewable energy adoption is accelerating worldwide. Solar and wind costs have fallen sharply. ' +
      'Governments are setting ambitious targets. Storage technology is improving. Grid integration remains a challenge.';
    const result = await tool.execute({ text, options: { summaryType: 'abstractive', includeKeypoints: false, includeKeywords: false, includeStatistics: false } });
    assert.equal(result.success, true);
    assert.equal(result.degraded, true, 'should flag degraded when abstractive unavailable');
    assert.equal(result.summary.type, 'extractive');
    assert.ok(typeof result.degradedReason === 'string' && result.degradedReason.length > 0);
  });
});

// ── A1.4 extract_with_llm: no undefined callViaSampling ─────────────────────
describe('A1.4 extract_with_llm sampling fallback', () => {
  test('source no longer references undefined callViaSampling()', () => {
    const src = readFileSync(join(repoRoot, 'src/tools/extract/extractWithLlm.js'), 'utf8');
    assert.ok(!/\bcallViaSampling\s*\(/.test(src), 'callViaSampling() call must be removed');
    assert.ok(/getSamplingClient\(\)/.test(src), 'should wire getSamplingClient() fallback');
  });
});

// ── A1.5 deep_research: skip empty extractions ──────────────────────────────
describe('A1.5 ResearchOrchestrator empty-extraction guard', () => {
  test('source guards on success + non-empty content text', () => {
    const src = readFileSync(join(repoRoot, 'src/core/ResearchOrchestrator.js'), 'utf8');
    assert.ok(/contentText\.trim\(\)\.length\s*>\s*0/.test(src), 'must require non-empty content text');
    assert.ok(/contentData\.success\s*!==\s*false/.test(src), 'must check extraction success');
  });
});

// ── A1.6 track_changes: clean no-baseline error ─────────────────────────────
describe('A1.6 ChangeTracker no-baseline', () => {
  test('compareWithBaseline rejects cleanly without emitting an unhandled error event', async () => {
    const { ChangeTracker } = await import('../../src/core/ChangeTracker.js');
    const tracker = new ChangeTracker();
    let unhandledErrorEmitted = false;
    tracker.on('error', () => { unhandledErrorEmitted = true; });
    await assert.rejects(
      () => tracker.compareWithBaseline('https://no-baseline.example.com', 'some content'),
      /No baseline found.*run create_baseline first/
    );
    assert.equal(unhandledErrorEmitted, false, 'must not emit an error event for the expected no-baseline case');
  });
});

// ── A1.7 scrape_template: HN selectors ──────────────────────────────────────
describe('A1.7 scrape_template hacker-news-front-page', () => {
  test('score/author/comments are populated from the .subtext row', async () => {
    const { TemplateRegistry } = await import('../../src/tools/templates/TemplateRegistry.js');
    const registry = new TemplateRegistry();
    // Minimal HN-shaped markup: athing row + following metadata row with .subtext.
    const html = `<table><tbody>
      <tr class='athing' id='100'>
        <td class='title'><span class='titleline'><a href='https://story.example/a'>Story A</a></span></td>
      </tr>
      <tr>
        <td class='subtext'>
          <span class='score'>123 points</span> by <a class='hnuser' href='user?id=alice'>alice</a>
          <span class='age'><a href='item?id=100'>2 hours ago</a></span>
          | <a href='item?id=100'>45&nbsp;comments</a>
        </td>
      </tr>
      <tr class='spacer'></tr>
    </tbody></table>`;
    const out = await registry.run('hacker-news-front-page', html, 'https://news.ycombinator.com/');
    assert.equal(out.data.stories.length, 1);
    const s = out.data.stories[0];
    assert.equal(s.title, 'Story A');
    assert.equal(s.score, '123');           // " points" stripped
    assert.equal(s.author, 'alice');
    assert.ok(s.comments && /comments/.test(s.comments), `comments should be populated, got: ${s.comments}`);
  });
});

// ── A1.8 generate_llms_txt: spec-compliant markdown ─────────────────────────
describe('A1.8 generate_llms_txt spec output', () => {
  test('default output is llmstxt.org markdown, not robots.txt directives', async () => {
    const { GenerateLLMsTxtTool } = await import('../../src/tools/llmstxt/generateLLMsTxt.js');
    const tool = new GenerateLLMsTxtTool();
    const analysis = {
      metadata: { baseUrl: 'https://example.com' },
      structure: {
        totalPages: 12,
        sections: {
          documentation: ['https://example.com/docs/intro', 'https://example.com/docs/api'],
          content: ['https://example.com/blog/post-1'],
          tools: [], navigation: [], media: [], other: []
        },
        sitemap: ['https://example.com/', 'https://example.com/about']
      },
      apis: [{ url: 'https://example.com/api/v1', type: 'rest' }],
      contentTypes: {}, securityAreas: [], rateLimit: {}
    };
    const md = tool.generateLLMsTxt(analysis, {}, 'standard');
    assert.ok(md.startsWith('# '), 'must start with an H1 title');
    assert.ok(/\n>\s/.test(md), 'must contain a blockquote summary');
    assert.ok(/\n## /.test(md), 'must contain at least one ## section');
    assert.ok(/\]\(https:\/\/example\.com\/docs\/intro\)/.test(md), 'must contain markdown links');
    assert.ok(!/User-agent:/.test(md), 'must NOT emit robots.txt User-agent directives');
    assert.ok(!/Disallow:/.test(md), 'must NOT emit robots.txt Disallow directives');
  });

  test('robotsStyle:true preserves legacy robots-style output', async () => {
    const { GenerateLLMsTxtTool } = await import('../../src/tools/llmstxt/generateLLMsTxt.js');
    const tool = new GenerateLLMsTxtTool();
    const analysis = {
      metadata: { baseUrl: 'https://example.com' },
      structure: { sections: {}, sitemap: [] },
      apis: [], contentTypes: {}, securityAreas: [], rateLimit: {}
    };
    const out = tool.generateLLMsTxt(analysis, { robotsStyle: true }, 'standard');
    assert.ok(/User-agent:/.test(out), 'robotsStyle should still emit User-agent');
  });
});

// ── A2 server.js MCP schema forwarding ──────────────────────────────────────
describe('A2 restored MCP capabilities (server.js schema forwarding)', () => {
  const src = readFileSync(join(repoRoot, 'server.js'), 'utf8');

  test('crawl_deep forwards advanced params', () => {
    for (const p of ['domain_filter', 'session', 'import_filter_config', 'enable_link_analysis', 'link_analysis_options']) {
      assert.ok(src.includes(p), `crawl_deep should forward ${p}`);
    }
  });

  test('search_web forwards the 10 dropped params', () => {
    for (const p of ['provider', 'expand_query', 'expansion_options', 'enable_ranking', 'ranking_weights',
      'enable_deduplication', 'deduplication_thresholds', 'include_ranking_details',
      'include_deduplication_details', 'localization']) {
      assert.ok(src.includes(p), `search_web should forward ${p}`);
    }
  });

  test('scrape_with_actions carries extended action fields', () => {
    for (const p of ['duration', 'distance', 'direction', 'captureAfter', 'clear', 'button', 'clickCount', 'fullPage', 'returnResult']) {
      assert.ok(src.includes(p), `action schema should carry ${p}`);
    }
  });
});

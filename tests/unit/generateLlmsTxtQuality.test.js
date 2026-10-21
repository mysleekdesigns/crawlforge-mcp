/**
 * Live sweep 2026-10-20, item 4.4: generate_llms_txt content quality.
 * Run: node --test --test-force-exit tests/unit/generateLlmsTxtQuality.test.js
 *
 * Defects seen on docs.python.org and gov.uk:
 * - "APIs detected" for gov.uk, whose /api redirects to an HTML help page.
 * - "Contact us using the information above" with no contact details below.
 * - Link text from URL slugs ("3: index") instead of page titles.
 * - "Public content pages: 0 identified" after analysing every page: the
 *   site-wide search box (and gov.uk's hidden feedback form) made each page
 *   a "forms" page, and a "...-login" link href made gov.uk "restricted".
 *
 * The analyzer's fetch is stubbed with fixtures condensed from live captures
 * (tests/fixtures/llmstxt/), so these tests run offline.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LLMsTxtAnalyzer } from '../../src/core/LLMsTxtAnalyzer.js';
import { GenerateLLMsTxtTool } from '../../src/tools/llmstxt/generateLLMsTxt.js';

const fixture = (name) => readFileSync(new URL(`../fixtures/llmstxt/${name}`, import.meta.url), 'utf8');
const HTML = 'text/html; charset=utf-8';

const PYTHON_INDEX = 'https://docs.python.org/3/index.html';
const GOVUK_HOME = 'https://www.gov.uk/';
const GOVUK_HELP = 'https://www.gov.uk/help/reuse-govuk-content';

// url -> [body, content-type]; anything else is a 404.
function stubbedAnalyzer(pages) {
  const analyzer = new LLMsTxtAnalyzer();
  analyzer.fetchWithTimeout = async (url) => {
    const page = pages[url];
    if (!page) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    return new Response(page[0], { status: 200, headers: { 'content-type': page[1] } });
  };
  return analyzer;
}

const GOVUK_PAGES = {
  [GOVUK_HOME]: [fixture('govuk-home.html'), HTML],
  // /api answers 200 after redirecting to the help page.
  'https://www.gov.uk/api': [fixture('govuk-help-reuse-govuk-content.html'), HTML],
  [GOVUK_HELP]: [fixture('govuk-help-reuse-govuk-content.html'), HTML]
};

async function classify(analyzer, baseUrl, urls) {
  analyzer.analysis.metadata = { baseUrl, analyzedAt: '2026-10-21T00:00:00.000Z', analysisTimeMs: 1 };
  analyzer.analysis.structure = { totalPages: urls.length, sitemap: urls, sections: { other: urls }, robotsTxt: null };
  await analyzer.classifyContent();
  return analyzer.analysis;
}

describe('API detection counts only endpoints that answer JSON or XML', () => {
  const tool = new GenerateLLMsTxtTool();

  test('gov.uk /api (redirects to an HTML help page) is not an API', async () => {
    const analyzer = stubbedAnalyzer(GOVUK_PAGES);
    await analyzer.detectAPIEndpoints(GOVUK_HOME);
    assert.deepEqual(analyzer.analysis.apis.map((a) => a.url), []);
    assert.ok(!tool.generateRecommendations(analyzer.analysis).some((r) => /APIs detected/.test(r.message)));
  });

  test('a probe answering application/json still counts', async () => {
    const analyzer = stubbedAnalyzer({ 'https://example.com/api': ['{"ok":true}', 'application/json'] });
    await analyzer.detectAPIEndpoints('https://example.com/');
    assert.deepEqual(analyzer.analysis.apis.map((a) => a.url), ['https://example.com/api']);
    assert.ok(tool.generateRecommendations(analyzer.analysis).some((r) => /APIs detected/.test(r.message)));
  });

  test('documentation links alone do not trigger "APIs detected"', () => {
    const apis = [{ url: 'https://example.com/developers', type: 'documentation', description: 'developer api' }];
    assert.ok(!tool.generateRecommendations({ apis }).some((r) => /APIs detected/.test(r.message)));
  });
});

describe('pages with only a search box or a hidden feedback form are public content', () => {
  const tool = new GenerateLLMsTxtTool();

  test('docs.python.org: public, titled, linked by title', async () => {
    const analysis = await classify(stubbedAnalyzer({ [PYTHON_INDEX]: [fixture('python-docs-index.html'), HTML] }),
      'https://docs.python.org/3/', [PYTHON_INDEX]);
    assert.equal(analysis.contentTypes.public.length, 1);
    assert.equal(analysis.contentTypes.forms.length, 0);
    const txt = tool.generateSpecLLMsTxt(analysis, {});
    assert.match(txt, /- \[3\.15\.1 Documentation\]\(https:\/\/docs\.python\.org\/3\/index\.html\)/);
    assert.doesNotMatch(txt, /\[3: index\]/);
  });

  test('gov.uk: both pages public, titled, counted in llms-full.txt', async () => {
    const analysis = await classify(stubbedAnalyzer(GOVUK_PAGES), GOVUK_HOME, [GOVUK_HOME, GOVUK_HELP]);
    assert.equal(analysis.contentTypes.public.length, 2);
    assert.equal(analysis.contentTypes.restricted.length, 0);
    const txt = tool.generateSpecLLMsTxt(analysis, {});
    assert.match(txt, /- \[Welcome to GOV\.UK\]\(https:\/\/www\.gov\.uk\/\)/);
    assert.match(txt, /- \[Reuse GOV\.UK content - GOV\.UK\]\(https:\/\/www\.gov\.uk\/help\/reuse-govuk-content\)/);
    assert.match(tool.generateLLMsFullTxt({ ...analysis, apis: [], securityAreas: [], errors: [] }, {}, 'standard'),
      /Public content pages:\*\* 2 identified/);
  });

  test('a page with a visible non-search form is still a forms page, and keeps its title', async () => {
    const html = '<html><head><title>Contact us</title></head><body><form method="post" action="/contact"><textarea name="m"></textarea></form></body></html>';
    const analysis = await classify(stubbedAnalyzer({ 'https://example.com/contact': [html, HTML] }),
      'https://example.com/', ['https://example.com/contact']);
    assert.equal(analysis.contentTypes.forms.length, 1);
    assert.equal(analysis.contentTypes.forms[0].metadata.title, 'Contact us');
  });
});

describe('llms-full.txt says "contact us" only when it lists a contact', () => {
  const tool = new GenerateLLMsTxtTool();
  const analysis = {
    metadata: { baseUrl: 'https://example.com', analyzedAt: '2026-10-21T00:00:00.000Z' },
    structure: { totalPages: 1 },
    apis: [], securityAreas: [], errors: []
  };

  test('organizationName alone leaves the contact section empty, so no line', () => {
    assert.doesNotMatch(tool.generateLLMsFullTxt(analysis, { organizationName: 'Example Org' }, 'standard'),
      /Contact us using the information above/);
  });

  test('contactEmail fills it', () => {
    assert.match(tool.generateLLMsFullTxt(analysis, { contactEmail: 'ai@example.com' }, 'standard'),
      /Contact us using the information above/);
  });
});

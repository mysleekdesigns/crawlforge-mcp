/**
 * Regression tests: outputOptions.customGuidelines / customRestrictions reach
 * every generated file, not only the legacy robots-style llms.txt.
 *
 * Run: node --test tests/unit/llmsTxtCustomOptions.test.js
 *
 * Found by the 2026-08-30 live matrix: a llms-full-txt run with both options
 * set returned a file that carried the organisation name and contact but
 * neither list; the spec-format llms.txt also dropped customRestrictions.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateLLMsTxtTool } from '../../src/tools/llmstxt/generateLLMsTxt.js';

const analysis = () => ({
  metadata: { baseUrl: 'https://example.org', analyzedAt: new Date().toISOString(), analysisTimeMs: 1 },
  structure: { totalPages: 3, sitemap: [], sections: {}, navigation: {}, hierarchy: {}, robotsTxt: null },
  apis: [],
  contentTypes: { public: [], restricted: [], dynamic: [], static: [], forms: [], media: [], documents: [] },
  securityAreas: [],
  rateLimit: { recommendedDelay: 1000, maxConcurrency: 5, recommendedRPM: 30, reasoning: 'defaults' },
  guidelines: {},
  errors: []
});
const options = {
  organizationName: 'Example Org',
  contactEmail: 'ai@example.org',
  customGuidelines: ['Cite the docs page you used'],
  customRestrictions: ['/playground', '/internal']
};

describe('generate_llms_txt — custom guidelines and restrictions', () => {
  test('llms-full.txt lists both', () => {
    const out = new GenerateLLMsTxtTool().generateLLMsFullTxt(analysis(), options, 'standard');
    assert.match(out, /### Site-Specific Guidelines\n- Cite the docs page you used/);
    assert.match(out, /### Additional Restrictions\n- \/playground\n- \/internal/);
    assert.match(out, /\*\*Organization:\*\* Example Org/);
  });

  test('spec-format llms.txt carries the guidelines and names the restricted paths', () => {
    const out = new GenerateLLMsTxtTool().generateSpecLLMsTxt(analysis(), options);
    assert.match(out, /^# Example Org/m);
    assert.match(out, /Cite the docs page you used/);
    assert.match(out, /Do not access: \/playground, \/internal\./);
  });

  test('robots-style llms.txt still emits them as comments and Disallow lines', () => {
    const out = new GenerateLLMsTxtTool().generateRobotsStyleTxt(analysis(), options, 'standard');
    assert.match(out, /# Cite the docs page you used/);
    assert.match(out, /Disallow: \/playground/);
  });

  test('omitting both options adds no empty sections', () => {
    const tool = new GenerateLLMsTxtTool();
    assert.doesNotMatch(tool.generateLLMsFullTxt(analysis(), {}, 'standard'), /Site-Specific Guidelines|Additional Restrictions/);
    assert.doesNotMatch(tool.generateSpecLLMsTxt(analysis(), {}), /Do not access/);
  });
});

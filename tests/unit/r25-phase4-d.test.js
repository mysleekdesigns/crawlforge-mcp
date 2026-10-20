/**
 * R25 Phase 4 (output quality) regressions, part D (2026-10-19).
 * Run: node --test --test-force-exit tests/unit/r25-phase4-d.test.js
 *
 * 4.x  Screenshot resources were always labelled image/png, so a JPEG taken
 *      with format:"jpeg" came back from resources/read as image/png.
 * 4.x  generate_llms_txt complianceLevel changed only the robots-style Disallow
 *      list (and a label in llms-full.txt), while its schema called it the
 *      "Compliance level for generated guidelines".
 * 4.x  llms-full.txt always said "Contact us using the information above",
 *      even when no contactEmail or organizationName was given.
 * 4.x  stealth_mode presented create_context -> create_page as a multi-step
 *      path, but create_page closes its page before the call returns.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ResourceRegistry, sniffImageMime } from '../../src/resources/ResourceRegistry.js';
import { GenerateLLMsTxtTool } from '../../src/tools/llmstxt/generateLLMsTxt.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('screenshot resources report the image type they hold', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

  test('sniffImageMime reads the magic bytes', () => {
    assert.equal(sniffImageMime(JPEG), 'image/jpeg');
    assert.equal(sniffImageMime(PNG), 'image/png');
    assert.equal(sniffImageMime(WEBP), 'image/webp');
    assert.equal(sniffImageMime(Buffer.from('not an image')), 'image/png');
  });

  test('a JPEG screenshot is listed and read as image/jpeg', async () => {
    const registry = new ResourceRegistry();
    registry.storeScreenshot('jpeg-1', JPEG.toString('base64'));
    const listed = registry.listResources().find((r) => r.uri === 'crawlforge://screenshot/jpeg-1');
    assert.equal(listed.mimeType, 'image/jpeg');
    const { contents } = await registry.readResource('crawlforge://screenshot/jpeg-1');
    assert.equal(contents[0].mimeType, 'image/jpeg');
    assert.equal(contents[0].blob, JPEG.toString('base64'));
  });

  test('a PNG screenshot stays image/png', async () => {
    const registry = new ResourceRegistry();
    registry.storeScreenshot('png-1', PNG);
    const { contents } = await registry.readResource('crawlforge://screenshot/png-1');
    assert.equal(contents[0].mimeType, 'image/png');
  });
});

const analysis = () => ({
  metadata: { baseUrl: 'https://example.com', analyzedAt: '2026-10-19T00:00:00.000Z', analysisTimeMs: 1 },
  structure: { totalPages: 1, sitemap: [], sections: {}, navigation: {}, hierarchy: {}, robotsTxt: null },
  apis: [],
  contentTypes: { public: [], restricted: [], dynamic: [], static: [], forms: [], media: [], documents: [] },
  securityAreas: [],
  rateLimit: { recommendedDelay: 1000, maxConcurrency: 5, recommendedRPM: 30, reasoning: 'defaults' },
  guidelines: {},
  errors: []
});
const CONTACT_LINE = /Contact us using the information above/;

describe('llms-full.txt points at contact details only when it has some', () => {
  const tool = new GenerateLLMsTxtTool();

  test('no contactEmail or organizationName: no "contact us" line', () => {
    assert.doesNotMatch(tool.generateLLMsFullTxt(analysis(), {}, 'standard'), CONTACT_LINE);
  });

  test('contactEmail alone prints it', () => {
    assert.match(tool.generateLLMsFullTxt(analysis(), { contactEmail: 'ai@example.com' }, 'standard'), CONTACT_LINE);
  });

  test('organizationName alone prints it', () => {
    assert.match(tool.generateLLMsFullTxt(analysis(), { organizationName: 'Example Org' }, 'standard'), CONTACT_LINE);
  });
});

describe('complianceLevel says it applies only with robotsStyle:true', () => {
  const tool = new GenerateLLMsTxtTool();
  const stamp = (s) => s.replace(/^# Generated on .*$/m, '');

  test('the robots-style Disallow list grows basic < standard < strict', () => {
    const disallows = (level) =>
      (tool.generateLLMsTxt(analysis(), { robotsStyle: true }, level).match(/^Disallow: /gm) || []).length;
    assert.ok(disallows('basic') < disallows('standard'));
    assert.ok(disallows('standard') < disallows('strict'));
  });

  test('the default markdown llms.txt is the same at every level', () => {
    const basic = stamp(tool.generateLLMsTxt(analysis(), {}, 'basic'));
    assert.equal(stamp(tool.generateLLMsTxt(analysis(), {}, 'strict')), basic);
  });

  test('both schema copies describe it that way', () => {
    for (const rel of ['server.js', 'src/tools/llmstxt/generateLLMsTxt.js']) {
      const line = read(rel).split('\n').find((l) => l.trim().startsWith("complianceLevel: z.enum(['basic', 'standard', 'strict'])"));
      assert.match(line, /Applies only with outputOptions\.robotsStyle:true/, rel);
    }
  });
});

describe('stealth_mode create_page is described as a check, not a session', () => {
  test('the tool description points multi-step work to browser_session', () => {
    const server = read('server.js');
    const start = server.indexOf('registerToolIfEnabled("stealth_mode"');
    const block = server.slice(start, server.indexOf('}, withAuth("stealth_mode"', start));
    assert.doesNotMatch(block, /remain for multi-step work|a context to open pages in/);
    assert.match(block, /create_page is a navigation and challenge check/);
    assert.match(block, /closes the page before the call returns/);
    assert.match(block, /use browser_session with stealth:true/);
  });

  test('the stealth skill and docs/SKILL.md say the same', () => {
    for (const rel of ['src/skills/agent-skills/crawlforge-stealth-browsing/SKILL.md', 'docs/SKILL.md']) {
      const text = read(rel);
      assert.doesNotMatch(text, /Typical flow: create a context/, rel);
      assert.match(text, /`create_page` is a navigation and challenge check/, rel);
      assert.match(text, /use `browser_session` with `stealth:true`/, rel);
    }
  });
});

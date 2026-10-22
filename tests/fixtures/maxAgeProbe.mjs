/**
 * Child-process probe for tests/unit/maxAgeParam.test.js. Needs
 * --experimental-test-module-mocks, which the unit runner does not pass, so
 * the test spawns it. Replaces the two page-cache seams (fetchWithTimeout,
 * fetchAndParse) with recorders that throw after recording, calls every
 * maxAge tool once with maxAge: 1234, and prints { tool: seamOptions } as JSON.
 */

import { mock } from 'node:test';

const calls = {};
const record = (options) => {
  calls[options.tool] = options;
  throw new Error('probe: seam reached');
};

const fetchUrl = new URL('../../src/tools/basic/_fetch.js', import.meta.url).href;
const parseUrl = new URL('../../src/tools/extract/_fetchAndParse.js', import.meta.url).href;
const realFetch = await import(fetchUrl);
const realParse = await import(parseUrl);
mock.module(fetchUrl, { namedExports: { ...realFetch, fetchWithTimeout: async (_url, options) => record(options) } });
mock.module(parseUrl, { namedExports: { ...realParse, fetchAndParse: async (_url, options) => record(options) } });

const { fetchUrlHandler } = await import('../../src/tools/basic/fetchUrl.js');
const { extractMetadataHandler } = await import('../../src/tools/basic/extractMetadata.js');
const { scrapeStructuredHandler } = await import('../../src/tools/basic/scrapeStructured.js');
const { extractTextHandler } = await import('../../src/tools/basic/extractText.js');
const { extractLinksHandler } = await import('../../src/tools/basic/extractLinks.js');
const { createExtractEmbeddedStateHandler } = await import('../../src/tools/extract/extractEmbeddedState.js');
const { UnifiedScrapeTool } = await import('../../src/tools/scrape/unifiedScrape.js');
const { ExtractStructuredTool } = await import('../../src/tools/extract/extractStructured.js');
const { ExtractWithLlm } = await import('../../src/tools/extract/extractWithLlm.js');

const url = 'https://example.com/';
const maxAge = 1234;
const runs = [
  () => fetchUrlHandler({ url, maxAge }),
  () => extractMetadataHandler({ url, maxAge }),
  () => scrapeStructuredHandler({ url, selectors: { title: 'h1' }, maxAge }),
  () => extractTextHandler({ url, maxAge }),
  () => extractLinksHandler({ url, maxAge }),
  () => createExtractEmbeddedStateHandler()({ url, maxAge }),
  () => new UnifiedScrapeTool().execute({ url, maxAge }),
  // No LLM (provider "none" is unknown → not ready), so it goes straight to the fetch.
  () => new ExtractStructuredTool().execute({ url, schema: { properties: { title: { type: 'string' } } }, llmConfig: { provider: 'none' }, maxAge }),
  () => new ExtractWithLlm().execute({ url, prompt: 'title', maxAge })
];
for (const run of runs) {
  try { await run(); } catch { /* the recorder throws by design */ }
}

process.stdout.write(JSON.stringify(calls));
process.exit(0);

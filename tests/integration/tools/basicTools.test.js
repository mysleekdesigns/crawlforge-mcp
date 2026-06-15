/**
 * Integration tests for src/tools/basic/* handlers.
 *
 * These tests call the handler functions directly (not through MCP).
 * Network calls are intercepted via global.fetch patching so tests run
 * without real HTTP access.
 *
 * Run: node --test tests/integration/tools/basicTools.test.js
 *
 * Tests cover:
 *   fetchUrlHandler  — happy path, network error, timeout
 *   extractTextHandler — happy path, HTTP error
 *   extractLinksHandler — happy path, filters external, deduplicates
 *   extractMetadataHandler — happy path field extraction
 *   scrapeStructuredHandler — happy path with selectors, empty selector
 *
 * Zod schema validation (invalid input rejected):
 *   - Each tool's handler currently validates inside the function and returns
 *     isError:true for bad input, which we verify.
 */

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchUrlHandler } from '../../../src/tools/basic/fetchUrl.js';
import { extractTextHandler } from '../../../src/tools/basic/extractText.js';
import { extractLinksHandler } from '../../../src/tools/basic/extractLinks.js';
import { extractMetadataHandler } from '../../../src/tools/basic/extractMetadata.js';
import { scrapeStructuredHandler } from '../../../src/tools/basic/scrapeStructured.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const originalFetch = global.fetch;

function mockFetch(body, { status = 200, statusText = 'OK', contentType = 'text/html; charset=utf-8' } = {}) {
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    url: 'https://example.com/mocked',
    headers: {
      get: (key) => {
        const map = { 'content-type': contentType };
        return map[key.toLowerCase()] || null;
      },
      forEach: (cb) => {
        cb(contentType, 'content-type');
      }
    },
    text: async () => body
  });
}

function restoreFetch() {
  global.fetch = originalFetch;
}

// Sample HTML for use across tests
const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
  <meta name="description" content="A test page description"/>
  <meta name="keywords" content="test, page, keywords"/>
  <meta property="og:title" content="OG Title"/>
  <meta name="twitter:card" content="summary"/>
  <link rel="canonical" href="https://example.com/canonical"/>
</head>
<body>
  <h1>Main Heading</h1>
  <p>Some text content here. More words follow.</p>
  <a href="https://external.example.com/link1">External Link</a>
  <a href="/internal/path">Internal Link</a>
  <a href="https://example.com/internal2">Internal Link 2</a>
  <a href="https://external.example.com/link1">Duplicate External</a>
</body>
</html>`;

// ── fetchUrlHandler ───────────────────────────────────────────────────────────

test('fetchUrlHandler: happy path returns status, body, headers', async () => {
  mockFetch('Hello, world!', { contentType: 'text/plain' });
  try {
    const result = await fetchUrlHandler({ url: 'https://example.com/' });
    assert.ok(!result.isError, 'should not be an error');
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.status, 200);
    assert.equal(parsed.body, 'Hello, world!');
    assert.ok(typeof parsed.headers === 'object');
    assert.ok(typeof parsed.size === 'number');
    assert.ok(typeof parsed.url === 'string');
  } finally {
    restoreFetch();
  }
});

test('fetchUrlHandler: network failure returns isError:true', async () => {
  global.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const result = await fetchUrlHandler({ url: 'https://example.com/' });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('Failed to fetch URL'));
  } finally {
    restoreFetch();
  }
});

test('fetchUrlHandler: request timeout returns isError:true', async () => {
  // Patch fetch to simulate an AbortError
  global.fetch = async (url, opts) => {
    // Simulate abort immediately
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    throw err;
  };
  try {
    const result = await fetchUrlHandler({ url: 'https://example.com/', timeout: 1 });
    assert.equal(result.isError, true);
  } finally {
    restoreFetch();
  }
});

test('fetchUrlHandler: custom headers are passed through', async () => {
  let capturedHeaders;
  global.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    return {
      ok: true, status: 200, statusText: 'OK',
      url: 'https://example.com/',
      headers: { get: () => null, forEach: () => {} },
      text: async () => 'ok'
    };
  };
  try {
    await fetchUrlHandler({ url: 'https://example.com/', headers: { 'X-Custom': 'value' } });
    assert.equal(capturedHeaders['X-Custom'], 'value');
  } finally {
    restoreFetch();
  }
});

// ── extractTextHandler ────────────────────────────────────────────────────────

test('extractTextHandler: happy path returns text, word_count, char_count, url', async () => {
  mockFetch(SAMPLE_HTML);
  try {
    const result = await extractTextHandler({ url: 'https://example.com/' });
    assert.ok(!result.isError, 'should not be an error');
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(typeof parsed.text === 'string');
    assert.ok(parsed.text.includes('Main Heading'));
    assert.ok(typeof parsed.word_count === 'number');
    assert.ok(parsed.word_count > 0);
    assert.ok(typeof parsed.char_count === 'number');
    assert.ok(typeof parsed.url === 'string');
  } finally {
    restoreFetch();
  }
});

test('extractTextHandler: HTTP error returns isError:true', async () => {
  mockFetch('Not Found', { status: 404, statusText: 'Not Found' });
  try {
    const result = await extractTextHandler({ url: 'https://example.com/missing' });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('Failed to extract text'));
  } finally {
    restoreFetch();
  }
});

test('extractTextHandler: removes scripts and styles by default', async () => {
  const htmlWithScript = `<html><body><script>var x=1;</script><p>Content</p><style>body{color:red}</style></body></html>`;
  mockFetch(htmlWithScript);
  try {
    const result = await extractTextHandler({ url: 'https://example.com/' });
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(!parsed.text.includes('var x=1'), 'script content should be removed');
    assert.ok(!parsed.text.includes('color:red'), 'style content should be removed');
    assert.ok(parsed.text.includes('Content'));
  } finally {
    restoreFetch();
  }
});

// ── extractLinksHandler ───────────────────────────────────────────────────────

test('extractLinksHandler: happy path returns links with counts', async () => {
  mockFetch(SAMPLE_HTML);
  try {
    const result = await extractLinksHandler({ url: 'https://example.com/' });
    assert.ok(!result.isError);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(parsed.links));
    assert.ok(typeof parsed.total_count === 'number');
    assert.ok(typeof parsed.internal_count === 'number');
    assert.ok(typeof parsed.external_count === 'number');
    assert.ok(parsed.total_count >= 1);
  } finally {
    restoreFetch();
  }
});

test('extractLinksHandler: deduplicates repeated links', async () => {
  mockFetch(SAMPLE_HTML);
  try {
    const result = await extractLinksHandler({ url: 'https://example.com/' });
    const parsed = JSON.parse(result.content[0].text);
    // Duplicate "External Link" href should appear only once
    const hrefs = parsed.links.map(l => l.href);
    const unique = new Set(hrefs);
    assert.equal(hrefs.length, unique.size, 'links should be deduplicated');
  } finally {
    restoreFetch();
  }
});

test('extractLinksHandler: filter_external:true returns only external links', async () => {
  mockFetch(SAMPLE_HTML);
  try {
    const result = await extractLinksHandler({ url: 'https://example.com/', filter_external: true });
    const parsed = JSON.parse(result.content[0].text);
    // Phase A (A1.1): filter_external:true keeps ONLY external links
    assert.ok(parsed.links.length > 0, 'should return external links');
    assert.ok(parsed.links.every(l => l.is_external), 'all links should be external when filter_external is true');
  } finally {
    restoreFetch();
  }
});

test('extractLinksHandler: HTTP error returns isError:true', async () => {
  mockFetch('', { status: 500, statusText: 'Internal Server Error' });
  try {
    const result = await extractLinksHandler({ url: 'https://example.com/' });
    assert.equal(result.isError, true);
  } finally {
    restoreFetch();
  }
});

// ── extractMetadataHandler ────────────────────────────────────────────────────

test('extractMetadataHandler: happy path extracts title, description, keywords, og_tags, twitter_tags', async () => {
  mockFetch(SAMPLE_HTML);
  try {
    const result = await extractMetadataHandler({ url: 'https://example.com/' });
    assert.ok(!result.isError);
    const parsed = JSON.parse(result.content[0].text);
    // B1: title fallback chain is og:title → <title> → h1, so og:title wins here
    assert.equal(parsed.title, 'OG Title');
    assert.equal(parsed.description, 'A test page description');
    assert.ok(Array.isArray(parsed.keywords));
    assert.ok(parsed.keywords.includes('test'));
    assert.ok(typeof parsed.og_tags === 'object');
    assert.equal(parsed.og_tags.title, 'OG Title');
    assert.ok(typeof parsed.twitter_tags === 'object');
    assert.equal(parsed.twitter_tags.card, 'summary');
    assert.equal(parsed.canonical_url, 'https://example.com/canonical');
    assert.ok(typeof parsed.url === 'string');
  } finally {
    restoreFetch();
  }
});

test('extractMetadataHandler: HTTP error returns isError:true', async () => {
  mockFetch('', { status: 403, statusText: 'Forbidden' });
  try {
    const result = await extractMetadataHandler({ url: 'https://example.com/forbidden' });
    assert.equal(result.isError, true);
  } finally {
    restoreFetch();
  }
});

// ── scrapeStructuredHandler ───────────────────────────────────────────────────

test('scrapeStructuredHandler: happy path extracts data using CSS selectors', async () => {
  mockFetch(SAMPLE_HTML);
  try {
    const result = await scrapeStructuredHandler({
      url: 'https://example.com/',
      selectors: { heading: 'h1', paragraph: 'p' }
    });
    assert.ok(!result.isError);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(typeof parsed.data === 'object');
    assert.ok(parsed.data.heading.includes('Main Heading'));
    // B1: elements_found reports per-field DOM match counts (object), not a total
    assert.equal(typeof parsed.elements_found, 'object');
    assert.ok(parsed.elements_found.heading >= 1);
    assert.ok(typeof parsed.url === 'string');
  } finally {
    restoreFetch();
  }
});

test('scrapeStructuredHandler: selector with no matches returns null for that field', async () => {
  mockFetch(SAMPLE_HTML);
  try {
    const result = await scrapeStructuredHandler({
      url: 'https://example.com/',
      selectors: { nonexistent: '.does-not-exist' }
    });
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.data.nonexistent, null);
  } finally {
    restoreFetch();
  }
});

test('scrapeStructuredHandler: multiple elements for same selector returns array', async () => {
  const multiHTML = `<html><body><p>First</p><p>Second</p></body></html>`;
  mockFetch(multiHTML);
  try {
    const result = await scrapeStructuredHandler({
      url: 'https://example.com/',
      selectors: { paragraphs: 'p' }
    });
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(parsed.data.paragraphs), 'multiple matches should return an array');
    assert.equal(parsed.data.paragraphs.length, 2);
  } finally {
    restoreFetch();
  }
});

test('scrapeStructuredHandler: HTTP error returns isError:true', async () => {
  mockFetch('', { status: 404, statusText: 'Not Found' });
  try {
    const result = await scrapeStructuredHandler({
      url: 'https://example.com/missing',
      selectors: { title: 'h1' }
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('Failed to scrape'));
  } finally {
    restoreFetch();
  }
});

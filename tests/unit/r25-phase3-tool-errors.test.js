/**
 * R25 Phase 3.3 — error messages that name the actual problem.
 *
 * Run: node --test --test-force-exit tests/unit/r25-phase3-tool-errors.test.js
 *
 * From the 2026-10-19 all-tools sweep:
 *  - track_changes {operation:'compare'} with no url failed with "Failed to
 *    parse URL from undefined" and a create_baseline hint.
 *  - summarize_content {text:'Tiny text'} returned a raw zod issue array.
 *  - process_document {sourceType:'pdf_url'} on a PNG failed as "Invalid PDF
 *    structure".
 *  - extract_with_llm {model:'nonexistent-model:98b'} was silently answered by
 *    a different model through the sampling fallback.
 *  - search_web over SearXNG returned an empty success when every engine
 *    failed, and a bare "fetch failed" when the instance was down.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const savedLlmEnv = {
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_DEFAULT_MODEL: process.env.OLLAMA_DEFAULT_MODEL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
};
for (const key of Object.keys(savedLlmEnv)) delete process.env[key];

const { TrackChangesTool } = await import('../../src/tools/tracking/trackChanges/index.js');
const { SummarizeContentTool } = await import('../../src/tools/extract/summarizeContent.js');
const { ProcessDocumentTool } = await import('../../src/tools/extract/processDocument.js');
const { ExtractWithLlm } = await import('../../src/tools/extract/extractWithLlm.js');
const { searchViaSearxng } = await import('../../src/tools/search/providers/searxng.js');
const { buildPdf } = await import('../fixtures/pdfBuilder.js');

// PNG signature + IHDR chunk: the start of python-logo.png.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000001f40000009f0806000000', 'hex');

let server;
let baseUrl;
let searxngBody;

before(async () => {
  const pdf = buildPdf({ pages: ['A real PDF under pdf_url.'] });
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('User-agent: *\nAllow: /\n'); return; }
    if (req.url === '/python-logo.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return; }
    if (req.url === '/paper.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); return; }
    if (req.url.startsWith('/search')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(searxngBody)); return; }
    // A stub Ollama with one model pulled: anything else is the 404 Ollama sends.
    if (req.url === '/ollama/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'gemma3:4b' }] }));
      return;
    }
    if (req.url === '/ollama/api/chat' || req.url === '/ollama/api/generate') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { model } = JSON.parse(body);
        if (model !== 'gemma3:4b') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `model "${model}" not found, try pulling it first` }));
          return;
        }
        const content = JSON.stringify({ room: '204' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model, message: { role: 'assistant', content }, response: content, done: true }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.OLLAMA_BASE_URL = `${baseUrl}/ollama`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [key, value] of Object.entries(savedLlmEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('track_changes: url is required where an operation acts on one page', () => {
  const tmp = (label) => path.join(os.tmpdir(), `r25p3-tc-${label}-${Math.random().toString(36).slice(2)}`);
  let tool;
  before(() => {
    tool = new TrackChangesTool({
      snapshotStorageDir: tmp('snap'), monitorStorageDir: tmp('mon'),
      resolveHostedCredentials: async () => { throw new Error('offline: no hosted credentials'); }
    });
  });
  after(async () => { await tool.shutdown().catch(() => {}); });

  test('compare with no url names the missing url, on one line', async () => {
    const r = await tool.execute({ operation: 'compare' });
    assert.equal(r.success, false);
    assert.equal(r.error, 'Invalid input - url: required for operation "compare"');
  });

  test('create_baseline, monitor and get_history need it too', async () => {
    for (const operation of ['create_baseline', 'monitor', 'get_history']) {
      const r = await tool.execute({ operation });
      assert.equal(r.success, false, operation);
      assert.match(r.error, new RegExp(`url: required for operation "${operation}"`));
    }
  });

  test('the global operations still run without one', async () => {
    for (const operation of ['list_scheduled_monitors', 'get_dashboard', 'get_monitoring_templates', 'get_stats', 'export_history']) {
      const r = await tool.execute({ operation });
      assert.equal(r.success, true, `${operation}: ${r.error}`);
    }
  });

  test('any other schema error is one line too, not a JSON issue dump', async () => {
    const r = await tool.execute({ url: 'not a url', operation: 'compare' });
    assert.equal(r.success, false);
    assert.match(r.error, /^Invalid input - url: /);
    assert.doesNotMatch(r.error, /[\n[{]/);
  });
});

describe('summarize_content: validation errors are path: message', () => {
  test('text under 10 characters gives a one-line error', async () => {
    const r = await new SummarizeContentTool().execute({ text: 'Tiny text' });
    assert.equal(r.success, false);
    assert.match(r.error, /^Content summarization failed: Invalid input - text: Too small: expected string to have >=10 characters$/);
  });
});

describe('process_document: pdf_url checks what it got', () => {
  const tool = new ProcessDocumentTool();

  test('a PNG under pdf_url is refused by name, not parsed as a PDF', async () => {
    const r = await tool.execute({ source: `${baseUrl}/python-logo.png`, sourceType: 'pdf_url' });
    assert.equal(r.success, false);
    assert.match(r.error, /image\/png content is not a PDF: sourceType "pdf_url" needs a URL that serves one/);
    assert.doesNotMatch(r.error, /Invalid PDF structure/);
  });

  test('a PDF under pdf_url still reaches the parser', async () => {
    const r = await tool.execute({ source: `${baseUrl}/paper.pdf`, sourceType: 'pdf_url' });
    assert.equal(r.success, true, r.error);
    assert.equal(r.documentType, 'pdf');
    assert.match(r.content.text, /A real PDF under pdf_url/);
  });
});

describe('extract_with_llm: a named model is not swapped for another', () => {
  test('an Ollama model that is not pulled errors instead of falling back to sampling', async () => {
    const r = await new ExtractWithLlm().execute({
      content: 'The meeting is in room 204.', prompt: 'Which room?', model: 'nonexistent-model:98b'
    });
    assert.equal(r.success, false);
    assert.match(r.error, /Ollama model "nonexistent-model:98b" is not pulled/);
    assert.doesNotMatch(r.error, /Sampling fallback/);
  });
});

describe('search_web over SearXNG', () => {
  test('no results because every engine failed is an error naming the engines', async () => {
    searxngBody = { results: [], number_of_results: 0, unresponsive_engines: [['google', 'timeout'], ['brave', 'too many requests']] };
    await assert.rejects(
      () => searchViaSearxng({ query: 'q', instanceUrl: baseUrl }),
      (err) => {
        assert.match(err.message, /engines failed: google \(timeout\), brave \(too many requests\)/);
        assert.match(err.message, /\nNext step: /);
        return true;
      }
    );
  });

  test('no results with every engine answering is still an empty success', async () => {
    searxngBody = { results: [], number_of_results: 0, unresponsive_engines: [] };
    const r = await searchViaSearxng({ query: 'q', instanceUrl: baseUrl });
    assert.deepEqual(r.items, []);
    assert.equal(r.searchInformation.totalResults, null);
  });

  test('total_results is number_of_results, or null when SearXNG reports 0; searchTime is measured', async () => {
    const results = [{ title: 'One', url: 'https://example.com/1', content: 's' }];
    searxngBody = { results, number_of_results: 0, unresponsive_engines: [['google', 'timeout']] };
    let r = await searchViaSearxng({ query: 'q', instanceUrl: baseUrl });
    assert.equal(r.items.length, 1, 'one failed engine among working ones is not an error');
    assert.equal(r.searchInformation.totalResults, null);
    assert.equal(typeof r.searchInformation.searchTime, 'number');

    searxngBody = { results, number_of_results: 1234 };
    r = await searchViaSearxng({ query: 'q', instanceUrl: baseUrl });
    assert.equal(r.searchInformation.totalResults, 1234);
  });

  test('a refused connection names the instance and how to start it', async () => {
    // A port that was free a moment ago: nothing listens on it.
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const deadUrl = `http://127.0.0.1:${probe.address().port}`;
    await new Promise((resolve) => probe.close(resolve));
    await assert.rejects(
      () => searchViaSearxng({ query: 'q', instanceUrl: deadUrl }),
      (err) => {
        assert.equal(err.message.split('\n')[0], `SearXNG is not reachable at ${deadUrl}: ECONNREFUSED.`);
        assert.match(err.message, /docker start searxng/);
        return true;
      }
    );
  });
});

/**
 * Unit tests: Ollama model selection.
 *
 * Run: node --test tests/unit/ollamaModelSelection.test.js
 *
 * Background (2026-08-25): the code default was llama3.2 regardless of what was
 * installed. Benchmarked against three live product pages with independently
 * verified ground truth, llama3.2 invented a compare-at price for a product
 * that has none — on all five runs — while gemma3:4b scored 45/45 and was
 * faster than the 12B and 20B models tested.
 *
 * Hardcoding the winner would break anyone who has not pulled it, so selection
 * reads the installed list and picks the best available.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const savedBaseUrl = process.env.OLLAMA_BASE_URL;
const savedDefaultModel = process.env.OLLAMA_DEFAULT_MODEL;
delete process.env.OLLAMA_DEFAULT_MODEL;

const { selectOllamaModel, FALLBACK_OLLAMA_MODEL } = await import('../../src/utils/ollamaConfig.js');

let server;
/** Model names the stub reports as installed. */
let installed = [];
let tagsRequests = 0;

before(async () => {
  server = http.createServer((req, res) => {
    // Tests vary the path prefix to get a fresh cache entry per case.
    if (req.url.endsWith('/api/tags')) {
      tagsRequests++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: installed.map((name) => ({ name })) }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (savedBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = savedBaseUrl;
  if (savedDefaultModel === undefined) delete process.env.OLLAMA_DEFAULT_MODEL;
  else process.env.OLLAMA_DEFAULT_MODEL = savedDefaultModel;
});

beforeEach(() => {
  tagsRequests = 0;
  delete process.env.OLLAMA_DEFAULT_MODEL;
  // A distinct path per test defeats the per-base-URL cache.
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

/** Point at a unique URL so each case gets a fresh installed-model probe. */
function freshEndpoint(tag) {
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${server.address().port}/${tag}`;
}

describe('selectOllamaModel', () => {
  test('prefers the benchmark winner when it is installed', async () => {
    installed = ['llama3.2:latest', 'gemma3:4b', 'qwen2.5:3b'];
    freshEndpoint('winner');
    assert.equal(await selectOllamaModel(), 'gemma3:4b');
  });

  test('falls to the next ranked model when the winner is absent', async () => {
    installed = ['llama3.2:latest', 'mistral:7b', 'qwen2.5:3b'];
    freshEndpoint('second');
    assert.equal(await selectOllamaModel(), 'mistral:7b', 'mistral outranks llama3.2 and qwen2.5');
  });

  test('a :latest tag still matches an untagged preference', async () => {
    installed = ['llama3.2:latest'];
    freshEndpoint('latest-tag');
    assert.equal(await selectOllamaModel(), 'llama3.2:latest');
  });

  test('an unranked model is used rather than failing', async () => {
    installed = ['some-private-finetune:v3'];
    freshEndpoint('unranked');
    assert.equal(await selectOllamaModel(), 'some-private-finetune:v3');
  });

  test('OLLAMA_DEFAULT_MODEL overrides the ranking and skips the probe', async () => {
    installed = ['gemma3:4b'];
    freshEndpoint('override');
    process.env.OLLAMA_DEFAULT_MODEL = 'mistral:7b';
    assert.equal(await selectOllamaModel(), 'mistral:7b');
    assert.equal(tagsRequests, 0, 'an explicit choice needs no discovery call');
  });

  test('an unreachable Ollama yields a real model name, not undefined', async () => {
    // Port 1 is reserved and refuses immediately.
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
    assert.equal(await selectOllamaModel(), FALLBACK_OLLAMA_MODEL);
  });

  test('the installed list is probed once per endpoint, then cached', async () => {
    installed = ['gemma3:4b'];
    freshEndpoint('cached');
    await selectOllamaModel();
    await selectOllamaModel();
    await selectOllamaModel();
    assert.equal(tagsRequests, 1, 'selection must not re-list models on every extraction');
  });
});

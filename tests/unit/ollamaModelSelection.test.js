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

const { selectOllamaModel, isJudgementModel, FALLBACK_OLLAMA_MODEL } = await import('../../src/utils/ollamaConfig.js');
const { OllamaProvider } = await import('../../src/core/llm/OllamaProvider.js');
const { LLMManager } = await import('../../src/core/llm/LLMManager.js');

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
    // A completion that answers with the model it was asked to run, so a test
    // can see which model a role resolved to.
    if (req.url.endsWith('/api/chat')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: { role: 'assistant', content: JSON.parse(body).model }, done: true }));
      });
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

describe('the judgement role', () => {
  // deep_research's claim judgements (relevance, grouping, contradiction) have
  // a different measured winner from extraction — see JUDGEMENT_MODELS.
  test('prefers a measured judgement model when it is installed, without changing extraction', async () => {
    installed = ['gemma3:4b', 'gemma3:12b', 'llama3.2:latest'];
    freshEndpoint('judge-installed');
    assert.equal(await selectOllamaModel(), 'gemma3:4b', 'extraction keeps its own winner');
    assert.equal(await selectOllamaModel('judgement'), 'gemma3:12b');
  });

  test('falls through to the extraction ranking when no judgement model is installed', async () => {
    installed = ['gemma3:4b', 'llama3.2:latest'];
    freshEndpoint('judge-absent');
    assert.equal(await selectOllamaModel('judgement'), 'gemma3:4b');
  });

  test('an explicit OLLAMA_DEFAULT_MODEL applies to every role', async () => {
    installed = ['gemma3:12b'];
    freshEndpoint('judge-pinned');
    process.env.OLLAMA_DEFAULT_MODEL = 'gemma3:4b';
    assert.equal(await selectOllamaModel('judgement'), 'gemma3:4b');
  });

  test('isJudgementModel matches the measured list, tagged or not', () => {
    assert.equal(isJudgementModel('gemma3:12b'), true);
    assert.equal(isJudgementModel('gemma3:12b:latest'), true);
    assert.equal(isJudgementModel('gemma3:4b'), false);
    assert.equal(isJudgementModel(undefined), false);
  });

  test('OllamaProvider resolves each role once and sends the right model', async () => {
    installed = ['gemma3:4b', 'gemma3:12b'];
    freshEndpoint('provider-roles');
    const provider = new OllamaProvider();
    assert.equal(await provider.generateCompletion('x'), 'gemma3:4b');
    assert.equal(await provider.generateCompletion('x', { role: 'judgement' }), 'gemma3:12b');
    assert.equal(await provider.generateCompletion('x', { role: 'judgement' }), 'gemma3:12b');
    assert.equal(tagsRequests, 1, 'both roles share one discovery call');
  });

  test('a provider constructed with an explicit model uses it for every role', async () => {
    installed = ['gemma3:12b'];
    freshEndpoint('provider-pinned');
    const provider = new OllamaProvider({ model: 'mistral:7b' });
    assert.equal(await provider.generateCompletion('x', { role: 'judgement' }), 'mistral:7b');
  });

  test('the conflict gate opens only when a measured judge is installed', async () => {
    installed = ['gemma3:4b', 'gemma3:12b'];
    freshEndpoint('gate-open');
    assert.equal(await new LLMManager({ defaultProvider: 'ollama' }).canJudgeContradictions(), true);

    installed = ['gemma3:4b', 'llama3.2:latest'];
    freshEndpoint('gate-closed');
    assert.equal(await new LLMManager({ defaultProvider: 'ollama' }).canJudgeContradictions(), false);
  });

  test('pinning the extraction winner keeps the conflict gate closed rather than routing around the measurement', async () => {
    installed = ['gemma3:12b'];
    freshEndpoint('gate-pinned');
    process.env.OLLAMA_DEFAULT_MODEL = 'gemma3:4b';
    assert.equal(await new LLMManager({ defaultProvider: 'ollama' }).canJudgeContradictions(), false);
  });

  test('an unreachable Ollama keeps the conflict gate closed', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
    assert.equal(await new LLMManager({ defaultProvider: 'ollama' }).canJudgeContradictions(), false);
  });
});

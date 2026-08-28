/**
 * Unit tests: LLMManager.scoreClaimRelevance / groupClaimsBySimilarity.
 *
 * Run: node --test tests/unit/llmSemanticClaims.test.js
 *
 * These two methods back deep_research's claim gate and its consensus
 * grouping. Both replaced lexical heuristics that were built and reverted:
 * sentence-shape scoring could not tell a statement about a subject from a
 * pitch for a product built around it, and a keyword key split paraphrases so
 * hard that 27 real claims produced 27 groups. What is locked here is not the
 * model's judgement — that cannot be unit tested — but the two contracts the
 * callers depend on and will not re-check: one score per claim in order, and a
 * true partition of every claim index.
 *
 * A stub Ollama server stands in for the real one, so the tests neither
 * require nor accidentally use a locally-installed Ollama, and so a test can
 * count how many completions a call actually made.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const savedEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_DEFAULT_MODEL: process.env.OLLAMA_DEFAULT_MODEL,
  DISABLE_OLLAMA: process.env.DISABLE_OLLAMA
};
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISABLE_OLLAMA;
// Pin the model so model selection never reaches for /api/tags mid-test.
process.env.OLLAMA_DEFAULT_MODEL = 'stub-model';

const { LLMManager } = await import('../../src/core/llm/LLMManager.js');

let server;
/** Canned reply for /api/chat. */
let chatContent = '{"scores":[]}';
/** Optional per-call reply, for tests that need one batch to differ. */
let chatResponder = null;
/** Completions requested since the last test started. */
let chatCalls = 0;
/** Every prompt body seen, so a test can assert on what was sent. */
let chatBodies = [];

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'stub-model:latest' }] }));
      return;
    }
    if (req.url === '/api/chat') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        chatCalls++;
        chatBodies.push(JSON.parse(body));
        const content = chatResponder ? chatResponder() : chatContent;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'stub-model', message: { role: 'assistant', content } }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  chatCalls = 0;
  chatBodies = [];
  chatResponder = null;
});

/** A manager talking to the stub server. */
async function stubbedManager() {
  const manager = new LLMManager({});
  await manager.ready();
  return manager;
}

/** A manager with no provider at all, standing in for an unavailable LLM. */
function providerlessManager() {
  return new LLMManager({ ollama: { enabled: false } });
}

const TOPIC = 'how automated browser detection works';

describe('LLMManager.scoreClaimRelevance', () => {
  /** An index-keyed reply, the shape the method asks the model for. */
  const scoreReply = entries => JSON.stringify({ scores: entries.map(([i, score]) => ({ i, score })) });

  test('maps each score onto its own claim, in input order', async () => {
    chatContent = scoreReply([[0, 0.9], [1, 0.1], [2, 0.55]]);
    const manager = await stubbedManager();

    const scores = await manager.scoreClaimRelevance(
      ['TLS fingerprinting identifies the client stack.', 'Plans start at $49 a month.', 'Headless flags are checked.'],
      TOPIC
    );

    assert.deepEqual(scores, [0.9, 0.1, 0.55]);
  });

  test('honours the index rather than the position it arrived in', async () => {
    chatContent = scoreReply([[2, 0.3], [0, 0.9], [1, 0.6]]);
    const manager = await stubbedManager();

    assert.deepEqual(await manager.scoreClaimRelevance(['a', 'b', 'c'], TOPIC), [0.9, 0.6, 0.3]);
  });

  test('clamps scores outside [0,1] rather than passing them through', async () => {
    chatContent = scoreReply([[0, 1.7], [1, -0.4], [2, '0.5']]);
    const manager = await stubbedManager();

    assert.deepEqual(await manager.scoreClaimRelevance(['a', 'b', 'c'], TOPIC), [1, 0, 0.5]);
  });

  test('more scores than claims: the extras are dropped, the batch still counts', async () => {
    // The live defect: 35 claims in, 39 scores back, both attempts rejected,
    // the gate went inert and vendor text reached the summary.
    chatContent = scoreReply([[0, 0.8], [1, 0.2], [2, 0.7], [3, 0.4], [4, 0.1]]);
    const manager = await stubbedManager();

    const scores = await manager.scoreClaimRelevance(['a', 'b'], TOPIC);

    assert.deepEqual(scores, [0.8, 0.2], 'a miscount costs the extra entries, never the run');
  });

  test('fewer scores than claims: the unscored claims come back null, not missing', async () => {
    chatContent = scoreReply([[0, 0.8], [3, 0.2]]);
    const manager = await stubbedManager();

    const scores = await manager.scoreClaimRelevance(['a', 'b', 'c', 'd'], TOPIC);

    assert.deepEqual(scores, [0.8, null, null, 0.2]);
    assert.equal(scores.length, 4, 'the array is always exactly claims.length long');
  });

  test('a duplicated index keeps the first score', async () => {
    chatContent = scoreReply([[0, 0.9], [0, 0.1], [1, 0.4]]);
    const manager = await stubbedManager();

    assert.deepEqual(await manager.scoreClaimRelevance(['a', 'b'], TOPIC), [0.9, 0.4]);
  });

  test('out-of-range and non-integer indices are dropped, never realigned', async () => {
    // Number(null) is 0 and Number(true) is 1 — coercing either would land a
    // score on a claim it does not belong to.
    chatContent = JSON.stringify({
      scores: [
        { i: 99, score: 0.9 }, { i: -1, score: 0.9 }, { i: 1.5, score: 0.9 },
        { i: null, score: 0.9 }, { i: true, score: 0.9 }, { i: '1', score: 0.9 },
        { i: 0, score: 0.7 }
      ]
    });
    const manager = await stubbedManager();

    assert.deepEqual(await manager.scoreClaimRelevance(['a', 'b'], TOPIC), [0.7, null]);
  });

  test('an unusable score is skipped while its neighbours survive', async () => {
    for (const bad of ['"high"', 'null', 'false', '""']) {
      chatContent = `{"scores":[{"i":0,"score":0.9},{"i":1,"score":${bad}}]}`;
      const manager = await stubbedManager();

      assert.deepEqual(
        await manager.scoreClaimRelevance(['a', 'b'], TOPIC),
        [0.9, null],
        `a score of ${bad} must cost its own claim, not the batch`
      );
    }
  });

  test('a partial result is never downgraded to []', async () => {
    chatContent = scoreReply([[0, 0.8]]);
    const manager = await stubbedManager();

    const scores = await manager.scoreClaimRelevance(['a', 'b', 'c'], TOPIC);

    assert.notDeepEqual(scores, [], 'one score is worth more to the caller than none');
    assert.deepEqual(scores, [0.8, null, null]);
  });

  test('batches rather than calling once per claim', async () => {
    const claims = Array.from({ length: 24 }, (_, i) => `Claim number ${i} about detection.`);
    chatContent = scoreReply(Array.from({ length: 12 }, (_, i) => [i, 0.5]));
    const manager = await stubbedManager();

    const scores = await manager.scoreClaimRelevance(claims, TOPIC);

    assert.equal(scores.length, 24);
    assert.ok(scores.every(score => score === 0.5));
    assert.equal(chatCalls, 2, '24 claims at the default batch of 12 is two calls, not 24');
  });

  test('one failed batch costs its own claims, not the whole run', async () => {
    const claims = Array.from({ length: 24 }, (_, i) => `Claim ${i}.`);
    // First batch answers, second is unparseable on both attempts.
    let call = 0;
    chatResponder = () => (++call === 1 ? scoreReply(Array.from({ length: 12 }, (_, i) => [i, 0.6])) : 'no idea');
    const manager = await stubbedManager();

    const scores = await manager.scoreClaimRelevance(claims, TOPIC);

    assert.equal(scores.length, 24);
    assert.ok(scores.slice(0, 12).every(score => score === 0.6));
    assert.ok(scores.slice(12).every(score => score === null), 'the failed batch is null, not absent');
  });

  test('an empty claim list short-circuits without reaching the LLM', async () => {
    const manager = await stubbedManager();

    assert.deepEqual(await manager.scoreClaimRelevance([], TOPIC), []);
    assert.equal(chatCalls, 0);
  });

  test('returns [] when no LLM is available, rather than throwing', async () => {
    const manager = providerlessManager();

    const scores = await manager.scoreClaimRelevance(['a', 'b'], TOPIC);

    assert.deepEqual(scores, [], 'the caller skips the gate rather than filtering on nothing');
  });

  test('returns [] when the reply cannot be parsed', async () => {
    chatContent = 'Sure! Here is how relevant each sentence is.';
    const manager = await stubbedManager();

    assert.deepEqual(await manager.scoreClaimRelevance(['a', 'b'], TOPIC), []);
  });

  test('returns [] when the reply carries no scores array', async () => {
    chatContent = '{"relevance":[0.9,0.1]}';
    const manager = await stubbedManager();

    assert.deepEqual(await manager.scoreClaimRelevance(['a', 'b'], TOPIC), []);
  });

  test('returns [] when nothing in the reply is usable', async () => {
    chatContent = '{"scores":[{"i":99,"score":0.9},{"i":0,"score":"high"}]}';
    const manager = await stubbedManager();

    assert.deepEqual(await manager.scoreClaimRelevance(['a', 'b'], TOPIC), []);
  });

  test('caps per-claim text so one long claim cannot blow the prompt', async () => {
    chatContent = scoreReply([[0, 0.5]]);
    const manager = await stubbedManager();

    await manager.scoreClaimRelevance(['x'.repeat(5000)], TOPIC, { maxClaimLength: 100 });

    const prompt = chatBodies[0].messages.at(-1).content;
    assert.ok(!prompt.includes('x'.repeat(200)), 'the claim must be truncated before it reaches the prompt');
  });

  test('the result is always either empty or exactly claims.length long', async () => {
    // The invariant the caller indexes against. Swept over every reply shape
    // the model has produced or plausibly could.
    const replies = [
      scoreReply([[0, 0.5], [1, 0.5], [2, 0.5]]),
      scoreReply([[0, 0.5]]),
      scoreReply([[0, 0.5], [1, 0.5], [2, 0.5], [3, 0.5], [4, 0.5], [5, 0.5]]),
      scoreReply([[2, 0.5], [2, 0.5], [99, 0.5]]),
      '{"scores":[]}',
      '{"scores":[0.5,0.5,0.5]}',
      '{"scores":"nope"}',
      '{"nope":true}',
      'not json at all',
      '```json\n{"scores":[{"i":0,"score":0.5}]}\n```'
    ];
    const claims = ['a', 'b', 'c'];

    for (const reply of replies) {
      chatContent = reply;
      const manager = await stubbedManager();
      const scores = await manager.scoreClaimRelevance(claims, TOPIC);

      assert.ok(
        scores.length === 0 || scores.length === claims.length,
        `reply ${reply.slice(0, 40)} produced length ${scores.length}`
      );
      assert.ok(
        scores.every(score => score === null || (typeof score === 'number' && score >= 0 && score <= 1)),
        'every entry is a clamped number or null'
      );
    }
  });
});

describe('LLMManager.groupClaimsBySimilarity', () => {
  const CLAIMS = [
    'Edge networks use TLS fingerprinting to detect automated browsers.',
    'Automated browsers are detected by edge networks through TLS fingerprinting.',
    'Mouse movement entropy is scored separately from network signals.'
  ];

  /** Every index exactly once — the guarantee the caller does not re-check. */
  function assertPartition(groups, count) {
    const flat = groups.flat();
    assert.deepEqual(
      [...flat].sort((a, b) => a - b),
      Array.from({ length: count }, (_, i) => i),
      'groups must be a partition of every claim index'
    );
    assert.equal(new Set(flat).size, flat.length, 'no index may appear twice');
  }

  test('a paraphrase pair stays in one group', async () => {
    chatContent = '{"groups":[[0,1],[2]]}';
    const manager = await stubbedManager();

    const groups = await manager.groupClaimsBySimilarity(CLAIMS, TOPIC);

    assert.deepEqual(groups, [[0, 1], [2]]);
    assertPartition(groups, 3);
    assert.equal(chatCalls, 1);
  });

  test('an index the model omits comes back as its own singleton group', async () => {
    chatContent = '{"groups":[[0,1]]}';
    const manager = await stubbedManager();

    const groups = await manager.groupClaimsBySimilarity(CLAIMS, TOPIC);

    assert.deepEqual(groups, [[0, 1], [2]]);
    assertPartition(groups, 3);
  });

  test('a duplicated index is kept only on its first occurrence', async () => {
    chatContent = '{"groups":[[0,1],[1,2]]}';
    const manager = await stubbedManager();

    const groups = await manager.groupClaimsBySimilarity(CLAIMS, TOPIC);

    assert.deepEqual(groups, [[0, 1], [2]], 'a repeated claim would double-count its own support');
    assertPartition(groups, 3);
  });

  test('out-of-range indices are dropped and the claims they displaced are restored', async () => {
    // A model that renumbers from 1 produces exactly this.
    chatContent = '{"groups":[[1,2],[3],[99],[-1]]}';
    const manager = await stubbedManager();

    const groups = await manager.groupClaimsBySimilarity(CLAIMS, TOPIC);

    assert.deepEqual(groups, [[1, 2], [0]]);
    assertPartition(groups, 3);
  });

  test('claims past the prompt cap are appended as singletons in the same single call', async () => {
    const claims = Array.from({ length: 8 }, (_, i) => `Claim ${i}.`);
    chatContent = '{"groups":[[0,1],[2]]}';
    const manager = await stubbedManager();

    const groups = await manager.groupClaimsBySimilarity(claims, TOPIC, { maxClaims: 3 });

    assert.deepEqual(groups, [[0, 1], [2], [3], [4], [5], [6], [7]]);
    assertPartition(groups, 8);
    assert.equal(chatCalls, 1, 'chunking would split a paraphrase pair across calls and never find it');
  });

  test('fewer than two claims short-circuits without reaching the LLM', async () => {
    const manager = await stubbedManager();

    assert.deepEqual(await manager.groupClaimsBySimilarity([], TOPIC), []);
    assert.deepEqual(await manager.groupClaimsBySimilarity(['only one'], TOPIC), []);
    assert.equal(chatCalls, 0);
  });

  test('returns [] when no LLM is available, rather than throwing', async () => {
    const manager = providerlessManager();

    const groups = await manager.groupClaimsBySimilarity(CLAIMS, TOPIC);

    assert.deepEqual(groups, [], 'the caller falls back to keyword grouping');
  });

  test('returns [] when the reply cannot be parsed', async () => {
    chatContent = 'I grouped the first two together.';
    const manager = await stubbedManager();

    assert.deepEqual(await manager.groupClaimsBySimilarity(CLAIMS, TOPIC), []);
  });

  test('returns [] when the reply carries no groups at all', async () => {
    chatContent = '{"groups":[]}';
    const manager = await stubbedManager();

    assert.deepEqual(await manager.groupClaimsBySimilarity(CLAIMS, TOPIC), []);
  });

  test('a null or boolean index is dropped rather than coerced onto claim 0', async () => {
    // Number(null) is 0 and Number(true) is 1, so coercion would attach those
    // claims to a group the model never put them in.
    chatContent = '{"groups":[[null,true],[2]]}';
    const manager = await stubbedManager();

    const groups = await manager.groupClaimsBySimilarity(CLAIMS, TOPIC);

    assert.deepEqual(groups, [[2], [0], [1]]);
    assertPartition(groups, 3);
  });
});

describe('LLMManager.findContradictions', () => {
  const PAIRS = [
    {
      a: 'Modern anti-bot systems do not just block IP addresses – they fingerprint the TLS handshake.',
      b: 'These systems maintain databases of known bot signatures and block matching fingerprints on sight.'
    },
    {
      a: 'Header-order checks run before any JavaScript challenge is issued.',
      b: 'Header-order checks run only after a JavaScript challenge has been passed.'
    },
    {
      a: 'Table of contents: how detection works, what it costs, how to respond.',
      b: 'Detection costs rise sharply once a challenge is issued on every request.'
    }
  ];

  /**
   * Answer each pass by the key it asks for. findContradictions asks twice —
   * once for the pairs that contradict, then once for the pairs that are
   * consistent, vetoing anything named by both. That second pass is the
   * control for the model's "yes" bias, so a stub has to distinguish them.
   */
  const twoPass = ({ contradictions = [], consistent = [] }) => () => {
    const asked = chatBodies.at(-1)?.format?.required?.[0];
    return asked === 'consistent'
      ? JSON.stringify({ consistent })
      : JSON.stringify({ contradictions });
  };

  test('returns the indices the model flagged, and only those', async () => {
    chatResponder = twoPass({ contradictions: [1], consistent: [] });
    const manager = await stubbedManager();

    const found = await manager.findContradictions(PAIRS, TOPIC);

    assert.deepEqual(found, [1], 'only the before/after pair asserts the same thing with opposite polarity');
    assert.equal(chatCalls, 2, 'one contradiction pass, then one consistency pass to veto against');
  });

  test('a pair the model calls contradictory AND consistent is dropped', async () => {
    // The measured failure this guards: asked one way the model named 13-29
    // agreeing pairs as contradictions. A pair it names in both directions is
    // one it is not actually discriminating, so it must not be reported.
    chatResponder = twoPass({ contradictions: [0, 1], consistent: [1] });
    const manager = await stubbedManager();

    assert.deepEqual(await manager.findContradictions(PAIRS, TOPIC), [0]);
  });

  test('a failed consistency pass cannot manufacture a conflict', async () => {
    let call = 0;
    chatResponder = () => (++call === 1 ? '{"contradictions":[1]}' : 'not json at all');
    const manager = await stubbedManager();

    assert.deepEqual(
      await manager.findContradictions(PAIRS, TOPIC),
      [1],
      'a veto pass that cannot be read vetoes nothing; it never adds'
    );
  });

  test('an empty contradiction list is a real answer, not a failure to retry', async () => {
    chatContent = '{"contradictions":[]}';
    const manager = await stubbedManager();

    assert.deepEqual(await manager.findContradictions(PAIRS, TOPIC), []);
    assert.equal(chatCalls, 1, 'reporting nothing is the expected answer and must not burn the retry');
  });

  test('pairs are judged in small batches, not one long list', async () => {
    // Measured 2026-08-28: judging a live run's ~30 pairs in a single call
    // returned 29 false contradictions. Batch size is load-bearing, so it is
    // pinned here rather than left to drift back.
    const pairs = Array.from({ length: 24 }, (_, i) => ({ a: `Claim A${i}.`, b: `Claim B${i}.` }));
    chatResponder = twoPass({ contradictions: [3], consistent: [] });
    const manager = await stubbedManager();

    const found = await manager.findContradictions(pairs, TOPIC, { batchSize: 8 });

    // The stub names local index 3 in every batch, so the result also pins
    // that each batch's indices are mapped back by its offset — a batch-local
    // 3 in the second batch is pair 11, not pair 3.
    assert.deepEqual(found, [3, 11, 19], 'batch-local indices are offset back to input positions');
    assert.equal(chatCalls, 6, '24 pairs in batches of 8 is 3 calls per pass, over two passes');
    for (const body of chatBodies) {
      const prompt = body.messages.at(-1).content;
      const pairsInPrompt = (prompt.match(/\nA: /g) || []).length;
      assert.ok(pairsInPrompt <= 8, `no batch may carry more than 8 pairs, saw ${pairsInPrompt}`);
    }
  });

  test('out-of-range, duplicate and non-integer indices are dropped', async () => {
    // Number(null) is 0 and Number(true) is 1 — coercing either would report a
    // contradiction the model never named.
    chatContent = '{"contradictions":[2,0,2,99,-1,1.5,"1",null,true]}';
    const manager = await stubbedManager();

    const found = await manager.findContradictions(PAIRS, TOPIC);

    assert.deepEqual(found, [0, 2], 'ascending, deduplicated, in range, integers only');
  });

  test('an empty pair list short-circuits without reaching the LLM', async () => {
    const manager = await stubbedManager();

    assert.deepEqual(await manager.findContradictions([], TOPIC), []);
    assert.equal(chatCalls, 0);
  });

  test('returns [] when no LLM is available, rather than throwing', async () => {
    const manager = providerlessManager();

    assert.deepEqual(await manager.findContradictions(PAIRS, TOPIC), [], 'the caller fails closed');
  });

  test('returns [] when the reply cannot be parsed', async () => {
    chatContent = 'Pair 2 looks contradictory to me.';
    const manager = await stubbedManager();

    assert.deepEqual(await manager.findContradictions(PAIRS, TOPIC), []);
  });

  test('pairs past the cap are left unexamined', async () => {
    const pairs = Array.from({ length: 6 }, (_, i) => ({ a: `A${i}`, b: `B${i}` }));
    chatResponder = twoPass({ contradictions: [1, 4], consistent: [] });
    const manager = await stubbedManager();

    const found = await manager.findContradictions(pairs, TOPIC, { maxPairs: 3 });

    assert.deepEqual(found, [1], 'index 4 is outside the examined batch and is not reported');
    assert.equal(chatCalls, 2, 'one call per pass; the cap does not add round trips');
  });

  test('caps per-claim text so one long claim cannot blow the prompt', async () => {
    chatContent = '{"contradictions":[]}';
    const manager = await stubbedManager();

    await manager.findContradictions([{ a: 'x'.repeat(5000), b: 'short' }], TOPIC, { maxClaimLength: 100 });

    const prompt = chatBodies[0].messages.at(-1).content;
    assert.ok(!prompt.includes('x'.repeat(200)), 'the claim must be truncated before it reaches the prompt');
  });
});

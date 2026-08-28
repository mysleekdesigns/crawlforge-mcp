/**
 * Regression tests: deep_research semantic claim grouping, per-claim topical
 * relevance, and conflict detection.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test tests/unit/researchSemanticGrouping.test.js
 *
 * Defects (measured 2026-08-28):
 * 1. groupRelatedClaims keyed a group on the claim's own first-three-sorted
 *    keywords, so paraphrases split. On 27 real claims from a live run: 27
 *    claims -> 27 groups, none with more than one claim, none cross-source.
 *    Consensus needs sourceCount >= 2 and conflict detection needs two claims
 *    in a group, so both were structurally unreachable and reported 0.
 * 2. detectInformationConflicts tested contradiction with unanchored
 *    String.includes over pairs like ['not','is'], so "another" contained
 *    "not" and "this"/"analysis" contained "is". On four ordinary,
 *    non-contradictory claims about anti-bot systems, 3 of the 6 pairs were
 *    reported as contradictions — invisible only because no group ever held
 *    two claims.
 * 3. Claims carried no per-claim topical relevance, only the score of the
 *    source page, so a vendor's description of its own product on an otherwise
 *    on-topic page reached aiSummary as a recommendation.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ResearchOrchestrator } from '../../src/core/ResearchOrchestrator.js';

// The paraphrase pair from the plan. Their keyword keys are
// "cloudflare_fingerprinting_uses" and "automated_browsers_detected", which is
// why the lexical key splits them.
const PARAPHRASE_A = 'Cloudflare uses TLS fingerprinting to detect automated browsers';
const PARAPHRASE_B = 'Automated browsers are detected by Cloudflare through TLS fingerprinting';

const TOPIC = 'anti-bot systems';

function orchestrator() {
  return new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
}

function claim(text, url, credibility = 0.7) {
  return { claim: text, source: url, credibility };
}

const PARAPHRASE_CLAIMS = [
  claim(PARAPHRASE_A, 'https://one.example/a', 0.8),
  claim(PARAPHRASE_B, 'https://two.example/b', 0.6)
];

// An orchestrator whose LLM answers exactly what the test dictates. `judge`
// is whether a measured judgement model is available — the conflict gate —
// and is stubbed so no test's outcome depends on what Ollama the developer
// happens to have installed.
function withLLM(ro, { partition, scores, contradictions, judge = false } = {}) {
  ro.enableLLMFeatures = true;
  ro.llmManager.groupClaimsBySimilarity = async () => partition ?? [];
  ro.llmManager.scoreClaimRelevance = async () => scores ?? [];
  ro.llmManager.findContradictions = async () => contradictions ?? [];
  ro.llmManager.canJudgeContradictions = async () => judge;
  return ro;
}

// Sources shaped as extractKeyClaims receives them, with a summarize stub that
// returns keypoints keyed by each source's extracted content.
function withKeypoints(ro, keypointsByContent) {
  ro.summarizeTool = {
    execute: async ({ text }) => ({ keypoints: keypointsByContent[text] || [] })
  };
  return ro;
}

function source(overrides = {}) {
  return {
    link: 'https://example.com/a',
    title: 'A',
    extractedContent: 'content-a',
    overallCredibility: 0.7,
    ...overrides
  };
}

describe('4.5 semantic claim grouping', () => {
  test('paraphrases of the same claim land in one group', async () => {
    const ro = withLLM(orchestrator(), { partition: [[0, 1]] });

    const groups = await ro.groupRelatedClaims(PARAPHRASE_CLAIMS, TOPIC);

    assert.equal(groups.length, 1, 'the paraphrase pair is one group');
    assert.equal(groups[0].claims.length, 2);
    assert.equal(groups[0].sourceCount, 2, 'consensus needs sourceCount >= 2');
  });

  test('grouping them makes consensus and conflict detection reachable', async () => {
    // The point of the fix: with one claim per group both were unreachable by
    // construction, whatever 4.1-4.3 did to the claim population.
    const ro = withLLM(orchestrator(), { partition: [[0, 1]] });

    const groups = await ro.groupRelatedClaims(PARAPHRASE_CLAIMS, TOPIC);
    const consensus = ro.identifyConsensus(groups);

    assert.equal(consensus.length, 1, 'a corroborated group is a consensus area');
    assert.equal(consensus[0].supportingSources, 2);
    assert.ok(groups.some(g => g.claims.length >= 2), 'a pair is available to compare');
  });

  test('the semantic path still populates id and keywords', async () => {
    const ro = withLLM(orchestrator(), { partition: [[0, 1]] });

    const [group] = await ro.groupRelatedClaims(PARAPHRASE_CLAIMS, TOPIC);

    assert.ok(typeof group.id === 'string' && group.id.length > 0, 'id is set');
    assert.ok(Array.isArray(group.keywords) && group.keywords.length > 0, 'keywords are set');
    // claimGroupLabel and identifyResearchGaps read a group built this way.
    assert.equal(ro.claimGroupLabel(group), PARAPHRASE_A, 'label is the most credible claim');
    assert.equal(ro.identifyResearchGaps([group], TOPIC).length, 0, 'a corroborated group is not a gap');
  });

  test('an empty partition falls back to the keyword key', async () => {
    const ro = withLLM(orchestrator(), { partition: [] });

    const groups = await ro.groupRelatedClaims(PARAPHRASE_CLAIMS, TOPIC);

    assert.equal(groups.length, 2, 'the lexical key splits the paraphrases');
    assert.deepEqual(groups.map(g => g.id).sort(), [
      'automated_browsers_detected',
      'cloudflare_fingerprinting_uses'
    ]);
  });

  test('LLM features off uses the keyword key without calling the LLM', async () => {
    const ro = orchestrator();
    ro.enableLLMFeatures = false;
    ro.llmManager.groupClaimsBySimilarity = async () => {
      throw new Error('must not be called');
    };

    const groups = await ro.groupRelatedClaims(PARAPHRASE_CLAIMS, TOPIC);

    assert.equal(groups.length, 2);
  });

  test('a partition that loses a claim falls back instead of dropping evidence', async () => {
    const ro = withLLM(orchestrator(), { partition: [[0]] });

    const groups = await ro.groupRelatedClaims(PARAPHRASE_CLAIMS, TOPIC);

    assert.equal(groups.flatMap(g => g.claims).length, 2, 'both claims survive');
    assert.equal(groups.length, 2, 'fell back to the keyword key');
  });

  test('an empty group in the partition falls back rather than throwing', async () => {
    // Covers every index exactly once and is still not usable.
    const ro = withLLM(orchestrator(), { partition: [[0, 1], []] });

    const groups = await ro.groupRelatedClaims(PARAPHRASE_CLAIMS, TOPIC);

    assert.equal(groups.length, 2, 'fell back to the keyword key');
  });

  test('group statistics are identical whichever path built the group', async () => {
    const semanticRo = withLLM(orchestrator(), { partition: [[0], [1]] });
    const lexicalRo = withLLM(orchestrator(), { partition: [] });

    const semantic = await semanticRo.groupRelatedClaims(PARAPHRASE_CLAIMS, TOPIC);
    const lexical = await lexicalRo.groupRelatedClaims(PARAPHRASE_CLAIMS, TOPIC);

    assert.equal(semantic.length, lexical.length);
    for (let i = 0; i < semantic.length; i++) {
      const { id: _semanticId, ...semanticRest } = semantic[i];
      const { id: _lexicalId, ...lexicalRest } = lexical[i];
      assert.deepEqual(semanticRest, lexicalRest, 'only the group id differs');
    }
  });

  test('the grouping call is awaited by synthesizeInformation', async () => {
    // groupRelatedClaims became async; an unawaited call would hand
    // detectInformationConflicts a Promise and silently produce no findings.
    const ro = withKeypoints(withLLM(orchestrator(), { partition: [[0, 1]] }), {
      'content-a': [PARAPHRASE_A],
      'content-b': [PARAPHRASE_B]
    });
    ro.initializeResearchSession('g1', TOPIC, Date.now());
    ro.llmManager.synthesizeFindings = async () => ({
      summary: 'ok', keyInsights: [], themes: [], confidence: 0.6
    });

    const synthesis = await ro.synthesizeInformation(
      [
        source({ extractedContent: 'content-a' }),
        source({ link: 'https://other.example/b', extractedContent: 'content-b' })
      ],
      TOPIC
    );

    assert.equal(synthesis.consensus.length, 1, 'consensusAreas is no longer structurally 0');
    assert.equal(synthesis.keyFindings.length, 1, 'the grouped pair is one finding');
    assert.equal(synthesis.keyFindings[0].supportingClaims, 2);
  });
});

describe('conflict detection is gated on a measured judge and fails closed', () => {
  function group(claims, id = 'g') {
    return { id, keywords: [], claims, sourceCount: 1, avgCredibility: 0.7 };
  }

  // Two claims that AGREE, from the live 2026-08-28 run where the lexical
  // detector reported them as contradicting each other because the first
  // contains the token "not". Real extractive claims are long multi-sentence
  // blobs, so nearly every pair carries both a negation and an affirmation
  // somewhere — which is why no sentence-shape test survives here.
  const AGREEING = [
    claim('Modern anti-bot systems do not just block IP addresses - they fingerprint your TLS handshake and analyze your browser environment.', 'https://a.example/1'),
    claim('Cloudflare and DataDome maintain databases of known bot signatures and block matching fingerprints on sight.', 'https://b.example/2')
  ];

  // A pair any lexical polarity test flags: identical subject, one negated.
  // Every assertion below is written so that a lexical detector reaching this
  // text would produce a DIFFERENT answer to the model's — that is what makes
  // these tests prove the lexical path is gone rather than merely dormant.
  const LEXICALLY_OPPOSED = [
    claim('Residential proxies reliably bypass DataDome detection.', 'https://a.example/1'),
    claim('Residential proxies do not bypass DataDome detection.', 'https://b.example/2')
  ];

  const UNRELATED = claim('Akamai deploys sensor JavaScript on every protected page.', 'https://c.example/3');

  test('no conflicts when the model finds none, whatever the text looks like', async () => {
    const ro = withLLM(orchestrator(), { contradictions: [] });

    const conflicts = await ro.detectInformationConflicts(
      [group([...AGREEING, ...LEXICALLY_OPPOSED])],
      TOPIC
    );

    assert.deepEqual(conflicts, [], 'no sentence-shape test may add a conflict of its own');
  });

  test('a contradiction the model names is reported once a measured judge is available', async () => {
    // Measured 2026-08-28: the default 4B model named 29, 13 and 28
    // non-contradictions on a live run's own claims and, with the consistency
    // veto, then missed "X does not use Y" against "X uses Y" outright — so
    // the judgement was gated off. Replaying the same claims through
    // gemma3:12b: 0 false contradictions on 27 real pairs, every planted one
    // caught, three runs. The gate is the model: with a measured judge the
    // model's answer is reported.
    const claims = [...LEXICALLY_OPPOSED, UNRELATED];
    // Pairs are formed in order: (0,1) (0,2) (1,2). The model names the first.
    const ro = withLLM(orchestrator(), { contradictions: [0], judge: true });

    const conflicts = await ro.detectInformationConflicts([group(claims)], TOPIC);

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'contradiction');
    assert.equal(conflicts[0].claim1.claim, LEXICALLY_OPPOSED[0].claim);
    assert.equal(conflicts[0].claim2.claim, LEXICALLY_OPPOSED[1].claim);
  });

  test('without a measured judge the model is not asked at all, whatever it would say', async () => {
    // Not merely "returns nothing": the gate must short-circuit before the
    // pairs are built, so an unmeasured model costs no LLM round trips inside
    // the tool's wall-clock limit — and cannot invent a conflict.
    const ro = withLLM(orchestrator(), { judge: false });
    let asked = false;
    ro.llmManager.findContradictions = async () => {
      asked = true;
      return [0];
    };

    assert.deepEqual(
      await ro.detectInformationConflicts(
        [
          group([claim('Group one claim A.', 'https://a.example/1'), claim('Group one claim B.', 'https://b.example/2')], 'g1'),
          group([claim('Group two claim C.', 'https://c.example/3'), claim('Group two claim D.', 'https://d.example/4')], 'g2')
        ],
        TOPIC
      ),
      []
    );
    assert.equal(asked, false, 'the judge must not be consulted while the gate is closed');
  });

  test('every candidate pair the orchestrator forms is offered to the judge', async () => {
    // The judge's own default examined 30 pairs while the orchestrator formed
    // up to 40, so the last ten candidates were silently never judged.
    let sent;
    let options;
    const ro = withLLM(orchestrator(), { judge: true });
    ro.llmManager.findContradictions = async (pairs, _topic, opts) => {
      sent = pairs.length;
      options = opts;
      return [];
    };
    const groups = Array.from({ length: 10 }, (_, g) =>
      group(
        Array.from({ length: 10 }, (_, i) =>
          claim(`Group ${g} claim ${i} about bot detection.`, `https://s${g}-${i}.example/x`, 0.5 + i * 0.01)
        ),
        `g${g}`
      )
    );

    await ro.detectInformationConflicts(groups, TOPIC);

    assert.equal(sent, 40, 'ten groups of ten is 450 pairs before the per-group and overall caps');
    assert.equal(options?.maxPairs, sent, 'the judge must be told to examine every pair it is sent');
  });

  test('no conflicts when LLM features are disabled, and the model is not called', async () => {
    const ro = orchestrator();
    ro.enableLLMFeatures = false;
    ro.llmManager.findContradictions = async () => {
      throw new Error('must not be called');
    };

    assert.deepEqual(await ro.detectInformationConflicts([group(LEXICALLY_OPPOSED)], TOPIC), []);
  });

  test('a failing model reports no conflicts rather than falling back', async () => {
    const ro = withLLM(orchestrator());
    ro.llmManager.findContradictions = async () => {
      throw new Error('provider down');
    };

    assert.deepEqual(await ro.detectInformationConflicts([group(LEXICALLY_OPPOSED)], TOPIC), []);
  });

  test('an unusable answer is ignored', async () => {
    const ro = withLLM(orchestrator(), { contradictions: [99, -1, 'x', null] });

    assert.deepEqual(await ro.detectInformationConflicts([group(LEXICALLY_OPPOSED)], TOPIC), []);
  });

  test('a group with a single claim produces no pair and no call', async () => {
    const ro = withLLM(orchestrator());
    ro.llmManager.findContradictions = async () => {
      throw new Error('must not be called');
    };

    assert.deepEqual(await ro.detectInformationConflicts([group([LEXICALLY_OPPOSED[0]])], TOPIC), []);
  });

  test('a large claim population still costs nothing without a measured judge', async () => {
    // Ten groups of ten claims is 450 unbounded pairs. The bounding logic that
    // caps this lives behind the gate, so what is pinned here is that none of
    // it runs.
    const groups = Array.from({ length: 10 }, (_, g) =>
      group(
        Array.from({ length: 10 }, (_, i) =>
          claim(`Group ${g} claim ${i} about bot detection.`, `https://s${g}-${i}.example/x`, 0.5 + i * 0.01)
        ),
        `g${g}`
      )
    );

    const ro = withLLM(orchestrator());
    ro.llmManager.findContradictions = async () => {
      throw new Error('must not be called');
    };

    assert.deepEqual(await ro.detectInformationConflicts(groups, TOPIC), []);
  });
});

describe('consensus is reachable at real source credibility', () => {
  function group(claims) {
    return {
      id: 'g',
      keywords: [],
      claims,
      sourceCount: new Set(claims.map(c => c.source)).size,
      avgCredibility: claims.reduce((sum, c) => sum + c.credibility, 0) / claims.length
    };
  }

  test('two sources at realistic credibility are a consensus area', () => {
    // Live 2026-08-28: source credibility spanned 0.496-0.630 (n=7, avg
    // 0.567), so a hardcoded 0.6 floor reported consensusAreas: 0 on a run
    // whose groups were properly corroborated.
    const consensus = orchestrator().identifyConsensus([group([
      claim(PARAPHRASE_A, 'https://one.example/a', 0.55),
      claim(PARAPHRASE_B, 'https://two.example/b', 0.55)
    ])]);

    assert.equal(consensus.length, 1);
    assert.equal(consensus[0].supportingSources, 2);
  });

  test('one source is never a consensus area, however credible', () => {
    const consensus = orchestrator().identifyConsensus([group([
      claim(PARAPHRASE_A, 'https://one.example/a', 0.99),
      claim('Cloudflare fingerprints the TLS handshake.', 'https://one.example/a', 0.99)
    ])]);

    assert.deepEqual(consensus, [], 'corroboration is the load-bearing requirement');
  });

  test('the floor is the caller-settable credibilityThreshold, not a separate constant', () => {
    const claims = [
      claim(PARAPHRASE_A, 'https://one.example/a', 0.4),
      claim(PARAPHRASE_B, 'https://two.example/b', 0.4)
    ];

    const strict = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' }, credibilityThreshold: 0.8 });
    assert.deepEqual(strict.identifyConsensus([group(claims)]), [], 'a strict caller excludes it');
    assert.equal(orchestrator().identifyConsensus([group(claims)]).length, 1, 'the default 0.3 admits it');
  });
});

describe('4.4 per-claim topical relevance', () => {
  const OFF_TOPIC = 'Their platform offers a free tier so you can start scraping today.';
  const ON_TOPIC = 'Cloudflare Bot Management scores every request using TLS and JA3 fingerprints.';

  test('scores land on topicRelevance and leave the source-level relevance alone', async () => {
    const ro = withKeypoints(withLLM(orchestrator(), { scores: [0.9] }), {
      'content-a': [ON_TOPIC]
    });

    const claims = await ro.extractKeyClaims([source({ relevanceScore: 0.7 })], TOPIC);

    assert.equal(claims[0].topicRelevance, 0.9);
    assert.equal(claims[0].relevance, 0.7, 'the source-level score is untouched');
  });

  test('an off-topic claim is dropped while its on-topic neighbour survives', async () => {
    const ro = withKeypoints(withLLM(orchestrator(), { scores: [0.05, 0.9] }), {
      'content-a': [OFF_TOPIC, ON_TOPIC]
    });

    const claims = await ro.extractKeyClaims([source()], TOPIC);

    assert.deepEqual(claims.map(c => c.claim), [ON_TOPIC]);
  });

  test('when every claim scores low the gate falls back instead of emptying the run', async () => {
    const ro = withKeypoints(withLLM(orchestrator(), { scores: [0.05, 0.1] }), {
      'content-a': [OFF_TOPIC, ON_TOPIC]
    });

    const claims = await ro.extractKeyClaims([source()], TOPIC);

    assert.equal(claims.length, 2);
  });

  test('an empty score array reproduces the behaviour of not having asked', async () => {
    const scored = withKeypoints(withLLM(orchestrator(), { scores: [] }), {
      'content-a': [OFF_TOPIC, ON_TOPIC]
    });
    const unscored = withKeypoints(orchestrator(), { 'content-a': [OFF_TOPIC, ON_TOPIC] });
    unscored.enableLLMFeatures = false;

    const withEmptyScores = await scored.extractKeyClaims([source()], TOPIC);
    const withoutScoring = await unscored.extractKeyClaims([source()], TOPIC);

    assert.deepEqual(
      withEmptyScores.map(({ extractedAt, ...rest }) => rest),
      withoutScoring.map(({ extractedAt, ...rest }) => rest)
    );
    assert.ok(withEmptyScores.every(c => c.topicRelevance === undefined), 'nothing recorded');
  });

  test('a null score means unscored, never zero', async () => {
    // The model does not always return a score for every claim: live
    // 2026-08-28 a 4B local model answered 39 scores for 35 claims on every
    // run. The contract now pads to length with null rather than giving up, so
    // a null must not read as a low score and drop a good claim.
    const MIDDLE = 'DataDome blocks roughly 5 billion automated requests every day.';
    const ro = withKeypoints(withLLM(orchestrator(), { scores: [0.05, null, 0.9] }), {
      'content-a': [OFF_TOPIC, MIDDLE, ON_TOPIC]
    });

    const claims = await ro.extractKeyClaims([source()], TOPIC);

    assert.deepEqual(claims.map(c => c.claim), [MIDDLE, ON_TOPIC], 'only the low score is filtered');
    assert.equal(claims[0].topicRelevance, undefined, 'the null-scored claim is unscored');
    assert.equal(claims[1].topicRelevance, 0.9);
  });

  test('a null-scored finding still reaches the aiSummary', async () => {
    const ro = withKeypoints(withLLM(orchestrator(), { scores: [null] }), {
      'content-a': [ON_TOPIC]
    });
    ro.initializeResearchSession('r3', TOPIC, Date.now());

    let sentToLLM = null;
    ro.llmManager.synthesizeFindings = async findings => {
      sentToLLM = findings;
      return { summary: 'ok', keyInsights: [], themes: [], confidence: 0.6 };
    };

    await ro.synthesizeInformation([source()], TOPIC);

    assert.deepEqual(sentToLLM.map(f => f.finding), [ON_TOPIC], 'unscored is not withheld');
  });

  test('a NaN score is treated as unscored rather than rejecting the claim', async () => {
    const ro = withKeypoints(withLLM(orchestrator(), { scores: [Number.NaN] }), {
      'content-a': [ON_TOPIC]
    });

    const claims = await ro.extractKeyClaims([source()], TOPIC);

    assert.equal(claims.length, 1);
    assert.equal(claims[0].topicRelevance, undefined, 'typeof NaN is "number" — the guard must not be typeof');
  });

  test('a score list of the wrong length is ignored rather than misaligned', async () => {
    const ro = withKeypoints(withLLM(orchestrator(), { scores: [0.9] }), {
      'content-a': [OFF_TOPIC, ON_TOPIC]
    });

    const claims = await ro.extractKeyClaims([source()], TOPIC);

    assert.equal(claims.length, 2);
    assert.ok(claims.every(c => c.topicRelevance === undefined));
  });

  test('a weakly on-topic finding is reported but withheld from aiSummary', async () => {
    const ro = withKeypoints(withLLM(orchestrator(), { scores: [0.35, 0.95] }), {
      'content-a': ['Scrapy Cloud hosts and schedules spiders for teams of any size.'],
      'content-b': [ON_TOPIC]
    });
    ro.initializeResearchSession('r1', TOPIC, Date.now());

    let sentToLLM = null;
    ro.llmManager.synthesizeFindings = async findings => {
      sentToLLM = findings;
      return { summary: 'ok', keyInsights: [], themes: [], confidence: 0.6 };
    };

    const synthesis = await ro.synthesizeInformation(
      [
        source({ link: 'https://vendor.example/a', extractedContent: 'content-a' }),
        source({ link: 'https://tendem.example/b', extractedContent: 'content-b' })
      ],
      TOPIC
    );

    assert.equal(synthesis.keyFindings.length, 2, 'both findings are still reported');
    assert.deepEqual(sentToLLM.map(f => f.finding), [ON_TOPIC]);
  });

  test('a run where every claim scores weakly still gets synthesized', async () => {
    const ro = withKeypoints(withLLM(orchestrator(), { scores: [0.35] }), {
      'content-a': [ON_TOPIC]
    });
    ro.initializeResearchSession('r2', TOPIC, Date.now());

    let sentToLLM = null;
    ro.llmManager.synthesizeFindings = async findings => {
      sentToLLM = findings;
      return { summary: 'ok', keyInsights: [], themes: [], confidence: 0.6 };
    };

    await ro.synthesizeInformation([source()], TOPIC);

    assert.equal(sentToLLM.length, 1, 'the fallback keeps the synthesis non-empty');
  });
});

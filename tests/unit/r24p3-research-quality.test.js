/**
 * Live test R24 Phase 3, items 3.11 and 3.1 (deep_research part).
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test --test-force-exit tests/unit/r24p3-research-quality.test.js
 *
 * - 3.11: findings the LLM scored 0.3 for topic relevance were reported as key
 *   findings (reproduced live 2026-10-03: "Talk at Bellcore, 7 March 1986…" and
 *   "I can't prove that one should do this…" at 0.3). Below
 *   MIN_SYNTHESIS_TOPIC_RELEVANCE (0.5) a claim is no longer a finding or one
 *   side of a conflict. Conflict candidates are also cross-source only.
 * - 3.1: the plain-fetch fallback stripped tags with a regex and ran every
 *   block together on one line; it now reads through flattenText.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ResearchOrchestrator, fallbackPageText, reportedFindings } from '../../src/core/ResearchOrchestrator.js';

const TOPIC = 'how to do great work';

function orchestrator() {
  const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
  ro.enableLLMFeatures = true;
  ro.llmManager.canJudgeContradictions = async () => true;
  return ro;
}

function claim(text, source, { credibility = 0.7, topicRelevance } = {}) {
  return {
    claim: text,
    source,
    credibility,
    ...(topicRelevance === undefined ? {} : { topicRelevance })
  };
}

function group(claims, id = 'g') {
  return {
    id,
    keywords: [],
    claims,
    sourceCount: new Set(claims.map(c => c.source)).size,
    avgCredibility: claims.reduce((sum, c) => sum + c.credibility, 0) / claims.length
  };
}

describe('3.11 key findings below the topic-relevance threshold are dropped', () => {
  const GROUPS = () => [
    group([claim('Talk at Bellcore, 7 March 1986.', 'https://a.example/1', { topicRelevance: 0.3 })], 'g1'),
    group([claim('The work you choose needs natural aptitude and deep interest.', 'https://b.example/2', { topicRelevance: 0.9 })], 'g2'),
    group([claim('Great work takes years of steady effort.', 'https://c.example/3')], 'g3')
  ];

  test('the report omits a finding scored 0.3 and keeps scored-high and unscored ones', () => {
    const ro = orchestrator();
    ro.initializeResearchSession('r24p3', TOPIC, Date.now());
    const keyFindings = ro.generateKeyFindings(GROUPS(), []);
    const results = ro.compileResearchResults(TOPIC, {
      keyFindings, supportingEvidence: [], conflicts: [], consensus: [], gaps: [], recommendations: []
    }, {});

    assert.deepEqual(
      results.findings.map(f => f.finding).sort(),
      ['Great work takes years of steady effort.', 'The work you choose needs natural aptitude and deep interest.']
    );
    assert.equal(results.researchSummary.keyFindings, 2);
  });

  test('when no finding is material the report keeps them all rather than none', () => {
    const weak = [{ finding: 'x', topicRelevance: 0.3 }, { finding: 'y', topicRelevance: 0.4 }];
    assert.deepEqual(reportedFindings(weak), weak);
    assert.deepEqual(reportedFindings([...weak, { finding: 'z', topicRelevance: 0.5 }]).map(f => f.finding), ['z']);
  });

  test('a group surfaces its material claim over a more credible off-topic one', () => {
    const ro = orchestrator();
    const [finding] = ro.generateKeyFindings([
      group([
        claim('An off-topic aside.', 'https://a.example/1', { credibility: 0.9, topicRelevance: 0.3 }),
        claim('Curiosity is the engine of great work.', 'https://b.example/2', { credibility: 0.6, topicRelevance: 0.8 })
      ])
    ], []);

    assert.equal(finding.finding, 'Curiosity is the engine of great work.');
    assert.equal(finding.topicRelevance, 0.8);
  });
});

describe('3.11 conflict candidates are material, cross-source pairs', () => {
  function capture(ro) {
    const sent = [];
    ro.llmManager.findContradictions = async pairs => {
      sent.push(...pairs);
      return [];
    };
    return sent;
  }

  test('two claims from the same page are never offered to the judge', async () => {
    const ro = orchestrator();
    const sent = capture(ro);

    await ro.detectInformationConflicts([
      group([
        claim('How to Do Great Work', 'https://pg.example/greatwork'),
        claim('Great work does not require genius.', 'https://pg.example/greatwork'),
        claim('Great work requires exceptional talent.', 'https://other.example/talent')
      ])
    ], TOPIC);

    assert.equal(sent.length, 2, 'only the two cross-source pairs');
    for (const pair of sent) {
      assert.ok(
        pair.a === 'Great work requires exceptional talent.' || pair.b === 'Great work requires exceptional talent.',
        `same-source pair sent: ${JSON.stringify(pair)}`
      );
    }
  });

  test('a claim scored below the threshold is not one side of a conflict', async () => {
    const ro = orchestrator();
    const sent = capture(ro);

    const conflicts = await ro.detectInformationConflicts([
      group([
        claim('Coffee raises blood pressure briefly.', 'https://a.example/1', { topicRelevance: 0.9 }),
        claim('Caffeine occurs naturally in many plants.', 'https://b.example/2', { topicRelevance: 0.3 })
      ])
    ], TOPIC);

    assert.deepEqual(sent, []);
    assert.deepEqual(conflicts, []);
  });

  test('a material cross-source pair the judge names is still reported', async () => {
    const ro = orchestrator();
    ro.llmManager.findContradictions = async () => [0];

    const conflicts = await ro.detectInformationConflicts([
      group([
        claim('Residential proxies reliably bypass DataDome.', 'https://a.example/1', { topicRelevance: 0.9 }),
        claim('Residential proxies do not bypass DataDome.', 'https://b.example/2')
      ])
    ], TOPIC);

    assert.equal(conflicts.length, 1);
  });
});

describe('3.1 the plain-fetch fallback keeps block boundaries', () => {
  test('blocks and <br> runs become line breaks, scripts and styles are dropped', () => {
    const html = '<html><head><style>p{}</style></head><body>' +
      '<div><font>July 2023<br><br>If you collected lists of techniques</font></div>' +
      '<h2>Heading</h2><p>Para one.</p><p>Para two.</p><script>var x = 1;</script></body></html>';

    const text = fallbackPageText(html);

    assert.equal(text, 'July 2023\nIf you collected lists of techniques\nHeading\nPara one.\nPara two.');
  });
});

/**
 * Regression tests: deep_research finding composition.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test tests/unit/researchFindingsComposition.test.js
 *
 * Defect (2026-08-26 live sweep): deep_research returned gibberish findings —
 * ungrammatical stopword-stripped keyword joins like
 * "scraping server model context protocol server that exposes scraping capabilities"
 * instead of readable sentences, even with llmEnhanced:true.
 *
 * Root causes:
 * 1. generateKeyFindings() composed `finding` from group.keywords.join(' ')
 *    (extractKeywords drops words <=3 chars and reorders nothing back into
 *    prose) instead of surfacing a claim sentence verbatim.
 * 2. LLMManager.synthesizeFindings() fed the raw model output to JSON.parse;
 *    small local models wrap JSON in ```json fences, so the parse always threw
 *    and the keyword gibberish flowed through the fallback into insights too.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ResearchOrchestrator } from '../../src/core/ResearchOrchestrator.js';
import { LLMManager } from '../../src/core/llm/LLMManager.js';

// Fixture: source content made of complete grammatical sentences, and the
// claims extractKeyClaims() would derive from it (claims are extractive
// sentences from the summarize tool — verbatim substrings of the source).
const SOURCE_TEXT = [
  'CrawlForge is a native MCP server purpose-built for AI agents that need web data.',
  'The server exposes 28 specialized scraping and research tools over the Model Context Protocol.',
  'Deep research runs multi-stage query expansion and verifies each source before synthesis.',
  'Credit costs range from one credit for simple fetches to ten credits for deep research.'
].join(' ');

function makeClaims() {
  const sentences = SOURCE_TEXT.match(/[^.]+\./g).map(s => s.trim());
  return sentences.map((sentence, i) => ({
    id: `https://example.com/src${i % 2}_claim_${i}`,
    claim: sentence,
    source: `https://example.com/src${i % 2}`,
    sourceTitle: `Source ${i % 2}`,
    credibility: 0.6 + i * 0.05,
    context: '',
    extractedAt: new Date().toISOString()
  }));
}

describe('generateKeyFindings — findings are verbatim extractive sentences', () => {
  const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });

  test('each finding is a complete sentence present verbatim in the source text', () => {
    const claims = makeClaims();
    const groups = ro.groupRelatedClaims(claims);
    const findings = ro.generateKeyFindings(groups, []);

    assert.ok(findings.length > 0, 'fixture claims must produce findings');
    for (const f of findings) {
      // Verbatim: the finding text must be a substring of the source content.
      assert.ok(
        SOURCE_TEXT.includes(f.finding),
        `finding must be verbatim from the source, got: "${f.finding}"`
      );
      // Grammatical shape: starts with a capital, ends with sentence punctuation,
      // and keeps its stopwords (the old keyword-join stripped words <=3 chars).
      assert.match(f.finding, /^[A-Z]/, 'finding starts like a sentence');
      assert.match(f.finding, /[.!?]$/, 'finding ends like a sentence');
      // Attribution survives the fix.
      assert.ok(Array.isArray(f.sources) && f.sources.length > 0, 'finding keeps source attribution');
    }
  });

  test('findings are not the stopword-stripped keyword join of the claim', () => {
    const claims = makeClaims();
    const groups = ro.groupRelatedClaims(claims);
    const findings = ro.generateKeyFindings(groups, []);

    for (const group of groups) {
      const keywordJoin = group.keywords.join(' ');
      for (const f of findings) {
        assert.notEqual(
          f.finding, keywordJoin,
          `finding must not be the keyword n-gram join: "${keywordJoin}"`
        );
      }
    }
  });
});

describe('LLMManager.synthesizeFindings — fenced JSON from small local models parses', () => {
  test('```json-fenced output is parsed instead of falling back to keyword gibberish', async () => {
    const mgr = new LLMManager({});
    mgr.generateCompletion = async () =>
      '```json\n{"summary":"CrawlForge provides 28 MCP web tools.","keyInsights":["It is purpose-built for AI agents."],"themes":["mcp"],"confidence":0.8,"gaps":[],"recommendations":[]}\n```';

    const result = await mgr.synthesizeFindings(
      [{ finding: 'CrawlForge is a native MCP server purpose-built for AI agents that need web data.' }],
      'CrawlForge MCP server'
    );

    assert.equal(result.summary, 'CrawlForge provides 28 MCP web tools.');
    assert.deepEqual(result.keyInsights, ['It is purpose-built for AI agents.']);
    // The pre-fix behavior threw on the fences and returned the fallback,
    // whose summary always starts with "Collected N findings".
    assert.ok(!result.summary.startsWith('Collected'), 'must not be the non-LLM fallback');
  });

  test('an empty/summary-less object falls back instead of blanking the synthesis', async () => {
    const mgr = new LLMManager({});
    mgr.generateCompletion = async () => '{}';

    const findings = [{ finding: 'CrawlForge exposes 28 web tools over MCP.' }];
    const result = await mgr.synthesizeFindings(findings, 'CrawlForge MCP server');

    // Live gemma3:4b intermittently returned {} under plain format:'json';
    // insights then serialized as {} in the tool output. The guard must route
    // that to the readable extractive fallback.
    assert.ok(typeof result.summary === 'string' && result.summary.length > 0);
    assert.deepEqual(result.keyInsights, ['CrawlForge exposes 28 web tools over MCP.']);
  });
});

describe('gap/consensus/recommendation composition — readable claims, not keyword joins (2026-08-26)', () => {
  const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
  const claimSentence = 'CrawlForge is a native MCP server purpose-built for AI agents that need web data.';
  const weakGroup = {
    keywords: ['crawlforge', 'native', 'server', 'purpose', 'built', 'agents'],
    claims: [{ claim: claimSentence, credibility: 0.45, source: 'https://example.com/a' }],
    avgCredibility: 0.45,
    sourceCount: 1,
    consensusStrength: 0.2
  };
  const gibberish = weakGroup.keywords.join(' ');

  test('identifyResearchGaps: area and suggestion carry the claim verbatim, not the keyword join', () => {
    const gaps = ro.identifyResearchGaps([weakGroup], 'test topic');
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].area, claimSentence);
    assert.notEqual(gaps[0].area, gibberish);
    assert.ok(gaps[0].suggestion.includes(claimSentence), 'suggestion quotes the claim');
  });

  test('identifyConsensus: topic is the readable claim', () => {
    const strongGroup = { ...weakGroup, avgCredibility: 0.7, sourceCount: 2 };
    const consensus = ro.identifyConsensus([strongGroup]);
    assert.equal(consensus.length, 1);
    assert.equal(consensus[0].topic, claimSentence);
  });

  test('gap_filling recommendation references the readable area', () => {
    const synthesis = { conflicts: [], gaps: ro.identifyResearchGaps([weakGroup], 't') };
    const recs = ro.generateResearchRecommendations(synthesis, 't');
    const gapRec = recs.find(r => r.type === 'gap_filling');
    assert.ok(gapRec, 'gap_filling recommendation exists');
    assert.ok(gapRec.description.includes(claimSentence.slice(0, 40)), 'description quotes a claim');
    assert.ok(!gapRec.description.includes(gibberish), 'no keyword join');
  });

  test('claimGroupLabel truncates a long claim at a word break with an ellipsis', () => {
    const longClaim = 'word '.repeat(60).trim() + '.';
    const label = ro.claimGroupLabel({ claims: [{ claim: longClaim, credibility: 0.9 }] });
    assert.ok(label.length <= 121, `label is capped (got ${label.length})`);
    assert.ok(label.endsWith('…'), 'ellipsis marks the cut');
    assert.ok(!label.includes('  '), 'cut lands on a word boundary');
  });
});

describe('synthesizeFindings — truncation-resistant prompt and retry (2026-08-26)', () => {
  // Live repro: gemma3:4b filled all six schema fields verbosely and overran
  // the 800-token budget, truncating the JSON mid-string ("Unterminated
  // string in JSON at position 4289") roughly two runs in three.

  function makeManager(completions) {
    const mgr = new LLMManager({});
    let call = 0;
    const prompts = [];
    mgr.generateCompletion = async (prompt) => {
      prompts.push(prompt);
      const out = completions[Math.min(call, completions.length - 1)];
      call++;
      if (out instanceof Error) throw out;
      return out;
    };
    return { mgr, prompts };
  }

  test('a giant finding is capped in the prompt instead of being passed whole', async () => {
    const blob = 'sitemap '.repeat(400); // ~3200 chars
    const { mgr, prompts } = makeManager(['{"summary":"ok","keyInsights":[],"themes":[],"confidence":0.5}']);
    await mgr.synthesizeFindings([{ finding: blob }], 'topic');
    assert.equal(prompts.length, 1);
    assert.ok(!prompts[0].includes(blob), 'whole blob must not reach the prompt');
    assert.ok(prompts[0].includes(blob.slice(0, 300) + '…'), 'capped to 300 chars + ellipsis');
  });

  test('a truncated first response is retried once and the retry result is returned', async () => {
    const truncated = '{"summary":"long and cut off mid str';
    const good = '{"summary":"real synthesis","keyInsights":["a"],"themes":["b"],"confidence":0.8}';
    const { mgr, prompts } = makeManager([truncated, good]);
    const result = await mgr.synthesizeFindings([{ finding: 'f' }], 'topic');
    assert.equal(prompts.length, 2, 'exactly one retry');
    assert.equal(result.summary, 'real synthesis');
  });

  test('two failed attempts fall back to the extractive synthesis', async () => {
    const truncated = '{"summary":"cut';
    const { mgr, prompts } = makeManager([truncated, truncated]);
    const result = await mgr.synthesizeFindings([{ finding: 'f' }], 'my topic');
    assert.equal(prompts.length, 2);
    assert.ok(/my topic/.test(result.summary), 'fallback synthesis mentions the topic');
  });
});

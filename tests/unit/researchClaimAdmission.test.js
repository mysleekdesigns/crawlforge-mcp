/**
 * Regression tests: deep_research claim admission and finding selection.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test tests/unit/researchClaimAdmission.test.js
 *
 * Defect (2026-08-28 live sweep, topic "What anti-bot systems do major
 * websites use in 2026"):
 * 1. The top finding was an arXiv front-matter block starting
 *    "DOI: XXXXXXX.XXXXXXX" — author/affiliation text admitted as a claim.
 * 2. All five findings came from one URL, none of them on topic, while the
 *    per-source relevance score computed during exploration was never used.
 * 3. generateKeyFindings sorted on group.consensusStrength, which
 *    groupRelatedClaims never sets — undefined vs undefined, so the sort
 *    ordered nothing and every finding had supportingClaims: 1.
 * 4. aiSummary concluded a scraping vendor was "a key solution", synthesized
 *    straight from that vendor's own marketing copy.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ResearchOrchestrator } from '../../src/core/ResearchOrchestrator.js';
import {
  isAdmissibleClaim,
  isVendorSelfPromotion,
  isProductRecommendation,
  brandFromUrl
} from '../../src/core/research/claimFilters.js';

// Verbatim shape of the front matter that became the top finding.
const DOI_FRONT_MATTER =
  'DOI: XXXXXXX.XXXXXXX Anna Mueller, Technical University of Munich, Germany anna.mueller@tum.de Wei Zhang, Institute for Web Science, Singapore';

const ON_TOPIC_CLAIM =
  'Cloudflare Bot Management scores every request using TLS and JA3 fingerprints.';

function orchestrator() {
  return new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
}

// Sources shaped as extractKeyClaims receives them, with a summarize stub that
// returns the keypoints keyed by each source's extracted content.
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

describe('4.1 front matter is not a claim', () => {
  test('rejects the DOI/author/affiliation block that became the top finding', () => {
    assert.equal(isAdmissibleClaim(DOI_FRONT_MATTER), false);
  });

  test('rejects CCS classifiers, retrieval lines and author rows', () => {
    const furniture = [
      'CCS Concepts: • Security and privacy → Web application security',
      'Retrieved from https://arxiv.org/abs/2401.01234 on 12 March 2026',
      'Jane R. Doe, Maria Silva, Kenji Watanabe, Stanford University, United States',
      'Copyright 2026 Association for Computing Machinery. All rights reserved.'
    ];
    for (const text of furniture) {
      assert.equal(isAdmissibleClaim(text), false, `should reject: ${text}`);
    }
  });

  test('rejects bot-challenge interstitials without rejecting talk about CAPTCHAs', () => {
    // Live 2026-08-28: Radware's challenge page supplied findings 1 and 6
    // ("Checking your browser. This only takes a moment.", "I am not a robot").
    // On an anti-bot topic these score as relevant, so only a content test
    // catches them.
    assert.equal(isAdmissibleClaim('Checking your browser       This only takes a moment.'), false);
    assert.equal(isAdmissibleClaim('I am not a robot           Select this box, or press Space'), false);
    assert.equal(isAdmissibleClaim('Please enable JavaScript and cookies to continue.'), false);
    assert.equal(
      isAdmissibleClaim("Your scripts run perfectly in testing, then production hits and you're dealing with CAPTCHA challenges and 2FA login flows."),
      true,
      'a real claim that discusses CAPTCHAs must survive'
    );
  });

  test('admits short factual claims, including ones dense in product names', () => {
    const claims = [
      ON_TOPIC_CLAIM,
      'DataDome blocks roughly 5 billion automated requests every day.',
      'Akamai and Imperva both rely on device fingerprinting.',
      'Headless browsers are detected through canvas and WebGL entropy.',
      'Rate limiting alone no longer stops distributed scraping.'
    ];
    for (const text of claims) {
      assert.equal(isAdmissibleClaim(text), true, `should admit: ${text}`);
    }
  });

  test('extractKeyClaims drops front matter and keeps the real claim', async () => {
    const ro = withKeypoints(orchestrator(), {
      'content-a': [DOI_FRONT_MATTER, ON_TOPIC_CLAIM]
    });

    const claims = await ro.extractKeyClaims([source()]);

    assert.equal(claims.length, 1);
    assert.equal(claims[0].claim, ON_TOPIC_CLAIM);
  });

  test('a source that yields only front matter contributes nothing when another source has claims', async () => {
    const ro = withKeypoints(orchestrator(), {
      'content-a': [DOI_FRONT_MATTER],
      'content-b': [ON_TOPIC_CLAIM]
    });

    const claims = await ro.extractKeyClaims([
      source(),
      source({ link: 'https://other.example/b', extractedContent: 'content-b' })
    ]);

    assert.deepEqual(claims.map(c => c.source), ['https://other.example/b']);
  });
});

describe('4.2 claims are gated on the per-source relevance score', () => {
  test('claims from an off-topic source are dropped, on-topic ones kept', async () => {
    const ro = withKeypoints(orchestrator(), {
      'content-a': ['AI chatbot adoption grew sharply among enterprise buyers.'],
      'content-b': [ON_TOPIC_CLAIM]
    });

    const claims = await ro.extractKeyClaims([
      source({ relevanceScore: 0.05 }),
      source({ link: 'https://other.example/b', extractedContent: 'content-b', relevanceScore: 0.8 })
    ]);

    assert.deepEqual(claims.map(c => c.claim), [ON_TOPIC_CLAIM]);
  });

  test('a source with no relevance score is not filtered out', async () => {
    const ro = withKeypoints(orchestrator(), { 'content-a': [ON_TOPIC_CLAIM] });

    const claims = await ro.extractKeyClaims([source()]);

    assert.equal(claims.length, 1);
    assert.equal(claims[0].relevance, undefined);
  });

  test('reads the score recorded in researchState when the source object lost it', async () => {
    const ro = withKeypoints(orchestrator(), { 'content-a': [ON_TOPIC_CLAIM] });
    ro.initializeResearchSession('s1', 'anti-bot systems', Date.now());
    ro.researchState.relevanceScores.set('https://example.com/a', 0.02);

    const claims = await ro.extractKeyClaims([source()]);

    // Nothing else survives, so the relevance gate falls back rather than
    // returning an empty research run.
    assert.equal(claims.length, 1);
    assert.equal(claims[0].relevance, 0.02);
  });

  test('when every source is below the threshold the gate falls back instead of emptying the run', async () => {
    const ro = withKeypoints(orchestrator(), {
      'content-a': [ON_TOPIC_CLAIM],
      'content-b': ['Perimeter defences moved from IP reputation to behavioural scoring.']
    });

    const claims = await ro.extractKeyClaims([
      source({ relevanceScore: 0.1 }),
      source({ link: 'https://other.example/b', extractedContent: 'content-b', relevanceScore: 0.05 })
    ]);

    assert.equal(claims.length, 2);
  });
});

describe('4.3 finding selection: source cap, corroboration, real ordering', () => {
  function group(id, claims, overrides = {}) {
    return {
      id,
      keywords: [id],
      claims,
      sourceCount: new Set(claims.map(c => c.source)).size,
      avgCredibility: claims.reduce((s, c) => s + c.credibility, 0) / claims.length,
      ...overrides
    };
  }

  function claim(text, url, credibility = 0.7) {
    return { claim: text, source: url, credibility };
  }

  test('one source cannot supply every finding', () => {
    const ro = orchestrator();
    const hogged = Array.from({ length: 8 }, (_, i) =>
      group(`hog${i}`, [claim(`Claim number ${i} describes a detection technique.`, 'https://one.example/a')])
    );
    const others = [
      group('o1', [claim('DataDome scores requests on behavioural signals.', 'https://two.example/b')]),
      group('o2', [claim('Akamai deploys sensor JavaScript on protected pages.', 'https://three.example/c')])
    ];

    const findings = ro.generateKeyFindings([...hogged, ...others], []);
    const fromHog = findings.filter(f => f.sources[0] === 'https://one.example/a');

    assert.ok(fromHog.length <= 4, `one source contributed ${fromHog.length} of ${findings.length} findings`);
    assert.equal(new Set(findings.map(f => f.sources[0])).size, 3, 'all three sources represented');
  });

  test('the first five findings are not dominated by one source', () => {
    // deepResearch.js outputFormat 'summary' returns results.findings.slice(0, 5),
    // which is how the live sweep saw "all five findings from one URL". An
    // aggregate cap does not constrain a prefix; the interleave does.
    // As in the live run: every group from the stronger source outranks every
    // group from the weaker one, so ranking alone puts them in one block.
    const ro = orchestrator();
    const groups = [];
    for (const [host, top] of [['https://first.example/a', 0.9], ['https://second.example/b', 0.6]]) {
      for (let i = 0; i < 5; i++) {
        groups.push(group(`${host}-${i}`, [claim(`Claim ${i} from ${host} about bot detection.`, host, top - i * 0.01)]));
      }
    }

    const top5 = ro.generateKeyFindings(groups, []).slice(0, 5);
    const perSource = top5.reduce((acc, f) => {
      acc[f.sources[0]] = (acc[f.sources[0]] || 0) + 1;
      return acc;
    }, {});

    assert.equal(Object.keys(perSource).length, 2, 'both sources appear in the top five');
    assert.ok(Math.max(...Object.values(perSource)) <= 3, `one source took ${JSON.stringify(perSource)}`);
  });

  test('depth from the strongest sources beats one line each from every thin source', () => {
    // Five sources with two groups each, plus a weak single-group source. The
    // slots go to a second finding from the strong five rather than to the
    // sixth source: interleaving every source produced a run whose findings
    // included a bot-check interstitial (live 2026-08-28).
    const ro = orchestrator();
    const groups = [];
    ['a', 'b', 'c', 'd', 'e'].forEach((host, h) => {
      for (let i = 0; i < 2; i++) {
        const url = `https://${host}.example/x`;
        groups.push(group(`${host}${i}`, [claim(`Claim ${i} from ${host} on bot detection.`, url, 0.9 - h * 0.05 - i * 0.01)]));
      }
    });
    groups.push(group('thin', [claim('A thin page says little about bots.', 'https://thin.example/z', 0.4)]));

    const findings = ro.generateKeyFindings(groups, []);
    const domains = findings.map(f => new URL(f.sources[0]).hostname);

    assert.equal(findings.length, 10);
    assert.equal(new Set(domains.slice(0, 5)).size, 5, 'the summary slice spans five sources');
    assert.ok(!domains.includes('thin.example'), 'the weakest source yields to depth');
  });

  test('the cap is not applied when only one source produced claims', () => {
    const ro = orchestrator();
    const groups = Array.from({ length: 6 }, (_, i) =>
      group(`g${i}`, [claim(`Single-source claim ${i} about bot detection.`, 'https://only.example/a')])
    );

    assert.equal(ro.generateKeyFindings(groups, []).length, 6);
  });

  test('a corroborated group outranks a lone claim listed before it', () => {
    const ro = orchestrator();
    const lone = group('lone', [claim('A single unverified statement.', 'https://one.example/a', 0.9)]);
    const corroborated = group('corroborated', [
      claim('Two sources agree that JA3 fingerprinting is widespread.', 'https://two.example/b', 0.6),
      claim('JA3 fingerprinting is widespread across CDNs.', 'https://three.example/c', 0.6)
    ]);

    const findings = ro.generateKeyFindings([lone, corroborated], []);

    assert.equal(findings[0].supportingClaims, 2, 'corroborated group ranks first');
  });

  test('findings are ordered by consensus strength, not by input order', () => {
    const ro = orchestrator();
    // Equal claim counts, so only consensus strength can separate them. Input
    // order is deliberately the reverse of strength order: the pre-fix sort
    // compared undefined with undefined and preserved input order.
    const weak = group('weak', [claim('A weakly supported statement about bots.', 'https://one.example/a', 0.35)]);
    const strong = group('strong', [claim('A strongly supported statement about bots.', 'https://two.example/b', 0.95)]);

    const findings = ro.generateKeyFindings([weak, strong], []);

    assert.equal(findings[0].finding, 'A strongly supported statement about bots.');
  });
});

describe('4.4 vendor self-description is not a research conclusion', () => {
  test('recognises a vendor promoting itself, and leaves third-party prose alone', () => {
    assert.equal(
      isVendorSelfPromotion(
        'Scrape.do is the most reliable solution for bypassing anti-bot protection.',
        'https://scrape.do/blog/anti-bot'
      ),
      true
    );
    assert.equal(
      isVendorSelfPromotion(
        'Cloudflare Bot Management scores requests using machine learning.',
        'https://blog.cloudflare.com/bot-management'
      ),
      false,
      'a factual claim on a vendor domain is not promotion'
    );
    assert.equal(brandFromUrl('https://scrape.do/blog'), 'scrape');
  });

  test('a promotional claim is down-weighted and flagged, a factual one is not', async () => {
    const ro = withKeypoints(orchestrator(), {
      'content-a': [
        'Scrape.do offers the best anti-bot bypass with unlimited bandwidth.',
        'Scrape.do rotates residential proxies on every request.'
      ]
    });

    const claims = await ro.extractKeyClaims([
      source({ link: 'https://scrape.do/anti-bot', extractedContent: 'content-a', overallCredibility: 0.8 })
    ]);

    const promo = claims.find(c => c.promotional);
    const factual = claims.find(c => !c.promotional);

    assert.ok(promo, 'the marketing claim is flagged');
    assert.equal(promo.credibility, 0.4, 'credibility halved');
    assert.equal(factual.credibility, 0.8, 'the factual claim keeps its credibility');
  });

  test('promotional findings are withheld from the aiSummary input', async () => {
    const ro = withKeypoints(orchestrator(), {
      'content-a': ['Scrape.do offers the best anti-bot bypass with unlimited bandwidth.'],
      'content-b': [ON_TOPIC_CLAIM]
    });
    ro.initializeResearchSession('s2', 'anti-bot systems', Date.now());
    ro.enableLLMFeatures = true;

    let sentToLLM = null;
    ro.llmManager.synthesizeFindings = async findings => {
      sentToLLM = findings;
      return { summary: 'ok', keyInsights: [], themes: [], confidence: 0.6 };
    };

    const synthesis = await ro.synthesizeInformation(
      [
        source({ link: 'https://scrape.do/anti-bot', extractedContent: 'content-a' }),
        source({ link: 'https://tendem.ai/anti-bot', extractedContent: 'content-b' })
      ],
      'anti-bot systems'
    );

    assert.ok(synthesis.keyFindings.some(f => f.promotional), 'the promotional finding is still reported');
    assert.ok(sentToLLM, 'synthesis was attempted');
    assert.deepEqual(sentToLLM.map(f => f.finding), [ON_TOPIC_CLAIM]);
  });

  test('one vendor pitching another vendor\'s product is promotional too', async () => {
    // Live 2026-08-28: firecrawl.dev describing Zyte's product reached the
    // aiSummary unflagged, which concluded "The dominant approach involves
    // utilizing specialized APIs like Zyte". Self-reference cannot see that —
    // the page names neither its own brand nor "we".
    const page = 'A comparison of scraping tooling in 2026.';

    const ro = withKeypoints(orchestrator(), {
      [page]: [
        'Their flagship product, Zyte API, is a web scraping API designed to unblock and render any website.',
        'Anti-bot systems fingerprint the TLS handshake before any JavaScript runs.'
      ]
    });

    const claims = await ro.extractKeyClaims([
      source({ link: 'https://www.firecrawl.dev/blog/tools', extractedContent: page })
    ]);

    assert.equal(claims.find(c => c.claim.includes('Zyte')).promotional, true, 'a peer vendor pitch is promotional');
    assert.equal(claims.find(c => c.claim.includes('TLS handshake')).promotional, false, 'a technical claim on the same page is not');
  });

  test('the shape test separates recommendations from claims about anti-bot systems', () => {
    // Both halves must match: a named offering as subject AND a predicate that
    // credits it with doing the work. Sentences taken verbatim from the live
    // runs — the first three were laundered into aiSummary, the rest are the
    // material that answers the question and must survive.
    const recommendations = [
      'Their flagship product, Zyte API, is a web scraping API designed to unblock, render, and extract data from any website.',
      'They maintain Scrapy, the most widely used Python web crawling framework, and their API was ranked #1 by Proxyway in their 2025 report.',
      'Zyte also offers Scrapy Cloud for hosting and scheduling Scrapy spiders, a Managed Data service for hands-off data feeds.'
    ];
    const evidence = [
      'CF-RAY in the response header means Cloudflare; _abck means Akamai; a bare 429 with no body means Kasada.',
      'Modern anti-bot systems do not just block IP addresses – they fingerprint your TLS handshake and analyze your browser environment.',
      'Cloudflare Bot Management scores every request using TLS and JA3 fingerprints.',
      'DataDome blocks roughly 5 billion automated requests every day.',
      'Before you write any bypass code, you need one thing, the vendor name.'
    ];

    for (const text of recommendations) {
      assert.equal(isProductRecommendation(text), true, `recommendation: ${text.slice(0, 50)}`);
    }
    for (const text of evidence) {
      assert.equal(isProductRecommendation(text), false, `evidence: ${text.slice(0, 50)}`);
    }
  });

  test('the publisher is irrelevant: same sentence, editorial domain, still flagged', async () => {
    // Domain-independent by construction. A page-level "is this a vendor" test
    // cannot work here anyway: extractKeyClaims sees post-Readability article
    // text, and Readability strips the pricing/sign-up chrome that marks a
    // vendor site — firecrawl.dev's own comparison post extracted 14,309 chars
    // containing one commercial signal.
    const editorial = 'An independent review of scraping tooling in 2026. Nothing is sold here.';
    const ro = withKeypoints(orchestrator(), {
      [editorial]: [
        'Their flagship product, Zyte API, is designed to render any website.',
        'Scrapy is the most widely used Python crawling framework.'
      ]
    });

    const claims = await ro.extractKeyClaims([
      source({ link: 'https://news.example/review', extractedContent: editorial })
    ]);

    assert.equal(claims.find(c => c.claim.includes('Zyte')).promotional, true);
    assert.equal(
      claims.find(c => c.claim.includes('Scrapy')).promotional,
      false,
      'a popularity fact with no pitch predicate stays a claim'
    );
  });

  test('an all-promotional run still gets synthesized rather than blanked', async () => {
    const ro = withKeypoints(orchestrator(), {
      'content-a': ['Scrape.do offers the best anti-bot bypass with unlimited bandwidth.']
    });
    ro.initializeResearchSession('s3', 'anti-bot systems', Date.now());
    ro.enableLLMFeatures = true;

    let sentToLLM = null;
    ro.llmManager.synthesizeFindings = async findings => {
      sentToLLM = findings;
      return { summary: 'ok', keyInsights: [], themes: [], confidence: 0.6 };
    };

    await ro.synthesizeInformation(
      [source({ link: 'https://scrape.do/anti-bot', extractedContent: 'content-a' })],
      'anti-bot systems'
    );

    assert.equal(sentToLLM.length, 1);
  });
});

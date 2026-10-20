/**
 * R25 Phase 4 regressions: track_changes history similarity and deep_research
 * finding quality.
 *
 * Run: CRAWLFORGE_CREATOR_SECRET= CACHE_ENABLE_DISK=false node --test --test-force-exit tests/unit/r25-phase4-c.test.js
 *
 * Repros (R25 sweep, 2026-10-19):
 * - get_history on https://httpbin.org/uuid (a fresh UUID per request, same
 *   size) reported similarity 1.0: SnapshotManager estimated it from size.
 * - deep_research findings listed one URL several times in `sources`.
 * - deep_research findings were raw fragments: "Built-in encryption\nQUIC was
 *   built with security in mind from the outset.", citation markers kept, and
 *   claims from off-topic sources reported through the admission fallback.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { SnapshotManager } from '../../src/core/SnapshotManager.js';
import { ResearchOrchestrator, claimStatements } from '../../src/core/ResearchOrchestrator.js';

const dirs = [];
after(async () => {
  await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
});

function manager(overrides = {}) {
  const base = path.join(os.tmpdir(), `r25p4c-${Math.random().toString(36).slice(2)}`);
  dirs.push(base);
  return new SnapshotManager({
    storageDir: base,
    retentionPolicy: { autoCleanup: false },
    ...overrides
  });
}

// Two httpbin.org/uuid bodies: same length, different content.
const UUID_A = '{\n  "uuid": "0b0b9a6e-6a3f-4e0e-9a43-1f7f3b5d2c11"\n}\n';
const UUID_B = '{\n  "uuid": "7c2d51f4-93b8-4a51-8d0e-5e6a9c4b8f02"\n}\n';
const URL_ = 'https://httpbin.org/uuid';

describe('track_changes history similarity is computed from content', () => {
  test('same size, different content does not score 1.0', async () => {
    assert.equal(UUID_A.length, UUID_B.length);
    const sm = manager();
    await sm.storeSnapshot(URL_, UUID_A, { timestamp: 1000 });
    await sm.storeSnapshot(URL_, UUID_B, { timestamp: 2000 });

    const { history } = await sm.getChangeHistory(URL_);

    assert.equal(history.length, 1);
    assert.equal(history[0].changes.hashChanged, true);
    assert.ok(history[0].changes.similarity < 1, `similarity ${history[0].changes.similarity}`);
    await sm.shutdown();
  });

  test('same repro read back from disk: an uncompressed snapshot is text, not a Buffer', async () => {
    // A restarted server has an empty snapshot cache, so get_history reads
    // every snapshot from disk; the small httpbin body is stored uncompressed.
    const sm = manager({ cacheEnabled: false });
    const stored = await sm.storeSnapshot(URL_, UUID_A, { timestamp: 1000 });
    await sm.storeSnapshot(URL_, UUID_B, { timestamp: 2000 });

    assert.equal((await sm.retrieveSnapshot(stored.snapshotId)).content, UUID_A);
    const { history } = await sm.getChangeHistory(URL_);
    assert.equal(typeof history[0].changes.similarity, 'number');
    assert.ok(history[0].changes.similarity < 1);
    await sm.shutdown();
  });

  test('reads content back from disk (no cache, gzip) for a chain of snapshots', async () => {
    const sm = manager({ cacheEnabled: false, retentionPolicy: { autoCleanup: false, compressionThreshold: 1024 } });
    const page = words => `<p>${words.join(' ')}</p>` + ' padding'.repeat(300);
    await sm.storeSnapshot(URL_, page(['alpha', 'beta', 'gamma']), { timestamp: 1000 });
    await sm.storeSnapshot(URL_, page(['alpha', 'beta', 'gamma']), { timestamp: 2000 });
    await sm.storeSnapshot(URL_, page(['delta', 'epsilon', 'zeta']), { timestamp: 3000 });

    const { history } = await sm.getChangeHistory(URL_);

    assert.equal(history.length, 2);
    // Newest first: 3000 vs 2000 changed, 2000 vs 1000 identical.
    assert.ok(history[0].changes.similarity > 0 && history[0].changes.similarity < 1);
    assert.equal(history[1].changes.similarity, 1);
    await sm.shutdown();
  });

  test('similarity is null, not a size estimate, when content cannot be read', async () => {
    const sm = manager();
    const metrics = await sm.calculateChangeMetrics(
      { metadata: { contentLength: 10, timestamp: 1, contentHash: 'a' } },
      { metadata: { contentLength: 10, timestamp: 2, contentHash: 'b' } }
    );
    assert.equal(metrics.similarity, null);
    await sm.shutdown();
  });
});

function orchestrator() {
  const ro = new ResearchOrchestrator({ searchConfig: { apiKey: 'test-key' } });
  ro.llmManager.scoreClaimRelevance = async () => [];
  ro.llmManager.groupClaimsBySimilarity = async () => [];
  return ro;
}

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

describe('deep_research findings list each source once', () => {
  test('a group of three claims from one page lists the page once', () => {
    const ro = orchestrator();
    const page = 'https://www.zscaler.com/blogs/quic';
    const claims = [
      'One of QUIC\'s main advantages is its reduced latency.',
      'QUIC was built with security in mind from the outset.',
      'QUIC multiplexes streams over a single connection.'
    ].map(text => ({ claim: text, source: page, credibility: 0.6 }));

    const [finding] = ro.generateKeyFindings([ro.buildClaimGroup('g', claims)], []);

    assert.deepEqual(finding.sources, [page]);
    assert.equal(finding.supportingSources, 1);
    assert.equal(finding.supportingClaims, 3);
  });
});

describe('deep_research claims are standalone statements', () => {
  test('heading lines are split from the sentence and citation markers removed', () => {
    assert.deepEqual(
      claimStatements('Built-in encryption\nQUIC was built with security in mind from the outset (3).'),
      ['Built-in encryption', 'QUIC was built with security in mind from the outset.']
    );
    assert.deepEqual(
      claimStatements('Key benefits:\n- Faster handshakes\n• Streams avoid head-of-line blocking [2, 3]'),
      ['Key benefits:', 'Faster handshakes', 'Streams avoid head-of-line blocking']
    );
  });

  test('wrapped lines are joined, years and inline parentheses kept', () => {
    assert.deepEqual(
      claimStatements('QUIC was standardised\nby the IETF in RFC 9000 (2021), with 1-RTT (or 0-RTT) setup [12].'),
      ['QUIC was standardised by the IETF in RFC 9000 (2021), with 1-RTT (or 0-RTT) setup.']
    );
  });

  test('extractKeyClaims admits the sentence, not the heading-plus-sentence block', async () => {
    const ro = withKeypoints(orchestrator(), {
      'content-a': [
        'Faster connection establishment\n1 RTT Connection Establishment\nHTTP/3 and QUIC offer 1-RTT connection establishment, while HTTP/2 requires 3 RTT (4).'
      ]
    });

    const claims = await ro.extractKeyClaims([source()]);

    assert.deepEqual(claims.map(c => c.claim), [
      'HTTP/3 and QUIC offer 1-RTT connection establishment, while HTTP/2 requires 3 RTT.'
    ]);
  });

  test('claims from an off-topic source are dropped even when nothing else survives', async () => {
    const ro = withKeypoints(orchestrator(), {
      'content-a': ['IBM Cloud offers managed Kubernetes clusters in every region.']
    });

    const claims = await ro.extractKeyClaims([source({ relevanceScore: 0.1 })]);

    assert.deepEqual(claims, []);
  });
});

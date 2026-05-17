/**
 * Unit tests for src/core/JobManager.js
 *
 * Run: node --test tests/unit/jobManager.test.js
 *
 * Tests cover:
 *   - createJob: correct initial state, event emission, stats increment
 *   - getJob / getJobsByStatus / getJobsByType / getJobsByTag
 *   - updateJobStatus: state transitions, field updates, stats
 *   - executeJob: happy path, no-executor failure, retry logic
 *   - cancelJob: cancels pending/running, throws on terminal states
 *   - addJobLog: caps at 100 entries
 *   - updateJobProgress: clamps 0-100
 *   - checkDependencies: met/unmet
 *   - cleanupExpiredJobs: removes expired entries
 *   - validateJob: structural checks
 *   - generateJobId: returns UUID-like strings
 *   - destroy: clears data and timers
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { JobManager } from '../../src/core/JobManager.js';

// Use a temp dir for persistence so tests don't pollute ./jobs
function makeTempJobManager(overrides = {}) {
  const storageDir = path.join(os.tmpdir(), `jm-test-${Math.random().toString(36).slice(2)}`);
  return new JobManager({
    storageDir,
    enablePersistence: false, // keep tests fast and side-effect free
    enableMonitoring: false,
    cleanupInterval: 24 * 60 * 60 * 1000, // long — don't fire during tests
    ...overrides
  });
}

// ── createJob ──────────────────────────────────────────────────────────────

test('JobManager: createJob returns a job with pending status and correct shape', async () => {
  const jm = makeTempJobManager();
  const job = await jm.createJob('scrape', { url: 'https://example.com' });

  assert.equal(typeof job.id, 'string');
  assert.equal(job.type, 'scrape');
  assert.deepEqual(job.data, { url: 'https://example.com' });
  assert.equal(job.status, 'pending');
  assert.equal(job.progress, 0);
  assert.ok(Array.isArray(job.logs));
  assert.ok(job.createdAt > 0);
  assert.ok(job.expiresAt > job.createdAt);

  jm.destroy();
});

test('JobManager: createJob increments stats.totalJobs', async () => {
  const jm = makeTempJobManager();
  const before = jm.stats.totalJobs;
  await jm.createJob('test', {});
  assert.equal(jm.stats.totalJobs, before + 1);
  jm.destroy();
});

test('JobManager: createJob emits jobCreated event', async () => {
  const jm = makeTempJobManager();
  let emitted = null;
  jm.on('jobCreated', (job) => { emitted = job; });
  const job = await jm.createJob('emit-test', {});
  assert.equal(emitted?.id, job.id);
  jm.destroy();
});

// ── getJob ─────────────────────────────────────────────────────────────────

test('JobManager: getJob returns null for unknown ID', () => {
  const jm = makeTempJobManager();
  assert.equal(jm.getJob('no-such-id'), null);
  jm.destroy();
});

test('JobManager: getJob retrieves created job by ID', async () => {
  const jm = makeTempJobManager();
  const job = await jm.createJob('lookup', {});
  const found = jm.getJob(job.id);
  assert.equal(found?.id, job.id);
  jm.destroy();
});

// ── getJobsByStatus ────────────────────────────────────────────────────────

test('JobManager: getJobsByStatus returns matching jobs', async () => {
  const jm = makeTempJobManager();
  const job = await jm.createJob('type-a', {});
  const pending = jm.getJobsByStatus('pending');
  assert.ok(pending.some(j => j.id === job.id));
  jm.destroy();
});

test('JobManager: getJobsByStatus returns empty array for unknown status', () => {
  const jm = makeTempJobManager();
  assert.deepEqual(jm.getJobsByStatus('nonexistent-status'), []);
  jm.destroy();
});

// ── getJobsByType / getJobsByTag ───────────────────────────────────────────

test('JobManager: getJobsByType filters by type', async () => {
  const jm = makeTempJobManager();
  await jm.createJob('crawl', {});
  await jm.createJob('scrape', {});
  const crawls = jm.getJobsByType('crawl');
  assert.ok(crawls.every(j => j.type === 'crawl'));
  assert.ok(crawls.length >= 1);
  jm.destroy();
});

test('JobManager: getJobsByTag filters by tag', async () => {
  const jm = makeTempJobManager();
  await jm.createJob('tagged', {}, { tags: ['priority'] });
  await jm.createJob('untagged', {});
  const tagged = jm.getJobsByTag('priority');
  assert.ok(tagged.every(j => j.tags.includes('priority')));
  assert.ok(tagged.length >= 1);
  jm.destroy();
});

// ── updateJobStatus ────────────────────────────────────────────────────────

test('JobManager: updateJobStatus changes status and sets timestamps correctly', async () => {
  const jm = makeTempJobManager();
  const job = await jm.createJob('transition', {});

  await jm.updateJobStatus(job.id, 'running');
  let updated = jm.getJob(job.id);
  assert.equal(updated.status, 'running');
  assert.ok(updated.startedAt > 0);

  await jm.updateJobStatus(job.id, 'completed', { result: { ok: true } });
  updated = jm.getJob(job.id);
  assert.equal(updated.status, 'completed');
  assert.ok(updated.completedAt > 0);
  assert.deepEqual(updated.result, { ok: true });

  jm.destroy();
});

test('JobManager: updateJobStatus throws for unknown job ID', async () => {
  const jm = makeTempJobManager();
  await assert.rejects(
    () => jm.updateJobStatus('ghost-id', 'running'),
    /not found/i
  );
  jm.destroy();
});

test('JobManager: failed status increments stats.failedJobs', async () => {
  const jm = makeTempJobManager();
  const job = await jm.createJob('will-fail', {});
  await jm.updateJobStatus(job.id, 'running');
  const before = jm.stats.failedJobs;
  await jm.updateJobStatus(job.id, 'failed', { error: 'oops' });
  assert.equal(jm.stats.failedJobs, before + 1);
  jm.destroy();
});

// ── executeJob ─────────────────────────────────────────────────────────────

test('JobManager: executeJob runs the registered executor and marks job completed', async () => {
  const jm = makeTempJobManager();
  jm.registerExecutor('compute', async (job) => ({ computed: job.data.x * 2 }));

  const job = await jm.createJob('compute', { x: 21 });
  const result = await jm.executeJob(job.id);

  assert.deepEqual(result, { computed: 42 });
  assert.equal(jm.getJob(job.id).status, 'completed');
  jm.destroy();
});

test('JobManager: executeJob throws when no executor is registered', async () => {
  const jm = makeTempJobManager();
  const job = await jm.createJob('unknown-type', {});
  await assert.rejects(
    () => jm.executeJob(job.id),
    /No executor registered/i
  );
  assert.equal(jm.getJob(job.id).status, 'failed');
  jm.destroy();
});

test('JobManager: executeJob throws for non-pending job', async () => {
  const jm = makeTempJobManager();
  jm.registerExecutor('do-it', async () => ({}));
  const job = await jm.createJob('do-it', {});
  await jm.executeJob(job.id); // marks it completed
  await assert.rejects(
    () => jm.executeJob(job.id),
    /not in pending status/i
  );
  jm.destroy();
});

// ── cancelJob ─────────────────────────────────────────────────────────────

test('JobManager: cancelJob changes status to cancelled and emits event', async () => {
  const jm = makeTempJobManager();
  let emitted = null;
  jm.on('jobCancelled', (job) => { emitted = job; });

  const job = await jm.createJob('to-cancel', {});
  await jm.cancelJob(job.id);

  assert.equal(jm.getJob(job.id).status, 'cancelled');
  assert.equal(emitted?.id, job.id);
  jm.destroy();
});

test('JobManager: cancelJob throws when job is already completed', async () => {
  const jm = makeTempJobManager();
  jm.registerExecutor('noop', async () => ({}));
  const job = await jm.createJob('noop', {});
  await jm.executeJob(job.id);
  await assert.rejects(
    () => jm.cancelJob(job.id),
    /cannot be cancelled/i
  );
  jm.destroy();
});

// ── addJobLog ──────────────────────────────────────────────────────────────

test('JobManager: addJobLog appends entries capped at 100', async () => {
  const jm = makeTempJobManager();
  const job = await jm.createJob('log-test', {});

  for (let i = 0; i < 110; i++) {
    await jm.addJobLog(job.id, 'info', `message ${i}`);
  }

  const updated = jm.getJob(job.id);
  assert.equal(updated.logs.length, 100, 'logs should be capped at 100 entries');
  jm.destroy();
});

// ── updateJobProgress ──────────────────────────────────────────────────────

test('JobManager: updateJobProgress clamps value to [0, 100]', async () => {
  const jm = makeTempJobManager();
  const job = await jm.createJob('progress', {});

  await jm.updateJobProgress(job.id, -10);
  assert.equal(jm.getJob(job.id).progress, 0, 'negative should clamp to 0');

  await jm.updateJobProgress(job.id, 150);
  assert.equal(jm.getJob(job.id).progress, 100, 'over-100 should clamp to 100');

  await jm.updateJobProgress(job.id, 50);
  assert.equal(jm.getJob(job.id).progress, 50);

  jm.destroy();
});

// ── checkDependencies ──────────────────────────────────────────────────────

test('JobManager: checkDependencies returns empty when no deps', async () => {
  const jm = makeTempJobManager();
  const job = await jm.createJob('no-deps', {}, { dependencies: [] });
  const unmet = await jm.checkDependencies(job);
  assert.deepEqual(unmet, []);
  jm.destroy();
});

test('JobManager: checkDependencies returns ids of incomplete deps', async () => {
  const jm = makeTempJobManager();
  const dep = await jm.createJob('dep', {});
  const main = await jm.createJob('main', {}, { dependencies: [dep.id] });
  const unmet = await jm.checkDependencies(main);
  assert.ok(unmet.includes(dep.id), 'pending dep should be listed as unmet');
  jm.destroy();
});

test('JobManager: checkDependencies returns empty when dep is completed', async () => {
  const jm = makeTempJobManager();
  jm.registerExecutor('dep-type', async () => ({}));
  const dep = await jm.createJob('dep-type', {});
  await jm.executeJob(dep.id);
  const main = await jm.createJob('main2', {}, { dependencies: [dep.id] });
  const unmet = await jm.checkDependencies(main);
  assert.deepEqual(unmet, []);
  jm.destroy();
});

// ── cleanupExpiredJobs ─────────────────────────────────────────────────────

test('JobManager: cleanupExpiredJobs removes jobs past their TTL', async () => {
  const jm = makeTempJobManager();
  const job = await jm.createJob('expire-me', {}, { ttl: 1 }); // 1ms TTL
  // Wait a moment so it expires
  await new Promise(r => setTimeout(r, 10));
  await jm.cleanupExpiredJobs();
  assert.equal(jm.getJob(job.id), null, 'expired job should have been removed');
  jm.destroy();
});

// ── validateJob ────────────────────────────────────────────────────────────

test('JobManager: validateJob returns true for a valid job object', async () => {
  const jm = makeTempJobManager();
  const job = await jm.createJob('validate-me', {});
  assert.equal(jm.validateJob(job), true);
  jm.destroy();
});

test('JobManager: validateJob returns false for invalid objects', () => {
  const jm = makeTempJobManager();
  assert.equal(jm.validateJob(null), false);
  assert.equal(jm.validateJob({}), false);
  assert.equal(jm.validateJob({ id: 'x', type: 'y', status: 'invalid-status' }), false);
  jm.destroy();
});

// ── generateJobId ──────────────────────────────────────────────────────────

test('JobManager: generateJobId produces unique UUID-like strings', () => {
  const jm = makeTempJobManager();
  const id1 = jm.generateJobId();
  const id2 = jm.generateJobId();
  assert.match(id1, /^[0-9a-f-]{36}$/i);
  assert.notEqual(id1, id2);
  jm.destroy();
});

// ── getStats ───────────────────────────────────────────────────────────────

test('JobManager: getStats returns expected shape', async () => {
  const jm = makeTempJobManager();
  await jm.createJob('stats-test', {});
  const stats = jm.getStats();
  assert.ok(typeof stats.totalJobs === 'number');
  assert.ok(typeof stats.jobCounts === 'object');
  assert.ok(typeof stats.jobCounts.pending === 'number');
  assert.ok(typeof stats.executorCount === 'number');
  jm.destroy();
});

// ── destroy ────────────────────────────────────────────────────────────────

test('JobManager: destroy clears all in-memory state', async () => {
  const jm = makeTempJobManager();
  await jm.createJob('before-destroy', {});
  jm.destroy();
  assert.equal(jm.jobs.size, 0);
  assert.equal(jm.executors.size, 0);
});

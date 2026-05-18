/**
 * Unit tests for scrape_with_actions recording / replay feature.
 *
 * Run: node --test tests/unit/scrapeWithActionsRecording.test.js
 *
 * Strategy:
 *   - All disk I/O is redirected to a per-test temp dir via
 *     process.env.CRAWLFORGE_HOME_OVERRIDE.
 *   - ActionExecutor.executeActionChain is stubbed so no Playwright is
 *     needed and tests remain fast.
 *   - Dynamic imports with cache-busting query strings ensure each test
 *     sees its own CRAWLFORGE_HOME_OVERRIDE value in the recorder module.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeTempDir() {
  const dir = path.join(os.tmpdir(), `cf-rec-test-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function removeTempDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// Minimal fake chain result used across tool-level tests
function makeFakeChainResult(actions) {
  const now = Date.now();
  const results = actions.map((a, i) => ({
    id: `action_${i}`,
    type: a.type,
    success: true,
    result: {},
    executionTime: 50,
    timestamp: now + i * 50,
    description: a.description
  }));

  return {
    success: true,
    results,
    screenshots: [],
    metadata: { finalUrl: 'https://example.com' }
  };
}

// Fake ActionExecutor stub
function makeFakeExecutor() {
  return {
    executeActionChain: async (_url, chainConfig) => {
      const actions = Array.isArray(chainConfig) ? chainConfig : chainConfig.actions;
      return makeFakeChainResult(actions);
    },
    getStats: () => ({}),
    destroy: async () => {}
  };
}

// Fake ExtractContentTool stub
function makeFakeExtract() {
  return {
    execute: async () => ({
      success: true,
      content: { text: 'page text', html: '<p>page</p>', markdown: '# page' },
      metadata: { title: 'Test Page' }
    })
  };
}

// ── Recorder module tests ─────────────────────────────────────────────────────

test('recordingName validation — accepts valid names', async () => {
  const { validateRecordingName } = await import(
    '../../src/tools/advanced/scrapeWithActions/recorder.js'
  );
  // Should not throw
  validateRecordingName('my-recording');
  validateRecordingName('abc123');
  validateRecordingName('A_B_C');
  validateRecordingName('a'.repeat(64));
});

test('recordingName validation — rejects invalid names', async () => {
  const { validateRecordingName } = await import(
    '../../src/tools/advanced/scrapeWithActions/recorder.js'
  );

  const bad = ['../evil', 'foo/bar', '', 'a'.repeat(65), 'has space', 'dot.dot'];
  for (const name of bad) {
    assert.throws(
      () => validateRecordingName(name),
      /Invalid recording name/,
      `Expected rejection for: "${name}"`
    );
  }
});

test('path traversal blocked by validateRecordingName', async () => {
  const { validateRecordingName } = await import(
    '../../src/tools/advanced/scrapeWithActions/recorder.js'
  );

  assert.throws(() => validateRecordingName('../../../etc/passwd'), /Invalid recording name/);
  assert.throws(() => validateRecordingName('foo/../bar'), /Invalid recording name/);
  assert.throws(() => validateRecordingName('/absolute'), /Invalid recording name/);
});

test('saveRecording writes JSON with correct shape', async () => {
  const tempDir = await makeTempDir();
  process.env.CRAWLFORGE_HOME_OVERRIDE = tempDir;

  try {
    const { saveRecording } = await import(
      `../../src/tools/advanced/scrapeWithActions/recorder.js?t=${Date.now()}`
    );

    const actions = [
      { type: 'click', selector: '#btn', timestamp_ms_since_start: 0 },
      { type: 'type', selector: '#inp', text: 'hello', timestamp_ms_since_start: 120 }
    ];

    const filePath = await saveRecording('test-rec', actions, { originalUrl: 'https://example.com' });

    assert.ok(filePath.endsWith('test-rec.json'), 'file path should end with test-rec.json');

    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    assert.equal(parsed.name, 'test-rec');
    assert.ok(typeof parsed.savedAt === 'string', 'savedAt should be a string');
    assert.equal(parsed.originalUrl, 'https://example.com');
    assert.deepEqual(parsed.recordedActions, actions);
  } finally {
    await removeTempDir(tempDir);
    delete process.env.CRAWLFORGE_HOME_OVERRIDE;
  }
});

test('saveRecording is atomic (no stale .tmp files left)', async () => {
  const tempDir = await makeTempDir();
  process.env.CRAWLFORGE_HOME_OVERRIDE = tempDir;

  try {
    const { saveRecording } = await import(
      `../../src/tools/advanced/scrapeWithActions/recorder.js?t=${Date.now() + 1}`
    );

    await saveRecording('atomic-test', [{ type: 'wait', duration: 100, timestamp_ms_since_start: 0 }]);

    const recDir = path.join(tempDir, '.crawlforge', 'recordings');
    const entries = await fs.readdir(recDir);
    const tmpFiles = entries.filter(f => f.endsWith('.tmp'));

    assert.equal(tmpFiles.length, 0, 'No .tmp files should remain after save');
  } finally {
    await removeTempDir(tempDir);
    delete process.env.CRAWLFORGE_HOME_OVERRIDE;
  }
});

test('loadRecording returns the saved recording', async () => {
  const tempDir = await makeTempDir();
  process.env.CRAWLFORGE_HOME_OVERRIDE = tempDir;

  try {
    const { saveRecording, loadRecording } = await import(
      `../../src/tools/advanced/scrapeWithActions/recorder.js?t=${Date.now() + 2}`
    );

    const actions = [{ type: 'scroll', direction: 'down', distance: 200, timestamp_ms_since_start: 0 }];
    await saveRecording('load-test', actions);

    const loaded = await loadRecording('load-test');
    assert.equal(loaded.name, 'load-test');
    assert.deepEqual(loaded.recordedActions, actions);
  } finally {
    await removeTempDir(tempDir);
    delete process.env.CRAWLFORGE_HOME_OVERRIDE;
  }
});

test('loadRecording errors clearly when recording does not exist', async () => {
  const tempDir = await makeTempDir();
  process.env.CRAWLFORGE_HOME_OVERRIDE = tempDir;

  try {
    const { loadRecording } = await import(
      `../../src/tools/advanced/scrapeWithActions/recorder.js?t=${Date.now() + 3}`
    );

    await assert.rejects(
      () => loadRecording('does-not-exist'),
      /Recording "does-not-exist" not found/
    );
  } finally {
    await removeTempDir(tempDir);
    delete process.env.CRAWLFORGE_HOME_OVERRIDE;
  }
});

test('listRecordings returns names of saved recordings', async () => {
  const tempDir = await makeTempDir();
  process.env.CRAWLFORGE_HOME_OVERRIDE = tempDir;

  try {
    const { saveRecording, listRecordings } = await import(
      `../../src/tools/advanced/scrapeWithActions/recorder.js?t=${Date.now() + 4}`
    );

    assert.deepEqual(await listRecordings(), [], 'empty dir returns []');

    await saveRecording('alpha', [{ type: 'wait', duration: 50, timestamp_ms_since_start: 0 }]);
    await saveRecording('beta', [{ type: 'wait', duration: 50, timestamp_ms_since_start: 0 }]);

    const names = await listRecordings();
    assert.deepEqual(names, ['alpha', 'beta']);
  } finally {
    await removeTempDir(tempDir);
    delete process.env.CRAWLFORGE_HOME_OVERRIDE;
  }
});

// ── ScrapeWithActionsTool integration tests (mocked ActionExecutor) ───────────

test('record mode saves a recording file', async () => {
  const tempDir = await makeTempDir();
  process.env.CRAWLFORGE_HOME_OVERRIDE = tempDir;

  try {
    const { ScrapeWithActionsTool } = await import(
      `../../src/tools/advanced/ScrapeWithActionsTool.js?t=${Date.now() + 10}`
    );

    const tool = new ScrapeWithActionsTool({
      actionExecutor: makeFakeExecutor(),
      extractContentTool: makeFakeExtract(),
      enableLogging: false
    });

    const result = await tool.execute({
      url: 'https://example.com',
      actions: [
        {
          type: 'click',
          selector: '#btn',
          continueOnError: false,
          retries: 0,
          captureAfter: false,
          clickCount: 1,
          delay: 0,
          force: false,
          button: 'left'
        }
      ],
      record: true,
      recordingName: 'my-test-recording'
    });

    assert.equal(result.success, true);
    assert.equal(result.recordingSaved, true);
    assert.ok(result.recordingPath, 'recordingPath should be set');

    const raw = await fs.readFile(result.recordingPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.name, 'my-test-recording');
    assert.ok(Array.isArray(parsed.recordedActions));
    assert.ok(parsed.recordedActions.length > 0);
    assert.ok(parsed.recordedActions[0].type, 'recorded entry must have a type');
    assert.ok('timestamp_ms_since_start' in parsed.recordedActions[0], 'must have timing field');
  } finally {
    await removeTempDir(tempDir);
    delete process.env.CRAWLFORGE_HOME_OVERRIDE;
  }
});

test('__list__ returns available recording names', async () => {
  const tempDir = await makeTempDir();
  process.env.CRAWLFORGE_HOME_OVERRIDE = tempDir;

  try {
    // Pre-populate a recording directly via the recorder module
    const { saveRecording } = await import(
      `../../src/tools/advanced/scrapeWithActions/recorder.js?t=${Date.now() + 20}`
    );
    await saveRecording('rec-one', [{ type: 'wait', duration: 50, timestamp_ms_since_start: 0 }]);

    const { ScrapeWithActionsTool } = await import(
      `../../src/tools/advanced/ScrapeWithActionsTool.js?t=${Date.now() + 21}`
    );

    const tool = new ScrapeWithActionsTool({
      actionExecutor: makeFakeExecutor(),
      extractContentTool: makeFakeExtract(),
      enableLogging: false
    });
    const result = await tool.execute({
      url: 'https://example.com',
      replayRecording: '__list__'
    });

    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.recordings));
    assert.ok(result.recordings.includes('rec-one'));
  } finally {
    await removeTempDir(tempDir);
    delete process.env.CRAWLFORGE_HOME_OVERRIDE;
  }
});

test('missing recording errors clearly', async () => {
  const tempDir = await makeTempDir();
  process.env.CRAWLFORGE_HOME_OVERRIDE = tempDir;

  try {
    const { ScrapeWithActionsTool } = await import(
      `../../src/tools/advanced/ScrapeWithActionsTool.js?t=${Date.now() + 30}`
    );

    const tool = new ScrapeWithActionsTool({
      actionExecutor: makeFakeExecutor(),
      extractContentTool: makeFakeExtract(),
      enableLogging: false
    });

    await assert.rejects(
      () => tool.execute({ url: 'https://example.com', replayRecording: 'ghost-recording' }),
      /ghost-recording.*not found|not found.*ghost-recording/i
    );
  } finally {
    await removeTempDir(tempDir);
    delete process.env.CRAWLFORGE_HOME_OVERRIDE;
  }
});

test('backward compat — existing calls without record/replayRecording still work', async () => {
  const tempDir = await makeTempDir();
  process.env.CRAWLFORGE_HOME_OVERRIDE = tempDir;

  try {
    const { ScrapeWithActionsTool } = await import(
      `../../src/tools/advanced/ScrapeWithActionsTool.js?t=${Date.now() + 40}`
    );

    const tool = new ScrapeWithActionsTool({
      actionExecutor: makeFakeExecutor(),
      extractContentTool: makeFakeExtract(),
      enableLogging: false
    });

    const result = await tool.execute({
      url: 'https://example.com',
      actions: [
        { type: 'wait', duration: 100, continueOnError: false, retries: 0, captureAfter: false }
      ]
    });

    assert.equal(result.success, true);
    assert.equal(result.recordingSaved, undefined, 'recordingSaved should be absent when not recording');
    assert.equal(result.replayedFrom, undefined, 'replayedFrom should be absent');
  } finally {
    await removeTempDir(tempDir);
    delete process.env.CRAWLFORGE_HOME_OVERRIDE;
  }
});

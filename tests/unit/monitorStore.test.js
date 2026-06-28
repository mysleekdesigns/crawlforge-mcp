/**
 * MonitorStore (v4.8) — per-file JSON persistence for scheduled monitors.
 * Run: node --test tests/unit/monitorStore.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MonitorStore } from '../../src/core/MonitorStore.js';

describe('MonitorStore', () => {
  test('save -> load round-trip across instances', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cf-ms-')), 'monitors');
    const a = new MonitorStore({ storageDir: dir });
    const id = a.newId();
    await a.save({ id, url: 'https://x.test/', interval: 60000, enabled: true });

    const b = new MonitorStore({ storageDir: dir });
    await b.load();
    assert.equal(b.list().length, 1);
    assert.equal(b.get(id).url, 'https://x.test/');
  });

  test('remove deletes from memory and disk', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cf-ms-')), 'monitors');
    const s = new MonitorStore({ storageDir: dir });
    const id = s.newId();
    await s.save({ id, url: 'https://y.test/' });
    assert.equal(await s.remove(id), true);
    assert.equal(s.get(id), undefined);

    const fresh = new MonitorStore({ storageDir: dir });
    await fresh.load();
    assert.equal(fresh.list().length, 0);
  });

  test('load tolerates a missing directory', async () => {
    const s = new MonitorStore({ storageDir: join(tmpdir(), 'cf-ms-missing-' + Math.random().toString(36).slice(2)) });
    await s.load();
    assert.equal(s.list().length, 0);
  });
});

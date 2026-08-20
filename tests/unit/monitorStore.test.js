/**
 * MonitorStore (v4.8) — per-file JSON persistence for scheduled monitors.
 * Run: node --test tests/unit/monitorStore.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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

  test('default storageDir is ~/.crawlforge/monitors, not cwd-relative', () => {
    const s = new MonitorStore();
    assert.equal(s.storageDir, join(homedir(), '.crawlforge', 'monitors'));
  });

  test('explicit storageDir override is kept and disarms legacy migration', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cf-ms-')), 'monitors');
    const s = new MonitorStore({ storageDir: dir });
    assert.equal(s.storageDir, dir);
    assert.equal(s._legacyDir, null);
  });

  test('load migrates legacy ./monitors files into the store', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cf-ms-mig-'));
    const storageDir = join(base, 'new-store');
    const legacyDir = join(base, 'legacy-monitors');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'aaa.json'), JSON.stringify({ id: 'aaa', url: 'https://a.test/' }));
    writeFileSync(join(legacyDir, 'bbb.json'), JSON.stringify({ id: 'bbb', url: 'https://b.test/' }));

    const s = new MonitorStore({ storageDir, legacyDir });
    await s.load();

    assert.equal(s.list().length, 2);
    assert.equal(s.get('aaa').url, 'https://a.test/');
    // Files were MOVED into the new store and the emptied legacy dir removed.
    assert.ok(existsSync(join(storageDir, 'aaa.json')));
    assert.ok(existsSync(join(storageDir, 'bbb.json')));
    assert.equal(existsSync(legacyDir), false);

    // A fresh instance sees the migrated monitors without the legacy dir.
    const fresh = new MonitorStore({ storageDir });
    await fresh.load();
    assert.equal(fresh.list().length, 2);
  });

  test('legacy migration skips existing ids and tolerates corrupt files', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cf-ms-mig-'));
    const storageDir = join(base, 'new-store');
    const legacyDir = join(base, 'legacy-monitors');
    mkdirSync(storageDir, { recursive: true });
    mkdirSync(legacyDir, { recursive: true });
    // Already present in the new store — the legacy copy must NOT overwrite it.
    writeFileSync(join(storageDir, 'dup.json'), JSON.stringify({ id: 'dup', url: 'https://new.test/' }));
    writeFileSync(join(legacyDir, 'dup.json'), JSON.stringify({ id: 'dup', url: 'https://old.test/' }));
    writeFileSync(join(legacyDir, 'broken.json'), '{not json');
    writeFileSync(join(legacyDir, 'ok.json'), JSON.stringify({ id: 'ok', url: 'https://ok.test/' }));

    const s = new MonitorStore({ storageDir, legacyDir });
    await s.load();

    assert.equal(s.get('dup').url, 'https://new.test/');
    assert.equal(s.get('ok').url, 'https://ok.test/');
    // Skipped/corrupt files stay behind; the non-empty legacy dir survives.
    assert.ok(existsSync(join(legacyDir, 'dup.json')));
    assert.ok(existsSync(join(legacyDir, 'broken.json')));
    assert.deepEqual(readdirSync(storageDir).sort(), ['dup.json', 'ok.json']);
  });

  test('no legacy migration runs when storageDir is overridden without legacyDir', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cf-ms-mig-'));
    const storageDir = join(base, 'new-store');
    const s = new MonitorStore({ storageDir });
    await s.load(); // must not touch any cwd-relative ./monitors dir
    assert.equal(s.list().length, 0);
  });
});

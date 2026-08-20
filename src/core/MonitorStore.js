/**
 * MonitorStore — disk persistence for scheduled change-monitors.
 *
 * One JSON file per monitor under <os.homedir()>/.crawlforge/monitors/<id>.json
 * (same base dir as ~/.crawlforge/config.json and ~/.crawlforge/snapshots —
 * user state must never depend on process.cwd(), or monitor:create from dir X
 * and monitor:stop / monitor:run-due from dir Y silently see different stores).
 * Mirrors JobManager's persistence *pattern* (mkdir-recursive, per-file JSON,
 * randomUUID, load-on-start) but deliberately omits TTL/eviction — scheduled
 * monitors are long-lived and must never be auto-expired.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class MonitorStore {
  constructor({ storageDir, legacyDir } = {}) {
    this.storageDir = storageDir || path.join(os.homedir(), '.crawlforge', 'monitors');
    // One-time best-effort migration source for stores created before v5.0.3,
    // when the default was cwd-relative './monitors'. Only armed when the
    // caller did NOT override storageDir (i.e. the default upgrade path), so
    // tests and embedders with explicit dirs never sweep files out of cwd —
    // unless they opt in by passing legacyDir explicitly.
    this._legacyDir = legacyDir ?? (storageDir ? null : path.resolve('./monitors'));
    this.monitors = new Map();
    this._loaded = false;
  }

  async load() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      const files = await fs.readdir(this.storageDir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const def = JSON.parse(await fs.readFile(path.join(this.storageDir, f), 'utf8'));
          if (def && def.id) this.monitors.set(def.id, def);
        } catch {
          /* skip corrupt file */
        }
      }
    } catch {
      /* dir unavailable — start empty */
    }
    await this._migrateLegacyDir();
    this._loaded = true;
    return this.monitors;
  }

  /**
   * Best-effort, idempotent migration of a legacy cwd-relative './monitors'
   * store into the new home-rooted store. Moves each parseable monitor file
   * whose id is not already present; skips (and leaves in place) everything
   * else. Never throws — a failed migration must not break monitor loading.
   */
  async _migrateLegacyDir() {
    if (!this._legacyDir) return;
    try {
      if (path.resolve(this._legacyDir) === path.resolve(this.storageDir)) return;
      const files = await fs.readdir(this._legacyDir); // throws if absent — caught below
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const from = path.join(this._legacyDir, f);
        try {
          const def = JSON.parse(await fs.readFile(from, 'utf8'));
          if (!def || !def.id || this.monitors.has(def.id)) continue; // skip existing ids
          await fs.mkdir(this.storageDir, { recursive: true });
          const to = path.join(this.storageDir, `${def.id}.json`);
          try {
            await fs.rename(from, to);
          } catch {
            // rename fails across filesystems (EXDEV) — copy+unlink instead
            await fs.copyFile(from, to);
            await fs.unlink(from).catch(() => {});
          }
          this.monitors.set(def.id, def);
        } catch {
          /* unreadable/corrupt legacy file — leave it, keep going */
        }
      }
      // Tidy up the legacy dir only if the migration emptied it.
      await fs.rmdir(this._legacyDir).catch(() => {});
    } catch {
      /* no legacy dir (the common case) or unreadable — nothing to migrate */
    }
  }

  newId() {
    return randomUUID();
  }

  async save(def) {
    this.monitors.set(def.id, def);
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      await fs.writeFile(
        path.join(this.storageDir, `${def.id}.json`),
        JSON.stringify(def, null, 2),
        'utf8'
      );
    } catch (err) {
      /* keep the in-memory copy even if the write fails */
      return { def, persisted: false, error: err.message };
    }
    return { def, persisted: true };
  }

  async remove(id) {
    this.monitors.delete(id);
    try {
      await fs.unlink(path.join(this.storageDir, `${id}.json`));
      return true;
    } catch {
      return false;
    }
  }

  get(id) {
    return this.monitors.get(id);
  }

  list() {
    return [...this.monitors.values()];
  }
}

export default MonitorStore;

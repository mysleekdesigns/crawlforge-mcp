/**
 * MonitorStore — disk persistence for scheduled change-monitors.
 *
 * One JSON file per monitor under ./monitors/<id>.json. Mirrors JobManager's
 * persistence *pattern* (mkdir-recursive, per-file JSON, randomUUID, load-on-
 * start) but deliberately omits TTL/eviction — scheduled monitors are long-lived
 * and must never be auto-expired.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class MonitorStore {
  constructor({ storageDir = './monitors' } = {}) {
    this.storageDir = storageDir;
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
    this._loaded = true;
    return this.monitors;
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

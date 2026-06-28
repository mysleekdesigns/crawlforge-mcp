/**
 * MonitorScheduler — recurring change-monitoring engine.
 *
 * Lifecycle:
 *   start()        load persisted monitors -> rehydrate baseline -> schedule
 *                  setInterval timers -> catch-up fire anything already due.
 *   _fire(def)     fetch -> (first run) create baseline, else compareWithBaseline
 *                  -> significance threshold gate -> optional plain-English goal
 *                  judge (SamplingClient, degrades gracefully) -> notify -> persist.
 *   runDueOnce()   fire everything currently due exactly once (the external-cron
 *                  one-shot path; guaranteed firing regardless of process uptime).
 *   stopAll()      clear every timer (graceful shutdown — no leaked handles).
 *
 * Honest firing model: a stdio MCP server is not a daemon. In-process timers only
 * fire while the process is alive; missed runs are caught up on next start(). For
 * guaranteed firing, run `crawlforge monitor:run-due` from system cron.
 *
 * All dependencies are injected so the engine is unit-testable without network,
 * timers, or an LLM.
 */
import { fetchContent, meetsNotificationThreshold } from '../tools/tracking/trackChanges/differ.js';
import { sendNotifications } from '../tools/tracking/trackChanges/notifier.js';

export const FIRING_GUARANTEE_NOTE =
  'In-process scheduling fires only while the MCP server process is alive; missed runs are ' +
  'caught up on restart. For guaranteed firing, run `crawlforge monitor:run-due` from system cron.';

const MIN_INTERVAL = 60_000;

export class MonitorScheduler {
  constructor({ tool, store, samplingClient = null, logger = null, now = () => Date.now() } = {}) {
    this.tool = tool;
    this.store = store;
    this.samplingClient = samplingClient;
    this.logger = logger || { warn() {}, info() {}, error() {} };
    this.now = now;
    this.timers = new Map();
    this._started = false;
  }

  async start() {
    if (this._started) return;
    this._started = true;
    await this.store.load();
    for (const def of this.store.list()) {
      if (def.enabled === false) continue;
      try {
        await this._ensureBaseline(def);
      } catch (err) {
        this.logger.warn('monitor baseline rehydrate failed', { id: def.id, error: err.message });
      }
      this._schedule(def);
      if (!def.nextDueAt || def.nextDueAt <= this.now()) {
        this._fire(def).catch(() => {});
      }
    }
  }

  _schedule(def) {
    this._clearTimer(def.id);
    if (def.enabled === false) return;
    const interval = Math.max(MIN_INTERVAL, def.interval || 3_600_000);
    const timer = setInterval(() => {
      this._fire(def).catch(() => {});
    }, interval);
    if (typeof timer.unref === 'function') timer.unref(); // never keep the process alive
    this.timers.set(def.id, timer);
  }

  _clearTimer(id) {
    const t = this.timers.get(id);
    if (t) {
      clearInterval(t);
      this.timers.delete(id);
    }
  }

  stopAll() {
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
  }

  async createMonitor(input) {
    if (!input || !input.url) throw new Error('createMonitor requires a url');
    const interval = Math.max(MIN_INTERVAL, input.interval || 3_600_000);
    const t = this.now();
    const def = {
      id: this.store.newId(),
      url: input.url,
      interval,
      schedule: input.schedule || null,
      goal: input.goal || null,
      notificationThreshold: input.notificationThreshold || 'moderate',
      trackingOptions: input.trackingOptions || {},
      notificationOptions: input.notificationOptions || null,
      enabled: true,
      createdAt: t,
      nextDueAt: t + interval,
      lastCheckAt: null,
      lastChangeAt: null,
      stats: { checks: 0, changesDetected: 0, notificationsSent: 0, errors: 0 },
    };
    await this.store.save(def);
    try {
      await this._ensureBaseline(def);
    } catch {
      /* baseline will be created on first fire */
    }
    this._schedule(def);
    return { ...def, firingGuarantee: FIRING_GUARANTEE_NOTE };
  }

  async stopMonitor(id) {
    this._clearTimer(id);
    const existed = !!this.store.get(id);
    await this.store.remove(id);
    return { stopped: existed, id };
  }

  async stopByUrl(url) {
    let count = 0;
    for (const def of this.store.list()) {
      if (def.url === url) {
        await this.stopMonitor(def.id);
        count++;
      }
    }
    return { stopped: count, url };
  }

  list() {
    return this.store.list().map((d) => ({
      id: d.id,
      url: d.url,
      interval: d.interval,
      goal: d.goal,
      enabled: d.enabled,
      nextDueAt: d.nextDueAt,
      lastCheckAt: d.lastCheckAt,
      lastChangeAt: d.lastChangeAt,
      stats: d.stats,
      scheduled: this.timers.has(d.id),
    }));
  }

  async runDueOnce() {
    if (!this.store._loaded) await this.store.load();
    const t = this.now();
    const due = this.store.list().filter((d) => d.enabled !== false && (!d.nextDueAt || d.nextDueAt <= t));
    const results = [];
    for (const def of due) {
      try {
        results.push(await this._fire(def));
      } catch (err) {
        results.push({ id: def.id, url: def.url, error: err.message });
      }
    }
    return { fired: results.length, results };
  }

  async _ensureBaseline(def) {
    const ct = this.tool.changeTracker;
    if (ct?.snapshots?.has(def.url)) return;
    try {
      const q = await this.tool.snapshotManager.querySnapshots({ url: def.url, limit: 1, includeContent: true });
      const content = q?.snapshots?.[0]?.content;
      if (content && typeof content === 'string') {
        await ct.createBaseline(def.url, content, def.trackingOptions);
      }
    } catch {
      /* no usable snapshot — first fire will create the baseline */
    }
  }

  async _fire(def) {
    const ct = this.tool.changeTracker;
    const finish = async (extra) => {
      def.lastCheckAt = this.now();
      def.nextDueAt = this.now() + Math.max(MIN_INTERVAL, def.interval || 3_600_000);
      await this.store.save(def);
      return { id: def.id, url: def.url, ...extra };
    };

    let fetched;
    try {
      fetched = await fetchContent(def.url);
    } catch (err) {
      def.stats.errors++;
      return finish({ error: err.message });
    }
    const content = fetched.content;

    // First fire (or unrehydrated) — establish a baseline.
    if (!ct?.snapshots?.has(def.url)) {
      await ct.createBaseline(def.url, content, def.trackingOptions);
      try {
        await this.tool.snapshotManager.storeSnapshot(def.url, content, { baseline: true, scheduledMonitor: def.id });
      } catch {
        /* snapshot persistence best-effort */
      }
      def.stats.checks++;
      return finish({ baselineCreated: true });
    }

    let cmp;
    try {
      cmp = await ct.compareWithBaseline(def.url, content, def.trackingOptions);
    } catch (err) {
      def.stats.errors++;
      return finish({ error: err.message });
    }

    def.stats.checks++;
    const meets = cmp.hasChanges && meetsNotificationThreshold(cmp.significance, def.notificationThreshold);
    let judge = null;
    let notified = false;

    if (meets) {
      def.stats.changesDetected++;
      def.lastChangeAt = this.now();
      judge = await this._judgeGoal(def, cmp);
      try {
        await this.tool.snapshotManager.storeSnapshot(def.url, content, {
          changes: cmp.summary,
          significance: cmp.significance,
          scheduledMonitor: def.id,
        });
      } catch {
        /* best-effort */
      }
      if (judge.meaningful && def.notificationOptions) {
        try {
          await sendNotifications(def.url, { ...cmp, goalJudgment: judge }, def.notificationOptions, this.tool);
          def.stats.notificationsSent++;
          notified = true;
        } catch (err) {
          def.stats.errors++;
          this.logger.warn('monitor notification failed', { id: def.id, error: err.message });
        }
      }
    }

    return finish({
      hasChanges: cmp.hasChanges,
      significance: cmp.significance,
      notified,
      mode: judge?.mode || 'threshold',
      reason: judge?.reason,
    });
  }

  /**
   * Decide whether a detected change is "meaningful" given the monitor's
   * plain-English goal. Degrades gracefully: no goal -> threshold; no LLM ->
   * notify and tag the mode; never hard-requires an LLM key.
   */
  async _judgeGoal(def, cmp) {
    if (!def.goal) return { meaningful: true, mode: 'threshold' };
    if (!this.samplingClient) return { meaningful: true, mode: 'degraded-no-llm' };
    try {
      const summary = JSON.stringify(cmp.summary || {}).slice(0, 1500);
      const prompt =
        `A monitored web page changed. The user's alert goal is:\n"${def.goal}"\n\n` +
        `Change summary (JSON):\n${summary}\n\n` +
        `Does this change match the goal and warrant an alert? ` +
        `Reply ONLY with JSON: {"meaningful": true|false, "reason": "short reason"}.`;
      const res = await this.samplingClient.complete(prompt, { maxTokens: 200 });
      const text = typeof res === 'string' ? res : res?.text || '';
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        return { meaningful: parsed.meaningful !== false, reason: parsed.reason || '', mode: 'llm' };
      }
      return { meaningful: true, mode: 'degraded-llm-error', reason: 'unparseable judge output' };
    } catch (err) {
      return { meaningful: true, mode: 'degraded-llm-error', reason: err.message };
    }
  }
}

export default MonitorScheduler;

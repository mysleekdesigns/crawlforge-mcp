/**
 * TrackChanges — entry-point (index.js).
 *
 * Preserves the same exports as the original single-file trackChanges.js:
 *   export class TrackChangesTool
 *   export default TrackChangesTool
 *   export const trackChangesTool          (singleton)
 *
 * Handler logic ≤ 150 LOC here; heavy work delegated to:
 *   schema.js   — Zod input schema
 *   differ.js   — fetch, merge-history, stat helpers
 *   monitor.js  — polling monitor lifecycle
 *   notifier.js — webhook / email / Slack notifications
 */

import { EventEmitter } from 'events';
import ChangeTracker from '../../../core/ChangeTracker.js';
import SnapshotManager from '../../../core/SnapshotManager.js';
import CacheManager from '../../../core/cache/CacheManager.js';
import { MonitorStore } from '../../../core/MonitorStore.js';
import { MonitorScheduler } from '../../../core/MonitorScheduler.js';
import { TrackChangesSchema } from './schema.js';
import { fetchContent, mergeHistoryData, matchesSignificanceFilter, calculateAverageInterval, calculateSignificanceDistribution } from './differ.js';
import { performMonitoringCheck, stopMonitor } from './monitor.js';
import { sendNotifications } from './notifier.js';

export class TrackChangesTool extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      cacheEnabled: true,
      cacheTTL: 3600000,
      snapshotStorageDir: './snapshots',
      enableRealTimeMonitoring: true,
      maxConcurrentMonitors: 50,
      defaultPollingInterval: 300000,
      ...options
    };

    this.changeTracker = new ChangeTracker({
      enableRealTimeTracking: this.options.enableRealTimeMonitoring,
      enableSemanticAnalysis: false,
      contentSimilarityThreshold: 0.8
    });

    this.snapshotManager = new SnapshotManager({
      storageDir: this.options.snapshotStorageDir,
      enableCompression: true,
      enableDeltaStorage: true,
      cacheEnabled: this.options.cacheEnabled
    });

    this.cache = this.options.cacheEnabled
      ? new CacheManager({ ttl: this.options.cacheTTL })
      : null;

    this.activeMonitors = new Map();
    this.monitorStats = new Map();

    // Scheduled-monitor subsystem (timers are NOT started here — only the
    // single server-owned instance calls startScheduler()).
    this._mcpServer = null;
    this.monitorStore = new MonitorStore({ storageDir: this.options.monitorStorageDir || './monitors' });
    this.scheduler = new MonitorScheduler({ tool: this, store: this.monitorStore });

    this.initialize();
  }

  /** Wire the MCP server so the goal-judge can use SamplingClient (Ollama-first). */
  setMcpServer(server) {
    this._mcpServer = server;
  }

  /** Start the in-process scheduler (called once, by the server). */
  async startScheduler() {
    if (this._mcpServer && !this.scheduler.samplingClient) {
      try {
        const { SamplingClient } = await import('../../../core/SamplingClient.js');
        this.scheduler.samplingClient = new SamplingClient({ mcpServer: this._mcpServer });
      } catch {
        /* goal-judge will degrade to threshold mode */
      }
    }
    await this.scheduler.start();
  }

  /** Fire every due monitor once and exit (the external-cron one-shot path). */
  async runDueOnce() {
    if (this._mcpServer && !this.scheduler.samplingClient) {
      try {
        const { SamplingClient } = await import('../../../core/SamplingClient.js');
        this.scheduler.samplingClient = new SamplingClient({ mcpServer: this._mcpServer });
      } catch { /* degrade */ }
    }
    return this.scheduler.runDueOnce();
  }

  async initialize() {
    try {
      await this.snapshotManager.initialize();
      this._setupEventHandlers();
      this.emit('initialized');
    } catch (error) {
      this.emit('error', { operation: 'initialize', error: error.message });
      throw error;
    }
  }

  _setupEventHandlers() {
    this.changeTracker.on('changeDetected', async (changeRecord) => {
      if (changeRecord.significance !== 'none') {
        try {
          await this.snapshotManager.storeSnapshot(
            changeRecord.url,
            changeRecord.details.current || '',
            { changes: changeRecord.details, significance: changeRecord.significance, changeType: changeRecord.changeType }
          );
        } catch (error) {
          this.emit('error', { operation: 'storeChangeSnapshot', url: changeRecord.url, error: error.message });
        }
      }
    });

    this.changeTracker.on('baselineCreated', (baseline) => this.emit('baselineCreated', baseline));
    this.snapshotManager.on('snapshotStored', (snapshot) => this.emit('snapshotStored', snapshot));
    this.snapshotManager.on('error', (error) => this.emit('error', error));
  }

  async execute(params) {
    try {
      const validated = TrackChangesSchema.parse(params);
      const { operation } = validated;

      switch (operation) {
        case 'create_baseline':         return await this.createBaseline(validated);
        case 'compare':                 return await this.compareWithBaseline(validated);
        case 'monitor':                 return await this.setupMonitoring(validated);
        case 'get_history':             return await this.getChangeHistory(validated);
        case 'get_stats':               return await this.getStatistics(validated);
        case 'create_scheduled_monitor':return await this.createScheduledMonitor(validated);
        case 'stop_scheduled_monitor':  return await this.stopScheduledMonitor(validated);
        case 'list_scheduled_monitors': return await this.listScheduledMonitors(validated);
        case 'get_dashboard':           return await this.getMonitoringDashboard(validated);
        case 'export_history':          return await this.exportHistoricalData(validated);
        case 'create_alert_rule':       return await this.createAlertRule(validated);
        case 'generate_trend_report':   return await this.generateTrendReport(validated);
        case 'get_monitoring_templates':return await this.getMonitoringTemplates(validated);
        default:                        throw new Error(`Unknown operation: ${operation}`);
      }
    } catch (error) {
      return { success: false, error: error.message, timestamp: Date.now() };
    }
  }

  async createBaseline(params) {
    const { url, content, html, trackingOptions, storageOptions = {} } = params;
    const enableSnapshots = storageOptions.enableSnapshots !== false;

    let sourceContent = content || html;
    let fetchMeta = {};
    if (!sourceContent) {
      const r = await fetchContent(url);
      sourceContent = r.content;
      fetchMeta = r.metadata;
    }
    if (!sourceContent || typeof sourceContent !== 'string') throw new Error('Invalid content');

    const baseline = await this.changeTracker.createBaseline(url, sourceContent, trackingOptions);
    let snapshotInfo = null;
    if (enableSnapshots) {
      snapshotInfo = await this.snapshotManager.storeSnapshot(url, sourceContent, { ...fetchMeta, baseline: true, trackingOptions });
    }

    return {
      success: true, operation: 'create_baseline', url,
      baseline: {
        version: baseline.version,
        contentHash: baseline.analysis?.hashes?.page,
        sections: Object.keys(baseline.analysis?.hashes?.sections || {}).length,
        elements: Object.keys(baseline.analysis?.hashes?.elements || {}).length,
        createdAt: baseline.timestamp,
        options: trackingOptions
      },
      snapshot: snapshotInfo, timestamp: Date.now()
    };
  }

  async compareWithBaseline(params) {
    const { url, content, html, trackingOptions, storageOptions = {}, notificationOptions } = params;
    const enableSnapshots = storageOptions.enableSnapshots !== false;

    let currentContent = content || html;
    let fetchMeta = {};
    if (!currentContent) {
      const r = await fetchContent(url);
      currentContent = r.content;
      fetchMeta = r.metadata;
    }
    if (!currentContent || typeof currentContent !== 'string') throw new Error('Invalid content');

    const comparisonResult = await this.changeTracker.compareWithBaseline(url, currentContent, trackingOptions);

    let snapshotInfo = null;
    if (comparisonResult.hasChanges && enableSnapshots) {
      snapshotInfo = await this.snapshotManager.storeSnapshot(url, currentContent, {
        ...fetchMeta, changes: comparisonResult.summary, significance: comparisonResult.significance
      });
    }

    if (comparisonResult.hasChanges && notificationOptions) {
      await sendNotifications(url, comparisonResult, notificationOptions, this);
    }

    return {
      success: true, operation: 'compare', url,
      hasChanges: comparisonResult.hasChanges,
      significance: comparisonResult.significance,
      changeType: comparisonResult.changeType,
      summary: comparisonResult.summary,
      details: comparisonResult.details,
      metrics: comparisonResult.metrics,
      recommendations: comparisonResult.recommendations,
      snapshot: snapshotInfo, timestamp: Date.now()
    };
  }

  async setupMonitoring(params) {
    const { url, monitoringOptions, trackingOptions, storageOptions, notificationOptions } = params;

    if (this.activeMonitors.has(url)) {
      clearInterval(this.activeMonitors.get(url).timer);
    }

    const deps = { changeTracker: this.changeTracker, snapshotManager: this.snapshotManager, emitter: this };

    const monitorConfig = {
      url,
      options: { ...monitoringOptions, trackingOptions, storageOptions, notificationOptions },
      stats: { started: Date.now(), checks: 0, changesDetected: 0, errors: 0, lastCheck: null, lastChange: null, averageResponseTime: 0 }
    };

    monitorConfig.timer = setInterval(
      () => performMonitoringCheck(url, monitorConfig, deps),
      monitoringOptions.interval
    );

    this.activeMonitors.set(url, monitorConfig);
    this.monitorStats.set(url, monitorConfig.stats);

    await performMonitoringCheck(url, monitorConfig, deps);

    return {
      success: true, operation: 'monitor', url,
      monitoring: { enabled: true, interval: monitoringOptions.interval, notificationThreshold: monitoringOptions.notificationThreshold, startedAt: monitorConfig.stats.started },
      timestamp: Date.now()
    };
  }

  async getChangeHistory(params) {
    const { url, queryOptions } = params;

    const changeHistory = this.changeTracker.getChangeHistory(url, queryOptions.limit);
    const snapshotHistory = await this.snapshotManager.getChangeHistory(url, queryOptions);
    let combined = mergeHistoryData(changeHistory, snapshotHistory.history);

    if (queryOptions.significanceFilter && queryOptions.significanceFilter !== 'all') {
      combined = combined.filter(e => matchesSignificanceFilter(e, queryOptions.significanceFilter));
    }

    const start = queryOptions.offset || 0;
    const end = start + (queryOptions.limit || 50);

    return {
      success: true, operation: 'get_history', url,
      history: combined.slice(start, end),
      pagination: { total: combined.length, limit: queryOptions.limit, offset: queryOptions.offset, hasMore: end < combined.length },
      timespan: {
        earliest: combined.length > 0 ? combined[combined.length - 1].timestamp : null,
        latest: combined.length > 0 ? combined[0].timestamp : null,
        totalEntries: combined.length
      },
      timestamp: Date.now()
    };
  }

  async getStatistics(params) {
    const { url } = params;
    const monitoringStats = url ? this.monitorStats.get(url) : this._getAggregatedMonitoringStats();
    let urlStats = null;
    if (url) {
      try {
        const changeHistory = this.changeTracker.getChangeHistory(url, 100);
        const snapshotHistory = await this.snapshotManager.querySnapshots({ url, limit: 100, includeContent: false });
        urlStats = {
          totalChanges: changeHistory.length,
          totalSnapshots: snapshotHistory.snapshots.length,
          lastChange: changeHistory.length > 0 ? changeHistory[0].timestamp : null,
          averageChangeInterval: calculateAverageInterval(changeHistory),
          significanceDistribution: calculateSignificanceDistribution(changeHistory),
          isBeingMonitored: this.activeMonitors.has(url)
        };
      } catch (error) {
        urlStats = { error: error.message };
      }
    }

    return {
      success: true, operation: 'get_stats', url: url || 'global',
      stats: {
        changeTracking: this.changeTracker.getStats(),
        snapshotStorage: this.snapshotManager.getStats(),
        monitoring: monitoringStats,
        urlSpecific: urlStats,
        system: { activeMonitors: this.activeMonitors.size, cacheEnabled: !!this.cache, cacheStats: this.cache ? this.cache.getStats() : null }
      },
      timestamp: Date.now()
    };
  }

  async createScheduledMonitor(params) {
    const { url, scheduledMonitorOptions, monitoringOptions, trackingOptions, notificationOptions } = params;
    if (!url) throw new Error('create_scheduled_monitor requires a url');
    const opts = scheduledMonitorOptions || {};
    const monitor = await this.scheduler.createMonitor({
      url,
      interval: opts.interval ?? monitoringOptions?.interval,
      schedule: opts.schedule,
      goal: opts.goal,
      notificationThreshold: opts.notificationThreshold || monitoringOptions?.notificationThreshold || 'moderate',
      trackingOptions,
      notificationOptions
    });
    return { success: true, operation: 'create_scheduled_monitor', url, monitor, firingGuarantee: monitor.firingGuarantee, timestamp: Date.now() };
  }

  async stopScheduledMonitor(params) {
    const { url, scheduledMonitorOptions } = params;
    const monitorId = scheduledMonitorOptions?.monitorId;
    if (monitorId) {
      const result = await this.scheduler.stopMonitor(monitorId);
      return { success: true, operation: 'stop_scheduled_monitor', monitorId, stopped: result.stopped, timestamp: Date.now() };
    }
    if (!url) throw new Error('stop_scheduled_monitor requires a url or scheduledMonitorOptions.monitorId');
    const result = await this.scheduler.stopByUrl(url);
    return { success: true, operation: 'stop_scheduled_monitor', url, stoppedMonitors: result.stopped, timestamp: Date.now() };
  }

  async listScheduledMonitors() {
    if (!this.monitorStore._loaded) await this.monitorStore.load();
    const monitors = this.scheduler.list();
    return { success: true, operation: 'list_scheduled_monitors', monitors, count: monitors.length, timestamp: Date.now() };
  }

  async getMonitoringDashboard(params) {
    const { dashboardOptions } = params;
    const dashboard = this.changeTracker.getMonitoringDashboard();
    if (!dashboardOptions?.includeRecentAlerts) delete dashboard.recentAlerts;
    if (!dashboardOptions?.includeTrends) delete dashboard.trends;
    if (!dashboardOptions?.includeMonitorStatus) {
      dashboard.monitors = dashboard.monitors.map(m => ({ id: m.id, url: m.url, status: m.status }));
    }
    return { success: true, operation: 'get_dashboard', dashboard, timestamp: Date.now() };
  }

  async exportHistoricalData(params) {
    const { url, exportOptions } = params;
    const exportData = await this.changeTracker.exportHistoricalData({ ...exportOptions, url });
    return { success: true, operation: 'export_history', url: url || 'global', export: exportData, timestamp: Date.now() };
  }

  async createAlertRule(params) {
    const { alertRuleOptions } = params;
    const ruleId = alertRuleOptions?.ruleId || `custom_rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const rule = {
      condition: this._parseCondition(alertRuleOptions?.condition || 'significance === "major"'),
      actions: alertRuleOptions?.actions || ['webhook'],
      throttle: alertRuleOptions?.throttle || 600000,
      priority: alertRuleOptions?.priority || 'medium'
    };
    this.changeTracker.alertRules.set(ruleId, rule);
    return { success: true, operation: 'create_alert_rule', ruleId, rule, timestamp: Date.now() };
  }

  async generateTrendReport(params) {
    const report = await this.changeTracker.generateTrendAnalysisReport(params.url);
    return { success: true, operation: 'generate_trend_report', report, timestamp: Date.now() };
  }

  async getMonitoringTemplates() {
    const templates = {};
    for (const [id, template] of this.changeTracker.monitoringTemplates.entries()) {
      templates[id] = { name: template.name, frequency: template.frequency, options: template.options, alertRules: template.alertRules };
    }
    return { success: true, operation: 'get_monitoring_templates', templates, count: Object.keys(templates).length, timestamp: Date.now() };
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  stopMonitoring(url) {
    if (!this.activeMonitors.has(url)) return false;
    const monitorConfig = this.activeMonitors.get(url);
    stopMonitor(url, monitorConfig, this);
    this.activeMonitors.delete(url);
    return true;
  }

  stopAllMonitoring() {
    const urls = Array.from(this.activeMonitors.keys());
    urls.forEach(url => this.stopMonitoring(url));
    this.emit('allMonitoringStopped', { count: urls.length });
    return urls.length;
  }

  getActiveMonitors() {
    return Array.from(this.activeMonitors.keys()).map(url => ({
      url,
      config: this.activeMonitors.get(url).options,
      stats: this.monitorStats.get(url)
    }));
  }

  async shutdown() {
    this.stopAllMonitoring();
    this.scheduler?.stopAll();
    await this.snapshotManager.shutdown();
    await this.changeTracker.cleanup();
    this.emit('shutdown');
  }

  /**
   * Alias so the server's graceful-shutdown sweep (which filters tools by a
   * `destroy`/`cleanup` method) actually tears this tool down — including the
   * scheduler timers. Without this, scheduled-monitor intervals would leak.
   */
  async cleanup() {
    return this.shutdown();
  }

  // ── Private helpers ────────────────────────────────────────────────────────────

  _getAggregatedMonitoringStats() {
    const stats = { totalMonitors: this.activeMonitors.size, totalChecks: 0, totalChanges: 0, totalErrors: 0, averageResponseTime: 0, oldestMonitor: null, newestMonitor: null };
    const all = Array.from(this.monitorStats.values());
    if (all.length === 0) return stats;
    stats.totalChecks = all.reduce((s, v) => s + v.checks, 0);
    stats.totalChanges = all.reduce((s, v) => s + v.changesDetected, 0);
    stats.totalErrors = all.reduce((s, v) => s + v.errors, 0);
    stats.averageResponseTime = all.reduce((s, v) => s + v.averageResponseTime, 0) / all.length;
    stats.oldestMonitor = Math.min(...all.map(v => v.started));
    stats.newestMonitor = Math.max(...all.map(v => v.started));
    return stats;
  }

  _parseCondition(conditionString) {
    return (changeResult) => {
      try {
        if (conditionString.includes('significance')) {
          const match = conditionString.match(/significance\s*===\s*["'](\w+)["']/);
          if (match) return changeResult.significance === match[1];
        }
        return false;
      } catch {
        return false;
      }
    };
  }
}

export default TrackChangesTool;

// Singleton instance — kept for backward-compat with any code that imports it directly
export const trackChangesTool = new TrackChangesTool();
trackChangesTool.name = 'track_changes';
trackChangesTool.validateParameters = (params) => TrackChangesSchema.parse(params);
trackChangesTool.description = 'Track and analyze content changes with baseline capture, comparison, and monitoring capabilities';
trackChangesTool.inputSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'URL to track for changes' },
    operation: { type: 'string', description: 'Operation to perform: create_baseline, compare, monitor, get_history, get_stats' },
    content: { type: 'string', description: 'Content to analyze or compare' }
  },
  required: ['url']
};

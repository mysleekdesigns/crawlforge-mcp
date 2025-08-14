/**
 * TrackChanges Tool - Change Tracking MCP Tool
 * Provides baseline capture, comparison, scheduled monitoring,
 * and change notification capabilities
 */

import { z } from 'zod';
import ChangeTracker from '../../core/ChangeTracker.js';
import SnapshotManager from '../../core/SnapshotManager.js';
import CacheManager from '../../core/cache/CacheManager.js';
import { EventEmitter } from 'events';

// Input validation schemas
const TrackChangesSchema = z.object({
  url: z.string().url(),
  operation: z.enum(['create_baseline', 'compare', 'monitor', 'get_history', 'get_stats']).default('compare'),
  
  // Content options
  content: z.string().optional(),
  html: z.string().optional(),
  
  // Tracking options
  trackingOptions: z.object({
    granularity: z.enum(['page', 'section', 'element', 'text']).default('section'),
    trackText: z.boolean().default(true),
    trackStructure: z.boolean().default(true),
    trackAttributes: z.boolean().default(false),
    trackImages: z.boolean().default(false),
    trackLinks: z.boolean().default(true),
    ignoreWhitespace: z.boolean().default(true),
    ignoreCase: z.boolean().default(false),
    customSelectors: z.array(z.string()).optional(),
    excludeSelectors: z.array(z.string()).optional().default([
      'script', 'style', 'noscript', '.advertisement', '.ad', '#comments'
    ]),
    significanceThresholds: z.object({
      minor: z.number().min(0).max(1).default(0.1),
      moderate: z.number().min(0).max(1).default(0.3),
      major: z.number().min(0).max(1).default(0.7)
    }).optional()
  }).optional().default({}),
  
  // Monitoring options
  monitoringOptions: z.object({
    enabled: z.boolean().default(false),
    interval: z.number().min(60000).max(24 * 60 * 60 * 1000).default(300000), // 5 minutes to 24 hours
    maxRetries: z.number().min(0).max(5).default(3),
    retryDelay: z.number().min(1000).max(60000).default(5000),
    notificationThreshold: z.enum(['minor', 'moderate', 'major', 'critical']).default('moderate'),
    enableWebhook: z.boolean().default(false),
    webhookUrl: z.string().url().optional(),
    webhookSecret: z.string().optional()
  }).optional(),
  
  // Storage options
  storageOptions: z.object({
    enableSnapshots: z.boolean().default(true),
    retainHistory: z.boolean().default(true),
    maxHistoryEntries: z.number().min(1).max(1000).default(100),
    compressionEnabled: z.boolean().default(true),
    deltaStorageEnabled: z.boolean().default(true)
  }).optional().default({}),
  
  // Query options for history retrieval
  queryOptions: z.object({
    limit: z.number().min(1).max(500).default(50),
    offset: z.number().min(0).default(0),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    includeContent: z.boolean().default(false),
    significanceFilter: z.enum(['all', 'minor', 'moderate', 'major', 'critical']).optional()
  }).optional(),
  
  // Notification options
  notificationOptions: z.object({
    email: z.object({
      enabled: z.boolean().default(false),
      recipients: z.array(z.string().email()).optional(),
      subject: z.string().optional(),
      includeDetails: z.boolean().default(true)
    }).optional(),
    webhook: z.object({
      enabled: z.boolean().default(false),
      url: z.string().url().optional(),
      method: z.enum(['POST', 'PUT']).default('POST'),
      headers: z.record(z.string()).optional(),
      signingSecret: z.string().optional(),
      includeContent: z.boolean().default(false)
    }).optional(),
    slack: z.object({
      enabled: z.boolean().default(false),
      webhookUrl: z.string().url().optional(),
      channel: z.string().optional(),
      username: z.string().optional()
    }).optional()
  }).optional()
});

export class TrackChangesTool extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      cacheEnabled: true,
      cacheTTL: 3600000, // 1 hour
      snapshotStorageDir: './snapshots',
      enableRealTimeMonitoring: true,
      maxConcurrentMonitors: 50,
      defaultPollingInterval: 300000, // 5 minutes
      ...options
    };
    
    // Initialize components
    this.changeTracker = new ChangeTracker({
      enableRealTimeTracking: this.options.enableRealTimeMonitoring,
      enableSemanticAnalysis: false, // Can be enabled if needed
      contentSimilarityThreshold: 0.8
    });
    
    this.snapshotManager = new SnapshotManager({
      storageDir: this.options.snapshotStorageDir,
      enableCompression: true,
      enableDeltaStorage: true,
      cacheEnabled: this.options.cacheEnabled
    });
    
    this.cache = this.options.cacheEnabled ? 
      new CacheManager({ ttl: this.options.cacheTTL }) : null;
    
    // Active monitors
    this.activeMonitors = new Map();
    this.monitorStats = new Map();
    
    // Notification handlers
    this.notificationHandlers = {
      webhook: this.sendWebhookNotification.bind(this),
      email: this.sendEmailNotification.bind(this),
      slack: this.sendSlackNotification.bind(this)
    };
    
    this.initialize();
  }
  
  async initialize() {
    try {
      await this.snapshotManager.initialize();
      
      // Set up event handlers
      this.setupEventHandlers();
      
      this.emit('initialized');
    } catch (error) {
      this.emit('error', { operation: 'initialize', error: error.message });
      throw error;
    }
  }
  
  setupEventHandlers() {
    // Handle change tracker events
    this.changeTracker.on('changeDetected', (changeRecord) => {
      this.handleChangeDetected(changeRecord);
    });
    
    this.changeTracker.on('baselineCreated', (baseline) => {
      this.emit('baselineCreated', baseline);
    });
    
    // Handle snapshot manager events
    this.snapshotManager.on('snapshotStored', (snapshot) => {
      this.emit('snapshotStored', snapshot);
    });
    
    this.snapshotManager.on('error', (error) => {
      this.emit('error', error);
    });
  }
  
  /**
   * Execute the track changes tool
   * @param {Object} params - Tool parameters
   * @returns {Object} - Execution results
   */
  async execute(params) {
    try {
      const validated = TrackChangesSchema.parse(params);
      const { url, operation } = validated;
      
      switch (operation) {
        case 'create_baseline':
          return await this.createBaseline(validated);
          
        case 'compare':
          return await this.compareWithBaseline(validated);
          
        case 'monitor':
          return await this.setupMonitoring(validated);
          
        case 'get_history':
          return await this.getChangeHistory(validated);
          
        case 'get_stats':
          return await this.getStatistics(validated);
          
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }
  
  /**
   * Create a baseline for change tracking
   * @param {Object} params - Parameters
   * @returns {Object} - Baseline creation results
   */
  async createBaseline(params) {
    const { url, content, html, trackingOptions, storageOptions } = params;
    
    try {
      // Fetch content if not provided
      let sourceContent = content || html;
      let fetchMetadata = {};
      
      if (!sourceContent) {
        const fetchResult = await this.fetchContent(url);
        sourceContent = fetchResult.content;
        fetchMetadata = fetchResult.metadata;
      }
      
      // Create baseline with change tracker
      const baseline = await this.changeTracker.createBaseline(
        url,
        sourceContent,
        trackingOptions
      );
      
      // Store snapshot if enabled
      let snapshotInfo = null;
      if (storageOptions.enableSnapshots) {
        const snapshotResult = await this.snapshotManager.storeSnapshot(
          url,
          sourceContent,
          {
            ...fetchMetadata,
            baseline: true,
            trackingOptions
          }
        );
        snapshotInfo = snapshotResult;
      }
      
      return {
        success: true,
        operation: 'create_baseline',
        url,
        baseline: {
          version: baseline.version,
          contentHash: baseline.analysis?.hashes?.page,
          sections: Object.keys(baseline.analysis?.hashes?.sections || {}).length,
          elements: Object.keys(baseline.analysis?.hashes?.elements || {}).length,
          createdAt: baseline.timestamp,
          options: trackingOptions
        },
        snapshot: snapshotInfo,
        timestamp: Date.now()
      };
      
    } catch (error) {
      throw new Error(`Failed to create baseline: ${error.message}`);
    }
  }
  
  /**
   * Compare current content with baseline
   * @param {Object} params - Parameters
   * @returns {Object} - Comparison results
   */
  async compareWithBaseline(params) {
    const { url, content, html, trackingOptions, storageOptions, notificationOptions } = params;
    
    try {
      // Fetch current content if not provided
      let currentContent = content || html;
      let fetchMetadata = {};
      
      if (!currentContent) {
        const fetchResult = await this.fetchContent(url);
        currentContent = fetchResult.content;
        fetchMetadata = fetchResult.metadata;
      }
      
      // Perform comparison
      const comparisonResult = await this.changeTracker.compareWithBaseline(
        url,
        currentContent,
        trackingOptions
      );
      
      // Store snapshot if changes detected and storage enabled
      let snapshotInfo = null;
      if (comparisonResult.hasChanges && storageOptions.enableSnapshots) {
        const snapshotResult = await this.snapshotManager.storeSnapshot(
          url,
          currentContent,
          {
            ...fetchMetadata,
            changes: comparisonResult.summary,
            significance: comparisonResult.significance
          }
        );
        snapshotInfo = snapshotResult;
      }
      
      // Send notifications if significant changes detected
      if (comparisonResult.hasChanges && notificationOptions) {
        await this.sendNotifications(url, comparisonResult, notificationOptions);
      }
      
      return {
        success: true,
        operation: 'compare',
        url,
        hasChanges: comparisonResult.hasChanges,
        significance: comparisonResult.significance,
        changeType: comparisonResult.changeType,
        summary: comparisonResult.summary,
        details: comparisonResult.details,
        metrics: comparisonResult.metrics,
        recommendations: comparisonResult.recommendations,
        snapshot: snapshotInfo,
        timestamp: Date.now()
      };
      
    } catch (error) {
      throw new Error(`Failed to compare with baseline: ${error.message}`);
    }
  }
  
  /**
   * Set up continuous monitoring for a URL
   * @param {Object} params - Parameters
   * @returns {Object} - Monitoring setup results
   */
  async setupMonitoring(params) {
    const { url, monitoringOptions, trackingOptions, storageOptions, notificationOptions } = params;
    
    try {
      // Check if already monitoring this URL
      if (this.activeMonitors.has(url)) {
        const existing = this.activeMonitors.get(url);
        clearInterval(existing.timer);
      }
      
      // Create monitoring configuration
      const monitorConfig = {
        url,
        options: {
          ...monitoringOptions,
          trackingOptions,
          storageOptions,
          notificationOptions
        },
        stats: {
          started: Date.now(),
          checks: 0,
          changesDetected: 0,
          errors: 0,
          lastCheck: null,
          lastChange: null,
          averageResponseTime: 0
        }
      };
      
      // Set up polling timer
      const timer = setInterval(async () => {
        await this.performMonitoringCheck(url, monitorConfig);
      }, monitoringOptions.interval);
      
      monitorConfig.timer = timer;
      
      // Store active monitor
      this.activeMonitors.set(url, monitorConfig);
      this.monitorStats.set(url, monitorConfig.stats);
      
      // Perform initial check
      await this.performMonitoringCheck(url, monitorConfig);
      
      return {
        success: true,
        operation: 'monitor',
        url,
        monitoring: {
          enabled: true,
          interval: monitoringOptions.interval,
          notificationThreshold: monitoringOptions.notificationThreshold,
          startedAt: monitorConfig.stats.started
        },
        timestamp: Date.now()
      };
      
    } catch (error) {
      throw new Error(`Failed to setup monitoring: ${error.message}`);
    }
  }
  
  /**
   * Get change history for a URL
   * @param {Object} params - Parameters
   * @returns {Object} - Change history
   */
  async getChangeHistory(params) {
    const { url, queryOptions } = params;
    
    try {
      // Get change history from change tracker
      const changeHistory = this.changeTracker.getChangeHistory(url, queryOptions.limit);
      
      // Get snapshot history from snapshot manager
      const snapshotHistory = await this.snapshotManager.getChangeHistory(url, queryOptions);
      
      // Merge and enrich history data
      const combinedHistory = this.mergeHistoryData(changeHistory, snapshotHistory.history);
      
      // Apply filters
      let filteredHistory = combinedHistory;
      if (queryOptions.significanceFilter && queryOptions.significanceFilter !== 'all') {
        filteredHistory = combinedHistory.filter(entry => 
          this.matchesSignificanceFilter(entry, queryOptions.significanceFilter)
        );
      }
      
      // Apply pagination
      const start = queryOptions.offset || 0;
      const end = start + (queryOptions.limit || 50);
      const paginatedHistory = filteredHistory.slice(start, end);
      
      return {
        success: true,
        operation: 'get_history',
        url,
        history: paginatedHistory,
        pagination: {
          total: filteredHistory.length,
          limit: queryOptions.limit,
          offset: queryOptions.offset,
          hasMore: end < filteredHistory.length
        },
        timespan: {
          earliest: combinedHistory.length > 0 ? 
            combinedHistory[combinedHistory.length - 1].timestamp : null,
          latest: combinedHistory.length > 0 ? 
            combinedHistory[0].timestamp : null,
          totalEntries: combinedHistory.length
        },
        timestamp: Date.now()
      };
      
    } catch (error) {
      throw new Error(`Failed to get change history: ${error.message}`);
    }
  }
  
  /**
   * Get statistics for change tracking
   * @param {Object} params - Parameters
   * @returns {Object} - Statistics
   */
  async getStatistics(params) {
    const { url } = params;
    
    try {
      // Get change tracker stats
      const changeTrackerStats = this.changeTracker.getStats();
      
      // Get snapshot manager stats
      const snapshotManagerStats = this.snapshotManager.getStats();
      
      // Get monitoring stats
      const monitoringStats = url ? 
        this.monitorStats.get(url) : 
        this.getAggregatedMonitoringStats();
      
      // Get URL-specific stats if URL provided
      let urlStats = null;
      if (url) {
        urlStats = await this.getUrlSpecificStats(url);
      }
      
      return {
        success: true,
        operation: 'get_stats',
        url: url || 'global',
        stats: {
          changeTracking: changeTrackerStats,
          snapshotStorage: snapshotManagerStats,
          monitoring: monitoringStats,
          urlSpecific: urlStats,
          system: {
            activeMonitors: this.activeMonitors.size,
            cacheEnabled: !!this.cache,
            cacheStats: this.cache ? this.cache.getStats() : null
          }
        },
        timestamp: Date.now()
      };
      
    } catch (error) {
      throw new Error(`Failed to get statistics: ${error.message}`);
    }
  }
  
  // Helper methods
  
  async fetchContent(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'MCP-WebScraper-ChangeTracker/3.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache'
        },
        timeout: 30000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const content = await response.text();
      
      return {
        content,
        metadata: {
          statusCode: response.status,
          contentType: response.headers.get('content-type'),
          contentLength: content.length,
          lastModified: response.headers.get('last-modified'),
          etag: response.headers.get('etag'),
          fetchedAt: Date.now()
        }
      };
      
    } catch (error) {
      throw new Error(`Failed to fetch content: ${error.message}`);
    }
  }
  
  async performMonitoringCheck(url, monitorConfig) {
    const startTime = Date.now();
    
    try {
      monitorConfig.stats.checks++;
      
      // Fetch current content
      const fetchResult = await this.fetchContent(url);
      
      // Perform comparison
      const comparisonResult = await this.changeTracker.compareWithBaseline(
        url,
        fetchResult.content,
        monitorConfig.options.trackingOptions
      );
      
      // Update stats
      const responseTime = Date.now() - startTime;
      monitorConfig.stats.averageResponseTime = 
        (monitorConfig.stats.averageResponseTime * (monitorConfig.stats.checks - 1) + responseTime) / 
        monitorConfig.stats.checks;
      
      monitorConfig.stats.lastCheck = Date.now();
      
      // Handle changes if detected
      if (comparisonResult.hasChanges) {
        monitorConfig.stats.changesDetected++;
        monitorConfig.stats.lastChange = Date.now();
        
        // Check if change meets notification threshold
        if (this.meetsNotificationThreshold(
          comparisonResult.significance, 
          monitorConfig.options.notificationThreshold
        )) {
          // Store snapshot if enabled
          if (monitorConfig.options.storageOptions?.enableSnapshots) {
            await this.snapshotManager.storeSnapshot(
              url,
              fetchResult.content,
              {
                ...fetchResult.metadata,
                changes: comparisonResult.summary,
                significance: comparisonResult.significance,
                monitoring: true
              }
            );
          }
          
          // Send notifications
          if (monitorConfig.options.notificationOptions) {
            await this.sendNotifications(
              url, 
              comparisonResult, 
              monitorConfig.options.notificationOptions
            );
          }
        }
      }
      
      this.emit('monitoringCheck', {
        url,
        hasChanges: comparisonResult.hasChanges,
        significance: comparisonResult.significance,
        responseTime,
        timestamp: Date.now()
      });
      
    } catch (error) {
      monitorConfig.stats.errors++;
      
      this.emit('monitoringError', {
        url,
        error: error.message,
        timestamp: Date.now()
      });
      
      // If too many errors, disable monitoring
      if (monitorConfig.stats.errors > monitorConfig.options.maxRetries) {
        this.stopMonitoring(url);
        
        this.emit('monitoringDisabled', {
          url,
          reason: 'Too many errors',
          totalErrors: monitorConfig.stats.errors
        });
      }
    }
  }
  
  async sendNotifications(url, changeResult, notificationOptions) {
    const notifications = [];
    
    if (notificationOptions.webhook?.enabled) {
      notifications.push(this.sendWebhookNotification(url, changeResult, notificationOptions.webhook));
    }
    
    if (notificationOptions.email?.enabled) {
      notifications.push(this.sendEmailNotification(url, changeResult, notificationOptions.email));
    }
    
    if (notificationOptions.slack?.enabled) {
      notifications.push(this.sendSlackNotification(url, changeResult, notificationOptions.slack));
    }
    
    await Promise.allSettled(notifications);
  }
  
  async sendWebhookNotification(url, changeResult, webhookConfig) {
    try {
      const payload = {
        event: 'change_detected',
        url,
        timestamp: Date.now(),
        significance: changeResult.significance,
        changeType: changeResult.changeType,
        summary: changeResult.summary,
        details: webhookConfig.includeContent ? changeResult.details : undefined
      };
      
      const response = await fetch(webhookConfig.url, {
        method: webhookConfig.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'MCP-WebScraper-ChangeTracker/3.0',
          ...webhookConfig.headers
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
      }
      
      this.emit('notificationSent', {
        type: 'webhook',
        url,
        success: true
      });
      
    } catch (error) {
      this.emit('notificationError', {
        type: 'webhook',
        url,
        error: error.message
      });
    }
  }
  
  async sendEmailNotification(url, changeResult, emailConfig) {
    // Email notification implementation would go here
    // This would integrate with email service providers
    this.emit('notificationSent', {
      type: 'email',
      url,
      success: true,
      note: 'Email notifications require external service integration'
    });
  }
  
  async sendSlackNotification(url, changeResult, slackConfig) {
    try {
      const payload = {
        text: `🔄 Content Change Detected`,
        attachments: [{
          color: this.getSlackColor(changeResult.significance),
          fields: [
            {
              title: 'URL',
              value: url,
              short: false
            },
            {
              title: 'Significance',
              value: changeResult.significance.toUpperCase(),
              short: true
            },
            {
              title: 'Change Type',
              value: changeResult.changeType.replace('_', ' '),
              short: true
            },
            {
              title: 'Summary',
              value: changeResult.summary.changeDescription,
              short: false
            }
          ],
          timestamp: Math.floor(Date.now() / 1000)
        }],
        channel: slackConfig.channel,
        username: slackConfig.username || 'Change Tracker'
      };
      
      const response = await fetch(slackConfig.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`Slack notification failed: ${response.status}`);
      }
      
      this.emit('notificationSent', {
        type: 'slack',
        url,
        success: true
      });
      
    } catch (error) {
      this.emit('notificationError', {
        type: 'slack',
        url,
        error: error.message
      });
    }
  }
  
  mergeHistoryData(changeHistory, snapshotHistory) {
    // Merge change tracker history with snapshot history
    const merged = [];
    
    // Add change history entries
    changeHistory.forEach(entry => {
      merged.push({
        ...entry,
        source: 'change_tracker',
        hasSnapshot: false
      });
    });
    
    // Add snapshot history entries
    snapshotHistory.forEach(entry => {
      const existing = merged.find(m => 
        Math.abs(m.timestamp - entry.timestamp) < 60000 // Within 1 minute
      );
      
      if (existing) {
        existing.hasSnapshot = true;
        existing.snapshotId = entry.snapshotId;
      } else {
        merged.push({
          ...entry,
          source: 'snapshot',
          hasSnapshot: true
        });
      }
    });
    
    // Sort by timestamp (newest first)
    return merged.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  matchesSignificanceFilter(entry, filter) {
    const significanceLevels = ['none', 'minor', 'moderate', 'major', 'critical'];
    const entryLevel = significanceLevels.indexOf(entry.significance || 'none');
    const filterLevel = significanceLevels.indexOf(filter);
    
    return entryLevel >= filterLevel;
  }
  
  meetsNotificationThreshold(significance, threshold) {
    const levels = ['none', 'minor', 'moderate', 'major', 'critical'];
    const significanceLevel = levels.indexOf(significance);
    const thresholdLevel = levels.indexOf(threshold);
    
    return significanceLevel >= thresholdLevel;
  }
  
  getSlackColor(significance) {
    const colors = {
      'none': '#36a64f',
      'minor': '#ffeb3b',
      'moderate': '#ff9800',
      'major': '#f44336',
      'critical': '#9c27b0'
    };
    
    return colors[significance] || '#36a64f';
  }
  
  async getUrlSpecificStats(url) {
    try {
      const changeHistory = this.changeTracker.getChangeHistory(url, 100);
      const snapshotHistory = await this.snapshotManager.querySnapshots({
        url,
        limit: 100,
        includeContent: false
      });
      
      return {
        totalChanges: changeHistory.length,
        totalSnapshots: snapshotHistory.snapshots.length,
        lastChange: changeHistory.length > 0 ? changeHistory[0].timestamp : null,
        averageChangeInterval: this.calculateAverageInterval(changeHistory),
        significanceDistribution: this.calculateSignificanceDistribution(changeHistory),
        isBeingMonitored: this.activeMonitors.has(url)
      };
      
    } catch (error) {
      return {
        error: error.message
      };
    }
  }
  
  getAggregatedMonitoringStats() {
    const stats = {
      totalMonitors: this.activeMonitors.size,
      totalChecks: 0,
      totalChanges: 0,
      totalErrors: 0,
      averageResponseTime: 0,
      oldestMonitor: null,
      newestMonitor: null
    };
    
    const allStats = Array.from(this.monitorStats.values());
    
    if (allStats.length === 0) return stats;
    
    stats.totalChecks = allStats.reduce((sum, s) => sum + s.checks, 0);
    stats.totalChanges = allStats.reduce((sum, s) => sum + s.changesDetected, 0);
    stats.totalErrors = allStats.reduce((sum, s) => sum + s.errors, 0);
    stats.averageResponseTime = allStats.reduce((sum, s) => sum + s.averageResponseTime, 0) / allStats.length;
    stats.oldestMonitor = Math.min(...allStats.map(s => s.started));
    stats.newestMonitor = Math.max(...allStats.map(s => s.started));
    
    return stats;
  }
  
  calculateAverageInterval(changeHistory) {
    if (changeHistory.length < 2) return null;
    
    let totalInterval = 0;
    for (let i = 1; i < changeHistory.length; i++) {
      totalInterval += changeHistory[i - 1].timestamp - changeHistory[i].timestamp;
    }
    
    return totalInterval / (changeHistory.length - 1);
  }
  
  calculateSignificanceDistribution(changeHistory) {
    const distribution = {
      none: 0,
      minor: 0,
      moderate: 0,
      major: 0,
      critical: 0
    };
    
    changeHistory.forEach(entry => {
      const significance = entry.significance || 'none';
      if (distribution.hasOwnProperty(significance)) {
        distribution[significance]++;
      }
    });
    
    return distribution;
  }
  
  async handleChangeDetected(changeRecord) {
    // Store snapshot if significant change
    if (changeRecord.significance !== 'none') {
      try {
        await this.snapshotManager.storeSnapshot(
          changeRecord.url,
          changeRecord.details.current || '',
          {
            changes: changeRecord.details,
            significance: changeRecord.significance,
            changeType: changeRecord.changeType
          }
        );
      } catch (error) {
        this.emit('error', {
          operation: 'storeChangeSnapshot',
          url: changeRecord.url,
          error: error.message
        });
      }
    }
  }
  
  // Public API methods
  
  stopMonitoring(url) {
    if (this.activeMonitors.has(url)) {
      const monitor = this.activeMonitors.get(url);
      clearInterval(monitor.timer);
      this.activeMonitors.delete(url);
      
      this.emit('monitoringStopped', { url });
      return true;
    }
    return false;
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
    await this.snapshotManager.shutdown();
    this.emit('shutdown');
  }
}

export default TrackChangesTool;
// Create and export tool instance for MCP compatibility
export const trackChangesTool = new TrackChangesTool();

// Add name property for MCP protocol compliance
trackChangesTool.name = 'track_changes';

// Add validateParameters method for MCP protocol compliance
trackChangesTool.validateParameters = function(params) {
  return TrackChangesSchema.parse(params);
};

// Add description property for MCP protocol compliance
trackChangesTool.description = 'Track and analyze content changes with baseline capture, comparison, and monitoring capabilities';

// Add inputSchema property for MCP protocol compliance
trackChangesTool.inputSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: 'URL to track for changes'
    },
    operation: {
      type: 'string',
      description: 'Operation to perform: create_baseline, compare, monitor, get_history, get_stats'
    },
    content: {
      type: 'string',
      description: 'Content to analyze or compare'
    }
  },
  required: ['url']
};

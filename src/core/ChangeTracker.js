import crypto from "crypto";
/**
 * ChangeTracker - Enhanced Content Change Detection and Analysis (Phase 2.4)
 * Implements hierarchical content hashing (page → sections → elements)
 * with differential comparison engine, change significance scoring,
 * scheduled monitoring, advanced comparison engine, alert system,
 * and historical analysis capabilities
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import { EventEmitter } from 'events';
import { load } from 'cheerio';
import { diffWords, diffLines, diffChars } from 'diff';
import * as cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';

const ChangeTrackingSchema = z.object({
  url: z.string().url(),
  content: z.string(),
  html: z.string().optional(),
  options: z.object({
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
      'script', 'style', 'noscript', '.advertisement', '.ad'
    ]),
    significanceThresholds: z.object({
      minor: z.number().min(0).max(1).default(0.1),
      moderate: z.number().min(0).max(1).default(0.3),
      major: z.number().min(0).max(1).default(0.7)
    }).optional()
  }).optional().default({})
});

const ChangeComparisonSchema = z.object({
  baselineUrl: z.string().url(),
  currentUrl: z.string().url(),
  baselineContent: z.string(),
  currentContent: z.string(),
  options: z.object({}).optional()
});

const ChangeSignificance = z.enum(['none', 'minor', 'moderate', 'major', 'critical']);

export class ChangeTracker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      hashAlgorithm: 'sha256',
      maxHistoryLength: 100,
      enableRealTimeTracking: true,
      monitoringInterval: 300000, // 5 minutes
      enableChangeSignificanceScoring: true,
      enableStructuralAnalysis: true,
      enableSemanticAnalysis: false,
      contentSimilarityThreshold: 0.8,
      ...options
    };
    
    // Content snapshots and hashes
    this.snapshots = new Map();
    this.contentHashes = new Map();
    this.changeHistory = new Map();
    this.structuralHashes = new Map();
    
    // Change detection state
    this.activeMonitors = new Map();
    this.lastProcessedTimestamps = new Map();
    
    // Content history and snapshots management
    this.contentHistory = new Map();
    this.baselineContent = new Map();
    this.changeNotifications = new Map();
    this.snapshotManager = new Map();
    
    // Phase 2.4 Enhanced Features
    this.scheduledMonitors = new Map(); // Cron-based monitoring
    this.monitoringTemplates = new Map(); // Reusable monitoring configurations
    this.alertRules = new Map(); // Custom alert rules and conditions
    this.alertHistory = new Map(); // Alert notification history
    this.trendAnalysis = new Map(); // Pattern recognition data
    this.visualRegression = new Map(); // Visual diff storage
    this.alertThrottling = new Map(); // Alert rate limiting
    this.semanticDiffCache = new Map(); // Semantic analysis cache
    this.monitoringDashboard = {
      status: 'initialized',
      monitors: new Map(),
      alerts: [],
      trends: {}
    };
    // Enhanced Statistics
    this.stats = {
      pagesTracked: 0,
      changesDetected: 0,
      significantChanges: 0,
      structuralChanges: 0,
      contentChanges: 0,
      falsePositives: 0,
      averageChangeScore: 0,
      lastAnalysis: null,
      processingTime: 0,
      // Phase 2.4 additions
      scheduledMonitors: 0,
      alertsSent: 0,
      alertsThrottled: 0,
      semanticAnalyses: 0,
      visualRegression: 0,
      trendPatternsDetected: 0,
      averageAlertResponseTime: 0,
      monitoringUptime: 0
    };
    
    // Semantic analysis tools (if enabled)
    this.semanticAnalyzer = null;
    
    this.initialize();
  }
  
  async initialize() {
    // Initialize semantic analysis if enabled
    if (this.options.enableSemanticAnalysis) {
      await this.initializeSemanticAnalyzer();
    }
    
    // Initialize Phase 2.4 components
    await this.initializeEnhancedFeatures();
    
    this.emit('initialized');
  }
  
  /**
   * Initialize Enhanced Features for Phase 2.4
   */
  async initializeEnhancedFeatures() {
    try {
      // Initialize monitoring dashboard
      this.monitoringDashboard.status = 'initializing';
      
      // Load existing monitoring templates
      await this.loadMonitoringTemplates();
      
      // Initialize alert system
      await this.initializeAlertSystem();
      
      // Set up historical analysis
      await this.initializeHistoricalAnalysis();
      
      // Initialize semantic diff engine if enabled
      if (this.options.enableSemanticAnalysis) {
        await this.initializeSemanticDiffEngine();
      }
      
      this.monitoringDashboard.status = 'active';
      this.emit('enhancedFeaturesInitialized');
      
    } catch (error) {
      this.monitoringDashboard.status = 'error';
      this.emit('error', { operation: 'initializeEnhancedFeatures', error: error.message });
      throw error;
    }
  }
  
  /**
   * Load monitoring templates from storage
   */
  async loadMonitoringTemplates() {
    const defaultTemplates = {
      'news-site': {
        name: 'News Site Monitoring',
        frequency: '*/15 * * * *', // Every 15 minutes
        options: {
          granularity: 'section',
          trackText: true,
          trackStructure: false,
          significanceThresholds: { minor: 0.05, moderate: 0.2, major: 0.5 }
        },
        alertRules: {
          threshold: 'minor',
          methods: ['webhook', 'email'],
          throttle: 300000 // 5 minutes
        }
      },
      'e-commerce': {
        name: 'E-commerce Site Monitoring',
        frequency: '0 */2 * * *', // Every 2 hours
        options: {
          granularity: 'element',
          trackText: true,
          trackStructure: true,
          trackImages: true,
          customSelectors: ['.price', '.stock-status', '.product-title']
        },
        alertRules: {
          threshold: 'moderate',
          methods: ['webhook', 'slack'],
          throttle: 600000 // 10 minutes
        }
      },
      'documentation': {
        name: 'Documentation Monitoring',
        frequency: '0 9 * * *', // Daily at 9 AM
        options: {
          granularity: 'section',
          trackText: true,
          trackStructure: true,
          excludeSelectors: ['.last-updated', '.edit-link']
        },
        alertRules: {
          threshold: 'major',
          methods: ['email'],
          throttle: 3600000 // 1 hour
        }
      }
    };
    
    for (const [id, template] of Object.entries(defaultTemplates)) {
      this.monitoringTemplates.set(id, template);
    }
  }
  
  /**
   * Initialize alert system with default rules
   */
  async initializeAlertSystem() {
    // Default alert rules
    const defaultAlertRules = {
      'critical-changes': {
        condition: (changeResult) => changeResult.significance === 'critical',
        actions: ['webhook', 'email', 'slack'],
        throttle: 0, // No throttling for critical changes
        priority: 'high'
      },
      'frequent-changes': {
        condition: (url, history) => {
          const recent = history.filter(h => Date.now() - h.timestamp < 3600000); // Last hour
          return recent.length > 5;
        },
        actions: ['webhook'],
        throttle: 1800000, // 30 minutes
        priority: 'medium'
      },
      'structural-changes': {
        condition: (changeResult) => changeResult.changeType === 'structural',
        actions: ['webhook', 'email'],
        throttle: 600000, // 10 minutes
        priority: 'medium'
      }
    };
    
    for (const [id, rule] of Object.entries(defaultAlertRules)) {
      this.alertRules.set(id, rule);
    }
  }
  
  /**
   * Initialize historical analysis capabilities
   */
  async initializeHistoricalAnalysis() {
    // Initialize trend analysis patterns
    this.trendAnalysis.set('patterns', {
      dailyChangePatterns: new Map(),
      weeklyTrends: new Map(),
      contentVelocity: new Map(),
      changeFrequency: new Map()
    });
  }
  
  /**
   * Initialize semantic diff engine
   */
  async initializeSemanticDiffEngine() {
    // Initialize semantic analysis components
    this.semanticDiffCache.set('initialized', true);
    this.semanticDiffCache.set('algorithms', {
      textSimilarity: this.calculateTextSimilarity.bind(this),
      structuralSimilarity: this.calculateStructuralSimilarity.bind(this),
      semanticSimilarity: this.calculateSemanticSimilarity.bind(this)
    });
  }
  
  /**
   * Create scheduled monitoring with cron-like scheduling
   * @param {string} url - URL to monitor
   * @param {string} schedule - Cron expression
   * @param {Object} options - Monitoring options
   * @returns {Object} - Monitor configuration
   */
  async createScheduledMonitor(url, schedule, options = {}) {
    try {
      // Validate cron expression
      if (!cron.validate(schedule)) {
        throw new Error(`Invalid cron expression: ${schedule}`);
      }
      
      const monitorId = `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const monitorConfig = {
        id: monitorId,
        url,
        schedule,
        options: {
          granularity: 'section',
          trackText: true,
          trackStructure: true,
          alertRules: {
            threshold: 'moderate',
            methods: ['webhook'],
            throttle: 600000
          },
          ...options
        },
        stats: {
          created: Date.now(),
          executions: 0,
          lastExecution: null,
          changesDetected: 0,
          errors: 0,
          averageExecutionTime: 0
        },
        status: 'active'
      };
      
      // Create cron job
      const cronJob = cron.schedule(schedule, async () => {
        await this.executeScheduledMonitor(monitorId);
      }, {
        scheduled: true,
        timezone: 'UTC'
      });
      
      monitorConfig.cronJob = cronJob;
      
      // Store monitor
      this.scheduledMonitors.set(monitorId, monitorConfig);
      this.monitoringDashboard.monitors.set(monitorId, {
        url,
        schedule,
        status: 'active',
        nextExecution: cronJob.nextDates().toString()
      });
      
      this.stats.scheduledMonitors++;
      
      this.emit('scheduledMonitorCreated', {
        monitorId,
        url,
        schedule,
        nextExecution: cronJob.nextDates().toString()
      });
      
      return {
        success: true,
        monitorId,
        url,
        schedule,
        nextExecution: cronJob.nextDates().toString(),
        options: monitorConfig.options
      };
      
    } catch (error) {
      this.emit('error', { operation: 'createScheduledMonitor', url, error: error.message });
      throw new Error(`Failed to create scheduled monitor: ${error.message}`);
    }
  }
  
  /**
   * Execute scheduled monitor check
   * @param {string} monitorId - Monitor ID
   */
  async executeScheduledMonitor(monitorId) {
    const startTime = Date.now();
    
    try {
      const monitor = this.scheduledMonitors.get(monitorId);
      if (!monitor || monitor.status !== 'active') {
        return;
      }
      
      monitor.stats.executions++;
      monitor.stats.lastExecution = Date.now();
      
      // Fetch current content
      const response = await fetch(monitor.url, {
        headers: {
          'User-Agent': 'MCP-WebScraper-ChangeTracker/3.0-Enhanced',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 30000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const currentContent = await response.text();
      
      // Perform enhanced comparison
      const comparisonResult = await this.performEnhancedComparison(
        monitor.url,
        currentContent,
        monitor.options
      );
      
      // Update execution time stats
      const executionTime = Date.now() - startTime;
      monitor.stats.averageExecutionTime = 
        (monitor.stats.averageExecutionTime * (monitor.stats.executions - 1) + executionTime) / 
        monitor.stats.executions;
      
      // Process change result
      if (comparisonResult.hasChanges) {
        monitor.stats.changesDetected++;
        
        // Update trend analysis
        await this.updateTrendAnalysis(monitor.url, comparisonResult);
        
        // Check alert rules and send notifications
        await this.processAlertRules(monitor.url, comparisonResult, monitor.options.alertRules);
      }
      
      this.emit('scheduledMonitorExecuted', {
        monitorId,
        url: monitor.url,
        hasChanges: comparisonResult.hasChanges,
        significance: comparisonResult.significance,
        executionTime
      });
      
    } catch (error) {
      const monitor = this.scheduledMonitors.get(monitorId);
      if (monitor) {
        monitor.stats.errors++;
      }
      
      this.emit('scheduledMonitorError', {
        monitorId,
        error: error.message,
        timestamp: Date.now()
      });
    }\n  }\n  \n  /**\n   * Perform enhanced comparison with semantic analysis\n   * @param {string} url - URL being compared\n   * @param {string} currentContent - Current content\n   * @param {Object} options - Comparison options\n   * @returns {Object} - Enhanced comparison results\n   */\n  async performEnhancedComparison(url, currentContent, options = {}) {\n    try {\n      // Get standard comparison\n      const standardComparison = await this.compareWithBaseline(url, currentContent, options);\n      \n      if (!standardComparison.hasChanges) {\n        return standardComparison;\n      }\n      \n      // Enhance with semantic analysis\n      const semanticAnalysis = await this.performSemanticAnalysis(\n        url, \n        currentContent, \n        standardComparison\n      );\n      \n      // Enhance with visual regression detection\n      const visualAnalysis = await this.performVisualRegressionAnalysis(\n        url,\n        currentContent,\n        options\n      );\n      \n      // Enhance with structured data analysis\n      const structuredAnalysis = await this.performStructuredDataAnalysis(\n        url,\n        currentContent,\n        standardComparison\n      );\n      \n      // Calculate enhanced significance score\n      const enhancedSignificance = await this.calculateEnhancedSignificance(\n        standardComparison,\n        semanticAnalysis,\n        visualAnalysis,\n        structuredAnalysis\n      );\n      \n      return {\n        ...standardComparison,\n        enhancedFeatures: {\n          semanticAnalysis,\n          visualAnalysis,\n          structuredAnalysis,\n          enhancedSignificance\n        },\n        significance: enhancedSignificance,\n        analysisType: 'enhanced'\n      };\n      \n    } catch (error) {\n      this.emit('error', { operation: 'performEnhancedComparison', url, error: error.message });\n      // Fall back to standard comparison\n      return await this.compareWithBaseline(url, currentContent, options);\n    }\n  }\n  \n  /**\n   * Perform semantic analysis of changes\n   * @param {string} url - URL\n   * @param {string} currentContent - Current content\n   * @param {Object} standardComparison - Standard comparison results\n   * @returns {Object} - Semantic analysis results\n   */\n  async performSemanticAnalysis(url, currentContent, standardComparison) {\n    const analysis = {\n      textualSimilarity: 0,\n      conceptualChanges: [],\n      sentimentChanges: [],\n      topicShifts: [],\n      keywordChanges: [],\n      confidenceScore: 0\n    };\n    \n    try {\n      // Get baseline content\n      const baseline = this.getLatestBaseline(url);\n      if (!baseline) {\n        return analysis;\n      }\n      \n      // Extract text content from both versions\n      const $ = load(currentContent);\n      const currentText = $.text().replace(/\\s+/g, ' ').trim();\n      \n      const $baseline = load(baseline.analysis.originalContent);\n      const baselineText = $baseline.text().replace(/\\s+/g, ' ').trim();\n      \n      // Calculate textual similarity using advanced algorithms\n      analysis.textualSimilarity = this.calculateTextSimilarity(baselineText, currentText);\n      \n      // Detect keyword changes\n      analysis.keywordChanges = this.detectKeywordChanges(baselineText, currentText);\n      \n      // Simple topic shift detection\n      analysis.topicShifts = this.detectTopicShifts(baselineText, currentText);\n      \n      // Calculate confidence score\n      analysis.confidenceScore = this.calculateSemanticConfidence(analysis);\n      \n      this.stats.semanticAnalyses++;\n      \n      return analysis;\n      \n    } catch (error) {\n      this.emit('error', { operation: 'performSemanticAnalysis', url, error: error.message });\n      return analysis;\n    }\n  }\n  \n  /**\n   * Perform visual regression analysis\n   * @param {string} url - URL\n   * @param {string} currentContent - Current content\n   * @param {Object} options - Analysis options\n   * @returns {Object} - Visual analysis results\n   */\n  async performVisualRegressionAnalysis(url, currentContent, options = {}) {\n    const analysis = {\n      layoutChanges: [],\n      cssChanges: [],\n      imageChanges: [],\n      fontChanges: [],\n      colorChanges: [],\n      hasVisualChanges: false\n    };\n    \n    try {\n      const $ = load(currentContent);\n      const baseline = this.getLatestBaseline(url);\n      \n      if (!baseline) {\n        return analysis;\n      }\n      \n      const $baseline = load(baseline.analysis.originalContent);\n      \n      // Detect layout changes\n      analysis.layoutChanges = this.detectLayoutChanges($baseline, $);\n      \n      // Detect CSS changes\n      analysis.cssChanges = this.detectCSSChanges($baseline, $);\n      \n      // Detect image changes\n      analysis.imageChanges = this.detectImageChanges($baseline, $);\n      \n      // Determine if there are visual changes\n      analysis.hasVisualChanges = \n        analysis.layoutChanges.length > 0 ||\n        analysis.cssChanges.length > 0 ||\n        analysis.imageChanges.length > 0;\n      \n      if (analysis.hasVisualChanges) {\n        this.stats.visualRegression++;\n      }\n      \n      return analysis;\n      \n    } catch (error) {\n      this.emit('error', { operation: 'performVisualRegressionAnalysis', url, error: error.message });\n      return analysis;\n    }\n  }\n  \n  /**\n   * Perform structured data analysis\n   * @param {string} url - URL\n   * @param {string} currentContent - Current content\n   * @param {Object} standardComparison - Standard comparison results\n   * @returns {Object} - Structured data analysis\n   */\n  async performStructuredDataAnalysis(url, currentContent, standardComparison) {\n    const analysis = {\n      schemaChanges: [],\n      dataFieldChanges: [],\n      validationChanges: [],\n      metadataChanges: [],\n      hasStructuredChanges: false\n    };\n    \n    try {\n      const $ = load(currentContent);\n      const baseline = this.getLatestBaseline(url);\n      \n      if (!baseline) {\n        return analysis;\n      }\n      \n      // Extract structured data (JSON-LD, microdata, etc.)\n      const currentStructuredData = this.extractStructuredData($);\n      const baselineStructuredData = this.extractStructuredData(load(baseline.analysis.originalContent));\n      \n      // Compare structured data\n      analysis.schemaChanges = this.compareStructuredData(baselineStructuredData, currentStructuredData);\n      \n      // Detect metadata changes\n      analysis.metadataChanges = this.compareMetadata(\n        baseline.analysis.metadata,\n        standardComparison.details.current?.metadata || {}\n      );\n      \n      analysis.hasStructuredChanges = \n        analysis.schemaChanges.length > 0 ||\n        analysis.metadataChanges.length > 0;\n      \n      return analysis;\n      \n    } catch (error) {\n      this.emit('error', { operation: 'performStructuredDataAnalysis', url, error: error.message });\n      return analysis;\n    }\n  }\n  \n  /**\n   * Update trend analysis with new change data\n   * @param {string} url - URL\n   * @param {Object} changeResult - Change analysis results\n   */\n  async updateTrendAnalysis(url, changeResult) {\n    try {\n      const patterns = this.trendAnalysis.get('patterns');\n      const now = new Date();\n      const dayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD\n      const hourKey = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH\n      \n      // Update daily patterns\n      if (!patterns.dailyChangePatterns.has(url)) {\n        patterns.dailyChangePatterns.set(url, new Map());\n      }\n      \n      const urlDailyPatterns = patterns.dailyChangePatterns.get(url);\n      if (!urlDailyPatterns.has(dayKey)) {\n        urlDailyPatterns.set(dayKey, {\n          changes: 0,\n          significance: [],\n          types: []\n        });\n      }\n      \n      const dayData = urlDailyPatterns.get(dayKey);\n      dayData.changes++;\n      dayData.significance.push(changeResult.significance);\n      dayData.types.push(changeResult.changeType);\n      \n      // Update change frequency\n      if (!patterns.changeFrequency.has(url)) {\n        patterns.changeFrequency.set(url, []);\n      }\n      \n      patterns.changeFrequency.get(url).push({\n        timestamp: Date.now(),\n        significance: changeResult.significance,\n        type: changeResult.changeType\n      });\n      \n      // Keep only last 1000 entries per URL\n      const frequency = patterns.changeFrequency.get(url);\n      if (frequency.length > 1000) {\n        frequency.splice(0, frequency.length - 1000);\n      }\n      \n      // Detect patterns\n      await this.detectChangePatterns(url, patterns);\n      \n    } catch (error) {\n      this.emit('error', { operation: 'updateTrendAnalysis', url, error: error.message });\n    }\n  }\n  \n  /**\n   * Process alert rules and send notifications\n   * @param {string} url - URL\n   * @param {Object} changeResult - Change results\n   * @param {Object} alertRules - Alert configuration\n   */\n  async processAlertRules(url, changeResult, alertRules = {}) {\n    try {\n      const alertsToSend = [];\n      \n      // Check each alert rule\n      for (const [ruleId, rule] of this.alertRules.entries()) {\n        let shouldTrigger = false;\n        \n        if (typeof rule.condition === 'function') {\n          try {\n            const history = this.getChangeHistory(url, 100);\n            shouldTrigger = rule.condition(changeResult, history);\n          } catch (error) {\n            this.emit('error', { \n              operation: 'evaluateAlertRule', \n              ruleId, \n              url, \n              error: error.message \n            });\n            continue;\n          }\n        }\n        \n        if (shouldTrigger) {\n          // Check throttling\n          const throttleKey = `${url}_${ruleId}`;\n          const lastAlert = this.alertThrottling.get(throttleKey);\n          \n          if (lastAlert && Date.now() - lastAlert < rule.throttle) {\n            this.stats.alertsThrottled++;\n            continue;\n          }\n          \n          alertsToSend.push({\n            ruleId,\n            rule,\n            url,\n            changeResult,\n            timestamp: Date.now()\n          });\n          \n          // Update throttling\n          this.alertThrottling.set(throttleKey, Date.now());\n        }\n      }\n      \n      // Send alerts\n      for (const alert of alertsToSend) {\n        await this.sendAlert(alert);\n      }\n      \n    } catch (error) {\n      this.emit('error', { operation: 'processAlertRules', url, error: error.message });\n    }\n  }\n  \n  /**\n   * Send alert notification\n   * @param {Object} alert - Alert configuration\n   */\n  async sendAlert(alert) {\n    const startTime = Date.now();\n    \n    try {\n      const alertData = {\n        id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,\n        ruleId: alert.ruleId,\n        url: alert.url,\n        timestamp: alert.timestamp,\n        priority: alert.rule.priority,\n        changeResult: {\n          significance: alert.changeResult.significance,\n          changeType: alert.changeResult.changeType,\n          summary: alert.changeResult.summary\n        }\n      };\n      \n      // Send to each configured method\n      const promises = alert.rule.actions.map(async (action) => {\n        try {\n          await this.sendNotificationByMethod(action, alertData);\n          this.emit('alertSent', { action, alertId: alertData.id, url: alert.url });\n        } catch (error) {\n          this.emit('alertError', { \n            action, \n            alertId: alertData.id, \n            url: alert.url, \n            error: error.message \n          });\n        }\n      });\n      \n      await Promise.allSettled(promises);\n      \n      // Store alert in history\n      if (!this.alertHistory.has(alert.url)) {\n        this.alertHistory.set(alert.url, []);\n      }\n      \n      this.alertHistory.get(alert.url).unshift(alertData);\n      \n      // Keep only last 100 alerts per URL\n      const history = this.alertHistory.get(alert.url);\n      if (history.length > 100) {\n        history.splice(100);\n      }\n      \n      // Update stats\n      this.stats.alertsSent++;\n      const responseTime = Date.now() - startTime;\n      this.stats.averageAlertResponseTime = \n        (this.stats.averageAlertResponseTime * (this.stats.alertsSent - 1) + responseTime) / \n        this.stats.alertsSent;\n      \n      this.emit('alertProcessed', {\n        alertId: alertData.id,\n        url: alert.url,\n        responseTime\n      });\n      \n    } catch (error) {\n      this.emit('error', { operation: 'sendAlert', url: alert.url, error: error.message });\n    }\n  }\n  \n  /**\n   * Send notification by specific method\n   * @param {string} method - Notification method\n   * @param {Object} alertData - Alert data\n   */\n  async sendNotificationByMethod(method, alertData) {\n    switch (method) {\n      case 'webhook':\n        await this.sendWebhookAlert(alertData);\n        break;\n      case 'email':\n        await this.sendEmailAlert(alertData);\n        break;\n      case 'slack':\n        await this.sendSlackAlert(alertData);\n        break;\n      default:\n        throw new Error(`Unknown notification method: ${method}`);\n    }\n  }\n  \n  /**\n   * Generate trend analysis report\n   * @param {string} url - URL (optional, for specific URL analysis)\n   * @returns {Object} - Trend analysis report\n   */\n  async generateTrendAnalysisReport(url = null) {\n    try {\n      const report = {\n        timestamp: Date.now(),\n        scope: url ? 'url-specific' : 'global',\n        url,\n        patterns: {},\n        insights: [],\n        recommendations: []\n      };\n      \n      const patterns = this.trendAnalysis.get('patterns');\n      \n      if (url) {\n        // URL-specific analysis\n        report.patterns = await this.analyzeUrlPatterns(url, patterns);\n      } else {\n        // Global analysis\n        report.patterns = await this.analyzeGlobalPatterns(patterns);\n      }\n      \n      // Generate insights\n      report.insights = this.generateTrendInsights(report.patterns);\n      \n      // Generate recommendations\n      report.recommendations = this.generateTrendRecommendations(report.patterns, report.insights);\n      \n      return report;\n      \n    } catch (error) {\n      this.emit('error', { operation: 'generateTrendAnalysisReport', url, error: error.message });\n      throw error;\n    }\n  }\n  \n  /**\n   * Export historical data\n   * @param {Object} options - Export options\n   * @returns {Object} - Exported data\n   */\n  async exportHistoricalData(options = {}) {\n    const {\n      format = 'json',\n      url = null,\n      startTime = null,\n      endTime = null,\n      includeContent = false,\n      includeSnapshots = false\n    } = options;\n    \n    try {\n      const exportData = {\n        metadata: {\n          exportTime: Date.now(),\n          format,\n          scope: url ? 'url-specific' : 'global',\n          url,\n          timeRange: { startTime, endTime },\n          options\n        },\n        changeHistory: {},\n        snapshots: {},\n        alertHistory: {},\n        trendAnalysis: {},\n        statistics: this.getEnhancedStats()\n      };\n      \n      // Export change history\n      const urls = url ? [url] : Array.from(this.changeHistory.keys());\n      \n      for (const targetUrl of urls) {\n        let history = this.getChangeHistory(targetUrl, 10000);\n        \n        // Apply time filters\n        if (startTime || endTime) {\n          history = history.filter(entry => {\n            if (startTime && entry.timestamp < startTime) return false;\n            if (endTime && entry.timestamp > endTime) return false;\n            return true;\n          });\n        }\n        \n        // Remove content if not requested\n        if (!includeContent) {\n          history = history.map(entry => {\n            const { details, ...rest } = entry;\n            return {\n              ...rest,\n              details: details ? {\n                similarity: details.similarity,\n                significance: details.significance\n              } : undefined\n            };\n          });\n        }\n        \n        exportData.changeHistory[targetUrl] = history;\n        \n        // Export alert history\n        if (this.alertHistory.has(targetUrl)) {\n          exportData.alertHistory[targetUrl] = this.alertHistory.get(targetUrl);\n        }\n      }\n      \n      // Export trend analysis\n      const patterns = this.trendAnalysis.get('patterns');\n      if (patterns) {\n        exportData.trendAnalysis = {\n          dailyPatterns: Object.fromEntries(patterns.dailyChangePatterns),\n          changeFrequency: Object.fromEntries(patterns.changeFrequency)\n        };\n      }\n      \n      // Format output\n      if (format === 'csv') {\n        return this.convertToCSV(exportData);\n      }\n      \n      return exportData;\n      \n    } catch (error) {\n      this.emit('error', { operation: 'exportHistoricalData', error: error.message });\n      throw error;\n    }\n  }\n  \n  /**\n   * Get monitoring dashboard status\n   * @returns {Object} - Dashboard data\n   */\n  getMonitoringDashboard() {\n    return {\n      status: this.monitoringDashboard.status,\n      monitors: Array.from(this.monitoringDashboard.monitors.entries()).map(([id, config]) => ({\n        id,\n        ...config\n      })),\n      recentAlerts: this.monitoringDashboard.alerts.slice(-10),\n      trends: this.monitoringDashboard.trends,\n      statistics: this.getEnhancedStats(),\n      timestamp: Date.now()\n    };\n  }\n  \n  /**\n   * Get enhanced statistics\n   * @returns {Object} - Enhanced statistics\n   */\n  getEnhancedStats() {\n    return {\n      ...this.stats,\n      activeScheduledMonitors: this.scheduledMonitors.size,\n      alertRules: this.alertRules.size,\n      monitoringTemplates: this.monitoringTemplates.size,\n      throttledAlerts: this.alertThrottling.size,\n      trendPatterns: this.trendAnalysis.has('patterns') ? \n        this.trendAnalysis.get('patterns').dailyChangePatterns.size : 0\n    };\n  }\n  \n  /**\n   * Create baseline snapshot for change tracking
   * @param {string} url - URL to track
   * @param {string} content - Content to establish as baseline
   * @param {Object} options - Tracking options
   * @returns {Object} - Baseline snapshot information
   */
  async createBaseline(url, content, options = {}) {
    const startTime = Date.now();
    
    try {
      const validated = ChangeTrackingSchema.parse({ url, content, options });
      const { granularity, trackText, trackStructure } = validated.options;
      
      // Generate hierarchical content hashes
      const contentAnalysis = await this.analyzeContent(content, validated.options);
      
      const baseline = {
        url,
        timestamp: Date.now(),
        contentLength: content.length,
        granularity,
        analysis: contentAnalysis,
        options: validated.options,
        version: 1
      };
      
      // Store baseline
      this.snapshots.set(url, [baseline]);
      this.contentHashes.set(url, contentAnalysis.hashes);
      this.changeHistory.set(url, []);
      this.lastProcessedTimestamps.set(url, Date.now());
      
      this.stats.pagesTracked++;
      this.stats.processingTime += Date.now() - startTime;
      
      this.emit('baselineCreated', {
        url,
        baseline,
        processingTime: Date.now() - startTime
      });
      
      return {
        success: true,
        url,
        version: 1,
        contentHash: contentAnalysis.hashes.page,
        sections: Object.keys(contentAnalysis.hashes.sections).length,
        elements: Object.keys(contentAnalysis.hashes.elements).length,
        createdAt: baseline.timestamp
      };
      
    } catch (error) {
      this.emit('error', { operation: 'createBaseline', url, error: error.message });
      throw new Error(`Failed to create baseline for ${url}: ${error.message}`);
    }
  }
  
  /**
   * Compare current content against baseline
   * @param {string} url - URL to compare
   * @param {string} currentContent - Current content
   * @param {Object} options - Comparison options
   * @returns {Object} - Change analysis results
   */
  async compareWithBaseline(url, currentContent, options = {}) {
    const startTime = Date.now();
    
    try {
      if (!this.snapshots.has(url)) {
        throw new Error(`No baseline found for URL: ${url}`);
      }
      
      const snapshots = this.snapshots.get(url);
      const baseline = snapshots[snapshots.length - 1]; // Get latest baseline
      
      const validated = ChangeComparisonSchema.parse({
        baselineUrl: url,
        currentUrl: url,
        baselineContent: baseline.analysis.originalContent || '',
        currentContent,
        options
      });
      
      // Analyze current content
      const currentAnalysis = await this.analyzeContent(currentContent, baseline.options);
      
      // Perform comprehensive change detection
      const changeAnalysis = await this.detectChanges(
        baseline.analysis,
        currentAnalysis,
        baseline.options
      );
      
      // Calculate change significance
      const significance = await this.calculateChangeSignificance(changeAnalysis, baseline.options);
      
      // Create change record
      const changeRecord = {
        url,
        timestamp: Date.now(),
        baselineVersion: baseline.version,
        changeType: this.classifyChangeType(changeAnalysis),
        significance,
        details: changeAnalysis,
        metrics: {
          contentSimilarity: changeAnalysis.similarity,
          structuralSimilarity: changeAnalysis.structuralSimilarity,
          addedElements: changeAnalysis.addedElements?.length || 0,
          removedElements: changeAnalysis.removedElements?.length || 0,
          modifiedElements: changeAnalysis.modifiedElements?.length || 0
        },
        processingTime: 0
      };
      
      changeRecord.processingTime = Date.now() - startTime;
      
      // Store change record
      const changeHistory = this.changeHistory.get(url);
      changeHistory.push(changeRecord);
      
      // Update statistics
      this.updateStats(changeRecord);
      
      // Update content hashes if significant change
      if (significance !== 'none') {
        this.contentHashes.set(url, currentAnalysis.hashes);
      }
      
      this.emit('changeDetected', changeRecord);
      
      return {
        hasChanges: significance !== 'none',
        significance,
        changeType: changeRecord.changeType,
        summary: this.generateChangeSummary(changeAnalysis),
        details: changeAnalysis,
        metrics: changeRecord.metrics,
        recommendations: this.generateChangeRecommendations(changeRecord)
      };
      
    } catch (error) {
      this.emit('error', { operation: 'compareWithBaseline', url, error: error.message });
      throw new Error(`Failed to compare content for ${url}: ${error.message}`);
    }
  }
  
  /**
   * Analyze content structure and create hierarchical hashes
   * @param {string} content - Content to analyze
   * @param {Object} options - Analysis options
   * @returns {Object} - Content analysis results
   */
  async analyzeContent(content, options = {}) {
    const analysis = {
      originalContent: content,
      hashes: {
        page: this.hashContent(content),
        sections: {},
        elements: {},
        text: {}
      },
      structure: {},
      metadata: {},
      statistics: {}
    };
    
    try {
      // Parse HTML if available
      const $ = load(content);
      
      // Remove excluded elements
      options.excludeSelectors?.forEach(selector => {
        $(selector).remove();
      });
      
      // Analyze at different granularities
      switch (options.granularity) {
        case 'element':
          await this.analyzeElementLevel($, analysis, options);
          break;
        case 'section':
          await this.analyzeSectionLevel($, analysis, options);
          break;
        case 'text':
          await this.analyzeTextLevel($, analysis, options);
          break;
        default:
          await this.analyzePageLevel($, analysis, options);
      }
      
      // Extract structural information
      if (options.trackStructure) {
        analysis.structure = this.extractStructure($, options);
      }
      
      // Extract metadata
      analysis.metadata = this.extractMetadata($, options);
      
      // Calculate statistics
      analysis.statistics = this.calculateContentStatistics(content, $);
      
    } catch (error) {
      // Fallback to plain text analysis
      analysis.hashes.text.plain = this.hashContent(content);
      analysis.statistics = {
        contentLength: content.length,
        wordCount: content.split(/\s+/).length,
        error: error.message
      };
    }
    
    return analysis;
  }
  
  /**
   * Detect changes between two content analyses
   * @param {Object} baseline - Baseline content analysis
   * @param {Object} current - Current content analysis
   * @param {Object} options - Detection options
   * @returns {Object} - Change detection results
   */
  async detectChanges(baseline, current, options = {}) {
    const changes = {
      similarity: 0,
      structuralSimilarity: 0,
      addedElements: [],
      removedElements: [],
      modifiedElements: [],
      textChanges: [],
      structuralChanges: [],
      attributeChanges: [],
      imageChanges: [],
      linkChanges: []
    };
    
    // Calculate overall content similarity
    changes.similarity = this.calculateSimilarity(
      baseline.hashes.page,
      current.hashes.page
    );
    
    // Detect structural changes
    if (options.trackStructure) {
      changes.structuralChanges = await this.detectStructuralChanges(
        baseline.structure,
        current.structure
      );
      
      changes.structuralSimilarity = this.calculateStructuralSimilarity(
        baseline.structure,
        current.structure
      );
    }
    
    // Detect section-level changes
    const sectionChanges = this.detectHashChanges(
      baseline.hashes.sections,
      current.hashes.sections
    );
    
    changes.addedElements.push(...sectionChanges.added);
    changes.removedElements.push(...sectionChanges.removed);
    changes.modifiedElements.push(...sectionChanges.modified);
    
    // Detect element-level changes
    if (baseline.hashes.elements && current.hashes.elements) {
      const elementChanges = this.detectHashChanges(
        baseline.hashes.elements,
        current.hashes.elements
      );
      
      changes.addedElements.push(...elementChanges.added);
      changes.removedElements.push(...elementChanges.removed);
      changes.modifiedElements.push(...elementChanges.modified);
    }
    
    // Detect text changes
    if (options.trackText) {
      changes.textChanges = await this.detectTextChanges(
        baseline.originalContent,
        current.originalContent,
        options
      );
    }
    
    // Detect link changes
    if (options.trackLinks) {
      changes.linkChanges = this.detectLinkChanges(
        baseline.metadata.links || [],
        current.metadata.links || []
      );
    }
    
    // Detect image changes
    if (options.trackImages) {
      changes.imageChanges = this.detectImageChanges(
        baseline.metadata.images || [],
        current.metadata.images || []
      );
    }
    
    return changes;
  }
  
  /**
   * Calculate change significance score
   * @param {Object} changeAnalysis - Change analysis results
   * @param {Object} options - Scoring options
   * @returns {string} - Significance level
   */
  async calculateChangeSignificance(changeAnalysis, options = {}) {
    const thresholds = options.significanceThresholds || {
      minor: 0.1,
      moderate: 0.3,
      major: 0.7
    };
    
    let significanceScore = 0;
    const weights = {
      similarity: 0.3,
      structural: 0.2,
      additions: 0.15,
      removals: 0.15,
      modifications: 0.1,
      textChanges: 0.1
    };
    
    // Content similarity impact (inverted - less similarity = more significant)
    significanceScore += (1 - changeAnalysis.similarity) * weights.similarity;
    
    // Structural changes impact
    if (changeAnalysis.structuralChanges.length > 0) {
      significanceScore += Math.min(changeAnalysis.structuralChanges.length * 0.1, 1) * weights.structural;
    }
    
    // Element changes impact
    const totalElements = changeAnalysis.addedElements.length +
                         changeAnalysis.removedElements.length +
                         changeAnalysis.modifiedElements.length;
    
    significanceScore += Math.min(totalElements * 0.05, 1) * 
      (weights.additions + weights.removals + weights.modifications);
    
    // Text changes impact
    if (changeAnalysis.textChanges.length > 0) {
      const textChangeRatio = changeAnalysis.textChanges.reduce(
        (sum, change) => sum + (change.added?.length || 0) + (change.removed?.length || 0),
        0
      ) / 1000; // Normalize by character count
      
      significanceScore += Math.min(textChangeRatio, 1) * weights.textChanges;
    }
    
    // Determine significance level
    if (significanceScore < thresholds.minor) {
      return 'none';
    } else if (significanceScore < thresholds.moderate) {
      return 'minor';
    } else if (significanceScore < thresholds.major) {
      return 'moderate';
    } else if (significanceScore < 0.9) {
      return 'major';
    } else {
      return 'critical';
    }
  }
  
  // Content Analysis Methods
  
  async analyzePageLevel($, analysis, options) {
    const pageContent = $.html();
    analysis.hashes.page = this.hashContent(pageContent);
    
    if (options.trackText) {
      const textContent = $.text();
      analysis.hashes.text.page = this.hashContent(textContent);
    }
  }
  
  async analyzeSectionLevel($, analysis, options) {
    const sections = ['header', 'nav', 'main', 'article', 'section', 'aside', 'footer'];
    
    sections.forEach(tag => {
      $(tag).each((index, element) => {
        const sectionKey = `${tag}_${index}`;
        const sectionContent = $(element).html() || '';
        analysis.hashes.sections[sectionKey] = this.hashContent(sectionContent);
        
        if (options.trackText) {
          const textContent = $(element).text() || '';
          analysis.hashes.text[sectionKey] = this.hashContent(textContent);
        }
      });
    });
    
    // Handle custom selectors
    if (options.customSelectors) {
      options.customSelectors.forEach((selector, index) => {
        $(selector).each((elemIndex, element) => {
          const key = `custom_${index}_${elemIndex}`;
          const content = $(element).html() || '';
          analysis.hashes.sections[key] = this.hashContent(content);
        });
      });
    }
  }
  
  async analyzeElementLevel($, analysis, options) {
    // Analyze common important elements
    const importantElements = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'a'];
    
    importantElements.forEach(tag => {
      $(tag).each((index, element) => {
        const elementKey = `${tag}_${index}`;
        const elementContent = $(element).html() || '';
        analysis.hashes.elements[elementKey] = this.hashContent(elementContent);
        
        if (options.trackAttributes) {
          const attributes = element.attribs || {};
          analysis.hashes.elements[`${elementKey}_attr`] = this.hashContent(JSON.stringify(attributes));
        }
      });
    });
  }
  
  async analyzeTextLevel($, analysis, options) {
    const textNodes = [];
    
    // Extract all text nodes
    $('*').contents().filter(function() {
      return this.type === 'text' && $(this).text().trim();
    }).each((index, node) => {
      const text = $(node).text().trim();
      if (text) {
        textNodes.push(text);
        analysis.hashes.text[`text_${index}`] = this.hashContent(text);
      }
    });
  }
  
  extractStructure($, options) {
    const structure = {
      elements: [],
      hierarchy: {},
      semanticStructure: {}
    };
    
    // Extract DOM hierarchy
    $('*').each((index, element) => {
      const tagName = element.name;
      const depth = $(element).parents().length;
      const hasChildren = $(element).children().length > 0;
      
      structure.elements.push({
        tag: tagName,
        index,
        depth,
        hasChildren,
        classes: element.attribs?.class?.split(' ') || [],
        id: element.attribs?.id
      });
    });
    
    // Extract semantic structure
    const semanticTags = ['header', 'nav', 'main', 'article', 'section', 'aside', 'footer'];
    semanticTags.forEach(tag => {
      structure.semanticStructure[tag] = $(tag).length;
    });
    
    return structure;
  }
  
  extractMetadata($, options) {
    const metadata = {
      title: $('title').text() || '',
      headings: [],
      links: [],
      images: [],
      scripts: [],
      forms: []
    };
    
    // Extract headings
    $('h1, h2, h3, h4, h5, h6').each((index, element) => {
      metadata.headings.push({
        tag: element.name,
        text: $(element).text().trim(),
        level: parseInt(element.name.replace('h', ''))
      });
    });
    
    // Extract links
    if (options.trackLinks) {
      $('a[href]').each((index, element) => {
        metadata.links.push({
          href: $(element).attr('href'),
          text: $(element).text().trim(),
          external: this.isExternalLink($(element).attr('href'))
        });
      });
    }
    
    // Extract images
    if (options.trackImages) {
      $('img[src]').each((index, element) => {
        metadata.images.push({
          src: $(element).attr('src'),
          alt: $(element).attr('alt') || '',
          title: $(element).attr('title') || ''
        });
      });
    }
    
    return metadata;
  }
  
  calculateContentStatistics(content, $) {
    return {
      contentLength: content.length,
      htmlLength: $.html().length,
      textLength: $.text().length,
      wordCount: $.text().split(/\s+/).filter(word => word.length > 0).length,
      elementCount: $('*').length,
      linkCount: $('a').length,
      imageCount: $('img').length,
      scriptCount: $('script').length
    };
  }
  
  // Change Detection Methods
  
  detectHashChanges(baselineHashes, currentHashes) {
    const changes = {
      added: [],
      removed: [],
      modified: []
    };
    
    const baselineKeys = new Set(Object.keys(baselineHashes));
    const currentKeys = new Set(Object.keys(currentHashes));
    
    // Find added elements
    for (const key of currentKeys) {
      if (!baselineKeys.has(key)) {
        changes.added.push(key);
      }
    }
    
    // Find removed elements
    for (const key of baselineKeys) {
      if (!currentKeys.has(key)) {
        changes.removed.push(key);
      }
    }
    
    // Find modified elements
    for (const key of baselineKeys) {
      if (currentKeys.has(key) && baselineHashes[key] !== currentHashes[key]) {
        changes.modified.push({
          key,
          oldHash: baselineHashes[key],
          newHash: currentHashes[key]
        });
      }
    }
    
    return changes;
  }
  
  async detectStructuralChanges(baselineStructure, currentStructure) {
    const changes = [];
    
    // Compare element counts by type
    const baselineCounts = this.countElementTypes(baselineStructure);
    const currentCounts = this.countElementTypes(currentStructure);
    
    for (const [element, baselineCount] of baselineCounts) {
      const currentCount = currentCounts.get(element) || 0;
      if (currentCount !== baselineCount) {
        changes.push({
          type: 'element_count_change',
          element,
          oldCount: baselineCount,
          newCount: currentCount,
          difference: currentCount - baselineCount
        });
      }
    }
    
    // Check for new element types
    for (const [element, currentCount] of currentCounts) {
      if (!baselineCounts.has(element)) {
        changes.push({
          type: 'new_element_type',
          element,
          count: currentCount
        });
      }
    }
    
    return changes;
  }
  
  async detectTextChanges(baselineContent, currentContent, options = {}) {
    const textChanges = [];
    
    if (options.ignoreWhitespace) {
      baselineContent = baselineContent.replace(/\s+/g, ' ').trim();
      currentContent = currentContent.replace(/\s+/g, ' ').trim();
    }
    
    if (options.ignoreCase) {
      baselineContent = baselineContent.toLowerCase();
      currentContent = currentContent.toLowerCase();
    }
    
    // Word-level diff
    const wordDiff = diffWords(baselineContent, currentContent);
    textChanges.push({
      type: 'word_diff',
      changes: wordDiff.filter(part => part.added || part.removed)
    });
    
    // Line-level diff for structured content
    const lineDiff = diffLines(baselineContent, currentContent);
    if (lineDiff.some(part => part.added || part.removed)) {
      textChanges.push({
        type: 'line_diff',
        changes: lineDiff.filter(part => part.added || part.removed)
      });
    }
    
    return textChanges;
  }
  
  detectLinkChanges(baselineLinks, currentLinks) {
    const changes = {
      added: [],
      removed: [],
      modified: []
    };
    
    const baselineMap = new Map(baselineLinks.map(link => [link.href, link]));
    const currentMap = new Map(currentLinks.map(link => [link.href, link]));
    
    // Find added links
    for (const [href, link] of currentMap) {
      if (!baselineMap.has(href)) {
        changes.added.push(link);
      }
    }
    
    // Find removed links
    for (const [href, link] of baselineMap) {
      if (!currentMap.has(href)) {
        changes.removed.push(link);
      }
    }
    
    // Find modified links (text changes)
    for (const [href, baselineLink] of baselineMap) {
      const currentLink = currentMap.get(href);
      if (currentLink && currentLink.text !== baselineLink.text) {
        changes.modified.push({
          href,
          oldText: baselineLink.text,
          newText: currentLink.text
        });
      }
    }
    
    return changes;
  }
  
  detectImageChanges(baselineImages, currentImages) {
    const changes = {
      added: [],
      removed: [],
      modified: []
    };
    
    const baselineMap = new Map(baselineImages.map(img => [img.src, img]));
    const currentMap = new Map(currentImages.map(img => [img.src, img]));
    
    // Find added images
    for (const [src, img] of currentMap) {
      if (!baselineMap.has(src)) {
        changes.added.push(img);
      }
    }
    
    // Find removed images
    for (const [src, img] of baselineMap) {
      if (!currentMap.has(src)) {
        changes.removed.push(img);
      }
    }
    
    // Find modified images (alt text changes)
    for (const [src, baselineImg] of baselineMap) {
      const currentImg = currentMap.get(src);
      if (currentImg && (currentImg.alt !== baselineImg.alt || currentImg.title !== baselineImg.title)) {
        changes.modified.push({
          src,
          oldAlt: baselineImg.alt,
          newAlt: currentImg.alt,
          oldTitle: baselineImg.title,
          newTitle: currentImg.title
        });
      }
    }
    
    return changes;
  }
  
  // Utility Methods
  
  hashContent(content) {
    return createHash(this.options.hashAlgorithm)
      .update(content || '')
      .digest('hex');
  }
  
  calculateSimilarity(hash1, hash2) {
    if (hash1 === hash2) return 1;
    
    // Simple similarity based on hash difference
    // In production, you might want to use more sophisticated algorithms
    const diff = this.hammingDistance(hash1, hash2);
    const maxLength = Math.max(hash1.length, hash2.length);
    return 1 - (diff / maxLength);
  }
  
  calculateStructuralSimilarity(baseline, current) {
    if (!baseline || !current) return 0;
    
    const baselineElements = baseline.elements || [];
    const currentElements = current.elements || [];
    
    if (baselineElements.length === 0 && currentElements.length === 0) return 1;
    if (baselineElements.length === 0 || currentElements.length === 0) return 0;
    
    const tagSimilarity = this.calculateTagSimilarity(baselineElements, currentElements);
    const hierarchySimilarity = this.calculateHierarchySimilarity(baseline.hierarchy, current.hierarchy);
    
    return (tagSimilarity + hierarchySimilarity) / 2;
  }
  
  calculateTagSimilarity(baselineElements, currentElements) {
    const baselineTags = baselineElements.map(el => el.tag);
    const currentTags = currentElements.map(el => el.tag);
    
    const intersection = baselineTags.filter(tag => currentTags.includes(tag));
    const union = new Set([...baselineTags, ...currentTags]);
    
    return intersection.length / union.size;
  }
  
  calculateHierarchySimilarity(baseline, current) {
    // Simple structural comparison - can be enhanced
    if (!baseline || !current) return 0;
    return Object.keys(baseline).length === Object.keys(current).length ? 1 : 0.5;
  }
  
  hammingDistance(str1, str2) {
    if (str1.length !== str2.length) {
      return Math.abs(str1.length - str2.length);
    }
    
    let distance = 0;
    for (let i = 0; i < str1.length; i++) {
      if (str1[i] !== str2[i]) {
        distance++;
      }
    }
    return distance;
  }
  
  countElementTypes(structure) {
    const counts = new Map();
    
    if (structure.elements) {
      structure.elements.forEach(element => {
        counts.set(element.tag, (counts.get(element.tag) || 0) + 1);
      });
    }
    
    return counts;
  }
  
  isExternalLink(href) {
    if (!href) return false;
    return href.startsWith('http://') || href.startsWith('https://');
  }
  
  classifyChangeType(changeAnalysis) {
    const { addedElements, removedElements, modifiedElements, structuralChanges } = changeAnalysis;
    
    if (structuralChanges.length > 0) {
      return 'structural';
    }
    
    if (addedElements.length > removedElements.length) {
      return 'content_addition';
    }
    
    if (removedElements.length > addedElements.length) {
      return 'content_removal';
    }
    
    if (modifiedElements.length > 0) {
      return 'content_modification';
    }
    
    return 'text_change';
  }
  
  generateChangeSummary(changeAnalysis) {
    const { addedElements, removedElements, modifiedElements, similarity } = changeAnalysis;
    
    const total = addedElements.length + removedElements.length + modifiedElements.length;
    
    return {
      totalChanges: total,
      contentSimilarity: Math.round(similarity * 100),
      added: addedElements.length,
      removed: removedElements.length,
      modified: modifiedElements.length,
      changeDescription: this.generateChangeDescription(changeAnalysis)
    };
  }
  
  generateChangeDescription(changeAnalysis) {
    const { addedElements, removedElements, modifiedElements, textChanges } = changeAnalysis;
    
    const descriptions = [];
    
    if (addedElements.length > 0) {
      descriptions.push(`${addedElements.length} elements added`);
    }
    
    if (removedElements.length > 0) {
      descriptions.push(`${removedElements.length} elements removed`);
    }
    
    if (modifiedElements.length > 0) {
      descriptions.push(`${modifiedElements.length} elements modified`);
    }
    
    if (textChanges.length > 0) {
      descriptions.push('Text content changed');
    }
    
    return descriptions.join(', ') || 'No significant changes detected';
  }
  
  generateChangeRecommendations(changeRecord) {
    const recommendations = [];
    const { significance, details, changeType } = changeRecord;
    
    if (significance === 'critical') {
      recommendations.push({
        type: 'alert',
        priority: 'high',
        message: 'Critical changes detected. Manual review recommended.'
      });
    }
    
    if (changeType === 'structural') {
      recommendations.push({
        type: 'monitoring',
        priority: 'medium',
        message: 'Structural changes may affect scraping selectors.'
      });
    }
    
    if (details.similarity < 0.5) {
      recommendations.push({
        type: 'analysis',
        priority: 'medium',
        message: 'Low content similarity suggests major content changes.'
      });
    }
    
    return recommendations;
  }
  
  updateStats(changeRecord) {
    this.stats.changesDetected++;
    
    if (changeRecord.significance !== 'none') {
      this.stats.significantChanges++;
    }
    
    if (changeRecord.changeType === 'structural') {
      this.stats.structuralChanges++;
    } else {
      this.stats.contentChanges++;
    }
    
    // Update average change score
    this.stats.averageChangeScore = 
      (this.stats.averageChangeScore * (this.stats.changesDetected - 1) + 
       changeRecord.details.similarity) / this.stats.changesDetected;
    
    this.stats.lastAnalysis = changeRecord.timestamp;
    this.stats.processingTime += changeRecord.processingTime;
  }
  
  // Public API Methods
  
  getStats() {
    return {
      ...this.stats,
      monitoredUrls: this.snapshots.size,
      totalSnapshots: Array.from(this.snapshots.values()).reduce((sum, snapshots) => sum + snapshots.length, 0),
      averageProcessingTime: this.stats.changesDetected > 0 ? 
        this.stats.processingTime / this.stats.changesDetected : 0
    };
  }
  
  getChangeHistory(url, limit = 50) {
    const history = this.changeHistory.get(url) || [];
    return history.slice(-limit).reverse();
  }
  
  clearHistory(url) {
    if (url) {
      this.changeHistory.set(url, []);
      this.emit('historyCleared', url);
    } else {
      this.changeHistory.clear();
      this.emit('allHistoryCleared');
    }
  }
  
  resetStats() {
    this.stats = {
      pagesTracked: 0,
      changesDetected: 0,
      significantChanges: 0,
      structuralChanges: 0,
      contentChanges: 0,
      falsePositives: 0,
      averageChangeScore: 0,
      lastAnalysis: null,
      processingTime: 0
    };
  }
  

  /**
   * Generate content hash
   */
  generateContentHash(content) {

    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * Create snapshot of content
   */
  async createSnapshot(url, content) {
    const timestamp = Date.now();
    const hash = this.generateContentHash(content);
    
    const snapshot = {
      url,
      content,
      contentHash: hash,
      timestamp,
      version: 1
    };
    
    // Store snapshot in cache
    if (!this.contentHistory.has(url)) {
      this.contentHistory.set(url, []);
    }
    
    this.contentHistory.get(url).unshift(snapshot);
    
    // Also store in snapshots Map for compatibility
    if (!this.snapshots.has(url)) {
      this.snapshots.set(url, []);
    }
    this.snapshots.get(url).unshift(snapshot);
    
    // Keep only last 100 snapshots
    const history = this.contentHistory.get(url);
    if (history.length > 100) {
      history.splice(100);
    }
    
    return snapshot;
  }


  /**
   * Get snapshot history for a URL
   */
  getSnapshotHistory(url) {
    return this.contentHistory.get(url) || [];
  }

  /**
   * Detect changes against the latest snapshot
   */
  async detectChanges(url, currentContent) {
    // Validate URL format
    try {
      new URL(url);
    } catch (error) {
      throw new Error(`Invalid URL format: ${url}`);
    }
    if (!this.contentHistory.has(url)) {
      return {
        hasChanges: false,
        score: 0,
        significance: "none"
      };
    }
    
    const history = this.contentHistory.get(url);
    if (history.length === 0) {
      return {
        hasChanges: false,
        score: 0,
        significance: "none"
      };
    }
    
    const lastSnapshot = history[0]; // Latest snapshot
    const currentHash = this.generateContentHash(currentContent);
    
    if (lastSnapshot.contentHash === currentHash) {
      return {
        hasChanges: false,
        score: 0,
        significance: "none"
      };
    }
    
    // Calculate change score based on content difference
    const similarity = this.calculateSimilarity(lastSnapshot.contentHash, currentHash);
    const score = 1 - similarity;
    
    // Determine significance
    let significance = "none";
    if (score > 0.7) significance = "major";
    else if (score > 0.3) significance = "moderate";
    else if (score > 0.1) significance = "minor";
    
    return {
      hasChanges: score > 0,
      score,
      significance
    };
  }
  
  /**
   * Calculate significance score for changes
   */
  calculateSignificanceScore(changes) {
    if (!changes) return 0;
    
    let score = 0;
    const weights = {
      textChanges: 0.4,
      structuralChanges: 0.6
    };
    
    // Handle object format with textChanges and structuralChanges
    if (typeof changes === "object" && !Array.isArray(changes)) {
      if (changes.textChanges) {
        const text = changes.textChanges;
        const textScore = ((text.additions || 0) + (text.deletions || 0) + (text.modifications || 0)) / (changes.totalLength || 1000);
        score += textScore * weights.textChanges;
      }
      
      if (changes.structuralChanges) {
        const struct = changes.structuralChanges;
        const structScore = ((struct.additions || 0) + (struct.deletions || 0)) / 20; // Normalize
        score += structScore * weights.structuralChanges;
      }
      
      return Math.min(score, 1.0); // Cap at 1.0
    }
    
    // Handle legacy array format
    if (Array.isArray(changes)) {
      const legacyWeights = {
        added: 0.3,
        removed: 0.4,
        modified: 0.2
      };
      
      changes.forEach(change => {
        score += (legacyWeights[change.type] || 0.1) * (change.count || 1);
      });
    }
    
    return Math.min(score, 1.0); // Cap at 1.0
  }

  /**
   * Start monitoring URL for changes
   */
  async startMonitoring(url, options = {}) {
    const monitorId = `monitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const monitor = {
      id: monitorId,
      url,
      interval: options.interval || 300000, // 5 minutes default
      enabled: true,
      lastCheck: null,
      checkCount: 0,
      changeCount: 0
    };
    
    this.activeMonitors.set(url, monitor); // Store by URL for easy access
    
    return monitor;
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return {
      totalBaselines: this.baselineContent.size,
      totalMonitors: this.activeMonitors.size,
      totalComparisons: this.stats.comparisons,
      totalChanges: this.stats.changesDetected,
      averageChangeSignificance: this.stats.averageSignificance,
      lastActivity: this.stats.lastActivity
    };
  }

  /**
   * Cleanup resources
   */
  async performDifferentialAnalysis(url, currentContent, options = {}) {
    if (!url || !currentContent) {
      throw new Error("URL and current content required for differential analysis");
    }
    
    if (!this.contentHistory.has(url)) {
      throw new Error(`No baseline found for URL: ${url}`);
    }
    
    try {
      const history = this.contentHistory.get(url);
      const baseline = history[0]; // Get latest snapshot
      
      const analysis = {
        wordDiff: [],
        statistics: {
          contentSimilarity: 0,
          changeScore: 0
        },
        similarity: 0,
        structuralChanges: [],
        contentChanges: [],
        semanticChanges: [],
        changeScore: 0,
        changeSignificance: "none",
        metadata: {
          comparisonTime: new Date().toISOString(),
          baselineVersion: baseline.version || "unknown",
          currentVersion: "current"
        }
      };
      
      // Calculate similarity
      const currentHash = this.generateContentHash(currentContent);
      analysis.similarity = this.calculateSimilarity(baseline.contentHash, currentHash);
      analysis.statistics.contentSimilarity = analysis.similarity;
      analysis.statistics.changeScore = 1 - analysis.similarity;
      
      // Simple word diff
      const baselineWords = baseline.content.split(/\s+/);
      const currentWords = currentContent.split(/\s+/);
      
      // Basic diff calculation
      const added = currentWords.filter(word => !baselineWords.includes(word));
      const removed = baselineWords.filter(word => !currentWords.includes(word));
      
      analysis.wordDiff = [
        ...added.map(word => ({ value: word, added: true })),
        ...removed.map(word => ({ value: word, removed: true }))
      ];
      
      return analysis;
    } catch (error) {
      throw new Error(`Differential analysis failed: ${error.message}`);
    }
  }
  
  /**
   * Stop monitoring a URL
   */
  stopMonitoring(url) {
    if (this.activeMonitors.has(url)) {
      this.activeMonitors.delete(url);
      return true;
    }
    return false;
  }  
  /**
   * Get statistics with proper format
   */
  getStatistics() {
    return {
      totalBaselines: this.contentHistory.size,
      totalMonitors: this.activeMonitors.size,
      totalComparisons: this.stats.changesDetected || 0,
      totalChanges: this.stats.changesDetected || 0,
      averageChangeSignificance: this.stats.averageChangeScore || 0,
      lastActivity: this.stats.lastAnalysis,
      pagesTracked: this.contentHistory.size,
      changesDetected: this.stats.changesDetected || 0
    };
  }

  async initializeSemanticAnalyzer() {
    // Placeholder for semantic analysis initialization
  }

  // Enhanced Feature Helper Methods

  /**
   * Get latest baseline for a URL
   * @param {string} url - URL
   * @returns {Object} - Latest baseline
   */
  getLatestBaseline(url) {
    const snapshots = this.snapshots.get(url);
    return snapshots && snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  }

  /**
   * Calculate text similarity using advanced algorithms
   * @param {string} text1 - First text
   * @param {string} text2 - Second text
   * @returns {number} - Similarity score (0-1)
   */
  calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    // Simple Jaccard similarity for keywords
    const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Calculate semantic similarity
   * @param {string} text1 - First text
   * @param {string} text2 - Second text
   * @returns {number} - Semantic similarity score
   */
  calculateSemanticSimilarity(text1, text2) {
    // Placeholder for advanced semantic analysis
    // Could integrate with NLP services or local models
    return this.calculateTextSimilarity(text1, text2);
  }

  /**
   * Detect keyword changes between texts
   * @param {string} baselineText - Baseline text
   * @param {string} currentText - Current text
   * @returns {Array} - Keyword changes
   */
  detectKeywordChanges(baselineText, currentText) {
    const changes = [];
    
    try {
      const baselineWords = baselineText.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const currentWords = currentText.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      
      const baselineFreq = this.calculateWordFrequency(baselineWords);
      const currentFreq = this.calculateWordFrequency(currentWords);
      
      // Find significant frequency changes
      const allWords = new Set([...Object.keys(baselineFreq), ...Object.keys(currentFreq)]);
      
      for (const word of allWords) {
        const baseFreq = baselineFreq[word] || 0;
        const currFreq = currentFreq[word] || 0;
        const change = Math.abs(currFreq - baseFreq);
        
        if (change > 2) { // Significant frequency change
          changes.push({
            word,
            baselineFrequency: baseFreq,
            currentFrequency: currFreq,
            change: currFreq - baseFreq,
            type: currFreq > baseFreq ? 'increased' : 'decreased'
          });
        }
      }
    } catch (error) {
      this.emit('error', { operation: 'detectKeywordChanges', error: error.message });
    }
    
    return changes.slice(0, 20); // Top 20 changes
  }

  /**
   * Detect topic shifts between texts
   * @param {string} baselineText - Baseline text
   * @param {string} currentText - Current text
   * @returns {Array} - Topic shifts
   */
  detectTopicShifts(baselineText, currentText) {
    const shifts = [];
    
    try {
      // Simple topic detection based on key phrases
      const topicKeywords = {
        technology: ['software', 'computer', 'digital', 'tech', 'system', 'data'],
        business: ['company', 'market', 'business', 'sales', 'revenue', 'profit'],
        health: ['health', 'medical', 'doctor', 'treatment', 'disease', 'patient'],
        politics: ['government', 'policy', 'political', 'election', 'vote', 'congress'],
        sports: ['game', 'team', 'player', 'score', 'match', 'championship']
      };
      
      const baselineTopics = this.detectTopics(baselineText, topicKeywords);
      const currentTopics = this.detectTopics(currentText, topicKeywords);
      
      // Compare topic presence
      for (const topic of Object.keys(topicKeywords)) {
        const baselineScore = baselineTopics[topic] || 0;
        const currentScore = currentTopics[topic] || 0;
        const change = currentScore - baselineScore;
        
        if (Math.abs(change) > 0.1) {
          shifts.push({
            topic,
            baselineScore,
            currentScore,
            change,
            type: change > 0 ? 'emerged' : 'diminished'
          });
        }
      }
    } catch (error) {
      this.emit('error', { operation: 'detectTopicShifts', error: error.message });
    }
    
    return shifts;
  }

  /**
   * Calculate semantic confidence score
   * @param {Object} analysis - Semantic analysis
   * @returns {number} - Confidence score
   */
  calculateSemanticConfidence(analysis) {
    let confidence = 0;
    
    // Base confidence on available data
    if (analysis.textualSimilarity > 0) confidence += 0.3;
    if (analysis.keywordChanges.length > 0) confidence += 0.3;
    if (analysis.topicShifts.length > 0) confidence += 0.2;
    
    // Adjust based on data quality
    const dataQuality = Math.min(
      analysis.keywordChanges.length / 10, // Max 10 keyword changes for full score
      1
    );
    
    return Math.min(confidence * dataQuality, 1);
  }

  /**
   * Detect layout changes between DOM structures
   * @param {Object} baseline - Baseline DOM
   * @param {Object} current - Current DOM
   * @returns {Array} - Layout changes
   */
  detectLayoutChanges(baseline, current) {
    const changes = [];
    
    try {
      // Compare element counts by type
      const baselineElements = this.countElements(baseline);
      const currentElements = this.countElements(current);
      
      for (const [tag, baseCount] of Object.entries(baselineElements)) {
        const currCount = currentElements[tag] || 0;
        if (Math.abs(currCount - baseCount) > 0) {
          changes.push({
            type: 'element_count_change',
            tag,
            baseline: baseCount,
            current: currCount,
            change: currCount - baseCount
          });
        }
      }
      
      // Check for new element types
      for (const [tag, currCount] of Object.entries(currentElements)) {
        if (!baselineElements[tag]) {
          changes.push({
            type: 'new_element_type',
            tag,
            count: currCount
          });
        }
      }
    } catch (error) {
      this.emit('error', { operation: 'detectLayoutChanges', error: error.message });
    }
    
    return changes;
  }

  /**
   * Detect CSS changes
   * @param {Object} baseline - Baseline DOM
   * @param {Object} current - Current DOM
   * @returns {Array} - CSS changes
   */
  detectCSSChanges(baseline, current) {
    const changes = [];
    
    try {
      // Extract style information
      const baselineStyles = this.extractStyles(baseline);
      const currentStyles = this.extractStyles(current);
      
      // Compare inline styles
      const styleDiff = this.compareStyles(baselineStyles, currentStyles);
      changes.push(...styleDiff);
      
    } catch (error) {
      this.emit('error', { operation: 'detectCSSChanges', error: error.message });
    }
    
    return changes;
  }

  /**
   * Extract structured data from DOM
   * @param {Object} $ - Cheerio DOM
   * @returns {Object} - Structured data
   */
  extractStructuredData($) {
    const structuredData = {
      jsonLd: [],
      microdata: [],
      rdfa: [],
      openGraph: {},
      twitterCard: {},
      schema: []
    };
    
    try {
      // Extract JSON-LD
      $('script[type="application/ld+json"]').each((index, element) => {
        try {
          const data = JSON.parse($(element).html());
          structuredData.jsonLd.push(data);
        } catch (e) {
          // Invalid JSON, skip
        }
      });
      
      // Extract Open Graph
      $('meta[property^="og:"]').each((index, element) => {
        const property = $(element).attr('property');
        const content = $(element).attr('content');
        if (property && content) {
          structuredData.openGraph[property] = content;
        }
      });
      
      // Extract Twitter Card
      $('meta[name^="twitter:"]').each((index, element) => {
        const name = $(element).attr('name');
        const content = $(element).attr('content');
        if (name && content) {
          structuredData.twitterCard[name] = content;
        }
      });
      
    } catch (error) {
      this.emit('error', { operation: 'extractStructuredData', error: error.message });
    }
    
    return structuredData;
  }

  /**
   * Compare structured data
   * @param {Object} baseline - Baseline structured data
   * @param {Object} current - Current structured data
   * @returns {Array} - Schema changes
   */
  compareStructuredData(baseline, current) {
    const changes = [];
    
    try {
      // Compare JSON-LD
      const jsonLdChanges = this.compareArrayData(baseline.jsonLd, current.jsonLd, 'json-ld');
      changes.push(...jsonLdChanges);
      
      // Compare Open Graph
      const ogChanges = this.compareObjectData(baseline.openGraph, current.openGraph, 'open-graph');
      changes.push(...ogChanges);
      
      // Compare Twitter Card
      const twitterChanges = this.compareObjectData(baseline.twitterCard, current.twitterCard, 'twitter-card');
      changes.push(...twitterChanges);
      
    } catch (error) {
      this.emit('error', { operation: 'compareStructuredData', error: error.message });
    }
    
    return changes;
  }

  /**
   * Compare metadata objects
   * @param {Object} baseline - Baseline metadata
   * @param {Object} current - Current metadata
   * @returns {Array} - Metadata changes
   */
  compareMetadata(baseline, current) {
    const changes = [];
    
    try {
      const baselineKeys = Object.keys(baseline || {});
      const currentKeys = Object.keys(current || {});
      const allKeys = new Set([...baselineKeys, ...currentKeys]);
      
      for (const key of allKeys) {
        const baseValue = baseline?.[key];
        const currValue = current?.[key];
        
        if (JSON.stringify(baseValue) !== JSON.stringify(currValue)) {
          changes.push({
            type: 'metadata_change',
            field: key,
            baseline: baseValue,
            current: currValue,
            changeType: !baseValue ? 'added' : !currValue ? 'removed' : 'modified'
          });
        }
      }
    } catch (error) {
      this.emit('error', { operation: 'compareMetadata', error: error.message });
    }
    
    return changes;
  }

  /**
   * Calculate enhanced significance score
   * @param {Object} standardComparison - Standard comparison
   * @param {Object} semanticAnalysis - Semantic analysis
   * @param {Object} visualAnalysis - Visual analysis
   * @param {Object} structuredAnalysis - Structured analysis
   * @returns {string} - Enhanced significance level
   */
  async calculateEnhancedSignificance(standardComparison, semanticAnalysis, visualAnalysis, structuredAnalysis) {
    try {
      let enhancedScore = 0;
      const weights = {
        standard: 0.4,
        semantic: 0.2,
        visual: 0.2,
        structured: 0.2
      };
      
      // Standard comparison score
      const standardScore = this.getSignificanceScore(standardComparison.significance);
      enhancedScore += standardScore * weights.standard;
      
      // Semantic analysis score
      const semanticScore = semanticAnalysis.confidenceScore * 
        (1 - semanticAnalysis.textualSimilarity);
      enhancedScore += semanticScore * weights.semantic;
      
      // Visual analysis score
      const visualScore = visualAnalysis.hasVisualChanges ? 0.7 : 0;
      enhancedScore += visualScore * weights.visual;
      
      // Structured data score
      const structuredScore = structuredAnalysis.hasStructuredChanges ? 0.8 : 0;
      enhancedScore += structuredScore * weights.structured;
      
      // Convert to significance level
      return this.scoreToSignificance(enhancedScore);
      
    } catch (error) {
      this.emit('error', { operation: 'calculateEnhancedSignificance', error: error.message });
      return standardComparison.significance;
    }
  }

  /**
   * Detect change patterns in historical data
   * @param {string} url - URL
   * @param {Object} patterns - Pattern data
   */
  async detectChangePatterns(url, patterns) {
    try {
      const frequency = patterns.changeFrequency.get(url);
      if (!frequency || frequency.length < 10) return;
      
      // Detect recurring patterns
      const recurringPatterns = this.detectRecurringPatterns(frequency);
      
      // Detect time-based patterns
      const timePatterns = this.detectTimePatterns(frequency);
      
      // Update trend analysis
      if (recurringPatterns.length > 0 || timePatterns.length > 0) {
        this.stats.trendPatternsDetected++;
        
        this.emit('patternsDetected', {
          url,
          recurringPatterns,
          timePatterns,
          timestamp: Date.now()
        });
      }
      
    } catch (error) {
      this.emit('error', { operation: 'detectChangePatterns', url, error: error.message });
    }
  }

  /**
   * Send webhook alert
   * @param {Object} alertData - Alert data
   */
  async sendWebhookAlert(alertData) {
    // Placeholder for webhook implementation
    this.emit('webhookAlert', alertData);
  }

  /**
   * Send email alert
   * @param {Object} alertData - Alert data
   */
  async sendEmailAlert(alertData) {
    // Placeholder for email implementation
    this.emit('emailAlert', alertData);
  }

  /**
   * Send Slack alert
   * @param {Object} alertData - Alert data
   */
  async sendSlackAlert(alertData) {
    // Placeholder for Slack implementation
    this.emit('slackAlert', alertData);
  }

  // Utility helper methods

  calculateWordFrequency(words) {
    const frequency = {};
    words.forEach(word => {
      frequency[word] = (frequency[word] || 0) + 1;
    });
    return frequency;
  }

  detectTopics(text, topicKeywords) {
    const topics = {};
    const words = text.toLowerCase().split(/\W+/);
    
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      let score = 0;
      keywords.forEach(keyword => {
        score += words.filter(word => word.includes(keyword)).length;
      });
      topics[topic] = score / words.length;
    }
    
    return topics;
  }

  countElements($) {
    const counts = {};
    $('*').each((index, element) => {
      const tag = element.name;
      counts[tag] = (counts[tag] || 0) + 1;
    });
    return counts;
  }

  extractStyles($) {
    const styles = {};
    $('[style]').each((index, element) => {
      const style = $(element).attr('style');
      if (style) {
        styles[`element_${index}`] = style;
      }
    });
    return styles;
  }

  compareStyles(baseline, current) {
    const changes = [];
    const allKeys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    
    for (const key of allKeys) {
      if (baseline[key] !== current[key]) {
        changes.push({
          type: 'style_change',
          element: key,
          baseline: baseline[key],
          current: current[key]
        });
      }
    }
    
    return changes;
  }

  compareArrayData(baseline, current, type) {
    const changes = [];
    
    if (baseline.length !== current.length) {
      changes.push({
        type: `${type}_count_change`,
        baseline: baseline.length,
        current: current.length
      });
    }
    
    return changes;
  }

  compareObjectData(baseline, current, type) {
    const changes = [];
    const allKeys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    
    for (const key of allKeys) {
      if (baseline[key] !== current[key]) {
        changes.push({
          type: `${type}_change`,
          field: key,
          baseline: baseline[key],
          current: current[key]
        });
      }
    }
    
    return changes;
  }

  getSignificanceScore(significance) {
    const scores = {
      'none': 0,
      'minor': 0.2,
      'moderate': 0.5,
      'major': 0.8,
      'critical': 1.0
    };
    return scores[significance] || 0;
  }

  scoreToSignificance(score) {
    if (score >= 0.9) return 'critical';
    if (score >= 0.7) return 'major';
    if (score >= 0.4) return 'moderate';
    if (score >= 0.1) return 'minor';
    return 'none';
  }

  analyzeUrlPatterns(url, patterns) {
    // Placeholder for URL-specific pattern analysis
    return {
      dailyAverage: 0,
      peakTimes: [],
      commonTypes: []
    };
  }

  analyzeGlobalPatterns(patterns) {
    // Placeholder for global pattern analysis
    return {
      totalUrls: patterns.dailyChangePatterns.size,
      mostActiveUrls: [],
      commonPatterns: []
    };
  }

  generateTrendInsights(patterns) {
    return [
      'Pattern analysis requires more data',
      'Monitoring is active and collecting data'
    ];
  }

  generateTrendRecommendations(patterns, insights) {
    return [
      'Continue monitoring to build pattern database',
      'Consider adjusting monitoring frequency based on change patterns'
    ];
  }

  detectRecurringPatterns(frequency) {
    // Placeholder for recurring pattern detection
    return [];
  }

  detectTimePatterns(frequency) {
    // Placeholder for time-based pattern detection
    return [];
  }

  convertToCSV(data) {
    // Placeholder for CSV conversion
    return JSON.stringify(data, null, 2);
  }

  cleanup() {
    // Stop all scheduled monitors
    for (const [id, monitor] of this.scheduledMonitors.entries()) {
      if (monitor.cronJob) {
        monitor.cronJob.destroy();
      }
    }
    
    // Clear all data
    this.contentHistory.clear();
    this.baselineContent.clear();
    this.activeMonitors.clear();
    this.changeNotifications.clear();
    this.snapshotManager.clear();
    this.scheduledMonitors.clear();
    this.monitoringTemplates.clear();
    this.alertRules.clear();
    this.alertHistory.clear();
    this.trendAnalysis.clear();
    this.visualRegression.clear();
    this.alertThrottling.clear();
    this.semanticDiffCache.clear();
  }

}

export default ChangeTracker;
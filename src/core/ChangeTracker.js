import crypto from "crypto";
/**
 * ChangeTracker - Content Change Detection and Analysis
 * Implements hierarchical content hashing (page → sections → elements)
 * with differential comparison engine and change significance scoring
 */

import { createHash } from 'crypto';
import { Worker } from 'worker_threads';
import { z } from 'zod';
import { EventEmitter } from 'events';
import { load } from 'cheerio';
import { diffWords, diffLines, diffChars } from 'diff';
import { structureSignature, structuralSimilarity } from 'crawlforge-extractors';
import { calculateSimilarity as calculateContentSimilarity } from '../tools/tracking/trackChanges/differ.js';
import { pageTitle } from '../utils/pageTitle.js';

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

// Bounds that keep a compare response usable. An unscoped Amazon product page
// produced a 5.6MB payload — 4MB of it a single line_diff holding the entire
// document twice — which overflows the MCP response limit on every comparison.
const MAX_DIFF_ENTRIES = 200;
const MAX_DIFF_VALUE_CHARS = 2000;

// Significance ordering, used to raise a level without ever lowering it.
const SIGNIFICANCE_ORDER = ['none', 'minor', 'moderate', 'major', 'critical'];

/**
 * A monetary amount carries meaning that its size on the page does not.
 * Significance is otherwise purely volumetric — how much of the document
 * changed — so a price is scored by how many characters it occupies. Tracking
 * a price block, a rise from $19.99 to $99.99 scored "minor", below the default
 * "moderate" notification threshold; untracked, the same change did not
 * register as a change at all.
 *
 * Only currency-tagged numbers count. Treating every number this way would fire
 * on view counters, timestamps and review totals, which is the opposite failure.
 */
const MONETARY_PATTERN =
  /[$£€¥₹]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|INR)\b/gi;

/** A price change at or above this fraction is major rather than moderate. */
const MAJOR_VALUE_CHANGE = 0.2;

/**
 * Parse the numeric amount out of a matched monetary string.
 * Commas are read as thousands separators; a European decimal comma is
 * ambiguous here and is not guessed at, so such a value simply reads as
 * changed rather than being scored by magnitude.
 * @param {string} raw
 * @returns {number|null}
 */
function parseMonetaryAmount(raw) {
  const amount = Number.parseFloat(raw.replace(/[^\d.,]/g, '').replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Monetary amounts in document order.
 * @param {string} text
 * @returns {Array<{raw: string, amount: number}>}
 */
function extractMonetaryValues(text) {
  if (!text) return [];
  const values = [];
  for (const match of String(text).matchAll(MONETARY_PATTERN)) {
    const amount = parseMonetaryAmount(match[0]);
    if (amount !== null) values.push({ raw: match[0].trim(), amount });
  }
  return values;
}

/**
 * Built-in monitoring presets, served by track_changes
 * {operation:"get_monitoring_templates"} and applied by
 * create_scheduled_monitor via scheduledMonitorOptions.templateId. `options`
 * are trackingOptions (the baseline analysis options); `frequency` is the
 * polling interval in ms; `goal` is the plain-English alert goal the
 * scheduler's LLM judge uses when one is configured.
 */
export const MONITORING_TEMPLATES = {
  'price-watch': {
    name: 'Price watch',
    description: 'Product, plan or rate pages — hourly, and any numeric change counts.',
    frequency: 3600000,
    notificationThreshold: 'minor',
    goal: 'A price, discount, fee or plan cost changed',
    options: { granularity: 'text', trackText: true, trackStructure: false, trackLinks: false, ignoreWhitespace: true, significanceThresholds: { minor: 0.02, moderate: 0.1, major: 0.3 } },
    alertRules: [{ condition: 'significance >= "minor"', actions: ['webhook'], priority: 'high' }]
  },
  'availability': {
    name: 'Stock / availability',
    description: 'In-stock, sold-out and waitlist states — every 15 minutes, any change counts.',
    frequency: 900000,
    notificationThreshold: 'minor',
    goal: 'An item went in or out of stock, or a waitlist or pre-order opened',
    options: { granularity: 'text', trackText: true, trackStructure: false, trackLinks: false, ignoreWhitespace: true, significanceThresholds: { minor: 0.01, moderate: 0.1, major: 0.3 } },
    alertRules: [{ condition: 'significance >= "minor"', actions: ['webhook'], priority: 'high' }]
  },
  'news-feed': {
    name: 'News / announcements',
    description: 'Blogs, changelogs and press pages — every 30 minutes, section-level diffs so a new post registers as one change.',
    frequency: 1800000,
    notificationThreshold: 'moderate',
    goal: 'A new article, release note or announcement was published',
    options: { granularity: 'section', trackText: true, trackStructure: true, trackLinks: true, ignoreWhitespace: true },
    alertRules: [{ condition: 'significance >= "moderate"', actions: ['webhook'], priority: 'medium' }]
  },
  'documentation': {
    name: 'Documentation',
    description: 'API references and docs pages — daily, structure tracked so a new parameter or removed endpoint shows up.',
    frequency: 86400000,
    notificationThreshold: 'moderate',
    goal: 'A documented API, parameter, default or behaviour changed',
    options: { granularity: 'section', trackText: true, trackStructure: true, trackLinks: true, ignoreWhitespace: true },
    alertRules: [{ condition: 'significance >= "moderate"', actions: ['webhook'], priority: 'medium' }]
  },
  'regulatory': {
    name: 'Regulation / policy',
    description: 'Terms, policies, tariffs and rule pages — daily, and every wording change counts.',
    frequency: 86400000,
    notificationThreshold: 'minor',
    goal: 'A rule, deadline, fee, threshold or policy wording changed',
    options: { granularity: 'text', trackText: true, trackStructure: false, trackLinks: false, ignoreWhitespace: true, ignoreCase: false },
    alertRules: [{ condition: 'significance >= "minor"', actions: ['webhook'], priority: 'high' }]
  },
  'job-board': {
    name: 'Job listings',
    description: 'Careers pages — every 6 hours, links tracked so an added or removed posting registers.',
    frequency: 21600000,
    notificationThreshold: 'moderate',
    goal: 'A job opening was added or removed',
    options: { granularity: 'section', trackText: true, trackStructure: false, trackLinks: true, ignoreWhitespace: true },
    alertRules: [{ condition: 'significance >= "moderate"', actions: ['webhook'], priority: 'medium' }]
  }
};

const SIGNIFICANCE_RANK = { none: 0, minor: 1, moderate: 2, major: 3, critical: 4 };

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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
    // Statistics
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
    
    // Alert rules (create_alert_rule) are evaluated on every compare; the
    // alerts they fire are kept here for get_dashboard. Presets back
    // get_monitoring_templates and scheduledMonitorOptions.templateId.
    this.alertRules = new Map();
    this.recentAlerts = [];
    this.maxRecentAlerts = 100;
    this.monitoringTemplates = new Map(
      Object.entries(MONITORING_TEMPLATES).map(([id, t]) => [id, { id, ...t }])
    );

    // Semantic analysis tools (if enabled)
    this.semanticAnalyzer = null;
    
    this.initialize();
  }
  
  async initialize() {
    // Initialize semantic analysis if enabled
    if (this.options.enableSemanticAnalysis) {
      await this.initializeSemanticAnalyzer();
    }
    
    this.emit('initialized');
  }
  
  /**
   * Create baseline snapshot for change tracking
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
        createdAt: baseline.timestamp,
        ...(contentAnalysis.warnings ? { warnings: contentAnalysis.warnings } : {})
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
   * @param {Object} storageOptions - History retention overrides for this
   *   call: retainHistory (boolean) and maxHistoryEntries (number), as
   *   forwarded from TrackChangesSchema.storageOptions. Both optional —
   *   falls back to this.options.maxHistoryLength when omitted.
   * @returns {Object} - Change analysis results
   */
  async compareWithBaseline(url, currentContent, options = {}, storageOptions = {}) {
    const startTime = Date.now();

    // Expected no-baseline case: return a clean error WITHOUT emitting an
    // unhandled 'error' event (which would crash callers with no 'error' listener).
    if (!this.snapshots.has(url)) {
      throw new Error(`No baseline found for ${url} — run create_baseline first`);
    }

    try {

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
      
      // Create change record. An unchanged compare (significance 'none' ⇒
      // hasChanges:false) must report a neutral changeType — classifyChangeType
      // falls through to 'text_change' even when nothing changed at all.
      const changeRecord = {
        url,
        timestamp: Date.now(),
        baselineVersion: baseline.version,
        changeType: significance === 'none' ? 'none' : this.classifyChangeType(changeAnalysis),
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
      
      // Store change record, trimmed to maxHistoryEntries/maxHistoryLength so
      // a long-running monitor doesn't accumulate a full diff record
      // (word/line-level diff arrays included) per check for the life of the
      // process. retainHistory:false skips storage entirely.
      if (storageOptions.retainHistory !== false) {
        const changeHistory = this.changeHistory.get(url);
        changeHistory.push(changeRecord);
        const maxHistoryLength = storageOptions.maxHistoryEntries ?? this.options.maxHistoryLength;
        if (maxHistoryLength && changeHistory.length > maxHistoryLength) {
          changeHistory.splice(0, changeHistory.length - maxHistoryLength);
        }
      }

      // Update statistics
      this.updateStats(changeRecord);
      
      // Update content hashes if significant change
      if (significance !== 'none') {
        this.contentHashes.set(url, currentAnalysis.hashes);
      }
      
      this.emit('changeDetected', changeRecord);
      const alerts = this.evaluateAlertRules(changeRecord);
      
      const ignoredOptions = this.findIgnoredCompareOptions(options, baseline.options);

      return {
        hasChanges: significance !== 'none',
        significance,
        changeType: changeRecord.changeType,
        summary: this.generateChangeSummary(changeAnalysis, significance),
        details: changeAnalysis,
        metrics: changeRecord.metrics,
        recommendations: this.generateChangeRecommendations(changeRecord),
        ...(alerts.length ? { alerts } : {}),
        ...(ignoredOptions.length ? {
          warnings: [
            `${ignoredOptions.join(', ')} passed to this compare ${ignoredOptions.length === 1 ? 'was' : 'were'} ignored — ` +
            `the baseline's options are applied to both sides of the diff. Recreate the baseline to change them.`
          ]
        } : {})
      };
      
    } catch (error) {
      this.emit('error', { operation: 'compareWithBaseline', url, error: error.message });
      throw new Error(`Failed to compare content for ${url}: ${error.message}`);
    }
  }
  
  /**
   * Report analysis options supplied at compare time that differ from the
   * baseline's and were therefore not applied.
   *
   * Ignoring them is deliberate — both sides of a diff have to be analyzed
   * identically, and once customSelectors scoped the baseline it no longer
   * holds the full document to re-scope. But doing it silently let a caller
   * scope a compare and read the resulting whole-page churn as real change:
   * the result is byte-identical to an unscoped run, with nothing saying so.
   *
   * @param {Object} callerOptions - trackingOptions passed to this compare
   * @param {Object} baselineOptions - options stored with the baseline
   * @returns {string[]} - names of the ignored options
   */
  findIgnoredCompareOptions(callerOptions = {}, baselineOptions = {}) {
    return ['granularity', 'customSelectors', 'excludeSelectors'].filter(key => {
      if (callerOptions[key] === undefined) return false;
      return JSON.stringify(callerOptions[key]) !== JSON.stringify(baselineOptions[key]);
    });
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
      let $ = load(content);

      // Remove excluded elements
      options.excludeSelectors?.forEach(selector => {
        $(selector).remove();
      });

      // Narrow the working document to customSelectors so hashing, similarity
      // and text diffs all operate on the same subtree. Previously these
      // selectors only added extra section hashes while every comparison still
      // ran over the whole page, so document-level churn (session tokens,
      // CSP nonces, rotating ad ids) registered as changes no matter how
      // tightly the caller scoped.
      if (options.customSelectors?.length) {
        const scoped = options.customSelectors
          .flatMap(selector => $(selector).toArray().map(element => $.html(element)))
          .join('\n');

        if (scoped) {
          $ = load(scoped);
          analysis.originalContent = scoped;
        } else {
          // Falling back to the full document keeps a bad selector from
          // silently tracking nothing, but the caller needs to know.
          analysis.warnings = [
            `customSelectors matched no elements (${options.customSelectors.join(', ')}); tracked the full document instead`
          ];
        }
      }

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
      
      // Calculate statistics over the scoped content, matching what is hashed
      analysis.statistics = this.calculateContentStatistics(analysis.originalContent, $);
      
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
      // null rather than 0: a structural score is only produced when
      // trackStructure is on, and 0 is a real score meaning "the structure
      // changed completely".
      structuralSimilarity: null,
      addedElements: [],
      removedElements: [],
      modifiedElements: [],
      textChanges: [],
      structuralChanges: [],
      attributeChanges: [],
      imageChanges: [],
      linkChanges: []
    };
    
    // Calculate overall content similarity. Hash equality is used only as the
    // fast identical/changed test — the hashes themselves are not comparable
    // (a single-character edit changes ~every hex digit), so an actual
    // similarity score is computed against the original content.
    changes.similarity = baseline.hashes.page === current.hashes.page
      ? 1
      : calculateContentSimilarity(baseline.originalContent, current.originalContent);
    
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
    
    // Detect monetary value changes. Scored by magnitude rather than by how
    // much of the page they occupy, so a price change is not diluted away.
    if (options.trackText !== false) {
      changes.valueChanges = this.detectValueChanges(
        baseline.originalContent,
        current.originalContent
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
   * Compare the monetary amounts in two versions of the tracked content.
   *
   * Amounts are paired in document order. When the two versions hold different
   * counts the set of prices itself changed (an item sold out, a sale price
   * appeared), which is reported as a change even though no single pair can be
   * measured.
   *
   * @param {string} baselineText
   * @param {string} currentText
   * @returns {{changes: Array, countChanged: boolean, maxRelativeChange: number}|null}
   *   null when no monetary value changed
   */
  detectValueChanges(baselineText, currentText) {
    const before = extractMonetaryValues(baselineText);
    const after = extractMonetaryValues(currentText);
    if (before.length === 0 && after.length === 0) return null;

    const changes = [];
    const pairs = Math.min(before.length, after.length);
    for (let i = 0; i < pairs; i++) {
      if (before[i].amount === after[i].amount) continue;
      const base = Math.abs(before[i].amount);
      const relativeChange = base > 0
        ? Math.abs(after[i].amount - before[i].amount) / base
        : 1;
      changes.push({
        before: before[i].raw,
        after: after[i].raw,
        relativeChange: Math.round(relativeChange * 1000) / 1000
      });
    }

    const countChanged = before.length !== after.length;
    if (changes.length === 0 && !countChanged) return null;

    return {
      changes: changes.slice(0, MAX_DIFF_ENTRIES),
      countChanged,
      maxRelativeChange: changes.reduce((max, c) => Math.max(max, c.relativeChange), 0)
    };
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
    let level;
    if (significanceScore < thresholds.minor) {
      level = 'none';
    } else if (significanceScore < thresholds.moderate) {
      level = 'minor';
    } else if (significanceScore < thresholds.major) {
      level = 'moderate';
    } else if (significanceScore < 0.9) {
      level = 'major';
    } else {
      level = 'critical';
    }

    // The score above measures how much of the page changed. A price change is
    // significant because of what it is, not how many characters it takes up,
    // so a monetary change raises the level to at least "moderate" — the
    // default notification threshold, which it previously fell below. This only
    // ever raises the level; a large structural change stays major.
    const valueChanges = changeAnalysis.valueChanges;
    if (valueChanges) {
      const floor = valueChanges.maxRelativeChange >= MAJOR_VALUE_CHANGE ? 'major' : 'moderate';
      if (SIGNIFICANCE_ORDER.indexOf(floor) > SIGNIFICANCE_ORDER.indexOf(level)) {
        level = floor;
      }
    }

    return level;
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

    // Scoping to a tag outside that list (address, td, li, tr, dd) otherwise
    // indexes ZERO elements: the scoped document is hashed, but nothing in it
    // matches the allowlist, so every compare sees an empty element map and
    // can never report an element-level change. Hash the scoped elements
    // themselves for any tag the loop above does not already cover.
    if (options.customSelectors?.length) {
      const alreadyHashed = new Set(importantElements);
      options.customSelectors.forEach((selector, selectorIndex) => {
        $(selector).each((index, element) => {
          const tag = element.tagName?.toLowerCase();
          if (!tag || alreadyHashed.has(tag)) return;

          const elementKey = `custom_${selectorIndex}_${index}`;
          analysis.hashes.elements[elementKey] = this.hashContent($(element).html() || '');

          if (options.trackAttributes) {
            const attributes = element.attribs || {};
            analysis.hashes.elements[`${elementKey}_attr`] = this.hashContent(JSON.stringify(attributes));
          }
        });
      });
    }
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
      // Element count per nesting depth. This used to be an empty object that
      // nothing ever wrote to, which made the hierarchy half of the structural
      // score a constant.
      hierarchy: structureSignature($).depths,
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
      title: pageTitle($) || '',
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
    
    // Word-level diff. Only record an entry when something actually changed
    // (mirrors line_diff below) — unconditionally pushing an empty word_diff
    // made every unchanged compare report "Text content changed".
    const wordDiff = diffWords(baselineContent, currentContent);
    const wordDiffChanges = wordDiff.filter(part => part.added || part.removed);
    if (wordDiffChanges.length > 0) {
      textChanges.push({
        type: 'word_diff',
        changes: this.capDiffPayload(wordDiffChanges)
      });
    }

    // Line-level diff for structured content. With ignoreWhitespace (the
    // default) the whole document collapses onto a single line, so diffLines
    // degenerates into "remove everything, add everything" — a payload twice
    // the page size describing what word_diff already pinpointed. Only run it
    // when the content genuinely has line structure.
    const hasLineStructure = baselineContent.includes('\n') || currentContent.includes('\n');
    if (hasLineStructure) {
      const lineDiff = diffLines(baselineContent, currentContent);
      const lineDiffChanges = lineDiff.filter(part => part.added || part.removed);
      if (lineDiffChanges.length > 0) {
        textChanges.push({
          type: 'line_diff',
          changes: this.capDiffPayload(lineDiffChanges)
        });
      }
    }

    return textChanges;
  }

  /**
   * Bound a diff payload so a large page cannot produce a multi-megabyte
   * response. Keeps the first maxEntries changes, truncates any oversized
   * value, and appends a marker describing what was dropped so callers never
   * mistake a truncated diff for a complete one.
   * @param {Array} changes - Diff parts from diffWords/diffLines
   * @param {Object} limits - Optional maxEntries / maxValueChars overrides
   * @returns {Array} - Bounded diff parts
   */
  capDiffPayload(changes, limits = {}) {
    const maxEntries = limits.maxEntries ?? MAX_DIFF_ENTRIES;
    const maxValueChars = limits.maxValueChars ?? MAX_DIFF_VALUE_CHARS;

    const capped = changes.slice(0, maxEntries).map(part => {
      if (typeof part.value === 'string' && part.value.length > maxValueChars) {
        return {
          ...part,
          value: part.value.slice(0, maxValueChars),
          truncated: true,
          omittedChars: part.value.length - maxValueChars
        };
      }
      return part;
    });

    const omittedEntries = changes.length - capped.length;
    if (omittedEntries > 0) {
      capped.push({
        omittedEntries,
        note: `${omittedEntries} further changes omitted; scope the comparison with customSelectors to see them`
      });
    }

    return capped;
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

  /**
   * D2.8: Hash large content (>256KB) off the main thread to avoid event-loop blocking.
   * Falls back to synchronous hashContent for smaller payloads.
   * @param {string} content
   * @returns {Promise<string>}
   */
  async hashContentAsync(content) {
    const THRESHOLD = 256 * 1024; // 256 KB
    const str = content || '';
    if (str.length <= THRESHOLD) {
      return this.hashContent(str);
    }

    const algorithm = this.options.hashAlgorithm || 'sha256';
    return new Promise((resolve, reject) => {
      const workerCode = `
        const { createHash } = require('crypto');
        const { workerData, parentPort } = require('worker_threads');
        const hash = createHash(workerData.algorithm).update(workerData.content).digest('hex');
        parentPort.postMessage(hash);
      `;
      const worker = new Worker(workerCode, {
        eval: true,
        workerData: { content: str, algorithm }
      });
      worker.once('message', resolve);
      worker.once('error', (err) => {
        // Fallback to sync on worker error
        try { resolve(this.hashContent(str)); } catch (e) { reject(e); }
      });
    });
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

    // Scored in crawlforge-extractors so the REST API's track_changes reports
    // the same number for the same pair of pages.
    return structuralSimilarity(
      { tags: (baseline.elements || []).map(el => el.tag), depths: baseline.hierarchy },
      { tags: (current.elements || []).map(el => el.tag), depths: current.hierarchy }
    );
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
  
  /**
   * Count text-level changes for the summary. word_diff and line_diff describe
   * the same edit at two granularities, so summing them would double-count —
   * take the word diff, falling back to the line diff (a whitespace-only edit
   * produces only the latter). Entries capDiffPayload dropped still count, or a
   * large diff would report the cap instead of the real number.
   */
  countTextChanges(textChanges = []) {
    const diff = textChanges.find(c => c.type === 'word_diff')
      || textChanges.find(c => c.type === 'line_diff');

    if (!diff) return 0;

    return diff.changes.reduce(
      (count, part) => count + (part.added || part.removed ? 1 : part.omittedEntries || 0),
      0
    );
  }

  generateChangeSummary(changeAnalysis, significance) {
    const { addedElements, removedElements, modifiedElements, similarity } = changeAnalysis;

    // Text-only changes were left out of the total, so a compare whose entire
    // diff was textual (a rotated UUID, an edited paragraph) reported
    // totalChanges:0 beside a populated details.textChanges, and anything
    // alerting on the counters never fired. Counted raw, like the three
    // element counters beside it: all four report what the diff holds, and
    // hasChanges alone reports whether it cleared the significance threshold.
    const textChanges = this.countTextChanges(changeAnalysis.textChanges);

    const total = addedElements.length + removedElements.length + modifiedElements.length + textChanges;

    return {
      totalChanges: total,
      contentSimilarity: Math.round(similarity * 100),
      added: addedElements.length,
      removed: removedElements.length,
      modified: modifiedElements.length,
      textChanges,
      // Sub-threshold text noise (a rotating session token, a base64 timestamp)
      // still lands in details.textChanges, so the description read "Text
      // content changed" on a compare that reported hasChanges:false and
      // totalChanges:0. Defer to the verdict the caller is given.
      changeDescription: significance === 'none'
        ? 'No significant changes detected'
        : this.generateChangeDescription(changeAnalysis)
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
  async detectChangesFromSnapshot(url, currentContent) {
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

  // ── Alert rules, dashboard, export, trends, presets ─────────────────────────
  // Backing for the track_changes operations create_alert_rule, get_dashboard,
  // export_history, generate_trend_report and get_monitoring_templates. The
  // tool has called these since v3.1.0; until 5.4.3 none of them existed.

  /**
   * Turn an alert-rule condition string into a predicate over a change record.
   * Supported: `significance === "major"`, `significance >= "moderate"` and
   * the other comparison operators against the significance ladder
   * none < minor < moderate < major < critical. Anything else never matches.
   */
  static parseAlertCondition(conditionString = '') {
    const match = String(conditionString).match(/significance\s*(===|==|!==|!=|>=|<=|>|<)\s*["'](\w+)["']/);
    if (!match) return () => false;
    const [, op, level] = match;
    const target = SIGNIFICANCE_RANK[level];
    if (target === undefined) return () => false;
    return (record) => {
      const rank = SIGNIFICANCE_RANK[record?.significance];
      if (rank === undefined) return false;
      switch (op) {
        case '===': case '==': return rank === target;
        case '!==': case '!=': return rank !== target;
        case '>=': return rank >= target;
        case '<=': return rank <= target;
        case '>': return rank > target;
        default: return rank < target;
      }
    };
  }

  /**
   * Register an alert rule. `condition` is a string (see parseAlertCondition);
   * `url` scopes the rule to one tracked page, or every page when omitted.
   */
  addAlertRule(ruleId, { condition, url = null, actions = ['webhook'], throttle = 600000, priority = 'medium' } = {}) {
    const rule = {
      id: ruleId,
      url,
      conditionText: condition || 'significance === "major"',
      condition: ChangeTracker.parseAlertCondition(condition || 'significance === "major"'),
      actions,
      throttle,
      priority,
      createdAt: Date.now(),
      fireCount: 0,
      suppressedCount: 0,
      lastFiredAt: null
    };
    this.alertRules.set(ruleId, rule);
    return rule;
  }

  /** Evaluate every rule against a change record; returns the alerts fired. */
  evaluateAlertRules(changeRecord) {
    const fired = [];
    const now = changeRecord.timestamp || Date.now();
    for (const rule of this.alertRules.values()) {
      if (rule.url && rule.url !== changeRecord.url) continue;
      let matches = false;
      try { matches = rule.condition(changeRecord); } catch { matches = false; }
      if (!matches) continue;
      if (rule.lastFiredAt && rule.throttle && now - rule.lastFiredAt < rule.throttle) {
        rule.suppressedCount++;
        continue;
      }
      rule.lastFiredAt = now;
      rule.fireCount++;
      const alert = {
        id: `alert_${now}_${Math.random().toString(36).slice(2, 8)}`,
        ruleId: rule.id,
        url: changeRecord.url,
        timestamp: now,
        significance: changeRecord.significance,
        changeType: changeRecord.changeType,
        similarity: changeRecord.details?.similarity ?? null,
        priority: rule.priority,
        actions: rule.actions
      };
      this.recentAlerts.unshift(alert);
      if (this.recentAlerts.length > this.maxRecentAlerts) this.recentAlerts.length = this.maxRecentAlerts;
      fired.push(alert);
      this.emit('alert', alert);
    }
    return fired;
  }

  /** Per-URL change trend over the in-memory history. */
  summarizeTrend(url) {
    const history = this.changeHistory.get(url) || [];
    const changes = history.filter(r => r.significance !== 'none');
    const significanceDistribution = { none: 0, minor: 0, moderate: 0, major: 0, critical: 0 };
    for (const r of history) {
      significanceDistribution[r.significance] = (significanceDistribution[r.significance] || 0) + 1;
    }
    const similarities = history.map(r => r.details?.similarity).filter(n => typeof n === 'number');
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const half = Math.floor(similarities.length / 2);
    const early = avg(similarities.slice(0, half));
    const late = avg(similarities.slice(half));
    let direction = 'insufficient_data';
    if (similarities.length >= 4 && early !== null && late !== null) {
      direction = late < early - 0.05 ? 'diverging' : late > early + 0.05 ? 'stabilizing' : 'steady';
    }
    const span = history.length >= 2 ? history[history.length - 1].timestamp - history[0].timestamp : 0;
    const changeTypes = {};
    for (const r of changes) changeTypes[r.changeType] = (changeTypes[r.changeType] || 0) + 1;
    return {
      url,
      compares: history.length,
      changes: changes.length,
      changeRate: history.length ? changes.length / history.length : 0,
      changesPerDay: span > 0 ? changes.length / (span / 86400000) : null,
      averageSimilarity: avg(similarities),
      direction,
      significanceDistribution,
      changeTypes,
      firstCompareAt: history[0]?.timestamp ?? null,
      lastCompareAt: history[history.length - 1]?.timestamp ?? null,
      lastChangeAt: changes[changes.length - 1]?.timestamp ?? null
    };
  }

  async generateTrendAnalysisReport(url) {
    if (url && !this.changeHistory.has(url) && !this.snapshots.has(url)) {
      throw new Error(`No tracking history for ${url} — run create_baseline and compare first`);
    }
    const urls = url ? [url] : Array.from(this.changeHistory.keys());
    const trends = urls.map(u => this.summarizeTrend(u));
    const recommendations = [];
    for (const t of trends) {
      if (t.compares < 2) {
        recommendations.push(`${t.url}: ${t.compares} compare${t.compares === 1 ? '' : 's'} recorded — run compare a few more times before reading a trend.`);
        continue;
      }
      if (t.direction === 'diverging') {
        recommendations.push(`${t.url}: each compare drifts further from the baseline — recreate the baseline if the current page is the new normal.`);
      }
      if (t.changes === 0) {
        recommendations.push(`${t.url}: no changes across ${t.compares} compares — the polling interval can be lengthened.`);
      }
      if (t.changesPerDay !== null && t.changesPerDay > 24) {
        recommendations.push(`${t.url}: changes more than hourly — scope the baseline with customSelectors to skip volatile regions.`);
      }
    }
    return { generatedAt: Date.now(), scope: url || 'global', urlCount: urls.length, trends, recommendations };
  }

  getMonitoringDashboard() {
    const urls = Array.from(new Set([...this.snapshots.keys(), ...this.changeHistory.keys()]));
    const tracked = urls.map(url => {
      const history = this.changeHistory.get(url) || [];
      const last = history[history.length - 1] || null;
      const snaps = this.snapshots.get(url) || [];
      const baseline = snaps[snaps.length - 1] || null;
      return {
        url,
        baselineVersion: baseline?.version ?? null,
        baselineCreatedAt: baseline?.timestamp ?? null,
        compares: history.length,
        changes: history.filter(r => r.significance !== 'none').length,
        lastCompareAt: last?.timestamp ?? null,
        lastSignificance: last?.significance ?? null,
        lastChangeType: last?.changeType ?? null
      };
    });
    return {
      generatedAt: Date.now(),
      summary: {
        trackedUrls: urls.length,
        totalCompares: tracked.reduce((n, t) => n + t.compares, 0),
        totalChanges: tracked.reduce((n, t) => n + t.changes, 0),
        alertRules: this.alertRules.size,
        alertsFired: this.recentAlerts.length,
        activeMonitors: 0,
        ...this.getStats()
      },
      tracked,
      alertRules: Array.from(this.alertRules.values()).map(r => ({
        id: r.id, url: r.url, condition: r.conditionText, actions: r.actions, throttle: r.throttle,
        priority: r.priority, fireCount: r.fireCount, suppressedCount: r.suppressedCount, lastFiredAt: r.lastFiredAt
      })),
      recentAlerts: this.recentAlerts.slice(0, 20),
      trends: urls.map(u => this.summarizeTrend(u)),
      // Polling and scheduled monitors live in the tool, which fills this in.
      monitors: []
    };
  }

  async exportHistoricalData(options = {}) {
    const { url, format = 'json', startTime, endTime, includeContent = false, includeSnapshots = false } = options;
    const urls = url ? [url] : Array.from(this.changeHistory.keys());
    const records = [];
    for (const u of urls) {
      for (const r of this.changeHistory.get(u) || []) {
        if (startTime && r.timestamp < startTime) continue;
        if (endTime && r.timestamp > endTime) continue;
        const row = {
          url: r.url,
          timestamp: r.timestamp,
          iso: new Date(r.timestamp).toISOString(),
          baselineVersion: r.baselineVersion ?? null,
          changeType: r.changeType,
          significance: r.significance,
          similarity: r.details?.similarity ?? null,
          structuralSimilarity: r.details?.structuralSimilarity ?? null,
          addedElements: r.metrics?.addedElements ?? 0,
          removedElements: r.metrics?.removedElements ?? 0,
          modifiedElements: r.metrics?.modifiedElements ?? 0,
          processingTime: r.processingTime ?? null
        };
        if (includeContent) row.details = r.details;
        records.push(row);
      }
    }
    records.sort((a, b) => a.timestamp - b.timestamp);

    const result = {
      format,
      exportedAt: Date.now(),
      scope: url || 'global',
      urlCount: urls.length,
      recordCount: records.length,
      ...(startTime || endTime ? { range: { startTime: startTime ?? null, endTime: endTime ?? null } } : {})
    };
    if (includeSnapshots) {
      result.snapshots = urls.flatMap(u => (this.snapshots.get(u) || []).map(snap => ({
        url: u,
        version: snap.version ?? null,
        createdAt: snap.timestamp ?? null,
        contentHash: snap.analysis?.hashes?.content ?? null,
        options: snap.options ?? null
      })));
    }
    if (format === 'csv') {
      const columns = ['url', 'timestamp', 'iso', 'baselineVersion', 'changeType', 'significance', 'similarity',
        'structuralSimilarity', 'addedElements', 'removedElements', 'modifiedElements', 'processingTime',
        ...(includeContent ? ['details'] : [])];
      result.columns = columns;
      result.csv = [columns.join(','), ...records.map(r => columns.map(c => csvCell(r[c])).join(','))].join('\n');
    } else {
      result.records = records;
    }
    return result;
  }

  async initializeSemanticAnalyzer() {
    // Placeholder for semantic analysis initialization
  }

  cleanup() {
    this.contentHistory.clear();
    this.baselineContent.clear();
    this.activeMonitors.clear();
    this.changeNotifications.clear();
    this.snapshotManager.clear();
  }

}

export default ChangeTracker;
/**
 * Unit tests for ChangeTracker - Wave 3 Change Detection and Analysis
 * Tests hierarchical content hashing, differential comparison engine,
 * and change significance scoring
 */

import { describe, it, beforeEach, afterEach, expect, jest } from '@jest/globals';
import { ChangeTracker } from '../../src/core/ChangeTracker.js';
import { createHash } from 'crypto';

// Mock external dependencies
jest.mock('cheerio', () => ({
  load: jest.fn(() => ({
    text: jest.fn(() => 'Sample text content'),
    html: jest.fn(() => '<p>Sample HTML</p>'),
    find: jest.fn(() => ({ length: 1 })),
    remove: jest.fn(() => ({})),
    each: jest.fn((callback) => callback())
  }))
}));

jest.mock('diff', () => ({
  diffWords: jest.fn(() => [
    { added: false, removed: false, value: 'same ' },
    { added: true, removed: false, value: 'new ' },
    { added: false, removed: true, value: 'old ' }
  ]),
  diffLines: jest.fn(() => [
    { added: false, removed: false, value: 'Line 1\n' },
    { added: true, removed: false, value: 'Line 2 new\n' }
  ]),
  diffChars: jest.fn(() => [
    { added: false, removed: false, value: 'Hello' },
    { added: true, removed: false, value: ' World' }
  ])
}));

describe('ChangeTracker', () => {
  let changeTracker;
  
  const sampleUrl = 'https://example.com/page';
  const sampleContent1 = 'This is the original content about machine learning.';
  const sampleContent2 = 'This is the updated content about artificial intelligence.';
  const sampleHtml1 = '<div><h1>Title</h1><p>Original paragraph</p></div>';
  const sampleHtml2 = '<div><h1>New Title</h1><p>Updated paragraph</p><p>Added paragraph</p></div>';

  beforeEach(() => {
    jest.clearAllMocks();
    
    changeTracker = new ChangeTracker({
      hashAlgorithm: 'sha256',
      maxHistoryLength: 10,
      enableRealTimeTracking: false, // Disabled for testing
      enableChangeSignificanceScoring: true,
      enableStructuralAnalysis: true,
      contentSimilarityThreshold: 0.8
    });
  });

  afterEach(async () => {
    if (changeTracker) {
      await changeTracker.cleanup();
    }
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultTracker = new ChangeTracker();
      
      expect(defaultTracker.options).toMatchObject({
        hashAlgorithm: 'sha256',
        maxHistoryLength: 100,
        enableRealTimeTracking: true,
        monitoringInterval: 300000,
        enableChangeSignificanceScoring: true,
        enableStructuralAnalysis: true,
        contentSimilarityThreshold: 0.8
      });
    });

    it('should accept custom configuration', () => {
      expect(changeTracker.options.maxHistoryLength).toBe(10);
      expect(changeTracker.options.enableRealTimeTracking).toBe(false);
      expect(changeTracker.options.contentSimilarityThreshold).toBe(0.8);
    });

    it('should initialize data structures', () => {
      expect(changeTracker.snapshots).toBeInstanceOf(Map);
      expect(changeTracker.contentHashes).toBeInstanceOf(Map);
      expect(changeTracker.changeHistory).toBeInstanceOf(Map);
      expect(changeTracker.structuralHashes).toBeInstanceOf(Map);
      expect(changeTracker.activeMonitors).toBeInstanceOf(Map);
    });

    it('should initialize statistics tracking', () => {
      expect(changeTracker.stats).toMatchObject({
        pagesTracked: 0,
        changesDetected: 0,
        significantChanges: 0,
        structuralChanges: 0,
        contentChanges: 0,
        falsePositives: 0,
        averageChangeScore: 0,
        lastAnalysis: null,
        processingTime: 0
      });
    });
  });

  describe('Content Hashing', () => {
    it('should generate consistent content hashes', () => {
      const hash1 = changeTracker.generateContentHash(sampleContent1);
      const hash2 = changeTracker.generateContentHash(sampleContent1);
      const hash3 = changeTracker.generateContentHash(sampleContent2);

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash1.length).toBe(64); // SHA256 hex length
    });

    it('should use specified hash algorithm', () => {
      const md5Tracker = new ChangeTracker({ hashAlgorithm: 'md5' });
      const hash = md5Tracker.generateContentHash(sampleContent1);
      
      expect(hash.length).toBe(32); // MD5 hex length
    });

    it('should generate hierarchical hashes', () => {
      const hierarchical = changeTracker.generateHierarchicalHashes(sampleHtml1, {
        granularity: 'section'
      });

      expect(hierarchical).toMatchObject({
        pageHash: expect.any(String),
        sectionHashes: expect.any(Map),
        elementHashes: expect.any(Map),
        metadata: expect.any(Object)
      });
    });

    it('should handle different granularity levels', () => {
      const pageLevel = changeTracker.generateHierarchicalHashes(sampleHtml1, {
        granularity: 'page'
      });
      
      const elementLevel = changeTracker.generateHierarchicalHashes(sampleHtml1, {
        granularity: 'element'
      });

      expect(pageLevel.sectionHashes.size).toBeLessThanOrEqual(elementLevel.elementHashes.size);
    });

    it('should generate structural hashes separately from content', () => {
      const structuralHash = changeTracker.generateStructuralHash(sampleHtml1);
      const contentHash = changeTracker.generateContentHash(sampleContent1);

      expect(structuralHash).not.toBe(contentHash);
      expect(structuralHash.length).toBe(64);
    });
  });

  describe('Snapshot Management', () => {
    it('should create content snapshots', async () => {
      const snapshot = await changeTracker.createSnapshot(sampleUrl, sampleContent1, {
        html: sampleHtml1,
        granularity: 'section'
      });

      expect(snapshot).toMatchObject({
        url: sampleUrl,
        timestamp: expect.any(Number),
        contentHash: expect.any(String),
        structuralHash: expect.any(String),
        hierarchicalHashes: expect.any(Object),
        metadata: expect.any(Object)
      });

      expect(changeTracker.snapshots.has(sampleUrl)).toBe(true);
    });

    it('should store snapshots with metadata', async () => {
      await changeTracker.createSnapshot(sampleUrl, sampleContent1, {
        html: sampleHtml1,
        metadata: { wordCount: 100, lastModified: '2023-01-01' }
      });

      const snapshot = changeTracker.snapshots.get(sampleUrl);
      expect(snapshot.metadata.wordCount).toBe(100);
      expect(snapshot.metadata.lastModified).toBe('2023-01-01');
    });

    it('should maintain snapshot history', async () => {
      // Create multiple snapshots
      await changeTracker.createSnapshot(sampleUrl, sampleContent1);
      await changeTracker.createSnapshot(sampleUrl, sampleContent2);

      const history = changeTracker.getSnapshotHistory(sampleUrl);
      expect(history.length).toBe(2);
      expect(history[1].timestamp).toBeGreaterThan(history[0].timestamp);
    });

    it('should enforce maximum history length', async () => {
      // Create more snapshots than limit
      for (let i = 0; i < 15; i++) {
        await changeTracker.createSnapshot(sampleUrl, `Content ${i}`);
      }

      const history = changeTracker.getSnapshotHistory(sampleUrl);
      expect(history.length).toBeLessThanOrEqual(changeTracker.options.maxHistoryLength);
    });

    it('should clean up old snapshots', async () => {
      await changeTracker.createSnapshot(sampleUrl, sampleContent1);
      
      // Fast-forward time and cleanup
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000); // +24 hours
      await changeTracker.cleanupOldSnapshots(12 * 60 * 60 * 1000); // 12 hour retention

      expect(changeTracker.snapshots.size).toBe(0);
    });
  });

  describe('Change Detection', () => {
    beforeEach(async () => {
      // Create baseline snapshot
      await changeTracker.createSnapshot(sampleUrl, sampleContent1, {
        html: sampleHtml1
      });
    });

    it('should detect content changes', async () => {
      const changes = await changeTracker.detectChanges(sampleUrl, sampleContent2, {
        html: sampleHtml2
      });

      expect(changes).toMatchObject({
        hasChanges: true,
        changeType: expect.any(String),
        significance: expect.any(String),
        score: expect.any(Number),
        details: expect.any(Object),
        timestamp: expect.any(Number)
      });

      expect(changeTracker.stats.changesDetected).toBe(1);
    });

    it('should detect no changes for identical content', async () => {
      const changes = await changeTracker.detectChanges(sampleUrl, sampleContent1, {
        html: sampleHtml1
      });

      expect(changes.hasChanges).toBe(false);
      expect(changes.score).toBe(0);
    });

    it('should classify change types', async () => {
      const contentOnly = await changeTracker.detectChanges(sampleUrl, sampleContent2, {
        html: sampleHtml1 // Same structure, different content
      });

      const structuralOnly = await changeTracker.detectChanges(sampleUrl, sampleContent1, {
        html: sampleHtml2 // Same content, different structure
      });

      expect(contentOnly.changeType).toBe('content');
      expect(structuralOnly.changeType).toBe('structural');
    });

    it('should track change history', async () => {
      await changeTracker.detectChanges(sampleUrl, sampleContent2);
      await changeTracker.detectChanges(sampleUrl, 'Third version of content');

      const history = changeTracker.getChangeHistory(sampleUrl);
      expect(history.length).toBe(2);
      expect(history[0].timestamp).toBeLessThan(history[1].timestamp);
    });

    it('should handle detection options', async () => {
      const changes = await changeTracker.detectChanges(sampleUrl, sampleContent2, {
        options: {
          ignoreWhitespace: true,
          ignoreCase: true,
          trackText: true,
          trackStructure: false
        }
      });

      expect(changes).toBeDefined();
      expect(changes.details.textChanges).toBeDefined();
      expect(changes.details.structuralChanges).toBeUndefined();
    });
  });

  describe('Change Significance Scoring', () => {
    it('should calculate change significance scores', () => {
      const minorChange = {
        textChanges: { additions: 5, deletions: 3, modifications: 1 },
        structuralChanges: { additions: 0, deletions: 0 },
        totalLength: 1000
      };

      const majorChange = {
        textChanges: { additions: 200, deletions: 150, modifications: 50 },
        structuralChanges: { additions: 5, deletions: 3 },
        totalLength: 1000
      };

      const minorScore = changeTracker.calculateSignificanceScore(minorChange);
      const majorScore = changeTracker.calculateSignificanceScore(majorChange);

      expect(minorScore).toBeGreaterThanOrEqual(0);
      expect(minorScore).toBeLessThanOrEqual(1);
      expect(majorScore).toBeGreaterThan(minorScore);
    });

    it('should classify significance levels', () => {
      const scores = [0.05, 0.2, 0.5, 0.8];
      const classifications = scores.map(score => 
        changeTracker.classifySignificance(score)
      );

      expect(classifications).toEqual(['minor', 'minor', 'moderate', 'major']);
    });

    it('should use custom thresholds', () => {
      const customTracker = new ChangeTracker({
        significanceThresholds: {
          minor: 0.05,
          moderate: 0.25,
          major: 0.6
        }
      });

      const classification = customTracker.classifySignificance(0.3);
      expect(classification).toBe('moderate');
    });

    it('should weight different change types appropriately', () => {
      const structuralChange = {
        textChanges: { additions: 0, deletions: 0, modifications: 0 },
        structuralChanges: { additions: 3, deletions: 1 },
        totalLength: 1000
      };

      const textChange = {
        textChanges: { additions: 50, deletions: 30, modifications: 10 },
        structuralChanges: { additions: 0, deletions: 0 },
        totalLength: 1000
      };

      const structuralScore = changeTracker.calculateSignificanceScore(structuralChange);
      const textScore = changeTracker.calculateSignificanceScore(textChange);

      // Structural changes should generally be weighted higher
      expect(structuralScore).toBeGreaterThan(textScore * 0.5);
    });
  });

  describe('Differential Analysis', () => {
    it('should perform detailed differential analysis', async () => {
      await changeTracker.createSnapshot(sampleUrl, sampleContent1);
      
      const diff = await changeTracker.performDifferentialAnalysis(
        sampleUrl, 
        sampleContent2
      );

      expect(diff).toMatchObject({
        wordDiff: expect.any(Array),
        lineDiff: expect.any(Array),
        charDiff: expect.any(Array),
        statistics: expect.any(Object),
        similarity: expect.any(Number)
      });
    });

    it('should calculate content similarity', () => {
      const similarity1 = changeTracker.calculateSimilarity(sampleContent1, sampleContent1);
      const similarity2 = changeTracker.calculateSimilarity(sampleContent1, sampleContent2);
      const similarity3 = changeTracker.calculateSimilarity(sampleContent1, 'Completely different content');

      expect(similarity1).toBe(1);
      expect(similarity2).toBeGreaterThan(0);
      expect(similarity2).toBeLessThan(1);
      expect(similarity3).toBeLessThan(similarity2);
    });

    it('should identify specific change locations', async () => {
      await changeTracker.createSnapshot(sampleUrl, sampleHtml1);
      
      const changes = await changeTracker.identifyChangeLocations(sampleUrl, sampleHtml2, {
        granularity: 'element'
      });

      expect(changes).toBeInstanceOf(Array);
      if (changes.length > 0) {
        expect(changes[0]).toMatchObject({
          selector: expect.any(String),
          changeType: expect.any(String),
          oldValue: expect.any(String),
          newValue: expect.any(String),
          position: expect.any(Object)
        });
      }
    });

    it('should handle custom selectors for tracking', async () => {
      await changeTracker.createSnapshot(sampleUrl, sampleHtml1);
      
      const changes = await changeTracker.detectChanges(sampleUrl, sampleHtml2, {
        options: {
          customSelectors: ['h1', 'p', '.important']
        }
      });

      expect(changes.details.customSelectorChanges).toBeDefined();
    });
  });

  describe('Filtering and Exclusions', () => {
    it('should exclude specified selectors from tracking', async () => {
      const htmlWithAds = `
        <div>
          <h1>Title</h1>
          <p>Content</p>
          <div class="advertisement">Ad content</div>
          <script>analytics();</script>
        </div>
      `;

      await changeTracker.createSnapshot(sampleUrl, 'Content', {
        html: htmlWithAds,
        options: {
          excludeSelectors: ['.advertisement', 'script']
        }
      });

      // Content with changed ads should not trigger significant changes
      const htmlWithDifferentAds = htmlWithAds.replace('Ad content', 'Different ad');
      const changes = await changeTracker.detectChanges(sampleUrl, 'Content', {
        html: htmlWithDifferentAds,
        options: {
          excludeSelectors: ['.advertisement', 'script']
        }
      });

      expect(changes.significance).toBe('none');
    });

    it('should handle whitespace filtering', async () => {
      const content1 = 'Hello World';
      const content2 = 'Hello    World   '; // Extra whitespace

      await changeTracker.createSnapshot(sampleUrl, content1);
      
      const changes = await changeTracker.detectChanges(sampleUrl, content2, {
        options: { ignoreWhitespace: true }
      });

      expect(changes.hasChanges).toBe(false);
    });

    it('should handle case sensitivity options', async () => {
      const content1 = 'Hello World';
      const content2 = 'hello world';

      await changeTracker.createSnapshot(sampleUrl, content1);
      
      const changesWithCase = await changeTracker.detectChanges(sampleUrl, content2, {
        options: { ignoreCase: false }
      });
      
      const changesIgnoreCase = await changeTracker.detectChanges(sampleUrl, content2, {
        options: { ignoreCase: true }
      });

      expect(changesWithCase.hasChanges).toBe(true);
      expect(changesIgnoreCase.hasChanges).toBe(false);
    });
  });

  describe('Real-time Monitoring', () => {
    it('should start monitoring URLs', async () => {
      const monitorOptions = {
        interval: 1000,
        callback: jest.fn()
      };

      await changeTracker.startMonitoring(sampleUrl, monitorOptions);
      
      expect(changeTracker.activeMonitors.has(sampleUrl)).toBe(true);
      expect(changeTracker.activeMonitors.get(sampleUrl)).toMatchObject({
        interval: 1000,
        callback: expect.any(Function),
        intervalId: expect.anything()
      });
    });

    it('should stop monitoring URLs', async () => {
      await changeTracker.startMonitoring(sampleUrl, { interval: 1000 });
      await changeTracker.stopMonitoring(sampleUrl);

      expect(changeTracker.activeMonitors.has(sampleUrl)).toBe(false);
    });

    it('should handle monitoring callbacks', (done) => {
      const callback = jest.fn((changes) => {
        expect(changes).toBeDefined();
        changeTracker.stopMonitoring(sampleUrl);
        done();
      });

      changeTracker.startMonitoring(sampleUrl, {
        interval: 100,
        callback
      });

      // Simulate content change
      setTimeout(() => {
        changeTracker.detectChanges(sampleUrl, sampleContent2);
      }, 150);
    });

    it('should handle monitoring errors gracefully', async () => {
      const errorCallback = jest.fn();
      
      await changeTracker.startMonitoring('invalid-url', {
        interval: 1000,
        errorCallback
      });

      // Should not throw but may call error callback
      expect(changeTracker.activeMonitors.has('invalid-url')).toBe(true);
    });
  });

  describe('Statistics and Reporting', () => {
    beforeEach(async () => {
      await changeTracker.createSnapshot(sampleUrl, sampleContent1);
      await changeTracker.detectChanges(sampleUrl, sampleContent2);
    });

    it('should track comprehensive statistics', () => {
      const stats = changeTracker.getStatistics();

      expect(stats).toMatchObject({
        pagesTracked: expect.any(Number),
        changesDetected: expect.any(Number),
        significantChanges: expect.any(Number),
        structuralChanges: expect.any(Number),
        contentChanges: expect.any(Number),
        averageChangeScore: expect.any(Number),
        processingTime: expect.any(Number)
      });
    });

    it('should generate change reports', async () => {
      const report = await changeTracker.generateChangeReport(sampleUrl, {
        includeDiffs: true,
        includeHistory: true,
        includeStatistics: true
      });

      expect(report).toMatchObject({
        url: sampleUrl,
        currentSnapshot: expect.any(Object),
        changeHistory: expect.any(Array),
        statistics: expect.any(Object),
        lastChange: expect.any(Object)
      });

      if (report.lastChange) {
        expect(report.lastChange.details).toBeDefined();
      }
    });

    it('should export tracking data', () => {
      const exportData = changeTracker.exportTrackingData([sampleUrl]);

      expect(exportData).toMatchObject({
        version: expect.any(String),
        timestamp: expect.any(Number),
        urls: expect.any(Array),
        statistics: expect.any(Object)
      });

      expect(exportData.urls).toContainEqual(
        expect.objectContaining({
          url: sampleUrl,
          snapshots: expect.any(Array),
          changeHistory: expect.any(Array)
        })
      );
    });

    it('should calculate change trends', () => {
      const trends = changeTracker.calculateChangeTrends(sampleUrl, {
        timeWindow: 24 * 60 * 60 * 1000 // 24 hours
      });

      expect(trends).toMatchObject({
        changeFrequency: expect.any(Number),
        averageSignificance: expect.any(Number),
        mostActiveHours: expect.any(Array),
        changeTypes: expect.any(Object)
      });
    });
  });

  describe('Performance Optimization', () => {
    it('should batch process multiple URLs efficiently', async () => {
      const urls = [
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3'
      ];

      const content = ['Content 1', 'Content 2', 'Content 3'];
      
      const startTime = Date.now();
      await changeTracker.batchProcessSnapshots(
        urls.map((url, i) => ({ url, content: content[i] }))
      );
      const processingTime = Date.now() - startTime;

      expect(changeTracker.snapshots.size).toBe(3);
      expect(processingTime).toBeLessThan(5000); // Should be reasonably fast
    });

    it('should optimize memory usage for large histories', async () => {
      const longContentTracker = new ChangeTracker({
        maxHistoryLength: 5,
        enableMemoryOptimization: true
      });

      // Create many snapshots
      for (let i = 0; i < 10; i++) {
        await longContentTracker.createSnapshot(sampleUrl, `Content ${i}`);
      }

      const history = longContentTracker.getSnapshotHistory(sampleUrl);
      expect(history.length).toBeLessThanOrEqual(5);
    });

    it('should handle large content efficiently', async () => {
      const largeContent = 'Large content '.repeat(10000);
      
      const startTime = Date.now();
      await changeTracker.createSnapshot(sampleUrl, largeContent);
      const processingTime = Date.now() - startTime;

      expect(processingTime).toBeLessThan(2000); // Should handle large content quickly
      expect(changeTracker.snapshots.has(sampleUrl)).toBe(true);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed HTML gracefully', async () => {
      const malformedHtml = '<div><p>Unclosed paragraph<div>Nested improperly</div>';
      
      await expect(
        changeTracker.createSnapshot(sampleUrl, 'Content', {
          html: malformedHtml
        })
      ).resolves.not.toThrow();
    });

    it('should handle empty content', async () => {
      await changeTracker.createSnapshot(sampleUrl, '');
      const changes = await changeTracker.detectChanges(sampleUrl, 'New content');

      expect(changes.hasChanges).toBe(true);
      expect(changes.significance).not.toBe('none');
    });

    it('should handle network errors during monitoring', async () => {
      const errorCallback = jest.fn();
      
      await changeTracker.startMonitoring('https://nonexistent.com', {
        interval: 1000,
        errorCallback
      });

      // Should not crash the tracker
      expect(changeTracker.activeMonitors.has('https://nonexistent.com')).toBe(true);
    });

    it('should validate input parameters', async () => {
      await expect(
        changeTracker.createSnapshot('invalid-url', sampleContent1)
      ).rejects.toThrow();

      await expect(
        changeTracker.detectChanges(sampleUrl, null)
      ).rejects.toThrow();
    });

    it('should handle concurrent operations safely', async () => {
      const promises = [];
      
      // Create multiple concurrent snapshots
      for (let i = 0; i < 5; i++) {
        promises.push(
          changeTracker.createSnapshot(`${sampleUrl}?v=${i}`, `Content ${i}`)
        );
      }

      await Promise.all(promises);
      expect(changeTracker.snapshots.size).toBe(5);
    });
  });

  describe('Cleanup and Resource Management', () => {
    it('should cleanup resources properly', async () => {
      await changeTracker.createSnapshot(sampleUrl, sampleContent1);
      await changeTracker.startMonitoring(sampleUrl, { interval: 1000 });

      await changeTracker.cleanup();

      expect(changeTracker.snapshots.size).toBe(0);
      expect(changeTracker.changeHistory.size).toBe(0);
      expect(changeTracker.activeMonitors.size).toBe(0);
    });

    it('should stop all monitoring on cleanup', async () => {
      await changeTracker.startMonitoring(sampleUrl, { interval: 1000 });
      await changeTracker.startMonitoring('https://example2.com', { interval: 1000 });

      await changeTracker.cleanup();

      expect(changeTracker.activeMonitors.size).toBe(0);
    });

    it('should handle cleanup errors gracefully', async () => {
      // Mock cleanup error
      jest.spyOn(changeTracker, 'stopAllMonitoring').mockRejectedValue(new Error('Cleanup failed'));

      await expect(changeTracker.cleanup()).resolves.not.toThrow();
    });

    it('should clear caches on cleanup', async () => {
      await changeTracker.createSnapshot(sampleUrl, sampleContent1);
      
      expect(changeTracker.contentHashes.size).toBeGreaterThan(0);
      
      await changeTracker.cleanup();
      
      expect(changeTracker.contentHashes.size).toBe(0);
      expect(changeTracker.structuralHashes.size).toBe(0);
    });
  });

  describe('Integration with MCP Protocol', () => {
    it('should format results for MCP responses', async () => {
      await changeTracker.createSnapshot(sampleUrl, sampleContent1);
      const changes = await changeTracker.detectChanges(sampleUrl, sampleContent2);

      const mcpResponse = changeTracker.formatForMCP(changes);

      expect(mcpResponse).toMatchObject({
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.any(String)
          })
        ])
      });
    });

    it('should handle MCP tool parameter validation', () => {
      const validParams = {
        url: sampleUrl,
        content: sampleContent1,
        options: {
          granularity: 'section',
          trackText: true,
          trackStructure: true
        }
      };

      expect(() => changeTracker.validateMCPParameters(validParams)).not.toThrow();
    });

    it('should provide structured error responses for MCP', () => {
      const error = new Error('Tracking failed');
      const mcpError = changeTracker.formatMCPError(error, sampleUrl);

      expect(mcpError).toMatchObject({
        error: {
          code: expect.any(Number),
          message: expect.any(String),
          details: expect.any(Object)
        }
      });
    });
  });
});
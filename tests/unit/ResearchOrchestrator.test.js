/**
 * Unit tests for ResearchOrchestrator - Wave 3 Deep Research Tool
 * Tests the multi-stage research orchestration engine including
 * query expansion, source verification, and information synthesis
 */

import { describe, it, beforeEach, afterEach, expect, jest } from '@jest/globals';
import { ResearchOrchestrator } from '../../src/core/ResearchOrchestrator.js';
import { SearchWebTool } from '../../src/tools/search/searchWeb.js';
import { CrawlDeepTool } from '../../src/tools/crawl/crawlDeep.js';
import { ExtractContentTool } from '../../src/tools/extract/extractContent.js';
import { SummarizeContentTool } from '../../src/tools/extract/summarizeContent.js';

// Mock external dependencies
jest.mock('../../src/tools/search/searchWeb.js');
jest.mock('../../src/tools/crawl/crawlDeep.js');
jest.mock('../../src/tools/extract/extractContent.js');
jest.mock('../../src/tools/extract/summarizeContent.js');

describe('ResearchOrchestrator', () => {
  let orchestrator;
  let mockSearchTool;
  let mockCrawlTool;
  let mockExtractTool;
  let mockSummarizeTool;

  const sampleResearchTopic = "Machine Learning algorithms in healthcare";
  const sampleSearchResults = [
    {
      title: "ML in Healthcare Overview",
      url: "https://example.com/ml-healthcare",
      snippet: "Machine learning is transforming healthcare...",
      credibilityScore: 0.8
    },
    {
      title: "Deep Learning for Medical Diagnosis",
      url: "https://example.com/dl-diagnosis",
      snippet: "Deep neural networks can assist in diagnosis...",
      credibilityScore: 0.9
    }
  ];

  const sampleExtractedContent = {
    title: "ML in Healthcare Overview",
    content: "Machine learning algorithms are revolutionizing healthcare by providing insights...",
    metadata: { wordCount: 500, readingTime: 3, language: 'en' },
    structuredData: { type: 'Article', author: 'Dr. Smith' }
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock implementations
    mockSearchTool = {
      execute: jest.fn(),
      searchWithOptions: jest.fn()
    };
    mockCrawlTool = {
      execute: jest.fn(),
      crawlUrls: jest.fn()
    };
    mockExtractTool = {
      execute: jest.fn(),
      extractFromUrl: jest.fn()
    };
    mockSummarizeTool = {
      execute: jest.fn(),
      summarizeText: jest.fn()
    };

    SearchWebTool.mockImplementation(() => mockSearchTool);
    CrawlDeepTool.mockImplementation(() => mockCrawlTool);
    ExtractContentTool.mockImplementation(() => mockExtractTool);
    SummarizeContentTool.mockImplementation(() => mockSummarizeTool);

    orchestrator = new ResearchOrchestrator({
      maxDepth: 3,
      maxUrls: 50,
      timeLimit: 60000,
      concurrency: 3,
      enableSourceVerification: true,
      enableConflictDetection: true
    });
  });

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.cleanup();
    }
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultOrchestrator = new ResearchOrchestrator();
      
      expect(defaultOrchestrator.maxDepth).toBe(5);
      expect(defaultOrchestrator.maxUrls).toBe(100);
      expect(defaultOrchestrator.timeLimit).toBe(120000);
      expect(defaultOrchestrator.concurrency).toBe(5);
      expect(defaultOrchestrator.enableSourceVerification).toBe(true);
      expect(defaultOrchestrator.enableConflictDetection).toBe(true);
    });

    it('should enforce configuration limits', () => {
      const limitedOrchestrator = new ResearchOrchestrator({
        maxDepth: 15, // Should be capped at 10
        maxUrls: 2000, // Should be capped at 1000
        timeLimit: 10000, // Should be raised to 30000
        concurrency: 50 // Should be capped at 20
      });

      expect(limitedOrchestrator.maxDepth).toBe(10);
      expect(limitedOrchestrator.maxUrls).toBe(1000);
      expect(limitedOrchestrator.timeLimit).toBe(30000);
      expect(limitedOrchestrator.concurrency).toBe(20);
    });

    it('should initialize all required tools and utilities', () => {
      expect(SearchWebTool).toHaveBeenCalled();
      expect(CrawlDeepTool).toHaveBeenCalled();
      expect(ExtractContentTool).toHaveBeenCalled();
      expect(SummarizeContentTool).toHaveBeenCalled();
      
      expect(orchestrator.queryExpander).toBeDefined();
      expect(orchestrator.resultRanker).toBeDefined();
      expect(orchestrator.cache).toBeDefined();
      expect(orchestrator.logger).toBeDefined();
    });

    it('should initialize research state correctly', () => {
      expect(orchestrator.researchState.sessionId).toBeNull();
      expect(orchestrator.researchState.startTime).toBeNull();
      expect(orchestrator.researchState.currentDepth).toBe(0);
      expect(orchestrator.researchState.visitedUrls).toEqual(new Set());
      expect(orchestrator.researchState.searchResults).toEqual(new Map());
      expect(orchestrator.researchState.extractedContent).toEqual(new Map());
      expect(orchestrator.researchState.researchFindings).toEqual([]);
    });
  });

  describe('Research Session Management', () => {
    it('should generate unique session IDs', () => {
      const sessionId1 = orchestrator.generateSessionId();
      const sessionId2 = orchestrator.generateSessionId();
      
      expect(sessionId1).toBeDefined();
      expect(sessionId2).toBeDefined();
      expect(sessionId1).not.toBe(sessionId2);
      expect(sessionId1.length).toBe(16); // 8 bytes hex = 16 chars
    });

    it('should initialize research session properly', () => {
      const sessionId = 'test-session-123';
      const topic = 'AI in healthcare';
      const startTime = Date.now();

      orchestrator.initializeResearchSession(sessionId, topic, startTime);

      expect(orchestrator.researchState.sessionId).toBe(sessionId);
      expect(orchestrator.researchState.startTime).toBe(startTime);
      expect(orchestrator.researchState.currentDepth).toBe(0);
      expect(orchestrator.researchState.visitedUrls.size).toBe(0);
      expect(orchestrator.researchState.activityLog).toContainEqual({
        timestamp: expect.any(Number),
        action: 'session_start',
        data: { sessionId, topic, startTime }
      });
    });

    it('should log activity correctly', () => {
      const action = 'test_action';
      const data = { key: 'value' };

      orchestrator.logActivity(action, data);

      expect(orchestrator.researchState.activityLog).toContainEqual({
        timestamp: expect.any(Number),
        action,
        data
      });
    });

    it('should reset research state', () => {
      // Set up some state
      orchestrator.researchState.sessionId = 'test';
      orchestrator.researchState.currentDepth = 2;
      orchestrator.researchState.visitedUrls.add('https://example.com');
      orchestrator.researchState.researchFindings.push({ title: 'test' });

      orchestrator.resetResearchState();

      expect(orchestrator.researchState.sessionId).toBeNull();
      expect(orchestrator.researchState.currentDepth).toBe(0);
      expect(orchestrator.researchState.visitedUrls.size).toBe(0);
      expect(orchestrator.researchState.researchFindings).toEqual([]);
    });
  });

  describe('Query Expansion', () => {
    it('should expand research topics effectively', async () => {
      const topic = "Machine Learning in healthcare";
      
      const expandedQueries = await orchestrator.expandResearchTopic(topic);
      
      expect(expandedQueries).toBeInstanceOf(Array);
      expect(expandedQueries.length).toBeGreaterThan(1);
      expect(expandedQueries).toContain(topic); // Should include original
      expect(expandedQueries.some(query => query.includes('ML'))).toBe(true);
      expect(expandedQueries.some(query => query.includes('medical'))).toBe(true);
    });

    it('should handle short topics', async () => {
      const topic = "AI";
      
      const expandedQueries = await orchestrator.expandResearchTopic(topic);
      
      expect(expandedQueries).toBeInstanceOf(Array);
      expect(expandedQueries).toContain(topic);
      expect(expandedQueries.some(query => query.includes('artificial intelligence'))).toBe(true);
    });

    it('should limit query expansion count', async () => {
      const topic = "Very complex machine learning algorithmic approaches in healthcare applications";
      
      const expandedQueries = await orchestrator.expandResearchTopic(topic);
      
      expect(expandedQueries.length).toBeLessThanOrEqual(10); // Default max queries
    });
  });

  describe('Information Gathering', () => {
    beforeEach(() => {
      mockSearchTool.execute.mockResolvedValue({
        results: sampleSearchResults,
        totalResults: sampleSearchResults.length,
        searchQuery: sampleResearchTopic
      });
    });

    it('should gather initial sources from expanded queries', async () => {
      const queries = [sampleResearchTopic, "ML healthcare applications"];
      const options = { maxResults: 20 };

      const sources = await orchestrator.gatherInitialSources(queries, options);

      expect(mockSearchTool.execute).toHaveBeenCalled();
      expect(sources).toBeInstanceOf(Array);
      expect(sources.length).toBeGreaterThan(0);
      expect(sources[0]).toHaveProperty('url');
      expect(sources[0]).toHaveProperty('title');
      expect(sources[0]).toHaveProperty('credibilityScore');
    });

    it('should handle search errors gracefully', async () => {
      mockSearchTool.execute.mockRejectedValue(new Error('Search API error'));
      
      const queries = [sampleResearchTopic];
      const sources = await orchestrator.gatherInitialSources(queries, {});

      expect(sources).toEqual([]);
      expect(orchestrator.metrics.searchQueries).toBe(1);
    });

    it('should deduplicate search results', async () => {
      const duplicateResults = [
        ...sampleSearchResults,
        sampleSearchResults[0] // Duplicate
      ];
      
      mockSearchTool.execute.mockResolvedValue({
        results: duplicateResults,
        totalResults: duplicateResults.length
      });

      const queries = [sampleResearchTopic];
      const sources = await orchestrator.gatherInitialSources(queries, {});

      expect(sources.length).toBe(sampleSearchResults.length); // No duplicates
    });
  });

  describe('Content Extraction and Processing', () => {
    beforeEach(() => {
      mockExtractTool.execute.mockResolvedValue(sampleExtractedContent);
      mockCrawlTool.execute.mockResolvedValue({
        results: [
          { url: 'https://example.com/related1', title: 'Related Article 1' },
          { url: 'https://example.com/related2', title: 'Related Article 2' }
        ]
      });
    });

    it('should perform deep content analysis', async () => {
      const sources = sampleSearchResults;
      
      const analysisResult = await orchestrator.performDeepContentAnalysis(sources);

      expect(mockExtractTool.execute).toHaveBeenCalled();
      expect(analysisResult).toHaveProperty('extractedContent');
      expect(analysisResult).toHaveProperty('relatedSources');
      expect(analysisResult.extractedContent.size).toBeGreaterThan(0);
    });

    it('should track processed URLs', async () => {
      const sources = sampleSearchResults.slice(0, 1);
      
      await orchestrator.performDeepContentAnalysis(sources);

      expect(orchestrator.researchState.visitedUrls.has(sources[0].url)).toBe(true);
      expect(orchestrator.metrics.urlsProcessed).toBe(1);
      expect(orchestrator.metrics.contentExtracted).toBe(1);
    });

    it('should handle extraction errors gracefully', async () => {
      mockExtractTool.execute.mockRejectedValue(new Error('Extraction failed'));
      
      const sources = sampleSearchResults.slice(0, 1);
      const result = await orchestrator.performDeepContentAnalysis(sources);

      expect(result.extractedContent.size).toBe(0);
      expect(orchestrator.researchState.visitedUrls.has(sources[0].url)).toBe(true); // Still marked as processed
    });

    it('should discover related sources through crawling', async () => {
      const sources = sampleSearchResults.slice(0, 1);
      
      const result = await orchestrator.performDeepContentAnalysis(sources);

      expect(mockCrawlTool.execute).toHaveBeenCalled();
      expect(result.relatedSources).toBeInstanceOf(Array);
      expect(result.relatedSources.length).toBe(2);
    });
  });

  describe('Source Verification', () => {
    it('should calculate credibility scores', () => {
      const source = {
        url: 'https://journal.nature.com/article',
        title: 'Peer-reviewed research on ML in healthcare',
        snippet: 'This study demonstrates...'
      };

      const score = orchestrator.calculateCredibilityScore(source);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
      expect(score).toBeGreaterThan(0.5); // Should be high for academic domain
    });

    it('should assign higher scores to academic domains', () => {
      const academicSource = {
        url: 'https://scholar.google.com/article',
        title: 'Research paper',
        snippet: 'Academic content'
      };
      
      const blogSource = {
        url: 'https://myblog.com/article',
        title: 'Blog post',
        snippet: 'Personal opinion'
      };

      const academicScore = orchestrator.calculateCredibilityScore(academicSource);
      const blogScore = orchestrator.calculateCredibilityScore(blogSource);

      expect(academicScore).toBeGreaterThan(blogScore);
    });

    it('should verify source authority', async () => {
      const sources = [
        { url: 'https://nature.com/article', credibilityScore: 0.9 },
        { url: 'https://randomblog.com/post', credibilityScore: 0.3 }
      ];

      const verifiedSources = await orchestrator.verifySourceAuthority(sources);

      expect(verifiedSources).toBeInstanceOf(Array);
      expect(verifiedSources[0].verified).toBe(true);
      expect(verifiedSources[1].verified).toBe(false);
      expect(orchestrator.metrics.sourcesVerified).toBe(2);
    });
  });

  describe('Conflict Detection', () => {
    it('should detect conflicting information', async () => {
      const contents = new Map([
        ['https://source1.com', 'Machine learning improves healthcare outcomes significantly.'],
        ['https://source2.com', 'Machine learning has no significant impact on healthcare.'],
        ['https://source3.com', 'ML shows promising results in healthcare applications.']
      ]);

      const conflicts = await orchestrator.detectInformationConflicts(contents);

      expect(conflicts).toBeInstanceOf(Array);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0]).toHaveProperty('conflictType');
      expect(conflicts[0]).toHaveProperty('sources');
      expect(conflicts[0]).toHaveProperty('severity');
      expect(orchestrator.metrics.conflictsDetected).toBeGreaterThan(0);
    });

    it('should calculate conflict severity', () => {
      const conflict = {
        sources: ['https://source1.com', 'https://source2.com'],
        contradictoryStatements: [
          'ML is very effective',
          'ML is not effective'
        ]
      };

      const severity = orchestrator.calculateConflictSeverity(conflict);

      expect(severity).toBeGreaterThanOrEqual(0);
      expect(severity).toBeLessThanOrEqual(1);
    });
  });

  describe('Full Research Workflow', () => {
    beforeEach(() => {
      // Setup comprehensive mocks for full workflow
      mockSearchTool.execute.mockResolvedValue({
        results: sampleSearchResults,
        totalResults: sampleSearchResults.length
      });
      
      mockExtractTool.execute.mockResolvedValue(sampleExtractedContent);
      
      mockCrawlTool.execute.mockResolvedValue({
        results: []
      });
      
      mockSummarizeTool.execute.mockResolvedValue({
        summary: 'Machine learning is transforming healthcare through various applications...',
        keyPoints: ['Improved diagnosis', 'Predictive analytics', 'Treatment optimization'],
        confidence: 0.8
      });
    });

    it('should conduct complete research workflow', async () => {
      const topic = sampleResearchTopic;
      const options = {
        maxDepth: 2,
        maxUrls: 10,
        timeLimit: 30000
      };

      const result = await orchestrator.conductResearch(topic, options);

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(result.topic).toBe(topic);
      expect(result.findings).toBeInstanceOf(Array);
      expect(result.summary).toBeDefined();
      expect(result.sources).toBeInstanceOf(Array);
      expect(result.credibilityAssessment).toBeDefined();
      expect(result.conflicts).toBeInstanceOf(Array);
      expect(result.metrics).toBeDefined();
    });

    it('should respect time limits', async () => {
      const startTime = Date.now();
      const timeLimit = 5000; // 5 seconds
      
      const result = await orchestrator.conductResearch(sampleResearchTopic, {
        timeLimit
      });

      const elapsedTime = Date.now() - startTime;
      expect(elapsedTime).toBeLessThan(timeLimit + 1000); // Allow 1s buffer
      expect(result.status).toBeDefined();
    });

    it('should handle research errors gracefully', async () => {
      mockSearchTool.execute.mockRejectedValue(new Error('Search failed'));
      
      const result = await orchestrator.conductResearch(sampleResearchTopic);

      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
      expect(result.partialResults).toBeDefined();
    });

    it('should generate comprehensive research report', async () => {
      const topic = sampleResearchTopic;
      
      const result = await orchestrator.conductResearch(topic);

      // Validate report structure
      expect(result).toMatchObject({
        sessionId: expect.any(String),
        topic: expect.any(String),
        status: expect.any(String),
        startTime: expect.any(Number),
        endTime: expect.any(Number),
        findings: expect.any(Array),
        summary: expect.any(Object),
        sources: expect.any(Array),
        credibilityAssessment: expect.any(Object),
        conflicts: expect.any(Array),
        metrics: expect.any(Object)
      });

      // Validate findings structure
      if (result.findings.length > 0) {
        expect(result.findings[0]).toMatchObject({
          title: expect.any(String),
          content: expect.any(String),
          sources: expect.any(Array),
          credibilityScore: expect.any(Number)
        });
      }
    });
  });

  describe('Performance and Limits', () => {
    it('should enforce URL limits', async () => {
      const manyResults = Array.from({ length: 50 }, (_, i) => ({
        title: `Result ${i}`,
        url: `https://example.com/page${i}`,
        snippet: `Content ${i}`,
        credibilityScore: 0.5
      }));

      mockSearchTool.execute.mockResolvedValue({
        results: manyResults,
        totalResults: manyResults.length
      });

      const result = await orchestrator.conductResearch(sampleResearchTopic, {
        maxUrls: 10
      });

      expect(orchestrator.metrics.urlsProcessed).toBeLessThanOrEqual(10);
    });

    it('should enforce depth limits', async () => {
      const result = await orchestrator.conductResearch(sampleResearchTopic, {
        maxDepth: 2
      });

      expect(orchestrator.researchState.currentDepth).toBeLessThanOrEqual(2);
    });

    it('should track performance metrics', async () => {
      await orchestrator.conductResearch(sampleResearchTopic);

      expect(orchestrator.metrics.searchQueries).toBeGreaterThanOrEqual(0);
      expect(orchestrator.metrics.urlsProcessed).toBeGreaterThanOrEqual(0);
      expect(orchestrator.metrics.totalProcessingTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Caching', () => {
    it('should cache research results', async () => {
      const topic = sampleResearchTopic;
      
      // First research
      const result1 = await orchestrator.conductResearch(topic);
      
      // Second research (should use cache)
      const result2 = await orchestrator.conductResearch(topic);

      expect(orchestrator.metrics.cacheHits).toBeGreaterThan(0);
    });

    it('should invalidate cache after TTL', async () => {
      const shortTTLOrchestrator = new ResearchOrchestrator({
        cacheEnabled: true,
        cacheTTL: 1000 // 1 second
      });

      const topic = sampleResearchTopic;
      await shortTTLOrchestrator.conductResearch(topic);
      
      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      await shortTTLOrchestrator.conductResearch(topic);

      // Should not have significant cache hits due to expiration
      expect(shortTTLOrchestrator.metrics.cacheHits).toBeLessThanOrEqual(1);
    });
  });

  describe('Event Emissions', () => {
    it('should emit research progress events', (done) => {
      let eventCount = 0;
      const expectedEvents = ['research_started', 'topic_expanded', 'sources_gathered'];
      
      expectedEvents.forEach(eventType => {
        orchestrator.on(eventType, () => {
          eventCount++;
          if (eventCount === expectedEvents.length) {
            done();
          }
        });
      });

      orchestrator.conductResearch(sampleResearchTopic);
    });

    it('should emit research completion event', (done) => {
      orchestrator.on('research_completed', (result) => {
        expect(result).toBeDefined();
        expect(result.sessionId).toBeDefined();
        done();
      });

      orchestrator.conductResearch(sampleResearchTopic);
    });
  });

  describe('Cleanup and Resource Management', () => {
    it('should cleanup resources properly', async () => {
      await orchestrator.cleanup();

      expect(orchestrator.researchState.sessionId).toBeNull();
      expect(orchestrator.activeMonitors?.size || 0).toBe(0);
    });

    it('should handle cleanup errors gracefully', async () => {
      // Mock cleanup error
      orchestrator.cache = {
        clear: jest.fn().mockRejectedValue(new Error('Cache clear failed'))
      };

      await expect(orchestrator.cleanup()).resolves.not.toThrow();
    });
  });

  describe('Integration with MCP Tools', () => {
    it('should pass correct parameters to search tool', async () => {
      await orchestrator.conductResearch(sampleResearchTopic);

      expect(mockSearchTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(String),
          maxResults: expect.any(Number)
        })
      );
    });

    it('should pass correct parameters to extract tool', async () => {
      await orchestrator.conductResearch(sampleResearchTopic);

      expect(mockExtractTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.any(String)
        })
      );
    });

    it('should handle tool execution failures', async () => {
      mockSearchTool.execute.mockRejectedValue(new Error('Tool failed'));
      
      const result = await orchestrator.conductResearch(sampleResearchTopic);

      expect(result.status).toBe('error');
      expect(result.partialResults).toBeDefined();
    });
  });
});
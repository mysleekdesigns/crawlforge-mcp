import { EventEmitter } from 'events';
import { SearchWebTool } from '../tools/search/searchWeb.js';
import { CrawlDeepTool } from '../tools/crawl/crawlDeep.js';
import { ExtractContentTool } from '../tools/extract/extractContent.js';
import { SummarizeContentTool } from '../tools/extract/summarizeContent.js';
import { QueryExpander } from '../tools/search/queryExpander.js';
import { ResultRanker } from '../tools/search/ranking/ResultRanker.js';
import { CacheManager } from './cache/CacheManager.js';
import { Logger } from '../utils/Logger.js';
import { LLMManager } from './llm/LLMManager.js';

/**
 * ResearchOrchestrator - Multi-stage research orchestration engine with LLM integration
 * Coordinates complex research workflows with intelligent query expansion,
 * source verification, information synthesis, and AI-powered analysis
 * 
 * Phase 2.1 Features:
 * - LLM-powered query expansion with semantic understanding
 * - AI-driven relevance scoring and content analysis
 * - Intelligent research synthesis with conflict detection
 * - Advanced provenance tracking and activity logging
 * - Smart URL prioritization based on content quality
 */
export class ResearchOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    const {
      maxDepth = 5,
      maxUrls = 100,
      timeLimit = 120000, // 2 minutes default
      concurrency = 5,
      enableSourceVerification = true,
      enableConflictDetection = true,
      cacheEnabled = true,
      cacheTTL = 1800000, // 30 minutes
      searchConfig = {},
      crawlConfig = {},
      extractConfig = {},
      summarizeConfig = {}
    } = options;

    this.maxDepth = Math.min(Math.max(1, maxDepth), 10);
    this.maxUrls = Math.min(Math.max(1, maxUrls), 1000);
    this.timeLimit = Math.min(Math.max(30000, timeLimit), 300000);
    this.concurrency = Math.min(Math.max(1, concurrency), 20);
    this.enableSourceVerification = enableSourceVerification;
    this.enableConflictDetection = enableConflictDetection;

    // Initialize tools
    this.searchTool = new SearchWebTool(searchConfig);
    this.crawlTool = new CrawlDeepTool(crawlConfig);
    this.extractTool = new ExtractContentTool(extractConfig);
    this.summarizeTool = new SummarizeContentTool(summarizeConfig);
    
    // Initialize utilities
    this.queryExpander = new QueryExpander();
    this.resultRanker = new ResultRanker();
    this.cache = cacheEnabled ? new CacheManager({ ttl: cacheTTL }) : null;
    this.logger = new Logger({ component: 'ResearchOrchestrator' });
    
    // Initialize LLM Manager for AI-powered research
    this.llmManager = new LLMManager(options.llmConfig || {});
    this.enableLLMFeatures = this.llmManager.isAvailable();
    
    if (this.enableLLMFeatures) {
      this.logger.info('LLM-powered research features enabled');
    } else {
      this.logger.warn('LLM providers not available, using fallback methods');
    }

    // Research state tracking
    this.researchState = {
      sessionId: null,
      startTime: null,
      currentDepth: 0,
      visitedUrls: new Set(),
      searchResults: new Map(),
      extractedContent: new Map(),
      researchFindings: [],
      credibilityScores: new Map(),
      conflictMap: new Map(),
      activityLog: [],
      llmAnalysis: new Map(),
      semanticSimilarities: new Map(),
      relevanceScores: new Map(),
      synthesisHistory: []
    };

    // Performance metrics
    this.metrics = {
      searchQueries: 0,
      urlsProcessed: 0,
      contentExtracted: 0,
      conflictsDetected: 0,
      sourcesVerified: 0,
      cacheHits: 0,
      totalProcessingTime: 0,
      llmAnalysisCalls: 0,
      semanticAnalysisTime: 0,
      queryExpansionTime: 0,
      synthesisTime: 0
    };
  }

  /**
   * Conduct comprehensive deep research on a topic
   * @param {string} topic - The research topic/question
   * @param {Object} options - Research configuration options
   * @returns {Promise<Object>} Research results
   */
  async conductResearch(topic, options = {}) {
    const sessionId = this.generateSessionId();
    const startTime = Date.now();
    
    this.initializeResearchSession(sessionId, topic, startTime);
    
    try {
      this.logger.info('Starting deep research', { sessionId, topic, options });
      
      // Stage 1: Initial topic exploration and query expansion
      const expandedQueries = await this.expandResearchTopic(topic);
      this.logActivity('topic_expansion', { originalTopic: topic, expandedQueries });

      // Stage 2: Broad information gathering
      const initialSources = await this.gatherInitialSources(expandedQueries, options);
      this.logActivity('initial_gathering', { sourcesFound: initialSources.length });

      // Stage 3: Deep exploration of promising sources
      const detailedFindings = await this.exploreSourcesInDepth(initialSources, options);
      this.logActivity('deep_exploration', { findingsCount: detailedFindings.length });

      // Stage 4: Source credibility assessment
      const verifiedSources = this.enableSourceVerification ? 
        await this.verifySourceCredibility(detailedFindings) : detailedFindings;
      this.logActivity('source_verification', { verifiedCount: verifiedSources.length });

      // Stage 5: Information synthesis and conflict detection
      const synthesizedResults = await this.synthesizeInformation(verifiedSources, topic);
      this.logActivity('information_synthesis', { conflictsFound: synthesizedResults.conflicts.length });

      // Stage 6: Final result compilation
      const finalResults = this.compileResearchResults(topic, synthesizedResults, options);
      
      const totalTime = Date.now() - startTime;
      this.metrics.totalProcessingTime = totalTime;
      
      this.logger.info('Research completed', { 
        sessionId, 
        duration: totalTime, 
        findings: finalResults.findings.length 
      });

      this.emit('researchCompleted', {
        sessionId,
        topic,
        duration: totalTime,
        findings: finalResults.findings.length
      });

      return finalResults;

    } catch (error) {
      this.logger.error('Research failed', { sessionId, error: error.message });
      this.emit('researchFailed', { sessionId, topic, error: error.message });
      
      return this.handleResearchError(error, topic, sessionId);
    }
  }

  /**
   * Initialize research session state
   */
  initializeResearchSession(sessionId, topic, startTime) {
    this.researchState = {
      sessionId,
      topic,
      startTime,
      currentDepth: 0,
      visitedUrls: new Set(),
      searchResults: new Map(),
      extractedContent: new Map(),
      researchFindings: [],
      credibilityScores: new Map(),
      conflictMap: new Map(),
      activityLog: []
    };

    // Reset metrics
    Object.keys(this.metrics).forEach(key => {
      this.metrics[key] = 0;
    });
  }

  /**
   * Expand research topic into multiple targeted queries with LLM enhancement
   */
  async expandResearchTopic(topic) {
    const startTime = Date.now();
    
    try {
      const cacheKey = this.cache ? this.cache.generateKey('topic_expansion_v2', { topic, llm: this.enableLLMFeatures }) : null;
      
      if (this.cache && cacheKey) {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          this.metrics.cacheHits++;
          return cached;
        }
      }

      let expandedQueries = [];
      
      // LLM-powered query expansion (preferred)
      if (this.enableLLMFeatures) {
        try {
          this.logger.info('Using LLM for intelligent query expansion');
          expandedQueries = await this.llmManager.expandQuery(topic, {
            maxExpansions: 8,
            includeContextual: true,
            includeSynonyms: true,
            includeRelated: true
          });
          this.metrics.llmAnalysisCalls++;
        } catch (llmError) {
          this.logger.warn('LLM query expansion failed, falling back to traditional methods', { error: llmError.message });
        }
      }
      
      // Fallback to traditional expansion if LLM failed or unavailable
      if (expandedQueries.length === 0) {
        expandedQueries = await this.queryExpander.expandQuery(topic, {
          enableSynonyms: true,
          enableSpellCheck: true,
          enablePhraseDetection: true,
          maxExpansions: 8
        });
      }

      // Add research-specific query variations
      const researchVariations = this.generateResearchVariations(topic);
      const allQueries = [...new Set([topic, ...expandedQueries, ...researchVariations])];

      // Rank queries by research relevance with semantic understanding
      const rankedQueries = await this.rankResearchQueriesWithSemantics(allQueries, topic);

      if (this.cache && cacheKey) {
        await this.cache.set(cacheKey, rankedQueries);
      }
      
      this.metrics.queryExpansionTime += Date.now() - startTime;
      return rankedQueries;
    } catch (error) {
      this.logger.warn('Topic expansion failed, using original topic', { error: error.message });
      this.metrics.queryExpansionTime += Date.now() - startTime;
      return [topic];
    }
  }

  /**
   * Generate research-specific query variations
   */
  generateResearchVariations(topic) {
    const variations = [];
    
    // Question-based variations
    variations.push(`what is ${topic}`);
    variations.push(`how does ${topic} work`);
    variations.push(`${topic} explained`);
    variations.push(`${topic} research`);
    variations.push(`${topic} studies`);
    variations.push(`${topic} analysis`);
    
    // Academic and authoritative variations
    variations.push(`${topic} academic`);
    variations.push(`${topic} scientific`);
    variations.push(`${topic} research paper`);
    variations.push(`${topic} peer reviewed`);
    
    // Current and historical context
    variations.push(`latest ${topic}`);
    variations.push(`current ${topic}`);
    variations.push(`${topic} 2024`);
    variations.push(`${topic} trends`);
    
    return variations.slice(0, 10); // Limit variations
  }

  /**
   * Rank research queries by relevance and specificity with semantic analysis
   */
  async rankResearchQueriesWithSemantics(queries, originalTopic) {
    const startTime = Date.now();
    
    try {
      const scored = await Promise.all(queries.map(async (query) => {
        let score = 0.5; // Base score
        
        // Give original topic highest priority
        if (query === originalTopic) {
          return { query, score: 1.0 };
        }
        
        // Traditional scoring
        const topicWords = originalTopic.toLowerCase().split(" ");
        const queryWords = query.toLowerCase().split(" ");
        const overlap = topicWords.filter(word => queryWords.includes(word));
        score += (overlap.length / topicWords.length) * 0.3;
        
        // Research-oriented bonus
        const researchKeywords = ["research", "study", "analysis", "academic", "scientific"];
        if (researchKeywords.some(keyword => query.toLowerCase().includes(keyword))) {
          score += 0.2;
        }
        
        // Length preference
        if (query.length > 10 && query.length < 100) {
          score += 0.1;
        }
        
        // Semantic similarity boost (if LLM available)
        if (this.enableLLMFeatures) {
          try {
            const similarity = await this.llmManager.calculateSimilarity(originalTopic, query);
            score += similarity * 0.3; // Semantic similarity weight
            this.researchState.semanticSimilarities.set(query, similarity);
          } catch (semanticError) {
            this.logger.debug('Semantic similarity calculation failed', { query, error: semanticError.message });
          }
        }
        
        return { query, score };
      }));

      const sortedQueries = scored
        .sort((a, b) => b.score - a.score)
        .map(item => item.query);
      
      // Ensure original topic is always first
      const result = [originalTopic];
      sortedQueries.forEach(query => {
        if (query !== originalTopic && result.length < this.maxDepth) {
          result.push(query);
        }
      });
      
      this.metrics.semanticAnalysisTime += Date.now() - startTime;
      return result.slice(0, this.maxDepth);
    } catch (error) {
      this.logger.warn('Semantic ranking failed, using fallback', { error: error.message });
      return this.rankResearchQueries(queries, originalTopic);
    }
  }
  
  /**
   * Fallback ranking method (original implementation)
   */
  rankResearchQueries(queries, originalTopic) {
    const scored = queries.map(query => {
      let score = 0.5;
      
      if (query === originalTopic) {
        score = 1.0;
      } else {
        const topicWords = originalTopic.toLowerCase().split(" ");
        const queryWords = query.toLowerCase().split(" ");
        const overlap = topicWords.filter(word => queryWords.includes(word));
        score += (overlap.length / topicWords.length) * 0.3;
        
        const researchKeywords = ["research", "study", "analysis", "academic", "scientific"];
        if (researchKeywords.some(keyword => query.toLowerCase().includes(keyword))) {
          score += 0.2;
        }
        
        if (query.length > 10 && query.length < 100) {
          score += 0.1;
        }
      }
      
      return { query, score };
    });

    const sortedQueries = scored
      .sort((a, b) => b.score - a.score)
      .map(item => item.query);
    
    const result = [originalTopic];
    sortedQueries.forEach(query => {
      if (query !== originalTopic && result.length < this.maxDepth) {
        result.push(query);
      }
    });
    
    return result.slice(0, this.maxDepth);
  }
  /**
   * Gather initial sources using expanded queries
   */
  async gatherInitialSources(queries, options) {
    const allSources = [];
    const maxSourcesPerQuery = Math.ceil(this.maxUrls / queries.length);
    
    await this.processWithTimeLimit(async () => {
      const searchPromises = queries.slice(0, 5).map(async (query) => {
        try {
          this.metrics.searchQueries++;
          const searchResults = await this.searchTool.execute({
            query,
            limit: maxSourcesPerQuery,
            enable_ranking: true,
            enable_deduplication: true
          });

          if (searchResults.results && searchResults.results.length > 0) {
            const processedResults = searchResults.results.map(result => ({
              ...result,
              sourceQuery: query,
              discoveredAt: new Date().toISOString(),
              credibilityScore: this.calculateInitialCredibility(result),
              researchRelevance: this.calculateResearchRelevance(result, query)
            }));

            this.researchState.searchResults.set(query, processedResults);
            return processedResults;
          }
          return [];
        } catch (error) {
          this.logger.warn('Search failed for query', { query, error: error.message });
          return [];
        }
      });

      const results = await Promise.all(searchPromises);
      results.forEach(sources => allSources.push(...sources));
    });

    // Deduplicate and rank sources
    const uniqueSources = this.deduplicateSources(allSources);
    const rankedSources = await this.rankSourcesByResearchValue(uniqueSources);
    
    return rankedSources.slice(0, this.maxUrls);
  }

  /**
   * Explore promising sources in depth with LLM-powered relevance analysis
   */
  async exploreSourcesInDepth(sources, options) {
    const detailedFindings = [];
    const batchSize = Math.min(this.concurrency, 10);
    const { topic } = this.researchState;
    
    await this.processWithTimeLimit(async () => {
      for (let i = 0; i < sources.length; i += batchSize) {
        const batch = sources.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (source) => {
          try {
            if (this.researchState.visitedUrls.has(source.link)) {
              return null;
            }
            
            this.researchState.visitedUrls.add(source.link);
            this.metrics.urlsProcessed++;

            // Extract detailed content
            const contentData = await this.extractTool.execute({
              url: source.link,
              options: { includeMetadata: true, includeStructuredData: true }
            });

            if (contentData && contentData.content) {
              this.metrics.contentExtracted++;
              
              // Enhance source with extracted content
              let enhancedSource = {
                ...source,
                extractedContent: contentData.content,
                metadata: contentData.metadata,
                structuredData: contentData.structuredData,
                extractedAt: new Date().toISOString(),
                wordCount: contentData.content.split(' ').length,
                readabilityScore: this.calculateReadabilityScore(contentData.content)
              };

              // LLM-powered relevance analysis
              if (this.enableLLMFeatures && topic) {
                try {
                  const relevanceAnalysis = await this.llmManager.analyzeRelevance(
                    contentData.content, 
                    topic,
                    { maxContentLength: 2000 }
                  );
                  
                  enhancedSource.llmAnalysis = relevanceAnalysis;
                  enhancedSource.relevanceScore = relevanceAnalysis.relevanceScore;
                  this.researchState.llmAnalysis.set(source.link, relevanceAnalysis);
                  this.researchState.relevanceScores.set(source.link, relevanceAnalysis.relevanceScore);
                  this.metrics.llmAnalysisCalls++;
                  
                  this.logger.debug('LLM relevance analysis completed', {
                    url: source.link,
                    relevanceScore: relevanceAnalysis.relevanceScore,
                    keyPoints: relevanceAnalysis.keyPoints.length
                  });
                } catch (llmError) {
                  this.logger.warn('LLM relevance analysis failed', { 
                    url: source.link, 
                    error: llmError.message 
                  });
                  // Set default relevance score
                  enhancedSource.relevanceScore = this.calculateTraditionalRelevance(contentData.content, topic);
                }
              } else {
                // Fallback relevance calculation
                enhancedSource.relevanceScore = this.calculateTraditionalRelevance(contentData.content, topic);
              }

              this.researchState.extractedContent.set(source.link, enhancedSource);
              return enhancedSource;
            }
            return null;
          } catch (error) {
            this.logger.warn('Content extraction failed', { 
              url: source.link, 
              error: error.message 
            });
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter(result => result !== null);
        detailedFindings.push(...validResults);
      }
    });

    // Sort by relevance score (LLM or traditional)
    return detailedFindings.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }

  /**
   * Verify source credibility using multiple factors
   */
  async verifySourceCredibility(sources) {
    const verifiedSources = [];
    
    for (const source of sources) {
      try {
        this.metrics.sourcesVerified++;
        
        const credibilityFactors = {
          domainAuthority: this.assessDomainAuthority(source.link),
          contentQuality: this.assessContentQuality(source),
          sourceType: this.identifySourceType(source),
          recency: this.assessContentRecency(source),
          authorityIndicators: this.findAuthorityIndicators(source),
          citationPotential: this.assessCitationPotential(source)
        };

        const overallCredibility = this.calculateOverallCredibility(credibilityFactors);
        
        // Only include sources that meet minimum credibility threshold
        if (overallCredibility >= 0.3) {
          verifiedSources.push({
            ...source,
            credibilityFactors,
            overallCredibility,
            verifiedAt: new Date().toISOString()
          });
          
          this.researchState.credibilityScores.set(source.link, overallCredibility);
        }
      } catch (error) {
        this.logger.warn('Credibility verification failed', {
          url: source.link,
          error: error.message
        });
      }
    }

    return verifiedSources.sort((a, b) => b.overallCredibility - a.overallCredibility);
  }

  /**
   * Synthesize information and detect conflicts with LLM enhancement
   */
  async synthesizeInformation(sources, topic) {
    const startTime = Date.now();
    const synthesis = {
      keyFindings: [],
      supportingEvidence: [],
      conflicts: [],
      consensus: [],
      gaps: [],
      recommendations: [],
      llmSynthesis: null
    };

    try {
      // Extract key claims and facts from each source
      const extractedClaims = await this.extractKeyClaims(sources);
      
      // Group related claims
      const claimGroups = this.groupRelatedClaims(extractedClaims);
      
      // Detect conflicts between claims
      if (this.enableConflictDetection) {
        synthesis.conflicts = this.detectInformationConflicts(claimGroups);
        this.metrics.conflictsDetected = synthesis.conflicts.length;
      }
      
      // Identify consensus areas
      synthesis.consensus = this.identifyConsensus(claimGroups);
      
      // Generate key findings
      synthesis.keyFindings = this.generateKeyFindings(claimGroups, sources);
      
      // Compile supporting evidence
      synthesis.supportingEvidence = this.compileSupportingEvidence(sources);
      
      // Identify research gaps
      synthesis.gaps = this.identifyResearchGaps(claimGroups, topic);
      
      // Generate recommendations
      synthesis.recommendations = this.generateResearchRecommendations(synthesis, topic);

      // LLM-powered comprehensive synthesis
      if (this.enableLLMFeatures && sources.length > 0) {
        try {
          this.logger.info('Generating LLM-powered research synthesis');
          
          // Prepare findings for LLM analysis
          const findingsForLLM = synthesis.keyFindings.map(finding => ({
            finding: finding.finding,
            credibility: finding.credibility,
            sources: finding.sources.length
          }));

          const llmSynthesis = await this.llmManager.synthesizeFindings(
            findingsForLLM,
            topic,
            { 
              maxFindings: 10, 
              includeConflicts: synthesis.conflicts.length > 0 
            }
          );

          synthesis.llmSynthesis = llmSynthesis;
          this.researchState.synthesisHistory.push({
            timestamp: new Date().toISOString(),
            topic,
            synthesis: llmSynthesis,
            sourceCount: sources.length
          });

          this.metrics.llmAnalysisCalls++;
          this.logger.info('LLM synthesis completed', {
            confidence: llmSynthesis.confidence,
            insights: llmSynthesis.keyInsights?.length || 0,
            themes: llmSynthesis.themes?.length || 0
          });

        } catch (llmError) {
          this.logger.warn('LLM synthesis failed', { error: llmError.message });
          synthesis.llmSynthesis = {
            error: 'LLM synthesis unavailable',
            fallback: true
          };
        }
      }

    } catch (error) {
      this.logger.error('Information synthesis failed', { error: error.message });
      synthesis.error = error.message;
    }

    this.metrics.synthesisTime += Date.now() - startTime;
    return synthesis;
  }

  /**
   * Extract key claims from source content
   */
  async extractKeyClaims(sources) {
    const claims = [];
    
    for (const source of sources) {
      try {
        if (!source.extractedContent) continue;
        
        const content = source.extractedContent.substring(0, 5000); // Limit content length
        
        // Use summarization to extract key points
        const summary = await this.summarizeTool.execute({
          text: content,
          options: {
            maxLength: 500,
            extractKeyPoints: true,
            includeSupporting: true
          }
        });

        if (summary.keyPoints) {
          summary.keyPoints.forEach((point, index) => {
            claims.push({
              id: `${source.link}_claim_${index}`,
              claim: point,
              source: source.link,
              sourceTitle: source.title,
              credibility: source.overallCredibility || 0.5,
              context: summary.supporting?.[index] || '',
              extractedAt: new Date().toISOString()
            });
          });
        }
      } catch (error) {
        this.logger.warn('Claim extraction failed', {
          source: source.link,
          error: error.message
        });
      }
    }

    return claims;
  }

  /**
   * Group related claims for analysis
   */
  groupRelatedClaims(claims) {
    const groups = new Map();
    
    for (const claim of claims) {
      const keywords = this.extractKeywords(claim.claim);
      const groupKey = keywords.slice(0, 3).sort().join('_');
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          id: groupKey,
          keywords,
          claims: [],
          avgCredibility: 0,
          sourceCount: 0
        });
      }
      
      groups.get(groupKey).claims.push(claim);
    }

    // Calculate group statistics
    groups.forEach(group => {
      group.sourceCount = new Set(group.claims.map(c => c.source)).size;
      group.avgCredibility = group.claims.reduce((sum, c) => sum + c.credibility, 0) / group.claims.length;
    });

    return Array.from(groups.values());
  }

  /**
   * Detect conflicts between information claims
   */
  detectInformationConflicts(claimGroups) {
    const conflicts = [];
    
    for (const group of claimGroups) {
      if (group.claims.length < 2) continue;
      
      // Simple conflict detection based on contradictory terms
      const conflictIndicators = [
        ['not', 'is'], ['false', 'true'], ['incorrect', 'correct'],
        ['impossible', 'possible'], ['never', 'always'], ['no', 'yes']
      ];
      
      for (let i = 0; i < group.claims.length; i++) {
        for (let j = i + 1; j < group.claims.length; j++) {
          const claim1 = group.claims[i];
          const claim2 = group.claims[j];
          
          const text1 = claim1.claim.toLowerCase();
          const text2 = claim2.claim.toLowerCase();
          
          for (const [neg, pos] of conflictIndicators) {
            if ((text1.includes(neg) && text2.includes(pos)) ||
                (text1.includes(pos) && text2.includes(neg))) {
              
              conflicts.push({
                id: `conflict_${conflicts.length}`,
                type: 'contradiction',
                claim1: claim1,
                claim2: claim2,
                severity: this.calculateConflictSeverity(claim1, claim2),
                detectedAt: new Date().toISOString()
              });
              
              break;
            }
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Identify areas of consensus
   */
  identifyConsensus(claimGroups) {
    return claimGroups
      .filter(group => group.sourceCount >= 2 && group.avgCredibility >= 0.6)
      .map(group => ({
        topic: group.keywords.join(' '),
        supportingClaims: group.claims.length,
        supportingSources: group.sourceCount,
        averageCredibility: group.avgCredibility,
        consensusStrength: this.calculateConsensusStrength(group)
      }))
      .sort((a, b) => b.consensusStrength - a.consensusStrength);
  }

  /**
   * Calculate various scoring functions
   */
  calculateInitialCredibility(source) {
    let score = 0.5;
    
    // Domain-based scoring
    try {
      const domain = new URL(source.link).hostname;
      if (domain.includes('edu')) score += 0.3;
      else if (domain.includes('gov')) score += 0.4;
      else if (domain.includes('org')) score += 0.2;
    } catch {}
    
    // Content indicators
    if (source.snippet) {
      const snippet = source.snippet.toLowerCase();
      if (snippet.includes('research') || snippet.includes('study')) score += 0.1;
      if (snippet.includes('peer reviewed')) score += 0.2;
    }
    
    return Math.min(1, score);
  }

  calculateResearchRelevance(result, query) {
    let relevance = 0.5;
    
    const title = (result.title || '').toLowerCase();
    const snippet = (result.snippet || '').toLowerCase();
    const queryLower = query.toLowerCase();
    
    // Title relevance
    if (title.includes(queryLower)) relevance += 0.3;
    
    // Snippet relevance
    if (snippet.includes(queryLower)) relevance += 0.2;
    
    return Math.min(1, relevance);
  }

  calculateReadabilityScore(content) {
    if (!content) return 0.5;
    
    const words = content.split(' ').length;
    const sentences = content.split(/[.!?]/).length;
    const avgWordsPerSentence = words / Math.max(sentences, 1);
    
    // Simple readability approximation
    if (avgWordsPerSentence < 15) return 0.8; // Easy to read
    if (avgWordsPerSentence < 20) return 0.6; // Moderate
    return 0.4; // Difficult
  }

  calculateOverallCredibility(factors) {
    const weights = {
      domainAuthority: 0.3,
      contentQuality: 0.25,
      sourceType: 0.2,
      recency: 0.1,
      authorityIndicators: 0.1,
      citationPotential: 0.05
    };
    
    let score = 0;
    Object.entries(weights).forEach(([factor, weight]) => {
      score += (factors[factor] || 0.5) * weight;
    });
    
    return Math.min(1, Math.max(0, score));
  }

  calculateConflictSeverity(claim1, claim2) {
    const credibilityDiff = Math.abs(claim1.credibility - claim2.credibility);
    return 0.5 + (credibilityDiff * 0.5);
  }

  calculateConsensusStrength(group) {
    return (group.sourceCount * 0.4) + (group.avgCredibility * 0.6);
  }

  /**
   * Utility functions
   */
  assessDomainAuthority(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      
      // High authority domains
      if (domain.includes('edu') || domain.includes('gov')) return 0.9;
      if (domain.includes('org')) return 0.7;
      if (['wikipedia.org', 'pubmed.ncbi.nlm.nih.gov'].includes(domain)) return 0.8;
      
      return 0.5;
    } catch {
      return 0.3;
    }
  }

  assessContentQuality(source) {
    let score = 0.5;
    
    if (source.wordCount > 500) score += 0.2;
    if (source.readabilityScore > 0.6) score += 0.1;
    if (source.metadata?.author) score += 0.1;
    if (source.structuredData) score += 0.1;
    
    return Math.min(1, score);
  }

  identifySourceType(source) {
    const content = (source.extractedContent || '').toLowerCase();
    const title = (source.title || '').toLowerCase();
    
    if (content.includes('abstract') || content.includes('methodology')) return 0.9;
    if (title.includes('research') || title.includes('study')) return 0.8;
    if (content.includes('peer reviewed')) return 0.9;
    if (title.includes('news') || title.includes('blog')) return 0.4;
    
    return 0.6;
  }

  assessContentRecency(source) {
    // Simple recency assessment - would need better date extraction in real implementation
    return 0.6; // Neutral score
  }

  findAuthorityIndicators(source) {
    let score = 0.5;
    const content = (source.extractedContent || '').toLowerCase();
    
    if (content.includes('citation') || content.includes('reference')) score += 0.2;
    if (content.includes('doi:')) score += 0.2;
    if (source.metadata?.author) score += 0.1;
    
    return Math.min(1, score);
  }

  assessCitationPotential(source) {
    let score = 0.5;
    
    if (source.metadata?.doi) score += 0.3;
    if (source.structuredData?.citations) score += 0.2;
    
    return Math.min(1, score);
  }

  extractKeywords(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 10);
  }

  /**
   * Calculate traditional relevance score without LLM
   */
  calculateTraditionalRelevance(content, topic) {
    if (!content || !topic) return 0.5;
    
    const topicWords = topic.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    const contentLower = content.toLowerCase();
    
    let matches = 0;
    let totalWeight = 0;
    
    topicWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      const wordMatches = (contentLower.match(regex) || []).length;
      matches += wordMatches;
      totalWeight += word.length * wordMatches; // Weight by word importance
    });
    
    // Calculate relevance based on keyword density and content length
    const contentWords = content.split(/\s+/).length;
    const density = matches / Math.max(contentWords, 1);
    const coverage = matches / Math.max(topicWords.length, 1);
    
    // Combine density and coverage with weights
    const relevanceScore = (density * 0.4) + (coverage * 0.6);
    
    return Math.min(1, Math.max(0, relevanceScore));
  }

  /**
   * Utility methods for research workflow
   */
  async processWithTimeLimit(asyncFunction) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Research time limit exceeded')), this.timeLimit);
    });

    try {
      await Promise.race([asyncFunction(), timeoutPromise]);
    } catch (error) {
      if (error.message === 'Research time limit exceeded') {
        this.logger.warn('Research time limit reached, returning partial results');
      } else {
        throw error;
      }
    }
  }

  deduplicateSources(sources) {
    const seen = new Set();
    return sources.filter(source => {
      const key = source.link;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async rankSourcesByResearchValue(sources) {
    return sources.sort((a, b) => {
      const scoreA = (a.credibilityScore || 0) + (a.researchRelevance || 0);
      const scoreB = (b.credibilityScore || 0) + (b.researchRelevance || 0);
      return scoreB - scoreA;
    });
  }

  generateKeyFindings(claimGroups, sources) {
    return claimGroups
      .filter(group => group.avgCredibility >= 0.6)
      .sort((a, b) => b.consensusStrength - a.consensusStrength)
      .slice(0, 10)
      .map(group => ({
        finding: group.keywords.join(' '),
        supportingClaims: group.claims.length,
        credibility: group.avgCredibility,
        sources: group.claims.map(c => c.source)
      }));
  }

  compileSupportingEvidence(sources) {
    return sources
      .filter(source => source.overallCredibility >= 0.7)
      .map(source => ({
        title: source.title,
        url: source.link,
        credibility: source.overallCredibility,
        evidence: source.extractedContent?.substring(0, 300) + '...'
      }))
      .slice(0, 15);
  }

  identifyResearchGaps(claimGroups, topic) {
    const gaps = [];
    
    // Identify areas with low claim count or credibility
    const weakAreas = claimGroups.filter(group => 
      group.claims.length < 2 || group.avgCredibility < 0.5
    );
    
    weakAreas.forEach(area => {
      gaps.push({
        area: area.keywords.join(' '),
        issue: 'Limited reliable sources',
        suggestion: `More research needed on ${area.keywords.join(' ')} related to ${topic}`
      });
    });
    
    return gaps.slice(0, 5);
  }

  generateResearchRecommendations(synthesis, topic) {
    const recommendations = [];
    
    if (synthesis.conflicts.length > 0) {
      recommendations.push({
        type: 'conflict_resolution',
        priority: 'high',
        description: `Investigate ${synthesis.conflicts.length} conflicting claims about ${topic}`
      });
    }
    
    if (synthesis.gaps.length > 0) {
      recommendations.push({
        type: 'gap_filling',
        priority: 'medium',
        description: `Address research gaps in ${synthesis.gaps.map(g => g.area).join(', ')}`
      });
    }
    
    recommendations.push({
      type: 'validation',
      priority: 'medium',
      description: `Validate findings with additional peer-reviewed sources`
    });
    
    return recommendations;
  }

  compileResearchResults(topic, synthesis, options) {
    const baseResults = {
      sessionId: this.researchState.sessionId,
      topic,
      researchSummary: {
        totalSources: this.metrics.urlsProcessed,
        verifiedSources: this.metrics.sourcesVerified,
        keyFindings: synthesis.keyFindings.length,
        conflictsFound: synthesis.conflicts.length,
        consensusAreas: synthesis.consensus.length,
        llmEnhanced: this.enableLLMFeatures
      },
      findings: synthesis.keyFindings,
      supportingEvidence: synthesis.supportingEvidence,
      consensus: synthesis.consensus,
      conflicts: synthesis.conflicts,
      researchGaps: synthesis.gaps,
      recommendations: synthesis.recommendations,
      credibilityAssessment: {
        highCredibilitySources: Array.from(this.researchState.credibilityScores.entries())
          .filter(([_, score]) => score >= 0.7)
          .length,
        averageCredibility: this.calculateAverageCredibility(),
        credibilityDistribution: this.getCredibilityDistribution()
      },
      activityLog: this.researchState.activityLog,
      performance: {
        ...this.metrics,
        timeLimit: this.timeLimit,
        completedWithinLimit: this.metrics.totalProcessingTime < this.timeLimit
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        researchDepth: this.researchState.currentDepth,
        configuration: {
          maxDepth: this.maxDepth,
          maxUrls: this.maxUrls,
          timeLimit: this.timeLimit,
          llmEnabled: this.enableLLMFeatures
        }
      }
    };

    // Add LLM-specific analysis if available
    if (this.enableLLMFeatures) {
      baseResults.llmAnalysis = {
        synthesis: synthesis.llmSynthesis,
        relevanceScores: Object.fromEntries(this.researchState.relevanceScores),
        semanticSimilarities: Object.fromEntries(this.researchState.semanticSimilarities),
        analysisHistory: this.researchState.synthesisHistory,
        llmMetrics: {
          totalLLMCalls: this.metrics.llmAnalysisCalls,
          semanticAnalysisTime: this.metrics.semanticAnalysisTime,
          queryExpansionTime: this.metrics.queryExpansionTime,
          synthesisTime: this.metrics.synthesisTime
        }
      };

      // Enhanced insights from LLM synthesis
      if (synthesis.llmSynthesis && !synthesis.llmSynthesis.error) {
        baseResults.insights = {
          aiSummary: synthesis.llmSynthesis.summary,
          keyThemes: synthesis.llmSynthesis.themes,
          confidenceLevel: synthesis.llmSynthesis.confidence,
          intelligentInsights: synthesis.llmSynthesis.keyInsights,
          aiRecommendations: synthesis.llmSynthesis.recommendations,
          identifiedGaps: synthesis.llmSynthesis.gaps
        };
      }

      // Provenance tracking for LLM-enhanced sources
      baseResults.provenance = {
        sourceAnalysis: Array.from(this.researchState.llmAnalysis.entries()).map(([url, analysis]) => ({
          url,
          relevanceScore: analysis.relevanceScore,
          keyPoints: analysis.keyPoints,
          topicAlignment: analysis.topicAlignment,
          credibilityIndicators: analysis.credibilityIndicators
        })),
        queryExpansion: this.researchState.semanticSimilarities.size > 0 ? 
          Object.fromEntries(this.researchState.semanticSimilarities) : null,
        totalAnalyzedSources: this.researchState.llmAnalysis.size
      };
    }

    return baseResults;
  }

  handleResearchError(error, topic, sessionId) {
    return {
      sessionId,
      topic,
      error: error.message,
      partialResults: {
        visitedUrls: Array.from(this.researchState.visitedUrls),
        activityLog: this.researchState.activityLog,
        metrics: this.metrics
      },
      recommendations: [{
        type: 'error_recovery',
        priority: 'high',
        description: 'Retry research with reduced scope or increased time limit'
      }],
      generatedAt: new Date().toISOString()
    };
  }

  calculateAverageCredibility() {
    const scores = Array.from(this.researchState.credibilityScores.values());
    return scores.length > 0 ? 
      scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  }

  getCredibilityDistribution() {
    const scores = Array.from(this.researchState.credibilityScores.values());
    const high = scores.filter(s => s >= 0.7).length;
    const medium = scores.filter(s => s >= 0.4 && s < 0.7).length;
    const low = scores.filter(s => s < 0.4).length;
    
    return { high, medium, low };
  }

  logActivity(type, data) {
    const activity = {
      type,
      timestamp: new Date().toISOString(),
      data
    };
    
    this.researchState.activityLog.push(activity);
    this.emit('activityLogged', activity);
  }

  generateSessionId() {
    return `research_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  // Public API methods for monitoring and control
  getResearchState() {
    return { ...this.researchState };
  }

  getMetrics() {
    return { ...this.metrics };
  }

  pauseResearch() {
    this.emit('researchPaused', { sessionId: this.researchState.sessionId });
  }

  resumeResearch() {
    this.emit('researchResumed', { sessionId: this.researchState.sessionId });
  }

  stopResearch() {
    this.emit('researchStopped', { sessionId: this.researchState.sessionId });
  }

  /**
   * Cleanup method for proper resource disposal
   */
  async cleanup() {
    try {
      // Stop any active research
      this.stopResearch();
      
      // Clear cache if available
      if (this.cache && typeof this.cache.clear === "function") {
        await this.cache.clear();
      }
      
      // Clear all event listeners
      this.removeAllListeners();
      
      // Reset research state
      this.researchState = {
        sessionId: null,
        currentDepth: 0,
        visitedUrls: new Set(),
        searchResults: new Map(),
        extractedContent: new Map(),
        researchFindings: [],
        credibilityScores: new Map(),
        conflictMap: new Map(),
        activityLog: [],
        llmAnalysis: new Map(),
        semanticSimilarities: new Map(),
        relevanceScores: new Map(),
        synthesisHistory: []
      };
      
      // Reset metrics
      this.metrics = {
        searchQueries: 0,
        urlsProcessed: 0,
        contentExtracted: 0,
        conflictsDetected: 0,
        sourcesVerified: 0,
        cacheHits: 0,
        totalProcessingTime: 0,
        llmAnalysisCalls: 0,
        semanticAnalysisTime: 0,
        queryExpansionTime: 0,
        synthesisTime: 0
      };
      
    } catch (error) {
      // Silent cleanup - do not throw errors during cleanup
      console.warn("Warning during ResearchOrchestrator cleanup:", error.message);
    }
  }
}


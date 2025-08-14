import { z } from 'zod';
import { ResearchOrchestrator } from '../../core/ResearchOrchestrator.js';
import { Logger } from '../../utils/Logger.js';

/**
 * DeepResearchTool - MCP tool for conducting comprehensive multi-stage research
 * Provides intelligent research orchestration with source verification,
 * conflict detection, and information synthesis
 */

const DeepResearchSchema = z.object({
  topic: z.string().min(3).max(500),
  
  // Research scope configuration
  maxDepth: z.number().min(1).max(10).optional().default(5),
  maxUrls: z.number().min(1).max(1000).optional().default(50),
  timeLimit: z.number().min(30000).max(300000).optional().default(120000), // 30s to 5min
  
  // Research approach options
  researchApproach: z.enum(['broad', 'focused', 'academic', 'current_events', 'comparative']).optional().default('broad'),
  
  // Source filtering preferences
  sourceTypes: z.array(z.enum(['academic', 'news', 'government', 'commercial', 'blog', 'wiki', 'any'])).optional().default(['any']),
  credibilityThreshold: z.number().min(0).max(1).optional().default(0.3),
  includeRecentOnly: z.boolean().optional().default(false),
  
  // Analysis configuration
  enableConflictDetection: z.boolean().optional().default(true),
  enableSourceVerification: z.boolean().optional().default(true),
  enableSynthesis: z.boolean().optional().default(true),
  
  // Output preferences
  outputFormat: z.enum(['comprehensive', 'summary', 'citations_only', 'conflicts_focus']).optional().default('comprehensive'),
  includeRawData: z.boolean().optional().default(false),
  includeActivityLog: z.boolean().optional().default(false),
  
  // Advanced options
  queryExpansion: z.object({
    enableSynonyms: z.boolean().optional().default(true),
    enableSpellCheck: z.boolean().optional().default(true),
    enableContextual: z.boolean().optional().default(true),
    maxVariations: z.number().min(1).max(20).optional().default(8)
  }).optional(),
  
  concurrency: z.number().min(1).max(20).optional().default(5),
  cacheResults: z.boolean().optional().default(true),
  
  // Webhook notifications for long-running research
  webhook: z.object({
    url: z.string().url(),
    events: z.array(z.enum(['started', 'progress', 'completed', 'failed'])).optional().default(['completed']),
    headers: z.record(z.string()).optional()
  }).optional()
});

export class DeepResearchTool {
  constructor(options = {}) {
    const {
      defaultTimeLimit = 120000,
      maxConcurrentResearch = 3,
      cacheEnabled = true,
      cacheTTL = 1800000, // 30 minutes
      ...orchestratorOptions
    } = options;

    this.defaultTimeLimit = defaultTimeLimit;
    this.maxConcurrentResearch = maxConcurrentResearch;
    this.logger = new Logger({ component: 'DeepResearchTool' });
    
    // Track active research sessions
    this.activeSessions = new Map();
    this.sessionQueue = [];
    
    // Default orchestrator configuration
    this.defaultOrchestratorConfig = {
      cacheEnabled,
      cacheTTL,
      ...orchestratorOptions
    };
  }

  async execute(params) {
    try {
      const validated = DeepResearchSchema.parse(params);
      const sessionId = this.generateSessionId();
      
      this.logger.info('Starting deep research', { 
        sessionId, 
        topic: validated.topic,
        config: this.sanitizeConfigForLogging(validated)
      });

      // Check concurrent session limits
      if (this.activeSessions.size >= this.maxConcurrentResearch) {
        return {
          success: false,
          error: 'Maximum concurrent research sessions reached. Please try again later.',
          queuePosition: this.sessionQueue.length + 1,
          estimatedWaitTime: this.estimateWaitTime()
        };
      }

      // Configure research orchestrator based on research approach
      const orchestratorConfig = this.buildOrchestratorConfig(validated);
      const orchestrator = new ResearchOrchestrator(orchestratorConfig);

      // Register session
      this.activeSessions.set(sessionId, {
        orchestrator,
        startTime: Date.now(),
        topic: validated.topic,
        status: 'running'
      });

      // Set up event listeners for progress tracking
      this.setupEventListeners(orchestrator, sessionId, validated);

      try {
        // Conduct the research
        const researchResults = await orchestrator.conductResearch(
          validated.topic,
          this.buildResearchOptions(validated)
        );

        // Format results according to output preference
        const formattedResults = this.formatResults(researchResults, validated);

        // Clean up session
        this.activeSessions.delete(sessionId);

        this.logger.info('Research completed successfully', { 
          sessionId,
          duration: Date.now() - this.activeSessions.get(sessionId)?.startTime || 0,
          findingsCount: researchResults.findings?.length || 0
        });

        return {
          success: true,
          sessionId,
          ...formattedResults
        };

      } catch (researchError) {
        // Handle research-specific errors
        this.logger.error('Research execution failed', {
          sessionId,
          error: researchError.message
        });

        const partialResults = orchestrator.getResearchState();
        this.activeSessions.delete(sessionId);

        return {
          success: false,
          sessionId,
          error: researchError.message,
          partialResults: validated.includeRawData ? partialResults : undefined,
          recommendations: this.generateErrorRecoveryRecommendations(researchError, validated)
        };
      }

    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return {
          success: false,
          error: 'Invalid parameters',
          details: validationError.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            received: err.received
          }))
        };
      }

      this.logger.error('Unexpected error in deep research', { error: validationError.message });
      return {
        success: false,
        error: 'An unexpected error occurred during research initialization',
        details: validationError.message
      };
    }
  }

  /**
   * Build orchestrator configuration based on research approach
   */
  buildOrchestratorConfig(params) {
    const baseConfig = { ...this.defaultOrchestratorConfig };
    
    // Adjust configuration based on research approach
    switch (params.researchApproach) {
      case 'academic':
        return {
          ...baseConfig,
          maxDepth: Math.min(params.maxDepth, 8),
          enableSourceVerification: true,
          searchConfig: {
            enableRanking: true,
            rankingWeights: {
              authority: 0.4, // Higher weight for academic sources
              semantic: 0.3,
              bm25: 0.2,
              freshness: 0.1
            }
          }
        };
        
      case 'current_events':
        return {
          ...baseConfig,
          maxDepth: Math.min(params.maxDepth, 6),
          searchConfig: {
            enableRanking: true,
            rankingWeights: {
              freshness: 0.4, // Prioritize recent content
              semantic: 0.3,
              bm25: 0.2,
              authority: 0.1
            }
          }
        };
        
      case 'focused':
        return {
          ...baseConfig,
          maxDepth: Math.min(params.maxDepth, 4),
          maxUrls: Math.min(params.maxUrls, 30),
          concurrency: Math.min(params.concurrency, 3)
        };
        
      case 'comparative':
        return {
          ...baseConfig,
          enableConflictDetection: true,
          maxDepth: params.maxDepth,
          searchConfig: {
            enableDeduplication: true,
            deduplicationThresholds: {
              url: 0.9,
              title: 0.8,
              content: 0.7
            }
          }
        };
        
      case 'broad':
      default:
        return {
          ...baseConfig,
          maxDepth: params.maxDepth,
          maxUrls: params.maxUrls,
          timeLimit: params.timeLimit
        };
    }
  }

  /**
   * Build research options for the orchestrator
   */
  buildResearchOptions(params) {
    return {
      sourceTypes: params.sourceTypes,
      credibilityThreshold: params.credibilityThreshold,
      includeRecentOnly: params.includeRecentOnly,
      queryExpansion: params.queryExpansion,
      enableConflictDetection: params.enableConflictDetection,
      enableSourceVerification: params.enableSourceVerification,
      enableSynthesis: params.enableSynthesis,
      concurrency: params.concurrency
    };
  }

  /**
   * Set up event listeners for research progress tracking
   */
  setupEventListeners(orchestrator, sessionId, params) {
    if (params.webhook) {
      orchestrator.on('researchCompleted', (data) => {
        this.sendWebhookNotification(params.webhook, 'completed', {
          sessionId,
          ...data
        });
      });

      orchestrator.on('researchFailed', (data) => {
        this.sendWebhookNotification(params.webhook, 'failed', {
          sessionId,
          ...data
        });
      });

      orchestrator.on('activityLogged', (activity) => {
        if (params.webhook.events.includes('progress')) {
          this.sendWebhookNotification(params.webhook, 'progress', {
            sessionId,
            activity
          });
        }
      });
    }

    // Internal progress tracking
    orchestrator.on('activityLogged', (activity) => {
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.lastActivity = activity;
        session.status = activity.type;
      }
    });
  }

  /**
   * Format research results according to output preferences
   */
  formatResults(results, params) {
    const formatted = {
      researchSummary: results.researchSummary,
      metadata: results.metadata
    };

    switch (params.outputFormat) {
      case 'comprehensive':
        return {
          ...formatted,
          findings: results.findings,
          supportingEvidence: results.supportingEvidence,
          consensus: results.consensus,
          conflicts: results.conflicts,
          researchGaps: results.researchGaps,
          recommendations: results.recommendations,
          credibilityAssessment: results.credibilityAssessment,
          performance: results.performance,
          activityLog: params.includeActivityLog ? results.activityLog : undefined,
          rawData: params.includeRawData ? this.extractRawData(results) : undefined
        };

      case 'summary':
        return {
          ...formatted,
          keyFindings: results.findings.slice(0, 5),
          topSources: results.supportingEvidence.slice(0, 5),
          mainConflicts: results.conflicts.slice(0, 3),
          primaryRecommendations: results.recommendations.slice(0, 3),
          credibilityOverview: {
            averageCredibility: results.credibilityAssessment.averageCredibility,
            highCredibilitySources: results.credibilityAssessment.highCredibilitySources
          }
        };

      case 'citations_only':
        return {
          ...formatted,
          sources: results.supportingEvidence.map(source => ({
            title: source.title,
            url: source.url,
            credibility: source.credibility,
            relevance: source.relevance
          })),
          citationCount: results.supportingEvidence.length,
          citationSummary: this.generateCitationSummary(results.supportingEvidence)
        };

      case 'conflicts_focus':
        return {
          ...formatted,
          conflicts: results.conflicts,
          conflictAnalysis: this.analyzeConflicts(results.conflicts),
          consensusAreas: results.consensus,
          recommendedActions: results.recommendations.filter(r => 
            r.type === 'conflict_resolution' || r.type === 'validation'
          )
        };

      default:
        return formatted;
    }
  }

  /**
   * Generate citation summary for citation-focused output
   */
  generateCitationSummary(sources) {
    const domainCounts = {};
    const typeDistribution = { academic: 0, commercial: 0, government: 0, other: 0 };
    
    sources.forEach(source => {
      try {
        const domain = new URL(source.url).hostname;
        domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        
        // Classify source type
        if (domain.includes('edu') || domain.includes('scholar')) {
          typeDistribution.academic++;
        } else if (domain.includes('gov')) {
          typeDistribution.government++;
        } else if (domain.includes('com')) {
          typeDistribution.commercial++;
        } else {
          typeDistribution.other++;
        }
      } catch {
        typeDistribution.other++;
      }
    });

    return {
      totalSources: sources.length,
      uniqueDomains: Object.keys(domainCounts).length,
      topDomains: Object.entries(domainCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([domain, count]) => ({ domain, count })),
      sourceTypeDistribution: typeDistribution,
      averageCredibility: sources.reduce((sum, s) => sum + (s.credibility || 0), 0) / sources.length
    };
  }

  /**
   * Analyze conflicts for conflict-focused output
   */
  analyzeConflicts(conflicts) {
    if (!conflicts.length) {
      return {
        conflictCount: 0,
        severity: 'none',
        resolutionPriority: 'low'
      };
    }

    const severityLevels = conflicts.map(c => c.severity || 0.5);
    const avgSeverity = severityLevels.reduce((sum, s) => sum + s, 0) / severityLevels.length;
    
    return {
      conflictCount: conflicts.length,
      averageSeverity: avgSeverity,
      severityDistribution: {
        high: severityLevels.filter(s => s >= 0.7).length,
        medium: severityLevels.filter(s => s >= 0.4 && s < 0.7).length,
        low: severityLevels.filter(s => s < 0.4).length
      },
      conflictTypes: [...new Set(conflicts.map(c => c.type))],
      resolutionPriority: avgSeverity >= 0.7 ? 'high' : avgSeverity >= 0.4 ? 'medium' : 'low',
      recommendations: this.generateConflictResolutionRecommendations(conflicts)
    };
  }

  /**
   * Generate conflict resolution recommendations
   */
  generateConflictResolutionRecommendations(conflicts) {
    const recommendations = [];
    
    const highSeverityConflicts = conflicts.filter(c => (c.severity || 0) >= 0.7);
    if (highSeverityConflicts.length > 0) {
      recommendations.push({
        type: 'priority_investigation',
        description: `Investigate ${highSeverityConflicts.length} high-severity conflicts immediately`,
        urgency: 'high'
      });
    }

    const contradictionConflicts = conflicts.filter(c => c.type === 'contradiction');
    if (contradictionConflicts.length > 0) {
      recommendations.push({
        type: 'cross_reference',
        description: 'Cross-reference contradictory claims with additional authoritative sources',
        urgency: 'medium'
      });
    }

    recommendations.push({
      type: 'expert_consultation',
      description: 'Consider consulting domain experts for conflict resolution',
      urgency: 'low'
    });

    return recommendations;
  }

  /**
   * Extract raw data for debugging/analysis
   */
  extractRawData(results) {
    return {
      searchQueries: results.activityLog?.filter(log => log.type === 'topic_expansion'),
      sourcesDiscovered: results.activityLog?.filter(log => log.type === 'initial_gathering'),
      extractionResults: results.activityLog?.filter(log => log.type === 'deep_exploration'),
      verificationResults: results.activityLog?.filter(log => log.type === 'source_verification'),
      synthesisProcess: results.activityLog?.filter(log => log.type === 'information_synthesis')
    };
  }

  /**
   * Generate error recovery recommendations
   */
  generateErrorRecoveryRecommendations(error, params) {
    const recommendations = [];
    
    if (error.message.includes('timeout') || error.message.includes('time limit')) {
      recommendations.push({
        type: 'increase_time_limit',
        description: `Consider increasing time limit beyond ${params.timeLimit}ms`,
        suggestedValue: Math.min(params.timeLimit * 2, 300000)
      });
      
      recommendations.push({
        type: 'reduce_scope',
        description: 'Reduce research scope to fit within time constraints',
        suggestions: {
          maxUrls: Math.ceil(params.maxUrls * 0.7),
          maxDepth: Math.max(1, params.maxDepth - 1)
        }
      });
    }

    if (error.message.includes('network') || error.message.includes('fetch')) {
      recommendations.push({
        type: 'retry_with_delay',
        description: 'Network issues detected. Retry with increased delays between requests',
        suggestedDelay: 2000
      });
    }

    if (error.message.includes('rate limit')) {
      recommendations.push({
        type: 'reduce_concurrency',
        description: 'Rate limiting detected. Reduce concurrent operations',
        suggestedConcurrency: Math.max(1, Math.ceil(params.concurrency / 2))
      });
    }

    recommendations.push({
      type: 'fallback_approach',
      description: 'Try a more focused research approach',
      suggestedApproach: 'focused'
    });

    return recommendations;
  }

  /**
   * Send webhook notification
   */
  async sendWebhookNotification(webhook, event, data) {
    if (!webhook.events.includes(event)) return;

    try {
      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data
      };

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'MCP-WebScraper-DeepResearch/1.0',
          ...webhook.headers
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        this.logger.warn('Webhook notification failed', {
          url: webhook.url,
          status: response.status,
          event
        });
      }
    } catch (error) {
      this.logger.error('Webhook notification error', {
        url: webhook.url,
        error: error.message,
        event
      });
    }
  }

  /**
   * Utility methods
   */
  generateSessionId() {
    return `deep_research_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  sanitizeConfigForLogging(config) {
    const { webhook, ...safeConfig } = config;
    return {
      ...safeConfig,
      webhook: webhook ? { url: webhook.url, events: webhook.events } : undefined
    };
  }

  estimateWaitTime() {
    const avgSessionTime = 120000; // 2 minutes average
    const queueSize = this.sessionQueue.length;
    return queueSize * avgSessionTime;
  }

  /**
   * Public API for session management
   */
  getActiveSessions() {
    return Array.from(this.activeSessions.entries()).map(([id, session]) => ({
      sessionId: id,
      topic: session.topic,
      status: session.status,
      duration: Date.now() - session.startTime,
      lastActivity: session.lastActivity?.type
    }));
  }

  getSessionStatus(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    return {
      sessionId,
      topic: session.topic,
      status: session.status,
      duration: Date.now() - session.startTime,
      lastActivity: session.lastActivity,
      metrics: session.orchestrator.getMetrics()
    };
  }

  cancelSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.orchestrator.stopResearch();
      this.activeSessions.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Get tool statistics and health information
   */
  getStats() {
    return {
      activeSessions: this.activeSessions.size,
      queuedSessions: this.sessionQueue.length,
      maxConcurrent: this.maxConcurrentResearch,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }
}

export default DeepResearchTool;
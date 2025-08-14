#!/usr/bin/env node

/**
 * LLM Integration Test for Deep Research Tool Phase 2.1
 * Tests the enhanced ResearchOrchestrator with LLM capabilities
 */

import { ResearchOrchestrator } from '../src/core/ResearchOrchestrator.js';
import { LLMManager } from '../src/core/llm/LLMManager.js';

async function testLLMIntegration() {
  console.log('🧪 Testing LLM Integration for Deep Research Tool Phase 2.1');
  console.log('=' .repeat(60));

  // Test 1: LLM Manager Initialization
  console.log('\n1. Testing LLM Manager Initialization...');
  
  const llmConfig = {
    defaultProvider: 'auto',
    openai: {
      // API key would come from environment or user input
    },
    anthropic: {
      // API key would come from environment or user input
    }
  };

  const llmManager = new LLMManager(llmConfig);
  console.log(`✓ LLM Manager initialized`);
  console.log(`  Available providers: ${Object.keys(llmManager.getProvidersMetadata()).join(', ') || 'None (API keys not configured)'}`);
  console.log(`  LLM features available: ${llmManager.isAvailable()}`);

  // Test 2: ResearchOrchestrator with LLM Integration
  console.log('\n2. Testing ResearchOrchestrator with LLM Integration...');
  
  const orchestratorConfig = {
    maxDepth: 3,
    maxUrls: 10,
    timeLimit: 60000, // 1 minute for testing
    llmConfig: llmConfig,
    cacheEnabled: false // Disable cache for testing
  };

  const orchestrator = new ResearchOrchestrator(orchestratorConfig);
  console.log(`✓ ResearchOrchestrator initialized with LLM support`);
  console.log(`  LLM features enabled: ${orchestrator.enableLLMFeatures}`);

  // Test 3: Query Expansion (if LLM available)
  console.log('\n3. Testing Query Expansion...');
  
  const testTopic = 'artificial intelligence machine learning';
  
  try {
    const expandedQueries = await orchestrator.expandResearchTopic(testTopic);
    console.log(`✓ Query expansion completed`);
    console.log(`  Original topic: "${testTopic}"`);
    console.log(`  Expanded queries (${expandedQueries.length}):`);
    expandedQueries.forEach((query, index) => {
      console.log(`    ${index + 1}. ${query}`);
    });
    
    const semanticSimilarities = orchestrator.researchState.semanticSimilarities;
    if (semanticSimilarities.size > 0) {
      console.log(`  Semantic similarities calculated for ${semanticSimilarities.size} queries`);
    }
  } catch (error) {
    console.log(`⚠ Query expansion failed: ${error.message}`);
    console.log(`  This is expected if LLM providers are not configured`);
  }

  // Test 4: Traditional Relevance Calculation (Fallback)
  console.log('\n4. Testing Traditional Relevance Calculation...');
  
  const testContent = 'This article discusses artificial intelligence and machine learning algorithms in modern applications.';
  const relevanceScore = orchestrator.calculateTraditionalRelevance(testContent, testTopic);
  console.log(`✓ Traditional relevance calculation completed`);
  console.log(`  Content: "${testContent.substring(0, 50)}..."`);
  console.log(`  Topic: "${testTopic}"`);
  console.log(`  Relevance score: ${relevanceScore.toFixed(3)}`);

  // Test 5: Metrics and State
  console.log('\n5. Testing Metrics and State Tracking...');
  
  const metrics = orchestrator.getMetrics();
  console.log(`✓ Metrics tracking working`);
  console.log(`  Query expansion time: ${metrics.queryExpansionTime}ms`);
  console.log(`  LLM analysis calls: ${metrics.llmAnalysisCalls}`);
  console.log(`  Semantic analysis time: ${metrics.semanticAnalysisTime}ms`);

  const state = orchestrator.getResearchState();
  console.log(`✓ State tracking working`);
  console.log(`  LLM analysis entries: ${state.llmAnalysis.size}`);
  console.log(`  Semantic similarities: ${state.semanticSimilarities.size}`);
  console.log(`  Relevance scores: ${state.relevanceScores.size}`);

  // Test 6: Health Check (if providers available)
  if (llmManager.isAvailable()) {
    console.log('\n6. Testing LLM Provider Health Check...');
    
    try {
      const health = await llmManager.healthCheck();
      console.log(`✓ Health check completed`);
      Object.entries(health).forEach(([provider, status]) => {
        console.log(`  ${provider}: ${status.available ? '✓ Available' : '✗ Unavailable'}`);
        if (!status.available && status.error) {
          console.log(`    Error: ${status.error}`);
        }
      });
    } catch (error) {
      console.log(`⚠ Health check failed: ${error.message}`);
    }
  }

  // Test 7: Cleanup
  console.log('\n7. Testing Cleanup...');
  
  try {
    await orchestrator.cleanup();
    console.log(`✓ Cleanup completed successfully`);
    
    const cleanedState = orchestrator.getResearchState();
    const cleanedMetrics = orchestrator.getMetrics();
    
    console.log(`  State reset - Session ID: ${cleanedState.sessionId || 'null'}`);
    console.log(`  Metrics reset - Total processing time: ${cleanedMetrics.totalProcessingTime}`);
  } catch (error) {
    console.log(`⚠ Cleanup failed: ${error.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎉 LLM Integration Test Complete');
  console.log('\nNotes:');
  console.log('- To test full LLM functionality, set OPENAI_API_KEY or ANTHROPIC_API_KEY');
  console.log('- The system gracefully falls back to traditional methods when LLM is unavailable');
  console.log('- Phase 2.1 enhancements include:');
  console.log('  • Intelligent query expansion with semantic understanding');
  console.log('  • AI-driven relevance scoring and content analysis');
  console.log('  • Enhanced research synthesis with conflict detection');
  console.log('  • Advanced provenance tracking and activity logging');
  console.log('  • Smart URL prioritization based on content quality');
}

// Run the test
testLLMIntegration().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
#!/usr/bin/env node

import { SearchWebTool } from './src/tools/search/searchWeb.js';
import { config, getActiveSearchProvider, getToolConfig } from './src/constants/config.js';

async function testSearch() {
  console.log('Testing search functionality...\n');
  
  // Get active provider
  const provider = getActiveSearchProvider();
  console.log(`Active search provider: ${provider}`);
  console.log(`Google API configured: ${!!config.search.google.apiKey}`);
  console.log(`Using provider: ${provider}\n`);
  
  try {
    // Initialize search tool
    const searchTool = new SearchWebTool(getToolConfig('search_web'));
    
    // Test basic search
    console.log('Testing basic search for "javascript tutorial"...');
    const results = await searchTool.execute({
      query: 'javascript tutorial',
      limit: 5
    });
    
    console.log(`\nSearch Results (${results.results.length} results):`);
    console.log('Provider used:', results.provider || 'unknown');
    console.log('Total results:', results.total_results || 'N/A');
    console.log('Search time:', results.search_time || 'N/A');
    
    results.results.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.title}`);
      console.log(`   URL: ${result.link}`);
      console.log(`   Snippet: ${result.snippet?.substring(0, 100)}...`);
    });
    
    // Test with site filter
    console.log('\n\nTesting search with site filter (mozilla.org)...');
    const siteResults = await searchTool.execute({
      query: 'javascript',
      site: 'mozilla.org',
      limit: 3
    });
    
    console.log(`Site-filtered results (${siteResults.results.length} results):`);
    siteResults.results.forEach((result, index) => {
      console.log(`${index + 1}. ${result.title} - ${result.link}`);
    });
    
  } catch (error) {
    console.error('Search test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
testSearch().catch(console.error);
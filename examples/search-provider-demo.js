#!/usr/bin/env node

/**
 * Demonstration of dual search provider support
 * Shows how the system automatically selects between DuckDuckGo and Google
 */

import { SearchWebTool } from '../src/tools/search/searchWeb.js';
import { config, getActiveSearchProvider, getToolConfig } from '../src/constants/config.js';

async function demonstrateSearchProviders() {
  console.log('=== MCP WebScraper Search Provider Demo ===\n');
  
  // Show current configuration
  const activeProvider = getActiveSearchProvider();
  console.log('Configuration Status:');
  console.log(`- Active Provider: ${activeProvider}`);
  console.log(`- Google API Key: ${config.search.google.apiKey ? 'Configured ✓' : 'Not configured ✗'}`);
  console.log(`- Search Engine ID: ${config.search.google.searchEngineId ? 'Configured ✓' : 'Not configured ✗'}`);
  console.log(`- Provider Mode: ${config.search.provider || 'auto'}`);
  
  console.log('\nProvider Selection Logic:');
  if (config.search.provider === 'auto' || !config.search.provider) {
    console.log('- Mode: AUTO (default)');
    console.log('- Will use Google if credentials are available');
    console.log('- Falls back to DuckDuckGo if no Google credentials');
  } else {
    console.log(`- Mode: MANUAL (${config.search.provider})`);
  }
  
  try {
    // Initialize search tool
    const searchTool = new SearchWebTool(getToolConfig('search_web'));
    
    // Perform a sample search
    console.log('\n=== Performing Test Search ===');
    console.log('Query: "Node.js MCP server tutorial"');
    console.log(`Using: ${activeProvider.toUpperCase()} provider\n`);
    
    const results = await searchTool.execute({
      query: 'Node.js MCP server tutorial',
      limit: 3
    });
    
    // Display provider information
    if (results.provider) {
      console.log('Provider Details:');
      console.log(`- Name: ${results.provider.name}`);
      console.log(`- API Key Required: ${results.provider.capabilities?.requiresApiKey ? 'Yes' : 'No'}`);
      console.log(`- Max Results: ${results.provider.capabilities?.maxResultsPerRequest || 'N/A'}`);
      
      if (results.provider.capabilities?.features) {
        console.log('- Features:');
        results.provider.capabilities.features.forEach(feature => {
          console.log(`  • ${feature}`);
        });
      }
    }
    
    // Display search results
    console.log('\n=== Search Results ===');
    console.log(`Total Results: ${results.total_results || 'Unknown'}`);
    console.log(`Results Returned: ${results.results.length}`);
    console.log(`Search Time: ${results.search_time || 'N/A'}s`);
    
    if (results.results.length > 0) {
      console.log('\nTop Results:');
      results.results.forEach((result, index) => {
        console.log(`\n${index + 1}. ${result.title}`);
        console.log(`   URL: ${result.link}`);
        console.log(`   ${result.snippet?.substring(0, 120)}...`);
      });
    }
    
    // Show how to switch providers
    console.log('\n=== Provider Configuration Options ===');
    console.log('\n1. Auto Mode (Default):');
    console.log('   No configuration needed - automatically selects best available provider');
    
    console.log('\n2. Force DuckDuckGo:');
    console.log('   Set environment variable: SEARCH_PROVIDER=duckduckgo');
    
    console.log('\n3. Force Google (requires API credentials):');
    console.log('   Set environment variables:');
    console.log('   - SEARCH_PROVIDER=google');
    console.log('   - GOOGLE_API_KEY=your_api_key');
    console.log('   - GOOGLE_SEARCH_ENGINE_ID=your_engine_id');
    
    console.log('\n4. Get Google API Credentials:');
    console.log('   - Visit: https://console.cloud.google.com/');
    console.log('   - Enable Custom Search API');
    console.log('   - Create credentials');
    console.log('   - Create search engine at: https://cse.google.com/');
    
  } catch (error) {
    console.error('\nError during search:', error.message);
    
    if (error.message.includes('API key')) {
      console.log('\nNote: Google provider requires API credentials.');
      console.log('The system should automatically use DuckDuckGo as fallback.');
    }
  }
  
  console.log('\n=== Demo Complete ===');
}

// Run the demonstration
demonstrateSearchProviders().catch(console.error);